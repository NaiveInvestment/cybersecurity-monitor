import { esc } from "./common.js";
import { buildImpactCases, dateLabel } from "./lib/impact-cases.js";
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

function caseCard(row) {
  const original = row.sources[0];
  const reviewed = row.milestones?.at(-1);
  const source = reviewed ? link(reviewed[4],reviewed[3]+" ↗") : link(original.u,original.s+" ↗");
  const attack = row.attack || original.tKo || original.t;
  const impact = row.impact || reportedScale(row.event);
  return '<article class="impact-story flow-event" data-case="'+esc(row.id)+'">'+
    '<header><h3>'+esc(row.name)+'</h3><small>'+(row.region==="KR"?"국내":"해외")+' / '+dateLabel(row.first)+'</small></header>'+
    '<p class="case-attack">'+esc(attack)+'</p>'+
    '<p class="case-impact"><span>피해</span> '+esc(impact || "규모 미공개")+'</p>'+
    '<footer>'+source+'</footer></article>';
}

export function renderImpact(file,items,end,cards) {
  const cases = buildImpactCases(file,items,end);
  const recent = cases.filter(row=>row.first>end-7*86400000);
  const pool = recent.length ? recent : cases;
  const lead = pool.slice(0,2);
  const third = pool.find(row=>!lead.includes(row) && row.types.some(t=>!lead.some(c=>c.types.includes(t)))) || pool[2];
  if (third) lead.push(third);
  $("#global-issues").innerHTML = lead.map(caseCard).join("") || '<p class="empty">선정된 침해 보도 없음</p>';
  const policy = materialPolicy(items,cards,end);
  const box = $("#impact-policy");
  box.hidden = !policy;
  if (policy) box.innerHTML = '<h3>정책과 기업 대응</h3><p>'+link(policy.url,policy.title)+'</p>';
}
