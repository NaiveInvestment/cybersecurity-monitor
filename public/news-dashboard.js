import { esc, fmtKst, headlineLink } from "./common.js";
import { fmtKrw, fmtUsd, isIncidentCandidate } from "./lib/incident-metrics.js";
import { majorIncidents } from "./lib/major-incidents.js";
import { publicationDay } from "./lib/news-search.js";
import { materialPolicy } from "./lib/news-briefing.js";
import { incidentSeries, newsPulse } from "./lib/news-pulse.js";

const DAY = 86400000;
const n = (value) => value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const shortDate = (day) => day.slice(5).replace("-", ".");
const label = (v, unit) => v == null ? "자료 없음" : n(v) + unit;

function delta(current, previous, unit) {
  if (current == null || previous == null) return "비교 자료 없음";
  const change = Math.round((current - previous) * 10) / 10;
  if (!change) return "직전과 동일";
  return `직전보다 ${n(Math.abs(change))}${unit} ${change > 0 ? "증가" : "감소"}`;
}

function compareBars(previous, current, unit) {
  return [current, previous].map((v, i) => `<div class="compare-line"><span>${i ? "직전" : "최근"}</span>
    <div class="compare-track">${v == null ? '<span class="missing">자료 없음</span>' : `<svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="${i ? "past" : "now"}" width="${v}" height="6"/></svg>`}</div>
    <b>${v == null ? "—" : label(v, unit)}</b></div>`).join("");
}

function volumeChart(bins) {
  const max = Math.max(1, ...bins.map(bin => bin.count));
  return `<svg class="volume-chart" viewBox="0 0 142 32" preserveAspectRatio="none" role="img" aria-label="직전 7일과 최근 7일의 24시간별 기사 건수">
    ${bins.map((bin,i) => {
      const height = 32 * bin.count / max;
      return `<rect class="${i < 7 ? "past" : "now"}" x="${i * 10 + (i < 7 ? 0 : 3)}" y="${32-height}" width="8" height="${height}"><title>${fmtKst(bin.end)} KST까지 24시간, ${bin.count}건</title></rect>`;
    }).join("")}</svg><div class="volume-axis"><span>직전 7일</span><span>최근 7일</span></div>`;
}

export function renderPulse(region, end, archive, file) {
  const mid = end - 7 * DAY;
  document.querySelector("#pulse-range").textContent = `${fmtKst(mid)} ~ ${fmtKst(end)} KST`;
  const host = document.querySelector("#pulse-metrics");
  const note = document.querySelector("#pulse-method");
  note.textContent = `수집 기사는 URL 중복을 제거해 최근 168시간과 그 앞 168시간을 비교합니다. 막대 하나는 24시간입니다. 속보는 30초마다 조회하며 감지 시각을 표시합니다. 기사 집계에는 정기 수집본만 사용합니다. 침해사고 보도는 해킹 분류 기사 중 원제목에서 실제 침해나 유출 발생을 언급한 기사입니다. 기사와 자동 감지 보도는 수집 피드의 국내외 분류를 따릅니다. 피해 강도는 사건 기록의 지역과 KST 날짜를 기준으로 유출 규모와 금전 피해를 로그 환산해 국내외 13개 7일 구간과 비교한 지수입니다. 규모 미공개, 보도 후보는 제외합니다.${file ? " 리서치 확인 " + file.researchUntil + "까지, 이후 확인 집계는 DeFiLlama만 반영." : ""}`;
  let counts = '<div class="pulse-message">보관 기사 집계 중</div>';
  if (archive?.failed) counts = `<div class="pulse-message">보관 기사 ${archive.failed}일분을 불러오지 못해 기사 비교를 보류했습니다. <button type="button" id="pulse-retry">다시 조회</button></div>`;
  if (archive && !archive.failed) {
    const { bins, previous, current } = newsPulse(archive.items, region, end);
    counts = `<section class="metric"><h4>수집 기사</h4><div class="metric-line"><strong>${n(current.count)}<small>건</small></strong><span>${delta(current.count, previous.count, "건")}</span></div>
      ${volumeChart(bins)}<p>직전 7일 ${n(previous.count)}건</p></section>
      <section class="metric"><h4>침해사고 보도 비중</h4><div class="metric-line"><strong>${label(current.share, "%")}</strong><span>${delta(current.share, previous.share, "%p")}</span></div>
      ${compareBars(previous.share, current.share, "%")}<p>최근 기사 ${n(current.count)}건 중 침해사고 보도 ${n(current.hacking)}건</p></section>`;
  }
  const series = incidentSeries(file, region, end);
  host.innerHTML = counts + historyMetric(series, "count", "확인 집계 사고", "건") +
    historyMetric(series, "value", "확인 피해 강도", "점");
}

function historyMetric(points, key, title, unit) {
  if (!points.length) return `<section class="metric"><h4>${title}</h4><p>사건 자료를 불러오지 못했습니다.</p></section>`;
  const current = points.at(-1)[key], previous = points.at(-2)[key];
  const measured = points.map(p => p[key]).filter(v => v != null);
  const max = key === "value" ? 100 : Math.max(1, ...measured);
  const bars = points.map((point,i) => {
    const value = point[key], x = i * 10 + 1;
    const height = value == null ? 0 : 31 * value / max;
    const tip = `${point.start} ~ ${point.end}, ${label(value, unit)}`;
    const mark = value == null ? `<path class="no-value" d="M${x},30 l5,-4"/>` :
      `<rect class="${i === points.length-1 ? "now" : "past"}" x="${x}" y="${31-height}" width="7" height="${value === 0 ? 1 : height}"/>`;
    return `<g><title>${tip}</title><rect x="${x}" width="8" height="32" fill="transparent"/>${mark}</g>`;
  }).join("");
  const rank = current == null ? "사선은 규모 자료 없음" :
    `관측 ${measured.length}구간 중 ${1+measured.filter(v=>v>current).length}위`;
  return `<section class="metric"><h4>${title}</h4><div class="metric-line"><strong class="${current == null ? "unmeasured" : ""}">${label(current,unit)}</strong>
    <span>직전 ${label(previous, unit)}</span></div>
    <svg class="volume-chart" role="img" aria-label="${title}, 최근 13개 7일 구간" viewBox="0 0 131 32" preserveAspectRatio="none">${bars}</svg>
    <div class="history-axis"><span>${shortDate(points[0].start)}</span><span>${shortDate(points.at(-1).end)}</span></div>
    <p>${rank}</p></section>`;
}

export function renderGlobalPulse(end, archive, file) {
  const host = document.querySelector("#global-metrics");
  document.querySelector("#global-range").textContent = `${fmtKst(end - 7*DAY)} ~ ${fmtKst(end)} KST`;
  const series = incidentSeries(file, "ALL", end);
  let number = '<section class="metric"><h4>수집 기사</h4><p>보관 기사 집계 중</p></section>';
  if (archive && !archive.failed) {
    const { bins, previous, current } = newsPulse(archive.items, "ALL", end);
    number = `<section class="metric"><h4>수집 기사</h4><div class="metric-line"><strong>${n(current.count)}건</strong><span>${delta(current.count, previous.count, "건")}</span></div>
      ${volumeChart(bins)}<p>직전 7일 ${n(previous.count)}건</p></section>`;
  } else if (archive?.failed) number = '<section class="metric"><h4>수집 기사</h4><p>일부 보관 기사 누락 <button type="button" id="global-retry">다시 조회</button></p></section>';
  host.innerHTML = number + historyMetric(series,"count","확인 집계 사고","건") + historyMetric(series,"value","확인 피해 강도","점");
  document.querySelector("#global-method").textContent = "기사는 마지막 수집 시각 기준 최근 168시간과 직전 168시간을 비교합니다. 사고는 날짜만 기록돼 KST 날짜 기준 7일씩 비교합니다. 기사 막대는 24시간, 사고 건수와 피해 강도 막대는 7일입니다. 피해 강도는 국내외 확인 사고의 유출 규모와 금전 피해를 구간별로 합산한 뒤 기존 로그 산식으로 계산한 0~100점 지수입니다. 피해 규모가 발표된 구간만 순위를 매깁니다.";
  document.querySelector("#global-coverage").textContent = file ? `사고 리서치 ${file.researchUntil}까지, 이후 확인 집계는 DeFiLlama만 반영` : "";
}

// Attach follow-up headlines only through the source URL and its existing story group.
function flowEntries(major, articles, groups) {
  const entries = new Map();
  for (const source of major.sources) {
    const match = articles.get(source.u);
    const family = match?.g ? groups.get(match.g) : null;
    for (const item of family || []) {
      if (item.r !== match.r || item.c !== "incident") continue;
      entries.set(item.u, { day: publicationDay(Date.parse(item.d)), item });
    }
    entries.set(source.u, { day: match ? publicationDay(Date.parse(match.d)) : source.d || major.event.d, item: match || {
      u: source.u, t: source.t || source.o, s: source.o,
    } });
  }
  return [...entries.values()].sort((a,b) => a.day.localeCompare(b.day) || (a.item.d || "").localeCompare(b.item.d || ""));
}

function flowRow(major, entries, showRegion = false) {
  const { event, records, loss } = major;
  const impact = [records && event.recUnit ? `영향 규모 ${n(records)}${esc(event.recUnit)}` : "", loss ? `금전 피해 ${event.krw ? fmtKrw(event.krw) : fmtUsd(loss)}` : ""].filter(Boolean).join(", ");
  const meta = isIncidentCandidate(event) ? "보도 기준" : event.via === "DeFiLlama" ? "DeFiLlama 집계" : "리서치 확인";
  const daily = new Map();
  for (const entry of entries) daily.set(entry.day, entry);
  const timeline = [...daily.values()];
  const latest = entries.at(-1)?.item;
  const sourceTitle = major.sources.find(source => source.t && source.t !== source.o);
  return `<article class="flow-event"><div class="flow-date"><time>${shortDate(event.d)}</time><span>${showRegion ? (event.r === "KR" ? "국내 / " : "해외 / ") : ""}${meta}</span></div>
    <h3>${esc(event.n)}</h3>${impact ? `<p class="impact">${impact}</p>` : ""}
    ${latest?.t && latest.t !== latest.s ? `<p class="flow-latest">${headlineLink(latest)}</p>` : sourceTitle ? `<p class="flow-latest"><a href="${esc(sourceTitle.u)}" target="_blank" rel="noopener">${esc(sourceTitle.t)}</a></p>` : ""}
    <details data-event="${esc(event.id)}"><summary>보도 흐름과 원문 ${entries.length}건</summary><ol class="timeline">${timeline.map(({day,item}) =>
      `<li><time>${shortDate(day)}</time><div>${headlineLink(item)}<p class="meta">${esc(item.s)}</p></div></li>`).join("")}</ol>
      ${entries.length > timeline.length ? `<details><summary>같은 날의 다른 원문</summary><ul class="extra-sources">${entries.filter(x => daily.get(x.day) !== x).map(({day,item}) => `<li>${shortDate(day)} ${headlineLink(item)}</li>`).join("")}</ul></details>` : ""}</details></article>`;
}

// Automatic extraction can name the same postal breach after a headline fragment
// and round its exposed population differently across outlets.
function isPostalBreach(major, domesticRecords) {
  if (!major.records || !isIncidentCandidate(major.event)) return false;
  return major.sources.some(source => {
    const title = source.t || major.event.atk || "";
    if (/^Korea Post\b.*(?:breach|leak|expos)/i.test(title)) return true;
    if (major.event.r !== "KR") return false;
    if (/(?:인터넷우체국|우정사업본부).{0,70}(?:유출|뚫렸|해킹)/.test(title)) return true;
    // A generic "post office" must be the sentence subject, and match a named local record.
    const postalSubject = /(?:^|[….,!?]\s*)우체국(?:마저|도|이|서|에서|의|[\s,]).{0,70}(?:유출|뚫렸|해킹)/;
    return postalSubject.test(title) && domesticRecords.some(row =>
      Math.abs(Date.parse(row.event.d) - Date.parse(major.event.d)) <= 7 * DAY &&
      Math.abs(row.records-major.records) <= .05 * Math.min(row.records,major.records));
  });
}

export function majorFlows(events, start, end) {
  const result = [];
  const postal = [];
  const majors = majorIncidents(events, [], start, end);
  const domesticRecords = majors.filter(row => row.event.r === "KR" && /^(인터넷우체국|우정사업본부)$/.test(row.event.n));
  for (const major of majors) {
    if (!isPostalBreach(major, domesticRecords)) {
      result.push(major);
      continue;
    }
    const same = postal.find(row =>
      Math.abs(Date.parse(row.event.d) - Date.parse(major.event.d)) <= 7 * DAY &&
      Math.abs(row.records - major.records) <= .05 * Math.min(row.records, major.records));
    if (same) {
      same.sources = [...new Map([...same.sources, ...major.sources].map(source => [source.u, source])).values()];
    } else {
      const row = { ...major, event: { ...major.event, r: "KR", n: "인터넷우체국" } };
      result.push(row);
      postal.push(row);
    }
  }
  return result;
}

export function renderFlow(file, items, region, end, cards = []) {
  const global = region === "ALL";
  const host = document.querySelector(global ? "#global-issues" : "#major-incidents");
  const open = new Set([...host.querySelectorAll("details[data-event][open]")].map(node => node.dataset.event));
  const openMore = host.querySelector(".flow-more")?.open;
  const majors = file ? majorFlows(file.events, publicationDay(end - 27 * DAY), publicationDay(end)).filter(({event}) => global || event.r === region) : [];
  const articles = new Map(items.map(item => [item.u, item]));
  const groups = new Map();
  for (const item of items) {
    if (!item.g) continue;
    if (!groups.has(item.g)) groups.set(item.g, []);
    groups.get(item.g).push(item);
  }
  if (global) {
    const policy = materialPolicy(items,cards,end);
    const cutoff = publicationDay(end-6*DAY);
    const from = publicationDay(end-27*DAY), through = publicationDay(end);
    const outage = (file?.events || []).filter(event => event.d >= from && event.d <= through &&
      event.src?.some(s => /^https?:\/\//i.test(s.u)) &&
      /(?:서비스|업무|운영|시스템).{0,12}(?:중단됐다|중단됐|중단되|중단$|마비)|(?:shut down|disrupt(?:ed|s)|suspend(?:ed|s)).{0,24}(?:services|operations)/i.test(event.atk || "") &&
      !/가능성|예정|훈련|예방|우려|may |could /i.test(event.atk || "") &&
      !majors.some(row => row.event.id === event.id || row.sources.some(s => event.src.some(t=>t.u===s.u))))
      .map(event => ({event,records:0,loss:0,sources:event.src.filter(s=>/^https?:\/\//i.test(s.u))}));
    const scored = [...majors,...outage].map(major => {
      const entries = flowEntries(major,articles,groups).filter(e=>e.day <= through);
      const updated = entries.at(-1)?.day || major.event.d;
      return { major, entries, updated, scale:Math.max(major.records/50000,major.loss/10000000,1) };
    }).sort((a,b) => Number(b.updated >= cutoff)-Number(a.updated >= cutoff) ||
      (b.updated >= cutoff && a.updated >= cutoff ? b.scale-a.scale : 0) || b.updated.localeCompare(a.updated));
    const seen = new Set();
    const distinct = scored.filter(({major,entries}) => {
      const urls = entries.map(({item})=>item.u);
      if (!urls.length || urls.some(u=>seen.has(u))) return false;
      for (const url of urls) seen.add(url);
      return true;
    });
    const first = distinct[0];
    const rest = distinct.slice(1).sort((a,b) => b.updated.localeCompare(a.updated) ||
      b.entries.length-a.entries.length || b.scale-a.scale);
    const selected = first ? [first,...rest.slice(0,policy ? 1 : 2)] : [];
    let html = selected.map(({major,entries})=>flowRow(major,entries,true)).join("");
    if (policy) {
      const ordered = [...policy.entries].sort((a,b)=>a.d.localeCompare(b.d));
      html += `<article class="flow-event policy-issue"><div class="flow-date"><time>${shortDate(publicationDay(Date.parse(policy.date)))}</time><span>${policy.region === "KR" ? "국내" : "해외"} / ${policy.kind}</span></div>
        <h3><a href="${esc(policy.url)}" target="_blank" rel="noopener">${esc(policy.title)}</a></h3>${policy.claim ? `<p class="flow-latest">${esc(policy.claim)}</p>` : ""}
        <details data-event="policy-${esc(policy.entries[0].u)}"><summary>보도 흐름과 원문 ${ordered.length}건</summary><ol class="timeline">
        ${ordered.map(item=>`<li><time>${shortDate(publicationDay(Date.parse(item.d)))}</time><div>${headlineLink(item)}<p class="meta">${esc(item.s)}</p></div></li>`).join("")}</ol></details></article>`;
    }
    host.innerHTML = html || '<p class="empty">최근 4주 자료에서 선정 기준을 충족한 이슈가 없습니다.</p>';
  } else {
    const rows = majors.map(major => flowRow(major, flowEntries(major, articles, groups)));
    host.innerHTML = rows.slice(0, 3).join("") + (rows.length > 3 ? `<details class="flow-more"><summary>주요 사고 ${rows.length - 3}건 더 보기</summary>${rows.slice(3).join("")}</details>` : "")
      || `<p class="empty">${file ? "이 기간에 선정 기준을 충족한 사고가 없습니다." : "사고 기록을 불러오지 못했습니다."}</p>`;
  }
  host.querySelectorAll("details[data-event]").forEach(node => { node.open = open.has(node.dataset.event); });
  if (openMore && host.querySelector(".flow-more")) host.querySelector(".flow-more").open = true;
}
