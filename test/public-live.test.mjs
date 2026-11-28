import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {financialRow,annualValuation} from '../public/lib/financials.js';
import {basketSeries,liveSectorComparison} from '../public/lib/sector-index.js';
import { LocalLive } from '../src/live-local.mjs';
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
test('local 1D uses the current session, previous-close weights and both live indices', () => {
  const date = '2026-11-20', prior = '2026-11-19';
  const at = `${date}T01:30:00.000Z`, now = Date.parse(at);
  const members = ['a', 'b', 'stale', 'new'].map(code => ({ code, name: code }));
  const history = [{ date: prior, close: 100 }, { date, close: 95 }];
  const benchmarks = ['KOSPI', 'KOSDAQ'].map(id => ({ id, history }));
  const data = {
    groups: [{ id: 'security', stocks: members }],
    stocks: { a: { history }, b: { history }, stale: { history }, new: { history: history.slice(-1) } },
    benchmarks,
  };
  const snapshot = {
    quotes: {
      a: { p: 110, previousClose: 100, cap: 220, at },
      b: { p: 90, previousClose: 100, cap: 90, at },
      stale: { p: 99, previousClose: 90, cap: 100, at: `${prior}T06:30:00.000Z` },
      new: { p: 150, previousClose: 100, cap: 100, at },
    },
    indices: {
      KOSPI: { p: 102, previousClose: 100, at, st: 'OPEN' },
      KOSDAQ: { p: 97, previousClose: 100, at, st: 'OPEN' },
    },
  };
  const equal = liveSectorComparison(data, snapshot, 'equal', now);
  assert.deepEqual(equal.dates, ['직전 종가', date]);
  assert.deepEqual(equal.series.map(s => s.points.at(-1).value), [100, 102, 97]);
  assert.deepEqual(equal.series[0].excluded.map(s => s.code), ['stale', 'new']);
  const cap = liveSectorComparison(data, snapshot, 'cap', now);
  assert.ok(Math.abs(cap.series[0].points[1].value - 103.3333333333) < 1e-8);
  assert.equal(liveSectorComparison(data, snapshot, 'equal', now + 121000), null);
  assert.equal(liveSectorComparison(data, { ...snapshot, indices: { KOSPI: snapshot.indices.KOSPI } }, 'equal', now), null);
  const closed = Object.fromEntries(Object.entries(snapshot.indices).map(([id, index]) => [id, { ...index, st: 'CLOSE' }]));
  assert.equal(liveSectorComparison(data, { ...snapshot, indices: closed }, 'equal', now + 86400000).open, false);
  const expanded = { ...data, groups: [...data.groups, { id: "robot", supplement: { count: 1 }, stocks: [members[0], members[1]] }] };
  const partial = { ...snapshot, indices: closed, quotes: { ...snapshot.quotes } };
  delete partial.quotes.b;
  assert.equal(liveSectorComparison(expanded, partial, "cap", now), null);
  assert.equal(liveSectorComparison(expanded, { ...snapshot, indices: closed }, "cap", now).series[1].included.length, 2);
});

test('local quote waits for a same-session previous close before applying a Kiwoom tick', () => {
  const now = Date.parse('2026-11-20T01:30:05Z');
  const live = new LocalLive({ universe: { stocks: [{ id: 'a', code: 'a', kind: 'KR' }] } });
  live.feed = { status: 'connected', lastAt: '2026-11-20T01:30:04Z' };
  live.ticks.a = { p: 102, at: '2026-11-20T01:30:04Z' };
  live.base.a = { p: 101, previousClose: 100, chg: 1, at: '2026-11-19T06:30:00Z' };
  assert.equal(live.domesticQuote('a', now).src, 'naver');
  live.base.a.at = '2026-11-20T01:30:00Z';
  const tick = live.domesticQuote('a', now);
  assert.equal(tick.src, 'kiwoom');
  assert.equal(tick.previousClose, 100);
  assert.equal(tick.chg, 2);
});
test('public relay: allowlist and seven public fields, stale upstream is rejected',async()=>{
 const now=Date.now();const iso=new Date(now).toISOString();
 const input={asOf:iso,naver:{at:iso},feed:{active:false},secret:'secret',q:{a:[100,1,5,5,2,iso,'OPEN','naver','secret'],private:[1,2,3]}};
 const safe=publicQuotes(input,['a'],now);
 assert.deepEqual(Object.keys(safe.q),['a']);assert.equal(safe.q.a.length,7);assert.equal(safe.secret,undefined);
 assert.deepEqual(safe.quoteSources,{a:'naver'});
 assert.deepEqual(publicQuotes({...input,q:{a:[...input.q.a.slice(0,7),'private']}},['a'],now).quoteSources,{});
 assert.equal(publicQuotes({...input,asOf:new Date(now-31000).toISOString()},['a'],now),null);
 assert.equal(publicQuotes({...input,naver:{at:new Date(now-60000).toISOString()}},['a'],now),null);
 assert.equal(relayUrl('https://evil.example/live.json'),null);assert.ok(relayUrl('https://test.trycloudflare.com/live.json'));
 assert.equal(freshRelay({...safe,asOf:new Date(now-16000).toISOString()},now),false);
 const server=createQuoteRelay({getPayload:()=>input,ids:['a']});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try {const base=`http://127.0.0.1:${server.address().port}`;assert.equal((await fetch(base+'/health')).status,404);assert.equal((await fetch(base+'/data/financials.json')).status,404);const response=await fetch(base+'/live.json');assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'https://naiveinvestment.github.io');assert.equal((await response.json()).secret,undefined);} finally {await new Promise(r=>server.close(r));}
});

test('public relay exposes comparison data only on request and only for approved codes', async () => {
  const at = new Date().toISOString();
  const input = { asOf: at, naver: { at }, q: { a: [100, 1, 5, 5, 2, at, 'OPEN'] } };
  const listed = { p: 110, previousClose: 100, cap: 22, at, st: 'OPEN', src: 'kiwoom', private: 'excluded' };
  const sector = {
    quotes: { a: listed, b: listed, private: listed },
    indices: { KOSPI: listed, KOSDAQ: listed, IXIC: listed },
    private: 'excluded',
  };
  const server = createQuoteRelay({ getPayload: () => input, ids: ['a'], getSector: () => sector, sectorCodes: ['a', 'b'] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = 'http://127.0.0.1:' + server.address().port;
    assert.equal((await (await fetch(url + '/live.json')).json()).sector, undefined);
    const expanded = await fetch(url + '/live.json?sector=1');
    assert.equal(expanded.headers.get('access-control-allow-origin'), 'https://naiveinvestment.github.io');
    const payload = await expanded.json();
    assert.deepEqual(Object.keys(payload.sector.quotes), ['a', 'b']);
    assert.deepEqual(Object.keys(payload.sector.indices), ['KOSPI', 'KOSDAQ']);
    assert.equal(payload.sector.quotes.a.previousClose, 100);
    assert.equal(payload.sector.quotes.a.src, 'kiwoom');
    assert.equal(payload.sector.quotes.a.private, undefined);
    assert.equal(payload.sector.private, undefined);
    assert.equal((await fetch(url + '/sector-live.json')).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
