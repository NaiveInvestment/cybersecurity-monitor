// 종목 페이지: 스냅샷을 그리고, 배포본에서는 live 브랜치의 시세를 덧씌운다.
import { pct, valuation, mean } from "./lib/calc.js";
import { groupStories, topIssues } from "./lib/issues.js";
import { esc, fmtEok, fmtLocalMillion, fmtPrice, fmtPct, signClass, fmtKst, loadJson, initTheme } from "./common.js";

const state = { view: "KR", cur: "krw", query: "", segs: new Set(), sort: { key: "cap", dir: "desc" }, liveAsOf: null, liveRev: null, liveSource: null };
// 방금 값이 바뀐 종목. 현재가 칸을 한 번 반짝이게 한다.
const flash = new Map();
let snapshot = null;
let meta = null;

const $ = (selector) => document.querySelector(selector);
const narrow = window.matchMedia("(max-width: 640px)");

// 화면에 쓰는 파생값. 금액은 원화 환산(억원)과 현지 통화(국내 억원, 해외 백만)를 함께 들고 있다.
function derive(stock) {
  const q = stock.q || {};
  const b = stock.b || {};
  const f = stock.f || null;
  const fx = snapshot.fx[stock.cur];
  const toEok = (value) => (value == null ? null : stock.kind === "KR" ? value : fx ? (value * fx) / 100 : null);
  const value = valuation(q.cap, f);
  return {
    price: q.p ?? null, chg: q.chg ?? null, tv: q.tv ?? null,
    cap: q.capKrw ?? toEok(q.cap), capLocal: q.cap ?? null,
    w1: pct(q.p, b.w1), m1: pct(q.p, b.m1), m3: pct(q.p, b.m3), ytd: pct(q.p, b.ytd), y1: pct(q.p, b.y1),
    dd: b.hi52 != null && q.p != null ? pct(q.p, Math.max(b.hi52, q.p)) : null,
    ym: f?.ym ?? null, yoy: f?.yoy ?? null, opm: f?.opm ?? null,
    rev: toEok(f?.rev), revLocal: f?.rev ?? null,
    revTtm: toEok(f?.revTtm), revTtmLocal: f?.revTtm ?? null,
    opTtm: toEok(f?.opTtm), opTtmLocal: f?.opTtm ?? null,
    psr: value.psr, per: value.per,
  };
}

const money = (stock, d, key) => (state.cur === "krw" || stock.kind === "KR" ? fmtEok(d[key]) : fmtLocalMillion(d[`${key}Local`], stock.cur));

function heat(value) {
  if (value == null || Math.abs(value) < 2) return "";
  const abs = Math.abs(value);
  const level = abs >= 40 ? 5 : abs >= 20 ? 4 : abs >= 10 ? 3 : abs >= 5 ? 2 : 1;
  return `h-${value > 0 ? "p" : "n"}${level}`;
}

function spark(stock) {
  const points = stock.f?.spark || [];
  if (points.length < 2) return "-";
  const max = Math.max(...points.map((point) => point.v));
  if (!(max > 0)) return "-";
  const label = points.map((point) => `${point.ym.slice(2).replace("-", ".")} ${point.v.toLocaleString("ko-KR")}`).join(", ");
  const bars = points.map((point, index) => {
    const height = Math.max(1, Math.round((point.v / max) * 16));
    return `<rect x="${index * 9}" y="${16 - height}" width="7" height="${height}"${index === points.length - 1 ? ' class="last"' : ""}></rect>`;
  }).join("");
  return `<svg class="spark" width="${points.length * 9 - 2}" height="16" viewBox="0 0 ${points.length * 9 - 2} 16" role="img" aria-label="분기 매출 ${esc(label)}"><title>분기 매출(${esc(stock.f.unit === "억원" ? "억원" : `${stock.f.unit} 백만`)}): ${esc(label)}</title>${bars}</svg>`;
}

const pctCell = (value, withHeat = true) => ({ html: fmtPct(value), cls: withHeat ? heat(value) : signClass(value) });

const GROUPS = [
  { id: "id", label: "종목" }, { id: "quote", label: "시세" }, { id: "ret", label: "수익률" },
  { id: "fin", label: "실적 (최근 확정 분기, 직전 4개 분기 합계)" }, { id: "val", label: "밸류" },
];

const COLUMNS = [
  { key: "name", group: "id", label: "종목", cls: "name", sort: (s) => s.name,
    cell: (s) => ({ html: `<a class="stock" href="news.html?q=${encodeURIComponent(s.name)}" title="${esc(s.market)}, ${esc(s.desc)} (관련 뉴스 보기)">${esc(s.name)}</a>${s.kind === "GL" ? `<span class="code">${esc(s.id)}</span>` : ""}` }) },
  { key: "seg", group: "id", label: "분야", cls: "tag left", narrow: false, sort: (s) => segLabel(s.seg), cell: (s) => ({ html: esc(segLabel(s.seg)) }) },
  { key: "price", group: "quote", label: "현재가", sort: (s, d) => d.price, cell: (s, d) => ({ html: `<a class="quote" href="${esc(s.url)}" target="_blank" rel="noopener" title="네이버 금융에서 열기">${fmtPrice(d.price, s.cur)}</a>`, cls: flash.has(s.id) ? `flash-${flash.get(s.id)}` : "" }) },
  { key: "chg", group: "quote", label: "등락률", sort: (s, d) => d.chg, cell: (s, d) => ({ html: fmtPct(d.chg, 2), cls: signClass(d.chg) }) },
  { key: "cap", group: "quote", label: "시가총액", sort: (s, d) => d.cap, cell: (s, d) => ({ html: money(s, d, "cap") }) },
  { key: "tv", group: "quote", label: "거래대금", sort: (s, d) => d.tv, cell: (s, d) => ({ html: fmtEok(d.tv) }) },
  { key: "w1", group: "ret", label: "1W", sort: (s, d) => d.w1, cell: (s, d) => pctCell(d.w1) },
  { key: "m1", group: "ret", label: "1M", sort: (s, d) => d.m1, cell: (s, d) => pctCell(d.m1) },
  { key: "m3", group: "ret", label: "3M", sort: (s, d) => d.m3, cell: (s, d) => pctCell(d.m3) },
  { key: "ytd", group: "ret", label: "YTD", sort: (s, d) => d.ytd, cell: (s, d) => pctCell(d.ytd) },
  { key: "y1", group: "ret", label: "1Y", sort: (s, d) => d.y1, cell: (s, d) => pctCell(d.y1) },
  { key: "dd", group: "ret", label: "52주<br>고점 대비", sort: (s, d) => d.dd, cell: (s, d) => ({ html: fmtPct(d.dd), cls: signClass(d.dd) }) },
  { key: "ym", group: "fin", label: "분기", sort: (s, d) => d.ym, cell: (s, d) => ({ html: d.ym ? d.ym.slice(2).replace("-", ".") : "-", cls: "per" }) },
  { key: "rev", group: "fin", label: "분기<br>매출", sort: (s, d) => d.rev, cell: (s, d) => ({ html: money(s, d, "rev") }) },
  { key: "yoy", group: "fin", label: "매출<br>YoY", sort: (s, d) => d.yoy, cell: (s, d) => pctCell(d.yoy, false) },
  { key: "revTtm", group: "fin", label: "매출<br>TTM", sort: (s, d) => d.revTtm, cell: (s, d) => ({ html: money(s, d, "revTtm") }) },
  { key: "opTtm", group: "fin", label: "영업이익<br>TTM", sort: (s, d) => d.opTtm, cell: (s, d) => ({ html: money(s, d, "opTtm"), cls: d.opTtm < 0 ? "neg" : "" }) },
  { key: "opm", group: "fin", label: "영업이익률", sort: (s, d) => d.opm, cell: (s, d) => ({ html: d.opm == null ? "-" : `${d.opm.toFixed(1)}%`, cls: d.opm < 0 ? "neg" : "" }) },
  { key: "spark", group: "fin", label: "분기 매출<br>추이", cell: (s) => ({ html: spark(s) }) },
  { key: "psr", group: "val", label: "PSR", sort: (s, d) => d.psr, cell: (s, d) => ({ html: d.psr == null ? "-" : d.psr.toFixed(1) }) },
  { key: "per", group: "val", label: "PER", sort: (s, d) => (typeof d.per === "number" ? d.per : null),
    cell: (s, d) => ({ html: d.per == null ? "-" : d.per === "N/M" ? "N/M" : d.per >= 100 ? Math.round(d.per).toLocaleString("ko-KR") : d.per.toFixed(1), cls: d.per === "N/M" ? "na" : "" }) },
];

const segLabel = (id) => snapshot.segments.find((segment) => segment.id === id)?.label || id;

function visibleStocks() {
  const query = state.query.trim().toLowerCase();
  return snapshot.stocks.filter((stock) => {
    if (state.view !== "ALL" && stock.kind !== state.view) return false;
    if (state.segs.size && !state.segs.has(stock.seg)) return false;
    if (!query) return true;
    return [stock.name, stock.nameEn, stock.id].some((text) => text && text.toLowerCase().includes(query));
  });
}

// 결측은 정렬 방향과 무관하게 항상 맨 아래.
function compare(a, b) {
  const column = COLUMNS.find((item) => item.key === state.sort.key);
  const left = column.sort(a.stock, a.d);
  const right = column.sort(b.stock, b.d);
  if (left == null && right == null) return (b.d.cap ?? -1) - (a.d.cap ?? -1);
  if (left == null) return 1;
  if (right == null) return -1;
  const order = typeof left === "string" ? left.localeCompare(right, "ko") : left - right;
  return state.sort.dir === "asc" ? order : -order;
}

function renderTable() {
  // 좁은 화면에서는 분야, 시장 열을 빼고 종목명 옆에 바로 시세가 오게 한다.
  const COLS = COLUMNS.filter((column) => !(narrow.matches && column.narrow === false));
  const rows = visibleStocks().map((stock) => ({ stock, d: derive(stock) })).sort(compare);
  $("#count").textContent = `${rows.length}종목`;
  if (!rows.length) {
    $("#table-wrap").innerHTML = '<p class="empty">조건에 맞는 종목이 없음</p>';
    return;
  }
  const firstOfGroup = new Set(GROUPS.map((group) => COLS.find((column) => column.group === group.id).key));
  const groupRow = GROUPS.map((group) => {
    const span = COLS.filter((column) => column.group === group.id).length;
    return `<th colspan="${span}" scope="colgroup" class="${group.id === "id" ? "name" : "g-start"}">${esc(group.label)}</th>`;
  }).join("");
  const headRow = COLS.map((column) => {
    const sorted = state.sort.key === column.key ? ` aria-sort="${state.sort.dir === "asc" ? "ascending" : "descending"}"` : "";
    const classes = [column.cls?.includes("name") ? "name" : "", column.cls?.includes("left") ? "left" : "", firstOfGroup.has(column.key) && column.group !== "id" ? "g-start" : ""].filter(Boolean).join(" ");
    const inner = column.sort ? `<button type="button" class="sort" data-sort="${column.key}">${column.label}</button>` : column.label;
    return `<th scope="col" class="${classes}"${sorted}>${inner}</th>`;
  }).join("");
  const body = rows.map(({ stock, d }) => `<tr>${COLS.map((column) => {
    const cell = column.cell(stock, d);
    const classes = [column.cls || "", cell.cls || "", firstOfGroup.has(column.key) && column.group !== "id" ? "g-start" : ""].filter(Boolean).join(" ");
    return column.key === "name" ? `<th scope="row" class="${classes}">${cell.html}</th>` : `<td class="${classes}">${cell.html}</td>`;
  }).join("")}</tr>`).join("");
  const wrap = $("#table-wrap");
  const scroll = { left: wrap.scrollLeft, top: wrap.scrollTop };
  wrap.innerHTML = `<table class="grid"><thead><tr class="groups">${groupRow}</tr><tr class="cols">${headRow}</tr></thead><tbody>${body}</tbody></table>`;
  wrap.scrollLeft = scroll.left;
  wrap.scrollTop = scroll.top;
}

function renderKpis() {
  const blocks = [
    { kind: "KR", title: "국내 보안주", index: snapshot.indices.KOSDAQ },
    { kind: "GL", title: "해외 보안주", index: snapshot.indices.IXIC },
  ];
  $("#kpis").innerHTML = blocks.map(({ kind, title, index }) => {
    const rows = snapshot.stocks.filter((stock) => stock.kind === kind).map(derive);
    const capSum = rows.reduce((total, d) => total + (d.cap || 0), 0);
    const keys = [["chg", "오늘"], ["w1", "1W"], ["m1", "1M"], ["ytd", "YTD"]];
    const basket = keys.map(([key]) => mean(rows.map((d) => d[key])));
    const iq = index?.q || {};
    const ib = index?.b || {};
    const bench = [iq.chg ?? null, pct(iq.p, ib.w1), pct(iq.p, ib.m1), pct(iq.p, ib.ytd)];
    const cells = (values, digits = 1) => values.map((value) => `<td class="${signClass(value)}">${fmtPct(value, digits)}</td>`).join("");
    const gap = basket.map((value, i) => (value == null || bench[i] == null ? null : value - bench[i]));
    return `<article class="kpi">
      <div><h2>${title} ${rows.length}종목 합산 시가총액</h2><p class="cap">${fmtEok(capSum)}</p></div>
      <table><thead><tr><td></td>${keys.map(([, label]) => `<th scope="col">${label}</th>`).join("")}</tr></thead>
      <tbody><tr><th scope="row">동일가중 평균</th>${cells(basket)}</tr>
      <tr><th scope="row">${esc(index?.name || "지수")}</th>${cells(bench)}</tr>
      <tr><th scope="row">차이(%p)</th>${gap.map((value) => `<td class="${signClass(Math.abs(value ?? 1) < 0.05 ? 0 : value)}">${value == null ? "-" : Math.abs(value) < 0.05 ? "0.0" : `${value > 0 ? "+" : ""}${value.toFixed(1)}`}</td>`).join("")}</tr></tbody></table>
    </article>`;
  }).join("");
}

function renderStatus() {
  const scope = snapshot.stocks.filter((stock) => state.view === "ALL" || stock.kind === state.view);
  const times = scope.map((stock) => Date.parse(stock.q?.at)).filter((time) => !Number.isNaN(time));
  const latest = times.length ? new Date(Math.max(...times)).toISOString() : null;
  const open = scope.some((stock) => stock.q?.st === "OPEN");
  const liveFresh = state.liveAsOf && Date.now() - Date.parse(state.liveAsOf) < 3 * 60000;
  const badge = $("#status-badge");
  let label = "장마감";
  let tone = "closed";
  if (open && liveFresh) { label = "LIVE"; tone = "live"; }
  else if (open) {
    const minutes = Math.max(1, Math.round((Date.now() - Date.parse(latest)) / 60000));
    label = `지연 ${minutes}분`;
    tone = "delayed";
  }
  badge.textContent = label;
  badge.dataset.state = tone;
  badge.hidden = false;
  $("#status-text").textContent = `시세 ${fmtKst(latest)} KST, ${state.liveSource || "네이버 금융"}`;
}

function renderNotes() {
  const usd = snapshot.fx.USD ? `1달러 ${snapshot.fx.USD.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}원` : "";
  const jpy = snapshot.fx.JPY ? `100엔 ${(snapshot.fx.JPY * 100).toLocaleString("ko-KR", { maximumFractionDigits: 0 })}원` : "";
  $("#notes").innerHTML = `출처: 네이버 금융 (재무 갱신 ${fmtKst(snapshot.generatedAt)} KST). 종목 구성 기준일 ${esc(snapshot.universeAsOf)}.<br>`
    + `수익률은 수정주가 종가 대비, 국내 시세와 거래대금은 KRX 기준, 해외 영업이익은 EBIT, PER은 직전 4개 분기 순이익 기준이며 적자는 N/M. 원화 환산은 현재 환율(${[usd, jpy].filter(Boolean).join(", ")}).`;
}

// 가장 많이 보도된 사건 하나를 종목 표 위에 한 줄로 보여 준다. 세 매체 이상이 다룬 사건이 없으면 숨긴다.
async function renderIssueBar() {
  try {
    const news = await loadJson("data/news.json");
    const [top] = topIssues(groupStories(news.items), { limit: 1 });
    if (!top || top.sources < 3) return;
    const bar = $("#issue-bar");
    bar.innerHTML = `<span class="label">주요 이슈</span><span class="title">${esc(top.lead.t)}</span><span class="meta">${top.sources}개 매체 ${top.count}건</span><span class="go">뉴스에서 보기</span>`;
    bar.hidden = false;
  } catch { /* 뉴스를 못 읽어도 종목 표는 그대로 둔다 */ }
}

function renderAll() {
  renderKpis();
  renderTable();
  renderStatus();
}

function applyLive(live) {
  if (!live?.q) return;
  state.liveAsOf = live.asOf;
  state.liveSource = live.source || null;
  // 로컬 실시간은 2초마다 읽는다. 바뀐 것이 없으면(rev 동일) 표를 다시 그리지 않는다.
  if (live.rev != null && live.rev === state.liveRev) { renderStatus(); return; }
  state.liveRev = live.rev ?? null;
  for (const stock of snapshot.stocks) {
    const row = live.q[stock.id];
    if (!row) continue;
    const [p, chg, cap, capKrw, tv, at, st] = row;
    if (stock.q?.at && Date.parse(at) < Date.parse(stock.q.at)) continue;
    if (stock.q?.p != null && p !== stock.q.p) flash.set(stock.id, p > stock.q.p ? "up" : "down");
    stock.q = { p, chg, cap, capKrw, tv, at, st };
  }
  for (const [id, quote] of Object.entries(live.idx || {})) {
    const index = snapshot.indices[id];
    if (index && (!index.q?.at || Date.parse(quote.at) >= Date.parse(index.q.at))) index.q = quote;
  }
  renderAll();
  flash.clear();
}

// 실시간 시세를 읽는다. 숨은 탭에서는 쉰다.
// 배포본: live 브랜치의 live.json. 무인증 API 한도(시간당 60회)를 넘지 않게 75초 간격.
// 로컬 실시간 서버: meta.live.url(같은 서버의 live.json)을 2초 간격.
async function pollLive() {
  if (!meta?.live || document.hidden) return;
  const { repo, branch, file, url } = meta.live;
  const attempts = url ? [() => fetch(url, { cache: "no-store" })] : [
    () => fetch(`https://api.github.com/repos/${repo}/contents/${file}?ref=${branch}`, { headers: { Accept: "application/vnd.github.raw+json" }, cache: "no-store" }),
    () => fetch(`https://raw.githubusercontent.com/${repo}/${branch}/${file}`, { cache: "no-store" }),
  ];
  for (const attempt of attempts) {
    try {
      const response = await attempt();
      if (response.ok) { applyLive(await response.json()); return; }
    } catch { /* 다음 경로로 */ }
  }
  renderStatus();
}

function bind() {
  const press = (container, attribute, value) => container.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset[attribute] === value)));
  $("#view-switch").addEventListener("click", (event) => {
    const view = event.target.closest("button")?.dataset.view;
    if (!view) return;
    state.view = view;
    press($("#view-switch"), "view", view);
    renderTable();
    renderStatus();
  });
  $("#cur-switch").addEventListener("click", (event) => {
    const cur = event.target.closest("button")?.dataset.cur;
    if (!cur) return;
    state.cur = cur;
    press($("#cur-switch"), "cur", cur);
    renderTable();
  });
  $("#search").addEventListener("input", (event) => { state.query = event.target.value; renderTable(); });
  $("#seg-chips").innerHTML = snapshot.segments.map((segment) => `<button type="button" data-seg="${segment.id}" aria-pressed="false">${esc(segment.label)}</button>`).join("");
  $("#seg-chips").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const seg = button.dataset.seg;
    if (state.segs.has(seg)) state.segs.delete(seg); else state.segs.add(seg);
    button.setAttribute("aria-pressed", String(state.segs.has(seg)));
    renderTable();
  });
  $("#table-wrap").addEventListener("click", (event) => {
    const key = event.target.closest("[data-sort]")?.dataset.sort;
    if (!key) return;
    const textual = ["name", "seg"].includes(key);
    state.sort = state.sort.key === key ? { key, dir: state.sort.dir === "desc" ? "asc" : "desc" } : { key, dir: textual ? "asc" : "desc" };
    renderTable();
  });
}

async function main() {
  initTheme();
  try {
    [snapshot, meta] = await Promise.all([loadJson("data/snapshot.json"), loadJson("data/meta.json")]);
  } catch (error) {
    $("#status-text").textContent = "데이터를 불러오지 못함";
    $("#table-wrap").innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }
  bind();
  // 뉴스 카드의 관련 종목에서 넘어오면 전체 보기에서 그 종목만 보여 준다.
  const query = new URLSearchParams(location.search).get("q");
  if (query) {
    state.query = query;
    state.view = "ALL";
    $("#search").value = query;
    document.querySelectorAll("#view-switch button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.view === "ALL")));
  }
  renderAll();
  renderNotes();
  renderIssueBar();
  if (meta.live) {
    pollLive();
    setInterval(pollLive, meta.live.interval || 75000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) pollLive(); });
  }
  narrow.addEventListener("change", renderTable);
  setInterval(renderStatus, 60000);
}

main();
