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
