import assert from "node:assert/strict";
import { test } from "node:test";
import { recentIncidentStories } from "../public/lib/recent-incidents.js";

const now = Date.UTC(2026, 10, 20, 2);
const hour = 3600000;
const article = (id, title, overrides = {}) => ({
  id, t: title, u: "https://news.example/" + id, d: new Date(now).toISOString(),
  s: "매체 " + id, c: "incident", r: "GL", g: id, ...overrides,
});

test("names a concrete breach or confirmed intrusion even when its impact is uncertain", () => {
  const headlines = [
    "배재대 해킹으로 학생과 교직원 개인정보 유출",
    "European Commission confirms cyberattack, investigation underway",
    "Chase confirms cyberattack that may have exposed customer data",
    "JP모건체이스, 협력업체 해킹 공식 발표…일부 고객 정보 노출 가능성",
    "다우오피스 PC메신저 업데이트 경로 해킹…기업 이용자 PC에 악성코드 설치",
    "[단독] 스웨즈락코리아 개인정보 침해사고…3만명 정보 영향",
    "Ethiopian Airlines investigates data breach affecting its loyalty programme",
    "Did Chase Bank Get Hacked? Firm Confirms Vendor Cyberattack Unrelated to Outage",
    "포항공대 해킹으로 개인정보 1만9천978건 유출",
    "Sunrise Hospital hit by ransomware",
  ];
  for (const title of headlines) assert.equal(recentIncidentStories([article("a", title)], now).length, 1, title);
});

test("excludes speculation, training, warnings, civil proceedings, statistics and market commentary", () => {
  const headlines = [
    "Nvidia Probes Possible Third-Party Breach",
    "Nvidia investigates an incident at a third-party partner after a ransomware gang lists it on its leak site",
    "병원 보안 담당자들 모의해킹 실전 경연",
    "PHP서 치명적 취약점 발견…웹사이트 해킹 경고등",
    "DotHouse Health Pays $725K to Settle Data Breach Lawsuit",
    "Tyler Robert Buchanan Gets 6 Years in $11.6M Crypto Hack Case",
    "Roper Center Data Breach Policy and Incident Response Plan",
    "The important lessons for CIOs from the Binance hack",
    "CJ대한통운 오네 챗봇 해킹됐나…개인정보 유출 여부 조사",
    "11만 건 금융정보 유출, AI 해킹 시대의 비용은 금융권이 감당할 수 있나",
    "정부 기관서 개인정보 유출되면 기관장도 문책",
    "경기도의회 운영위, 개인정보 유출 및 교육정책 연속성 점검",
    "GS건설, 개인정보 유출 3주 만에 자이 회원 조회 창구 개설",
    "Fabrikam has not confirmed a cyberattack",
    "Fabrikam would suffer a data breach if it fails to patch",
    "Fabrikam was hacked?",
    "BlackFog Report: Publicly Disclosed Ransomware Attacks Reach Highest Q3 Total on Record",
    "중앙은행 직원 실수로 개인정보 오발송…고객 정보 유출",
  ];
  for (const title of headlines) assert.equal(recentIncidentStories([article("a", title)], now).length, 0, title);
});

test("uses article publication time across regions, including exactly 24h and excluding future, stale and invalid dates", () => {
  const cases = [
    article("now", "한빛대 해킹으로 학생 정보 유출", { r: "KR" }),
    article("edge", "Fabrikam confirms cyberattack", { d: new Date(now - 24 * hour).toISOString() }),
    article("stale", "Western University confirms data breach", { d: new Date(now - 24 * hour - 1).toISOString() }),
    article("future", "Eastern University confirms data breach", { d: new Date(now + 1).toISOString() }),
    article("bad", "Tyne University confirms data breach", { d: "2026-xx-01" }),
    article("bad-url", "Other University confirms data breach", { u: "javascript:alert(1)" }),
  ];
  assert.deepEqual(recentIncidentStories(cases.reverse(), now).map((s) => s.id), ["now", "edge"]);
  assert.deepEqual(recentIncidentStories(cases, now + 25 * hour), []);
});

test("joins source regions for the same vendor report, splits unrelated victims inside reused group, and counts qualifying sources", () => {
  const recent = (id, title, hoursAgo, fields) => article(id, title, {
    d: new Date(now - hoursAgo * hour).toISOString(), ...fields,
  });
  const articles = [
    recent("a", "JP모건체이스, 협력업체 해킹 공식 발표", 1, { r: "KR", g: "kr" }),
    recent("b", "Chase confirms vendor cyberattack", 2, { g: "mixed" }),
    recent("c", "Othercorp confirms data breach", 3, { g: "mixed" }),
    recent("d", "Chase confirms vendor cyberattack", 4, { u: "https://news.example/b" }),
    recent("e", "Chase data breach lawsuit", 0, { g: "mixed" }),
    recent("old", "Chase confirms vendor cyberattack", 56, { g: "mixed" }),
  ];
  const stories = recentIncidentStories(articles.reverse(), now);
  assert.deepEqual(stories.map((s) => s.items.map((i) => i.id)), [["a", "b"], ["c"]]);
  assert.equal(stories[0].sources, 2);
  assert.equal(stories[0].count, 2);
  assert.equal(stories[0].last, stories[0].lead.d);
});
