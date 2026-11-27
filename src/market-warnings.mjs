import { stripTags } from "./news.mjs";

export const KIND_WARNINGS = "https://kind.krx.co.kr/investwarn/investattentwarnrisky.do?method=investattentwarnriskyMain";
const kinds = { attention: [1, "invstcautnisu_sub"], warning: [2, "invstwarnisu_sub"], danger: [3, "invstriskisu_sub"] };
const severity = { attention: 1, warning: 2, danger: 3 };
const isoDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value);
const dayMs = 86400000;
const dateKey = date => date.toISOString().slice(0, 10);
export const addDays = (day, count) => dateKey(new Date(Date.parse(day) + count * dayMs));
export const marketDay = now => dateKey(new Date(now + 9 * 3600000));
// Today’s daily row is provisional before the regular session has closed.
export function lastClosedDate(now, index) {
  const today = marketDay(now);
  const afterClose = new Date(now + 9 * 3600000).toISOString().slice(11, 16) >= "15:40";
  const tradedAt = Date.parse(index?.at);
  if (afterClose && index?.st === "CLOSE" && Number.isFinite(tradedAt) && marketDay(tradedAt) === today) return today;
  return addDays(today, -1);
}
const stockName = text => text.normalize("NFKC").replace(/\(주\)|주식회사|\s+/g, "").toLowerCase();
const olderNames = { "150900": ["파수"], "136540": ["윈스"], "067920": ["이글루시큐리티"], "232830": ["시큐센"] };
const preferred = /(?:\d+)?우(?:[BC])?$/i;
const compareDate = (a, b) => b.effective.localeCompare(a.effective);

export function parseKindWarningPage(html, level, page) {
  const pagination = /전체\s*<em>([\d,]+)<\/em>건\s*:\s*<strong>(\d+)<\/strong>\s*\/\s*(\d+)/.exec(html);
  const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(html)?.[1];
  if (!pagination || !body || Number(pagination[2]) !== page) throw new Error("KIND 조회 응답 형식 확인 필요");
  const total = Number(pagination[1].replaceAll(",", ""));
  const pages = Number(pagination[3]);
  const rows = [];
  for (const [, row] of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const identity = /companysummary_open\(\s*['"]([\dA-Z]{5,6})['"]\s*\)/i.exec(row);
    if (!identity) continue;
    const [, company, a, b, c] = Array.from(row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), match => match[1]);
    const name = stripTags(/<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(company || "")?.[1] || "");
    const [first, second, third] = [a, b, c].map(value => stripTags(value || ""));
    const attention = level === "attention";
    const announced = attention ? second : first;
    const effective = attention ? third : second;
    const released = !attention && third !== "-" ? third : null;
    if (!name || !isoDay(announced) || !isoDay(effective) || (released !== null && !isoDay(released))) {
      throw new Error("KIND 종목 또는 지정일 파싱 실패");
    }
    rows.push({ code: identity[1], name, level, announced, effective, released, reason: attention ? first : null });
  }
  if (rows.length !== Math.min(100, Math.max(0, total - (page - 1) * 100)) ||
      pages !== Math.max(1, Math.ceil(total / 100))) throw new Error("KIND 검색 건수와 페이지 불일치");
  return { rows, total, pages };
}

async function fetchKindPage(level, from, until, page, request) {
  const [menuIndex, forward] = kinds[level];
  const url = new URL(KIND_WARNINGS);
  url.search = "";
  const body = new URLSearchParams({ method: "investattentwarnriskySub", forward, menuIndex: String(menuIndex),
    currentPageSize: "100", pageIndex: String(page), orderMode: level === "attention" ? "4" : "3", orderStat: "D",
    marketType: "", startDate: from, endDate: until, searchFromDate: from, searchToDate: until });
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await request(url, { method: "POST", body, signal: AbortSignal.timeout(8000), headers: {
        "Referer": KIND_WARNINGS, "X-Requested-With": "XMLHttpRequest", "User-Agent": "Mozilla/5.0",
      } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseKindWarningPage(await res.text(), level, page);
    } catch (error) { last = error; }
  }
  throw last;
}

export async function fetchKindWarnings(level, from, until, request = fetch) {
  const first = await fetchKindPage(level, from, until, 1, request);
  const out = [...first.rows];
  for (let page = 2; page <= first.pages; page++) {
    const next = await fetchKindPage(level, from, until, page, request);
    if (next.total !== first.total) throw new Error("KIND 조회 중 건수 변경");
    out.push(...next.rows);
  }
  return out;
}

function matchesStock(stock, row) {
  if (row.code.length === 6) return stock.code === row.code;
  if (stock.code.slice(0, 5) !== row.code) return false;
  const name = stockName(row.name);
  return [stock.name, ...(olderNames[stock.code] || [])].some(alias => name === stockName(alias));
}

export function officialForStock(stock, results, today, sessions) {
  const rows = Object.values(results).flatMap(result => result?.rows || []).filter(row => matchesStock(stock, row));
  const active = rows.filter(row => row.level === "attention" ? row.effective === today :
    row.effective <= today && (!row.released || row.released > today))
    .sort((a, b) => severity[b.level] - severity[a.level] || compareDate(a, b));
  const upcoming = rows.filter(row => row.effective > today).sort((a, b) =>
    a.effective.localeCompare(b.effective) || severity[b.level] - severity[a.level]);
  const recentSessions = new Set(sessions.slice(-15));
  const attentionHistory = results.attention && recentSessions.size === 15 ? rows.filter(row =>
    row.level === "attention" && recentSessions.has(row.effective)).sort(compareDate) : null;
  const unresolved = Object.values(results).flatMap(result => result?.rows || []).some(row =>
    row.code === stock.code.slice(0, 5) && !preferred.test(stockName(row.name)) && !matchesStock(stock, row));
  return { active, upcoming, attentionHistory,
    complete: !unresolved && Object.keys(kinds).every(level => results[level] != null) };
}

const percent = (a, b) => 100 * (a - b) / b;
const valid = value => Number.isFinite(value) && value > 0;
const windows = [
  { id: "quick", days: 3, threshold: 100, multiple: 5 },
  { id: "short", days: 5, threshold: 60, multiple: 5 },
  { id: "medium", days: 15, threshold: 100, multiple: 3 },
  { id: "shortAccounts", days: 5, threshold: 45 },
  { id: "mediumAccounts", days: 15, threshold: 75 },
];

export function priceChecks(history, benchmark, cutoff) {
  const calendar = benchmark.filter(row => row.date <= cutoff);
  const session = calendar.at(-1);
  const prices = new Map(history.map(({ date, close }) => [date, close]));
  const close = prices.get(session?.date);
  if (!session || !valid(close)) return null;
  const recent = calendar.slice(-15);
  const high15 = recent.length === 15 && recent.every(row => valid(prices.get(row.date))) ?
    Math.max(...recent.map(row => prices.get(row.date))) : null;
  const checks = windows.map(rule => {
    const sample = calendar.slice(-(rule.days + 1));
    if (sample.length !== rule.days + 1 || !sample.every(row => valid(prices.get(row.date)))) {
      return { ...rule, result: null };
    }
    const [base] = sample;
    const prior = prices.get(base.date);
    const result = percent(close, prior);
    const rate = rule.multiple ? percent(session.close, base.close) : null;
    return { ...rule, baseDate: base.date, prior, result, indexReturn: rate,
      indexPass: rate === null ? null : result >= rate * rule.multiple,
      pricePass: close * 100 >= prior * (100 + rule.threshold),
      cutoffPrice: Math.ceil(prior * (100 + rule.threshold) / 100) };
  });
  const anniversary = new Date(session.date + "T00:00:00Z");
  const month = anniversary.getUTCMonth();
  anniversary.setUTCFullYear(anniversary.getUTCFullYear() - 1);
  if (anniversary.getUTCMonth() !== month) anniversary.setUTCDate(0);
  const lookback = dateKey(anniversary);
  const annualBase = calendar.findLast(row => row.date <= lookback);
  const annualPrice = prices.get(annualBase?.date);
  const annual = annualBase && valid(annualPrice) && (Date.parse(lookback) - Date.parse(annualBase.date)) <= 7 * dayMs ?
    { baseDate: annualBase.date, stockReturn: percent(close, annualPrice), indexReturn: percent(session.close, annualBase.close) } : null;
  if (annual) {
    annual.excess = annual.stockReturn - annual.indexReturn;
    annual.cutoffPrice = Math.ceil(annualPrice * (300 + annual.indexReturn) / 100);
  }
  return { date: session.date, close, high15, checks, annual };
}
