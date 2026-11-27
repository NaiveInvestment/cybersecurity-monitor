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

function priceTable(prices) {
  if (!prices) return "<p>비교할 거래일 종가가 부족합니다.</p>";
  const close = prices.close;
  const high = prices.high15 === null ? "확인 불가" : `${won(prices.high15)}${close >= prices.high15 ? " (최고가)" : ""}`;
  const target = value => value == null ? "—" : `${won(value)}${value > close ?
    `<span class="warning-muted">필요 ${fmtPct(100 * (value - close) / close, 2)}</span>` : ""}`;
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
  return `<p>${esc(prices.date)} 종가 <strong>${won(close)}</strong> / 최근 15거래일 최고 종가 ${high}</p>
    <div class="warning-table-wrap"><table class="warning-rules">
      <thead><tr><th scope="col">요건 유형</th><th scope="col">종목 상승률</th><th scope="col">가격 계산값</th><th scope="col">지수 / 계좌</th></tr></thead>
      <tbody>${lines}
        <tr><th scope="row">초장기상승<span>1년 초과 +200%p</span></th><td title="${annualHint}">${annualPrice}</td><td>${target(annual?.cutoffPrice)}</td><td>계좌 자료 필요</td></tr>
      </tbody>
    </table></div>`;
}

const kindLink = "https://kind.krx.co.kr/investwarn/investattentwarnrisky.do?method=investattentwarnriskyMain";

export function bindMarketWarnings(dialog) {
  dialog.querySelector("[data-warning-close]").addEventListener("click", () => dialog.close());
}

export function showMarketWarnings(dialog, feed, stock) {
  const row = feed?.stocks?.[stock.id];
  const official = row?.official;
  const visible = validOfficial(feed);
  const active = official?.active || [];
  const upcoming = official?.upcoming || [];
  const history = official?.attentionHistory;
  const officialStatus = !visible || !official?.complete ? "KRX 전체 목록 확인 대기" :
    (active.length ? "현재 지정" : "현재 지정 내역 없음");
  const counts = history ? `최근 15거래일 투자주의 공시 ${new Set(history.map(item => item.effective)).size}일` :
    "최근 투자주의 이력 확인 대기";
  const head = dialog.querySelector("h2");
  head.textContent = `${stock.name} 시장경보`;
  dialog.querySelector(".warning-detail").innerHTML = `
    <section><h3>한국거래소 공식 공시</h3>
      <p>${esc(feed?.officialDate || "기준일 없음")} / ${officialStatus}</p>
      ${(active.length || upcoming.length) ? `<ul>${[...active, ...upcoming].map(approvalLine).join("")}</ul>` : ""}
      <p>${counts}<span class="warning-muted"> / 반복지정 규정상 제외 유형은 별도 적용</span></p>
      ${history?.length ? `<details><summary>최근 투자주의 사유</summary><ul>${history.map(approvalLine).join("")}</ul></details>` : ""}
      <p class="warning-muted">투자주의의 소수계좌 또는 소수지점 집중, 종가급변, 단일계좌 거래량, 상한가 잔량 등은 KRX 공시에서 확인합니다.</p>
    </section>
    <section><h3>공개 종가로 보는 가격 요건</h3>
      ${priceTable(row?.prices)}
      <p class="warning-muted">네이버 금융의 정규장 수정종가로 계산합니다. ‘가격 근접’과 ‘조건 근접’은 각 유형의 가격 기준까지 5% 이내일 때 표시합니다. 계좌 조건이 있는 유형은 상승률에 도달하면 ‘추가 요건’으로 표시합니다.</p>
      <p class="warning-muted">지정예고 후 판단기간, 계좌 매매 집중도, 시가총액 예외, 투자주의 반복지정, 재지정과 투자위험 전환은 KIND 공시를 확인하세요.</p>
    </section>
    <a href="${kindLink}" target="_blank" rel="noopener noreferrer">KRX KIND 시장경보 공시 ↗</a>`;
  dialog.showModal();
}
