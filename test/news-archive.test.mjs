import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { archiveArticles, buildSearchArchive } from "../src/news-archive.mjs";
import { searchArchive } from "../public/lib/news-search.js";
import { mergeItems } from "../src/news.mjs";

const now = Date.parse("2026-11-22T03:00:00Z");
const article = (id, d) => ({ id, u: `https://example.org/${id}`, t: `자료 ${id}`, d, c: "policy", r: "KR", s: "A" });

test("search retains older reports when more than 3000 recent headlines arrive", async t => {
  const dir = mkdtempSync(join(tmpdir(), "cyber-news-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const state = join(dir, "state");
  const site = join(dir, "site");
  const current = Array.from({length: 3001}, (_, n) => article(String(n), "2026-11-21T22:00:00Z"));
  const oct = article("oct", "2026-10-28T16:00:00Z");
  const sept = article("sept", "2026-09-17T03:00:00Z");
  const { items } = mergeItems([...current, oct, sept], [], { now });
  archiveArticles(state, [oct, sept], now);
  archiveArticles(state, items, now);
  const monthly = { items: items.slice(0, 3000) };
  monthly.archive = buildSearchArchive(state, site, monthly.items, now);
  const reads = [];
  const cache = new Map();
  const load = async url => {
    reads.push(url);
    return JSON.parse(readFileSync(join(site, url.split("/").at(-1).split("?")[0])));
  };
  const last30 = await searchArchive(monthly, 30, load, cache, now);
  assert.equal(last30.items.length, 3002);
  assert.equal(last30.items.at(-1).id, "oct");
  assert.match(last30.coverage, /2026-10-29.*2026-11-22.*2일/);
  assert.equal(last30.failed, 0);
  assert.equal(reads.length, 2);
  const last7 = await searchArchive(monthly, 7, load, cache, now);
  assert.equal(last7.items.length, 3001);
  assert.equal(reads.length, 2);
  const all = await searchArchive(monthly, 0, load, cache, now);
  assert.equal(all.items.at(-1).id, "sept");
  assert.equal(reads.length, 3);
  const partialCache = new Map();
  const partial = await searchArchive(monthly, 30, async () => { throw Error("offline"); }, partialCache, now);
  assert.equal(partial.failed, 2);
  assert.equal(partial.items.length, 3000);
  assert.equal((await searchArchive(monthly, 30, load, partialCache, now)).items.length, 3002);
});

test("distinct publishers' reports survive a shared headline", () => {
  const first = article("first", "2026-11-19T21:00:00Z");
  const reprint = { ...first, u: "https://example.org/reprint", id: "reprint", s: "B" };
  assert.equal(mergeItems([first], [reprint], { now }).items.length, 2);
});
