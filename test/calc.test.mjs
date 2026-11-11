import test from "node:test";
import assert from "node:assert/strict";
import { toNum, pct, shiftDate, baseClose, returnBases, normalizeQuote, financeMetrics, valuation, mean } from "../public/lib/calc.js";

test("toNum: 쉼표, 결측 표기", () => {
  assert.equal(toNum("1,234.5"), 1234.5);
  assert.equal(toNum("-"), null);
  assert.equal(toNum("N/A"), null);
  assert.equal(toNum(""), null);
  assert.equal(toNum(-3), -3);
});

test("pct: 기준가가 없거나 0 이하면 값을 만들지 않는다", () => {
  assert.equal(pct(110, 100).toFixed(4), "10.0000");
  assert.equal(pct(110, null), null);
  assert.equal(pct(110, 0), null);
});

test("shiftDate: 월말 보정과 연 이동", () => {
  assert.equal(shiftDate("2026-03-31", { months: -1 }), "2026-02-28");
  assert.equal(shiftDate("2026-01-15", { months: -3 }), "2025-10-15");
  assert.equal(shiftDate("2024-02-29", { years: 1 }), "2025-02-28");
  assert.equal(shiftDate("2026-11-11", { days: -7 }), "2026-11-04");
});

const history = [
  { date: "2025-11-10", close: 50 }, { date: "2025-12-30", close: 80 }, { date: "2026-08-11", close: 100 },
  { date: "2026-10-09", close: 120 }, { date: "2026-11-04", close: 90 }, { date: "2026-11-10", close: 95 }, { date: "2026-11-11", close: 99 },
];

test("baseClose: target 이하의 마지막 종가, 상장 전이면 null", () => {
  assert.equal(baseClose(history, "2026-10-11"), 120);
  assert.equal(baseClose(history, "2025-11-09"), null);
});

test("returnBases: 기간별 기준가와 52주 고점", () => {
  assert.deepEqual(returnBases(history, "2026-11-11"), { w1: 90, m1: 120, m3: 100, ytd: 80, y1: 50, hi52: 120 });
});

test("returnBases: 상장 1년 미만이면 1Y, YTD 기준가가 없다", () => {
  const bases = returnBases(history.slice(2), "2026-11-11");
  assert.equal(bases.y1, null);
  assert.equal(bases.ytd, null);
  assert.equal(bases.w1, 90);
});

test("normalizeQuote: 국내는 억원, 하락은 음수", () => {
  const quote = normalizeQuote("KR", {
    closePriceRaw: "121900", fluctuationsRatioRaw: "12.66", compareToPreviousPrice: { name: "FALLING" },
    marketValueFullRaw: "1356320000000", accumulatedTradingValueRaw: "72300000000", localTradedAt: "2026-11-11T10:30:00+09:00", marketStatus: "OPEN",
  });
  assert.deepEqual(quote, { p: 121900, chg: -12.66, cap: 13563.2, capKrw: 13563.2, tv: 723, at: "2026-11-11T10:30:00+09:00", st: "OPEN" });
});

test("normalizeQuote: 해외는 현지 통화 백만과 원화 억원을 함께", () => {
  const quote = normalizeQuote("GL", {
    closePriceRaw: "225.76", fluctuationsRatioRaw: "-1.23", compareToPreviousPrice: { name: "FALLING" },
    marketValueFullRaw: "231163529930", marketValueKrwRaw: "309504850000000", accumulatedTradingValueKrwRaw: "1867290000000",
  });
  assert.equal(quote.cap, 231163.5);
  assert.equal(quote.capKrw, 3095048.5);
  assert.equal(quote.tv, 18672.9);
  assert.equal(quote.chg, -1.23);
  assert.equal(normalizeQuote("GL", { closePriceRaw: "0" }), null);
});

const table = {
  periods: [
    { ym: "2025-06", consensus: false }, { ym: "2025-09", consensus: false }, { ym: "2025-12", consensus: false },
    { ym: "2026-03", consensus: false }, { ym: "2026-06", consensus: false }, { ym: "2026-09", consensus: true },
  ],
  rev: [623, 645, 836, 591, 713, 900], op: [35, 79, 209, 19, 54, 80], ni: [136, 136, 236, 51, 74, 90],
};

test("financeMetrics: 확정 분기만으로 최근 분기, YoY, TTM", () => {
  const metrics = financeMetrics(table);
  assert.equal(metrics.ym, "2026-06");
  assert.equal(metrics.rev, 713);
  assert.equal(metrics.yoy, 14.4);
  assert.equal(metrics.revTtm, 2785);
  assert.equal(metrics.opTtm, 361);
  assert.equal(metrics.niTtm, 497);
  assert.equal(metrics.opm, 13);
  assert.equal(metrics.spark.length, 5);
});

test("financeMetrics: 분기가 이어지지 않으면 TTM을 만들지 않는다", () => {
  const gap = { periods: table.periods.filter((_, i) => i !== 2), rev: [623, 645, 591, 713, 900], op: [35, 79, 19, 54, 80], ni: [1, 1, 1, 1, 1] };
  const metrics = financeMetrics(gap);
  assert.equal(metrics.revTtm, null);
  assert.equal(metrics.opm, null);
  assert.equal(metrics.yoy, 14.4);
});

test("financeMetrics: 매출이 전부 결측이면 null", () => {
  assert.equal(financeMetrics({ periods: table.periods, rev: Array(6).fill(null), op: [], ni: [] }), null);
});

test("valuation: 적자는 N/M, 결측은 null", () => {
  assert.deepEqual(valuation(13563.2, { revTtm: 2785, niTtm: 497 }), { psr: 4.87, per: 27.3 });
  assert.equal(valuation(1000, { revTtm: 500, niTtm: -10 }).per, "N/M");
  assert.equal(valuation(1000, { revTtm: 500, niTtm: null }).per, null);
  assert.deepEqual(valuation(null, { revTtm: 500, niTtm: 10 }), { psr: null, per: null });
});

test("mean: 결측 제외", () => {
  assert.equal(mean([1, null, 3]), 2);
  assert.equal(mean([null]), null);
});
