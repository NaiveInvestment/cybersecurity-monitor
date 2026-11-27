import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fetchNewsText } from "../src/news-feeds.mjs";
import { publicSecurityAlerts } from "../scripts/publish-security-alerts.mjs";

test("feed fetch retries a short rate limit and honors longer Retry-After", async () => {
  const url = "https://news.google.com/rss";
  const waited = [];
  const limits = [new Response("", { status: 429, headers: { "Retry-After": "2" } }),
    new Response("<rss />")];
  const body = await fetchNewsText(url, "text/xml", {
    request: async () => limits.shift(), wait: async delay => waited.push(delay),
  });
  assert.equal(body, "<rss />");
  assert.deepEqual(waited, [2000]);
  await assert.rejects(fetchNewsText(url, "text/xml", {
    request: async () => new Response("", { status: 503, headers: { "Retry-After": "60" } }),
    wait: async () => assert.fail("Server requested a wait beyond this polling budget"),
  }), /HTTP 503/);
});

test("public live alerts expose only fresh production article fields", () => {
  const now = Date.parse("2026-11-27T02:30:00Z");
  const url = "https://signal.sedaily.com/article/20119766";
  const id = createHash("sha256").update(url).digest("hex").slice(0, 24);
  const actual = { id, url, title: "과학기술인공제회 해킹으로 회원정보 유출", source: "서울경제 시그널",
    first: "2026-11-27T02:10:00Z", qualifiedAt: "2026-11-27T02:15:00Z",
    detectedAt: "2026-11-27T02:20:00Z", receipts: [{ chat_id: 1 }], keys: ["private"] };
  const { title, source } = actual;
  const mockUrl = "https://example.com/news";
  const mockId = createHash("sha256").update(mockUrl).digest("hex").slice(0, 24);
  const rows = [{ ...actual, id: mockId, url: mockUrl }, { ...actual, test: true }, { ...actual, first: null },
    { ...actual, detectedAt: "2026-11-27T01:30:00Z" }, actual, actual];
  assert.deepEqual(publicSecurityAlerts({ alerts: rows }, now).alerts,
    [{ id, url, title, source, detectedAt: "2026-11-27T02:20:00.000Z" }]);
});
