// OpenDART 원 단위. 직전 연간 실적에 올해와 전년 동기 누적 차이를 더한다.
export function filingTtmWon(line) {
  const { priorYear, currentYtd, priorYtd } = line ?? {};
  if (![priorYear, currentYtd, priorYtd].every(Number.isSafeInteger)) return null;
  const total = priorYear - priorYtd + currentYtd;
  return Number.isSafeInteger(total) ? total : null;
}

// 시세의 국내 시가총액과 같은 억원 단위로 변환한다. 배수 계산 전에는 반올림하지 않는다.
export function filingSummary(finance) {
  if (!finance) return null;
  const eok = (line) => {
    const won = filingTtmWon(line);
    return won == null ? null : won / 1e8;
  };
  const revTtm = eok(finance.rev);
  const opTtm = eok(finance.op);
  const statement = finance.basis === "OFS" ? "별도" : "연결";
  const netIncome = finance.ni?.scope === "parent" ? "지배주주 순이익" : "당기순이익";
  return {
    revTtm, opTtm, niTtm: eok(finance.ni),
    opm: revTtm > 0 && opTtm != null ? opTtm / revTtm * 100 : null,
    netBasis: `${statement} ${netIncome}`,
  };
}

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
