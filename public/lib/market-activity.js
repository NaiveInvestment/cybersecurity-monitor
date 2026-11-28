import { krxDate } from "./sector-index.js";

export const marketMonthRanges = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12 };

export function marketRangeStart(end, period) {
  return shiftMarketMonths(end, -marketMonthRanges[period]);
}

export function shiftMarketMonths(end, months) {
  const date = new Date(`${end}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const days = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, days));
  return date.toISOString().slice(0, 10);
}

export function currentMarketActivity(stocks, now = new Date()) {
  const date = krxDate(now.toISOString());
  const domestic = stocks.filter(stock => stock.kind === "KR");
  const quotes = domestic.map(stock => stock.q);
  if (!quotes.length || !quotes.every(quote => krxDate(quote?.at) === date)) return null;

  const caps = quotes.map(quote => quote.capKrw ?? quote.cap);
  const amounts = quotes.map(quote => quote.tv);
  const cap = caps.every(value => Number.isFinite(value) && value > 0)
    ? caps.reduce((sum, value) => sum + value, 0) : null;
  const turnover = amounts.every(value => Number.isFinite(value) && value >= 0)
    ? amounts.reduce((sum, value) => sum + value, 0) : null;
  if (cap == null && turnover == null) return null;

  return {
    date, cap, turnover, listed: quotes.length, live: true,
    constituents: cap == null ? null : Object.fromEntries(domestic.map((stock, index) => [stock.code ?? stock.id, caps[index]])),
    time: new Date(Math.min(...quotes.map(quote => Date.parse(quote.at)))).toISOString(),
  };
}
