import { reportsIncident } from "./recent-incidents.js";
import { compositeIndex, isIncidentCandidate, windowsEnding } from "./incident-metrics.js";
import { publicationDay } from "./news-search.js";

const DAY = 86400000;
const reportCache = new WeakMap();

export function isIncidentReport(item) {
  if (item.c !== "incident") return false;
  if (!reportCache.has(item)) reportCache.set(item, reportsIncident(item.t || ""));
  return reportCache.get(item);
}

// Fourteen adjacent 24-hour buckets, each open on the left and closed on the right.
export function newsPulse(items, region, end) {
  const bins = Array.from({ length: 14 }, (_, i) => ({
    end: end - (13 - i) * DAY, count: 0, hacking: 0,
  }));
  for (const item of items) {
    const age = end - Date.parse(item.d);
    if ((region !== "ALL" && item.r !== region) || !(age >= 0 && age < 14 * DAY)) continue;
    const bin = bins[13 - Math.floor(age / DAY)];
    bin.count++;
    if (isIncidentReport(item)) bin.hacking++;
  }
  const total = (days) => {
    const count = days.reduce((sum, day) => sum + day.count, 0);
    const hacking = days.reduce((sum, day) => sum + day.hacking, 0);
    return { count, hacking, share: count ? 100 * hacking / count : null };
  };
  return { bins, previous: total(bins.slice(0, 7)), current: total(bins.slice(7)) };
}

export function incidentSeries(file, region, end) {
  if (!file) return [];
  const windows = windowsEnding(publicationDay(end), 13);
  const records = file.events.filter(event => !isIncidentCandidate(event));
  const groups = region === "ALL" ? ["ALL"] : ["KR","GL"];
  return compositeIndex(records, windows, groups)[region].map(point => {
    const covered = (!file.since || point.start >= file.since) && point.end <= file.until;
    return { ...point, count: covered ? point.count : null,
      value: covered && (point.recKnown || point.usdKnown) ? point.index : null };
  });
}

export function damagePulse(file, region, end) {
  return file ? incidentSeries(file, region, end).slice(-2) : null;
}
