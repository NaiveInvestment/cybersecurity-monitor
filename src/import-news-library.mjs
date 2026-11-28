import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { archiveArticles } from "./news-archive.mjs";
import { mergeLibrary } from "../public/lib/news-library.js";

export async function importNewsLibrary(news, archiveDir, repo) {
  const local=process.env.AI_WORKSPACE_LOCAL && join(process.env.AI_WORKSPACE_LOCAL,"runtime","hong-security-alerts","news-library.json");
  let rows;
  if (local && existsSync(local)) rows=JSON.parse(readFileSync(local,"utf8")).items;
  else if (repo) {
    try {
    const response=await fetch("https://raw.githubusercontent.com/"+repo+"/security-alerts/news-library.json",{signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error("Public news library HTTP "+response.status);
    rows=(await response.json()).items;
    } catch (error) {
      if (!existsSync(archiveDir)) throw error;
      console.warn("뉴스 통합 원본 갱신 지연, 보존된 날짜별 기사를 사용합니다.",error.message);
      return news;
    }
  } else return news;
  if (!Array.isArray(rows)) throw new Error("Invalid public news library");
  archiveArticles(archiveDir,rows);
  return {...news,items:mergeLibrary(news.items,rows).slice(0,3000)};
}

