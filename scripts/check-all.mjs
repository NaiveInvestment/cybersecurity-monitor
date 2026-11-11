// 납품 전 일괄 검사: 단위 테스트 + 사이트 폴더 검사(빌드 폴더와의 일치 포함) + 브라우저 조작 검사.
// 사용: node scripts/check-all.mjs <사이트 폴더>
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "../src/universe.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("사이트 폴더를 지정할 것");
  process.exit(1);
}
const run = (label, args) => {
  const status = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" }).status;
  console.log(`[${label}] ${status === 0 ? "통과" : "실패"}`);
  return status === 0;
};
const results = [
  run("단위 테스트", ["--test"]),
  run("사이트 검사", [join(ROOT, "scripts", "verify-site.mjs"), dir, "--same-as", join(ROOT, "_site")]),
  run("브라우저 조작 검사", [join(ROOT, "scripts", "interaction-check.mjs"), dir]),
];
if (results.includes(false)) process.exit(1);
console.log("check-all ok");
