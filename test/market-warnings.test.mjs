import assert from "node:assert/strict";
import test from "node:test";
import { addDays, intradayPriceBases, lastClosedDate, officialForStock, parseKindWarningPage, priceChecks } from "../src/market-warnings.mjs";
import { kosdaqPriceLevel, marketWarningBadge, shortHeatView, warningPriceView } from "../public/lib/market-warnings.js";
import { parseRegularBars, shortHeatMetrics } from "../src/short-heat.mjs";

const today = "2026-11-27";
const now = Date.parse(today + "T14:00:00+09:00");
const dates = Array.from({ length: 16 }, (_, i) => addDays(today, i - 15));
const check = (data, id) => data.checks.find(item => item.id === id);
const stock = { code: "053800", name: "안랩" };
const row = (level, effective, released = null, name = stock.name, reason = null) => ({
  code: "05380", name, level, effective, announced: addDays(effective, -1), released, reason,
});

test("reads KIND exact row count and distinguishes an empty list from a broken response", () => {
  const table = (rows, count, page = 1) => `<tbody>${rows}</tbody>전체 <em>${count}</em>건 : <strong>${page}</strong>/1`;
  const markup = `<tr><td>1</td><td><a onclick="companysummary_open('05380')">안랩</a></td>
    <td>투자경고 지정예고</td><td>2026-11-26</td><td>2026-11-27</td></tr>`;
  assert.deepEqual(parseKindWarningPage(table(markup, 1), "attention", 1).rows,
    [row("attention", today, null, stock.name, "투자경고 지정예고")]);
  assert.equal(parseKindWarningPage(table("<tr><td>조회된 결과값이 없습니다.</td></tr>", 0), "danger", 1).rows.length, 0);
  assert.throws(() => parseKindWarningPage(table(markup, 2), "attention", 1), /건수/);
  assert.throws(() => parseKindWarningPage("<html>차단</html>", "warning", 1), /형식/);
});

test("official designations are effective-dated and exclude preferred shares and released warnings", () => {
  const caution = row("attention", today, null, stock.name, "투자경고 지정예고");
  const future = row("warning", "2026-11-30");
  const official = officialForStock(stock, {
    attention: { rows: [caution, row("attention", today, null, "안랩우")] },
    warning: { rows: [future, row("warning", "2026-11-20", today)] }, danger: { rows: [] },
  }, today, dates);
  assert.deepEqual(official.active, [caution]);
  assert.deepEqual(official.upcoming, [future]);
  assert.deepEqual(official.attentionHistory, [caution]);
  assert.equal(official.complete, true);
  assert.equal(officialForStock(stock, { attention: { rows: [] } }, today, []).attentionHistory, null);
  const partial = officialForStock(stock, { attention: { rows: [] }, warning: { rows: [] } }, today, dates);
  assert.equal(partial.complete, false);
  const feed = { officialDate: today, checkedAt: new Date(now).toISOString(), stocks: { [stock.code]: { official } } };
  assert.equal(marketWarningBadge(feed, stock.code, now).label, "경고 예고");
  assert.equal(marketWarningBadge(feed, stock.code, now + 24 * 3600000).label, "확인 대기");
});

test("close selection, windows, equality and 15-day index multiplier", () => {
  assert.equal(lastClosedDate(now, { st: "CLOSE", at: new Date(now).toISOString() }), "2026-11-26");
  const evening = Date.parse(today + "T16:00:00+09:00");
  assert.equal(lastClosedDate(evening, { st: "OPEN", at: new Date(evening).toISOString() }), "2026-11-26");
  assert.equal(lastClosedDate(evening, { st: "CLOSE", at: new Date(evening).toISOString() }), today);
  const prices = dates.map((date, i) => ({ date, close: i === 15 ? 160 : i === 0 ? 80 : 100 }));
  const benchmark = dates.map((date, i) => ({ date, close: i === 15 ? 125 : 100 }));
  const checks = priceChecks(prices, benchmark, today);
  assert.equal(check(checks, "short").result, 60);
  assert.equal(check(checks, "short").pricePass, true);
  assert.equal(check(checks, "short").indexPass, false);
  assert.equal(check(checks, "medium").pricePass, true);
  assert.equal(check(checks, "medium").indexPass, true);
  assert.equal(checks.high15, 160);
  const missing = priceChecks(prices.filter(item => item.date !== dates[14]), benchmark, today);
  assert.equal(check(missing, "short").result, null);
  assert.equal(missing.high15, null);
});

test("annual excess subtracts the same-date market return", () => {
  const current = { date: "2024-02-29", close: 300 };
  const earlier = { date: "2023-02-28", close: 100 };
  const next = { date: "2023-03-01", close: 300 };
  const benchmark = [earlier, next, { ...current, close: 90 }];
  const result = priceChecks([earlier, next, current], benchmark, current.date).annual;
  assert.equal(result.baseDate, earlier.date);
  assert.equal(result.excess, 210);
  assert.equal(result.cutoffPrice, 290);
});

test("intraday bases use T-3/T-5/T-15 and exactly 40 completed sessions", () => {
  const history = Array.from({ length: 42 }, (_, i) => ({ date: addDays(today, i - 41), close: i === 41 ? 9999 : 100 + i }));
  const benchmark = history.map(row => ({ ...row, close: 100 }));
  const intraday = intradayPriceBases(history, benchmark, today, addDays(today, -1));
  assert.equal(intraday.previousClose, 140);
  assert.deepEqual(intraday.checks.slice(0, 3).map(({ prior }) => prior), [138, 136, 126]);
  assert.deepEqual(intraday.overheat, { average: 120.5, cutoffPrice: 157 });
  assert.equal(intraday.high14, 140);
  const missing = intradayPriceBases(history.filter(row => row.date !== addDays(today, -16)), benchmark, today, addDays(today, -1));
  assert.equal(missing.overheat, null);
  assert.equal(intradayPriceBases(history, benchmark, today, today), null);
});

test("quote preview updates with the regular quote and excludes NXT, stale data and after-hours", () => {
  const cutoff = addDays(today, -1);
  const history = Array.from({ length: 41 }, (_, i) => ({ date: addDays(today, i - 41), close: 100 }));
  const intraday = intradayPriceBases(history, history, today, cutoff);
  const prices = priceChecks(history, history, cutoff);
  const row = { intraday, prices };
  const quote = { p: 159, st: "OPEN", at: new Date(now).toISOString() };
  const first = warningPriceView(row, quote, null, now);
  assert.equal(first.prices.checks[1].pricePass, false);
  assert.equal(warningPriceView(row, { ...quote, p: 160 }, null, now).prices.checks[1].pricePass, true);
  assert.equal(warningPriceView(row, { ...quote, nxt: true }, null, now).prices, prices);
  assert.equal(warningPriceView(row, quote, null, now + 180001).prices, prices);
  const after = Date.parse(today + "T16:00:00+09:00");
  assert.equal(warningPriceView(row, { ...quote, at: new Date(after).toISOString() }, null, after).prices, prices);
  assert.equal(warningPriceView({ ...row, intraday: { ...intraday, date: cutoff } }, quote, null, now).prices, prices);
  assert.deepEqual([1999, 2001, 4999, 5001, 175520, 199999, 200001, 500001]
    .map(kosdaqPriceLevel), [1999, 2005, 5000, 5010, 175600, 200000, 200500, 501000]);
});

test("short-heat metrics compare two sessions against the forty before the test date", () => {
  const codes = Array.from({ length: 41 }, (_, index) => addDays(today, index - 40).replaceAll("-", ""));
  const prices = parseRegularBars(codes.map((dt, index) => ({
    dt, cur_prc: index === 40 ? "-130" : "100", high_pric: index === 40 ? "150" : "110",
    low_pric: index === 40 ? "100" : "90", trde_qty: "10", trde_prica: "1",
  })));
  const integrated = prices.map((row, index) => ({ ...row,
    value: index === 40 ? 14_300_000 : 1_000_000,
  }));
  const shares = new Map(prices.map(row => [row.date, 1000]));
  const adjusted = prices.map((row, index) => ({ ...row, close: index === 40 ? 130 : 50 }));
  const result = shortHeatMetrics(prices, prices, integrated, shares, today);
  assert.equal(result.averageClose, 100);
  assert.equal(result.close, 130);
  assert.equal(result.volatility > 1.49 && result.volatility < 1.51, true);
  assert.equal(result.turnover > 5.99 && result.turnover < 6.01, true);
  assert.equal(shortHeatMetrics(prices, adjusted, integrated, shares, today).averageClose, 50);
  adjusted.at(-1).close = 131;
  assert.equal(shortHeatMetrics(prices, adjusted, integrated, shares, today, { intraday: true }).averageClose, 50);
  assert.equal(shortHeatMetrics(prices, [], integrated, shares, today).averageClose, null);
  assert.equal(shortHeatMetrics(prices, prices, integrated.slice(1), shares, today).turnover, null);
  assert.equal(shortHeatMetrics(prices.slice(1), prices, integrated, shares, today), null);
});

test("short-heat price follows the live KRX quote and late or missing metrics are dated", () => {
  const closed = { date: "2026-11-26", close: 110 };
  const feed = { live: { date: today, close: 125, turnover: 4.5, volatility: 1.3 },
    closed, checkedAt: new Date(now - 300000).toISOString() };
  const quote = { p: 127, at: new Date(now).toISOString(), st: "OPEN" };
  assert.equal(shortHeatView({}, quote, feed, now).close, 127);
  assert.equal(shortHeatView({}, { ...quote, nxt: true }, feed, now), closed);
  assert.equal(shortHeatView({}, quote, { ...feed, checkedAt: new Date(now - 721000).toISOString() }, now), closed);
  assert.equal(shortHeatView({ prices: { date: today, close: 123, overheat: { average: 100 } } }, quote, null, now).averageClose, 100);
});
