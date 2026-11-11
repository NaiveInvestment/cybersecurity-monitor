// 브라우저와 Node 수집기가 함께 쓰는 순수 계산 함수. DOM, 네트워크 의존 없음.

export function toNum(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null) return null;
  const text = String(value).replace(/,/g, "").trim();
  if (!text || text === "-" || /^N\/?A$/i.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function round(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// 기준가 대비 수익률(%). 기준가가 없거나 0 이하면 값을 만들지 않는다.
export function pct(now, base) {
  if (now == null || base == null || base <= 0) return null;
  return (now / base - 1) * 100;
}

// "YYYY-MM-DD"에 일, 월, 연을 더한다. 월말은 그 달의 마지막 날로 맞춘다(3/31 - 1개월 = 2/28).
export function shiftDate(iso, { days = 0, months = 0, years = 0 } = {}) {
  const [y, m, d] = iso.split("-").map(Number);
  const totalMonths = y * 12 + (m - 1) + months + years * 12;
  const ny = Math.floor(totalMonths / 12);
  const nm = totalMonths - ny * 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const date = new Date(Date.UTC(ny, nm, Math.min(d, lastDay)));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// 날짜 오름차순 일봉에서 target 이하의 마지막 종가. 상장 전 구간이면 null.
export function baseClose(history, target) {
  if (!history.length || history[0].date > target) return null;
  let close = null;
  for (const row of history) {
    if (row.date > target) break;
    close = row.close;
  }
  return close;
}

// 수익률 기준가 묶음. today는 시세 기준일(현지 날짜).
export function returnBases(history, today) {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const yearAgo = shiftDate(today, { years: -1 });
  const window = sorted.filter((row) => row.date > yearAgo && row.date <= today);
  return {
    w1: baseClose(sorted, shiftDate(today, { days: -7 })),
    m1: baseClose(sorted, shiftDate(today, { months: -1 })),
    m3: baseClose(sorted, shiftDate(today, { months: -3 })),
    ytd: baseClose(sorted, `${Number(today.slice(0, 4)) - 1}-12-31`),
    y1: baseClose(sorted, yearAgo),
    hi52: window.length ? Math.max(...window.map((row) => row.close)) : null,
  };
}

// 네이버 실시간 시세 한 행을 화면 단위로 정규화한다.
// cap: 국내는 억원, 해외는 현지 통화 백만. capKrw, tv(거래대금)는 항상 억원.
export function normalizeQuote(kind, row) {
  const price = toNum(row?.closePriceRaw ?? row?.closePrice);
  if (price == null || price <= 0) return null;
  const direction = row.compareToPreviousPrice?.name;
  let change = toNum(row.fluctuationsRatioRaw ?? row.fluctuationsRatio);
  if (change != null) {
    change = Math.abs(change);
    if (direction === "FALLING" || direction === "LOWER_LIMIT") change = -change;
    if (direction === "UNCHANGED") change = 0;
  }
  const capLocal = toNum(row.marketValueFullRaw ?? row.marketValueFull);
  const capKrw = kind === "KR" ? capLocal : toNum(row.marketValueKrwRaw);
  const valueKrw = kind === "KR" ? toNum(row.accumulatedTradingValueRaw) : toNum(row.accumulatedTradingValueKrwRaw);
  return {
    p: price,
    chg: round(change, 2),
    cap: capLocal == null ? null : round(kind === "KR" ? capLocal / 1e8 : capLocal / 1e6, 1),
    capKrw: capKrw == null ? null : round(capKrw / 1e8, 1),
    tv: valueKrw == null ? null : round(valueKrw / 1e8, 1),
    at: row.localTradedAt || null,
    st: row.marketStatus || null,
  };
}

function monthsBetween(fromYm, toYm) {
  const [fy, fm] = fromYm.split("-").map(Number);
  const [ty, tm] = toYm.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

// 분기 재무 표(periods, rev, op, ni가 같은 길이)에서 최근 분기, YoY, TTM을 만든다.
// 확정 분기만 쓰고 컨센서스 열은 버린다. 4개 분기가 이어지지 않으면 TTM을 만들지 않는다.
export function financeMetrics({ periods, rev, op, ni }) {
  const confirmed = periods.map((_, index) => index).filter((index) => !periods[index].consensus && rev[index] != null);
  if (!confirmed.length) return null;
  const last = confirmed[confirmed.length - 1];
  const ym = periods[last].ym;
  const prior = confirmed.find((index) => {
    const gap = monthsBetween(periods[index].ym, ym);
    return gap >= 11 && gap <= 13;
  });
  const last4 = confirmed.slice(-4);
  const span = last4.length === 4 ? monthsBetween(periods[last4[0]].ym, ym) : null;
  const contiguous = span != null && span >= 8 && span <= 10;
  const sum = (series) => (contiguous && last4.every((index) => series[index] != null)
    ? last4.reduce((total, index) => total + series[index], 0) : null);
  const revTtm = sum(rev);
  const opTtm = sum(op);
  const niTtm = sum(ni);
  return {
    ym,
    rev: rev[last],
    yoy: prior != null && rev[prior] > 0 ? round((rev[last] / rev[prior] - 1) * 100, 1) : null,
    revTtm: round(revTtm, 1),
    opTtm: round(opTtm, 1),
    niTtm: round(niTtm, 1),
    opm: revTtm > 0 && opTtm != null ? round((opTtm / revTtm) * 100, 1) : null,
    spark: confirmed.slice(-5).map((index) => ({ ym: periods[index].ym, v: rev[index] })),
  };
}

// PSR, PER. 시가총액과 실적은 같은 통화 단위여야 한다. 이익이 0 이하이면 PER은 "N/M".
export function valuation(cap, fin) {
  if (cap == null || !fin) return { psr: null, per: null };
  return {
    psr: fin.revTtm > 0 ? round(cap / fin.revTtm, 2) : null,
    per: fin.niTtm == null ? null : fin.niTtm > 0 ? round(cap / fin.niTtm, 1) : "N/M",
  };
}

export function mean(values) {
  const valid = values.filter((value) => value != null && Number.isFinite(value));
  return valid.length ? valid.reduce((total, value) => total + value, 0) / valid.length : null;
}
