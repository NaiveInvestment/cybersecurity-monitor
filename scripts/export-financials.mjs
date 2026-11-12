import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { loadUniverse, ROOT } from "../src/universe.mjs";
import { join } from "node:path";
import { pushOrphan } from "../src/git-orphan.mjs";
const snap = await (await fetch("http://127.0.0.1:8848/api/snapshot", {signal: AbortSignal.timeout(10000)})).json();
const keys = ["period","kind","provisional","basis","source","baseDate","revenue","operatingIncome","parentNetIncome","parentEquity","unit","contributors"];
const clean = row => {
  const out = Object.fromEntries(keys.filter(k => row[k] != null).map(k => [k,row[k]]));
  if (row.filing?.url && /^https:\/\/dart.fss.or.kr\//.test(row.filing.url)) out.filing = {url:row.filing.url};
  if (row.horizons) out.horizons = Object.fromEntries(["oneMonth","threeMonth","highest"].map(k=>[k,row.horizons[k] ? Object.fromEntries(keys.filter(f=>row.horizons[k][f]!=null).map(f=>[f,row.horizons[k][f]])) : null]));
  return out;
};
const stocks = loadUniverse().stocks.filter(s=>s.kind==="KR").map(s=> {
  const source = snap.stocks.find(x=>x.code===s.code);
  if (!source) throw new Error(`재무 코드 누락 ${s.code}`);
  return { code:s.code, id:s.id, name:s.name, annual:Object.fromEntries(Object.entries(source.annual||{}).map(([k,v])=>[k,clean(v)])), quarter:Object.fromEntries(Object.entries(source.quarter||{}).map(([k,v])=>[k,clean(v)])) };
});
const baseDates = stocks.flatMap(s=>Object.values(s.annual)).map(r=>r.baseDate).filter(Boolean).sort();
const result = {exportedAt:new Date().toISOString(),workbookBaseDate:baseDates.at(-1),unit:"억원",sources:["OpenDART","ConsenDB 3개월 평균"],stocks};
const args=process.argv.slice(2);
const out=args.includes('--out')?args[args.indexOf('--out')+1]:join(ROOT,"data","financials.json");
let changed=true;
if(existsSync(out)){const previous=JSON.parse(readFileSync(out,'utf8'));previous.exportedAt=result.exportedAt;changed=JSON.stringify(previous)!==JSON.stringify(result);}
if(changed) {
  if(args.includes('--publish')) {
    const pending=out+'.pending';writeFileSync(pending,JSON.stringify(result));
    pushOrphan('financials',[{path:pending,name:'financials.json'}],'Refresh domestic financials');
  }
  writeFileSync(out,JSON.stringify(result));
}
console.log(`재무 ${stocks.length}종목, ConsenDB 기준일 ${result.workbookBaseDate}`);
