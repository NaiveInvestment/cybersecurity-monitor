export function quoteMarket(stock) {
  if (stock.kind === "KR") return "KR";
  return stock.market === "TSE" ? "JP" : "US";
}

export function isNxtPremarket(timestamp) {
  const kst = new Date(timestamp + 9 * 3600000);
  const weekday = kst.getUTCDay() >= 1 && kst.getUTCDay() <= 5;
  return weekday && kst.getUTCHours() === 8 && kst.getUTCMinutes() < 50;
}

export function selectNxtPremarket(quotes, ids, now = Date.now()) {
  if (!quotes || !isNxtPremarket(now)) return null;
  const selected = {};
  for (const id of ids) {
    const quote = quotes[id];
    const at = Date.parse(quote?.at);
    if (!Number.isFinite(quote?.p) || quote.p <= 0 || !Number.isFinite(quote.chg) || quote.chg <= -100) continue;
    if (!isNxtPremarket(at) || at <= now - 50 * 60000 || at > now + 5000) continue;
    selected[id] = { p: quote.p, chg: quote.chg, at: quote.at };
  }
  return Object.keys(selected).length ? selected : null;
}

const names = { KR: "국내", JP: "일본", US: "미국" };

export function quoteStatus(stocks, payload, now = Date.now()) {
  const open = new Map();
  let latest = 0;
  let closed = false;
  for (const stock of stocks) {
    const row = payload?.q?.[stock.id];
    const useRow = row && (!stock.q?.at || Date.parse(row[5]) >= Date.parse(stock.q.at));
    const at = Date.parse(useRow ? row[5] : stock.q?.at);
    const validTime = at > 0 && at <= now + 5000 ? at : 0;
    const status = useRow ? row[6] : stock.q?.st;
    latest = Math.max(latest, validTime);
    if (status === "CLOSE") closed = true;
    if (status !== "OPEN") continue;
    const market = quoteMarket(stock);
    open.set(market, Math.max(open.get(market) || 0, validTime));
  }

  const time = latest ? new Date(latest).toISOString() : null;
  if (!open.size) return { time, label: closed ? "장마감" : "시세 확인 중", tone: closed ? "closed" : "delayed" };

  let oldest = Infinity;
  let delayedMarket;
  for (const [market, tradedAt] of open) {
    // Legacy and cloud feeds lack market-specific polling times. Their file
    // timestamp can only bound freshness alongside the market's own quote.
    const collectedAt = Date.parse(payload?.marketSuccessAt ? payload.marketSuccessAt[market] : payload?.asOf);
    const effective = collectedAt > 0 && collectedAt <= now + 5000 ? Math.min(collectedAt, tradedAt) : 0;
    if (effective < oldest) {
      oldest = effective;
      delayedMarket = market;
    }
  }
  const prefix = open.size > 1 ? names[delayedMarket] + " " : "";
  if (!oldest) return { time, label: prefix + "수집 확인 중", tone: "delayed" };
  const minutes = Math.floor((now - oldest) / 60000);
  if (minutes >= 3) return { time, label: prefix + "지연 " + minutes + "분", tone: "delayed" };
  return { time, label: "LIVE", tone: "live" };
}
