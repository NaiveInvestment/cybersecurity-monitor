import { esc, fmtKst, initTheme, loadJson, signClass } from "./common.js";

const byId = (id) => document.getElementById("position-" + id);
const search = byId("search");
const hardware = byId("hardware");
const body = byId("body");
const empty = byId("empty");
const count = byId("count");
const quoteTime = byId("quote-time");
const sectorTitle = byId("sector-title");
const sectorPanel = byId("sector");
const sectorDocuments = document.createElement("div");
const sectorRevenue = document.querySelector(".position-sector-revenue");
const eventPanel = document.querySelector(".position-sector-event");
const eventTitle = byId("event-title");
const sectorContext = document.querySelector(".position-sector-context");
const connectionHeading = byId("connection-heading");
const sectorFunction = document.querySelector(".position-sector-function");
const sectorDevelopment = document.querySelector(".position-sector-development");
const sectorTrigger = document.querySelector(".position-sector-trigger");
const sectorSources = document.querySelector(".position-sector-sources");
const lookupHeading = document.getElementById("lookup-heading");
const buttons = new Map(
  [...byId("map").querySelectorAll("[data-sector]"), hardware].map((button) => [button.dataset.sector, button])
);
const won = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const legacySectors = new Map(Object.entries({
  auth: "iam", patch: "exposure", detect: "soc", saas: "transfer", n2sf: "transfer", resilience: "data",
}));
const quotes = new Map();
const expanded = new Set();
const percent = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
const quoteSources = { kiwoom: "키움", naver: "네이버" };
let active;
let data;
let sectors;
let sectorReports;
let stocks;
let polling = false;
let pendingQuotes = false;

function ttm({ priorYear, currentYtd, priorYtd } = {}) {
  return [priorYear, currentYtd, priorYtd].every(Number.isSafeInteger)
    ? priorYear + currentYtd - priorYtd : null;
}

function amount(value) {
  return value == null ? "—" : won.format(Math.abs(value) < 0.05 ? 0 : value);
}

function source(url, label) {
  return `<a class="position-ref" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`;
}

function filing(receipt, label) {
  return receipt ? source("https://dart.fss.or.kr/dsaf001/main.do?rcpNo=" + receipt, label) : "";
}

function quoteLabel(quote) {
  if (!quote) return "시총 자료 없음";
  const provider = quoteSources[quote.src] ?? "기존 시세";
  const time = quote.at ? `${fmtKst(quote.at)} KST` : "";
  return [time, provider].filter(Boolean).join(", ");
}

function setQuote(id, cap, at, src) {
  if (!Number.isFinite(cap) || cap <= 0) return false;
  const parsed = Date.parse(at);
  const ms = Number.isFinite(parsed) ? parsed : -Infinity;
  const previous = quotes.get(id);
  if (previous && (ms < previous.ms || (ms === previous.ms && cap === previous.cap && src === previous.src))) return false;
  quotes.set(id, { cap, at: Number.isFinite(parsed) ? at : null, ms, src });
  return true;
}

function financialCell(key, label, value, title = "") {
  const display = amount(value == null ? null : value / 1e8);
  const color = key === "revenue" ? "" : signClass(value);
  return `<td class="position-number position-${key}" data-amount-krw="${value ?? ""}">
    <span class="position-mobile-label">${label}</span><span class="${color}" title="${esc(title)}">${display}</span>
  </td>`;
}

function mixItems(items) {
  return items.map(({ label, pct }) => `<li><span>${esc(label)}</span> <strong>${percent.format(pct)}%</strong></li>`).join("");
}

function validReports(list) {
  return Array.isArray(list)
    ? list.filter((report) => typeof report?.href === "string"
      && /^reports\/[a-f0-9]{64}\.pdf$(?![\s\S])/.test(report.href)
      && typeof report.title === "string" && report.title.trim())
    : [];
}

function renderReportList(reports) {
  const items = reports.map(({ href, title, date, provider, kind }) => {
    const metadata = [date, provider, kind].filter((value) => typeof value === "string" && value.trim()).join(", ");
    return `<li>
      <a href="report-view.html?pdf=${href.slice(8, -4)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>
      ${metadata ? `<span class="position-sub">${esc(metadata)}</span>` : ""}
    </li>`;
  }).join("");
  return `<ul class="position-report-list">${items}</ul>`;
}

function stockRow(stock, sector) {
  const { id, name, product, note, finance, role, other, mix, exposures } = stock;
  const exposure = exposures[sector];
  const quote = quotes.get(id);
  const isOpen = expanded.has(id);
  const basis = finance.basis === "OFS" ? "별도" : "연결";
  const netBasis = finance.ni?.scope === "parent" ? "지배주주 순이익" : "당기순이익";
  const labels = [role, ...other].map((key) => data.roles[key]).join(" / ");
  const mixBasis = mix?.basis === "OFS" ? "별도" : "연결";

  const fullMix = mix
    ? `<div><h3>매출 비중</h3><p class="position-sub">2026년 3분기 누적, ${mixBasis}</p>
       <ul class="position-mix-full">${mixItems(mix.items)}</ul>
       ${mix.note ? `<p class="position-sub position-detail-note">${esc(mix.note)}</p>` : ""}
       ${source(mix.url, "매출 비중 공시")}</div>`
    : "";

  return `<tr class="position-row" data-stock="${id}">
    <th scope="row" class="position-stub">
      <button type="button" class="position-company" data-stock-toggle="${id}" aria-controls="position-details-${id}" aria-expanded="${isOpen}">${esc(name)}</button>
    </th>
    <td class="position-connection">
      <span class="position-product">${esc(exposure?.product ?? product)}</span>
      <span class="position-relevance">${esc(exposure?.connection ?? (sector ? "이 분야의 제품 또는 공급 사례 확인이 필요합니다." : "대표 분야 " + data.roles[role]))}</span>
    </td>
    <td class="position-number position-cap" data-cap-krw="${quote?.cap ?? ""}">
      <span class="position-mobile-label">시가총액</span><span title="${esc(quoteLabel(quote))}">${amount(quote?.cap)}</span>
    </td>
    ${financialCell("revenue", "매출", ttm(finance.rev))}
    ${financialCell("profit", "영업이익", ttm(finance.op))}
    ${financialCell("net", "순이익", ttm(finance.ni), basis + " " + netBasis)}
  </tr>
  <tr class="position-details-row" id="position-details-${id}"${isOpen ? "" : " hidden"}><td colspan="6">
    <div class="position-details">
      <div><h3>제품과 사업</h3><p>${esc(product)}</p><p class="position-sub">${esc(labels)}</p>
        <p class="position-detail-note">${esc(note)}</p><div class="position-detail-links">${stock.source ? source(stock.source, "제품 자료") : ""}${exposure?.evidence ? source(exposure.evidence.url, exposure.evidence.label) : ""}</div></div>
      <div><h3>실적 기준</h3><p>${basis} / ${netBasis}</p>
        <p class="position-sub">2026년 3분기 영업이익 ${amount(finance.op.quarter == null ? null : finance.op.quarter / 1e8)}억원</p>
        <div class="position-detail-links">${filing(finance.quarterReceipt, "분기 공시")}${filing(finance.annualReceipt, "연간 공시")}</div></div>
      ${fullMix}
      ${stock.reports.length ? `<div class="position-reports"><h3>기업 리포트와 IR 자료</h3>${renderReportList(stock.reports)}</div>` : ""}
    </div>
  </td></tr>`;
}

function normalizeSearch(value) {
  return value.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}
function renderStocks() {
  const query = normalizeSearch(search.value);
  const matches = stocks.filter((stock) => query
    ? stock.searchText.includes(query)
    : active === "all" || stock.role === active || stock.other.includes(active)
  );
  lookupHeading.textContent = query
    ? "전체 종목 검색"
    : active === "all" ? "전체 종목" : sectorTitle.textContent + " 관련 종목";
  matches.sort((a, b) => (quotes.get(b.id)?.cap ?? 0) - (quotes.get(a.id)?.cap ?? 0)
    || a.name.localeCompare(b.name, "ko-KR"));

  const exposureSector = query || active === "all" ? null : active;
  connectionHeading.textContent = exposureSector ? "제품과 연결 근거" : "주요 제품과 사업";
  body.innerHTML = matches.map((stock) => stockRow(stock, exposureSector)).join("");
  const resultCount = `${matches.length}개 종목`;
  if (count.textContent !== resultCount) count.textContent = resultCount;
  empty.hidden = matches.length > 0;
  empty.textContent = matches.length ? "" : "검색 조건에 맞는 종목이 없습니다.";

  const shownQuotes = matches.map((stock) => quotes.get(stock.id)).filter(Boolean);
  const latest = shownQuotes.reduce((previous, quote) => !previous || quote.ms > previous.ms ? quote : previous, null);
  quoteTime.textContent = latest?.at ? `최신 시세 ${fmtKst(latest.at)} KST` : "";
  pendingQuotes = false;
}

function renderSector(section, label, key) {
  const all = !section;
  const notes = section?.context ?? [];
  sectorPanel.classList.toggle("is-overview", all);
  sectorTitle.textContent = label;
  sectorFunction.textContent = section?.function ?? `국내 보안주 ${stocks.length}개를 시가총액순으로 비교합니다.`;
  sectorRevenue.textContent = section?.revenueModel ?? "";
  sectorRevenue.hidden = all;
  eventPanel.hidden = all;
  eventTitle.textContent = section?.eventTitle ?? "";
  sectorDevelopment.textContent = section?.development ?? "";
  sectorTrigger.textContent = section?.trigger ?? "";
  sectorSources.innerHTML = (section?.sources ?? []).map(({ url, label }) => source(url, label)).join("");
  sectorContext.hidden = !notes.length;
  sectorContext.innerHTML = notes.map(({ title, text, milestones = [], sources = [] }) => `
    <div class="position-context-card">
      <h4>${esc(title)}</h4>
      ${text ? `<p>${esc(text)}</p>` : ""}
      ${milestones.length ? `<dl>${milestones.map(({ when, text }) => `<div><dt>${esc(when)}</dt><dd>${esc(text)}</dd></div>`).join("")}</dl>` : ""}
      <div class="position-sector-sources">${sources.map(({ url, label }) => source(url, label)).join("")}</div>
    </div>`).join("");
  const reports = key === "all" ? sectorReports : sectorReports.filter(({ roles }) => Array.isArray(roles) && roles.includes(key));
  sectorDocuments.hidden = !reports.length;
  sectorDocuments.innerHTML = reports.length
    ? `<details><summary>업종과 정책 자료</summary>${renderReportList(reports)}</details>`
    : "";
}

function selectSector(key, updateUrl = false) {
  active = key;
  for (const [sector, button] of buttons) {
    button.setAttribute("aria-pressed", String(sector === key));
  }
  for (const step of byId("map").querySelectorAll(".position-step")) {
    step.classList.toggle("is-selected", Boolean(step.querySelector('[aria-pressed="true"]')));
  }
  const all = key === "all";
  hardware.hidden = !all && key !== "hardware";
  renderSector(all ? null : sectors[key], buttons.get(key).textContent.trim(), key);
  search.value = "";
  renderStocks();

  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set("sector", key);
    url.searchParams.delete("issue");
    history.replaceState(null, "", url);
  }
}

async function refreshQuotes(url) {
  if (polling || document.hidden) return;
  polling = true;
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3500) });
    if (!response.ok) return;
    const { q } = await response.json();
    let changed = false;
    for (const { id } of stocks) {
      const row = q?.[id];
      if (Array.isArray(row) && Number.isFinite(Date.parse(row[5]))) {
        changed = setQuote(id, row[3], row[5], row[7]) || changed;
      }
    }
    if (changed) {
      if (body.contains(document.activeElement)) pendingQuotes = true;
      else renderStocks();
    }
  } catch {
    // Keep the latest usable quotes when the live feed is temporarily unavailable.
  } finally {
    polling = false;
  }
}

async function start() {
  initTheme();
  const [positions, guides, connections, businessMix, reportLibrary, snapshot, meta] = await Promise.all([
    loadJson("data/positions.json"),
    loadJson("data/position-sectors.json"),
    loadJson("data/position-exposure.json"),
    loadJson("data/position-mix.json").catch(() => null),
    document.body.hasAttribute("data-report-library") ? loadJson("data/position-library.json").catch(() => null) : null,
    loadJson("data/snapshot.json").catch(() => null),
    loadJson("data/meta.json").catch(() => null),
  ]);
  data = positions;
  sectors = guides;
  sectorReports = validReports(reportLibrary?.sector);
  sectorDocuments.className = "position-sector-documents";
  sectorPanel.append(sectorDocuments);
  stocks = data.stocks.map((stock) => {
    const mix = businessMix?.byId?.[stock.id];
    const reports = validReports(reportLibrary?.byId?.[stock.id]);
    const roles = [stock.role, ...stock.other];
    const exposures = Object.fromEntries(roles.map((role) => [role, connections[role]?.[stock.id]]));
    const terms = [stock.name, stock.id, stock.product, ...roles.map((role) => data.roles[role]),
      ...Object.values(exposures).map((exposure) => exposure?.product), ...(mix?.items.map((item) => item.label) ?? [])];
    return { ...stock, mix, exposures, reports, searchText: normalizeSearch(terms.join(" ")) };
  });
  for (const { id, q } of snapshot?.stocks ?? []) {
    if (q) setQuote(id, q.capKrw, q.at, q.src);
  }

  byId("date").textContent = `공시 ${data.asOf} 기준`;
  for (const [key, button] of buttons) {
    button.setAttribute("aria-controls", "position-sector position-company-section");
    button.addEventListener("click", () => selectSector(key === "hardware" && active === key ? "all" : key, true));
  }
  search.closest("label").hidden = false;
  search.addEventListener("input", renderStocks);
  body.addEventListener("click", (event) => {
    const button = event.target.closest("[data-stock-toggle]");
    if (!button) return;
    const id = button.dataset.stockToggle;
    const open = !expanded.has(id);
    if (open) expanded.add(id);
    else expanded.delete(id);
    document.getElementById("position-details-" + id).hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  });
  body.addEventListener("focusout", () => requestAnimationFrame(() => {
    if (pendingQuotes && !body.contains(document.activeElement)) renderStocks();
  }));

  const params = new URLSearchParams(location.search);
  const initial = params.get("sector");
  selectSector(buttons.has(initial) ? initial : legacySectors.get(params.get("issue")) ?? "transfer");

  if (meta?.live?.url) {
    const poll = () => refreshQuotes(meta.live.url);
    void poll();
    setInterval(poll, meta.live.interval || 2000);
    document.addEventListener("visibilitychange", poll);
  }
}

start().catch((error) => {
  sectorFunction.textContent = "분야별 자료를 불러오지 못했습니다. 페이지를 새로고침해 주세요.";
  count.textContent = "종목 자료를 불러오지 못했습니다.";
  console.error(error);
});
