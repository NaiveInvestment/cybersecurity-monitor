import assert from "node:assert/strict";
import test from "node:test";
import { parseKosdaqCaps } from "../src/kosdaq-market.mjs";
import { kosdaqSharePoints } from "../public/lib/kosdaq-share.js";

test("market series uses KRX closing market capitalization, in the chart's unit", () => {
  const header = "Date,Close,UpDown,Comp,Change,Open,High,Low,Volume,Amount,MarCap";
  const row = "2026-11-27,708.99,1,53.28,0.0813,664.52,710.90,664.52,520313123,6794676884612,406201792957956";
  const csv = [header, row].join("\n");
  assert.deepEqual(parseKosdaqCaps("\uFEFF" + csv, 2026, "2026-11-28"), [
    { date: "2026-11-27", cap: 4062017.92957956 },
  ]);
  assert.deepEqual(parseKosdaqCaps(csv + ".0", 2026, "2026-11-28"), parseKosdaqCaps(csv, 2026, "2026-11-28"));
  assert.throws(() => parseKosdaqCaps(csv, 2026, "2026-11-26"));
  assert.throws(() => parseKosdaqCaps(csv + "\n" + row, 2026, "2026-11-28"));
  assert.throws(() => parseKosdaqCaps(csv.replace("11-27", "11-28"), 2026, "2026-11-28"));
});

test("market share joins same-date complete closes and only KOSDAQ names", () => {
  const row = { date: "2026-11-27", listed: 2, capCount: 2, constituents: { a: 20_000, b: 30_000 } };
  const market = { market: "KOSDAQ", unit: "억원", bars: [{ date: row.date, cap: 2_000_000 }] };
  assert.deepEqual(kosdaqSharePoints([
    row, { ...row, date: "2026-11-28" }, { ...row, live: true }, { ...row, capCount: 1 },
  ], market, new Set(["a"])), [{ share: 1, stockCap: 20_000, marketCap: 2_000_000 }, null, null, null]);
  assert.deepEqual(kosdaqSharePoints([row], { ...market, unit: "원" }, new Set(["a"])), [null]);
});
