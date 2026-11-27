import { esc, fmtPct } from "../common.js";

const levels = { danger: "투자위험", warning: "투자경고", attention: "투자주의" };
const reasons = {
  quick: "초단기 급등", short: "단기 급등", medium: "중장기 급등",
  shortAccounts: "단기상승과 계좌 요건", mediumAccounts: "중장기상승과 계좌 요건",
};
const monitorGap = 0.05;
const referenceDayMs = 86400000;
const won = number => Number.isFinite(number) ? Math.round(number).toLocaleString("ko-KR") + "원" : "자료 없음";
const localDay = now => new Date(now + 9 * 3600000).toISOString().slice(0, 10);
const timeLabel = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
const dateLabel = day => day ? `${Number(day.slice(5, 7))}월 ${Number(day.slice(8))}일` : "";
const gap = (price, target) => 100 * (target - price) / price;
const change = (price, base) => 100 * (price - base) / base;
const usablePrice = value => Number.isFinite(value) && value > 0;
const overheatLink = "https://kind.krx.co.kr/external/2026/06/18/000721/20260618001566/70724.htm";
const quoteSteps = [[2000, 1], [5000, 5], [20000, 10], [50000, 50], [200000, 100], [500000, 500], [Infinity, 1000]];

export function kosdaqPriceLevel(value) {
  if (!usablePrice(value)) return null;
  const [, step] = quoteSteps.find(([ceiling]) => value < ceiling);
  return Math.ceil(value / step) * step;
}

function freshRegular(quote, now) {
  const at = Date.parse(quote?.at);
  if (quote?.nxt || quote?.st !== "OPEN" || !usablePrice(quote.p) || !Number.isFinite(at) ||
      now - at > 180000 || at > now + 5000 || localDay(at) !== localDay(now)) return false;
  const time = value => new Date(value + 9 * 3600000).toISOString().slice(11, 16);
  return time(at) >= "09:00" && time(now) < "15:30";
}

export function warningPriceView(row, quote, indexQuote, now = Date.now()) {
  const liveQuote = freshRegular(quote, now);
  const basis = row?.intraday;
  if (!basis || basis.date !== localDay(now) || !liveQuote) {
    return { prices: row?.prices, intraday: false, liveQuote };
  }
  const close = quote.p;
  const index = freshRegular(indexQuote, now) ? indexQuote.p : null;
  const checks = basis.checks.map(rule => {
    if (!usablePrice(rule.prior)) return { ...rule, result: null };
    const result = change(close, rule.prior);
    const indexReturn = rule.multiple && index ? change(index, rule.baseIndex) : null;
    return { ...rule, result, indexReturn, indexPass: indexReturn === null ? null : result >= indexReturn * rule.multiple,
      cutoffPrice: Math.ceil(rule.prior * (100 + rule.threshold) / 100),
      pricePass: close * 100 >= rule.prior * (100 + rule.threshold) };
  });
  const year = basis.annual;
  let annual = null;
  if (year && index) {
    const stockReturn = change(close, year.baseClose);
    const indexReturn = change(index, year.baseIndex);
    annual = { stockReturn, indexReturn, excess: stockReturn - indexReturn,
      cutoffPrice: Math.ceil(year.baseClose * (300 + indexReturn) / 100) };
  }
  return { prices: { date: basis.date, close, high15: basis.high14 == null ? null : Math.max(close, basis.high14),
    checks, annual, overheat: basis.overheat }, intraday: true, liveQuote };
}

function noticeLabel(row) {
  if (row.level !== "attention") return levels[row.level];
  if (/지정해제.*재지정/.test(row.reason)) return "재지정 예고";
  if (/투자경고\s*(?:종목\s*)?지정\s*예고/.test(row.reason)) return "경고 예고";
  if (/투자위험\s*(?:종목\s*)?지정\s*예고/.test(row.reason)) return "위험 예고";
  return levels.attention;
}

export function validOfficial(feed, now = Date.now()) {
  const age = now - Date.parse(feed?.checkedAt);
  return age >= -60000 && age <= 12 * 3600000 && feed.officialDate === localDay(now);
}

export function marketWarningBadge(feed, id, now = Date.now()) {
  const row = feed?.stocks?.[id];
  const current = validOfficial(feed, now);
  const notice = row?.official?.active[0];
  if (notice && current) return { label: noticeLabel(notice), tone: notice.level,
    rank: { danger: 90, warning: 80, attention: 60 }[notice.level] };
  const upcoming = row?.official?.upcoming[0];
  if (upcoming && current) {
    const label = noticeLabel(upcoming);
    return { label: label.endsWith("예고") ? label : label.replace("투자", "") + " 예정", tone: upcoming.level, rank: 50 };
  }
  if (!current || !row?.official?.complete) return { label: "확인 대기", tone: "unknown", rank: 30 };
  const priceAge = Date.parse(localDay(now)) - Date.parse(row.prices?.date);
  if (!row.prices || !(priceAge >= 0 && priceAge <= 7 * referenceDayMs) ||
      !row.prices.checks.some(check => Number.isFinite(check.result))) {
    return { label: "시세 미확인", tone: "quiet", rank: 1 };
  }
  const publicChecks = row.prices.checks.filter(check => check.multiple && Number.isFinite(check.result));
  if (publicChecks.some(check => check.pricePass)) return { label: "가격 충족", tone: "price", rank: 40 };
  const close = row.prices.close;
  if (publicChecks.some(check => check.cutoffPrice - close <= close * monitorGap)) {
    return { label: "가격 근접", tone: "price", rank: 35 };
  }
  if (row.prices.checks.some(check => !check.multiple && check.pricePass) ||
      row.prices.annual?.excess >= 200) return { label: "추가 요건", tone: "price", rank: 34 };
  if (row.prices.checks.some(check => !check.multiple && Number.isFinite(check.cutoffPrice) &&
    check.cutoffPrice - close <= close * monitorGap) ||
    row.prices.annual?.cutoffPrice - close <= close * monitorGap) {
    return { label: "조건 근접", tone: "price", rank: 33 };
  }
  return { label: "—", tone: "quiet", rank: 0 };
}

function approvalLine(row) {
  const until = row.released ? ` / 해제 ${esc(row.released)}` : "";
  const why = row.reason ? ` / ${esc(row.reason)}` : "";
  return `<li><strong>${esc(levels[row.level])}</strong> ${esc(row.effective)}${until}${why}</li>`;
}

function warningActions(prices, market) {
  if (!prices || !usablePrice(prices.close)) return { closest: null, crossed: [] };
  const candidates = prices.checks.map(rule => ({ ...rule, passed: rule.pricePass,
    text: `${rule.days}거래일 +${rule.threshold}%`, accounts: !rule.multiple }));
  if (prices.annual) candidates.push({ ...prices.annual, passed: prices.annual.excess >= 200,
    text: "1년 지수 대비 +200%p", accounts: true });
  const available = candidates.filter(rule => usablePrice(rule.cutoffPrice)).map(rule => ({
    ...rule, cutoffPrice: market === "KOSDAQ" ? kosdaqPriceLevel(rule.cutoffPrice) : rule.cutoffPrice,
  }));
  available.sort((a, b) => Math.abs(a.cutoffPrice - prices.close) - Math.abs(b.cutoffPrice - prices.close));
  const crossed = available.filter(rule => rule.passed);
  return { closest: available.find(rule => !rule.passed) || crossed[0] || null, crossed };
}

function actionRow(title, text, cutoff, price, condition, passed = price >= cutoff) {
  const target = usablePrice(cutoff) ? `${won(cutoff)}<small> 이상</small>` : "기준 자료 없음";
  const distance = !usablePrice(cutoff) ? "" : passed ? "가격 요건 도달" :
    `가격 기준까지 ${fmtPct(gap(price, cutoff), 2)}`;
  return `<li class="warning-action">
    <div><h3>${title}</h3><p>${text}</p></div>
    <div class="warning-action-price"><strong>${target}</strong><span>${distance}</span></div>
    <p class="warning-action-note">${condition}</p>
  </li>`;
}

export function shortHeatView(view, quote, snapshot, now = Date.now()) {
  const today = localDay(now);
  const age = now - Date.parse(snapshot?.checkedAt);
  if (freshRegular(quote, now) && snapshot?.live?.date === today && age >= -60000 && age <= 12 * 60000) {
    return { ...snapshot.live, close: quote.p, at: snapshot.checkedAt, live: true };
  }
  const closed = snapshot?.closed;
  const daysAgo = Date.parse(today) - Date.parse(closed?.date);
  if (daysAgo >= 0 && daysAgo <= 7 * referenceDayMs) return closed;
  const overheat = view.prices?.overheat;
  return { date: view.prices?.date, close: view.prices?.close, averageClose: overheat?.average,
    live: view.intraday };
}

function shortHeatRow(label, value, threshold, current, minimum) {
  const status = !Number.isFinite(value) ? ["unknown", "자료 없음"] :
    value >= threshold ? ["pass", "충족"] : ["miss", "미충족"];
  return `<tr><th scope="row">${label}</th><td>${current}</td><td>${minimum}</td>
    <td><span class="short-heat-result is-${status[0]}">${status[1]}</span></td></tr>`;
}

function multiple(value, threshold) {
  if (!Number.isFinite(value)) return "—";
  if (value < threshold && Number(value.toFixed(2)) >= threshold) return `&lt; ${threshold}배`;
  return `${value.toFixed(2)}배`;
}

function renderShortHeat(view, quote, market, snapshot) {
  const data = shortHeatView(view, quote, snapshot);
  const cutoff = usablePrice(data.averageClose) ? Math.ceil(data.averageClose * 13 / 10) : null;
  const level = market === "KOSDAQ" ? kosdaqPriceLevel(cutoff) : cutoff;
  const at = Date.parse(data.at);
  const asOf = Number.isFinite(at) ? `장중 추정, 지표 ${timeLabel.format(at)}` :
    data.date ? `${dateLabel(data.date)} ${data.live ? "장중 추정" : "정규장 추정"}` : "조회 대기";
  const price = usablePrice(data.close) && level ? data.close : null;
  return `<li class="warning-action short-heat">
    <div><h3>단기과열 / 30분 단일가</h3></div>
    <span class="short-heat-as-of">${asOf}</span>
    <table aria-label="단기과열 세 가지 요건">
      <thead><tr><th scope="col">요건</th><th scope="col">현재</th><th scope="col">기준</th><th scope="col">판정</th></tr></thead>
      <tbody>
        ${shortHeatRow("주가", price, level, usablePrice(data.close) ? won(data.close) : "—", level ? won(level) + " 이상" : "—")}
        ${shortHeatRow("거래회전율", data.turnover, 6, multiple(data.turnover, 6), "6.00배 이상")}
        ${shortHeatRow("일중 변동성", data.volatility, 1.5, multiple(data.volatility, 1.5), "1.50배 이상")}
      </tbody>
    </table>
    <p class="warning-action-note">주가는 직전 40거래일 평균 종가의 130%, 나머지는 최근 2거래일 평균을 직전 40거래일 평균과 비교합니다. 실제 지정에는 세 요건 충족과 함께 예고 이력과 종가 상승 요건도 적용됩니다.</p>
  </li>`;
}

function renderPriceOverview(view, quote, market, shortHeat) {
  const { prices, intraday, liveQuote } = view;
  const { closest: reference, crossed } = warningActions(prices, market);
  const source = quote?.nxt ? "NXT 프리마켓" : quote?.src === "kiwoom" ? "키움" :
    quote?.src === "naver" ? "네이버 금융" : "종목표 시세";
  const timing = liveQuote ? (quote.src === "kiwoom" ? "실시간" : "장중") : "최근 체결";
  const at = Date.parse(quote?.at);
  const quoteInfo = Number.isFinite(at)
    ? `${source} ${timing} <time datetime="${esc(quote.at)}">${dateLabel(localDay(at))} ${timeLabel.format(at)}</time>`
    : "시세 수신 대기";
  const basis = intraday ? "오늘 이 가격으로 정규장이 끝난다고 가정" :
    prices ? `${dateLabel(prices.date)} 정규장 종가 ${won(prices.close)} 기준` : "비교 기준 자료 없음";
  const attentionCondition = reference?.accounts ? "계좌 매매 조건도 확인해야 합니다." :
    "경고 지정 여부는 예고와 최고 종가, 지수 요건 등도 봅니다.";
  return `<section class="warning-quote" aria-label="현재가">
    <div><span>현재가</span><strong>${won(quote?.p)}</strong></div>
    <p>${quoteInfo}</p>
  </section>
  <section class="warning-comparison" aria-label="시장경보와 단기과열 요건">
    <p class="warning-basis">${basis}</p>
    <ul>
      ${actionRow("투자주의 / 경고 예고", reference?.text || "급등 가격 기준", reference?.cutoffPrice,
        prices?.close, attentionCondition + (crossed.length
          ? `<span>이미 도달한 가격 요건: ${crossed.map(rule => rule.text).join(", ")}</span>` : ""), reference?.passed)}
      ${renderShortHeat(view, quote, market, shortHeat)}
    </ul>
  </section>`;
}

function priceTable(prices, intraday) {
  if (!prices) return "<p>비교할 거래일 종가가 부족합니다.</p>";
  const close = prices.close;
  const high = prices.high15 === null ? "확인 불가" : `${won(prices.high15)}${close >= prices.high15 ? " (최고가)" : ""}`;
  const target = value => value == null ? "—" : `${won(value)}${value > close ?
    `<span class="warning-muted">필요 ${fmtPct(gap(close, value), 2)}</span>` : ""}`;
  const lines = prices.checks.map(check => {
    const change = check.result === null ? "자료 없음" : fmtPct(check.result, 2);
    const index = check.multiple ? (check.indexReturn == null ? "자료 없음" :
      `${fmtPct(check.indexReturn, 2)} × ${check.multiple}배 / ${check.indexPass ? "충족" : "미충족"}`) : "계좌 자료 필요";
    return `<tr><th scope="row">${reasons[check.id]}<span>${check.days}거래일 +${check.threshold}%</span></th>
      <td>${change}</td><td title="${esc(check.baseDate || "")}">${target(check.cutoffPrice)}</td><td>${index}</td></tr>`;
  }).join("");
  const annual = prices.annual;
  const annualPrice = annual ? fmtPct(annual.excess, 2).replace("%", "%p") : "자료 없음";
  const annualHint = annual ? `종목 ${fmtPct(annual.stockReturn, 2)}, 지수 ${fmtPct(annual.indexReturn, 2)}` : "시장지수 대비";
  return `<p>${esc(prices.date)} ${intraday ? "현재가를 종가로 가정" : "정규장 수정종가"} <strong>${won(close)}</strong>
    / 최근 15거래일 ${intraday ? "비교 최고가" : "최고 종가"} ${high}</p>
    <div class="warning-table-wrap"><table class="warning-rules">
      <thead><tr><th scope="col">요건 유형</th><th scope="col">종목 상승률</th><th scope="col">산술 기준가</th><th scope="col">지수 / 계좌</th></tr></thead>
      <tbody>${lines}
        <tr><th scope="row">초장기상승<span>1년 초과수익 +200%p</span></th><td title="${annualHint}">${annualPrice}</td><td>${target(annual?.cutoffPrice)}</td><td>계좌 자료 필요</td></tr>
      </tbody>
    </table></div>`;
}

const kindLink = "https://kind.krx.co.kr/investwarn/investattentwarnrisky.do?method=investattentwarnriskyMain";

export function bindMarketWarnings(dialog) {
  dialog.querySelector("[data-warning-close]").addEventListener("click", () => dialog.close());
}

export function updateMarketWarningPrices(dialog, feed, stock, quote, indexQuote, shortHeat) {
  const row = feed?.stocks?.[stock.id];
  const view = warningPriceView(row, quote, indexQuote);
  for (const [selector, content] of [
    [".warning-overview", renderPriceOverview(view, quote, stock.market, shortHeat)],
    [".warning-rule-data", priceTable(view.prices, view.intraday)],
  ]) {
    const container = dialog.querySelector(selector);
    if (container && container.renderedMarkup !== content) {
      container.renderedMarkup = content;
      container.innerHTML = content;
    }
  }
}

export function showMarketWarnings(dialog, feed, stock, quote, indexQuote, shortHeat) {
  const openSections = [...dialog.querySelectorAll(".warning-breakdown")].map(section => section.open);
  const row = feed?.stocks?.[stock.id];
  const official = row?.official;
  const visible = validOfficial(feed);
  const active = official?.active || [];
  const upcoming = official?.upcoming || [];
  const history = official?.attentionHistory;
  const first = active[0] || upcoming[0];
  const officialStatus = !visible ? "공시 확인 대기" : active.length ? noticeLabel(first) :
    !official?.complete ? "공시 확인 대기" : upcoming.length ? `${noticeLabel(first)} (${dateLabel(first.effective)} 적용)` :
    "지정 내역 없음";
  const counts = history ? `최근 15거래일 투자주의 공시 ${new Set(history.map(item => item.effective)).size}일` :
    "최근 투자주의 이력 확인 대기";
  const head = dialog.querySelector("h2");
  head.textContent = `${stock.name} 시장경보`;
  dialog.querySelector(".warning-detail").innerHTML = `
    <div class="warning-official${visible && first ? ` is-${first.level}` : ""}">
      <div><span>KRX 투자주의/경고/위험</span><strong>${esc(officialStatus)}</strong></div>
      <a href="${kindLink}" target="_blank" rel="noopener noreferrer">${dateLabel(feed?.officialDate) || "공시"} 조회 ↗</a>
    </div>
    <div class="warning-overview"></div>
    <details class="warning-breakdown"><summary>가격 요건 전체 보기</summary>
      <div class="warning-rule-data"></div>
      <p class="warning-muted">네이버 금융 정규장 수정종가 기준. 장중에는 종목표 시세와 당일 지수로 비교합니다. 요약의 기준가는 코스닥 호가단위로 올림했습니다.</p>
      <p class="warning-muted">단기과열 추정은 키움 정규장 일봉과 다음 금융의 일별 상장주식수를 사용합니다. 거래회전율은 KRX와 NXT의 정규장 합산 거래대금, 일중 변동성은 KRX 고가와 저가 기준입니다. 가격 기준에는 수정주가를 반영합니다.</p>
      <a href="${overheatLink}" target="_blank" rel="noopener noreferrer">KRX 단기과열 공시 예시 ↗</a>
    </details>
    <details class="warning-breakdown"><summary>공시 및 투자주의 이력</summary>
      ${first ? `<p>${visible ? "지정 및 예정 내역" : "마지막 조회 내역"}</p><ul>${[...active, ...upcoming].map(approvalLine).join("")}</ul>` : ""}
      <p>${counts}</p>
      ${history?.length ? `<ul>${history.map(approvalLine).join("")}</ul>` : ""}
      <p class="warning-muted">계좌 집중도, 시가총액 예외, 반복지정과 지정예고 후 판단기간 등은 KIND 공시에서 확인하세요.</p>
    </details>`;
  dialog.dataset.stockId = stock.id;
  if (dialog.open) {
    dialog.querySelectorAll(".warning-breakdown").forEach((section, index) => { section.open = Boolean(openSections[index]); });
  }
  updateMarketWarningPrices(dialog, feed, stock, quote, indexQuote, shortHeat);
  if (!dialog.open) dialog.showModal();
}
