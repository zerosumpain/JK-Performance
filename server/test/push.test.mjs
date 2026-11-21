import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app.mjs';
import { seedCatalogue } from '../catalogue.mjs';
import { openStore } from '../store.mjs';

// Apple stand-ins: an RSA key for identity tokens, an EC key as our .p8,
// and a fetch that plays Apple's keys, token and revoke endpoints.
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256', use: 'sig' };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const appleToken = claims => {
  const head = b64({ alg: 'RS256', kid: 'test-kid' }), body = b64({ iss: 'https://appleid.apple.com', aud: 'com.jkperformance.app', exp: Math.floor(Date.now() / 1000) + 600, ...claims });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), rsa.privateKey).toString('base64url')}`;
};

const appleCalls = [];
/** Checks the client secret really is ES256-signed by our key for this app. */
function checkSecret(secret) {
  const [h, p, s] = secret.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url')), claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(header.kid, 'TESTKEY123');
  assert.equal(claims.iss, 'TEAM123456');
  assert.equal(claims.sub, 'com.jkperformance.app');
  assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
}
const fetchImpl = async (url, init) => {
  if (String(url).endsWith('/auth/keys')) return { ok: true, json: async () => ({ keys: [jwk] }) };
  const form = new URLSearchParams(init.body);
  checkSecret(form.get('client_secret'));
  appleCalls.push({ path: new URL(url).pathname, form: Object.fromEntries(form) });
  if (url.endsWith('/auth/token')) {
    if (form.get('code') === 'good-code') return { ok: true, status: 200, json: async () => ({ refresh_token: 'refresh-for-sam' }) };
    return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

const sent = [];
let dead = new Set();
const pushTransport = (device, payload) => {
  sent.push({ device, payload });
  return dead.has(device.token) ? { status: 410, reason: 'Unregistered' } : { status: 200, reason: null };
};

let server, base, db;
async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const ok = async (...args) => {
  const r = await call(...args);
  assert.equal(r.status, 200, `${args[0]} ${args[1]} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const settle = () => new Promise(r => setTimeout(r, 20));
const tokenA = 'a'.repeat(64), tokenB = 'b'.repeat(64), tokenC = 'c'.repeat(64);

let coach, sam;
before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jk-push-'));
  const keyFile = join(dir, 'AuthKey_TESTKEY123.p8');
  writeFileSync(keyFile, ec.privateKey.export({ format: 'pem', type: 'pkcs8' }));
  const config = {
    dataDir: dir, appleAudience: 'com.jkperformance.app', coachEmails: ['coach@example.com'], primaryCoachEmail: null,
    supportEmail: 's@example.com', publicUrl: 'https://jk.example.com', gateServices: false, payments: false,
    demoCode: null, demoCoachCode: null, fetchImpl, pushTransport,
    apple: { keyId: 'TESTKEY123', teamId: 'TEAM123456', keyFile },
  };
  db = openStore(':memory:');
  seedCatalogue(db);
  server = createApp(db, config);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  coach = await ok('POST', '/api/auth/apple', { body: { identityToken: appleToken({ sub: 'c', email: 'coach@example.com' }), fullName: { givenName: 'John' } } });
  sam = await ok('POST', '/api/auth/apple', { body: { identityToken: appleToken({ sub: 's', email: 'sam@example.com' }), fullName: { givenName: 'Sam' }, authorizationCode: 'good-code' } });
});
after(() => server.close());

describe('Sign in with Apple tokens', () => {
  test('the authorization code is swapped for a refresh token; a bad code still signs in', async () => {
    assert.equal(db.prepare('SELECT apple_refresh FROM users WHERE id=?').get(sam.me.id).apple_refresh, 'refresh-for-sam');
    const again = await ok('POST', '/api/auth/apple', { body: { identityToken: appleToken({ sub: 's' }), authorizationCode: 'expired' } });
    assert.equal(again.me.id, sam.me.id);
    assert.equal(db.prepare('SELECT apple_refresh FROM users WHERE id=?').get(sam.me.id).apple_refresh, 'refresh-for-sam');
  });
});

describe('Push notifications', () => {
  test('tokens are checked, owned by the latest account, and leave on sign-out', async () => {
    assert.equal((await call('PUT', '/api/push/token', { token: sam.token, body: { token: 'nothex' } })).status, 400);
    assert.equal((await call('PUT', '/api/push/token', { body: { token: tokenA } })).status, 401);
    const r = await ok('PUT', '/api/push/token', { token: sam.token, body: { token: tokenA.toUpperCase(), env: 'sandbox' } });
    assert.equal(r.enabled, true);
    await ok('PUT', '/api/push/token', { token: coach.token, body: { token: tokenB } });
    // The same phone signed in as someone else moves the token.
    await ok('PUT', '/api/push/token', { token: coach.token, body: { token: tokenC } });
    await ok('PUT', '/api/push/token', { token: sam.token, body: { token: tokenC } });
    assert.equal(db.prepare('SELECT user_id FROM push_tokens WHERE token=?').get(tokenC).user_id, sam.me.id);
    assert.equal(db.prepare('SELECT env FROM push_tokens WHERE token=?').get(tokenA).env, 'sandbox');
    await ok('DELETE', `/api/push/token?token=${tokenC}`, { token: sam.token });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM push_tokens WHERE user_id=?').get(sam.me.id).n, 1);
  });

  test('a message reaches the other side only', async () => {
    sent.length = 0;
    await ok('POST', '/api/messages', { token: sam.token, body: { text: 'Knee feels fine today' } });
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].device.token, tokenB);
    assert.equal(sent[0].payload.aps.alert.title, 'Sam');
    assert.equal(sent[0].payload.aps.alert.body, 'Knee feels fine today');
    assert.equal(sent[0].payload.kind, 'message');
    sent.length = 0;
    await ok('POST', '/api/messages', { token: coach.token, body: { clientId: sam.me.id, text: 'Good. Squat Monday.' } });
    await settle();
    assert.deepEqual(sent.map(s => [s.device.token, s.device.env]), [[tokenA, 'sandbox']]);
  });

  test('publishing feedback tells the client once; check-ins tell the coach once', async () => {
    sent.length = 0;
    const week = (await ok('GET', `/api/reports?clientId=${sam.me.id}`, { token: coach.token })).suggestedWeek;
    const body = { clientId: sam.me.id, week, summary: 'Strong week', status: 'published' };
    const first = { body: await ok('PUT', '/api/reports', { token: coach.token, body }) };
    await ok('PUT', '/api/reports', { token: coach.token, body: { ...body, summary: 'Strong week, edited' } });
    await settle();
    const reports = sent.filter(s => s.payload.kind === 'report');
    assert.equal(reports.length, 1);
    assert.equal(reports[0].payload.id, first.body.id);
    sent.length = 0;
    await ok('POST', '/api/checkins', { token: sam.token, body: { energy: 4, sleep: 3, note: 'ok' } });
    await ok('POST', '/api/checkins', { token: sam.token, body: { energy: 5, sleep: 3, note: 'edit' } });
    await settle();
    assert.deepEqual(sent.map(s => [s.payload.kind, s.device.token]), [['checkin', tokenB]]);
  });

  test('a dead token is forgotten', async () => {
    dead = new Set([tokenB]);
    await ok('POST', '/api/messages', { token: sam.token, body: { text: 'Anyone there?' } });
    await settle();
    assert.equal(db.prepare('SELECT COUNT(*) n FROM push_tokens WHERE token=?').get(tokenB).n, 0);
    dead = new Set();
  });

  test('signing out with the token removes it', async () => {
    const s2 = await ok('POST', '/api/auth/apple', { body: { identityToken: appleToken({ sub: 's' }) } });
    await ok('PUT', '/api/push/token', { token: s2.token, body: { token: tokenC } });
    await ok('POST', '/api/auth/logout', { token: s2.token, body: { pushToken: tokenC } });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM push_tokens WHERE token=?').get(tokenC).n, 0);
  });
});

describe('Deleting the account', () => {
  test('revokes Sign in with Apple and drops the push tokens', async () => {
    appleCalls.length = 0;
    const r = await ok('DELETE', '/api/me', { token: sam.token });
    assert.equal(r.appleRevoked, true);
    const revoke = appleCalls.find(c => c.path === '/auth/revoke');
    assert.equal(revoke.form.token, 'refresh-for-sam');
    assert.equal(revoke.form.token_type_hint, 'refresh_token');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM push_tokens').get().n, 0);
  });
});
