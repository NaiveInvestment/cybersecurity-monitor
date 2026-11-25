import { esc, initTheme, loadJson, signClass } from "./common.js";
import { marketComposition } from "./lib/market-composition.js";
import { treemap } from "./lib/treemap.js";
import { currentMarketActivity, marketRangeStart } from "./lib/market-activity.js";
import { startQuoteFeed } from "./lib/quote-feed.js";

const number = value => value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const trillions = value => value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
const signed = value => value == null ? "–" : Math.abs(value) < .05 ? "0" : (value > 0 ? "+" : "") + number(value);

const TREND = { height: 200, top: 32, left: 46, right: 16, bottom: 40 };
const TREND_COMPACT = { height: 170, top: 32, left: 38, right: 12, bottom: 40 };
const MAP = { height: 400, compactHeight: 440 };
const STEPS = [.01, .02, .05, .1, .2, .5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
// 증감률 색 단계의 경계(%). 범례 문구와 CSS의 composition-heat 단계가 이 값을 따른다.
const HEAT = [2, 10, 30];
// 화면은 늘 최근 1년을 보여 준다. 비교일 빠른 선택은 조회일에서 이만큼 앞선 날짜다(전일은 직전 거래일, 1주는 7일 전).
const RANGE = "1Y";
const PRESETS = { day: null, week: null, month: "1M", quarter: "3M", half: "6M", year: "1Y" };
const PERIOD_PRESETS = { "1M": "month", "3M": "quarter", "6M": "half", "1Y": "year" };
function presetDate(preset, date) {
  if (PRESETS[preset]) return marketRangeStart(date, PRESETS[preset]);
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 7);
  return day.toISOString().slice(0, 10);
}

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

// 월이 바뀌는 첫 거래일에 눈금을 둔다. 한 달 조회처럼 월 눈금이 모자라면 주가 바뀌는 첫 거래일에 둔다.
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

// 한 계열(합계 또는 고른 종목)의 시총 추이. 값이 없는 날은 선을 끊는다.
function drawTrend(points, values, width, measure, name) {
  const compact = width < 550;
  const { height, top, right, bottom, ...layout } = compact ? TREND_COMPACT : TREND;
  const present = values.filter(value => value != null);
  const peak = Math.max(0, ...present), trough = present.length ? Math.min(...present) : 0;
  const divisor = peak >= 10000 ? 10000 : 1, unit = divisor > 1 ? "조원" : "억원";
  // 세로축은 0부터가 아니라 값이 움직인 범위에 위아래 여유를 조금 둔 구간이다. 눈금은 그 안의 딱 떨어지는 값에 여섯 개(좁은 화면 다섯 개) 이하로 둔다.
  const pad = Math.max((peak - trough) * .08, peak * .005, 1e-6);
  const low = Math.max(0, trough - pad) / divisor, high = (peak + pad) / divisor;
  const inside = size => [Math.ceil(low / size - 1e-9), Math.floor(high / size + 1e-9)];
  const step = STEPS.find(size => inside(size)[1] - inside(size)[0] < (compact ? 5 : 6)) ?? STEPS.at(-1);
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
  const tag = Math.ceil(measure("2026-00-00", 11, 700)) / 2 + 7;
  const mark = Math.ceil(measure("비교 2026-00-00", 11, 700)) / 2 + 7;
  // 날짜 표식 둘(비교일, 조회일)의 자리는 날짜가 바뀔 때마다 createMarketComposition의 show가 옮긴다.
  const pill = (kind, half) => `<g data-composition-${kind} data-half="${half}">
      <rect x="${-half}" y="${top - 27}" width="${half * 2}" height="19" rx="4"/>
      <text y="${top - 17.5}" text-anchor="middle" dominant-baseline="central"></text>
    </g>`;
  const html = `<svg class="composition-chart${compact ? " compact" : ""}" viewBox="0 0 ${width} ${height}" tabindex="0" role="img"
    aria-label="${esc(name)} 시가총액 추이, ${unit}. 방향키로 조회일 이동"
    data-plot-start="${left}" data-plot-width="${plotWidth}" data-view-width="${width}">
    ${axis}${dates}
    <defs><clipPath id="composition-window"><rect data-composition-window x="0" y="0" width="0" height="${height}"/></clipPath></defs>
    <path class="composition-area" d="${area}"/>
    <path class="composition-area composition-area-window" clip-path="url(#composition-window)" d="${area}"/>
    <path class="composition-line" d="${line}"/>
    <line class="composition-base" data-composition-base x1="0" x2="0" y1="${top - 8}" y2="${base}"/>
    <circle class="composition-base-dot" data-composition-base-dot r="3.5"/>
    <line data-composition-cursor x1="0" x2="0" y1="${top - 8}" y2="${base}"/>
    <circle class="composition-dot" data-composition-dot r="4"/>
    ${pill("base-tag", mark)}${pill("tag", tag)}
  </svg>`;
  return { html, spot, unit };
}

// 칸 크기에 따라 고르는 글자 단계. min은 이름만, full은 증감률까지, deep은 시총과 비중까지 적는 데 필요한 칸 높이다.
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

const heatClass = percent => {
  const level = percent == null ? 0 : HEAT.filter(limit => Math.abs(percent) >= limit).length;
  return level ? (percent > 0 ? "up" : "down") + level : "flat";
};

// 조회일 시총을 넓이로, 비교일 대비 증감률을 색으로 그린 지도. 이름은 칸에 들어갈 때만 적는다.
function drawMap(tiles, width, measure) {
  const height = width < 550 ? MAP.compactHeight : MAP.height;
  const rects = treemap(tiles.map(tile => tile.cap), width, height);
  const body = tiles.map((tile, i) => {
    const rect = rects[i];
    if (!rect) return "";
    const x = rect.x + 1, y = rect.y + 1, w = Math.max(.5, rect.width - 2), h = Math.max(.5, rect.height - 2);
    const percent = tile.percent == null ? "" : `${signed(tile.percent)}%`;
    const fits = (text, size, weight, pad) => measure(text, size, weight) + pad * 2 <= w;
    const text = (kind, dx, dy, value) => `<text class="composition-tile-${kind}" x="${(x + dx).toFixed(2)}" y="${(y + dy).toFixed(2)}">${esc(value)}</text>`;
    let labels = "";
    const detail = `${number(tile.cap)}억원, 비중 ${number(tile.weight)}%`;
    const tier = TIERS.find(item => h >= item.min && fits(tile.name, item.size, item.weight, item.pad));
    if (h >= 150 && w >= 230) {
      labels = text("name huge", 12, 30, tile.name) + (percent ? text("percent huge", 12, 55, percent) + text("detail", 12, 76, detail) : "");
    } else if (tier) {
      labels = text(`name ${tier.kind}`, tier.pad, tier.name, tile.name);
      if (percent && h >= tier.full && fits(percent, tier.percentSize, tier.percentWeight, tier.pad)) {
        labels += text(`percent ${tier.kind}`, tier.pad, tier.percent, percent);
        if (h >= tier.deep && fits(detail, 11, 400, tier.pad)) labels += text("detail", tier.pad, tier.detail, detail);
      }
    } else if (tile.name.length >= 4) {
      // 좁고 긴 칸은 이름을 두 줄로 나눠 적는다.
      const cut = Math.ceil(tile.name.length / 2), parts = [tile.name.slice(0, cut), tile.name.slice(cut)];
      const wrap = WRAPS.find(item => h >= item.min && parts.every(part => fits(part, item.size, 600, item.pad)));
      if (wrap) labels = parts.map((part, line) => text(`name ${wrap.kind}`, wrap.pad, wrap.name + line * wrap.gap, part)).join("");
    }
    const spoken = `${tile.name}, 시총 ${number(tile.cap)}억원, 비중 ${number(tile.weight)}%${percent ? `, 비교일 대비 ${percent}` : ""}`;
    return `<g class="composition-tile composition-heat-${heatClass(tile.percent)}" data-compose-tile="${esc(tile.code)}" data-named="${labels ? 1 : 0}"
      tabindex="0" role="button" aria-pressed="false" aria-label="${esc(spoken)}">
      <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="3"/>${labels}</g>`;
  }).join("");
  return `<svg class="composition-map" viewBox="0 0 ${width} ${height}" role="group" aria-label="조회일 종목별 시가총액 지도. 넓이는 시총, 색은 비교일 대비 증감률">${body}</svg>`;
}

function createMarketComposition(root, onSelection, firstMode) {
  const chart = root.querySelector("[data-compose-chart]");
  const map = root.querySelector("[data-compose-map]");
  const title = root.querySelector("[data-compose-trend-title]");
  const note = root.querySelector("[data-compose-readout]");
  const clear = root.querySelector("[data-compose-clear]");
  const body = root.querySelector("tbody");
  const result = root.querySelector("[data-compose-result]");
  const headline = root.querySelector("[data-compose-status]");
  const total = root.querySelector("[data-compose-total]");
  const change = root.querySelector("[data-compose-change]");
  const baseInput = root.querySelector("[data-compose-base]");
  const dateInput = root.querySelector("[data-compose-date]");
  const presets = [...root.querySelectorAll("[data-compose-preset]")];
  // mode는 비교일을 정하는 방식이다. 빠른 선택이면 조회일을 옮길 때 비교일도 따라 움직이고, custom이면 날짜 칸에서 고른 날짜(순번 custom)에 머문다.
  let mode = firstMode, custom = 0, windowStart = "";
  // selected는 화면에 보이는 날짜, committed는 고정된 조회일이다. 마우스를 올린 동안만 둘이 달라진다.
  let points, members, names, selected, committed, model, baseline, highlighted, hovered, trend, measure, top;
  let details = new Map();
  const label = code => code === "other" ? "기타" : names.get(code) ?? code;
  // 표의 기타 행과 지도에서 상위 종목이 아닌 칸은 서로 짝이다.
  const paired = (code, target) => code === target || (target === "other" && !top.has(code)) || (code === "other" && !top.has(target));

  function mark() {
    for (const node of root.querySelectorAll("[data-compose-tile], tr[data-compose-group]")) {
      const code = node.dataset.composeTile ?? node.dataset.composeGroup;
      node.classList.toggle("dimmed", Boolean(highlighted && !paired(code, highlighted)));
      node.classList.toggle("hot", Boolean(hovered && paired(code, hovered)));
      if (node.dataset.composeTile) node.setAttribute("aria-pressed", String(code === highlighted));
    }
  }

  function describe() {
    const item = details.get(hovered ?? highlighted);
    // 단추는 다시 그리지 않는다. 누르는 도중에 설명 줄이 바뀌어도 단추가 그대로 있어야 눌린다.
    clear.hidden = !highlighted;
    if (!item) {
      note.innerHTML = `<span class="composition-hint">칸이나 표의 행을 누르면 그 종목의 추이를 봅니다.</span>`;
      return;
    }
    note.innerHTML = `<strong>${esc(item.name)}</strong><span>시총 ${number(item.cap)}억원</span><span>비중 ${number(item.weight)}%</span>
      ${item.delta == null ? "" : `<span class="${signClass(item.delta)}">비교일 대비 ${signed(item.delta)}억원${item.percent == null ? "" : ` (${signed(item.percent)}%)`}</span>`}`;
  }

  // 조회일(순번)에서 본 비교일의 순번. 시총 자료가 있는 날 가운데 목표 날짜 이후 첫 거래일이다.
  function baseOf(index) {
    const first = model.amounts.findIndex(Boolean);
    if (mode === "custom") return custom;
    if (mode === "day") return Math.max(first, model.amounts.findLastIndex((amounts, i) => amounts && i < index));
    const target = presetDate(mode, points[index].date);
    const found = points.findIndex((point, i) => model.amounts[i] && point.date >= target);
    return found < 0 || found > index ? first : found;
  }

  function markPresets() {
    for (const button of presets) {
      const preset = button.dataset.composePreset;
      button.setAttribute("aria-pressed", String(preset === mode));
      // 보이는 1년보다 앞선 날짜가 필요한 비교는 고를 수 없다.
      button.disabled = Boolean(model) && preset !== mode && preset !== "day" && presetDate(preset, points[committed].date) < windowStart;
    }
  }

  function show(index) {
    selected = Math.max(0, Math.min(index, points.length - 1));
    if (root.hidden || !model) return;
    baseline = baseOf(selected);
    const point = points[selected];
    const svg = chart.querySelector("svg");
    const part = name => svg.querySelector(`[data-composition-${name}]`);
    const spot = trend.spot(selected), origin = trend.spot(baseline);
    const place = (line, dot, at) => {
      line.setAttribute("transform", `translate(${at.x} 0)`);
      dot.setAttribute("visibility", at.y == null ? "hidden" : "visible");
      dot.setAttribute("cx", at.x);
      dot.setAttribute("cy", at.y ?? 0);
    };
    place(part("base"), part("base-dot"), origin);
    place(part("cursor"), part("dot"), spot);
    // 날짜 표식은 제 선 위에 두되, 둘이 가까우면 날짜가 이른 쪽을 왼쪽으로 밀어 나란히 놓는다.
    const view = Number(svg.dataset.viewWidth), gap = 4;
    const tags = [{ node: part("base-tag"), x: origin.x, text: `비교 ${points[baseline].date}` }, { node: part("tag"), x: spot.x, text: point.date }];
    for (const tag of tags) {
      tag.half = Number(tag.node.dataset.half);
      tag.at = Math.max(tag.half + 1, Math.min(tag.x, view - tag.half - 1));
    }
    const [first, second] = tags[1].x < tags[0].x ? [tags[1], tags[0]] : tags;
    const need = first.half + second.half + gap;
    if (second.at - first.at < need) {
      const middle = (first.at + second.at) / 2 + (first.half - second.half) / 2;
      first.at = Math.max(first.half + 1, Math.min(middle - need / 2, view - 1 - second.half - need));
      second.at = first.at + need;
    }
    for (const tag of tags) {
      tag.node.setAttribute("transform", `translate(${tag.at} 0)`);
      tag.node.querySelector("text").textContent = tag.text;
    }
    const span = part("window");
    span.setAttribute("x", Math.min(spot.x, origin.x));
    span.setAttribute("width", Math.abs(spot.x - origin.x));
    if (document.activeElement !== dateInput) dateInput.value = point.date;
    if (document.activeElement !== baseInput) baseInput.value = points[baseline].date;
    const amounts = model.amounts[selected];
    headline.textContent = point.live ? "당일 합산 시총 (잠정)" : "조회일 합산 시총 (추정)";
    details = new Map();
    if (!amounts) {
      total.textContent = "–";
      change.textContent = "–";
      result.textContent = `${point.date} 시총 자료 없음`;
      body.innerHTML = "<tr><td colspan='4'>집계 가능한 시총이 없습니다.</td></tr>";
      map.innerHTML = "";
      describe();
      return;
    }
    const base = model.amounts[baseline], before = points[baseline].constituents;
    const weight = cap => point.cap > 0 ? cap / point.cap * 100 : 0;
    const rows = model.groups.map((code, group) => ({
      code, cap: amounts[group], delta: base ? amounts[group] - base[group] : null,
      percent: base?.[group] > 0 ? (amounts[group] / base[group] - 1) * 100 : null,
    }));
    // 조회일 시총이 큰 순서로 놓아야 칸이 정사각형에 가까워져 이름이 들어갈 자리가 생긴다.
    const tiles = members.map(code => {
      const cap = point.constituents[code] ?? 0, old = base ? before[code] : null;
      return { code, name: label(code), cap, weight: weight(cap), delta: old == null ? null : cap - old, percent: old > 0 ? (cap / old - 1) * 100 : null };
    }).sort((a, b) => b.cap - a.cap || a.code.localeCompare(b.code));
    for (const tile of tiles) details.set(tile.code, tile);
    const rest = rows.at(-1);
    details.set("other", { ...rest, name: label("other"), weight: weight(rest.cap) });
    const activeTile = map.contains(document.activeElement) ? document.activeElement.dataset.composeTile : null;
    map.innerHTML = drawMap(tiles, Math.max(260, map.clientWidth), measure);
    if (activeTile) [...map.querySelectorAll("[data-compose-tile]")].find(node => node.dataset.composeTile === activeTile)?.focus({ preventScroll: true });
    const other = rows.pop();
    rows.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) || b.cap - a.cap);
    if (other) rows.push(other);
    const totalDelta = base ? point.cap - points[baseline].cap : null;
    const deltaPercent = base && points[baseline].cap ? totalDelta / points[baseline].cap * 100 : null;
    total.innerHTML = `${trillions(point.cap / 10000)}<small>조원</small>`;
    change.className = `num ${signClass(totalDelta)}`;
    change.innerHTML = `${signed(totalDelta)}<small>억원</small>${deltaPercent == null ? "" : `<small class="composition-pct">${signed(deltaPercent)}%</small>`}`;
    result.textContent = `${points[baseline].date} → ${point.date}`;
    const scale = Math.max(1, ...rows.map(row => Math.abs(row.delta ?? 0)));
    body.innerHTML = rows.map(({ code, cap, delta }) => {
      const halfWidth = Math.abs(delta ?? 0) / scale * 49;
      const meter = `<svg viewBox="0 0 100 8" class="composition-meter" aria-hidden="true"><line x1="50" x2="50" y1="0" y2="8"/><rect class="${signClass(delta)}" x="${delta < 0 ? 50 - halfWidth : 50}" y="1" width="${halfWidth}" height="6" rx="2"/></svg>`;
      return `<tr data-compose-group="${esc(code)}" data-cap="${cap}" data-weight="${weight(cap)}" data-delta="${delta ?? ""}">
        <th scope="row">${esc(label(code))}</th>
        <td>${number(cap)}</td><td>${number(weight(cap))}%</td><td class="${signClass(delta)}"><span class="composition-delta">${meter}${signed(delta)}</span></td>
      </tr>`;
    }).join("");
    mark();
    describe();
  }

  function commit(index) {
    show(index);
    committed = selected;
    if (!root.hidden && model) {
      markPresets();
      onSelection(points[selected].date);
    }
  }

  function paintTrend() {
    const hadFocus = chart.contains(document.activeElement);
    const values = points.map((point, i) => !model.amounts[i] ? null
      : !highlighted ? point.cap : highlighted === "other" ? model.amounts[i].at(-1) : point.constituents[highlighted] ?? null);
    const name = highlighted ? label(highlighted) : "합계";
    trend = drawTrend(points, values, Math.max(260, chart.clientWidth), measure, name);
    chart.innerHTML = trend.html;
    title.textContent = `${name} 시가총액 (${trend.unit})`;
    if (hadFocus) chart.querySelector("svg").focus({ preventScroll: true });
  }

  function render(applyBase = false) {
    if (root.hidden || !points?.length) return;
    model = marketComposition(points, members);
    if (!model) {
      chart.innerHTML = "";
      map.innerHTML = "";
      body.innerHTML = "";
      note.textContent = "";
      clear.hidden = true;
      result.textContent = "조회 기간의 구성 자료가 없습니다.";
      return;
    }
    for (const input of [baseInput, dateInput]) {
      input.min = points[0].date;
      input.max = points.at(-1).date;
    }
    if (mode === "custom") {
      // 날짜 칸에서 고른 비교일은 그 날짜 이전의 마지막 자료 있는 날로 맞춘다.
      custom = points.findLastIndex((point, i) => model.amounts[i] && point.date <= baseInput.value);
      if (custom < 0) custom = model.amounts.findIndex(Boolean);
      if (applyBase) baseInput.value = points[custom].date;
    }
    top = new Set(model.groups);
    if (highlighted && highlighted !== "other" && !members.includes(highlighted)) highlighted = null;
    measure ??= textMeasure(getComputedStyle(chart).fontFamily);
    paintTrend();
    show(selected);
    markPresets();
  }

  function toggle(code) {
    if (!model || !code) return;
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
  clear.addEventListener("click", () => toggle(highlighted));

  dateInput.addEventListener("change", () => {
    commit(points.findLastIndex(point => point.date <= dateInput.value));
    dateInput.value = points[selected].date;
  });
  baseInput.addEventListener("change", () => {
    mode = "custom";
    render(true);
  });
  for (const button of presets) {
    button.addEventListener("click", () => {
      if (!model) return;
      mode = button.dataset.composePreset;
      show(committed);
      markPresets();
    });
  }
  function indexAt(event) {
    const svg = chart.querySelector("svg");
    if (!svg || !model) return null;
    const bounds = svg.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * Number(svg.dataset.viewWidth) / bounds.width;
    return Math.round((x - Number(svg.dataset.plotStart)) / Number(svg.dataset.plotWidth) * (points.length - 1));
  }
  // 마우스를 올리면 그 날짜를 미리 보고, 누르거나 끌면 조회일로 고정한다. 그래프를 벗어나면 고정한 날짜로 돌아간다.
  chart.addEventListener("pointermove", event => {
    const index = indexAt(event);
    if (index == null) return;
    if (event.pointerType === "mouse" && !event.buttons) show(index);
    else commit(index);
  });
  chart.addEventListener("pointerleave", () => { if (model && selected !== committed) show(committed); });
  chart.addEventListener("click", event => {
    const index = indexAt(event);
    if (index != null) commit(index);
  });
  chart.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !model) return;
    event.preventDefault();
    commit(committed + (event.key === "ArrowRight" ? 1 : -1));
  });

  return {
    update(nextPoints, nextMembers, nextNames, nextSelected, nextStart) {
      windowStart = nextStart;
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
  const params = new URLSearchParams(location.search);
  let selection = params.get("date"), endDate, current, history, stocks, meta;
  try {
    const [config, snapshot] = await Promise.all([loadJson("data/meta.json"), loadJson("data/snapshot.json")]);
    meta = config;
    stocks = snapshot.stocks;
    history = meta.domesticMarket ? await loadJson(meta.domesticMarket) : null;
    if (!history?.bars.some(day => day.constituents)) throw new Error("composition unavailable");
  } catch {
    status.textContent = "시총 구성 자료를 불러올 수 없습니다.";
    return;
  }
  const names = new Map(stocks.filter(stock => stock.kind === "KR").map(stock => [stock.code ?? stock.id, stock.name]));
  const composition = createMarketComposition(root, date => { selection = date; }, PERIOD_PRESETS[params.get("period")] ?? "quarter");

  function draw() {
    const last = history.bars.at(-1);
    const points = current?.date > last.date ? [...history.bars, current] : history.bars;
    const end = points.at(-1).date;
    const start = marketRangeStart(end, RANGE);
    const visible = points.filter(point => point.date >= start);
    const index = selection && selection !== endDate ? visible.findIndex(point => point.date === selection) : -1;
    endDate = end;
    composition.update(visible, history.members, names, index < 0 ? visible.length - 1 : index, start);
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
