const twoDecimals = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const indexTick = new Intl.NumberFormat("ko-KR");
const percentTick = new Intl.NumberFormat("ko-KR", { maximumSignificantDigits: 3 });

export function kosdaqShareLogScale(values, { top, bottom }) {
  const present = values.filter(value => Number.isFinite(value) && value > 0);
  if (!present.length) return null;
  const min = Math.log10(Math.min(...present)), max = Math.log10(Math.max(...present));
  const span = max - min;
  const margin = Math.max(.1, span * .07);
  const low = min - margin, high = max + margin;
  const steps = span > .9 ? [1, 2, 5] : [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
  const ticks = [];
  const minTick = 10 ** low, maxTick = 10 ** high;
  for (let order = Math.floor(low); order <= Math.ceil(high); order += 1) {
    for (const step of steps) {
      const tick = step * 10 ** order;
      if (tick > 0 && tick >= minTick && tick <= maxTick) ticks.push(tick);
    }
  }
  return { ticks, y: value => value > 0 ? bottom - (Math.log10(value) - low) / (high - low) * (bottom - top) : null };
}

function shareOnDate(point, marketCap, members) {
  if (!Number.isFinite(marketCap) || marketCap <= 0 || point.live || !point.constituents ||
      point.capCount !== point.listed) return null;
  const values = Object.entries(point.constituents).filter(([code]) => members.has(code)).map(([, cap]) => cap);
  if (!values.length || values.some(cap => !Number.isFinite(cap) || cap < 0)) return null;
  const stockCap = values.reduce((sum, cap) => sum + cap, 0);
  if (stockCap > marketCap) return null;
  return { share: stockCap / marketCap * 100, stockCap, marketCap };
}

export function kosdaqComparisonPoints(points, market, members) {
  const marketDays = new Map(market?.market === "KOSDAQ" && market.unit === "억원"
    && Array.isArray(market.bars) ? market.bars.map(row => [row.date, row]) : []);
  return points.map(point => {
    const day = marketDays.get(point.date);
    return {
      comparison: shareOnDate(point, day?.cap, members),
      close: Number.isFinite(day?.close) && day.close > 0 ? day.close : null,
    };
  });
}

const sectorIds = ["bio", "robot"];

export function kosdaqSectorSharePoints(points, market, sectorData) {
  const totals = new Map(market?.market === "KOSDAQ" && market.unit === "억원"
    && Array.isArray(market.bars) ? market.bars.map(({ date, cap }) => [date, Math.round(cap * 100_000_000)]) : []);
  const sectors = new Map(sectorData?.market === "KOSDAQ" && sectorData.unit === "원"
    && Array.isArray(sectorData.bars) ? sectorData.bars.map(row => [row.date, row]) : []);
  return points.map(point => {
    const row = sectors.get(point.date);
    const total = totals.get(point.date);
    if (row?.marketCap !== total || !(total > 0)) return {};
    return Object.fromEntries(sectorIds.flatMap(id => {
      const cap = row.caps?.[id]?.cap;
      return Number.isSafeInteger(cap) && cap > 0 && cap <= total ? [[id, cap / total * 100]] : [];
    }));
  });
}

function plotScale(values, minStep, { top, bottom }) {
  const present = values.filter(value => value != null);
  if (!present.length) return null;
  const min = Math.min(...present), max = Math.max(...present);
  const pad = Math.max((max - min) * .04, minStep / 4);
  const low = Math.max(0, min - pad), high = max + pad;
  const target = Math.max(minStep, (high - low) / 4);
  const order = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 2.5, 5, 10].map(size => size * order).find(size => size >= target);
  const start = Math.floor(low / step + 1e-9), end = Math.ceil(high / step - 1e-9);
  return {
    ticks: Array.from({ length: end - start + 1 }, (_, i) => (start + i) * step),
    y: value => bottom - (value / step - start) / (end - start) * (bottom - top),
  };
}

function drawAxis(scale, left, right, side) {
  if (!scale) return "";
  const isLeft = side === "left";
  return scale.ticks.map(tick => {
    const y = scale.y(tick).toFixed(1);
    const label = isLeft ? `${percentTick.format(tick)}%` : indexTick.format(tick);
    return `<line class="${isLeft ? "chart-grid" : "kosdaq-index-tick"}" x1="${isLeft ? left : right}" x2="${isLeft ? right : right + 4}" y1="${y}" y2="${y}"/>
      <text class="kosdaq-axis-${side}" x="${isLeft ? left - 6 : right + 7}" y="${y}" text-anchor="${isLeft ? "end" : "start"}" dominant-baseline="central">${label}</text>`;
  }).join("");
}

function drawSeries(values, x, scale, series) {
  if (!scale) return "";
  const path = values.map((value, i) => value == null ? "" :
    `${values[i - 1] == null ? "M" : "L"}${x(i).toFixed(2)},${scale.y(value).toFixed(2)}`).join("");
  return `<path class="kosdaq-series-line kosdaq-${series}-line" d="${path}"/>
    <circle class="kosdaq-series-dot kosdaq-${series}-dot" data-kosdaq-${series === "share" ? "dot" : series + "-dot"} r="3.5" visibility="hidden"/>`;
}

function placeDot(dot, value, x, scale) {
  if (!dot) return;
  const y = value == null ? null : scale.y(value);
  dot.setAttribute("visibility", y == null ? "hidden" : "visible");
  if (y == null) return;
  dot.setAttribute("cx", x);
  dot.setAttribute("cy", y);
}

export function createKosdaqShare(panel, market, members, sectorData) {
  const chart = panel.querySelector("[data-kosdaq-chart]");
  const value = panel.querySelector("[data-kosdaq-share]");
  const index = panel.querySelector("[data-kosdaq-index]");
  const status = panel.querySelector("[data-kosdaq-readout]");
  const button = panel.querySelector("[data-kosdaq-toggle]");
  const detail = panel.querySelector("#kosdaq-share-plot");
  const sectorStatus = panel.querySelector("[data-kosdaq-sector-status]");
  const controls = [...panel.querySelectorAll("[data-kosdaq-sector]")].map(button => ({
    button, id: button.dataset.kosdaqSector, value: button.querySelector("b"),
  }));
  const active = new Set();
  button.addEventListener("click", () => {
    detail.hidden = !detail.hidden;
    button.setAttribute("aria-expanded", String(!detail.hidden));
  });

  let days = [], entries = [], sectorShares = [], shares = [], closes = [], recent = -1;
  let layout, selected = 0, x, shareScale, indexScale;
  const series = new Map();
  const latest = new Map();

  function draw() {
    const hadFocus = chart.contains(document.activeElement);
    const wasDisabled = button.disabled;
    const { width, left, right, spot, ticks } = layout;
    const height = width < 550 ? 220 : 276;
    const top = 31, bottom = height - 25;
    const extra = [...active].map(id => [id, series.get(id)]);
    shareScale = kosdaqShareLogScale(shares.concat(...extra.map(([, values]) => values)), { top, bottom });
    indexScale = plotScale(closes, 10, { top, bottom });
    button.disabled = !shareScale && !indexScale;
    if (button.disabled) {
      chart.replaceChildren();
      detail.hidden = true;
      button.setAttribute("aria-expanded", "false");
      return;
    }
    if (wasDisabled) {
      detail.hidden = false;
      button.setAttribute("aria-expanded", "true");
    }
    x = position => spot(position).x;
    chart.innerHTML = `<svg class="composition-chart" viewBox="0 0 ${width} ${height}" tabindex="0"
      role="img" aria-label="왼쪽은 섹터 시총 비중 퍼센트 로그 눈금, 오른쪽은 코스닥지수 포인트 선형 눈금. 방향키로 조회일 이동">
      ${shareScale ? '<text class="kosdaq-axis-left kosdaq-chart-label" y="13">시총 비중 (%, 로그)</text>' : ""}
      ${indexScale ? `<text class="kosdaq-axis-right kosdaq-chart-label" x="${width - 1}" y="13" text-anchor="end">코스닥지수 (pt)</text>` : ""}
      ${ticks.map(({ index, label }) => `<text class="composition-tick" x="${x(index).toFixed(1)}" y="${height - 5}" text-anchor="middle">${label}</text>`).join("")}
      ${drawAxis(shareScale, left, right, "left")}${drawAxis(indexScale, left, right, "right")}
      <line class="kosdaq-share-cursor" data-kosdaq-cursor x1="0" x2="0" y1="${top}" y2="${bottom}"/>
      ${drawSeries(closes, x, indexScale, "index")}
      ${extra.map(([id, values]) => drawSeries(values, x, shareScale, id)).join("")}
      ${drawSeries(shares, x, shareScale, "share")}
    </svg>`;
    if (hadFocus) chart.querySelector("svg").focus({ preventScroll: true });
  }

  function select(position) {
    const point = days[position];
    if (!point) return;
    selected = position;
    const { comparison, close } = entries[position];
    value.textContent = comparison ? `${twoDecimals.format(comparison.share)}%` : "–";
    index.textContent = close == null ? "–" : `${twoDecimals.format(close)} pt`;
    status.textContent = comparison
      ? `${point.date} 보안주 ${twoDecimals.format(comparison.stockCap / 10000)}조원 / 코스닥 ${twoDecimals.format(comparison.marketCap / 10000)}조원`
      : `${point.date} 비교 자료 없음${recent >= 0 ? ` / 최근 ${days[recent].date}` : ""}`;
    panel.dataset.date = point.date;
    const missing = [];
    for (const control of controls) {
      const on = active.has(control.id);
      const share = sectorShares[position][control.id];
      control.value.hidden = !on;
      control.value.textContent = share == null ? "–" : `${twoDecimals.format(share)}%`;
      if (on && share == null && latest.get(control.id) >= 0) {
        missing.push(days[latest.get(control.id)].date);
      }
    }
    const latestCommon = missing.sort()[0];
    sectorStatus.textContent = latestCommon
      ? (point.date > latestCommon ? `비교 섹터 종가 ${latestCommon}까지` : "조회일 비교 섹터 자료 없음") : "";
    const cursor = chart.querySelector("[data-kosdaq-cursor]");
    if (!cursor) return;
    const px = x(position);
    cursor.setAttribute("transform", `translate(${px} 0)`);
    placeDot(chart.querySelector("[data-kosdaq-dot]"), comparison?.share, px, shareScale);
    placeDot(chart.querySelector("[data-kosdaq-index-dot]"), close, px, indexScale);
    for (const id of active) {
      placeDot(chart.querySelector(`[data-kosdaq-${id}-dot]`), sectorShares[position][id], px, shareScale);
    }
  }

  for (const control of controls) {
    control.button.addEventListener("click", () => {
      if (active.has(control.id)) active.delete(control.id);
      else active.add(control.id);
      control.button.setAttribute("aria-pressed", String(active.has(control.id)));
      draw();
      select(selected);
    });
  }

  return {
    chart,
    render(points, nextLayout) {
      days = points;
      layout = nextLayout;
      entries = kosdaqComparisonPoints(points, market, members);
      sectorShares = kosdaqSectorSharePoints(points, market, sectorData);
      shares = entries.map(entry => entry.comparison?.share > 0 ? entry.comparison.share : null);
      closes = entries.map(entry => entry.close);
      recent = shares.findLastIndex(share => share != null);
      for (const { id, button } of controls) {
        const values = sectorShares.map(row => row[id] ?? null);
        series.set(id, values);
        const last = values.findLastIndex(share => share != null);
        latest.set(id, last);
        button.disabled = last < 0;
      }
      draw();
    },
    select,
  };
}
