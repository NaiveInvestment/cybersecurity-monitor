import { fmtKst, loadJson } from "./common.js";
import { currentMarketActivity, marketMonthRanges, marketRangeStart } from "./lib/market-activity.js";

const panel = document.querySelector("#domestic-market");
let data, range = "3M", points = [], selected, current;

const figures = [
  { key: "cap", unit: "조원", scale: 10000 },
  { key: "turnover", unit: "억원", scale: 1 },
];
const number = (n, digits) => n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const fmt = value => value == null ? "-" : value >= 10000
  ? `${number(value / 10000, 2)}조원` : `${number(value, 2)}억원`;

function drawChart({ key, unit, scale }, width) {
  const bars = key === "turnover";
  const label = bars ? "일별 거래대금" : "합산 시총";
  const singlePoint = points.length === 1;
  const widthPx = Math.max(260, width);
  const height = 92, left = 48, right = 9, top = 9, bottom = 18;
  const plotWidth = widthPx - left - right, plotHeight = height - top - bottom;
  const values = points.map(p => p[key] == null ? null : p[key] / scale);
  const valid = values.filter(Number.isFinite);
  const min = valid.length && !bars ? Math.min(...valid) : 0;
  const max = valid.length ? Math.max(...valid) : 1;
  const pad = Math.max((max - min) * .08, max * .02, .01);
  const lo = bars ? 0 : Math.max(0, min - pad), hi = max + pad;
  const step = plotWidth / points.length;
  const x = i => left + (i + .5) * step;
  const y = n => top + (hi - n) * plotHeight / (hi - lo);
  const ticks = [hi, (lo + hi) / 2, lo].map(t => `<line x1="${left}" y1="${y(t)}" x2="${widthPx-right}" y2="${y(t)}" class="chart-grid"/><text x="${left-5}" y="${y(t)+3}" text-anchor="end">${number(t, bars ? 0 : 2)}</text>`).join("");
  let previous = false;
  const geometry = values.map((value, i) => {
    if (value == null) { previous = false; return ""; }
    if (bars) {
      const w = singlePoint ? 40 : Math.max(1, step * .72);
      return `<rect x="${x(i)-w/2}" y="${y(value)}" width="${w}" height="${y(0)-y(value)}"${points[i].live ? " data-live" : ""}/>`;
    }
    const command = previous ? "L" : "M";
    previous = true;
    return `${command}${x(i).toFixed(2)},${y(value).toFixed(2)}`;
  }).join(" ");
  const first = points[0].date.slice(5), last = points.at(-1).date.slice(5);
  const latest = points.length - 1;
  const marker = !bars && (singlePoint || points[latest].live) && values[latest] != null
    ? `<circle cx="${x(latest)}" cy="${y(values[latest])}" r="3" fill="var(--brand)"/>` : "";
  const dates = singlePoint
    ? `<text x="${x(0)}" y="${height-3}" text-anchor="middle">${last}</text>`
    : `<text x="${left}" y="${height-3}">${first}</text><text x="${widthPx-right}" y="${height-3}" text-anchor="end">${last}</text>`;
  return `<figure class="activity-figure" data-metric="${key}">
    <figcaption>${label} <small>${unit}</small><strong data-activity-value="${key}"></strong></figcaption>
    <svg class="activity-chart ${bars ? "activity-bars" : "activity-line"}" viewBox="0 0 ${widthPx} ${height}" tabindex="0" role="img" aria-label="${label}, 방향키로 거래일 조회" data-plot-start="${left}" data-plot-width="${plotWidth}" data-view-width="${widthPx}">
      ${ticks}${bars ? geometry : `<path class="activity-trace" d="${geometry}"/>`}
      <line data-activity-cursor stroke="currentColor" y1="${top}" y2="${height-bottom}"/>
      ${marker}${dates}
    </svg>
  </figure>`;
}

function showPoint(index) {
  if (!points.length || !panel.querySelector("[data-activity-date]")) return;
  selected = Math.max(0, Math.min(index, points.length-1));
  const point = points[selected];
  panel.querySelector("[data-activity-date]").textContent = `${point.date}, ${point.live ? "잠정" : "마감"}, ${point.listed}/${data.members.length}종목`;
  for (const { key } of figures) {
    panel.querySelector(`[data-activity-value="${key}"]`).textContent = fmt(point[key]);
    const svg = panel.querySelector(`[data-metric="${key}"] svg`);
    const x = Number(svg.dataset.plotStart) + (selected + .5) * Number(svg.dataset.plotWidth) / points.length;
    const cursor = svg.querySelector("[data-activity-cursor]");
    cursor.setAttribute("x1", x);
    cursor.setAttribute("x2", x);
  }
  panel.querySelector(".activity-composition-link").href = `market-composition.html?period=${range}&date=${point.date}`;
}

function showCurrent() {
  const line = panel?.querySelector("[data-activity-live]");
  if (!line) return;
  line.textContent = current?.date > data.bars.at(-1).date
    ? `오늘 시총 ${fmt(current.cap)}, ${fmtKst(current.time, false)} KST` : "";
}

export function updateMarketActivity(stocks) {
  if (!panel) return;
  const next = currentMarketActivity(stocks);
  const changed = next?.date !== current?.date || next?.cap !== current?.cap || next?.turnover !== current?.turnover;
  current = next;
  if (changed) draw();
  else showCurrent();
}

function draw(resetSelection = false) {
  if (!data?.bars.length) return;
  const activeMetric = document.activeElement?.closest("figure.activity-figure")?.dataset.metric;
  const priorDate = selected < points.length - 1 ? points[selected]?.date : null;
  const days = current?.date > data.bars.at(-1).date ? [...data.bars, current] : data.bars;
  const from = marketRangeStart(days.at(-1).date, range);
  points = days.filter(point => point.date >= from);
  panel.querySelector(".activity-figures").innerHTML = figures.map(figure => drawChart(figure, panel.clientWidth - 28)).join("");
  for (const button of panel.querySelectorAll("[data-activity-range]")) {
    button.setAttribute("aria-pressed", String(button.dataset.activityRange === range));
  }
  const preserved = points.findIndex(p => p.date === priorDate);
  showPoint(preserved >= 0 && !resetSelection ? preserved : points.length - 1);
  showCurrent();
  if (activeMetric) panel.querySelector(`[data-metric="${activeMetric}"] svg`)?.focus({ preventScroll: true });
}

export function startMarketActivity(url) {
  if (!panel || !url) return;
  panel.addEventListener("click", event => {
    const button = event.target.closest("[data-activity-range]");
    if (!button) return;
    range = button.dataset.activityRange;
    draw(true);
  });
  panel.addEventListener("pointermove", event => {
    const svg = event.target.closest("svg.activity-chart");
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * Number(svg.dataset.viewWidth) / bounds.width;
    const ratio = (x - Number(svg.dataset.plotStart)) / Number(svg.dataset.plotWidth);
    showPoint(Math.floor(ratio * points.length));
  });
  panel.addEventListener("keydown", event => {
    if (!event.target.matches("svg.activity-chart") || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    showPoint(selected + (event.key === "ArrowRight" ? 1 : -1));
  });
  loadJson(url).then(result => {
    if (!result.bars?.length) return;
    data = result;
    panel.innerHTML = `<header class="activity-head"><h2>국내 보안주 추이</h2>
      <div class="seg-switch" role="group" aria-label="일봉 조회 기간">${Object.keys(marketMonthRanges).map(period => `<button type="button" data-activity-range="${period}">${period}</button>`).join("")}</div>
      </header>
      <div class="activity-meta"><span data-activity-date></span><span data-activity-live></span></div>
      <div class="activity-figures"></div>
      <a class="activity-composition-link" href="market-composition.html" ${result.bars.some(point => point.constituents) ? "" : "hidden"}>시총 구성 페이지 <span aria-hidden="true">↗</span></a>
      <details class="activity-method"><summary>자료와 계산 기준</summary>
      <p>과거 시총은 현재 시총과 현재가로 역산한 주식수에 키움 KRX 수정 종가를 곱한 추정치입니다. 과거 거래대금은 키움 KRX와 NXT의 통합 실측치입니다. 오늘은 위 카드와 같은 시세의 시총과 네이버 통합 누적 거래대금을 잠정값으로 표시합니다. 거래대금이 빠진 날은 합계를 비웁니다.</p></details>`;
    panel.hidden = false;
    draw();
    // The relative chart measured its container before the grid became two columns.
    window.dispatchEvent(new Event("resize"));
  }).catch(() => { /* Leave the panel hidden if the history is unavailable. */ });
  window.addEventListener("resize", () => { if (data) draw(); });
}
