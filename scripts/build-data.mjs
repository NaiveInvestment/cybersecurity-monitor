// 종목 스냅샷(data/snapshot.json) 생성: 실시간 시세 + 일봉 기준가 + 분기 재무.
// 사용: node scripts/build-data.mjs [--out _site/data] [--prev 이전 snapshot.json]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadUniverse, ROOT } from "../src/universe.mjs";
import { fetchRealtime, fetchIndexRealtime, fetchDaily, fetchFinance, mapLimit } from "../src/naver.mjs";
import { returnBases, financeMetrics, round } from "../public/lib/calc.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const outDir = option("--out", join(ROOT, "_site", "data"));
const prevPath = option("--prev", null);

const compact = (date) => date.toISOString().slice(0, 10).replaceAll("-", "");
const now = new Date();
const start = new Date(now);
start.setUTCDate(start.getUTCDate() - 400);
const range = { start: compact(start), end: compact(new Date(now.getTime() + 24 * 3600 * 1000)) };

// 시세 기준일: 체결 시각의 현지 날짜. 없으면 마지막 일봉 날짜.
const tradedDate = (quote, history) => quote?.at?.slice(0, 10) || history.at(-1)?.date || now.toISOString().slice(0, 10);

// 원천 재무의 의심 신호. 값을 고치지 않고 빌드 로그와 snapshot.warnings에 남겨 사람이 확인하게 한다.
function financeWarnings(stock, finance) {
  const found = [];
  const id = stock.id;
  const rows = finance.periods.map((period, at) => ({ ym: period.ym, consensus: period.consensus, rev: finance.rev[at], op: finance.op[at] }))
    .filter((row) => !row.consensus && row.rev != null);
  for (let at = 1; at < rows.length; at += 1) {
    const [before, current] = [rows[at - 1], rows[at]];
    if (before.rev === current.rev && before.op != null && before.op === current.op) found.push(`${id}: ${before.ym}와 ${current.ym}의 매출, 영업이익이 같음(복제값 의심)`);
    if (stock.kind === "GL" && before.rev > current.rev * 1.6 && at === 1) found.push(`${id}: ${before.ym} 매출 ${before.rev}가 다음 분기 ${current.rev}의 1.6배 초과(누적값 의심)`);
  }
  return found;
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function main() {
  const universe = loadUniverse();
  const domestic = universe.stocks.filter((stock) => stock.kind === "KR");
  const overseas = universe.stocks.filter((stock) => stock.kind === "GL");

  const [quotesKr, quotesGl, indexKr, indexGl] = await Promise.all([
    fetchRealtime("KR", domestic.map((stock) => stock.code)),
    fetchRealtime("GL", overseas.map((stock) => stock.code)),
    fetchIndexRealtime("KR", universe.indices.filter((index) => index.kind === "KR").map((index) => index.code)),
    fetchIndexRealtime("GL", universe.indices.filter((index) => index.kind === "GL").map((index) => index.code)),
  ]);

  const details = await mapLimit(universe.stocks, 6, async (stock) => {
    const [history, finance] = await Promise.all([
      fetchDaily(stock.kind, stock.code, range),
      fetchFinance(stock.kind, stock.code).catch((error) => ({ error: error.message })),
    ]);
    return { history, finance };
  });

  const errors = [];
  const warnings = [];
  const excluded = [];
  const stocks = universe.stocks.map((stock, index) => {
    const quote = (stock.kind === "KR" ? quotesKr : quotesGl)[stock.code] || null;
    const detail = details[index].value;
    if (details[index].error) errors.push(`${stock.id} 일봉: ${details[index].error}`);
    if (!quote) errors.push(`${stock.id} 시세 없음`);
    const history = detail?.history || [];
    const finance = detail?.finance && !detail.finance.error ? detail.finance : null;
    // 원천 값이 분기 값이 아닌 것으로 확인된 분기는 universe.json의 finExclude로 빼고 결측으로 둔다.
    if (finance && stock.finExclude) {
      finance.periods.forEach((period, at) => {
        if (stock.finExclude[period.ym]) { finance.rev[at] = null; finance.op[at] = null; finance.ni[at] = null; excluded.push(`${stock.id} ${period.ym}`); }
      });
    }
    if (finance) warnings.push(...financeWarnings(stock, finance));
    if (detail?.finance?.error) errors.push(`${stock.id} 재무: ${detail.finance.error}`);
    const metrics = finance ? financeMetrics(finance) : null;
    const { aliases, code, finExclude, ...publicFields } = stock;
    return {
      ...publicFields,
      q: quote,
      b: history.length ? returnBases(history, tradedDate(quote, history)) : null,
      f: metrics ? { ...metrics, unit: finance.unit } : null,
    };
  });

  // 환율은 네이버가 준 원화 환산 시총과 현지 통화 시총의 비율에서 얻는다(통화별 중앙값). 현지 통화 1단위당 원.
  const fx = { KRW: 1 };
  for (const cur of new Set(overseas.map((stock) => stock.cur))) {
    const ratios = stocks.filter((stock) => stock.cur === cur && stock.q?.cap > 0 && stock.q?.capKrw > 0)
      .map((stock) => (stock.q.capKrw * 1e8) / (stock.q.cap * 1e6));
    fx[cur] = round(median(ratios), 4);
  }

  const indices = {};
  for (const index of universe.indices) {
    const history = await fetchDaily(index.kind, index.code, { ...range, type: "index" }).catch((error) => {
      errors.push(`${index.id} 지수 일봉: ${error.message}`);
      return [];
    });
    const quote = (index.kind === "KR" ? indexKr : indexGl)[index.code] || null;
    if (!quote) errors.push(`${index.id} 지수 시세 없음`);
    indices[index.id] = { name: index.name, kind: index.kind, q: quote, b: history.length ? returnBases(history, tradedDate(quote, history)) : null };
  }

  const coverage = {
    total: stocks.length,
    quote: stocks.filter((stock) => stock.q).length,
    history: stocks.filter((stock) => stock.b).length,
    revenue: stocks.filter((stock) => stock.f?.rev != null).length,
    ttm: stocks.filter((stock) => stock.f?.revTtm != null).length,
  };

  // 채움률이 직전 산출물의 절반 아래로 떨어지면 실패시켜 직전 배포를 그대로 둔다.
  if (prevPath && existsSync(prevPath)) {
    const previous = JSON.parse(readFileSync(prevPath, "utf8")).coverage || {};
    for (const key of ["quote", "history", "revenue", "ttm"]) {
      if (previous[key] > 0 && coverage[key] < previous[key] / 2) {
        throw new Error(`채움률 급락: ${key} ${previous[key]} → ${coverage[key]}. 직전 산출물을 유지한다.`);
      }
    }
  }
  if (coverage.quote < coverage.total / 2) throw new Error(`시세 채움률 부족: ${coverage.quote}/${coverage.total}`);

  const snapshot = {
    generatedAt: now.toISOString(),
    source: "네이버 금융",
    universeAsOf: universe.asOf,
    segments: universe.segments,
    countries: universe.countries,
    fx, indices, coverage, errors, warnings, excluded, stocks,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "snapshot.json"), JSON.stringify(snapshot));
  console.log("snapshot", JSON.stringify(coverage), "fx", JSON.stringify(fx));
  if (errors.length) console.log("errors:\n  " + errors.join("\n  "));
  if (excluded.length) console.log(`제외한 분기(universe.json finExclude): ${excluded.join(", ")}`);
  if (warnings.length) console.log("warnings(원천 확인 필요):\n  " + warnings.join("\n  "));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
