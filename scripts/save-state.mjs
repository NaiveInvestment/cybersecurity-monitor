// 누적 상태(헤드라인 보관분, 해킹 사건 기록, 직전 스냅샷)를 data 브랜치에 단일 커밋으로 저장한다. Actions 전용.
import { configureBot, pushOrphan } from "../src/git-orphan.mjs";

configureBot();
const commit = pushOrphan("data", [
  { path: "state/news.json", name: "news.json" },
  { path: "state/incident-log.json", name: "incident-log.json" },
  { path: "state/ransomware-days.json", name: "ransomware-days.json", optional: true },
  { path: "state/defillama-hacks.json", name: "defillama-hacks.json", optional: true },
  { path: "_site/data/snapshot.json", name: "snapshot.json" },
], "state");
console.log(`data 브랜치 갱신: ${commit}`);
