import { groupStories } from "./issues.js";
import { reportsDisputedImpact } from "./impact-cases.js";
import { isIncidentReport } from "./news-pulse.js";
import { regionalAlerts, wireRegion } from "./news-wire.js";

const DAY = 86400000;
export function newsDay(items, alerts, index, now) {
  const inDay = stamp => stamp > now - DAY && stamp <= now;
  const seen = new Set();
  const rows = [];
  for (const item of items) {
    const stamp = Date.parse(item.d);
    if (!inDay(stamp) || seen.has(item.u)) continue;
    rows.push({ item, stamp, region: item.r,
      kind: item.c === "policy" ? "정책" : item.c === "spending" ? "기업 대응" : reportsDisputedImpact(item.t) ? "침해 관련 보도" : isIncidentReport(item) ? "침해사고" : "일반 보도" });
    seen.add(item.u);
  }
  const accepted = regionalAlerts(alerts, index, {region:"ALL",category:"all",query:""}, now);
  for (const alert of accepted) {
    const detected = Date.parse(alert.detectedAt), published = Date.parse(alert.first);
    if (!inDay(detected) || (Number.isFinite(published) && !inDay(published)) || seen.has(alert.url)) continue;
    rows.push({item:{t:alert.title, s:alert.source, u:alert.url, important:alert.important}, region:wireRegion(alert,index), kind:"속보 감지", stamp:detected});
    seen.add(alert.url);
  }
  return rows.sort((a,b) => b.stamp - a.stamp || a.item.u.localeCompare(b.item.u));
}

const security = /보안|정보보호|정보\s?유출|개인정보|해킹|랜섬웨어|cyber|data (?:breach|protection|privacy)|ransomware|NIS2|DORA/i;
const decision = /의결|공포|시행|통과|낙찰|계약 체결|예산 확정|과징금.{0,25}(부과|패소|적법)|(?:법원|재판부).{0,35}(적법|인정)|\b(?:enacts?|adopts?|awards?|fines?|upholds?|takes effect|comes into force)\b/i;
const opinion = /해야|촉구|검토 중|시행될까|여부|could|urges?|calls for/i;

// Use a dated regulatory or spending decision, with a source, even on a busy incident day.
export function materialPolicy(items, cards, end) {
  const recent = items.filter(item => ["policy","spending"].includes(item.c) &&
    Date.parse(item.d) > end - 7 * DAY && Date.parse(item.d) <= end &&
    security.test(item.t) && decision.test(item.t) && !opinion.test(item.t));
  const groups = groupStories(recent).sort((a,b) => b.last.localeCompare(a.last));
  const best = groups.find(group => group.sources >= 2) || groups[0];
  if (best) return { title: best.lead.tKo || best.lead.t, url:best.lead.u, region:best.r,
    kind:best.c === "policy" ? "정책" : "기업 대응", entries:best.items, date:best.last };
  const card = cards.filter(row => ["policy","spending"].includes(row.category) &&
    row.sources.some(source => source.kind !== "media") && Date.parse(row.date) <= end && Date.parse(row.date) > end-28*DAY)
    .sort((a,b) => b.date.localeCompare(a.date))[0];
  return card && {title:card.title, url:card.sources.find(s=>s.kind !== "media").url, region:card.region, kind:card.category === "policy" ? "정책" : "기업 대응",
    date:card.date, claim:card.claim, entries:card.sources.map(s=>({t:s.name,u:s.url,s:s.name,d:s.date || card.date}))};
}
