// 해킹 사건 페이지 데이터 조립: data/incident-events.json을 쓴다. fetch-news 다음에 실행한다(사건 기록을 읽음).
// 사용: node scripts/build-incidents.mjs [--out _site/data] [--state state] [--offline]
// DeFiLlama는 실패하면 직전 캐시나 저장소 초기값을, ransomware.live는 분당 1회 제한이라 실행마다 이번 달 목록 한 번만 받는다.
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/universe.mjs";
import { compileEntities } from "../src/incident-log.mjs";
import { mergeEvents, ransomwareDays, kstDay } from "../src/incident-events.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const outDir = option("--out", join(ROOT, "_site", "data"));
const stateDir = option("--state", join(ROOT, "state"));
const offline = args.includes("--offline");
const UA = "cybersecurity-monitor/1.0 (incident page builder)";
const read = (path, fallback = null) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);
const DAYS = 92; // 화면은 최근 13주
const now = Date.now();
const since = kstDay(now - DAYS * 86400000);

async function getJson(url) {
  const response = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

// ---- DeFiLlama ----
const hackCache = join(stateDir, "defillama-hacks.json");
let hacks = read(hackCache)?.hacks || read(join(ROOT, "data", "incidents", "defillama-seed.json")).hacks;
let hackNote = "캐시";
if (!offline) {
  try {
    const fresh = await getJson("https://api.llama.fi/hacks");
    const cut = (now - 400 * 86400000) / 1000;
    hacks = fresh.filter((h) => h.date >= cut && h.amount >= 1e6).map(({ date, name, classification, technique, amount, chain, targetType }) => ({ date, name, classification, technique, amount, chain, targetType }));
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(hackCache, JSON.stringify({ fetchedAt: new Date().toISOString(), hacks }));
    hackNote = "새로 받음";
  } catch (error) { hackNote = `캐시 사용(${error.message})`; }
}

// ---- ransomware.live 일별 건수 ----
const rwPath = join(stateDir, "ransomware-days.json");
const rw = read(rwPath) || { fetchedAt: null, days: read(join(ROOT, "data", "incidents", "ransomware-seed.json")).days };
let rwNote = "캐시";
const stale = !rw.fetchedAt || now - Date.parse(rw.fetchedAt) > 50 * 60000;
if (!offline && stale) {
  // 월초 사흘은 지난달을 마저 받는다. 한 번 실행에 한 달만(분당 1회 제한).
  const target = new Date(now + 9 * 3600000);
  if (target.getUTCDate() <= 3 && rw.lastMonthDone !== kstDay(now).slice(0, 7)) target.setUTCMonth(target.getUTCMonth() - 1);
  const ym = `${target.getUTCFullYear()}/${String(target.getUTCMonth() + 1).padStart(2, "0")}`;
  try {
    const list = await getJson(`https://api.ransomware.live/v2/victims/${ym}`);
    if (!Array.isArray(list)) throw new Error("목록 아님");
    const prefix = ym.replace("/", "-");
    for (const day of Object.keys(rw.days)) if (day.startsWith(prefix)) delete rw.days[day];
    Object.assign(rw.days, ransomwareDays(list));
    if (prefix !== kstDay(now).slice(0, 7)) rw.lastMonthDone = kstDay(now).slice(0, 7);
    rw.fetchedAt = new Date().toISOString();
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(rwPath, JSON.stringify(rw));
    rwNote = `${prefix} 새로 받음`;
  } catch (error) { rwNote = `캐시 사용(${error.message})`; }
}

// ---- 합치기 ----
const research = read(join(ROOT, "data", "incidents", "research.json")).incidents;
const newsLog = read(join(stateDir, "incident-log.json"))?.stories || [];
const entityConfig = read(join(ROOT, "data", "incident-entities.json"));
const newsItems = read(join(stateDir, "news.json"))?.items || [];
// 원화 금전 피해 환산용 환율: 같은 조립의 시세 스냅샷, 없으면 직전 스냅샷, 그것도 없으면 환산하지 않는다.
const fx = read(join(outDir, "snapshot.json"))?.fx?.USD || read(join(stateDir, "snapshot.json"))?.fx?.USD || null;
const events = mergeEvents({ research, newsLog, entities: compileEntities(entityConfig), hacks, newsItems, since, fx });
const ransomware = Object.fromEntries(Object.entries(rw.days).filter(([day]) => day >= since).sort().map(([day, v]) => [day, { total: v.total, KR: v.KR, kr: (v.kr || []).slice(0, 12) }]));
const researchUntil = read(join(ROOT, "data", "incidents", "research.json")).collectedAt;
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "incident-events.json"), JSON.stringify({ updatedAt: new Date().toISOString(), since, until: kstDay(now), researchUntil, fx, events, ransomware }));
const count = (r, via) => events.filter((e) => e.r === r && (!via || e.via === via)).length;
console.log(`incidents: 사건 ${events.length}(국내 ${count("KR")}, 해외 ${count("GL")}; 리서치 ${events.filter((e) => e.via === "리서치").length}, 보도 수집 ${events.filter((e) => e.via === "보도 수집").length}, DeFiLlama ${events.filter((e) => e.via === "DeFiLlama").length}), 랜섬웨어 ${Object.keys(ransomware).length}일. DeFiLlama ${hackNote}, ransomware.live ${rwNote}`);
