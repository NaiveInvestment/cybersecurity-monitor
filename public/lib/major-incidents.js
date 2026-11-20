const NEWS_URL = /^https?:\/\//i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// 최근 4주 사고 기록에서 공개된 영향 범위 또는 금전 피해가 큰 사건을 고른다.
export function majorIncidents(events, freshStories, from, through) {
  const freshUrls = new Set(freshStories.flatMap(story => story.items.map(item => item.u)));
  return events.flatMap(event => {
    if (!DAY.test(event.d) || event.d < from || event.d > through) return [];
    const records = !event.claim && Number.isFinite(event.rec) && event.rec > 0 ? event.rec : 0;
    const loss = Number.isFinite(event.usd) && event.usd > 0 ? event.usd : 0;
    if (records < 50000 && loss < 10000000) return [];
    const sources = (event.src || []).filter(source => NEWS_URL.test(source.u)).sort((a, b) =>
      String(b.d || "").localeCompare(String(a.d || "")));
    if (!sources.length || sources.some(source => freshUrls.has(source.u))) return [];
    return [{ event, records, loss, sources }];
  }).sort((a, b) => b.event.d.localeCompare(a.event.d) ||
    b.loss - a.loss || b.records - a.records || a.event.n.localeCompare(b.event.n));
}
