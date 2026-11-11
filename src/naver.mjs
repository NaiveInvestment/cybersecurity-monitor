// 네이버 금융 공개 엔드포인트 수집기. 키가 필요 없어 GitHub Actions에서 그대로 돈다.
// 구조는 홍대현 Universe의 src/providers/naver.mjs를 따르되, 일괄 시세와 해외 종목, 분기 재무를 더했다.
import { toNum, normalizeQuote } from "../public/lib/calc.js";

const HEADERS = {
  accept: "application/json, text/plain, */*",
  referer: "https://m.stock.naver.com/",
  "user-agent": "Mozilla/5.0 (compatible; cybersecurity-monitor/1.0)",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getJson(url, { attempts = 3, fetchImpl = fetch } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(600 * attempt);
    }
  }
  throw new Error(`${url}: ${lastError.message}`);
}

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

// kind: "KR"(국내) | "GL"(해외). 반환: { 코드: 정규화 시세 }
export async function fetchRealtime(kind, codes, options = {}) {
  const path = kind === "KR" ? "domestic" : "worldstock";
  const output = {};
  for (const group of chunk(codes, 40)) {
    const json = await getJson(`https://polling.finance.naver.com/api/realtime/${path}/stock/${group.join(",")}`, options);
    for (const row of json?.datas || []) {
      const code = kind === "KR" ? row.itemCode : row.reutersCode;
      const quote = normalizeQuote(kind, row);
      if (code && quote) output[code] = quote;
    }
  }
  return output;
}

// 지수 실시간. 반환: { 코드: { p, chg, at, st } }
export async function fetchIndexRealtime(kind, codes, options = {}) {
  const path = kind === "KR" ? "domestic" : "worldstock";
  const json = await getJson(`https://polling.finance.naver.com/api/realtime/${path}/index/${codes.join(",")}`, options);
  const output = {};
  for (const row of json?.datas || []) {
    const code = kind === "KR" ? row.itemCode : row.reutersCode;
    const quote = normalizeQuote(kind, row);
    if (code && quote) output[code] = { p: quote.p, chg: quote.chg, at: quote.at, st: quote.st };
  }
  return output;
}

export function parseDaily(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      date: String(row.localDate || "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"),
      close: toNum(row.closePrice),
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.close != null && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// 일봉 종가(수정주가). type: "item" | "index"
export async function fetchDaily(kind, code, { start, end, type = "item", ...options } = {}) {
  const market = kind === "KR" ? "domestic" : "foreign";
  const url = `https://api.stock.naver.com/chart/${market}/${type}/${encodeURIComponent(code)}/day?startDateTime=${start}&endDateTime=${end}`;
  return parseDaily(await getJson(url, options));
}

function ymOf(key) {
  const text = String(key);
  const compact = /^(\d{4})(\d{2})$/.exec(text);
  if (compact) return `${compact[1]}-${compact[2]}`;
  const dotted = /^(\d{4})\.(\d{2})/.exec(text);
  return dotted ? `${dotted[1]}-${dotted[2]}` : null;
}

// 분기 재무 응답을 { unit, periods, rev, op, ni }로. 국내는 억원, 해외는 현지 통화 백만.
// 영업이익: 국내 "영업이익", 해외 "EBIT". 순이익: 국내 "지배주주순이익"(없으면 "당기순이익"), 해외 "당기순이익".
export function parseFinance(kind, json) {
  const info = kind === "KR" ? json?.financeInfo : json;
  const titles = info?.trTitleList || [];
  const columns = Object.fromEntries((info?.rowList || []).map((row) => [row.title, row.columns || {}]));
  const periods = titles.map((title) => ({ key: title.key, ym: ymOf(title.key), consensus: title.isConsensus === "Y" }))
    .filter((period) => period.ym);
  const series = (title) => periods.map((period) => toNum(columns[title]?.[period.key]?.value));
  const hasAny = (values) => values.some((value) => value != null);
  const rev = series("매출액");
  const op = series(kind === "KR" ? "영업이익" : "EBIT");
  const owner = series("지배주주순이익");
  const ni = kind === "KR" && hasAny(owner) ? owner : series("당기순이익");
  const order = periods.map((_, index) => index).sort((a, b) => periods[a].ym.localeCompare(periods[b].ym));
  const pick = (values) => order.map((index) => values[index]);
  return {
    unit: kind === "KR" ? "억원" : String(info?.unit || "").split("(")[0] || null,
    periods: order.map((index) => ({ ym: periods[index].ym, consensus: periods[index].consensus })),
    rev: pick(rev), op: pick(op), ni: pick(ni),
  };
}

export async function fetchFinance(kind, code, options = {}) {
  const url = kind === "KR"
    ? `https://m.stock.naver.com/api/stock/${code}/finance/quarter`
    : `https://api.stock.naver.com/stock/${encodeURIComponent(code)}/finance/quarter`;
  return parseFinance(kind, await getJson(url, options));
}

// 동시 실행 수를 제한한 map. 개별 실패는 { error }로 남기고 전체는 계속한다.
export async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { value: await task(items[index], index) };
      } catch (error) {
        results[index] = { error: error.message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
