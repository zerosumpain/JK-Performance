import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { meOut } from './account.mjs';
import { exchangeAppleCode } from './apple.mjs';
import { issueSession, upsertIdentityUser, verifyAppleToken, verifyGoogleToken } from './auth.mjs';
import { fail, raw } from './http.mjs';
import { hash, nowIso } from './store.mjs';

/**
 * What the Android app needs that the iPhone app doesn't:
 * - Sign in with Google (Credential Manager hands the app a Google ID token);
 * - Sign in with Apple on the web: a Custom Tab opens Apple's page, Apple posts
 *   back here, and the server hands the app a one-time code through the
 *   jkperformance:// link, which the app swaps for a session;
 * - a private download page for the APK while there's no Play Store listing.
 */

const APP_SCHEME = 'jkperformance://auth';
const HANDOFF_SECONDS = 120;
const STATE = /^[A-Za-z0-9_-]{16,128}$/;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const callbackUrl = config => `${new URL(config.publicUrl).origin}/api/auth/apple/callback`;

async function signInGoogle(_req, ctx) {
  if (!ctx.config.googleClientIds.length) fail(503, 'Google sign-in is not set up on this server');
  const claims = await verifyGoogleToken(ctx.body.idToken, ctx.config.googleClientIds, { fetchImpl: ctx.config.fetchImpl });
  const fullName = { givenName: claims.given_name ?? ctx.body.fullName?.givenName, familyName: claims.family_name ?? ctx.body.fullName?.familyName };
  const user = upsertIdentityUser(ctx.db, ctx.config, 'google', claims, fullName);
  return { token: issueSession(ctx.db, user.id), me: meOut(ctx.db, user) };
}

/** Step 1: the app opens this in a Custom Tab with a random `state`; we send the browser to Apple. */
function appleWebStart(_req, ctx) {
  if (!ctx.config.appleServicesId) fail(503, 'Sign in with Apple on Android is not set up on this server');
  const state = String(ctx.query.state ?? '');
  if (!STATE.test(state)) fail(400, 'state is required');
  const url = new URL('https://appleid.apple.com/auth/authorize');
  url.search = new URLSearchParams({
    client_id: ctx.config.appleServicesId, redirect_uri: callbackUrl(ctx.config),
    response_type: 'code id_token', response_mode: 'form_post', scope: 'name email', state,
  }).toString();
  return raw(302, { location: url.toString(), 'cache-control': 'no-store' }, '');
}

/** A page that hands the browser back to the app (a plain redirect to a custom scheme is sometimes blocked). */
function backToApp(params) {
  const link = `${APP_SCHEME}?${new URLSearchParams(params)}`;
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JK Performance</title><style>body{font:16px system-ui;background:#0b0b0c;color:#f2f2f2;display:grid;place-items:center;min-height:90vh;text-align:center}a{display:inline-block;margin-top:16px;padding:12px 22px;border-radius:12px;background:#fff;color:#000;text-decoration:none;font-weight:600}</style>
<div><p>${params.error ? esc(params.error) : 'Signed in. Returning to the app…'}</p><a href="${esc(link)}">Open JK Performance</a></div>
<script>location.replace(${JSON.stringify(link)})</script>`;
  return raw(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" }, html);
}

/** Step 2: Apple form-posts the identity token here; the app gets a two-minute, single-use code. */
async function appleWebCallback(_req, ctx) {
  const form = new URLSearchParams(ctx.rawBody?.toString('utf8') ?? '');
  const state = form.get('state') ?? '';
  if (!STATE.test(state)) fail(400, 'state is missing');
  if (form.get('error')) return backToApp({ state, error: form.get('error') === 'user_cancelled_authorize' ? 'Sign-in cancelled' : 'Apple could not sign you in' });
  let claims;
  try {
    claims = await verifyAppleToken(form.get('id_token'), [ctx.config.appleServicesId], { fetchImpl: ctx.config.fetchImpl });
  } catch (e) {
    return backToApp({ state, error: e.message });
  }
  // Apple sends the name only on the very first sign-in, as JSON in `user`.
  let name = null;
  try { const u = JSON.parse(form.get('user') ?? 'null'); name = u?.name ? { givenName: u.name.firstName, familyName: u.name.lastName } : null; } catch { /* no name */ }
  const user = upsertIdentityUser(ctx.db, ctx.config, 'apple', claims, name);
  const refresh = await exchangeAppleCode(ctx.config, form.get('code'), { clientId: ctx.config.appleServicesId, redirectUri: callbackUrl(ctx.config) });
  if (refresh) ctx.db.prepare('UPDATE users SET apple_refresh=?, apple_refresh_client=? WHERE id=?').run(refresh, ctx.config.appleServicesId, user.id);
  const code = randomBytes(24).toString('base64url');
  ctx.db.prepare('DELETE FROM auth_handoffs WHERE expires_at<?').run(Date.now());
  ctx.db.prepare('INSERT INTO auth_handoffs (hash, user_id, expires_at, created_at) VALUES (?,?,?,?)').run(hash(code), user.id, Date.now() + HANDOFF_SECONDS * 1000, nowIso());
  return backToApp({ state, code });
}

/** Step 3: the app swaps the one-time code for a session. */
function appleWebFinish(_req, ctx) {
  const row = ctx.db.prepare('SELECT * FROM auth_handoffs WHERE hash=?').get(hash(String(ctx.body.code ?? '')));
  if (!row || row.expires_at < Date.now()) fail(401, 'That sign-in has expired. Try again.');
  ctx.db.prepare('DELETE FROM auth_handoffs WHERE hash=?').run(row.hash);
  const user = ctx.db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
  return { token: issueSession(ctx.db, user.id), me: meOut(ctx.db, user) };
}

/** Which sign-in buttons the Android app should show. */
const androidConfig = (_req, ctx) => ({ google: ctx.config.googleClientIds.length > 0, googleClientId: ctx.config.googleClientIds[0] ?? null, apple: !!ctx.config.appleServicesId });

// MARK: - APK download (private link while testing)

const apkDir = config => join(config.dataDir, 'android');
function apkInfo(config) {
  const file = join(apkDir(config), 'jk-performance.apk');
  if (!existsSync(file)) return null;
  let meta = {};
  try { meta = JSON.parse(readFileSync(join(apkDir(config), 'version.json'), 'utf8')); } catch { /* optional */ }
  const st = statSync(file);
  return { file, bytes: st.size, builtAt: meta.builtAt ?? st.mtime.toISOString(), version: meta.version ?? null, commit: meta.commit ?? null };
}

function checkToken(ctx) {
  if (!ctx.config.androidDownloadToken || ctx.params.token !== ctx.config.androidDownloadToken) fail(404, 'Not found');
}

function downloadPage(_req, ctx) {
  checkToken(ctx);
  const info = apkInfo(ctx.config);
  const built = info ? new Date(info.builtAt).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }) : null;
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>JK Performance for Android</title>
<style>body{font:16px/1.5 system-ui;background:#0b0b0c;color:#f2f2f2;max-width:520px;margin:0 auto;padding:32px 16px}.badge{width:56px;height:56px;border-radius:14px;border:1px solid #999;display:grid;place-items:center;font-weight:800;font-size:22px}a.btn{display:block;text-align:center;margin:24px 0;padding:14px;border-radius:12px;background:#fff;color:#000;text-decoration:none;font-weight:700}small,li{color:#aaa}</style>
<div class="badge">JK</div><h1>JK Performance for Android</h1>
${info ? `<p>Version ${esc(info.version ?? '')} · built ${esc(built)} · ${(info.bytes / 1048576).toFixed(1)} MB</p>
<a class="btn" href="/android/${esc(ctx.params.token)}/jk-performance.apk">Download the app</a>
<ol><li>Tap <b>Download the app</b>, then open the file.</li><li>If Android asks, allow your browser to install unknown apps.</li><li>Open JK Performance and sign in.</li></ol>
<small>Installing a newer version over the top keeps you signed in.</small>` : '<p>No build yet. Check back soon.</p>'}`;
  return raw(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" }, html);
}

function downloadApk(_req, ctx) {
  checkToken(ctx);
  const info = apkInfo(ctx.config);
  if (!info) fail(404, 'No build yet');
  return raw(200, {
    'content-type': 'application/vnd.android.package-archive',
    'content-disposition': 'attachment; filename="jk-performance.apk"',
    'cache-control': 'no-store', 'x-robots-tag': 'noindex',
  }, readFileSync(info.file));
}

export function androidRoutes(r) {
  r.add('POST', '/api/auth/google', signInGoogle, { public: true });
  r.add('GET', '/api/auth/apple/web', appleWebStart, { public: true });
  r.add('POST', '/api/auth/apple/callback', appleWebCallback, { public: true, rawBody: 16 * 1024 });
  r.add('POST', '/api/auth/apple/finish', appleWebFinish, { public: true });
  r.add('GET', '/api/android/config', androidConfig, { public: true });
  r.add('GET', '/android/:token', downloadPage, { public: true });
  r.add('GET', '/android/:token/jk-performance.apk', downloadApk, { public: true });
}
