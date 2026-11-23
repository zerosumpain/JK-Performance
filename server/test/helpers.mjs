/**
 * Test helpers for desk v2 (docs/design/desk-v2.md 3.15). New tests use these;
 * older test files keep their own set-up.
 *
 *   const { makeWorld } = await import('./helpers.mjs');   // dynamic, if you set FEATURES_DIR first
 *   const w = await makeWorld();
 *   const r = await w.call('GET', '/api/tags', { as: w.coach });   // {status, body}
 *   const body = await w.ok('POST', '/api/tags', { as: w.coach, body: { name: 'VIP' } });   // asserts 200
 *   await w.settle();                                     // drain events and after-commit work
 *   w.close();
 *
 * - This module is an entry point: it imports server/features.mjs, so every
 *   feature in server/features/ is loaded (or FEATURES_DIR when NODE_ENV=test).
 * - Sign-in uses a fake Apple JWKS. coach@example.com and coach2@example.com
 *   are coaches; anyone else who signs in becomes a client of the first coach.
 * - `config.testNow` is on, so routes that read requestNow(ctx) accept ?at=<iso>.
 * - Pushes go to a recorder: `w.pushes` lists every payload sent.
 * - No network: config.fetchImpl answers Apple's keys and otherwise calls the
 *   handler set with `w.onFetch(fn)`, or throws.
 * - `fakeToday()` gives {today, now} for FAKE_TODAY=monday|sunday|YYYY-MM-DD
 *   (else the real London day at noon), so date logic can be run on chosen days.
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.mjs';
import { issueSession } from '../auth.mjs';
import { seedCatalogue } from '../catalogue.mjs';
import { drainEvents } from '../events.mjs';
import { tickClock } from '../features.mjs';
import { newId, nowIso, openStore } from '../store.mjs';
import { closeAllStreams } from '../stream.mjs';
import { addDays, londonDay, londonToUtc, mondayOf } from '../time.mjs';

export { tickClock };

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'helper-kid', alg: 'RS256', use: 'sig' };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');

/** An Apple identity token signed by the fake key. */
export function appleToken(claims) {
  const head = b64({ alg: 'RS256', kid: 'helper-kid' });
  const body = b64({ iss: 'https://appleid.apple.com', aud: 'com.jkperformance.app', exp: Math.floor(Date.now() / 1000) + 600, ...claims });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

/** {today, now} for FAKE_TODAY (monday, sunday or a YYYY-MM-DD), else the real London day; now is noon London. */
export function fakeToday(which = process.env.FAKE_TODAY) {
  const real = londonDay();
  let today = real;
  if (which === 'monday') today = mondayOf(real);
  else if (which === 'sunday') today = addDays(mondayOf(real), 6);
  else if (/^\d{4}-\d\d-\d\d$/.test(which ?? '')) today = which;
  return { today, now: londonToUtc(today, '12:00') };
}

export async function makeWorld({ config: extra = {} } = {}) {
  const pushes = [];
  let fetchHandler = null;
  const fetchImpl = async (url, init) => {
    if (String(url).startsWith('https://appleid.apple.com/')) return { ok: true, json: async () => ({ keys: [jwk] }) };
    if (fetchHandler) return fetchHandler(String(url), init);
    throw new Error(`No network in tests: ${url}`);
  };
  const config = {
    port: 0, host: '127.0.0.1', dataDir: mkdtempSync(join(tmpdir(), 'jk-world-')), appleAudience: 'com.jkperformance.app',
    coachEmails: ['coach@example.com', 'coach2@example.com'], primaryCoachEmail: 'coach@example.com', supportEmail: 's@example.com',
    publicUrl: 'https://jk.example.com', gateServices: false, payments: false, demoCode: null, demoCoachCode: null, apple: null,
    googleClientIds: [], appleServicesId: null, fcmServiceAccountFile: null, androidDownloadToken: null, logRequests: false,
    pushTransport: (device, payload) => { pushes.push({ token: device.token, ...payload }); return { status: 200 }; },
    fetchImpl, testNow: true, ffmpegPath: 'ffmpeg',
    ai: { key: null, model: null, audioModel: null, dailyCalls: 300, dailyAudioSeconds: 7200, clientDailyNotes: 20, clientDailyAudioSeconds: 1800, disabled: false, baseUrl: 'https://openrouter.ai/api/v1' },
    ...extra,
  };
  const db = openStore(':memory:');
  seedCatalogue(db);
  const server = createApp(db, config);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { as = null, token = as?.token, body, raw, headers = {}, signal } = {}) {
    const res = await fetch(base + path, {
      method, signal,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  }
  const ok = async (method, path, opts) => {
    const r = await call(method, path, opts);
    assert.equal(r.status, 200, `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  /** Sign in with the fake Apple key; returns {token, me, id, row}. */
  const signIn = async (sub, email, fullName) => {
    const s = await ok('POST', '/api/auth/apple', { body: { identityToken: appleToken({ sub, email }), fullName } });
    return { ...s, id: s.me.id, row: db.prepare('SELECT * FROM users WHERE id=?').get(s.me.id) };
  };
  /** A user straight into the database (no sign-in side effects): {id, token, row}. */
  const user = (name, role, coachId = null, { isDemo = false } = {}) => {
    const id = newId('u');
    db.prepare('INSERT INTO users (id, apple_sub, name, role, coach_id, is_demo, created_at, onboarded_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, `sub-${id}`, name, role, coachId, isDemo ? 1 : 0, nowIso(), nowIso());
    return { id, token: issueSession(db, id), row: db.prepare('SELECT * FROM users WHERE id=?').get(id) };
  };
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setImmediate(r));
      drainEvents(db, config);
    }
  };

  const coach = await signIn('helper-coach', 'coach@example.com', { givenName: 'John', familyName: 'Kelly' });
  const client = await signIn('helper-client', 'sam@example.com', { givenName: 'Sam', familyName: 'Carter' });
  await settle();

  return {
    db, config, server, base, call, ok, signIn, user, coach, client, pushes, settle,
    onFetch: fn => { fetchHandler = fn; },
    tick: (id, now) => tickClock(db, config, id, now),
    close: () => { closeAllStreams(); server.closeAllConnections?.(); server.close(); },
  };
}

/**
 * Every table with a client_id, user_id, owner_id or coach_id column has no
 * row for this user (6.2: DELETE /api/me leaves nothing behind).
 */
export function assertNoRowsFor(db, userId) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(t => t.name);
  const left = [];
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name).filter(c => ['client_id', 'user_id', 'owner_id', 'coach_id'].includes(c));
    for (const c of cols) {
      const n = db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${c}=?`).get(userId).n;
      if (n) left.push(`${t}.${c}: ${n}`);
    }
  }
  assert.deepEqual(left, [], `rows left for ${userId}`);
}
