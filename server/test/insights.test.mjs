/**
 * F25 Engagement insights (docs/design/desk-v2.md, WP8): heatmap bucketing in
 * London time across BST, cohort maths, NPS maths, survey cadence idempotence,
 * the detractor notification, isolation (the demo world never reaches a real
 * coach), export and erasure.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { assertNoRowsFor, makeWorld } from './helpers.mjs';
import { buildDemo } from '../demo.mjs';
import { activeMonths, buildCohorts, heatCell, monthAdd, npsOf, periodOf } from '../features/insights.mjs';
import { newId } from '../store.mjs';
import { londonDay } from '../time.mjs';

let w;
before(async () => { w = await makeWorld(); });
after(() => w.close());

function person(name, { joined = '2026-01-05T09:00:00.000Z', plan = 'performance', coachId = w.coach.id } = {}) {
  const u = w.user(name, 'client', coachId);
  w.db.prepare('UPDATE users SET created_at=?, plan=? WHERE id=?').run(joined, plan, u.id);
  return { ...u, row: w.db.prepare('SELECT * FROM users WHERE id=?').get(u.id) };
}
const message = (clientId, atIso) => w.db.prepare("INSERT INTO messages (id, client_id, from_id, from_role, text, at) VALUES (?,?,?,'client','hi',?)").run(newId('m'), clientId, clientId, atIso);

describe('the heatmap', () => {
  test('buckets by London weekday and hour, across both BST changes', () => {
    assert.deepEqual(heatCell('2026-03-28T23:30:00.000Z'), [5, 23], 'Saturday 23:30 GMT');
    assert.deepEqual(heatCell('2026-03-29T00:30:00.000Z'), [6, 0], 'Sunday 00:30 GMT, before the clocks go forward');
    assert.deepEqual(heatCell('2026-03-29T01:30:00.000Z'), [6, 2], 'Sunday 02:30 BST');
    assert.deepEqual(heatCell('2026-07-01T18:30:00.000Z'), [2, 19], 'Wednesday 19:30 BST');
    assert.deepEqual(heatCell('2026-10-25T00:30:00.000Z'), [6, 1], 'Sunday 01:30 BST');
    assert.deepEqual(heatCell('2026-10-25T01:30:00.000Z'), [6, 1], 'Sunday 01:30 GMT, after the clocks go back');
    assert.deepEqual(heatCell('2026-11-30T23:59:00.000Z'), [0, 23], 'Monday 23:59 GMT');
  });

  test('the engagement endpoint counts activity in the right cell and day', async () => {
    const h = person('Hattie Heat');
    message(h.id, '2026-07-06T06:15:00.000Z'); // Monday 07:15 BST
    message(h.id, '2026-07-06T06:40:00.000Z');
    w.db.prepare(`INSERT INTO workouts (id, client_id, date, title, published, published_at, edited_at, edited_by, completed_at, created_by) VALUES (?,?,?,?,1,?,?,'coach',?,?)`)
      .run(newId('w'), h.id, '2026-07-07', 'Lower', '2026-07-07T05:00:00.000Z', '2026-07-07T05:00:00.000Z', '2026-07-07T17:05:00.000Z', w.coach.id); // Tue 18:05 BST
    const r = await w.ok('GET', '/api/insights/engagement?days=30&at=2026-07-10T12:00:00.000Z', { as: w.coach });
    assert.equal(r.heatmap.length, 7);
    assert.equal(r.heatmap[0].length, 24);
    assert.equal(r.heatmap[0][7], 2);
    assert.equal(r.heatmap[1][18], 1);
    assert.equal(r.daily.find(d => d.day === '2026-07-06').active, 1);
    assert.equal(r.mix.find(m => m.kind === 'message').n, 2);
    assert.equal(r.mix.find(m => m.kind === 'workout').n, 1);
    assert.ok(r.top.some(p => p.client.id === h.id && p.activeDays === 2));
    assert.equal(r.summary.peak.weekday, 'Mon');
    assert.equal(r.summary.peak.hour, 7);
    assert.ok(r.bands && r.bands.items.length);
  });
});

describe('cohorts', () => {
  test('the maths on a fixture', () => {
    const p = (joinMonth, ...active) => ({ joinMonth, active: new Set(active) });
    const out = buildCohorts([
      p('2026-01', '2026-01', '2026-02', '2026-03'),
      p('2026-01', '2026-01'),
      p('2026-02', '2026-02', '2026-03', '2026-04'),
      p('2026-04', '2026-04'),
      p('2026-05', '2026-05'),
    ], '2026-04');
    assert.deepEqual(out.cohorts.map(c => [c.month, c.size, c.retained]), [
      ['2026-01', 2, [100, 50, 50, 0]],
      ['2026-02', 1, [100, 100, 100]],
      ['2026-04', 1, [100]],
    ], 'a cohort joining after the current month is left out');
    // Lifetimes 3, 1, 3, 1 months.
    assert.equal(out.avgLifetimeMonths, 2);
    assert.deepEqual(out.survival.map(s => [s.month, s.pct, s.of]), [[0, 100, 4], [1, 66.7, 3], [2, 66.7, 3], [3, 0, 2]]);
  });

  test('active months: any activity, or a plan with activity in the last 30 days of the month', () => {
    const plan = day => (day < '2026-04-01' ? 'performance' : 'none');
    const months = activeMonths('2026-01-10', ['2026-01-30', '2026-04-02'], plan, '2026-05-15');
    assert.deepEqual([...months].sort(), ['2026-01', '2026-02', '2026-04'],
      'February counts by the plan rule (30 January is within 30 days of its end); March does not; nor May (no plan, nothing)');
    assert.deepEqual([...activeMonths('2026-01-10', ['2026-01-30'], () => 'none', '2026-03-15')], ['2026-01'], 'without a plan only real activity counts');
    assert.equal(monthAdd('2026-11', 3), '2027-02');
  });

  test('the endpoint groups the coach\'s clients by join month', async () => {
    const a = person('Cora Cohort', { joined: '2026-02-10T09:00:00.000Z' });
    message(a.id, '2026-02-12T10:00:00.000Z');
    message(a.id, '2026-03-12T10:00:00.000Z');
    const r = await w.ok('GET', '/api/insights/cohorts?months=12&at=2026-05-20T12:00:00.000Z', { as: w.coach });
    const feb = r.cohorts.find(c => c.month === '2026-02');
    assert.equal(feb.size, 1);
    assert.deepEqual(feb.retained.slice(0, 2), [100, 100]);
    assert.ok(r.survival.length >= 1);
  });
});

describe('NPS', () => {
  test('0–6 detractor, 7–8 passive, 9–10 promoter', () => {
    assert.deepEqual(npsOf([0, 6, 7, 8, 9, 10]), { nps: 0, promoters: 2, passives: 2, detractors: 2, responses: 6 });
    assert.equal(npsOf([9, 10, 10, 7]).nps, 75);
    assert.equal(npsOf([6, 6, 9]).nps, -33);
    assert.equal(npsOf([]).nps, null);
  });
});

describe('surveys', () => {
  let s1, s2, survey;
  before(async () => {
    s1 = person('Pia Pulse', { joined: '2026-01-05T09:00:00.000Z' });
    s2 = person('Dev Detractor', { joined: '2026-01-05T09:00:00.000Z' });
    survey = (await w.ok('POST', '/api/insights/surveys', { as: w.coach, body: { kind: 'nps', cadence: 'monthly', audience: { clientIds: [s1.id, s2.id] } } })).survey;
  });

  test('creating one makes the form; validation', async () => {
    assert.equal(survey.questions[0].label, 'How likely are you to recommend JK to a friend? (0–10)');
    assert.equal(survey.questions[1].kind, 'long');
    assert.equal((await w.call('POST', '/api/insights/surveys', { as: w.coach, body: { kind: 'pulse', cadence: 'monthly', questions: [] } })).status, 400);
    assert.equal((await w.call('POST', '/api/insights/surveys', { as: w.coach, body: { kind: 'nps', cadence: 'weekly' } })).status, 400);
    const pulse = (await w.ok('POST', '/api/insights/surveys', { as: w.coach, body: { kind: 'pulse', cadence: 'afterDays', afterDays: 30, questions: ['Energy?', 'Support?'] } })).survey;
    assert.deepEqual(pulse.questions.map(q => q.kind), ['scale', 'scale']);
    assert.equal(pulse.afterDays, 30);
    assert.equal(periodOf('quarterly', '2026-11-24'), '2026-Q4');
  });

  test('cadence: the 10:00 clock sends once a period, never twice', async () => {
    const sends = () => w.db.prepare('SELECT COUNT(*) n FROM form_requests WHERE form_id=?').get(survey.formId).n;
    await w.tick('insights.pulse', new Date('2026-11-24T09:55:00.000Z'));
    assert.equal(sends(), 0, 'not before 10:00');
    await w.tick('insights.pulse', new Date('2026-11-24T10:05:00.000Z'));
    assert.equal(sends(), 2);
    await w.tick('insights.pulse', new Date('2026-11-24T10:15:00.000Z'));
    await w.tick('insights.pulse', new Date('2026-11-28T10:15:00.000Z'));
    assert.equal(sends(), 2, 'once per month');
    await w.tick('insights.pulse', new Date('2026-12-01T10:15:00.000Z'));
    assert.equal(sends(), 4, 'again next month');
    await w.ok('PATCH', `/api/insights/surveys/${survey.id}`, { as: w.coach, body: { status: 'paused' } });
    await w.tick('insights.pulse', new Date('2027-01-02T10:15:00.000Z'));
    assert.equal(sends(), 4, 'paused sends nothing');
    await w.ok('PATCH', `/api/insights/surveys/${survey.id}`, { as: w.coach, body: { status: 'active' } });
    await w.settle();
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM events WHERE type='pulse.sent' AND payload LIKE ?").get(`%${survey.id}%`).n, 4);
  });

  test('afterDays sends when a client reaches the day, and new clients skip recurring surveys for two weeks', async () => {
    const fresh = person('Nia New', { joined: '2026-11-20T09:00:00.000Z' });
    const after = (await w.ok('POST', '/api/insights/surveys?at=2026-11-20T09:00:00.000Z', { as: w.coach, body: { kind: 'pulse', cadence: 'afterDays', afterDays: 10, questions: ['How is it going?'], audience: { clientIds: [fresh.id, s1.id] } } })).survey;
    const n = () => w.db.prepare('SELECT COUNT(*) n FROM form_requests WHERE form_id=? AND client_id=?').get(after.formId, fresh.id).n;
    const old = () => w.db.prepare('SELECT COUNT(*) n FROM form_requests WHERE form_id=? AND client_id=?').get(after.formId, s1.id).n;
    await w.tick('insights.pulse', new Date('2026-11-29T10:30:00.000Z'));
    assert.equal(n(), 0);
    await w.tick('insights.pulse', new Date('2026-11-30T10:30:00.000Z'));
    await w.tick('insights.pulse', new Date('2026-12-30T10:30:00.000Z'));
    assert.equal(n(), 1, 'once, on day 10');
    assert.equal(old(), 0, 'a long-standing client is not swept up');
  });

  test('a detractor notifies the coach (urgent); a promoter does not', async () => {
    const reqOf = c => w.db.prepare('SELECT id FROM form_requests WHERE form_id=? AND client_id=? AND submitted_at IS NULL').get(survey.formId, c.id).id;
    await w.ok('POST', `/api/form-requests/${reqOf(s2)}/answers`, { as: s2, body: { answers: { nps: '4', why: 'Hard to get an evening slot.' } } });
    await w.ok('POST', `/api/form-requests/${reqOf(s1)}/answers`, { as: s1, body: { answers: { nps: '10' } } });
    await w.settle();
    const notes = w.db.prepare("SELECT * FROM coach_notifications WHERE kind='detractor'").all();
    assert.equal(notes.length, 1);
    assert.equal(notes[0].tone, 'urgent');
    assert.equal(notes[0].client_id, s2.id);
    assert.match(notes[0].title, /Dev scored 4\/10/);
    const answered = w.db.prepare("SELECT payload FROM events WHERE type='pulse.answered'").all().map(e => JSON.parse(e.payload));
    assert.deepEqual(answered.map(p => p.score).sort(), [10, 4].sort());
    const nps = await w.ok('GET', `/api/insights/nps?at=${new Date().toISOString()}`, { as: w.coach });
    assert.equal(nps.responses, 2);
    assert.equal(nps.nps, 0);
    assert.equal(nps.comments[0].text, 'Hard to get an evening slot.');
    assert.equal(nps.comments[0].category, 'detractor');
  });
});

describe('isolation, the demo world, export and erasure', () => {
  let other;
  before(async () => { other = await w.signIn('wp8-ins-coach2', 'coach2@example.com'); });

  test('survey routes are 404 across coaches; a client gets 403', async () => {
    const s = (await w.ok('POST', '/api/insights/surveys', { as: w.coach, body: { kind: 'nps', cadence: 'once' } })).survey;
    for (const [method, path, body] of [['PATCH', `/api/insights/surveys/${s.id}`, { status: 'paused' }], ['DELETE', `/api/insights/surveys/${s.id}`], ['POST', `/api/insights/surveys/${s.id}/send`, {}]]) {
      assert.equal((await w.call(method, path, { as: other, body })).status, 404, `${method} ${path}`);
    }
    assert.ok(!(await w.ok('GET', '/api/insights/surveys', { as: other })).surveys.some(x => x.id === s.id));
    const mine = person('Own Only');
    assert.equal((await w.call('POST', '/api/insights/surveys', { as: other, body: { kind: 'nps', cadence: 'once', audience: { clientIds: [mine.id] } } })).status, 404);
    for (const path of ['/api/insights/engagement', '/api/insights/cohorts', '/api/insights/nps', '/api/insights/surveys']) {
      assert.equal((await w.call('GET', path, { as: w.client })).status, 403, path);
    }
    await w.ok('DELETE', `/api/insights/surveys/${s.id}`, { as: w.coach });
  });

  test('the demo world never reaches a real coach\'s numbers', async () => {
    buildDemo(w.db, londonDay(), w.config);
    const demoCoach = w.db.prepare("SELECT id FROM users WHERE apple_sub='demo-coach'").get();
    assert.ok(w.db.prepare('SELECT COUNT(*) n FROM pulse_surveys WHERE coach_id=?').get(demoCoach.id).n >= 2, 'the demo has surveys');
    const mineIds = new Set(w.db.prepare("SELECT id FROM users WHERE role='client' AND coach_id=?").all(w.coach.id).map(r => r.id));
    const e = await w.ok('GET', '/api/insights/engagement?days=365', { as: w.coach });
    assert.ok([...e.top, ...e.quiet].every(p => mineIds.has(p.client.id)));
    const n = await w.ok('GET', '/api/insights/nps', { as: w.coach });
    assert.ok(n.comments.every(c => mineIds.has(c.client.id)));
    const c = await w.ok('GET', '/api/insights/cohorts', { as: w.coach });
    assert.ok(c.cohorts.reduce((s, x) => s + x.size, 0) <= mineIds.size);
    const o = await w.ok('GET', '/api/insights/engagement', { as: other });
    assert.equal(o.summary.clients, 0);
  });

  test('a demo rebuild gives at least six cohorts and an NPS near +45', async () => {
    const token = w.db.prepare("SELECT id FROM users WHERE apple_sub='demo-coach'").get().id;
    const { issueSession } = await import('../auth.mjs');
    const as = { token: issueSession(w.db, token) };
    const c = await w.ok('GET', '/api/insights/cohorts', { as });
    assert.ok(c.cohorts.length >= 6, `${c.cohorts.length} cohorts`);
    const n = await w.ok('GET', '/api/insights/nps', { as });
    assert.ok(n.responses >= 12 && n.nps >= 30 && n.nps <= 60, JSON.stringify({ r: n.responses, nps: n.nps }));
    assert.ok(n.comments.length >= 4);
  });

  test('the export lists the surveys sent; erasure leaves nothing', async () => {
    const leaver = await w.signIn('wp8-ins-leaver', 'ins-leaver@example.com', { givenName: 'Lyn', familyName: 'Left' });
    w.db.prepare('UPDATE users SET created_at=? WHERE id=?').run('2026-01-05T09:00:00.000Z', leaver.id);
    const s = (await w.ok('POST', '/api/insights/surveys', { as: w.coach, body: { kind: 'nps', cadence: 'once', audience: { clientIds: [leaver.id] } } })).survey;
    const sent = await w.ok('POST', `/api/insights/surveys/${s.id}/send`, { as: w.coach, body: {} });
    assert.equal(sent.sent, 1);
    const again = await w.ok('POST', `/api/insights/surveys/${s.id}/send`, { as: w.coach, body: {} });
    assert.equal(again.sent, 0, 'once is once');
    const exp = await w.ok('GET', '/api/me/export', { as: leaver });
    assert.equal(exp.features.insights.surveys.length, 1);
    await w.ok('DELETE', '/api/me', { as: leaver });
    assertNoRowsFor(w.db, leaver.id);
  });
});
