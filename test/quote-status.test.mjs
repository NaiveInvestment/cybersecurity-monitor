import assert from "node:assert/strict";
import test from "node:test";
import { quoteStatus } from "../public/lib/quote-status.js";
import { LocalLive } from "../src/live-local.mjs";

const now = Date.parse("2026-11-20T01:00:00Z");
const ago = (minutes) => new Date(now - minutes * 60000).toISOString();
const kr = { id: "a", kind: "KR", market: "KOSDAQ", q: { at: ago(5), st: "OPEN" } };
const jp = { id: "b", kind: "GL", market: "TSE", q: { at: ago(0), st: "OPEN" } };
const packet = { asOf: ago(0), marketSuccessAt: { KR: ago(5), JP: ago(0) } };

test("a fresh HTTP response or another open market cannot mask stale quotes", () => {
  assert.equal(quoteStatus([kr, jp], packet, now).label, "국내 지연 5분");
  assert.equal(quoteStatus([jp], packet, now).label, "LIVE");
  assert.equal(quoteStatus([kr], { asOf: ago(0) }, now).label, "지연 5분");
  assert.equal(quoteStatus([kr], { ...packet, marketSuccessAt: {} }, now).tone, "delayed");
  const stopped = { ...packet, marketSuccessAt: { JP: ago(3) } };
  assert.equal(quoteStatus([jp], stopped, now).label, "지연 3분");
});

test("a new tick restores live status and a closed market does not accrue delay", () => {
  const q = { a: [100, 0, 1, 1, 1, ago(0), "OPEN"] };
  assert.equal(quoteStatus([kr], { q, marketSuccessAt: { KR: ago(0) } }, now).label, "LIVE");
  q.a[6] = "CLOSE";
  assert.equal(quoteStatus([kr], { q, marketSuccessAt: {} }, now).label, "장마감");
});

test("poll records success only for markets that returned usable stock observations", async (t) => {
  const local = new LocalLive({ universe: { stocks: [
    { ...kr, code: "000001" }, { ...jp, code: "1.T" },
  ] } });
  const prior = ago(5);
  local.marketSuccessAt.JP = prior;
  t.mock.method(globalThis, "fetch", async (url) => ({
    ok: true,
    json: async () => ({ datas: url.includes("domestic/stock") ? [{
      itemCode: "000001", closePriceRaw: "100", localTradedAt: ago(0), marketStatus: "OPEN",
    }] : [] }),
  }));
  await local.poll();
  const payload = local.snapshot();
  assert.ok(Date.parse(payload.marketSuccessAt.KR) > 0);
  assert.equal(payload.marketSuccessAt.JP, prior);
  assert.equal(payload.q.a[5], ago(0));
});
