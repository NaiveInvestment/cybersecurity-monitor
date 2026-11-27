// 사건 자동 감지: 리서치가 끝난 뒤에 보도된 해킹 기사 묶음에서 피해 기관을 찾아 사건 후보로 만든다.
// 규칙(판단 없이 기계적으로):
//   1. 해킹 사례로 분류된 기사 묶음(매체 수 무관. 국내 소형 사건은 수집 기사가 1건뿐인 경우가 많다)
//   2. 실제 사고 발생을 보도한 문장이 있어야 한다. 예방, 추정, 대응 및 과거 회고는 제외한다.
//   3. 제목 앞머리의 기관 이름(국문은 첫 낱말, 영문은 동사 앞 고유명사). 매체가 2곳 이상이면 2곳 이상에서 같아야 한다
//   4. 해설, 정책, 동향 기사로 보이는 묶음(기자수첩, 대책, 보고서, 주의보 등)과 일반명사 주어(정부, 해커, 북한 등)는 뺀다
//   5. 해킹이 아니라고 밝힌 제목이 섞인 묶음은 뺀다
// 화면에는 "자동 감지"로 따로 표시한다.

import { isDeniedIncidentTitle } from "../public/lib/incident-trend.js";
import { reportsIncident } from "../public/lib/recent-incidents.js";

const COMMENTARY = /기자수첩|칼럼|사설|기고|인터뷰|대책|강화|점검|전수|보고서|질타|동향|전망|경고|주의보|가이드|교육|훈련|세미나|컨퍼런스|포럼|토론|이슈플러스|이슈트렌드|심층|종합\)|과징금|제재|판결|소송|배상|실적|영업익|참가|선봬|제시|제공|출시|수요|시급|대전환|진화|고심|화제|확인해야|연임|경계하라|\bwarns? (of|about|over)\b|\bthreat\b|\brisks?\b|\bsettlement\b|\blawsuit\b|\bopinion\b|\banalysis\b|\breport(s)? (finds|says|shows)\b|\bhow to\b|\btips?\b|\bwhat (is|are|to)\b|\bweek in\b|\broundup\b|이어\s|잇따라|줄줄이|모시기|책임|징계|콘퍼런스|총력|흔적|2차\s?피해|\blessons?\b|\bamid\b|\bfears?\b|\bcoincided?\b|\bsurge\b/i;
// "쿠팡 이어 G마켓도 털렸다", "부경대 이어 부산대도"처럼 앞선 피해 기관을 첫머리에 두는 묶음 기사, 업계 동향, 대응 기사는 뺀다.
const GENERIC_KO = new Set([
  "도내", "모바일", "금융사", "대구경북권","로봇이", "해커가", "해커들이", "정부가", "의료기관", "병원", "병원들", "공공", "금융", "증권", "증권가", "민생", "회원", "몸값", "로봇", "방치", "지자체", "협력사", "외주업체", "위탁업체", "수탁사", "중고폰", "부동산", "코인마켓", "인증기관", "항공예약시스템", "개보위", "경실련", "시민단체들", "전세계", "세계", "글로벌", "정보유출", "개인정보유출", "해킹사고", "새롭게", "연이어", "잇딴", "잇달아", "탈취한", "해킹당해야", "AI로", "대학마다", "금융기관부터", "공공기관부터", "정부", "금융위", "금융당국", "금감원", "경찰", "검찰", "국정원", "과기정통부", "개인정보위", "행안부", "북한", "北", "中", "중국", "미국", "일본", "러시아", "해커", "해커들", "해킹", "해킹조직", "랜섬웨어", "보안", "기업", "기업들", "국내", "단독", "속보", "종합", "포토", "영상", "AI", "이번", "또", "잇단", "연이은", "잇따른", "대학", "대학가", "은행권", "금융권", "카드사", "통신사", "업계", "공공기관", "개인정보", "고객정보", "정보", "사이버", "사이버공격", "가상자산", "코인", "거래소", "이용자", "고객", "직원", "임직원", "소비자", "시민단체", "국회", "의원", "여야", "野", "與", "연쇄", "저축은행", "성적", "학사", "카드", "은행"]);
const GENERIC_EN = new Set(["worrying", "foreign", "after", "before", "israel", "malaysia", "japan", "india", "telecom", "new ai-assisted", "dire wolf", "active screenconnect", "the", "a", "an", "hackers", "hacker", "ransomware", "cyberattack", "data", "breach", "police", "fbi", "cisa", "us", "u.s.", "uk", "eu", "china", "chinese", "russia", "russian", "iran", "iranian", "north", "korea", "report", "new", "major", "global", "massive", "another", "why", "how", "what", "who", "breaking", "exclusive", "update", "ai-assisted", "ai-powered", "state-backed", "state-sponsored"]);
// 이름 끝의 "이", "가"는 떼지 않는다(NHN두레이, 레일웨이, 메가 같은 이름이 잘린다).
const PARTICLE = /(으로부터|에서도|에게서|에서|에게|으로|이라|이나|도|서|에|의|은|는|을|를|과|와|만)$/;
const PLACE_NAMES = new Map([["충남", "충청남도"], ["충남도", "충청남도"], ["충청남도", "충청남도"]]);
const INCIDENT_PARTIES = [
  ["한국전력", "KR", /한국전력(?!기술)|(?<![\p{L}\p{N}])한전(?:\s?ON)?(?=(?:은|는|이|가|도|의|에서)?(?:[^\p{L}\p{N}]|$))|\bKEPCO\b|Korea Electric Power Corporation/iu],
  ["예별손해보험", "KR", /예별손(?:해보험|보)|엘케이\s?보험중개/i],
  ["삼성증권", "KR", /삼성증권|Samsung Securities/i],
  ["한국투자저축은행", "KR", /한국투자저축(?:은행|銀)|한투저축(?:은행|銀)|Korea Investment Savings Bank/i],
  ["수협은행", "KR", /수협은행|\bSuhyup Bank\b/i],
  ["올리브영", "KR", /올리브영|\bOlive Young\b/i],
  ["다나와", "KR", /다나와|\bDanawa\b/i],
  ["과학기술인공제회", "KR", /과학기술인\s*공제회|(?:^|[^가-힣])과기공(?:제회)?(?=[^가-힣]|은|이|도|에|$)/],
  ["팸텍", "KR", /팸텍|\bPamtek\b/i],
  ["빗썸", "KR", /빗썸|\bBithumb\b/i],
  ["대신증권", "KR", /대신증권|Daishin Securities/i],
  ["컬리", "KR", /컬리|\bKurly\b/i],
  ["행정안전부", "KR", /행정안전부.{0,12}이메일|행정기관\s*(?:업무용\s*)?이메일|공무원\s*업무\s*메일/],
  ["라쿠텐증권", "GL", /라쿠텐\s*증권|Rakuten Securities/i],
  ["1Password", "GL", /원패스워드|\b1Password\b/i],
  ["Turnitin", "GL", /터니틴|\bTurnitin\b/i],
  ["Zodia Custody", "GL", /조디아\s*커스터디|\bZodia Custody\b|Standard Chartered[’']s Zodia/i],
  ["CoinDCX", "GL", /코인DCX|\bCoinDCX\b/i],
  ["JPMorgan Chase", "GL", /JP\s*모[건간]|제이피모건|\bJ\.?\s?P\.?\s?Morgan(?:\s?Chase)?\b/i],
  ["Visa", "GL", /비자\s*(?:[·,]|카드)|\bVisa\b/i],
  ["Mastercard", "GL", /마스터카드|\bMastercard\b/i],
  ["LaLiga", "GL", /라리가|\bLa\s?Liga\b/i],
  ["Next", "GL", /넥스트|\bNext (?:hit by|investigates|reports|discloses) (?:a |third-party )?data breach\b/i],
  ["FBI", "GL", /\bFBI\b|연방수사국/i],
  ["머스크", "GL", /머스크.{0,12}(?:랜섬웨어|사이버 공격)|\bMaersk\b/i],
  ["오사키전기공업", "GL", /오사키\s*전기(?:공업)?|\bOsaki Electric\b/i],
  ["도이체방크", "GL", /도이체[뱅방]크|\bDeutsche Bank\b/i],
  ["소프트99", "GL", /소프트99|\bSoft99\b/i],
  ["벨레다", "GL", /벨레다|\bWeleda\b/i],
  ["케어링", "KR", /케어링.{0,12}(?:유출|해킹)|\bCaring\b.{0,12}data breach/i],
];
const NON_INCIDENT = /유출\s*(?:제로|0건)|의혹\s*부인.{0,15}사실무근|청문회['’”]?\s*예고|기업보안성적표|공격\s*사례\s*공개|정책\s*대응|과기혁신특위|단독\s*후속.{0,35}최초\s*보도|data breach suit|cyberattack funding|first autonomous AI cyberattack/i;
const FBI_VICTIM = /\bFBI\s+(?:hacked|hit by|suffers?|fell victim to)\b|\b(?:hackers?|ransomware)\s+(?:breach(?:ed|es)?|hit|target(?:ed|s)?)\s+(?:the\s+)?FBI\b|(?:FBI|연방수사국)[,의\s]+(?:내부망|서버|시스템|네트워크).{0,10}(?:해킹|침해|유출)/i;
const NON_PARTY = new Set(["범죄자", "치명적", "상장", "다크웹", "뚫린", "가사", "홈서비스", "블록체인", "보험중개사", "증권사", "피해자", "결제대행", "간편결제", "최근", "혹시", "줄잇", "해외송금업체", "독일", "의혹", "트럼프", "포티넷", "엔키화이트햇", "슈퍼컴퓨터마저", "suspected", "possible", "legislative", "was ansem", "south korea", "dam"]);

const matchingParties = text => INCIDENT_PARTIES.filter(([, , pattern]) => pattern.test(text));
const marketOrRetrospective = /\[특징주\]|보안주.{0,18}(?:강세|급등|상한가)|(?:유출|해킹|침해)\s*(?:(?:사태|사고)\s*)?\d+\s*(?:년|주년)(?:\s|[,.…]|$)|해킹 피해액.{0,24}전액 복구/;
const assertedKoreanBreach = /^(?:\[[^\]]+\]\s*)?[가-힣A-Za-z0-9]{2,25}[,\s]+(?:해킹|랜섬웨어 공격)(?:\s*사고)?\s*[…⋯]/;
export const reportsActualIncident = title => !marketOrRetrospective.test(title) && !COMMENTARY.test(title) &&
  (reportsIncident(title) || assertedKoreanBreach.test(title) || /^FBI\s+hacked (?:after|in|by)\b/i.test(title));

export function incidentEvidence(story, itemsById) {
  const current = (story.m || []).map(id => itemsById.get(id)).filter(Boolean);
  const available = [...(story.evidence || []), ...current];
  const titles = available.length ? available : [{ t: story.t, d: story.f,
    s: Object.values(story.ds || {}).flat()[0] || "보도", u: story.u }];
  return [...new Map(titles.filter(item => item.t && item.s && item.u && reportsActualIncident(item.t))
    .map(item => [item.u, item])).values()];
}

export function incidentParty(text, matches = matchingParties(text)) {
  if (matches.length !== 1) return null;
  const [name, region] = matches[0];
  return { name, region };
}

// 국문 제목의 첫 낱말(괄호 머리말, 쉼표, 조사 제거). 너무 짧거나 일반명사면 null.
export function koSubject(title) {
  const t = String(title).replace(/^\s*(\[[^\]]*\]|\([^)]*\)|【[^】]*】)\s*/g, "").trim();
  // 직함 뒤에 인용문이 바로 나오면 이름은 발언자다.
  if (/^\S+\s+\S*시의원\s*[,:]?\s*["'‘“]/.test(t)) return null;
  const first = t.split(/[\s,·…'"‘’“”]+/)[0] || "";
  let word = first.replace(/[^\p{L}\p{N}&.+-]/gu, "");
  if (/[가-힣]/.test(word)) {
    const subject = word.replace(PARTICLE, "");
    word = PLACE_NAMES.get(word) ?? PLACE_NAMES.get(subject) ?? subject;
  }
  if (word.length < 2 || GENERIC_KO.has(word) || /^\d/.test(word)) return null;
  // "日기업들", "美병원"처럼 나라 머리말이 붙은 첫 낱말은 특정 기관이 아니다.
  if (/^[日中美英北]/.test(word)) return null;
  if (!/[가-힣]/.test(word)) return null;
  if (/(마다|부터|까지|한|된|던|는|을|게|며|고|면|로)$/.test(word) && !/(은행|증권|카드|생명|화재|캐피탈|저축|금고|공사|공단|대학|병원|협회|재단|그룹|건설|전자|통신|마켓|커피)$/.test(word)) return null;
  return word;
}

// 영문 제목에서 동사 앞 고유명사(대문자로 시작하는 1~4 낱말).
export function enSubject(title) {
  const m = /^([A-Z][\w&.'’-]*(?:\s+(?:[A-Z][\w&.'’-]*|of|and|&)){0,4}?)\s+(?:says|confirms|discloses|reports|reveals|notifies|warns|hit|hits|suffers|hacked|investigates|probes|data breach|breach|ransomware|cyberattack|cyber attack|attack|outage|security incident|victim|struck|targeted|falls)/.exec(String(title).replace(/^\s*\[[^\]]*\]\s*/, ""));
  if (!m) return null;
  // "Gentlemen ransomware gang involved in ..."처럼 이름 뒤가 공격 조직이면 피해 기관이 아니다.
  const rest = String(title).replace(/^\s*\[[^\]]*\]\s*/, "").slice(m[1].length);
  if (/^\s+(ransomware\s+)?(gang|group|crew|operators?)\b/i.test(rest)) return null;
  // "Massive Kik"처럼 앞에 붙은 일반 형용사는 뗀다.
  const words = m[1].replace(/['’]s$/, "").trim().split(/\s+/);
  while (words.length > 1 && GENERIC_EN.has(words[0].toLowerCase())) words.shift();
  const name = words.join(" ");
  if (GENERIC_EN.has(name.toLowerCase()) || name.length < 3) return null;
  return name;
}

function titleParty(title, region) {
  if (NON_INCIDENT.test(title)) return null;
  const matches = matchingParties(title);
  if (matches.length) {
    const party = incidentParty(title, matches);
    return party?.name === "FBI" && !FBI_VICTIM.test(title) ? null : party;
  }
  if (/^\S+\s+(?:국회의원|시의원)\s*[,:]?\s*["'‘“]/.test(title)) return null;
  const name = region === "KR" || /[가-힣]/.test(title) ? koSubject(title) : enSubject(title);
  return name && !NON_PARTY.has(name.toLowerCase()) ? { name, region } : null;
}

// stories: 사건 기록(사전 밖 묶음), itemsById: 기사 id → 기사. after: 이 날짜 다음부터(리서치 마감일).
// known: 이미 있는 사건 [{ n, r, d }] (리서치, 사전 사건). 같은 이름이 14일 안에 있으면 뺀다.
export function autoDetect(stories, itemsById, { after, known = [], sameName, kstDay, minMedia = 1 }) {
  const out = [];
  for (const s of [...stories].sort((a, b) => Date.parse(a.f) - Date.parse(b.f) || b.s - a.s)) {
    if (s.s < minMedia) continue;
    const items = (s.m || []).map((id) => itemsById.get(id)).filter(Boolean);
    if (items.some((i) => isDeniedIncidentTitle(i.t))) continue;
    const qualified = incidentEvidence(s, itemsById);
    const votes = new Map();
    for (const item of qualified) {
      const party = titleParty(item.t, s.r);
      if (!party) continue;
      const key = `${party.region}:${party.name}`;
      if (!votes.has(key)) votes.set(key, { ...party, sources: new Set(), items: [] });
      const vote = votes.get(key);
      vote.sources.add(item.s);
      vote.items.push(item);
    }
    // 매체가 2곳 이상이면 2곳 이상이 같은 이름을 써야 하고, 1곳뿐이면 그 제목의 이름을 쓴다.
    const need = Math.min(2, new Set(qualified.map((i) => i.s)).size);
    const best = [...votes.values()].filter(vote => vote.sources.size >= need).sort((a, b) => b.sources.size - a.sources.size)[0];
    if (!best) continue;
    const { name, region } = best;
    const first = Math.min(...best.items.map(item => Date.parse(item.d || s.f)));
    if (!Number.isFinite(first)) continue;
    const day = kstDay(first);
    if (day <= after) continue;
    if (known.some((k) => {
      const alias = incidentParty(k.n);
      return (alias?.region ?? k.r) === region && sameName(alias?.name ?? k.n, name) &&
        Math.abs(Date.parse(k.d) - Date.parse(day)) <= 14 * 86400000;
    })) continue;
    if (out.some((o) => o.region === region && sameName(o.name, name) && Math.abs(Date.parse(o.day) - Date.parse(day)) <= 14 * 86400000)) continue;
    // 대표 기사는 그 이름을 주어로 쓴 제목(묶음에 다른 사건 기사가 섞여도 내용 칸이 어긋나지 않게).
    const lead = [...best.items].sort((a, b) => (a.d || s.f).localeCompare(b.d || s.f))[0];
    if (!lead) continue;
    out.push({ story: s, name, region, day, items: best.items, lead, media: best.sources.size });
  }
  return out;
}
