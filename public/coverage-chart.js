import { esc, fmtKst } from "./common.js";

const $ = selector => document.querySelector(selector);
const short = value => fmtKst(value).slice(0,5).replace("-",".");
const pct = week => week.count ? 100 * week.severe.length / week.count : null;
const share = week => week.count ? pct(week).toFixed(1)+"%" : "—";
const delta = (n,unit) => n===0 ? "변동 없음" : (n>0?"+":"−")+Math.abs(n)+unit;
let archive, index, plottedWidth;

function choose(i) {
  index = i;
  const week = archive.weeks[i];
  for (const hit of $("#impact-chart").querySelectorAll("[data-week]")) {
    const active = Number(hit.dataset.week)===i;
    hit.setAttribute("aria-pressed",String(active));
    hit.setAttribute("tabindex",active?"0":"-1");
  }
  $("#coverage-readout").textContent = short(week.start)+" ~ "+short(week.end)+" / "+
    "보도 "+week.count+"건 (데일리시큐 "+week.sources.DS+", THN "+week.sources.THN+") / 주요 피해 "+week.severe.length+"건";
  const refs = $("#coverage-examples");
  refs.hidden = !week.severe.length;
  refs.querySelector("ul").innerHTML = week.severe.map(r=>'<li><a href="'+esc(r.url)+'" target="_blank" rel="noopener">'+esc(r.title)+'</a></li>').join("");
}

function plot(weeks) {
  const chart = $("#impact-chart");
  plottedWidth = Math.max(1,chart.clientWidth);
  const left=35, right=plottedWidth-8, step=(right-left)/weeks.length;
  const x = i => left+(i+.5)*step;
  const top=10, base=80, lowTop=105, bottom=148;
  const max = Math.max(10,Math.ceil(Math.max(...weeks.map(w=>w.count))/20)*20);
  const high = Math.min(100,Math.max(20,Math.ceil(Math.max(...weeks.map(w=>pct(w)||0))/20)*20));
  const y = n => base-n/max*(base-top);
  const lowY = p => bottom-p/high*(bottom-lowTop);
  const grid = (height,label) => '<line class="grid-line" x1="'+left+'" x2="'+right+'" y1="'+height+'" y2="'+height+'"/><text x="'+(left-6)+'" y="'+(height+4)+'" text-anchor="end">'+label+'</text>';
  let svg = grid(top,max)+grid((top+base)/2,max/2)+grid(base,0)+grid(lowTop,high+"%")+grid(bottom,"0%");
  let curve="", next="M";
  for (const [i,w] of weeks.entries()) {
    const cx=x(i), bar=Math.min(40,step*.63);
    svg+='<rect class="ds-bar" x="'+(cx-bar/2)+'" y="'+y(w.sources.DS)+'" width="'+bar+'" height="'+(base-y(w.sources.DS))+'"/>'+
      '<rect class="thn-bar" x="'+(cx-bar/2)+'" y="'+y(w.count)+'" width="'+bar+'" height="'+(y(w.sources.DS)-y(w.count))+'"/>';
    const p=pct(w);
    if(p===null) { next="M"; continue; }
    curve+=next+cx+" "+lowY(p)+" "; next="L";
  }
  svg+='<path class="share-line" d="'+curve+'"/>';
  for (const [i,w] of weeks.entries()) {
    const cx=x(i), p=pct(w);
    if(p!==null) svg+='<circle class="share-dot" cx="'+cx+'" cy="'+lowY(p)+'" r="3"/>';
    const month=short(w.start).slice(0,2);
    if (!i || month!==short(weeks[i-1].start).slice(0,2)) svg+='<text class="month-tick" x="'+cx+'" y="170" text-anchor="middle">'+Number(month)+'월</text>';
    const label=short(w.start)+"부터 "+short(w.end)+"까지, 보도 "+w.count+"건, 주요 피해 "+share(w);
    svg+='<g role="button" data-week="'+i+'" aria-label="'+esc(label)+'"><rect class="week-hit" x="'+(cx-step/2+1)+'" y="3" width="'+(step-2)+'" height="149" rx="2"/></g>';
  }
  $("#impact-chart").innerHTML='<svg viewBox="0 0 '+plottedWidth+' 176" role="group" aria-label="주별 침해 보도량과 주요 피해 보도 비중. 방향키로 주 선택">'+svg+'</svg>';
}

export function bindCoverage() {
  const chart=$("#impact-chart");
  new ResizeObserver(()=>{
    if (!archive || !chart.clientWidth || chart.clientWidth===plottedWidth) return;
    const restoreFocus = chart.contains(document.activeElement);
    plot(archive.weeks);
    choose(index);
    if (restoreFocus) chart.querySelector('[aria-pressed="true"]').focus({preventScroll:true});
  }).observe(chart);
  chart.addEventListener("click",e=>{
    const hit=e.target.closest("[data-week]");
    if(hit) choose(Number(hit.dataset.week));
  });
  chart.addEventListener("keydown",e=>{
    const hit=e.target.closest("[data-week]");
    if(!hit) return;
    const keys={ArrowLeft:index-1,ArrowRight:index+1,Home:0,End:archive.weeks.length-1,Enter:index," ":index};
    if(!(e.key in keys)) return;
    e.preventDefault();
    choose(Math.min(archive.weeks.length-1,Math.max(0,keys[e.key])));
    chart.querySelector('[data-week="'+index+'"]').focus();
  });
}

export function renderCoverage(data) {
  if(!data?.weeks?.length) {
    if(!archive) $("#impact-range").textContent="보도 추이 자료를 불러오지 못했습니다.";
    return;
  }
  if(data.asOf===archive?.asOf) return;
  archive=data;
  const weeks=data.weeks, last=weeks.at(-1), prior=weeks.at(-2);
  $("#impact-range").textContent=short(weeks[0].start)+" ~ "+short(last.end)+" / 17주 / "+fmtKst(last.end)+" KST 기준";
  const change = pct(last)===null || pct(prior)===null ? "—" : delta(Number((pct(last)-pct(prior)).toFixed(1)),"%p");
  $("#impact-stats").innerHTML='<div><span>최근 7일 침해 보도</span><strong>'+last.count+'<small>건</small></strong><em>직전 7일 '+prior.count+'건 / '+delta(last.count-prior.count,"건")+'</em></div>'+
    '<div><span>주요 피해 보도 비중</span><strong>'+share(last)+'</strong><em>직전 7일 '+share(prior)+' / '+change+'</em></div>';
  plot(weeks);
  choose(weeks.length-1);
}
