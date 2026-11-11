import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadUniverse, ROOT } from "../src/universe.mjs";
import { activeSessions, minutesToNextSession } from "../src/sessions.mjs";

test("universe: 국내 35종목, 해외 36종목, id 중복 없음", () => {
  const universe = loadUniverse();
  assert.equal(universe.stocks.filter((stock) => stock.kind === "KR").length, 35);
  assert.equal(universe.stocks.filter((stock) => stock.kind === "GL").length, 36);
  assert.equal(new Set(universe.stocks.map((stock) => stock.id)).size, 71);
});

const kst = (text) => new Date(`${text}+09:00`);

test("sessions: 아시아장과 미국장 구간", () => {
  assert.deepEqual(activeSessions(kst("2026-11-11T10:00:00")), { asia: true, us: false });   // 수요일 장중
  assert.deepEqual(activeSessions(kst("2026-11-11T16:00:00")), { asia: false, us: false });  // 장 마감 뒤
  assert.deepEqual(activeSessions(kst("2026-11-11T23:40:00")), { asia: false, us: true });   // 수요일 밤 미국장
  assert.deepEqual(activeSessions(kst("2026-11-14T05:00:00")), { asia: false, us: true });   // 토요일 새벽(금요일 미국장)
  assert.deepEqual(activeSessions(kst("2026-11-14T10:00:00")), { asia: false, us: false });  // 토요일 낮
  assert.deepEqual(activeSessions(kst("2026-11-16T05:00:00")), { asia: false, us: false });  // 월요일 새벽
});

test("sessions: 다음 구간까지 남은 분", () => {
  assert.equal(minutesToNextSession(kst("2026-11-11T10:00:00")), 0);
  assert.equal(minutesToNextSession(kst("2026-11-11T08:40:00")), 15);
  assert.ok(minutesToNextSession(kst("2026-11-14T10:00:00")) > 45);
});

test("cards: 필수 필드, 분야와 종목 참조", () => {
  const universe = loadUniverse();
  const segs = new Set(universe.segments.map((segment) => segment.id));
  const ids = new Set(universe.stocks.map((stock) => stock.id));
  const { cards } = JSON.parse(readFileSync(join(ROOT, "data", "curated", "cards.json"), "utf8"));
  assert.ok(cards.length >= 30);
  for (const card of cards) {
    assert.match(card.id, /^[a-z0-9-]+$/, card.id);
    assert.ok(["incident", "policy", "spending"].includes(card.category), card.id);
    assert.ok(["KR", "GL"].includes(card.region), card.id);
    assert.match(card.date, /^\d{4}-\d{2}(-\d{2})?$/, card.id);
    assert.ok(card.title && card.claim && card.status && card.facts.length && card.sources.length, card.id);
    for (const seg of card.segs || []) assert.ok(segs.has(seg), `${card.id}: 분야 ${seg}`);
    for (const ticker of card.tickers || []) assert.ok(ids.has(ticker), `${card.id}: 종목 ${ticker}`);
    for (const source of card.sources) assert.match(source.url, /^https?:\/\//, card.id);
  }
  assert.equal(new Set(cards.map((card) => card.id)).size, cards.length);
});

test("화면 문구: 가운뎃점과 원문자 숫자, 인라인 style을 쓰지 않는다", () => {
  const files = [
    ...readdirSync(join(ROOT, "public")).filter((name) => /\.(html|js|css)$/.test(name)).map((name) => join(ROOT, "public", name)),
    join(ROOT, "data", "curated", "cards.json"), join(ROOT, "universe.json"),
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.equal(/[·‧・]/.test(text), false, `${file}: 가운뎃점`);
    assert.equal(/[①-⑳]/.test(text), false, `${file}: 원문자`);
    if (file.endsWith(".html") || file.endsWith(".js")) assert.equal(/\sstyle=/.test(text), false, `${file}: 인라인 style`);
  }
});
