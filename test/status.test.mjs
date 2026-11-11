import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { statusTone } from "../public/lib/status.js";
import { ROOT } from "../src/universe.mjs";

test("statusTone: 예정과 진행 중은 계획 색, 끝난 것만 완료 색", () => {
  assert.equal(statusTone("시행 예정"), "plan");
  assert.equal(statusTone("시행"), "done");
  assert.equal(statusTone("발표, 과제별 이행"), "plan");
  assert.equal(statusTone("규칙 심사 중"), "plan");
  assert.equal(statusTone("제소"), "plan");
  assert.equal(statusTone("수사 의뢰"), "plan");
  assert.equal(statusTone("제재 의결"), "done");
  assert.equal(statusTone("결성 완료"), "done");
  assert.equal(statusTone("종결"), "done");
  assert.equal(statusTone("회사 공지"), "");
  assert.equal(statusTone(undefined), "");
});

test("cards: 아직 적용 전이거나 소송 중인 카드는 완료 색이 아니다", () => {
  const { cards } = JSON.parse(readFileSync(join(ROOT, "data", "curated", "cards.json"), "utf8"));
  const tone = (id) => statusTone(cards.find((card) => card.id === id).status);
  assert.equal(tone("kr-2026-disclosure-expansion"), "plan");
  assert.equal(tone("gl-2026-eu-nis2-court-referral"), "plan");
  assert.equal(tone("gl-2026-proofpoint-varonis"), "plan");
  assert.equal(tone("gl-2026-google-wiz-close"), "done");
  assert.equal(tone("kr-2026-pipa-10pct"), "done");
});
