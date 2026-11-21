import { pushTo } from './apple.mjs';
import { fail, oneOf } from './http.mjs';
import { nowIso } from './store.mjs';

/** APNs device tokens are hex; 32 bytes today, but Apple says not to rely on the length. */
const TOKEN = /^[0-9a-f]{64,200}$/;

// Apple's answers that mean this token will never work again.
const DEAD = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic', 'ExpiredToken']);

/**
 * Tell a person something on their phone. Fire and forget: the caller's
 * request never waits on Apple, and a failure only shows in the log. Demo
 * accounts never get pushes. `kind` lets the app open the right screen.
 */
export function notify(db, config, userId, { title, body, kind, id = null, clientId = null }) {
  if (!userId || (!config.apple && !config.pushTransport)) return;
  const user = db.prepare('SELECT is_demo FROM users WHERE id=?').get(userId);
  if (!user || user.is_demo) return;
  const devices = db.prepare('SELECT token, env FROM push_tokens WHERE user_id=?').all(userId);
  if (!devices.length) return;
  const payload = {
    aps: { alert: { title, body: clip(body, 180) }, sound: 'default', 'thread-id': kind },
    kind, ...(id ? { id } : {}), ...(clientId ? { clientId } : {}),
  };
  for (const device of devices) {
    pushTo(config, device, payload)
      .then(r => {
        if (r.status === 200) return;
        if (r.status === 410 || DEAD.has(r.reason)) db.prepare('DELETE FROM push_tokens WHERE token=?').run(device.token);
        else console.warn(`Push ${kind} failed: ${r.status} ${r.reason ?? ''}`);
      })
      .catch(e => console.warn(`Push ${kind} failed: ${e.message}`));
  }
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The phone registers its token after each launch; the latest owner wins. */
function putToken(_req, ctx) {
  const token = String(ctx.body.token ?? '').toLowerCase();
  if (!TOKEN.test(token)) fail(400, 'token must be an APNs device token in hex');
  const env = oneOf(ctx.body.env ?? 'production', 'env', ['production', 'sandbox']);
  const now = nowIso();
  ctx.db.prepare(`INSERT INTO push_tokens (token, user_id, env, created_at, updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id, env=excluded.env, updated_at=excluded.updated_at`)
    .run(token, ctx.user.id, env, now, now);
  return { ok: true, enabled: !!(ctx.config.apple || ctx.config.pushTransport) };
}

/** Turning notifications off on this phone (or signing out of it). */
function deleteToken(_req, ctx) {
  const token = String(ctx.query.token ?? '').toLowerCase();
  if (token) ctx.db.prepare('DELETE FROM push_tokens WHERE token=? AND user_id=?').run(token, ctx.user.id);
  else ctx.db.prepare('DELETE FROM push_tokens WHERE user_id=?').run(ctx.user.id);
  return { ok: true };
}

export function pushRoutes(r) {
  r.add('PUT', '/api/push/token', putToken);
  r.add('DELETE', '/api/push/token', deleteToken);
}
