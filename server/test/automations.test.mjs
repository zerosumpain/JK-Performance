/**
 * F15 The automation builder (docs/design/desk-v2.md, WP5). Loads the real
 * automations, templates and outreach features plus small stand-ins for
 * features other packages own (tasks, voice, crm and a throwing action),
 * through FEATURES_DIR, so these tests do not depend on other packages.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const SERVER = new URL('../', import.meta.url);
const real = name => `export { feature } from ${JSON.stringify(new URL(`features/${name}.mjs`, SERVER).href)};\n`;
const FIXTURES = mkdtempSync(join(tmpdir(), 'jk-wp5-auto-'));
mkdirSync(FIXTURES, { recursive: true });
for (const n of ['automations', 'outreach', 'templates']) writeFileSync(join(FIXTURES, `${n}.mjs`), real(n));
writeFileSync(join(FIXTURES, 'tasks.mjs'), `export const feature = {
  name: 'tasks', namespaces: ['task'],
  schema(db) { db.exec('CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, client_id TEXT REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL)'); },
  actions: { 'task.create': { label: 'Create a task', clientFacing: false, params: [{ key: 'title', label: 'Title', type: 'text', required: true }],
    run(db, _c, ctx) { db.prepare('INSERT INTO tasks (coach_id, client_id, title) VALUES (?,?,?)').run(ctx.coachId, ctx.client.id, ctx.params.title); return 'Created task'; } } },
};\n`);
writeFileSync(join(FIXTURES, 'voice.mjs'), `export const feature = {
  name: 'voice', namespaces: ['voice'],
  emits: { 'voice.analysed': { label: 'A voice note was transcribed', payload: ['messageId', 'flagged'], aiDerived: true },
           'voice.flagged': { label: 'A voice note was flagged', payload: ['messageId', 'kinds'], aiDerived: true } },
  facts: { 'voice.sentiment14': { label: 'Voice sentiment', type: 'number', aiDerived: true, compute: () => ({}) } },
};\n`);
writeFileSync(join(FIXTURES, 'crm.mjs'), `export const feature = {
  name: 'crm', namespaces: ['crm', 'lifecycle'], exact: ['client.offboarded', 'client.stageChanged'],
  schema(db) { db.exec('CREATE TABLE IF NOT EXISTS stub_stage (client_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, stage TEXT NOT NULL)'); },
  emits: { 'client.offboarded': { label: 'Coaching ended', payload: ['exitReason'] }, 'client.stageChanged': { label: 'Lifecycle stage changed', payload: ['from', 'to'] } },
  facts: { 'crm.stage': { label: 'Stage', type: 'enum', options: [{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }],
    compute(db, _c, ids) { const m = new Map(); for (const id of ids) m.set(id, db.prepare('SELECT stage FROM stub_stage WHERE client_id=?').get(id)?.stage ?? 'active'); return m; } } },
};\n`);
writeFileSync(join(FIXTURES, 'boom.mjs'), `export const feature = {
  name: 'boom', namespaces: ['boom'],
  actions: { 'boom.explode': { label: 'Explode', clientFacing: false, params: [], run() { throw new Error('kaboom'); } } },
};\n`);
process.env.NODE_ENV = 'test';
process.env.FEATURES_DIR = FIXTURES;

const { makeWorld, assertNoRowsFor } = await import('./helpers.mjs');
const { emit } = await import('../events.mjs');
const { openStore, newId, nowIso } = await import('../store.mjs');
const { runFeatureSchemas } = await import('../features.mjs');
const auto = await import('../features/automations.mjs');
const { buildDemo } = await import('../demo.mjs');
const { resetLimits } = await import('../ratelimit.mjs');

let w, coach2, client2;
before(async () => {
  w = await makeWorld();
  coach2 = await w.signIn('helper-coach2', 'coach2@example.com', { givenName: 'Other', familyName: 'Coach' });
  client2 = w.user('Ola Other', 'client', coach2.id);
});
after(() => { w.close(); rmSync(FIXTURES, { recursive: true, force: true }); });
beforeEach(async () => {
  resetLimits();
  await w.settle();
  for (const t of ['automations', 'messages', 'deferred_messages', 'tasks', 'coach_notifications', 'client_outreach', 'stub_stage', 'scheduled_messages', 'broadcasts']) w.db.prepare(`DELETE FROM ${t}`).run();
  w.db.prepare('DELETE FROM client_tags').run();
  // Most tests run without quiet hours, so the wall clock never matters.
  w.db.prepare("DELETE FROM coach_prefs WHERE key LIKE 'outreach.%'").run();
  for (const c of [w.coach, coach2]) w.db.prepare("INSERT INTO coach_prefs (coach_id, key, value, updated_at) VALUES (?, 'outreach.quietHours', 'null', ?)").run(c.id, nowIso());
});

const NOW = new Date('2026-06-10T10:00:00Z'); // a Wednesday, 11:00 BST
const at = iso => `?at=${encodeURIComponent(iso)}`;
const rows = (sql, ...args) => w.db.prepare(sql).all(...args);
const one = (sql, ...args) => w.db.prepare(sql).get(...args);
const count = (table, where = '1=1', ...args) => one(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`, ...args).n;
const msg = text => ({ type: 'action', action: 'message.send', params: { text } });

async function make(body, { live = true, as = w.coach } = {}) {
  const a = (await w.ok('POST', '/api/automations', { as, body: { name: 'Test', ...body } })).automation;
  if (live) await w.ok('POST', `/api/automations/${a.id}/status`, { as, body: { status: 'live' } });
  return a;
}
const runsOf = id => rows('SELECT * FROM automation_runs WHERE automation_id=? ORDER BY started_at', id);
const logOf = run => JSON.parse(one('SELECT log FROM automation_runs WHERE id=?', run.id).log).map(l => l.outcome);
const tick = (id, now) => w.tick(id, now);
async function fire(type, payload = {}, clientId = w.client.id, coachId = w.coach.id) {
  emit(w.db, type, { coachId, clientId, ...payload });
  await w.settle();
}

test('trigger matching with where: only a late cancel by the client starts a run', async () => {
  const a = await make({ trigger: { type: 'event', event: 'booking.cancelled', where: { late: true, byRole: 'client' } }, steps: [msg('Hi {first}')], settings: { reentry: 'always' } });
  await fire('booking.cancelled', { late: false, byRole: 'client' });
  await fire('booking.cancelled', { late: true, byRole: 'coach' });
  assert.equal(runsOf(a.id).length, 0);
  await fire('booking.cancelled', { late: true, byRole: 'client' });
  assert.equal(runsOf(a.id).length, 1);
  await tick('automations.advance', new Date(Date.now() + 60_000));
  assert.equal(runsOf(a.id)[0].status, 'done');
  assert.equal(one("SELECT text FROM messages WHERE client_id=? AND via='automation'", w.client.id).text, 'Hi Sam');
});

test('conditions gate the start; a step `if` is checked when the step runs, and a false one is skipped and logged', async () => {
  const tag = (await w.ok('POST', '/api/tags', { as: w.coach, body: { name: `VIP ${newId('x')}` } })).tag;
  const a = await make({
    trigger: { type: 'manual' }, conditions: { match: 'all', rules: [{ fact: 'core.tags', op: 'has', value: tag.id }] },
    steps: [{ ...msg('Plan step'), if: { match: 'all', rules: [{ fact: 'core.plan', op: 'eq', value: 'elite' }] } }, msg('Always')], settings: { reentry: 'always' },
  });
  const r1 = await w.ok('POST', `/api/automations/${a.id}/enrol${at(NOW.toISOString())}`, { as: w.coach, body: { clientIds: [w.client.id] } });
  assert.equal(r1.started, 0);
  assert.equal(r1.skipped[0].reason, 'conditions not met');
  await w.ok('PUT', `/api/coach/clients/${w.client.id}/tags`, { as: w.coach, body: { tagIds: [tag.id] } });
  const r2 = await w.ok('POST', `/api/automations/${a.id}/enrol${at(NOW.toISOString())}`, { as: w.coach, body: { clientIds: [w.client.id] } });
  assert.equal(r2.started, 1);
  const log = logOf(runsOf(a.id)[0]);
  assert.ok(log.includes('Skipped: condition not met'), log.join(' | '));
  assert.ok(log.includes('Sent'));
  assert.deepEqual(rows("SELECT text FROM messages WHERE via='automation'").map(m => m.text), ['Always']);
});

test('waits with `at` land on London wall-clock time across both DST changes', () => {
  const wu = auto.waitUntil;
  // Spring forward (29 Mar 2026): 08:00 BST is 07:00Z.
  assert.equal(wu(new Date('2026-03-28T09:00:00Z'), { days: 1, at: '08:00' }).toISOString(), '2026-03-29T07:00:00.000Z');
  // Same wall clock a day later, though the day had 23 hours.
  assert.equal(wu(new Date('2026-03-28T12:00:00Z'), { days: 1 }).toISOString(), '2026-03-29T11:00:00.000Z');
  // Fall back (25 Oct 2026): 08:00 GMT is 08:00Z.
  assert.equal(wu(new Date('2026-10-24T09:00:00Z'), { days: 1, at: '08:00' }).toISOString(), '2026-10-25T08:00:00.000Z');
  assert.equal(wu(new Date('2026-10-24T12:00:00Z'), { days: 1 }).toISOString(), '2026-10-25T13:00:00.000Z');
  // Days 0 with `at`: the next 07:30 (tomorrow when it has passed).
  assert.equal(wu(new Date('2026-06-10T10:00:00Z'), { at: '07:30' }).toISOString(), '2026-06-11T06:30:00.000Z');
  assert.equal(wu(new Date('2026-06-10T05:00:00Z'), { at: '07:30' }).toISOString(), '2026-06-10T06:30:00.000Z');
  // "Wait 2 days, then at 07:30" is that calendar day at 07:30, even from an afternoon.
  assert.equal(wu(new Date('2026-06-10T15:00:00Z'), { days: 2, at: '07:30' }).toISOString(), '2026-06-12T06:30:00.000Z');
  assert.equal(wu(new Date('2026-06-10T15:00:00Z'), { hours: 3 }).toISOString(), '2026-06-10T18:00:00.000Z');
});

test('a run waits on the London clock across the spring DST change', async () => {
  const a = await make({ trigger: { type: 'manual' }, steps: [{ type: 'wait', days: 1, at: '08:00' }, msg('Morning')], settings: { reentry: 'always' } });
  await w.ok('POST', `/api/automations/${a.id}/enrol${at('2026-03-28T09:00:00Z')}`, { as: w.coach, body: { clientIds: [w.client.id] } });
  const run = runsOf(a.id)[0];
  assert.equal(run.next_at, '2026-03-29T07:00:00.000Z');
  await tick('automations.advance', new Date('2026-03-29T06:59:00Z'));
  assert.equal(count('messages', "via='automation'"), 0);
  await tick('automations.advance', new Date('2026-03-29T07:00:00Z'));
  assert.equal(count('messages', "via='automation'"), 1);
});

test('quiet hours: a run started at night waits for morning; an opted-out automation is still held by the governor', async () => {
  for (const c of [w.coach]) w.db.prepare("UPDATE coach_prefs SET value=? WHERE coach_id=? AND key='outreach.quietHours'").run(JSON.stringify({ start: '21:00', end: '07:30' }), c.id);
  const night = '2026-06-10T21:30:00Z'; // 22:30 BST
  const a = await make({ trigger: { type: 'manual' }, steps: [msg('Night one')], settings: { reentry: 'always' } });
  await w.ok('POST', `/api/automations/${a.id}/enrol${at(night)}`, { as: w.coach, body: { clientIds: [w.client.id] } });
  const run = runsOf(a.id)[0];
  assert.equal(run.next_at, '2026-06-11T06:30:00.000Z');
  assert.match(logOf(run).join(' | '), /Waiting for quiet hours to end/);
  const b = await make({ trigger: { type: 'manual' }, steps: [msg('Night two')], settings: { reentry: 'always', quietHours: false } });
  await w.ok('POST', `/api/automations/${b.id}/enrol${at(night)}`, { as: w.coach, body: { clientIds: [w.client.id] } });
  assert.match(logOf(runsOf(b.id)[0]).join(' | '), /Deferred to (tomorrow )?07:30/);
  assert.equal(count('deferred_messages', "reason='quietHours'"), 1);
  assert.equal(count('messages', "via='automation'"), 0);
});

test('re-entry: never, a cooldown, and always', async () => {
  const day = d => new Date(NOW.getTime() + d * 86_400_000).toISOString();
  const enrol = async (id, iso) => w.ok('POST', `/api/automations/${id}/enrol${at(iso)}`, { as: w.coach, body: { clientIds: [w.client.id] } });
  const never = await make({ trigger: { type: 'manual' }, steps: [{ type: 'action', action: 'coach.notify', params: { title: 'x' } }], settings: { reentry: 'never' } });
  assert.equal((await enrol(never.id, day(0))).started, 1);
  assert.equal((await enrol(never.id, day(40))).skipped[0].reason, 'has been through it before');
  const cool = await make({ trigger: { type: 'manual' }, steps: [{ type: 'action', action: 'coach.notify', params: { title: 'y' } }], settings: { reentry: { cooldownDays: 14 } } });
  assert.equal((await enrol(cool.id, day(0))).started, 1);
  assert.match((await enrol(cool.id, day(5))).skipped[0].reason, /14 days/);
  assert.equal((await enrol(cool.id, day(15))).started, 1);
  const always = await make({ trigger: { type: 'manual' }, steps: [{ type: 'action', action: 'coach.notify', params: { title: 'z' } }], settings: { reentry: 'always' } });
  assert.equal((await enrol(always.id, day(0))).started, 1);
  assert.equal((await enrol(always.id, day(0))).started, 1);
  // Never two at once: a run that is still waiting blocks a new one.
  const waiting = await make({ trigger: { type: 'manual' }, steps: [{ type: 'wait', days: 3 }, msg('later')], settings: { reentry: 'always' } });
  assert.equal((await enrol(waiting.id, day(0))).started, 1);
  assert.equal((await enrol(waiting.id, day(1))).skipped[0].reason, 'already in it');
});

test('stopOn: a client reply stops the run before the follow-up goes', async () => {
  const a = await make({ trigger: { type: 'event', event: 'booking.cancelled', where: { late: true } }, steps: [{ type: 'wait', days: 0, hours: 1 }, msg('Follow up')], settings: { stopOn: ['message.received'] } });
  await fire('booking.cancelled', { late: true, byRole: 'client' });
  await tick('automations.advance', new Date(Date.now() + 1000));
  await fire('message.received', { messageId: 'm_x', kind: 'text' });
  const run = runsOf(a.id)[0];
  assert.equal(run.status, 'stopped');
  assert.match(logOf(run).at(-1), /^Stopped: a client sent a message/);
  await tick('automations.advance', new Date(Date.now() + 3 * 3_600_000));
  assert.equal(count('messages', "via='automation'"), 0);
});

test('an enters trigger records membership on its first look and only starts runs on a later change', async () => {
  const tag = (await w.ok('POST', '/api/tags', { as: w.coach, body: { name: `Watch ${newId('x')}` } })).tag;
  const other = w.user('Pat Second', 'client', w.coach.id);
  await w.ok('PUT', `/api/coach/clients/${w.client.id}/tags`, { as: w.coach, body: { tagIds: [tag.id] } });
  const a = await make({ trigger: { type: 'enters', rules: { match: 'all', rules: [{ fact: 'core.tags', op: 'has', value: tag.id }] } }, steps: [{ type: 'action', action: 'coach.notify', params: { title: 'Entered: {first}' } }], settings: { reentry: 'always' } });
  assert.equal(await tick('automations.enters', NOW), 0, 'the first look never starts runs');
  assert.equal(one('SELECT inside FROM automation_state WHERE automation_id=? AND client_id=?', a.id, w.client.id).inside, 1);
  assert.equal(await tick('automations.enters', NOW), 0, 'nobody changed');
  await w.ok('PUT', `/api/coach/clients/${other.id}/tags`, { as: w.coach, body: { tagIds: [tag.id] } });
  assert.equal(await tick('automations.enters', NOW), 1);
  assert.deepEqual(runsOf(a.id).map(r => r.client_id), [other.id]);
});

test('a schedule fires once per slot, across a restart of the store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jk-wp5-slot-'));
  const file = join(dir, 'db.sqlite');
  try {
    const setUp = () => { const db = openStore(file); runFeatureSchemas(db); return db; };
    let db = setUp();
    const coachId = newId('u'), clientId = newId('u');
    db.prepare("INSERT INTO users (id, apple_sub, name, role, created_at) VALUES (?,?,'Coach C','coach',?)").run(coachId, `s-${coachId}`, nowIso());
    db.prepare("INSERT INTO users (id, apple_sub, name, role, coach_id, created_at) VALUES (?,?,'Cara Client','client',?,?)").run(clientId, `s-${clientId}`, coachId, nowIso());
    db.prepare("INSERT INTO coach_prefs (coach_id, key, value, updated_at) VALUES (?, 'outreach.quietHours', 'null', ?)").run(coachId, nowIso());
    db.prepare(`INSERT INTO automations (id, coach_id, name, status, trigger, steps, settings, created_at, updated_at, live_at) VALUES ('au_s', ?, 'Monday nudge', 'live', ?, ?, ?, ?, ?, ?)`)
      .run(coachId, JSON.stringify({ type: 'schedule', days: [3], at: '08:00', audience: { everyone: true } }), JSON.stringify([{ id: 's1', type: 'wait', days: 1 }]),
        JSON.stringify({ reentry: 'always' }), nowIso(), nowIso(), '2026-06-01T00:00:00Z');
    const config = { pushTransport: () => ({ status: 200 }) };
    assert.equal(auto.runSchedules(db, config, new Date('2026-06-10T06:59:00Z')), 0, 'not yet 08:00 BST');
    assert.equal(auto.runSchedules(db, config, new Date('2026-06-10T07:05:00Z')), 1);
    assert.equal(auto.runSchedules(db, config, new Date('2026-06-10T07:06:00Z')), 0);
    db.close();
    db = setUp();
    assert.equal(auto.runSchedules(db, config, new Date('2026-06-10T07:30:00Z')), 0, 'a restart does not fire the slot again');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM automation_runs').get().n, 1);
    // Thursday is not a scheduled day; next Wednesday is a new slot.
    assert.equal(auto.runSchedules(db, config, new Date('2026-06-11T07:05:00Z')), 0);
    db.prepare("UPDATE automation_runs SET status='done'").run();
    assert.equal(auto.runSchedules(db, config, new Date('2026-06-17T07:05:00Z')), 1);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maxPerDay drops the overflow and tells the coach once', async () => {
  const a = await make({ trigger: { type: 'manual' }, steps: [{ type: 'action', action: 'coach.notify', params: { title: 'Hi' } }], settings: { reentry: 'always', maxPerDay: 1 } });
  const extra = w.user('Max Extra', 'client', w.coach.id);
  const third = w.user('Tia Third', 'client', w.coach.id);
  const r = await w.ok('POST', `/api/automations/${a.id}/enrol${at(NOW.toISOString())}`, { as: w.coach, body: { clientIds: [w.client.id, extra.id, third.id] } });
  assert.equal(r.started, 1);
  assert.deepEqual(r.skipped.map(s => s.reason), ['daily limit reached', 'daily limit reached']);
  assert.equal(count('coach_notifications', "kind='automation' AND dedupe LIKE 'automation.cap:%'"), 1);
});

test('test mode has no side effects: no messages, tasks, events, runs or notifications', async () => {
  const a = await make({ trigger: { type: 'event', event: 'booking.cancelled', where: { late: true } },
    steps: [{ type: 'wait', days: 0, hours: 1 }, msg('Hi {first}, all OK?'), { type: 'action', action: 'task.create', params: { title: 'Call {first}' } }, { type: 'action', action: 'coach.notify', params: { title: 'x' } }] });
  await w.settle();
  const before = ['messages', 'tasks', 'events', 'automation_runs', 'coach_notifications', 'deferred_messages', 'scheduled_messages'].map(t => count(t));
  const out = await w.ok('POST', `/api/automations/${a.id}/test${at(NOW.toISOString())}`, { as: w.coach, body: { clientId: w.client.id, event: { type: 'booking.cancelled', payload: { late: true } } } });
  await w.settle();
  assert.equal(out.willRun, true);
  assert.equal(out.timeline.find(t => t.stepId === 's2').rendered, 'Hi Sam, all OK?');
  assert.equal(out.timeline.find(t => t.stepId === 's3').rendered, 'Call Sam');
  assert.equal(out.timeline.find(t => t.stepId === 's2').at, '2026-06-10T11:00:00.000Z');
  assert.deepEqual(['messages', 'tasks', 'events', 'automation_runs', 'coach_notifications', 'deferred_messages', 'scheduled_messages'].map(t => count(t)), before);
  const no = await w.ok('POST', `/api/automations/${a.id}/test`, { as: w.coach, body: { clientId: w.client.id, event: { type: 'booking.cancelled', payload: { late: false } } } });
  assert.equal(no.willRun, false);
});

test('AI judgements can only notify, task, tag or draft: save and turn-on refuse, and the engine never messages', async () => {
  const bad = { name: 'AI', trigger: { type: 'event', event: 'voice.analysed' }, steps: [msg('Saw your note')] };
  let r = await w.call('POST', '/api/automations', { as: w.coach, body: bad });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, auto.AI_REFUSAL);
  r = await w.call('POST', '/api/automations', { as: w.coach, body: { name: 'AI fact', trigger: { type: 'manual' }, conditions: { match: 'all', rules: [{ fact: 'voice.sentiment14', op: 'lt', value: 0 }] }, steps: [msg('Hey')] } });
  assert.equal(r.status, 400);
  r = await w.call('POST', '/api/automations', { as: w.coach, body: { name: 'AI if', trigger: { type: 'manual' }, steps: [{ ...msg('Hey'), if: { match: 'all', rules: [{ fact: 'voice.sentiment14', op: 'lt', value: 0 }] } }] } });
  assert.equal(r.status, 400);
  // The reference example is allowed.
  const ok = await make({ trigger: { type: 'event', event: 'voice.flagged' }, steps: [{ type: 'action', action: 'coach.notify', params: { title: 'Flag: {first}' } }, { type: 'action', action: 'task.create', params: { title: 'Listen' } }] });
  assert.equal(ok.status, 'draft');
  r = await w.call('PUT', `/api/automations/${ok.id}`, { as: w.coach, body: { steps: [msg('Oops')] } });
  assert.equal(r.status, 400);
  // A row that slipped past the save check cannot be turned on...
  const id = newId('au');
  w.db.prepare("INSERT INTO automations (id, coach_id, name, status, trigger, steps, settings, created_at, updated_at) VALUES (?,?,'Sneaky','draft',?,?,'{}',?,?)")
    .run(id, w.coach.id, JSON.stringify({ type: 'event', event: 'voice.analysed' }), JSON.stringify([{ id: 's1', ...msg('Heard you') }]), nowIso(), nowIso());
  r = await w.call('POST', `/api/automations/${id}/status`, { as: w.coach, body: { status: 'live' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, auto.AI_REFUSAL);
  // ...and if one is live anyway, the engine refuses at run time.
  w.db.prepare("UPDATE automations SET status='live', settings=? WHERE id=?").run(JSON.stringify({ reentry: 'always', quietHours: false }), id);
  await fire('voice.analysed', { messageId: 'm_v', flagged: 2 });
  await tick('automations.advance', new Date(Date.now() + 60_000));
  const run = runsOf(id)[0];
  assert.ok(logOf(run).includes('refused: aiDerived'));
  for (const t of ['messages', 'scheduled_messages', 'deferred_messages', 'broadcasts']) assert.equal(count(t), 0, `${t} stays empty`);
});

test('every message step is governed: the 4th automated message of the day is held, and a paused client is skipped', async () => {
  const a = await make({ trigger: { type: 'manual' }, steps: [msg('One'), msg('Two'), msg('Three'), msg('Four')], settings: { reentry: 'always' } });
  await w.ok('POST', `/api/automations/${a.id}/enrol${at(NOW.toISOString())}`, { as: w.coach, body: { clientIds: [w.client.id] } });
  const log = logOf(runsOf(a.id)[0]);
  assert.deepEqual(log.filter(l => l === 'Sent').length, 3);
  assert.ok(log.some(l => /^Deferred to tomorrow 07:30$/.test(l)), log.join(' | '));
  assert.equal(one('SELECT reason FROM deferred_messages').reason, 'cap');
  // A client paused after the run started: the step is skipped and logged.
  const b = await make({ trigger: { type: 'manual' }, steps: [{ type: 'wait', days: 0, hours: 1 }, msg('Later')], settings: { reentry: 'always' } });
  const other = w.user('Paula Paused', 'client', w.coach.id);
  await w.ok('POST', `/api/automations/${b.id}/enrol${at(NOW.toISOString())}`, { as: w.coach, body: { clientIds: [other.id] } });
  await w.ok('PUT', `/api/coach/clients/${other.id}/outreach`, { as: w.coach, body: { paused: true } });
  await tick('automations.advance', new Date(NOW.getTime() + 2 * 3_600_000));
  assert.ok(logOf(runsOf(b.id)[0]).includes('Skipped: outreach paused'));
});

test('a client paused in their lifecycle has client steps deferred, but the coach is still told', async () => {
  const a = await make({ trigger: { type: 'manual' }, steps: [{ type: 'action', action: 'coach.notify', params: { title: 'Heads up' } }, msg('Hello')], settings: { reentry: 'always' } });
  w.db.prepare("INSERT INTO stub_stage (client_id, stage) VALUES (?, 'paused')").run(w.client.id);
  await w.ok('POST', `/api/automations/${a.id}/enrol${at(NOW.toISOString())}`, { as: w.coach, body: { clientIds: [w.client.id] } });
  const run = runsOf(a.id)[0];
  assert.deepEqual(logOf(run).slice(1), ['Notified', 'Deferred: client paused']);
  assert.equal(run.status, 'active');
  assert.ok(Date.parse(run.next_at) > NOW.getTime());
});

test('client.offboarded stops every active run of that client', async () => {
  const a = await make({ trigger: { type: 'manual' }, steps: [{ type: 'wait', days: 5 }, msg('Later')], settings: { reentry: 'always' } });
  await w.ok('POST', `/api/automations/${a.id}/enrol`, { as: w.coach, body: { clientIds: [w.client.id] } });
  const off = await w.ok('GET', `/api/coach/clients/${w.client.id}/automations`, { as: w.coach });
  assert.equal(off.runs[0].status, 'active');
  await fire('client.offboarded', { exitReason: 'moved' });
  const run = runsOf(a.id)[0];
  assert.equal(run.status, 'stopped');
  assert.equal(logOf(run).at(-1), 'Stopped: coaching ended');
});

test('converting an autoflow gives a draft: join → client.joined, each step a wait plus an action', async () => {
  const form = one('SELECT id FROM forms WHERE coach_id=?', w.coach.id) ?? (() => {
    const id = newId('f');
    w.db.prepare("INSERT INTO forms (id, coach_id, name, questions, created_at, updated_at) VALUES (?,?,'Intake','[]',?,?)").run(id, w.coach.id, nowIso(), nowIso());
    return { id };
  })();
  const flow = await w.ok('POST', '/api/autoflows', { as: w.coach, body: { name: 'Onboarding', trigger: 'join', active: false, steps: [{ day: 0, action: 'message', text: 'Welcome {first}' }, { day: 2, action: 'form', formId: form.id }] } });
  const out = (await w.ok('POST', `/api/automations/from-autoflow/${flow.id}`, { as: w.coach })).automation;
  assert.equal(out.status, 'draft');
  assert.equal(out.fromAutoflowId, flow.id);
  assert.deepEqual(out.trigger, { type: 'event', event: 'client.joined', where: {} });
  assert.deepEqual(out.steps.map(s => s.type === 'wait' ? `wait ${s.days}d ${s.at}` : s.action), ['message.send', 'wait 2d 09:00', 'form.send']);
  assert.equal(out.steps[0].params.text, 'Welcome {first}');
  assert.equal((await w.call('POST', `/api/automations/from-autoflow/${flow.id}`, { as: { token: coach2.token } })).status, 404);
});

test('isolation: another coach\'s event never starts my automation; every route is 404 across coaches and 403 for clients', async () => {
  const a = await make({ trigger: { type: 'event', event: 'booking.cancelled' }, steps: [{ type: 'action', action: 'coach.notify', params: { title: 'x' } }], settings: { reentry: 'always' } });
  await fire('booking.cancelled', { late: true }, client2.id, coach2.id);
  // Even a payload naming my client under the other coach does nothing.
  await fire('booking.cancelled', { late: true }, w.client.id, coach2.id);
  assert.equal(runsOf(a.id).length, 0);
  await w.ok('POST', `/api/automations/${a.id}/status`, { as: w.coach, body: { status: 'paused' } });
  await w.ok('POST', `/api/automations/${a.id}/status`, { as: w.coach, body: { status: 'live' } });
  const manual = await make({ trigger: { type: 'manual' }, steps: [{ type: 'wait', days: 1 }, { type: 'action', action: 'coach.notify', params: { title: 'x' } }], settings: { reentry: 'always' } });
  await w.ok('POST', `/api/automations/${manual.id}/enrol`, { as: w.coach, body: { clientIds: [w.client.id] } });
  const runId = runsOf(manual.id)[0].id;
  const them = { token: coach2.token };
  const routes = [
    ['GET', `/api/automations/${a.id}`], ['PUT', `/api/automations/${a.id}`, { name: 'x' }], ['DELETE', `/api/automations/${a.id}`],
    ['POST', `/api/automations/${a.id}/status`, { status: 'paused' }], ['POST', `/api/automations/${a.id}/test`, { clientId: client2.id }],
    ['POST', `/api/automations/${manual.id}/enrol`, { clientIds: [client2.id] }], ['GET', `/api/automations/${a.id}/runs`],
    ['POST', `/api/automations/runs/${runId}/stop`], ['GET', `/api/coach/clients/${w.client.id}/automations`],
  ];
  for (const [m, p, body] of routes) assert.equal((await w.call(m, p, { as: them, body })).status, 404, `${m} ${p}`);
  // My own automation with their client: 404 too, and nothing written.
  assert.equal((await w.call('POST', `/api/automations/${manual.id}/enrol`, { as: w.coach, body: { clientIds: [w.client.id, client2.id] } })).status, 404);
  assert.equal((await w.call('POST', `/api/automations/${a.id}/test`, { as: w.coach, body: { clientId: client2.id } })).status, 404);
  for (const [m, p, body] of [['GET', '/api/automations'], ['GET', '/api/automations/catalogue'], ['GET', '/api/automations/recipes'], ['POST', '/api/automations', { name: 'x', trigger: { type: 'manual' } }], ...routes]) {
    assert.equal((await w.call(m, p, { as: w.client, body })).status, 403, `client ${m} ${p}`);
  }
  assert.equal((await w.ok('GET', '/api/automations', { as: them })).automations.length, 0);
});

test('reassignment: after a client moves coach, the old coach sees none of their runs and the run stops', async () => {
  const mover = w.user('Mo Mover', 'client', w.coach.id);
  const a = await make({ trigger: { type: 'manual' }, steps: [{ type: 'wait', days: 1 }, msg('Later')], settings: { reentry: 'always' } });
  await w.ok('POST', `/api/automations/${a.id}/enrol${at(NOW.toISOString())}`, { as: w.coach, body: { clientIds: [mover.id] } });
  w.db.prepare('UPDATE users SET coach_id=? WHERE id=?').run(coach2.id, mover.id);
  assert.equal((await w.ok('GET', `/api/automations/${a.id}/runs`, { as: w.coach })).runs.length, 0);
  assert.equal((await w.call('GET', `/api/coach/clients/${mover.id}/automations`, { as: w.coach })).status, 404);
  await tick('automations.advance', new Date(NOW.getTime() + 2 * 86_400_000));
  assert.equal(runsOf(a.id)[0].status, 'stopped');
  assert.equal(count('messages', 'client_id=?', mover.id), 0);
});

test('a throwing action logs the failure and the run carries on', async () => {
  const a = await make({ trigger: { type: 'manual' }, steps: [{ type: 'action', action: 'boom.explode', params: {} }, msg('Still here')], settings: { reentry: 'always' } });
  await w.ok('POST', `/api/automations/${a.id}/enrol${at(NOW.toISOString())}`, { as: w.coach, body: { clientIds: [w.client.id] } });
  const run = runsOf(a.id)[0];
  assert.deepEqual(logOf(run).slice(1), ['failed: kaboom', 'Sent', 'Finished']);
  assert.equal(run.status, 'done');
  const critical = await make({ trigger: { type: 'manual' }, steps: [{ type: 'action', action: 'boom.explode', params: {}, critical: true }, msg('Never')], settings: { reentry: 'always' } });
  await w.ok('POST', `/api/automations/${critical.id}/enrol${at(NOW.toISOString())}`, { as: w.coach, body: { clientIds: [w.client.id] } });
  assert.equal(runsOf(critical.id)[0].status, 'failed');
});

test('recipes: available ones become drafts; one whose feature is missing is greyed and refused', async () => {
  const { recipes } = await w.ok('GET', '/api/automations/recipes', { as: w.coach });
  assert.equal(recipes.length, 18);
  const late = recipes.find(r => r.id === 'late-cancel');
  assert.equal(late.available, true, late.missing.join(','));
  const noShow = recipes.find(r => r.id === 'no-show');
  assert.equal(noShow.available, false);
  assert.deepEqual(noShow.needs, ['Diary']);
  assert.equal((await w.call('POST', '/api/automations', { as: w.coach, body: { recipe: 'no-show' } })).status, 409);
  const made = (await w.ok('POST', '/api/automations', { as: w.coach, body: { recipe: 'late-cancel' } })).automation;
  assert.equal(made.recipe, 'late-cancel');
  assert.equal(made.status, 'draft');
  assert.match(made.sentence, /^When a session was cancelled \(late, by the client\)/);
  assert.equal(recipes.find(r => r.id === 'voice-flag').available, true);
});

test('the demo: its automations only ever touch demo clients, and a real sign-up starts nothing there', async () => {
  buildDemo(w.db, undefined, w.config);
  const demoCoach = one("SELECT * FROM users WHERE apple_sub='demo-coach'");
  const live = rows("SELECT * FROM automations WHERE coach_id=? AND status='live'", demoCoach.id);
  assert.equal(live.length, 6);
  assert.ok(count('automation_runs', 'coach_id=?', demoCoach.id) >= 30);
  assert.equal(count('automation_runs', "coach_id=? AND status='active'", demoCoach.id), 2);
  assert.equal(one(`SELECT COUNT(*) n FROM automation_runs r JOIN users u ON u.id=r.client_id WHERE r.coach_id=? AND u.is_demo=0`, demoCoach.id).n, 0);
  const runs = count('automation_runs');
  const newcomer = await w.signIn('helper-new', 'newbie@example.com', { givenName: 'Nia', familyName: 'New' });
  await w.settle();
  await tick('automations.advance', new Date(Date.now() + 60_000));
  assert.equal(count('automation_runs'), runs);
  assert.equal(count('automation_runs', 'client_id=?', newcomer.id), 0);
});

test('export and erasure: a client\'s runs are in their export, and DELETE /api/me leaves nothing', async () => {
  const leaver = await w.signIn('helper-leaver', 'leaver@example.com', { givenName: 'Lee', familyName: 'Leaver' });
  const a = await make({ trigger: { type: 'manual' }, steps: [{ type: 'wait', days: 3 }, msg('Later')], settings: { reentry: 'always' } });
  await w.ok('POST', `/api/automations/${a.id}/enrol`, { as: w.coach, body: { clientIds: [leaver.id] } });
  w.db.prepare("UPDATE automation_state SET inside=1 WHERE automation_id=? AND client_id=?").run(a.id, leaver.id);
  const exp = await w.ok('GET', '/api/me/export', { as: leaver });
  assert.equal(exp.features.automations.automationRuns.length, 1);
  assert.equal(exp.features.automations.automationRuns[0].automation, 'Test');
  await w.ok('DELETE', '/api/me', { as: leaver });
  assertNoRowsFor(w.db, leaver.id);
  assert.equal(count('automation_state', 'client_id=?', leaver.id), 0);
});
