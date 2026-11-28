import { esc, fmtKst, headlineLink } from "./common.js";
import { buildImpactCases, impactTypes, impactWindows, responseReport, dateLabel } from "./lib/impact-cases.js";
import { materialPolicy } from "./lib/news-briefing.js";
import { fmtKrw, fmtUsd } from "./lib/incident-metrics.js";

const $ = selector=>document.querySelector(selector);
let periods=[], selectedWeek=3, selectedType="all", expanded=false, archiveIssue=false;
const dateOf = article=>dateLabel(Date.parse(article.d));
const shortTitle = article=>article.tKo || article.t;
const link = (url,title)=>'<a target="_blank" rel="noopener" href="'+esc(url)+'">'+esc(title)+'</a>';
const subset = (week,type)=>week.rows.filter(row=>type==="all" || row.types.includes(type));
const firstDate = row=>dateLabel(row.first);
function figureCaption(row) {
  const e=row.event;
  if (!e) return "";
  const facts=[];
  if (Number.isFinite(e.rec) && e.rec>0 && e.recUnit && !e.claim) facts.push(e.rec.toLocaleString("ko-KR")+e.recUnit);
  if (e.usd>0) facts.push(e.krw ? fmtKrw(e.krw) : fmtUsd(e.usd));
  return facts.length ? "보도된 규모 "+facts.join(", ") : "";
}

function caseCard(row) {
  const milestones=row.milestones || [];
  const response=responseReport(row);
  const last=milestones.at(-1);
  const original=row.sources[0];
  const status=last ? last[1] : response ? "입장 관련 보도" : "언론 보도";
  const timeline=milestones.map(([date,kind,body,source,url])=>'<li><time>'+esc(date)+'</time><div><b>'+esc(kind)+'</b> '+esc(body)+' '+link(url,source)+'</div></li>').join("");
  const reports=[...row.sources].reverse();
  const head=row.reviewed ? esc(row.title) : original ? link(original.u,row.title) : esc(row.title);
  const facts=row.scope || figureCaption(row);
  const extra=reports.filter(a=>!last || dateOf(a)>last[0]);
  return '<article class="impact-story flow-event" data-case="'+esc(row.id)+'"><p class="case-kicker">'+
    esc(row.role)+' <span>/ '+(row.region==="KR"?"국내":"해외")+' / 첫 수집 보도 '+firstDate(row)+'</span></p><h3>'+head+'</h3>'+
    (facts?'<p class="case-scope">'+esc(facts)+'</p>':'')+
    (last?'<p class="case-update"><b>'+esc(status)+'</b> '+esc(last[0])+' '+esc(last[2])+' '+link(last[4],last[3])+'</p>':
      response?'<p class="case-update"><b>입장 관련 보도</b> '+headlineLink(response)+'</p>':'')+
    (row.lens?'<p class="case-lens"><b>투자자가 볼 점</b> '+esc(row.lens)+'</p>':'')+
    (last && extra.length?'<p class="case-followup"><b>후속 보도</b> '+headlineLink(extra[0])+'</p>':'')+
    '<details data-event="'+esc(row.id)+'"><summary>경과와 출처</summary>'+
    (timeline?'<ol class="impact-timeline">'+timeline+'</ol>':'')+
    (reports.length?'<ul class="case-sources">'+reports.map(a=>'<li><time>'+dateOf(a)+'</time> '+headlineLink(a)+' <small>'+esc(a.s)+'</small></li>').join("")+'</ul>':'')+
    '</details></article>';
}

function drawPeriod() {
  const current=periods[selectedWeek];
  if (!current) return;
  const rows=subset(current,selectedType);
  const host=$("#impact-list");
  const label=impactTypes.find(([key])=>key===selectedType)[1];
  const id=host.querySelector("details[open]")?.dataset.event;
  host.innerHTML='<h4>'+dateLabel(current.start)+' ~ '+dateLabel(current.end)+' / '+label+' '+rows.length+'건</h4>'+
    (rows.length?'<ul class="period-list">'+(expanded?rows:rows.slice(0,3)).map(row=>{
      const refs=row.sources.length?row.sources:[], last=row.milestones?.at(-1);
      const url=last?.[4] || refs[0]?.u;
      const title=row.reviewed ? row.title : shortTitle(refs[0]);
      return '<li><time>'+firstDate(row)+'</time><div>'+link(url,title)+
        '<details data-event="'+esc(row.id)+'"><summary>보도 내용과 출처</summary>'+
        (row.types.length?'<p>보도 주제 / '+row.types.map(t=>impactTypes.find(([k])=>k===t)?.[1]).filter(Boolean).map(esc).join(', ')+'</p>':'')+
        (row.reviewed?'<p>'+esc(row.scope)+'</p><p>'+esc(last[2])+' '+link(last[4],last[3])+'</p>':'')+
        refs.slice().reverse().map(a=>'<p>'+dateOf(a)+' '+headlineLink(a)+' <small>'+esc(a.s)+'</small></p>').join("")+
        '</details></div></li>';
    }).join("")+'</ul>':'<p class="empty">'+(current.missed.length||archiveIssue?'수집된 자료에서 이 유형의 사건을 찾지 못했습니다.':'이 기간에 선정된 사건이 없습니다.')+'</p>')+
    (rows.length>3?'<button class="period-more" type="button" data-period-more aria-expanded="'+expanded+'">'+(expanded?'목록 줄이기':'사건 '+rows.length+'건 모두 보기')+'</button>':'');
  if (id) for(const d of host.querySelectorAll("details")) d.open=d.dataset.event===id;
}

function drawMatrix() {
  const host=$("#impact-chart");
  const now=periods[3], prior=periods[2];
  const current=now.rows.length, previous=prior.rows.length, diff=current-previous;
  const partial=archiveIssue || now.missed.length || prior.missed.length;
  $("#impact-stats").innerHTML='<strong>'+current+'건</strong> 최근 7일 <span>직전 7일 '+previous+'건'+
    (partial?' / 일부 날짜 자료 없음':diff?' / '+Math.abs(diff)+'건 '+(diff>0?'증가':'감소'):' / 동일')+'</span>';
  const max=Math.max(1,...periods.map(w=>w.rows.length));
  host.innerHTML='<table><thead><tr><th scope="col">보도 주제</th>'+periods.map((w,i)=>'<th scope="col">'+
    (i===3?'최근 7일':i===2?'직전 7일':dateLabel(w.end)+'까지')+'</th>').join("")+'</tr></thead><tbody>'+
    impactTypes.map(([key,label])=>'<tr><th scope="row">'+label+'</th>'+periods.map((week,i)=>{
      const n=subset(week,key).length, incomplete=week.missed.length>0||archiveIssue;
      const displayed=incomplete && n===0?'—':String(n)+(incomplete?'*':'');
      return '<td><button type="button" class="matrix-cell" aria-pressed="'+(i===selectedWeek && key===selectedType)+'" data-impact-week="'+i+'" data-impact-type="'+key+
        '" aria-label="'+dateLabel(week.start)+'부터 '+dateLabel(week.end)+'까지 '+label+' '+n+'건'+(incomplete?' 일부 자료 없음':'')+'"><span>'+displayed+
        '</span><svg aria-hidden="true" class="cell-shade" viewBox="0 0 100 10" preserveAspectRatio="none"><rect width="'+Math.round(n/max*100)+'" height="10"/></svg></button></td>';
    }).join("")+'</tr>').join("")+'</tbody></table>';
}

export function bindImpact() {
  $("#impact-chart").addEventListener("click",e=>{
    const btn=e.target.closest("[data-impact-week]");
    if(!btn) return;
    selectedWeek=Number(btn.dataset.impactWeek); selectedType=btn.dataset.impactType; expanded=false;
    for (const node of $("#impact-chart").querySelectorAll("button")) node.setAttribute("aria-pressed",String(node===btn));
    drawPeriod();
  });
  $("#impact-list").addEventListener("click",e=>{
    if(!e.target.closest("[data-period-more]")) return;
    expanded=!expanded; drawPeriod(); $("#impact-list [data-period-more]")?.focus({preventScroll:true});
  });
}

export function renderImpact(file,items,end,cards,archive) {
  const cases=buildImpactCases(file,items,end);
  periods=impactWindows(cases,end,items);
  archiveIssue=!!archive.failed || !file;
  const week=periods[3].rows;
  const pool=week.length ? week : cases;
  const lead=pool.slice(0,2);
  const third=pool.find(row=>!lead.includes(row) && row.types.some(t=>!lead.some(c=>c.types.includes(t)))) || pool[2];
  if(third) lead.push(third);
  const host=$("#global-issues");
  const open=new Set([...host.querySelectorAll("details[open]")].map(d=>d.dataset.event));
  host.innerHTML=lead.map(caseCard).join("") || '<p class="empty">선정 기준에 맞는 보도가 없습니다.</p>';
  for(const d of host.querySelectorAll("details")) d.open=open.has(d.dataset.event);
  $("#impact-range").textContent=fmtKst(periods[3].start)+" ~ "+fmtKst(end)+" KST";
  const missing=periods.some(w=>w.missed.length);
  $("#impact-note").textContent="숫자를 누르면 해당 사건이 열립니다. 첫 수집 보도 시각 기준, 같은 사건은 한 번만 셉니다. 한 사건에 여러 주제가 붙을 수 있습니다."+
    (archiveIssue||missing?" *는 일부 날짜 자료만 집계, —는 해당 자료에서 관측 없음.":"");
  drawMatrix(); drawPeriod();
  const policy=materialPolicy(items,cards,end);
  const policyBox=$("#impact-policy");
  policyBox.hidden=!policy;
  if(policy) policyBox.innerHTML='<h3>정책과 기업 대응</h3><p>'+link(policy.url,policy.title)+'</p>';
}
