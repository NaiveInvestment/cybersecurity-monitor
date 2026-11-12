// 정적 사이트 조립: public/ → _site/, 큐레이션 카드 복사, 자산 URL에 내용 해시, 검색 차단, meta.json.
// 사용: node scripts/build-site.mjs [--out _site] [--live owner/repo]
// --live를 주거나 GITHUB_REPOSITORY가 있으면 브라우저가 live 브랜치를 폴링한다. 없으면 스냅샷만 보여 준다.
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ROOT } from "../src/universe.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const outDir = option("--out", join(ROOT, "_site"));
const liveRepo = option("--live", process.env.GITHUB_REPOSITORY || null);
const defaultTheme = option("--default-theme", "dark");

const publicDir = join(ROOT, "public");
mkdirSync(join(outDir, "data"), { recursive: true });
cpSync(publicDir, outDir, { recursive: true });
if (existsSync(join(ROOT, "data", "financials.json"))) cpSync(join(ROOT,"data","financials.json"),join(outDir,"data","financials.json"));

// 큐레이션 카드: 스키마를 확인하고 날짜 내림차순으로 싣는다.
const cards = JSON.parse(readFileSync(join(ROOT, "data", "curated", "cards.json"), "utf8"));
const CATEGORIES = ["incident", "policy", "spending"];
for (const card of cards.cards) {
  const problems = [];
  if (!/^[a-z0-9-]+$/.test(card.id || "")) problems.push("id");
  if (!CATEGORIES.includes(card.category)) problems.push("category");
  if (!["KR", "GL"].includes(card.region)) problems.push("region");
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(card.date || "")) problems.push("date");
  if (!card.title || !card.claim || !card.status) problems.push("title/claim/status");
  if (!Array.isArray(card.facts) || !card.facts.length) problems.push("facts");
  if (!Array.isArray(card.sources) || !card.sources.length || card.sources.some((source) => !/^https?:\/\//.test(source.url))) problems.push("sources");
  if (problems.length) throw new Error(`cards.json: ${card.id || "(id 없음)"} 항목 오류: ${problems.join(", ")}`);
}
const ids = cards.cards.map((card) => card.id);
if (new Set(ids).size !== ids.length) throw new Error("cards.json: 중복 id");
cards.cards.sort((a, b) => b.date.localeCompare(a.date));
// 화면에 쓰는 필드만 싣는다. 검증 메모(note)는 저장소에만 둔다.
const published = cards.cards.map(({ note, verifiedOn, ...card }) => card);
writeFileSync(join(outDir, "data", "cards.json"), JSON.stringify({ updated: cards.updated, cards: published }));

for (const required of ["snapshot.json", "news.json"]) {
  if (!existsSync(join(outDir, "data", required))) throw new Error(`data/${required}가 없다. build-data와 fetch-news를 먼저 실행할 것.`);
}

writeFileSync(join(outDir, "data", "meta.json"), JSON.stringify({
  builtAt: new Date().toISOString(),
  live: liveRepo ? { repo: liveRepo, branch: "live", file: "live.json", relayConfig: `https://raw.githubusercontent.com/${liveRepo}/relay/relay.json` } : null,
}));
writeFileSync(join(outDir, "robots.txt"), "User-agent: *\nDisallow: /\n");
writeFileSync(join(outDir, ".nojekyll"), "");

// 자산 URL에 내용 해시를 붙여 배포 직후에도 옛 캐시가 남지 않게 한다. lib/은 app.js가 가져오므로 묶어서 한 해시를 쓴다.
const hashOf = (paths) => {
  const hash = createHash("sha256");
  for (const path of paths) hash.update(readFileSync(path));
  return hash.digest("hex").slice(0, 10);
};
const scripts = [...readdirSync(outDir).filter((name) => name.endsWith(".js")).map((name) => join(outDir, name)),
  ...readdirSync(join(outDir, "lib")).map((name) => join(outDir, "lib", name))].sort();
const versions = { "styles.css": hashOf([join(outDir, "styles.css")]), js: hashOf(scripts) };
// 모든 스크립트(lib 폴더 포함)의 import 경로에도 같은 해시를 붙여 새 파일과 옛 캐시가 섞이지 않게 한다.
for (const path of scripts) {
  const source = readFileSync(path, "utf8");
  const rewritten = source.replace(/(from "\.\/[\w./-]+\.js)(")/g, `$1?v=${versions.js}$2`);
  if (rewritten !== source) writeFileSync(path, rewritten);
}
for (const name of readdirSync(outDir).filter((file) => file.endsWith(".html"))) {
  const path = join(outDir, name);
  const html = readFileSync(path, "utf8")
    .replace(/(href="styles\.css)(")/g, `$1?v=${versions["styles.css"]}$2`)
    .replace(/(src="[\w-]+\.js)(")/g, `$1?v=${versions.js}$2`)
    .replace('data-default-theme="dark"', `data-default-theme="${defaultTheme === "light" ? "light" : "dark"}"`);
  writeFileSync(path, html);
}
console.log(`site: ${outDir}, 카드 ${cards.cards.length}장, live ${liveRepo || "꺼짐"}`);
