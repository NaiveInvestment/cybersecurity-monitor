import { esc, fmtKst, headlineLink as link, loadJson, initTheme } from "./common.js";
import { statusTone } from "./lib/status.js";
import { groupStories, topIssues } from "./lib/issues.js";
import { recentIncidentStories } from "./lib/recent-incidents.js";

const PAGE = 40;
const state = { view: "recent", category: "all", region: "KR", period: 30, query: "", shown: PAGE, focus: null, topic: "policy" };
let cards = [];
let news = { items: [], updatedAt: null };
let names = {};
let segments = {};

const $ = (selector) => document.querySelector(selector);
const REGION = { KR: "국내", GL: "해외" };
const CATEGORY = { incident: "해킹 사례", policy: "정책", spending: "기업 대응과 지출" };

const kstDate = (iso) => {
  const date = new Date(new Date(iso).getTime() + 9 * 3600000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
};
const inRegion = (region) => state.region === "ALL" || region === state.region;
const matches = (text) => {
  const query = state.query.trim().toLowerCase();
  return !query || text.toLowerCase().includes(query);
};
// 정부, 규제기관, 회사 자료 없이 기사만으로 정리한 항목.
const mediaOnly = (card) => card.sources.every((source) => source.kind === "media");
const stockNames = (ids) => ids.map((id) => names[id] || id).join(", ");

function filteredBriefs() {
  const cutoff = state.period ? kstDate(Date.now() - state.period * 86400000) : "";
  return cards.filter((card) => inRegion(card.region) && card.date >= cutoff
    && matches([card.title, card.entity, card.claim, ...(card.facts || []).map((fact) => fact.value),
      stockNames(card.tickers || [])].join(" ")));
}

function filteredItems() {
  const cutoff = state.period ? Date.now() - state.period * 86400000 : 0;
  return news.items.filter((item) => (state.category === "all" || item.c === state.category)
    && inRegion(item.r) && Date.parse(item.d) >= cutoff
    && matches(`${item.t} ${item.tKo || ""} ${item.s} ${stockNames(item.k || [])}`));
}

function findStory(items, id) {
  return groupStories(items.filter((item) => String(item.g || item.id) === id))[0];
}

function recentRow(story, firstReport = false) {
  const item = firstReport ? story.items.at(-1) : story.lead;
  const others = story.items.filter((article) => article !== item);
  const coverage = story.sources > 1 ? `${story.sources}개 매체 보도` : `다른 보도 ${others.length}건`;
  const related = others.length ? `<details class="related" data-story="${esc(story.id)}">
    <summary>${coverage}</summary>
    <ul>${others.map((row) => `<li>${link(row)} <span class="meta">${esc(row.s)}, ${fmtKst(row.d)}</span></li>`).join("")}</ul>
  </details>` : "";
  return `<li class="recent-row">${link(item, "recent-title")}
    <p class="recent-meta meta"><time class="num" datetime="${esc(item.d)}">${fmtKst(item.d)}</time><span>${esc(item.s)}</span>${story.earlier
      ? `<a href="${esc(story.earlier.u)}" target="_blank" rel="noopener">이전 보도 ${fmtKst(story.earlier.d)}</a>` : ""}</p>
    ${related}</li>`;
}

function watchRecentIncidents(file) {
  const panel = $("#recent-incidents");
  let previousHtml;
  let lastFetch = Date.now();
  let fetching = false;
  function paint() {
    const stories = recentIncidentStories(file.items);
    const fresh = stories.filter((story) => !story.followUp).sort((a, b) => Date.parse(b.first) - Date.parse(a.first));
    const followUps = stories.filter((story) => story.followUp);
    const stale = Date.now() - Date.parse(file.updatedAt) >= 86400000;
    const newReports = fresh.length
      ? `<ul class="recent-new" aria-label="새 침해사고">${fresh.map((story) => recentRow(story, true)).join("")}</ul>`
      : `<p class="recent-message">${stale ? `최근 수집은 ${fmtKst(file.updatedAt)} KST입니다. 새 수집을 기다리고 있습니다.` : "최근 24시간 안에 처음 보도된 침해사고가 없습니다."}</p>`;
    const latestOnKnown = followUps.length
      ? `<details class="recent-followups" data-story=""><summary>후속 보도 ${followUps.length}개 보기</summary><ul>${followUps.map((story) => recentRow(story)).join("")}</ul></details>`
      : "";
    const html = newReports + latestOnKnown;
    if (html === previousHtml) return;
    const openStories = new Set([...panel.querySelectorAll("details[open]")].map((detail) => detail.dataset.story));
    panel.innerHTML = html;
    panel.querySelectorAll("details").forEach((detail) => { detail.open = openStories.has(detail.dataset.story); });
    previousHtml = html;
  }
  async function update() {
    if (document.hidden) return;
    paint();
    if (fetching || Date.now() - lastFetch < 30 * 60000) return;
    fetching = true;
    lastFetch = Date.now();
    try {
      file = await loadJson("data/news.json");
      news = file;
      $("#status-text").textContent = `기사 수집 ${fmtKst(news.updatedAt)} KST`;
      paint();
    } catch {
      // 수집본이 잠시 응답하지 않으면 마지막 수집본에서도 지난 기사는 계속 만료한다.
    } finally {
      fetching = false;
    }
  }
  paint();
  window.setInterval(update, 60000);
  document.addEventListener("visibilitychange", update);
}

function renderFeed() {
  const focus = state.focus;
  if (state.category === "briefs" && !focus) {
    const briefs = filteredBriefs();
    $("#feed-title").textContent = "출처 확인 자료";
    $("#feed-sub").textContent = `${briefs.length}건`;
    $("#feed").innerHTML = briefList(briefs);
    return;
  }
  const items = focus?.items ?? filteredItems();
  const visible = focus ? items : items.slice(0, state.shown);
  $("#feed-title").textContent = focus ? "관련 기사" : "기사 목록";
  $("#feed-sub").textContent = `${items.length.toLocaleString("ko-KR")}건`;
  let day = "";
  const links = visible.map((item) => {
    const date = kstDate(item.d);
    const header = date !== day ? `<p class="day">${date}</p>` : "";
    day = date;
    return `${header}<div class="headline">
      <time class="time num" datetime="${esc(item.d)}">${fmtKst(item.d, false)}</time>
      <div>${link(item, "title")}<p class="meta">${esc(item.s)}, ${REGION[item.r]}, ${CATEGORY[item.c]}</p></div>
    </div>`;
  }).join("");
  const back = focus ? '<p class="focus-bar"><button type="button" id="focus-clear">기사 목록으로 돌아가기</button></p>' : "";
  const more = items.length > visible.length
    ? `<button type="button" class="more" id="more">기사 ${items.length - visible.length}건 더 보기</button>` : "";
  $("#feed").innerHTML = back + (links || '<p class="empty">조건에 맞는 기사가 없습니다.</p>') + more;
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

function renderPolicy() {
  $("#digest-title").textContent = state.topic === "policy" ? "정책 정리" : "기업 대응과 지출 정리";
  $("#digest").innerHTML = briefList(cards.filter((card) => card.category === state.topic));
}

const press = (container, attribute, value) => container.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset[attribute] === String(value))));

const tabs = [...document.querySelectorAll(".news-tabs [role=tab]")];

function selectView(view) {
  state.view = view;
  for (const button of tabs) {
    const active = button.dataset.view === view;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    document.getElementById(button.getAttribute("aria-controls")).hidden = !active;
  }
  if (view === "search") renderFeed();
  if (view === "policy") renderPolicy();
}

function resetSearchResults() {
  state.focus = null;
  state.shown = PAGE;
  renderFeed();
}

function selectSearchFilters() {
  press($("#region-switch"), "region", state.region);
  press($("#period-switch"), "period", state.period);
  $("#search-category").value = state.category;
  $("#search").value = state.query;
}

function bind() {
  tabs.forEach((button, index) => {
    button.addEventListener("click", () => selectView(button.dataset.view));
    button.addEventListener("keydown", (event) => {
      const shortcuts = { ArrowLeft: (index + tabs.length - 1) % tabs.length, ArrowRight: (index + 1) % tabs.length, Home: 0, End: tabs.length - 1 };
      if (!Object.hasOwn(shortcuts, event.key)) return;
      event.preventDefault();
      const next = tabs[shortcuts[event.key]];
      next.focus();
      selectView(next.dataset.view);
    });
  });
  $("#region-switch").addEventListener("click", (event) => {
    const region = event.target.closest("button")?.dataset.region;
    if (!region) return;
    state.region = region;
    press($("#region-switch"), "region", region);
    resetSearchResults();
  });
  $("#period-switch").addEventListener("click", (event) => {
    const period = event.target.closest("button")?.dataset.period;
    if (period == null) return;
    state.period = Number(period);
    press($("#period-switch"), "period", period);
    resetSearchResults();
  });
  $("#search").addEventListener("input", (event) => {
    state.query = event.target.value;
    resetSearchResults();
  });
  $("#search-category").addEventListener("change", (event) => {
    state.category = event.target.value;
    resetSearchResults();
  });
  $("#policy-switch").addEventListener("click", (event) => {
    const topic = event.target.closest("button")?.dataset.topic;
    if (!topic) return;
    state.topic = topic;
    press($("#policy-switch"), "topic", topic);
    renderPolicy();
  });
  $("#policy-to-search").addEventListener("click", () => {
    Object.assign(state, { category: state.topic, region: "ALL", period: 30, query: "", focus: null, shown: PAGE });
    selectSearchFilters();
    selectView("search");
    $("#search").focus();
  });
  $("#feed").addEventListener("click", (event) => {
    if (event.target.id === "more") { state.shown += PAGE; renderFeed(); }
    if (event.target.id === "focus-clear") {
      state.focus = null;
      renderFeed();
      $("#feed-title").focus({ preventScroll: true });
    }
  });
}

async function main() {
  initTheme();
  bind();
  try {
    const [cardFile, newsFile, snapshot] = await Promise.all([
      loadJson("data/cards.json"), loadJson("data/news.json"), loadJson("data/snapshot.json"),
    ]);
    cards = cardFile.cards;
    news = newsFile;
    names = Object.fromEntries(snapshot.stocks.map((stock) => [stock.id, stock.name]));
    segments = Object.fromEntries(snapshot.segments.map((segment) => [segment.id, segment.label]));
    $("#status-text").textContent = `기사 수집 ${fmtKst(news.updatedAt)} KST`;
    $("#notes").textContent = "영문 제목은 자동 번역을 기본으로 합니다. 제목을 누르면 원문이 열립니다.";
    watchRecentIncidents(news);
  } catch {
    $("#status-text").textContent = "데이터를 불러오지 못했습니다.";
    $("#recent-incidents").innerHTML = '<p class="recent-message">침해사고 기사를 불러오지 못했습니다.</p>';
    renderFeed();
    renderPolicy();
    return;
  }
  const params = new URLSearchParams(location.search);
  const storyId = params.get("story");
  const linkedStory = storyId && findStory(news.items, storyId);
  const query = params.get("q");
  if (linkedStory && topIssues([linkedStory]).length) {
    Object.assign(state, { view: "search", region: linkedStory.r, category: linkedStory.c, focus: linkedStory });
  } else if (query) {
    Object.assign(state, { view: "search", query, region: "ALL", period: 0 });
    if (!filteredItems().length && filteredBriefs().length) state.category = "briefs";
  }
  selectSearchFilters();
  selectView(state.view);
}

main();
