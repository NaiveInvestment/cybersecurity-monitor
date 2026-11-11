// 헤드라인을 사건(같은 묶음 번호 g) 단위로 모으고, 보도량으로 주요 이슈를 고른다.
import { similarity } from "./text.js";

// 묶음을 대표할 제목: 다른 제목들과 평균적으로 가장 비슷한 것. "[포토]" 같은 머리말이 붙은 제목은 뒤로 민다.
function representative(items) {
  const pool = items.slice(0, 14);
  if (pool.length <= 2) return pool.find((item) => !/^\s*[[(<]/.test(item.t)) || pool[0];
  let best = pool[0];
  let bestScore = -Infinity;
  for (const candidate of pool) {
    let score = 0;
    for (const other of pool) if (other !== candidate) score += similarity(candidate.t, other.t);
    score /= pool.length - 1;
    if (/^\s*[[(<]/.test(candidate.t)) score -= 0.15;
    if (score > bestScore) { best = candidate; bestScore = score; }
  }
  return best;
}

// items: 헤드라인 목록. 반환: 사건 목록(최신 기사 시각 내림차순).
export function groupStories(items) {
  const byGroup = new Map();
  for (const item of items) {
    const key = item.g || item.id;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(item);
  }
  const stories = [...byGroup.entries()].map(([id, members]) => {
    const sorted = [...members].sort((a, b) => b.d.localeCompare(a.d));
    return {
      id,
      items: sorted,
      lead: representative(sorted),
      count: sorted.length,
      sources: new Set(sorted.map((item) => item.s)).size,
      first: sorted[sorted.length - 1].d,
      last: sorted[0].d,
      c: sorted[0].c,
      r: sorted[0].r,
      k: [...new Set(sorted.flatMap((item) => item.k || []))],
    };
  });
  return stories.sort((a, b) => b.last.localeCompare(a.last));
}

// 최근 hours 시간 안에 기사가 나온 사건을 보도 매체 수, 기사 수, 최신순으로 줄 세운다.
// 여러 매체가 다룬 사건이 모자라면 한 매체만 다룬 최신 사건으로 채운다.
export function topIssues(stories, { now = Date.now(), hours = 72, limit = 8 } = {}) {
  const cutoff = now - hours * 3600000;
  const recent = stories.filter((story) => Date.parse(story.last) >= cutoff);
  const rank = (a, b) => b.sources - a.sources || b.count - a.count || b.last.localeCompare(a.last);
  const multi = recent.filter((story) => story.sources >= 2).sort(rank);
  const single = recent.filter((story) => story.sources < 2).sort((a, b) => b.last.localeCompare(a.last));
  return [...multi, ...single].slice(0, limit);
}

// 사건에 맞는 정리 카드: 같은 지역과 범주에서, 카드의 주체 이름이 사건 제목의 40% 이상에 나오는 것.
// 같은 기관의 옛 사건 정리가 새 사건 아래 붙지 않게, 카드 날짜가 사건의 첫 보도일 앞뒤 30일 안일 때만 쓴다.
export function cardForStory(story, cards) {
  const titles = story.items.map((item) => item.t.toLowerCase());
  const first = Date.parse(story.first);
  let best = null;
  for (const card of cards) {
    if (card.region !== story.r || card.category !== story.c) continue;
    const cardTime = Date.parse(String(card.date).length === 7 ? `${card.date}-15` : card.date);
    if (Number.isNaN(cardTime) || Math.abs(cardTime - first) > 30 * 86400000) continue;
    const names = String(card.entity || "").split(/,\s*/).map((name) => name.trim().toLowerCase()).filter((name) => name.length >= 2);
    const hits = titles.filter((title) => names.some((name) => title.includes(name))).length;
    if (hits / titles.length >= 0.4 && (!best || card.date > best.date)) best = card;
  }
  return best;
}
