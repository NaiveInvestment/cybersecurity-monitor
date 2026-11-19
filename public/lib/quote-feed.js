import { freshRelay, relayUrl } from "./relay.js";

const CLOUD_INTERVAL = 75000;
const RELAY_INTERVAL = 2000;
const DISCOVERY_INTERVAL = 60000;

async function fetchJson(url, options) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3500), ...options });
  if (!response.ok) throw new Error("Quote feed unavailable");
  return response.json();
}

export function startQuoteFeed(live, { onQuotes, onRelayLost, onUnavailable }) {
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
    if (document.hidden || cloudRunning) return;
    cloudRunning = true;
    try {
      const attempts = url ? [() => fetchJson(url)] : [
        () => fetchJson(`https://api.github.com/repos/${repo}/contents/${file}?ref=${branch}`, {
          headers: { Accept: "application/vnd.github.raw+json" },
        }),
        () => fetchJson(`https://raw.githubusercontent.com/${repo}/${branch}/${file}`),
      ];
      for (const attempt of attempts) {
        let payload;
        try { payload = await attempt(); } catch { continue; }
        if (!payload?.q || typeof payload.q !== "object") continue;
        cloud = payload;
        if (!relayActive) onQuotes(payload, url ? "local" : "cloud");
        return;
      }
      onUnavailable?.();
    } finally {
      cloudRunning = false;
    }
  }

  async function pollRelay() {
    if (document.hidden || relayRunning) return;
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
        try { payload = await fetchJson(relay); } catch { /* Fall back to cloud. */ }
      }
      if (freshRelay(payload)) {
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

  void pollCloud();
  setInterval(pollCloud, live.interval || (url ? RELAY_INTERVAL : CLOUD_INTERVAL));
  if (relayConfig) {
    void pollRelay();
    setInterval(pollRelay, RELAY_INTERVAL);
  }
  document.addEventListener("visibilitychange", () => {
    void pollCloud();
    if (relayConfig) void pollRelay();
  });
}
