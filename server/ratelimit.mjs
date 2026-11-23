/**
 * An in-memory sliding-window rate limit (docs/design/desk-v2.md 3.15), for
 * the public enquiry form and the AI endpoints. `limit(key, {max, perMs})`
 * records one hit and says whether it is allowed. Per process: a restart
 * forgets, which is fine for abuse brakes.
 */
const windows = new Map(); // key -> [timestamps]
let sweeps = 0;

export function limit(key, { max, perMs, now = Date.now() } = {}) {
  const since = now - perMs;
  const hits = (windows.get(key) ?? []).filter(t => t > since);
  const allowed = hits.length < max;
  if (allowed) hits.push(now);
  windows.set(key, hits);
  if (++sweeps % 1000 === 0) sweep(now);
  return allowed;
}

/** Forget keys with no recent hits (an hour), so the map cannot grow without bound. */
function sweep(now) {
  for (const [k, hits] of windows) if (!hits.length || hits[hits.length - 1] < now - 3_600_000) windows.delete(k);
}

/** Tests: forget everything. */
export function resetLimits() {
  windows.clear();
}
