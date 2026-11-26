import test from "node:test";
import assert from "node:assert/strict";
import { currentMarketActivity } from "../public/lib/market-activity.js";

test("당일 합산 시총과 거래대금은 같은 한국 날짜의 국내 시세만 사용한다", () => {
  const now = new Date("2026-11-25T03:40:00Z");
  const stocks = [
    { kind: "KR", code: "A", q: { cap: 110, capKrw: 100, tv: 3, at: "2026-11-25T03:39:00Z" } },
    { kind: "KR", code: "B", q: { cap: 20, tv: 0, at: "2026-11-24T23:30:00Z" } },
    { kind: "GL", code: "C", q: { cap: 2000, tv: 800, at: "2026-11-25T03:35:00Z" } },
  ];
  assert.deepEqual(currentMarketActivity(stocks, now), {
    date: "2026-11-25", cap: 120, turnover: 3, listed: 2, live: true,
    constituents: { A: 100, B: 20 }, time: "2026-11-24T23:30:00.000Z",
  });
  stocks[1].q.tv = null;
  assert.equal(currentMarketActivity(stocks, now).cap, 120);
  assert.equal(currentMarketActivity(stocks, now).turnover, null);
  stocks[1].q.at = "2026-11-24T06:30:00Z";
  assert.equal(currentMarketActivity(stocks, now), null);
});
