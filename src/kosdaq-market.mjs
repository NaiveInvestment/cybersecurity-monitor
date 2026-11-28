import { readFile, rename, writeFile } from "node:fs/promises";
import { krxDate } from "../public/lib/sector-index.js";

const archive = "https://raw.githubusercontent.com/FinanceData/fdr_krx_data_cache/master/data/index/year_kq11";
const fields = "Date,Close,UpDown,Comp,Change,Open,High,Low,Volume,Amount,MarCap";
const KRW_PER_EOK = 100_000_000;

export function parseKosdaqCaps(csv, year, asOf) {
  const [header, ...records] = csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (header !== fields) throw new Error("코스닥 연간 데이터의 열이 바뀌었습니다.");
  const dates = new Set();
  return records.map(line => {
    const columns = line.split(",");
    const [date, rawClose] = columns;
    const close = /^\d+(?:\.\d+)?$/.test(rawClose) ? Number(rawClose) : null;
    const raw = columns.at(-1);
    const cap = /^\d+(?:\.0+)?$/.test(raw) ? Number(raw) : null;
    const weekday = new Date(date + "T00:00:00Z").getUTCDay();
    if (columns.length !== 11 || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !date.startsWith(year + "-") || date > asOf || !(weekday >= 1 && weekday <= 5) ||
        dates.has(date) || !Number.isSafeInteger(cap) || cap <= 0) {
      throw new Error(`잘못된 코스닥 시총 행 (${date})`);
    }
    dates.add(date);
    return { date, cap: cap / KRW_PER_EOK, close: Number.isFinite(close) && close > 0 ? close : null };
  });
}

export async function refreshKosdaqMarket(target, { asOf = krxDate(new Date().toISOString()), request = fetch } = {}) {
  const year = Number(asOf.slice(0, 4));
  const files = await Promise.all([year - 1, year].map(async value => {
    const response = await request(`${archive}/${value}.csv`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`코스닥 일별 시총 HTTP ${response.status}`);
    return parseKosdaqCaps(await response.text(), value, asOf);
  }));
  const bars = files.flat().sort((a, b) => a.date.localeCompare(b.date));
  if (files[0].length < 200 || !bars.length) throw new Error("코스닥 1년 시총 범위가 부족합니다.");
  const prior = await readFile(target, "utf8").then(JSON.parse).catch(() => null);
  const data = { market: "KOSDAQ", unit: "억원", asOf: bars.at(-1).date, bars };
  if (prior?.asOf > data.asOf) return prior;
  const staged = `${target}.${process.pid}.tmp`;
  await writeFile(staged, JSON.stringify(data));
  await rename(staged, target);
  return data;
}
