/**
 * WP2 onboarding feature (docs/design/desk-v2.md F27): every default step
 * ticks from its event or fact (and nothing from another client or coach),
 * completion emits once and moves the stage (with crm), a stall emits once
 * per stall, clients with no checklist count as complete, the template is
 * validated, isolation, export and erasure.
 *
 * Features load from a temp folder: the real crm and onboarding files plus
 * two fixtures that declare the billing and guidebook events, so the billing
 * and guide steps are visible here (they hide when those features are absent).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { emit } from '../events.mjs';
import { clientFacts } from '../facts.mjs';
import { newId, nowIso, tx } from '../store.mjs';
import { addDays, londonDay, londonToUtc } from '../time.mjs';

const dir = mkdtempSync(join(tmpdir(), 'wp2-onb-features-'));
for (const f of ['crm.mjs', 'onboarding.mjs']) symlinkSync(fileURLToPath(new URL(`../features/${f}`, import.meta.url)), join(dir, f));
writeFileSync(join(dir, 'billing.mjs'), `export const feature = { name: 'billing', namespaces: ['invoice', 'package', 'billing'],
  emits: { 'invoice.issued': { label: 'Invoice issued' }, 'package.sold': { label: 'Package sold' }, 'billing.scheduleCreated': { label: 'Schedule created' } } };
`);
writeFileSync(join(dir, 'guidebook.mjs'), `export const feature = { name: 'guidebook', namespaces: ['guide'], emits: { 'guide.opened': { label: 'Guide opened', payload: ['guideId'] } } };
`);
process.env.NODE_ENV = 'test';
process.env.FEATURES_DIR = dir;
const { assertNoRowsFor, makeWorld } = await import('./helpers.mjs');
const { _test } = await import('../features/onboarding.mjs');

const today = londonDay();
let w, coach2, parq, waiver;
before(async () => {
  w = await makeWorld();
  coach2 = await w.signIn('wp2-onb-coach2', 'coach2@example.com', { givenName: 'Other', familyName: 'Coach' });
  const form = name => {
    const id = newId('f');
    w.db.prepare('INSERT INTO forms (id, coach_id, name, intro, questions, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(id, w.coach.id, name, '', '[]', nowIso(), nowIso());
    return id;
  };
  parq = form('PAR-Q health check');
  waiver = form('Terms and waiver');
  form('Monthly review');
});
after(() => w.close());

const one = (sql, ...a) => w.db.prepare(sql).get(...a);
const events = (type, clientId) => w.db.prepare('SELECT * FROM events WHERE type=? AND client_id=? ORDER BY seq').all(type, clientId).map(e => ({ ...e, payload: JSON.parse(e.payload) }));
const fire = async (type, coachId, clientId, payload = {}) => { tx(w.db, () => emit(w.db, type, { coachId, clientId, ...payload })); await w.settle(); };
const checklist = async c => w.ok('GET', `/api/coach/clients/${c.id}/onboarding`, { as: w.coach });
const doneKeys = async c => (await checklist(c)).steps.filter(s => s.done).map(s => s.key);
/** A fresh client with no app set-up yet (onboarded_at empty). */
function fresh(name, coachId = w.coach.id) {
  const u = w.user(name, 'client', coachId);
  w.db.prepare('UPDATE users SET onboarded_at=NULL, notifications_on=1 WHERE id=?').run(u.id);
  return u;
}
const startFor = c => w.ok('POST', `/api/coach/clients/${c.id}/onboarding`, { as: w.coach, body: { start: true } });

describe('the checklist', () => {
  test('a client who signs up starts a checklist on client.joined; the default template has nine visible steps', async () => {
    const s = await w.signIn('wp2-joiner', 'joiner@example.com', { givenName: 'Jo', familyName: 'Iner' });
    await w.settle();
    const list = await w.ok('GET', `/api/coach/clients/${s.id}/onboarding`, { as: w.coach });
    assert.equal(list.started, true);
    assert.equal(list.total, 9);
    assert.deepEqual(list.steps.map(x => x.key), ['parq', 'waiver', 'goal', 'program', 'booking', 'billing', 'guide', 'app', 'notifications']);
    const t = await w.ok('GET', '/api/onboarding/template', { as: w.coach });
    assert.equal(t.template.steps.find(x => x.key === 'parq').ref, parq);
    assert.equal(t.template.steps.find(x => x.key === 'waiver').ref, waiver);
  });

  test('each default step ticks from its event or fact; another client\'s or coach\'s event ticks nothing', async () => {
    const a = fresh('Ada Steps');
    const b = fresh('Ben Other');
    await startFor(a);
    await startFor(b);
    assert.deepEqual(await doneKeys(a), []);
    // Events of another client, and an event carrying another coach, tick nothing.
    await fire('booking.created', w.coach.id, b.id, { bookingId: 'b_x' });
    await fire('form.submitted', coach2.id, a.id, { formId: parq, requestId: 'fr_x' });
    await fire('invoice.issued', coach2.id, a.id, {});
    assert.deepEqual(await doneKeys(a), []);
    // A different form does not tick the questionnaire.
    await fire('form.submitted', w.coach.id, a.id, { formId: 'f_other', requestId: 'fr_y' });
    assert.deepEqual(await doneKeys(a), []);
    await fire('form.submitted', w.coach.id, a.id, { formId: parq, requestId: 'fr_1' });
    await fire('form.submitted', w.coach.id, a.id, { formId: waiver, requestId: 'fr_2' });
    await fire('booking.created', w.coach.id, a.id, { bookingId: 'b_1' });
    await fire('package.sold', w.coach.id, a.id, {});
    await fire('guide.opened', w.coach.id, a.id, { guideId: 'gb_any' });
    assert.deepEqual((await doneKeys(a)).sort(), ['billing', 'booking', 'guide', 'parq', 'waiver']);
    // Fact steps: a goal, a program, the app set up and notifications on (a device registered), evaluated on the next event.
    w.db.prepare("INSERT INTO goals (id, client_id, title, metric, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").run(newId('g'), a.id, 'Run 10k', 'custom', 'active', nowIso(), nowIso());
    w.db.prepare("INSERT INTO workouts (id, client_id, date, title, edited_at, edited_by, created_by) VALUES (?,?,?,?,?,?,?)").run(newId('w'), a.id, today, 'Lower A', nowIso(), w.coach.id, w.coach.id);
    w.db.prepare('UPDATE users SET onboarded_at=? WHERE id=?').run(nowIso(), a.id);
    w.db.prepare("INSERT INTO push_tokens (token, user_id, env, created_at, updated_at) VALUES (?,?,'production',?,?)").run(`tok-${a.id}`, a.id, nowIso(), nowIso());
    assert.equal((await doneKeys(a)).length, 5);
    await fire('message.received', w.coach.id, a.id, { messageId: 'm_1' });
    const list = await checklist(a);
    assert.equal(list.done, 9);
    assert.equal(list.pct, 100);
    assert.ok(list.completedAt);
    assert.ok(list.steps.every(s => s.by === 'auto'));
    assert.deepEqual(await doneKeys(b), ['booking']); // only Ben's own booking
    // A draft goal does not count as a goal set.
    const c = fresh('Cy Draft');
    await startFor(c);
    w.db.prepare("INSERT INTO goals (id, client_id, title, metric, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").run(newId('g'), c.id, 'Draft', 'custom', 'draft', nowIso(), nowIso());
    await fire('message.received', w.coach.id, c.id, {});
    assert.ok(!(await doneKeys(c)).includes('goal'));
  });

  test('completion emits once and moves the stage to Active (crm); the coach can tick and untick', async () => {
    const c = fresh('Cora Complete');
    await startFor(c);
    tx(w.db, () => _test.nightly(w.db, w.coach.id, today));
    await w.settle();
    // crm's nightly ran too (both handle day.started); force the lifecycle row via crm's nightly on the event.
    await w.tick('core.dayStarted', londonToUtc(today, '06:00'));
    await w.settle();
    let l = await w.ok('GET', `/api/coach/clients/${c.id}/lifecycle`, { as: w.coach });
    assert.equal(l.stage, 'onboarding');
    const list = await checklist(c);
    await w.ok('POST', `/api/coach/clients/${c.id}/onboarding`, { as: w.coach, body: { step: list.steps[0].key, done: true } });
    await w.ok('POST', `/api/coach/clients/${c.id}/onboarding`, { as: w.coach, body: { step: list.steps[0].key, done: false } });
    assert.ok(!(await doneKeys(c)).includes(list.steps[0].key));
    for (const s of list.steps) await w.ok('POST', `/api/coach/clients/${c.id}/onboarding`, { as: w.coach, body: { step: s.key, done: true } });
    await w.settle();
    const after = await checklist(c);
    assert.ok(after.steps.every(s => s.done && s.by === 'coach'));
    assert.equal(events('onboarding.completed', c.id).length, 1);
    l = await w.ok('GET', `/api/coach/clients/${c.id}/lifecycle`, { as: w.coach });
    assert.equal(l.stage, 'active');
    // Ticking again after completion emits nothing more.
    await w.ok('POST', `/api/coach/clients/${c.id}/onboarding`, { as: w.coach, body: { step: list.steps[0].key, done: true } });
    await w.settle();
    assert.equal(events('onboarding.completed', c.id).length, 1);
    assert.equal(events('onboarding.stepDone', c.id).length, 10); // nine plus the first tick before the untick
  });

  test('stalled emits once per stall, and again only after new progress and a new stall', async () => {
    const c = fresh('Stu Stall');
    await startFor(c);
    const start = one('SELECT * FROM onboarding_clients WHERE client_id=?', c.id);
    const startDay = londonDay(new Date(start.started_at));
    const night = d => { tx(w.db, () => _test.nightly(w.db, w.coach.id, d)); };
    night(addDays(startDay, 4));
    assert.equal(events('onboarding.stalled', c.id).length, 0);
    night(addDays(startDay, 5));
    night(addDays(startDay, 6));
    let s = events('onboarding.stalled', c.id);
    assert.equal(s.length, 1);
    assert.equal(s[0].payload.days, 5);
    assert.equal(s[0].payload.nextStep, 'parq');
    const needs = await w.ok('GET', '/api/coach/needs-you', { as: w.coach });
    assert.ok(needs.items.find(i => i.client.id === c.id).reasons.some(r => r.kind === 'onboardingStalled' && r.rank === 5 && /Onboarding stuck \d+ days: waiting on health questionnaire returned/.test(r.text)));
    // New progress, then a new stall.
    w.db.prepare('UPDATE onboarding_clients SET last_progress_at=? WHERE client_id=?').run(londonToUtc(addDays(startDay, 7), '12:00').toISOString(), c.id);
    w.db.prepare("INSERT INTO onboarding_steps (client_id, step_key, done_at, by) VALUES (?, 'parq', ?, 'coach')").run(c.id, londonToUtc(addDays(startDay, 7), '12:00').toISOString());
    night(addDays(startDay, 8));
    assert.equal(events('onboarding.stalled', c.id).length, 1);
    night(addDays(startDay, 12));
    night(addDays(startDay, 13));
    s = events('onboarding.stalled', c.id);
    assert.equal(s.length, 2);
    assert.equal(s[1].payload.nextStep, 'waiver');
  });

  test('a client with no checklist row counts as complete and is never Onboarding', async () => {
    const c = w.user('Old Timer', 'client', w.coach.id);
    const list = await checklist(c);
    assert.equal(list.started, false);
    assert.equal(list.pct, null);
    assert.equal(clientFacts(w.db, w.coach.id, [c.id], { only: ['onboarding.pct'] }).get(c.id)['onboarding.pct'], null);
    assert.notEqual((await w.ok('GET', `/api/coach/clients/${c.id}/lifecycle`, { as: w.coach })).stage, 'onboarding');
    assert.ok(!(await w.ok('GET', '/api/onboarding', { as: w.coach })).clients.some(x => x.client.id === c.id));
    assert.equal((await w.call('POST', `/api/coach/clients/${c.id}/onboarding`, { as: w.coach, body: { step: 'parq', done: true } })).status, 409);
  });

  test('the onboarding list shows who is onboarding, how far, and who is stuck', async () => {
    const { clients } = await w.ok('GET', '/api/onboarding', { as: w.coach });
    const stu = clients.find(x => x.client.name === 'Stu Stall');
    assert.ok(stu);
    assert.equal(stu.total, 9);
    assert.ok(stu.nextStep.nudge.length > 20);
    assert.ok(!clients.some(x => x.client.name === 'Cora Complete'));
  });
});

describe('template, isolation, export and erasure', () => {
  test('the template is validated: kinds, known events and facts, at most 12 steps', async () => {
    const put = body => w.call('PUT', '/api/onboarding/template', { as: w.coach, body });
    assert.equal((await put({ steps: [{ key: 'x', label: 'X', kind: 'event', event: 'nope.never' }] })).status, 400);
    assert.equal((await put({ steps: [{ key: 'x', label: 'X', kind: 'fact', fact: 'nope.fact' }] })).status, 400);
    assert.equal((await put({ steps: [{ key: 'x', label: 'X', kind: 'wish' }] })).status, 400);
    assert.equal((await put({ steps: Array.from({ length: 13 }, (_, i) => ({ key: `s${i}`, label: 'S', kind: 'manual' })) })).status, 400);
    assert.equal((await put({ steps: [{ key: 'a', label: 'A', kind: 'manual' }, { key: 'a', label: 'B', kind: 'manual' }] })).status, 400);
    assert.equal((await put({ steps: [{ key: 'p', label: 'P', kind: 'event', event: 'form.submitted', ref: 'f_not_mine' }] })).status, 404);
    // Another coach's template is their own.
    const ok = await w.ok('PUT', '/api/onboarding/template', { as: coach2, body: { steps: [{ key: 'call', label: 'Intro call', kind: 'manual' }, { key: 'app', label: 'App', kind: 'fact', fact: 'core.onboarded' }], stallDays: 3 } });
    assert.equal(ok.template.steps.length, 2);
    assert.equal(ok.template.stallDays, 3);
    assert.equal((await w.ok('GET', '/api/onboarding/template', { as: w.coach })).template.steps.length, 9);
  });

  test('every route is a 404 across coaches and a 403 for a client', async () => {
    const c = fresh('Iris Iso');
    await startFor(c);
    for (const [method, path, body] of [['GET', `/api/coach/clients/${c.id}/onboarding`], ['POST', `/api/coach/clients/${c.id}/onboarding`, { step: 'parq', done: true }]]) {
      assert.equal((await w.call(method, path, { as: coach2, body })).status, 404);
      assert.equal((await w.call(method, path, { as: c, body })).status, 403);
    }
    for (const [method, path] of [['GET', '/api/onboarding'], ['GET', '/api/onboarding/template'], ['PUT', '/api/onboarding/template']]) {
      assert.equal((await w.call(method, path, { as: c, body: method === 'PUT' ? { steps: [] } : undefined })).status, 403);
    }
    assert.ok(!(await w.ok('GET', '/api/onboarding', { as: coach2 })).clients.some(x => x.client.id === c.id));
    // Reassigned: the old coach gets 404, the new one sees the checklist.
    w.db.prepare('UPDATE users SET coach_id=? WHERE id=?').run(coach2.id, c.id);
    assert.equal((await w.call('GET', `/api/coach/clients/${c.id}/onboarding`, { as: w.coach })).status, 404);
    assert.equal((await w.ok('GET', `/api/coach/clients/${c.id}/onboarding`, { as: coach2 })).started, true);
  });

  test('the export includes the client\'s steps; DELETE /api/me leaves no rows', async () => {
    const c = fresh('Ed Export');
    await startFor(c);
    await w.ok('POST', `/api/coach/clients/${c.id}/onboarding`, { as: w.coach, body: { step: 'waiver', done: true } });
    const exp = await w.call('GET', '/api/me/export', { as: c });
    const body = JSON.parse(Buffer.isBuffer(exp.body) ? exp.body.toString() : JSON.stringify(exp.body));
    assert.ok(body.features.onboarding.checklist.startedAt);
    assert.deepEqual(body.features.onboarding.steps.map(s => [s.key, s.by]), [['waiver', 'coach']]);
    await w.ok('DELETE', '/api/me', { as: c });
    assertNoRowsFor(w.db, c.id);
  });
});
