import test from "node:test";
import assert from "node:assert/strict";
import { buildTrend, trendSvg, niceMax, tierOf, kstDay, isDeniedIncidentTitle, heatRows, heatLevel } from "../public/lib/incident-trend.js";
import { updateIncidentLog, publicIncidentLog, compileEntities } from "../src/incident-log.mjs";

const story = (id, r, f, s, n = s) => ({ id, r, f, s, n, t: `사건 ${id}`, u: `https://example.com/${id}` });

test("tierOf와 kstDay: 매체 수 구간, KST 날짜 경계", () => {
  assert.deepEqual([2, 4, 5, 19, 20, 80].map(tierOf), [0, 0, 1, 1, 2, 2]);
  assert.equal(kstDay("2026-11-09T14:59:00Z"), "2026-11-09");
  assert.equal(kstDay("2026-11-09T15:00:00Z"), "2026-11-10");
});

test("buildTrend: 2개 매체 이상만, 부정 제목 제외, 지역별 구간 수와 공통 눈금", () => {
  const stories = [
    story("a", "KR", "2026-11-09T01:00:00Z", 1),
    story("b", "KR", "2026-11-09T02:00:00Z", 3),
    story("c", "KR", "2026-11-10T16:00:00Z", 40),
    story("d", "GL", "2026-11-10T01:00:00Z", 6),
    { ...story("e", "GL", "2026-11-10T02:00:00Z", 49), t: "United Airlines says tech outage disrupts departures, no signs of cyberattack" },
    story("old", "KR", "2026-11-01T01:00:00Z", 9),
  ];
  const trend = buildTrend(stories, { now: Date.parse("2026-11-11T03:00:00Z"), since: "2026-11-09", days: 60 });
  assert.deepEqual(trend.dates, ["2026-11-09", "2026-11-10", "2026-11-11"]);
  const [kr, gl] = trend.regions;
  assert.deepEqual(kr.daily.map((day) => day.total), [1, 0, 1]);
  assert.deepEqual(kr.tiers, [1, 0, 1]);
  assert.equal(kr.stories[0].id, "c");
  assert.deepEqual(gl.stories.map((s) => s.id), ["d"]);
  assert.equal(trend.maxDaily, 1);
  assert.equal(trend.maxSources, 40);
});

test("isDeniedIncidentTitle: 원인 부인, 별도 확인된 유출, 원인 미확정 구분", () => {
  for (const title of ["Trump administration says tech outages are not a cyberattack", "United Airlines says tech outage disrupts departures, no signs of cyberattack", "Meade County Dispatch Disruption Caused by Equipment Failure, Not Cyberattack", "Transport Secy Rules Out Foreign Cyberattack", "전산 장애, 해킹 아냐"]) assert.ok(isDeniedIncidentTitle(title), title);
  for (const title of ["Uber reports data breach affecting nearly 150,000 drivers", "금융보안원 해킹, 개인정보 유출", "Coles reports customer data breach, no signs of cyberattack", "Transportation secretary still hasn't rule out a cyberattack hit the FAA", '라이터 "외부기관 주소 침해 정황…자체 해킹 아냐" 출금 일시 중단']) assert.ok(!isDeniedIncidentTitle(title), title);
});

test("niceMax: 1, 2, 2.5, 5, 10 배수", () => {
  assert.deepEqual([1, 3, 23, 48, 60, 101].map(niceMax), [1, 5, 25, 50, 100, 200]);
});

test("trendSvg: 누적 막대, 오늘 표시, 지정 폭", () => {
  const stories = [story("a", "KR", "2026-11-09T01:00:00Z", 2), story("b", "KR", "2026-11-11T01:00:00Z", 25), story("c", "KR", "2026-11-10T01:00:00Z", 7)];
  const trend = buildTrend(stories, { now: Date.parse("2026-11-11T03:00:00Z"), since: "2026-11-09" });
  const svg = trendSvg(trend, trend.regions[0], { width: 500, today: "2026-11-11" });
  assert.match(svg, /width="500"/);
  assert.match(svg, /오늘/);
  assert.match(svg, /class="tr-day partial"/);
  for (const cls of ["tr-t1", "tr-t2", "tr-t3"]) assert.match(svg, new RegExp(cls));
});

test("updateIncidentLog: 기사가 밀려나도 과거 사건과 최대 강도를 유지한다", () => {
  const item = (id, g, s, d) => ({ id, g, t: `금융보안원 해킹 ${id}`, u: `https://example.com/${id}`, s, d, c: "incident", r: "KR", k: [] });
  const first = updateIncidentLog({ stories: [] }, [
    item("a1", "a1", "연합", "2026-11-10T01:00:00Z"), item("a2", "a1", "뉴스1", "2026-11-10T02:00:00Z"), item("a3", "a1", "뉴시스", "2026-11-10T03:00:00Z"),
    { ...item("p1", "p1", "가", "2026-11-10T01:00:00Z"), c: "policy" },
  ], { now: Date.parse("2026-11-11T00:00:00Z") });
  assert.equal(first.stories.length, 1);
  assert.equal(first.stories[0].s, 3);
  // 첫 기사가 밀려나 묶음 번호가 a2로 바뀌어도 같은 사건으로 합친다.
  const second = updateIncidentLog(first, [item("a2", "a2", "뉴스1", "2026-11-10T02:00:00Z"), item("b1", "b1", "가", "2026-11-11T01:00:00Z")], { now: Date.parse("2026-11-12T00:00:00Z") });
  assert.equal(second.stories.length, 2);
  assert.equal(second.added, 1);
  const a = second.stories.find((entry) => entry.m.includes("a1"));
  assert.equal(a.s, 3);
  assert.equal(a.f, "2026-11-10T01:00:00Z");
  assert.ok(!("m" in publicIncidentLog(second).stories[0]));
});

test("updateIncidentLog: 피해 주체 사전으로 쪼개진 후속 보도를 한 사건으로, 지역은 주체 소재로", () => {
  const entities = compileEntities({ entities: [
    { id: "fsi", name: "금융보안원", region: "KR", sector: "금융", match: ["금융보안원", "금보원"] },
    { id: "binance", name: "바이낸스", region: "GL", sector: "가상자산", match: ["바이낸스", String.raw`\bbinance\b`] },
  ] });
  const item = (id, g, t, s, d, r = "KR") => ({ id, g, t, u: `https://example.com/${id}`, s, d, c: "incident", r, k: [] });
  const items = [
    item("a1", "a1", "금융보안원도 해킹", "연합", "2026-11-10T01:00:00Z"), item("a2", "a1", "금융보안원도 해킹당해", "뉴스1", "2026-11-10T02:00:00Z"),
    item("b1", "b1", "금융위, 금보원 특정감사 착수", "뉴시스", "2026-11-14T01:00:00Z"), item("b2", "b1", "금융위, 금융보안원 감사", "연합", "2026-11-14T02:00:00Z"),
    item("c1", "c1", "바이낸스 63억 달러 해킹", "한경", "2026-11-11T01:00:00Z"), item("c2", "c2", "Binance hacked for $6.3 billion", "Reuters", "2026-11-11T03:00:00Z", "GL"),
    item("z1", "z1", "어느 병원 랜섬웨어", "가", "2026-11-12T01:00:00Z"), item("z2", "z1", "어느 병원 랜섬웨어 피해", "나", "2026-11-12T02:00:00Z"),
    item("x1", "x1", "금융보안원 또 해킹", "다", "2026-12-20T01:00:00Z"),
  ];
  const { stories } = updateIncidentLog({ stories: [] }, items, { entities, now: Date.parse("2026-12-21T00:00:00Z") });
  const fsi = stories.filter((entry) => entry.e === "fsi").sort((a, b) => a.f.localeCompare(b.f));
  assert.equal(fsi.length, 2, "14일 넘게 끊기면 새 사건");
  assert.equal(fsi[0].s, 3);
  assert.equal(fsi[0].n, 4);
  assert.equal(fsi[0].l, "2026-11-14T02:00:00Z");
  const binance = stories.find((entry) => entry.e === "binance");
  assert.equal(binance.r, "GL");
  assert.equal(binance.s, 2);
  const other = stories.find((entry) => !entry.e);
  assert.equal(other.s, 2);
  // 다시 돌려도 같은 결과(멱등).
  const again = updateIncidentLog({ stories }, items, { entities, now: Date.parse("2026-12-21T00:00:00Z") });
  assert.equal(again.added, 0);
  assert.equal(again.stories.find((entry) => entry.e === "fsi" && entry.f === fsi[0].f).s, 3);
});

test("heatRows: 최근 기간에 보도가 있는 사건만 강도순, 칸은 날짜별 매체 수", () => {
  const stories = [
    { ...story("a", "KR", "2026-11-09T01:00:00Z", 30), dd: { "2026-11-09": 10, "2026-11-11": 25 } },
    { ...story("b", "KR", "2026-11-10T01:00:00Z", 6), dd: { "2026-11-10": 6 } },
    { ...story("c", "KR", "2026-11-09T01:00:00Z", 50), dd: { "2026-11-09": 50 } },
  ];
  const trend = buildTrend(stories, { now: Date.parse("2026-11-11T03:00:00Z"), since: "2026-11-09" });
  const heat = heatRows(trend, trend.regions[0], { days: 2 });
  assert.deepEqual(heat.days, ["2026-11-10", "2026-11-11"]);
  assert.deepEqual(heat.rows.map((row) => row.id), ["a", "b"]);
  assert.deepEqual(heat.rows[0].cells, [0, 25]);
  assert.deepEqual([0, 1, 3, 4, 8, 15, 30].map(heatLevel), [0, 1, 1, 2, 3, 4, 5]);
});
