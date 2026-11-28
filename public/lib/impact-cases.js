import { impactNotes } from "./impact-notes.js";
import { reportsIncident } from "./recent-incidents.js";
import { publicationDay } from "./news-search.js";

const DAY = 86400000;
export const impactTypes = [
  ["all","전체 사건"],["infra","핵심 인프라"],["operations","서비스 중단"],
  ["personal","개인정보"],["financial","금융정보"],["technical","인증정보와 코드"],["loss","금전 피해"],
];
const background = /(?:청산액|특징주|급락|급등|대책 촉구|협상\s?의혹|차등\s?보상|글로벌.{0,15}피해.{0,8}전망|올해.{0,16}(?:가상자산|해킹 피해)|주간|위클리|보안\s?브리핑|기자수첩|사설|과징금|패소|소송|강연|웨비나|정기점검|취약점|공격\s?기법|예방|예고|훈련)|\b(?:lawsuit|settlement|roundup|patch(?:es)?|vulnerabilit(?:y|ies)|CVE-\d+|best practices|acquisition|in review|how to)\b/i;
const dispute = /해킹.{0,6}(?:아니다|아냐|무관|흔적 없)|(?:유출|침해|피해|영업 영향|사업 영향).{0,16}(?:증거.{0,3}없|확인되지 않|제한적|경미|미미|없다고|없다|사실무근)|\b(?:denies|denied|disputes)\b.{0,38}(?:hack|breach|attack)|\b(?:no (?:evidence|signs?) of|limited impact|no material (?:impact|effect)|immaterial impact)\b/i;
const allegation = /해킹\s?의혹|침해\s?의혹|침해\s?추정|유출\s?주장|해킹\s?주장|\b(?:alleged|suspected|reportedly|alleges?|claims? to have)\b/i;
const operations = /(?:서비스|가동|생산|조업|시스템|결제|출금).{0,14}(?:중단|마비|먹통|재개|복구)|\b(?:disrupts?|disrupted|halted|suspended|shuts? down|restores?)\b.{0,27}(?:service|production|operation|payment)|(?:service|production|operation)\w* (?:halt|outage|disrupt)/i;
const credentials = /인증\s?토큰|인증정보|소스\s?코드|계정정보|비밀번호|접근\s?키|\b(?:credentials|access tokens?|source code|passwords?)\b/i;
const financialData = /계좌(?:번호|정보)|카드(?:번호|정보)|금융정보|결제정보|(?:bank account|payment card|credit card) (?:details|numbers?|information)/i;
const reportedLoss = /(?:탈취|도난|해킹|피해).{0,16}\d[\d,.]*\s*(?:억|만)\s*원.{0,8}(?:유출|피해|도난|탈취)|\d[\d,.]*\s*(?:억|만)\s*원?\s*(?:탈취|도난|피해)|(?:stolen|stole|loss of)\s*\$[\d,.]+|\$[\d,.]+(?:\s*(?:million|billion|[mb]))?\s*(?:stolen|lost)/i;
const privacy = /개인정보|고객정보|회원정보|주민등록번호|생년월일|전화번호|\b(?:data breach affecting [\d.,]+ (?:million )?(?:accounts|customers)|personal data|personal information|customer data|social security numbers|email addresses)\b/i;
const infrastructure = /클라우드|금융보안원|전력|결제망|기간통신|송전|공용 인증|항공관제|\b(?:cloud|power grid|payment network|telecom|air traffic)\b/i;
const majorOrg = /^(?:Microsoft|Amazon|Google|Apple|Oracle|SAP|Cisco|Salesforce|IBM|Meta|삼성전자|SK텔레콤|LG유플러스|현대자동차|한국전력|JPMorgan(?: Chase)?|Visa|Mastercard|1Password|FBI|CIA)$/i;
const notName = /^(?:트럼프|당국|공격자|지운|올해|해킹이|지주|코스닥|대충격|올해만|단독|해커|hackers?|report|customers?|software|cyberattack|alleged|company|group|officials?)$/i;
const exploitationReported = /악용 (?:정황|흔적|확인)|악용(?:해|으로).{0,20}(?:침투|탈취)|exploited.{0,30}(?:to breach|to steal|in (?:the|this) (?:attack|breach))/i;
const directReport = /\b(?:breach|hacked|hacking|cyberattack|attack|data leak|cyber incident|security incident)\b|침해|유출|해킹|보안\s?사고/i;
const namedReply = /^(?:\[[^\]]+\]\s*)?(?:["'“‘][^"'”’]{1,18}["'”’]\s*)?([A-Z][\w&.’'-]*(?:\s+[A-Z][\w&.’'-]*){0,3}|[가-힣A-Za-z0-9]{2,20})(?:\s+(?:says|denies|disputes|investigates|probes|confirms|reportedly|hit by|suffers)\b|,\s*|[ 는은]\s*["“]|의\s*해킹\s*의혹)/;
const backgroundRole = /\bSAP (?:customer|client|user)\b|SAP\s*(?:제품\s*사용|고객사)|while (?:a |the )?cyberattack targets|denies? (?:orchestrating|.{0,25}involvement)|배후설.{0,7}부인|(?:고객사|제품|사용\s?기업|협력사|입점사).{0,12}(?:에서|해킹|유출)|\b(?:customer|client|user|reseller) (?:of|using)\b|\b(?:products?|customers?|clients?)\s+(?:hit|breached|hacked)\b/i;
const http = url => /^https?:\/\//i.test(url || "");
const normalize = name => {
  const plain=name.toLowerCase().replace(/[^\p{L}\p{N}]/gu,"");
  if (["lit","라이터"].includes(plain)) return "lighter";
  if (["jpmorgan","jpmorganchase","jp모건"].includes(plain)) return "jpmorgan";
  return ["한국전력공사","한전","kepco"].includes(plain) ? "한국전력" : plain;
};
export const reportsDisputedImpact = t=>!!t && !background.test(t) && !backgroundRole.test(t) && directReport.test(t) && (dispute.test(t) || allegation.test(t));
const newReport = (t) => !background.test(t) && directReport.test(t) && (reportsIncident(t) || dispute.test(t) || allegation.test(t) || operations.test(t));
const withinEpisode = (stamp, start) => stamp >= start - DAY && stamp < start + 21*DAY;

function topics(name, description, event) {
  const types = [];
  if (infrastructure.test(name)) types.push("infra");
  if (operations.test(description)) types.push("operations");
  if (privacy.test(description) || (event?.rec > 0 && ["명","계정"].includes(event.recUnit))) types.push("personal");
  if (financialData.test(description)) types.push("financial");
  if (credentials.test(description)) types.push("technical");
  if (event?.usd > 0 || reportedLoss.test(description)) types.push("loss");
  return types;
}

function generic(name, article, event, media=1, customer=false) {
  if (!name || notName.test(name) || !http(article.u) || background.test(article.t)) return null;
  const types = topics(name,article.t,event);
  const substantial = (event?.rec >= 50000 && !event.claim) || event?.usd >= 1e7;
  const notable = majorOrg.test(name) || types.includes("infra");
  if (!customer && media<2 && !substantial && !notable && !types.some(t=>t==="operations" || t==="technical") &&
      !dispute.test(article.t) && !allegation.test(article.t)) return null;
  const vendor=/third[ -]party (?:vendor|provider)|at (?:a |its )?vendor|협력업체|위탁사|외부 업체/i.test(article.t);
  const role = customer ? "고객사 침해 관련 보도" : vendor ? "협력사 관련 보도" : notable ? (types.includes("infra") ? "핵심 서비스" : "주요 기업 또는 기관") :
    substantial ? "피해 규모 보도" : media>=2 ? "복수 매체 보도" : operations.test(article.t) ? "운영 영향 보도" : "침해 관련 보도";
  const stamp = Date.parse(article.d);
  return {id:event?.id || article.u, name, region:event?.r || article.r, role, types,
    first:stamp, priority:notable ? 2 : 1, sources:[article], title:article.tKo || article.t, event};
}

// Dated editorial records absorb reports about that particular episode. A product or customer mention alone is insufficient.
export function buildImpactCases(file, items, end, notes=impactNotes) {
  const from = end - 28*DAY;
  const articles = [...new Map(items.filter(row=>http(row.u) && row.t && Date.parse(row.d)<=end).map(row=>[row.u,row])).values()]
    .sort((a,b)=>a.d.localeCompare(b.d));
  const byUrl = new Map(articles.map(item=>[item.u,item]));
  const byGroup = new Map();
  for (const a of articles) if(a.g) {
    if (!byGroup.has(a.g)) byGroup.set(a.g,[]);
    byGroup.get(a.g).push(a);
  }
  const used = new Set();
  const cases = [];
  const reviewed = notes.filter(note=>Date.parse(note.first)<=end && Date.parse(note.first)>from-21*DAY && publicationDay(end)>=note.first.slice(0,4)+"-"+note.milestones.at(-1)[0].replace(".","-"));
  for (const note of reviewed) {
    const stamp=Date.parse(note.first);
    const sources = articles.filter(a=>withinEpisode(Date.parse(a.d),stamp) && note.match.test(a.t) && note.topic.test(a.t) &&
      !background.test(exploitationReported.test(a.t) ? a.t.replace(/취약점|vulnerabilit(?:y|ies)/gi,"") : a.t) &&
      !backgroundRole.test(a.t) && !/이어.{0,18}(?:까지|마저)|이번 주|잇단 보안사고|오늘뉴스|주요\s?뉴스|뉴스\s?종합|보안.{0,4}뉴스.{0,4}(?:모음|톱)|daily (?:digest|roundup)/i.test(a.t));
    for (const source of sources) used.add(source.u);
    cases.push({...note, types:note.type, first:Math.min(stamp,...sources.map(a=>Date.parse(a.d))), sources, reviewed:true});
  }

  const groups = new Map();
  function add(row) {
    if (!row || !Number.isFinite(row.first)) return;
    const key = normalize(row.name);
    const groupId = row.sources[0].g;
    const episodes = groups.get(key) || [];
    const existing = episodes.find(c=>c.id===row.id ||
      (Math.abs(c.first-row.first)<7*DAY && !/별개(?:의)? 사고|별건|unrelated incident|separate incident/i.test(row.sources[0].t) &&
        (!row.event || !c.event || row.event.id===c.event.id)) || (groupId && c.sources.some(s=>s.g===groupId) && Math.abs(c.first-row.first)<14*DAY)
      || (c.sources.some(s=>s.u===row.sources[0].u)));
    if (existing) {
      existing.sources.push(...row.sources);
      existing.first=Math.min(existing.first,row.first);
      existing.types=[...new Set([...existing.types,...row.types])];
    } else {
      cases.push(row);
      episodes.push(row);
      groups.set(key,episodes);
    }
    for (const s of row.sources) used.add(s.u);
  }

  for (const event of file?.events || []) {
    const recorded = Date.parse(event.d+"T00:00:00+09:00");
    if (recorded<from-DAY || recorded>end || !event.n || notName.test(event.n)) continue;
    const direct=(event.src || []).map(s=>byUrl.get(s.u)).filter(Boolean)
      .filter(a=>!background.test(a.t) && !used.has(a.u) && !backgroundRole.test(a.t));
    const related=direct.flatMap(a=>byGroup.get(a.g)||[]).filter(a=>!used.has(a.u) && !backgroundRole.test(a.t) &&
      normalize(a.t).includes(normalize(event.n)) && newReport(a.t) && Math.abs(Date.parse(a.d)-recorded)<7*DAY);
    const sources=[...new Map([...direct,...related].map(a=>[a.u,a])).values()];
    if (!sources.length || reviewed.some(n=>withinEpisode(recorded,Date.parse(n.first)) &&
      (n.names.includes(event.n) || (event.src || []).some(s=>used.has(s.u))))) continue;
    const first=sources.reduce((a,b)=>a.d<=b.d?a:b);
    // An old event resurfacing in current coverage is a follow-up, not a new case.
    if (Math.abs(Date.parse(first.d)-recorded)>3*DAY) continue;
    const row=generic(event.n,first,event,new Set(sources.map(a=>a.s)).size);
    if (row) { row.sources=sources; add(row); }
  }
  for (const a of articles) {
    if (used.has(a.u) || Date.parse(a.d)<=from || !newReport(a.t)) continue;
    const customer=/^(?:[A-Z][A-Za-z0-9.-]*\s+(?:customer|client)\s+([A-Z][\w&.-]*(?: [A-Z][\w&.-]*){0,2})\s+(?:discloses|confirms|denies|suffers|reports)|[가-힣A-Za-z0-9]+\s*고객사\s+([가-힣A-Za-z0-9]+?)(?:에서|의|,|\s+(?:해킹|침해|보안 ?사고)))/.exec(a.t);
    if (customer) {
      add(generic(customer[1] || customer[2],a,null,1,true));
      continue;
    }
    if (backgroundRole.test(a.t)) continue;
    const match=namedReply.exec(a.t);
    if (!match) continue;
    const name=match[1];
    if (!dispute.test(a.t) && !allegation.test(a.t) && !majorOrg.test(name) && !infrastructure.test(name)) continue;
    if (reviewed.some(note=>withinEpisode(Date.parse(a.d),Date.parse(note.first)) && note.names.some(n=>normalize(n)===normalize(name)))) continue;
    add(generic(name,a,null));
  }
  for (const row of cases) {
    row.sources=[...new Map(row.sources.map(s=>[s.u,s])).values()].sort((a,b)=>a.d.localeCompare(b.d));
    row.latest=row.sources.at(-1);
    if(!row.reviewed && row.sources.length) {
      row.title=row.sources[0].tKo || row.sources[0].t;
      row.types=[...new Set(row.sources.flatMap(a=>topics(row.name,a.t,row.event)))];
    }
  }
  return cases.filter(c=>c.first>from && c.first<=end).sort((a,b)=>b.priority-a.priority || Number(!!b.reviewed)-Number(!!a.reviewed) || b.first-a.first);
}

export function impactWindows(cases,end,articles) {
  const dates=new Set(articles.map(a=>publicationDay(Date.parse(a.d))));
  return Array.from({length:4},(_,i)=>{
    const until=end-(3-i)*7*DAY, start=until-7*DAY;
    const fromDate=publicationDay(start+1), toDate=publicationDay(until);
    const missed=[];
    for (let t=Date.parse(fromDate);t<=Date.parse(toDate);t+=DAY) {
      const date=new Date(t).toISOString().slice(0,10);
      if (!dates.has(date)) missed.push(date);
    }
    return {start,end:until,missed,rows:cases.filter(row=>row.first>start && row.first<=until)};
  });
}
export const responseReport = row => [...row.sources].reverse().find(s=>dispute.test(s.t));
export const dateLabel = stamp => publicationDay(stamp).slice(5).replace("-",".");
