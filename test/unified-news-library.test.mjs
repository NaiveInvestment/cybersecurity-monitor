import assert from "node:assert/strict";
import test from "node:test";
import {mergeLibrary,veryImportant,importanceMark} from "../public/lib/news-library.js";

const row={id:"first",t:"Example bank confirms customer leak",s:"Example News",d:"2026-11-27T08:00:00Z",u:"https://news.google.com/rss/articles/abc",r:"GL",c:"incident",k:[]};
test("same publisher and title keep one direct original and preserve editorial importance",()=>{
  const direct={...row,id:"direct",u:"https://example.com/original",important:true};
  const duplicate={...direct,id:"tracking",u:direct.u+"?utm_source=forward"};
  for(const list of [[row,direct,duplicate],[duplicate,row,direct]]) {
    const merged=mergeLibrary(list);
    assert.equal(merged.length,1);
    assert.ok(merged[0].u.includes("example.com"));
    assert.ok(importanceMark(merged[0]).includes("중요"));
  }
  assert.equal(mergeLibrary([row,{...row,t:"Independent new development",u:"https://example.com/update"}]).length,2);
});
test("priority is reserved for confirmed high impact",()=>{
  assert.equal(veryImportant({t:"11만명 개인정보 유출"}),false);
  assert.equal(veryImportant({confirmed:true,t:"11만명 개인정보 유출 확인"}),true);
  assert.equal(veryImportant({confirmed:true,t:"11만명 개인정보 유출 우려"}),false);
  assert.equal(veryImportant({confirmed:true,t:"11만명 유출 과징금 취소소송 1심 판결"}),false);
  assert.equal(importanceMark({t:"보안 솔루션 공급계약 체결"}),"");
});

test("a later correction replaces the original headline and can remove importance", () => {
  const initial = {...row,u:"https://publisher.net/story",important:true,tKo:"초기 피해 규모"};
  const revised = {...initial,d:"2026-11-28T09:00:00Z",t:"Publisher corrects incident scope",important:false};
  delete revised.tKo;
  for (const rows of [[initial,revised],[revised,initial]]) {
    const [result] = mergeLibrary(rows);
    assert.equal(result.t,revised.t);
    assert.equal(result.important,false);
    assert.equal(result.tKo,undefined);
  }
});

test("archived stock-movement reports stay out while security contracts stay searchable", () => {
  const quote = {...row,t:"[특징주] 안랩, 해킹 소식에 주가 9% 급등",u:"https://press.kr/1"};
  const contract = {...row,t:"안랩, 공공기관 보안 솔루션 공급계약 체결",u:"https://press.kr/2"};
  assert.deepEqual(mergeLibrary([quote,contract]),[contract]);
});
