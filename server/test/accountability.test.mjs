/**
 * F24 The accountability board (docs/design/desk-v2.md, WP8): the score per
 * part on every weekday (the Monday trap), milestones once, bulk nudges with
 * rendered names through the governor, snapshots, isolation, reassignment,
 * export and erasure.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { assertNoRowsFor, makeWorld } from './helpers.mjs';
import { emit } from '../events.mjs';
import { weekParts } from '../features/accountability.mjs';
import { newId } from '../store.mjs';
import { addDays, londonToUtc } from '../time.mjs';

let w;
before(async () => { w = await makeWorld(); });
after(() => w.close());

const WEEK = '2026-11-23'; // a Monday (GMT)
const at = (d, t = '12:00') => londonToUtc(d, t).toISOString();

/** A client of `coachId` who joined long ago, straight into the database. */
function person(name, coachId = w.coach.id) {
  const u = w.user(name, 'client', coachId);
  w.db.prepare("UPDATE users SET created_at=?, plan='performance' WHERE id=?").run('2026-01-05T09:00:00.000Z', u.id);
  return { ...u, row: w.db.prepare('SELECT * FROM users WHERE id=?').get(u.id) };
}
function habit(clientId) {
  const id = newId('h');
  w.db.prepare("INSERT INTO habits (id, client_id, name, kind, target, unit, icon, position, created_at) VALUES (?,?,?,'check',1,'','checkmark',0,?)")
    .run(id, clientId, 'Walk', '2026-01-05T09:00:00.000Z');
  return id;
}
const tick = (habitId, day) => w.db.prepare('INSERT OR REPLACE INTO habit_days (habit_id, date, value, done) VALUES (?,?,1,1)').run(habitId, day);
const workout = (clientId, day, done) => w.db.prepare(`INSERT INTO workouts (id, client_id, date, title, published, published_at, edited_at, edited_by, completed_at, created_by)
  VALUES (?,?,?,'Session',1,?,?,'coach',?,?)`).run(newId('w'), clientId, day, at(day, '06:00'), at(day, '06:00'), done ? at(day, '07:30') : null, w.coach.id);
const commitment = (clientId, week, i, text, outcome) => w.db.prepare(`INSERT INTO commitments (id, client_id, week, position, text, outcome, created_by, created_at, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?)`).run(newId('cm'), clientId, week, i, text, outcome, w.coach.id, at(addDays(week, -1)), at(addDays(week, -1)));
const checkin = (clientId, week, day) => w.db.prepare("INSERT INTO checkins (id, client_id, week, energy, sleep, pain, note, submitted_at) VALUES (?,?,?,4,4,'[]','',?)")
  .run(newId('c'), clientId, week, at(day, '18:00'));
const formula = p => Math.round(100 * (0.4 * p.c + 0.3 * p.h + 0.2 * p.t + 0.1 * p.k));
const close = (a, b) => Math.abs(a - b) < 0.002;

describe('the score, part by part, on every weekday', () => {
  let ana, nobody;
  before(() => {
    ana = person('Ana Busy');
    const hid = habit(ana.id);
    // Day minimum met Mon, Tue, Thu, Fri, Sun; missed Wed and Sat.
    for (const i of [0, 1, 3, 4, 6]) tick(hid, addDays(WEEK, i));
    workout(ana.id, WEEK, true); workout(ana.id, addDays(WEEK, 2), false); workout(ana.id, addDays(WEEK, 4), true);
    commitment(ana.id, WEEK, 0, 'Three sessions', 'kept');
    commitment(ana.id, WEEK, 1, 'Lights out by eleven', 'mostly');
    commitment(ana.id, WEEK, 2, 'A run for joy', null);
    nobody = person('Nora Nothing');
  });

  const expected = {
    // day offset: [h, t, k]
    0: [1, 1, 1], 1: [1, 1, 1], 2: [1, 1, 1], 3: [3 / 4, 2 / 3, 1], 4: [4 / 5, 2 / 3, 0], 5: [4 / 5, 2 / 3, 0], 6: [5 / 7, 2 / 3, 0],
  };
  for (const [i, [h, t, k]] of Object.entries(expected)) {
    test(`${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]}: commitments count only once reviewed, the minimum only for days gone, the check-in from Friday`, () => {
      const today = addDays(WEEK, Number(i));
      const p = weekParts(w.db, ana.row, WEEK, { today, now: londonToUtc(today, '12:00') });
      assert.ok(close(p.parts.c, 0.75), `C ${p.parts.c}`);
      assert.ok(close(p.parts.h, h), `H ${p.parts.h} want ${h}`);
      assert.ok(close(p.parts.t, t), `T ${p.parts.t} want ${t}`);
      assert.equal(p.parts.k, k);
      assert.equal(p.score, formula({ c: 0.75, h, t, k }));
      assert.equal(p.minimumDays.length, 7);
    });
  }

  test('after the week ends an open commitment counts as not kept', () => {
    const p = weekParts(w.db, ana.row, WEEK, { today: addDays(WEEK, 7), now: londonToUtc(addDays(WEEK, 7), '12:00') });
    assert.ok(close(p.parts.c, 0.5));
    assert.ok(p.flags.includes('missed'));
  });

  test('no commitments set gives C = .5 and the flag; nothing due counts as kept; the Monday trap', () => {
    const mon = weekParts(w.db, nobody.row, WEEK, { today: WEEK, now: londonToUtc(WEEK, '09:00') });
    assert.deepEqual(mon.parts, { c: 0.5, h: 1, t: 1, k: 1 });
    assert.equal(mon.score, 80);
    assert.ok(mon.flags.includes('noCommitments'));
    const fri = weekParts(w.db, nobody.row, WEEK, { today: addDays(WEEK, 4), now: londonToUtc(addDays(WEEK, 4), '09:00') });
    assert.equal(fri.parts.k, 0);
    assert.equal(fri.score, 70);
    checkin(nobody.id, WEEK, addDays(WEEK, 4));
    const sat = weekParts(w.db, nobody.row, WEEK, { today: addDays(WEEK, 5), now: londonToUtc(addDays(WEEK, 5), '09:00') });
    assert.equal(sat.parts.k, 1);
    assert.equal(sat.checkin, true);
  });

  test('the board answers for a chosen week, with filters', async () => {
    const r = await w.ok('GET', `/api/accountability?week=${addDays(WEEK, 3)}&at=${at(addDays(WEEK, 3), '19:00')}`, { as: w.coach });
    assert.equal(r.week, WEEK);
    const row = r.rows.find(x => x.client.id === ana.id);
    assert.equal(row.score, formula({ c: 0.75, h: 0.75, t: 2 / 3, k: 1 }));
    assert.equal(row.commitments.length, 3);
    assert.deepEqual(row.commitments.map(c => c.outcome), ['kept', 'mostly', 'open']);
    assert.equal(row.trend.length, 8);
    assert.deepEqual(row.workouts, { done: 2, planned: 3 });
    const missed = await w.ok('GET', `/api/accountability?week=${WEEK}&filter=missed&at=${at(addDays(WEEK, 3))}`, { as: w.coach });
    assert.ok(missed.rows.every(x => x.flags.includes('missed')));
    assert.equal((await w.call('GET', `/api/accountability?week=2099-01-05&at=${at(WEEK)}`, { as: w.coach })).status, 400);
  });
});

describe('streak milestones', () => {
  test('fire once per crossing, from day.started', async () => {
    const sid = person('Stella Streak');
    const hid = habit(sid.id);
    const D = '2026-11-20';
    for (let i = 1; i <= 6; i++) tick(hid, addDays(D, -i));
    emit(w.db, 'day.started', { coachId: w.coach.id, day: D });
    await w.settle();
    const rows = () => w.db.prepare('SELECT * FROM accountability_milestones WHERE client_id=?').all(sid.id);
    assert.equal(rows().length, 0, 'the first sighting only records the streak');
    tick(hid, D);
    emit(w.db, 'day.started', { coachId: w.coach.id, day: addDays(D, 1) });
    await w.settle();
    assert.deepEqual(rows().map(r => [r.milestone, r.reached_on]), [[7, D]]);
    emit(w.db, 'day.started', { coachId: w.coach.id, day: addDays(D, 1) });
    await w.settle();
    assert.equal(rows().length, 1, 'once');
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM events WHERE type='accountability.milestone' AND client_id=?").get(sid.id).n, 1);
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM coach_notifications WHERE kind='streak' AND client_id=?").get(sid.id).n, 1);
    const board = await w.ok('GET', `/api/accountability?week=2026-11-16&at=${at('2026-11-21')}`, { as: w.coach });
    assert.ok(board.milestones.some(m => m.client.id === sid.id && m.streak === 7));
    const { hooks } = await import('../registry.mjs');
    const [[, needs]] = hooks('needs').filter(([f]) => f.name === 'accountability');
    const items = needs(w.db, w.coach.row, [sid.row], '2026-11-21');
    assert.equal(items[0].text, '7-day streak');
    assert.equal(items[0].rank, 8);
    assert.equal(items[0].action.label, 'Celebrate');
  });
});

describe('nudges', () => {
  let a, b;
  before(() => { a = person('Amy Pond'); b = person('Bea Smith'); });

  test('a bulk nudge sends one rendered message each, through the governor', async () => {
    const out = await w.ok('POST', '/api/accountability/nudge?at=2026-11-24T12:00:00.000Z', { as: w.coach, body: { clientIds: [a.id, b.id], text: 'Hi {first}, one more push!', kind: 'nudge' } });
    assert.deepEqual(out, { sent: 2, deferred: 0, skipped: [] });
    const msgs = w.db.prepare("SELECT client_id, text, via FROM messages WHERE via='nudge' AND client_id IN (?,?) ORDER BY text").all(a.id, b.id);
    assert.deepEqual(msgs.map(m => m.text), ['Hi Amy, one more push!', 'Hi Bea, one more push!']);
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM accountability_nudges WHERE client_id IN (?,?)').get(a.id, b.id).n, 2);
    await w.settle();
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM events WHERE type='accountability.nudged' AND client_id IN (?,?)").get(a.id, b.id).n, 2);
  });

  test('quiet hours defer, paused clients are skipped, unknown variables and foreign ids refuse everything', async () => {
    const night = await w.ok('POST', '/api/accountability/nudge?at=2026-11-24T22:30:00.000Z', { as: w.coach, body: { clientIds: [a.id], text: 'Late {first}', kind: 'celebrate' } });
    assert.equal(night.deferred, 1);
    await w.ok('PUT', `/api/coach/clients/${b.id}/outreach`, { as: w.coach, body: { paused: true } });
    const paused = await w.ok('POST', '/api/accountability/nudge?at=2026-11-25T12:00:00.000Z', { as: w.coach, body: { clientIds: [b.id], text: 'Hello {first}' } });
    assert.deepEqual(paused.skipped, [{ clientId: b.id, reason: 'outreach paused' }]);
    const before = w.db.prepare("SELECT COUNT(*) n FROM messages WHERE via='nudge'").get().n;
    assert.equal((await w.call('POST', '/api/accountability/nudge', { as: w.coach, body: { clientIds: [a.id], text: 'Hi {nickname}' } })).status, 400);
    const stranger = await w.signIn('wp8-acc-coach2', 'coach2@example.com');
    const theirs = w.user('Their Client', 'client', stranger.id);
    assert.equal((await w.call('POST', '/api/accountability/nudge', { as: w.coach, body: { clientIds: [a.id, theirs.id], text: 'Hi' } })).status, 404);
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM messages WHERE via='nudge'").get().n, before, 'nothing sent');
    const p = await w.ok('POST', '/api/accountability/preview', { as: w.coach, body: { clientIds: [a.id], text: 'Go {first}' } });
    assert.equal(p.previews[0].text, 'Go Amy');
  });
});

describe('snapshots, isolation, reassignment, export and erasure', () => {
  let other;
  before(async () => { other = await w.signIn('wp8-acc-coach2', 'coach2@example.com'); });

  test('the Monday 05:00 clock snapshots last week once', async () => {
    const n1 = await w.tick('accountability.weekClose', new Date('2026-11-30T05:10:00.000Z'));
    assert.ok(n1 > 0);
    const n2 = await w.tick('accountability.weekClose', new Date('2026-11-30T05:25:00.000Z'));
    assert.equal(n2, 0);
    assert.ok(w.db.prepare("SELECT 1 FROM accountability_weeks WHERE week='2026-11-23'").get());
    assert.equal(await w.tick('accountability.weekClose', new Date('2026-12-07T04:30:00.000Z')), 0, 'before 05:00 the week is not closed');
  });

  test('every route is coach-only and own-only', async () => {
    const c = person('Isla Own');
    for (const [method, path, body] of [['GET', `/api/coach/clients/${c.id}/accountability`], ['POST', '/api/accountability/preview', { clientIds: [c.id], text: 'x' }],
      ['POST', '/api/accountability/nudge', { clientIds: [c.id], text: 'x' }]]) {
      assert.equal((await w.call(method, path, { as: other, body })).status, 404, `${method} ${path}`);
    }
    assert.ok(!(await w.ok('GET', '/api/accountability', { as: other })).rows.some(r => r.client.id === c.id));
    for (const [method, path, body] of [['GET', '/api/accountability'], ['GET', `/api/coach/clients/${c.id}/accountability`], ['POST', '/api/accountability/nudge', { clientIds: [c.id], text: 'x' }]]) {
      assert.equal((await w.call(method, path, { as: w.client, body })).status, 403);
    }
  });

  test('a reassigned client\'s history goes with them', async () => {
    const m = person('Milo Moved');
    w.db.prepare("INSERT INTO accountability_weeks (client_id, coach_id, week, score, parts) VALUES (?,?,?,?,?)").run(m.id, w.coach.id, '2026-11-16', 64, '{"c":0.5,"h":0.5,"t":1,"k":1}');
    w.db.prepare('INSERT INTO accountability_nudges (id, coach_id, client_id, week, kind, at) VALUES (?,?,?,?,?,?)').run(newId('an'), w.coach.id, m.id, '2026-11-16', 'nudge', at('2026-11-17'));
    w.db.prepare('UPDATE users SET coach_id=? WHERE id=?').run(other.id, m.id);
    assert.equal((await w.call('GET', `/api/coach/clients/${m.id}/accountability?at=${at('2026-11-24')}`, { as: w.coach })).status, 404);
    const h = await w.ok('GET', `/api/coach/clients/${m.id}/accountability?at=${at('2026-11-24')}`, { as: other });
    assert.equal(h.weeks.find(x => x.week === '2026-11-16').score, 64);
    const board = await w.ok('GET', `/api/accountability?week=2026-11-16&at=${at('2026-11-24')}`, { as: other });
    assert.ok(board.rows.find(r => r.client.id === m.id).lastNudgeAt);
  });

  test('the export carries the weeks and nudges; erasure leaves nothing', async () => {
    const leaver = await w.signIn('wp8-acc-leaver', 'acc-leaver@example.com', { givenName: 'Lou', familyName: 'Gone' });
    w.db.prepare("INSERT INTO accountability_weeks (client_id, coach_id, week, score, parts) VALUES (?,?,?,?,?)").run(leaver.id, w.coach.id, '2026-11-16', 71, '{}');
    await w.ok('POST', '/api/accountability/nudge?at=2026-11-24T12:00:00.000Z', { as: w.coach, body: { clientIds: [leaver.id], text: 'Hey {first}' } });
    const exp = await w.ok('GET', '/api/me/export', { as: leaver });
    assert.equal(exp.features.accountability.weeks[0].score, 71);
    assert.equal(exp.features.accountability.nudges.length, 1);
    await w.ok('DELETE', '/api/me', { as: leaver });
    assertNoRowsFor(w.db, leaver.id);
  });
});
