import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pushOrphan } from "../src/git-orphan.mjs";
import { ROOT } from "../src/universe.mjs";

const runtime = join(process.env.LOCALAPPDATA, "AIWorkspace", "runtime", "cybersecurity-monitor");
mkdirSync(runtime, { recursive: true });
const executable = join(process.env.LOCALAPPDATA, "AIWorkspace", "tools", "cloudflared", "cloudflared.exe");
const configPath = join(runtime, "relay.json");
let child, url = null, published = false, stopped = false;
const log = message => console.log(new Date().toISOString(), message);
function publish() {
  if (!url || published || stopped) return;
  try {
    writeFileSync(configPath, JSON.stringify({ url: `${url}/live.json`, updatedAt: new Date().toISOString() }));
    process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "NaiveInvestment";
    process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "NaiveInvestment@users.noreply.github.com";
    process.env.GCM_INTERACTIVE = "Never";
    process.env.GIT_TERMINAL_PROMPT = "0";
    pushOrphan("relay", [{ path: configPath, name: "relay.json" }], "Update public quote relay address");
    published = true;
    log("공개 시세 주소 갱신 완료");
  } catch { log("시세 주소 게시 실패, 30초 뒤 재시도"); }
}
function start() {
  url = null; published = false;
  child = spawn(executable, ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:8859", "--protocol", "http2"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let buffer = "";
  const read = data => {
    buffer = (buffer + data.toString()).slice(-12000);
    const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && url !== match[0]) { url = match[0]; publish(); }
  };
  child.stdout.on("data", read); child.stderr.on("data", read);
  child.on("error", () => log("터널 실행 실패"));
  child.on("close", () => { if (!stopped) setTimeout(start, 5000); });
}
const server = createServer((req, res) => { res.writeHead(200, {"Content-Type":"application/json"}); res.end(JSON.stringify({ app: "cybersecurity-public-relay", published, url })); });
server.on("error", error => { if (error.code === "EADDRINUSE") process.exit(0); throw error; });
server.listen(8860, "127.0.0.1", start);
setInterval(publish, 30000).unref();
let financialBusy=false;
function refreshFinancials() {
  if(financialBusy)return;financialBusy=true;
  const job=spawn(process.execPath,[join(ROOT,'scripts','export-financials.mjs'),'--out',join(runtime,'financials.json'),'--publish'],{cwd:ROOT,windowsHide:true,stdio:'ignore'});
  job.on('error',()=>{financialBusy=false;});job.on('exit',()=>{financialBusy=false;});
}
setTimeout(refreshFinancials,15000);setInterval(refreshFinancials,300000).unref();
for (const event of ["SIGINT", "SIGTERM"]) process.on(event, () => { stopped = true; child?.kill(); server.close(); process.exit(0); });
