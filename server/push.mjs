import { pushTo } from './apple.mjs';
import { fail, oneOf } from './http.mjs';
import { nowIso } from './store.mjs';

/** APNs device tokens are hex; 32 bytes today, but Apple says not to rely on the length. */
const TOKEN = /^[0-9a-f]{64,200}$/;
/** FCM registration tokens: url-safe base64 with a colon, around 160 characters. */
const FCM_TOKEN = /^[A-Za-z0-9_:\-]{100,400}$/;
const pushOn = config => !!(config.apple || config.fcmServiceAccountFile || config.pushTransport);

// Apple's answers that mean this token will never work again.
const DEAD = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic', 'ExpiredToken']);

/**
 * Tell a person something on their phone. Fire and forget: the caller's
 * request never waits on Apple, and a failure only shows in the log. Demo
 * accounts never get pushes. `kind` lets the app open the right screen.
 */
export function notify(db, config, userId, { title, body, kind, id = null, clientId = null }) {
  if (!userId || !pushOn(config)) return;
  const user = db.prepare('SELECT is_demo FROM users WHERE id=?').get(userId);
  if (!user || user.is_demo) return;
  const devices = db.prepare('SELECT token, env, platform FROM push_tokens WHERE user_id=?').all(userId);
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

/** APNs tokens are case-insensitive hex (kept lower case); FCM tokens are case-sensitive. */
export const normalToken = (token, platform = 'ios') => (platform === 'android' ? String(token ?? '') : String(token ?? '').toLowerCase());

/** The phone registers its token after each launch; the latest owner wins. */
function putToken(_req, ctx) {
  const platform = oneOf(ctx.body.platform ?? 'ios', 'platform', ['ios', 'android']);
  const token = normalToken(ctx.body.token, platform);
  if (platform === 'ios' && !TOKEN.test(token)) fail(400, 'token must be an APNs device token in hex');
  if (platform === 'android' && !FCM_TOKEN.test(token)) fail(400, 'token must be an FCM registration token');
  const env = oneOf(ctx.body.env ?? 'production', 'env', ['production', 'sandbox']);
  const now = nowIso();
  ctx.db.prepare(`INSERT INTO push_tokens (token, user_id, env, platform, created_at, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id, env=excluded.env, platform=excluded.platform, updated_at=excluded.updated_at`)
    .run(token, ctx.user.id, env, platform, now, now);
  const enabled = platform === 'android' ? !!(ctx.config.fcmServiceAccountFile || ctx.config.pushTransport) : !!(ctx.config.apple || ctx.config.pushTransport);
  return { ok: true, enabled };
}

/** Turning notifications off on this phone (or signing out of it). */
function deleteToken(_req, ctx) {
  const raw = String(ctx.query.token ?? '');
  if (raw) ctx.db.prepare('DELETE FROM push_tokens WHERE token IN (?,?) AND user_id=?').run(raw, raw.toLowerCase(), ctx.user.id);
  else ctx.db.prepare('DELETE FROM push_tokens WHERE user_id=?').run(ctx.user.id);
  return { ok: true };
}

export function pushRoutes(r) {
  r.add('PUT', '/api/push/token', putToken);
  r.add('DELETE', '/api/push/token', deleteToken);
}
