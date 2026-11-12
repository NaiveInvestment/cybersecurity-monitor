import { createServer } from "node:http";

// Only public quote fields cross this boundary. No local health, files or credentials.
export function publicQuotes(payload, ids, now = Date.now()) {
  if (!payload?.q || !Number.isFinite(Date.parse(payload.asOf)) || Math.abs(now - Date.parse(payload.asOf)) > 30000) return null;
  const q = {};
  const kiwoom = payload.feed?.active === true && payload.feed?.stocks > 0;
  const naverFresh = Number.isFinite(Date.parse(payload.naver?.at)) && now - Date.parse(payload.naver.at) < 45000;
  if(!naverFresh) return null;
  for (const id of ids) {
    const row = payload.q[id];
    if (!naverFresh && !(kiwoom && row?.[7] === "kiwoom" && now-Date.parse(row[5])<120000)) continue;
    if (!Array.isArray(row) || !(row[0] > 0) || !Number.isFinite(row[0]) || !Number.isFinite(Date.parse(row[5]))) continue;
    q[id] = row.slice(0, 7).map((v, i) => i < 5 ? (Number.isFinite(v) ? v : null) : i === 5 ? new Date(v).toISOString() : v === "OPEN" ? "OPEN" : "CLOSE");
  }
  if (!kiwoom && !naverFresh) return null;
  const idx={};
  if(naverFresh) for(const id of ['KOSDAQ','IXIC']) {
    const value=payload.idx?.[id];
    if(value?.p>0&&Number.isFinite(value.p)&&Number.isFinite(Date.parse(value.at))) idx[id]=Object.fromEntries(['p','chg','at','st'].filter(k=>value[k]!=null).map(k=>[k,value[k]]));
  }
  return { asOf: payload.asOf, q, idx, source: kiwoom ? "국내 키움 실시간, 해외 네이버 10초" : "네이버 금융 10초 갱신" };
}

export function createQuoteRelay({ getPayload, ids, origin = "https://naiveinvestment.github.io" }) {
  return createServer((req, res) => {
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": origin, "Vary": "Origin" };
    if (req.url?.split("?")[0] !== "/live.json" || req.method !== "GET") { res.writeHead(404, headers).end('{}'); return; }
    const payload = publicQuotes(getPayload(), ids);
    if (!payload) { res.writeHead(503, headers).end('{}'); return; }
    res.writeHead(200, headers).end(JSON.stringify(payload));
  });
}
