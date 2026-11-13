import {financialRow,annualValuation} from "./financials.js";
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const FINANCIAL_METRICS=['revenue','operatingIncome','parentNetIncome'];
export function timelinePeriods(stocks,{quarter=false,all=false}={}) {
  const type=quarter?'quarter':'annual';
  const rows=stocks.flatMap(s=>Object.entries(s[type]||{}));
  const actual=[...new Set(rows.filter(([,r])=>r.kind==='actual').map(([p])=>p))].sort();
  const estimate=[...new Set(rows.filter(([,r])=>r.kind==='estimate').map(([p])=>p))].sort();
  const periods=[...new Set([...(all?actual:actual.slice(quarter?-4:-3)),...(all?estimate:estimate.slice(0,quarter?4:2))])].sort();
  return periods.filter(period=>Number(period.slice(0,4))<=2027).map(period=>{const kinds=new Set(rows.filter(([p])=>p===period).map(([,r])=>r.kind));return {period,type,label:period+(kinds.size>1?'A/E':kinds.has('actual')?'A':'E'),estimate:kinds.has('estimate'),coverage:stocks.filter(s=>FINANCIAL_METRICS.some(k=>financialRow(s,period,'threeMonth',type)?.[k]!=null)).length};});
}
export function timelineValues(stock,period,cap,horizon='threeMonth',valuation='pe',quarter=false) {
  const row=financialRow(stock,period,horizon,quarter?'quarter':'annual');
  const values=FINANCIAL_METRICS.map(k=>row?.[k]??null);
  values.push(quarter?(row?.revenue>0&&row?.operatingIncome!=null?row.operatingIncome/row.revenue*100:null):annualValuation(stock,period,cap,horizon)[valuation]);
  return values;
}
export function timelineNumber(value) {
  return value==null||!Number.isFinite(Number(value))?'-':Number(value).toLocaleString('ko-KR',{maximumFractionDigits:1});
}
export function trendSvg(points,label) {
  const finite=points.map(p=>p.value).filter(v=>typeof v==='number'&&Number.isFinite(v));
  if(!finite.length)return '<span class="financial-missing">—</span>';
  const lo=Math.min(0,...finite),hi=Math.max(0,...finite),range=hi-lo||1;
  const x=i=>5+i/Math.max(1,points.length-1)*100,y=v=>17-(v-lo)/range*14;
  let paths='';
  for(let i=1;i<points.length;i++) {
    if(typeof points[i-1].value!=='number'||typeof points[i].value!=='number')continue;
    paths+=`<path class="${points[i].forecast?'forecast':'reported'}" d="M${x(i-1)},${y(points[i-1].value)} L${x(i)},${y(points[i].value)}"/>`;
  }
  const dots=points.map((p,i)=>typeof p.value==='number'?`<circle class="${p.forecast?'forecast':'reported'}" cx="${x(i)}" cy="${y(p.value)}" r="1.7"/>`:'').join('');
  const description=label+': '+points.map(p=>p.period+' '+timelineNumber(p.value)).join(', ');
  return `<svg class="financial-trend" viewBox="0 0 110 20" role="img" aria-label="${escape(description)}"><title>${escape(description)}</title><line class="trend-zero" x1="3" x2="108" y1="${y(0)}" y2="${y(0)}"/>${paths}${dots}</svg>`;
}
