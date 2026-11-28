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
