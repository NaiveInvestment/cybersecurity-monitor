// 헤드라인 수집: 피드를 읽어 분류하고 이전 보관분(--state)에 합쳐 data/news.json으로 쓴다.
// 사용: node scripts/fetch-news.mjs [--out _site/data] [--state state/news.json]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { loadUniverse, ROOT } from "../src/universe.mjs";
import { parseFeed, decodeBody, canonicalUrl, splitPublisher, classify, buildStockMatcher, itemId, mergeItems, assignGroups } from "../src/news.mjs";
import { updateIncidentLog, publicIncidentLog, compileEntities } from "../src/incident-log.mjs";
import { translateHeadlines } from "../src/headline-translations.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const outDir = option("--out", join(ROOT, "_site", "data"));
const statePath = option("--state", join(ROOT, "state", "news.json"));
// 사건 기록은 헤드라인 보관분 옆에 둔다(Actions에서는 data 브랜치에 함께 저장).
const logPath = option("--incident-log", join(dirname(statePath), "incident-log.json"));

async function fetchFeed(feed) {
  const response = await fetch(feed.url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; cybersecurity-monitor/1.0; RSS reader)", accept: "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = decodeBody(Buffer.from(await response.arrayBuffer()), response.headers.get("content-type") || "");
  return parseFeed(body);
}

async function main() {
  const { feeds, trendStart } = JSON.parse(readFileSync(join(ROOT, "data", "sources.json"), "utf8"));
  const matchStocks = buildStockMatcher(loadUniverse().stocks);
  const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { items: [] };

  const incoming = [];
  const report = [];
  // 구글 뉴스 검색은 한꺼번에 부르면 429가 나기 쉬워 1.5초 간격으로 하나씩 부른다. 다른 피드는 동시에 받는다.
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const google = feeds.map((feed, index) => ({ feed, index })).filter(({ feed }) => feed.url.includes("news.google.com"));
  const results = new Array(feeds.length);
  const others = Promise.allSettled(feeds.map((feed, index) => (feed.url.includes("news.google.com") ? null : fetchFeed(feed).then((value) => { results[index] = { status: "fulfilled", value }; }, (reason) => { results[index] = { status: "rejected", reason }; }))));
  for (const { feed, index } of google) {
    try { results[index] = { status: "fulfilled", value: await fetchFeed(feed) }; } catch (reason) { results[index] = { status: "rejected", reason }; }
    await sleep(1500);
  }
  await others;
  results.forEach((result, index) => {
    const feed = feeds[index];
    if (result.status === "rejected") {
      report.push({ id: feed.id, ok: false, error: result.reason.message });
      return;
    }
    let used = 0;
    for (const entry of result.value) {
      if (!entry.date) continue;
      const split = feed.aggregator ? splitPublisher(entry.title, entry.source) : { title: entry.title, publisher: "" };
      const source = feed.aggregator ? (entry.source || split.publisher || feed.name) : feed.name;
      const category = classify(split.title, feed.aggregator ? "" : entry.summary, feed.hint || null);
      if (category === "other") continue;
      const url = canonicalUrl(entry.link);
      incoming.push({ id: itemId(url), t: split.title, u: url, s: source, d: entry.date, r: feed.region, c: category, k: matchStocks(split.title) });
      used += 1;
    }
    report.push({ id: feed.id, ok: true, fetched: result.value.length, used });
  });

  const okFeeds = report.filter((row) => row.ok).length;
  if (okFeeds === 0) throw new Error("모든 피드 수집 실패. 직전 보관분을 유지한다.");

  const { items, added } = mergeItems(previous.items || [], incoming);
  const groupCount = assignGroups(items);
  const { english, translated } = await translateHeadlines(items, { previous: previous.items });
  console.log(`한국어 제목 ${translated}/${english}건`);
  const output = { updatedAt: new Date().toISOString(), feeds: report, items };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "news.json"), JSON.stringify(output));
  mkdirSync(join(statePath, ".."), { recursive: true });
  writeFileSync(statePath, JSON.stringify(output));

  const previousLog = existsSync(logPath) ? JSON.parse(readFileSync(logPath, "utf8")) : { stories: [] };
  const entities = compileEntities(JSON.parse(readFileSync(join(ROOT, "data", "incident-entities.json"), "utf8")));
  const log = updateIncidentLog(previousLog, items, { entities });
  writeFileSync(logPath, JSON.stringify({ updatedAt: output.updatedAt, stories: log.stories }));
  writeFileSync(join(outDir, "incidents.json"), JSON.stringify(publicIncidentLog(log, { updatedAt: output.updatedAt, since: trendStart })));

  const count = (key, value) => items.filter((item) => item[key] === value).length;
  console.log(`news: 보관 ${items.length}건(신규 ${added}, 사건 묶음 ${groupCount}개), 사례 ${count("c", "incident")}, 정책 ${count("c", "policy")}, 지출 ${count("c", "spending")}, 국내 ${count("r", "KR")}, 해외 ${count("r", "GL")}`);
  console.log(`  사건 기록 ${log.stories.length}개(신규 ${log.added})`);
  for (const row of report) console.log(`  ${row.ok ? "ok " : "ERR"} ${row.id} ${row.ok ? `${row.used}/${row.fetched}` : row.error}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
