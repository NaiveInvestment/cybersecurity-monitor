import test from "node:test";
import assert from "node:assert/strict";
import { currentMarketActivity } from "../public/lib/market-activity.js";
import { marketComposition } from "../public/lib/market-composition.js";

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

test("시총 구성의 종목은 마감일 평균으로 고정되고 날짜마다 기타 포함 합계가 맞는다", () => {
  const points = [
    { cap: 100, constituents: { A: 60, B: 40 } },
    { cap: 120, constituents: { A: 30, B: 70, C: 20 } },
    { cap: null, constituents: null },
    { cap: 300, constituents: { A: 80, B: 10, C: 210 }, live: true },
  ];
  assert.deepEqual(marketComposition(points, ["A", "B", "C"], 2), {
    groups: ["B", "A", "other"], amounts: [[40, 60, 0], [70, 30, 20], null, [10, 80, 210]],
  });
  assert.equal(marketComposition([{ cap: 100 }], ["A"]), null);
});
