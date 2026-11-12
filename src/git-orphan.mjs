// 파일 몇 개를 부모 없는 커밋 하나로 만들어 브랜치에 강제 푸시한다. 브랜치 히스토리는 항상 1커밋으로 유지된다.
// skiet-parity-monitor의 live 브랜치 방식과 같다.
import { execFileSync } from "node:child_process";

function git(args, env = {}) {
  return execFileSync("git", args, { env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

export function configureBot() {
  git(["config", "user.name", "github-actions[bot]"]);
  git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
}

// files: [{ path: 로컬 파일 경로, name: 브랜치 안의 파일명 }]
export function pushOrphan(branch, files, message = "update") {
  const env = { GIT_INDEX_FILE: `.git/orphan-index-${branch}` };
  git(["read-tree", "--empty"], env);
  for (const file of files) {
    const blob = git(["hash-object", "-w", file.path]);
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},${file.name}`], env);
  }
  const tree = git(["write-tree"], env);
  const commit = git(["commit-tree", tree, "-m", message]);
  git(["push", "-f", "-q", "origin", `${commit}:refs/heads/${branch}`]);
  return commit;
}
