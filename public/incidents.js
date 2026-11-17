// 해킹 사건 페이지: 통합, 국내, 해외를 바꿔 보며 종합 지수, 건수, 유출 규모, 탈취 금액, 업권, 사건 목록, 최근 보도를 본다.
import { esc, fmtKst, loadJson, initTheme } from "./common.js";
import { groupStories } from "./lib/issues.js";
import { REGION_LABEL, weeksEnding, weeklyStats, compositeIndex, summary, claimText, orgBreakdown, indexChart, countChart, sizeChart, knownRec, knownUsd, fmtCount, fmtUsd, fmtKrw } from "./lib/incident-metrics.js";

const $ = (s) => document.querySelector(s);
const PAGE = 25;
const state = { region: "ALL", query: "", sort: "d", shown: PAGE };
let data = null;
let news = { items: [] };
let weeks = [];
let widths = "";

const fmt1 = (v) => v.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
// 화면 기간은 13주 칸의 첫날부터. 그 앞 자료는 쓰지 않는다.
const first = () => weeks[0].start;
const inView = (e) => e.d >= first() && e.d <= data.until;
// 자동 감지가 시작되는 날(리서치 마감 다음 날). 기간 안일 때만 경계선을 긋는다.
const autoFrom = () => { const d = new Date(Date.parse(`${data.researchUntil}T00:00:00Z`) + 86400000).toISOString().slice(0, 10); return d <= data.until ? d : null; };
const regionList = () => (state.region === "ALL" ? ["KR", "GL"] : [state.region]);
// 안쪽 여백을 뺀 실제 그림 폭
const width = (el) => { const cs = getComputedStyle(el); return Math.max(260, Math.floor(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))); };
const legend = (keys) => keys.map((k) => `<span class="${k}"><i></i>${REGION_LABEL[k]}</span>`).join("");

function renderTop() {
  const opts = { since: first() > data.since ? first() : data.since, until: data.until };
  const sums = Object.fromEntries(["KR", "GL", "ALL"].map((r) => [r, summary(data.events, weeks, r, opts)]));
  $("#inc-title").textContent = `${state.region === "ALL" ? "국내외" : REGION_LABEL[state.region]} 해킹 사건 동향`;
  $("#inc-range").textContent = `최근 13주, ${first().slice(5).replace("-", ".")}~${data.until.slice(5).replace("-", ".")}`;
  $("#inc-claim").innerHTML = regionList().map((r) => `<p>${esc(claimText(sums[r], REGION_LABEL[r]))}</p>`).join("");
  const s = sums[state.region];
  const index = compositeIndex(data.events, weeks);
  const lastFull = (r) => index[r].filter((p) => !p.partial).at(-1);
  const avg = (r) => index[r].reduce((t, p) => t + p.index, 0) / index[r].length;
  const idxTile = regionList().map((r) => `<span class="${r}">${REGION_LABEL[r]} <b class="num">${Math.round(lastFull(r).index)}</b><small>평균 ${Math.round(avg(r))}</small></span>`).join("");
  $("#inc-kpis").innerHTML = `
    <div class="kpi-tile"><h3>사건 수</h3><p class="big num">${s.total.toLocaleString("ko-KR")}<small>건</small></p><p class="sub">최근 4주 주당 <b class="num">${fmt1(s.recentPerWeek)}</b>, 그 전 <b class="num">${fmt1(s.beforePerWeek)}</b></p></div>
    <div class="kpi-tile"><h3>유출 발표 합계</h3><p class="big num">${fmtCount(s.rec)}<small>건</small></p><p class="sub">규모가 발표된 ${s.recKnown}건 기준, 최근 4주 ${fmtCount(s.recentRec)}건</p></div>
    <div class="kpi-tile"><h3>탈취 금액 합계</h3><p class="big num">${s.usd ? fmtUsd(s.usd) : "$0"}</p><p class="sub">금액이 발표된 ${s.usdKnown}건 기준, 최근 4주 ${s.recentUsd ? fmtUsd(s.recentUsd) : "$0"}</p></div>
    <div class="kpi-tile"><h3>종합 지수, 지난주</h3><p class="idx-tile">${idxTile}</p><p class="sub">0~100, 기간 중 가장 센 주의 각 요소가 100</p></div>`;
}

function renderIndex() {
  const index = compositeIndex(data.events, weeks);
  const el = $("#idx-chart");
  if (state.region === "ALL") {
    $("#idx-legend").innerHTML = legend(["KR", "GL"]);
    el.innerHTML = indexChart([{ key: "KR", label: "국내", points: index.KR }, { key: "GL", label: "해외", points: index.GL }], weeks, { width: width(el), boundary: autoFrom() });
  } else {
    const r = state.region;
    $("#idx-legend").innerHTML = `${legend([r])}<span class="comp-c"><i></i>건수 요소</span><span class="comp-r"><i></i>유출 요소</span><span class="comp-m"><i></i>금액 요소</span>`;
    el.innerHTML = indexChart([{ key: r, label: REGION_LABEL[r], points: index[r] }], weeks, { width: width(el), components: index[r], boundary: autoFrom() });
  }
}

function renderCounts() {
  const el = $("#cnt-chart");
  const groups = regionList().map((r) => ({ key: r, label: REGION_LABEL[r], stats: weeklyStats(data.events, weeks, r) }));
  $("#cnt-legend").innerHTML = legend(regionList());
  el.innerHTML = countChart(groups, weeks, { width: width(el), boundary: autoFrom() });
  // 랜섬웨어 피해 공개: 국내는 국내, 해외는 전 세계에서 국내를 뺀 것, 통합은 전 세계
  const pick = (v) => (state.region === "KR" ? v.KR : state.region === "GL" ? v.total - v.KR : v.total);
  const rwStats = weeks.map((w) => {
    const days = Object.entries(data.ransomware).filter(([d]) => d >= w.start && d <= w.end);
    return { ...w, count: days.reduce((t, [, v]) => t + pick(v), 0), events: days.flatMap(([, v]) => (state.region !== "GL" ? v.kr || [] : [])).map((n) => ({ n })) };
  });
  $("#rw-title").textContent = `랜섬웨어 피해 공개 건수, ${state.region === "KR" ? "국내" : state.region === "GL" ? "해외(전 세계에서 국내 제외)" : "전 세계"}`;
  $("#rw-chart").innerHTML = countChart([{ key: "RW", label: "랜섬웨어 공개", stats: rwStats }], weeks, { width: width($("#rw-chart")) });
}

function renderOrgs() {
  const rows = orgBreakdown(data.events, weeks, state.region);
  const max = Math.max(0.1, ...rows.flatMap((r) => [r.recent, r.before]));
  const bar = (v, cls) => `<svg class="org-bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect class="track" width="100" height="10"></rect><rect class="${cls}" width="${Math.max(0.5, (v / max) * 100).toFixed(1)}" height="10"></rect></svg>`;
  $("#org-table").innerHTML = `<table class="org-table"><thead><tr><th>업권</th><th>그 전 9주</th><th>최근 4주</th><th class="n">전체</th></tr></thead><tbody>${rows.map((r) => `<tr><th scope="row">${esc(r.label)}</th><td>${bar(r.before, "before")}<b class="num">${fmt1(r.before)}</b></td><td>${bar(r.recent, `recent${/금융|가상자산|감독/.test(r.org) ? " fin" : ""}`)}<b class="num">${fmt1(r.recent)}</b></td><td class="n num">${r.total}</td></tr>`).join("")}</tbody></table><p class="inc-foot">노랑은 금융권(금융회사, 가상자산 거래소, 감독과 보안 기관)</p>`;
}

function renderSizes() {
  const list = data.events.filter(inView).filter((e) => regionList().includes(e.r));
  const recN = list.filter(knownRec).length, usdN = list.filter(knownUsd).length;
  $("#rec-sub").textContent = `점 하나가 사건 하나, 높이가 발표된 유출 건수(로그 눈금, 한 칸이 10배). 규모가 발표된 ${recN}건, 나머지 ${list.length - recN}건은 미공개이거나 해커 주장`;
  $("#usd-sub").textContent = `금전 피해(가상자산 탈취, 무단 사용 등) 금액이 발표된 ${usdN}건. 높이가 금액(로그 눈금, 달러). 원화로만 발표된 금액은 사이트 시세의 원달러 환율${data.fx ? `(${Math.round(data.fx).toLocaleString("ko-KR")}원)` : ""}로 환산`;
  $("#rec-chart").innerHTML = recN ? sizeChart(list, weeks, "rec", { width: width($("#rec-chart")) }) : '<p class="empty">유출 규모가 발표된 사건 없음</p>';
  $("#usd-chart").innerHTML = usdN ? sizeChart(list, weeks, "usd", { width: width($("#usd-chart")) }) : '<p class="empty">이 기간 금액이 발표된 사건 없음</p>';
}

function renderTable() {
  const q = state.query.trim().toLowerCase();
  const rows = data.events.filter(inView).filter((e) => regionList().includes(e.r)).filter((e) => !q || `${e.n} ${e.org} ${e.atk}`.toLowerCase().includes(q));
  const key = { d: (e) => e.d, rec: knownRec, usd: knownUsd }[state.sort];
  rows.sort((a, b) => (state.sort === "d" ? b.d.localeCompare(a.d) : key(b) - key(a)) || b.d.localeCompare(a.d));
  const shown = rows.slice(0, state.shown);
  $("#list-sub").textContent = `${rows.length}건. 이름을 누르면 첫 출처, 숫자 옆은 근거 성격`;
  $("#inc-table").innerHTML = `<thead><tr><th>날짜</th><th>피해 기관</th><th>업권</th><th class="n">유출</th><th class="n">금액</th><th>내용</th><th>출처</th></tr></thead><tbody>${shown.map((e) => `<tr>
      <td class="num nowrap">${e.d.slice(2).replace(/-/g, ".")}</td>
      <th scope="row"><span class="rg ${e.r}">${e.r === "KR" ? "국내" : "해외"}</span>${e.via === "자동 감지" ? '<span class="auto" title="리서치 이후 기사 제목에서 자동으로 찾은 사건">자동 감지</span>' : ""}${e.src[0] ? `<a href="${esc(e.src[0].u)}" target="_blank" rel="noopener">${esc(e.n)}</a>` : esc(e.n)}</th>
      <td class="nowrap">${esc(e.org || "-")}</td>
      <td class="n num nowrap">${knownRec(e) ? `${fmtCount(e.rec)}${esc(e.recUnit || "건")}` : e.claim && e.rec ? `<span class="claim" title="해커 주장, 집계 제외">${fmtCount(e.rec)}?</span>` : "-"}${e.basis && (knownRec(e) || knownUsd(e)) ? `<small>${esc(e.basis)}</small>` : ""}</td>
      <td class="n num nowrap">${e.krw ? `${fmtKrw(e.krw)}<small>원화 발표, ${fmtUsd(e.usd)} 환산</small>` : knownUsd(e) ? fmtUsd(e.usd) : "-"}</td>
      <td class="atk">${esc(e.atk || "")}</td>
      <td class="src">${e.src.slice(0, 3).map((s) => `<a href="${esc(s.u)}" target="_blank" rel="noopener" title="${esc(s.t || "")}">${esc(s.o)}</a>`).join("")}</td>
    </tr>`).join("")}</tbody>`;
  const more = $("#inc-more");
  more.hidden = rows.length <= shown.length;
  more.textContent = `${rows.length - shown.length}건 더 보기`;
}

function renderPress() {
  const cutoff = Date.now() - 7 * 86400000;
  const items = news.items.filter((i) => i.c === "incident" && regionList().includes(i.r) && Date.parse(i.d) >= cutoff);
  const stories = groupStories(items).sort((a, b) => b.sources - a.sources || b.last.localeCompare(a.last)).slice(0, 8);
  $("#inc-press").innerHTML = stories.length ? stories.map((s) => `<li><a href="${esc(s.lead.u)}" target="_blank" rel="noopener">${esc(s.lead.t)}</a><p class="meta"><span class="rg ${s.r}">${s.r === "KR" ? "국내" : "해외"}</span>${s.sources}개 매체, ${s.count}건, 최근 ${fmtKst(s.last)}</p></li>`).join("") : '<li class="empty">최근 7일 기사 없음</li>';
}

function renderCharts() {
  widths = [...document.querySelectorAll(".inc-chart")].map((el) => el.clientWidth).join(",");
  renderIndex();
  renderCounts();
  renderSizes();
}

function render() {
  renderTop();
  renderCharts();
  renderOrgs();
  renderTable();
  renderPress();
}

function bind() {
  const press = (group, attr, value) => group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset[attr] === value)));
  $("#inc-region").addEventListener("click", (event) => {
    const region = event.target.closest("button")?.dataset.region;
    if (!region) return;
    state.region = region;
    state.shown = PAGE;
    press($("#inc-region"), "region", region);
    const url = new URL(location.href);
    if (region === "ALL") url.searchParams.delete("r"); else url.searchParams.set("r", region);
    history.replaceState(null, "", url);
    render();
  });
  $("#inc-sort").addEventListener("click", (event) => {
    const sort = event.target.closest("button")?.dataset.sort;
    if (!sort) return;
    state.sort = sort;
    state.shown = PAGE;
    press($("#inc-sort"), "sort", sort);
    renderTable();
  });
  $("#inc-search").addEventListener("input", (event) => { state.query = event.target.value; state.shown = PAGE; renderTable(); });
  $("#inc-more").addEventListener("click", () => { state.shown += PAGE * 2; renderTable(); });
  let frame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const now = [...document.querySelectorAll(".inc-chart")].map((el) => el.clientWidth).join(",");
      if (now !== widths) renderCharts();
    });
  }).observe($("main"));
}

async function main() {
  initTheme();
  try {
    [data, news] = await Promise.all([loadJson("data/incident-events.json"), loadJson("data/news.json").catch(() => ({ items: [] }))]);
  } catch (error) {
    $("#status-text").textContent = "데이터를 불러오지 못함";
    $("#inc-claim").innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }
  weeks = weeksEnding(data.until, 13);
  const r = new URLSearchParams(location.search).get("r");
  if (r === "KR" || r === "GL") {
    state.region = r;
    document.querySelectorAll("#inc-region button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.region === r)));
  }
  $("#status-text").textContent = `사건 자료 ${fmtKst(data.updatedAt)} KST`;
  $("#inc-notes").textContent = `자료 범위: 사건 리서치는 ${data.researchUntil}까지. 그 뒤는 기사 제목에서 피해 기관을 자동으로 찾은 사건(표의 "자동 감지", 차트의 점선 이후)이라 리서치 구간과 집계 방식이 다름. ` + "출처: 원문 링크를 확인한 사건 리서치, 보도 수집(피해 주체 사전에 걸리고 3개 매체 이상이 다룬 사건, 규모는 매체 2곳 이상 제목에 같은 숫자가 나올 때만), DeFiLlama 가상자산 해킹($1천만 이상), ransomware.live(유출 사이트 공개일 기준). 공개 보도 기준이라 보도되지 않은 사건은 빠짐. 마지막 주는 집계 중.";
  bind();
  render();
}

main();
