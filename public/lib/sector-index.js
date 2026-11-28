// Fixed membership comparison. Equal weights at the selected period's first close.
// Cap weights use starting prices times today's implied shares; no future-return weights.
export function basketSeries(members, stocks, dates, mode="equal") {
  if(!dates.length) return {points:[],included:[],excluded:[]};
  const included=[],excluded=[];
  for(const member of members) {
    const s=stocks[member.code], h=s?.history||[];
    const base=h.filter(p=>p.date<=dates[0]).at(-1);
    if(!base?.close || (mode==="cap" && !(s.cap>0&&s.p>0))) {excluded.push(member);continue;}
    included.push({...member,history:h,base:base.close,weight:mode==="cap"?s.cap*base.close/s.p:1});
  }
  const total=included.reduce((s,m)=>s+m.weight,0);
  const pointers=new Map(included.map(m=>[m.code,0]));
  const points=dates.map(date=> {
    let value=0;
    for(const m of included) {
      let at=pointers.get(m.code);
      while(at+1<m.history.length&&m.history[at+1].date<=date) at++;
      pointers.set(m.code,at);
      value+=m.weight/total*m.history[at].close/m.base*100;
    }
    return {date,value:total?value:null};
  });
  return {points,included:included.map(({code,name})=>({code,name})),excluded};
}

export function krxDate(timestamp) {
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? new Date(time + 9 * 3600000).toISOString().slice(0, 10) : null;
}

function priceRatio(quote) {
  if (quote?.p > 0 && quote.previousClose > 0) return quote.p / quote.previousClose;
  return Number.isFinite(quote?.chg) && quote.chg > -100 ? 1 + quote.chg / 100 : null;
}

export function liveSectorComparison(data, snapshot, mode, now = Date.now(), maxAgeMs = 120000) {
  if (!snapshot?.quotes || !snapshot.indices) return null;
  const indices = data.benchmarks.map((index) => snapshot.indices[index.id]);
  const date = krxDate(indices[0]?.at);
  if (!date || indices.some((quote) => krxDate(quote?.at) !== date || priceRatio(quote) == null)) return null;
  if (data.benchmarks.some((index) => date < index.history.at(-1)?.date)) return null;
  const asOf = Math.min(...indices.map((quote) => Date.parse(quote.at)));
  const open = indices.some((quote) => quote.st === "OPEN");
  if (open && now - asOf > maxAgeMs) return null;
  // A previous close feed can still contain the old ETF-only rosters after an expansion.
  // When that close is already in daily data, use it for the whole comparison.
  if (!open && data.benchmarks.every(index => index.history.at(-1)?.date === date)) {
    const missingClose = data.groups.some(group => group.supplement && group.stocks.some(({code}) =>
      !snapshot.quotes[code] && data.stocks[code]?.history.at(-1)?.date === date));
    if (missingClose) return null;
  }

  const dates = ["직전 종가", date];
  const points = (value) => [{ date: dates[0], value: value == null ? null : 100 }, { date, value }];
  const series = data.groups.map((group) => {
    const included = [], excluded = [];
    let totalWeight = 0, weightedRatio = 0;
    for (const stock of group.stocks) {
      const quote = snapshot.quotes[stock.code];
      const ratio = priceRatio(quote);
      const hasPriorClose = data.stocks[stock.code]?.history.some((point) => point.date < date);
      if (krxDate(quote?.at) !== date || ratio == null || !hasPriorClose || (mode === "cap" && !(quote.cap > 0))) {
        excluded.push(stock);
        continue;
      }
      // Use previous-close capitalization so intraday winners do not gain weight.
      const weight = mode === "cap" ? quote.cap / ratio : 1;
      included.push(stock);
      totalWeight += weight;
      weightedRatio += weight * ratio;
    }
    return { ...group, included, excluded, points: points(totalWeight ? weightedRatio / totalWeight * 100 : null) };
  });
  if (!series.find((group) => group.id === "security")?.included.length) return null;
  data.benchmarks.forEach((index, i) => {
    series.push({ ...index, points: points(priceRatio(indices[i]) * 100) });
  });
  return { dates, series, asOf: new Date(asOf).toISOString(), open };
}
