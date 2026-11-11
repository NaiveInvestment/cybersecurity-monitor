// 헤드라인 수집용 순수 함수: RSS/Atom 파싱, 분류, 중복 제거, 종목 연결. 요약문은 만들지 않는다.
import { createHash } from "node:crypto";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(text) {
  return String(text ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z#0-9]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

export const stripTags = (text) => decodeEntities(decodeEntities(text).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

function tag(block, name) {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return match ? match[1] : "";
}

// RSS 2.0과 Atom을 함께 읽는다. 반환: [{ title, link, date, source, summary }]
export function parseFeed(xml) {
  const text = String(xml);
  const blocks = text.match(/<item[\s>][\s\S]*?<\/item>/gi) || text.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map((block) => {
    let link = stripTags(tag(block, "link"));
    if (!link) link = (/<link[^>]*href="([^"]+)"/i.exec(block) || [])[1] || "";
    const rawDate = stripTags(tag(block, "pubDate") || tag(block, "published") || tag(block, "updated") || tag(block, "dc:date"));
    const time = Date.parse(rawDate);
    return {
      title: stripTags(tag(block, "title")),
      link: decodeEntities(link).trim(),
      date: Number.isNaN(time) ? null : new Date(time).toISOString(),
      source: stripTags(tag(block, "source")),
      summary: stripTags(tag(block, "description") || tag(block, "summary")).slice(0, 300),
    };
  }).filter((item) => item.title && /^https?:\/\//.test(item.link));
}

// 응답 바이트를 XML 선언이나 Content-Type의 문자셋으로 디코딩한다(국내 매체의 EUC-KR 대응).
export function decodeBody(buffer, contentType = "") {
  const head = Buffer.from(buffer).subarray(0, 200).toString("latin1");
  const declared = (/encoding=["']([\w-]+)["']/i.exec(head) || /charset=([\w-]+)/i.exec(contentType) || [])[1] || "utf-8";
  try {
    return new TextDecoder(declared.toLowerCase()).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

export function canonicalUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|oc$)/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

// 구글 뉴스 제목 끝의 " - 매체명"을 떼어 낸다.
export function splitPublisher(title, source = "") {
  if (source && title.endsWith(` - ${source}`)) return { title: title.slice(0, -source.length - 3).trim(), publisher: source };
  const cut = title.lastIndexOf(" - ");
  if (cut > 0 && title.length - cut - 3 >= 2 && title.length - cut - 3 <= 40) {
    return { title: title.slice(0, cut).trim(), publisher: title.slice(cut + 3).trim() };
  }
  return { title, publisher: "" };
}

export const titleKey = (title) => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

function bigrams(text) {
  const key = titleKey(text);
  const set = new Set();
  for (let index = 0; index < key.length - 1; index += 1) set.add(key.slice(index, index + 2));
  return set;
}

// 문자 2-gram 자카드 유사도. 한글 제목에서도 어순이 조금 달라진 같은 기사를 잡는다.
export function similarity(a, b) {
  const left = bigrams(a);
  const right = bigrams(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

const RULES = {
  incident: [
    /해킹/, /유출/, /랜섬웨어/, /침해\s?사고/, /탈취/, /디도스|DDoS/i, /악성코드/, /사이버\s?공격/, /털렸/, /무단\s?(접속|결제|접근)/,
    /\bbreach(ed|es)?\b/i, /\bhack(ed|ers?|ing)?\b/i, /\bransomware\b/i, /\bleak(ed|s)?\b/i, /\bstolen?\b/i, /\bcyber\s?attack/i,
    /\bcompromised?\b/i, /\bdata theft\b/i, /\bextortion\b/i, /\bheist\b/i, /\bintrusion\b/i, /\bexposed?\b/i,
  ],
  policy: [
    /법안/, /개정안/, /시행령/, /과징금/, /과태료/, /제재/, /종합\s?대책/, /의무화/, /가이드라인/, /국회/, /입법/, /개인정보위/, /과기정통부/,
    /금융위|금감원|금융당국/, /규제/, /공시\s?의무/, /국정감사|국감/, /행정명령/, /인증\s?제도|ISMS/,
    /\bregulat(ion|ions|or|ors|ory)\b/i, /\bbill\b/i, /\blaw(s|makers)?\b/i, /\bexecutive order\b/i, /\bfin(e|ed|es)\b/i, /\bpenalt(y|ies)\b/i,
    /\bsanction(s|ed)?\b/i, /\bdirective\b/i, /\bmandate[sd]?\b/i, /\bcongress\b/i, /\bsenate\b/i, /\bSEC\b/, /\bFTC\b/, /\bCISA\b/, /\bNIS2\b/,
    /\blegislation\b/i, /\bsettle(s|d|ment)\b/i, /\bcompliance\b/i,
  ],
  spending: [
    /투자/, /예산/, /인수/, /수주/, /공급\s?계약/, /증액/, /펀드/, /억\s?원\s?(투입|규모)/, /도입\s?(확대|추진)/, /보안\s?지출/, /합병/,
    /\bacquir(e|es|ed|ing)\b/i, /\bacquisition\b/i, /\bto buy\b/i, /\bfunding\b/i, /\brais(es|ed)\b/i, /\bbudget\b/i, /\binvest(s|ed|ment|ing)?\b/i,
    /\bspend(s|ing)?\b/i, /\bcontract\b/i, /\$\s?\d[\d.,]*\s?(billion|million|bn|m)\b/i, /\bmerger\b/i, /\bIPO\b/,
  ],
};
const ORDER = ["incident", "policy", "spending"];

// 제목 중심 키워드 규칙. 동점이면 피드 힌트, 그다음 사례 > 정책 > 지출 순. 어디에도 안 걸리면 other.
export function classify(title, summary = "", hint = null) {
  const scores = {};
  for (const category of ORDER) {
    scores[category] = RULES[category].reduce((total, rule) => total + (rule.test(title) ? 2 : 0) + (rule.test(summary) ? 1 : 0), 0);
  }
  const best = Math.max(...ORDER.map((category) => scores[category]));
  if (best === 0) return hint && ORDER.includes(hint) ? hint : "other";
  const leaders = ORDER.filter((category) => scores[category] === best);
  return hint && leaders.includes(hint) ? hint : leaders[0];
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 종목명 매칭기. 한글 이름은 앞 글자가 한글이 아닐 때만(마라톤 안의 "아톤" 방지), 영문은 단어 경계로 찾는다.
export function buildStockMatcher(stocks) {
  const patterns = [];
  for (const stock of stocks) {
    const names = [stock.name, stock.nameEn, ...(stock.aliases || [])].filter(Boolean);
    for (const name of new Set(names)) {
      if (/[가-힣]/.test(name)) {
        if (name.length >= 2) patterns.push({ id: stock.id, regex: new RegExp(`(?<![가-힣])${escapeRegExp(name)}`) });
      } else if (name.length >= 4) {
        patterns.push({ id: stock.id, regex: new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(name)}(?![A-Za-z0-9])`, "i") });
      }
    }
  }
  return (text) => [...new Set(patterns.filter((pattern) => pattern.regex.test(text)).map((pattern) => pattern.id))];
}

export const itemId = (url) => createHash("sha1").update(url).digest("hex").slice(0, 12);

// 새 항목을 기존 보관분에 합친다. URL이 같거나, 같은 지역에서 4일 안에 제목이 거의 같은 기사는 버린다.
export function mergeItems(existing, incoming, { now = Date.now(), keepDays = 180, maxItems = 3000, threshold = 0.5 } = {}) {
  const cutoff = now - keepDays * 86400000;
  const kept = existing.filter((item) => Date.parse(item.d) >= cutoff);
  const urls = new Set(kept.map((item) => item.u));
  const keys = new Set(kept.map((item) => `${item.r}|${titleKey(item.t)}`));
  let added = 0;
  const sorted = [...incoming].sort((a, b) => a.d.localeCompare(b.d));
  for (const item of sorted) {
    const time = Date.parse(item.d);
    if (Number.isNaN(time) || time < cutoff || time > now + 86400000) continue;
    const key = `${item.r}|${titleKey(item.t)}`;
    if (urls.has(item.u) || keys.has(key)) continue;
    const near = kept.some((other) => other.r === item.r && Math.abs(Date.parse(other.d) - time) < 4 * 86400000
      && similarity(other.t, item.t) >= threshold);
    if (near) continue;
    kept.push(item);
    urls.add(item.u);
    keys.add(key);
    added += 1;
  }
  kept.sort((a, b) => b.d.localeCompare(a.d));
  return { items: kept.slice(0, maxItems), added };
}

// 같은 사건을 다룬 기사끼리 묶음 번호(g)를 준다. 같은 지역과 범주에서 며칠 안에 제목이 비슷하면 한 묶음이고,
// 묶음 안의 어느 기사와 비슷해도 합류한다(단일 연결). 기사를 버리지 않고 화면에서 접어 보여 주기 위한 값이다.
export function assignGroups(items, { threshold = 0.4, windowDays = 3 } = {}) {
  const windowMs = windowDays * 86400000;
  const groups = [];
  const sorted = [...items].sort((a, b) => a.d.localeCompare(b.d));
  for (const item of sorted) {
    const time = Date.parse(item.d);
    let home = null;
    for (let index = groups.length - 1; index >= 0 && !home; index -= 1) {
      const group = groups[index];
      if (group.r !== item.r || group.c !== item.c || time - group.last > windowMs) continue;
      if (group.members.some((other) => time - Date.parse(other.d) <= windowMs && similarity(other.t, item.t) >= threshold)) home = group;
    }
    if (home) {
      home.members.push(item);
      home.last = time;
    } else {
      groups.push({ r: item.r, c: item.c, last: time, members: [item] });
    }
  }
  for (const group of groups) for (const member of group.members) member.g = group.members[0].id;
  return groups.length;
}
