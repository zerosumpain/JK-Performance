import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../app.mjs';
import { seedCatalogue } from '../catalogue.mjs';
import { fcmSend } from '../fcm.mjs';
import { openStore } from '../store.mjs';

// Stand-ins for Apple and Google: one RSA key signs both providers' identity
// tokens; fetch plays their key endpoints and Apple's token endpoint.
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = claims => {
  const head = b64({ alg: 'RS256', kid: 'k1' }), body = b64({ exp: Math.floor(Date.now() / 1000) + 600, ...claims });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), rsa.privateKey).toString('base64url')}`;
};
const google = claims => idToken({ iss: 'https://accounts.google.com', aud: 'web-client.apps.googleusercontent.com', email_verified: true, ...claims });
const apple = claims => idToken({ iss: 'https://appleid.apple.com', aud: 'com.jkperformance.web', ...claims });

const fetchImpl = async url => {
  if (/auth\/keys|oauth2\/v3\/certs/.test(String(url))) return { ok: true, json: async () => ({ keys: [jwk] }) };
  return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
};

let server, base, db, dir;
const config = () => ({
  dataDir: dir, appleAudience: 'com.jkperformance.app', coachEmails: ['coach@example.com'], primaryCoachEmail: null,
  supportEmail: 's@example.com', publicUrl: 'https://jk.example.com', gateServices: false, payments: false,
  demoCode: null, demoCoachCode: null, fetchImpl, pushTransport: (device, payload) => { sent.push({ device, payload }); return { status: 200 }; },
  googleClientIds: ['web-client.apps.googleusercontent.com'], appleServicesId: 'com.jkperformance.web',
  androidDownloadToken: 'download-token-123456',
});
const sent = [];
async function call(method, path, { token, body, form } = {}) {
  const res = await fetch(base + path, {
    method, redirect: 'manual',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: body ? JSON.stringify(body) : form ? new URLSearchParams(form).toString() : undefined,
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, body: json, text, headers: res.headers };
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'jk-android-'));
  db = openStore(':memory:');
  seedCatalogue(db);
  server = createApp(db, config());
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('Google sign-in: new clients join; a matching verified email reaches the same account', async () => {
  // The coach first signed in with Apple on an iPhone.
  const coachApple = await call('POST', '/api/auth/apple', { body: { identityToken: idToken({ iss: 'https://appleid.apple.com', aud: 'com.jkperformance.app', sub: 'apple-coach', email: 'coach@example.com' }) } });
  assert.equal(coachApple.body.me.role, 'coach');

  const coachGoogle = await call('POST', '/api/auth/google', { body: { idToken: google({ sub: 'g-coach', email: 'Coach@Example.com' }) } });
  assert.equal(coachGoogle.status, 200);
  assert.equal(coachGoogle.body.me.id, coachApple.body.me.id, 'same account on Android');

  const ann = await call('POST', '/api/auth/google', { body: { idToken: google({ sub: 'g-ann', email: 'ann@example.com', given_name: 'Ann', family_name: 'Lee' }) } });
  assert.equal(ann.body.me.role, 'client');
  assert.equal(ann.body.me.name, 'Ann Lee');
  assert.equal(ann.body.me.coach.id, coachApple.body.me.id);
  const again = await call('POST', '/api/auth/google', { body: { idToken: google({ sub: 'g-ann', email: 'ann@example.com' }) } });
  assert.equal(again.body.me.id, ann.body.me.id);

  // An unverified email never joins someone else's account.
  const sneaky = await call('POST', '/api/auth/google', { body: { idToken: google({ sub: 'g-sneaky', email: 'coach@example.com', email_verified: false }) } });
  assert.notEqual(sneaky.body.me.id, coachApple.body.me.id);
  assert.equal(sneaky.body.me.role, 'client');

  assert.equal((await call('POST', '/api/auth/google', { body: { idToken: idToken({ iss: 'https://accounts.google.com', aud: 'someone-else', sub: 'x' }) } })).status, 401);
  assert.equal((await call('POST', '/api/auth/google', { body: { idToken: apple({ sub: 'x' }) } })).status, 401, 'an Apple token is not a Google token');
  assert.deepEqual((await call('GET', '/api/android/config')).body, { google: true, googleClientId: 'web-client.apps.googleusercontent.com', apple: true });
});

test('Apple on the web: Apple posts back, the app swaps a one-time code for a session', async () => {
  assert.equal((await call('GET', '/api/auth/apple/web')).status, 400, 'state is required');
  const state = 'state-abcdefghijklmnop';
  const start = await call('GET', `/api/auth/apple/web?state=${state}`);
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get('location'));
  assert.equal(to.origin, 'https://appleid.apple.com');
  assert.equal(to.searchParams.get('client_id'), 'com.jkperformance.web');
  assert.equal(to.searchParams.get('redirect_uri'), 'https://jk.example.com/api/auth/apple/callback');
  assert.equal(to.searchParams.get('state'), state);

  const page = await call('POST', '/api/auth/apple/callback', { form: { state, id_token: apple({ sub: 'apple-bo', email: 'bo@example.com' }), code: 'c', user: JSON.stringify({ name: { firstName: 'Bo', lastName: 'Diaz' } }) } });
  assert.equal(page.status, 200);
  const link = /jkperformance:\/\/auth\?([^"]+)"/.exec(page.text);
  assert.ok(link, 'the page links back to the app');
  const params = new URLSearchParams(link[1].replace(/&amp;/g, '&'));
  assert.equal(params.get('state'), state);
  const done = await call('POST', '/api/auth/apple/finish', { body: { code: params.get('code') } });
  assert.equal(done.status, 200);
  assert.equal(done.body.me.name, 'Bo Diaz');
  assert.equal((await call('POST', '/api/auth/apple/finish', { body: { code: params.get('code') } })).status, 401, 'single use');

  // The same Apple person on an iPhone (same team-scoped sub) gets the same account.
  const phone = await call('POST', '/api/auth/apple', { body: { identityToken: idToken({ iss: 'https://appleid.apple.com', aud: 'com.jkperformance.app', sub: 'apple-bo' }) } });
  assert.equal(phone.body.me.id, done.body.me.id);

  const bad = await call('POST', '/api/auth/apple/callback', { form: { state, id_token: idToken({ iss: 'https://appleid.apple.com', aud: 'com.jkperformance.app', sub: 'x' }) } });
  assert.match(bad.text, /error=/, 'a token for another client id is refused');
  const cancelled = await call('POST', '/api/auth/apple/callback', { form: { state, error: 'user_cancelled_authorize' } });
  assert.match(cancelled.text, /Sign-in cancelled/);
});

test('Android push tokens keep their case and go out marked android', async () => {
  const { body } = await call('POST', '/api/auth/google', { body: { idToken: google({ sub: 'g-push', email: 'push@example.com' }) } });
  const fcm = 'dXyZ:APA91b' + 'Ab_-'.repeat(35);
  assert.equal((await call('PUT', '/api/push/token', { token: body.token, body: { token: 'not a token', platform: 'android' } })).status, 400);
  const put = await call('PUT', '/api/push/token', { token: body.token, body: { token: fcm, platform: 'android' } });
  assert.equal(put.body.enabled, true);
  assert.equal(db.prepare('SELECT platform FROM push_tokens WHERE token=?').get(fcm)?.platform, 'android');
  // The coach replies: the notification goes to the Android device.
  const coach = db.prepare("SELECT id FROM users WHERE role='coach'").get();
  const coachToken = (await call('POST', '/api/auth/google', { body: { idToken: google({ sub: 'g-coach', email: 'coach@example.com' }) } })).body.token;
  assert.equal((await call('POST', '/api/messages', { token: coachToken, body: { clientId: body.me.id, text: 'Nice work' } })).status, 200);
  await new Promise(r => setTimeout(r, 30));
  const out = sent.find(s => s.device.token === fcm);
  assert.ok(out, `pushed (coach ${coach.id})`);
  assert.equal(out.device.platform, 'android');
  await call('DELETE', `/api/push/token?token=${encodeURIComponent(fcm)}`, { token: body.token });
  assert.equal(db.prepare('SELECT 1 FROM push_tokens WHERE token=?').get(fcm), undefined);
});

test('FCM: the service account signs in, the message carries the kind, dead tokens are reported', async () => {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const file = join(dir, 'fcm.json');
  writeFileSync(file, JSON.stringify({ project_id: 'jk-test', client_email: 'push@jk-test.iam.gserviceaccount.com', private_key: key.privateKey.export({ format: 'pem', type: 'pkcs8' }) }));
  const calls = [];
  const fcmFetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('oauth2.googleapis.com')) {
      const assertion = new URLSearchParams(init.body).get('assertion');
      const [h, p, s] = assertion.split('.');
      assert.ok(verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key.publicKey, Buffer.from(s, 'base64url')));
      return { ok: true, json: async () => ({ access_token: 'ya29.test', expires_in: 3600 }) };
    }
    const msg = JSON.parse(init.body).message;
    if (msg.token === 'gone') return { ok: false, status: 404, json: async () => ({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }) };
    return { ok: true, status: 200, json: async () => ({ name: 'projects/jk-test/messages/1' }) };
  };
  const cfg = { fcmServiceAccountFile: file, fetchImpl: fcmFetch };
  const payload = { aps: { alert: { title: 'Coach JK', body: 'Nice work' } }, kind: 'message', clientId: 'u1' };
  assert.deepEqual(await fcmSend(cfg, { token: 'live' }, payload), { status: 200, reason: null });
  const send = calls.find(c => c.url.includes('fcm.googleapis.com'));
  assert.equal(send.url, 'https://fcm.googleapis.com/v1/projects/jk-test/messages:send');
  assert.equal(send.init.headers.authorization, 'Bearer ya29.test');
  const msg = JSON.parse(send.init.body).message;
  assert.deepEqual(msg.data, { kind: 'message', clientId: 'u1' });
  assert.equal(msg.notification.title, 'Coach JK');
  assert.equal((await fcmSend(cfg, { token: 'gone' }, payload)).reason, 'Unregistered');
  assert.equal(calls.filter(c => c.url.includes('oauth2')).length, 1, 'the access token is reused');
});

test('the APK download page is private and serves the newest build', async () => {
  assert.equal((await call('GET', '/android/wrong-token-123456')).status, 404);
  assert.match((await call('GET', '/android/download-token-123456')).text, /No build yet/);
  mkdirSync(join(dir, 'android'), { recursive: true });
  writeFileSync(join(dir, 'android', 'jk-performance.apk'), Buffer.from('PK-fake-apk'));
  writeFileSync(join(dir, 'android', 'version.json'), JSON.stringify({ version: '0.1.7', builtAt: '2026-11-21T18:00:00Z', commit: 'abc' }));
  const page = await call('GET', '/android/download-token-123456');
  assert.match(page.text, /Version 0\.1\.7/);
  const apk = await fetch(`${base}/android/download-token-123456/jk-performance.apk`);
  assert.equal(apk.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.equal(await apk.text(), 'PK-fake-apk');
  assert.equal((await call('GET', '/android/wrong-token-123456/jk-performance.apk')).status, 404);
});
