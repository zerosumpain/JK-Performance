import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Android push through Firebase Cloud Messaging (HTTP v1). A Firebase service
 * account (JSON, mounted read-only like the Apple key) signs a short JWT that
 * Google swaps for an hour-long access token; each push is one HTTPS POST.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const b64 = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

let account = null; // { file, json, key }
function serviceAccount(file) {
  if (account?.file !== file) {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    account = { file, json, key: createPrivateKey(json.private_key) };
  }
  return account;
}

let access = null; // { file, token, until }
async function accessToken(config, now = Date.now()) {
  if (access?.file === config.fcmServiceAccountFile && access.until - now > 5 * 60_000) return access.token;
  const { json, key } = serviceAccount(config.fcmServiceAccountFile);
  const iat = Math.floor(now / 1000);
  const signing = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: json.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
  const assertion = `${signing}.${sign('sha256', Buffer.from(signing), key).toString('base64url')}`;
  const res = await config.fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`FCM auth ${res.status} ${body.error ?? ''}`);
  access = { file: config.fcmServiceAccountFile, token: body.access_token, until: now + (body.expires_in ?? 3600) * 1000 };
  return access.token;
}

/**
 * The APNs-shaped payload push.mjs builds, sent to one Android device.
 * Resolves `{status, reason}` like apnsSend; a dead token comes back as
 * reason 'Unregistered' so the caller forgets it.
 */
export async function fcmSend(config, device, payload) {
  try {
    const { json } = serviceAccount(config.fcmServiceAccountFile);
    const alert = payload.aps?.alert ?? {};
    const data = Object.fromEntries(['kind', 'id', 'clientId'].filter(k => payload[k] != null).map(k => [k, String(payload[k])]));
    const res = await config.fetchImpl(`https://fcm.googleapis.com/v1/projects/${json.project_id}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await accessToken(config)}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: device.token,
          notification: { title: alert.title, body: alert.body },
          data,
          android: { priority: 'high', notification: { channel_id: 'coach', tag: payload.kind } },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { status: 200, reason: null };
    const body = await res.json().catch(() => ({}));
    const code = body.error?.details?.find(d => d.errorCode)?.errorCode ?? body.error?.status ?? null;
    const dead = res.status === 404 || code === 'UNREGISTERED' || (res.status === 400 && code === 'INVALID_ARGUMENT' && /token/i.test(body.error?.message ?? ''));
    return { status: res.status, reason: dead ? 'Unregistered' : code };
  } catch (e) {
    return { status: 0, reason: e.message };
  }
}
