import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { pushOrphan } from "../src/git-orphan.mjs";
import { fetchIndexRealtime, mapLimit } from "../src/naver.mjs";
import { lastClosedDate } from "../src/market-warnings.mjs";
import { parseRegularBars, shortHeatMetrics } from "../src/short-heat.mjs";
import { loadUniverse, ROOT } from "../src/universe.mjs";

const stocks = loadUniverse().stocks.filter(stock => stock.kind === "KR");
const markets = [...new Set(stocks.map(stock => stock.market))];
const baseUrl = "https://api.kiwoom.com";
const time = now => new Date(now + 9 * 3600000).toISOString();
const output = join(ROOT, "_live", "data", "short-heat.json");
const publishMarker = join(ROOT, "_live", ".short-heat-last-publish");
const publish = process.argv.includes("--publish");
const evidenceOption = process.argv.indexOf("--evidence");
const evidencePath = evidenceOption === -1 ? null : process.argv[evidenceOption + 1];

async function listedShares(code, date) {
  const url = `https://finance.daum.net/api/quote/A${code}/days?symbolCode=A${code}&page=1&perPage=60`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Referer: `https://finance.daum.net/quotes/A${code}` },
    signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`상장주식수 HTTP ${res.status}`);
  return new Map((await res.json()).data.filter(row => row.date.slice(0, 10) <= date)
    .map(row => [row.date.slice(0, 10), row.listedSharesCount]));
}

const workspaceCheckout = process.cwd();
const { KiwoomRestProvider, KiwoomTokenManager } = await import(
  pathToFileURL(join(workspaceCheckout, "src", "providers", "kiwoom.mjs")).href);
const request = (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
const tokenManager = new KiwoomTokenManager({
  appKey: process.env.KIWOOM_APP_KEY, appSecret: process.env.KIWOOM_APP_SECRET, baseUrl, fetchImpl: request,
});
const provider = new KiwoomRestProvider({ tokenManager, baseUrl, fetchImpl: request });
process.chdir(ROOT);

async function regularBars(token, code, date, adjusted = false) {
  await provider.waitForRequestSlot();
  const response = await request(`${baseUrl}/api/dostk/chart`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json;charset=UTF-8", "api-id": "ka11081" },
    body: JSON.stringify({ stk_cd: code, base_dt: date.replaceAll("-", ""), upd_stkpc_tp: adjusted ? "1" : "0" }),
  });
  if (!response.ok) throw new Error(`키움 정규장 일봉 HTTP ${response.status}`);
  const body = await response.json();
  if (Number(body.return_code) !== 0 || !Array.isArray(body.result_list)) throw new Error("키움 정규장 일봉 확인 필요");
  return parseRegularBars(body.result_list.slice(0, 62));
}

function readPrevious() {
  try { return JSON.parse(readFileSync(output, "utf8")); } catch { return null; }
}

function publishFeed(checkedAt) {
  if (!publish) return;
  let lastPublished;
  try { lastPublished = readFileSync(publishMarker, "utf8"); } catch { /* First publication. */ }
  if (lastPublished === checkedAt) return;
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: "NaiveInvestment", GIT_COMMITTER_NAME: "NaiveInvestment",
    GIT_AUTHOR_EMAIL: "NaiveInvestment@users.noreply.github.com",
    GIT_COMMITTER_EMAIL: "NaiveInvestment@users.noreply.github.com", GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never",
  });
  pushOrphan("short-heat", [{ path: output, name: "short-heat.json" }], "Refresh public short-heat comparisons");
  writeFileSync(publishMarker, checkedAt);
}

async function refresh() {
  const now = Date.now();
  const local = time(now);
  const date = local.slice(0, 10);
  const clock = local.slice(11, 16);
  const weekday = new Date(local).getUTCDay();
  const marketHours = weekday > 0 && weekday < 6 && clock >= "09:00" && clock < "15:30";
  const previous = readPrevious();
  const indices = clock >= "15:40" ? await fetchIndexRealtime("KR", markets, { attempts: 1 }).catch(() => ({})) : {};
  const cutoffs = Object.fromEntries(markets.map(market => [market, lastClosedDate(now, indices[market])]));
  const onlyPublish = previous && !marketHours && (clock >= "15:30" && clock < "15:40" ||
    previous.date === date && markets.every(market => previous.cutoffs?.[market] >= cutoffs[market]));
  if (!evidencePath && onlyPublish) {
    publishFeed(previous.checkedAt);
    return;
  }
  const token = await tokenManager.getToken();
  const evidence = {};
  const results = await mapLimit(stocks, 5, async stock => {
    const [krx, adjusted, combined, shares] = await Promise.all([
      regularBars(token, stock.code, date),
      regularBars(token, stock.code, date, true).catch(() => []),
      regularBars(token, stock.code + "_AL", date).catch(() => []),
      listedShares(stock.code, date).catch(() => new Map()),
    ]);
    const latestClosed = krx.find(row => row.volume > 0 && row.date <= cutoffs[stock.market]);
    if (evidencePath) evidence[stock.id] = { krx, adjusted, combined, shares: [...shares] };
    return {
      closed: latestClosed ? shortHeatMetrics(krx, adjusted, combined, shares, latestClosed.date) : null,
      live: marketHours ? shortHeatMetrics(krx, adjusted, combined, shares, date, { intraday: true }) : null,
    };
  });
  const rows = Object.fromEntries(stocks.flatMap((stock, index) => {
    const row = results[index].value;
    return row?.closed || row?.live ? [[stock.id, row]] :
      previous?.stocks?.[stock.id]?.closed ? [[stock.id, { closed: previous.stocks[stock.id].closed, live: null }]] : [];
  }));
  const updated = results.filter(item => item.value?.closed || item.value?.live).length;
  if (!updated) throw new Error("국내 정규장 일봉을 수신하지 못함");
  const next = { date, checkedAt: new Date(now).toISOString(), cutoffs, stocks: rows };
  const pending = output + "." + process.pid + ".tmp";
  mkdirSync(join(ROOT, "_live", "data"), { recursive: true });
  writeFileSync(pending, JSON.stringify(next));
  renameSync(pending, output);
  if (evidencePath) writeFileSync(evidencePath, JSON.stringify({ next, evidence }));
  publishFeed(next.checkedAt);
  console.log(`단기과열 가격/변동성 ${updated}/${stocks.length}, 회전율 ${Object.values(rows).filter(row =>
    Number.isFinite((row.live || row.closed)?.turnover)).length}/${stocks.length}`);
}

try { await refresh(); } catch (error) {
  console.error("단기과열 수집 또는 게시 실패:", error.name);
  process.exitCode = 1;
}
