import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app.mjs';
import { issueSession } from '../auth.mjs';
import { seedCatalogue } from '../catalogue.mjs';
import { buildDemo } from '../demo.mjs';
import { feedbackWeek } from '../reports.mjs';
import { newId, nowIso, openStore } from '../store.mjs';
import { addDays, londonDay, londonToUtc, mondayOf, weekday } from '../time.mjs';

// Plan. Act. Review. (docs/design/plan-act-review.md): the client's three tabs,
// the coach's editors, booking purpose, item tempo and the additive migrations.

const sent = [];
let server, base, db, demoCoach, sam, coach, other, elite, free, stranger;
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
const today = londonDay();
const week = feedbackWeek(today);

/** A plain (not demo) user with a session; clients get the coach and plan given. */
function user(name, role, { coachId = null, plan = 'none' } = {}) {
  const id = newId('u');
  db.prepare('INSERT INTO users (id, apple_sub, name, role, coach_id, plan, created_at, onboarded_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, `t-${id}`, name, role, coachId, plan, nowIso(), nowIso());
  return { id, token: issueSession(db, id) };
}

/** The next weekday (Monday to Friday) at least two days out, so a default 07:00-19:00 slot is open. */
function slotDay() {
  for (let d = addDays(today, 2); ; d = addDays(d, 1)) if (weekday(d) <= 5) return d;
}

before(async () => {
  db = openStore(':memory:');
  seedCatalogue(db);
  buildDemo(db);
  server = createApp(db, {
    dataDir: mkdtempSync(join(tmpdir(), 'jk-par-')), appleAudience: 'com.jkperformance.app', coachEmails: [], primaryCoachEmail: null,
    supportEmail: 's@example.com', publicUrl: 'https://jk.example.com', gateServices: false, payments: false,
    demoCode: 'demo-client-code', demoCoachCode: 'demo-coach-code', fetchImpl: fetch,
    pushTransport: (device, payload) => { sent.push({ device, payload }); return { status: 200 }; },
    googleClientIds: [], appleServicesId: null,
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  demoCoach = (await call('POST', '/api/auth/code', { body: { code: 'demo-coach-code' } })).body.token;
  sam = (await call('POST', '/api/auth/code', { body: { code: 'demo-client-code' } })).body.token;
  coach = user('Coach One', 'coach');
  other = user('Coach Two', 'coach');
  elite = user('Ella Elite', 'client', { coachId: coach.id, plan: 'elite' });
  free = user('Fran Free', 'client', { coachId: coach.id, plan: 'none' });
  stranger = user('Sid Stranger', 'client', { coachId: other.id, plan: 'elite' });
  db.prepare("INSERT INTO push_tokens (token, user_id, env, created_at, updated_at) VALUES (?,?,'production',?,?)").run('d'.repeat(64), coach.id, nowIso(), nowIso());
});
after(() => server.close());

describe('migrations', () => {
  test('an old database gains the new columns and tables, keeps its rows, and reopens cleanly', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'jk-par-mig-')), 'old.sqlite');
    let d = openStore(file);
    // Make it look like the release before Plan. Act. Review.
    d.exec(`DROP TABLE priorities; DROP TABLE preps; DROP TABLE commitments; DROP TABLE reflection_drafts;
      ALTER TABLE bookings DROP COLUMN purpose; ALTER TABLE goals DROP COLUMN aim; ALTER TABLE goals DROP COLUMN planned_on;
      ALTER TABLE checkins DROP COLUMN feeling; ALTER TABLE checkins DROP COLUMN noticed; ALTER TABLE workout_items DROP COLUMN tempo;`);
    d.prepare("INSERT INTO users (id, name, role, created_at) VALUES ('u1', 'Old Client', 'client', ?)").run(nowIso());
    d.prepare("INSERT INTO checkins (id, client_id, week, energy, sleep, pain, note, submitted_at) VALUES ('c1', 'u1', '2026-11-02', 4, 3, '[]', 'Fine', ?)").run(nowIso());
    d.close();
    for (let i = 0; i < 2; i++) {
      d = openStore(file);
      const cols = t => d.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
      assert.ok(cols('bookings').includes('purpose'));
      assert.ok(['aim', 'planned_on'].every(c => cols('goals').includes(c)));
      assert.ok(['feeling', 'noticed'].every(c => cols('checkins').includes(c)));
      assert.ok(cols('workout_items').includes('tempo'));
      for (const t of ['priorities', 'preps', 'commitments', 'reflection_drafts']) assert.ok(cols(t).length, t);
      const c = d.prepare("SELECT * FROM checkins WHERE id='c1'").get();
      assert.equal(c.energy, 4);
      assert.equal(c.feeling, null);
      d.close();
    }
  });
});

describe('client endpoints', () => {
  test('GET /api/week reads like the board for the demo client', async () => {
    const w = await ok('GET', '/api/week', { token: sam });
    assert.equal(w.date, today);
    assert.equal(w.firstName, 'Sam');
    assert.match(w.dateLabel, /^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+$/);
    assert.match(w.greeting, /^Good (morning|afternoon|evening)$/);
    assert.equal(w.days.length, 7);
    assert.deepEqual(w.days.map(d => d.letter), ['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    assert.equal(w.days.filter(d => d.today).length, 1);
    assert.equal(w.days.find(d => d.today).mark, 'today');
    assert.equal(w.today.title, 'Lower body strength, and three habits.');
    assert.equal(w.today.workout.title, 'Lower body strength');
    assert.deepEqual(w.today.workout.blocks.map(b => b.label), ['Warm', 'Squat', 'Hinge', 'Carry', 'Ease']);
    assert.equal(w.today.workout.blocks[0].done, true);
    assert.equal(w.today.workout.minutes, 45);
    assert.deepEqual(w.today.habits.map(h => h.name), ['Protein at every meal', 'A walk after lunch', 'Lights out by eleven']);
    assert.equal(w.today.habits[1].doneToday, true);
    assert.equal(w.today.habits[1].progress, 1);
    for (const h of w.today.habits) assert.equal(h.week.length, 7);
    assert.ok(w.today.progress > 0 && w.today.progress < 1);
    assert.equal(w.today.restDay, false);
    assert.match(w.plan.title, /^Plan [A-Z][a-z]+ with JK$/);
    assert.match(w.plan.when, /^(Today|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[^,]*, 7:30am$/);
    assert.equal(w.review.title, 'Accountability with JK');
    assert.match(w.review.when, /, 6pm$/);
    assert.match(w.footer, /^Planning with JK (today|tomorrow|on .+)$/);
    if (w.plan.dayIndex !== null && !w.days[w.plan.dayIndex].today) assert.equal(w.days[w.plan.dayIndex].mark, 'plan');
  });

  test('GET /api/week on a free plan: no workout or habits, never a 403; a coach may preview their own client', async () => {
    const w = await ok('GET', '/api/week', { token: free.token });
    assert.equal(w.today.workout, null);
    assert.deepEqual(w.today.habits, []);
    assert.equal(w.today.restDay, true);
    assert.equal(w.plan, null);
    assert.equal(w.footer, null);
    const preview = await ok('GET', `/api/week?clientId=${elite.id}`, { token: coach.token });
    assert.equal(preview.firstName, 'Ella');
    assert.equal((await call('GET', `/api/week?clientId=${stranger.id}`, { token: coach.token })).status, 404);
    assert.equal((await call('GET', '/api/week', { token: coach.token })).status, 400);
  });

  test('direction and review are locked (200, not 403) without progress and checkin', async () => {
    assert.deepEqual(await ok('GET', '/api/direction', { token: free.token }), { locked: true, feature: 'progress' });
    assert.deepEqual(await ok('GET', '/api/review', { token: free.token }), { locked: true, feature: 'checkin' });
    assert.deepEqual(await ok('PUT', '/api/direction/prep', { token: free.token, body: { feeling: 50 } }), { locked: true, feature: 'progress' });
    assert.deepEqual(await ok('POST', '/api/review/reflection', { token: free.token, body: { feeling: 3 } }), { locked: true, feature: 'checkin' });
    assert.deepEqual(await ok('POST', '/api/review/accept', { token: free.token, body: { week } }), { locked: true, feature: 'checkin' });
    // Foundation has progress but no check-in.
    db.prepare("UPDATE users SET plan='foundation' WHERE id=?").run(free.id);
    assert.equal((await ok('GET', '/api/direction', { token: free.token })).locked, false);
    assert.equal((await ok('GET', '/api/review', { token: free.token })).locked, true);
    db.prepare("UPDATE users SET plan='none' WHERE id=?").run(free.id);
  });

  test('GET /api/direction for the demo client: aim, season, priorities, Thursday and the prep draft', async () => {
    const d = await ok('GET', '/api/direction', { token: sam });
    assert.equal(d.aim, 'Get strong enough that the hills stop mattering.');
    assert.equal(d.plannedOn, addDays(today, -19));
    assert.match(d.plannedLabel, /^Planned together with JK, \d{1,2} [A-Z][a-z]+$/);
    assert.equal(d.season.start, d.plannedOn);
    assert.equal(d.season.today, today);
    assert.equal(d.season.phaseWord, 'early days, building');
    assert.deepEqual(d.priorities.map(p => [p.title, p.statusWord, p.progress]), [['Strength', 'Building', 0.66], ['Sleep', 'Settling in', 0.33], ['Joyful runs', 'Not yet', 0]]);
    assert.match(d.planning.when, /, 7:30am$/);
    assert.deepEqual([d.prep.feeling, d.prep.feelingWord, d.prep.inTheWay, d.prep.sharedAt], [70, 'Mostly good', 'Late nights at work midweek', null]);
  });

  test('GET /api/review for the demo client: last week rated, Sunday\'s notes, the shape of the month, agreed and pending', async () => {
    const r = await ok('GET', '/api/review', { token: sam });
    assert.equal(r.week, week);
    assert.equal(r.label, 'REVIEW · BEFORE YOUR SESSION');
    assert.deepEqual(r.commitments.map(c => [c.text, c.outcome]), [['Three sessions', 'kept'], ['Lights out by eleven', 'mostly'], ['A run for joy', 'missed']]);
    assert.equal(r.reflection.feelingWord, 'Steady');
    assert.equal(r.session.pending, true);
    assert.match(r.session.with, /^With JK · .+, 6pm$/);
    assert.equal(r.session.notes, 'Steady is exactly right, Sam. You spotted the link between the walk and your sleep yourself. The run slipped again, so we\'ve made it smaller.');
    assert.deepEqual(r.session.shape.weeks.map(w => w.word), ['Flat', 'Stretched', 'Steady', 'Steady']);
    assert.equal(r.session.shape.trend, 'trending steadier');
    assert.deepEqual(r.session.agreed.map(c => c.text), ['Walk after lunch, every weekday', 'Twenty minute run, any pace']);
    assert.equal(r.session.agreedWeek, addDays(week, 7));
    assert.equal(r.session.acceptedAt, null);
  });
});

describe('prep, reflection and accept', () => {
  let planningId;
  test('the coach books a planning session with a purpose and can change it', async () => {
    const d = slotDay();
    const bad = await call('POST', '/api/bookings', { token: coach.token, body: { clientId: elite.id, kind: 'inperson', start: londonToUtc(d, '07:00').toISOString(), purpose: 'party' } });
    assert.equal(bad.status, 400);
    const b = await ok('POST', '/api/bookings', { token: coach.token, body: { clientId: elite.id, kind: 'inperson', start: londonToUtc(d, '07:00').toISOString(), purpose: 'review' } });
    assert.equal(b.purpose, 'review');
    planningId = b.id;
    // PATCH changes the purpose and leaves the meeting link alone.
    await ok('PATCH', `/api/bookings/${b.id}`, { token: coach.token, body: { meetingUrl: 'https://meet.example.com/x' } });
    const p = await ok('PATCH', `/api/bookings/${b.id}`, { token: coach.token, body: { purpose: 'planning' } });
    assert.equal(p.purpose, 'planning');
    assert.equal(db.prepare('SELECT meeting_url FROM bookings WHERE id=?').get(b.id).meeting_url, 'https://meet.example.com/x');
    assert.equal((await call('PATCH', `/api/bookings/${b.id}`, { token: coach.token, body: { purpose: 'nope' } })).status, 400);
    assert.equal((await call('PATCH', `/api/bookings/${b.id}`, { token: other.token, body: { purpose: null } })).status, 404);
    assert.equal((await call('PATCH', `/api/bookings/${b.id}`, { token: elite.token, body: { purpose: null } })).status, 403);
    const list = await ok('GET', `/api/bookings?from=${d}&to=${d}`, { token: elite.token });
    assert.equal(list.bookings.find(x => x.id === b.id).purpose, 'planning');
    const w = await ok('GET', '/api/week', { token: elite.token });
    assert.equal(w.plan.bookingId, b.id);
    assert.match(w.footer, /^Planning with JK /);
  });

  test('the client prepares: autosaves merge, share hands it to JK and shows in Needs you until he reads it', async () => {
    // A goal, so direction has an aim to fall back to.
    await ok('POST', '/api/goals', { token: coach.token, body: { clientId: elite.id, title: 'Run a 10k', metric: 'custom', status: 'active', targetDate: addDays(today, 60) } });
    let d = await ok('GET', '/api/direction', { token: elite.token });
    assert.equal(d.aim, 'Run a 10k', 'the aim falls back to the goal title');
    assert.equal(d.prep, null);
    assert.equal(d.planning.bookingId, planningId);
    const p1 = await ok('PUT', '/api/direction/prep', { token: elite.token, body: { feeling: 15 } });
    assert.equal(p1.feelingWord, 'Hard going');
    const p2 = await ok('PUT', '/api/direction/prep', { token: elite.token, body: { easier: 'Mornings', inTheWay: 'Work' } });
    assert.deepEqual([p2.id, p2.feeling, p2.easier, p2.inTheWay, p2.sharedAt], [p1.id, 15, 'Mornings', 'Work', null]);
    assert.equal((await call('PUT', '/api/direction/prep', { token: elite.token, body: { feeling: 101 } })).status, 400);
    assert.equal((await call('PUT', '/api/direction/prep', { token: coach.token, body: { feeling: 1 } })).status, 403);
    assert.equal(db.prepare('SELECT booking_id FROM preps WHERE id=?').get(p1.id).booking_id, planningId);
    let needs = await ok('GET', '/api/coach/needs-you', { token: coach.token });
    assert.ok(!needs.items.some(i => i.client.id === elite.id && i.reasons.some(r => r.kind === 'prepShared')), 'a draft is not handed over');
    const shared = await ok('PUT', '/api/direction/prep', { token: elite.token, body: { feeling: 85, share: true } });
    assert.ok(shared.sharedAt);
    assert.equal(shared.feelingWord, 'Flowing');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE client_id=? AND from_role='client'").get(elite.id).n, 0, 'nothing posted to the thread');
    needs = await ok('GET', '/api/coach/needs-you', { token: coach.token });
    const item = needs.items.find(i => i.client.id === elite.id);
    assert.ok(item.reasons.some(r => r.kind === 'prepShared' && r.text === 'Shared thoughts for planning'));
    const par = await ok('GET', `/api/coach/clients/${elite.id}/par`, { token: coach.token });
    assert.equal(par.prep.feeling, 85);
    assert.equal(par.planning.bookingId, planningId);
    needs = await ok('GET', '/api/coach/needs-you', { token: coach.token });
    assert.ok(!needs.items.some(i => i.client.id === elite.id && i.reasons.some(r => r.kind === 'prepShared')), 'seen once JK opened it');
    d = await ok('GET', '/api/direction', { token: elite.token });
    assert.equal(d.prep.id, p1.id);
  });

  test('the coach sets the aim, priorities and commitments; only for their own clients', async () => {
    assert.equal((await call('PUT', `/api/coach/clients/${free.id}/aim`, { token: coach.token, body: { aim: 'x' } })).status, 404, 'no active goal');
    assert.equal((await call('PUT', `/api/coach/clients/${elite.id}/aim`, { token: other.token, body: { aim: 'x' } })).status, 404);
    assert.equal((await call('PUT', `/api/coach/clients/${elite.id}/aim`, { token: elite.token, body: { aim: 'x' } })).status, 403);
    assert.equal((await call('GET', `/api/coach/clients/${elite.id}/par`, { token: elite.token })).status, 403);
    assert.equal((await call('PUT', `/api/coach/clients/${elite.id}/aim`, { token: coach.token, body: { aim: 'x'.repeat(141) } })).status, 400);
    const plannedOn = addDays(today, -3);
    let par = await ok('PUT', `/api/coach/clients/${elite.id}/aim`, { token: coach.token, body: { aim: 'Run without thinking about it.', plannedOn } });
    assert.equal(par.aim, 'Run without thinking about it.');
    const d = await ok('GET', '/api/direction', { token: elite.token });
    assert.equal(d.plannedOn, plannedOn);
    assert.equal(d.season.start, plannedOn);

    assert.equal((await call('PUT', `/api/coach/clients/${elite.id}/priorities`, { token: coach.token, body: { priorities: [1, 2, 3, 4].map(i => ({ title: `P${i}`, status: 'notyet' })) } })).status, 400);
    assert.equal((await call('PUT', `/api/coach/clients/${elite.id}/priorities`, { token: coach.token, body: { priorities: [{ title: 'Pace', status: 'fast' }] } })).status, 400);
    par = await ok('PUT', `/api/coach/clients/${elite.id}/priorities`, { token: coach.token, body: { priorities: [{ title: 'Pace', status: 'settling' }, { title: 'Sleep', status: 'strong' }] } });
    const paceId = par.priorities[0].id;
    par = await ok('PUT', `/api/coach/clients/${elite.id}/priorities`, { token: coach.token, body: { priorities: [{ title: 'Pace', status: 'building' }] } });
    assert.deepEqual(par.priorities.map(p => [p.id, p.title, p.statusWord]), [[paceId, 'Pace', 'Building']]);
    assert.equal((await call('PUT', `/api/coach/clients/${stranger.id}/priorities`, { token: coach.token, body: { priorities: [] } })).status, 404);

    assert.equal((await call('PUT', `/api/coach/clients/${elite.id}/commitments`, { token: coach.token, body: { week: addDays(week, 1), items: [] } })).status, 400, 'a Monday');
    par = await ok('PUT', `/api/coach/clients/${elite.id}/commitments`, { token: coach.token, body: { week, items: ['Two runs', 'Bed by ten'] } });
    assert.deepEqual(par.commitments.current.map(c => c.text), ['Two runs', 'Bed by ten']);
    assert.equal(par.commitments.currentWeek, week);
    await ok('PUT', `/api/coach/clients/${elite.id}/commitments`, { token: coach.token, body: { week: addDays(week, 7), items: ['Three runs'] } });
  });

  test('the client looks back: drafts stay private, outcomes save, share files the check-in and tells JK', async () => {
    let r = await ok('GET', '/api/review', { token: elite.token });
    assert.equal(r.reflection, null);
    assert.equal(r.label, 'REVIEW · THIS WEEK');
    const [runs, bed] = r.commitments;
    r = await ok('POST', '/api/review/reflection', { token: elite.token, body: { feeling: 4, outcomes: { [runs.id]: 'kept' } } });
    assert.deepEqual([r.reflection.feeling, r.reflection.feelingWord, r.reflection.sharedAt], [4, 'Good', null]);
    assert.equal(r.commitments[0].outcome, 'kept');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM checkins WHERE client_id=?').get(elite.id).n, 0, 'a draft is not a check-in');
    r = await ok('POST', '/api/review/reflection', { token: elite.token, body: { noticed: 'Runs felt easy', outcomes: { [bed.id]: 'mostly', [runs.id]: null } } });
    assert.deepEqual([r.reflection.feeling, r.reflection.noticed, r.commitments[0].outcome, r.commitments[1].outcome], [4, 'Runs felt easy', null, 'mostly']);
    assert.equal((await call('POST', '/api/review/reflection', { token: elite.token, body: { feeling: 6 } })).status, 400);
    assert.equal((await call('POST', '/api/review/reflection', { token: elite.token, body: { outcomes: { [bed.id]: 'great' } } })).status, 400);
    assert.equal((await call('POST', '/api/review/reflection', { token: coach.token, body: { feeling: 3 } })).status, 403);
    // Another client's commitment is not theirs to rate.
    const theirs = newId('cm');
    db.prepare('INSERT INTO commitments (id, client_id, week, position, text, created_at, updated_at) VALUES (?,?,?,0,?,?,?)').run(theirs, stranger.id, week, 'Theirs', nowIso(), nowIso());
    assert.equal((await call('POST', '/api/review/reflection', { token: elite.token, body: { outcomes: { [theirs]: 'kept' } } })).status, 404);
    assert.equal(db.prepare('SELECT outcome FROM commitments WHERE id=?').get(theirs).outcome, null);

    sent.length = 0;
    r = await ok('POST', '/api/review/reflection', { token: elite.token, body: { share: true } });
    assert.ok(r.reflection.sharedAt);
    const c = db.prepare('SELECT * FROM checkins WHERE client_id=? AND week=?').get(elite.id, week);
    assert.deepEqual([c.feeling, c.energy, c.sleep, c.pain, c.note, c.noticed], [4, 4, 4, '[]', 'Runs felt easy', 'Runs felt easy']);
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].payload.kind, 'checkin');
    assert.equal(sent[0].payload.aps.alert.body, 'Sent their weekly check-in.');
    // Every coach view still reads it as a check-in.
    const list = await ok('GET', `/api/checkins?clientId=${elite.id}`, { token: coach.token });
    assert.equal(list.checkins[0].energy, 4);
    const needs = await ok('GET', '/api/coach/needs-you', { token: coach.token });
    assert.ok(needs.items.find(i => i.client.id === elite.id).reasons.some(x => x.kind === 'checkinLetterDue'));
    const par = await ok('GET', `/api/coach/clients/${elite.id}/par`, { token: coach.token });
    assert.deepEqual([par.reflection.feelingWord, par.reflection.noticed], ['Good', 'Runs felt easy']);

    // An edit after sharing stays a draft until shared again.
    r = await ok('POST', '/api/review/reflection', { token: elite.token, body: { feeling: 2 } });
    assert.equal(r.reflection.feeling, 2);
    assert.equal(db.prepare('SELECT feeling FROM checkins WHERE id=?').get(c.id).feeling, 4);
    r = await ok('POST', '/api/review/reflection', { token: elite.token, body: { share: true } });
    assert.equal(db.prepare('SELECT feeling FROM checkins WHERE id=?').get(c.id).feeling, 2);
    await settle();
    assert.equal(sent.at(-1).payload.aps.alert.body, 'Updated their weekly check-in.');
  });

  test('JK changes the agreed list: unchanged texts keep outcomes; "I\'m in" accepts the week', async () => {
    let par = await ok('PUT', `/api/coach/clients/${elite.id}/commitments`, { token: coach.token, body: { week, items: ['Bed by ten', 'One long run'] } });
    assert.deepEqual(par.commitments.current.map(c => [c.text, c.outcome]), [['Bed by ten', 'mostly'], ['One long run', null]]);
    let r = await ok('GET', '/api/review', { token: elite.token });
    assert.equal(r.session.pending, true);
    assert.deepEqual(r.session.agreed.map(c => c.text), ['Three runs']);
    assert.equal((await call('POST', '/api/review/accept', { token: elite.token, body: { week: addDays(week, 8) } })).status, 400);
    r = await ok('POST', '/api/review/accept', { token: elite.token, body: { week: addDays(week, 7) } });
    assert.equal(r.session.pending, false);
    assert.ok(r.session.acceptedAt);
    par = await ok('GET', `/api/coach/clients/${elite.id}/par`, { token: coach.token });
    assert.ok(par.commitments.next[0].acceptedAt);
    // Rewording an accepted commitment asks again.
    par = await ok('PUT', `/api/coach/clients/${elite.id}/commitments`, { token: coach.token, body: { week: addDays(week, 7), items: ['Three runs', 'Stretch daily'] } });
    assert.deepEqual(par.commitments.next.map(c => !!c.acceptedAt), [true, false]);
    assert.equal((await ok('GET', '/api/review', { token: elite.token })).session.pending, true);
    assert.equal((await call('POST', '/api/review/accept', { token: demoCoach, body: { week } })).status, 403);
  });
});

describe('workout item tempo', () => {
  test('tempo is written and read on workouts and programs, checked, and kept by writers that leave it out', async () => {
    const item = { exerciseId: 'ex_goblet-squat', sets: 3, reps: '8', load: '20 kg', note: 'Breathe', tempo: '3-1-1' };
    assert.equal((await call('POST', '/api/workouts', { token: coach.token, body: { clientId: elite.id, date: today, title: 'Legs', items: [{ ...item, tempo: 'slow' }] } })).status, 400);
    let w = await ok('POST', '/api/workouts', { token: coach.token, body: { clientId: elite.id, date: today, title: 'Legs', items: [item, { ...item, exerciseId: 'ex_romanian-deadlift', tempo: '' }] } });
    assert.deepEqual(w.items.map(i => i.tempo), ['3-1-1', null]);
    const { tempo: _t, ...noTempo } = item;
    w = await ok('PUT', `/api/workouts/${w.id}`, { token: coach.token, body: { date: today, title: 'Legs', items: [{ ...noTempo, id: w.items[0].id }, { ...noTempo, id: w.items[1].id, tempo: '2-0-1-0' }] } });
    assert.deepEqual(w.items.map(i => i.tempo), ['3-1-1', '2-0-1-0']);
    const p = await ok('POST', '/api/programs', { token: coach.token, body: { name: 'Tempo block', workouts: [{ dayOffset: 0, title: 'A', items: [item, noTempo] }] } });
    assert.deepEqual(p.workouts[0].items.map(i => i.tempo), ['3-1-1', null]);
    const laid = await ok('POST', `/api/programs/${p.id}/assign`, { token: coach.token, body: { clientId: elite.id, startDate: addDays(today, 30) } });
    assert.equal(laid.created, 1);
    const wid = db.prepare('SELECT id FROM workouts WHERE client_id=? AND date=?').get(elite.id, addDays(today, 30)).id;
    assert.deepEqual((await ok('GET', `/api/workouts/${wid}`, { token: coach.token })).items.map(i => i.tempo), ['3-1-1', null]);
    // The demo cue and tempo are on Sam's goblet squat.
    const sw = await ok('GET', '/api/week', { token: sam });
    const goblet = (await ok('GET', `/api/workouts/${sw.today.workout.id}`, { token: sam })).items[1];
    assert.deepEqual([goblet.exercise.name, goblet.tempo, goblet.note], ['Goblet Squat', '3-1-1', 'Sit into the bottom and breathe before you stand.']);
  });
});

describe('the week across the days', () => {
  test('days mark planning and review sessions this week; footer falls back to the review', async () => {
    const monday = mondayOf(today);
    const later = addDays(monday, 6) > today ? addDays(monday, 6) : null;
    if (!later) return; // Sunday: nothing later this week to mark
    const c = user('Rae Review', 'client', { coachId: coach.id, plan: 'performance' });
    db.prepare("INSERT INTO bookings (id, coach_id, client_id, kind, start, end, location, title, created_at, purpose) VALUES (?,?,?,'video',?,?,'','Weekly check with JK',?,'review')")
      .run(newId('b'), coach.id, c.id, londonToUtc(later, '18:00').toISOString(), londonToUtc(later, '19:00').toISOString(), nowIso());
    const w = await ok('GET', '/api/week', { token: c.token });
    assert.equal(w.days[6].mark, 'review');
    assert.equal(w.review.title, 'Weekly check with JK', 'a title the coach wrote is kept');
    assert.equal(w.review.dayIndex, 6);
    assert.equal(w.plan, null);
    assert.match(w.footer, /^Reviewing with JK /);
    const r = await ok('GET', '/api/review', { token: c.token });
    assert.equal(r.label, 'REVIEW · BEFORE YOUR SESSION');
    assert.equal(r.session, null);
  });
});
