import { krxDate } from "./sector-index.js";

export function currentMarketActivity(stocks, now = new Date()) {
  const date = krxDate(now.toISOString());
  const quotes = stocks.filter(stock => stock.kind === "KR").map(stock => stock.q);
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
    time: new Date(Math.min(...quotes.map(quote => Date.parse(quote.at)))).toISOString(),
  };
}
