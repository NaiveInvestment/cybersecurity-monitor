const DAY = 86400000;
export const WEEK = 7 * DAY;
export const grades = ["미정", "제한", "중간", "높음", "매우 높음"];
export const firstCovered = Date.parse("2026-08-18T00:00:00+09:00");

export function publicTime(date) {
  // A date-only disclosure enters the Korean calendar day without inventing a publication clock.
  if (typeof date !== "string") return NaN;
  return Date.parse(date.length === 10 ? date + "T00:00:00+09:00" : date);
}
function publicLink(value) {
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
}

export function eventSeries(baseline, updates, asOf) {
  const events = new Map();
  const aliases = new Map();

  for (const event of baseline) {
    events.set(event.id, event);
    for (const key of event.aliases || []) aliases.set(key, event.id);
  }
  for (const edition of [...updates].sort((a,b) => publicTime(a.date) - publicTime(b.date))) {
    if (!edition.id || !publicLink(edition.url) || !Number.isFinite(publicTime(edition.date)) || publicTime(edition.date)>asOf) continue;
    // A shared roundup URL can refer to distinct victims. A source match also needs the victim name.
    const linked = baseline.find(e => e.url===edition.url && e.name && edition.name.toLowerCase().includes(e.name.toLowerCase()));
    const id = aliases.get(edition.id) || (events.has(edition.id) ? edition.id : linked?.id || edition.id);
    const previous = events.get(id);
    if (!previous) {
      events.set(id, {...edition, id});
    } else {
      const earlier = publicTime(edition.date) < publicTime(previous.date);
      const stronger = edition.grade > previous.grade || /정정|철회|오보 확인/.test(edition.impact) && publicTime(edition.date)>=publicTime(previous.date);
      events.set(id, {...(stronger ? {...previous, grade:edition.grade, reason:edition.reason, impact:edition.impact, url:edition.url} : previous), date:earlier ? edition.date : previous.date});
    }
    aliases.set(edition.id, id);

  }
  const weeks = Array.from({length:17}, (_,i) => ({
    start:asOf - (17-i)*WEEK, end:asOf - (16-i)*WEEK, events:[], distribution:[0,0,0,0,0]
  }));
  for (const event of events.values()) {
    const time = publicTime(event.date);
    const index = Math.ceil((time-weeks[0].start)/WEEK)-1;
    if (index < 0 || index >= weeks.length || !Number.isInteger(index)) continue;
    const week=weeks[index];
    week.events.push(event);
    week.distribution[event.grade]++;
  }
  for (const week of weeks) {
    week.events.sort((a,b) => b.grade-a.grade || publicTime(b.date)-publicTime(a.date) || a.name.localeCompare(b.name));
    week.assessed = week.events.length-week.distribution[0];
    week.mean = week.assessed ? week.events.reduce((sum,e)=>sum+e.grade,0)/week.assessed : null;
    week.partial = week.start < firstCovered && week.end > firstCovered;
    week.available = week.end > firstCovered && (week.events.length > 0 || week.end <= Date.parse("2026-11-18T00:00:00+09:00"));
  }
  return weeks;
}
