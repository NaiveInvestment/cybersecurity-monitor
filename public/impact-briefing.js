import { esc, fmtKst } from "./common.js";
import { casePress } from "./lib/case-press.js";
import { buildImpactCases } from "./lib/impact-cases.js";
import { publicationDay } from "./lib/news-search.js";
import { materialPolicy } from "./lib/news-briefing.js";
import { fmtKrw, fmtUsd } from "./lib/incident-metrics.js";

const $ = selector => document.querySelector(selector);
const link = (url, title) => '<a target="_blank" rel="noopener" href="'+esc(url)+'">'+esc(title)+'</a>';

function reportedScale(event) {
  const facts = [];
  if (event?.rec > 0 && event.recUnit && !event.claim) facts.push(event.rec.toLocaleString("ko-KR")+event.recUnit);
  if (event?.usd > 0) facts.push(event.krw ? fmtKrw(event.krw) : fmtUsd(event.usd));
  return facts.join(", ");
}

function publicationTime(value) {
  if (!value) return "시각 미공개";
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const label = dayOnly ? value.slice(5).replace("-",".")+" 시각 미공개" : fmtKst(value).replace("-",".");
  return '<time datetime="'+esc(value)+'">'+esc(label)+'</time>';
}

function caseCard(row,end,partial) {
  const press=casePress(row,end);
  const count="최근 24시간 기사 "+press.articles.length+"건 / 매체 "+press.outlets+"곳"+(partial?" (일부 수집)":"");
  const note="수집한 공개 기사 기준. 발행 시각을 확인할 수 있는 보도만 집계합니다.";
  const coverage=press.articles.length ? '<details class="case-press"><summary title="'+note+'">'+count+'</summary><ul>'+
    press.articles.map(a=>'<li>'+link(a.u,a.tKo || a.t)+'<small>'+esc(a.s)+' / '+esc(fmtKst(a.at))+' KST</small></li>').join("")+
    '</ul></details>' : '<span class="case-press" title="'+note+'">'+count+'</span>';
  const original = row.sources[0];
  const reviewed = row.milestones?.at(-1);
  const source = reviewed ? link(reviewed[4],reviewed[3]+" ↗") : link(original.u,original.s+" ↗");
  const article = reviewed ? row.sources.find(item=>item.u===reviewed[4]) : original;
  const feedDate = article?.dayPrecision ? article.calendarDay || publicationDay(Date.parse(article.d)) : article?.d;
  const published = reviewed?.[5] || feedDate;
  const attack = row.attack || original.tKo || original.t;
  const impact = row.impact || reportedScale(row.event);
  return '<article class="impact-story flow-event" data-case="'+esc(row.id)+'">'+
    '<header><h3>'+esc(row.name)+'</h3><small>'+(row.region==="KR"?"국내":"해외")+' / '+publicationTime(published)+'</small></header>'+
    '<p class="case-attack">'+esc(attack)+'</p>'+
    '<p class="case-impact"><span>피해</span> '+esc(impact || "규모 미공개")+'</p>'+
    '<footer>'+source+coverage+'</footer></article>';
}

export function renderImpact(file,items,end,cards,failedDays=[]) {
  const cases = buildImpactCases(file,items,end);
  const recent = cases.filter(row=>row.first>end-7*86400000);
  const pool = recent.length ? recent : cases;
  const lead = pool.slice(0,2);
  const third = pool.find(row=>!lead.includes(row) && row.types.some(t=>!lead.some(c=>c.types.includes(t)))) || pool[2];
  if (third) lead.push(third);
  const host=$("#global-issues");
  const open=new Set([...host.querySelectorAll(".case-press[open]")].map(node=>node.closest("article").dataset.case));
  const partial=failedDays.some(day=>day>=publicationDay(end-86400000) && day<=publicationDay(end));
  host.innerHTML = lead.map(row=>caseCard(row,end,partial)).join("") || '<p class="empty">선정된 침해 보도 없음</p>';
  for (const details of host.querySelectorAll("details.case-press")) details.open=open.has(details.closest("article").dataset.case);
  const policy = materialPolicy(items,cards,end);
  const box = $("#impact-policy");
  box.hidden = !policy;
  if (policy) box.innerHTML = '<h3>정책과 기업 대응</h3><p>'+link(policy.url,policy.title)+'</p>';
}
