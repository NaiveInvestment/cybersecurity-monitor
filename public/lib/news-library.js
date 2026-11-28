const DAY = 86400000;
const cleaned = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const isGoogle = url => url.startsWith("https://news.google.com/");

function urlKey(url) {
  try {
    const u = new URL(url);
    u.hash="";
    u.hostname=u.hostname.replace(/^www\./,"");
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$|oc$)/i.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    return u.href.replace(/\/$/,"");
  } catch { return url; }
}

export function priceHeadline(title) {
  if (/(?:股价|股價|概念股|板块).{0,24}(?:大涨|上涨|涨停|拉升|下跌|暴跌|漲停|上漲)/u.test(title)) return true;
  const stockMove = /(?:급등락|급등|급락|상한가|하한가|장중.{0,15}(?:강세|약세|%))|\d+(?:\.\d+)?\s*%\s*(?:올라|뛰어|↑|↓)/u;
  const operatingMetric = /계약\s*금액|수주\s*액|공급\s*액|매출|피해|도입률|차단율|탐지율|수요|공격\s*(?:건수|횟수)|사용량/u;
  if (stockMove.test(title) && !operatingMetric.test(title) &&
      /(?:주가|관련주|종목|보안주|테마주|장중|상한가|하한가|기대감|\d+(?:\.\d+)?\s*%)/u.test(title)) return true;
  return /\[\s*(?:특징주|주가동향|급등주)\s*\]|(?:주가|관련주|보안주|보안株|주식|테마주|株).{0,32}(?:급등|급락|강세|약세|상승|하락|상한가|신고가|반등)|(?:주가|종목).{0,14}(?:목표가|목표주가)|\b(?:shares|stocks?|share price)\s+(?:(?:of|in)\s+.{1,35}?\s+)?(?:jump|soar|surge|rally|rallie|climb|rise|gain|dip|fall|tumble|drop|slide|plunge|spike|up\b|down\b)/iu.test(title);
}

export function veryImportant(item) {
  if (typeof item.important === "boolean") return item.important;
  if (!item.confirmed) return false;
  const text = item.t+" "+(item.tKo || "");
  if (/의혹|우려|유출 가능|유출 없|유출.*아니|단순 점검|모의훈련|초안|법안 발의|검토 중|취소소송|손해배상|급등|급락|could|may have|suspect|potential|denies|draft|proposal|simulation|lawsuit|sues/i.test(text)) return false;
  if (/유출|탈취|노출|leaked|stolen|breach|exposed/i.test(text)) {
    const counts = [...text.matchAll(/(\d[\d,.]*)\s*(억|만|million|billion|thousand)\s*(여?\s*명|여?\s*건|people|users|customers|accounts|records|patients)/gi)];
    if (counts.some(([,n,u]) => Number(n.replaceAll(",","")) * ({"억":1e8,"만":1e4,"million":1e6,"billion":1e9,"thousand":1e3}[u.toLowerCase()]) >= 100000)) return true;
  }
  const core = /미\s*공군|전국.{0,8}(은행|전력|통신)|국가\s*결제망|national payment|air force|national power grid/i;
  return core.test(text) && /해킹 피해|해킹.{0,10}뚫|침해 확인|전면 중단|전국.{0,8}마비|hackers? breach|crippled|nationwide outage/i.test(text);
}

export function mergeLibrary(base, extras=[]) {
  const result=[], byUrl=new Map(), byTitle=new Map();
  for (const row of [...base,...extras]) {
    if (!row?.u || !row.t || priceHeadline(row.t)) continue;
    const url=urlKey(row.u);
    const title=cleaned(row.s)+"|"+cleaned(row.t);
    const same=byTitle.get(title);
    const i=byUrl.get(url) ?? (same !== undefined && Math.abs(Date.parse(result[same].d)-Date.parse(row.d))<=2*DAY ? same : undefined);
    if (i===undefined) {
      byTitle.set(title,result.length); byUrl.set(url,result.length); result.push(row); continue;
    }
    const old=result[i];
    const newest = Date.parse(row.d) >= Date.parse(old.d) ? row : old;
    const prior = newest === row ? old : row;
    const direct = isGoogle(newest.u) && !isGoogle(prior.u) ? prior : newest;
    const merged = {...prior, ...newest, u:direct.u, id:direct.id,
      k:[...new Set([...(old.k || []), ...(row.k || [])])]};
    if (prior.t !== newest.t && !newest.tKo) delete merged.tKo;
    result[i]=merged;
    byUrl.set(url,i); byTitle.set(title,i);
  }
  return result.sort((a,b)=>Date.parse(b.d)-Date.parse(a.d) || a.u.localeCompare(b.u));
}

export function importanceMark(item) {
  return veryImportant(item) ? '<strong class="news-important">중요</strong> ' : "";
}

