// 조립된 사이트를 실제 브라우저(Edge 또는 Chrome 헤드리스)로 열어 주요 조작을 검사한다.
// 사용: node scripts/interaction-check.mjs <사이트 폴더> [--shots <폴더>]
// 보기 전환, 통화 전환, 정렬, 검색, 분야 필터, 뉴스 탭과 지역, 검색어 진입, 묶음 펼치기, 테마 전환, 가로 넘침을 본다.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, normalize, extname } from "node:path";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const root = normalize(args[0] || "_site");
const shotsDir = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };
const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium-browser",
];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = normalize(join(root, pathname.endsWith("/") ? `${pathname}index.html` : pathname));
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browserPath = BROWSERS.find((path) => existsSync(path));
if (!browserPath) { console.error("브라우저를 찾지 못함"); process.exit(1); }
const profile = mkdtempSync(join(tmpdir(), "csm-check-"));
const debugPort = 9300 + Math.floor(Math.random() * 500);
const browser = spawn(browserPath, ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });

async function connect() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
      const page = targets.find((target) => target.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 아직 기동 중 */ }
    await sleep(200);
  }
  throw new Error("브라우저 디버깅 포트 연결 실패");
}

const socket = new WebSocket(await connect());
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
const consoleErrors = [];
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") {
    consoleErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text);
  } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  sequence += 1;
  pending.set(sequence, { resolve, reject });
  socket.send(JSON.stringify({ id: sequence, method, params }));
});
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
async function open(path, { width = 1440, height = 1000, scheme = "light" } = {}) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  await send("Page.navigate", { url: `${base}/${path}` });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(150);
    const ready = await evaluate("document.readyState === 'complete' && (document.querySelector('.grid tbody tr, .lead, .note, .empty') !== null)").catch(() => false);
    if (ready) return;
  }
  throw new Error(`${path}: 화면이 준비되지 않음`);
}
async function shot(name) {
  if (!shotsDir) return;
  mkdirSync(shotsDir, { recursive: true });
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(data, "base64"));
}

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const TABLE = `(() => { const rows = [...document.querySelectorAll('.grid tbody tr')]; return {
  count: rows.length, first: rows[0]?.querySelector('.stock')?.textContent, last: rows.at(-1)?.querySelector('.stock')?.textContent,
  heads: [...document.querySelectorAll('.grid thead tr.cols th')].map((th) => th.textContent.trim()),
  sorted: document.querySelector('.grid th[aria-sort]')?.textContent.trim() + ':' + document.querySelector('.grid th[aria-sort]')?.getAttribute('aria-sort'),
  capCell: rows[0]?.querySelector('.company-cap')?.textContent || rows[0]?.children[[...document.querySelectorAll('.grid thead tr.cols th')].findIndex((th) => th.textContent.trim() === '시가총액')]?.textContent,
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  wrapOverflow: document.querySelector('#table-wrap').scrollWidth > document.querySelector('#table-wrap').clientWidth,
  count_label: document.querySelector('#count').textContent, theme: document.documentElement.dataset.theme,
}; })()`;
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const type = (selector, text) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);

try {
  await send("Page.enable");
  await send("Runtime.enable");

  // ---- 종목 페이지, 데스크톱 ----
  await open("index.html");
  let table = await evaluate(TABLE);
  check(table.count === 35, `국내 보기 행 수 ${table.count}`);
  check(table.sorted.includes("시가총액:descending"), `기본 정렬 ${table.sorted}`);
  check(await evaluate("document.querySelector('#table-mode')===null&&document.querySelector('[data-sort=price]')!==null&&document.querySelector('[data-sort=ytd]')!==null"),'첫 화면이 시세, 수익률이 아님');
  check(!table.overflow && table.wrapOverflow, "국내 전체 실적 열이 표 안에서 좌우로 이어지지 않음");
  check(/억|조/.test(table.capCell), `시가총액 표기 ${table.capCell}`);
  const kpi = await evaluate("[...document.querySelectorAll('.kpi')].map((el) => el.textContent.replace(/\\s+/g, ' ').trim())");
  check(kpi.length === 2 && kpi[0].includes("35종목") && kpi[1].includes("36종목") && kpi.every((text) => text.includes("차이(%p)")), "요약 띠 구성 오류");
  check(/시세 \d\d-\d\d \d\d:\d\d KST/.test(await evaluate("document.querySelector('#status-text').textContent")), "기준 시각 표시 없음");
  await evaluate("document.querySelector('.grid tbody tr:last-child').scrollIntoView({block:'end',inline:'nearest'})");
  check(await evaluate("scrollY>0&&document.querySelector('.grid tbody tr:last-child').getBoundingClientRect().bottom<=innerHeight+1"),'페이지 세로 스크롤로 마지막 종목에 도달하지 못함');
  await shot('page-bottom');
  await evaluate('scrollTo(0,0)');
  await sleep(600);
  const issueBar = await evaluate("(() => { const el = document.querySelector('#issue-bar'); return el.hidden ? null : el.textContent; })()");
  check(issueBar === null || (/주요 이슈/.test(issueBar) && /\d+개 매체/.test(issueBar)), `한 줄 이슈 표기 ${issueBar}`);

  await click('#view-switch [data-view="GL"]');
  table = await evaluate(TABLE);
  check(table.count === 36, `해외 보기 행 수 ${table.count}`);
  check(!table.overflow && !table.wrapOverflow, "1440 해외 보기에서 가로 넘침");
  await shot("index-desktop-overseas-krw");
  await click('#cur-switch [data-cur="local"]');
  table = await evaluate(TABLE);
  check(/[$¥]/.test(table.capCell), `현지 통화 시가총액 표기 ${table.capCell}`);
  check(!table.wrapOverflow, "1440 해외 현지 통화 보기에서 표 가로 넘침");
  await shot("index-desktop-overseas-local");
  await click('#cur-switch [data-cur="krw"]');
  check(/조|억/.test((await evaluate(TABLE)).capCell), "원화 환산 복귀 실패");

  await click('#view-switch [data-view="ALL"]');
  table = await evaluate(TABLE);
  check(table.count === 71, `전체 보기 행 수 ${table.count}`);
  check(!table.overflow && !table.wrapOverflow, "1440 전체 보기에서 가로 넘침");
  await click('#view-switch [data-view="GL"]');
  await click('[data-sort="yoy"]');
  table = await evaluate(TABLE);
  check(table.sorted.endsWith(":descending") && table.sorted.includes("YoY"), `YoY 정렬 ${table.sorted}`);
  const yoyDesc = await evaluate(`(() => { const i = [...document.querySelectorAll('.grid thead tr.cols th')].findIndex((th) => th.textContent.includes('YoY')); return [...document.querySelectorAll('.grid tbody tr')].map((tr) => tr.children[i].textContent); })()`);
  const numeric = yoyDesc.filter((text) => text !== "-").map((text) => Number(text.replace(/[+%,]/g, "")));
  check(numeric.every((value, index) => index === 0 || numeric[index - 1] >= value), "YoY 내림차순 정렬이 어긋남");
  check(yoyDesc.indexOf("-") === -1 || yoyDesc.slice(yoyDesc.indexOf("-")).every((text) => text === "-"), "결측이 맨 아래가 아님");
  await click('[data-sort="yoy"]');
  check((await evaluate(TABLE)).sorted.endsWith(":ascending"), "오름차순 전환 실패");
  await click('[data-sort="cap"]');
  await click('#view-switch [data-view="ALL"]');
  await click('#view-switch [data-view="KR"]');
  check(await evaluate("document.querySelector('#notes') === null"), "하단 설명이 남음");
  const timeline=await evaluate("({headers:[...document.querySelectorAll('.grid .cols th')].map(e=>e.textContent),groups:document.querySelector('.groups').textContent,values:document.querySelectorAll('.grid tbody tr:first-child .financial-value').length})");
  check(['2023A','2024A','2025A','2026E','2027E'].every(y=>timeline.headers.includes(y))&&!timeline.headers.some(y=>y.includes('2028')), '2027년까지의 연간 시계열 기간 오류');
  check(['매출','영업이익','지배순이익','P/E','P/B','ROE'].every(m=>timeline.groups.includes(m))&&timeline.values===30,'실적과 밸류 전체 동시 표시 실패');
  const summary=await evaluate("({keys:[...document.querySelectorAll('.grid tbody tr:first-child .ttm-value')].map(e=>e.dataset.summary),headers:[...document.querySelectorAll('.grid .cols th')].map(e=>e.textContent),right:document.querySelector('.grid .cols th.ttm-summary:last-of-type')?.getBoundingClientRect().right})");
  check(JSON.stringify(summary.keys)===JSON.stringify(['revTtm','opTtm','niTtm','psr','per']),'TTM 요약 다섯 지표 순서 오류');
  check(summary.headers.indexOf('PER')<summary.headers.indexOf('2023A'),'연도별 상세가 TTM 요약보다 먼저 표시됨');
  check(await evaluate("document.querySelector('.grid thead [data-sort=per]').getBoundingClientRect().right<=innerWidth"),'1440 화면에서 TTM 요약이 처음부터 모두 보이지 않음');
  await click('[data-sort="per"]');
  check(await evaluate("document.querySelector('[data-sort=per]').closest('th').getAttribute('aria-sort')==='descending'"),'TTM PER 정렬 실패');
  await evaluate("document.querySelector('.grid').scrollIntoView({block:'start',inline:'nearest'})");
  await shot('ttm-summary');
  await evaluate('scrollTo(0,0)');
  check(await evaluate("document.querySelector('#financial-metric')===null&&document.querySelector('#valuation-metric')===null"),'지표 선택기가 남음');
  check(await evaluate("document.documentElement.scrollHeight>innerHeight&&document.querySelector('#table-wrap').scrollHeight<=document.querySelector('#table-wrap').clientHeight+1"),'표 안의 세로 스크롤이 남음');
  await evaluate("document.querySelector('#table-pan').scrollLeft=1500");await sleep(100);
  check(await evaluate("Math.abs(document.querySelector('#table-wrap').scrollLeft-document.querySelector('#table-pan').scrollLeft)<2"),'상단 좌우 스크롤 연결 실패');
  await shot('financial-right');
  await evaluate("document.querySelector('#table-pan').scrollLeft=0");await sleep(100);
  await evaluate("document.querySelector('#financial-horizon').value='oneMonth';document.querySelector('#financial-horizon').dispatchEvent(new Event('change',{bubbles:true}))");
  check(await evaluate("document.querySelector('.groups').textContent.includes('1M 평균')"), "컨센서스 기준 전환 실패");
  await evaluate("document.querySelector('#financial-horizon').value='threeMonth';document.querySelector('#financial-horizon').dispatchEvent(new Event('change',{bubbles:true}))");
  await sleep(400);
  check(await evaluate("document.querySelectorAll('.sector-chart path').length>=5"), "섹터 그래프 없음");
  await click('[data-weight="cap"]');
  check(await evaluate("document.querySelector('[data-weight=cap]').getAttribute('aria-pressed')==='true'"), "시총가중 전환 실패");
  await click('[data-weight="equal"]');
  await click('[data-range="3M"]');
  await evaluate("document.querySelector('.sector-picker').open=true");
  await click('.sector-picker [data-series="staples"]');
  check(await evaluate("document.querySelector('.series-staples')!==null"), "소비재 추가 실패");
  check(await evaluate("getComputedStyle(document.querySelector('.series-staples')).stroke===getComputedStyle(document.querySelector('.legend-staples .legend-line')).backgroundColor"), "소비재 선과 범례 색 불일치");
  await evaluate("document.querySelector('.sector-picker').open=false");
  await shot('consumer-sector');
  await evaluate("document.querySelector('.sector-picker').open=true");
  await click('.sector-picker [data-series="staples"]');
  await click('[data-range="YTD"]');
  await click('#view-switch [data-view="ALL"]');

  await type("#search", "crowd");
  table = await evaluate(TABLE);
  check(table.count === 1 && table.first === "크라우드스트라이크", `영문 검색 결과 ${table.count} ${table.first}`);
  await type("#search", "없는종목");
  check(await evaluate("document.querySelector('.empty') !== null"), "빈 결과 안내 없음");
  await type("#search", "");
  await click('#seg-chips [data-seg="identity"]');
  table = await evaluate(TABLE);
  const identityAll = await evaluate("[...document.querySelectorAll('.grid tbody tr td.tag')].every((td) => td.textContent === '인증과 ID')");
  check(table.count > 5 && table.count < 71 && identityAll, `분야 필터 결과 ${table.count}`);
  await click('#seg-chips [data-seg="identity"]');
  check((await evaluate(TABLE)).count === 71, "분야 필터 해제 실패");

  const before = (await evaluate(TABLE)).theme;
  await click("[data-theme-toggle]");
  const after = (await evaluate(TABLE)).theme;
  check(before !== after, "테마 전환 실패");
  await shot("index-desktop-all-toggled-theme");
  await click("[data-theme-toggle]");
  // 저장된 선택은 시스템 설정보다 우선한다. 이후 검사는 저장값 없이 시스템 설정을 따르는지 본다.
  check(await evaluate("localStorage.getItem('csm-theme')") === before, "테마 선택이 저장되지 않음");
  await evaluate("localStorage.removeItem('csm-theme')");

  const link = await evaluate("document.querySelector('.grid tbody tr .stock').getAttribute('href')");
  check(/^news\.html\?q=/.test(link), `종목명 링크 ${link}`);

  // ---- 종목 페이지, 모바일 ----
  await open("index.html", { width: 390, height: 844, scheme: "dark" });
  table = await evaluate(TABLE);
  check(table.theme === "dark", "시스템 다크 설정을 따르지 않음");
  check(!table.overflow, "모바일 페이지 가로 넘침");
  check(!table.heads.includes("분야") && table.heads[1] === "현재가", `모바일 기본 열 구성 ${table.heads.slice(0, 4).join(",")}`);
  check(await evaluate("document.querySelector('#table-wrap').scrollHeight<=document.querySelector('#table-wrap').clientHeight+1"),'모바일 표 안 세로 스크롤이 남음');
  await evaluate("const w=document.querySelector('#table-wrap');w.scrollLeft=1600;w.dispatchEvent(new Event('scroll'))");await sleep(100);
  await shot('financial-mobile-right');
  await evaluate("document.querySelector('#table-wrap').scrollLeft=0");
  await click('#view-switch [data-view="GL"]');
  await shot("index-mobile-dark-overseas");

  // ---- 뉴스 페이지 ----
  await open("news.html");
  const NEWS = `(() => ({
    lead: document.querySelector('.lead h3')?.textContent || '', leadSources: Number(document.querySelector('.lead-stats b')?.textContent),
    leadCount: Number(document.querySelectorAll('.lead-stats b')[1]?.textContent), leadDigest: document.querySelector('.lead-digest') !== null,
    ranks: document.querySelectorAll('.rank li').length, notes: document.querySelectorAll('.note').length,
    headlines: document.querySelectorAll('.headline').length, tab: document.querySelector('#tabs [aria-selected="true"]').dataset.tab,
    countries: [...new Set([...document.querySelectorAll('.note-head em')].map((el) => el.textContent.trim()))],
    related: document.querySelectorAll('details.related').length, focus: document.querySelector('.focus-bar') !== null,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    feedTop: Math.round(document.querySelector('#feed-title').getBoundingClientRect().top + window.scrollY),
    theme: document.documentElement.dataset.theme,
  }))()`;
  let page = await evaluate(NEWS);
  check(page.theme === "dark", "기본 테마가 다크가 아님");
  check(page.lead.length > 5 && page.leadSources >= 2 && page.ranks >= 3, `주요 이슈 구성: 대표 ${page.leadSources}개 매체, 순위 ${page.ranks}건`);
  check(page.tab === "incident" && page.notes >= 10 && page.headlines >= 15, `뉴스 첫 화면 정리 ${page.notes}건, 기사 ${page.headlines}건`);
  check(!page.overflow, "뉴스 페이지 가로 넘침");
  const rankSources = await evaluate("[...document.querySelectorAll('.rank .meta')].map((el) => Number((/(\\d+)개 매체/.exec(el.textContent) || [])[1]))");
  check(rankSources.every((value, index) => (index === 0 ? page.leadSources >= value : rankSources[index - 1] >= value)), `주요 이슈가 매체 수 순이 아님: ${page.leadSources}, ${rankSources.join(",")}`);
  const noteDates = await evaluate("[...document.querySelectorAll('.note-date')].map((el) => el.firstChild.textContent)");
  check(noteDates.every((date, index) => index === 0 || noteDates[index - 1] >= date), "정리가 날짜 내림차순이 아님");
  check(await evaluate("document.querySelector('.note').open && !document.querySelectorAll('.note')[1].open"), "정리의 첫 건만 펼쳐져 있어야 함");
  await evaluate("document.querySelectorAll('.note')[1].querySelector('summary').click()");
  check(await evaluate("document.querySelectorAll('.note')[1].open && document.querySelectorAll('.note')[1].querySelectorAll('.facts dt').length >= 2"), "정리 펼치기 실패");
  check(page.related >= 1, "같은 사건 묶음이 없음");
  await shot("news-desktop-dark");

  // 주요 이슈의 관련 기사 모두 보기
  await click(".lead-more");
  page = await evaluate(NEWS);
  check(page.focus && page.headlines === page.leadCount, `사건 모아 보기: 기사 ${page.headlines}건, 기대 ${page.leadCount}건`);
  await shot("news-desktop-focus");
  await click("#focus-clear");
  check(!(await evaluate(NEWS)).focus, "전체 기사로 돌아가기 실패");

  await click('#region-switch [data-region="KR"]');
  page = await evaluate(NEWS);
  check(page.countries.length === 1 && page.countries[0] === "한국", `국내 필터 뒤 국가 ${page.countries.join(",")}`);
  check(await evaluate("[...document.querySelectorAll('.headline .meta')].filter((el) => !el.closest('.related')).every((el) => el.textContent.includes('국내'))"), "국내 필터 뒤 해외 기사가 남음");
  check(await evaluate("document.querySelector('.kicker').textContent.includes('국내')"), "국내 필터 뒤 주요 이슈가 국내가 아님");
  await click('#region-switch [data-region="GL"]');
  page = await evaluate(NEWS);
  check(!page.countries.includes("한국") && page.notes >= 4, `해외 필터 뒤 정리 ${page.notes}건`);
  check(await evaluate("document.querySelector('.kicker').textContent.includes('해외')"), "해외 필터 뒤 주요 이슈가 해외가 아님");
  await click('#region-switch [data-region="ALL"]');

  await click('#tabs [data-tab="policy"]');
  const tones = await evaluate("Object.fromEntries([...document.querySelectorAll('.note .state')].map((el) => [el.textContent, el.dataset.tone]))");
  check(tones["시행 예정"] === "plan" && tones["제소"] === "plan" && tones["시행"] === "done", `상태 색 ${JSON.stringify(tones)}`);
  check(await evaluate("[...document.querySelectorAll('.note-date i')].some((el) => el.textContent === '시행')"), "정리 날짜 의미 표시 없음");
  for (const tab of ["policy", "spending"]) {
    await click(`#tabs [data-tab="${tab}"]`);
    page = await evaluate(NEWS);
    check(page.tab === tab && page.notes >= 8 && page.headlines >= 5, `${tab} 탭 정리 ${page.notes}건, 기사 ${page.headlines}건`);
  }
  await shot("news-desktop-spending");
  const sevenDays = await evaluate("(() => { document.querySelector('#period-switch [data-period=\"7\"]').click(); return document.querySelectorAll('.headline').length; })()");
  const allDays = await evaluate("(() => { document.querySelector('#period-switch [data-period=\"0\"]').click(); return document.querySelectorAll('.headline').length; })()");
  check(sevenDays <= allDays, "기간 필터 결과가 어긋남");
  await type("#search", "KT");
  page = await evaluate(NEWS);
  check(page.notes >= 1 && page.notes <= 6, `검색 뒤 정리 ${page.notes}건`);

  await open(`news.html?q=${encodeURIComponent("SK텔레콤")}`);
  page = await evaluate(NEWS);
  check(page.notes >= 1 && (await evaluate("document.querySelector('#search').value")) === "SK텔레콤", "검색어 진입 실패");
  check(await evaluate("document.querySelector('#period-switch [aria-pressed=\"true\"]').dataset.period") === "0", "검색어 진입 시 기간이 전체로 바뀌지 않음");

  await open(`index.html?q=${encodeURIComponent("팔로알토")}`);
  table = await evaluate(TABLE);
  check(table.count === 1 && table.first === "팔로알토 네트웍스", `종목 검색어 진입 결과 ${table.count} ${table.first}`);

  await open("news.html", { width: 390, height: 844, scheme: "light" });
  page = await evaluate(NEWS);
  check(!page.overflow, "모바일 뉴스 가로 넘침");
  check(page.lead.length > 5, "모바일 주요 이슈 없음");
  check(await evaluate("getComputedStyle(document.querySelector('.jump')).display") === "flex", "모바일 바로가기 없음");
  await click('#tabs [data-tab="policy"]');
  page = await evaluate(NEWS);
  check(page.notes === 3 && await evaluate("document.querySelector('#more-digest') !== null"), `모바일 정리 미리보기 ${page.notes}건`);
  await shot("news-mobile-dark-policy");
  await click("#more-digest");
  check((await evaluate(NEWS)).notes >= 10, "정리 더 보기 실패");

  // Browser-level source transition simulation. No live market prices are fabricated on the site.
  const fixture=JSON.parse(await readFile(join(root,'data','snapshot.json'),'utf8'));
  const target=fixture.stocks.find(s=>s.kind==='KR');
  const cloudRows=Object.fromEntries(fixture.stocks.map(s=>[s.id,[s.q.p,s.q.chg,s.q.cap,s.q.capKrw,s.q.tv,s.q.at,s.q.st]]));
  const init=`(()=>{const original=window.fetch.bind(window),rows=${JSON.stringify(cloudRows)},id=${JSON.stringify(target.id)};window.__relayTest='key';window.fetch=async function(input,options){const u=String(input);const json=x=>Promise.resolve(new Response(JSON.stringify(x),{status:200,headers:{'Content-Type':'application/json'}}));if(u.endsWith('data/meta.json'))return json({live:{repo:'test/test',branch:'live',file:'live.json',relayConfig:'https://raw.githubusercontent.com/test/test/relay/relay.json'}});if(u.includes('/relay/relay.json'))return json({url:'https://test.trycloudflare.com/live.json'});if(u.includes('api.github.com/repos/test/test/contents/live.json'))return json({asOf:new Date().toISOString(),q:rows,idx:{},source:'네이버 금융'});if(u.includes('test.trycloudflare.com')){if(window.__relayTest==='off')throw new Error('simulated PC off');const q=structuredClone(rows);if(window.__relayTest==='key')q[id]=[rows[id][0]+100,1,rows[id][2],rows[id][3],rows[id][4],new Date().toISOString(),'OPEN'];return json({asOf:new Date().toISOString(),q,idx:{},source:window.__relayTest==='key'?'국내 키움 실시간, 해외 네이버 10초':'네이버 금융 10초 갱신'});}return original(input,options);};})();`;
  await send('Page.addScriptToEvaluateOnNewDocument',{source:init});
  await open('index.html');await sleep(2800);
  const readPrice=`(()=>{const tr=[...document.querySelectorAll('.grid tbody tr')].find(tr=>tr.querySelector('.stock')?.textContent===${JSON.stringify(target.name)});return Number(tr.querySelector('.quote').textContent.replace(/,/g,''));})()`;
  check(await evaluate(readPrice)===target.q.p+100,'키움 중계 우선 적용 실패');
  await evaluate("window.__relayTest='off'");await sleep(2600);
  check(await evaluate(readPrice)===target.q.p,'PC 중단 후 네이버 가격 복원 실패');
  check(!(await evaluate("document.querySelector('#status-text').textContent")).includes('키움'),'PC 중단 후 키움 출처 잔존');
  await evaluate("window.__relayTest='key'");await sleep(2600);
  check(await evaluate(readPrice)===target.q.p+100,'중계 재연결 실패');
  await evaluate("window.__relayTest='naver'");await sleep(2600);
  check(await evaluate(readPrice)===target.q.p,'키움 연결 중단 후 로컬 네이버 복원 실패');
  check((await evaluate("document.querySelector('#status-text').textContent")).includes('네이버 금융 10초'),'네이버 전환 출처 불일치');
  check(consoleErrors.length === 0, `콘솔 오류: ${consoleErrors.join(" | ")}`);
} catch (error) {
  failures.push(`실행 오류: ${error.message}`);
} finally {
  socket.close();
  browser.kill();
  server.close();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* 프로필 정리는 실패해도 무방 */ }
}

if (failures.length) {
  console.error(`interaction-check 실패 ${failures.length}건:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("interaction-check ok");
