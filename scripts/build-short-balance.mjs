import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fetchShortBalance } from "../src/short-balance.mjs";
import { loadUniverse, ROOT } from "../src/universe.mjs";

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const output = join(option("--out") || join(ROOT, "_site", "data"), "short-balance.json");
const previous = [output, option("--prev")].filter(Boolean).flatMap(path => {
  try { return [JSON.parse(readFileSync(path, "utf8"))]; } catch { return []; }
}).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row?.asOf) && row.stocks)
  .sort((a, b) => b.asOf.localeCompare(a.asOf))[0];
const domestic = loadUniverse().stocks.filter(stock => stock.kind === "KR");
let data;
try {
  data = await fetchShortBalance(domestic);
} catch (error) {
  console.warn(`공매도 잔고 갱신 대기: ${error.message}`);
}
if (previous && (!data || previous.asOf > data.asOf)) data = previous;
if (data) {
  const pending = `${output}.${process.pid}.tmp`;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(pending, JSON.stringify(data));
  renameSync(pending, output);
  console.log(`공매도 순보유잔고 ${data.asOf}, ${Object.keys(data.stocks).length}/${domestic.length}`);
}
