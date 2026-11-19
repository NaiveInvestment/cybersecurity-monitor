import test from "node:test";
import assert from "node:assert/strict";
import { translateHeadlines } from "../src/headline-translations.mjs";

test("cache and editorial reuse match the source title, never just the URL", async () => {
  const previous = [{ u: "link", t: "Old title", tKo: "이전 번역", lang: "en" }];
  const items = [{ u: "link", t: "Different title" }, { u: "duplicate", t: "Different title" },
    { t: "Old title" }, { t: "클라우드 서비스 발표" }, { t: "Revue des attaques" }];
  const result = await translateHeadlines(items, {
    previous, corrections: { "Old title": "검토한 번역" },
    translate: async (titles) => {
      assert.deepEqual(titles, ["Different title", "Revue des attaques"]);
      return { "Different title": "다른 제목" };
    },
  });
  assert.deepEqual(result, { english: 3, translated: 3 });
  assert.equal(items[0].t, "Different title");
  assert.equal(items[1].tKo, "다른 제목");
  assert.equal(items[2].tKo, "검토한 번역");
  assert.ok(!items[3].lang && !items[4].lang);
});

test("warm feed continues through a translator outage, retries missing translations on recovery", async () => {
  const previous = [{ t: "Bank confirms theft", lang: "en", tKo: "은행이 도난을 확인" }];
  const items = [...previous, { t: "City confirms cyberattack" }];
  const failure = async () => { throw new Error("model unavailable"); };
  let warnings = 0;
  const options = { previous, corrections: {}, translate: failure, warn: () => { warnings++; } };
  assert.deepEqual(await translateHeadlines(items, options), { english: 2, translated: 1 });
  assert.equal(warnings, 1);
  assert.equal(items[1].lang, "en");
  assert.equal(items[1].tKo, undefined);
  await assert.rejects(translateHeadlines(items, { ...options, previous: [] }), /unavailable/);
  await translateHeadlines(items, { previous: items, corrections: {}, translate: async () => ({ "City confirms cyberattack": "시 당국이 사이버 공격을 확인" }) });
  assert.ok(items[1].tKo);
});
