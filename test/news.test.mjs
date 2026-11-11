import test from "node:test";
import assert from "node:assert/strict";
import { parseFeed, decodeBody, canonicalUrl, splitPublisher, classify, buildStockMatcher, mergeItems, similarity, assignGroups, anchorTokens } from "../src/news.mjs";

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

test("anchorTokens: 조사를 떼고 일반어는 뺀다", () => {
  assert.deepEqual([...anchorTokens("[단독] '금융보안 문지기' 금융보안원도 해킹으로 개인정보 유출")].sort(), ["금융보안", "금융보안원"]);
  assert.deepEqual([...anchorTokens("Vanderbilt University hit by ransomware attack")], ["vanderbilt"]);
  assert.deepEqual([...anchorTokens("개인정보위, 랜섬웨어 대응 가이드라인 발표")], []);
  assert.deepEqual([...anchorTokens("4대 은행, 내년 정보보호 예산 확대")], ["4대은행"]);
  assert.deepEqual([...anchorTokens("해킹 피해 확산에 금융 당국 긴급 점검")], []);
});

test("assignGroups: 제목이 달라도 같은 기관을 다룬 묶음은 합친다", () => {
  const item = (id, t, d, c = "incident") => ({ id, t, d, r: "KR", c });
  const items = [
    item("a", "금융보안원도 해킹에 뚫려…금융사 보안평가 정보 일부 유출", "2026-11-10T01:00:00Z"),
    item("a2", "금융보안원도 해킹에 뚫려…금융사 직원 개인정보 300여건 유출", "2026-11-10T01:30:00Z"),
    item("a3", "금융보안원도 해킹에 뚫렸다...금융사 정보 유출", "2026-11-10T02:00:00Z"),
    item("b", "'금융보안 문지기' 금융보안원까지 해킹당했다", "2026-11-10T03:00:00Z"),
    item("c", "해킹당한 금융보안원 850여 건 정보 유출", "2026-11-11T01:00:00Z"),
    item("x", "카스퍼스키, 6개월간 해킹 툴 217만건 탐지", "2026-11-10T03:00:00Z"),
    item("y", "카스퍼스키 보안 도구가 해킹툴로 악용", "2026-11-10T05:00:00Z"),
    item("d", "금융보안원, 2026 금융 AI 챌린지 마무리", "2026-11-10T02:00:00Z", "policy"),
    item("e", "쿠팡 과징금 취소 소송 첫 변론", "2026-11-10T04:00:00Z"),
    item("f", "금융보안원 조직 개편 발표", "2026-10-01T04:00:00Z"),
  ];
  assignGroups(items);
  const group = (id) => items.find((row) => row.id === id).g;
  assert.equal(group("a"), "a");
  assert.equal(group("a3"), "a");
  assert.equal(group("b"), "a");   // 제목은 달라도 기준 묶음의 주체 낱말(금융보안원)을 가진 기사
  assert.equal(group("c"), "a");
  assert.equal(group("x"), "x");   // 작은 묶음끼리는 낱말 하나로 합치지 않는다
  assert.equal(group("y"), "y");
  assert.equal(group("d"), "d");   // 범주가 다르면 따로
  assert.equal(group("e"), "e");
  assert.equal(group("f"), "f");
});

test("assignGroups: 틀만 같은 영문 제목은 다른 회사 사건이면 합치지 않는다", () => {
  const item = (id, t, d = "2026-11-11T00:00:00Z") => ({ id, t, d, r: "GL", c: "incident" });
  const items = [
    item("w", "WireCo Data Breach Exposes Sensitive Employee Information"),
    item("c", "Cirrus Aircraft Data Breach Exposes Sensitive Personal and Health Information", "2026-11-11T01:00:00Z"),
    item("a", "Amplifon Americas discloses data breach affecting sensitive customer information", "2026-11-11T02:00:00Z"),
    item("l", "Lansing Urgent Care Data Breach Exposes Social Security Numbers", "2026-11-11T03:00:00Z"),
    item("h", "Hearing aid giant Amplifon reveals data breach hits thousands of US customers — Social Security numbers and medical information stolen", "2026-11-11T04:00:00Z"),
    item("x", "Hackers Exploit Critical Xen Orchestra Auth Bypass Flaw to Gain Admin Access", "2026-11-11T05:00:00Z"),
    item("b", "Hackers now exploit critical Barracuda ESG flaws to gain root access", "2026-11-11T06:00:00Z"),
    item("f", "The Atlantic Federal Credit Union Data Breach Exposes SSNs", "2026-11-11T07:00:00Z"),
    item("s", "Santa Barbara Endodontics Data Breach: SSNs and Health Records Exposed", "2026-11-11T08:00:00Z"),
    item("v1", "Vanderbilt University shuts down devices after cyber attack", "2026-11-11T09:00:00Z"),
    item("v2", "Vanderbilt University shuts down campus devices after cyberattack", "2026-11-11T10:00:00Z"),
  ];
  assignGroups(items);
  const group = (id) => items.find((row) => row.id === id).g;
  for (const id of ["w", "c", "l", "x", "b", "f", "s"]) assert.equal(group(id), id, id);
  assert.notEqual(group("a"), "w");
  assert.notEqual(group("h"), "l");
  assert.equal(group("v2"), "v1");   // 같은 사건은 여전히 묶인다
});

test("anchorTokens: 약칭은 본 이름으로", () => {
  assert.ok(anchorTokens("금보원, 해킹으로 정보 유출").has("금융보안원"));
});
