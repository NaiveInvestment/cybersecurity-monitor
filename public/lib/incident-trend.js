// 보안 사고 추이: 국내와 해외의 일별 신규 사건 수(보도가 시작된 날 기준)와 사건별 강도(보도한 매체 수).
// 기사 1건짜리 묶음은 단발 기사나 사건이 아닌 기사가 대부분이라 세지 않는다. 사건은 2개 매체 이상이 보도한 묶음이다.
// 강도는 소(2~4개 매체), 중(5~19개), 대(20개 이상)다.

export const MIN_SOURCES = 2;
export const TIERS = [
  { key: "소", label: "소 2~4개 매체", min: 2 },
  { key: "중", label: "중 5~19개", min: 5 },
  { key: "대", label: "대 20개 이상", min: 20 },
];
export const tierOf = (sources) => (sources >= 20 ? 2 : sources >= 5 ? 1 : 0);
export const REGIONS = [["KR", "국내"], ["GL", "해외"]];

// 사건이 아님을 밝히는 제목("no signs of cyberattack", "Not Cyberattack", "해킹 아냐"). 분류와 추이 모두에서 뺀다.
export const NOT_INCIDENT = /reports? no (data )?breach|\bno (signs?|evidence|indications?) of (a |any )?(cyber|hack)|\bnot (a |an )?(cyber\s?attack|hack)|\b(caused by|due to) [\w\s-]{0,30}, not (a )?cyber|\brules? out [\w\s-]{0,20}cyber|해킹\s?(아냐|아니다|아닌 것|흔적\s?없|과\s?무관|무관)/i;

const DAY = 86400000;
export const kstDay = (value) => new Date((typeof value === "number" ? value : Date.parse(value)) + 9 * 3600000).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// stories: [{ id, r, f(첫 보도 시각), s(매체 수), n(기사 수), t, u }]. since: 집계 시작일(YYYY-MM-DD).
export function buildTrend(stories, { now = Date.now(), since = null, days = 60 } = {}) {
  const end = kstDay(now);
  let start = addDays(end, -(days - 1));
  if (since && since > start) start = since;
  const dates = [];
  for (let day = start; day <= end; day = addDays(day, 1)) dates.push(day);
  const index = new Map(dates.map((day, i) => [day, i]));
  const regions = REGIONS.map(([id, label]) => {
    const daily = dates.map((date) => ({ date, tiers: [0, 0, 0], total: 0 }));
    const counted = [];
    for (const story of stories) {
      if (story.r !== id || story.s < MIN_SOURCES || NOT_INCIDENT.test(story.t)) continue;
      const slot = index.get(kstDay(story.f));
      if (slot == null) continue;
      const tier = tierOf(story.s);
      daily[slot].tiers[tier] += 1;
      daily[slot].total += 1;
      counted.push({ ...story, day: dates[slot], tier });
    }
    counted.sort((a, b) => b.s - a.s || b.n - a.n || b.f.localeCompare(a.f));
    const count = (tier) => counted.filter((story) => story.tier === tier).length;
    return { id, label, daily, stories: counted, total: counted.length, tiers: [count(0), count(1), count(2)] };
  });
  const maxDaily = Math.max(1, ...regions.flatMap((region) => region.daily.map((day) => day.total)));
  const maxSources = Math.max(5, ...regions.flatMap((region) => region.stories.map((story) => story.s)));
  return { dates, start, end, regions, maxDaily, maxSources };
}

// 히트맵: 최근 days일 동안 보도가 있었던 사건 중 강도(전체 매체 수) 상위 limit개. 칸은 그날 보도한 매체 수(dd).
export function heatRows(trend, region, { days = 14, limit = 10 } = {}) {
  const heatDays = trend.dates.slice(-days);
  const rows = region.stories
    .filter((story) => heatDays.some((day) => story.dd?.[day]))
    .slice(0, limit)
    .map((story) => ({ ...story, cells: heatDays.map((day) => story.dd?.[day] || 0) }));
  return { days: heatDays, rows };
}

// 칸 진하기: 1~3, 4~7, 8~14, 15~29, 30개 매체 이상.
export const heatLevel = (value) => (!value ? 0 : value >= 30 ? 5 : value >= 15 ? 4 : value >= 8 ? 3 : value >= 4 ? 2 : 1);

// 눈금 최댓값을 1, 2, 2.5, 5, 10 배수로 올린다.
export function niceMax(value) {
  const power = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

const escapeText = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const round = (value) => Math.round(value * 10) / 10;

// 지역 하나의 일별 신규 사건 수 누적 막대(SVG 문자열). 아래부터 대, 중, 소.
// width는 실제 표시 폭(px)이라 글자가 줄어들지 않는다. today 막대는 집계 중으로 흐리게 그린다.
export function trendSvg(trend, region, { width = 640, today = null } = {}) {
  const left = 30;
  const right = 8;
  const plotW = Math.max(120, width - left - right);
  const n = trend.dates.length;
  const band = plotW / n;
  const barW = Math.max(3, Math.min(34, band * 0.62));
  const top = 18;
  const plotH = 76;
  const height = top + plotH + 26;
  const x = (i) => left + band * i + band / 2;
  const yMax = niceMax(trend.maxDaily);
  const y = (value) => top + plotH - (value / yMax) * plotH;

  const parts = [];
  const ticks = yMax <= 4 ? [0, yMax] : [0, yMax / 2, yMax];
  for (const tick of ticks) {
    const ty = round(y(tick));
    parts.push(`<line class="tr-grid" x1="${left}" x2="${left + plotW}" y1="${ty}" y2="${ty}"/><text class="tr-tick" x="${left - 7}" y="${ty + 4}" text-anchor="end">${tick}</text>`);
  }
  region.daily.forEach((day, i) => {
    let base = top + plotH;
    const partial = day.date === today;
    const detail = TIERS.map((tier, k) => `${tier.key} ${day.tiers[k]}`).join(", ");
    const segments = [2, 1, 0].map((tier) => {
      const count = day.tiers[tier];
      if (!count) return "";
      const h = (count / yMax) * plotH;
      base -= h;
      return `<rect class="tr-t${tier + 1}" x="${round(x(i) - barW / 2)}" y="${round(base)}" width="${round(barW)}" height="${round(Math.max(1, h - 1))}"/>`;
    }).join("");
    parts.push(`<g class="tr-day${partial ? " partial" : ""}"><title>${day.date.slice(5)} ${region.label} 신규 사건 ${day.total}개${partial ? "(오늘, 집계 중)" : ""}: ${detail}</title><rect class="tr-hit" x="${round(left + band * i)}" y="${top}" width="${round(band)}" height="${plotH}"/>${segments}</g>`);
    if (band >= 16) parts.push(`<text class="tr-val${day.total ? "" : " zero"}" x="${round(x(i))}" y="${round(base - 5)}" text-anchor="middle">${day.total}</text>`);
  });
  parts.push(`<line class="tr-axis" x1="${left}" x2="${left + plotW}" y1="${top + plotH}" y2="${top + plotH}"/>`);
  const step = Math.max(1, Math.ceil(42 / band));
  trend.dates.forEach((date, i) => {
    if ((n - 1 - i) % step) return;
    parts.push(`<text class="tr-tick" x="${round(x(i))}" y="${height - 7}" text-anchor="middle">${date === today ? "오늘" : date.slice(5)}</text>`);
  });
  const label = `${region.label} 일별 신규 보안 사고 수: ${trend.start}부터 ${trend.end}까지 ${region.total}개, 대 ${region.tiers[2]}개, 중 ${region.tiers[1]}개`;
  return `<svg class="trend-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeText(label)}">${parts.join("")}</svg>`;
}
