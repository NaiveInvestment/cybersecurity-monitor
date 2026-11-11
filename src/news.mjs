// 헤드라인 수집용 순수 함수: RSS/Atom 파싱, 분류, 중복 제거, 종목 연결. 요약문은 만들지 않는다.
import { createHash } from "node:crypto";
import { titleKey, similarity } from "../public/lib/text.js";

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

export { titleKey, similarity };

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
      if (group.members.some((other) => time - Date.parse(other.d) <= windowMs && similarity(other.t, item.t) >= threshold && sameSubject(other.t, item.t))) home = group;
    }
    if (home) {
      home.members.push(item);
      home.last = time;
    } else {
      groups.push({ r: item.r, c: item.c, last: time, members: [item] });
    }
  }
  const merged = mergeByAnchor(groups, windowMs);
  for (const group of merged) {
    group.members.sort((a, b) => a.d.localeCompare(b.d));
    for (const member of group.members) member.g = group.members[0].id;
  }
  return merged.length;
}

// 영문 제목은 "X Data Breach Exposes Sensitive Information"처럼 틀이 같아 글자 유사도만으로는 다른 회사 사건이 붙는다.
// 두 제목 모두 주체 낱말이 있는데 하나도 겹치지 않으면 다른 사건으로 본다. 한글 제목은 표기가 다양해 이 조건을 걸지 않는다.
function sameSubject(a, b) {
  if (/[가-힣]/.test(a) || /[가-힣]/.test(b)) return true;
  const left = anchorTokens(a);
  const right = anchorTokens(b);
  if (!left.size || !right.size) return true;
  for (const token of left) if (right.has(token)) return true;
  return false;
}

// 제목에서 사건의 주체가 될 만한 낱말을 뽑는다. 한글은 조사 하나를 떼고 4자 이상, 영문은 6자 이상.
// 어느 기사에나 나오는 보안 일반어는 뺀다.
const ANCHOR_STOP = new Set([
  "개인정보", "정보보호", "사이버보안", "정보보안", "랜섬웨어", "악성코드", "해킹사고", "보안사고", "유출사고", "침해사고",
  "개인정보위", "개인정보보호", "개인정보보호위원회", "과기정통부", "금융위원회", "금융감독원", "금융당국", "보안업계", "소프트웨어",
  "인공지능", "가이드라인", "제로트러스트", "클라우드", "데이터센터", "사이버공격", "보이스피싱", "피싱사이트", "가상자산", "비트코인",
  "개인정보유출", "정보유출", "보안투자", "정보보호예산", "국정감사", "대한민국", "스타트업", "업데이트", "네트워크", "컨퍼런스",
  "기자수첩", "이슈종합", "사이버보안주", "보안기업", "보안전문가", "전문가들", "이용자들", "피해자들", "고객정보", "금융회사",
  "breach", "breaches", "attack", "attacks", "hacker", "hackers", "hacked", "hacking", "cyberattack", "cyberattacks", "cybersecurity",
  "security", "ransomware", "company", "companies", "million", "billion", "customers", "customer", "personal", "information", "exposed",
  "exposes", "exposure", "affected", "affecting", "affects", "discloses", "disclosed", "confirms", "confirmed", "settlement", "action",
  "lawsuit", "university", "hospital", "health", "healthcare", "medical", "center", "system", "systems", "network", "networks", "service",
  "services", "government", "federal", "agency", "report", "reports", "warning", "critical", "vulnerability", "vulnerabilities", "update",
  "updates", "software", "password", "passwords", "account", "accounts", "records", "privacy", "online", "digital", "global", "people",
  "individuals", "sensitive", "incident", "investigation", "following", "impacted", "impacts", "through", "should", "startup", "raises",
  "funding", "series", "acquire", "acquires", "acquisition", "budget", "investment", "market", "regulation", "executive", "school",
  "schools", "county", "district", "police", "credit", "public", "library", "notice", "notification", "stolen", "access", "numbers",
  "social", "protect", "protection", "threat", "threats", "against", "targets", "targeted", "alleged", "allegedly", "claims", "probes",
  "employee", "employees", "patient", "patients", "client", "clients", "member", "members", "student", "students", "thousands", "hundreds",
  "details", "involving", "reveals", "revealed", "reported", "suffers", "latest", "exploit", "exploits", "exploited", "access", "bypass",
  "federal", "americas", "americans", "giant", "leaked", "leaks", "hacked", "breached", "stolen",
]);
// 같은 기관을 가리키는 약칭. 주체 낱말을 뽑을 때 본 이름으로 바꾼다.
const ANCHOR_ALIAS = new Map([["금보원", "금융보안원"]]);
const PARTICLE = /(으로부터|에게서|이라는|까지|마저|조차|부터|에서|에게|으로|라는|이나|처럼|보다|은|는|이|가|을|를|의|에|도|로|과|와|만)$/;

// 짧은 낱말 둘이 붙어 주체가 되는 경우("4대 은행")를 위한 일반어 목록. 이 낱말이 낀 두 낱말 조합은 쓰지 않는다.
const SHORT_STOP = new Set([
  "해킹", "유출", "보안", "정보", "피해", "공격", "사고", "금융", "내년", "올해", "관련", "대응", "확대", "강화", "투자", "예산",
  "정부", "기업", "국내", "해외", "미국", "중국", "북한", "개인", "고객", "직원", "회사", "업계", "시장", "발표", "추진", "계획",
  "논란", "우려", "긴급", "단독", "종합", "속보", "포토", "영상", "이번", "지난", "최근", "다시", "사이버", "데이터", "서비스", "시스템",
]);

export function anchorTokens(title) {
  const tokens = new Set();
  const text = String(title).replace(/\[[^\]]*\]|\([^)]*\)/g, " ");
  let previousShort = null;
  for (const raw of text.split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    let short = null;
    if (/[가-힣]/.test(raw)) {
      // 조사를 먼저 떼고 4자 이상만 남긴다("해킹으로"는 "해킹"이 돼 빠진다). 서술어("유출됐다")도 뺀다.
      const stripped = raw.replace(PARTICLE, "");
      const token = ANCHOR_ALIAS.get(stripped) || stripped;
      if (token.length >= 4) {
        if (!token.endsWith("다") && !ANCHOR_STOP.has(token)) tokens.add(token);
      } else if (token.length >= 2 && !SHORT_STOP.has(token)) {
        // 짧은 낱말은 바로 앞의 짧은 낱말과 붙여 본다("4대" + "은행").
        if (previousShort && !ANCHOR_STOP.has(previousShort + token)) tokens.add(previousShort + token);
        short = token;
      }
    } else if (/^[A-Za-z]/.test(raw) && raw.length >= 6) {
      const token = raw.toLowerCase();
      if (!ANCHOR_STOP.has(token)) tokens.add(token);
    }
    previousShort = short;
  }
  return tokens;
}

// 제목이 서로 달라 갈라진 묶음을 주체 낱말로 다시 합친다.
// 기준이 되는 것은 기사 3건 이상인 묶음이고, 그 묶음 제목의 절반 이상에 나오는 낱말이 주체 낱말이다.
// 기준 묶음끼리는 주체 낱말이 같으면 합치고, 작은 묶음은 주체 낱말을 가진 가장 큰 기준 묶음 하나에만 붙인다.
// 작은 묶음끼리는 합치지 않는다(낱말 하나로 서로 다른 기사가 줄줄이 이어지는 것을 막는다).
function mergeByAnchor(groups, windowMs) {
  const signature = groups.map((group) => {
    const counts = new Map();
    for (const member of group.members) for (const token of anchorTokens(member.t)) counts.set(token, (counts.get(token) || 0) + 1);
    return new Set([...counts].filter(([, count]) => count * 2 >= group.members.length).map(([token]) => token));
  });
  const first = groups.map((group) => Date.parse(group.members[0].d));
  const near = (a, b) => groups[a].r === groups[b].r && groups[a].c === groups[b].c
    && Math.max(first[a], first[b]) - Math.min(groups[a].last, groups[b].last) <= windowMs;
  const shares = (a, b) => [...signature[a]].some((token) => signature[b].has(token));
  const parent = groups.map((_, index) => index);
  const find = (index) => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  const seeds = groups.map((_, index) => index).filter((index) => groups[index].members.length >= 3 && signature[index].size > 0);
  for (let at = 0; at < seeds.length; at += 1) {
    for (let other = at + 1; other < seeds.length; other += 1) {
      if (near(seeds[at], seeds[other]) && shares(seeds[at], seeds[other])) parent[find(seeds[other])] = find(seeds[at]);
    }
  }
  const seedSet = new Set(seeds);
  groups.forEach((group, index) => {
    if (seedSet.has(index) || !signature[index].size) return;
    const matches = seeds.filter((seed) => near(seed, index) && shares(seed, index));
    if (!matches.length) return;
    const best = matches.reduce((a, b) => (groups[b].members.length > groups[a].members.length ? b : a));
    parent[find(index)] = find(best);
  });
  const merged = new Map();
  groups.forEach((group, index) => {
    const root = find(index);
    if (!merged.has(root)) merged.set(root, { r: group.r, c: group.c, last: group.last, members: [] });
    const target = merged.get(root);
    target.members.push(...group.members);
    target.last = Math.max(target.last, group.last);
  });
  return [...merged.values()];
}
