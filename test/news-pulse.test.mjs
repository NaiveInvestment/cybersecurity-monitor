import test from "node:test";
import assert from "node:assert/strict";
import { newsPulse, damagePulse, incidentSeries } from "../public/lib/news-pulse.js";

const end = Date.parse("2026-11-28T06:25:00Z");
const day = 86400000;
const article = (age, r = "KR", c = "incident") => ({ t: "인터넷우체국 해킹으로 개인정보 유출", d: new Date(end - age).toISOString(), r, c });

test("rolling comparisons share one boundary and exclude later, older and other-region stories", () => {
  const rows = [article(0), article(day, "KR", "policy"), article(7*day-1), article(7*day),
    article(14*day-1), article(14*day), article(-1), article(0, "GL")];
  const result = newsPulse(rows, "KR", end);
  assert.deepEqual(result.bins.map(bin => bin.count), [1,0,0,0,0,0,1,1,0,0,0,0,1,1]);
  assert.equal(result.current.count, 3);
  assert.equal(result.current.share, 100*2/3);
  assert.equal(result.previous.share, 100);
  assert.equal(newsPulse([], "KR", end).previous.share, null);
});

test("damage comparisons share the existing reference scale and distinguish missing, candidate and disclosed zero", () => {
  const file = {until:"2026-11-28", events:[
    { r:"KR", d:"2026-11-21", via:"리서치", rec:10000 },
    { r:"KR", d:"2026-11-22", via:"자동 감지", rec:99999 },
    { r:"GL", d:"2026-11-28", via:"리서치", usd:0 },
  ]};
  const [past,now] = damagePulse(file,"KR",end);
  assert.deepEqual([past.start,past.end,now.start,now.end],["2026-11-15","2026-11-21","2026-11-22","2026-11-28"]);
  assert.equal(past.value,50);
  assert.equal(now.value,null);
  assert.equal(damagePulse(file,"GL",end)[1].value,0);
  assert.equal(damagePulse({ ...file, until:"2026-11-27" },"GL",end)[1].value,null);
});

test("a feed category alone is insufficient evidence of an incident report", () => {
  const rows = [article(0), { ...article(0), t:"Binance wins preliminary approval for a regional hub" }];
  assert.equal(newsPulse(rows,"KR",end).current.share,50);
});

test("overseas coverage of the same Korean postal breach joins the domestic timeline", async () => {
  const { majorFlows } = await import("../public/news-dashboard.js");
  const row = { via:"자동 감지", rec:113000, d:"2026-11-27" };
  const events = [
    { ...row, r:"KR", n:"인터넷우체국", src:[{u:"https://kr.example", t:"인터넷우체국 개인정보 유출"}] },
    { ...row, r:"GL", n:"Post", d:"2026-11-28", src:[{u:"https://gl.example", t:"Korea Post confirms data breach"}] },
  ];
  events.push({ ...row, r:"KR", n:"해킹이", rec:110000, src:[{u:"https://other.example", t:"해킹이 일상이 된 나라…우체국마저 뚫렸다, 하루치만 11만명 정보 유출"}] });
  const rows = majorFlows(events,"2026-11-01","2026-11-28");
  assert.equal(rows.length,1);
  assert.equal(rows[0].event.r,"KR");
  assert.equal(rows[0].sources.length,3);
  for (const region of ["GL","KR"]) {
    const foreign = { ...row, r:region, n:"일본우체국", src:[{u:"https://jp.example", t:"일본 우체국에서 11만 명 개인정보 유출"}] };
    const withForeign = majorFlows([...events, foreign],"2026-11-01","2026-11-28");
    assert.equal(withForeign.length,2);
    assert.equal(withForeign.find(x => x.event.n==="일본우체국").event.r,region);
  }
  events[1].rec = 140000;
  assert.equal(majorFlows(events,"2026-11-01","2026-11-28").length,2);
});

test("live wire routes current alerts by publisher, filters searches and suppresses archived and expired URLs", async () => {
  const { regionalAlerts, wireIndex } = await import("../public/lib/news-wire.js");
  const index = wireIndex([{ s:"연합뉴스",r:"KR",u:"https://a.kr/exists" }]);
  const state = {region:"KR",category:"all",query:""};
  const item = { source:"연합뉴스",url:"https://a.kr/new",title:"정보보호 정책 개정안",detectedAt:new Date(end).toISOString() };
  const foreign = { ...item, source:"NHK",url:"https://news.web.nhk/one",title:"유출 가능성 조사" };
  const rows = [item,foreign,{ ...item,url:"https://a.kr/exists" },{ ...item,url:"https://a.kr/old",detectedAt:new Date(end-46*60000).toISOString() }];
  assert.deepEqual(regionalAlerts(rows,index,state,end),[item]);
  assert.deepEqual(regionalAlerts(rows,index,{...state,region:"GL"},end),[foreign]);
  assert.deepEqual(regionalAlerts(rows,index,{...state,category:"policy",query:"개정"},end),[item]);
  assert.deepEqual(regionalAlerts(rows,index,{...state,category:"incident"},end),[]);
});


test("global trends add exposures before index normalization and preserve coverage gaps", () => {
  const records = [
    {r:"KR", d:"2026-11-19", rec:1000, via:"리서치"},
    {r:"GL", d:"2026-11-18", usd:1000000, via:"리서치"},
    {r:"GL", d:"2026-11-26", rec:1000, usd:0, via:"리서치"},
    {r:"KR", d:"2026-11-27", rec:500000, via:"자동 감지"},
  ];
  const file = {events:records, since:"2026-11-15", until:"2026-11-28"};
  const series = incidentSeries(file, "ALL", end);
  assert.equal(series.length,13);
  assert.deepEqual(series.slice(0,-2).map(x=>x.count),Array(11).fill(null));
  assert.deepEqual(series.slice(-2).map(x=>[x.count,x.value]),[[2,100],[1,50]]);
  assert.deepEqual(newsPulse([article(0),article(5,"GL"),article(7*day,"GL")],"ALL",end).current.count,2);
});

test("24-hour stream uses the wall clock, dates and URLs across publishers and live detections", async () => {
  const {newsDay} = await import("../public/lib/news-briefing.js");
  const {wireIndex} = await import("../public/lib/news-wire.js");
  const items = [article(day-1),article(25,"GL","policy"),article(day),article(-1)]
    .map((item,i)=>({...item,u:"https://paper.example/"+i,s:"paper"+i}));
  const live = (age, suffix, extra = {}) => ({title:"Live report", source:"New source",
    url:"https://live.example/"+suffix, detectedAt:new Date(end-age).toISOString(), ...extra});
  const alerts = [live(0,"now"),live(10,"dup",{url:items[1].u}), live(0,"old",{first:new Date(end-day).toISOString()}),
    live(-1,"future"),live(46*60000,"expired"),live(2,"now")];
  const dayRows = newsDay(items,alerts,wireIndex(items),end);
  assert.deepEqual(dayRows.map(x=>x.item.u),[alerts[0].url,items[1].u,items[0].u]);
  assert.deepEqual(dayRows.map(x=>x.region),[null,"GL","KR"]);
  assert.deepEqual(newsDay(items,[],wireIndex(items),end+2*day),[]);
});

test("policy issue matches its representative source and falls back to a dated primary document", async () => {
  const {materialPolicy} = await import("../public/lib/news-briefing.js");
  const base = {...article(10,"KR","policy"), g:"decision", s:"매체 A", t:"[속보] 개인정보 보호법 개정안 통과", u:"https://one.example/a"};
  const lead = {...base,s:"매체 B",d:new Date(end-5000).toISOString(),t:"개인정보 보호법 개정안 통과",u:"https://two.example/b"};
  const issue = materialPolicy([base,lead],[],end);
  assert.equal(issue.title,lead.t);
  assert.equal(issue.url,lead.u);
  assert.equal(issue.entries.length,2);
  const card = {date:"2026-11-09", category:"policy",region:"GL",title:"공식 시행 결정",
    sources:[{kind:"official",name:"규제기관",url:"https://official.example/rule"}]};
  const fallback = materialPolicy([{...base,t:"개인정보 보호법 개정 촉구"}],[card],end);
  assert.equal(fallback.url,card.sources[0].url);
  assert.equal(materialPolicy([], [{...card,date:"2026-10-01"}],end),undefined);
});
