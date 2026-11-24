/**
 * Desk v2 foundation (docs/design/desk-v2.md section 3, WP0-S): the feature
 * loader, events, notifications, the live stream, facts, rules, tags,
 * segments, the outreach governor, templating, actions, the AI module, audio,
 * search and the demo hooks. A fixture feature is copied into a temp folder
 * and loaded through FEATURES_DIR (honoured only with NODE_ENV=test).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SERVER = fileURLToPath(new URL('../', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const mod = name => pathToFileURL(join(SERVER, name)).href;

// The fixture feature: imports store.mjs, messages.mjs and registry.mjs, as a real one may.
const FIXTURE_DIR = mkdtempSync(join(tmpdir(), 'jk-features-'));
const VOICE_FILE = join(FIXTURE_DIR, 'voice.m4a');
writeFileSync(VOICE_FILE, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypM4A '), Buffer.alloc(64)]));
writeFileSync(join(FIXTURE_DIR, 'README.md'), 'Fixture features for foundation.test.mjs\n');
writeFileSync(join(FIXTURE_DIR, 'sample.mjs'), `
import { requireCoach } from '${mod('access.mjs')}';
import { messageOut } from '${mod('messages.mjs')}';
import { featureNames } from '${mod('registry.mjs')}';
import { newId } from '${mod('store.mjs')}';
export const control = { explode: false };
const seen = (db, handler, e) => db.prepare('INSERT INTO sample_seen (seq, handler, type, client_id) VALUES (?,?,?,?)').run(e.seq, handler, e.type, e.clientId);
export const feature = {
  name: 'sample',
  namespaces: ['sample'],
  exact: ['booking.sampled'],
  schema(db, { addColumn }) {
    db.exec(\`CREATE TABLE IF NOT EXISTS sample_seen (seq INTEGER, handler TEXT, type TEXT, client_id TEXT REFERENCES users(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS sample_rows (id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id TEXT REFERENCES users(id) ON DELETE CASCADE, note TEXT)\`);
    addColumn('sample_rows', 'extra', 'TEXT');
  },
  routes(r) {
    r.add('GET', '/api/sample/ping', (_req, ctx) => { requireCoach(ctx); return { pong: true, features: featureNames(), out: typeof messageOut }; });
  },
  clocks: [{ id: 'sample.tick', everyMs: 60000, run(db, _config, now) { return 'ticked at ' + now.toISOString(); } }],
  on: {
    'client.joined': (db, _c, e) => seen(db, 'joined', e),
    'message.received': (db, _c, e) => { if (control.explode) throw new Error('boom'); seen(db, 'received', e); },
    '*': (db, _c, e) => seen(db, 'star', e),
  },
  emits: { 'sample.done': { label: 'Sample done', payload: ['n'] }, 'sample.felt': { label: 'Sample felt', payload: [], aiDerived: true } },
  actions: {
    'sample.mark': { label: 'Mark', clientFacing: false, params: [{ key: 'note', label: 'Note', type: 'text', required: true }],
      run(db, _config, ctx) { db.prepare('INSERT INTO sample_rows (id, coach_id, client_id, note) VALUES (?,?,?,?)').run(newId('smp'), ctx.coachId, ctx.client.id, ctx.params.note); return 'Marked'; } },
  },
  facts: {
    'sample.score': { label: 'Score', type: 'number', compute: (_db, _c, ids) => new Map(ids.map(id => [id, 42])) },
    'sample.mood': { label: 'Mood', type: 'number', aiDerived: true, compute: (_db, _c, ids) => Object.fromEntries(ids.map(id => [id, 1])) },
    'sample.broken': { label: 'Broken', type: 'number', compute() { throw new Error('fact boom'); } },
  },
  variables: { sampleWord: { label: 'Word', value: () => 'bananas' } },
  needs(_db, _coach, clients) { return clients.filter(c => c.name.startsWith('Sam')).map(c => ({ clientId: c.id, kind: 'sample', text: 'Sample reason', at: null, rank: 2, iconKey: 'bolt', action: { label: 'Look', path: '/sample' } })); },
  search(_db, _coach, q) { return q === 'zz' ? [{ type: 'sample', id: 'x', title: 'Sample hit', detail: '', path: '/sample', icon: 'bolt', score: 0.99 }] : []; },
  badges() { return { inbox: 2 }; },
  exportFor(db, user) { return { rows: db.prepare('SELECT note FROM sample_rows WHERE client_id=?').all(user.id) }; },
  quiet(db) { return new Set(db.prepare("SELECT note FROM sample_rows WHERE extra='quiet'").all().map(r => r.note)); },
  demo: {
    tables: { client: ['sample_rows', 'sample_seen'] },
    media: [{ key: 'sample-voice', file: ${JSON.stringify(VOICE_FILE)}, mime: 'audio/mp4', durationSec: 12 }],
    build(db, ctx) {
      const m = ctx.media('sample-voice');
      for (const c of ctx.clients) db.prepare('INSERT INTO sample_rows (id, coach_id, client_id, note) VALUES (?,?,?,?)').run(newId('smp'), ctx.coach.id, c.id, m?.id ?? 'no media');
    },
  },
};
`);
process.env.NODE_ENV = 'test';
process.env.FEATURES_DIR = FIXTURE_DIR;

const { makeWorld, assertNoRowsFor, fakeToday } = await import('./helpers.mjs');
const { validateFeatures } = await import('../features.mjs');
const { FEATURES, allFacts, allEvents, hooks } = await import('../registry.mjs');
const { emit, drainEvents, eventsFor } = await import('../events.mjs');
const { tx, afterCommit, setCoachPref } = await import('../store.mjs');
const { sendMessage } = await import('../messages.mjs');
const { notifyCoach } = await import('../notifications.mjs');
const facts = await import('../facts.mjs');
const { render } = await import('../templating.mjs');
const ai = await import('../ai.mjs');
const audio = await import('../audio.mjs');
const { buildDemo } = await import('../demo.mjs');
const { addDays, londonToUtc } = await import('../time.mjs');
const { limit } = await import('../ratelimit.mjs');
const { rng } = await import('../rng.mjs');
const fixture = await import(pathToFileURL(join(FIXTURE_DIR, 'sample.mjs')).href);

let w;
const { today, now } = fakeToday();
const at = (day, clock) => londonToUtc(day, clock);
const pushToken = (db, userId, n) => db.prepare("INSERT INTO push_tokens (token, user_id, env, platform, created_at, updated_at) VALUES (?,?,'production','ios',?,?)")
  .run(String(n).repeat(64).slice(0, 64), userId, new Date().toISOString(), new Date().toISOString());

before(async () => { w = await makeWorld(); });
after(() => w.close());

describe('the feature loader', () => {
  const ok = { name: 'one', namespaces: ['one'], emits: { 'one.done': { label: 'x' } } };
  const load = (...features) => validateFeatures(features.map(f => ({ file: f.name, feature: f })));

  test('the fixture loaded, with its schema, routes and clocks', async () => {
    assert.deepEqual(FEATURES.map(f => f.name), ['sample']);
    assert.ok(w.db.prepare("SELECT 1 FROM sqlite_master WHERE name='sample_rows'").get());
    assert.ok(w.db.prepare('PRAGMA table_info(sample_rows)').all().some(c => c.name === 'extra'), 'addColumn');
    assert.deepEqual((await w.ok('GET', '/api/sample/ping', { as: w.coach })).features, ['sample']);
    assert.equal((await w.call('GET', '/api/sample/ping', { as: w.client })).status, 403);
    assert.match(await w.tick('sample.tick', now), /^ticked at /);
    assert.deepEqual(await w.ok('GET', '/api/coach/capabilities', { as: w.coach }), { features: ['sample'], ai: { provider: 'stub' } });
  });

  test('a bad id, a clash and a reserved id each throw', () => {
    assert.equal(load(ok).length, 1);
    assert.throws(() => load({ ...ok, emits: { 'two.done': { label: 'x' } } }), /outside its namespaces/);
    assert.throws(() => load(ok, { name: 'two', namespaces: ['one'] }), /already claimed by one/);
    assert.throws(() => load({ name: 'two', namespaces: ['message'] }), /reserved by the foundation/);
    assert.throws(() => load({ name: 'two', exact: ['client.joined'] }), /reserved by the foundation/);
    assert.throws(() => load(ok, { name: 'two', exact: ['booking.x'] }, { name: 'three', exact: ['booking.x'] }), /already claimed by two/);
    assert.throws(() => load({ name: 'two', namespaces: ['client'] }), /covers id "client.joined", which is reserved/);
    assert.throws(() => load(ok, { name: 'two', exact: ['one.extra'] }), /in namespace "one", which is claimed by one/);
    assert.throws(() => load({ name: 'two', exact: ['zed.x'] }, { name: 'three', namespaces: ['zed'] }), /covers id "zed.x", which is claimed by two/);
    const word = { label: 'w', value: () => 'w' };
    assert.throws(() => load({ ...ok, variables: { first: word } }), /variable "first" is reserved/);
    assert.throws(() => load({ ...ok, variables: { word } }, { name: 'two', namespaces: ['two'], variables: { word } }), /variable "word" is already claimed by one/);
    assert.throws(() => load({ ...ok, colour: 'red' }), /unknown key "colour"/);
    assert.throws(() => validateFeatures([{ file: 'other', feature: ok }]), /must equal the file name/);
    assert.throws(() => load({ ...ok, variables: { mood: { label: 'm', aiDerived: true, value: () => 1 } } }), /AI-derived/);
    assert.throws(() => load({ ...ok, on: { 'one.done': async () => {} } }), /synchronous/);
    assert.throws(() => load({ ...ok, actions: { 'one.go': { label: 'Go' } } }), /needs run/);
  });

  test('features import no entry point and no other feature', () => {
    const banned = /(^|\/)(app|main|features|demo|account)\.mjs$|\/features\/[a-z0-9-]+\.mjs$/;
    const dirs = [join(SERVER, 'features'), FIXTURE_DIR];
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter(n => /^[a-z0-9-]+\.mjs$/.test(n))) {
        const src = readFileSync(join(dir, file), 'utf8');
        for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
          const spec = m[1] ?? m[2];
          assert.ok(!banned.test(spec.replace(/^file:\/\//, '')) || spec.endsWith('/registry.mjs'), `${file} imports ${spec}`);
        }
      }
    }
  });

  test('importing app.mjs with the fixture settles (no import cycle)', () => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./server/app.mjs')"], {
      cwd: ROOT, timeout: 5000, env: { ...process.env, NODE_ENV: 'test', FEATURES_DIR: FIXTURE_DIR }, encoding: 'utf8',
    });
    assert.equal(r.status, 0, `exit ${r.status} ${r.signal ?? ''} ${r.stderr}`);
  });
});

describe('events', () => {
  const seen = (handler, seq) => w.db.prepare('SELECT COUNT(*) n FROM sample_seen WHERE handler=? AND seq=?').get(handler, seq).n;

  test('cursors are created eagerly, and an event emitted at start-up runs each handler exactly once', async () => {
    const keys = w.db.prepare("SELECT handler FROM event_cursors WHERE handler LIKE 'sample:%' ORDER BY handler").all().map(r => r.handler);
    assert.deepEqual(keys, ['sample:*', 'sample:client.joined', 'sample:message.received']);
    const joined = eventsFor(w.db, { clientId: w.client.id, types: ['client.joined'] })[0];
    assert.equal(joined.summary, 'Joined');
    assert.equal(joined.payload.email, 'sam@example.com');
    assert.equal(seen('joined', joined.seq), 1);
    assert.equal(seen('star', joined.seq), 1);
    await w.settle();
    drainEvents(w.db, w.config);
    assert.equal(seen('joined', joined.seq), 1, 'never twice');
  });

  test('a rolled-back write emits nothing; a throwing handler is logged and skipped', async () => {
    assert.throws(() => tx(w.db, () => { emit(w.db, 'sample.done', { coachId: w.coach.id, n: 1 }); throw new Error('roll back'); }));
    await w.settle();
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM events WHERE type='sample.done'").get().n, 0);
    fixture.control.explode = true;
    try {
      await w.ok('POST', '/api/messages', { as: w.client, body: { text: 'Hello coach' } });
      await w.settle();
    } finally { fixture.control.explode = false; }
    const ev = eventsFor(w.db, { clientId: w.client.id, types: ['message.received'] })[0];
    assert.equal(ev.summary, 'Message');
    assert.match(w.db.prepare('SELECT error FROM event_failures WHERE seq=? AND handler=?').get(ev.seq, 'sample:message.received').error, /boom/);
    assert.equal(seen('star', ev.seq), 1, 'other handlers still ran');
    await w.ok('POST', '/api/messages', { as: w.client, body: { text: 'Again' } });
    await w.settle();
    assert.equal(seen('received', eventsFor(w.db, { clientId: w.client.id, types: ['message.received'] })[0].seq), 1, 'the cursor moved on');
  });

  test('a rolled-back emit does not stall the immediate drain', async () => {
    const turns = async n => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
    assert.throws(() => tx(w.db, () => { emit(w.db, 'client.joined', { coachId: w.coach.id, clientId: w.client.id }); throw new Error('roll back'); }));
    await turns(3);
    const seq = emit(w.db, 'client.joined', { coachId: w.coach.id, clientId: w.client.id }) && w.db.prepare('SELECT MAX(seq) seq FROM events').get().seq;
    await turns(5); // no settle(): only the after-commit drain can have run the handler
    assert.equal(seen('joined', seq), 1);
  });

  test('existing code emits: message.sent, checkin, form, booking, workout, membership, letter', async () => {
    const { coach, client } = w;
    await w.ok('POST', '/api/messages', { as: coach, body: { clientId: client.id, text: 'Morning' } });
    await w.ok('POST', '/api/checkins', { as: client, body: { energy: 3, sleep: 3, pain: ['Knee'], note: 'Sore' } });
    const form = await w.ok('POST', '/api/forms', { as: coach, body: { name: 'Quick', questions: [{ kind: 'yesno', label: 'Pain?', flag: true }] } });
    const req = await w.ok('POST', `/api/forms/${form.id}/send`, { as: coach, body: { clientId: client.id } });
    await w.ok('POST', `/api/form-requests/${req.id}/answers`, { as: client, body: { answers: { [form.questions[0].id]: true } } });
    const cls = await w.ok('POST', '/api/classes', { as: coach, body: { title: 'Conditioning', start: addDays(today, 3) + 'T08:00:00Z', end: addDays(today, 3) + 'T09:00:00Z', capacity: 5 } });
    await w.ok('POST', `/api/classes/${cls.id}/join`, { as: client });
    await w.ok('POST', `/api/classes/${cls.id}/leave`, { as: client });
    await w.ok('POST', '/api/me/membership', { as: client, body: { plan: 'elite' } });
    await w.settle();
    const types = eventsFor(w.db, { coachId: coach.id, limit: 100 }).map(e => e.type);
    for (const t of ['message.sent', 'checkin.submitted', 'form.sent', 'form.submitted', 'booking.created', 'booking.cancelled', 'membership.changed']) assert.ok(types.includes(t), t);
    const sent = eventsFor(w.db, { coachId: coach.id, types: ['message.sent'] })[0];
    assert.equal(sent.payload.via, 'desk');
    assert.equal(eventsFor(w.db, { coachId: coach.id, types: ['checkin.submitted'] })[0].payload.pain, true);
    assert.equal(eventsFor(w.db, { coachId: coach.id, types: ['form.submitted'] })[0].payload.flagged, 1);
    assert.equal(eventsFor(w.db, { coachId: coach.id, types: ['membership.changed'] })[0].summary, 'Plan: Elite');
    assert.equal(sent.payload.text, undefined, 'never a message body');
  });

  test('day.started once per coach per London day, after 05:00', async () => {
    const before = w.db.prepare("SELECT COUNT(*) n FROM events WHERE type='day.started'").get().n;
    assert.equal(await w.tick('core.dayStarted', at(today, '04:59')), 0);
    assert.ok(await w.tick('core.dayStarted', at(today, '05:01')) >= 1);
    assert.equal(await w.tick('core.dayStarted', at(today, '09:00')), 0);
    assert.ok(w.db.prepare("SELECT COUNT(*) n FROM events WHERE type='day.started'").get().n > before);
  });
});

describe('notifications and the live stream', () => {
  test('dedupe, list, count and read; another coach sees none of it', async () => {
    const other = w.user('Other Coach', 'coach');
    const n1 = notifyCoach(w.db, w.config, w.coach.id, { clientId: w.client.id, kind: 'test', title: 'One', dedupe: 'one' });
    assert.ok(n1);
    assert.equal(notifyCoach(w.db, w.config, w.coach.id, { kind: 'test', title: 'One again', dedupe: 'one' }), null, 'deduped within 24 h');
    const list = await w.ok('GET', '/api/notifications', { as: w.coach });
    assert.equal(list.items[0].title, 'One');
    assert.equal(list.items[0].client.name, 'Sam Carter');
    assert.ok(list.unread >= 1);
    assert.deepEqual(await w.ok('GET', '/api/notifications', { as: other }), { items: [], unread: 0 });
    assert.equal((await w.call('POST', '/api/notifications/read', { as: other, body: { ids: [n1.id] } })).status, 404);
    await w.ok('POST', '/api/notifications/read', { as: w.coach, body: { ids: [n1.id] } });
    assert.equal((await w.ok('POST', '/api/notifications/read', { as: w.coach, body: { all: true } })).unread, 0);
    assert.equal((await w.ok('GET', '/api/notifications/count', { as: w.coach })).unread, 0);
    assert.equal((await w.call('GET', '/api/notifications', { as: w.client })).status, 403);
  });

  test('urgent notifications push to the coach once; data ones never; quiet hours wait; read ones never push', async () => {
    pushToken(w.db, w.coach.id, 'a');
    const pushed = () => w.pushes.filter(p => p.kind === 'coachNotification').length;
    const start = pushed();
    notifyCoach(w.db, w.config, w.coach.id, { kind: 'pain', title: 'Pain reported', tone: 'urgent', dedupe: 'u1', now: at(today, '12:00') });
    notifyCoach(w.db, w.config, w.coach.id, { kind: 'info', title: 'FYI', tone: 'data', now: at(today, '12:00') });
    await w.settle();
    assert.equal(pushed(), start + 1);
    const late = notifyCoach(w.db, w.config, w.coach.id, { kind: 'pain', title: 'Late pain', tone: 'urgent', dedupe: 'u2', now: at(today, '23:00') });
    const read = notifyCoach(w.db, w.config, w.coach.id, { kind: 'pain', title: 'Read pain', tone: 'urgent', dedupe: 'u3', now: at(today, '23:30') });
    assert.equal(late.push_after, at(addDays(today, 1), '06:30').toISOString());
    await w.ok('POST', '/api/notifications/read', { as: w.coach, body: { ids: [read.id] } });
    await w.settle();
    assert.equal(pushed(), start + 1, 'held in quiet hours');
    assert.equal(await w.tick('core.urgentPush', at(addDays(today, 1), '06:00')), 0);
    assert.equal(await w.tick('core.urgentPush', at(addDays(today, 1), '06:31')), 1);
    assert.equal(await w.tick('core.urgentPush', at(addDays(today, 1), '06:40')), 0, 'once');
    assert.equal(pushed(), start + 2);
    w.db.prepare('DELETE FROM push_tokens WHERE user_id=?').run(w.coach.id);
  });

  test('the stream sends notifications and committed events to the coach only', async () => {
    assert.equal((await w.call('GET', '/api/coach/stream', { as: w.client })).status, 403);
    const ac = new AbortController();
    const res = await fetch(`${w.base}/api/coach/stream`, { headers: { authorization: `Bearer ${w.coach.token}` }, signal: ac.signal });
    assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    assert.equal(res.headers.get('x-accel-buffering'), 'no');
    const reader = res.body.getReader();
    let text = '';
    const until = async re => { while (!re.test(text)) { const { value, done } = await reader.read(); if (done) break; text += Buffer.from(value).toString('utf8'); } };
    await until(/: connected/);
    notifyCoach(w.db, w.config, w.coach.id, { kind: 'test', title: 'Live one' });
    await until(/event: notification/);
    assert.match(text, /"title":"Live one"/);
    await w.ok('POST', '/api/messages', { as: w.client, body: { text: 'Live message' } });
    await w.settle();
    await until(/event: message\.received/);
    assert.doesNotMatch(text, /Live message/, 'summaries only, never bodies');
    ac.abort();
  });
});

describe('facts, rules, tags and segments', () => {
  test('an in-person session 3 days ago counts as activity; quiet bookings do not', async () => {
    const c = w.user('Pat Walker', 'client', w.coach.id);
    w.db.prepare('UPDATE users SET created_at=? WHERE id=?').run(at(addDays(today, -60), '09:00').toISOString(), c.id);
    const b = (day, id) => w.db.prepare("INSERT INTO bookings (id, coach_id, client_id, kind, start, end, title, created_at) VALUES (?,?,?,'inperson',?,?,'1:1',?)")
      .run(id, w.coach.id, c.id, at(day, '07:00').toISOString(), at(day, '08:00').toISOString(), new Date().toISOString());
    b(addDays(today, -3), 'b_three');
    b(addDays(today, -1), 'b_noshow');
    w.db.prepare("INSERT INTO sample_rows (id, coach_id, client_id, note, extra) VALUES ('smp_q', ?, ?, 'b_noshow', 'quiet')").run(w.coach.id, c.id);
    const f = facts.clientFacts(w.db, w.coach.id, [c.id], { today, now }).get(c.id);
    assert.equal(f['core.daysQuiet'], 3);
    assert.equal(f['core.sessionsAttended14'], 1);
    assert.equal(f['sample.score'], 42);
    assert.equal(f['sample.broken'], null, 'a throwing provider gives null');
    assert.equal(f['core.segments'], undefined, 'segments only when asked');
    w.db.prepare("DELETE FROM sample_rows WHERE id='smp_q'").run();
  });

  test('rules validate with a path, and evaluate', () => {
    assert.throws(() => facts.validateRules({ match: 'all', rules: [{ fact: 'core.plan', op: 'eq', value: 'elite' }, { match: 'any', rules: [{ fact: 'core.plan', op: 'nope', value: 1 }] }] }),
      e => e.status === 400 && e.message === 'rules[1].rules[0].op is not known');
    assert.throws(() => facts.validateRules({ match: 'all', rules: [{ fact: 'core.nope', op: 'eq', value: 1 }] }), /rules\[0\]\.fact is not known/);
    assert.throws(() => facts.validateRules({ match: 'all', rules: [{ match: 'any', rules: [{ match: 'all', rules: [] }] }] }), /nests too deep/);
    assert.throws(() => facts.validateRules({ match: 'all', rules: Array.from({ length: 21 }, () => ({ fact: 'core.unread', op: 'gt', value: 0 })) }), /more than 20/);
    const rules = { match: 'all', rules: [{ fact: 'core.daysQuiet', op: 'gte', value: 7 },
      { match: 'any', rules: [{ fact: 'core.tags', op: 'has', value: 'tg_a' }, { fact: 'core.plan', op: 'in', value: ['performance', 'elite'] }] }] };
    assert.equal(facts.evaluate(rules, { 'core.daysQuiet': 9, 'core.tags': [], 'core.plan': 'elite' }), true);
    assert.equal(facts.evaluate(rules, { 'core.daysQuiet': 9, 'core.tags': [], 'core.plan': 'none' }), false);
    assert.equal(facts.evaluate({ match: 'all', rules: [{ fact: 'x', op: 'between', value: [2, 4] }] }, { x: 4 }), true);
    assert.equal(facts.evaluate({ match: 'all', rules: [{ fact: 'x', op: 'isSet' }] }, { x: null }), false);
  });

  test('tags: CRUD, client tags emit, bulk refuses one foreign id and writes nothing', async () => {
    const other = w.user('Other Coach', 'coach');
    const otherClient = w.user('Foreign Client', 'client', other.id);
    const vip = (await w.ok('POST', '/api/tags', { as: w.coach, body: { name: 'VIP', color: 'chart-2' } })).tag;
    assert.equal((await w.call('POST', '/api/tags', { as: w.coach, body: { name: 'VIP' } })).status, 409);
    assert.equal((await w.call('POST', '/api/tags', { as: w.coach, body: { name: 'X', color: '#fff' } })).status, 400);
    const put = await w.ok('PUT', `/api/coach/clients/${w.client.id}/tags`, { as: w.coach, body: { tagIds: [vip.id] } });
    assert.deepEqual(put.tags.map(t => t.name), ['VIP']);
    await w.settle();
    assert.equal(eventsFor(w.db, { clientId: w.client.id, types: ['client.tagged'] })[0].payload.tagId, vip.id);
    assert.equal((await w.call('PUT', `/api/coach/clients/${w.client.id}/tags`, { as: other, body: { tagIds: [] } })).status, 404);
    assert.equal((await w.call('PATCH', `/api/tags/${vip.id}`, { as: other, body: { name: 'Mine' } })).status, 404);
    const bulk = await w.call('POST', '/api/coach/clients/tags', { as: w.coach, body: { clientIds: [w.client.id, otherClient.id], remove: [vip.id] } });
    assert.equal(bulk.status, 404);
    assert.equal((await w.ok('GET', '/api/tags', { as: w.coach })).tags.find(t => t.id === vip.id).count, 1, 'nothing written');
    assert.equal((await w.ok('POST', '/api/coach/clients/tags', { as: w.coach, body: { clientIds: [w.client.id], remove: [vip.id] } })).changed, 1);
    await w.ok('PATCH', `/api/tags/${vip.id}`, { as: w.coach, body: { color: 'chart-3' } });
    await w.ok('DELETE', `/api/tags/${vip.id}`, { as: w.coach });
    assert.equal((await w.call('GET', '/api/tags', { as: w.client })).status, 403);
  });

  test('segments: CRUD, counts, preview and core.segments', async () => {
    const rules = { match: 'all', rules: [{ fact: 'core.plan', op: 'eq', value: 'elite' }] };
    const seg = (await w.ok('POST', '/api/segments', { as: w.coach, body: { name: 'Elite', rules } })).segment;
    assert.equal(seg.count, 1);
    assert.equal((await w.call('POST', '/api/segments', { as: w.coach, body: { name: 'Bad', rules: { match: 'all', rules: [{ fact: 'core.segments', op: 'has', value: seg.id }] } } })).status, 400);
    const preview = await w.ok('POST', '/api/segments/preview', { as: w.coach, body: { rules } });
    assert.deepEqual(preview.clients.map(c => c.name), ['Sam Carter']);
    assert.deepEqual(facts.clientFacts(w.db, w.coach.id, [w.client.id], { only: ['core.segments'] }).get(w.client.id)['core.segments'], [seg.id]);
    const other = w.user('Other Coach', 'coach');
    assert.equal((await w.call('PUT', `/api/segments/${seg.id}`, { as: other, body: { name: 'x', rules } })).status, 404);
    assert.equal((await w.call('POST', '/api/segments/preview', { as: other, body: { audience: { segmentId: seg.id } } })).status, 404);
    await w.ok('PUT', `/api/segments/${seg.id}`, { as: w.coach, body: { name: 'Elite people', rules, pinned: true } });
    assert.equal((await w.ok('GET', '/api/segments', { as: w.coach })).segments[0].pinned, true);
    await w.ok('DELETE', `/api/segments/${seg.id}`, { as: w.coach });
  });

  test('facts routes and AI-derived facts are refused for audiences that message', async () => {
    const list = (await w.ok('GET', '/api/facts', { as: w.coach })).facts;
    assert.ok(list.some(f => f.id === 'core.daysQuiet' && f.type === 'days'));
    assert.equal(list.find(f => f.id === 'sample.mood').aiDerived, true);
    const mine = (await w.ok('GET', `/api/facts/clients/${w.client.id}`, { as: w.coach })).facts;
    assert.equal(mine['sample.score'], 42);
    assert.ok(Array.isArray(mine['core.tags']));
    assert.equal((await w.call('GET', `/api/facts/clients/${w.client.id}`, { as: w.user('X', 'coach') })).status, 404);
    const mood = { rules: { match: 'all', rules: [{ fact: 'sample.mood', op: 'gte', value: 1 }] } };
    assert.equal(facts.resolveAudience(w.db, w.coach.id, mood).length >= 1, true, 'reading is fine');
    assert.throws(() => facts.resolveAudience(w.db, w.coach.id, mood, { purpose: 'broadcast' }), e => e.status === 400);
    assert.throws(() => facts.resolveAudience(w.db, w.coach.id, mood, { purpose: 'automated' }), e => e.status === 400);
    assert.ok(allEvents().find(e => e.type === 'sample.felt').aiDerived);
  });
});

describe('the outreach governor (3.5)', () => {
  let c;
  before(() => {
    c = w.user('Gov Client', 'client', w.coach.id);
    pushToken(w.db, c.id, 'b');
  });
  const send = (via, when, text = 'Hi') => sendMessage(w.db, w.config, { coachId: w.coach.id, clientId: c.id, text, via, now: when });

  test('the 4th automated send of the day is held until the next morning, then sent', async () => {
    const noon = at(today, '12:00');
    for (let i = 0; i < 3; i++) assert.ok(send('automation', noon, `A${i}`).message);
    const held = send('automation', noon, 'A3');
    assert.equal(held.message, null);
    assert.equal(held.deferredUntil, at(addDays(today, 1), '07:30').toISOString());
    for (let i = 0; i < 5; i++) assert.ok(send('desk', noon, `D${i}`).message, 'coach sends are never capped');
    assert.equal(await w.tick('core.deferred', at(addDays(today, 1), '07:00')), 0);
    assert.equal(await w.tick('core.deferred', at(addDays(today, 1), '07:31')), 1);
    assert.equal(w.db.prepare("SELECT status FROM deferred_messages WHERE client_id=? AND text='A3'").get(c.id).status, 'sent');
    assert.equal(w.db.prepare("SELECT via FROM messages WHERE client_id=? AND text='A3'").get(c.id).via, 'automation');
  });

  test('quiet hours hold a campaign nudge and a dunning step; dunning keeps 08:00-20:00', () => {
    const night = at(today, '22:00');
    assert.equal(send('campaign', night).deferredUntil, at(addDays(today, 1), '07:30').toISOString());
    assert.equal(send('dunning', night).deferredUntil, at(addDays(today, 1), '08:00').toISOString());
    assert.equal(send('dunning', at(today, '07:45')).deferredUntil, at(today, '08:00').toISOString());
    assert.equal(send('dunning', at(today, '20:30')).deferredUntil, at(addDays(today, 1), '08:00').toISOString());
    assert.ok(send('desk', night).message, 'a coach-typed send is never held');
  });

  test('a send held twice is dropped', async () => {
    w.db.prepare("INSERT INTO deferred_messages (id, coach_id, client_id, text, via, send_at, reason, created_at) VALUES ('dm_twice', ?, ?, 'Twice', 'automation', ?, 'quietHours', ?)")
      .run(w.coach.id, c.id, at(today, '21:00').toISOString(), at(today, '21:00').toISOString());
    await w.tick('core.deferred', at(today, '23:00'));
    assert.equal(w.db.prepare("SELECT status FROM deferred_messages WHERE id='dm_twice'").get().status, 'dropped');
  });

  test('paused: no automation message but desk messages; no broadcasts drops the client from a broadcast audience', async () => {
    const out = await w.ok('PUT', `/api/coach/clients/${c.id}/outreach`, { as: w.coach, body: { paused: true, note: 'Holiday' } });
    assert.deepEqual({ ...out.outreach, sentToday: 0 }, { paused: true, noBroadcasts: false, note: 'Holiday', sentToday: 0, cap: 3 });
    const before = w.db.prepare('SELECT COUNT(*) n FROM messages WHERE client_id=?').get(c.id).n;
    assert.equal(send('automation', at(today, '12:00')).skipped, 'outreach paused');
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM messages WHERE client_id=?').get(c.id).n, before, 'writes nothing');
    assert.ok(send('desk', at(today, '12:00')).message);
    await w.ok('PUT', `/api/coach/clients/${c.id}/outreach`, { as: w.coach, body: { paused: false, noBroadcasts: true } });
    const audience = facts.resolveAudience(w.db, w.coach.id, { clientIds: [c.id, w.client.id] }, { purpose: 'broadcast' });
    assert.deepEqual(audience.map(x => x.id), [w.client.id]);
    assert.equal(audience.skipped.noBroadcasts, 1);
    assert.equal(send('broadcast', at(today, '12:00')).skipped, 'no broadcasts');
    assert.equal((await w.call('GET', `/api/coach/clients/${c.id}/outreach`, { as: w.user('Y', 'coach') })).status, 404);
    await w.ok('PUT', `/api/coach/clients/${c.id}/outreach`, { as: w.coach, body: { noBroadcasts: false } });
  });

  test('an action that throws after message.send leaves no row and sends no push', async () => {
    const pushes = w.pushes.length;
    const rows = w.db.prepare('SELECT COUNT(*) n FROM messages WHERE client_id=?').get(c.id).n;
    assert.throws(() => tx(w.db, () => {
      facts.runAction(w.db, w.config, 'message.send', { coachId: w.coach.id, client: { id: c.id }, params: { text: 'Hello {first}' }, now: at(addDays(today, 5), '12:00') });
      throw new Error('later step failed');
    }), /later step failed/);
    await w.settle();
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM messages WHERE client_id=?').get(c.id).n, rows);
    assert.equal(w.pushes.length, pushes);
    const ok = facts.runAction(w.db, w.config, 'message.send', { coachId: w.coach.id, client: { id: c.id }, params: { text: 'Hello {first}' }, now: at(addDays(today, 5), '12:00') });
    assert.equal(ok, 'Sent');
    await w.settle();
    assert.equal(w.pushes.at(-1).aps.alert.body, 'Hello Gov');
  });

  test('sendMessage refuses another coach\'s client', () => {
    const other = w.user('Other Coach', 'coach');
    assert.throws(() => sendMessage(w.db, w.config, { coachId: other.id, clientId: c.id, text: 'x', via: 'desk' }), e => e.status === 404);
  });
});

describe('templating and actions', () => {
  test('variables fill; unknown ones stay and are reported; features add theirs', () => {
    const client = w.db.prepare('SELECT * FROM users WHERE id=?').get(w.client.id);
    const r = render(w.db, w.coach.id, client, 'Hi {first} {name}, from {coachFirst}. {sampleWord}! {nope} {nextSession}', { extra: { campaign: 'Spring' } });
    assert.equal(r.text, 'Hi Sam Sam Carter, from John. bananas! {nope} ');
    assert.deepEqual(r.missing, ['nope']);
    assert.deepEqual(r.empty, ['nextSession']);
    assert.equal(render(w.db, w.coach.id, client, '{campaign}', { extra: { campaign: 'Spring' } }).text, 'Spring');
    assert.equal(render(w.db, w.coach.id, client, 'x'.repeat(5000)).text.length, 4000);
  });

  test('built-in and feature actions run; params are checked', () => {
    assert.throws(() => facts.checkParams('sample.mark', {}), /note is required/);
    assert.deepEqual(facts.checkParams('program.assign', { programId: 'p_x' }), { programId: 'p_x', start: 'nextMonday' });
    const client = { id: w.client.id };
    assert.equal(facts.runAction(w.db, w.config, 'sample.mark', { coachId: w.coach.id, client, params: { note: 'hello' } }), 'Marked');
    assert.equal(facts.runAction(w.db, w.config, 'coach.notify', { coachId: w.coach.id, client, params: { title: 'Check {first}' } }), 'Notified');
    assert.equal(facts.runAction(w.db, w.config, 'form.send', { coachId: w.coach.id, client, params: { formId: 'f_gone' } }), 'Skipped: no form');
    const other = w.user('Other Coach', 'coach');
    assert.throws(() => facts.runAction(w.db, w.config, 'sample.mark', { coachId: other.id, client, params: { note: 'x' } }), e => e.status === 404);
    assert.ok(facts.actionCatalogue().some(a => a.id === 'message.send' && a.clientFacing === true));
    assert.ok(facts.actionCatalogue().some(a => a.id === 'sample.mark' && a.clientFacing === false && !a.run));
  });
});

describe('the AI module', () => {
  const coachRow = () => w.db.prepare('SELECT * FROM users WHERE id=?').get(w.coach.id);
  const stub = () => ({ text: '[Stub] fine', json: { verdict: 'ok' } });
  const schema = { type: 'object', required: ['verdict'], properties: { verdict: { type: 'string' } } };
  const withKey = async fn => {
    Object.assign(w.config.ai, { key: 'test-key', model: 'vendor/text-model' });
    try { await fn(); } finally { Object.assign(w.config.ai, { key: null, model: null }); w.onFetch(null); }
  };

  test('without a key the stub answers, labelled, and only metadata is kept', async () => {
    assert.equal(ai.aiInfo(w.db, w.config, coachRow()).provider, 'stub');
    const r = await ai.complete(w.db, w.config, { user: coachRow(), purpose: 'review', system: 's', prompt: 'secret words', schema, stub });
    assert.equal(r.provider, 'stub');
    assert.deepEqual(r.json, { verdict: 'ok' });
    const row = w.db.prepare("SELECT * FROM ai_calls WHERE coach_id=? ORDER BY at DESC LIMIT 1").get(w.coach.id);
    assert.equal(row.provider, 'stub');
    assert.ok(!JSON.stringify(row).includes('secret'), 'no prompts');
    await assert.rejects(ai.complete(w.db, w.config, { user: coachRow(), purpose: 'review', system: 's', prompt: 'p' }), /stub/);
    assert.throws(() => ai.aiInfo(w.db, w.config, w.db.prepare('SELECT * FROM users WHERE id=?').get(w.client.id)), /coach row/);
  });

  test('redaction removes email, phone, link, postcode and surname', () => {
    const out = ai.redactForAi('Mail sam.carter@example.com or call 07700 900123 / +44 20 7946 0958, see https://x.example/a?b=1 or example.com/x at SW1A 1AA. Carter said hi.', { surname: 'Carter' });
    for (const p of ['[email]', '[phone]', '[link]', '[postcode]', '[surname]']) assert.ok(out.includes(p), `${p} in ${out}`);
    for (const o of ['sam.carter@example.com', '07700', '7946', 'https://', 'example.com/x', 'SW1A', 'Carter']) assert.ok(!out.includes(o), `${o} gone from ${out}`);
  });

  test('OpenRouter: privacy settings, json_schema with require_parameters, a downgrade on 400, and a visible privacy failure', async () => {
    await withKey(async () => {
      const bodies = [];
      w.onFetch(async (url, init) => {
        const body = JSON.parse(init.body);
        bodies.push({ url, body, headers: init.headers });
        if (body.response_format?.type === 'json_schema') return { ok: false, status: 400, json: async () => ({ error: { message: 'json_schema is not supported' } }) };
        return { ok: true, json: async () => ({ model: body.model, choices: [{ message: { content: '```json\n{"verdict":"good"}\n```' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
      });
      const info = ai.aiInfo(w.db, w.config, coachRow());
      assert.equal(info.provider, 'openrouter');
      const r = await ai.complete(w.db, w.config, { user: coachRow(), purpose: 'review', system: 's', prompt: 'p', schema, stub });
      assert.deepEqual(r.json, { verdict: 'good' });
      assert.equal(bodies[0].url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.deepEqual(bodies[0].body.provider, { data_collection: 'deny', zdr: true, require_parameters: true });
      assert.equal(bodies[0].body.response_format.json_schema.strict, true);
      assert.equal(bodies[0].headers['x-title'], 'JK Performance');
      assert.deepEqual(bodies[1].body.response_format, { type: 'json_object' });
      assert.match(bodies[1].body.messages[1].content[0].text, /JSON Schema/);
      assert.equal(w.db.prepare("SELECT error FROM ai_calls WHERE provider='openrouter' ORDER BY at DESC LIMIT 1").get().error, 'downgraded:json_object');

      w.onFetch(async () => ({ ok: false, status: 404, json: async () => ({ error: { message: 'No endpoints found matching your data policy' } }) }));
      await assert.rejects(ai.complete(w.db, w.config, { user: coachRow(), purpose: 'review', system: 's', prompt: 'p', stub }), e => e.kind === 'provider' && /privacy/.test(e.message));

      w.onFetch(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"other":1}' } }] }) }));
      await assert.rejects(ai.complete(w.db, w.config, { user: coachRow(), purpose: 'review', system: 's', prompt: 'p', schema, stub }), e => e.kind === 'invalid');
    });
  });

  test('the daily text budget answers 429; demo coaches always get the stub', async () => {
    await withKey(async () => {
      w.config.ai.dailyCalls = 1;
      try {
        w.onFetch(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'fine' } }] }) }));
        const used = ai.usedToday(w.db, w.coach.id).calls;
        if (used < 1) await ai.complete(w.db, w.config, { user: coachRow(), purpose: 'draft', system: 's', prompt: 'p', stub });
        await assert.rejects(ai.complete(w.db, w.config, { user: coachRow(), purpose: 'draft', system: 's', prompt: 'p', stub }), e => e.kind === 'quota' && e.status === 429);
        const demo = w.user('Demo Coach', 'coach', null, { isDemo: true });
        assert.equal((await ai.complete(w.db, w.config, { user: demo.row, purpose: 'draft', system: 's', prompt: 'p', stub })).provider, 'stub');
      } finally { w.config.ai.dailyCalls = 300; }
    });
  });

  test('parallel calls cannot pass the daily cap, and quota refusals charge nothing', async () => {
    await withKey(async () => {
      const used = ai.usedToday(w.db, w.coach.id).calls;
      w.config.ai.dailyCalls = used + 3;
      let fetches = 0;
      try {
        w.onFetch(async () => { fetches++; await new Promise(r => setTimeout(r, 5)); return { ok: true, json: async () => ({ choices: [{ message: { content: 'fine' } }] }) }; });
        const all = await Promise.allSettled(Array.from({ length: 10 }, () => ai.complete(w.db, w.config, { user: coachRow(), purpose: 'draft', system: 's', prompt: 'p', stub })));
        assert.equal(fetches, 3);
        assert.equal(all.filter(r => r.status === 'fulfilled').length, 3);
        assert.ok(all.filter(r => r.status === 'rejected').every(r => r.reason.kind === 'quota'));
        assert.equal(ai.usedToday(w.db, w.coach.id).calls, used + 3, 'the seven refusals are not charged');
        w.db.prepare("INSERT INTO ai_calls (id, coach_id, client_id, purpose, provider, ok, error, audio_seconds, ms, at) VALUES ('ai_q1', ?, ?, 'transcribe', 'openrouter', 0, 'quota', 0, 0, ?)")
          .run(w.coach.id, w.client.id, new Date().toISOString());
        assert.equal(ai.usedToday(w.db, w.coach.id).calls, used + 3, 'an audio refusal is not a text call');
        assert.equal(ai.clientAudioToday(w.db, w.client.id).notes, 0);
      } finally { w.config.ai.dailyCalls = 300; }
    });
  });

  test('listen() refuses over budget before converting, and a failed conversion is a recorded AiError', { skip: !audio.ffmpegAvailable(w?.config ?? { ffmpegPath: 'ffmpeg' }) && 'no ffmpeg' }, async () => {
    await withKey(async () => {
      Object.assign(w.config.ai, { audioModel: 'vendor/audio-model', dailyAudioSeconds: 10 });
      try {
        const missing = join(FIXTURE_DIR, 'missing.m4a');
        await assert.rejects(ai.listen(w.db, w.config, { user: coachRow(), clientId: w.client.id, purpose: 'transcribe', audioPath: missing, durationSec: 100, system: 's', prompt: 'p', stub }), e => e.kind === 'quota');
        await assert.rejects(ai.listen(w.db, w.config, { user: coachRow(), clientId: w.client.id, purpose: 'transcribe', audioPath: missing, durationSec: 5, system: 's', prompt: 'p', stub }), e => e.kind === 'upstream' && /convert/.test(e.detail));
        const row = w.db.prepare("SELECT * FROM ai_calls WHERE purpose='transcribe' ORDER BY rowid DESC LIMIT 1").get();
        assert.equal(row.ok, 0);
        assert.match(row.error, /^upstream: convert/);
        assert.equal(row.audio_seconds, 0);
      } finally { Object.assign(w.config.ai, { audioModel: null, dailyAudioSeconds: 7200 }); }
    });
  });

  test('status and settings routes', async () => {
    const s = await w.ok('GET', '/api/ai/status', { as: w.coach });
    assert.equal(s.provider, 'stub');
    assert.equal(s.limits.dailyCalls, 300);
    await w.ok('PUT', '/api/ai/settings', { as: w.coach, body: { reviewMode: 'always', enabled: false } });
    assert.equal((await w.ok('GET', '/api/ai/status', { as: w.coach })).provider, 'off');
    await assert.rejects(ai.complete(w.db, w.config, { user: coachRow(), purpose: 'review', system: 's', prompt: 'p', stub }), e => e.kind === 'off');
    await w.ok('PUT', '/api/ai/settings', { as: w.coach, body: { enabled: true, reviewMode: 'ask' } });
    assert.equal((await w.call('PUT', '/api/ai/settings', { as: w.coach, body: { reviewMode: 'sometimes' } })).status, 400);
    assert.equal((await w.call('GET', '/api/ai/status', { as: w.client })).status, 403);
  });
});

describe('audio', () => {
  const hasFfmpeg = audio.ffmpegAvailable(w?.config ?? { ffmpegPath: 'ffmpeg' });
  const dir = mkdtempSync(join(tmpdir(), 'jk-audio-'));
  const make = (name, args) => {
    const out = join(dir, name);
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, out]);
    if (r.status !== 0) throw new Error(`could not make ${name}`);
    return readFileSync(out);
  };

  test('the sniffer reads magic bytes only', () => {
    const ftyp = brand => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`), Buffer.alloc(8)]);
    assert.equal(audio.sniffAudio(ftyp('M4A ')), 'mov');
    assert.equal(audio.sniffAudio(ftyp('heic')), null, 'a HEIC photo is not audio');
    assert.equal(audio.sniffAudio(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1])), 'matroska');
    assert.equal(audio.sniffAudio(Buffer.from('OggS\0\0')), 'ogg');
    assert.equal(audio.sniffAudio(Buffer.from('ID3\x03\0')), 'mp3');
    assert.equal(audio.sniffAudio(Buffer.from([0xff, 0xfb, 0x90, 0])), 'mp3');
    assert.equal(audio.sniffAudio(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')])), 'wav');
    assert.equal(audio.sniffAudio(Buffer.from('#EXTM3U\nhttp://evil/x.ts\n')), null);
  });

  test('a playlist, a mismatched file and a file with no audio are refused; real audio converts to m4a', { skip: !hasFfmpeg && 'no ffmpeg on this host' }, async () => {
    const config = { dataDir: mkdtempSync(join(tmpdir(), 'jk-audio-data-')), ffmpegPath: 'ffmpeg' };
    await assert.rejects(audio.convertUpload(config, Buffer.from('#EXTM3U\n#EXTINF:1,\nfile:///etc/passwd\n')), e => e.status === 415);
    await assert.rejects(audio.convertUpload(config, Buffer.concat([Buffer.from('OggS'), Buffer.alloc(2000, 7)])), e => e.status === 415);
    const silentVideo = make('video.mp4', ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=5', '-an', '-c:v', 'mpeg4']);
    await assert.rejects(audio.convertUpload(config, silentVideo), e => e.status === 415 && /No audio/.test(e.message));
    const webm = make('note.webm', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libopus']);
    const out = await audio.convertUpload(config, webm, { capSec: 300 });
    assert.equal(audio.ftypBrand(out.bytes).trim().length > 0, true);
    assert.ok(Math.abs(out.seconds - 2) < 0.2, `${out.seconds}`);
    const long = make('long.wav', ['-f', 'lavfi', '-i', 'sine=duration=5']);
    await assert.rejects(audio.convertUpload(config, long, { capSec: 1 }), e => e.status === 400);
    assert.deepEqual(readdirSync(audio.audioTempDir(config)), [], 'temp files deleted');
  });

  test('without ffmpeg only an m4a passes', async () => {
    const config = { dataDir: dir, ffmpegPath: join(dir, 'no-such-ffmpeg') };
    const m4a = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypM4A '), Buffer.alloc(8)]);
    assert.equal((await audio.convertUpload(config, m4a)).converted, false);
    await assert.rejects(audio.convertUpload(config, Buffer.from('OggS\0\0\0\0')), e => e.status === 415 && /send m4a/.test(e.message));
  });

  test('one job at a time; more than 4 waiting is 503', async () => {
    let release;
    const gate = new Promise(r => { release = r; });
    const jobs = [audio.audioJob(() => gate), ...Array.from({ length: 4 }, () => audio.audioJob(() => 1))];
    await assert.rejects(audio.audioJob(() => 1), e => e.status === 503);
    release();
    await Promise.all(jobs);
  });
});

describe('search, badges, prefs, needs, export and erasure', () => {
  test('search merges built-ins and hooks, escapes LIKE, and is scoped to the coach', async () => {
    assert.equal((await w.call('GET', '/api/search?q=s', { as: w.coach })).status, 400);
    const sam = await w.ok('GET', '/api/search?q=sam', { as: w.coach });
    assert.equal(sam.results[0].type, 'client');
    assert.equal(sam.results[0].title, 'Sam Carter');
    assert.equal((await w.ok('GET', '/api/search?q=zz', { as: w.coach })).results[0].title, 'Sample hit');
    assert.deepEqual((await w.ok('GET', `/api/search?q=${encodeURIComponent('%%')}`, { as: w.coach })).results, []);
    assert.deepEqual((await w.ok('GET', '/api/search?q=sam&types=message', { as: w.coach })).results.filter(r => r.type !== 'message'), []);
    const other = w.user('Other Coach', 'coach');
    assert.deepEqual((await w.ok('GET', '/api/search?q=sam', { as: other })).results, []);
  });

  test('badges merge hooks; prefs round-trip; rate limits and rng behave', async () => {
    assert.deepEqual(await w.ok('GET', '/api/coach/badges', { as: w.coach }), { badges: { inbox: 2 } });
    assert.deepEqual(await w.ok('GET', '/api/coach/prefs/desk.theme', { as: w.coach }), { value: null });
    await w.ok('PUT', '/api/coach/prefs/desk.theme', { as: w.coach, body: { value: { mode: 'dark' } } });
    assert.deepEqual(await w.ok('GET', '/api/coach/prefs/desk.theme', { as: w.coach }), { value: { mode: 'dark' } });
    assert.equal((await w.call('PUT', '/api/coach/prefs/bad key!', { as: w.coach, body: { value: 1 } })).status, 400);
    assert.equal((await w.call('PUT', '/api/coach/prefs/big', { as: w.coach, body: { value: 'x'.repeat(17000) } })).status, 413);
    assert.equal((await w.call('GET', '/api/coach/prefs/desk.theme', { as: w.client })).status, 403);
    assert.equal([1, 2, 3].map(() => limit('t:1', { max: 2, perMs: 60_000 })).join(), 'true,true,false');
    assert.equal(rng('seed')(), rng('seed')());
  });

  test('needs-you merges feature reasons', async () => {
    const needs = await w.ok('GET', '/api/coach/needs-you', { as: w.coach });
    const sam = needs.items.find(i => i.client.id === w.client.id);
    assert.ok(sam.reasons.some(r => r.text === 'Sample reason' && r.feature === 'sample'));
  });

  test('messages since=<cursor> returns updated rows', async () => {
    const first = await w.ok('GET', `/api/messages?clientId=${w.client.id}`, { as: w.coach });
    assert.ok(first.cursor);
    const sent = await w.ok('POST', '/api/messages', { as: w.coach, body: { clientId: w.client.id, text: 'After the cursor' } });
    const next = await w.ok('GET', `/api/messages?clientId=${w.client.id}&since=${encodeURIComponent(first.cursor)}`, { as: w.coach });
    assert.ok(next.updated.some(m => m.id === sent.id));
    assert.ok(next.cursor >= first.cursor);
  });

  test('the export carries feature sections, and deleting the account leaves no rows', async () => {
    const ella = await w.signIn('helper-ella', 'ella@example.com', { givenName: 'Ella', familyName: 'Hughes' });
    facts.runAction(w.db, w.config, 'sample.mark', { coachId: w.coach.id, client: { id: ella.id }, params: { note: 'exported' } });
    const tag = (await w.ok('POST', '/api/tags', { as: w.coach, body: { name: 'Erase me' } })).tag;
    await w.ok('PUT', `/api/coach/clients/${ella.id}/tags`, { as: w.coach, body: { tagIds: [tag.id] } });
    notifyCoach(w.db, w.config, w.coach.id, { clientId: ella.id, kind: 'x', title: 'About Ella' });
    await w.ok('POST', '/api/messages', { as: ella, body: { text: 'Hi' } });
    await w.settle();
    const exp = (await w.call('GET', '/api/me/export', { as: ella })).body;
    assert.deepEqual(exp.features.sample.rows, [{ note: 'exported' }]);
    assert.deepEqual(exp.tags.map(t => t.name), ['Erase me']);
    await w.ok('DELETE', '/api/me', { as: ella });
    assertNoRowsFor(w.db, ella.id);
  });
});

describe('the demo world and features', () => {
  test('builders run in the build\'s transaction, never emit, and fixtures are written once', async () => {
    buildDemo(w.db, today, w.config);
    const events = w.db.prepare('SELECT COUNT(*) n FROM events').get().n;
    const coach = w.db.prepare("SELECT * FROM users WHERE apple_sub='demo-coach'").get();
    const rows = w.db.prepare('SELECT note FROM sample_rows WHERE coach_id=?').all(coach.id);
    assert.equal(rows.length, 6);
    assert.match(rows[0].note, /^md_/);
    const fixture1 = w.db.prepare("SELECT id FROM media WHERE purpose='demo:sample-voice'").get().id;
    const sam = w.db.prepare("SELECT * FROM users WHERE apple_sub='demo-client'").get();
    const upload = (await import('../media.mjs')).storeMedia(w.db, w.config, { ownerId: sam.id, clientId: sam.id, bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(10)]), mime: 'image/jpeg', purpose: 'mealPhoto' });
    setCoachPref(w.db, coach.id, 'desk.theme', 'light');
    setCoachPref(w.db, coach.id, 'notify.prefs', { x: false });
    for (let i = 0; i < 45; i++) setCoachPref(w.db, coach.id, `desk.junk${i}`, 'x'.repeat(100));
    w.db.prepare("UPDATE coach_prefs SET updated_at='2099-01-01T00:00:00.000Z' WHERE coach_id=? AND key='desk.theme'").run(coach.id);
    const { storeMedia } = await import('../media.mjs');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
    const avatars = [0, 1, 2].map(() => storeMedia(w.db, w.config, { ownerId: coach.id, bytes: png, mime: 'image/png', purpose: 'avatar' }));
    const { coachSettings, saveCoachSettings } = await import('../settings.mjs');
    saveCoachSettings(w.db, coach.id, { ...coachSettings(w.db, coach.id), avatarMediaId: avatars[2].id });
    buildDemo(w.db, addDays(today, 1), w.config);
    await w.settle();
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM events').get().n, events, 'builders emit nothing');
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM sample_rows WHERE coach_id=?').get(coach.id).n, 6, 'wiped and rebuilt');
    assert.equal(w.db.prepare("SELECT id FROM media WHERE purpose='demo:sample-voice'").get().id, fixture1, 'the fixture is reused');
    assert.equal(w.db.prepare('SELECT 1 FROM media WHERE id=?').get(upload.id), undefined, 'a demo upload is gone');
    assert.equal(existsSync(join(w.config.dataDir, 'media', `${upload.id}.jpg`)), false, 'and its file');
    const kept = w.db.prepare('SELECT key FROM coach_prefs WHERE coach_id=?').all(coach.id).map(r => r.key);
    assert.equal(kept.length, 40, 'desk prefs are bounded');
    assert.ok(kept.includes('desk.theme') && !kept.includes('notify.prefs'));
    assert.deepEqual(avatars.map(m => !!w.db.prepare('SELECT 1 FROM media WHERE id=?').get(m.id)), [false, false, true], 'only the portrait in use survives');
    const files = readdirSync(join(w.config.dataDir, 'media')).length;
    assert.equal(files, w.db.prepare('SELECT COUNT(*) n FROM media').get().n, 'one file per media row');
  });

  test('hooks() reads features at call time', () => {
    assert.deepEqual(hooks('badges').map(([f]) => f.name), ['sample']);
    assert.ok(allFacts().some(f => f.id === 'core.daysQuiet' && f.feature === 'core'));
  });
});
