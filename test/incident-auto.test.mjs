import test from "node:test";
import assert from "node:assert/strict";
import { koSubject, enSubject, autoDetect } from "../src/incident-auto.mjs";
import { sameName, kstDay, mergeEvents } from "../src/incident-events.mjs";
import { NOT_INCIDENT } from "../public/lib/incident-trend.js";

test("koSubject: 제목 첫머리 기관명, 일반명사와 부사형은 뺀다", () => {
  assert.equal(koSubject("[단독] 메가MGC커피 고객정보 유출…수탁사 해킹"), "메가MGC커피");
  assert.equal(koSubject("KB캐피탈, 해킹으로 1,811명 유출"), "KB캐피탈");
  assert.equal(koSubject("NHN두레이 개인정보 유출 확인"), "NHN두레이");
  assert.equal(koSubject("삼성도 털렸다…멀티캠퍼스 유출"), "삼성");
  assert.equal(koSubject("대학마다 다 털렸다, 해킹 공격 비상"), null);
  assert.equal(koSubject("정부, 해킹 피해 조사"), null);
  assert.equal(koSubject("TSMC, SEC에 개인정보 유출 공시"), null, "국내 기사 속 영문 해외 기업은 국내 사건으로 잡지 않는다");
});

test("enSubject: 동사 앞 고유명사", () => {
  assert.equal(enSubject("Expedia confirms data breach following supply chain attack"), "Expedia");
  assert.equal(enSubject("Hong Kong Metropolitan University reports data breach"), "Hong Kong Metropolitan University");
  assert.equal(enSubject("Worrying data breach at CAL"), null);
  assert.equal(enSubject("Hackers claim breach of retailer"), null);
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
  ];
  const byId = new Map(items.map((i) => [i.id, i]));
  const stories = [
    story("a", "KR", "2026-11-18T01:00:00Z", 2, ["a1", "a2"], items[0].t),
    story("b", "KR", "2026-11-19T01:00:00Z", 1, ["b1"], items[2].t),
    story("c", "KR", "2026-11-18T01:00:00Z", 1, ["c1"], items[3].t),
    story("d", "GL", "2026-11-18T01:00:00Z", 1, ["d1"], items[4].t),
    story("e", "KR", "2026-11-18T01:00:00Z", 1, ["e1"], items[5].t),
    story("f", "KR", "2026-11-10T01:00:00Z", 1, ["f1"], items[6].t),
  ];
  const found = autoDetect(stories, byId, { after: "2026-11-17", known: [{ n: "레고랜드", r: "KR", d: "2026-11-17" }], sameName, kstDay, notIncident: NOT_INCIDENT });
  assert.deepEqual(found.map((f) => f.name), ["메가MGC커피"]);
});

test("mergeEvents: 자동 감지는 리서치 마감 다음 날부터, 표시와 제목 숫자", () => {
  const newsLog = [{ id: "z", r: "KR", f: "2026-11-18T01:00:00Z", s: 2, m: ["z1", "z2"], t: "번개장터, 개인정보 유출 49건", u: "https://n/z" }];
  const newsItems = [{ id: "z1", t: "번개장터, 고객 개인정보 49건 유출", s: "가", u: "https://n/z1" }, { id: "z2", t: "번개장터 해킹 사고 확인…전화번호 49건 유출", s: "나", u: "https://n/z2" }];
  const events = mergeEvents({ research: [], newsLog, newsItems, since: "2026-08-18", researchUntil: "2026-11-17", notIncident: NOT_INCIDENT });
  assert.equal(events.length, 1);
  assert.equal(events[0].via, "자동 감지");
  assert.equal(events[0].n, "번개장터");
  assert.equal(events[0].rec, 49);
  assert.equal(mergeEvents({ research: [], newsLog, newsItems, since: "2026-08-18", researchUntil: "2026-11-20", notIncident: NOT_INCIDENT }).length, 0);
});
