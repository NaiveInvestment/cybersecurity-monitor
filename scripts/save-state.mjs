// 누적 상태(헤드라인 보관분, 해킹 사건 기록, 직전 스냅샷)를 data 브랜치에 단일 커밋으로 저장한다. Actions 전용.
import { configureBot, pushOrphan } from "../src/git-orphan.mjs";
import { readdirSync } from "node:fs";

configureBot();
const commit = pushOrphan("data", [
  { path: "state/news.json", name: "news.json" },
  ...readdirSync("state/news-archive").filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map(name => ({ path: `state/news-archive/${name}`, name: `news-archive/${name}` })),
  { path: "state/incident-log.json", name: "incident-log.json" },
  { path: "state/ransomware-days.json", name: "ransomware-days.json", optional: true },
  { path: "state/defillama-hacks.json", name: "defillama-hacks.json", optional: true },
  { path: "_site/data/snapshot.json", name: "snapshot.json" },
  { path: "_site/data/short-balance.json", name: "short-balance.json", optional: true },
  { path: "_site/data/kosdaq-market.json", name: "kosdaq-market.json", optional: true },
  { path: "_site/data/kosdaq-sector-caps.json", name: "kosdaq-sector-caps.json", optional: true },
], "state");
console.log(`data 브랜치 갱신: ${commit}`);
