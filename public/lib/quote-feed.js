import { freshRelay, relayUrl } from "./relay.js";

const CLOUD_INTERVAL = 75000;
const RELAY_INTERVAL = 2000;
const DISCOVERY_INTERVAL = 60000;
const cloudRequests = new Map();

async function fetchJson(url, options) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3500), ...options });
  if (!response.ok) throw new Error("Quote feed unavailable");
  return response.json();
}

async function loadCloud(api, raw) {
  const attempts = [
    () => fetchJson(api, { headers: { Accept: "application/vnd.github.raw+json" } }),
    () => fetchJson(raw),
  ];
  for (const attempt of attempts) {
    let payload;
    try { payload = await attempt(); } catch { continue; }
    if (payload?.q && typeof payload.q === "object") return payload;
  }
  return null;
}

function sharedCloud(repo, branch, file) {
  const api = `https://api.github.com/repos/${repo}/contents/${file}?ref=${branch}`;
  const now = Date.now();
  const cached = cloudRequests.get(api);
  if (cached && now - cached.at < CLOUD_INTERVAL - 1000) return cached.promise;
  const raw = `https://raw.githubusercontent.com/${repo}/${branch}/${file}`;
  const promise = loadCloud(api, raw).then((payload) => {
    if (!payload && cloudRequests.get(api)?.promise === promise) cloudRequests.delete(api);
    return payload;
  });
  cloudRequests.set(api, { at: now, promise });
  return promise;
}

export function startQuoteFeed(live, { onQuotes, onRelayLost, onUnavailable, acceptSector, isActive = () => true }) {
  if (!live) return;
  const { repo, branch, file, url, relayConfig } = live;
  if (!url && !(repo && branch && file)) return;

  let cloud = null;
  let cloudRunning = false;
  let relay = null;
  let relayRunning = false;
  let relayActive = false;
  let lastDiscovery = -Infinity;

  async function pollCloud() {
    if (document.hidden || !isActive() || cloudRunning) return;
    cloudRunning = true;
    try {
      const payload = url ? await fetchJson(url).catch(() => null) : await sharedCloud(repo, branch, file);
      if (payload?.q && typeof payload.q === "object") {
        cloud = payload;
        if (!relayActive) onQuotes(payload, url ? "local" : "cloud");
      } else onUnavailable?.();
    } finally {
      cloudRunning = false;
    }
  }

  async function pollRelay() {
    if (document.hidden || !isActive() || relayRunning) return;
    relayRunning = true;
    try {
      const now = Date.now();
      if (now - lastDiscovery >= DISCOVERY_INTERVAL) {
        lastDiscovery = now;
        try {
          const config = new URL(relayConfig);
          config.searchParams.set("t", Math.floor(now / DISCOVERY_INTERVAL));
          relay = relayUrl((await fetchJson(config)).url);
        } catch { /* A failed discovery can leave the previous relay available. */ }
      }
      let payload;
      if (relay) {
        const endpoint = new URL(relay);
        if (acceptSector) endpoint.searchParams.set("sector", "1");
        try { payload = await fetchJson(endpoint); } catch { /* Fall back to cloud. */ }
      }
      if (freshRelay(payload) && (!acceptSector || acceptSector(payload.sector, cloud?.sector))) {
        relayActive = true;
        onQuotes(payload, "relay");
      } else if (relayActive) {
        relayActive = false;
        onRelayLost?.(cloud);
      }
    } finally {
      relayRunning = false;
    }
  }

  function refresh() {
    void pollCloud();
    if (relayConfig) void pollRelay();
  }
  refresh();
  setInterval(pollCloud, live.interval || (url ? RELAY_INTERVAL : CLOUD_INTERVAL));
  if (relayConfig) setInterval(pollRelay, RELAY_INTERVAL);
  document.addEventListener("visibilitychange", refresh);
  return refresh;
}
