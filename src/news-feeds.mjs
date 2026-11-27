import { setTimeout as sleep } from "node:timers/promises";
import { articlePublishedAt, classify, decodeBody, parseFeed, signalHeadlines } from "./news.mjs";
import { reportsActualIncident } from "./incident-auto.mjs";

const retryable = new Set([429, 503]);
const newsAccept = "application/rss+xml, application/xml, text/xml, */*";
const host = url => new URL(url).hostname;
const google = url => host(url) === "news.google.com";

export async function fetchNewsText(url, accept, { request = fetch, wait = sleep } = {}) {
  const options = { headers: { "user-agent": "cybersecurity-monitor/1.0 (RSS reader)", accept } };
  const get = () => request(url, { ...options, signal: AbortSignal.timeout(google(url) ? 12000 : 25000) });
  let response = await get();
  if (retryable.has(response.status)) {
    const header = response.headers.get("retry-after");
    const delay = !header ? 2500 : /^\d+$/.test(header)
      ? Number(header) * 1000 : Math.max(0, Date.parse(header) - Date.now());
    if (Number.isFinite(delay) && delay <= 7000) {
      await response.body?.cancel();
      await wait(delay);
      response = await get();
    }
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return decodeBody(Buffer.from(await response.arrayBuffer()), response.headers.get("content-type") || "");
}

export async function fetchNewsFeed(feed) {
  if (feed.format !== "signal-homepage") {
    const body = await fetchNewsText(feed.url, newsAccept);
    if (!/<(?:rss|feed|rdf:RDF)(?:\s|>)/i.test(body)) throw new Error("RSS 또는 Atom 응답 없음");
    return parseFeed(body);
  }
  const headlines = signalHeadlines(await fetchNewsText(feed.url, "text/html"));
  if (!headlines.length) throw new Error("시그널 기사 목록을 찾지 못했습니다.");
  const candidates = headlines.filter(({ title }) => reportsActualIncident(title) || classify(title) === "incident");
  const pages = await Promise.allSettled(candidates.map(async (row) => {
    const date = articlePublishedAt(await fetchNewsText(row.link, "text/html"));
    if (!date) throw new Error("기사 발행 시각 없음");
    return { ...row, date };
  }));
  const entries = pages.flatMap(page => page.status === "fulfilled" ? [page.value] : []);
  if (candidates.length && !entries.length) throw new Error("시그널 사고 기사의 발행 시각을 읽지 못했습니다.");
  return entries;
}
