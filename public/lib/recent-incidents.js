import { isDeniedIncidentTitle } from "./incident-trend.js";
import { incidentIdentity } from "./incident-identity.js";
import { similarity } from "./text.js";

const DAY = 24 * 60 * 60 * 1000;

// 피드의 'incident' 범주에는 경보와 해설도 있다. 실제 발생을 서술한 제목만 고른다.
const background = /모의\s*해킹|모의\s*훈련|경진대회|가상\s*시나리오|예방\s*(?:교육|훈련)|판결|과징금|소송|과태료|처벌|손해배상|사설|기자수첩|칼럼|기고|국정감사|행정사무감사|행감|시민사회|주가|시황|시사점|\b(?:drills?|simulat(?:ed|ion)|tabletop|lawsuits?|sued|settle(?:s|d|ment)?|sentenc(?:ed|ing)|indict(?:ed|ment)|arrests?|court order|injunction|lessons|roundup|retrospective|anniversary|forecast|prevention|response plan|risk assessment|how to|readiness)\b|\b(?:gets|faces) \d+ years\b/i;
const speculative = /의혹|주장|정황|가능성|의심|여부|미확인|우려|가정|예상|(?:막기|막는다|방지|예방|대비|차단)|모르면|된다면|될\s*수|했을까|해킹(?:이|은)?\s*(?:아니|아냐)|(?:유출|침해|피해)(?:이|은|는|가)?\s*(?:없|아니|아냐|부인)|\b(?:possible|potential|suspected|alleg(?:ed|edly|es?)|unconfirmed|claims?|rumou?rs?|hoax|fears?|could|would|might|may|prevents?|prevented|simulates?|denies|denied|no evidence|no sign|risk of|threat of)\b/i;
const koIncident = /(?:해킹|사이버\s?공격|디도스\s?공격|랜섬웨어\s?공격|침해\s?사고)(?:으?로|당|됐|받|을?\s*(?:받[아았]|당[해했]|확인|발생|공식\s?발표|피해))|(?:해킹|침해|공격)에\s.{0,30}(?:유출|중단|마비|탈취)|(?:협력업체|공급업체|서비스\s?업체|전산망|학사시스템|학습관리시스템|홈페이지|서버)\s?해킹(?:$|[,….])|(?:정보|자료|데이터|계정|자금|자산|코인|토큰|명|건)(?:가|이|를|을)?\s*(?:[0-9만천억,여.]+\s*(?:명|건)(?:의|이|가)?\s*)?(?:유출|탈취)(?!\s*(?:방지|위협))|(?:유출|탈취)\s*(?:확인|발표|신고|사과|통지|통보|됐다|되었|발생)|랜섬웨어\s*(?:감염|피해)|디도스(?:로|에)\s*.{0,20}(?:중단|마비)|사이버\s?공격\s?받[아았]/;
const koSecurityOutage = /보안\s*사고(?:로|에\s*따라|(?:가)?\s*발생(?:해|하여))[^,;…]{0,30}(?:서비스|사이트|홈페이지|플랫폼)\s*(?:(?:이용|운영|접속)(?:을|이)?\s*)?(?:일시\s*)?(?:중단|마비)(?!\s*(?:검토|논의|예고|가능|여부|예정))/;
const otherFocus = [
  /동결\s?명령|피해금\s?회수|피해액\s?회수|사고.{0,12}(?:재조명|주년)/,
  /국회\s?차원|개정안|입법예고|정책.{0,12}점검|(?:징계|문책|견책|감봉)|조회\s?창구|해킹당한\s?줄|아닙니다|유출(?:되면|될\s?경우)|(?:했|됐|당했)나[….?\s]|냐[?…]|해킹\s?방어|오발송|오배송|실수로\s*(?:공개|전송)/,
  /(?:시대의|감당할\s?수|신뢰\s?흔들|시민사회|말아야|강화해야|늘었는데|급증세|로\s?본|의\s?교훈|회수\s?추적|긴급\s?소집|되짚|짚어본|증원|화제)/,
  /\b(?:quarterly|surge[sd]?|on record|record high|digest|the toll of|freez(?:ing|e) order|ruling|pay[s]? to settle|statistic[s]?|report\s*:|\w+ preparedness|prepares? for)\b/i,
  /\b(?:ransomware gang (?:lists|names)|(?:hackers?|group|gang) (?:claim[s]?|threaten[s]?)|leak site|data for sale|ransom deadline|threatens? to (?:leak|publish))\b/i,
  /^(?:what the tech|日\s?기업들|ticker\s*:)|\b(?:warn(?:s|ing) (?:as|ahead)|first[- ]ever (?:autonomous|simulated)|theoretical attack)\b/i,
];
const disputed = /사실\s?무근|(?:유출|침해|피해|해킹).{0,8}(?:확인되지\s?않|된\s?적\s?없|사실이?\s?없|발생하지\s?않)|\b(?:not|never|yet to)\s+(?:been\s+)?confirm(?:ed)?\b|\b(?:denies|denied|disputes|refutes)\b.{0,50}\b(?:hack|attack|breach)|\b(?:no|without) evidence of\b/i;
const attack = String.raw`(?:cyber[ -]?attack|ransomware (?:attack|infection|incident)|(?:data |security |cybersecurity )?breach|hack(?:ing)?|intrusion|data (?:theft|leak)|security incident)\b`;
const englishIncident = [
  new RegExp(String.raw`\b(?:confirm(?:s|ed)?|disclos(?:es?|ed)|report(?:s|ed)?|reveal(?:s|ed)?|announc(?:es?|ed)|acknowledg(?:es?|ed)|suffer(?:s|ed)?|sustain(?:s|ed)?|battl(?:es|ing))\b.{0,48}?\b` + attack, "i"),
  new RegExp(String.raw`\b(?:hit|struck|compromised|targeted|affected|accessed|exposed|impacted|disrupted) (?:in|by) (?:an? |the )?(?:[\w-]+ ){0,3}?` + attack, "i"),
  new RegExp(String.raw`\b` + attack + String.raw`.{0,35}?\b(?:expos(?:es|ed)|leaks?|hits?|hit|disrupt(?:s|ed|ing)|shuts? down|affects?|impacts?|forces?|continues|remains ongoing)\b`, "i"),
  /\b(?:was|were|got|been) (?:hacked|breached|compromised)\b|\bhackers? (?:breach(?:ed)?|stole|steal|leak(?:s|ed)?|used\b.{0,45}\bto breach)\b|\b(?:records|data|documents|information|emails?|details) (?:were |was )?(?:stolen|leaked|accessed|exposed)\b/i,
  /\b(?:affected|impacted) (?:in|by) .{1,65}\bdata breach\b/i,
  /\b(?:million|billion|trillion) (?:dollars? )?stolen from\b/i,
  /\b(?:cope with|responds? to|notifies? .{1,40} of|recovery from) (?:a |the )?data breach\b|\bcyberattack reported at\b|\b(?:data breach|cyberattack) affecting\b/i,
  /\b(?:infected|struck|hit) (?:with|by) ransomware\b/i,
];

// 따옴표나 줄임표로 이은 뒤 문장에서 유출 규모만 미확정인 경우는 앞 문장의 사고 확인을 보존한다.
function confirmedStatements(title) {
  if (!title || background.test(title) || otherFocus.some((re) => re.test(title)) || isDeniedIncidentTitle(title)) return [];
  const statements = title.replace(/[^;…?]*\?/g, " ");
  return statements.split(/\s*[;…]|\s+but\s+|,\s*(?=staff|customer|personal|investigation|says|warns)|\bthat (?=may|might|could)\b/i)
    .filter((part) => part && !disputed.test(part) && !speculative.test(part) &&
      !/(?:해킹|유출|공격).{0,8}(?:대책|방지법|위험|주의보|땐|시\s)|(?:취약점|경고등)/i.test(part));
}

export function reportsSecurityOutage(title) {
  return koSecurityOutage.test(title) && confirmedStatements(title).some((part) => koSecurityOutage.test(part));
}

export function reportsIncident(title) {
  return confirmedStatements(title).some((part) => koIncident.test(part) || koSecurityOutage.test(part) ||
    /(?:업데이트\s?경로|유통망)\s?해킹|(?:악성코드|랜섬웨어)\s*(?:설치|감염)|개인정보\s?침해사고(?:\s*발생)?$|연락처(?:가|를)?\s*(?:유출|탈취)|(?:정보|계정)(?:가|이|도)?\s*(?:대량\s*유출|털려|털렸)/.test(part) ||
    englishIncident.some((pattern) => pattern.test(part)));
}

// 기존 기사 묶음에도 서로 다른 피해 기관이 섞일 수 있어, 제목에서 같은 이름을 식별한 경우에만 합친다.
const commonName = /^(?:a|an|the|how|why|what|who|when|did|at|as|in|on|of|after|new|major|nearly|external|ransomware|cyberattack|cyber|data|hack(?:er|ers|ed|ing)?|breach|security|bank|firm|vendor|employee|company|customer|system|victim|attack|service|provider|report|reportedly|incident|leaks?|exposes?|warns?|affects?|confirms?|thousands|hundreds|million|records?|personal|hackathon|ai|해킹|랜섬웨어|사이버공격|사이버|정부|올해|최근|경찰|국내|해외|전국|고객정보|개인정보|직원|고객|기관|기업|금융사|위탁|거래|단독|속보|회계법인)$/i;
const leadingTags = /^(?:\s*\[[^\]]+\]\s*)+/;
function subject(title) {
  const clean = title.replace(leadingTags, "").trim();
  const alias = incidentIdentity(clean);
  if (alias) return alias.name;
  const candidates = clean.match(/[\p{L}\d&-]+/gu) || [];
  for (const word of candidates) {
    if (/^[\d-]/.test(word) || word.length < 2 || commonName.test(word)) continue;
    if (/[가-힣]/.test(word)) return word.replace(/(?:에서|으로|에는|은|는|의|가)$/, "").toLowerCase();
    if (/^[A-Z]/.test(word)) return word.toLowerCase();
  }
  return null;
}

const followUpTitle = /(?:피해|유출).{0,22}(?:늘어|확대|추가 확인)|피해\s?규모.{0,12}(?:정정|재산정)|\b(?:full|final) report on .{0,30}(?:attack|breach|hack)|\b(?:reopens?|still down|restores? services?)\b.{0,50}\b(?:following|after)\b.{0,24}\b(?:hack|cyberattack|breach)|\b(?:breach|attack) toll (?:rises|grows)\b/i;

function samePastIncident(item, earlier, name) {
  const details = incidentIdentity(item.t);
  const previous = incidentIdentity(earlier.t);
  if (details?.name === name && details.detail && previous?.name === name && previous.detail
      && Date.parse(item.d) - Date.parse(earlier.d) <= 14 * DAY) return true;
  const score = similarity(item.t, earlier.t);
  return score >= 0.6 || (item.g && item.g === earlier.g && score >= 0.4);
}

export function incidentUpdate(items, sources, now = Date.now()) {
  const reference = sources.filter(source => source.t && source.d)
    .map(source => ({ ...source, subject: subject(source.t) })).filter(source => source.subject);
  if (!reference.length) return null;
  return items.find(item => Date.parse(item.d) <= now && reference.some(source =>
    item.u !== source.u && item.d.slice(0, 10) > source.d
    && subject(item.t) === source.subject && samePastIncident(item, source, source.subject))
    && /^https?:\/\//i.test(item.u) && reportsIncident(item.t)) || null;
}

export function recentIncidentStories(items, now = Date.now()) {
  const cutoff = now - DAY;
  const groups = new Map();
  const seenUrls = new Set();
  const historical = new Map();
  const timely = items.filter((item) => {
    const time = Date.parse(item.d);
    return time <= now && /^https?:\/\//i.test(item.u) && reportsIncident(item.t);
  }).sort((a, b) => Date.parse(b.d) - Date.parse(a.d));
  for (const item of timely) {
    if (seenUrls.has(item.u)) continue;
    seenUrls.add(item.u);
    const name = subject(item.t);
    if (!name) continue;
    if (Date.parse(item.d) < cutoff) {
      if (!historical.has(name)) historical.set(name, []);
      historical.get(name).push(item);
      continue;
    }
    const identity = incidentIdentity(item.t);
    const key = identity?.detail ? name + "/detail" : name + "/group/" + (item.g || item.id);
    if (!groups.has(key)) groups.set(key, { name, items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()].map(({ name, items }) => {
    const members = items.sort((a, b) => Date.parse(b.d) - Date.parse(a.d));
    const lead = members[0];
    const earlier = (historical.get(name) || []).findLast((old) =>
      members.some((member) => samePastIncident(member, old, name)));
    return {
      id: lead.id, lead, items: members, first: members.at(-1).d, last: lead.d,
      earlier, followUp: Boolean(earlier) || members.every((item) => followUpTitle.test(item.t)),
      sources: new Set(members.map((item) => item.s)).size, count: members.length,
      r: lead.r, c: "incident", k: [...new Set(members.flatMap((item) => item.k || []))],
    };
  }).sort((a, b) => Date.parse(b.last) - Date.parse(a.last));
}
