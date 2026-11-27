const MAX_AGE = 45 * 60 * 1000;
const STORAGE_KEY = "csm-seen-security-alerts";
const localHost = location.hostname === "127.0.0.1" || location.hostname === "localhost";
const formatTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function stored() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function activeAlerts(alerts) {
  const now = Date.now();
  const urls = new Set();
  return alerts.filter(alert => {
    if (!alert) return false;
    const age = now - Date.parse(alert.detectedAt);
    return age >= -60000 && age <= MAX_AGE && alert.id && alert.title && /^https?:\/\//i.test(alert.url);
  }).sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt)).filter(alert => {
    if (urls.has(alert.url)) return false;
    urls.add(alert.url);
    return true;
  });
}

function timeLabel(cell, at) {
  cell.dateTime = at;
  cell.textContent = formatTime.format(Date.parse(at)) + " KST";
}

function createWidget(feedUrl) {
  const widget = document.createElement("aside");
  widget.className = "security-alert-widget";
  widget.setAttribute("aria-label", "보안 알림");
  widget.innerHTML = `
    <section class="security-alert-card security-alert" hidden>
      <div class="security-alert-top">
        <div class="security-alert-heading"><strong>실시간 보안 뉴스</strong><time></time></div>
        <button type="button" class="security-alert-close" aria-label="알림 닫기">×</button>
      </div>
      <div class="security-alert-content">
        <div role="status" class="security-alert-announcement">
          <p class="security-alert-title"></p>
          <p class="security-alert-meta"><span class="security-alert-source"></span></p>
        </div>
        <div class="security-alert-actions">
          <a class="security-alert-link" target="_blank" rel="noopener noreferrer">기사 보기 <span aria-hidden="true">↗</span></a>
          <button type="button" class="security-alert-history-button">최근 알림</button>
        </div>
      </div>
    </section>
    <section id="security-alert-history" class="security-alert-card security-alert-history" aria-labelledby="security-history-title" hidden>
      <div class="security-alert-top">
        <div><strong id="security-history-title">최근 보안 알림</strong><span class="security-alert-period">최근 45분</span></div>
        <button type="button" class="security-alert-close" aria-label="최근 알림 닫기">×</button>
      </div>
      <ul class="security-alert-list"></ul>
    </section>
    <button type="button" class="security-alert-launcher" aria-controls="security-alert-history" hidden>보안 알림<span></span></button>`;

  const notice = widget.querySelector(".security-alert");
  const history = widget.querySelector(".security-alert-history");
  const launcher = widget.querySelector(".security-alert-launcher");
  const closeNotice = notice.querySelector(".security-alert-close");
  const closeHistory = history.querySelector(".security-alert-close");
  const seen = new Set(stored());
  let recent = [], active, loading = false;

  function remember(alerts) {
    for (const alert of alerts) seen.add(alert.id);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set([...stored(), ...seen])].slice(-100))); }
    catch { /* The current page still remembers alerts if storage is unavailable. */ }
  }

  function showLauncher() {
    launcher.hidden = Boolean(active) || !history.hidden || localHost && recent.length === 0;
    launcher.querySelector("span").textContent = String(recent.length);
    launcher.setAttribute("aria-label", "최근 보안 알림 " + recent.length + "건");
  }

  function showNext() {
    if (active || !history.hidden || document.hidden) return;
    const past = new Set(stored());
    active = recent.find(alert => !seen.has(alert.id) && !past.has(alert.id));
    if (active) {
      notice.hidden = false;
      notice.querySelector(".security-alert-title").textContent = active.title;
      notice.querySelector(".security-alert-source").textContent = active.source || "";
      timeLabel(notice.querySelector("time"), active.detectedAt);
      notice.querySelector("a").href = active.url;
      remember([active]);
    }
    showLauncher();
  }

  function populateHistory() {
    const rows = recent.map(alert => {
      const row = document.createElement("li");
      const link = document.createElement("a");
      link.href = alert.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = alert.title;
      const meta = document.createElement("p");
      meta.className = "security-alert-meta";
      const source = document.createElement("span");
      source.textContent = alert.source || "";
      const time = document.createElement("time");
      timeLabel(time, alert.detectedAt);
      meta.append(source, time);
      row.append(link, meta);
      return row;
    });
    history.querySelector("ul").replaceChildren(...rows);
    if (!rows.length) {
      const empty = document.createElement("li");
      empty.textContent = "최근 45분 새 알림 없음";
      history.querySelector("ul").append(empty);
    }
    remember(recent);
  }

  function openHistory() {
    active = null;
    notice.hidden = true;
    history.hidden = false;
    populateHistory();
    showLauncher();
    closeHistory.focus();
  }

  function dismiss() {
    if (!history.hidden) history.hidden = true;
    else {
      active = null;
      notice.hidden = true;
    }
    showNext();
    if (active) closeNotice.focus();
    else if (!launcher.hidden) launcher.focus();
  }

  launcher.addEventListener("click", openHistory);
  notice.querySelector(".security-alert-history-button").addEventListener("click", openHistory);
  closeNotice.addEventListener("click", dismiss);
  closeHistory.addEventListener("click", dismiss);
  widget.addEventListener("keydown", event => {
    if (event.key === "Escape" && (active || !history.hidden)) {
      event.preventDefault();
      dismiss();
    }
  });
  document.body.append(widget);

  async function update() {
    if (loading || document.hidden) return;
    loading = true;
    try {
      const url = new URL(feedUrl, location.href);
      if (!localHost) url.searchParams.set("slot", String(Math.floor(Date.now() / 30_000)));
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!response.ok) return;
      const { alerts } = await response.json();
      if (!Array.isArray(alerts)) return;
      const next = activeAlerts(alerts);
      if (!history.hidden && JSON.stringify(next) !== JSON.stringify(recent)) {
        recent = next;
        populateHistory();
      } else recent = next;
      if (active && !recent.some(alert => alert.id === active.id)) {
        active = null;
        notice.hidden = true;
      }
      showNext();
      showLauncher();
    } catch { /* Try the feed again on the next poll. */ }
    finally { loading = false; }
  }

  showLauncher();
  update();
  setInterval(update, localHost ? 10000 : 30000);
  document.addEventListener("visibilitychange", update);
  window.addEventListener("focus", update);
}

if (localHost) {
  createWidget("security-alerts.json");
} else {
  fetch("data/meta.json", { cache: "no-store", signal: AbortSignal.timeout(5000) })
    .then(response => response.ok ? response.json() : null)
    .then(meta => { if (meta?.securityAlerts) createWidget(meta.securityAlerts); })
    .catch(() => {});
}
