import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app.mjs';
import { seedCatalogue } from '../catalogue.mjs';
import { openStore } from '../store.mjs';

// The same stand-in for Apple as api.test.mjs: our own RSA key served as the JWKS.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'desk-kid', alg: 'RS256', use: 'sig' };
const fetchImpl = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function appleToken(claims) {
  const head = b64({ alg: 'RS256', kid: 'desk-kid' }), body = b64({ iss: 'https://appleid.apple.com', aud: 'com.jkperformance.app', exp: Math.floor(Date.now() / 1000) + 600, ...claims });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

const config = { dataDir: '', appleAudience: 'com.jkperformance.app', coachEmails: ['coach@example.com'], primaryCoachEmail: null, supportEmail: 's@example.com', publicUrl: 'https://jk.example.com', gateServices: false, payments: false, demoCode: null, demoCoachCode: null, fetchImpl };
let server, base, coach, client;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
}
const signIn = async (sub, email) => (await call('POST', '/api/auth/apple', { body: { identityToken: appleToken({ sub, email }) } })).body;

before(async () => {
  const db = openStore(':memory:');
  seedCatalogue(db);
  server = createApp(db, config);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  coach = await signIn('desk-coach', 'coach@example.com');
  client = await signIn('desk-client', 'client@example.com');
});
after(() => server.close());

describe('Coach desk', () => {
  test('serves the page and its modules under a strict CSP', async () => {
    const page = await call('GET', '/desk');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client(;|$)/, 'only our modules and Google\'s sign-in button');
    assert.doesNotMatch(csp, /unsafe/);
    assert.match(page.body, /<script type="module" src="\/desk\/main\.js">/);
    assert.match(page.body, /href="\/desk\/app\.css"/);
    for (const name of ['main.js', 'core.js', 'today.js', 'clients.js', 'overview.js', 'letters.js', 'symbols.js', 'schedule.js', 'messages.js', 'programs.js', 'guides.js']) {
      const js = await call('GET', `/desk/${name}`);
      assert.equal(js.status, 200, name);
      assert.match(js.headers.get('content-type'), /javascript/);
    }
    assert.match((await call('GET', '/desk/core.js')).body, /jk\.desk\.token/);
    assert.equal((await call('GET', '/desk/app.css')).status, 200);
    assert.equal((await call('GET', '/desk/nope.js')).status, 404, 'only files in server/desk/');
    // The self-hosted Newsreader serif, allowed by the CSP; nothing else in fonts/ is served.
    assert.match(csp, /font-src 'self'/);
    for (const name of ['newsreader-roman.woff2', 'newsreader-italic.woff2']) {
      const font = await fetch(`${base}/desk/fonts/${name}`);
      assert.equal(font.status, 200, name);
      assert.equal(font.headers.get('content-type'), 'font/woff2');
      assert.equal(Buffer.from(await font.arrayBuffer()).subarray(0, 4).toString('latin1'), 'wOF2');
    }
    assert.equal((await call('GET', '/desk/fonts/OFL-Newsreader.txt')).status, 404);
    assert.match((await call('GET', '/desk/app.css')).body, /--accent:#C8A970/);
    assert.equal((await call('GET', '/desk/..%2Fapp.mjs')).status, 404);
    const login = await fetch(base + '/login', { redirect: 'manual' });
    assert.equal(login.status, 302);
    assert.equal(login.headers.get('location'), '/desk');
  });

  test('a coach makes a one-time code; a client cannot', async () => {
    assert.equal((await call('POST', '/api/auth/link-code', { token: client.token })).status, 403);
    assert.equal((await call('POST', '/api/auth/link-code')).status, 401);
    const made = await call('POST', '/api/auth/link-code', { token: coach.token });
    assert.equal(made.status, 200);
    assert.match(made.body.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(made.body.url, 'https://jk.example.com/desk');

    // Typed lower-case without the dash still works, once.
    const typed = made.body.code.replace('-', '').toLowerCase();
    const first = await call('POST', '/api/auth/link', { body: { code: typed } });
    assert.equal(first.status, 200);
    assert.equal(first.body.me.role, 'coach');
    assert.equal((await call('POST', '/api/auth/link', { body: { code: typed } })).status, 401);
    assert.equal((await call('POST', '/api/auth/link', { body: { code: 'WRONGCODE' } })).status, 401);

    const clients = await call('GET', '/api/coach/clients', { token: first.body.token });
    assert.equal(clients.status, 200);
    assert.ok(clients.body.clients.some(c => c.id === client.me.id));
  });

  test('a newer code replaces an older one', async () => {
    const a = (await call('POST', '/api/auth/link-code', { token: coach.token })).body.code;
    const b = (await call('POST', '/api/auth/link-code', { token: coach.token })).body.code;
    assert.equal((await call('POST', '/api/auth/link', { body: { code: a } })).status, 401);
    assert.equal((await call('POST', '/api/auth/link', { body: { code: b } })).status, 200);
  });
});
