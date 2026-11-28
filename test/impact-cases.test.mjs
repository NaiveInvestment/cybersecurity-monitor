import test from "node:test";
import assert from "node:assert/strict";
import { buildImpactCases, impactWindows, responseReport } from "../public/lib/impact-cases.js";

const end=Date.parse("2026-11-28T10:00Z");
const day=86400000;
const article=(t,slug,age=0,props={})=>({t,u:"https://paper.test/"+slug,d:new Date(end-age).toISOString(),r:"GL",s:slug,c:"incident",...props});

test("source-reviewed platform reports retain attribution and distinguish clients from provider incidents",()=>{
  const rows=[
    article("SAP confirms security incident after suspicious GitHub activity","sap"),
    article("SAP flags security incident, says no evidence of customer data breach","reply"),
    article("SAP customer Acme discloses GitHub data breach","customer"),
    article("CISA warns of SAP NetWeaver vulnerability","advisory"),
    article("US Air Force cloud platform reportedly hacked","cloud"),
  ];
  const cases=buildImpactCases(null,rows,end);
  const sap=cases.find(c=>c.name==="SAP"),cloud=cases.find(c=>c.name.includes("Cloud One"));
  assert.deepEqual(sap.sources.map(s=>s.u),[rows[0].u,rows[1].u]);
  assert.equal(responseReport(sap).u,rows[1].u);
  assert.equal(cases.find(c=>c.name==="Acme").role,"고객사 침해 관련 보도");
  assert.match(sap.milestones.at(-1)[2],/고객 업무 데이터/);
  assert.deepEqual(cloud.sources.map(s=>s.u),[rows[4].u]);
  assert.match(cloud.milestones.at(-1)[2],/논평/);
});

test("denial stays visible without a confirmed event and repeat coverage counts once",()=>{
  const first=article("Atlas denies data breach","first",2*day);
  const reply=article("Atlas says no evidence of data breach","reply",day);
  const outside=article("Atlas denies data breach","future",-day);
  const spokes=article("Russia denies orchestrating cyberattack on Romanian institution","comment");
  const rows=buildImpactCases({events:[]},[first,reply,first,outside,spokes],end,[]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].name,"Atlas");
  assert.deepEqual(rows[0].sources.map(x=>x.u),[first.u,reply.u]);
  assert.equal(responseReport(rows[0]).u,reply.u);
});

test("claims from a new victim, qualified impact and a later legal ruling keep distinct meanings",()=>{
  const rows=[article("Acme investigates suspected cyberattack","claim",day),
    article("Acme says cyberattack had no material impact on operations","limited"),
    article("Acme pays settlement for 2023 data breach","ruling")];
  const cases=buildImpactCases(null,rows,end,[]);
  assert.equal(cases.length,1);
  assert.equal(responseReport(cases[0]).u,rows[1].u);
  assert.equal(cases[0].sources.length,2);
});

test("a shared episode never doubles a report and a supplier's customer incident alone does not add the supplier",()=>{
  const a=article("한국전력, 보안 사고로 서비스 중단","kepco",day,{r:"KR"});
  const caseFile={events:[{id:"kepco",n:"한국전력",r:"KR",d:a.d.slice(0,10),src:[{u:a.u}]}]};
  const related=article("한국전력공사, 보안 사고로 서비스 중단","second",0,{r:"KR"});
  const customer=article("SAP 고객사 해킹으로 GitHub 소스코드 유출","customer");
  const stock=article("한국전력, 해킹 이후 주가 급락","stock",0,{r:"KR"});
  const output=buildImpactCases(caseFile,[a,related,customer,stock],end,[]);
  assert.equal(output.length,1);
  assert.equal(output[0].types.includes("operations"),true);
});

test("168-hour windows are disjoint, expose missing dates and count an incident once across topics",()=>{
  const dated=[0,7*day,14*day,21*day,28*day,-1].map(age=>({first:end-age,types:["infra","technical"]}));
  const complete=Array.from({length:30},(_,i)=>article("sample","x"+i,i*day));
  const windows=impactWindows(dated,end,complete);
  assert.deepEqual(windows.map(w=>w.rows.length),[1,1,1,1]);
  assert.ok(windows.every(w=>w.missed.length===0));
  assert.ok(impactWindows(dated,end,[]).every(w=>w.missed.length>0));
});

test("financial records and money actually reported lost are distinct drill-down topics",()=>{
  const a=article("가람페이, 해킹으로 25억원 유출...금감원 조사 착수","money",day,{r:"KR"});
  const b=article("가람은행, 해킹으로 고객 계좌번호 유출","info",day,{r:"KR"});
  const events=[a,b].map((x,i)=>({id:x.s,n:i?"가람은행":"가람페이",r:"KR",d:x.d.slice(0,10),rec:60000,src:[{u:x.u}]}));
  const rows=buildImpactCases({events},[a,b],end,[]);
  assert.deepEqual(rows.find(x=>x.name==="가람페이").types,["loss"]);
  assert.ok(rows.find(x=>x.name==="가람은행").types.includes("financial"));
  assert.ok(!rows.find(x=>x.name==="가람은행").types.includes("loss"));
});
