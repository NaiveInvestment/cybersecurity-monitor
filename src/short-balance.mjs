import { addDays, marketDay } from "./market-warnings.mjs";

export const KRX_SHORT_BALANCE = "https://data.krx.co.kr/comm/srt/srtLoader/index.cmd?screenId=MDCSTAT305";
const origin = "https://data.krx.co.kr";
const headers = { "User-Agent": "Mozilla/5.0", Referer: KRX_SHORT_BALANCE, Origin: origin,
  "X-Requested-With": "XMLHttpRequest", Accept: "application/json, text/javascript, */*; q=0.01" };
const markets = { KOSPI: "1", KOSDAQ: "2", KONEX: "6" };
const dateKey = day => day.replaceAll("-", "");
const decimal = field => typeof field === "string" && /^\d[\d,]*(?:\.\d+)?$/.test(field)
  ? Number(field.replaceAll(",", "")) : NaN;

export function parseShortBalanceRows(body) {
  const rows = body?.OutBlock_1;
  if (!Array.isArray(rows)) throw new Error("KRX 공매도 잔고 응답 형식 확인 필요");
  if (!rows.every(row => /^[A-Z0-9]{6}$/.test(row.ISU_CD)) ||
      new Set(rows.map(row => row.ISU_CD)).size !== rows.length) {
    throw new Error("KRX 공매도 잔고 종목코드 확인 필요");
  }
  return rows;
}

export function stockShortBalance(row) {
  const amount = decimal(row.BAL_AMT), cap = decimal(row.MKTCAP), shares = decimal(row.BAL_QTY);
  const listed = decimal(row.LIST_SHRS), reported = decimal(row.BAL_RTO);
  const ratio = 100 * (amount / cap);
  if (![amount, cap, shares, listed].every(Number.isSafeInteger) || cap <= 0 || listed <= 0 ||
      shares > listed || amount > cap || !Number.isFinite(reported) ||
      Math.abs(ratio - reported) > 0.011 || Math.abs(ratio - 100 * shares / listed) > 0.011) return null;
  return { ratio, amount, cap, shares };
}

async function marketRows(market, day, request) {
  const body = new URLSearchParams({ bld: "dbms/MDC_OUT/STAT/srt/MDCSTAT30501_OUT", locale: "ko_KR",
    searchType: "1", mktTpCd: market, trdDd: dateKey(day), share: "1", money: "1", csvxls_isNo: "false" });
  const response = await request(new URL("/comm/bldAttendant/getJsonData.cmd", origin), {
    method: "POST", headers,
    signal: AbortSignal.timeout(10000), body,
  });
  if (!response.ok) throw new Error(`KRX 공매도 잔고 HTTP ${response.status}`);
  return parseShortBalanceRows(await response.json());
}

export async function fetchShortBalance(stocks, now = Date.now(), request = fetch) {
  const marketsToFetch = [...new Set(stocks.map(stock => stock.market))];
  const today = marketDay(now);
  for (let offset = 2; offset <= 10; offset++) {
    const asOf = addDays(today, -offset);
    if ([0, 6].includes(new Date(asOf).getUTCDay())) continue;
    const all = await Promise.all(marketsToFetch.map(async market => [market, await marketRows(markets[market], asOf, request)]));
    if (!all.every(([, rows]) => rows.length)) continue;
    const sources = Object.fromEntries(all.map(([market, rows]) => [market,
      new Map(rows.map(row => [row.ISU_CD, row]))]));
    const matches = stocks.flatMap(stock => {
      const raw = sources[stock.market].get(stock.code);
      if (!raw) return [];
      const data = stockShortBalance(raw);
      if (!data) throw new Error(`KRX 공매도 잔고 값 확인 필요: ${stock.code}`);
      return [[stock.id, data]];
    });
    return { asOf, source: KRX_SHORT_BALANCE, stocks: Object.fromEntries(matches) };
  }
  throw new Error("최근 공매도 잔고 미공개");
}
