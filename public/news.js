// 뉴스 페이지: 큐레이션 카드(1차 출처 확인)와 자동 수집 헤드라인을 범주, 지역, 기간, 검색어로 거른다.
import { esc, fmtKst, loadJson, initTheme } from "./common.js";
import { statusTone } from "./lib/status.js";

const PAGE = 60;
const CARD_PREVIEW = 3;
const state = { tab: "incident", region: "ALL", period: 30, query: "", shown: PAGE, cardsOpen: false };
let cards = [];
let news = { items: [], updatedAt: null };
let names = {};
let segments = {};

const $ = (selector) => document.querySelector(selector);
const REGION = { KR: "국내", GL: "해외" };
// 카드와 헤드라인이 한 줄로 쌓이는 폭에서는 카드를 몇 장만 먼저 보여 줘 헤드라인이 멀리 밀리지 않게 한다.
const stacked = window.matchMedia("(max-width: 1100px)");

function matches(text) {
  const query = state.query.trim().toLowerCase();
  return !query || text.toLowerCase().includes(query);
}

function filteredCards() {
  return cards.filter((card) => card.category === state.tab
    && (state.region === "ALL" || card.region === state.region)
    && matches([card.title, card.entity, card.claim, ...(card.facts || []).map((fact) => fact.value), ...(card.tickers || []).map((id) => names[id] || id)].join(" ")));
}

function filteredHeadlines() {
  const cutoff = state.period ? Date.now() - state.period * 86400000 : 0;
  return news.items.filter((item) => item.c === state.tab
    && (state.region === "ALL" || item.r === state.region)
    && Date.parse(item.d) >= cutoff
    && matches(`${item.t} ${item.s} ${(item.k || []).map((id) => names[id] || id).join(" ")}`));
}

function renderCards() {
  const all = filteredCards();
  const preview = stacked.matches && !state.cardsOpen && !state.query.trim() && all.length > CARD_PREVIEW;
  const list = preview ? all.slice(0, CARD_PREVIEW) : all;
  const more = preview ? `<button type="button" class="more" id="more-cards">카드 ${all.length - CARD_PREVIEW}장 더 보기</button>` : "";
  $("#cards").innerHTML = list.length ? list.map((card) => {
    const facts = card.facts.map((fact) => `<dt>${esc(fact.label)}</dt><dd>${esc(fact.value)}</dd>`).join("");
    const segs = (card.segs || []).map((id) => segments[id]).filter(Boolean).join(", ");
    const tickers = (card.tickers || []).map((id) => `<a href="index.html?q=${encodeURIComponent(names[id] || id)}" title="종목 표에서 보기">${esc(names[id] || id)}</a>`).join(", ");
    const sources = card.sources.map((source) => `<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.name)}</a>`).join("");
    return `<article class="card">
      <p class="card-date"><b class="num">${esc(card.date)}</b>${card.dateLabel ? `<span class="when">${esc(card.dateLabel)}</span>` : ""}<span>${esc(card.country || REGION[card.region])}</span></p>
      <div>
        <h3>${esc(card.title)}<span class="state" data-tone="${statusTone(card.status)}">${esc(card.status)}</span></h3>
        <p class="claim">${esc(card.claim)}</p>
        <dl class="facts">${facts}</dl>
        <p class="card-foot">${segs ? `<span>관련 분야: ${esc(segs)}</span>` : ""}${tickers ? `<span>관련 종목: ${tickers}</span>` : ""}<span class="src">출처: ${sources}</span></p>
      </div>
    </article>`;
  }).join("") + more : '<p class="empty">조건에 맞는 카드가 없음</p>';
}

function renderHeadlines() {
  const list = filteredHeadlines();
  // 같은 사건을 다룬 기사는 최신 기사 하나 아래로 접는다.
  const groups = [];
  const position = new Map();
  for (const item of list) {
    const key = item.g || item.id;
    if (position.has(key)) groups[position.get(key)].push(item);
    else { position.set(key, groups.length); groups.push([item]); }
  }
  const shown = groups.slice(0, state.shown);
  let day = "";
  const rows = shown.map(([item, ...rest]) => {
    const kst = fmtKst(item.d);
    const date = `${new Date(new Date(item.d).getTime() + 9 * 3600000).getUTCFullYear()}-${kst.slice(0, 5)}`;
    const header = date !== day ? `<p class="day">${date}</p>` : "";
    day = date;
    const tags = [...new Set([item, ...rest].flatMap((row) => row.k || []))].map((id) => names[id] || id).join(", ");
    const related = rest.length ? `<details class="related"><summary>같은 사건 기사 ${rest.length}건</summary><ul>${rest.map((row) => `<li><a href="${esc(row.u)}" target="_blank" rel="noopener">${esc(row.t)}</a> <span class="meta">${esc(row.s)}</span></li>`).join("")}</ul></details>` : "";
    return `${header}<div class="headline">
      <a class="title" href="${esc(item.u)}" target="_blank" rel="noopener">${esc(item.t)}</a>
      <span class="meta">${esc(item.s)}, ${kst.slice(6)} ${REGION[item.r]}${tags ? `<b>${esc(tags)}</b>` : ""}</span>${related}
    </div>`;
  }).join("");
  const more = groups.length > shown.length ? `<button type="button" class="more" id="more">더 보기 (${groups.length - shown.length}건 남음)</button>` : "";
  $("#headlines").innerHTML = rows ? rows + more : '<p class="empty">조건에 맞는 헤드라인이 없음</p>';
  $("#headlines-sub").textContent = `키워드 규칙 분류, 요약 없음. 기사 ${list.length}건, 사건 ${groups.length}개`;
}

function renderCounts() {
  document.querySelectorAll("#tabs button").forEach((button) => {
    const tab = button.dataset.tab;
    const cardCount = cards.filter((card) => card.category === tab && (state.region === "ALL" || card.region === state.region)).length;
    button.querySelector("small").textContent = `카드 ${cardCount}`;
  });
  $("#count").textContent = `카드 ${filteredCards().length}장, 헤드라인 ${filteredHeadlines().length}건`;
}

function render() {
  renderCards();
  renderHeadlines();
  renderCounts();
}

function bind() {
  const press = (container, attribute, value) => container.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset[attribute] === String(value))));
  $("#tabs").addEventListener("click", (event) => {
    const tab = event.target.closest("button")?.dataset.tab;
    if (!tab) return;
    state.tab = tab;
    state.shown = PAGE;
    state.cardsOpen = false;
    document.querySelectorAll("#tabs button").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.tab === tab)));
    render();
  });
  $("#region-switch").addEventListener("click", (event) => {
    const region = event.target.closest("button")?.dataset.region;
    if (!region) return;
    state.region = region;
    press($("#region-switch"), "region", region);
    render();
  });
  $("#period-switch").addEventListener("click", (event) => {
    const period = event.target.closest("button")?.dataset.period;
    if (period == null) return;
    state.period = Number(period);
    press($("#period-switch"), "period", period);
    render();
  });
  $("#search").addEventListener("input", (event) => { state.query = event.target.value; state.shown = PAGE; render(); });
  $("#cards").addEventListener("click", (event) => {
    if (event.target.id !== "more-cards") return;
    state.cardsOpen = true;
    renderCards();
  });
  stacked.addEventListener("change", renderCards);
  $("#headlines").addEventListener("click", (event) => {
    if (event.target.id !== "more") return;
    state.shown += PAGE;
    renderHeadlines();
  });
}

async function main() {
  initTheme();
  try {
    const [cardFile, newsFile, snapshot] = await Promise.all([loadJson("data/cards.json"), loadJson("data/news.json"), loadJson("data/snapshot.json")]);
    cards = cardFile.cards;
    news = newsFile;
    names = Object.fromEntries(snapshot.stocks.map((stock) => [stock.id, stock.name]));
    segments = Object.fromEntries(snapshot.segments.map((segment) => [segment.id, segment.label]));
    $("#status-text").textContent = `헤드라인 ${fmtKst(news.updatedAt)} KST, 카드 ${cardFile.updated} 기준`;
    $("#notes").textContent = `헤드라인 출처: 구글 뉴스 검색, 데일리시큐, BleepingComputer, The Record, The Hacker News, SecurityWeek, Krebs on Security, CISA. 카드의 금액과 건수는 각 카드의 출처 기준이며, 계획과 확정과 집행은 상태 표시로 구분함.`;
  } catch (error) {
    $("#status-text").textContent = "데이터를 불러오지 못함";
    $("#cards").innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }
  const query = new URLSearchParams(location.search).get("q");
  if (query) {
    state.query = query;
    state.period = 0;
    $("#search").value = query;
    document.querySelectorAll("#period-switch button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.period === "0")));
    // 검색어로 들어오면 결과가 있는 첫 범주를 연다.
    const first = ["incident", "policy", "spending"].find((tab) => { state.tab = tab; return filteredCards().length || filteredHeadlines().length; });
    state.tab = first || "incident";
    document.querySelectorAll("#tabs button").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.tab === state.tab)));
  }
  bind();
  render();
}

main();
