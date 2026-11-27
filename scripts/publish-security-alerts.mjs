import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { pushOrphan } from "../src/git-orphan.mjs";

const expires = 45 * 60_000;
const urlId = url => createHash("sha256").update(url).digest("hex").slice(0, 24);

export function publicSecurityAlerts(feed, now = Date.now()) {
  const seen = new Set();
  const alerts = [];
  for (const alert of [...(Array.isArray(feed?.alerts) ? feed.alerts : [])]
    .filter(Boolean).sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt))) {
    const { id, title, source, url, first, qualifiedAt, detectedAt } = alert;
    const detected = Date.parse(detectedAt);
    const qualified = Date.parse(qualifiedAt);
    const published = Date.parse(first);
    if (!(now - expires <= detected && detected <= now + 60_000 &&
      published <= qualified && qualified <= detected) || alert.test ||
      typeof title !== "string" || !/[가-힣]/.test(title) || title.length > 160 ||
      typeof source !== "string" || !source.trim() || source.length > 70 ||
      typeof url !== "string" || seen.has(url) || id !== urlId(url)) continue;
    const target = URL.parse(url);
    if (!target || !["http:", "https:"].includes(target.protocol) || target.username || target.password ||
      !target.hostname.includes(".") || /(?:^|\.)(?:localhost|example\.(?:com|net|org)|invalid|test|local)$/i.test(target.hostname) ||
      /^[\d.]+$/.test(target.hostname)) continue;
    seen.add(url);
    alerts.push({ id, title, source, url, detectedAt: new Date(detected).toISOString() });
    if (alerts.length === 30) break;
  }
  return { updatedAt: new Date(now).toISOString(), alerts };
}

function main(root) {
  const latest = join(root, "latest.json");
  if (!existsSync(latest)) return;
  const output = join(root, "public-feed.json");
  const current = publicSecurityAlerts(JSON.parse(readFileSync(latest, "utf8")));
  const previous = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : null;
  if (previous && JSON.stringify(previous.alerts) === JSON.stringify(current.alerts)) return;
  const pending = join(root, `public-feed-${process.pid}.json`);
  writeFileSync(pending, JSON.stringify(current));
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: "NaiveInvestment", GIT_COMMITTER_NAME: "NaiveInvestment",
    GIT_AUTHOR_EMAIL: "NaiveInvest@users.noreply.github.com",
    GIT_COMMITTER_EMAIL: "NaiveInvest@users.noreply.github.com",
    GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never",
  });
  pushOrphan("security-alerts", [{ path: pending, name: "security-alerts.json" }], "Refresh public security alerts");
  renameSync(pending, output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv[2]);
