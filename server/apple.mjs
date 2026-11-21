import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http2 from 'node:http2';

/**
 * One Apple key (.p8, ES256) does two jobs:
 * - signs the provider token for Apple Push Notifications;
 * - signs the client secret for Sign in with Apple's token endpoints, so the
 *   server can swap the app's authorization code for a refresh token at sign-in
 *   and revoke it when the account is deleted (App Store rule 5.1.1(v)).
 * The key file is mounted read-only from the host; it never goes in the repo.
 */

const APPLE_ID = 'https://appleid.apple.com';
const b64 = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

let loaded = null; // { file, key }
function privateKey(apple) {
  if (loaded?.file !== apple.keyFile) loaded = { file: apple.keyFile, key: createPrivateKey(readFileSync(apple.keyFile)) };
  return loaded.key;
}

function jwt(apple, claims) {
  const signing = `${b64({ alg: 'ES256', kid: apple.keyId })}.${b64(claims)}`;
  const signature = sign('sha256', Buffer.from(signing), { key: privateKey(apple), dsaEncoding: 'ieee-p1363' });
  return `${signing}.${signature.toString('base64url')}`;
}

// MARK: - Push

// Apple wants the provider token reused, refreshed between 20 and 60 minutes.
let provider = null; // { at, token }
function providerToken(apple, now = Date.now()) {
  if (!provider || now - provider.at > 45 * 60_000) {
    provider = { at: now, token: jwt(apple, { iss: apple.teamId, iat: Math.floor(now / 1000) }) };
  }
  return provider.token;
}

const HOSTS = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' };
const connections = new Map();

function connection(env) {
  const open = connections.get(env);
  if (open && !open.closed && !open.destroyed) return open;
  const c = http2.connect(HOSTS[env]);
  const drop = () => { if (connections.get(env) === c) connections.delete(env); };
  c.on('error', drop);
  c.on('goaway', drop);
  c.on('close', drop);
  c.setTimeout(10 * 60_000, () => c.close()); // idle connections go; the next push reconnects
  connections.set(env, c);
  return c;
}

function apnsSend(config, device, payload) {
  return new Promise(resolve => {
    let stream;
    try {
      stream = connection(device.env).request({
        ':method': 'POST',
        ':path': `/3/device/${device.token}`,
        authorization: `bearer ${providerToken(config.apple)}`,
        'apns-topic': config.appleAudience,
        'apns-push-type': 'alert',
        'apns-priority': '10',
      });
    } catch (e) {
      return resolve({ status: 0, reason: e.message });
    }
    let status = 0, body = '';
    stream.setTimeout(10_000, () => stream.close(http2.constants.NGHTTP2_CANCEL));
    stream.on('response', h => { status = h[':status']; });
    stream.on('data', chunk => { body += chunk; });
    stream.on('error', e => resolve({ status: 0, reason: e.message }));
    stream.on('close', () => {
      let reason = null;
      try { reason = body ? JSON.parse(body).reason : null; } catch { reason = body.slice(0, 100); }
      resolve({ status, reason });
    });
    stream.end(JSON.stringify(payload));
  });
}

/** Send one notification to one device: `{status, reason}`; never throws. */
export function pushTo(config, device, payload) {
  if (config.pushTransport) return Promise.resolve(config.pushTransport(device, payload));
  if (!config.apple) return Promise.resolve({ status: 0, reason: 'push is not configured' });
  return apnsSend(config, device, payload);
}

// MARK: - Sign in with Apple tokens

function clientSecret(config, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  return jwt(config.apple, { iss: config.apple.teamId, iat, exp: iat + 300, aud: APPLE_ID, sub: config.appleAudience });
}

async function applePost(config, path, fields) {
  return config.fetchImpl(`${APPLE_ID}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.appleAudience, client_secret: clientSecret(config), ...fields }),
    signal: AbortSignal.timeout(8000),
  });
}

/**
 * The app's one-time authorization code → a refresh token, or null. Best effort:
 * sign-in has already been verified by the identity token, so a failure here
 * only means this sign-in leaves nothing to revoke later.
 */
export async function exchangeAppleCode(config, code) {
  if (!config.apple || typeof code !== 'string' || !code || code.length > 512) return null;
  try {
    const res = await applePost(config, '/auth/token', { code, grant_type: 'authorization_code' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || typeof body.refresh_token !== 'string') {
      console.warn(`Apple code exchange: ${res.status} ${body.error ?? ''}`);
      return null;
    }
    return body.refresh_token;
  } catch (e) {
    console.warn(`Apple code exchange failed: ${e.message}`);
    return null;
  }
}

/** Revoke a Sign in with Apple refresh token. Best effort; returns whether Apple said yes. */
export async function revokeApple(config, refreshToken) {
  if (!config.apple || !refreshToken) return false;
  try {
    const res = await applePost(config, '/auth/revoke', { token: refreshToken, token_type_hint: 'refresh_token' });
    if (!res.ok) console.warn(`Apple revoke: ${res.status}`);
    return res.ok;
  } catch (e) {
    console.warn(`Apple revoke failed: ${e.message}`);
    return false;
  }
}
