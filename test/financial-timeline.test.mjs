import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {timelinePeriods,timelineValues,trendSvg,timelineNumber} from '../public/lib/financial-timeline.js';
const data=JSON.parse(readFileSync(new URL('../data/financials.json',import.meta.url)));
test('financial timeline: actual and estimate periods chronologically, no 2028 gap-heavy default',()=>{
 const periods=timelinePeriods(data.stocks);
 assert.deepEqual(periods.map(p=>p.label),['2023A','2024A','2025A','2026E','2027E']);
 assert.equal(timelinePeriods(data.stocks,{all:true}).at(-1).label,'2028E');
 const quarters=timelinePeriods(data.stocks,{quarter:true});
 assert.ok(quarters.some(p=>p.label==='2026Q3A/E'));
 assert.equal(quarters.at(-1).period,'2027Q2');
});
test('financial timeline: simultaneous metrics, cap-sensitive PE, quarterly margin not quarterly PE',()=>{
 const g=data.stocks.find(s=>s.code==='263860');
 const values=timelineValues(g,'2026',3024);
 assert.deepEqual(values.slice(0,3),[574,112,104]);assert.equal(values[3],3024/104);
 assert.equal(timelineValues(g,'2026',6048)[3],values[3]*2);
 const sample={quarter:{'2026Q1':{kind:'actual',revenue:100,operatingIncome:-10,parentNetIncome:-12}}};
 assert.deepEqual(timelineValues(sample,'2026Q1',1000,'threeMonth','pe',true),[100,-10,-12,-10]);
 assert.deepEqual(timelineValues(data.stocks.find(s=>s.code==='053800'),'2026',1000),[null,null,null,null]);
 assert.equal(timelineNumber(null),'—');assert.equal(timelineNumber('N/M'),'N/M');
});
test('financial timeline: missing periods remain gaps and future segment is dashed',()=>{
 const gap=trendSvg([{period:'2023',value:10},{period:'2024',value:null},{period:'2025',value:20}], '매출');
 assert.equal((gap.match(/<path/g)||[]).length,0);assert.equal((gap.match(/<circle/g)||[]).length,2);
 const chart=trendSvg([{period:'2025A',value:-10},{period:'2026E',value:20,forecast:true}], '영업이익');
 assert.match(chart,/class="forecast" d=/);assert.match(chart,/trend-zero/);assert.match(chart,/-10/);
});
