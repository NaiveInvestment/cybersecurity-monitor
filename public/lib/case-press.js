import { articleUrlKey, mergeLibrary, publicationStamp } from "./news-library.js";

const key = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu,"");
const aliases = [
  ["The Record","The Record from Recorded Future News","therecord.media"],
  ["KBS","KBS 뉴스","news.kbs.co.kr"], ["SBS","SBS 뉴스","news.sbs.co.kr"],
  ["MBC","MBC 뉴스","imnews.imbc.com"], ["디지털타임스","www.dt.co.kr"],
  ["매일경제","매일경제 마켓","mk.co.kr"], ["조선비즈","Chosunbiz","biz.chosun.com"],
  ["연합뉴스","연합뉴스 한민족센터","Yonhap News Agency","yna.co.kr"],
  ["VOA 한국어","VOA 한국어 홈페이지","voakorea.com"],
  ["오마이뉴스","OhmyNews"], ["한겨레","hani.co.kr"], ["EBN","www.ebn.co.kr"],
];
const outlets = new Map(aliases.flatMap(([name,...other])=>[name,...other].map(s=>[key(s.replace(/^www\./i,"")),name])));

export function casePress(caseRow,end) {
  const candidates = [...caseRow.sources];
  const ref = caseRow.milestones?.at(-1);
  if (ref?.[5] && caseRow.pressTitle) {
    candidates.push({t:caseRow.pressTitle,s:ref[3],u:ref[4],d:ref[5]});
  }
  const reviewedUrl = ref && articleUrlKey(ref[4]);
  const reports = candidates.filter(a=>/^https?:\/\//i.test(a.u) && a.s?.trim() && !/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\//i.test(a.u)).map(a=>{
    const name = a.s.trim().replace(/^https?:\/\/|\/$/gi,"").replace(/^www\./i,"");
    return {...a,s:outlets.get(key(name)) || name};
  });
  const start = end-86400000;
  const articles = mergeLibrary(reports).map(a=>{
    const known = ref?.[5] && (articleUrlKey(a.u)===reviewedUrl ||
      (caseRow.pressTitle && key(a.s)===key(ref[3]) && key(a.t)===key(caseRow.pressTitle)));
    const at = known ? publicationStamp({d:ref[5]}) : publicationStamp(a);
    return {...a,at};
  }).filter(a=>a.at>start && a.at<=end).sort((a,b)=>b.at-a.at || a.u.localeCompare(b.u));
  return {articles, outlets:new Set(articles.map(a=>key(a.s))).size};
}
