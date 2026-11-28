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
    if (!row?.u || !row.t) continue;
    const url=urlKey(row.u);
    const title=cleaned(row.s)+"|"+cleaned(row.t);
    const same=byTitle.get(title);
    const i=byUrl.get(url) ?? (same !== undefined && Math.abs(Date.parse(result[same].d)-Date.parse(row.d))<=2*DAY ? same : undefined);
    if (i===undefined) {
      byTitle.set(title,result.length); byUrl.set(url,result.length); result.push(row); continue;
    }
    const old=result[i];
    const preferred=isGoogle(old.u) && !isGoogle(row.u) ? row : old;
    const merged={...old,...row,u:preferred.u,id:preferred.id,t:preferred.t,
      k:[...new Set([...(old.k || []),...(row.k || [])])]};
    if (old.important===true || row.important===true) merged.important=true;
    result[i]=merged;
    byUrl.set(url,i); byTitle.set(title,i);
  }
  return result.sort((a,b)=>Date.parse(b.d)-Date.parse(a.d) || a.u.localeCompare(b.u));
}

export function importanceMark(item) {
  return veryImportant(item) ? '<strong class="news-important">중요</strong> ' : "";
}

