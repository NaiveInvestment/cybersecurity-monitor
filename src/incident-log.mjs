// 해킹 사건 기록: 헤드라인 보관분(최대 3,000건)이 밀려나도 사건 추이가 끊기지 않게 사건 단위 요약을 따로 쌓는다.
// 사건 단위는 두 가지다.
// 1. 피해 주체 사전(data/incident-entities.json)에 걸리는 기사는 주체별로 모은다. 후속 보도와 해설이 여러 묶음으로
//    쪼개져도 한 사건이며, 강도는 그 주체를 다룬 고유 매체 수다. 지역은 기사 언어가 아니라 피해 주체 소재다.
//    같은 주체라도 기사가 GAP_DAYS일 넘게 끊기면 새 사건으로 본다.
// 2. 사전에 없는 기사는 화면과 같은 사건 묶음(g) 단위다.
// 요약문은 만들지 않는다.
import { groupStories } from "../public/lib/issues.js";
import { reportsActualIncident } from "./incident-auto.mjs";

const DAY = 86400000;
const kstDay = (iso) => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10);
// 날짜별 보도 매체(ds: { "YYYY-MM-DD": [매체] })를 쌓는다. 히트맵 칸 값이 된다.
function addDaySource(entry, item) {
  if (reportsActualIncident(item.t)) {
    const evidence = entry.evidence ?? (entry.evidence = []);
    if (evidence.length < 16 && !evidence.some(row => row.s === item.s)) {
      const { t, d, s, u } = item;
      evidence.push({ t, d, s, u });
    }
  }
  entry.ds = entry.ds || {};
  const day = kstDay(item.d);
  const list = entry.ds[day] || (entry.ds[day] = []);
  if (!list.includes(item.s)) list.push(item.s);
}
const GAP_DAYS = 14;

export function compileEntities(config) {
  return (config?.entities || []).map((entity) => ({ ...entity, regex: entity.match.map((source) => new RegExp(source, "i")) }));
}

export const entityOf = (entities, title) => entities.find((entity) => entity.regex.some((regex) => regex.test(title))) || null;

// 대표 기사: 그 주체 기사 중 가장 큰 묶음의 대표 제목.
function leadOf(items) {
  const [top] = groupStories(items).sort((a, b) => b.sources - a.sources || b.count - a.count);
  return top.lead;
}

// previous: 직전 기록 { stories: [...] }. items: 현재 헤드라인 보관분. entities: compileEntities 결과.
export function updateIncidentLog(previous, items, { entities = [], now = Date.now(), keepDays = 400 } = {}) {
  const cutoff = now - keepDays * DAY;
  const entries = (previous?.stories || []).filter((entry) => Date.parse(entry.f) >= cutoff)
    .map((entry) => ({ ...entry, m: [...entry.m], src: entry.src ? [...entry.src] : undefined,
      evidence: [...(entry.evidence || [])], ds: Object.fromEntries(Object.entries(entry.ds || {}).map(([day, list]) => [day, [...list]])) }));
  const byMember = new Map();
  for (const entry of entries) for (const id of entry.m) byMember.set(id, entry);
  let added = 0;

  const incident = items.filter((item) => item.c === "incident");
  const matched = new Map();
  const rest = [];
  for (const item of incident) {
    const entity = entityOf(entities, item.t);
    if (!entity) { rest.push(item); continue; }
    if (!matched.has(entity.id)) matched.set(entity.id, { entity, items: [] });
    matched.get(entity.id).items.push(item);
  }

  // 1. 주체별 사건: 시간순으로 훑으며 기존 기록의 같은 주체 사건(마지막 기사 뒤 GAP_DAYS일 안)에 붙인다.
  for (const { entity, items: list } of matched.values()) {
    list.sort((a, b) => a.d.localeCompare(b.d));
    const touched = new Set();
    for (const item of list) {
      const time = Date.parse(item.d);
      let entry = byMember.get(item.id);
      if (!entry || entry.e !== entity.id) {
        entry = entries.filter((other) => other.e === entity.id && time - Date.parse(other.l) <= GAP_DAYS * DAY && Date.parse(other.f) - time <= GAP_DAYS * DAY)
          .sort((a, b) => b.l.localeCompare(a.l))[0];
      }
      if (!entry) {
        entry = { id: `${entity.id}-${item.d.slice(0, 10)}`, e: entity.id, name: entity.name, sector: entity.sector, r: entity.region, f: item.d, l: item.d, s: 0, n: 0, t: item.t, u: item.u, m: [], src: [] };
        entries.push(entry);
        added += 1;
      }
      if (!entry.m.includes(item.id)) { entry.m.push(item.id); entry.n += 1; }
      if (!entry.src.includes(item.s)) entry.src.push(item.s);
      addDaySource(entry, item);
      entry.s = entry.src.length;
      if (item.d < entry.f) entry.f = item.d;
      if (item.d > entry.l) entry.l = item.d;
      Object.assign(entry, { name: entity.name, sector: entity.sector, r: entity.region });
      byMember.set(item.id, entry);
      touched.add(entry);
    }
    for (const entry of touched) {
      const lead = leadOf(list.filter((item) => entry.m.includes(item.id)));
      entry.t = lead.t;
      entry.u = lead.u;
    }
  }

  // 2. 사전에 없는 기사: 사건 묶음 단위. 기사 id가 겹치면 같은 항목이고 매체 수와 기사 수는 큰 쪽을 남긴다.
  for (const story of groupStories(rest)) {
    const ids = story.items.map((item) => item.id);
    const hit = ids.map((id) => byMember.get(id)).find((entry) => entry && !entry.e);
    const current = { id: story.id, r: story.r, f: story.first, l: story.last, s: story.sources, n: story.count, t: story.lead.t, u: story.lead.u };
    if (hit) {
      const grew = current.n >= hit.n;
      hit.f = hit.f < current.f ? hit.f : current.f;
      hit.l = hit.l > current.l ? hit.l : current.l;
      hit.s = Math.max(hit.s, current.s);
      hit.n = Math.max(hit.n, current.n);
      if (grew) { hit.id = current.id; hit.t = current.t; hit.u = current.u; }
      for (const id of ids) if (!hit.m.includes(id)) { hit.m.push(id); byMember.set(id, hit); }
      for (const item of story.items) addDaySource(hit, item);
    } else {
      const entry = { ...current, m: ids };
      for (const item of story.items) addDaySource(entry, item);
      entries.push(entry);
      for (const id of ids) byMember.set(id, entry);
      added += 1;
    }
  }
  entries.sort((a, b) => b.f.localeCompare(a.f));
  return { stories: entries, added };
}

// 화면용: 기사 id와 매체 목록을 빼고, 날짜별 매체는 수(dd)로만 싣는다.
export const publicIncidentLog = (log, meta = {}) => ({ ...meta, stories: log.stories.map(({ m, src, ds, evidence, ...entry }) => ({ ...entry, dd: Object.fromEntries(Object.entries(ds || {}).map(([day, list]) => [day, list.length])) })) });
