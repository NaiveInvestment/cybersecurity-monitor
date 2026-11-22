import assert from "node:assert/strict";
import test from "node:test";
import { LocalLive } from "../src/live-local.mjs";
import { publicQuotes } from "../src/public-relay.mjs";
import { fetchRealtime } from "../src/naver.mjs";

const time = (minute) => `2026-11-23T08:${minute}:00+09:00`;
const krx = { marketStatus: "PREOPEN", closePriceRaw: "111100", compareToPreviousClosePriceRaw: "0",
  fluctuationsRatioRaw: "0", localTradedAt: time(15) };
const pre = { tradingSessionType: "PRE_MARKET", overMarketStatus: "OPEN", overPrice: "107,700",
  compareToPreviousClosePrice: "-3,400", localTradedAt: time(15), accumulatedTradingVolumeRaw: "101604" };
const stocks = ["053800", "263860"].map(code => ({ id: code, code, kind: "KR" }));

test("the live table receives NXT premarket trade separately from KRX and public quotes", async t => {
  const now = Date.parse(time(16));
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async url => ({
    ok: true,
    json: async () => ({ datas: url.includes("domestic/stock") ? [
      { ...krx, itemCode: "053800", overMarketPriceInfo: pre, integratedPriceInfo: { accumulatedTradingValueRaw: "11152000000" } },
      { ...krx, itemCode: "263860", closePriceRaw: "36400" },
    ] : [] }),
  }));
  const feed = new LocalLive({ universe: { stocks } });
  await feed.poll();
  const snap = feed.snapshot();
  assert.deepEqual(snap.nxtPre, { "053800": { p: 107700, chg: -3.06, at: time(15) } });
  assert.deepEqual(snap.q["053800"].slice(0, 7), [111100, 0, null, null, 111.5, time(15), "PREOPEN"]);
  feed.sectorBase = {};
  feed.sectorUpdatedAt = now;
  feed.sectorPollAt = now;
  assert.equal(feed.sectorSnapshot(now).quotes["053800"].p, 111100);
  assert.equal(feed.sectorSnapshot(now).quotes["053800"].nxtPre, undefined);
  // Match the simulated clock in the public relay's freshness test.
  const publicPacket = publicQuotes({ ...snap, asOf: time(15), naver: {at:time(15)} }, ["053800"], Date.parse(time(15)));
  assert.equal(publicPacket.q["053800"][0], 111100);
  assert.equal(publicPacket.nxtPre, undefined);
});

test("NXT is ignored outside premarket, during a KRX open or when the trade date is stale", t => {
  const feed = new LocalLive({ universe: { stocks } });
  feed.base["053800"] = { p: 111100, chg: 0, at: time(15), st: "PREOPEN" };
  feed.nxtPre["053800"] = { p: 107700, chg: -3.06, at: time(15) };
  let now = Date.parse(time(49));
  t.mock.method(Date, "now", () => now);
  assert.ok(feed.snapshot().nxtPre);
  feed.base["053800"].st = "OPEN";
  assert.equal(feed.snapshot().nxtPre, undefined);
  feed.base["053800"].st = "PREOPEN";
  now = Date.parse(time(50));
  assert.equal(feed.snapshot().nxtPre, undefined);
  now = Date.parse("2026-11-24T08:15:00+09:00");
  assert.equal(feed.snapshot().nxtPre, undefined);
});

test("zero-volume, halted, malformed, and non-premarket quotes cannot replace the current price", async () => {
  const cases = [
    { accumulatedTradingVolumeRaw: "0" },
    { tradableStatus: "nonTradable" },
    { tradeStopType: { name: "HALT" } },
    { compareToPreviousClosePrice: "" },
    { tradingSessionType: "AFTER_MARKET" },
  ];
  const codes = cases.map((_, i) => String(i));
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ datas: cases.map((fields, i) => ({
      ...krx, itemCode: codes[i], overMarketPriceInfo: { ...pre, ...fields },
    })) }),
  });
  const parsed = await fetchRealtime("KR", codes, { includeNxtPreMarket: true, fetchImpl });
  assert.equal(Object.keys(parsed).length, cases.length);
  assert.ok(Object.values(parsed).every(row => row.p === 111100 && !row.nxtPre));
});
