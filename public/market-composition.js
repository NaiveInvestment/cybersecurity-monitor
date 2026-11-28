import { esc, initTheme, loadJson } from "./common.js";
import { marketComposition } from "./lib/market-composition.js";
import { createKosdaqShare } from "./lib/kosdaq-share.js";
import { treemap } from "./lib/treemap.js";
import { currentMarketActivity, marketRangeStart } from "./lib/market-activity.js";
import { startQuoteFeed } from "./lib/quote-feed.js";

const number = value => value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const trillions = value => value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });

const TREND = { height: 420, top: 32, left: 46, right: 44, bottom: 40 };
const TREND_COMPACT = { height: 320, top: 32, left: 43, right: 42, bottom: 40 };
const MAP = { height: 400, compactHeight: 440 };
const SPARK = { width: 120, height: 26, points: 64 };
const STEPS = [.01, .02, .05, .1, .2, .5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
// 누적 그래프에서 따로 색을 주는 기업 수(1년 마감일 평균 시총 순). 나머지는 기타로 묶는다. CSS의 composition-color-0..6이 이 수를 따른다.
const TOP = 7;
// 연간 요약, 기업 색과 표의 작은 추이선은 항상 1년 이력을 사용한다.
const HISTORY_RANGE = "1Y";

function textMeasure(fontFamily) {
  const context = document.createElement("canvas").getContext("2d");
  const cache = new Map();
  return (text, size, weight) => {
    const key = `${weight} ${size} ${text}`;
    if (!cache.has(key)) {
      context.font = `${weight} ${size}px ${fontFamily}`;
      cache.set(key, context.measureText(text).width);
    }
    return cache.get(key);
  };
}

// 월이 바뀌는 첫 거래일에 눈금을 둔다. 월 눈금이 모자라면 주가 바뀌는 첫 거래일에 둔다.
function timeTicks(points, x, compact) {
  const weekday = point => new Date(point.date + "T00:00:00Z").getUTCDay();
  const starts = changed => points.map((point, i) => i && changed(point, points[i - 1]) ? i : 0).filter(Boolean);
  let ticks = starts((point, before) => point.date.slice(0, 7) !== before.date.slice(0, 7));
  const monthly = ticks.length >= 3;
  if (!monthly) ticks = starts((point, before) => weekday(point) < weekday(before));
  const room = ticks.length ? (x(points.length - 1) - x(0)) / ticks.length : 0;
  const every = [1, 2, 3, 4, 6].find(count => room * count >= (compact ? 44 : 52)) ?? 6;
  ticks = ticks.filter((index, order) => monthly ? (Number(points[index].date.slice(5, 7)) - 1) % every === 0 : order % every === 0);
  return ticks.map((index, order) => {
    const date = points[index].date;
    const year = !order || date.slice(0, 4) !== points[ticks[order - 1]].date.slice(0, 4) ? date.slice(0, 4) : "";
    return { index, year, label: monthly ? `${Number(date.slice(5, 7))}월` : `${date.slice(5, 7)}.${date.slice(8)}` };
  });
}

// 시총 추이. stack이 있으면 합계선 아래를 기업별 띠로 쌓아 칠하고(0부터 시작), 없으면 한 계열(고른 종목)의 선을 값 범위에 맞춰 그린다.
// 값이 없는 날은 선과 띠를 끊는다.
function drawTrend(points, values, width, measure, name, { stack = null, tone = "" } = {}) {
  const compact = width < 550;
  const { height, top, right, bottom, ...layout } = compact ? TREND_COMPACT : TREND;
  const present = values.filter(value => value != null);
  const peak = Math.max(0, ...present), trough = present.length ? Math.min(...present) : 0;
  const divisor = peak >= 10000 ? 10000 : 1, unit = divisor > 1 ? "조원" : "억원";
  // 쌓은 띠는 넓이가 곧 값이라 세로축이 0부터여야 한다. 한 계열일 때는 값이 움직인 범위에 위아래 여유를 조금 둔다.
  // 눈금은 그 안의 딱 떨어지는 값에 여섯 개 이하로 둔다.
  const pad = Math.max((peak - trough) * .08, peak * .005, 1e-6);
  const low = stack ? 0 : Math.max(0, trough - pad) / divisor, high = (stack ? peak * 1.05 : peak + pad) / divisor;
  const inside = size => [Math.ceil(low / size - 1e-9), Math.floor(high / size + 1e-9)];
  const step = STEPS.find(size => inside(size)[1] - inside(size)[0] < 6) ?? STEPS.at(-1);
  const marks = Array.from({ length: Math.max(0, inside(step)[1] - inside(step)[0] + 1) }, (_, i) => (inside(step)[0] + i) * step)
    .map(value => ({ value, text: trillions(value) }));
  // 세로축 숫자가 길어지면 왼쪽 여백을 그만큼 넓힌다.
  const left = Math.max(layout.left, Math.ceil(Math.max(0, ...marks.map(mark => measure(mark.text, 11, 400)))) + 11);
  const plotWidth = width - left - right, base = height - bottom;
  const x = index => points.length > 1 ? left + index * plotWidth / (points.length - 1) : left + plotWidth / 2;
  const y = value => base - (value / divisor - low) / (high - low) * (base - top);
  const axis = `<line class="composition-baseline" x1="${left}" x2="${left + plotWidth}" y1="${base}" y2="${base}"/>` + marks.map(mark => {
    const py = y(mark.value * divisor).toFixed(2);
    return `<line class="chart-grid" x1="${left}" x2="${left + plotWidth}" y1="${py}" y2="${py}"/>
      <text class="composition-tick" x="${left - 7}" y="${py}" text-anchor="end" dominant-baseline="central">${mark.text}</text>`;
  }).join("");
  const dates = timeTicks(points, x, compact).map(({ index, year, label }) => {
    const half = Math.max(measure(label, 11, 400), measure(year, 11, 400)) / 2;
    const px = Math.max(half + 1, Math.min(x(index), width - half - 2)).toFixed(2);
    return `<line class="composition-baseline" x1="${x(index).toFixed(2)}" x2="${x(index).toFixed(2)}" y1="${base}" y2="${base + 4}"/>
      <text class="composition-tick" x="${px}" y="${base + 17}" text-anchor="middle">${label}</text>
      ${year ? `<text class="composition-tick composition-year" x="${px}" y="${base + 33}" text-anchor="middle">${year}</text>` : ""}`;
  }).join("");
  const spans = [];
  values.forEach((value, index) => {
    if (value == null) return;
    if (values[index - 1] == null) spans.push([]);
    spans.at(-1).push([x(index).toFixed(2), y(value).toFixed(2)]);
  });
  const line = spans.map(span => "M" + span.map(pair => pair.join(",")).join("L")).join("");
  const area = spans.map(span => `M${span[0][0]},${base}L${span.map(pair => pair.join(",")).join("L")}L${span.at(-1)[0]},${base}Z`).join("");
  const spot = index => ({ x: x(index), y: values[index] == null ? null : y(values[index]) });
  let bands = "";
  if (stack) {
    const floor = values.map(() => 0);
    for (const layer of stack) {
      const runs = [];
      layer.values.forEach((value, index) => {
        if (value == null) return;
        if (layer.values[index - 1] == null) runs.push([]);
        runs.at(-1).push([x(index).toFixed(2), y(floor[index]).toFixed(2), y(floor[index] + value).toFixed(2)]);
        floor[index] += value;
      });
      const d = runs.map(run => "M" + run.map(([px, , upper]) => `${px},${upper}`).join("L") + "L" + [...run].reverse().map(([px, lower]) => `${px},${lower}`).join("L") + "Z").join("");
      bands += `<path class="composition-band composition-color-${layer.slot}" data-compose-band="${esc(layer.code)}" d="${d}"/>`;
    }
  }
  const tag = Math.ceil(measure("2026-00-00", 11, 700)) / 2 + 7;
  const html = `<svg class="composition-chart${compact ? " compact" : ""}" viewBox="0 0 ${width} ${height}" tabindex="0" role="img"
    aria-label="${esc(name)} 시가총액 추이${stack ? "와 기업별 구성" : ""}, ${unit}. 방향키로 조회일 이동"
    data-plot-start="${left}" data-plot-width="${plotWidth}" data-view-width="${width}"
    data-plot-top="${top}" data-plot-base="${base}" data-axis-low="${low * divisor}" data-axis-high="${high * divisor}">
    ${axis}${dates}
    ${stack ? bands : `<path class="composition-area${tone}" d="${area}"/>`}
    <path class="composition-line${stack ? " total" : tone}" d="${line}"/>
    <line data-composition-cursor x1="0" x2="0" y1="${top - 8}" y2="${base}"/>
    <circle class="composition-dot" data-composition-dot r="4"/>
    <g data-composition-tag data-half="${tag}" aria-hidden="true">
      <rect x="${-tag}" y="${top - 27}" width="${tag * 2}" height="19" rx="4"/>
      <text y="${top - 17.5}" text-anchor="middle" dominant-baseline="central"></text>
    </g>
  </svg>`;
  return { html, spot, unit };
}

// 칸 크기에 따라 고르는 글자 단계. min은 이름만, full은 비중까지, deep은 시총까지 적는 데 필요한 칸 높이다.
const TIERS = [
  { kind: "large", size: 15, weight: 700, pad: 9, name: 22, min: 30, percent: 42, percentSize: 13, percentWeight: 700, full: 51, detail: 60, deep: 69 },
  { kind: "medium", size: 12, weight: 700, pad: 5, name: 16, min: 21, percent: 32, percentSize: 11, percentWeight: 600, full: 38 },
  { kind: "small", size: 11, weight: 600, pad: 4, name: 12.5, min: 17, percent: 27, percentSize: 10, percentWeight: 600, full: 33 },
  { kind: "tiny", size: 10, weight: 600, pad: 3, name: 11, min: 15 },
];

const WRAPS = [
  { kind: "small", size: 11, pad: 4, name: 12.5, gap: 15.5, min: 33 },
  { kind: "tiny", size: 10, pad: 3, name: 11, gap: 14, min: 29 },
];

// 조회일의 구성: 넓이는 그날의 시총이고 색은 누적 그래프와 같은 기업 색이다. 이름은 칸에 들어갈 때만 적는다.
function drawMap(tiles, width, measure) {
  const height = width < 550 ? MAP.compactHeight : MAP.height;
  const rects = treemap(tiles.map(tile => tile.cap), width, height);
  const body = tiles.map((tile, i) => {
    const rect = rects[i];
    if (!rect) return "";
    const x = rect.x + 1, y = rect.y + 1, w = Math.max(.5, rect.width - 2), h = Math.max(.5, rect.height - 2);
    const percent = `${number(tile.weight)}%`, detail = `${number(tile.cap)}억원`;
    const fits = (text, size, weight, pad) => measure(text, size, weight) + pad * 2 <= w;
    const text = (kind, dx, dy, value) => `<text class="composition-tile-${kind}" x="${(x + dx).toFixed(2)}" y="${(y + dy).toFixed(2)}">${esc(value)}</text>`;
    let labels = "";
    const tier = TIERS.find(item => h >= item.min && fits(tile.name, item.size, item.weight, item.pad));
    if (h >= 150 && w >= 230) {
      labels = text("name huge", 12, 30, tile.name) + text("percent huge", 12, 55, percent) + text("detail", 12, 76, detail);
    } else if (tier) {
      labels = text(`name ${tier.kind}`, tier.pad, tier.name, tile.name);
      if (h >= tier.full && fits(percent, tier.percentSize, tier.percentWeight, tier.pad)) {
        labels += text(`percent ${tier.kind}`, tier.pad, tier.percent, percent);
        if (h >= tier.deep && fits(detail, 11, 400, tier.pad)) labels += text("detail", tier.pad, tier.detail, detail);
      }
    } else if (tile.name.length >= 4) {
      // 좁고 긴 칸은 이름을 두 줄로 나눠 적는다.
      const cut = Math.ceil(tile.name.length / 2), parts = [tile.name.slice(0, cut), tile.name.slice(cut)];
      const wrap = WRAPS.find(item => h >= item.min && parts.every(part => fits(part, item.size, 600, item.pad)));
      if (wrap) labels = parts.map((part, line) => text(`name ${wrap.kind}`, wrap.pad, wrap.name + line * wrap.gap, part)).join("");
    }
    const spoken = `${tile.name}, 시총 ${detail}, 비중 ${percent}`;
    return `<g class="composition-tile composition-color-${tile.slot}" data-compose-tile="${esc(tile.code)}" data-named="${labels ? 1 : 0}"
      tabindex="0" role="button" aria-pressed="false" aria-label="${esc(spoken)}">
      <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="3"/>${labels}</g>`;
  }).join("");
  return `<svg class="composition-map" viewBox="0 0 ${width} ${height}" role="group" aria-label="조회일 종목별 시가총액 구성. 넓이는 시총">${body}</svg>`;
}

// 종목 하나의 1년 시총 추이를 표 칸에 넣을 작은 선으로 만든다. 세로는 그 종목의 최저와 최고에 맞춘다.
function sparkline(series) {
  const present = series.filter(value => value != null);
  const low = Math.min(...present), high = Math.max(...present);
  const x = index => 3 + (series.length > 1 ? index / (series.length - 1) : .5) * (SPARK.width - 6);
  const y = value => SPARK.height - 4 - (high > low ? (value - low) / (high - low) : .5) * (SPARK.height - 8);
  const stride = Math.max(1, Math.ceil(series.length / SPARK.points));
  let path = "", open = false;
  series.forEach((value, index) => {
    if (value == null) { open = false; return; }
    if (open && index % stride && index !== series.length - 1 && series[index + 1] != null) return;
    path += `${open ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
    open = true;
  });
  return { path, x, y, label: present.length ? `1년 최저 ${number(low)}억원, 최고 ${number(high)}억원` : "자료 없음" };
}

function createMarketComposition(root, onSelection, market, kosdaqMembers, sectorCaps) {
  const kosdaq = createKosdaqShare(root.querySelector("[data-compose-kosdaq]"), market, kosdaqMembers, sectorCaps);
  const chart = root.querySelector("[data-compose-chart]");
  const map = root.querySelector("[data-compose-map]");
  const title = root.querySelector("[data-compose-trend-title]");
  const note = root.querySelector("[data-compose-readout]");
  const clear = root.querySelector("[data-compose-clear]");
  const body = root.querySelector("tbody");
  const result = root.querySelector("[data-compose-result]");
  const headline = root.querySelector("[data-compose-status]");
  const total = root.querySelector("[data-compose-total]");
  const highest = root.querySelector("[data-compose-high]");
  const lowest = root.querySelector("[data-compose-low]");
  const dateInput = root.querySelector("[data-compose-date]");
  const periods = [...root.querySelectorAll("[data-compose-period]")];
  const periodLabel = root.querySelector("[data-compose-period-label]");
  let period = HISTORY_RANGE, firstVisible = 0;
  const keys = root.querySelector("[data-compose-keys]");
  // selected는 화면에 보이는 날짜, committed는 고정된 조회일이다. 마우스를 올린 동안만 둘이 달라진다.
  // model은 따로 색을 주는 상위 기업과 기타의 날짜별 시총, slots는 상위 기업의 색 번호다.
  let points, members, names, selected, committed, ready = false, highlighted, hovered, trend, measure, model;
  let details = new Map(), sparks = new Map(), slots = new Map();
  const label = code => code === "other" ? "기타" : names.get(code) ?? code;
  const slotOf = code => slots.get(code) ?? "other";
  // 범례의 기타와 상위 기업이 아닌 종목은 서로 짝이다.
  const paired = (code, target) => code === target || (target === "other" && !slots.has(code)) || (code === "other" && !slots.has(target));

  function mark() {
    for (const node of root.querySelectorAll("[data-compose-tile], tr[data-compose-group], [data-compose-key], [data-compose-band]")) {
      const band = node.dataset.composeBand;
      const code = node.dataset.composeTile ?? node.dataset.composeGroup ?? node.dataset.composeKey ?? band;
      // 띠는 마우스를 올린 기업만 남기고 흐리게, 칸과 행과 범례는 고정한 기업만 남기고 흐리게 한다.
      const focus = band ? hovered : highlighted;
      node.classList.toggle("dimmed", Boolean(focus && !paired(code, focus)));
      if (!band) node.classList.toggle("hot", Boolean(hovered && paired(code, hovered)));
      if (node.dataset.composeTile || node.dataset.composeKey) node.setAttribute("aria-pressed", String(code === highlighted));
    }
  }

  function describe() {
    const item = details.get(hovered ?? highlighted);
    // 단추는 다시 그리지 않는다. 누르는 도중에 설명 줄이 바뀌어도 단추가 그대로 있어야 눌린다.
    clear.hidden = !highlighted;
    note.innerHTML = item
      ? `<strong>${esc(item.name)}</strong><span>시총 ${number(item.cap)}억원</span><span>비중 ${number(item.weight)}%</span>`
      : `<span class="composition-hint">칸이나 표의 행을 누르면 그 종목의 추이를 봅니다.</span>`;
  }

  function spark(code) {
    if (!sparks.has(code)) sparks.set(code, sparkline(points.map(point => point.constituents?.[code] ?? null)));
    const { path, x, y, label: spoken } = sparks.get(code), value = points[selected].constituents?.[code];
    return `<svg class="composition-spark" viewBox="0 0 ${SPARK.width} ${SPARK.height}" role="img" aria-label="${spoken}"><path d="${path}"/>
      ${value == null ? "" : `<circle cx="${x(selected).toFixed(1)}" cy="${y(value).toFixed(1)}" r="2.4"/>`}</svg>`;
  }

  function show(index) {
    selected = Math.max(firstVisible, Math.min(index, points.length - 1));
    if (root.hidden || !ready) return;
    const point = points[selected];
    kosdaq.select(selected - firstVisible);
    const svg = chart.querySelector("svg");
    const tag = svg.querySelector("[data-composition-tag]"), dot = svg.querySelector("[data-composition-dot]");
    const half = Number(tag.dataset.half), spot = trend.spot(selected - firstVisible);
    svg.querySelector("[data-composition-cursor]").setAttribute("transform", `translate(${spot.x} 0)`);
    tag.setAttribute("transform", `translate(${Math.max(half + 1, Math.min(spot.x, Number(svg.dataset.viewWidth) - half - 1))} 0)`);
    tag.querySelector("text").textContent = point.date;
    dot.setAttribute("visibility", spot.y == null ? "hidden" : "visible");
    dot.setAttribute("cx", spot.x);
    dot.setAttribute("cy", spot.y ?? 0);
    if (document.activeElement !== dateInput) dateInput.value = point.date;
    headline.textContent = point.live ? "당일 합산 시총 (잠정)" : "조회일 합산 시총 (추정)";
    details = new Map();
    const amounts = model.amounts[selected];
    if (!amounts) {
      total.textContent = "–";
      result.textContent = `${point.date} 시총 자료 없음`;
      body.innerHTML = "<tr><td colspan='4'>집계 가능한 시총이 없습니다.</td></tr>";
      map.innerHTML = "";
      describe();
      return;
    }
    const weight = cap => point.cap > 0 ? cap / point.cap * 100 : 0;
    // 시총이 큰 순서로 놓아야 칸이 정사각형에 가까워져 이름이 들어갈 자리가 생긴다.
    const tiles = members.map(code => {
      const cap = point.constituents[code] ?? 0;
      return { code, name: label(code), cap, weight: weight(cap), slot: slotOf(code) };
    }).filter(tile => tile.cap > 0).sort((a, b) => b.cap - a.cap || a.code.localeCompare(b.code));
    for (const tile of tiles) details.set(tile.code, tile);
    details.set("other", { name: label("other"), cap: amounts.at(-1), weight: weight(amounts.at(-1)) });
    // 범례에는 그날의 비중을 적는다.
    keys.querySelectorAll("[data-compose-key]").forEach((node, i) => { node.querySelector("b").textContent = `${number(weight(amounts[i]))}%`; });
    const activeTile = map.contains(document.activeElement) ? document.activeElement.dataset.composeTile : null;
    map.innerHTML = drawMap(tiles, Math.max(260, map.clientWidth), measure);
    if (activeTile) [...map.querySelectorAll("[data-compose-tile]")].find(node => node.dataset.composeTile === activeTile)?.focus({ preventScroll: true });
    total.innerHTML = `${trillions(point.cap / 10000)}<small>조원</small>`;
    result.textContent = `${point.date} 기준 ${tiles.length}개 종목`;
    const widest = tiles[0]?.weight || 1;
    body.innerHTML = tiles.map(({ code, name, cap, weight }) => `<tr data-compose-group="${esc(code)}" data-cap="${cap}" data-weight="${weight}">
        <th scope="row"><i class="composition-chip composition-color-${slotOf(code)}"></i>${esc(name)}</th>
        <td>${number(cap)}</td>
        <td><span class="composition-share"><svg viewBox="0 0 100 8" class="composition-meter" aria-hidden="true"><rect x="0" y="1" width="${(weight / widest * 100).toFixed(1)}" height="6" rx="2"/></svg><b>${number(weight)}%</b></span></td>
        <td class="composition-spark-cell">${spark(code)}</td>
      </tr>`).join("");
    mark();
    describe();
  }

  function commit(index) {
    show(index);
    committed = selected;
    if (!root.hidden && ready) onSelection(points[selected].date);
  }

  function paintTrend() {
    const hadFocus = chart.contains(document.activeElement);
    const visible = points.slice(firstVisible);
    const amounts = model.amounts.slice(firstVisible);
    const pick = group => amounts.map(amounts => amounts ? amounts[group] : null);
    const values = visible.map((point, i) => !amounts[i] ? null
      : !highlighted ? point.cap : highlighted === "other" ? amounts[i].at(-1) : point.constituents[highlighted] ?? null);
    const name = highlighted ? label(highlighted) : "합계";
    // 고른 종목이 없으면 합계선 아래에 상위 기업을 큰 순서로 아래부터 쌓고 기타를 맨 위에 둔다.
    const stack = highlighted ? null : model.groups.map((code, group) => ({ code, slot: slotOf(code), values: pick(group) }));
    const tone = highlighted && (highlighted === "other" || slots.has(highlighted)) ? ` composition-color-${slotOf(highlighted)}` : "";
    trend = drawTrend(visible, values, Math.max(260, chart.clientWidth), measure, name, { stack, tone });
    chart.innerHTML = trend.html;
    const { plotStart, plotWidth, viewWidth } = chart.querySelector("svg").dataset;
    const ticks = timeTicks(visible, i => trend.spot(i).x, Number(viewWidth) < 550);
    kosdaq.render(visible, { ticks, width: Number(viewWidth), left: Number(plotStart),
      right: Number(plotStart) + Number(plotWidth), spot: trend.spot });
    title.textContent = highlighted ? `${name} 시가총액 (${trend.unit})` : `합계 시가총액과 기업별 구성 (${trend.unit})`;
    if (hadFocus) chart.querySelector("svg").focus({ preventScroll: true });
  }

  function applyPeriod() {
    const cutoff = marketRangeStart(points.at(-1).date, period);
    firstVisible = points.findIndex(point => point.date >= cutoff);
    dateInput.min = points[firstVisible].date;
    for (const button of periods) {
      const active = button.dataset.composePeriod === period;
      button.setAttribute("aria-pressed", String(active));
      if (active) periodLabel.textContent = "최근 " + button.textContent;
    }
  }

  for (const button of periods) {
    button.addEventListener("click", () => {
      if (!ready || period === button.dataset.composePeriod) return;
      period = button.dataset.composePeriod;
      applyPeriod();
      paintTrend();
      commit(committed);
    });
  }

  function render() {
    if (root.hidden || !points?.length) return;
    model = marketComposition(points, members, TOP);
    ready = Boolean(model);
    const days = points.filter((point, i) => model?.amounts[i]);
    if (!ready) {
      keys.innerHTML = "";
      chart.innerHTML = "";
      map.innerHTML = "";
      body.innerHTML = "";
      note.textContent = "";
      clear.hidden = true;
      result.textContent = "조회 기간의 구성 자료가 없습니다.";
      return;
    }
    applyPeriod();
    dateInput.max = points.at(-1).date;
    // 1년 동안 합산 시총이 가장 컸던 날과 가장 작았던 날
    const stat = (node, day) => { node.innerHTML = `${trillions(day.cap / 10000)}<small>조원</small><small class="composition-when">${day.date}</small>`; };
    stat(highest, days.reduce((best, day) => day.cap > best.cap ? day : best));
    stat(lowest, days.reduce((best, day) => day.cap < best.cap ? day : best));
    if (highlighted && highlighted !== "other" && !members.includes(highlighted)) highlighted = null;
    slots = new Map(model.groups.slice(0, -1).map((code, slot) => [code, slot]));
    // 범례는 다시 그리지 않고 값만 바꾼다(누르는 도중에 단추가 사라지지 않게). 기업 구성이 바뀔 때만 새로 만든다.
    if (keys.dataset.groups !== model.groups.join()) {
      keys.dataset.groups = model.groups.join();
      keys.innerHTML = model.groups.map(code => `<button type="button" class="composition-key composition-color-${slotOf(code)}" data-compose-key="${esc(code)}" aria-pressed="false">
        <i></i><span>${esc(label(code))}</span><b class="num"></b></button>`).join("");
    }
    measure ??= textMeasure(getComputedStyle(chart).fontFamily);
    sparks = new Map();
    paintTrend();
    commit(selected);
  }

  function toggle(code) {
    if (!ready || !code) return;
    highlighted = code === highlighted ? null : code;
    paintTrend();
    show(selected);
  }
  function hover(code) {
    if (code === hovered) return;
    hovered = code;
    mark();
    describe();
  }
  const tileOf = event => event.target.closest?.("[data-compose-tile]")?.dataset.composeTile ?? null;
  const rowOf = event => event.target.closest?.("tr[data-compose-group]")?.dataset.composeGroup ?? null;
  map.addEventListener("click", event => toggle(tileOf(event)));
  map.addEventListener("keydown", event => {
    if (!["Enter", " "].includes(event.key) || !tileOf(event)) return;
    event.preventDefault();
    toggle(tileOf(event));
  });
  map.addEventListener("pointerover", event => hover(tileOf(event)));
  map.addEventListener("pointerleave", () => hover(null));
  map.addEventListener("focusin", event => hover(tileOf(event)));
  map.addEventListener("focusout", () => hover(null));
  body.addEventListener("click", event => toggle(rowOf(event)));
  body.addEventListener("pointerover", event => hover(rowOf(event)));
  body.addEventListener("pointerleave", () => hover(null));
  const keyOf = event => event.target.closest?.("[data-compose-key]")?.dataset.composeKey ?? null;
  keys.addEventListener("click", event => toggle(keyOf(event)));
  keys.addEventListener("pointerover", event => hover(keyOf(event)));
  keys.addEventListener("pointerleave", () => hover(null));
  keys.addEventListener("focusin", event => hover(keyOf(event)));
  keys.addEventListener("focusout", () => hover(null));
  clear.addEventListener("click", () => toggle(highlighted));

  dateInput.addEventListener("change", () => {
    if (!ready) return;
    commit(points.findLastIndex(point => point.date <= dateInput.value));
    dateInput.value = points[selected].date;
  });
  function indexAt(event) {
    const svg = chart.querySelector("svg");
    if (!svg || !ready) return null;
    const bounds = svg.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * Number(svg.dataset.viewWidth) / bounds.width;
    return firstVisible + Math.round((x - Number(svg.dataset.plotStart)) / Number(svg.dataset.plotWidth) * (points.length - 1 - firstVisible));
  }
  // 마우스를 올리면 그 날짜의 구성을 미리 보고, 누르거나 끌면 조회일로 고정한다. 그래프를 벗어나면 고정한 날짜로 돌아간다.
  for (const target of [chart, kosdaq.chart]) {
    target.addEventListener("pointermove", event => {
      const index = indexAt(event);
      if (index == null) return;
      if (event.pointerType === "mouse" && !event.buttons) show(index);
      else commit(index);
    });
    target.addEventListener("pointerleave", () => { if (ready && selected !== committed) show(committed); });
    target.addEventListener("click", event => {
      const index = indexAt(event);
      if (index != null) commit(index);
    });
    target.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !ready) return;
      event.preventDefault();
      commit(committed + (event.key === "ArrowRight" ? 1 : -1));
    });
  }

  return {
    update(nextPoints, nextMembers, nextNames, nextSelected) {
      points = nextPoints;
      members = nextMembers;
      names = nextNames;
      selected = committed = nextSelected;
      render();
    },
  };
}

async function main() {
  initTheme();
  const root = document.querySelector("#market-composition");
  const status = document.querySelector("#composition-status");
  let selection = new URLSearchParams(location.search).get("date"), endDate, current, history, stocks, meta, kosdaqMarket, sectorCaps;
  try {
    const [config, snapshot] = await Promise.all([loadJson("data/meta.json"), loadJson("data/snapshot.json")]);
    meta = config;
    stocks = snapshot.stocks;
    const local = meta.live?.url === "live.json";
    const marketPath = meta.kosdaqMarket ?? (local ? "data/kosdaq-market.json" : null);
    const sectorPath = meta.kosdaqSectorCaps ?? (local ? "data/kosdaq-sector-caps.json" : null);
    [history, kosdaqMarket, sectorCaps] = await Promise.all([
      meta.domesticMarket ? loadJson(meta.domesticMarket) : null,
      marketPath ? loadJson(marketPath).catch(() => null) : null,
      sectorPath ? loadJson(sectorPath).catch(() => null) : null,
    ]);
    if (!history?.bars.some(day => day.constituents)) throw new Error("composition unavailable");
  } catch {
    status.textContent = "시총 구성 자료를 불러올 수 없습니다.";
    return;
  }
  const names = new Map(stocks.filter(stock => stock.kind === "KR").map(stock => [stock.code ?? stock.id, stock.name]));
  const kosdaqMembers = new Set(stocks.filter(stock => stock.kind === "KR" &&
    stock.market === "KOSDAQ").map(stock => stock.code ?? stock.id));
  const composition = createMarketComposition(root, date => { selection = date; }, kosdaqMarket, kosdaqMembers, sectorCaps);

  function draw() {
    const last = history.bars.at(-1);
    const points = current?.date > last.date ? [...history.bars, current] : history.bars;
    const end = points.at(-1).date;
    const start = marketRangeStart(end, HISTORY_RANGE);
    const visible = points.filter(point => point.date >= start);
    const index = selection && selection !== endDate ? visible.findIndex(point => point.date === selection) : -1;
    endDate = end;
    composition.update(visible, history.members, names, index < 0 ? visible.length - 1 : index);
  }

  function update(quotes) {
    const rows = stocks.map(stock => {
      const row = quotes?.[stock.id];
      if (!row || !Number.isFinite(Date.parse(row[5])) || Date.parse(row[5]) < Date.parse(stock.q?.at)) return stock;
      const [p, chg, cap, capKrw, tv, at, st] = row;
      return { ...stock, q: { p, chg, cap, capKrw, tv, at, st } };
    });
    const next = currentMarketActivity(rows);
    if (next?.date === current?.date && next?.cap === current?.cap &&
        Object.entries(next?.constituents ?? {}).every(([code, cap]) => current?.constituents?.[code] === cap)) return;
    current = next;
    draw();
  }
  current = currentMarketActivity(stocks);
  status.hidden = true;
  root.hidden = false;
  draw();
  let frame;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  });
  startQuoteFeed(meta.live, { onQuotes: payload => update(payload.q), onRelayLost: payload => update(payload?.q) });
}

main();
