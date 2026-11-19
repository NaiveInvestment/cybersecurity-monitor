import test from "node:test";
import assert from "node:assert/strict";
import { parseCount, headlineCount, mergeEvents, ransomwareDays, sameName } from "../src/incident-events.mjs";
import { compileEntities } from "../src/incident-log.mjs";
import { weeksEnding, weeklyStats, compositeIndex, summary, claimText, orgBreakdown, indexChart, countChart, sizeChart } from "../public/lib/incident-metrics.js";

test("parseCount: 한글, 영문 규모 표기", () => {
  const cases = { "KB캐피탈 1,811명": 1811, "1천800명 유출": 1800, "2만4천여 건": 24000, "2만 4011건": 24011, "300여 계정": 300, "4.6만명": 46000, "Uber Data Breach Impacts 150,000 People": 150000, "involving 1.3 million people": 1300000, "해킹 사고 발생": null, "3명": null };
  for (const [text, expected] of Object.entries(cases)) assert.equal(parseCount(text), expected, text);
});

test("headlineCount: 서로 다른 매체 2곳 이상이 같은 숫자를 쓸 때만", () => {
  assert.equal(headlineCount([{ t: "1,811명 유출", s: "가" }, { t: "1811명 정보 유출", s: "나" }, { t: "1800명", s: "다" }]), 1811);
  assert.equal(headlineCount([{ t: "1,811명 유출", s: "가" }, { t: "1811명", s: "가" }]), null);
});

test("sameName: 괄호와 기호를 빼고 포함 관계로", () => {
  assert.ok(sameName("Binance", "Binance CEX"));
  assert.ok(sameName("카카오(카카오워크)", "카카오"));
  assert.ok(!sameName("Uber", "Bitget"));
});

const research = [
  { date: "2026-10-30", name: "Binance", region: "GL", org_type: "가상자산 거래소", records: null, usd: 6340000000, size_basis: "회사 발표", attack: "핫월렛", sources: [{ outlet: "A", url: "https://a", title: "t", date: "2026-10-30" }] },
  { date: "2026-11-10", name: "금융보안원", region: "KR", org_type: "국가기관, 금융 감독 또는 보안 기관", records: 300, size_basis: "기관 발표", attack: "", sources: [{ outlet: "B", url: "https://b", title: "t", date: "2026-11-10" }] },
  { date: "2026-11-13", name: "Vanderbilt", region: "GL", org_type: "대학, 병원", records: 1000000, size_basis: "해커 주장", attack: "", sources: [{ outlet: "C", url: "https://c", title: "t", date: "2026-11-13" }] },
];
const entities = compileEntities({ entities: [
  { id: "fsi", name: "금융보안원", region: "KR", sector: "금융", match: ["금융보안원"] },
  { id: "kbcapital", name: "KB캐피탈", region: "KR", sector: "금융", match: ["KB캐피탈"] },
  { id: "hana", name: "하나은행", region: "KR", sector: "금융", match: ["하나은행"] },
] });
const newsLog = [
  { id: "a", e: "fsi", name: "금융보안원", sector: "금융", r: "KR", f: "2026-11-09T06:00:00Z", s: 109, t: "t", u: "https://x", m: [] },
  { id: "b", e: "kbcapital", name: "KB캐피탈", sector: "금융", r: "KR", f: "2026-11-13T01:00:00Z", s: 22, t: "t", u: "https://y", m: ["k1", "k2"] },
  { id: "c", e: "hana", name: "하나은행", sector: "금융", r: "KR", f: "2026-11-12T01:00:00Z", s: 1, t: "해설", u: "https://z", m: [] },
];
const newsItems = [{ id: "k1", t: "KB캐피탈 1,811명 유출", s: "가" }, { id: "k2", t: "KB캐피탈 해킹 1811명", s: "나" }];
const hacks = [{ date: Date.parse("2026-10-29T12:00:00Z") / 1000, name: "Binance CEX", amount: 6.36e9 }, { date: Date.parse("2026-11-02T00:00:00Z") / 1000, name: "Mercado Bitcoin", amount: 4e7 }, { date: Date.parse("2026-11-03T00:00:00Z") / 1000, name: "Tiny", amount: 2e6 }];

test("mergeEvents: 리서치 우선, 보도 수집은 3개 매체 이상, DeFiLlama 중복 제거", () => {
  const events = mergeEvents({ research, newsLog, entities, hacks, newsItems, since: "2026-08-18" });
  const names = events.map((e) => e.n);
  assert.deepEqual(names.filter((n) => n === "금융보안원").length, 1, "리서치와 겹치는 보도 수집 사건은 뺀다");
  assert.ok(names.includes("KB캐피탈"));
  assert.ok(!names.includes("하나은행"), "1개 매체 묶음은 사건이 아니다");
  assert.ok(!names.includes("Binance CEX") && names.includes("Binance"), "DeFiLlama 중복은 리서치로");
  assert.ok(names.includes("Mercado Bitcoin") && !names.includes("Tiny"), "$1천만 미만 제외");
  assert.equal(events.find((e) => e.n === "KB캐피탈").rec, 1811);
  assert.equal(events.find((e) => e.n === "Vanderbilt").claim, true);
});

test("ransomwareDays: 공개일 KST로 일별, 국내 따로", () => {
  const days = ransomwareDays([{ discovered: "2026-11-09T16:00:00Z", country: "KR", victim: "가" }, { discovered: "2026-11-09T10:00:00Z", country: "US" }]);
  assert.deepEqual(days["2026-11-10"], { total: 1, KR: 1, kr: ["가"] });
  assert.equal(days["2026-11-09"].total, 1);
});

test("weeksEnding: 월요일 시작 13주, 마지막 주는 집계 중", () => {
  const weeks = weeksEnding("2026-11-17", 13);
  assert.equal(weeks.length, 13);
  assert.equal(weeks.at(-1).start, "2026-11-16");
  assert.equal(weeks.at(-1).partial, true);
  assert.equal(weeks[0].start, "2026-08-24");
  assert.equal(weeks[0].partial, false);
});

test("compositeIndex: 0~100, 같은 잣대, 주장 숫자 제외", () => {
  const events = mergeEvents({ research, newsLog, entities, hacks, newsItems, since: "2026-08-18" });
  const weeks = weeksEnding("2026-11-17", 13);
  const idx = compositeIndex(events, weeks);
  const all = [...idx.KR, ...idx.GL];
  assert.ok(all.every((p) => p.index >= 0 && p.index <= 100));
  assert.equal(Math.max(...all.map((p) => p.m)), 100);
  const glWeek = idx.GL.find((p) => p.start === "2026-11-09");
  assert.equal(glWeek.rec, 0, "Vanderbilt 해커 주장 100만 건은 유출 합계에서 빠진다");
  const krWeek = idx.KR.find((p) => p.start === "2026-11-09");
  assert.equal(krWeek.count, 2);
  assert.equal(krWeek.rec, 300 + 1811);
});

test("summary, claimText, orgBreakdown", () => {
  const events = [
    ...Array.from({ length: 9 }, (_, i) => ({ d: `2026-09-0${(i % 7) + 1}`, n: `a${i}`, r: "KR", org: "일반 기업", src: [] })),
    ...Array.from({ length: 20 }, (_, i) => ({ d: `2026-11-${String(10 + (i % 7)).padStart(2, "0")}`, n: `b${i}`, r: "KR", org: "금융회사", src: [] })),
  ];
  const weeks = weeksEnding("2026-11-17", 13);
  const s = summary(events, weeks, "KR", { since: "2026-08-18", until: "2026-11-17" });
  assert.equal(s.total, 29);
  assert.ok(s.recentPerWeek > s.beforePerWeek);
  assert.match(claimText(s, "국내"), /국내 보안 사고는 최근 4주 주당 .*배/);
  const orgs = orgBreakdown(events, weeks, "KR");
  assert.deepEqual(orgs.map((o) => o.org), ["금융회사", "일반 기업"]);
});

test("차트 SVG: 지정 폭, 라벨, 빈 자료", () => {
  const events = mergeEvents({ research, newsLog, entities, hacks, newsItems, since: "2026-08-18" });
  const weeks = weeksEnding("2026-11-17", 13);
  const idx = compositeIndex(events, weeks);
  assert.match(indexChart([{ key: "KR", label: "국내", points: idx.KR }], weeks, { width: 600, components: idx.KR }), /width="600"[\s\S]*ic-comp comp-m/);
  assert.match(countChart([{ key: "KR", label: "국내", stats: weeklyStats(events, weeks, "KR") }], weeks, { width: 500 }), /ic-bar KR/);
  const usd = sizeChart(events, weeks, "usd", { width: 700 });
  assert.match(usd, /Binance \$6\.34B/);
  assert.doesNotMatch(sizeChart(events, weeks, "rec", { width: 700 }), /Vanderbilt/, "주장 숫자는 점으로 찍지 않는다");
});

test("피해 업권과 요약은 같은 관측 일수와 사건 범위를 사용한다", () => {
  const coverage = { since: "2026-08-20", until: "2026-11-19" };
  const weeks = weeksEnding(coverage.until);
  const events = [
    { d: "2026-08-20", r: "KR", org: "금융회사" },
    { d: "2026-09-01", r: "KR", org: "금융회사", usd: 0 },
    { d: "2026-11-19", r: "KR", org: "미분류", rec: 20, claim: true },
    { d: "2026-11-20", r: "KR", org: "금융회사" },
    { d: "2026-11-18", r: "GL", org: "금융회사", usd: 50 },
  ];
  const stats = summary(events, weeks, "KR", coverage);
  const rows = orgBreakdown(events, weeks, "KR", coverage);
  assert.equal(rows.reduce((sum, row) => sum + row.total, 0), 2);
  assert.equal(stats.total, 2);
  assert.equal(stats.recentPerWeek, 7 / 25);
  assert.equal(rows.find((r) => r.org === "기타").recent, stats.recentPerWeek);
  assert.equal(rows.find((r) => r.org === "금융회사").before, stats.beforePerWeek);
  assert.equal(stats.recKnown, 0);
  assert.equal(stats.usdKnown, 1);
  assert.equal(stats.usd, 0);
  assert.equal(stats.recentUsdKnown, 0);
  const shortCoverage = summary(events, weeks, "KR", { since: "2026-11-17", until: coverage.until });
  assert.equal(shortCoverage.beforePerWeek, null);
  assert.match(claimText(shortCoverage, "국내"), /앞선 기간의 집계 자료는 없습니다/);
});

test("원화 금전 피해: 금전 손실 문맥일 때만 읽고 환율로 환산", async () => {
  const { parseKrw, researchKrw, fromResearch } = await import("../src/incident-events.mjs");
  assert.equal(parseKrw("피해 자산 약100000000 KRW"), 1e8);
  assert.equal(parseKrw("KRW 2,000,000 상당"), 2e6);
  assert.equal(parseKrw("1억 2,000만원"), 1.2e8);
  assert.equal(parseKrw("200만원 상당 토큰"), 2e6);
  const base = { date: "2026-10-29", name: "x", region: "KR", sources: [] };
  assert.equal(researchKrw({ ...base, loss_or_outage: "약1억원 자산 피해", attack: "핫월렛 비정상 출금으로 가상자산 탈취", amount_note: "피해 자산 약100000000 KRW" }), 1e8);
  assert.equal(researchKrw({ ...base, loss_or_outage: null, attack: "개인정보 유출", amount_note: "투자 37억원" }), null, "금전 손실 문맥이 아니면 읽지 않는다");
  const [e] = fromResearch([{ ...base, loss_or_outage: "약1억원 자산 피해", attack: "가상자산 탈취", amount_note: "약100000000 KRW" }], { fx: 1250 });
  assert.equal(e.krw, 1e8);
  assert.equal(e.usd, 80000);
});
