import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {financialRow,annualValuation} from '../public/lib/financials.js';
import {basketSeries} from '../public/lib/sector-index.js';
import {publicQuotes,createQuoteRelay} from '../src/public-relay.mjs';
import {freshRelay,relayUrl} from '../public/lib/relay.js';
const financials=JSON.parse(readFileSync(new URL('../data/financials.json',import.meta.url)));
test('financials: code coverage, workbook values, missing estimates and live valuation',()=>{
 assert.equal(financials.stocks.length,35);assert.equal(new Set(financials.stocks.map(s=>s.code)).size,35);
 const g=financials.stocks.find(s=>s.code==='263860');
 assert.equal(financialRow(g,'2026','threeMonth').revenue,574);
 assert.equal(financialRow(g,'2026','oneMonth').operatingIncome,110);
 assert.equal(financialRow(g,'2026','highest').operatingIncome,114);
 const v=annualValuation(g,'2026',3000),v2=annualValuation(g,'2026',3300);
 assert.ok(Math.abs(v2.pe/v.pe-1.1)<1e-10);assert.equal(v2.roe,v.roe);
 assert.equal(annualValuation(g,'2026',-1).pe,null);
 assert.equal(annualValuation(financials.stocks.find(s=>s.code==='456010'),'2026',3000).pe,'N/M');
 assert.equal(financialRow(financials.stocks.find(s=>s.code==='053800'),'2026'),null);
 const sparse={annual:{2026:{kind:'estimate',revenue:999,horizons:{oneMonth:{revenue:100}}}}};
 assert.equal(financialRow(sparse,'2026','threeMonth'),null);
});
test('sector: same-date base100, equal and starting cap weights, later listing excluded',()=>{
 const dates=['2026-01-02','2026-01-05'];
 const stocks={a:{history:[{date:dates[0],close:10},{date:dates[1],close:20}],p:20,cap:200},b:{history:[{date:dates[0],close:10},{date:dates[1],close:10}],p:10,cap:100},c:{history:[{date:dates[1],close:99}],p:99,cap:100}};
 const members=['a','b','c'].map(code=>({code,name:code}));
 for(const mode of ['equal','cap']) {const s=basketSeries(members,stocks,dates,mode);assert.equal(s.points[0].value,100);assert.equal(s.points[1].value,150);assert.equal(s.excluded[0].code,'c');}
});
test('public relay: allowlist and seven public fields, stale upstream is rejected',async()=>{
 const now=Date.now();const iso=new Date(now).toISOString();
 const input={asOf:iso,naver:{at:iso},feed:{active:false},secret:'secret',q:{a:[100,1,5,5,2,iso,'OPEN','naver','secret'],private:[1,2,3]}};
 const safe=publicQuotes(input,['a'],now);
 assert.deepEqual(Object.keys(safe.q),['a']);assert.equal(safe.q.a.length,7);assert.equal(safe.secret,undefined);
 assert.equal(publicQuotes({...input,asOf:new Date(now-31000).toISOString()},['a'],now),null);
 assert.equal(publicQuotes({...input,naver:{at:new Date(now-60000).toISOString()}},['a'],now),null);
 assert.equal(relayUrl('https://evil.example/live.json'),null);assert.ok(relayUrl('https://test.trycloudflare.com/live.json'));
 assert.equal(freshRelay({...safe,asOf:new Date(now-16000).toISOString()},now),false);
 const server=createQuoteRelay({getPayload:()=>input,ids:['a']});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try {const base=`http://127.0.0.1:${server.address().port}`;assert.equal((await fetch(base+'/health')).status,404);assert.equal((await fetch(base+'/data/financials.json')).status,404);const response=await fetch(base+'/live.json');assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'https://naiveinvestment.github.io');assert.equal((await response.json()).secret,undefined);} finally {await new Promise(r=>server.close(r));}
});
