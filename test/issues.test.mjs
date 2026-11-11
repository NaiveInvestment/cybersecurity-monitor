import test from "node:test";
import assert from "node:assert/strict";
import { groupStories, topIssues, cardForStory } from "../public/lib/issues.js";

const item = (id, g, t, s, d, c = "incident", r = "KR") => ({ id, g, t, s, d, c, r, k: [] });
const items = [
  item("a1", "a", "금융보안원도 해킹에 뚫려…금융사 정보 유출", "연합뉴스", "2026-11-10T01:00:00Z"),
  item("a2", "a", "[포토] 금융보안원 해킹 피해", "뉴시스", "2026-11-11T01:00:00Z"),
  item("a3", "a", "금융보안원도 해킹에 뚫렸다...금융사 정보 유출", "동아일보", "2026-11-10T03:00:00Z"),
  item("a4", "a", "금융보안원 해킹에 금융사 정보 유출", "연합뉴스", "2026-11-10T05:00:00Z"),
  item("b1", "b", "4대 은행 정보보호 예산 확대", "한국경제", "2026-11-10T02:00:00Z", "spending"),
  item("b2", "b", "4대 은행, 내년 정보보호 예산 확대", "매일경제", "2026-11-10T04:00:00Z", "spending"),
  item("c1", "c", "단독 기사", "어느신문", "2026-11-11T02:00:00Z"),
  item("old1", "old", "지난달 사건", "가", "2026-10-01T00:00:00Z"),
  item("old2", "old", "지난달 사건 후속", "나", "2026-10-01T02:00:00Z"),
];

test("groupStories: 묶음별 기사 수, 매체 수, 대표 제목", () => {
  const stories = groupStories(items);
  const a = stories.find((story) => story.id === "a");
  assert.equal(a.count, 4);
  assert.equal(a.sources, 3);
  assert.equal(a.first, "2026-11-10T01:00:00Z");
  assert.equal(a.last, "2026-11-11T01:00:00Z");
  assert.ok(!a.lead.t.startsWith("[포토]"));
  assert.deepEqual(stories.map((story) => story.id), ["c", "a", "b", "old"]);
});

test("topIssues: 최근 3일, 매체 수 순, 한 매체 기사는 뒤로", () => {
  const now = Date.parse("2026-11-11T03:00:00Z");
  const issues = topIssues(groupStories(items), { now });
  assert.deepEqual(issues.map((story) => story.id), ["a", "b", "c"]);
  assert.deepEqual(topIssues(groupStories(items), { now, limit: 1 }).map((story) => story.id), ["a"]);
});

test("cardForStory: 주체 이름이 제목 다수에 나오는 같은 범주 카드", () => {
  const story = groupStories(items).find((row) => row.id === "a");
  const cards = [
    { id: "x", region: "KR", category: "incident", entity: "금융보안원", date: "2026-11-09" },
    { id: "y", region: "KR", category: "policy", entity: "금융보안원", date: "2026-11-10" },
    { id: "z", region: "KR", category: "incident", entity: "쿠팡", date: "2026-06-11" },
  ];
  assert.equal(cardForStory(story, cards).id, "x");
  assert.equal(cardForStory(groupStories(items).find((row) => row.id === "c"), cards), null);
  const stale = [{ id: "old", region: "KR", category: "incident", entity: "금융보안원", date: "2025-03-01" }];
  assert.equal(cardForStory(story, stale), null);   // 같은 기관의 오래된 사건 정리는 붙이지 않는다
});
