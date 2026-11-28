const percent = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const height = 97, top = 10, bottom = 85;

export function kosdaqSharePoints(points, market, members) {
  const marketDays = new Map(market?.market === "KOSDAQ" && market.unit === "억원"
    && Array.isArray(market.bars) ? market.bars.map(({ date, cap }) => [date, cap]) : []);
  return points.map(point => {
    const marketCap = marketDays.get(point.date);
    if (!Number.isFinite(marketCap) || marketCap <= 0 || point.live || !point.constituents ||
        point.capCount !== point.listed) return null;
    const values = Object.entries(point.constituents).filter(([code]) => members.has(code)).map(([, cap]) => cap);
    if (!values.length || values.some(cap => !Number.isFinite(cap) || cap < 0)) return null;
    const stockCap = values.reduce((sum, cap) => sum + cap, 0);
    if (stockCap > marketCap) return null;
    return { share: stockCap / marketCap * 100, stockCap, marketCap };
  });
}

export function createKosdaqShare(panel, market, members) {
  const chart = panel.querySelector("[data-kosdaq-chart]");
  const value = panel.querySelector("[data-kosdaq-share]");
  const status = panel.querySelector("[data-kosdaq-readout]");
  const button = panel.querySelector("[data-kosdaq-toggle]");
  const detail = panel.querySelector("#kosdaq-share-plot");
  button.addEventListener("click", () => {
    detail.hidden = !detail.hidden;
    button.setAttribute("aria-expanded", String(!detail.hidden));
  });

  let entries = [], days = [], recent = null, x, y;
  return {
    chart,
    render(points, layout) {
      const hadFocus = chart.contains(document.activeElement);
      days = points;
      entries = kosdaqSharePoints(points, market, members);
      const observed = entries.flatMap(entry => entry ? [entry.share] : []);
      recent = entries.findLastIndex(Boolean);
      button.disabled = !observed.length;
      if (!observed.length) {
        chart.replaceChildren();
        detail.hidden = true;
        button.setAttribute("aria-expanded", "false");
        return;
      }
      const { width, left, right, spot } = layout;
      x = index => spot(index).x;
      const min = Math.min(...observed), max = Math.max(...observed);
      const step = Math.max(.1, Math.ceil((max - min + .05) / .3) / 10);
      const low = Math.max(0, Math.floor((min - .02) / step) * step);
      const high = Math.max(low + step * 2, Math.ceil((max + .02) / step) * step);
      y = ratio => bottom - (ratio - low) / (high - low) * (bottom - top);
      const grid = [];
      for (let tick = low; tick <= high + 1e-7; tick += step) {
        const mark = y(tick).toFixed(1);
        grid.push(`<line class="chart-grid" x1="${left}" x2="${right}" y1="${mark}" y2="${mark}"/>
          <text x="${left - 6}" y="${mark}" text-anchor="end" dominant-baseline="central">${tick.toFixed(1)}%</text>`);
      }
      const path = entries.map((entry, index) => entry ? `${entries[index - 1] ? "L" : "M"}${x(index).toFixed(2)},${y(entry.share).toFixed(2)}` : "").join("");
      chart.innerHTML = `<svg class="composition-chart" viewBox="0 0 ${width} ${height}" tabindex="0"
        role="img" aria-label="코스닥 전체 종가 시총 중 국내 보안주 비중. 방향키로 조회일 이동">
        ${grid.join("")}<path class="kosdaq-share-line" d="${path}"/>
        <line class="kosdaq-share-cursor" data-kosdaq-cursor x1="0" x2="0" y1="${top}" y2="${bottom}"/>
        <circle class="kosdaq-share-dot" data-kosdaq-dot r="3.5"/>
      </svg>`;
      if (hadFocus) chart.querySelector("svg").focus({ preventScroll: true });
    },
    select(index) {
      const point = days[index], entry = entries[index];
      if (!point) return;
      value.textContent = entry ? `${percent.format(entry.share)}%` : "–";
      status.textContent = entry
        ? `${point.date} 보안주 ${money.format(entry.stockCap / 10000)}조원 / 코스닥 ${money.format(entry.marketCap / 10000)}조원`
        : `${point.date} 비교 자료 없음${recent >= 0 ? ` / 최근 ${days[recent].date}` : ""}`;
      panel.dataset.date = point.date;
      const cursor = chart.querySelector("[data-kosdaq-cursor]");
      if (!cursor) return;
      cursor.setAttribute("transform", `translate(${x(index)} 0)`);
      const dot = chart.querySelector("[data-kosdaq-dot]");
      dot.setAttribute("visibility", entry ? "visible" : "hidden");
      if (entry) {
        dot.setAttribute("cx", x(index));
        dot.setAttribute("cy", y(entry.share));
      }
    },
  };
}
