/**
 * WP2 crm feature (docs/design/desk-v2.md F5, F7, F8): the health score and
 * its bands, the timeline, private notes, lifecycle rules (including an
 * in-person-only client and the churn suggestion that never ends anything),
 * pause and resume, End coaching, the radar and renewals, isolation,
 * reassignment, export and erasure.
 *
 * Features load from a temp folder: the real crm and onboarding files
 * (symlinked) plus two fixtures, one with timeline/renewals/offboarding hooks
 * and one whose hooks throw. Dates come from fakeToday() where they matter.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { checkParams, runAction } from '../facts.mjs';
import { newId, nowIso, tx } from '../store.mjs';
import { addDays, londonDay, londonToUtc } from '../time.mjs';

const dir = mkdtempSync(join(tmpdir(), 'wp2-crm-features-'));
for (const f of ['crm.mjs', 'onboarding.mjs']) symlinkSync(fileURLToPath(new URL(`../features/${f}`, import.meta.url)), join(dir, f));
writeFileSync(join(dir, 'zhooks.mjs'), `export const feature = {
  name: 'zhooks', namespaces: ['zhooks'],
  timeline(db, coach, client) { return [{ at: new Date(Date.now() - 3_600_000).toISOString(), kind: 'campaign', icon: 'rocket_launch', title: 'Fixture hook item', detail: '', path: null }]; },
  renewals(db, coach) {
    const c = db.prepare("SELECT id, name FROM users WHERE coach_id=? AND role='client' ORDER BY name LIMIT 1").get(coach.id);
    return c ? [{ client: { id: c.id, name: c.name }, kind: 'package', label: '1 credit left', on: '2099-01-01', detail: 'Fixture package' }] : [];
  },
  offboarding() { return { schedules: [{ id: 'bs_fixture', label: 'Monthly' }] }; },
};
`);
writeFileSync(join(dir, 'zthrows.mjs'), `export const feature = {
  name: 'zthrows', namespaces: ['zthrows'],
  timeline() { throw new Error('timeline boom'); },
  renewals() { throw new Error('renewals boom'); },
  offboarding() { throw new Error('offboarding boom'); },
};
`);
process.env.NODE_ENV = 'test';
process.env.FEATURES_DIR = dir;
const { assertNoRowsFor, fakeToday, makeWorld } = await import('./helpers.mjs');
const { bandOf, scoreFrom, _test } = await import('../features/crm.mjs');

const { today } = fakeToday();
const realToday = londonDay();

let w, coach2;
before(async () => {
  w = await makeWorld();
  coach2 = await w.signIn('wp2-coach2', 'coach2@example.com', { givenName: 'Other', familyName: 'Coach' });
  // Quiet errors from the throwing fixture are expected.
  console.error = () => {};
});
after(() => w.close());

const one = (sql, ...a) => w.db.prepare(sql).get(...a);
const rows = (sql, ...a) => w.db.prepare(sql).all(...a);
const iso = (d, t = '09:00') => londonToUtc(d, t).toISOString();
const events = (type, clientId) => rows('SELECT * FROM events WHERE type=? AND client_id=? ORDER BY seq', type, clientId).map(e => ({ ...e, payload: JSON.parse(e.payload) }));
/** A client of `coachId` who joined `daysAgo` days before `day`. */
function person(name, { coachId = w.coach.id, daysAgo = 120, day = realToday, plan = 'performance' } = {}) {
  const u = w.user(name, 'client', coachId);
  w.db.prepare('UPDATE users SET created_at=?, onboarded_at=?, plan=? WHERE id=?').run(iso(addDays(day, -daysAgo)), iso(addDays(day, -daysAgo)), plan, u.id);
  return { ...u, row: one('SELECT * FROM users WHERE id=?', u.id) };
}
const msg = (clientId, from, text, at) => w.db.prepare('INSERT INTO messages (id, client_id, from_id, from_role, text, at) VALUES (?,?,?,?,?,?)').run(newId('m'), clientId, null, from, text, at);
const session = (clientId, start) => w.db.prepare("INSERT INTO bookings (id, coach_id, client_id, kind, start, end, title, created_at) VALUES (?,?,?,'inperson',?,?,'1:1 strength',?)")
  .run(newId('b'), one('SELECT coach_id FROM users WHERE id=?', clientId).coach_id, clientId, start, new Date(Date.parse(start) + 3_600_000).toISOString(), nowIso());
const nightly = (coachId = w.coach.id, day = realToday) => tx(w.db, () => _test.nightly(w.db, coachId, day));
const stageOf = id => one('SELECT stage FROM client_lifecycle WHERE client_id=?', id)?.stage;

describe('health score (F5)', () => {
  test('the formula on a fixture', () => {
    const s = scoreFrom({ messages14: 4, checkins14: 1, habitDays14: 8, sessions14: 1, adherence28: 80, streak: 7, pain14: false, commitmentsSet: 4, commitmentsMissed: 1, daysQuiet: 1 });
    // engagement min(1,(4+3+4+3)/12)=1 → 30; adherence .8 → 24; consistency 7/14 → 10; wellbeing 1−0.25×(1/4)=.9375 → 18.75
    assert.equal(s.health, Math.round(100 * (0.3 * 1 + 0.3 * 0.8 + 0.2 * 0.5 + 0.2 * 0.9375)));
    assert.equal(s.health, 83);
    assert.equal(s.band, 'thriving');
    assert.deepEqual([s.factors.engagement, s.factors.adherence, s.factors.consistency, s.factors.wellbeing], [30, 24, 10, 19]);
    assert.ok(s.factors.notes.some(n => n === 'Kept 3/4 commitments'), s.factors.notes.join(' | '));
    // Null adherence counts 0.5 and pain halves wellbeing. Low voice sentiment is AI-derived: a note, never points (D5).
    const low = scoreFrom({ adherence28: null, pain14: true, sentiment14: -0.6 });
    assert.equal(low.health, Math.round(100 * (0.3 * 0.5 + 0.2 * 0.5)));
    assert.equal(low.health, scoreFrom({ adherence28: null, pain14: true }).health);
    assert.ok(low.factors.notes.some(n => /voice notes \(AI, not scored\)/.test(n)), low.factors.notes.join(' | '));
    // Sentiment is ignored when the fact is absent.
    assert.equal(scoreFrom({ adherence28: null }).health, Math.round(100 * (0.3 * 0.5 + 0.2)));
  });

  test('band boundaries', () => {
    assert.deepEqual([100, 75, 74, 50, 49, 30, 29, 0].map(bandOf), ['thriving', 'thriving', 'steady', 'steady', 'watch', 'watch', 'atRisk', 'atRisk']);
    assert.equal(bandOf(null), null);
  });

  test('a client\'s score from the API, stored per day, with a 90-day series and trend', async () => {
    const c = person('Score Fixture');
    for (let i = 1; i <= 4; i++) msg(c.id, 'client', 'Felt good today', iso(addDays(realToday, -i), '18:00'));
    w.db.prepare('INSERT INTO client_scores (client_id, coach_id, day, health, band, factors) VALUES (?,?,?,?,?,?)').run(c.id, w.coach.id, addDays(realToday, -14), 20, 'atRisk', '{}');
    const s = await w.ok('GET', `/api/coach/clients/${c.id}/score`, { as: w.coach });
    assert.equal(typeof s.health, 'number');
    assert.equal(s.score, s.health);
    assert.equal(s.band, bandOf(s.health));
    assert.equal(s.trend, s.health - 20);
    assert.ok(Array.isArray(s.factors.notes) && s.factors.notes.length >= 4);
    assert.equal(one('SELECT health FROM client_scores WHERE client_id=? AND day=?', c.id, realToday).health, s.health);
    assert.equal(s.series.at(-1).day, realToday);
  });

  test('an in-person-only client (two sessions a week, no app activity for 35 days) scores at least Steady and stays Active', async () => {
    const c = person('Ina Person', { daysAgo: 200 });
    msg(c.id, 'client', 'See you Tuesday', iso(addDays(realToday, -40), '18:00')); // the last app activity, 40 days ago
    for (let d = 2; d <= 35; d += 3.5) session(c.id, iso(addDays(realToday, -Math.round(d)), '07:00'));
    const s = await w.ok('GET', `/api/coach/clients/${c.id}/score`, { as: w.coach });
    assert.ok(s.health >= 50, `health ${s.health}`);
    assert.ok(['steady', 'thriving'].includes(s.band));
    nightly();
    assert.equal(stageOf(c.id), 'active');
    assert.equal(one('SELECT churn_suggested_at FROM client_lifecycle WHERE client_id=?', c.id).churn_suggested_at, null);
  });
});

describe('lifecycle (F7)', () => {
  test('each automatic rule: active, at risk by health, by quiet days, by a falling trend', async () => {
    const fine = person('Fiona Fine');
    for (let i = 0; i < 10; i++) msg(fine.id, 'client', 'Done', iso(addDays(realToday, -i), '18:00'));
    const quiet = person('Quentin Quiet');
    msg(quiet.id, 'client', 'Busy week', iso(addDays(realToday, -12), '18:00'));
    for (let i = 0; i < 6; i++) session(quiet.id, iso(addDays(realToday, -(13 + i * 3)), '07:00'));
    const falling = person('Fay Falling');
    for (let i = 0; i < 10; i++) msg(falling.id, 'client', 'Done', iso(addDays(realToday, -i), '18:00'));
    w.db.prepare('INSERT INTO client_scores (client_id, coach_id, day, health, band, factors) VALUES (?,?,?,?,?,?)').run(falling.id, w.coach.id, addDays(realToday, -14), 99, 'thriving', '{}');
    const low = person('Lou Low');
    msg(low.id, 'client', 'Knee pain again, sorry', iso(addDays(realToday, -2), '18:00'));
    nightly();
    const healthOf = id => one('SELECT health FROM client_scores WHERE client_id=? AND day=?', id, realToday).health;
    assert.equal(stageOf(fine.id), 'active');
    assert.equal(stageOf(quiet.id), 'atRisk');
    assert.ok(healthOf(falling.id) - 99 <= -20 && healthOf(falling.id) >= 35);
    assert.equal(stageOf(falling.id), 'atRisk');
    assert.ok(healthOf(low.id) < 35);
    assert.equal(stageOf(low.id), 'atRisk');
    // The first classification never emits stageChanged (no automation storm on deploy).
    assert.equal(events('client.stageChanged', fine.id).length, 0);
  });

  test('Onboarding while the checklist is open, then Active the moment it completes', async () => {
    const c = person('Nina New', { daysAgo: 3 });
    await w.ok('POST', `/api/coach/clients/${c.id}/onboarding`, { as: w.coach, body: { start: true } });
    nightly();
    assert.equal(stageOf(c.id), 'onboarding');
    const list = await w.ok('GET', `/api/coach/clients/${c.id}/onboarding`, { as: w.coach });
    for (const s of list.steps.filter(x => !x.done)) await w.ok('POST', `/api/coach/clients/${c.id}/onboarding`, { as: w.coach, body: { step: s.key, done: true } });
    await w.settle();
    assert.equal(stageOf(c.id), 'active');
    const changed = events('client.stageChanged', c.id);
    assert.equal(changed.length, 1);
    assert.deepEqual([changed[0].payload.from, changed[0].payload.to, changed[0].payload.manual], ['onboarding', 'active', false]);
    // A client joined 60+ days ago with an open checklist is not Onboarding.
    const old = person('Olga Old', { daysAgo: 90 });
    for (let i = 0; i < 6; i++) msg(old.id, 'client', 'Done', iso(addDays(realToday, -i), '18:00'));
    await w.ok('POST', `/api/coach/clients/${old.id}/onboarding`, { as: w.coach, body: { start: true } });
    nightly();
    assert.notEqual(stageOf(old.id), 'onboarding');
  });

  test('a manual override survives the nightly run until it is cleared; history is appended once per change', async () => {
    const c = person('Manny Manual');
    msg(c.id, 'client', 'old news', iso(addDays(realToday, -20), '18:00'));
    nightly();
    assert.equal(stageOf(c.id), 'atRisk');
    await w.ok('PUT', `/api/coach/clients/${c.id}/lifecycle`, { as: w.coach, body: { stage: 'active' } });
    nightly();
    nightly();
    let l = await w.ok('GET', `/api/coach/clients/${c.id}/lifecycle`, { as: w.coach });
    assert.equal(l.stage, 'active');
    assert.equal(l.manual, true);
    assert.equal(l.history.length, 2);
    l = await w.ok('PUT', `/api/coach/clients/${c.id}/lifecycle`, { as: w.coach, body: { manual: false } });
    assert.equal(l.stage, 'atRisk');
    assert.equal(l.manual, false);
    nightly();
    assert.equal((await w.ok('GET', `/api/coach/clients/${c.id}/lifecycle`, { as: w.coach })).history.length, 3);
    assert.deepEqual(events('client.stageChanged', c.id).map(e => [e.payload.from, e.payload.to, e.payload.manual]), [['atRisk', 'active', true], ['active', 'atRisk', false]]);
    // Churned and paused can only come from End coaching and Pause.
    assert.equal((await w.call('PUT', `/api/coach/clients/${c.id}/lifecycle`, { as: w.coach, body: { stage: 'churned' } })).status, 400);
    assert.equal((await w.call('PUT', `/api/coach/clients/${c.id}/lifecycle`, { as: w.coach, body: { stage: 'paused' } })).status, 400);
    // The birthday is day and month only.
    assert.equal((await w.ok('PUT', `/api/coach/clients/${c.id}/lifecycle`, { as: w.coach, body: { birthday: '12-05' } })).birthday, '12-05');
    assert.equal((await w.call('PUT', `/api/coach/clients/${c.id}/lifecycle`, { as: w.coach, body: { birthday: '1990-12-05' } })).status, 400);
  });

  test('the churn rule suggests (a needs-you reason) and changes nothing: stage, schedule or end', async () => {
    const c = person('Cal Gone', { daysAgo: 200 });
    msg(c.id, 'client', 'Swamped', iso(addDays(realToday, -34), '18:00'));
    const future = iso(addDays(realToday, 5), '07:00');
    session(c.id, future);
    nightly();
    const row = one('SELECT * FROM client_lifecycle WHERE client_id=?', c.id);
    assert.ok(row.churn_suggested_at);
    assert.equal(row.stage, 'atRisk');
    assert.equal(events('client.offboarded', c.id).length, 0);
    assert.equal(one('SELECT cancelled_at FROM bookings WHERE client_id=? AND start=?', c.id, future).cancelled_at, null);
    const needs = await w.ok('GET', '/api/coach/needs-you', { as: w.coach });
    const item = needs.items.find(i => i.client.id === c.id);
    assert.ok(item.reasons.some(r => r.kind === 'churnSuggested' && r.rank === 6 && /Looks like Cal has stopped: quiet 34 days/.test(r.text)), JSON.stringify(item.reasons));
    // A plan lapsed for 14+ days after having one also suggests it.
    const lapsed = person('Lapsed Larry', { daysAgo: 100, plan: 'none' });
    for (let i = 0; i < 4; i++) msg(lapsed.id, 'client', 'ok', iso(addDays(realToday, -i), '18:00'));
    w.db.prepare('INSERT INTO membership_events (user_id, plan, at) VALUES (?,?,?), (?,?,?)').run(lapsed.id, 'foundation', iso(addDays(realToday, -100)), lapsed.id, 'none', iso(addDays(realToday, -20)));
    nightly();
    assert.ok(one('SELECT churn_suggested_at FROM client_lifecycle WHERE client_id=?', lapsed.id).churn_suggested_at);
  });

  test('segment preview counts match the rules evaluation', async () => {
    nightly();
    const rules = { match: 'all', rules: [{ fact: 'crm.stage', op: 'eq', value: 'atRisk' }] };
    const preview = await w.ok('POST', '/api/segments/preview', { as: w.coach, body: { rules } });
    const { clients } = await w.ok('GET', '/api/crm/clients', { as: w.coach });
    assert.equal(preview.count, clients.filter(c => c.stage === 'atRisk').length);
    assert.ok(preview.count >= 2);
    const health = { match: 'all', rules: [{ fact: 'crm.health', op: 'lt', value: 35 }] };
    assert.equal((await w.ok('POST', '/api/segments/preview', { as: w.coach, body: { rules: health } })).count, clients.filter(c => c.health !== null && c.health < 35).length);
    const counts = (await w.ok('GET', '/api/crm/stages', { as: w.coach })).counts;
    assert.equal(counts.atRisk, preview.count);
  });
});

describe('pause, resume and end (F8)', () => {
  test('pause and resume emit their events with days; the clock resumes automatically', async () => {
    const c = person('Pat Pause');
    const l = await w.ok('POST', `/api/coach/clients/${c.id}/pause`, { as: w.coach, body: { weeks: 3, reason: 'Holiday' } });
    assert.equal(l.lifecycle.stage, 'paused');
    assert.equal(l.lifecycle.pausedUntil, addDays(realToday, 21));
    await w.settle();
    const p = events('client.paused', c.id);
    assert.deepEqual([p.length, p[0].payload.days, p[0].payload.until, p[0].payload.reason], [1, 21, addDays(realToday, 21), 'Holiday']);
    assert.equal((await w.call('POST', `/api/coach/clients/${c.id}/pause`, { as: w.coach, body: { weeks: 1 } })).status, 400);
    // The nightly run keeps them paused.
    nightly();
    assert.equal(stageOf(c.id), 'paused');
    // The clock before the day does nothing, on the day resumes.
    await w.tick('crm.resume', londonToUtc(addDays(realToday, 20), '12:00'));
    assert.equal(stageOf(c.id), 'paused');
    await w.tick('crm.resume', londonToUtc(addDays(realToday, 21), '00:20'));
    assert.notEqual(stageOf(c.id), 'paused');
    const r = events('client.resumed', c.id);
    assert.equal(r.length, 1);
    assert.equal(r[0].payload.pausedDays, 21);
    await w.tick('crm.resume', londonToUtc(addDays(realToday, 22), '12:00'));
    assert.equal(events('client.resumed', c.id).length, 1);
    // A manual resume.
    await w.ok('POST', `/api/coach/clients/${c.id}/pause`, { as: w.coach, body: { weeks: 2, reason: '' } });
    await w.ok('POST', `/api/coach/clients/${c.id}/resume`, { as: w.coach });
    assert.equal(events('client.resumed', c.id).at(-1).payload.pausedDays, 0);
    assert.equal((await w.call('POST', `/api/coach/clients/${c.id}/resume`, { as: w.coach })).status, 409);
  });

  test('ending coaching needs an exit reason; it records the stage and emits client.offboarded once', async () => {
    const c = person('Eddie End');
    assert.equal((await w.call('POST', `/api/coach/clients/${c.id}/end`, { as: w.coach, body: { money: 'leave', packages: 'expire' } })).status, 400);
    const off = await w.ok('GET', `/api/coach/clients/${c.id}/offboarding`, { as: w.coach });
    assert.deepEqual(off.schedules, [{ id: 'bs_fixture', label: 'Monthly' }]); // the fixture hook; the throwing one is skipped
    const out = await w.ok('POST', `/api/coach/clients/${c.id}/end`, { as: w.coach, body: { exitReason: 'cost', exitNote: 'Mortgage', money: 'leave', keepChasing: true, packages: 'refund', survey: true } });
    assert.equal(out.lifecycle.stage, 'churned');
    assert.equal(out.lifecycle.exitReason, 'cost');
    assert.equal(out.survey, 'Sent');
    assert.ok(one("SELECT 1 FROM form_requests WHERE client_id=? AND name='Before you go'", c.id));
    await w.settle();
    const e = events('client.offboarded', c.id);
    assert.equal(e.length, 1);
    assert.deepEqual([e[0].payload.exitReason, e[0].payload.money, e[0].payload.keepChasing, e[0].payload.packages], ['cost', 'leave', true, 'refund']);
    assert.equal((await w.call('POST', `/api/coach/clients/${c.id}/end`, { as: w.coach, body: { exitReason: 'cost' } })).status, 409);
    // Ending changes neither the plan nor app access.
    assert.equal(one('SELECT plan FROM users WHERE id=?', c.id).plan, 'performance');
    assert.equal((await w.call('GET', '/api/me', { as: c })).status, 200);
    // Nightly leaves an ended client alone; goal reached ends as Alumni; Restart coaching is a manual stage change.
    nightly();
    assert.equal(stageOf(c.id), 'churned');
    const g = person('Gina Goal');
    assert.equal((await w.ok('POST', `/api/coach/clients/${g.id}/end`, { as: w.coach, body: { exitReason: 'goalReached', money: 'invoice', packages: 'expire' } })).lifecycle.stage, 'alumni');
    await w.ok('PUT', `/api/coach/clients/${c.id}/lifecycle`, { as: w.coach, body: { stage: 'active' } });
    await w.settle();
    assert.deepEqual(events('client.stageChanged', c.id).at(-1).payload, { from: 'churned', to: 'active', manual: true });
    const ended = await w.ok('GET', '/api/retention/ended', { as: w.coach });
    assert.ok(ended.clients.some(x => x.client.id === g.id && x.exitReason === 'goalReached'));
  });

  test('lifecycle.set refuses churned; lifecycle.pause pauses', () => {
    const c = person('Act Ion');
    assert.throws(() => checkParams('lifecycle.set', { stage: 'churned' }), /stage must be one of/);
    assert.throws(() => tx(w.db, () => runAction(w.db, w.config, 'lifecycle.set', { coachId: w.coach.id, client: { id: c.id }, params: { stage: 'churned' } })), /End coaching/);
    assert.equal(tx(w.db, () => runAction(w.db, w.config, 'lifecycle.set', { coachId: w.coach.id, client: { id: c.id }, params: checkParams('lifecycle.set', { stage: 'atRisk' }) })), 'Stage: At risk');
    assert.match(tx(w.db, () => runAction(w.db, w.config, 'lifecycle.pause', { coachId: w.coach.id, client: { id: c.id }, params: checkParams('lifecycle.pause', { weeks: 4, reason: 'Surgery' }) })), /^Paused until /);
    assert.equal(stageOf(c.id), 'paused');
  });
});

describe('timeline, notes and retention', () => {
  test('the timeline merges domain history, events, pinned notes and a hook (a throwing hook is skipped)', async () => {
    const c = person('Tim Line');
    msg(c.id, 'client', 'Squats felt great', iso(addDays(realToday, -1), '18:00'));
    await w.ok('PUT', `/api/coach/clients/${c.id}/tags`, { as: w.coach, body: { tagIds: [(await w.ok('POST', '/api/tags', { as: w.coach, body: { name: 'Timeline tag' } })).tag.id] } });
    await w.ok('POST', `/api/coach/clients/${c.id}/notes`, { as: w.coach, body: { body: 'Pinned private note', pinned: true } });
    await w.ok('POST', `/api/coach/clients/${c.id}/notes`, { as: w.coach, body: { body: 'Unpinned note' } });
    const t = await w.ok('GET', `/api/coach/clients/${c.id}/timeline`, { as: w.coach });
    const titles = t.items.map(i => i.title);
    assert.ok(titles.includes('Tim wrote'));
    assert.ok(titles.some(x => /Tagged Timeline tag/.test(x)), titles.join(' | '));
    assert.ok(titles.includes('Pinned note'));
    assert.ok(!t.items.some(i => i.detail === 'Unpinned note'));
    assert.ok(titles.includes('Fixture hook item'));
    assert.deepEqual(t.items.map(i => i.at), [...t.items.map(i => i.at)].sort().reverse());
    // Filter and paging.
    const notes = await w.ok('GET', `/api/coach/clients/${c.id}/timeline?kinds=note`, { as: w.coach });
    assert.deepEqual(notes.items.map(i => i.kind), ['note']);
    const page = await w.ok('GET', `/api/coach/clients/${c.id}/timeline?limit=2`, { as: w.coach });
    assert.equal(page.items.length, 2);
    const next = await w.ok('GET', `/api/coach/clients/${c.id}/timeline?limit=2&before=${encodeURIComponent(page.next)}`, { as: w.coach });
    assert.ok(next.items.every(i => i.at < page.next));
  });

  test('notes: pin, edit, delete; in the client\'s export under features.crm.notes and in no client-facing endpoint', async () => {
    const c = person('Nora Notes');
    const { note } = await w.ok('POST', `/api/coach/clients/${c.id}/notes`, { as: w.coach, body: { body: 'SECRET-COACH-NOTE knee' } });
    assert.match(note.id, /^nb_/);
    assert.equal((await w.ok('PATCH', `/api/coach/clients/${c.id}/notes/${note.id}`, { as: w.coach, body: { pinned: true, body: 'SECRET-COACH-NOTE knee, left' } })).note.pinned, true);
    assert.equal((await w.ok('GET', `/api/coach/clients/${c.id}/notes`, { as: w.coach })).notes[0].body, 'SECRET-COACH-NOTE knee, left');
    const exp = await w.call('GET', '/api/me/export', { as: c });
    const body = JSON.parse(Buffer.isBuffer(exp.body) ? exp.body.toString() : JSON.stringify(exp.body));
    assert.equal(body.features.crm.notes[0].body, 'SECRET-COACH-NOTE knee, left');
    for (const path of ['/api/timeline', '/api/messages', '/api/me', '/api/today']) {
      const r = await w.call('GET', path, { as: c });
      const text = Buffer.isBuffer(r.body) ? r.body.toString() : JSON.stringify(r.body);
      assert.ok(!text.includes('SECRET-COACH-NOTE'), `${path} leaks a note`);
    }
    // A client calling a coach endpoint gets 403.
    assert.equal((await w.call('GET', `/api/coach/clients/${c.id}/notes`, { as: c })).status, 403);
    await w.ok('DELETE', `/api/coach/clients/${c.id}/notes/${note.id}`, { as: w.coach });
    assert.equal((await w.ok('GET', `/api/coach/clients/${c.id}/notes`, { as: w.coach })).notes.length, 0);
  });

  test('the radar groups by band and stage; renewals merge hooks and tolerate a throwing one', async () => {
    nightly();
    const r = await w.ok('GET', '/api/retention', { as: w.coach });
    for (const card of r.watch) assert.equal(card.band, 'watch');
    for (const card of r.atRisk) assert.ok(card.band === 'atRisk' || card.stage === 'atRisk');
    for (const card of r.suggested) assert.equal(card.suggested, true);
    const all = [...r.watch, ...r.atRisk, ...r.suggested];
    assert.equal(new Set(all.map(x => x.client.id)).size, all.length, 'a client is in one column');
    assert.ok(r.suggested.some(x => x.client.name === 'Cal Gone' && x.play.kind === 'end'), JSON.stringify(r.suggested.map(x => [x.client.name, x.play])) + JSON.stringify(r.atRisk.map(x => x.client.name)));
    assert.ok(!all.some(x => ['paused', 'churned', 'alumni'].includes(x.stage)));
    assert.ok(r.stats.reasons.some(x => x.reason === 'goalReached')); // Eddie (cost) restarted, so only Gina counts
    assert.equal(r.stats.churn.length, 12);
    const ren = await w.ok('GET', '/api/retention/renewals?days=30', { as: w.coach });
    assert.ok(ren.items.some(i => i.detail === 'Fixture package' && i.kind === 'package'));
    // Another coach's renewals never show here.
    assert.ok(ren.items.every(i => one('SELECT coach_id FROM users WHERE id=?', i.client.id).coach_id === w.coach.id));
  });

  test('crm.bandChanged when the band moves between nights; at risk becomes a needs-you reason', async () => {
    const c = person('Bea Band');
    w.db.prepare('INSERT INTO client_scores (client_id, coach_id, day, health, band, factors) VALUES (?,?,?,?,?,?)').run(c.id, w.coach.id, addDays(realToday, -1), 80, 'thriving', '{}');
    nightly();
    const s = one('SELECT * FROM client_scores WHERE client_id=? AND day=?', c.id, realToday);
    const e = events('crm.bandChanged', c.id);
    assert.equal(e.length, 1);
    assert.deepEqual([e[0].payload.from, e[0].payload.to, e[0].payload.health], ['thriving', s.band, s.health]);
    nightly();
    assert.equal(events('crm.bandChanged', c.id).length, 1);
    if (s.band === 'atRisk') {
      const needs = await w.ok('GET', '/api/coach/needs-you', { as: w.coach });
      assert.ok(needs.items.find(i => i.client.id === c.id).reasons.some(r => r.text === `Health dropped to ${s.health} (At risk)`));
    }
  });
});

describe('isolation, reassignment, export and erasure', () => {
  test('every route is a 404 across coaches and a 403 for a client', async () => {
    const mine = person('Iso Mine');
    const { note } = await w.ok('POST', `/api/coach/clients/${mine.id}/notes`, { as: w.coach, body: { body: 'private' } });
    const routes = [
      ['GET', `/api/coach/clients/${mine.id}/score`], ['GET', `/api/coach/clients/${mine.id}/timeline`],
      ['GET', `/api/coach/clients/${mine.id}/notes`], ['POST', `/api/coach/clients/${mine.id}/notes`, { body: 'x' }],
      ['PATCH', `/api/coach/clients/${mine.id}/notes/${note.id}`, { body: 'x' }], ['DELETE', `/api/coach/clients/${mine.id}/notes/${note.id}`],
      ['GET', `/api/coach/clients/${mine.id}/lifecycle`], ['PUT', `/api/coach/clients/${mine.id}/lifecycle`, { stage: 'active' }],
      ['POST', `/api/coach/clients/${mine.id}/pause`, { weeks: 2 }], ['POST', `/api/coach/clients/${mine.id}/resume`],
      ['GET', `/api/coach/clients/${mine.id}/offboarding`], ['POST', `/api/coach/clients/${mine.id}/end`, { exitReason: 'other' }],
    ];
    for (const [method, path, body] of routes) {
      assert.equal((await w.call(method, path, { as: coach2, body })).status, 404, `${method} ${path} for another coach`);
      assert.equal((await w.call(method, path, { as: mine, body })).status, 403, `${method} ${path} for a client`);
    }
    for (const path of ['/api/crm/clients', '/api/crm/stages', '/api/retention', '/api/retention/renewals', '/api/retention/ended']) {
      assert.equal((await w.call('GET', path, { as: mine })).status, 403, path);
    }
    const theirs = await w.ok('GET', '/api/crm/clients', { as: coach2 });
    assert.ok(!theirs.clients.some(c => c.id === mine.id));
    assert.equal(stageOf(mine.id) ?? 'none', 'none');
    assert.equal((await w.ok('GET', `/api/coach/clients/${mine.id}/notes`, { as: w.coach })).notes.length, 1);
  });

  test('a reassigned client leaves the old coach (404) and the new coach sees their rows', async () => {
    const c = person('Rhea Assign');
    await w.ok('POST', `/api/coach/clients/${c.id}/notes`, { as: w.coach, body: { body: 'handover note' } });
    await w.ok('POST', `/api/coach/clients/${c.id}/pause`, { as: w.coach, body: { weeks: 2, reason: 'Trip' } });
    w.db.prepare('UPDATE users SET coach_id=? WHERE id=?').run(coach2.id, c.id);
    assert.equal((await w.call('GET', `/api/coach/clients/${c.id}/notes`, { as: w.coach })).status, 404);
    assert.equal((await w.call('GET', `/api/coach/clients/${c.id}/lifecycle`, { as: w.coach })).status, 404);
    assert.ok(!(await w.ok('GET', '/api/crm/clients', { as: w.coach })).clients.some(x => x.id === c.id));
    assert.equal((await w.ok('GET', `/api/coach/clients/${c.id}/notes`, { as: coach2 })).notes[0].body, 'handover note');
    assert.equal((await w.ok('GET', `/api/coach/clients/${c.id}/lifecycle`, { as: coach2 })).stage, 'paused');
    // The resume clock emits for the current coach.
    await w.tick('crm.resume', londonToUtc(addDays(realToday, 15), '12:00'));
    assert.equal(events('client.resumed', c.id)[0].coach_id, coach2.id);
  });

  test('the export carries the client\'s lifecycle and scores; DELETE /api/me leaves no rows', async () => {
    const c = person('Del Ete');
    await w.ok('POST', `/api/coach/clients/${c.id}/notes`, { as: w.coach, body: { body: 'to be erased', pinned: true } });
    await w.ok('GET', `/api/coach/clients/${c.id}/score`, { as: w.coach });
    await w.ok('POST', `/api/coach/clients/${c.id}/pause`, { as: w.coach, body: { weeks: 2, reason: 'Exams' } });
    const exp = await w.call('GET', '/api/me/export', { as: c });
    const body = JSON.parse(Buffer.isBuffer(exp.body) ? exp.body.toString() : JSON.stringify(exp.body));
    assert.equal(body.features.crm.lifecycle.stage, 'paused');
    assert.ok(body.features.crm.scores.length >= 1);
    assert.ok(body.features.crm.lifecycleHistory.length >= 1);
    await w.ok('DELETE', '/api/me', { as: c });
    assertNoRowsFor(w.db, c.id);
  });
});

describe('demo world', () => {
  test('every demo client has a stage that fits its story, with scores, notes, tags and segments', async () => {
    const { buildDemo } = await import('../demo.mjs');
    buildDemo(w.db, today, w.config);
    buildDemo(w.db, addDays(today, 1), w.config); // twice, on consecutive days
    const coach = one("SELECT * FROM users WHERE apple_sub='demo-coach'");
    const stage = name => one('SELECT l.stage FROM client_lifecycle l JOIN users u ON u.id=l.client_id WHERE u.name=? AND u.is_demo=1', name)?.stage;
    assert.equal(stage('Sam Carter'), 'active');
    assert.equal(stage('Alex Morgan'), 'paused');
    assert.equal(stage('Leo Grant'), 'atRisk');
    assert.equal(stage('Hannah Price'), 'alumni');
    assert.equal(stage('Marcus Webb'), 'churned');
    assert.equal(one("SELECT COUNT(*) n FROM users WHERE apple_sub LIKE 'demo-crm-%'").n, 4);
    assert.ok(one("SELECT churn_suggested_at FROM client_lifecycle l JOIN users u ON u.id=l.client_id WHERE u.name='Dan Okafor'").churn_suggested_at);
    const sam = one("SELECT id FROM users WHERE apple_sub='demo-client'");
    assert.equal(one('SELECT COUNT(*) n FROM client_scores WHERE client_id=?', sam.id).n, 90);
    assert.ok(one('SELECT COUNT(*) n FROM client_notes WHERE client_id=?', sam.id).n >= 2);
    assert.equal(one('SELECT COUNT(*) n FROM segments WHERE coach_id=? AND pinned=1', coach.id).n, 1);
    assert.equal(one('SELECT COUNT(*) n FROM segments WHERE coach_id=?', coach.id).n, 3);
    assert.ok(one('SELECT COUNT(*) n FROM tags WHERE coach_id=?', coach.id).n >= 3);
    // A save in the history: at risk, then active within 30 days.
    const r = _test.retention(w.db, coach, addDays(today, 1));
    assert.ok(r.stats.saves90 >= 1);
    assert.ok(r.stats.reasons.length >= 2);
  });
});
