import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { startQuoteFeed } from "../public/lib/quote-feed.js";

test("public quotes use cloud fallback and a fresh relay, then restore current cloud quotes", async (t) => {
  const api = "https://api.github.com/repos/owner/site/contents/live.json?ref=live";
  const cloud = "https://raw.githubusercontent.com/owner/site/live/live.json";
  const config = "https://raw.githubusercontent.com/owner/site/relay/relay.json";
  const relay = "https://test.trycloudflare.com/live.json";
  const fresh = { asOf: new Date().toISOString(), q: { sample: [1] } };
  const cloudPayload = { q: { sample: [2] } };
  const calls = [];
  const scheduled = new Map();
  let relayPayload = null;
  t.mock.method(globalThis, "setInterval", (poll, interval) => scheduled.set(interval, poll));
  const mockDoc = { hidden: false, addEventListener() {} };
  globalThis.document = mockDoc;
  t.after(() => { delete globalThis.document; });
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = String(input);
    calls.push(url);
    if (url === api) {
      assert.equal(options.headers.Accept, "application/vnd.github.raw+json");
      return { ok: false };
    }
    if (url === cloud) return { ok: true, json: async () => cloudPayload };
    if (url.startsWith(config + "?t=")) return { ok: true, json: async () => ({ url: relay }) };
    if (url === relay && relayPayload) return { ok: true, json: async () => relayPayload };
    return { ok: false };
  });
  const seen = [];
  startQuoteFeed({ repo: "owner/site", branch: "live", file: "live.json", relayConfig: config }, {
    onQuotes: (payload, source) => seen.push({ payload, source }),
    onRelayLost: (payload) => seen.push({ payload, source: "relay-lost" }),
  });
  await setImmediate();
  assert.deepEqual(seen, [{ payload: cloudPayload, source: "cloud" }]);
  assert.deepEqual([...scheduled.keys()], [75000, 2000]);

  relayPayload = fresh;
  await scheduled.get(2000)();
  await scheduled.get(75000)();
  assert.deepEqual(seen.at(-1), { payload: fresh, source: "relay" });
  assert.equal(seen.length, 2);

  relayPayload = { ...fresh, asOf: new Date(Date.now() - 20_000).toISOString() };
  await scheduled.get(2000)();
  assert.deepEqual(seen.at(-1), { payload: cloudPayload, source: "relay-lost" });

  mockDoc.hidden = true;
  const count = calls.length;
  await scheduled.get(2000)();
  await scheduled.get(75000)();
  assert.equal(calls.length, count);
});

test("local quotes poll the same origin at the configured cadence", async (t) => {
  const payload = { q: { sample: [1] } };
  t.mock.method(globalThis, "setInterval", (_, interval) => assert.equal(interval, 2500));
  globalThis.document = { hidden: false, addEventListener() {} };
  t.after(() => { delete globalThis.document; });
  const fetch = t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "live.json");
    return { ok: true, json: async () => payload };
  });
  const seen = [];
  startQuoteFeed({ url: "live.json", interval: 2500 }, {
    onQuotes: (payload, source) => seen.push({ payload, source }),
  });
  await setImmediate();
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(seen, [{ payload, source: "local" }]);
});

test("sector polling is opt-in and falls back when the chart rejects the relay snapshot", async (t) => {
  const config = "https://raw.githubusercontent.com/owner/site/relay/relay.json";
  const relay = "https://test.trycloudflare.com/live.json";
  const at = new Date().toISOString();
  const open = (at) => ({ indices: { KOSPI: { at, st: "OPEN" }, KOSDAQ: { at, st: "OPEN" } } });
  const cloud = { q: { a: [1] }, sector: open(at) };
  let relayPayload = { asOf: at, q: { a: [2] }, sector: open(at) };
  let active = false;
  const scheduled = new Map(), seen = [];
  t.mock.method(globalThis, "setInterval", (poll, interval) => scheduled.set(interval, poll));
  globalThis.document = { hidden: false, addEventListener() {} };
  t.after(() => { delete globalThis.document; });
  const fetch = t.mock.method(globalThis, "fetch", async (input) => {
    const url = String(input);
    if (url.startsWith(config + "?t=")) return { ok: true, json: async () => ({ url: relay }) };
    if (url === relay + "?sector=1") return { ok: true, json: async () => relayPayload };
    assert.match(url, /api\.github\.com\/repos\/owner\/site\/contents\/live\.json\?ref=live$/);
    return { ok: true, json: async () => cloud };
  });
  const refresh = startQuoteFeed({ repo: "owner/site", branch: "live", file: "live.json", relayConfig: config }, {
    isActive: () => active,
    acceptSector: (snapshot) => Date.now() - Date.parse(snapshot?.indices?.KOSDAQ?.at) < 120000,
    onQuotes: (payload, source) => seen.push([source, payload]),
    onRelayLost: (payload) => seen.push(["returned to cloud", payload]),
  });
  assert.equal(fetch.mock.callCount(), 0);
  active = true;
  refresh();
  await setImmediate();
  assert.deepEqual(seen.at(-1), ["relay", relayPayload]);
  relayPayload = { ...relayPayload, sector: open(new Date(Date.now() - 121000).toISOString()) };
  await scheduled.get(2000)();
  assert.deepEqual(seen.at(-1), ["returned to cloud", cloud]);
  active = false;
  const count = fetch.mock.callCount();
  await scheduled.get(2000)();
  await scheduled.get(75000)();
  assert.equal(fetch.mock.callCount(), count);
});
