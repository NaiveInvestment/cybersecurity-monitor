export function financialRow(stock, period, horizon = "threeMonth", type = "annual") {
  const row = stock?.[type]?.[period];
  if (!row) return null;
  return row.kind === "estimate" ? row.horizons?.[horizon] || null : row;
}
export function annualValuation(stock, period, cap, horizon = "threeMonth") {
  const row = financialRow(stock, period, horizon);
  const previous = financialRow(stock, String(Number(period)-1), horizon);
  const ratio = denominator => !(cap > 0) || !Number.isFinite(cap) || denominator == null ? null : denominator <= 0 ? "N/M" : cap/denominator;
  const ni = row?.parentNetIncome, eq = row?.parentEquity, prevEq = previous?.parentEquity;
  return {pe:ratio(ni), pb:ratio(eq), roe:ni==null||eq==null||prevEq==null?null:ni<=0||eq<=0||prevEq<=0?"N/M":ni/((eq+prevEq)/2)*100};
}
