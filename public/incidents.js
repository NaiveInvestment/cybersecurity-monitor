// 보안 사고 페이지: 통합, 국내, 해외를 바꿔 보며 최근 7일 강도, 강도 지수, 건수, 유출 규모, 탈취 금액, 업권, 사건 목록, 최근 보도를 본다.
import { esc, fmtKst, headlineLink, loadJson } from "./common.js";
import { groupStories } from "./lib/issues.js";
import { isDeniedIncidentTitle } from "./lib/incident-trend.js";
import { REGION_LABEL, weeksEnding, weeklyStats, compositeIndex, brief, orgBreakdown, indexChart, countChart, sizeChart, hasRec, hasUsd, knownRec, knownUsd, fmtCount, fmtUsd, fmtKrw, isIncidentCandidate } from "./lib/incident-metrics.js";

const $ = (s) => document.querySelector(s);
const PAGE = 15;
const state = { region: "ALL", query: "", sort: "d", shown: PAGE, countMode: "confirmed" };
let data = null;
let news = { items: [] };
let weeks = [];
let widths = "";
let confirmed = [], candidates = [];

const fmt1 = (v) => v == null ? "-" : v.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
// 화면 기간은 13주 칸의 첫날부터. 그 앞 자료는 쓰지 않는다.
const first = () => weeks[0].start;
const inView = (e) => e.d >= first() && e.d <= data.until;
// 자동 감지가 시작되는 날(리서치 마감 다음 날). 기간 안일 때만 경계선을 긋는다.
const autoFrom = () => { const d = new Date(Date.parse(`${data.researchUntil}T00:00:00Z`) + 86400000).toISOString().slice(0, 10); return d <= data.until ? d : null; };
const regionList = () => (state.region === "ALL" ? ["KR", "GL"] : [state.region]);
// 안쪽 여백을 뺀 실제 그림 폭
const width = (el) => { const cs = getComputedStyle(el); return Math.max(260, Math.floor(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))); };
const legend = (keys) => keys.map((k) => `<span class="${k}"><i></i>${REGION_LABEL[k]}</span>`).join("");

const md = (day) => day.slice(5).replace("-", ".");
// 사고 하나의 규모 글: 유출과 금액 중 발표된 것
const sizeText = (e) => [hasRec(e) && e.rec ? `유출 ${fmtCount(e.rec)}${e.recUnit || "건"}` : "", knownUsd(e) ? (e.krw ? fmtKrw(e.krw) : fmtUsd(e.usd)) : ""].filter(Boolean).join(", ");
const eventLink = (e) => (e.src[0] ? `<a href="${esc(e.src[0].u)}" target="_blank" rel="noopener">${esc(e.n)}</a>` : esc(e.n));

// 13개 7일 구간 막대(key: "size" 피해 규모 | "count" 건수). 마지막(최근 7일)만 지역 색.
function sparkline(b, key) {
  const max = Math.max(1, ...b.series.map((w) => w[key]));
  const bw = 8, gap = 3, H = 26;
  const bars = b.series.map((w, i) => {
    const h = Math.max(1.5, (w[key] / max) * H);
    const v = key === "size" ? `피해 규모 ${Math.round(w.size)}` : `${w.count}건`;
    return `<rect class="${i === b.series.length - 1 ? `cur ${b.region}` : "past"}" x="${i * (bw + gap)}" y="${(H - h).toFixed(1)}" width="${bw}" height="${h.toFixed(1)}"><title>${md(w.start)}~${md(w.end)} ${v}</title></rect>`;
  }).join("");
  return `<svg class="brief-spark" viewBox="0 0 ${b.series.length * (bw + gap) - gap} ${H}" preserveAspectRatio="none" role="img" aria-label="최근 13개 7일 구간의 ${key === "size" ? "피해 규모" : "사고 건수"}, 마지막이 최근 7일">${bars}</svg>`;
}

// 판정 한 줄: 이름, 단계, 순위, 13구간 막대
const verdict = (b, key) => {
  const isSize = key === "size";
  if (!b.count) return `<div class="vd"><span class="vd-name">${isSize ? "피해 규모" : "사고 수"}</span><span class="na">확인 자료 없음</span></div>`;
  const level = isSize ? b.level : b.countLevel, label = isSize ? b.label : b.countLabel, rank = isSize ? b.rank : b.countRank;
  return `<div class="vd"><span class="vd-name">${isSize ? "피해 규모" : "사고 수"}</span><b class="lv ${level}">${label}</b><span class="rank">13구간 중 <b class="num">${rank}</b>위</span>${sparkline(b, key)}</div>`;
};

// 금전 피해 합계: 모두 원화로 발표됐으면 원화, 아니면 달러(원화는 환산)
function moneyText(b) {
  const paid = b.series.at(-1).events.filter((e) => knownUsd(e));
  if (!paid.length) return "<small>발표 없음</small>";
  return paid.every((e) => e.krw) ? fmtKrw(paid.reduce((t, e) => t + e.krw, 0)) : fmtUsd(b.usd);
}

function briefCard(b) {
  const today = b.today.length ? `오늘(${md(data.until)}) 확인 집계 ${b.today.length}건: ${b.today.slice(0, 4).map(eventLink).join(", ")}${b.today.length > 4 ? ` 외 ${b.today.length - 4}건` : ""}` : `오늘(${md(data.until)}) 확인 자료 없음`;
  return `<article class="brief-card ${b.region}">
    <header><span class="rg ${b.region}">${REGION_LABEL[b.region]}</span><span class="win num">${md(b.start)}~${md(b.end)}</span></header>
    <div class="vds">${verdict(b, "count")}${verdict(b, "size")}</div>
    <div class="brief-body">
      <dl class="brief-nums">
        <div><dt>새 사고</dt><dd class="num">${b.count}<small>건</small></dd></div>
        <div><dt>발표된 유출</dt><dd class="num">${b.rec ? `${fmtCount(b.rec)}<small>건</small>` : "<small>발표 없음</small>"}</dd></div>
        <div><dt>금전 피해</dt><dd class="num">${moneyText(b)}</dd></div>
      </dl>
    </div>
    ${b.top.length ? `<ol class="brief-top">${b.top.map((e) => `<li>${eventLink(e)}<span class="sz num">${esc(sizeText(e))}</span><span class="d num">${md(e.d)}</span></li>`).join("")}</ol>` : '<p class="brief-none">규모가 발표된 사고 없음</p>'}
    <p class="brief-today">${today}</p>
  </article>`;
}

function renderTop() {
  const b = brief(confirmed.filter(inView), data.until);
  const list = regionList();
  $("#inc-range").textContent = `${state.region === "ALL" ? "국내외" : REGION_LABEL[state.region]} 보안 사고, 최근 7일 ${md(b.KR.start)}~${md(b.KR.end)}`;
  $("#inc-title").textContent = `최근 7일 확인 집계, ${list.map(region => b[region].count ? `${REGION_LABEL[region]} ${b[region].count}건` : `${REGION_LABEL[region]} 확인 자료 없음`).join(", ")}`;
  const brief1 = $("#inc-brief");
  brief1.classList.toggle("single", list.length === 1);
  brief1.innerHTML = list.map((r) => briefCard(b[r])).join("");
  $("#inc-rule").textContent = `리서치 확인은 ${data.researchUntil}까지. DeFiLlama 집계 포함. 순위는 최근 7일을 앞선 12개 구간과 비교합니다.`;
}

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

function renderPress() {
  const cutoff = Date.now() - 7 * 86400000;
  const items = news.items.filter((i) => i.c === "incident" && regionList().includes(i.r) && Date.parse(i.d) >= cutoff && !isDeniedIncidentTitle(i.t));
  const stories = groupStories(items).sort((a, b) => b.sources - a.sources || b.last.localeCompare(a.last)).slice(0, 8);
  $("#inc-press").innerHTML = stories.length ? stories.map((s) => `<li>${headlineLink(s.lead)}<p class="meta"><span class="rg ${s.r}">${s.r === "KR" ? "국내" : "해외"}</span>${s.sources}개 매체, ${s.count}건, 최근 ${fmtKst(s.last)}</p></li>`).join("") : '<li class="empty">최근 7일 기사 없음</li>';
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

export async function initIncidents() {
  try {
    [data, news] = await Promise.all([loadJson("data/incident-events.json"), loadJson("data/news.json").catch(() => ({ items: [] }))]);
  } catch (error) {
    $("#status-text").textContent = "데이터를 불러오지 못함";
    $("#inc-brief").innerHTML = `<p class="empty">${esc(error.message)}</p>`;
    return;
  }
  weeks = weeksEnding(data.until, 13);
  confirmed = data.events.filter(event => !isIncidentCandidate(event));
  candidates = data.events.filter(isIncidentCandidate);
  const r = new URLSearchParams(location.search).get("r");
  if (r === "KR" || r === "GL") {
    state.region = r;
    document.querySelectorAll("#inc-region button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.region === r)));
  }
  $("#status-text").textContent = `사건 자료 ${fmtKst(data.updatedAt)} KST`;
  $("#inc-notes").textContent = `리서치 확인은 ${data.researchUntil}까지입니다. 보도 수집과 제목 자동 감지는 보도 후보로 표시합니다. 출처는 사고 리서치 원문, 공개 보도, DeFiLlama(1천만 달러 이상 가상자산 해킹), ransomware.live(유출 사이트 공개일 기준)입니다.`;
  bind();
  render();
}
