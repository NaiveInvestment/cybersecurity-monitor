// 로컬 서버. 127.0.0.1 전용.
//   node scripts/serve.mjs [--port 8895]             조립된 _site를 그대로 보여 준다.
//   node scripts/serve.mjs --live [--port 8858]      로컬 실시간 모드. 국내는 키움 실시간(Universe 서버 중계), 해외는 네이버 10초.
// 실시간 모드에서는 시작할 때와 3시간마다 스냅샷(일봉, 분기 재무)과 헤드라인을 다시 받아 조립한다.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join, normalize, extname } from "node:path";
import { loadUniverse, ROOT } from "../src/universe.mjs";
import { LocalLive } from "../src/live-local.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const liveMode = args.includes("--live");
const port = Number(option("--port", /^\d+$/.test(args[0] || "") ? args[0] : liveMode ? 8858 : 8895));
const root = join(ROOT, "_site");
const startedAt = new Date().toISOString();
const REBUILD_MS = 3 * 3600 * 1000;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8" };
const log = (message) => console.log(`${new Date().toISOString()} ${message}`);
const script = (name) => join(ROOT, "scripts", name);
const snapshotPath = join(root, "data", "snapshot.json");
let lastBuildAt = null;
let building = false;

function buildSteps(full) {
  const steps = [];
  if (full) {
    steps.push([script("build-data.mjs"), ...(existsSync(snapshotPath) ? ["--prev", snapshotPath] : [])]);
    steps.push([script("fetch-news.mjs")]);
  }
  steps.push([script("build-site.mjs")]);
  return steps;
}

// 시작할 때: 스냅샷이 없거나 3시간 넘게 낡았으면 전부 다시 받고, 아니면 화면 파일만 다시 조립한다.
function buildAtStartup() {
  const stale = !existsSync(snapshotPath) || Date.now() - statSync(snapshotPath).mtimeMs > REBUILD_MS;
  for (const step of buildSteps(stale)) {
    const result = spawnSync(process.execPath, step, { cwd: ROOT, encoding: "utf8" });
    if (result.status !== 0) {
      log(`빌드 실패: ${step[0]}\n${result.stderr || result.stdout}`);
      if (!existsSync(join(root, "index.html"))) throw new Error("조립된 사이트가 없어 시작할 수 없음");
      return;
    }
  }
  lastBuildAt = new Date().toISOString();
  log(stale ? "스냅샷과 헤드라인을 새로 받아 조립함" : "화면 파일을 다시 조립함");
}

// 가동 중: 서버를 멈추지 않고 뒤에서 다시 받는다. 실패하면 직전 조립본을 그대로 둔다.
function rebuildInBackground() {
  if (building) return;
  building = true;
  const steps = buildSteps(true);
  const next = () => {
    const step = steps.shift();
    if (!step) { building = false; lastBuildAt = new Date().toISOString(); log("주기 재조립 완료"); return; }
    const child = spawn(process.execPath, step, { cwd: ROOT, stdio: "ignore" });
    child.on("exit", (code) => { if (code === 0) next(); else { building = false; log(`주기 재조립 실패: ${step[0]}`); } });
  };
  next();
}

let live = null;
if (liveMode) {
  buildAtStartup();
  live = new LocalLive({ universe: loadUniverse(), log });
  live.start();
  setInterval(rebuildInBackground, REBUILD_MS).unref();
}

const json = (response, value) => {
  response.writeHead(200, { "content-type": TYPES[".json"], "cache-control": "no-store" });
  response.end(JSON.stringify(value));
};

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  if (pathname === "/health") {
    json(response, { status: "ok", app: "cybersecurity-monitor", mode: liveMode ? "live" : "static", startedAt, lastBuildAt, building,
      feed: live ? { ...live.feed, active: live.feedActive() } : null, naver: live ? live.naver : null });
    return;
  }
  if (live && pathname === "/live.json") { json(response, live.snapshot()); return; }
  if (live && pathname === "/data/meta.json") {
    // 조립본의 meta.json 대신 로컬 실시간 주소를 알려 준다. 화면은 이 주소를 2초마다 읽는다.
    json(response, { builtAt: lastBuildAt || startedAt, live: { url: "live.json", interval: 2000 } });
    return;
  }
  const file = normalize(join(root, pathname.endsWith("/") ? `${pathname}index.html` : pathname));
  if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1", () => log(`http://127.0.0.1:${port}/ (${liveMode ? "로컬 실시간" : "정적"})`));
