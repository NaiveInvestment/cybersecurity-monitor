import { mergeLibrary } from "./news-library.js";
const DAY = 86400000;
export const publicationDay = (timestamp) => new Date(timestamp + 9 * 3600000).toISOString().slice(0, 10);

export async function searchArchive(file, period, load, cache, now = Date.now()) {
  const since = period ? now - period * DAY : 0;
  const days = (file.archive || []).filter(({ day }) => day >= publicationDay(since));
  const results = await Promise.allSettled(days.map(({ day, revision }) => {
    const url = `data/news-archive/${day}.json?v=${revision}`;
    if (!cache.has(url)) {
      cache.set(url, load(url).catch(error => { cache.delete(url); throw error; }));
    }
    return cache.get(url);
  }));
  const archived = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
  const items = mergeLibrary(archived, file.items).filter(item => Date.parse(item.d) >= since)
    .sort((a, b) => b.d.localeCompare(a.d));
  const dates = new Set(items.map(item => publicationDay(Date.parse(item.d))));
  const coverage = items.length
    ? `보관 기사 날짜 ${publicationDay(Date.parse(items.at(-1).d))} ~ ${publicationDay(Date.parse(items[0].d))}, 기사 있는 날 ${dates.size}일`
    : "보관 기사 없음";
  const failedDays = days.filter((_,i)=>results[i].status==="rejected").map(x=>x.day);
  return { items, coverage, failed:failedDays.length, failedDays };
}
