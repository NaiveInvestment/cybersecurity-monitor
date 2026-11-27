import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fetchDaily, fetchIndexRealtime, mapLimit } from "../src/naver.mjs";
import { addDays, fetchKindWarnings, intradayPriceBases, KIND_WARNINGS, lastClosedDate, marketDay,
  officialForStock, priceChecks } from "../src/market-warnings.mjs";
import { loadUniverse, ROOT } from "../src/universe.mjs";

const args = process.argv.slice(2);
function option(name) {
  const position = args.indexOf(name);
  return position === -1 ? null : args[position + 1];
}
const outDir = option("--out") || join(ROOT, "_site", "data");
const evidence = option("--evidence");
const now = Date.now();
const today = marketDay(now);
const compact = day => day.replaceAll("-", "");
const range = { start: compact(addDays(today, -400)), end: compact(addDays(today, 1)), attempts: 2 };
const levels = ["attention", "warning", "danger"];
const stocks = loadUniverse().stocks.filter(stock => stock.kind === "KR");

function save(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const pending = `${path}.${process.pid}.tmp`;
  writeFileSync(pending, JSON.stringify(data));
  renameSync(pending, path);
}

const marketCodes = [...new Set(stocks.map(stock => stock.market))];
const [indices, histories, marketQuotes] = await Promise.all([
  Promise.all(marketCodes.map(async code => [code,
    await fetchDaily("KR", code, { ...range, type: "index" }).catch(() => [])])),
  mapLimit(stocks, 7, stock => fetchDaily("KR", stock.code, range)),
  fetchIndexRealtime("KR", marketCodes, { attempts: 1 }).catch(() => ({})),
]);
const byMarket = Object.fromEntries(indices);
const from = addDays(today, -38);
const until = addDays(today, 7);
const kindResponses = await Promise.allSettled(levels.map(level => fetchKindWarnings(level, from, until)));
const errors = {};
const official = Object.fromEntries(levels.map((level, index) => {
  const result = kindResponses[index];
  if (result.status === "fulfilled") return [level, { rows: result.value }];
  errors[level] = result.reason.message;
  return [level, null];
}));

const rows = Object.fromEntries(stocks.map((stock, index) => {
  const benchmark = byMarket[stock.market] || [];
  const cutoff = lastClosedDate(now, marketQuotes[stock.market]);
  const permittedDates = benchmark.filter(point => point.date <= cutoff).map(point => point.date);
  // A notice may take effect today before today’s price row is final.
  const calendar = [...new Set([...permittedDates, ...benchmark
    .filter(point => point.date === today).map(point => point.date)])];
  const history = histories[index].value || [];
  return [stock.id, { official: officialForStock(stock, official, today, calendar),
    prices: priceChecks(history, benchmark, cutoff),
    intraday: intradayPriceBases(history, benchmark, today, cutoff) }];
}));
const payload = { checkedAt: new Date(now).toISOString(), officialDate: today, source: KIND_WARNINGS, errors, stocks: rows };
save(join(outDir, "market-warnings.json"), payload);
if (evidence) save(evidence, { payload, filters: { from, until }, official, indices: byMarket,
  history: Object.fromEntries(stocks.map((stock, index) => [stock.id, histories[index].value || []])) });
console.log(`시장경보: 공시 ${3 - Object.keys(errors).length}/3, 가격 비교 ${Object.values(rows)
  .filter(row => row.prices?.checks.some(check => check.result !== null)).length}/${stocks.length}`);
if (Object.keys(errors).length) console.warn("KIND 확인 실패:", JSON.stringify(errors));
