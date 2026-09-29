const PREFIX = 'gt-parking-mantle-requests-v1:';
const TAB_KEY = 'gt-parking-mantle-tab-v1';
const WINDOW_MS = 24 * 60 * 60 * 1000;
let fallbackTabId = null;

function tabId() {
  try {
    let id = sessionStorage.getItem(TAB_KEY);
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      sessionStorage.setItem(TAB_KEY, id);
    }
    return id;
  } catch {
    return fallbackTabId ||= `${Date.now()}-${Math.random()}`;
  }
}

export function recordMantleRequest(status = 0) {
  try {
    const key = PREFIX + tabId();
    const now = Date.now();
    const history = JSON.parse(localStorage.getItem(key) || '[]');
    const recent = (Array.isArray(history) ? history : []).filter(row => Array.isArray(row) && row[0] > now - WINDOW_MS);
    recent.push([now, Number(status) || 0]);
    localStorage.setItem(key, JSON.stringify(recent));
  } catch { /* Storage can be disabled; never interrupt bookings for telemetry. */ }
}

export function localMantleUsage() {
  const result = { attempts: 0, responses: 0, rateLimited: 0, networkFailures: 0 };
  try {
    const cutoff = Date.now() - WINDOW_MS;
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      const history = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(history)) continue;
      for (const [at, status] of history) {
        if (at <= cutoff) continue;
        result.attempts++;
        if (status === 0) result.networkFailures++;
        else result.responses++;
        if (status === 429) result.rateLimited++;
      }
    }
  } catch { /* Report the observed portion if browser storage is unavailable. */ }
  return result;
}
