// GitHub Actions 장중 상시 폴러. 60초마다 네이버 일괄 시세를 받아 live 브랜치의 live.json 단일 커밋으로 강제 푸시한다.
// 크론 지연에 대비해 하루 여러 번 기동되며, 원격 live.json이 신선하면 대기하다가 앞선 폴러가 멈추면 이어받는다.
// --once: 한 번만 받아 live.json을 쓰고 끝낸다(푸시 없음, 로컬 확인용).
import { writeFileSync } from "node:fs";
import { loadUniverse } from "../src/universe.mjs";
import { fetchRealtime, fetchIndexRealtime } from "../src/naver.mjs";
import { activeSessions, minutesToNextSession } from "../src/sessions.mjs";
import { configureBot, pushOrphan } from "../src/git-orphan.mjs";

const TICK_MS = 60000;
const FRESH_MS = 150000;                   // 원격이 이보다 새로우면 다른 폴러가 살아 있다고 본다
const MAX_AGE_MS = 5.5 * 3600 * 1000;      // 러너 6시간 한도 전에 스스로 끝내 다음 크론이 이어받게 한다
const WAIT_LIMIT_MIN = 45;                 // 다음 장 시작이 이보다 멀면 종료
const once = process.argv.includes("--once");
const startedAt = Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const universe = loadUniverse();
const groups = {
  kr: universe.stocks.filter((stock) => stock.kind === "KR"),
  jp: universe.stocks.filter((stock) => stock.kind === "GL" && stock.country === "JP"),
  us: universe.stocks.filter((stock) => stock.kind === "GL" && stock.country !== "JP"),
};
const state = { q: {}, idx: {} };

async function remoteState() {
  if (!process.env.GITHUB_REPOSITORY) return null;
  try {
    const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/contents/live.json?ref=live`, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github.raw+json", "User-Agent": "live-poller" },
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function absorb(stocks, quotes) {
  for (const stock of stocks) {
    const quote = quotes[stock.code];
    if (quote) state.q[stock.id] = [quote.p, quote.chg, quote.cap, quote.capKrw, quote.tv, quote.at, quote.st];
  }
}

async function tick(sessions) {
  const jobs = [];
  if (sessions.asia) {
    jobs.push(fetchRealtime("KR", groups.kr.map((stock) => stock.code)).then((quotes) => absorb(groups.kr, quotes)));
    jobs.push(fetchRealtime("GL", groups.jp.map((stock) => stock.code)).then((quotes) => absorb(groups.jp, quotes)));
    jobs.push(fetchIndexRealtime("KR", ["KOSDAQ"]).then((quotes) => { if (quotes.KOSDAQ) state.idx.KOSDAQ = quotes.KOSDAQ; }));
  }
  if (sessions.us) {
    jobs.push(fetchRealtime("GL", groups.us.map((stock) => stock.code)).then((quotes) => absorb(groups.us, quotes)));
    jobs.push(fetchIndexRealtime("GL", [".IXIC"]).then((quotes) => { if (quotes[".IXIC"]) state.idx.IXIC = quotes[".IXIC"]; }));
  }
  const results = await Promise.allSettled(jobs);
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length === results.length) throw new Error(failed[0].reason.message);
  writeFileSync("live.json", JSON.stringify({ asOf: new Date().toISOString(), sessions, q: state.q, idx: state.idx }));
  return Object.keys(state.q).length;
}

async function main() {
  if (once) {
    const count = await tick({ asia: true, us: true });
    console.log(`live.json 작성: ${count}종목`);
    return;
  }
  configureBot();
  let active = false;
  while (true) {
    if (Date.now() - startedAt > MAX_AGE_MS) { console.log("가동 한도 도달, 다음 폴러에 넘김"); break; }
    const sessions = activeSessions();
    if (!sessions.asia && !sessions.us) {
      const wait = minutesToNextSession();
      if (wait > WAIT_LIMIT_MIN) { console.log(`다음 장까지 ${wait}분, 종료`); break; }
      await sleep(60000);
      continue;
    }
    if (!active) {
      const remote = await remoteState();
      if (remote?.asOf && Date.now() - Date.parse(remote.asOf) < FRESH_MS) { await sleep(60000); continue; }
      if (remote?.q) Object.assign(state.q, remote.q);       // 닫힌 시장의 마지막 값은 이어받는다
      if (remote?.idx) Object.assign(state.idx, remote.idx);
      active = true;
      console.log("활성 폴러로 전환");
    }
    try {
      const count = await tick(sessions);
      pushOrphan("live", [{ path: "live.json", name: "live.json" }], "live");
      console.log(new Date().toISOString(), `${count}종목`, JSON.stringify(sessions));
    } catch (error) {
      console.error("tick 실패:", error.message);
    }
    await sleep(TICK_MS);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
