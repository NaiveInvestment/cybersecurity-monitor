// 해킹 사건 페이지 데이터: 세 원천을 사건 하나 = 피해 기관 하나로 합친다. 판단 점수는 넣지 않고 발표된 숫자만 싣는다.
// 1. 리서치(data/incidents/research.json): 원문 링크를 확인한 사건. 규모, 업권, 공격 내용이 있다. 겹치면 이쪽이 우선.
// 2. 보도 수집 사건 기록(state/incident-log.json의 피해 주체 사전 사건): 리서치 이후 새 사건을 자동으로 잡는다. 규모는 비어 있다.
// 3. DeFiLlama 가상자산 해킹: 탈취 금액. 리서치에 같은 이름이 7일 안에 있으면 뺀다.

import { autoDetect, incidentParty } from "./incident-auto.mjs";

const DAY = 86400000;
export const kstDay = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
const norm = (s) => String(s).toLowerCase().replace(/\(.*?\)|[^a-z0-9가-힣ぁ-んァ-ン一-龥]/g, "");
export const sameName = (a, b) => { const x = norm(a), y = norm(b); return x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x)); };
const KOREAN_CRYPTO = /upbit|bithumb|coinone|korbit|gdac|playdapp|gopax/i;

// 피해 주체 사전의 분야를 리서치 업권 이름으로 맞춘다.
const SECTOR_ORG = { 금융: "금융회사", 가상자산: "가상자산 거래소", 공공: "공공기관", 교육: "대학, 병원", 기업: "일반 기업", 통신: "통신사" };
const ORG_OVERRIDE = { fsi: "국가기관, 금융 감독 또는 보안 기관" };

const slug = (s) => norm(s).slice(0, 24) || "x";

// 원화 금전 피해: "약100000000 KRW", "KRW 2,000,000", "약 1억원", "200만원". 탈취, 출금, 무단 사용 같은 금전 손실 문맥일 때만 읽는다.
const MONEY_CONTEXT = /탈취|출금|무단\s?(사용|결제|이체)|도난|피해\s?(금액|자산)|자산\s?피해|소액결제|토큰\s?(무단\s?)?사용/;
export function parseKrw(text) {
  const s = String(text || "");
  let m = /([\d,]+(?:\.\d+)?)\s*KRW|KRW\s*([\d,]+(?:\.\d+)?)/.exec(s);
  if (m) return Number((m[1] || m[2]).replace(/,/g, ""));
  m = /(\d+(?:\.\d+)?)\s*억\s*(?:(\d[\d,]*)\s*만)?\s*원/.exec(s);
  if (m) return Number(m[1]) * 1e8 + (m[2] ? Number(m[2].replace(/,/g, "")) * 1e4 : 0);
  m = /(\d[\d,]*(?:\.\d+)?)\s*만\s*원/.exec(s);
  if (m) return Number(m[1].replace(/,/g, "")) * 1e4;
  return null;
}
export function researchKrw(r) {
  if (r.usd) return null;
  if (!MONEY_CONTEXT.test(`${r.loss_or_outage || ""} ${r.attack || ""}`)) return null;
  return parseKrw(r.amount_note) ?? parseKrw(r.loss_or_outage);
}

// fx: 1달러당 원화(사이트 시세 스냅샷). 원화로만 발표된 금전 피해는 달러로 환산해 금액 차트와 지수에 넣고 원래 금액을 함께 싣는다.
export function fromResearch(list, { fx = null } = {}) {
  return list.map((r) => {
    const krw = fx ? researchKrw(r) : null;
    return {
    id: `r-${r.date}-${slug(r.name)}`,
    d: r.date, n: r.name, r: r.region, org: r.org_type,
    rec: r.records ?? null, recUnit: r.records_unit ?? null, basis: r.size_basis ?? null, claim: r.size_basis === "해커 주장",
    usd: r.usd ?? (krw ? krw / fx : null), krw: krw || null, usdBasis: krw ? "원화 발표, 환산" : null, amt: r.amount_note ?? null,
    atk: r.attack || "", src: (r.sources || []).map((s) => ({ o: s.outlet, u: s.url, t: s.title, d: s.date })), via: "리서치",
  };
  });
}

// 제목 속 유출 규모: "1,811명", "1천800명", "2만4천여 건", "300여 계정", "15만명" 같은 꼴을 숫자로 바꾼다.
export function parseCount(text) {
  const en = /(\d[\d,]*(?:\.\d+)?)\s*(million|billion)?\s+(?:[a-z']+\s+){0,2}?(people|persons|customers|users|records|drivers|patients|individuals|members|accounts|employees|students)\b/i.exec(String(text));
  if (en) {
    const base = Number(en[1].replace(/,/g, ""));
    const value = en[2] ? base * (en[2].toLowerCase() === "billion" ? 1e9 : 1e6) : base;
    if (Number.isFinite(value) && value >= 10) return Math.round(value);
  }
  // "1만9천978건"처럼 단위가 이어진 숫자는 모두 더한다. 제목에 숫자가 여럿이면("9명→2009명") 가장 큰 값.
  const UNIT = { 억: 1e8, 만: 1e4, 천: 1e3, "": 1 };
  let best = null;
  for (const m of String(text).matchAll(/((?:\d[\d,]*(?:\.\d+)?\s*[억만천]?\s*)+)여?\s*(?:명|건|개\s*계정|계정|계좌)/g)) {
    let value = 0;
    for (const [, num, unit] of m[1].matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([억만천]?)/g)) value += Number(num.replace(/,/g, "")) * UNIT[unit];
    if (Number.isFinite(value) && value >= 10 && (best === null || value > best)) best = Math.round(value);
  }
  return best;
}

const UNSURE = /우려|가능성|추정|주장|의혹|\balleged(ly)?\b|\bclaims?\b|\bmay\b|\bpossibl[ey]\b/i;

// 서로 다른 매체 2곳 이상의 제목에 같은 숫자가 나와야 규모로 쓴다.
export function headlineCount(items) {
  const bySource = new Map();
  for (const item of items) {
    const value = parseCount(item.t);
    if (value) { if (!bySource.has(value)) bySource.set(value, new Set()); bySource.get(value).add(item.s); }
  }
  const best = [...bySource.entries()].filter(([, set]) => set.size >= 2).sort((a, b) => b[1].size - a[1].size || b[0] - a[0])[0];
  return best ? best[0] : null;
}

// 사건 기록(state/incident-log.json)에서 피해 주체 사전에 걸리고 3개 매체 이상이 다룬 사건만(1~2곳은 해설, 시황 기사가 많다).
// 리서치에 같은 기관이 14일 안에 있으면 뺀다. newsItems를 주면 제목 속 규모를 채운다.
export function fromNewsLog(stories, entities, research, { since, newsItems = [], minMedia = 3 }) {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const itemById = new Map(newsItems.map((item) => [item.id, item]));
  return stories.filter((s) => s.e && s.s >= minMedia && kstDay(Date.parse(s.f)) >= since).flatMap((s) => {
    const entity = byId.get(s.e);
    const day = kstDay(Date.parse(s.f));
    const alias = incidentParty(s.name) ?? incidentParty(s.t);
    const n = alias?.name ?? s.name;
    const region = alias?.region ?? s.r;
    const dup = research.some((r) => r.r === region && (sameName(incidentParty(r.n)?.name ?? r.n, n) || (entity && entity.regex.some((re) => re.test(r.n)))) && Math.abs(Date.parse(r.d) - Date.parse(day)) <= 14 * DAY);
    if (dup) return [];
    const rec = headlineCount((s.m || []).map((id) => itemById.get(id)).filter(Boolean));
    return [{ id: `n-${s.id}`, d: day, n, r: region, org: ORG_OVERRIDE[s.e] || SECTOR_ORG[s.sector] || "일반 기업", rec, recUnit: null, basis: rec ? "보도(제목 숫자)" : null, claim: false, usd: null, amt: null, atk: "", src: [{ o: `보도 ${s.s}개 매체`, u: s.u, t: s.t, d: day }], media: s.s, via: "보도 수집" }];
  });
}

export function fromDefiLlama(hacks, research, { since, minUsd = 1e7 }) {
  return hacks.filter((h) => h.amount >= minUsd && kstDay(h.date * 1000) >= since).flatMap((h) => {
    const day = kstDay(h.date * 1000);
    const name = h.name.replace(/ CEX$/, "");
    if (research.some((r) => sameName(r.n, name) && Math.abs(Date.parse(r.d) - Date.parse(day)) <= 7 * DAY)) return [];
    return [{ id: `d-${day}-${slug(name)}`, d: day, n: name, r: KOREAN_CRYPTO.test(h.name) ? "KR" : "GL", org: "가상자산 거래소", rec: null, recUnit: null, basis: "집계(DeFiLlama)", claim: false, usd: h.amount, amt: null, atk: [h.classification, h.technique].filter(Boolean).join(", "), src: [{ o: "DeFiLlama", u: "https://defillama.com/hacks", t: name, d: day }], via: "DeFiLlama" }];
  });
}

// 리서치 마감(researchUntil) 다음 날부터는 사전 밖 사건도 기사 제목에서 자동 감지한다("자동 감지"로 표시).
export function fromAuto(stories, { newsItems = [], known = [], after }) {
  const itemsById = new Map(newsItems.map((item) => [item.id, item]));
  return autoDetect(stories, itemsById, { after, known: known.map((e) => ({ n: e.n, r: e.r, d: e.d })), sameName, kstDay }).map(({ story, name, region, day, items, lead, media }) => {
    // 규모: 매체 2곳 이상이 같은 숫자를 쓰면 그 숫자. 기사가 한 매체뿐이면 그 제목의 숫자(1개 매체로 표시).
    // "우려", "가능성", "주장", "alleged"가 붙은 숫자는 확정이 아니라 집계에서 뺀다(해커 주장과 같은 취급).
    const agreed = headlineCount(items);
    const single = !agreed && new Set(items.map((item) => item.s)).size <= 1 ? parseCount(lead.t) : null;
    const rec = agreed ?? single;
    const unsure = Boolean(rec) && UNSURE.test(lead.t);
    return { id: `a-${story.id}`, d: day, n: name, r: region, org: "기타", rec, recUnit: null, basis: rec ? (unsure ? "보도(확정 전)" : agreed ? "보도(제목 숫자)" : "보도(1개 매체 제목)") : null, claim: unsure, usd: null, amt: null, atk: lead.t, src: [{ o: media > 1 ? `보도 ${media}개 매체` : lead.s || "보도", u: lead.u, t: lead.t, d: day }], media, via: "자동 감지" };
  });
}

export function mergeEvents({ research, newsLog = [], entities = [], hacks = [], newsItems = [], since, fx = null, researchUntil = null }) {
  const r = fromResearch(research, { fx }).filter((e) => e.d >= since);
  const n = fromNewsLog(newsLog, entities, r, { since, newsItems });
  const d = fromDefiLlama(hacks, r, { since });
  const a = researchUntil ? fromAuto(newsLog, { newsItems, known: [...r, ...n, ...d], after: researchUntil > since ? researchUntil : since }) : [];
  // 피해 규모가 일치하고 보상이나 사과를 다루는 후속 보도는 원래 사건에 귀속한다.
  const candidates = [...n, ...a].filter(event => {
    if (!event.rec || !/보상|사과|compensation|apolog/i.test(event.src[0]?.t)) return true;
    return !r.some(prior => {
      const days = (Date.parse(event.d) - Date.parse(prior.d)) / DAY;
      return days >= 0 && days <= 45 && prior.r === event.r && prior.rec === event.rec &&
        sameName(incidentParty(prior.n)?.name ?? prior.n, event.n);
    });
  });
  const ids = new Set();
  return [...r, ...d, ...candidates].filter((e) => (ids.has(e.id) ? false : ids.add(e.id))).sort((a, b) => b.d.localeCompare(a.d) || a.n.localeCompare(b.n));
}

// ransomware.live 월 목록을 일별 건수로 바꾼다(공개일 KST 기준).
export function ransomwareDays(list) {
  const days = {};
  for (const v of list) {
    const at = Date.parse(v.discovered || v.attackdate);
    if (Number.isNaN(at)) continue;
    const day = kstDay(at);
    const row = days[day] || (days[day] = { total: 0, KR: 0, kr: [] });
    row.total += 1;
    if (v.country === "KR") { row.KR += 1; row.kr.push(v.victim || v.post_title || ""); }
  }
  return days;
}
