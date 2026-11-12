export function relayUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname) && !url.port && !url.username && !url.password && url.pathname === "/live.json" ? url.href : null;
  } catch { return null; }
}
export function freshRelay(payload, now = Date.now()) {
  const age = now - Date.parse(payload?.asOf);
  return Number.isFinite(age) && age >= -5000 && age < 15000 && payload?.q && Object.keys(payload.q).length > 0;
}
