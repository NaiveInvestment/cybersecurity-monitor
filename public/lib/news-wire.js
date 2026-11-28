import { reportsIncident } from "./recent-incidents.js";

const FRESH = 45 * 60000;
const norm = source => (source || "").trim().toLowerCase();

export function wireIndex(articles) {
  const sources = new Map(), urls = new Set();
  for (const item of articles) {
    urls.add(item.u);
    const key = norm(item.s);
    if (!sources.has(key)) sources.set(key, item.r);
    else if (sources.get(key) !== item.r) sources.set(key, null);
  }
  return { sources, urls };
}

export function wireRegion(alert, index) {
  const host = new URL(alert.url).hostname;
  const fallback = host.endsWith(".kr") ? "KR" : host.endsWith(".jp") || host.endsWith(".nhk") ? "GL" : null;
  return index.sources.get(norm(alert.source)) || fallback;
}

export function regionalAlerts(alerts, index, state, now = Date.now()) {
  if (state.focus || state.category === "briefs") return [];
  const seen = new Set(index.urls);
  const query = state.query.trim().toLowerCase();
  return [...alerts].sort((a,b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt)).filter(alert => {
    const age = now - Date.parse(alert.detectedAt);
    if (!(age >= -60000 && age <= FRESH) || alert.test || !alert.title || !alert.source || seen.has(alert.url)) return false;
    let target;
    try { target = new URL(alert.url); } catch { return false; }
    if (!["http:","https:"].includes(target.protocol)) return false;
    if (state.region !== "ALL" && wireRegion(alert, index) !== state.region) return false;
    if (!`${alert.title} ${alert.source}`.toLowerCase().includes(query)) return false;
    if (state.category !== "all") {
      const policy = /법안|입법|법률|시행령|개정안|과징금|규제|정책|감독규정|보안 의무|지침/;
      const category = policy.test(alert.title) ? "policy" : reportsIncident(alert.title) ? "incident" : null;
      if (state.category !== category) return false;
    }
    seen.add(alert.url);
    return true;
  });
}

export function watchWire(onAlerts) {
  const local = ["localhost","127.0.0.1"].includes(location.hostname);
  let endpoint, loading = false, alerts = [];
  async function update() {
    if (document.hidden || loading) return;
    loading = true;
    try {
      if (!endpoint) {
        if (local) endpoint = "security-alerts.json";
        else {
          const meta = await fetch("data/meta.json", { cache:"no-store", signal:AbortSignal.timeout(5000) });
          if (!meta.ok) return;
          endpoint = (await meta.json()).securityAlerts;
        }
      }
      if (!endpoint) return;
      const url = new URL(endpoint, location.href);
      if (!local) url.searchParams.set("slot", String(Math.floor(Date.now()/30000)));
      const response = await fetch(url, { cache:"no-store", signal:AbortSignal.timeout(5000) });
      if (!response.ok) return;
      const file = await response.json();
      if (Array.isArray(file.alerts)) alerts = file.alerts;
    } catch {
      // The last edition can still be displayed until its original expiry.
    } finally { loading = false; onAlerts(alerts); }
  }
  update();
  setInterval(update, 30000);
  document.addEventListener("visibilitychange", update);
}
