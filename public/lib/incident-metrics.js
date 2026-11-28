// 보안 사고 페이지 계산과 차트(순수 함수). 사건 하나 = 피해 기관 하나, 숫자는 발표된 것만 쓴다.
// 강도 지수: 주마다 유출과 금액 두 요소를 0~100으로 바꿔 평균한다(가중치 같음).
// 건수는 리서치 마감 뒤 집계 방식(자동 감지)이 달라 지수에서 빼고 건수 차트로 따로 본다(c는 참고로만 계산).
//   유출 = log10(1 + 유출 건수 합 / 1천) / 기간 최대 주
//   금액 = log10(1 + 탈취 금액 합 / $100만) / 기간 최대 주
// 기간 최대 주는 국내와 해외의 모든 주에서 찾는다. 그래서 두 지역 지수는 같은 잣대로 비교된다.
// 유출과 금액은 로그라서 한 건의 초대형 사건이 지수를 혼자 끌고 가지 않는다.

export const REGION_LABEL = { ALL: "통합", KR: "국내", GL: "해외" };
const DAY = 86400000;
const toMs = (day) => Date.parse(`${day}T00:00:00Z`);
const toDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// until이 들어 있는 주까지 월요일 시작 n주. 마지막 주는 until까지만 있다(partial).
export function weeksEnding(until, n = 13) {
  const end = toMs(until);
  const monday = end - ((new Date(end).getUTCDay() + 6) % 7) * DAY;
  return Array.from({ length: n }, (_, i) => {
    const start = monday - (n - 1 - i) * 7 * DAY;
    return { start: toDay(start), end: toDay(start + 6 * DAY), partial: start + 6 * DAY > end };
  });
}

export const inRegion = (region) => (e) => region === "ALL" || e.r === region;
export const isIncidentCandidate = (event) => !["리서치", "DeFiLlama"].includes(event.via);
export const hasRec = (e) => Number.isFinite(e.rec) && e.rec >= 0 && !e.claim;
export const hasUsd = (e) => Number.isFinite(e.usd) && e.usd >= 0;
export const knownRec = (e) => (e.rec && !e.claim ? e.rec : 0);
export const knownUsd = (e) => e.usd || 0;

export function weeklyStats(events, weeks, region) {
  const list = events.filter(inRegion(region));
  return weeks.map((w) => {
    const inWeek = list.filter((e) => e.d >= w.start && e.d <= w.end);
    const rec = inWeek.reduce((t, e) => t + knownRec(e), 0);
    const usd = inWeek.reduce((t, e) => t + knownUsd(e), 0);
    const topRec = [...inWeek].sort((a, b) => knownRec(b) - knownRec(a))[0];
    const topUsd = [...inWeek].sort((a, b) => knownUsd(b) - knownUsd(a))[0];
    return { ...w, count: inWeek.length, rec, usd, recKnown: inWeek.filter(hasRec).length, usdKnown: inWeek.filter(hasUsd).length,
      topRec: knownRec(topRec || {}) ? topRec : null, topUsd: knownUsd(topUsd || {}) ? topUsd : null, events: inWeek };
  });
}

const recScale = (v) => Math.log10(1 + v / 1e3);
const usdScale = (v) => Math.log10(1 + v / 1e6);

// 반환: { KR: [{ start, index, c, r, m, partial }], GL: [...], max: { count, rec, usd } }
export function compositeIndex(events, weeks, regions = ["KR", "GL"]) {
  const groups = regions.map(region => [region, weeklyStats(events, weeks, region)]);
  const all = groups.flatMap(([, stats]) => stats);
  const max = { count: Math.max(1, ...all.map((w) => w.count)), rec: Math.max(1e-9, ...all.map((w) => recScale(w.rec))), usd: Math.max(1e-9, ...all.map((w) => usdScale(w.usd))) };
  const score = (w) => {
    const c = (w.count / max.count) * 100;
    const r = (recScale(w.rec) / max.rec) * 100;
    const m = (usdScale(w.usd) / max.usd) * 100;
    return { start: w.start, end: w.end, partial: w.partial, c, r, m, index: (r + m) / 2, count: w.count, rec: w.rec, usd: w.usd, recKnown: w.recKnown, usdKnown: w.usdKnown };
  };
  return { ...Object.fromEntries(groups.map(([region, stats]) => [region, stats.map(score)])), max };
}

export const fmtCount = (v) => (v >= 1e8 ? `${(v / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억` : v >= 1e4 ? `${(v / 1e4).toLocaleString("ko-KR", { maximumFractionDigits: v >= 1e6 ? 0 : 1 })}만` : Math.round(v).toLocaleString("ko-KR"));
export const fmtKrw = (v) => (v >= 1e8 ? `${(v / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억원` : `${Math.round(v / 1e4).toLocaleString("ko-KR")}만원`);
export const fmtUsd = (v) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toLocaleString("en-US", { maximumFractionDigits: v >= 1e8 ? 0 : 1 })}M` : `$${Math.round(v).toLocaleString("en-US")}`);
const fmt1 = (v) => v.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// 결론 문장 재료: 최근 4주(마지막 미완성 주 포함) 대 그 전 주들의 주당 건수.
// since, until: 자료 범위(첫 주와 마지막 주가 잘려 있을 수 있어 실제 일수로 나눈다).
export function summary(events, weeks, region, { since = weeks[0].start, until = weeks.at(-1).end } = {}) {
  const observed = events.filter((event) => event.d >= since && event.d <= until);
  const stats = weeklyStats(observed, weeks, region);
  const recent = stats.slice(-4), before = stats.slice(0, -4);
  const span = (w) => (Math.min(toMs(w.end), toMs(until)) - Math.max(toMs(w.start), toMs(since))) / DAY + 1;
  const perWeek = (list) => {
    const days = list.reduce((total, week) => total + Math.max(0, span(week)), 0);
    return days ? list.reduce((total, week) => total + week.count, 0) * 7 / days : null;
  };
  const sumField = (list, field) => list.reduce((total, week) => total + week[field], 0);
  return {
    total: stats.reduce((t, w) => t + w.count, 0),
    recentPerWeek: perWeek(recent),
    beforePerWeek: perWeek(before),
    recentRec: recent.reduce((t, w) => t + w.rec, 0),
    recentUsd: recent.reduce((t, w) => t + w.usd, 0),
    rec: stats.reduce((t, w) => t + w.rec, 0),
    usd: stats.reduce((t, w) => t + w.usd, 0),
    recKnown: sumField(stats, "recKnown"),
    usdKnown: sumField(stats, "usdKnown"),
    recentRecKnown: sumField(recent, "recKnown"),
    recentUsdKnown: sumField(recent, "usdKnown"),
  };
}

export function claimText(s, label) {
  if (s.recentPerWeek === null) return `${label} 보안 사고의 최근 4주 집계 자료가 없습니다.`;
  if (s.beforePerWeek === null) return `${label} 보안 사고는 최근 4주 주당 ${fmt1(s.recentPerWeek)}건입니다. 앞선 기간의 집계 자료는 없습니다.`;
  if (!s.beforePerWeek) return `${label} 보안 사고는 최근 4주 주당 ${fmt1(s.recentPerWeek)}건이며, 앞선 기간에 집계된 사고는 0건입니다.`;
  const ratio = s.recentPerWeek / s.beforePerWeek;
  const trend = ratio >= 1.3 ? `그 전(주당 ${fmt1(s.beforePerWeek)}건)의 ${fmt1(ratio)}배` : ratio <= 0.77 ? `그 전(주당 ${fmt1(s.beforePerWeek)}건)보다 줄었다` : `그 전(주당 ${fmt1(s.beforePerWeek)}건)과 비슷하다`;
  return `${label} 보안 사고는 최근 4주 주당 ${fmt1(s.recentPerWeek)}건으로 ${trend}.`;
}

// ---- 최근 7일 브리핑 ----
// until로 끝나는 7일 구간과 그 앞 7일 구간 n-1개를 같은 잣대로 비교한다(요일과 무관, 마지막 구간도 꽉 찬 7일).
// 피해 규모 = (유출 요소 + 금액 요소) / 2. 요소는 강도 지수와 같은 로그 눈금을 두 지역, 모든 구간의 최댓값으로 나눈 0~100.
// 건수도 같은 방식으로 순위를 매기되, 리서치 마감 뒤는 자동 감지라 앞 구간보다 많이 잡힐 수 있다(화면에 표시).
// 13개 구간 중 1~3위는 "큰 편"(건수는 "많은 편"), 11~13위는 "작은 편"("적은 편"), 나머지 "보통".
export function windowsEnding(until, n = 13) {
  const end = toMs(until);
  return Array.from({ length: n }, (_, i) => {
    const last = end - (n - 1 - i) * 7 * DAY;
    return { start: toDay(last - 6 * DAY), end: toDay(last) };
  });
}

export const LEVELS = { high: "큰 편", mid: "보통", low: "작은 편" };
export const COUNT_LEVELS = { high: "많은 편", mid: "보통", low: "적은 편" };
const levelOf = (rank, n) => (rank <= 3 ? "high" : rank > n - 3 ? "low" : "mid");

export function brief(events, until, { n = 13 } = {}) {
  const wins = windowsEnding(until, n);
  const stat = (region) => wins.map((w) => {
    const list = events.filter((e) => e.r === region && e.d >= w.start && e.d <= w.end);
    return { ...w, events: list, count: list.length, rec: list.reduce((t, e) => t + knownRec(e), 0), usd: list.reduce((t, e) => t + knownUsd(e), 0) };
  });
  const by = { KR: stat("KR"), GL: stat("GL") };
  const all = [...by.KR, ...by.GL];
  const max = { rec: Math.max(1e-9, ...all.map((w) => recScale(w.rec))), usd: Math.max(1e-9, ...all.map((w) => usdScale(w.usd))) };
  const size = (w) => ((recScale(w.rec) / max.rec) * 100 + (usdScale(w.usd) / max.usd) * 100) / 2;
  // 사건 하나의 크기: 유출과 금액 중 큰 쪽(같은 눈금)
  const weight = (e) => Math.max(recScale(knownRec(e)) / max.rec, usdScale(knownUsd(e)) / max.usd);
  const out = {};
  for (const region of ["KR", "GL"]) {
    const series = by[region].map((w) => ({ ...w, size: size(w) }));
    const cur = series.at(-1);
    const rank = series.filter((w) => w.size > cur.size).length + 1;
    const level = levelOf(rank, n);
    const countRank = series.filter((w) => w.count > cur.count).length + 1;
    const countLevel = levelOf(countRank, n);
    const ranked = [...cur.events].sort((a, b) => weight(b) - weight(a) || b.d.localeCompare(a.d));
    out[region] = { region, start: cur.start, end: cur.end, count: cur.count, rec: cur.rec, usd: cur.usd, size: cur.size, rank, n, level, label: LEVELS[level], countRank, countLevel, countLabel: COUNT_LEVELS[countLevel],
      top: ranked.filter((e) => weight(e) > 0).slice(0, 3), unsized: cur.events.filter((e) => !weight(e)).length,
      today: cur.events.filter((e) => e.d === until), series };
  }
  return out;
}

// 브리핑 제목 한 줄
export function briefTitle(b, region) {
  const clause = (x) => `사고 수 ${x.countLabel}, 피해 규모 ${x.label}`;
  if (region === "ALL") return `최근 7일 보안 사고: 국내는 ${clause(b.KR)}. 해외는 ${clause(b.GL)}`;
  return `최근 7일 ${REGION_LABEL[region]} 보안 사고: ${clause(b[region])}`;
}

// 업권별 건수(최근 4주와 그 전, 주당).
export const ORG_ORDER = ["금융회사", "가상자산 거래소", "국가기관, 금융 감독 또는 보안 기관", "공공기관", "통신사", "상장 대기업", "일반 기업", "대학, 병원", "기타"];
export const ORG_SHORT = { "국가기관, 금융 감독 또는 보안 기관": "국가, 감독, 보안 기관" };
export function orgBreakdown(events, weeks, region, coverage) {
  return ORG_ORDER.map((org) => {
    const mine = events.filter((e) => e.org === org || (org === "기타" && !ORG_ORDER.includes(e.org)));
    const { total, recentPerWeek, beforePerWeek } = summary(mine, weeks, region, coverage);
    return { org, label: ORG_SHORT[org] || org, total, recent: recentPerWeek, before: beforePerWeek };
  }).filter((row) => row.total);
}

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const r1 = (v) => Math.round(v * 10) / 10;
const shortName = (n, max = 14) => (n.length > max ? `${n.slice(0, max - 1)}…` : n);
const weekLabel = (w) => w.start.slice(5).replace("-", ".");

// ---- 차트: 모두 실제 표시 폭(px)을 받아 글자 크기가 줄지 않는다 ----

// 강도 지수 선. series: [{ key, label, points }], 단일 지역이면 요소 선(r, m)을 옅게 함께.
// 리서치에서 자동 감지로 바뀌는 주에 세로 점선. boundary: 자동 감지가 시작되는 날(YYYY-MM-DD).
function boundaryLine(weeks, boundary, xOf, top, bottom) {
  const i = boundary ? weeks.findIndex((w) => boundary >= w.start && boundary <= w.end) : -1;
  if (i < 0) return "";
  const x = r1(xOf(i));
  const labelOnLeft = i >= weeks.length / 2;
  return `<line class="ic-bound" x1="${x}" x2="${x}" y1="${top}" y2="${bottom}"/><text class="ic-boundlab" x="${x + (labelOnLeft ? -4 : 4)}" y="${top + 10}" text-anchor="${labelOnLeft ? "end" : "start"}">자동 감지</text>`;
}

export function indexChart(series, weeks, { width = 800, components = null, boundary = null, plotH = 210 } = {}) {
  const left = 40, right = 64, top = 14, H = top + plotH + 28;
  const plotW = Math.max(200, width - left - right);
  const x = (i) => left + (plotW * (i + 0.5)) / weeks.length;
  const y = (v) => top + plotH - (v / 100) * plotH;
  const p = [];
  for (const v of [0, 25, 50, 75, 100]) p.push(`<line class="ic-grid" x1="${left}" x2="${left + plotW}" y1="${y(v)}" y2="${y(v)}"/><text class="ic-tick" x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
  const step = Math.max(1, Math.ceil(46 / (plotW / weeks.length)));
  weeks.forEach((w, i) => { if ((weeks.length - 1 - i) % step === 0) p.push(`<text class="ic-tick" x="${r1(x(i))}" y="${H - 8}" text-anchor="middle">${weekLabel(w)}</text>`); });
  const path = (pts, key) => pts.map((pt, i) => pt.missing ? "" :
    `${i && !pts[i - 1].missing ? "L" : "M"}${r1(x(i))} ${r1(y(pt[key]))}`).join("");
  p.push(boundaryLine(weeks, boundary, (i) => x(i) - plotW / weeks.length / 2, top, top + plotH));
  if (components) {
    for (const [key, cls] of [["r", "comp-r"], ["m", "comp-m"]]) p.push(`<path class="ic-comp ${cls}" d="${path(components, key)}"/>`);
  }
  for (const s of series) {
    p.push(`<path class="ic-line ${s.key}" d="${path(s.points, "index")}"/>`);
    s.points.forEach((pt, i) => {
      if (pt.missing) return;
      p.push(`<circle class="ic-pt ${s.key}${pt.partial ? " partial" : ""}" cx="${r1(x(i))}" cy="${r1(y(pt.index))}" r="4"><title>${esc(`${s.label} ${weekLabel(pt)} 주${pt.partial ? "(집계 중)" : ""}: 강도 ${Math.round(pt.index)} (유출 ${Math.round(pt.r)}, 금액 ${Math.round(pt.m)}) / ${pt.count}건, 유출 ${pt.recKnown ? fmtCount(pt.rec) + "건" : "발표 없음"}, 금전 피해 ${pt.usdKnown ? fmtUsd(pt.usd) : "발표 없음"}`)}</title></circle>`);
    });
    const last = s.points.at(-1);
    if (!last || last.missing) continue;
    p.push(`<text class="ic-end ${s.key}" x="${r1(x(s.points.length - 1) + 9)}" y="${r1(y(last.index) + 4)}">${s.label} ${Math.round(last.index)}${last.partial ? "*" : ""}</text>`);
  }
  return `<svg class="ic" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="img" aria-label="주별 강도 지수">${p.join("")}</svg>`;
}

// 주별 건수 막대. groups: [{ key, label, stats }] 하나면 단일 막대, 둘이면 나란히. rw: 같은 주 랜섬웨어 피해 공개 건수(선택).
// left, right를 강도 지수와 같게 주면 같은 주가 위아래로 맞는다.
export function countChart(groups, weeks, { width = 800, boundary = null, left = 34, right = 10, plotH = 190 } = {}) {
  const top = 22, H = top + plotH + 28;
  const plotW = Math.max(200, width - left - right);
  const band = plotW / weeks.length;
  const max = Math.max(1, ...groups.flatMap((g) => g.stats.map((w) => w.count)));
  const yMax = Math.max(5, Math.ceil(max / 5) * 5);
  const y = (v) => top + plotH - (v / yMax) * plotH;
  const p = [];
  for (const v of [0, yMax / 2, yMax]) p.push(`<line class="ic-grid" x1="${left}" x2="${left + plotW}" y1="${y(v)}" y2="${y(v)}"/><text class="ic-tick" x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
  p.push(boundaryLine(weeks, boundary, (i) => left + band * i, top, top + plotH));
  const gw = Math.min(30, (band * 0.72) / groups.length);
  weeks.forEach((w, i) => {
    groups.forEach((g, k) => {
      const v = g.stats[i].count;
      const x0 = left + band * i + (band - gw * groups.length - 2 * (groups.length - 1)) / 2 + k * (gw + 2);
      const names = g.stats[i].events.slice(0, 10).map((e) => e.n).join(", ");
      p.push(`<rect class="ic-bar ${g.key}${w.partial ? " partial" : ""}" x="${r1(x0)}" y="${r1(y(v))}" width="${r1(gw)}" height="${r1(y(0) - y(v))}"><title>${esc(`${g.label} ${weekLabel(w)} 주 ${v}건${w.partial ? "(집계 중)" : ""}${names ? `: ${names}` : ""}`)}</title></rect>`);
      if (v && gw >= 9) p.push(`<text class="ic-val ${g.key}" x="${r1(x0 + gw / 2)}" y="${r1(y(v) - 4)}" text-anchor="middle">${v}</text>`);
    });
  });
  const step = Math.max(1, Math.ceil(46 / band));
  weeks.forEach((w, i) => { if ((weeks.length - 1 - i) % step === 0) p.push(`<text class="ic-tick" x="${r1(left + band * i + band / 2)}" y="${H - 8}" text-anchor="middle">${weekLabel(w)}</text>`); });
  p.push(`<line class="ic-axis" x1="${left}" x2="${left + plotW}" y1="${y(0)}" y2="${y(0)}"/>`);
  return `<svg class="ic" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="img" aria-label="주별 사건 수">${p.join("")}</svg>`;
}

// 사건별 규모 점(로그 눈금). kind: "rec" 유출 건수 | "usd" 탈취 금액.
export function sizeChart(events, weeks, kind, { width = 800, maxLabels = 10 } = {}) {
  const val = kind === "rec" ? knownRec : knownUsd;
  const list = events.filter((e) => val(e));
  const left = 54, right = 12, top = 12, plotH = kind === "rec" ? 250 : 190, H = top + plotH + 28;
  const plotW = Math.max(200, width - left - right);
  const t0 = toMs(weeks[0].start), t1 = toMs(weeks.at(-1).end) + DAY;
  const x = (d) => left + ((toMs(d) + DAY / 2 - t0) / (t1 - t0)) * plotW;
  // 금액 축은 가장 작은 금액이 있는 자리까지 내린다($1천~$100만 사이에서).
  const minUsd = Math.min(...list.map(val));
  const lo = kind === "rec" ? 1 : Math.max(3, Math.min(6, Math.floor(Math.log10(minUsd)))), hi = kind === "rec" ? 8 : 10;
  const y = (v) => top + plotH - ((Math.log10(Math.max(v, 10 ** lo)) - lo) / (hi - lo)) * plotH;
  const tickRec = { 1: "10", 2: "100", 3: "1천", 4: "1만", 5: "10만", 6: "100만", 7: "1천만", 8: "1억" };
  const tickUsd = { 3: "$1K", 4: "$10K", 5: "$100K", 6: "$1M", 7: "$10M", 8: "$100M", 9: "$1B", 10: "$10B" };
  const p = [];
  for (let k = lo; k <= hi; k += 1) p.push(`<line class="ic-grid" x1="${left}" x2="${left + plotW}" y1="${r1(y(10 ** k))}" y2="${r1(y(10 ** k))}"/><text class="ic-tick" x="${left - 6}" y="${r1(y(10 ** k) + 4)}" text-anchor="end">${(kind === "rec" ? tickRec : tickUsd)[k]}</text>`);
  const months = [...new Set(weeks.flatMap((w) => [w.start.slice(0, 7), w.end.slice(0, 7)]))].map((m) => `${m}-01`).filter((d) => toMs(d) > t0 && toMs(d) < t1);
  for (const d of months) p.push(`<line class="ic-vgrid" x1="${r1(x(d) - plotW / ((t1 - t0) / DAY) / 2)}" x2="${r1(x(d) - plotW / ((t1 - t0) / DAY) / 2)}" y1="${top}" y2="${top + plotH}"/><text class="ic-tick" x="${r1(x(d))}" y="${H - 8}" text-anchor="middle">${Number(d.slice(5, 7))}월</text>`);
  for (const e of [...list].sort((a, b) => val(a) - val(b))) {
    p.push(`<circle class="ic-dot ${e.r}" cx="${r1(x(e.d))}" cy="${r1(y(val(e)))}" r="5.5"><title>${esc(`${e.n} ${e.d} ${kind === "rec" ? `${fmtCount(val(e))}건` : `${fmtUsd(val(e))}${e.krw ? `(원화 ${fmtKrw(e.krw)} 환산)` : ""}`} (${e.r === "KR" ? "국내" : "해외"}${e.basis ? `, ${e.basis}` : ""})`)}</title></circle>`);
  }
  const boxes = [];
  const ranked = [...list].sort((a, b) => val(b) - val(a));
  const pick = new Set([...ranked.slice(0, maxLabels), ...ranked.filter((e) => e.r === "KR").slice(0, Math.ceil(maxLabels / 2))]);
  for (const e of ranked.filter((item) => pick.has(item))) {
    const text = `${shortName(e.n)} ${kind === "rec" ? `${fmtCount(val(e))}건` : e.krw ? fmtKrw(e.krw) : fmtUsd(val(e))}`;
    const w = [...text].reduce((t, ch) => t + (/[가-힣ぁ-んァ-ン一-龥]/.test(ch) ? 12 : 7), 0);
    const cx = x(e.d), cy = y(val(e));
    const box = cx + 9 + w > left + plotW ? { x: cx - 9 - w, y: cy - 7, w, h: 14 } : { x: cx + 9, y: cy - 7, w, h: 14 };
    if (box.x < left || boxes.some((o) => box.x < o.x + o.w + 4 && box.x + box.w + 4 > o.x && box.y < o.y + o.h + 1 && box.y + box.h + 1 > o.y)) continue;
    boxes.push(box);
    p.push(`<text class="ic-lab ${e.r}" x="${r1(box.x)}" y="${r1(box.y + 11)}">${esc(text)}</text>`);
  }
  return `<svg class="ic" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="img" aria-label="${kind === "rec" ? "사건별 유출 건수" : "사건별 금전 피해액"}">${p.join("")}</svg>`;
}
