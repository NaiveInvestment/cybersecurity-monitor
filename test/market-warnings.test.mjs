import assert from "node:assert/strict";
import test from "node:test";
import { addDays, lastClosedDate, officialForStock, parseKindWarningPage, priceChecks } from "../src/market-warnings.mjs";
import { marketWarningBadge } from "../public/lib/market-warnings.js";

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
