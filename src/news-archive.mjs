import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { isDeniedIncidentTitle } from "../public/lib/incident-trend.js";

import { priceHeadline, retainPublication } from "../public/lib/news-library.js";

const DAY = 86400000;
const archiveDay = (timestamp) => new Date(timestamp + 9 * 3600000).toISOString().slice(0, 10);
const daysIn = (dir) => existsSync(dir) ? readdirSync(dir).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort() : [];

function saveChanged(path, text) {
  if (existsSync(path) && readFileSync(path, "utf8") === text) return;
  const temp = path + "." + randomUUID() + ".tmp";
  writeFileSync(temp, text);
  try { renameSync(temp, path); } finally { if (existsSync(temp)) unlinkSync(temp); }
}

// The latest feed stays small for the incident overview. Every accepted article,
// including the ones leaving that feed, is retained by KST publication date.
export function archiveArticles(dir, items, now = Date.now()) {
  const cutoff = archiveDay(now - 180 * DAY);
  const groups = new Map();
  for (const item of items) {
    const timestamp = Date.parse(item.d);
    if (!Number.isFinite(timestamp) || timestamp > now + DAY) continue;
    const day = archiveDay(timestamp);
    if (day < cutoff) continue;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(item);
  }
  mkdirSync(dir, { recursive: true });
  for (const [day, rows] of groups) {
    const file = join(dir, day + ".json");
    const previous = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
    const indexed = new Map(previous.map(item => [item.u, item]));
    for (const item of rows) {
      const saved = indexed.get(item.u);
      const translation = saved?.t === item.t && saved.tKo && !item.tKo ? { tKo: saved.tKo, lang: saved.lang } : {};
      indexed.set(item.u, { ...(typeof saved?.important === "boolean" ? { important:saved.important } : {}), ...retainPublication(item,saved), ...translation });
    }
    const sorted = [...indexed.values()].sort((a, b) => b.d.localeCompare(a.d) || a.u.localeCompare(b.u));
    saveChanged(file, JSON.stringify(sorted));
  }
  for (const name of daysIn(dir)) if (name.slice(0, 10) < cutoff) unlinkSync(join(dir, name));
}

// Only days with extra search results need a browser request. The per-day hash
// changes when late articles or translations arrive.
export function buildSearchArchive(stateDir, outDir, current, now = Date.now()) {
  const latest = new Map(current.map(item => [item.u,item]));
  const cutoff = archiveDay(now - 180 * DAY);
  const days = [];
  const batches = [];
  mkdirSync(outDir, { recursive: true });
  for (const name of daysIn(stateDir).reverse()) {
    const day = name.slice(0, 10);
    if (day < cutoff) continue;
    const rows = [];
    for (const item of JSON.parse(readFileSync(join(stateDir,name),"utf8"))) {
      if (priceHeadline(item.t) || (item.c==="incident" && isDeniedIncidentTitle(item.t))) continue;
      const newer = latest.get(item.u);
      if (newer) {
        const merged = retainPublication(newer,item);
        if (merged !== newer) newer.firstPublishedAt=merged.firstPublishedAt;
        continue;
      }
      latest.set(item.u,item);
      rows.push(item);
    }
    if (rows.length) batches.push({name,day,rows});
  }
  // An older archive day can supply the first publication time of a later revision.
  for (const {name,day,rows} of batches) {
    const text=JSON.stringify(rows);
    saveChanged(join(outDir,name),text);
    days.push({day,revision:createHash("sha256").update(text).digest("hex").slice(0,16)});
  }
  const active = new Set(days.map(({day}) => day + ".json"));
  for (const name of daysIn(outDir)) if (!active.has(name)) unlinkSync(join(outDir, name));
  return days;
}

export function publishSearchableNews(stateDir, dataDir, news) {
  const archive = buildSearchArchive(stateDir, join(dataDir, "news-archive"), news.items);
  saveChanged(join(dataDir, "news.json"), JSON.stringify({ ...news, archive }));
}
