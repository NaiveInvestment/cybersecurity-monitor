import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/translate-headlines.py", import.meta.url));
const reviewed = JSON.parse(readFileSync(new URL("../data/headline-corrections.json", import.meta.url), "utf8"));
const candidate = (title) => /[a-z]{2}/i.test(title) && !/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}]/u.test(title);
const englishHeadline = /\b(the|after|says|confirms|announces|cyberattack|data breach|hit by|stolen|exposes)\b/i;

function translateOffline(titles) {
  return new Promise((resolve, reject) => {
    const python = process.env.HEADLINE_PYTHON || "python";
    const child = execFile(python, [script], {
      windowsHide: true, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: "1", HF_HUB_DISABLE_PROGRESS_BARS: "1", HF_HUB_DISABLE_XET: "1" },
    }, (error, stdout, stderr) => {
      if (error) { reject(new Error("영문 제목 번역 실패: " + (stderr.trim() || error.message))); return; }
      try { resolve(JSON.parse(stdout)); } catch (cause) { reject(cause); }
    });
    child.stdin.on("error", (error) => { if (error.code !== "EPIPE") reject(error); });
    child.stdin.end(JSON.stringify(titles));
  });
}

// The original text remains the grouping and source-identity key. A URL or story
// ID alone is insufficient for reusing a translation when a publisher edits its title.
export async function translateHeadlines(items, {
  previous = [], corrections = reviewed, translate = translateOffline, warn = console.warn,
} = {}) {
  const translations = new Map();
  for (const item of previous) {
    if (item.lang === "en" && item.tKo && /[가-힣]/.test(item.tKo)) translations.set(item.t, item.tKo);
  }
  const warmCache = translations.size > 0;
  for (const [title, korean] of Object.entries(corrections)) translations.set(title, korean);
  const missing = [...new Set(items.map((item) => item.t))]
    .filter((title) => candidate(title) && !translations.has(title));
  if (missing.length) {
    try {
      const fresh = Object.entries(await translate(missing));
      if (fresh.length && fresh.every(([, korean]) => !korean)) throw new Error("한국어 번역 결과가 비어 있습니다.");
      for (const [title, korean] of fresh) translations.set(title, korean);
    } catch (error) {
      if (!warmCache) throw error;
      warn("제목 번역을 다음 수집에서 재시도합니다. " + error.message);
      for (const title of missing) if (englishHeadline.test(title)) translations.set(title, "");
    }
  }
  let english = 0;
  let translated = 0;
  for (const item of items) {
    const korean = translations.get(item.t);
    if (korean === undefined) continue;
    item.lang = "en";
    english++;
    if (korean && /[가-힣]/.test(korean)) { item.tKo = korean; translated++; }
  }
  if (english && !translated && !warmCache) throw new Error("영문 기사의 한국어 제목을 생성하지 못했습니다.");
  return { english, translated };
}
