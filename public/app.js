// 종목 페이지: 스냅샷을 그리고, 배포본에서는 live 브랜치의 시세를 덧씌운다.
import { capWeightedReturn, pct, valuation, mean } from "./lib/calc.js";
import { startQuoteFeed } from "./lib/quote-feed.js";
import { isNxtPremarket, quoteStatus, selectNxtPremarket } from "./lib/quote-status.js";
import { financialRow, annualValuation, filingSummary } from "./lib/financials.js";
import {timelinePeriods,timelineValues,timelineNumber,trendSvg} from "./lib/financial-timeline.js";
import { esc, fmtEok, fmtLocalMillion, fmtPrice, fmtPct, signClass, fmtKst, loadJson, initTheme } from "./common.js";

const state = { view: "KR", cur: "krw", query: "", segs: new Set(), sort: { key: "cap", dir: "desc" }, livePayload: null, liveRev: null, liveSource: null };
// 방금 값이 바뀐 종목. 현재가 칸을 한 번 반짝이게 한다.
const flash = new Map();
let snapshot = null;
let meta = null;
let financials = null;
let kpiWeight = "cap";
let filingPeriod = null;
let filings = new Map();
let horizon = "threeMonth";
let baseQuotes = {};

const $ = (selector) => document.querySelector(selector);
const narrow = window.matchMedia("(max-width: 640px)");
const press = (container, attribute, value) => container.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset[attribute] === value)));

// 화면에 쓰는 파생값. 금액은 원화 환산(억원)과 현지 통화(국내 억원, 해외 백만)를 함께 들고 있다.
function derive(stock) {
  const q = stock.q || {};
  const b = stock.b || {};
  const f = stock.f || null;
  const ttm = stock.kind === "KR" ? filings.get(stock.id) : f;
  const fx = snapshot.fx[stock.cur];
  const toEok = (value) => (value == null ? null : stock.kind === "KR" ? value : fx ? (value * fx) / 100 : null);
  const value = valuation(q.cap, ttm);
  return {
    price: q.p ?? null, chg: q.chg ?? null, tv: q.tv ?? null,
    cap: q.capKrw ?? toEok(q.cap), capLocal: q.cap ?? null,
    w1: pct(q.p, b.w1), m1: pct(q.p, b.m1), m3: pct(q.p, b.m3), ytd: pct(q.p, b.ytd), y1: pct(q.p, b.y1),
    dd: b.hi52 != null && q.p != null ? pct(q.p, Math.max(b.hi52, q.p)) : null,
    ym: f?.ym ?? null, yoy: f?.yoy ?? null, opm: ttm?.opm ?? null,
    rev: toEok(f?.rev), revLocal: f?.rev ?? null,
    revTtm: toEok(ttm?.revTtm), revTtmLocal: ttm?.revTtm ?? null,
    opTtm: toEok(ttm?.opTtm), opTtmLocal: ttm?.opTtm ?? null,
    niTtm: toEok(ttm?.niTtm), niTtmLocal: ttm?.niTtm ?? null,
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

let GROUPS = [
  { id: "id", label: "종목" }, { id: "quote", label: "시세" }, { id: "ret", label: "수익률" },
  { id: "fin", label: "실적 (최근 확정 분기, 직전 4개 분기 합계)" }, { id: "val", label: "밸류" },
];

let COLUMNS = [
  { key: "name", group: "id", label: "종목", cls: "name", sort: (s) => s.name,
    cell: (s) => ({ html: `<a class="stock" href="news.html?q=${encodeURIComponent(s.name)}" aria-label="${esc(s.name)} 관련 뉴스" title="${esc(s.market)}, ${esc(s.desc)} (관련 뉴스 보기)">${esc(s.name)}</a>${s.kind === "GL" ? `<span class="code">${esc(s.id)}</span>` : ""}` }) },
  { key: "seg", group: "id", label: "분야", cls: "tag left", narrow: false, sort: (s) => segLabel(s.seg), cell: (s) => ({ html: esc(segLabel(s.seg)) }) },
  { key: "price", group: "quote", label: "현재가", sort: (s, d) => d.price, cell: (s, d) => ({ html: `<a class="quote" href="${esc(s.url)}" target="_blank" rel="noopener" title="${d.nxt ? 'NXT 프리마켓, ' : ''}네이버 금융에서 열기">${fmtPrice(d.price, s.cur)}</a>`, cls: flash.has(s.id) ? `flash-${flash.get(s.id)}` : "" }) },
  { key: "chg", group: "quote", label: "등락률", sort: (s, d) => d.chg, cell: (s, d) => ({ html: d.nxt ? `<span title="NXT 프리마켓, 전일 종가 대비">${fmtPct(d.chg, 2)}</span>` : fmtPct(d.chg, 2), cls: signClass(d.chg) }) },
  { key: "cap", group: "quote", label: "시가총액", sort: (s, d) => d.cap, cell: (s, d) => ({ html: money(s, d, "cap") }) },
  { key: "tv", group: "quote", label: "거래대금", title: "국내 기준: KRX + NXT 당일 누적", sort: (s, d) => d.tv, cell: (s, d) => ({ html: fmtEok(d.tv) }) },
  { key: "w1", group: "ret", label: "1W", sort: (s, d) => d.w1, cell: (s, d) => pctCell(d.w1) },
  { key: "m1", group: "ret", label: "1M", sort: (s, d) => d.m1, cell: (s, d) => pctCell(d.m1) },
  { key: "m3", group: "ret", label: "3M", sort: (s, d) => d.m3, cell: (s, d) => pctCell(d.m3) },
  { key: "ytd", group: "ret", label: "YTD", sort: (s, d) => d.ytd, cell: (s, d) => pctCell(d.ytd) },
  { key: "y1", group: "ret", label: "1Y", sort: (s, d) => d.y1, cell: (s, d) => pctCell(d.y1) },
  { key: "dd", group: "ret", label: "52주<br>고점 대비", cls:"drawdown", sort: (s, d) => d.dd, cell: (s, d) => ({ html: fmtPct(d.dd), cls: signClass(d.dd) }) },
  { key: "ym", group: "fin", label: "분기", sort: (s, d) => d.ym, cell: (s, d) => ({ html: d.ym ? d.ym.slice(2).replace("-", ".") : "-", cls: "per" }) },
  { key: "rev", group: "fin", label: "분기<br>매출", sort: (s, d) => d.rev, cell: (s, d) => ({ html: money(s, d, "rev") }) },
  { key: "yoy", group: "fin", label: "매출<br>YoY", sort: (s, d) => d.yoy, cell: (s, d) => pctCell(d.yoy, false) },
  { key: "revTtm", group: "fin", label: "매출<br>TTM", sort: (s, d) => d.revTtm, cell: (s, d) => ({ html: money(s, d, "revTtm") }) },
  { key: "opTtm", group: "fin", label: "영업이익<br>TTM", sort: (s, d) => d.opTtm, cell: (s, d) => ({ html: money(s, d, "opTtm"), cls: d.opTtm < 0 ? "neg" : "" }) },
  { key: "opm", group: "fin", label: "영업이익률", sort: (s, d) => d.opm, cell: (s, d) => ({ html: d.opm == null ? "-" : `${d.opm.toFixed(1)}%`, cls: d.opm < 0 ? "neg" : "" }) },
  { key: "spark", group: "fin", label: "분기 매출<br>추이", cell: (s) => ({ html: spark(s) }) },
  { key: "psr", group: "val", label: "PSR", sort: (s, d) => d.psr, cell: (s, d) => ({ html: d.psr == null ? "-" : d.psr.toFixed(1) }) },
  { key: "per", group: "val", label: "PER", sort: (s, d) => (typeof d.per === "number" ? d.per : null),
    cell: (s, d) => ({ html: d.per == null ? '<span title="자료 없음">-</span>' : d.per === "N/M" ? '<span title="최근 4개 분기 순이익이 0 이하라 PER 계산 제외">-</span>' : d.per >= 100 ? Math.round(d.per).toLocaleString("ko-KR") : d.per.toFixed(1), cls: d.per === "N/M" ? "na" : "" }) },
];
const BASE_COLUMNS = COLUMNS;
const BASE_GROUPS = GROUPS.map(g=>({...g}));
function financialColumns() {
  const active=!!financials&&state.view==='KR';
  $('#financial-horizon').closest('label').hidden=!active;
  const domesticBasis = filingPeriod ? `국내 TTM OpenDART ${filingPeriod}` : '국내 TTM 공시 자료 없음';
  const baseNote = state.view === 'GL' ? '해외 실적은 최근 확정 분기와 TTM'
    : state.view === 'ALL' ? `${domesticBasis}, 해외 TTM 및 분기 자료 네이버`
    : domesticBasis;
  $('#financial-date').textContent = active
    ? `${baseNote}, 연간 확정 OpenDART, 추정 ConsenDB ${financials.workbookBaseDate}`
    : baseNote;
  if(!active){COLUMNS=BASE_COLUMNS;GROUPS=BASE_GROUPS.map(g=>({...g}));if(!COLUMNS.some(c=>c.key===state.sort.key&&c.sort))state.sort={key:'cap',dir:'desc'};return;}
  const byId=new Map(financials.stocks.map(s=>[s.id,s]));
  const periods=timelinePeriods(financials.stocks).filter(p=>Number(p.period.slice(0,4))<=2027);
  const basis={threeMonth:'3M 평균',oneMonth:'1M 평균',highest:'3M 최고'}[horizon];
  const metrics=[{id:'revenue',label:`매출 (억원, ${basis})`,field:'revenue'},{id:'operatingIncome',label:`영업이익 (억원, ${basis})`,field:'operatingIncome'},{id:'parentNetIncome',label:`지배순이익 (억원, ${basis})`,field:'parentNetIncome'},{id:'pe',label:'P/E (배, 현재 시총)',valuation:'pe'},{id:'pb',label:'P/B (배, 현재 시총)',valuation:'pb'},{id:'roe',label:'ROE (%)',valuation:'roe'}];
  GROUPS=[...BASE_GROUPS.filter(g=>!['fin','val'].includes(g.id)),{id:'ttm',label:'TTM 요약 (억원, 배)'},...metrics.map(m=>({id:m.id,label:m.label}))];
  COLUMNS=BASE_COLUMNS.filter(c=>!['fin','val'].includes(c.group));
  const summary=[{key:'revTtm',label:'매출'},{key:'opTtm',label:'영업이익'},{key:'niTtm',label:'순이익'},{key:'psr',label:'PSR'},{key:'per',label:'PER'}];
  for(const metric of summary)COLUMNS.push({key:metric.key,group:'ttm',label:metric.label,cls:'ttm-summary',sort:(s,d)=>typeof d[metric.key]==='number'?d[metric.key]:null,cell:(s,d)=>{
    const filing = filings.get(s.id);
    const v=d[metric.key],period=filing ? `${filingPeriod}까지 최근 4개 확정 분기` : '확정 분기 자료 없음';
    const note=metric.key==='niTtm'?(filing?.netBasis ?? '순이익'):metric.key==='psr'?'현재 시총 / TTM 매출':metric.key==='per'?`현재 시총 / TTM ${filing?.netBasis ?? '순이익'}`:'최근 4개 확정 분기 합계';
    const ratio=['psr','per'].includes(metric.key);
    const display=ratio&&typeof v==='number'?v.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1}):timelineNumber(v);
    return {html:`<span class="ttm-value${ratio?' ttm-ratio':''}${typeof v!=='number'?' ttm-missing':''}" data-summary="${metric.key}" title="OpenDART, ${esc(period)}, ${esc(note)}${v==null?', 자료 없음':v==='N/M'?', 순이익이 0 이하라 PER 계산 제외':''}">${display}</span>`,cls:typeof v==='number'&&v<0?'neg':v==='N/M'?'na':''};
  }});
  const value=(s,d,p,m)=>m.field?financialRow(byId.get(s.id),p.period,horizon)?.[m.field]??null:annualValuation(byId.get(s.id),p.period,d.cap,horizon)[m.valuation];
  for(const m of metrics){
    for(const p of periods)COLUMNS.push({key:`${m.id}-${p.period}`,group:m.id,label:p.label,cls:'financial-year',sort:(s,d)=>{const v=value(s,d,p,m);return typeof v==='number'?v:null;},cell:(s,d)=>{const v=value(s,d,p,m);return {html:`<span class="financial-value ${v==null?'financial-missing':''}" data-metric="${m.id}" data-period="${p.period}" title="${esc(m.label)}, ${p.label}${v==null?', 자료 없음':v==='N/M'?', 이익 또는 자기자본이 0 이하라 계산 제외':''}">${timelineNumber(v)}</span>`,cls:(byId.get(s.id)?.annual?.[p.period]?.kind==='actual'?'actual-cell':'estimate-cell')+(typeof v==='number'&&v<0?' neg':'')};}});
    COLUMNS.push({key:m.id+'-trend',group:m.id,label:'추이',cls:'financial-spark',cell:(s,d)=>({html:trendSvg(periods.map(p=>({period:p.label,value:value(s,d,p,m),forecast:byId.get(s.id)?.annual?.[p.period]?.kind!=='actual'})),m.label)})});
  }
  if(!COLUMNS.some(c=>c.key===state.sort.key&&c.sort))state.sort={key:'cap',dir:'desc'};
}

const segLabel = (id) => snapshot.segments.find((segment) => segment.id === id)?.label || id;

const normalizeStockQuery = (text) => text.toLowerCase().replace(/\s+/g, "");

function visibleStocks(view = state.view) {
  const query = normalizeStockQuery(state.query);
  return snapshot.stocks.filter((stock) => {
    if (view !== "ALL" && stock.kind !== view) return false;

    if (state.segs.size && !state.segs.has(stock.seg)) return false;
    if (!query) return true;
    return [stock.name, stock.nameEn, stock.id].some((text) => text && normalizeStockQuery(text).includes(query));
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
  financialColumns();
  // 좁은 화면에서는 분야, 시장 열을 빼고 종목명 옆에 바로 시세가 오게 한다.
  const COLS = COLUMNS.filter((column) => !(narrow.matches && column.narrow === false));
  const nxtPre = isNxtPremarket(Date.now()) ? state.livePayload?.nxtPre : null;
  const rows = visibleStocks().map((stock) => {
    const d = derive(stock);
    const pre = nxtPre?.[stock.id];
    if (pre) return { stock, d: { ...d, price: pre.p, chg: pre.chg, nxt: true } };
    return { stock, d };
  }).sort(compare);
  $("#count").textContent = `${rows.length}종목`;
  if (!rows.length) {
    const otherView = state.view === "KR" ? "GL" : "KR";
    const alternative = state.view !== "ALL" && state.query.trim() && visibleStocks(otherView).length
      ? ` <button type="button" data-stock-view="${otherView}">${otherView === "KR" ? "국내" : "해외"} 종목에서 찾기</button>` : "";
    $("#table-wrap").innerHTML = `<p class="empty stock-empty">조건에 맞는 종목이 없음${alternative}</p>`;
    updateTablePan();
    return;
  }
  const activeGroups=GROUPS.filter(g=>COLS.some(c=>c.group===g.id));
  const firstOfGroup = new Set(activeGroups.map((group) => COLS.find((column) => column.group === group.id).key));
  const groupRow = activeGroups.map((group) => {
    const span = COLS.filter((column) => column.group === group.id).length;
    return `<th colspan="${span}" scope="colgroup" class="${group.id === "id" ? "name" : "g-start"}">${esc(group.label)}</th>`;
  }).join("");
  const headRow = COLS.map((column) => {
    const sorted = state.sort.key === column.key ? ` aria-sort="${state.sort.dir === "asc" ? "ascending" : "descending"}"` : "";
    const classes = [column.cls || "", firstOfGroup.has(column.key) && column.group !== "id" ? "g-start" : ""].filter(Boolean).join(" ");
    const title = column.title ? ` title="${esc(column.title)}"` : "";
    const inner = column.sort ? `<button type="button" class="sort" data-sort="${column.key}"${title}>${column.label}</button>` : column.label;
    return `<th scope="col" class="${classes}"${sorted}>${inner}</th>`;
  }).join("");
  const body = rows.map(({ stock, d }) => `<tr>${COLS.map((column) => {
    const cell = column.cell(stock, d);
    const classes = [column.cls || "", cell.cls || "", firstOfGroup.has(column.key) && column.group !== "id" ? "g-start" : ""].filter(Boolean).join(" ");
    return column.key === "name" || column.rowHeader ? `<th scope="row" class="${classes}">${cell.html}</th>` : `<td class="${classes}">${cell.html}</td>`;
  }).join("")}</tr>`).join("");
  const wrap = $("#table-wrap");
  const scroll = { left: wrap.scrollLeft, top: wrap.scrollTop };
  wrap.innerHTML = `<table class="grid${financials&&state.view==='KR'?' wide-financials':''}"><thead><tr class="groups">${groupRow}</tr><tr class="cols">${headRow}</tr></thead><tbody>${body}</tbody></table>`;
  fitOverviewColumns();
  wrap.scrollLeft = scroll.left;
  wrap.scrollTop = scroll.top;
  updateTablePan();
}

function fitOverviewColumns() {
  const wrap=$('#table-wrap'),table=wrap.querySelector('.wide-financials');
  if(!table)return;
  const scroll=wrap.scrollLeft;
  table.querySelector('colgroup')?.remove();
  const heads=[...table.querySelectorAll('.cols th')];
  const last=heads.findIndex(th=>th.querySelector('[data-sort="per"]'));
  if(last<0)return;
  const widths=heads.map(th=>th.getBoundingClientRect().width);
  const compact=heads.findIndex(th=>th.classList.contains('drawdown'));
  if(compact>=0)widths[compact]=64;
  const natural=widths.slice(0,last+1).reduce((sum,width)=>sum+width,0);
  const target=wrap.clientWidth;
  if(target>=natural){
    const fixed=compact>=0?widths[compact]:0;
    let used=0,total=0;
    for(let i=0;i<=last;i++){
      if(i===compact)continue;
      total+=widths[i];
      const edge=Math.round(total/(natural-fixed)*(target-fixed));
      widths[i]=edge-used;used=edge;
    }
  }
  table.insertAdjacentHTML('afterbegin',`<colgroup>${widths.map(width=>`<col width="${Math.round(width)}">`).join('')}</colgroup>`);
  wrap.scrollLeft=scroll;
}

function updateTablePan() {
  const wrap=$('#table-wrap'),pan=$('#table-pan');
  pan.hidden=wrap.scrollWidth<=wrap.clientWidth+1;
  if(!pan.hidden){pan.innerHTML=`<svg width="${wrap.scrollWidth}" height="1" aria-hidden="true"></svg>`;pan.scrollLeft=wrap.scrollLeft;}
}

function renderKpis() {
  const capWeighted = kpiWeight === "cap";
  const blocks = [
    { kind: "KR", title: "국내 보안주", index: snapshot.indices.KOSDAQ },
    { kind: "GL", title: "해외 보안주", index: snapshot.indices.IXIC },
  ];
  $("#kpis").innerHTML = blocks.map(({ kind, title, index }) => {
    const rows = snapshot.stocks.filter((stock) => stock.kind === kind).map(derive);
    const capSum = rows.reduce((total, d) => total + (d.cap || 0), 0);
    const keys = [["chg", "오늘"], ["w1", "1W"], ["m1", "1M"], ["ytd", "YTD"]];
    const basket = keys.map(([key]) => capWeighted ? capWeightedReturn(rows, key) : mean(rows.map((d) => d[key])));
    const iq = index?.q || {};
    const ib = index?.b || {};
    const bench = [iq.chg ?? null, pct(iq.p, ib.w1), pct(iq.p, ib.m1), pct(iq.p, ib.ytd)];
    const cells = (values, digits = 1) => values.map((value) => `<td class="${signClass(value)}">${fmtPct(value, digits)}</td>`).join("");
    const gap = basket.map((value, i) => (value == null || bench[i] == null ? null : value - bench[i]));
    return `<article class="kpi">
      <div><h2>${title} ${rows.length}종목 합산 시가총액</h2><p class="cap">${fmtEok(capSum)}</p></div>
      <table><thead><tr><td></td>${keys.map(([, label]) => `<th scope="col">${label}</th>`).join("")}</tr></thead>
      <tbody><tr><th scope="row">${capWeighted ? "시총가중 평균" : "동일가중 평균"}</th>${cells(basket)}</tr>
      <tr><th scope="row">${esc(index?.name || "지수")}</th>${cells(bench)}</tr>
      <tr><th scope="row">차이(%p)</th>${gap.map((value) => `<td class="${signClass(Math.abs(value ?? 1) < 0.05 ? 0 : value)}">${value == null ? "-" : Math.abs(value) < 0.05 ? "0.0" : `${value > 0 ? "+" : ""}${value.toFixed(1)}`}</td>`).join("")}</tr></tbody></table>
    </article>`;
  }).join("");
}

function renderStatus() {
  const scope = snapshot.stocks.filter((stock) => state.view === "ALL" || stock.kind === state.view);
  const now = Date.now();
  const payload = state.livePayload;
  const nxtPre = isNxtPremarket(now) ? payload?.nxtPre : null;
  const preStocks = scope.filter(stock => nxtPre?.[stock.id])
    .map(stock => ({ ...stock, q: { at: nxtPre[stock.id].at, st: "OPEN" } }));
  const { label, tone, time } = preStocks.length
    ? quoteStatus(preStocks, { marketSuccessAt: payload.marketSuccessAt, asOf: payload.asOf }, now)
    : quoteStatus(scope, payload, now);
  const badge = $("#status-badge");
  badge.textContent = preStocks.length ? (tone === "live" ? "NXT 프리마켓" : `NXT ${label}`) : label;
  badge.dataset.state = tone;
  badge.hidden = false;
  $("#status-text").textContent = `시세 ${fmtKst(time)} KST, ${state.liveSource || "네이버 금융"}`;
}

// 가장 많이 보도된 사건 하나를 종목 표 위에 한 줄로 보여 준다. 세 매체 이상이 다룬 사건이 없으면 숨긴다.
async function renderIssueBar() {
  try {
    const issues = await loadJson("data/issue-banner.json");
    const cutoff = Date.now() - 72 * 3600000;
    const top = issues.find((issue) => Date.parse(issue.last) >= cutoff);
    if (!top) return;
    const bar = $("#issue-bar");
    bar.href = `news.html?story=${encodeURIComponent(top.id)}`;
    const language = top.lang === "en" ? '<span class="headline-language">영어</span>' : "";
    bar.innerHTML = `<span class="label">주요 이슈</span><span class="title" title="${esc(top.title)}">${esc(top.tKo || top.title)}</span>${language}<span class="meta">${top.sources}개 매체 ${top.count}건</span><span class="go">관련 기사 보기</span>`;
    bar.hidden = false;
  } catch { /* 뉴스를 못 읽어도 종목 표는 그대로 둔다 */ }
}

function renderAll() {
  renderKpis();
  renderTable();
  renderStatus();
}

function applyLive(live, force = false) {
  if (!live?.q) return;
  const ids = Object.keys(live.nxtPre ?? {}).filter(id => live.q[id] && live.q[id][6] !== "OPEN");
  const nxtPre = selectNxtPremarket(live.nxtPre, ids);
  const sessionChanged = Boolean(state.livePayload?.nxtPre) !== Boolean(nxtPre);
  state.livePayload = { ...live, nxtPre };
  state.liveSource = live.source || null;
  // 로컬 실시간은 2초마다 읽는다. 바뀐 것이 없으면(rev 동일) 표를 다시 그리지 않는다.
  if (!sessionChanged && live.rev != null && live.rev === state.liveRev) { renderStatus(); return; }
  state.liveRev = live.rev ?? null;
  for (const stock of snapshot.stocks) {
    const row = live.q[stock.id];
    if (!row) continue;
    const [p, chg, cap, capKrw, tv, at, st] = row;
    if (!force && stock.q?.at && Date.parse(at) < Date.parse(stock.q.at)) continue;
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

function refreshStatus() {
  if (state.livePayload?.nxtPre && !isNxtPremarket(Date.now())) {
    state.livePayload = { ...state.livePayload, nxtPre: null };
    renderTable();
  }
  renderStatus();
}

function restoreCloudQuotes(cloud) {
  for (const stock of snapshot.stocks) stock.q = structuredClone(baseQuotes[stock.id]);
  state.liveRev = null;
  state.livePayload = null;
  state.liveSource = null;
  if (cloud) applyLive(cloud, true);
  else renderAll();
}

function selectView(view) {
  state.view = view;
  press($("#view-switch"), "view", view);
  renderTable();
  renderStatus();
}

function saveStockSelection() {
  const { view, cur, query, segs, sort } = state;
  history.replaceState({ ...history.state, stocks: { view, cur, query, segs: [...segs], sort, horizon } }, "");
}

function restoreStockSelection() {
  const saved = history.state?.stocks;
  if (saved) {
    const { view, cur, query, segs, sort } = saved;
    Object.assign(state, { view, cur, query, segs: new Set(segs), sort });
    horizon = saved.horizon;
  } else {
    // 뉴스의 관련 종목 링크는 국내외 종목에서 검색한다.
    const query = new URLSearchParams(location.search).get("q");
    if (query) Object.assign(state, { query, view: "ALL" });
  }
  $("#search").value = state.query;
  $("#financial-horizon").value = horizon;
  press($("#view-switch"), "view", state.view);
  press($("#cur-switch"), "cur", state.cur);
}

function bind() {
  const weights = $("#kpi-weight-switch");
  weights.addEventListener("click", (event) => {
    const weight = event.target.closest("button")?.dataset.weight;
    if (!weight || weight === kpiWeight) return;
    kpiWeight = weight;
    press(weights, "weight", weight);
    renderKpis();
  });
  window.addEventListener("pagehide", saveStockSelection);
  $('#table-pan').addEventListener('scroll',()=>{const w=$('#table-wrap'),p=$('#table-pan');if(w.scrollLeft!==p.scrollLeft)w.scrollLeft=p.scrollLeft;});
  $('#table-wrap').addEventListener('scroll',()=>{const w=$('#table-wrap'),p=$('#table-pan');if(p.scrollLeft!==w.scrollLeft)p.scrollLeft=w.scrollLeft;});
  window.addEventListener('resize',()=>{fitOverviewColumns();updateTablePan();});
  $('#financial-horizon').addEventListener('change',e=>{horizon=e.target.value;renderTable();});
  $("#view-switch").addEventListener("click", (event) => {
    const view = event.target.closest("button")?.dataset.view;
    if (view) selectView(view);
  });
  $("#cur-switch").addEventListener("click", (event) => {
    const cur = event.target.closest("button")?.dataset.cur;
    if (!cur) return;
    state.cur = cur;
    press($("#cur-switch"), "cur", cur);
    renderTable();
  });
  $("#search").addEventListener("input", (event) => { state.query = event.target.value; renderTable(); });
  $("#seg-chips").innerHTML = snapshot.segments.map((segment) => `<button type="button" data-seg="${segment.id}" aria-pressed="${state.segs.has(segment.id)}">${esc(segment.label)}</button>`).join("");
  $("#seg-chips").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const seg = button.dataset.seg;
    if (state.segs.has(seg)) state.segs.delete(seg); else state.segs.add(seg);
    button.setAttribute("aria-pressed", String(state.segs.has(seg)));
    renderTable();
  });
  $("#table-wrap").addEventListener("click", (event) => {
    const alternative = event.target.closest("[data-stock-view]")?.dataset.stockView;
    if (alternative) {
      selectView(alternative);
      $("#view-switch [aria-pressed=true]").focus({ preventScroll: true });
      return;
    }
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
  baseQuotes=Object.fromEntries(snapshot.stocks.map(s=>[s.id,structuredClone(s.q)]));
  const [annual, positions] = await Promise.all([
    loadJson("data/financials.json").catch(() => null),
    loadJson("data/positions.json").catch(() => null),
  ]);
  financials = annual;
  if (positions?.period && Array.isArray(positions.stocks)) {
    filingPeriod = positions.period;
    filings = new Map(positions.stocks.map((stock) => [stock.id, filingSummary(stock.finance)]));
  }
  restoreStockSelection();
  bind();
  renderAll();
  renderIssueBar();
  startQuoteFeed(meta.live, {
    onQuotes: (payload, feed) => applyLive(payload, feed === "relay" && state.liveSource !== payload.source),
    onRelayLost: restoreCloudQuotes,
    onUnavailable: refreshStatus,
  });

  narrow.addEventListener("change", renderTable);
  setInterval(refreshStatus, 60000);
}

main();
