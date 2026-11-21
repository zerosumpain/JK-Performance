import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app.mjs';
import { seedCatalogue } from '../catalogue.mjs';
import { openStore } from '../store.mjs';
import { seedDemo } from '../demo.mjs';
import { addDays, londonDay, londonToUtc, mondayOf } from '../time.mjs';

// A stand-in for Apple: our own RSA key, served as Apple's JWKS.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256', use: 'sig' };
const fetchImpl = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function appleToken(claims, { kid = 'test-kid', key = privateKey } = {}) {
  const head = b64({ alg: 'RS256', kid }), body = b64({ iss: 'https://appleid.apple.com', aud: 'com.jkperformance.app', exp: Math.floor(Date.now() / 1000) + 600, ...claims });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}

let server, base, db, dataDir;
const config = { dataDir: '', appleAudience: 'com.jkperformance.app', coachEmails: ['coach@example.com'], primaryCoachEmail: null, supportEmail: 's@example.com', publicUrl: 'https://jk.example.com', gateServices: false, payments: false, demoCode: null, demoCoachCode: null, fetchImpl };

async function call(method, path, { token, body, raw, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}
const ok = async (...args) => {
  const r = await call(...args);
  assert.equal(r.status, 200, `${args[0]} ${args[1]} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const signIn = async (sub, email, fullName) => ok('POST', '/api/auth/apple', { body: { identityToken: appleToken({ sub, email }), fullName } });

let coach, sam, kim;
before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'jk-test-'));
  config.dataDir = dataDir;
  db = openStore(':memory:');
  seedCatalogue(db);
  server = createApp(db, config);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  coach = await signIn('apple-coach', 'Coach@Example.com', { givenName: 'John', familyName: 'Kelly' });
  sam = await signIn('apple-sam', 'sam@example.com', { givenName: 'Sam', familyName: 'Carter' });
  kim = await signIn('apple-kim', 'kim@example.com', { givenName: 'Kim', familyName: 'Lee' });
});
after(() => server.close());

describe('Sign in with Apple', () => {
  test('roles and coach assignment come from the server', () => {
    assert.equal(coach.me.role, 'coach');
    assert.equal(sam.me.role, 'client');
    assert.equal(sam.me.coach.id, coach.me.id);
    assert.equal(sam.me.name, 'Sam Carter');
  });
  test('signing in again returns the same account', async () => {
    const again = await signIn('apple-sam', 'sam@example.com');
    assert.equal(again.me.id, sam.me.id);
    assert.equal(again.me.name, 'Sam Carter');
  });
  test('rejects a token for another app, expired, unsigned or forged', async () => {
    const bad = [
      appleToken({ sub: 'x', aud: 'com.other.app' }),
      appleToken({ sub: 'x', exp: Math.floor(Date.now() / 1000) - 3600 }),
      appleToken({ sub: 'x', iss: 'https://evil.example' }),
      appleToken({ sub: 'x' }, { key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey }),
      'not.a.token',
    ];
    for (const identityToken of bad) assert.equal((await call('POST', '/api/auth/apple', { body: { identityToken } })).status, 401);
  });
  test('a new client gets default habits and the welcome message', async () => {
    const h = await ok('GET', '/api/habits', { token: sam.token });
    assert.deepEqual(h.habits.map(x => x.name), ['Water', 'Sleep 7h+', 'Steps', 'Creatine']);
    const m = await ok('GET', '/api/messages', { token: sam.token });
    assert.equal(m.messages[0].fromRole, 'coach');
  });
  test('no token, a junk token, or a logged-out token is a 401', async () => {
    assert.equal((await call('GET', '/api/me')).status, 401);
    assert.equal((await call('GET', '/api/me', { token: 'x'.repeat(43) })).status, 401);
    const s = await signIn('apple-temp', 'temp@example.com');
    await ok('POST', '/api/auth/logout', { token: s.token });
    assert.equal((await call('GET', '/api/me', { token: s.token })).status, 401);
  });
});

describe('Plan → completion', () => {
  let workout;
  test('a coach draft is invisible to the client until published', async () => {
    workout = await ok('POST', '/api/workouts', { token: coach.token, body: {
      clientId: sam.me.id, date: londonDay(), title: 'Lower Body Strength', startsAt: '11:00',
      items: [{ exerciseId: 'ex_back-squat', sets: 3, reps: '5', load: '100 kg' }, { exerciseId: 'ex_bulgarian-split-squat', sets: 2, reps: '10 / leg', load: '2×20 kg' }],
    } });
    assert.equal(workout.published, false);
    assert.equal((await call('GET', `/api/workouts/${workout.id}`, { token: sam.token })).status, 404);
    assert.equal((await ok('GET', '/api/workouts', { token: sam.token })).workouts.length, 0);
    await ok('POST', `/api/workouts/${workout.id}/publish`, { token: coach.token });
    assert.equal((await ok('GET', '/api/workouts', { token: sam.token })).workouts.length, 1);
  });
  test('the client logs sets and completes; the coach cannot log for them', async () => {
    const item = workout.items[0];
    let w = await ok('PUT', `/api/workouts/${workout.id}/items/${item.id}/sets/1`, { token: sam.token, body: { load: '100', reps: 5 } });
    w = await ok('PUT', `/api/workouts/${workout.id}/items/${item.id}/sets/2`, { token: sam.token, body: { load: '105', reps: 5, rpe: 8 } });
    assert.equal(w.items[0].logged.length, 2);
    assert.equal((await call('PUT', `/api/workouts/${workout.id}/items/${item.id}/sets/3`, { token: coach.token, body: { load: '1', reps: 1 } })).status, 403);
    assert.equal((await call('PUT', `/api/workouts/${workout.id}`, { token: sam.token, body: { date: londonDay(), title: 'x', items: [] } })).status, 403);
    w = await ok('POST', `/api/workouts/${workout.id}/complete`, { token: sam.token, body: { note: 'Felt strong' } });
    assert.ok(w.completedAt);
  });
  test('editing keeps logged sets on kept items, and "previous" shows the last best set', async () => {
    const kept = workout.items[0];
    const w = await ok('PUT', `/api/workouts/${workout.id}`, { token: coach.token, body: {
      date: londonDay(), title: 'Lower Body Strength', items: [{ id: kept.id, exerciseId: 'ex_back-squat', sets: 4, reps: '5', load: '102.5 kg' }],
    } });
    assert.equal(w.items.length, 1);
    assert.equal(w.items[0].logged.length, 2);
    const next = await ok('POST', '/api/workouts', { token: coach.token, body: { clientId: sam.me.id, date: addDays(londonDay(), 3), title: 'Next', items: [{ exerciseId: 'ex_back-squat', sets: 3, reps: '5', load: '105 kg' }] } });
    assert.equal(next.items[0].previous, '105 × 5');
  });
  test('records and adherence follow from the logs', async () => {
    const p = await ok('GET', '/api/progress', { token: sam.token });
    assert.equal(p.records[0].exercise, 'Back Squat');
    assert.equal(p.records[0].kg, 105);
    const c = await ok('GET', '/api/coach/clients', { token: coach.token });
    assert.equal(c.clients.find(x => x.id === sam.me.id).adherence, 100);
  });
  test('programs lay down draft workouts', async () => {
    const prog = await ok('POST', '/api/programs', { token: coach.token, body: { name: 'Block A', daysPerWeek: 2, weeks: 1, workouts: [
      { dayOffset: 0, title: 'A1', items: [{ exerciseId: 'ex_deadlift', sets: 3, reps: '5', load: '140 kg' }] },
      { dayOffset: 2, title: 'A2', items: [{ exerciseId: 'ex_bench-press', sets: 3, reps: '8', load: '80 kg' }] },
    ] } });
    const r = await ok('POST', `/api/programs/${prog.id}/assign`, { token: coach.token, body: { clientId: sam.me.id, startDate: addDays(londonDay(), 7) } });
    assert.equal(r.created, 2);
    const all = await ok('GET', `/api/workouts?clientId=${sam.me.id}&from=${addDays(londonDay(), 7)}&to=${addDays(londonDay(), 10)}`, { token: coach.token });
    assert.deepEqual(all.workouts.map(w => [w.title, w.published]), [['A1', false], ['A2', false]]);
  });
});

describe('Isolation', () => {
  test("one client cannot reach another's anything", async () => {
    const w = (await ok('GET', '/api/workouts', { token: sam.token })).workouts[0];
    assert.equal((await call('GET', `/api/workouts/${w.id}`, { token: kim.token })).status, 404);
    // A clientId that isn't yours is refused, never silently used.
    assert.equal((await call('GET', `/api/habits?clientId=${sam.me.id}`, { token: kim.token })).status, 404);
    assert.equal((await call('GET', `/api/progress?clientId=${sam.me.id}`, { token: kim.token })).status, 404);
    assert.equal((await call('GET', '/api/coach/clients', { token: kim.token })).status, 403);
  });
  test("another coach cannot reach this coach's clients", async () => {
    config.coachEmails.push('coach2@example.com');
    const other = await signIn('apple-coach2', 'coach2@example.com');
    assert.equal(other.me.role, 'coach');
    assert.equal((await call('GET', `/api/habits?clientId=${sam.me.id}`, { token: other.token })).status, 404);
    assert.equal((await ok('GET', '/api/coach/clients', { token: other.token })).clients.length, 0);
  });
});

describe('Bookings and credits', () => {
  let slot, kimSlot;
  test('booking uses a credit and takes the slot', async () => {
    await ok('POST', '/api/me/membership', { token: sam.token, body: { plan: 'performance' } });
    const from = addDays(londonDay(), 7);
    const { slots } = await ok('GET', `/api/slots?from=${from}&to=${addDays(from, 6)}&kind=inperson`, { token: sam.token });
    slot = slots.find(s => s.open);
    kimSlot = slots.filter(s => s.open)[1];
    const before = (await ok('GET', '/api/me', { token: sam.token })).membership;
    const b = await ok('POST', '/api/bookings', { token: sam.token, body: { start: slot.start, kind: 'inperson' } });
    assert.equal(b.usesCredit, true);
    const afterBooking = (await ok('GET', '/api/me', { token: sam.token })).membership;
    const sameMonth = londonDay(new Date(slot.start)).slice(0, 7) === londonDay().slice(0, 7);
    if (sameMonth) assert.equal(afterBooking.creditsLeft, before.creditsLeft - 1);
    assert.equal((await call('POST', '/api/bookings', { token: kim.token, body: { start: slot.start, kind: 'inperson' } })).status, 409);
    assert.equal((await call('POST', '/api/bookings', { token: kim.token, body: { start: '2030-01-01T03:17:00.000Z', kind: 'inperson' } })).status, 400);
    // The coach sees it; Kim does not.
    const coachView = await ok('GET', `/api/bookings?from=${londonDay()}&to=${addDays(londonDay(), 20)}`, { token: coach.token });
    assert.ok(coachView.bookings.some(x => x.id === b.id));
    const kimView = await ok('GET', `/api/bookings?from=${londonDay()}&to=${addDays(londonDay(), 20)}`, { token: kim.token });
    assert.ok(!kimView.bookings.some(x => x.id === b.id));
    // Cancelling a week ahead refunds it and frees the slot.
    const cancel = await ok('DELETE', `/api/bookings/${b.id}`, { token: sam.token });
    assert.equal(cancel.refunded, true);
    await ok('POST', '/api/bookings', { token: kim.token, body: { start: kimSlot.start, kind: 'inperson' } });
  });
  test('group classes respect capacity', async () => {
    const start = londonToUtc(addDays(londonDay(), 2), '08:00').toISOString(), end = londonToUtc(addDays(londonDay(), 2), '09:00').toISOString();
    const c = await ok('POST', '/api/classes', { token: coach.token, body: { title: 'Conditioning', start, end, capacity: 1, location: 'Park' } });
    await ok('POST', `/api/classes/${c.id}/join`, { token: sam.token });
    assert.equal((await call('POST', `/api/classes/${c.id}/join`, { token: kim.token })).status, 409);
    await ok('POST', `/api/classes/${c.id}/leave`, { token: sam.token });
    await ok('POST', `/api/classes/${c.id}/join`, { token: kim.token });
  });
});

describe('Habits, health, check-ins, messages', () => {
  test('steps fill from Apple Health; ticking a habit counts', async () => {
    const today = londonDay();
    await ok('PUT', '/api/health/sharing', { token: sam.token, body: { share: true } });
    await ok('POST', '/api/health/samples', { token: sam.token, body: { samples: [
      { id: `steps-${today}`, kind: 'steps', start: londonToUtc(today).toISOString(), end: new Date().toISOString(), value: 12000 },
      { id: `weight-${today}`, kind: 'weight', start: new Date().toISOString(), end: new Date().toISOString(), value: 78.4 },
    ] } });
    // Re-sending the same id replaces, not duplicates.
    await ok('POST', '/api/health/samples', { token: sam.token, body: { samples: [{ id: `steps-${today}`, kind: 'steps', start: londonToUtc(today).toISOString(), end: new Date().toISOString(), value: 12500 }] } });
    let h = await ok('GET', '/api/habits', { token: sam.token });
    const steps = h.habits.find(x => x.name === 'Steps');
    assert.equal(steps.value, 12500);
    assert.equal(steps.done, true);
    assert.equal(steps.source, 'health');
    const water = h.habits.find(x => x.name === 'Water');
    await ok('PUT', `/api/habits/${water.id}/days/${today}`, { token: sam.token, body: { value: 3 } });
    h = await ok('GET', '/api/habits', { token: sam.token });
    assert.equal(h.habits.find(x => x.name === 'Water').done, true);
    assert.equal((await ok('GET', '/api/progress', { token: sam.token })).weight.latest, 78.4);
  });
  test('nutrition totals add up', async () => {
    const n = await ok('POST', '/api/nutrition/entries', { token: sam.token, body: { date: londonDay(), name: 'Lunch', kcal: 700, protein: 50, carbs: 70, fat: 20 } });
    assert.equal(n.totals.kcal, 700);
    assert.equal(n.targets.protein, 170);
  });
  test('check-in, coach reply', async () => {
    const c = await ok('POST', '/api/checkins', { token: sam.token, body: { energy: 4, sleep: 3, pain: ['Knee'], note: 'Tight knee' } });
    const r = await ok('POST', `/api/checkins/${c.id}/review`, { token: coach.token, body: { reply: 'Mobility first next week' } });
    assert.equal(r.reply, 'Mobility first next week');
    assert.equal((await call('POST', `/api/checkins/${c.id}/review`, { token: kim.token, body: { reply: 'x' } })).status, 403);
  });
  test('messages flow both ways and unread clears on read', async () => {
    await ok('POST', '/api/messages', { token: sam.token, body: { text: 'See you at 11' } });
    let t = await ok('GET', '/api/threads', { token: coach.token });
    assert.equal(t.threads.find(x => x.client.id === sam.me.id).unread, 1);
    await ok('GET', `/api/messages?clientId=${sam.me.id}`, { token: coach.token });
    t = await ok('GET', '/api/threads', { token: coach.token });
    assert.equal(t.threads.find(x => x.client.id === sam.me.id).unread, 0);
    await ok('POST', '/api/messages', { token: coach.token, body: { clientId: sam.me.id, text: '👍' } });
    const m = await ok('GET', '/api/messages', { token: sam.token });
    assert.equal(m.messages.at(-1).text, '👍');
  });
});

describe('Apple Health consent and activities', () => {
  const today = londonDay();
  const run = { id: 'hk-run-1', type: 'Running', start: londonToUtc(today, '07:00').toISOString(), end: londonToUtc(today, '07:40').toISOString(), minutes: 40, kcal: 420, distanceKm: 7.2, avgHr: 151, source: 'Apple Watch' };
  test('the coach sees health and activities only while the client shares', async () => {
    await ok('POST', '/api/health/activities', { token: sam.token, body: { activities: [run, { ...run }] } });
    let w = await ok('GET', `/api/health/week?clientId=${sam.me.id}`, { token: coach.token });
    assert.equal(w.shared, true);
    assert.equal(w.activities.length, 1);
    assert.equal(w.activities[0].distanceKm, 7.2);
    assert.equal(w.days.length, 7);
    await ok('PUT', '/api/health/sharing', { token: sam.token, body: { share: false } });
    w = await ok('GET', `/api/health/week?clientId=${sam.me.id}`, { token: coach.token });
    assert.deepEqual(w, { shared: false, days: [], activities: [] });
    assert.equal((await call('GET', `/api/health/activities?clientId=${sam.me.id}`, { token: coach.token })).status, 403);
    const detail = await ok('GET', `/api/coach/clients/${sam.me.id}`, { token: coach.token });
    assert.equal(detail.healthShared, false);
    assert.equal(detail.health, null);
    // Steps-backed habits show no Health value to the coach; the client still sees theirs.
    const coachHabits = await ok('GET', `/api/habits?clientId=${sam.me.id}`, { token: coach.token });
    assert.notEqual(coachHabits.habits.find(x => x.name === 'Steps').source, 'health');
    const own = await ok('GET', '/api/habits', { token: sam.token });
    assert.equal(own.habits.find(x => x.name === 'Steps').source, 'health');
    assert.equal((await ok('GET', '/api/health/activities', { token: sam.token })).activities.length, 1);
    assert.equal((await ok('GET', '/api/me', { token: sam.token })).healthSharing, false);
    // Another coach never sees it, sharing or not.
    await ok('PUT', '/api/health/sharing', { token: sam.token, body: { share: true } });
    assert.equal((await call('GET', `/api/health/week?clientId=${sam.me.id}`, { token: kim.token })).status, 404);
    assert.equal((await call('PUT', '/api/health/sharing', { token: coach.token, body: { share: true } })).status, 403);
  });
  test('erasing Health data removes samples and activities and stops sharing', async () => {
    const temp = await signIn('apple-erase', 'erase@example.com');
    await ok('PUT', '/api/health/sharing', { token: temp.token, body: { share: true } });
    await ok('POST', '/api/health/activities', { token: temp.token, body: { activities: [run] } });
    await ok('POST', '/api/health/samples', { token: temp.token, body: { samples: [{ id: 'steps-a', kind: 'steps', start: run.start, end: run.end, value: 10 }] } });
    const d = await ok('DELETE', '/api/health/data', { token: temp.token });
    assert.equal(d.sharing, false);
    assert.equal(d.activityCount, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM health_samples WHERE user_id=?').get(temp.me.id).n, 0);
  });
});

describe('Weekly feedback', () => {
  const week = mondayOf(londonDay());
  let report;
  test('a draft is the coach\'s; publishing shows it to the client with the figures and a message', async () => {
    const blank = await ok('GET', `/api/reports/week/${week}?clientId=${sam.me.id}`, { token: coach.token });
    assert.equal(blank.id, null);
    assert.equal(typeof blank.stats.workoutsPlanned, 'number');
    assert.equal((await call('GET', `/api/reports/week/${addDays(week, 1)}?clientId=${sam.me.id}`, { token: coach.token })).status, 400);
    report = await ok('PUT', '/api/reports', { token: coach.token, body: { clientId: sam.me.id, week, summary: 'Solid week.', wins: 'Squat PB', focus: 'Sleep' } });
    assert.equal(report.status, 'draft');
    assert.equal((await ok('GET', '/api/reports', { token: sam.token })).reports.length, 0);
    assert.equal((await call('GET', `/api/reports/${report.id}`, { token: sam.token })).status, 404);
    assert.equal((await call('PUT', '/api/reports', { token: sam.token, body: { clientId: sam.me.id, week, summary: 'x' } })).status, 403);
    report = await ok('PUT', '/api/reports', { token: coach.token, body: { clientId: sam.me.id, week, summary: 'Solid week.', wins: 'Squat PB', focus: 'Sleep', status: 'published' } });
    assert.equal(report.status, 'published');
    const mine = await ok('GET', '/api/reports', { token: sam.token });
    assert.equal(mine.reports.length, 1);
    assert.equal(mine.unread, 1);
    const full = await ok('GET', `/api/reports/${report.id}`, { token: sam.token });
    assert.equal(full.wins, 'Squat PB');
    assert.ok(full.stats.healthShared);
    assert.ok(Array.isArray(full.plan.workouts));
    assert.equal((await ok('GET', '/api/reports', { token: sam.token })).unread, 0);
    const msgs = await ok('GET', '/api/messages', { token: sam.token });
    assert.ok(msgs.messages.some(m => m.text.includes('feedback')));
    // Editing a published report doesn't post a second message.
    await ok('PUT', '/api/reports', { token: coach.token, body: { clientId: sam.me.id, week, summary: 'Solid week!', status: 'published' } });
    const again = await ok('GET', '/api/messages', { token: sam.token });
    assert.equal(again.messages.filter(m => m.text.includes('feedback')).length, 1);
  });
  test('nobody else can read or write it', async () => {
    assert.equal((await call('GET', `/api/reports/${report.id}`, { token: kim.token })).status, 404);
    assert.equal((await call('PUT', '/api/reports', { token: kim.token, body: { clientId: sam.me.id, week, summary: 'x' } })).status, 403);
  });
});

describe('Calendar feed', () => {
  test('a private iCalendar feed of sessions, revocable', async () => {
    const start = londonToUtc(addDays(londonDay(), 3), '18:30').toISOString(), end = londonToUtc(addDays(londonDay(), 3), '19:30').toISOString();
    const c = await ok('POST', '/api/classes', { token: coach.token, body: { title: 'Track, intervals; hard', start, end, capacity: 5, location: 'Park' } });
    await ok('POST', `/api/classes/${c.id}/join`, { token: sam.token });
    assert.equal((await ok('GET', '/api/calendar/feed', { token: sam.token })).active, false);
    const f = await ok('POST', '/api/calendar/feed', { token: sam.token });
    assert.ok(f.webcal.startsWith('webcal://'));
    const path = new URL(f.url).pathname;
    const ics = await call('GET', path);
    assert.equal(ics.status, 200);
    const text = ics.body.toString('utf8');
    assert.match(text, /^BEGIN:VCALENDAR\r\n/);
    assert.match(text, /SUMMARY:Track\\, intervals\\; hard/);
    assert.match(text, /DTSTART:\d{8}T\d{6}Z/);
    assert.ok(text.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
    const again = await ok('POST', '/api/calendar/feed', { token: sam.token });
    assert.equal((await call('GET', path)).status, 404);
    await ok('DELETE', '/api/calendar/feed', { token: sam.token });
    assert.equal((await call('GET', new URL(again.url).pathname)).status, 404);
  });
});

describe('Photos', () => {
  let photo;
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
  test('JPEG only; client and their coach can see it, nobody else', async () => {
    assert.equal((await call('POST', '/api/photos', { token: sam.token, raw: Buffer.from('GIF89a'), headers: { 'content-type': 'image/jpeg' } })).status, 415);
    photo = await ok('POST', `/api/photos?date=${londonDay()}`, { token: sam.token, raw: jpeg, headers: { 'content-type': 'image/jpeg' } });
    assert.equal((await call('GET', photo.url, { token: sam.token })).status, 200);
    assert.equal((await call('GET', photo.url, { token: coach.token })).status, 200);
    assert.equal((await call('GET', photo.url, { token: kim.token })).status, 404);
    assert.equal((await call('GET', '/api/photos/ph_..%2F..%2Fjk', { token: sam.token })).status, 404);
  });
});

describe('Membership gate', () => {
  test('when on, a free client is refused services with a code the app knows', async () => {
    config.gateServices = true;
    try {
      const r = await call('GET', '/api/workouts', { token: kim.token });
      assert.equal(r.status, 403);
      assert.equal(r.body.error, 'membership_required');
      assert.equal((await call('GET', '/api/me', { token: kim.token })).status, 200);
    } finally {
      config.gateServices = false;
    }
  });
});

describe('Export and deletion', () => {
  test('export holds the client\'s data', async () => {
    const r = await call('GET', '/api/me/export', { token: sam.token });
    assert.equal(r.status, 200);
    const data = r.body;
    assert.ok(data.workouts.length >= 2);
    assert.ok(data.messages.length >= 2);
    assert.ok(data.healthSamples.length >= 1);
  });
  test('a coach with clients cannot delete; a client can, and everything goes', async () => {
    assert.equal((await call('DELETE', '/api/me', { token: coach.token })).status, 409);
    const photos = () => existsSync(join(dataDir, 'photos')) ? readdirSync(join(dataDir, 'photos')).length : 0;
    assert.equal(photos(), 1);
    await ok('DELETE', '/api/me', { token: sam.token });
    assert.equal(photos(), 0);
    assert.equal((await call('GET', '/api/me', { token: sam.token })).status, 401);
    const id = sam.me.id;
    for (const [table, col] of [['workouts', 'client_id'], ['habits', 'client_id'], ['messages', 'client_id'], ['bookings', 'client_id'], ['measurements', 'user_id'], ['health_samples', 'user_id'], ['photos', 'user_id'], ['checkins', 'client_id'], ['sessions', 'user_id'], ['membership_events', 'user_id'], ['health_activities', 'user_id'], ['reports', 'client_id']]) {
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${col}=?`).get(id).n, 0, table);
    }
    assert.equal(db.prepare('SELECT COUNT(*) n FROM class_attendees WHERE user_id=?').get(id).n, 0);
  });
});

describe('Coach preview as the demo client', () => {
  test('a coach can switch to the demo client; a client cannot; demo health is never stored', async () => {
    seedDemo(db);
    const c2 = await signIn('apple-coach', 'coach@example.com');
    const demo = await ok('POST', '/api/auth/demo-client', { token: c2.token });
    assert.equal(demo.me.name, 'Sam Carter');
    assert.equal(demo.me.isDemo, true);
    assert.equal(c2.me.isDemo, false);
    assert.equal((await call('POST', '/api/auth/demo-client', { token: kim.token })).status, 403);
    // The coach's own session still works after switching.
    assert.equal((await ok('GET', '/api/me', { token: c2.token })).role, 'coach');
    const r = await ok('POST', '/api/health/samples', { token: demo.token, body: { samples: [{ id: 'steps-x', kind: 'steps', start: new Date().toISOString(), end: new Date().toISOString(), value: 5 }] } });
    assert.equal(r.stored, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM health_samples WHERE id='steps-x'").get().n, 0);
  });
});
