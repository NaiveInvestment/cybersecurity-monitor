import test from "node:test";
import assert from "node:assert/strict";
import {casePress} from "../public/lib/case-press.js";
import {mergeLibrary,articleUrlKey} from "../public/lib/news-library.js";
import {archiveArticles,buildSearchArchive} from "../src/news-archive.mjs";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const end=Date.parse("2026-11-28T12:00:00Z"), day=86400000;
const news=(s,t,u,age=1)=>({s,t,u,d:new Date(end-age).toISOString()});
test("one article across feeds, distinct outlets and an outlet's own follow-up",()=>{
  const a=news("The Record","SAP confirms intrusion","https://therecord.media/sap");
  const rows=[a,{...a,u:a.u+"?utm_source=x"},news("The Record from Recorded Future News",a.t,"https://news.google.com/rss/articles/abc"),
    {...a,u:a.u.replace("https:","http:")},news("Another News",a.t,"https://example.org/reprint"),news(a.s,"SAP confirms new impact","https://therecord.media/sap-update")];
  for(const sources of [rows,[...rows].reverse()]){
    const result=casePress({sources},end);
    assert.equal(result.articles.length,3);
    assert.equal(result.outlets,2);
    assert.ok(result.articles.some(item=>articleUrlKey(item.u)===articleUrlKey(a.u)));
  }
});

test("only published reports in the half-open trailing day; updates, undated hours and Telegram do not qualify",()=>{
  const source=news("Example","Initial","https://example.org/original",day);
  const updated={...source,t:"Correction",d:new Date(end).toISOString(),dateKind:"updated"};
  const valid=news("Other","At boundary","https://example.org/valid",0);
  const atStart=news("Other","Just inside","https://example.org/inside",day-1);
  for (const pair of [[source,updated],[updated,source]]) {
    const sources=[...mergeLibrary(pair),valid,atStart,{...valid,u:"https://example.org/day",dayPrecision:true},
      {...valid,u:"https://example.org/unknown",dayPrecision:true,firstPublishedAt:"2026-11-28"},news("Other","Future","https://example.org/future",-1),{...valid,u:"https://t.me/example/12"},
      {...valid,u:"https://example.org/date-only",d:"2026-11-28"}];
    assert.deepEqual(casePress({sources},end).articles.map(a=>a.u),[valid.u,atStart.u]);
    assert.equal(casePress({sources:[]},end).outlets,0);
  }
});

test("a curated publication overrides portal timing across the 24-hour boundary",()=>{
  const original=news("한겨레","우체국 유출","https://www.hani.co.kr/arti/x",day+50);
  const wrapper=news(original.s,original.t,"https://news.google.com/rss/articles/other");
  const row={pressTitle:original.t,milestones:[["11.27","보도","",original.s,original.u,original.d]],sources:[wrapper]};
  assert.equal(casePress(row,end).articles.length,0);
  assert.equal(casePress({...row,sources:[]},end-day/2).articles[0].u,original.u);
});

test("same URL on an older archive day retains its first publication in the current snapshot",()=>{
  const dir=mkdtempSync(join(tmpdir(),"case-press-"));
  try {
    const output=join(dir,"public");mkdirSync(output);
    const original=news("Source","Breach","https://press.example/a",day+5000);
    archiveArticles(dir,[original],end);
    const current=[{...original,t:"Breach updated",d:new Date(end).toISOString()}];
    buildSearchArchive(dir,output,current,end);
    assert.equal(current[0].firstPublishedAt,original.d);
    assert.equal(casePress({sources:current},end).articles.length,0);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
