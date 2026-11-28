import { shiftMarketMonths } from "./market-activity.js";

export function marketComposition(points, members, limit = 10, rankFrom = 0) {
  const complete = points.filter(point => point.constituents && Number.isFinite(point.cap));
  if (!complete.length) return null;
  const closed = points.slice(rankFrom).filter(point => !point.live && point.constituents && Number.isFinite(point.cap));
  const rankDays = closed.length ? closed : complete;
  const ranked = members.map(code => ({
    code, total: rankDays.reduce((sum, day) => sum + (day.constituents[code] ?? 0), 0),
  })).filter(stock => stock.total > 0)
    .sort((a, b) => b.total - a.total || a.code.localeCompare(b.code));
  const codes = ranked.slice(0, limit).map(stock => stock.code);
  const groups = [...codes, "other"];
  const amounts = points.map(point => {
    if (!point.constituents || !Number.isFinite(point.cap)) return null;
    const top = codes.map(code => point.constituents[code] ?? 0);
    const remainder = point.cap - top.reduce((sum, cap) => sum + cap, 0);
    return [...top, Math.max(0, remainder)];
  });
  return { groups, amounts };
}

export function compositionHistory(domesticBars, market, sectors) {
  const capDays = new Map((market?.bars ?? []).map(row => [row.date, Math.round(row.cap * 1e8)]));
  const days = new Map(domesticBars.map(row => [row.date, row]));
  for (const row of sectors?.bars ?? []) {
    if (row.marketCap !== capDays.get(row.date) || !row.constituentsWon) continue;
    const entries = Object.entries(row.constituentsWon);
    if (!entries.length || entries.some(([, won]) => !Number.isSafeInteger(won) || won < 0)) continue;
    const cap = entries.reduce((sum, [, won]) => sum + won, 0);
    if (cap <= 0 || cap > row.marketCap) continue;
    const constituents = Object.fromEntries(entries.map(([code, won]) => [code, won / 1e8]));
    days.set(row.date, { date:row.date, cap:cap / 1e8, constituents, listed:entries.length,
      capCount:entries.length, verifiedClose:true });
  }
  if (!days.size) return [];
  const dates = [...days.keys()].sort();
  // Keep the index and gaps aligned when one stock file is missing.
  for (const date of capDays.keys()) {
    if (!days.has(date) && date >= dates[0]) days.set(date, { date, cap:null });
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export const zoomMonths = [1, 3, 6, 12, 24, 36];

// Center on the chosen trading day, shifting the whole window inward at either edge.
export function compositionWindow(points, months, anchor) {
  const first = points[0].date, last = points.at(-1).date;
  if (months === zoomMonths.at(-1)) return [0, points.length - 1];
  let end = last, start = shiftMarketMonths(end, -months);
  if (anchor && anchor < last) {
    const mid = Date.parse(anchor), trailing = Date.parse(shiftMarketMonths(anchor, -months));
    start = new Date((mid + trailing) / 2).toISOString().slice(0, 10);
    if (start < first) start = first;
    end = shiftMarketMonths(start, months);
    if (end > last) {
      end = last;
      start = shiftMarketMonths(last, -months);
    }
  }
  return [points.findIndex(point => point.date >= start), points.findLastIndex(point => point.date <= end)];
}
