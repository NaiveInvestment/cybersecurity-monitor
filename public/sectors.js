import {basketSeries,liveSectorComparison} from "./lib/sector-index.js";
import {esc,fmtKst,fmtPct,signClass,loadJson} from "./common.js";
import {startQuoteFeed} from "./lib/quote-feed.js";
import {marketPeriodLabels} from "./lib/market-activity.js";
const root=document.querySelector('#sector-panel');
let data,period="YTD",mode="cap",hidden=new Set();
let localFeed,refreshFeed,liveSnapshot,feedSource,polling=false;
const ranges=["1D","1W","1M","3M","6M","YTD","1Y"];
const focusable='button,summary,a[href]';
const cloudMaxAge=180000;
function dailyComparison() {
  const all=data.benchmarks[0].history.map(p=>p.date);
  const end=all.at(-1), endDate=new Date(end+'T00:00:00Z'), start=new Date(endDate);
  if(period==="1D") start.setTime(Date.parse((all.at(-2)||end)+'T00:00:00Z'));
  else if(period==="1W") start.setUTCDate(start.getUTCDate()-7);
  else if(period==="YTD") start.setUTCFullYear(endDate.getUTCFullYear()-1,11,31);
  else if(period==="1Y") start.setUTCFullYear(start.getUTCFullYear()-1);
  else start.setUTCMonth(start.getUTCMonth()-Number(period[0]));
  const from=start.toISOString().slice(0,10);
  const anchor=all.filter(d=>d<=from).at(-1)||all[0];
  const dates=all.filter(d=>d>=anchor);
  const series=data.groups.map(g=>({...g,...basketSeries(g.stocks,data.stocks,dates,mode)}));
  for(const b of data.benchmarks) {
    const base=b.history.filter(p=>p.date<=dates[0]).at(-1)?.close;
    series.push({...b,points:b.history.filter(p=>p.date>=dates[0]).map(p=>({date:p.date,value:p.close/base*100}))});
  }
  return {dates,series};
}

const lastValue = (series) => series.points.at(-1)?.value;
const percentReturn = (series) => Number.isFinite(lastValue(series)) ? lastValue(series)-100 : null;

function draw(preserveFocus=false) {
  const detailStates=[...root.querySelectorAll('details')].map(detail=>detail.open);
  const methodScroll=root.querySelector('.sector-method')?.scrollTop ?? 0;
  const focused = preserveFocus && root.contains(document.activeElement) ? document.activeElement : null;
  const active = focused ? [...root.querySelectorAll(focusable)].indexOf(focused) : -1;
  const seriesId = focused?.dataset.series;
  const sourceList = focused?.closest(".sector-picker-list") ? ".sector-picker-list" : ".sector-legend";
  const oneDay=period==="1D" && refreshFeed;
  const live=oneDay && liveSectorComparison(data,liveSnapshot,mode,Date.now(),feedSource==="cloud"?cloudMaxAge:undefined);
  const {dates,series:latest}=live || dailyComparison();
  const end=dates.at(-1);
  const basis=live ? `${live.open?'장중':'마감'} ${fmtKst(live.asOf,false)} KST` : oneDay ? '일봉 기준' : '';
  const source=feedSource==="cloud"
    ? '보안주, 비교 섹터, 지수는 네이버 금융 장중 시세입니다.'
    : '보안주는 키움 체결 우선, 비교 섹터와 지수는 네이버 금융 시세입니다.';
  const method=live
    ? `직전 거래일 종가를 100으로 두고 같은 거래일의 최신 KRX 시세로 계산합니다. ${source} 해당 거래일 시세나 기준 종가가 없는 종목은 제외합니다. 시총가중은 직전 거래일 종가 기준입니다.`
    : `${data.membershipAsOf} 구성으로 소급 계산. 선택 기간 시작일 100, 기간 시작 비중으로 고정 수량 보유, 배당 제외. 시작일 미상장 종목은 제외. 시총가중은 현재 주식수를 시작 가격에 적용한 근사치. 일봉 갱신 ${data.generatedAt.slice(0,10)}.`;
  const visible=latest.filter(s=>!hidden.has(s.id));
  const values=visible.flatMap(s=>s.points.map(p=>p.value)).filter(v=>Number.isFinite(v));
  let lo=Math.min(100,...values),hi=Math.max(100,...values),pad=Math.max(2,(hi-lo)*.1);lo-=pad;hi+=pad;
  const W=Math.max(250,Math.round(root.clientWidth - 2 * parseFloat(getComputedStyle(root).paddingLeft))),H=186,L=44,R=16,T=12,B=24, pw=W-L-R,ph=H-T-B;
  const x=date=>L+dates.indexOf(date)/(dates.length-1||1)*pw, y=v=>T+(hi-v)/(hi-lo)*ph;
  const ticks=Array.from({length:4},(_,i)=>lo+(hi-lo)*i/3);
  const grid=ticks.filter(v=>Math.abs(y(v)-y(100))>13).map(v=>`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end">${Math.round(v)}</text>`).join('');
  const paths=visible.filter(s=>Number.isFinite(lastValue(s))).map(s=>`<path class="series-${s.id}" d="${s.points.filter(p=>Number.isFinite(p.value)).map((p,i)=>`${i?'L':'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}"><title>${esc(s.name)} ${fmtPct(percentReturn(s))}</title></path>`).join('');
  const secReturn=percentReturn(latest.find(s=>s.id==='security'));
  const ranked=latest.filter(s=>s.stocks&&Number.isFinite(lastValue(s))).sort((a,b)=>lastValue(b)-lastValue(a));
  const rank=ranked.findIndex(s=>s.id==='security')+1;
  const kosdaq=percentReturn(latest.find(s=>s.id==='KOSDAQ'));
  const summary=[
    secReturn!=null && kosdaq!=null ? `코스닥 대비 <b class="${signClass(secReturn-kosdaq)}">${fmtPct(secReturn-kosdaq)}p</b>` : '',
    rank ? `${ranked.length}개 섹터 중 ${rank}위` : '',
    basis,
  ].filter(Boolean).map(item=>`<span>${item}</span>`).join('');
  root.innerHTML=`<header class="sector-head"><h2>섹터 상대주가</h2><div class="seg-switch" role="group" aria-label="섹터 상대주가 가중 방식"><button type="button" data-weight="equal" aria-pressed="${mode==='equal'}">동일가중</button><button type="button" data-weight="cap" aria-pressed="${mode==='cap'}">시총가중</button></div></header>
  <div class="sector-performance"><div><span>보안주 수익률</span><strong class="${signClass(secReturn)}">${fmtPct(secReturn)}</strong></div><p>${summary}</p></div>
  <div class="sector-controls"><div class="seg-switch" role="group" aria-label="비교 기간">${ranges.map(r=>`<button type="button" data-range="${r}" aria-pressed="${period===r}">${marketPeriodLabels[r]}</button>`).join('')}</div><small>시작일 = 100</small></div>
  <svg class="sector-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${period} ${esc(visible.map(s=>s.name).join(', '))}, 시작 100 비교"><title>섹터 상대주가, ${dates[0]} = 100</title>${grid}<line x1="${L}" x2="${W-R}" y1="${y(100)}" y2="${y(100)}" class="chart-base"/><text class="sector-base-value" x="${L-8}" y="${y(100)+4}" text-anchor="end">100</text>${paths}<text x="${L}" y="${H-3}">${dates[0]}</text><text x="${W-R}" y="${H-3}" text-anchor="end">${end}</text></svg>
  <div class="sector-legend">${visible.map(s=>`<button class="legend-${s.id}" data-series="${s.id}" aria-pressed="true"><span class="legend-line"></span>${s.name} <b>${fmtPct(percentReturn(s))}</b>${s.stocks?`<small>${s.included.length}/${s.stocks.length}</small>`:''}</button>`).join('')}</div><div class="sector-actions"><details class="sector-picker" ${detailStates[0]?'open':''}><summary>비교 섹터 선택</summary><div class="sector-picker-list">${latest.filter(s=>s.id!=='security').map(s=>`<button data-series="${s.id}" aria-pressed="${!hidden.has(s.id)}">${s.name}</button>`).join('')}</div></details><details ${detailStates[1]?'open':''}><summary>구성, 계산 기준</summary><div class="sector-method"><p>${method}</p>${data.groups.map(g=>{const row=latest.find(s=>s.id===g.id);return `<p><b>${g.name}</b> ${g.source?`<a href="${esc(g.source)}" target="_blank" rel="noopener">${esc(g.reference)}</a>`:esc(g.reference)}: ${g.stocks.map(s=>esc(s.name)).join(', ')}${row.excluded.length?`<br>제외: ${row.excluded.map(s=>esc(s.name)).join(', ')}`:''}</p>`}).join('')}</div></details></div>`;
  if (active >= 0) {
    const target = seriesId
      ? root.querySelector(`${sourceList} [data-series="${CSS.escape(seriesId)}"]`) ?? root.querySelector(".sector-picker summary")
      : root.querySelectorAll(focusable)[active];
    target?.focus({preventScroll:true});
  }
  if(methodScroll) root.querySelector('.sector-method').scrollTop=methodScroll;
}

function showSnapshot(snapshot, source) {
  liveSnapshot=snapshot;
  feedSource=source;
  if(data && period==="1D") draw(true);
}

function acceptSector(snapshot, cloud) {
  const relay=liveSectorComparison(data,snapshot,mode);
  if(!relay) return false;
  const fallback=liveSectorComparison(data,cloud,mode,Date.now(),cloudMaxAge);
  return !fallback || relay.dates.at(-1)>=fallback.dates.at(-1);
}

async function pollLocal() {
  if(!data || period!=="1D" || document.hidden || polling) return;
  polling=true;
  try { showSnapshot(await loadJson(localFeed.url), "local"); }
  catch { showSnapshot(null, "local"); }
  finally { polling=false; }
}

root?.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.dataset.range)period=b.dataset.range;if(b.dataset.weight)mode=b.dataset.weight;if(b.dataset.series&&b.dataset.series!=='security'){hidden.has(b.dataset.series)?hidden.delete(b.dataset.series):hidden.add(b.dataset.series);}draw(true);if(b.dataset.range==="1D")refreshFeed?.();});
if(root) loadJson('data/sectors.json').then(result=>{data=result;hidden=new Set(data.groups.filter(g=>!['security','semi','bio'].includes(g.id)).map(g=>g.id));draw();}).catch(()=>{root.textContent='섹터 비교 데이터를 불러오지 못했습니다.';});
if(root) loadJson('data/meta.json').then(meta=>{
  localFeed=meta.sectorLive;
  if(localFeed) {
    refreshFeed=pollLocal;
    setInterval(pollLocal,localFeed.interval);
    document.addEventListener('visibilitychange',pollLocal);
  } else if(meta.live?.sector) {
    refreshFeed=startQuoteFeed(meta.live,{
      acceptSector,
      isActive:()=>Boolean(data) && period==="1D",
      onQuotes:(payload,source)=>showSnapshot(payload.sector,source),
      onRelayLost:(cloud)=>showSnapshot(cloud?.sector,"cloud"),
      onUnavailable:()=>{if(feedSource!=="relay" && data && period==="1D") draw(true);},
    });
  }
  refreshFeed?.();
}).catch(()=>{ /* 일봉 데이터를 사용한다. */ });
window.addEventListener('resize',()=>{if(data)draw();});
