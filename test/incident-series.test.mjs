import test from "node:test";
import assert from "node:assert/strict";
import { eventSeries, publicTime, WEEK } from "../public/lib/incident-series.js";
import { reportedEdition } from "../public/lib/reported-impact.js";
const end=Date.parse("2026-11-28T13:00:00Z");
const iso=t=>new Date(t).toISOString();
const sample=(id,time,grade,label=id)=>({id,date:iso(time),grade,name:label,reason:"source",impact:label,url:"https://example.org/roundup"});

test("168시간 경계와 사건 식별, 평균의 결측값 처리",()=>{
  const a=sample("post",end-WEEK,3), b=sample("bank",end,2);
  a.aliases=["second-edition-id"];
  const later=sample("second-edition-id",end-1000,3);
  const data=eventSeries([a,b,sample("unknown",end,0),sample("bank-wallet",end,4,"bank")],[later],end);
  assert.deepEqual(data.at(-2).events.map(e=>e.id),["post"]);
  assert.equal(data.at(-1).events.length,3);
  assert.equal(data.at(-1).assessed,2);
  assert.equal(data.at(-1).mean,3);
  assert.equal(data[0].available,false);
  assert.equal(data.filter(w=>w.partial).length,1);
  assert.equal(publicTime("2026-11-28"),Date.parse("2026-11-27T15:00Z"));
});

test("후속 피해 재평가와 하향 정정은 첫 공개 주에 반영",()=>{
  const first=sample("e",end-WEEK,2);
  const update=sample("e",end-3000,4);
  const correction={...sample("e",end-1000,2),impact:"유출 규모 정정"};
  const data=eventSeries([first],[correction,update],end);
  assert.equal(data.at(-2).mean,2);
  assert.equal(data.at(-1).events.length,0);
});

test("피해 미확인과 공격자 규모 주장은 최고 강도로 처리하지 않는다",()=>{
  for(const title of ["이메일 최대 166만 건 유출 가능성","공격자 주장, 회원 200만 명 유출"]) {
    assert.equal(reportedEdition({title}).grade,0);
  }
  assert.equal(reportedEdition({title:"군 공용 클라우드 침해, 규모 미공개"}).grade,3);
  assert.equal(reportedEdition({title:"고객 120만 명 개인정보 유출 확인"}).grade,4);
  assert.equal(reportedEdition({title:"공식 홈페이지 변조"}).grade,1);
});

test("피해 인원과 회원 모집단, 금전 탈취와 사후 회수액을 구별",()=>{
  const grade=title=>reportedEdition({title}).grade;
  assert.equal(grade("회원 11만명 넘는 대한치과위생사협회, 개인정보 유출"),2);
  assert.equal(grade("바이낸스 해킹 탈취 자산 27억 달러 이상 동결, 12억 달러 이상 압류"),0);
  assert.equal(grade("프랑스 국세청 납세자 67만8천명 개인정보 유출"),3);
  assert.equal(grade("거래소 25억원 탈취 확인"),3);
  assert.equal(grade("고객 계좌 잔액 27억 원 노출"),0);
});
