import { esc } from "./common.js";
import { REGION_LABEL, weeksEnding, weeklyStats, compositeIndex, orgBreakdown, indexChart, countChart, sizeChart, hasRec, hasUsd, knownRec, knownUsd, fmtCount, fmtUsd, fmtKrw, isIncidentCandidate } from "./lib/incident-metrics.js";

const $ = (s) => document.querySelector(s);
const fmt1 = (v) => v == null ? "-" : v.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const PAGE = 15;
const state = { region: "ALL", query: "", sort: "d", shown: PAGE, countMode: "confirmed" };
let data = null;
let weeks = [];
let widths = "";
let confirmed = [], candidates = [];

// 화면 기간은 13주 칸의 첫날부터. 그 앞 자료는 쓰지 않는다.
const first = () => weeks[0].start;
const inView = (e) => e.d >= first() && e.d <= data.until;
// 자동 감지가 시작되는 날(리서치 마감 다음 날). 기간 안일 때만 경계선을 긋는다.
const autoFrom = () => { const d = new Date(Date.parse(`${data.researchUntil}T00:00:00Z`) + 86400000).toISOString().slice(0, 10); return d <= data.until ? d : null; };
const regionList = () => (state.region === "ALL" ? ["KR", "GL"] : [state.region]);
// 안쪽 여백을 뺀 실제 그림 폭
const width = (el) => { const cs = getComputedStyle(el); return Math.max(260, Math.floor(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))); };
const legend = (keys) => keys.map((k) => `<span class="${k}"><i></i>${REGION_LABEL[k]}</span>`).join("");

function renderIndex() {
  const index = compositeIndex(confirmed, weeks);
  const withCoverage = points => points.map(point =>
    point.end > data.researchUntil && !point.recKnown && !point.usdKnown ? { ...point, missing: true } : point);
  const el = $("#idx-chart");
  if (state.region === "ALL") {
    $("#idx-legend").innerHTML = legend(["KR", "GL"]);
    el.innerHTML = indexChart([{ key: "KR", label: "국내", points: withCoverage(index.KR) }, { key: "GL", label: "해외", points: withCoverage(index.GL) }], weeks, { width: width(el), plotH: 170 });
  } else {
    const r = state.region;
    $("#idx-legend").innerHTML = `${legend([r])}<span class="comp-r"><i></i>유출 요소</span><span class="comp-m"><i></i>금액 요소</span>`;
    const points = withCoverage(index[r]);
    el.innerHTML = indexChart([{ key: r, label: REGION_LABEL[r], points }], weeks, { width: width(el), components: points, plotH: 170 });
  }
}

function renderCounts() {
  const el = $("#cnt-chart");
  const screening = state.countMode === "candidates";
  const groups = regionList().map((r) => ({ key: r, label: REGION_LABEL[r], stats: weeklyStats(screening ? candidates : confirmed, weeks, r) }));
  $("#cnt-title").textContent = screening ? "보도 후보 건수" : "확인 집계 건수";
  $("#cnt-note").textContent = screening ? "실제 사고 보도를 골라 같은 사고의 여러 기사를 한 건으로 셉니다."
    : `리서치 확인은 ${data.researchUntil}까지입니다. 이후 막대는 DeFiLlama 자료만 반영합니다. 최근 사고 보도는 ‘보도 후보’에서 볼 수 있습니다.`;
  el.innerHTML = countChart(groups, weeks, { width: width(el), boundary: screening ? autoFrom() : null, left: 40, right: 64, plotH: 140 });
  // 랜섬웨어 피해 공개: 국내는 국내, 해외는 전 세계에서 국내를 뺀 것, 통합은 전 세계
  const pick = (v) => (state.region === "KR" ? v.KR : state.region === "GL" ? v.total - v.KR : v.total);
  const rwStats = weeks.map((w) => {
    const days = Object.entries(data.ransomware).filter(([d]) => d >= w.start && d <= w.end);
    return { ...w, count: days.reduce((t, [, v]) => t + pick(v), 0), events: days.flatMap(([, v]) => (state.region !== "GL" ? v.kr || [] : [])).map((n) => ({ n })) };
  });
  $("#rw-sub").textContent = `랜섬웨어 조직이 유출 사이트에 올린 피해 기관 수(ransomware.live), ${state.region === "KR" ? "국내" : state.region === "GL" ? "해외(전 세계에서 국내 제외)" : "전 세계"}`;
  $("#rw-chart").innerHTML = countChart([{ key: "RW", label: "랜섬웨어 공개", stats: rwStats }], weeks, { width: width($("#rw-chart")), plotH: 220 });
}

function renderOrgs() {
  const rows = orgBreakdown(confirmed, weeks, state.region, data);
  const max = Math.max(0.1, ...rows.flatMap((r) => [r.recent, r.before]));
  const bar = (v, cls) => `<svg class="org-bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect class="track" width="100" height="10"></rect><rect class="${cls}" width="${Math.max(0, (v / max) * 100).toFixed(1)}" height="10"></rect></svg>`;
  $("#org-table").innerHTML = `<table class="org-table"><thead><tr><th>업권</th><th>그 전 9주</th><th>최근 4주</th><th class="n">전체</th></tr></thead><tbody>${rows.map((r) => `<tr><th scope="row">${esc(r.label)}</th><td>${bar(r.before, "before")}<b class="num">${fmt1(r.before)}</b></td><td>${bar(r.recent, `recent${/금융|가상자산|감독/.test(r.org) ? " fin" : ""}`)}<b class="num">${fmt1(r.recent)}</b></td><td class="n num">${r.total}</td></tr>`).join("")}</tbody></table><p class="inc-foot">노랑은 금융권(금융회사, 가상자산 거래소, 감독과 보안 기관)</p>`;
}

function renderSizes() {
  const list = confirmed.filter(inView).filter((e) => regionList().includes(e.r));
  const recN = list.filter(hasRec).length, usdN = list.filter(hasUsd).length;
  $("#rec-sub").textContent = `점 하나가 사고 하나, 높을수록 유출이 큼(한 칸이 10배). 규모가 발표된 ${recN}건만`;
  $("#usd-sub").textContent = `가상자산 탈취, 무단 사용 등 금액이 발표된 ${usdN}건. 높을수록 큼(한 칸이 10배). 원화 발표액은 ${data.fx ? `${Math.round(data.fx).toLocaleString("ko-KR")}원` : "사이트 환율"}으로 달러 환산`;
  $("#rec-chart").innerHTML = list.some(knownRec) ? sizeChart(list, weeks, "rec", { width: width($("#rec-chart")), maxLabels: 6 }) : recN ? '<p class="empty">발표된 유출 규모는 모두 0건입니다.</p>' : '<p class="empty">유출 규모가 발표된 사건 없음</p>';
  $("#usd-chart").innerHTML = list.some(knownUsd) ? sizeChart(list, weeks, "usd", { width: width($("#usd-chart")), maxLabels: 6 }) : usdN ? '<p class="empty">발표된 피해 금액은 모두 0달러입니다.</p>' : '<p class="empty">이 기간 금액이 발표된 사건 없음</p>';
}

function renderTable() {
  const q = state.query.trim().toLowerCase();
  const rows = data.events.filter(inView).filter((e) => regionList().includes(e.r)).filter((e) => !q || `${e.n} ${e.org} ${e.atk}`.toLowerCase().includes(q));
  const key = { d: (e) => e.d, rec: knownRec, usd: knownUsd }[state.sort];
  rows.sort((a, b) => (state.sort === "d" ? b.d.localeCompare(a.d) : key(b) - key(a)) || b.d.localeCompare(a.d));
  const shown = rows.slice(0, state.shown);
  const count = rows.filter(isIncidentCandidate).length;
  $("#list-sub").textContent = `확인 집계 ${rows.length - count}건, 보도 후보 ${count}건. 이름을 누르면 출처를 엽니다.`;
  $("#inc-table").innerHTML = `<thead><tr><th>날짜</th><th>피해 기관</th><th>업권</th><th class="n">유출</th><th class="n">금액</th><th>내용</th><th>출처</th></tr></thead><tbody>${shown.map((e) => `<tr>
      <td class="num nowrap">${e.d.slice(2).replace(/-/g, ".")}</td>
      <th scope="row"><span class="rg ${e.r}">${e.r === "KR" ? "국내" : "해외"}</span>${isIncidentCandidate(e) ? '<span class="auto" title="기사 보도에서 찾은 후보">보도 후보</span>' : ""}${e.src[0] ? `<a href="${esc(e.src[0].u)}" target="_blank" rel="noopener">${esc(e.n)}</a>` : esc(e.n)}</th>
      <td class="nowrap">${esc(e.org || "-")}</td>
      <td class="n num nowrap">${hasRec(e) ? `${fmtCount(e.rec)}${esc(e.recUnit || "건")}` : e.claim && e.rec ? `<span class="claim" title="해커 주장, 집계 제외">${fmtCount(e.rec)}?</span>` : "-"}${e.basis && (hasRec(e) || hasUsd(e)) ? `<small>${esc(e.basis)}</small>` : ""}</td>
      <td class="n num nowrap">${e.krw ? `${fmtKrw(e.krw)}<small>원화 발표, ${fmtUsd(e.usd)} 환산</small>` : hasUsd(e) ? fmtUsd(e.usd) : "-"}</td>
      <td class="atk">${esc(e.atk || "")}</td>
      <td class="src">${e.src.slice(0, 3).map((s) => `<a href="${esc(s.u)}" target="_blank" rel="noopener" title="${esc(s.t || "")}">${esc(s.o)}</a>`).join("")}</td>
    </tr>`).join("")}</tbody>`;
  const more = $("#inc-more");
  more.hidden = rows.length <= shown.length;
  more.textContent = `${rows.length - shown.length}건 더 보기`;
}

function renderCharts() {
  widths = [...document.querySelectorAll(".inc-chart")].map((el) => el.clientWidth).join(",");
  renderIndex();
  renderCounts();
  renderSizes();
}

function render() {
  renderCharts();
  renderOrgs();
  renderTable();
}

function bind() {
  const press = (group, attr, value) => group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset[attr] === value)));
  $("#inc-sort").addEventListener("click", (event) => {
    const sort = event.target.closest("button")?.dataset.sort;
    if (!sort) return;
    state.sort = sort;
    state.shown = PAGE;
    press($("#inc-sort"), "sort", sort);
    renderTable();
  });
  $("#inc-count-mode").addEventListener("click", (event) => {
    const mode = event.target.closest("button")?.dataset.countMode;
    if (!mode) return;
    state.countMode = mode;
    press($("#inc-count-mode"), "countMode", mode);
    renderCounts();
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
  }).observe($("#news-incidents-view"));
}

export function showIncidentHistory(file, region) {
  if (!file) return;
  if (!data) bind();
  if (data !== file) {
    data = file;
    weeks = weeksEnding(data.until, 13);
    confirmed = data.events.filter(event => !isIncidentCandidate(event));
    candidates = data.events.filter(isIncidentCandidate);
  }
  if (state.region !== region) state.shown = PAGE;
  state.region = region;
  $("#inc-notes").textContent = `리서치 확인은 ${data.researchUntil}까지입니다. 보도 수집과 자동 감지는 후보로 표시합니다. 출처는 사고 리서치 원문, 공개 보도, DeFiLlama, ransomware.live입니다.`;
  render();
}
