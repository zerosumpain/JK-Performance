import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createApp } from '../app.mjs';
import { seedCatalogue } from '../catalogue.mjs';
import { buildDemo } from '../demo.mjs';
import { openStore } from '../store.mjs';

// Signing in to the coach web app (/desk): Google, Apple on the web, the demo
// coach code. Coaches only, and the web never creates a client account.
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

let server, base, db;
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
const users = () => db.prepare('SELECT COUNT(*) n FROM users').get().n;

before(async () => {
  db = openStore(':memory:');
  seedCatalogue(db);
  buildDemo(db);
  server = createApp(db, {
    dataDir: '/tmp', appleAudience: 'com.jkperformance.app', coachEmails: ['coach@example.com'], primaryCoachEmail: null,
    supportEmail: 's@example.com', publicUrl: 'https://jk.example.com', gateServices: false, payments: false,
    demoCode: 'demo-client-code', demoCoachCode: 'demo-coach-code', fetchImpl, pushTransport: () => ({ status: 200 }),
    googleClientIds: ['web-client.apps.googleusercontent.com'], appleServicesId: 'com.jkperformance.web',
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('the web app says which ways in it has', async () => {
  assert.deepEqual((await call('GET', '/api/auth/web/config')).body,
    { google: true, googleClientId: 'web-client.apps.googleusercontent.com', apple: true, demo: true });
});

test('Google on the web: the coach gets in; a stranger is turned away without an account', async () => {
  const before = users();
  const stranger = await call('POST', '/api/auth/web/google', { body: { idToken: google({ sub: 'g-new', email: 'new@example.com' }) } });
  assert.equal(stranger.status, 403);
  assert.match(stranger.body.error, /for coaches/);
  assert.equal(users(), before, 'no client account made from the web');

  const coach = await call('POST', '/api/auth/web/google', { body: { idToken: google({ sub: 'g-coach', email: 'coach@example.com', given_name: 'Jo', family_name: 'K' }) } });
  assert.equal(coach.status, 200);
  assert.equal(coach.body.me.role, 'coach');
  assert.equal(db.prepare('SELECT kind FROM sessions ORDER BY created_at DESC LIMIT 1').get().kind, 'web', 'a 30-day web session');
  assert.equal((await call('GET', '/api/coach/clients', { token: coach.body.token })).status, 200);

  // A client who already has an account (from the app) still can't use the web.
  await call('POST', '/api/auth/google', { body: { idToken: google({ sub: 'g-client', email: 'client@example.com' }) } });
  assert.equal((await call('POST', '/api/auth/web/google', { body: { idToken: google({ sub: 'g-client', email: 'client@example.com' }) } })).status, 403);
});

test('Apple on the web returns to /desk, coaches only', async () => {
  const state = 'web-abcdefghijklmnop';
  const before = users();
  const stranger = await call('POST', '/api/auth/apple/callback', { form: { state, id_token: apple({ sub: 'apple-stranger', email: 'x@example.com' }) } });
  assert.equal(stranger.status, 303);
  const back = new URL(stranger.headers.get('location'), base);
  assert.equal(back.pathname, '/desk');
  assert.match(new URLSearchParams(back.hash.slice(1)).get('error'), /for coaches/);
  assert.equal(users(), before);

  const coach = await call('POST', '/api/auth/apple/callback', { form: { state, id_token: apple({ sub: 'apple-coach', email: 'coach@example.com' }) } });
  const params = new URLSearchParams(new URL(coach.headers.get('location'), base).hash.slice(1));
  assert.equal(params.get('state'), state);
  const done = await call('POST', '/api/auth/apple/finish', { body: { code: params.get('code'), web: true } });
  assert.equal(done.status, 200);
  assert.equal(done.body.me.role, 'coach');
  assert.equal(db.prepare('SELECT kind FROM sessions ORDER BY created_at DESC LIMIT 1').get().kind, 'web');
});

test('the demo codes on the web: the coach code works, the client code is refused', async () => {
  const coach = await call('POST', '/api/auth/web/code', { body: { code: ' demo-coach-code ' } });
  assert.equal(coach.status, 200);
  assert.equal(coach.body.me.role, 'coach');
  assert.equal((await call('POST', '/api/auth/web/code', { body: { code: 'demo-client-code' } })).status, 403);
  assert.equal((await call('POST', '/api/auth/web/code', { body: { code: 'nope' } })).status, 401);
});
