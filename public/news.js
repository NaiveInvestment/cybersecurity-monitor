import { esc, fmtKst, headlineLink as link, loadJson, initTheme } from "./common.js";
import { statusTone } from "./lib/status.js";
import { groupStories } from "./lib/issues.js";
import { searchArchive, publicationDay } from "./lib/news-search.js";
import { isIncidentReport } from "./lib/news-pulse.js";
import { renderPulse, renderFlow } from "./news-dashboard.js";
import { showIncidentHistory } from "./incidents.js";

const PAGE = 12;
const $ = (selector) => document.querySelector(selector);
const REGION = { KR: "국내", GL: "해외" };
const CATEGORY = { incident: "침해사고", policy: "정책", spending: "기업 대응" };
const params = new URLSearchParams(location.search);
const state = { category: "all", region: params.get("r") === "GL" ? "GL" : "KR",
  period: 7, query: params.get("q") || "", shown: PAGE, focus: null };
let cards = [], names = {}, segments = {}, news = { items: [] }, events = null;
let searchResult = null, pulseArchive = null, flowItems = [], pulseRequest = 0;
let cardsAvailable = false, refreshing = false;
const archiveCache = new Map();
const anchor = () => Date.parse(news.updatedAt) || Date.now();
const kstDate = stamp => publicationDay(new Date(stamp).getTime());
const inRegion = region => region === state.region;
const matches = text => text.toLowerCase().includes(state.query.trim().toLowerCase());
const mediaOnly = card => card.sources.every(source => source.kind === "media");
const stockNames = ids => ids.map(id => names[id] || id).join(", ");

function filteredBriefs() {
  const cutoff = state.period ? kstDate(anchor() - state.period * 86400000) : "";
  return cards.filter((card) => inRegion(card.region) && card.date >= cutoff
    && matches([card.title, card.entity, card.claim, ...(card.facts || []).map((fact) => fact.value),
      stockNames(card.tickers || [])].join(" ")));
}

function prepareSearch() {
  if (searchResult?.file === news && searchResult.period === state.period) return searchResult.ready;
  const result = { file: news, period: state.period, items: news.items, pending: true, failed: 0 };
  searchResult = result;
  result.ready = searchArchive(news, state.period, loadJson, archiveCache, anchor()).then(data => {
    Object.assign(result, data, { pending: false });
    if (searchResult === result) renderFeed();
  });
  return result.ready;
}

function filteredItems() {
  const cutoff = state.period ? anchor() - state.period * 86400000 : 0;
  return searchResult.items.filter((item) => (state.category === "all" || (state.category === "incident" ? isIncidentReport(item) : item.c === state.category))
    && inRegion(item.r) && Date.parse(item.d) > cutoff && Date.parse(item.d) <= anchor()
    && matches(`${item.t} ${item.tKo || ""} ${item.s} ${stockNames(item.k || [])}`));
}

function renderFeed() {
  const focus = state.focus;
  if (state.category === "briefs" && !focus) {
    const briefs = filteredBriefs();
    $("#feed-title").textContent = "출처 확인 자료";
    $("#feed-sub").textContent = `${briefs.length}건`;
    $("#feed").innerHTML = cardsAvailable ? briefList(briefs) : '<p class="empty">정리 자료를 불러오지 못했습니다.</p>';
    return;
  }
  if (!focus) prepareSearch();
  const items = focus?.items ?? filteredItems();
  const visible = focus ? items : items.slice(0, state.shown);
  $("#feed-title").textContent = focus ? "관련 기사" : "최신 기사";
  $("#feed-sub").textContent = `${items.length.toLocaleString("ko-KR")}건`;
  if (!focus) {
    if (searchResult.pending) $("#feed-sub").textContent += ", 보관 기사 조회 중";
    $("#feed-sub").title = searchResult.coverage || "";
    if (searchResult.failed) $("#feed-sub").textContent += `, ${searchResult.failed}일분 조회 실패`;
  }
  let day = "";
  const links = visible.map((item) => {
    const date = kstDate(item.d);
    const header = date !== day ? `<p class="day">${date}</p>` : "";
    day = date;
    return `${header}<div class="headline">
      <time class="time num" datetime="${esc(item.d)}">${fmtKst(item.d, false)}</time>
      <div>${link(item, "title")}<p class="meta">${esc(item.s)} <span class="wire-category">${item.c === "incident" && !isIncidentReport(item) ? "일반 보도" : CATEGORY[item.c]}</span></p></div>
    </div>`;
  }).join("");
  const back = focus ? '<p class="focus-bar"><button type="button" id="focus-clear">기사 목록으로 돌아가기</button></p>' : "";
  const more = items.length > visible.length
    ? `<button type="button" class="more" id="more">기사 더 보기 (${visible.length} / ${items.length.toLocaleString("ko-KR")}건)</button>` : "";
  const retry = !focus && searchResult.failed ? '<button type="button" class="more" id="archive-retry">보관 기사 다시 조회</button>' : "";
  $("#feed").innerHTML = back + (links || '<p class="empty">조건에 맞는 기사가 없습니다.</p>') + more + retry;
}

function briefList(list) {
  return list.length ? list.map((card, index) => {
    const facts = card.facts.map((fact) => `<dt>${esc(fact.label)}</dt><dd>${esc(fact.value)}</dd>`).join("");
    const segs = (card.segs || []).map((id) => segments[id]).filter(Boolean).join(", ");
    const tickers = (card.tickers || []).map((id) => `<a href="index.html?q=${encodeURIComponent(names[id] || id)}" title="종목 표에서 보기">${esc(names[id] || id)}</a>`).join(", ");
    const sources = card.sources.map((source) => `<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.name)}</a>`).join("");
    const open = index === 0 ? " open" : "";
    return `<details class="note"${open}>
      <summary>
        <span class="note-date num">${esc(card.date)}${card.dateLabel ? `<i>${esc(card.dateLabel)}</i>` : ""}</span>
        <span class="note-head"><b>${esc(card.title)}</b><span class="state" data-tone="${statusTone(card.status)}">${esc(card.status)}</span><em>${esc(card.country || REGION[card.region])}</em></span>
        <span class="note-claim">${esc(card.claim)}</span>
      </summary>
      <div class="note-body">
        <dl class="facts">${facts}</dl>
        <p class="note-foot">${segs ? `<span>관련 분야: ${esc(segs)}</span>` : ""}${tickers ? `<span>관련 종목: ${tickers}</span>` : ""}<span class="src">${mediaOnly(card) ? "출처(기사 기준)" : "출처"}: ${sources}</span></p>
      </div>
    </details>`;
  }).join("") : '<p class="empty">조건에 맞는 정리가 없습니다.</p>';
}


const press = (selector, key, value) => document.querySelectorAll(selector + " button").forEach(button => {
  button.setAttribute("aria-pressed", String(button.dataset[key] === value));
});

function syncControls() {
  press("#region-switch", "region", state.region);
  press("#category-switch", "category", state.category);
  $("#search").value = state.query;
  $("#period").value = String(state.period);
  $("#news-title").textContent = REGION[state.region] + " 보안 뉴스";
}

function drawOverview() {
  renderPulse(state.region, anchor(), pulseArchive, events);
  renderFlow(events, flowItems.length ? flowItems : news.items, state.region, anchor());
  if ($("#history").open) drawHistory();
}

function drawHistory() {
  if (events) showIncidentHistory(events, state.region);
  else $("#inc-notes").textContent = "사건 자료를 불러오지 못했습니다.";
}

async function loadPulse() {
  const request = ++pulseRequest;
  const [result, flowArchive] = await Promise.all([14, 28].map(days => searchArchive(news, days, loadJson, archiveCache, anchor())));
  if (request !== pulseRequest) return;
  pulseArchive = result;
  flowItems = flowArchive.items;
  drawOverview();
}

function resetFeed() {
  state.shown = PAGE;
  state.focus = null;
  syncControls();
  renderFeed();
}

function bind() {
  $("#region-switch").addEventListener("click", event => {
    const region = event.target.closest("button")?.dataset.region;
    if (!region || state.region === region) return;
    state.region = region;
    const url = new URL(location.href);
    url.searchParams.set("r", region);
    url.searchParams.delete("story");
    history.replaceState(null, "", url);
    resetFeed();
    drawOverview();
  });
  $("#category-switch").addEventListener("click", event => {
    const category = event.target.closest("button")?.dataset.category;
    if (!category) return;
    if (category === "briefs" && state.category !== "briefs") {
      state.articlePeriod = state.period;
      state.period = 0;
    } else if (category !== "briefs" && state.category === "briefs") {
      state.period = state.articlePeriod ?? 7;
    }
    state.category = category;
    resetFeed();
  });
  $("#period").addEventListener("change", event => { state.period = Number(event.target.value); resetFeed(); });
  $("#search").addEventListener("input", event => { state.query = event.target.value; resetFeed(); });
  $("#history").addEventListener("toggle", () => { if ($("#history").open) drawHistory(); });
  $("#pulse-metrics").addEventListener("click", event => { if (event.target.id === "pulse-retry") loadPulse(); });
  $("#feed").addEventListener("click", event => {
    if (event.target.id === "archive-retry") { searchResult = null; renderFeed(); }
    if (event.target.id === "more") { state.shown += PAGE; renderFeed(); }
    if (event.target.id === "focus-clear") { resetFeed(); $("#feed-title").focus(); }
  });
}

async function refresh(first = false) {
  if (refreshing) return;
  refreshing = true;
  try {
    const [file, eventFile] = await Promise.all([loadJson("data/news.json"), loadJson("data/incident-events.json").catch(() => events)]);
    news = file;
    events = eventFile;
    $("#status-text").textContent = `기사 수집 ${fmtKst(news.updatedAt)} KST`;
    if (first && state.query) {
      state.period = 0;
      await prepareSearch();
      if (!params.has("r")) {
        const match = searchResult.items.find(item => matches(`${item.t} ${item.tKo || ""} ${item.s} ${stockNames(item.k || [])}`));
        const card = cards.find(item => matches(item.title + " " + item.entity + " " + stockNames(item.tickers || [])));
        state.region = match?.r || card?.region || state.region;
      }
      if (!filteredItems().length && filteredBriefs().length) state.category = "briefs";
    }
    if (first && params.has("story")) {
      const id = params.get("story");
      const story = groupStories(news.items.filter(item => String(item.g || item.id) === id))[0];
      if (story) { state.region = story.r; state.focus = story; }
    }
    syncControls();
    renderFeed();
    await loadPulse();
    if (first) {
      const target = document.getElementById(location.hash.slice(1));
      if (target?.closest("#history") || params.get("view") === "incidents") {
        $("#history").open = true;
        drawHistory();
        (target || $("#history")).scrollIntoView();
      } else if (state.query || state.focus) {
        $("#news-library").scrollIntoView();
      }
    }
  } catch (error) {
    $("#status-text").textContent = news.updatedAt ? `갱신 지연, 최근 수집 ${fmtKst(news.updatedAt)} KST` : "기사 수집본을 불러오지 못했습니다.";
    if (!news.updatedAt) {
      for (const id of ["feed","pulse-metrics","major-incidents"]) document.getElementById(id).innerHTML = '<p class="empty">자료를 불러오지 못했습니다.</p>';
    }
  } finally {
    refreshing = false;
  }
}

async function main() {
  initTheme();
  const [cardFile, snapshot] = await Promise.all([loadJson("data/cards.json").catch(() => null), loadJson("data/snapshot.json").catch(() => null)]);
  cardsAvailable = !!cardFile;
  cards = cardFile?.cards || [];
  names = Object.fromEntries((snapshot?.stocks || []).map(stock => [stock.id, stock.name]));
  segments = Object.fromEntries((snapshot?.segments || []).map(segment => [segment.id, segment.label]));
  bind();
  await refresh(true);
  const update = () => { if (!document.hidden) refresh(); };
  window.setInterval(update, 5 * 60000);
  document.addEventListener("visibilitychange", update);
}
main();
