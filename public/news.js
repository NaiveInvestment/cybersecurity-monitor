// 뉴스 페이지. 위에서부터: 보도량으로 고른 주요 이슈, 범주별 최신 기사(사건 묶음), 1차 출처로 정리한 기록.
import { esc, fmtKst, loadJson, initTheme } from "./common.js";
import { statusTone } from "./lib/status.js";
import { groupStories, topIssues, cardForStory } from "./lib/issues.js";

const PAGE = 40;
const DIGEST_PREVIEW = 3;
const state = { tab: "incident", region: "ALL", period: 30, query: "", shown: PAGE, focus: null, digestOpen: false };
let cards = [];
let news = { items: [], updatedAt: null };
let names = {};
let segments = {};

const $ = (selector) => document.querySelector(selector);
const REGION = { KR: "국내", GL: "해외" };
const CATEGORY = { incident: "해킹 사례", policy: "정책", spending: "기업 대응과 지출" };
// 기사와 정리가 한 줄로 쌓이는 폭에서는 정리를 몇 건만 먼저 보여 준다.
const stacked = window.matchMedia("(max-width: 1100px)");

const kstDate = (iso) => {
  const date = new Date(new Date(iso).getTime() + 9 * 3600000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
};
const inRegion = (region) => state.region === "ALL" || region === state.region;
const matches = (text) => {
  const query = state.query.trim().toLowerCase();
  return !query || text.toLowerCase().includes(query);
};
const link = (item, cls = "") => `<a${cls ? ` class="${cls}"` : ""} href="${esc(item.u)}" target="_blank" rel="noopener">${esc(item.t)}</a>`;
// 정부, 규제기관, 회사 자료 없이 기사만으로 정리한 항목.
const mediaOnly = (card) => card.sources.every((source) => source.kind === "media");
const stockNames = (ids) => ids.map((id) => names[id] || id).join(", ");

function filteredCards() {
  return cards.filter((card) => card.category === state.tab && inRegion(card.region)
    && matches([card.title, card.entity, card.claim, ...(card.facts || []).map((fact) => fact.value), stockNames(card.tickers || [])].join(" ")));
}

function filteredItems() {
  const cutoff = state.period ? Date.now() - state.period * 86400000 : 0;
  return news.items.filter((item) => item.c === state.tab && inRegion(item.r) && Date.parse(item.d) >= cutoff
    && matches(`${item.t} ${item.s} ${stockNames(item.k || [])}`));
}

// ---- 주요 이슈 ----
function renderIssues() {
  const stories = groupStories(news.items.filter((item) => inRegion(item.r)));
  const issues = topIssues(stories);
  if (!issues.length) {
    $("#issues").innerHTML = '<p class="empty">최근 3일 안에 수집된 기사가 없음</p>';
    return;
  }
  const [lead, ...rest] = issues;
  const card = cardForStory(lead, cards);
  const others = lead.items.filter((item) => item !== lead.lead).slice(0, 4);
  const digest = card ? `<div class="lead-digest">
      <p class="lead-claim">${esc(card.claim)}</p>
      <dl class="facts">${card.facts.slice(0, 4).map((fact) => `<dt>${esc(fact.label)}</dt><dd>${esc(fact.value)}</dd>`).join("")}</dl>
      <p class="lead-src">${mediaOnly(card) ? "정리 기준(기사)" : "정리 기준"}: ${esc(card.sources.map((source) => source.name).join(", "))}</p>
    </div>` : "";
  const leadHtml = `<article class="lead">
      <p class="kicker"><b>${CATEGORY[lead.c]}</b><span>${REGION[lead.r]}</span><span>첫 보도 ${fmtKst(lead.first)}</span><span>최근 ${fmtKst(lead.last)}</span></p>
      <h3>${link(lead.lead)}</h3>
      <p class="lead-stats"><span><b class="num">${lead.sources}</b>개 매체</span><span><b class="num">${lead.count}</b>건 보도</span>${lead.k.length ? `<span class="lead-stocks">${esc(stockNames(lead.k))}</span>` : ""}</p>
      ${digest}
      <ul class="lead-list">${others.map((item) => `<li>${link(item)}<span class="meta">${esc(item.s)}</span></li>`).join("")}</ul>
      ${lead.count > 1 ? `<button type="button" class="lead-more" data-focus="${esc(lead.id)}" data-tab="${lead.c}">관련 기사 ${lead.count}건 모두 보기</button>` : ""}
    </article>`;
  const top = lead.sources;
  const rankHtml = `<ol class="rank">${rest.map((story, index) => `<li>
      <span class="rank-no num">${index + 2}</span>
      <div class="rank-body">
        ${link(story.lead, "rank-title")}
        <p class="meta"><b>${CATEGORY[story.c]}</b>, ${REGION[story.r]}, ${story.sources}개 매체 ${story.count}건, 최근 ${fmtKst(story.last)}</p>
        <svg class="bar" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><rect class="track" width="100" height="4"></rect><rect class="fill" width="${Math.max(2, Math.round((story.sources / top) * 100))}" height="4"></rect></svg>
      </div>
      ${story.count > 1 ? `<button type="button" class="rank-more" data-focus="${esc(story.id)}" data-tab="${story.c}" aria-label="관련 기사 ${story.count}건 보기">${story.count}건</button>` : ""}
    </li>`).join("")}</ol>`;
  $("#issues").innerHTML = leadHtml + rankHtml;
}

// ---- 최신 기사 ----
function renderFeed() {
  const items = filteredItems();
  const stories = groupStories(items);
  const focus = state.focus ? stories.find((story) => story.id === state.focus) : null;
  let html = "";
  if (focus) {
    html += `<p class="focus-bar"><span>같은 사건 기사 ${focus.count}건, ${focus.sources}개 매체</span><button type="button" id="focus-clear">전체 기사로 돌아가기</button></p>`;
    let day = "";
    html += focus.items.map((item) => {
      const date = kstDate(item.d);
      const header = date !== day ? `<p class="day">${date}</p>` : "";
      day = date;
      return `${header}<div class="headline"><span class="time num">${fmtKst(item.d).slice(6)}</span><div>${link(item, "title")}<p class="meta">${esc(item.s)}, ${REGION[item.r]}</p></div></div>`;
    }).join("");
  } else {
    const shown = stories.slice(0, state.shown);
    let day = "";
    html += shown.map((story) => {
      const item = story.lead;
      const date = kstDate(story.last);
      const header = date !== day ? `<p class="day">${date}</p>` : "";
      day = date;
      const rest = story.items.filter((row) => row !== item);
      const related = rest.length ? `<details class="related"><summary>같은 사건 기사 ${rest.length}건 더</summary><ul>${rest.slice(0, 12).map((row) => `<li>${link(row)} <span class="meta">${esc(row.s)}</span></li>`).join("")}</ul>${rest.length > 12 ? `<button type="button" class="related-all" data-focus="${esc(story.id)}">전체 ${story.count}건 보기</button>` : ""}</details>` : "";
      const big = story.sources >= 5;
      return `${header}<div class="headline${big ? " hot" : ""}">
        <span class="time num">${fmtKst(story.last).slice(6)}</span>
        <div>${link(item, "title")}
          <p class="meta">${esc(item.s)}, ${REGION[story.r]}${story.sources > 1 ? `<b class="cover">${story.sources}개 매체 ${story.count}건</b>` : ""}${story.k.length ? `<b class="stocks">${esc(stockNames(story.k))}</b>` : ""}</p>${related}
        </div>
      </div>`;
    }).join("");
    if (stories.length > shown.length) html += `<button type="button" class="more" id="more">더 보기 (사건 ${stories.length - shown.length}개 남음)</button>`;
  }
  $("#feed").innerHTML = html || '<p class="empty">조건에 맞는 기사가 없음</p>';
  $("#feed-sub").textContent = `기사 ${items.length}건, 사건 ${stories.length}개. 키워드 규칙 분류, 요약 없음`;
}

// ---- 사건과 정책 정리 ----
function renderDigest() {
  const all = filteredCards();
  const preview = stacked.matches && !state.digestOpen && !state.query.trim() && all.length > DIGEST_PREVIEW;
  const list = preview ? all.slice(0, DIGEST_PREVIEW) : all;
  const more = preview ? `<button type="button" class="more" id="more-digest">정리 ${all.length - DIGEST_PREVIEW}건 더 보기</button>` : "";
  $("#digest").innerHTML = list.length ? list.map((card, index) => {
    const facts = card.facts.map((fact) => `<dt>${esc(fact.label)}</dt><dd>${esc(fact.value)}</dd>`).join("");
    const segs = (card.segs || []).map((id) => segments[id]).filter(Boolean).join(", ");
    const tickers = (card.tickers || []).map((id) => `<a href="index.html?q=${encodeURIComponent(names[id] || id)}" title="종목 표에서 보기">${esc(names[id] || id)}</a>`).join(", ");
    const sources = card.sources.map((source) => `<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.name)}</a>`).join("");
    // 맨 위 한 건과 검색 결과는 펼쳐 둔다.
    const open = index === 0 || state.query.trim() ? " open" : "";
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
  }).join("") + more : '<p class="empty">조건에 맞는 정리가 없음</p>';
}

function renderCounts() {
  const cutoff = state.period ? Date.now() - state.period * 86400000 : 0;
  document.querySelectorAll("#tabs button").forEach((button) => {
    const tab = button.dataset.tab;
    const count = news.items.filter((item) => item.c === tab && inRegion(item.r) && Date.parse(item.d) >= cutoff).length;
    button.querySelector("small").textContent = count.toLocaleString("ko-KR");
  });
  $("#count").textContent = `기사 ${filteredItems().length}건, 정리 ${filteredCards().length}건`;
}

function render() {
  renderIssues();
  renderFeed();
  renderDigest();
  renderCounts();
}

function selectTab(tab) {
  state.tab = tab;
  state.shown = PAGE;
  state.digestOpen = false;
  document.querySelectorAll("#tabs button").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.tab === tab)));
}

function bind() {
  const press = (container, attribute, value) => container.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset[attribute] === String(value))));
  $("#tabs").addEventListener("click", (event) => {
    const tab = event.target.closest("button")?.dataset.tab;
    if (!tab) return;
    state.focus = null;
    selectTab(tab);
    render();
  });
  $("#region-switch").addEventListener("click", (event) => {
    const region = event.target.closest("button")?.dataset.region;
    if (!region) return;
    state.region = region;
    state.focus = null;
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
  $("#search").addEventListener("input", (event) => { state.query = event.target.value; state.shown = PAGE; state.focus = null; render(); });
  // 사건 하나의 기사만 모아 보기: 주요 이슈와 기사 목록의 "모두 보기" 버튼.
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-focus]");
    if (!button) return;
    if (button.dataset.tab) selectTab(button.dataset.tab);
    state.focus = button.dataset.focus;
    state.period = 0;
    state.query = "";
    $("#search").value = "";
    press($("#period-switch"), "period", 0);
    render();
    $("#feed-title").scrollIntoView({ block: "start" });
  });
  $("#feed").addEventListener("click", (event) => {
    if (event.target.id === "more") { state.shown += PAGE; renderFeed(); }
    if (event.target.id === "focus-clear") { state.focus = null; renderFeed(); renderCounts(); }
  });
  $("#digest").addEventListener("click", (event) => {
    if (event.target.id !== "more-digest") return;
    state.digestOpen = true;
    renderDigest();
  });
  stacked.addEventListener("change", renderDigest);
}

async function main() {
  initTheme();
  try {
    const [cardFile, newsFile, snapshot] = await Promise.all([loadJson("data/cards.json"), loadJson("data/news.json"), loadJson("data/snapshot.json")]);
    cards = cardFile.cards;
    news = newsFile;
    names = Object.fromEntries(snapshot.stocks.map((stock) => [stock.id, stock.name]));
    segments = Object.fromEntries(snapshot.segments.map((segment) => [segment.id, segment.label]));
    $("#status-text").textContent = `기사 수집 ${fmtKst(news.updatedAt)} KST, 정리 ${cardFile.updated} 기준`;
    $("#notes").textContent = "기사 출처: 구글 뉴스 검색, 데일리시큐, BleepingComputer, The Record, The Hacker News, SecurityWeek, Krebs on Security, CISA. 주요 이슈는 같은 사건을 다룬 매체 수로 정함. 주요 이슈의 매체 수는 같은 범주 안에서 센 것임. 정리의 금액과 건수는 각 항목의 출처 기준이며, 계획과 확정과 집행은 상태 표시로 구분함.";
  } catch (error) {
    $("#status-text").textContent = "데이터를 불러오지 못함";
    $("#issues").innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }
  const query = new URLSearchParams(location.search).get("q");
  if (query) {
    state.query = query;
    state.period = 0;
    $("#search").value = query;
    document.querySelectorAll("#period-switch button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.period === "0")));
    // 검색어로 들어오면 결과가 있는 첫 범주를 연다.
    const first = ["incident", "policy", "spending"].find((tab) => { state.tab = tab; return filteredCards().length || filteredItems().length; });
    selectTab(first || "incident");
  }
  bind();
  render();
}

main();
