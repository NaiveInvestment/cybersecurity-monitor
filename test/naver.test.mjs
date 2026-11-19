import test from "node:test";
import assert from "node:assert/strict";
import { parseDaily, parseFinance, fetchFinance, fetchRealtime } from "../src/naver.mjs";
import { financeMetrics } from "../public/lib/calc.js";

test("parseDaily: 날짜 형식과 정렬, 잘못된 행 제거", () => {
  const rows = parseDaily([
    { localDate: "20261103", closePrice: 113900 }, { localDate: "20261102", closePrice: 115900 },
    { localDate: "bad", closePrice: 1 }, { localDate: "20261104", closePrice: 0 },
  ]);
  assert.deepEqual(rows, [{ date: "2026-11-02", close: 115900 }, { date: "2026-11-03", close: 113900 }]);
});

test("parseFinance: 국내는 영업이익과 지배주주순이익, 컨센서스 열 표시", () => {
  const json = { financeInfo: {
    trTitleList: [{ isConsensus: "N", key: "202603" }, { isConsensus: "N", key: "202606" }, { isConsensus: "Y", key: "202609" }],
    rowList: [
      { title: "매출액", columns: { 202603: { value: "591" }, 202606: { value: "1,713" }, 202609: { value: "-" } } },
      { title: "영업이익", columns: { 202603: { value: "19" }, 202606: { value: "-54" }, 202609: { value: "-" } } },
      { title: "당기순이익", columns: { 202603: { value: "40" }, 202606: { value: "64" } } },
      { title: "지배주주순이익", columns: { 202603: { value: "51" }, 202606: { value: "74" } } },
    ],
  } };
  const parsed = parseFinance("KR", json);
  assert.equal(parsed.unit, "억원");
  assert.deepEqual(parsed.periods, [{ ym: "2026-03", consensus: false }, { ym: "2026-06", consensus: false }, { ym: "2026-09", consensus: true }]);
  assert.deepEqual(parsed.rev, [591, 1713, null]);
  assert.deepEqual(parsed.op, [19, -54, null]);
  assert.deepEqual(parsed.ni, [51, 74, null]);
});

test("parseFinance: 해외는 EBIT과 당기순이익, 통화 단위, 기간 오름차순", () => {
  const json = {
    unit: "USD(백만). %, 배 생략",
    trTitleList: [{ isConsensus: "N", key: "2026.07.31" }, { isConsensus: "N", key: "2026.04.30" }],
    rowList: [
      { title: "매출액", columns: { "2026.04.30": { value: "1,385.63" }, "2026.07.31": { value: "1,470.90" } } },
      { title: "EBIT", columns: { "2026.04.30": { value: "-29.20" }, "2026.07.31": { value: "-33.03" } } },
      { title: "당기순이익", columns: { "2026.04.30": { value: "27.77" }, "2026.07.31": { value: "5.31" } } },
    ],
  };
  const parsed = parseFinance("GL", json);
  assert.equal(parsed.unit, "USD");
  assert.deepEqual(parsed.periods.map((period) => period.ym), ["2026-04", "2026-07"]);
  assert.deepEqual(parsed.rev, [1385.63, 1470.9]);
  assert.deepEqual(parsed.op, [-29.2, -33.03]);
});

test("fetchFinance: HENNGE FY2026 4분기의 중복 원천값을 실제 공시로 정정", async () => {
  const periods = ["2025.12.31", "2026.03.31", "2026.06.30", "2026.09.30"];
  const json = {
    unit: "JPY(백만)",
    trTitleList: periods.map((key) => ({ key, isConsensus: "N" })),
    rowList: [
      ["매출액", [3015.76, 3113.09, 3260.89, 3260.89]],
      ["EBIT", [529.63, 738.28, 586.17, 586.17]],
      ["당기순이익", [365.97, 518.26, 477.07, 477.07]],
    ].map(([title, values]) => ({
      title,
      columns: Object.fromEntries(periods.map((key, index) => [key, { value: String(values[index]) }])),
    })),
  };
  const fetchImpl = async () => ({ ok: true, json: async () => json });
  const finance = await fetchFinance("GL", "4475.T", { fetchImpl });
  assert.deepEqual(finance.rev.slice(-2), [3260.89, 3392.024]);
  assert.deepEqual(finance.op.slice(-2), [586.17, 385.292]);
  assert.deepEqual(finance.ni.slice(-2), [477.07, 424.832]);
  const { ym, revTtm, opTtm, niTtm } = financeMetrics(finance);
  assert.deepEqual([ym, revTtm, opTtm, niTtm], ["2026-09", 12781.8, 2239.4, 1786.1]);
  assert.deepEqual(await fetchFinance("GL", "OTHER.T", { fetchImpl }), parseFinance("GL", json));

  json.rowList[0].columns[periods.at(-1)].value = "3392.02";
  assert.deepEqual(await fetchFinance("GL", "4475.T", { fetchImpl }), parseFinance("GL", json));
});

test("fetchRealtime: 40개씩 나눠 받고 코드로 묶는다", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const codes = url.split("/").pop().split(",");
    return { ok: true, json: async () => ({ datas: codes.map((code) => ({ itemCode: code, closePriceRaw: "100", fluctuationsRatioRaw: "1.5", compareToPreviousPrice: { name: "RISING" }, marketValueFullRaw: "100000000000" })) }) };
  };
  const codes = Array.from({ length: 45 }, (_, i) => String(100000 + i));
  const quotes = await fetchRealtime("KR", codes, { fetchImpl });
  assert.equal(calls.length, 2);
  assert.equal(Object.keys(quotes).length, 45);
  assert.equal(quotes["100000"].cap, 1000);
});
