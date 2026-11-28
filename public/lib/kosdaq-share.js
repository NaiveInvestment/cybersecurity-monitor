const twoDecimals = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const indexTick = new Intl.NumberFormat("ko-KR");
const height = 124, top = 11, bottom = 111;

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

function plotScale(values, minStep) {
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
    const label = isLeft ? `${Number(tick.toFixed(2))}%` : indexTick.format(tick);
    return `<line class="${isLeft ? "chart-grid" : "kosdaq-index-tick"}" x1="${isLeft ? left : right}" x2="${isLeft ? right : right + 4}" y1="${y}" y2="${y}"/>
      <text class="kosdaq-axis-${side}" x="${isLeft ? left - 6 : right + 7}" y="${y}" text-anchor="${isLeft ? "end" : "start"}" dominant-baseline="central">${label}</text>`;
  }).join("");
}

function drawSeries(values, x, scale, series) {
  if (!scale) return "";
  const path = values.map((value, i) => value == null ? "" :
    `${values[i - 1] == null ? "M" : "L"}${x(i).toFixed(2)},${scale.y(value).toFixed(2)}`).join("");
  return `<path class="kosdaq-series-line kosdaq-${series}-line" d="${path}"/>
    <circle class="kosdaq-series-dot kosdaq-${series}-dot" data-kosdaq-${series === "share" ? "dot" : "index-dot"} r="3.5" visibility="hidden"/>`;
}

function placeDot(dot, value, x, scale) {
  if (!dot) return;
  dot.setAttribute("visibility", value == null ? "hidden" : "visible");
  if (value == null) return;
  dot.setAttribute("cx", x);
  dot.setAttribute("cy", scale.y(value));
}

export function createKosdaqShare(panel, market, members) {
  const chart = panel.querySelector("[data-kosdaq-chart]");
  const value = panel.querySelector("[data-kosdaq-share]");
  const index = panel.querySelector("[data-kosdaq-index]");
  const status = panel.querySelector("[data-kosdaq-readout]");
  const button = panel.querySelector("[data-kosdaq-toggle]");
  const detail = panel.querySelector("#kosdaq-share-plot");
  button.addEventListener("click", () => {
    detail.hidden = !detail.hidden;
    button.setAttribute("aria-expanded", String(!detail.hidden));
  });

  let entries = [], days = [], recent = -1, x, shareScale, indexScale;
  return {
    chart,
    render(points, layout) {
      const hadFocus = chart.contains(document.activeElement);
      const wasDisabled = button.disabled;
      days = points;
      entries = kosdaqComparisonPoints(points, market, members);
      const shares = entries.map(entry => entry.comparison?.share ?? null);
      const closes = entries.map(entry => entry.close);
      recent = shares.findLastIndex(share => share != null);
      shareScale = plotScale(shares, .1);
      indexScale = plotScale(closes, 10);
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
      const { width, left, right, spot } = layout;
      x = position => spot(position).x;
      chart.innerHTML = `<svg class="composition-chart" viewBox="0 0 ${width} ${height}" tabindex="0"
        role="img" aria-label="코스닥 내 보안주 비중은 왼쪽 퍼센트 축, 코스닥지수는 오른쪽 포인트 축. 방향키로 조회일 이동">
        ${drawAxis(shareScale, left, right, "left")}${drawAxis(indexScale, left, right, "right")}
        <line class="kosdaq-share-cursor" data-kosdaq-cursor x1="0" x2="0" y1="${top}" y2="${bottom}"/>
        ${drawSeries(closes, x, indexScale, "index")}
        ${drawSeries(shares, x, shareScale, "share")}
      </svg>`;
      if (hadFocus) chart.querySelector("svg").focus({ preventScroll: true });
    },
    select(position) {
      const point = days[position];
      if (!point) return;
      const { comparison, close } = entries[position];
      value.textContent = comparison ? `${twoDecimals.format(comparison.share)}%` : "–";
      index.textContent = close == null ? "–" : `${twoDecimals.format(close)} pt`;
      status.textContent = comparison
        ? `${point.date} 보안주 ${twoDecimals.format(comparison.stockCap / 10000)}조원 / 코스닥 ${twoDecimals.format(comparison.marketCap / 10000)}조원`
        : `${point.date} 비교 자료 없음${recent >= 0 ? ` / 최근 ${days[recent].date}` : ""}`;
      panel.dataset.date = point.date;
      const cursor = chart.querySelector("[data-kosdaq-cursor]");
      if (!cursor) return;
      const px = x(position);
      cursor.setAttribute("transform", `translate(${px} 0)`);
      placeDot(chart.querySelector("[data-kosdaq-dot]"), comparison?.share, px, shareScale);
      placeDot(chart.querySelector("[data-kosdaq-index-dot]"), close, px, indexScale);
    },
  };
}
