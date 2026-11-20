// 사건 자동 감지: 리서치가 끝난 뒤에 보도된 해킹 기사 묶음에서 피해 기관을 찾아 사건 후보로 만든다.
// 규칙(판단 없이 기계적으로):
//   1. 해킹 사례로 분류된 기사 묶음(매체 수 무관. 국내 소형 사건은 수집 기사가 1건뿐인 경우가 많다)
//   2. 제목에 유출, 해킹, 침해, 랜섬웨어, 탈취(영문은 breach, hacked, ransomware 등)가 있는 기사가 절반 이상
//   3. 제목 앞머리의 기관 이름(국문은 첫 낱말, 영문은 동사 앞 고유명사). 매체가 2곳 이상이면 2곳 이상에서 같아야 한다
//   4. 해설, 정책, 동향 기사로 보이는 묶음(기자수첩, 대책, 보고서, 주의보 등)과 일반명사 주어(정부, 해커, 북한 등)는 뺀다
//   5. 해킹이 아니라고 밝힌 제목이 섞인 묶음은 뺀다
// 화면에는 "자동 감지"로 따로 표시한다.

import { isDeniedIncidentTitle } from "../public/lib/incident-trend.js";

const INCIDENT_WORD = /유출|해킹(당|으로|에|됐|피해|사고)|침해|랜섬웨어|탈취|털렸|무단\s?(접속|접근|결제)|비정상\s?접(속|근)|\bbreach(ed|es)?\b|\bhacked\b|\bransomware\b|\bcyberattack\b|\bdata (theft|stolen|exposed)\b|\bstolen\b|\bcompromised\b/i;
const COMMENTARY = /기자수첩|칼럼|사설|기고|인터뷰|대책|강화|점검|전수|보고서|질타|동향|전망|경고|주의보|가이드|교육|훈련|세미나|컨퍼런스|포럼|토론|이슈플러스|이슈트렌드|심층|종합\)|과징금|제재|판결|소송|배상|실적|영업익|참가|선봬|제시|제공|출시|수요|시급|대전환|진화|고심|화제|확인해야|연임|경계하라|\bwarns? (of|about|over)\b|\bthreat\b|\brisks?\b|\bsettlement\b|\blawsuit\b|\bopinion\b|\banalysis\b|\breport(s)? (finds|says|shows)\b|\bhow to\b|\btips?\b|\bwhat (is|are|to)\b|\bweek in\b|\broundup\b|이어\s|잇따라|줄줄이|모시기|책임|징계|콘퍼런스|총력|흔적|2차\s?피해|\blessons?\b|\bamid\b|\bfears?\b|\bcoincided?\b|\bsurge\b/i;
// "쿠팡 이어 G마켓도 털렸다", "부경대 이어 부산대도"처럼 앞선 피해 기관을 첫머리에 두는 묶음 기사, 업계 동향, 대응 기사는 뺀다.
const GENERIC_KO = new Set([
  "도내", "모바일", "금융사", "대구경북권","로봇이", "해커가", "해커들이", "정부가", "의료기관", "병원", "병원들", "공공", "금융", "증권", "증권가", "민생", "회원", "몸값", "로봇", "방치", "지자체", "협력사", "외주업체", "위탁업체", "수탁사", "중고폰", "부동산", "코인마켓", "인증기관", "항공예약시스템", "개보위", "경실련", "시민단체들", "전세계", "세계", "글로벌", "정보유출", "개인정보유출", "해킹사고", "새롭게", "연이어", "잇딴", "잇달아", "탈취한", "해킹당해야", "AI로", "대학마다", "금융기관부터", "공공기관부터", "정부", "금융위", "금융당국", "금감원", "경찰", "검찰", "국정원", "과기정통부", "개인정보위", "행안부", "북한", "北", "中", "중국", "미국", "일본", "러시아", "해커", "해커들", "해킹", "해킹조직", "랜섬웨어", "보안", "기업", "기업들", "국내", "단독", "속보", "종합", "포토", "영상", "AI", "이번", "또", "잇단", "연이은", "잇따른", "대학", "대학가", "은행권", "금융권", "카드사", "통신사", "업계", "공공기관", "개인정보", "고객정보", "정보", "사이버", "사이버공격", "가상자산", "코인", "거래소", "이용자", "고객", "직원", "임직원", "소비자", "시민단체", "국회", "의원", "여야", "野", "與", "연쇄", "저축은행", "성적", "학사", "카드", "은행"]);
const GENERIC_EN = new Set(["worrying", "foreign", "after", "before", "israel", "malaysia", "japan", "india", "telecom", "new ai-assisted", "dire wolf", "active screenconnect", "the", "a", "an", "hackers", "hacker", "ransomware", "cyberattack", "data", "breach", "police", "fbi", "cisa", "us", "u.s.", "uk", "eu", "china", "chinese", "russia", "russian", "iran", "iranian", "north", "korea", "report", "new", "major", "global", "massive", "another", "why", "how", "what", "who", "breaking", "exclusive", "update", "ai-assisted", "ai-powered", "state-backed", "state-sponsored"]);
// 이름 끝의 "이", "가"는 떼지 않는다(NHN두레이, 레일웨이, 메가 같은 이름이 잘린다).
const PARTICLE = /(으로부터|에서도|에게서|에서|에게|으로|이라|이나|도|서|에|의|은|는|을|를|과|와|만)$/;
const PLACE_NAMES = new Map([["충남", "충청남도"], ["충남도", "충청남도"], ["충청남도", "충청남도"]]);

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

const subjectOf = (title, region) => (region === "KR" || /[가-힣]/.test(title) ? koSubject(title) : enSubject(title));

// stories: 사건 기록(사전 밖 묶음), itemsById: 기사 id → 기사. after: 이 날짜 다음부터(리서치 마감일).
// known: 이미 있는 사건 [{ n, r, d }] (리서치, 사전 사건). 같은 이름이 14일 안에 있으면 뺀다.
export function autoDetect(stories, itemsById, { after, known = [], sameName, kstDay, minMedia = 1 }) {
  const out = [];
  for (const s of stories) {
    if (s.e || s.s < minMedia) continue;
    const day = kstDay(Date.parse(s.f));
    if (day <= after) continue;
    const items = (s.m || []).map((id) => itemsById.get(id)).filter(Boolean);
    const titles = items.length ? items : [{ t: s.t, s: "?" }];
    if (titles.filter((i) => INCIDENT_WORD.test(i.t)).length * 2 < titles.length) continue;
    if (titles.some((i) => isDeniedIncidentTitle(i.t))) continue;
    if (titles.filter((i) => COMMENTARY.test(i.t)).length * 2 >= titles.length) continue;
    const votes = new Map();
    for (const item of titles) {
      const name = subjectOf(item.t, s.r);
      if (!name) continue;
      if (!votes.has(name)) votes.set(name, new Set());
      votes.get(name).add(item.s);
    }
    // 매체가 2곳 이상이면 2곳 이상이 같은 이름을 써야 하고, 1곳뿐이면 그 제목의 이름을 쓴다.
    const need = Math.min(2, new Set(titles.map((i) => i.s)).size);
    const best = [...votes.entries()].filter(([, set]) => set.size >= need).sort((a, b) => b[1].size - a[1].size)[0];
    if (!best) continue;
    const name = best[0];
    if (known.some((k) => k.r === s.r && sameName(k.n, name) && Math.abs(Date.parse(k.d) - Date.parse(day)) <= 14 * 86400000)) continue;
    if (out.some((o) => o.story.r === s.r && sameName(o.name, name) && Math.abs(Date.parse(o.day) - Date.parse(day)) <= 14 * 86400000)) continue;
    // 대표 기사는 그 이름을 주어로 쓴 제목(묶음에 다른 사건 기사가 섞여도 내용 칸이 어긋나지 않게).
    const lead = items.find((item) => item.u && subjectOf(item.t, s.r) === name) || null;
    out.push({ story: s, name, day, items, lead });
  }
  return out;
}
