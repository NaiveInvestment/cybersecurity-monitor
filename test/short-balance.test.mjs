import assert from "node:assert/strict";
import test from "node:test";
import { fetchShortBalance, parseShortBalanceRows, stockShortBalance } from "../src/short-balance.mjs";

const sample = { ISU_CD: "053800", BAL_QTY: "144,441", LIST_SHRS: "11,126,506",
  BAL_AMT: "17,549,581,500", MKTCAP: "1,351,870,479,000", BAL_RTO: "1.30" };
const zero = { ...sample, ISU_CD: "0015S0", BAL_QTY: "0", BAL_AMT: "0", BAL_RTO: "0.00" };

test("KRX short balances use same-date capitalization and preserve published zero", () => {
  assert.deepEqual(parseShortBalanceRows({ OutBlock_1: [sample, zero] }), [sample, zero]);
  assert.throws(() => parseShortBalanceRows({ OutBlock_1: [sample, sample] }), /종목코드/);
  assert.equal(stockShortBalance(sample).ratio.toFixed(2), "1.30");
  assert.equal(stockShortBalance(zero).ratio, 0);
  assert.equal(stockShortBalance({ ...sample, BAL_AMT: "-" }), null);
  assert.equal(stockShortBalance({ ...sample, MKTCAP: "5,000" }), null);
});

test("an unpublished KRX date falls back while an absent ticker stays missing", async () => {
  const dates = [];
  const fetcher = async (_url, { body }) => {
    const day = body.get("trdDd");
    dates.push(day);
    return Response.json({ OutBlock_1: day === "20261124" ? [sample, zero] : [] });
  };
  const stocks = ["053800", "0015S0", "777777"].map(code => ({ code, id: code, market: "KOSDAQ" }));
  const result = await fetchShortBalance(stocks, Date.parse("2026-11-27T16:00:00+09:00"), fetcher);
  assert.deepEqual(dates, ["20261125", "20261124"]);
  assert.equal(result.asOf, "2026-11-24");
  assert.equal(result.stocks["0015S0"].amount, 0);
  assert.equal("777777" in result.stocks, false);
});
