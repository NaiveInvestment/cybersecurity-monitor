import { esc, initTheme, loadJson, signClass } from "./common.js";
import { marketComposition } from "./lib/market-composition.js";
import { treemap } from "./lib/treemap.js";
import { currentMarketActivity, marketMonthRanges, marketRangeStart } from "./lib/market-activity.js";
import { startQuoteFeed } from "./lib/quote-feed.js";

const number = value => value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const trillions = value => value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
const signed = value => value == null ? "–" : Math.abs(value) < .05 ? "0" : (value > 0 ? "+" : "") + number(value);

const TREND = { height: 200, top: 32, left: 46, right: 16, bottom: 40 };
const TREND_COMPACT = { height: 170, top: 32, left: 38, right: 12, bottom: 40 };
const MAP = { height: 400, compactHeight: 440 };
const STEPS = [.1, .2, .5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
// 증감률 색 단계의 경계(%). 범례 문구와 CSS의 composition-heat 단계가 이 값을 따른다.
const HEAT = [2, 10, 30];

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
  const peak = Math.max(0, ...values.filter(value => value != null));
  const divisor = peak >= 10000 ? 10000 : 1, unit = divisor > 1 ? "조원" : "억원";
  const step = STEPS.find(size => peak / divisor / size <= 3) ?? STEPS.at(-1);
  const high = Math.max(1, Math.ceil(peak / divisor / step - 1e-9)) * step;
  // 세로축 숫자가 길어지면 왼쪽 여백을 그만큼 넓힌다.
  const left = Math.max(layout.left, Math.ceil(measure(number(high), 11, 400)) + 11);
  const plotWidth = width - left - right, base = height - bottom;
  const x = index => points.length > 1 ? left + index * plotWidth / (points.length - 1) : left + plotWidth / 2;
  const y = value => base - value / (high * divisor) * (base - top);
  const axis = Array.from({ length: Math.round(high / step) + 1 }, (_, i) => {
    const py = y(i * step * divisor).toFixed(2);
    return `<line class="${i ? "chart-grid" : "composition-baseline"}" x1="${left}" x2="${left + plotWidth}" y1="${py}" y2="${py}"/>
      <text class="composition-tick" x="${left - 7}" y="${py}" text-anchor="end" dominant-baseline="central">${number(i * step)}</text>`;
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
    aria-label="${esc(name)} 시가총액 추이, ${unit}. 방향키로 조회일, Shift와 방향키로 비교일 이동"
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

function createMarketComposition(root, onSelection) {
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

  function show(index) {
    selected = Math.max(0, Math.min(index, points.length - 1));
    if (root.hidden || !model) return;
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
    if (!root.hidden && model) onSelection(points[selected].date);
  }

  // 비교일을 옮긴다. 시총 자료가 없는 날이면 그 앞의 자료 있는 날로 맞춘다.
  function rebase(index) {
    const limit = Math.max(0, Math.min(index, points.length - 1));
    const found = model.amounts.findLastIndex((amounts, i) => amounts && i <= limit);
    baseline = found < 0 ? model.amounts.findIndex(Boolean) : found;
    baseInput.value = points[baseline].date;
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
    baseline = points.findLastIndex((point, i) => model.amounts[i] && point.date <= baseInput.value);
    if (baseline < 0) baseline = model.amounts.findIndex(Boolean);
    if (applyBase || document.activeElement !== baseInput) baseInput.value = points[baseline].date;
    top = new Set(model.groups);
    if (highlighted && highlighted !== "other" && !members.includes(highlighted)) highlighted = null;
    measure ??= textMeasure(getComputedStyle(chart).fontFamily);
    paintTrend();
    show(selected);
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
  baseInput.addEventListener("change", () => render(true));
  // 그래프 안의 가로 위치(viewBox 단위)와 그 자리의 날짜 순번
  function locate(event) {
    const svg = chart.querySelector("svg");
    if (!svg || !model) return null;
    const bounds = svg.getBoundingClientRect(), scale = Number(svg.dataset.viewWidth) / bounds.width;
    const x = (event.clientX - bounds.left) * scale;
    const index = offset => Math.max(0, Math.min(points.length - 1,
      Math.round((x + offset - Number(svg.dataset.plotStart)) / Number(svg.dataset.plotWidth) * (points.length - 1))));
    return { x, scale, index };
  }
  // 누른 자리가 표식(선이나 날짜 표)이면 그 표식을, 아니면 구간을 끈다.
  function grip(event, at) {
    const reach = (event.pointerType === "mouse" ? 9 : 20) * at.scale;
    const lines = { base: trend.spot(baseline).x, date: trend.spot(committed).x };
    // 미리 보는 동안의 조회일 표는 마우스를 따라다니므로 손잡이로 치지 않는다.
    const hit = name => event.target.closest?.("[data-composition-" + name + "]");
    const tagged = hit("base-tag") ? "base" : hit("tag") && selected === committed ? "date" : null;
    if (tagged) return { kind: tagged, offset: lines[tagged] - at.x };
    const near = Object.entries(lines).map(([kind, x]) => ({ kind, distance: Math.abs(x - at.x), offset: x - at.x }))
      .filter(item => item.distance <= reach).sort((a, b) => a.distance - b.distance);
    // 두 표식이 같은 날짜에 겹쳐 있으면 끄는 방향으로 정한다(왼쪽이면 비교일, 오른쪽이면 조회일).
    if (near.length === 2 && near[0].distance === near[1].distance) return { kind: "either", offset: near[0].offset };
    return near[0] ?? { kind: "range", offset: 0 };
  }
  // 마우스를 올리면 그 날짜를 미리 보고, 누르면 조회일로 고정한다. 끌면 누른 날짜부터 놓은 날짜까지가 비교일과 조회일이 되고,
  // 비교일이나 조회일 표식을 잡고 끌면 그 날짜만 옮긴다. 그래프를 벗어나면 고정한 날짜로 돌아간다.
  let drag = null;
  chart.addEventListener("pointerdown", event => {
    const at = locate(event);
    if (!at || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    drag = { ...grip(event, at), id: event.pointerId, start: at.index(0), down: event.clientX, moved: false, undo: { baseline, committed } };
    chart.setPointerCapture?.(event.pointerId);
  });
  chart.addEventListener("pointermove", event => {
    const at = locate(event);
    if (!at) return;
    if (!drag || drag.id !== event.pointerId) {
      if (event.pointerType !== "mouse" || event.buttons) return;
      chart.classList.toggle("grabbable", grip(event, at).kind !== "range");
      show(at.index(0));
      return;
    }
    if (!drag.moved && Math.abs(event.clientX - drag.down) < (event.pointerType === "mouse" ? 4 : 8)) return;
    drag.moved = true;
    chart.classList.add("dragging");
    if (drag.kind === "either") drag.kind = event.clientX < drag.down ? "base" : "date";
    const index = at.index(drag.offset);
    if (drag.kind === "base") {
      rebase(index);
      show(committed);
    } else if (drag.kind === "date") {
      commit(index);
    } else {
      rebase(Math.min(drag.start, index));
      commit(Math.max(drag.start, index));
    }
  });
  function release(event, cancelled) {
    if (!drag || drag.id !== event.pointerId) return;
    const { moved, undo, start } = drag;
    drag = null;
    chart.classList.remove("dragging");
    if (cancelled) {
      // 세로로 넘기는 손짓으로 바뀐 경우 등: 끌기 전으로 되돌린다.
      if (moved && model) {
        rebase(undo.baseline);
        commit(Math.min(undo.committed, points.length - 1));
      }
    } else if (!moved && model) commit(start);
  }
  chart.addEventListener("pointerup", event => release(event, false));
  chart.addEventListener("pointercancel", event => release(event, true));
  chart.addEventListener("pointerleave", () => {
    chart.classList.remove("grabbable");
    if (model && !drag && selected !== committed) show(committed);
  });
  chart.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !model) return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    if (!event.shiftKey) return commit(committed + step);
    // 비교일은 시총 자료가 있는 다음 날짜로 옮긴다.
    let next = baseline + step;
    while (next >= 0 && next < points.length && !model.amounts[next]) next += step;
    if (next < 0 || next >= points.length) return;
    rebase(next);
    show(committed);
  });

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
  const params = new URLSearchParams(location.search);
  let range = Object.hasOwn(marketMonthRanges, params.get("period")) ? params.get("period") : "3M";
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
  const composition = createMarketComposition(root, date => { selection = date; });

  function draw() {
    const last = history.bars.at(-1);
    const points = current?.date > last.date ? [...history.bars, current] : history.bars;
    const end = points.at(-1).date;
    const start = marketRangeStart(end, range);
    const visible = points.filter(point => point.date >= start);
    const index = selection && selection !== endDate ? visible.findIndex(point => point.date === selection) : -1;
    endDate = end;
    root.querySelectorAll("[data-compose-range]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.composeRange === range)));
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
  root.addEventListener("click", event => {
    const button = event.target.closest("[data-compose-range]");
    if (!button) return;
    range = button.dataset.composeRange;
    selection = null;
    root.querySelector("[data-compose-base]").value = "";
    draw();
  });
  let frame;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  });
  startQuoteFeed(meta.live, { onQuotes: payload => update(payload.q), onRelayLost: payload => update(payload?.q) });
}

main();
