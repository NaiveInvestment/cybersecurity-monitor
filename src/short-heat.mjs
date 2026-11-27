const positive = value => Number.isFinite(value) && value > 0;
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

export function parseRegularBars(rows) {
  const price = value => typeof value === "string" && value.trim() ? Math.abs(Number(value)) : NaN;
  return (rows || []).filter(row => /^\d{8}$/.test(row.dt)).map(row => ({
    date: row.dt.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"),
    close: price(row.cur_prc), high: price(row.high_pric), low: price(row.low_pric),
    value: price(row.trde_prica) * 1_000_000, volume: price(row.trde_qty),
  }));
}

export function shortHeatMetrics(krx, adjustedKrx, integrated, listedShares, date, { intraday = false } = {}) {
  const bars = krx.filter(row => row.date <= date && positive(row.volume))
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-41);
  if (bars.length !== 41 || bars.at(-1).date !== date ||
      new Set(bars.map(row => row.date)).size !== 41) return null;
  const previous = bars.slice(0, 40);
  const recent = bars.slice(-2);
  const adjustedByDate = new Map(adjustedKrx.map(row => [row.date, row.close]));
  const turnoverByDate = new Map(integrated.map(row => [row.date, row.value]));
  const volatility = ({ high, low }) => positive(low) && high >= low && Number.isFinite(high)
    ? (high - low) / ((high + low) / 2) : NaN;
  const turnover = ({ date, close }) => {
    const shares = listedShares.get(date);
    const value = turnoverByDate.get(date);
    return positive(shares) && positive(value) && positive(close) ? value / (close * shares) : NaN;
  };
  const ratio = indicator => {
    const baseline = mean(previous.map(indicator));
    const lastTwo = mean(recent.map(indicator));
    return positive(baseline) && Number.isFinite(lastTwo) ? lastTwo / baseline : null;
  };
  const close = bars.at(-1).close;
  const adjustedClose = intraday ? close : adjustedByDate.get(date);
  const adjustedHistory = previous.map(row => adjustedByDate.get(row.date));
  // Rebase adjusted history to the test date's original price scale.
  const scale = positive(close) && positive(adjustedClose) ? close / adjustedClose : null;
  const averageClose = scale && adjustedHistory.every(positive) ? mean(adjustedHistory) * scale : null;
  const alertBases = {};
  for (const days of [3, 5, 15]) {
    const anchor = previous.at(-days).date;
    const adjusted = adjustedByDate.get(anchor);
    if (scale && positive(adjusted)) alertBases[days] = { date: anchor, close: Math.round(adjusted * scale) };
  }
  const recentCloses = adjustedHistory.slice(-14);
  const high14 = scale && recentCloses.every(positive) ? Math.round(Math.max(...recentCloses) * scale) : null;
  return { date, close, averageClose, alertBases, high14,
    turnover: ratio(turnover), volatility: ratio(volatility) };
}
