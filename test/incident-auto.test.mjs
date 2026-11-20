import test from "node:test";
import assert from "node:assert/strict";
import { koSubject, enSubject, autoDetect } from "../src/incident-auto.mjs";
import { sameName, kstDay, mergeEvents } from "../src/incident-events.mjs";

test("koSubject: 제목 첫머리 기관명, 일반명사와 부사형은 뺀다", () => {
  assert.equal(koSubject("[단독] 메가MGC커피 고객정보 유출…수탁사 해킹"), "메가MGC커피");
  assert.equal(koSubject("KB캐피탈, 해킹으로 1,811명 유출"), "KB캐피탈");
  assert.equal(koSubject("NHN두레이 개인정보 유출 확인"), "NHN두레이");
  assert.equal(koSubject("삼성도 털렸다…멀티캠퍼스 유출"), "삼성");
  assert.equal(koSubject("대학마다 다 털렸다, 해킹 공격 비상"), null);
  assert.equal(koSubject("정부, 해킹 피해 조사"), null);
  assert.equal(koSubject("TSMC, SEC에 개인정보 유출 공시"), null, "국내 기사 속 영문 해외 기업은 국내 사건으로 잡지 않는다");
  for (const title of ["금융사 IT자산 관리 의무화…침해사고 40건이 불렀다", "도내 대학 위탁관리 서버 잇단 해킹", "모바일 지역사랑상품권 앱 개인정보 유출", "대구경북권 대학서 해킹 피해 잇따라"]) assert.equal(koSubject(title), null, title);
  assert.equal(koSubject('이영남 서울시의원 "따릉이 462만명 정보 유출에도 9개월째 관리자 징계 없어"'), null);
  for (const name of ["충남", "충남도", "충청남도"]) assert.equal(koSubject(`${name} 지역화폐 개인정보 유출`), "충청남도");
});

test("enSubject: 동사 앞 고유명사", () => {
  assert.equal(enSubject("Expedia confirms data breach following supply chain attack"), "Expedia");
  assert.equal(enSubject("Hong Kong Metropolitan University reports data breach"), "Hong Kong Metropolitan University");
  assert.equal(enSubject("Worrying data breach at CAL"), null);
  assert.equal(enSubject("Hackers claim breach of retailer"), null);
  assert.equal(enSubject("Gentlemen ransomware gang involved in alleged breach of NVIDIA's systems"), null, "공격 조직 이름은 피해 기관이 아니다");
  assert.equal(enSubject("AI-assisted cyberattack hit EU executive in October"), null);
});

test("koSubject: 나라 머리말과 업권 일반명사", () => {
  assert.equal(koSubject("日기업들, 이용 끝난 개인정보 쌓아뒀다 해킹에 줄줄이 유출"), null);
  assert.equal(koSubject("저축은행 직원 정보 유출"), null);
  assert.equal(koSubject("포항공대 해킹으로 개인정보 1만9천978건 유출"), "포항공대");
});

test("autoDetect: 묶음 기사, 업계 동향, 대응 기사 제외", () => {
  const titles = ["[해킹 경보④] 쿠팡 이어 G마켓·SSG닷컴도 털렸다", "부산대 등 대학가 해킹 잇따라…개인정보 1천여 건 유출", "연쇄 해킹에 놀란 은행권, ‘화이트해커' 모시기 경쟁", "인사혁신처, 공공기관 개인정보 유출 땐 기관장도 책임… 공무원 징계 수위 높인다", "SK쉴더스, 국제 보안 콘퍼런스서 랜섬웨어 공격 경로 공개", "충남도, 개인정보 유출 2차 피해 최소화 ‘총력’", "Satya Nadella says much critical infrastructure is 'unpatchable' amid AI cyberattack fears", "Lessons to learn from a first-of-its-kind cyberattack on a European wind farm", "소프트99, 위탁 시스템 침해로 주문정보 3813명 유출"];
  const items = titles.map((t, i) => item(`x${i}`, t, `매체${i}`));
  const stories = items.map((it, i) => story(`s${i}`, /[가-힣]/.test(it.t) ? "KR" : "GL", "2026-11-19T01:00:00Z", 1, [it.id], it.t));
  const found = autoDetect(stories, new Map(items.map((i) => [i.id, i])), { after: "2026-11-17", sameName, kstDay });
  assert.deepEqual(found.map((f) => f.name), ["소프트99"]);
});

test("mergeEvents: 한 매체뿐인 자동 감지는 그 제목 숫자, 확정 전 표현은 집계 제외", () => {
  const newsItems = [{ id: "p1", t: "포항공대 해킹으로 개인정보 1만9천978건 유출", s: "가", u: "https://n/p1" }, { id: "q1", t: "라쿠텐증권 해킹…최대 447만명 정보 유출 우려", s: "나", u: "https://n/q1" }];
  const newsLog = [{ id: "p", r: "KR", f: "2026-11-19T01:00:00Z", s: 1, m: ["p1"], t: newsItems[0].t, u: "https://n/p" }, { id: "q", r: "KR", f: "2026-11-19T02:00:00Z", s: 1, m: ["q1"], t: newsItems[1].t, u: "https://n/q" }];
  const events = mergeEvents({ research: [], newsLog, newsItems, since: "2026-08-18", researchUntil: "2026-11-17" });
  const p = events.find((e) => e.n === "포항공대"), q = events.find((e) => e.n === "라쿠텐증권");
  assert.equal(p.rec, 19978);
  assert.equal(p.claim, false);
  assert.equal(p.basis, "보도(1개 매체 제목)");
  assert.equal(q.rec, 4470000);
  assert.equal(q.claim, true);
});

const story = (id, r, f, s, m, t) => ({ id, r, f, s, m, t, u: `https://x/${id}` });
const item = (id, t, s) => ({ id, t, s, u: `https://x/${id}` });

test("autoDetect: 마감 뒤, 사건 낱말, 해설과 해킹 아님 제외, 같은 이름 중복 제거", () => {
  const items = [
    item("a1", "메가MGC커피 고객정보 유출…수탁사 해킹", "가"), item("a2", "메가MGC커피, 고객 30명 연락처 유출", "나"),
    item("b1", "메가MGC커피 고객센터 해킹…개인정보 유출", "다"),
    item("c1", "[기자수첩] 해킹 대책 시급", "라"),
    item("d1", "Coles reports no data breach as investigation continues", "E"),
    item("e1", "레고랜드 코리아 고객정보 유출…예약시스템 해킹", "마"),
    item("f1", "이전 사건 유출", "바"),
    item("g1", "Coles reports customer data breach, no signs of cyberattack", "G"),
    item("h1", "이영남 서울시의원, 따릉이 관리와 개인정보 유출 질타", "아"),
  ];
  const byId = new Map(items.map((i) => [i.id, i]));
  const stories = [
    story("a", "KR", "2026-11-18T01:00:00Z", 2, ["a1", "a2"], items[0].t),
    story("b", "KR", "2026-11-19T01:00:00Z", 1, ["b1"], items[2].t),
    story("c", "KR", "2026-11-18T01:00:00Z", 1, ["c1"], items[3].t),
    story("d", "GL", "2026-11-18T01:00:00Z", 1, ["d1"], items[4].t),
    story("e", "KR", "2026-11-18T01:00:00Z", 1, ["e1"], items[5].t),
    story("f", "KR", "2026-11-10T01:00:00Z", 1, ["f1"], items[6].t),
    story("g", "GL", "2026-11-18T01:00:00Z", 1, ["g1"], items[7].t),
    story("h", "KR", "2026-11-18T01:00:00Z", 1, ["h1"], items[8].t),
  ];
  const found = autoDetect(stories, byId, { after: "2026-11-17", known: [{ n: "레고랜드", r: "KR", d: "2026-11-17" }], sameName, kstDay });
  assert.deepEqual(found.map((f) => f.name), ["메가MGC커피", "Coles"]);
});

test("mergeEvents: 자동 감지는 리서치 마감 다음 날부터, 표시와 제목 숫자", () => {
  const newsLog = [{ id: "z", r: "KR", f: "2026-11-18T01:00:00Z", s: 2, m: ["z1", "z2"], t: "번개장터, 개인정보 유출 49건", u: "https://n/z" }];
  const newsItems = [{ id: "z1", t: "번개장터, 고객 개인정보 49건 유출", s: "가", u: "https://n/z1" }, { id: "z2", t: "번개장터 해킹 사고 확인…전화번호 49건 유출", s: "나", u: "https://n/z2" }];
  const events = mergeEvents({ research: [], newsLog, newsItems, since: "2026-08-18", researchUntil: "2026-11-17" });
  assert.equal(events.length, 1);
  assert.equal(events[0].via, "자동 감지");
  assert.equal(events[0].n, "번개장터");
  assert.equal(events[0].rec, 49);
  assert.equal(mergeEvents({ research: [], newsLog, newsItems, since: "2026-08-18", researchUntil: "2026-11-20" }).length, 0);
});
