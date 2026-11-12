import {basketSeries} from "./lib/sector-index.js";
import {esc,fmtPct,signClass,loadJson} from "./common.js";
const root=document.querySelector('#sector-panel');
let data,period="YTD",mode="equal",hidden=new Set(),latest=[];
const ranges=["1M","3M","6M","YTD","1Y"];
function draw() {
  const pickerOpen=root.querySelector('.sector-picker')?.open;
  const all=data.benchmarks[0].history.map(p=>p.date);
  const end=all.at(-1), endDate=new Date(end+'T00:00:00Z'), start=new Date(endDate);
  if(period==="YTD") start.setUTCFullYear(endDate.getUTCFullYear()-1,11,31);
  else if(period==="1Y") start.setUTCFullYear(start.getUTCFullYear()-1);
  else start.setUTCMonth(start.getUTCMonth()-Number(period[0]));
  const from=start.toISOString().slice(0,10);
  const anchor=all.filter(d=>d<=from).at(-1)||all[0];
  const dates=all.filter(d=>d>=anchor);
  latest=data.groups.map(g=>({...g,...basketSeries(g.stocks,data.stocks,dates,mode)}));
  for(const b of data.benchmarks) {
    const base=b.history.filter(p=>p.date<=dates[0]).at(-1)?.close;
    latest.push({...b,points:b.history.filter(p=>p.date>=dates[0]).map(p=>({date:p.date,value:p.close/base*100})),included:[],excluded:[]});
  }
  const visible=latest.filter(s=>!hidden.has(s.id));
  const values=visible.flatMap(s=>s.points.map(p=>p.value)).filter(v=>Number.isFinite(v));
  let lo=Math.min(100,...values),hi=Math.max(100,...values),pad=Math.max(2,(hi-lo)*.1);lo-=pad;hi+=pad;
  const W=Math.max(320,Math.round(root.clientWidth-28)),H=178,L=44,R=16,T=12,B=24, pw=W-L-R,ph=H-T-B;
  const x=date=>L+dates.indexOf(date)/(dates.length-1||1)*pw, y=v=>T+(hi-v)/(hi-lo)*ph;
  const ticks=Array.from({length:4},(_,i)=>lo+(hi-lo)*i/3);
  const grid=ticks.map(v=>`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end">${Math.round(v)}</text>`).join('');
  const paths=visible.map(s=>`<path class="series-${s.id}" d="${s.points.filter(p=>p.value!=null).map((p,i)=>`${i?'L':'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}"><title>${esc(s.name)} ${fmtPct(s.points.at(-1)?.value-100)}</title></path>`).join('');
  const security=latest.find(s=>s.id==='security'), secReturn=security.points.at(-1)?.value-100;
  const ranked=latest.filter(s=>!['KOSPI','KOSDAQ'].includes(s.id)).sort((a,b)=>b.points.at(-1).value-a.points.at(-1).value);
  const rank=ranked.findIndex(s=>s.id==='security')+1;
  const kosdaq=latest.find(s=>s.id==='KOSDAQ').points.at(-1).value-100;
  root.innerHTML=`<div class="sector-head"><h2>섹터 상대주가</h2><strong class="${signClass(secReturn)}">보안 ${fmtPct(secReturn)}</strong><span>${rank}/${data.groups.length}위, 코스닥 대비 ${fmtPct(secReturn-kosdaq)}p</span><div class="sector-controls"><div class="seg-switch" aria-label="비교 기간">${ranges.map(r=>`<button data-range="${r}" aria-pressed="${period===r}">${r}</button>`).join('')}</div><div class="seg-switch" aria-label="지수 비중"><button data-weight="equal" aria-pressed="${mode==='equal'}">동일가중</button><button data-weight="cap" aria-pressed="${mode==='cap'}">시총가중</button></div></div></div>
  <svg class="sector-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${period} 보안, 조선, 방산, 반도체, 바이오와 코스피, 코스닥, 시작 100 비교"><title>섹터 상대주가, 시작일 ${dates[0]} = 100</title>${grid}<line x1="${L}" x2="${W-R}" y1="${y(100)}" y2="${y(100)}" class="chart-base"/>${paths}<text x="${L}" y="${H-3}">${dates[0]}</text><text x="${W-R}" y="${H-3}" text-anchor="end">${end}</text></svg>
  <div class="sector-legend">${latest.filter(s=>!hidden.has(s.id)).map(s=>`<button class="legend-${s.id}" data-series="${s.id}" aria-pressed="${!hidden.has(s.id)}"><span class="legend-line"></span>${s.name} <b>${fmtPct(s.points.at(-1)?.value-100)}</b>${s.stocks?`<small>${s.included.length}/${s.stocks.length}</small>`:''}</button>`).join('')}<details class="sector-picker" ${pickerOpen?'open':''}><summary>비교 섹터 선택</summary><div class="sector-picker-list">${latest.filter(s=>s.id!=='security').map(s=>`<button data-series="${s.id}" aria-pressed="${!hidden.has(s.id)}">${s.name}</button>`).join('')}</div></details><details><summary>구성, 계산 기준</summary><div class="sector-method"><p>${data.membershipAsOf} 구성으로 소급 계산. 선택 기간 시작일 100, 기간 시작 비중으로 고정 수량 보유, 배당 제외. 시작일 미상장 종목은 제외. 시총가중은 현재 주식수를 시작 가격에 적용한 근사치. 일봉 갱신 ${data.generatedAt.slice(0,10)}.</p>${data.groups.map(g=>{const row=latest.find(s=>s.id===g.id);return `<p><b>${g.name}</b> ${g.source?`<a href="${esc(g.source)}" target="_blank" rel="noopener">${esc(g.reference)}</a>`:esc(g.reference)}: ${g.stocks.map(s=>esc(s.name)).join(', ')}${row.excluded.length?`<br>제외: ${row.excluded.map(s=>esc(s.name)).join(', ')}`:''}</p>`}).join('')}</div></details></div>`;
}
root?.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.dataset.range)period=b.dataset.range;if(b.dataset.weight)mode=b.dataset.weight;if(b.dataset.series&&b.dataset.series!=='security'){hidden.has(b.dataset.series)?hidden.delete(b.dataset.series):hidden.add(b.dataset.series);}draw();});
if(root) loadJson('data/sectors.json').then(result=>{data=result;hidden=new Set([...data.groups.filter(g=>!['security','ship','defense','semi','bio'].includes(g.id)).map(g=>g.id),'KOSPI']);draw();}).catch(()=>{root.textContent='섹터 비교 데이터를 불러오지 못했습니다.';});
window.addEventListener('resize',()=>{if(data)draw();});
