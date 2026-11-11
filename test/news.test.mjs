import test from "node:test";
import assert from "node:assert/strict";
import { parseFeed, decodeBody, canonicalUrl, splitPublisher, classify, buildStockMatcher, mergeItems, similarity, assignGroups } from "../src/news.mjs";

test("parseFeed: RSS와 Atom, CDATA와 엔티티", () => {
  const rss = `<rss><channel><title>피드</title>
    <item><title><![CDATA[A사 해킹 &amp; 유출]]></title><link>https://example.com/a?utm_source=x</link><pubDate>Tue, 10 Nov 2026 01:00:00 GMT</pubDate><source url="https://p.example">매체</source><description>&lt;p&gt;본문&lt;/p&gt;</description></item>
    <item><title>링크 없음</title></item></channel></rss>`;
  const items = parseFeed(rss);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "A사 해킹 & 유출");
  assert.equal(items[0].date, "2026-11-10T01:00:00.000Z");
  assert.equal(items[0].source, "매체");
  assert.equal(items[0].summary, "본문");
  const atom = `<feed><entry><title>Breach at B</title><link href="https://example.org/b"/><updated>2026-11-09T00:00:00Z</updated></entry></feed>`;
  assert.equal(parseFeed(atom)[0].link, "https://example.org/b");
});

test("decodeBody: EUC-KR 선언을 따른다", () => {
  const eucKr = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="euc-kr"?><t>'), Buffer.from([0xc7, 0xd8, 0xc5, 0xb7]), Buffer.from("</t>")]);
  assert.ok(decodeBody(eucKr).includes("해킹"));
});

test("canonicalUrl: 추적 파라미터와 www 제거", () => {
  assert.equal(canonicalUrl("https://WWW.Example.com/a/?utm_source=x&id=3#top"), "https://example.com/a/?id=3");
});

test("splitPublisher: 매체명에 하이픈이 있어도 떼어 낸다", () => {
  assert.deepEqual(splitPublisher("SPH Media confirms data breach - Marketing-Interactive", "Marketing-Interactive"), { title: "SPH Media confirms data breach", publisher: "Marketing-Interactive" });
  assert.deepEqual(splitPublisher("금융보안원 해킹 피해 - 동아일보"), { title: "금융보안원 해킹 피해", publisher: "동아일보" });
  assert.deepEqual(splitPublisher("제목만 있음"), { title: "제목만 있음", publisher: "" });
});

test("classify: 사례, 정책, 지출, 기타", () => {
  assert.equal(classify("금융보안원 해킹으로 직원 정보 유출"), "incident");
  assert.equal(classify("개인정보 피해구제 이행결과 제출 의무화 법안 발의"), "policy");
  assert.equal(classify("4대 은행, 정보보호 예산 확대"), "spending");
  assert.equal(classify("Daylight raises $80 million in Series B"), "spending");
  assert.equal(classify("Senate passes bill to tighten regulation"), "policy");
  assert.equal(classify("Microsoft patches 1,094 flaws"), "other");
  assert.equal(classify("제목에 단서 없음", "", "policy"), "policy");
  assert.equal(classify("유출 기업에 과징금"), "incident");
});

test("buildStockMatcher: 한글은 앞 글자 경계, 영문은 단어 경계", () => {
  const match = buildStockMatcher([
    { id: "158430", name: "아톤", aliases: [] }, { id: "053800", name: "안랩", aliases: [] },
    { id: "CRWD", name: "크라우드스트라이크", nameEn: "CrowdStrike", aliases: [] }, { id: "FFIV", name: "F5", nameEn: "F5", aliases: ["F5 Networks"] },
  ]);
  assert.deepEqual(match("마라톤 대회 개최"), []);
  assert.deepEqual(match("아톤이 인증 사업 수주"), ["158430"]);
  assert.deepEqual(match("안랩, CrowdStrike와 협력"), ["053800", "CRWD"]);
  assert.deepEqual(match("CrowdStrikes again"), []);
  assert.deepEqual(match("F5 키를 눌러 새로고침"), []);
});

test("mergeItems: URL, 제목 중복과 유사 제목 제거, 보존 기간", () => {
  const now = Date.parse("2026-11-11T00:00:00Z");
  const item = (id, t, d, r = "KR") => ({ id, t, u: `https://e.com/${id}`, s: "매체", d, r, c: "incident", k: [] });
  const existing = [item("a", "금융보안원 해킹 피해 650여 건 유출", "2026-11-10T00:00:00Z"), item("old", "오래된 기사", "2026-01-01T00:00:00Z")];
  const incoming = [
    item("a", "금융보안원 해킹 피해 650여 건 유출", "2026-11-10T00:00:00Z"),
    item("b", "금융보안원 해킹 피해, 650여 건 유출 확인", "2026-11-10T03:00:00Z"),
    item("c", "쿠팡 과징금 취소 소송", "2026-11-10T05:00:00Z"),
    item("d", "금융보안원 해킹 피해 650여 건 유출", "2026-11-10T06:00:00Z", "GL"),
    item("future", "미래 기사", "2026-12-25T00:00:00Z"),
  ];
  const { items, added } = mergeItems(existing, incoming, { now });
  assert.deepEqual(items.map((row) => row.id), ["d", "c", "a"]);
  assert.equal(added, 2);
  assert.ok(similarity("금융보안원 해킹 피해 650여 건 유출", "금융보안원 해킹 피해, 650여 건 유출 확인") >= 0.5);
});

test("assignGroups: 같은 사건 기사는 한 묶음, 지역이나 기간이 다르면 따로", () => {
  const item = (id, t, d, r = "KR") => ({ id, t, d, r, c: "incident" });
  const items = [
    item("a", "금융보안원도 해킹에 뚫려…금융사 보안평가 정보 일부 유출", "2026-11-10T01:00:00Z"),
    item("b", "금융보안원도 해킹에 뚫려…금융사 직원 개인정보 300여건 유출", "2026-11-10T03:00:00Z"),
    item("c", "쿠팡 과징금 취소 소송 첫 변론", "2026-11-10T04:00:00Z"),
    item("d", "금융보안원도 해킹에 뚫려…금융사 보안평가 정보 일부 유출", "2026-11-10T05:00:00Z", "GL"),
    item("e", "금융보안원도 해킹에 뚫려…금융사 보안평가 정보 일부 유출 후속", "2026-11-20T05:00:00Z"),
  ];
  assert.equal(assignGroups(items), 4);
  assert.deepEqual(items.map((row) => row.g), ["a", "a", "c", "d", "e"]);
});
