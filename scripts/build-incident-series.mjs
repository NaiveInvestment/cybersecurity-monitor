import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/universe.mjs";
import { impactNotes } from "../public/lib/impact-notes.js";
import { researchKrw } from "../src/incident-events.mjs";

const read = file => JSON.parse(readFileSync(file,"utf8"));
const dir = process.argv[2];
const research = read(join(ROOT,"data/incidents/research.json")).incidents;
const editions = read(join(ROOT,"data/incidents/trend-editions.json"));
const feed = read(join(dir,"incident-events.json"));
const text = s => (s || "").replace(/[\u00b7\u2027\u30fb]/g,", ").trim();
const hash = s => createHash("sha256").update(s).digest("hex").slice(0,16);
const number = n => n.toLocaleString("ko-KR");
const unsupported = new Set(["한국전력공사|2026-10-04","외교부|2026-11-02","조달청|2026-11-10","행정안전부(정보공개포털)|2026-11-05","SIMBA|2026-09-25","서울사이버대학교|2026-10-05","State Bank of India|2026-10-19"]);
const noteGrade = {
  "sap-dev-202611":[3,"기업용 소프트웨어 공급자의 개발 환경 침해 보도"],
  "cloud-one-202611":[3,"군 공용 클라우드 침해 보도"],
  "post-202611":[3,"하루치 확인 규모 10만 명 이상"],
  "fsi-202611":[3,"금융회사 상시평가 시스템 침해"],
  "danawa-202611":[3,"대외 서비스 다일 중단"]
};
// Source timelines explicitly describe customer-facing interruptions across multiple days.
const sustainedOutages = new Map([
  ["佐川急便 (Sagawa Express)|2026-09-30","배송 조회와 접수 서비스 중단, 9월 30일부터 10월 23일 이후까지"],
  ["ヤマト運輸 (Yamato Transport)|2026-09-29","후불 결제 서비스 중단, 9월 28일부터 10월 9일까지"],
  ["미래에셋생명|2026-10-26","대외 홈페이지 나흘째 중단"]
]);
function researchEvent(x) {
  if (unsupported.has(x.name+"|"+x.date) || x.name === "금융보안원" && x.date==="2026-11-10") return null;
  const links=x.sources.filter(s=>/^https?:\/\//.test(s.url));
  if (!links.length) return null;
  const evidence=[];
  const add=(grade, reason)=>evidence.push({grade,reason});
  const claim=x.size_basis==="해커 주장";
  const amount=x.records && ["명","계정","건"].includes(x.records_unit) ? number(x.records)+x.records_unit : "";
  const attack=text(x.attack);
  const scope=text(x.loss_or_outage);
  const resolvedCounts = ["오케이저축은행","Ymirlink"];
  const possible = !resolvedCounts.includes(x.name) && /가능성|최대|미확정/.test([x.attack,x.amount_note].join(" "));
  const reportedSize = !possible && !claim && !/가능성|추정치|상한/.test(x.size_basis || "") && amount;
  if (reportedSize) add(x.records>=1e6?4:x.records>=1e5?3:2,reportedSize+" "+(x.size_basis || "보도"));
  const krw=researchKrw(x);
  if (!claim && (x.usd>0 || krw>0)) {
    const dollars=x.usd || krw/1400;
    const money=x.usd ? number(x.usd)+"달러" : number(krw)+"원";
    add(dollars>=1e8?4:dollars>=1e6?3:2,"금전 피해 "+money);
  }
  if (/국가기관|통신사/.test(x.org_type)) add(3,text(x.org_type)+" 침해");
  if (/상장 대기업|금융회사|가상자산 거래소/.test(x.org_type)) add(2,text(x.org_type)+" 침해");
  if (x.name==="Brevo" && x.date==="2026-09-15" || x.name==="Digitaliseringsdirektoratet (Digdir)") add(4,text(x.spread) || attack);
  if (scope && /중단|차질|정지|오프라인|폐쇄|제한/.test(scope) && !/중단.{0,6}(없|않)|중단되지/.test(scope)) add(/글로벌 업무|생산|다수 브랜드/.test(scope)?3:2,scope);
  if (/유출|탈취|무단 접근|자료 반출/.test(attack) && !/가능성|의심|의혹|주장|정황/.test(attack)) add(2,attack);
  const sustained=sustainedOutages.get(x.name+"|"+x.date);
  if (sustained) add(3,sustained);
  const sensitive=text(x.sensitive);
  const exposedSensitive = !claim && !possible && sensitive.split(/[,，]/).some(part=>!/부분|앞.{0,2}자리|암호화|마스킹|가능성|주장|조사|의심|끝.{0,2}자리/.test(part) && /주민등록번호|여권|\bSSN\b|평문.{0,3}비밀번호|카드번호/.test(part));
  if (exposedSensitive) add(3,"고위험 식별정보 또는 결제정보 노출");
  const best=evidence.sort((a,b)=>b.grade-a.grade)[0] || {grade:0,reason:"공개된 피해 정보로 등급 미정"};
  const detail=[attack,amount && (claim?"공격자 주장 ":possible?"가능 규모 ":"")+amount,sensitive,scope].filter(Boolean).join(" / ");
  return {id:"research-"+hash(x.name+"|"+x.date),date:x.date,name:text(x.name),impact:detail, ...best,
    url:(links.find(s=>s.date===x.date) || links[0]).url, sources:links.map(s=>({name:text(s.outlet),url:s.url}))};
}
const events=research.map(researchEvent).filter(Boolean);
for (const x of impactNotes) {
  const [grade,reason]=noteGrade[x.id] || [0,"세부 피해 등급 검토 전"];
  const firstDay=x.id==="sap-dev-202611"?"2026-11-26":x.first;
  events.push({id:x.id,date:firstDay,name:x.name,grade,reason,impact:x.impact,url:x.milestones.at(-1)[4],aliases:editions.aliases[x.id] || []});
}
events.push(...editions.events);
for (const x of feed.events.filter(e=>e.via==="DeFiLlama" && e.usd>0)) {
  // The feed already resolves research overlaps. Match the same victim and date as well on older snapshots.
  if (events.some(e=>e.name.toLowerCase()===x.n.toLowerCase() && e.date.slice(0,10)===x.d)) continue;
  events.push({id:x.id,date:x.d,name:x.n,grade:x.usd>=1e8?4:x.usd>=1e6?3:2,
    reason:"집계 피해액 "+number(x.usd)+"달러",impact:"가상자산 피해, DeFiLlama 집계",url:x.src[0].u});
}
if (new Set(events.map(e=>e.id)).size!==events.length || events.some(e=>!/^https?:\/\//.test(e.url) || !Number.isInteger(e.grade))) throw Error("Invalid incident series");
writeFileSync(join(dir,"incident-series.json"), JSON.stringify({asOf:new Date().toISOString(),events}));
