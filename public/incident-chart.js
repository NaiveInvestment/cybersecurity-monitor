import { esc, fmtKst } from "./common.js";
import { eventSeries, grades } from "./lib/incident-series.js";
import { reportedEdition } from "./lib/reported-impact.js";

const $=selector=>document.querySelector(selector);
const date=value=>fmtKst(new Date(value).toISOString()).slice(0,5).replace("-",".");
const value=week=>week.mean===null?"미정":week.mean.toFixed(1);
let archive, live=[], weeks=[], selected=16, width=0;
const change=(a,b,unit)=>a===b?"동일":(a>b?"+":"−")+Math.abs(a-b).toLocaleString("ko-KR",{maximumFractionDigits:1})+unit;

function select(index) {
  selected=index;
  const w=weeks[index];
  $("#case-trend-plot").querySelectorAll("[data-week]").forEach(hit=>{
    const active=Number(hit.dataset.week)===index;
    hit.setAttribute("aria-pressed",String(active));
    hit.setAttribute("tabindex",active?"0":"-1");
  });
  const label=date(w.start)+" ~ "+date(w.end);
  $("#trend-selection").textContent=label+"　"+(w.available?(w.partial?"부분 집계 ":"")+w.events.length+"건":"자료 부족")+
    (w.assessed?"　평균 "+value(w)+" / 4　높음 이상 "+(w.distribution[3]+w.distribution[4])+"건":"")+
    (w.distribution[0]?"　강도 미정 "+w.distribution[0]+"건":"");
  const list=$("#trend-cases");
  list.hidden=!w.events.length;
  list.querySelector("summary").textContent="선택 기간 사건 "+w.events.length+"건과 출처";
  list.querySelector("ul").innerHTML=w.events.map(e=>'<li><span class="case-grade grade-'+e.grade+'">'+esc(grades[e.grade])+'</span><div><a target="_blank" rel="noopener" href="'+esc(e.url)+'">'+esc(e.name)+'</a><small>'+esc(e.impact===e.name?e.reason:e.impact)+(e.reason!==e.impact && e.name!==e.impact?' / '+esc(e.reason):'')+ '</small>'+(e.sources?.length>1?'<small>'+e.sources.map(s=>'<a target="_blank" rel="noopener" href="'+esc(s.url)+'">'+esc(s.name)+'</a>').join(', ')+'</small>':'')+'</div></li>' ).join("");
  const top=w.events.filter(e=>e.grade>=3).slice(0,2);
  $("#trend-leaders").innerHTML=top.map(e=>'<a target="_blank" rel="noopener" title="'+esc(e.reason)+'" href="'+esc(e.url)+'">'+esc(e.name)+' ('+esc(e.reason)+')</a>').join('<span aria-hidden="true">, </span>');
}

function plot() {
  const chart=$("#case-trend-plot");
  width=chart.clientWidth;
  if (!width || !weeks.length) return;
  const left=30, right=width-9, step=(right-left)/weeks.length, x=i=>left+(i+.5)*step;
  const max=Math.max(4,Math.ceil(Math.max(...weeks.map(w=>w.events.length))/4)*4);
  const top=21, base=86, low=122, bottom=173;
  const y=n=>base-n/max*(base-top), score=n=>bottom-(n-1)/3*(bottom-low);
  const grid=(v,s)=>'<line class="grid-line" x1="'+left+'" x2="'+right+'" y1="'+v+'" y2="'+v+'"/><text x="'+(left-6)+'" y="'+(v+4)+'" text-anchor="end">'+s+'</text>';
  let svg='<text class="axis-title" x="0" y="12">공개 사건 수 (건)</text><text class="axis-title" x="0" y="111">사건당 평균 강도 (1~4)</text>'+grid(y(max),max)+grid(y(max/2),max/2)+grid(base,0)+grid(score(4),4)+grid(score(2.5),2.5)+grid(score(1),1);
  let line="", move=true;
  weeks.forEach((w,i)=>{
    const bar=Math.min(step*.58,45), cx=x(i);
    if(w.available) svg+='<rect class="ds-bar" x="'+(cx-bar/2)+'" y="'+y(w.events.length)+'" width="'+bar+'" height="'+(base-y(w.events.length))+'"/>';
    else svg+='<text x="'+cx+'" y="'+(base-4)+'" text-anchor="middle">–</text>';
    if(w.mean!==null) {
      line+=(move?"M":"L")+cx+" "+score(w.mean)+" ";
      svg+='<circle class="share-dot" cx="'+cx+'" cy="'+score(w.mean)+'" r="3"/>';
      move=false;
    } else move=true;
    const tick=date(w.start);
    if (!i || tick.slice(0,2)!==date(weeks[i-1].start).slice(0,2)) svg+='<text x="'+cx+'" y="194" text-anchor="middle">'+Number(tick.slice(0,2))+'월</text>';
  });
  svg+='<path class="share-line" d="'+line+'"/>';
  weeks.forEach((w,i)=>{
    const label=date(w.start)+" ~ "+date(w.end)+", "+(w.available?w.events.length+"건, 강도 "+value(w):"자료 부족");
    svg+='<g role="button" data-week="'+i+'" aria-label="'+esc(label)+'"><title>'+esc(label)+'</title><rect class="week-hit" x="'+(x(i)-step/2+1)+'" y="16" width="'+(step-2)+'" height="162" rx="2"/></g>';
  });
  chart.innerHTML='<svg viewBox="0 0 '+width+' 200" role="group" aria-label="주별 해킹 사건 수와 피해 강도. 방향키로 기간 선택">'+svg+'</svg>';
  select(selected);
}

function draw() {
  if (!archive) return;
  const asOf=Math.floor(Date.now()/60000)*60000;
  weeks=eventSeries(archive.events,live,asOf);
  const last=weeks.at(-1), prior=weeks.at(-2);
  $("#case-trend-range").textContent=date(weeks[0].start)+" ~ "+date(last.end)+" / 17주 / "+fmtKst(new Date(asOf).toISOString())+" KST";
  const total=w=>w.available?w.events.length+"건":"자료 부족";
  $("#case-trend-stats").innerHTML='<div><span>최근 7일 공개 사건</span><strong>'+total(last)+'</strong><small>직전 7일 '+total(prior)+(prior.available && last.available?" / "+change(last.events.length,prior.events.length,"건"):"")+'</small></div>'+
    '<div><span>사건당 평균 강도</span><strong>'+value(last)+(last.assessed?'<em> / 4</em>':'')+'</strong><small>직전 7일 '+value(prior)+(last.assessed && prior.assessed?' / '+change(Number(value(last)),Number(value(prior)),"점"):'')+'</small></div>';
  plot();
}
export function showSeries(data) {
  if (!data?.events?.length) {
    if (!archive) $("#case-trend-range").textContent="사건 기록을 불러오지 못했습니다.";
    return;
  }
  archive=data;
  draw();
}
export function updateEditions(editions) {
  if (!Array.isArray(editions)) return;
  live=editions.filter(e=>typeof e.date==="string" && typeof e.title==="string" && typeof e.id==="string").map(reportedEdition);
  draw();
}
export function bindSeries() {
  const chart=$("#case-trend-plot");
  new ResizeObserver(()=>{ if(width!==chart.clientWidth && weeks.length) plot(); }).observe(chart);
  chart.addEventListener("click",event=>{
    const hit=event.target.closest("[data-week]");
    if(hit) select(Number(hit.dataset.week));
  });
  chart.addEventListener("keydown",event=>{
    if(!event.target.closest("[data-week]")) return;
    const next={ArrowLeft:selected-1,ArrowRight:selected+1,Home:0,End:16,Enter:selected," ":selected}[event.key];
    if(next===undefined) return;
    event.preventDefault();select(Math.max(0,Math.min(16,next)));
    chart.querySelector('[aria-pressed="true"]').focus();
  });
}
