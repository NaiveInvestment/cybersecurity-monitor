export function marketComposition(points, members, limit = 10) {
  const complete = points.filter(point => point.constituents && Number.isFinite(point.cap));
  if (!complete.length) return null;
  const closed = complete.filter(point => !point.live);
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
