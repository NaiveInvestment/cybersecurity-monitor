// 조립된 사이트 폴더를 검사한다. 사용: node scripts/verify-site.mjs <사이트 폴더> [--same-as _site]
// 데이터 채움률, 카드 구성, 금지 문자, 자산 참조, (선택) 다른 빌드 폴더와의 파일 일치를 본다. 실패하면 종료 코드 1.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

const args = process.argv.slice(2);
const dir = args[0];
const sameAs = args.includes("--same-as") ? args[args.indexOf("--same-as") + 1] : null;
if (!dir || !existsSync(dir)) {
  console.error("사이트 폴더를 지정할 것");
  process.exit(1);
}

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const read = (path) => readFileSync(join(dir, path), "utf8");
const walk = (root) => readdirSync(root).flatMap((name) => {
  const path = join(root, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

for (const file of ["index.html", "news.html", "styles.css", "theme.js", "common.js", "app.js", "news.js", "lib/calc.js", "lib/status.js", "data/snapshot.json", "data/news.json", "data/cards.json", "data/meta.json", "robots.txt"]) {
  check(existsSync(join(dir, file)), `파일 없음: ${file}`);
}

if (!failures.length) {
  const snapshot = JSON.parse(read("data/snapshot.json"));
  const kr = snapshot.stocks.filter((stock) => stock.kind === "KR");
  const gl = snapshot.stocks.filter((stock) => stock.kind === "GL");
  check(kr.length === 35, `국내 종목 수 ${kr.length}, 기대 35`);
  check(gl.length >= 30, `해외 종목 수 ${gl.length}, 기대 30 이상`);
  const fill = (rows, test) => rows.filter(test).length / rows.length;
  check(fill(snapshot.stocks, (stock) => stock.q?.p > 0 && stock.q?.capKrw > 0) >= 0.95, "시세와 시가총액 채움률 95% 미만");
  check(fill(snapshot.stocks, (stock) => stock.b?.m1 > 0) >= 0.95, "일봉 기준가 채움률 95% 미만");
  check(fill(snapshot.stocks, (stock) => stock.f?.rev != null) >= 0.9, "분기 매출 채움률 90% 미만");
  check(fill(snapshot.stocks, (stock) => stock.f?.revTtm != null) >= 0.85, "TTM 매출 채움률 85% 미만");
  check(snapshot.fx.USD > 500 && snapshot.fx.USD < 3000, `USD 환율 이상: ${snapshot.fx.USD}`);
  check(snapshot.fx.JPY > 3 && snapshot.fx.JPY < 30, `JPY 환율 이상: ${snapshot.fx.JPY}`);
  check(Boolean(snapshot.indices.KOSDAQ?.q?.p && snapshot.indices.IXIC?.q?.p), "지수 시세 없음");
  // 내부 정합성: 원화 환산 시총은 현지 통화 시총과 환율의 곱과 1% 안에서 맞아야 한다.
  for (const stock of gl) {
    if (!stock.q?.cap || !stock.q?.capKrw) continue;
    const implied = (stock.q.cap * snapshot.fx[stock.cur]) / 100;
    check(Math.abs(implied / stock.q.capKrw - 1) < 0.01, `${stock.id}: 원화 환산 시총 불일치`);
  }
  // TTM 매출은 분기 매출보다 커야 하고, 스파크 마지막 값은 최근 분기 매출과 같아야 한다.
  for (const stock of snapshot.stocks) {
    if (!stock.f) continue;
    if (stock.f.revTtm != null) check(stock.f.revTtm >= stock.f.rev, `${stock.id}: TTM 매출이 분기 매출보다 작음`);
    check(stock.f.spark.at(-1)?.v === stock.f.rev, `${stock.id}: 스파크 마지막 값과 최근 분기 매출 불일치`);
  }

  const { cards } = JSON.parse(read("data/cards.json"));
  for (const region of ["KR", "GL"]) {
    for (const category of ["incident", "policy", "spending"]) {
      const count = cards.filter((card) => card.region === region && card.category === category).length;
      check(count >= 4, `카드 부족: ${region} ${category} ${count}장`);
    }
  }
  check(cards.every((card, index) => index === 0 || cards[index - 1].date >= card.date), "카드가 날짜 내림차순이 아님");
  check(cards.every((card) => !("note" in card)), "공개 카드에 검증 메모가 남아 있음");

  const news = JSON.parse(read("data/news.json"));
  check(news.items.length >= 50, `헤드라인 ${news.items.length}건, 기대 50 이상`);
  check(news.items.every((item) => ["incident", "policy", "spending"].includes(item.c) && ["KR", "GL"].includes(item.r) && /^https?:\/\//.test(item.u)), "헤드라인 필드 오류");
  check(new Set(news.items.map((item) => item.u)).size === news.items.length, "헤드라인 URL 중복");

  for (const file of walk(dir).filter((path) => /\.(html|js|css|json)$/.test(path))) {
    const text = readFileSync(file, "utf8");
    const name = relative(dir, file);
    // 수집한 기사 제목은 원문 그대로 두므로 news.json은 금지 문자 검사에서 뺀다.
    if (!name.endsWith("news.json")) {
      check(!/[·‧・]/.test(text), `${name}: 가운뎃점`);
      check(!/[①-⑳]/.test(text), `${name}: 원문자 숫자`);
    }
    if (/\.(html|js)$/.test(name)) check(!/\sstyle=/.test(text), `${name}: 인라인 style`);
    if (name.endsWith(".html")) {
      check(/<meta name="robots" content="noindex/.test(text), `${name}: noindex 없음`);
      for (const [, ref] of text.matchAll(/(?:src|href)="([^"#:]+?)(?:\?v=[0-9a-f]+)?"/g)) check(existsSync(join(dir, ref)), `${name}: 참조 파일 없음 ${ref}`);
    }
  }

  if (sameAs) {
    const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
    for (const file of walk(sameAs)) {
      const name = relative(sameAs, file);
      check(existsSync(join(dir, name)) && digest(join(dir, name)) === digest(file), `빌드 폴더와 다름: ${name}`);
    }
  }
  // 가져오는 모듈 경로에도 캐시 해시가 붙어 있어야 한다.
  for (const name of ["app.js", "news.js"]) check(!/from "\.\/[\w./-]+\.js"/.test(read(name)), `${name}: 해시 없는 import 경로`);
  if (snapshot.warnings?.length) console.log(`원천 확인 필요 ${snapshot.warnings.length}건:\n  ${snapshot.warnings.join("\n  ")}`);
  if (!failures.length) console.log(`verify-site ok: 국내 ${kr.length}, 해외 ${gl.length}, 카드 ${cards.length}장, 헤드라인 ${news.items.length}건, 채움률 ${JSON.stringify(snapshot.coverage)}`);
}

if (failures.length) {
  console.error(`verify-site 실패 ${failures.length}건:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
