import test from "node:test";
import assert from "node:assert/strict";
import { newsPulse, damagePulse } from "../public/lib/news-pulse.js";

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
  const rows = majorFlows(events,"2026-11-01","2026-11-28");
  assert.equal(rows.length,1);
  assert.equal(rows[0].event.r,"KR");
  assert.equal(rows[0].sources.length,2);
  events[1].rec = 140000;
  assert.equal(majorFlows(events,"2026-11-01","2026-11-28").length,2);
});
