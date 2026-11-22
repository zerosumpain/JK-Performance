import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { recordPlan } from '../account.mjs';
import { createApp } from '../app.mjs';
import { issueSession, setUpClient } from '../auth.mjs';
import { seedCatalogue } from '../catalogue.mjs';
import { needsYou } from '../needs.mjs';
import { newId, nowIso, openStore } from '../store.mjs';
import { addDays, londonDay, londonToUtc, mondayOf, weekday } from '../time.mjs';
import { todayFor } from '../today.mjs';

// The Atelier redesign's server changes (docs/design/atelier-spec.md, items 1–17).

let server, base, db, dataDir;
const config = { dataDir: '', appleAudience: 'x', coachEmails: [], primaryCoachEmail: null, supportEmail: 's@example.com', publicUrl: 'https://jk.example.com',
  gateServices: true, payments: false, demoCode: null, demoCoachCode: null, fetchImpl: fetch };

async function call(method, path, { token, body, raw, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}
const ok = async (...args) => {
  const r = await call(...args);
  assert.equal(r.status, 200, `${args[0]} ${args[1]} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

const today = londonDay();
const at = (d, t = '09:00') => londonToUtc(d, t).toISOString();
let coach, otherCoach, free, elite, foundation, performance;

/** A user and a session token, without going through Apple. */
function person(name, role, { coachId = null, plan = 'none' } = {}) {
  const id = newId('u');
  db.prepare('INSERT INTO users (id, apple_sub, name, role, coach_id, created_at, onboarded_at) VALUES (?,?,?,?,?,?,?)').run(id, `t-${id}`, name, role, coachId, at(addDays(today, -60)), nowIso());
  if (role === 'client') {
    setUpClient(db, id, coachId);
    db.prepare('UPDATE habits SET introduced_at=?, created_at=? WHERE client_id=?').run(at(addDays(today, -60)), at(addDays(today, -60)), id);
    recordPlan(db, id, plan, at(addDays(today, -60)));
  }
  return { id, token: issueSession(db, id), row: () => db.prepare('SELECT * FROM users WHERE id=?').get(id) };
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'jk-atelier-'));
  config.dataDir = dataDir;
  db = openStore(':memory:');
  seedCatalogue(db);
  server = createApp(db, config);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  coach = person('John Kelly', 'coach');
  otherCoach = person('Other Coach', 'coach');
  free = person('Fran Free', 'client', { coachId: coach.id, plan: 'none' });
  elite = person('Eli Elite', 'client', { coachId: coach.id, plan: 'elite' });
  foundation = person('Fay Foundation', 'client', { coachId: coach.id, plan: 'foundation' });
  performance = person('Pat Performance', 'client', { coachId: coach.id, plan: 'performance' });
});
after(() => server.close());

describe('Features and gates (items 1, 2)', () => {
  test('Me carries features, the coach and preferences', async () => {
    const me = await ok('GET', '/api/me', { token: elite.token });
    assert.equal(me.features.priority, true);
    assert.equal(me.features.formChecks, false);
    assert.equal(me.features.hasMacroTargets, true);
    assert.equal(me.coach.replyLine, 'Same-day replies');
    assert.deepEqual(me.preferences, { notificationsOn: true, eveningReminderTime: null });
    const f = await ok('GET', '/api/me', { token: foundation.token });
    assert.equal(f.features.checkin, false);
    assert.equal(f.coach.replyLine, 'JK replies most evenings');
    const c = await ok('GET', '/api/me', { token: coach.token });
    assert.equal(c.coachSettings.studioTools, false);
  });

  test('Free never gets a 403 from Today, the timeline or guides, with the gate on', async () => {
    const me = await ok('GET', '/api/me', { token: free.token });
    assert.equal(me.features.guides, true);
    assert.equal(me.features.habits, false);
    const t = await ok('GET', '/api/today', { token: free.token });
    assert.equal(t.next.kind, 'membership');
    assert.equal(t.next.buttonLabel, 'Have a look');
    assert.equal(t.goal, null);
    assert.equal(t.coachLine, null);
    assert.deepEqual(t.habits, []);
    const tl = await ok('GET', '/api/timeline', { token: free.token });
    assert.deepEqual(tl.items, []);
    const g = await ok('GET', '/api/client/guides', { token: free.token });
    assert.ok(g.guides.length >= 4);
    const one = await ok('GET', `/api/client/guides/${g.guides[0].id}`, { token: free.token });
    assert.ok(one.body.length > 50);
    assert.equal((await ok('GET', '/api/goal', { token: free.token })).goal, null);
    // Member-only routes still say so.
    assert.equal((await call('GET', '/api/habits', { token: free.token })).status, 403);
    // A plan the coach took guides off gets an empty list, not a 403.
    await ok('PUT', '/api/coach/plans/none', { token: coach.token, body: { features: ['programme'] } });
    assert.deepEqual((await ok('GET', '/api/client/guides', { token: free.token })).guides, []);
    await ok('POST', '/api/coach/plans/reset', { token: coach.token });
  });

  test('coach settings and the per-client settings', async () => {
    const s = await ok('PATCH', '/api/coach/settings', { token: coach.token, body: { studioTools: true, formChecks: true, replyExpectation: { standard: 'JK replies by 8pm' }, defaultMeetingUrl: 'https://meet.example.com/jk' } });
    assert.equal(s.studioTools, true);
    assert.equal(s.replyExpectation.priority, 'Same-day replies');
    assert.equal((await call('PATCH', '/api/coach/settings', { token: coach.token, body: { defaultMeetingUrl: 'javascript:alert(1)' } })).status, 400);
    assert.equal((await call('PATCH', '/api/coach/settings', { token: elite.token, body: { studioTools: true } })).status, 403);
    assert.equal((await ok('GET', '/api/me', { token: elite.token })).features.formChecks, true);
    const cs = await ok('PATCH', `/api/coach/clients/${performance.id}/settings`, { token: coach.token, body: { letterRhythm: 'fortnightly', dayMinimum: 2 } });
    assert.equal(cs.letterRhythm.days, 14);
    assert.equal(cs.dayMinimum, 2);
    assert.equal((await call('PATCH', `/api/coach/clients/${performance.id}/settings`, { token: otherCoach.token, body: { dayMinimum: 2 } })).status, 404);
    const p = await ok('PUT', '/api/me/preferences', { token: elite.token, body: { notificationsOn: false, eveningReminderTime: '20:30' } });
    assert.deepEqual(p, { notificationsOn: false, eveningReminderTime: '20:30' });
    assert.equal((await call('PUT', '/api/me/preferences', { token: elite.token, body: { eveningReminderTime: '25:00' } })).status, 400);
  });
});

describe('Habits and the day rule (items 3, 5, 6)', () => {
  test('IconKeys, the five-habit cap and edits', async () => {
    const h = await ok('GET', '/api/habits', { token: elite.token });
    assert.deepEqual(h.habits.map(x => x.iconKey), ['water', 'sleep', 'steps', 'energy']);
    const added = await ok('POST', '/api/habits', { token: coach.token, body: { clientId: elite.id, name: 'Protein', kind: 'count', target: 170, unit: 'g', iconKey: 'protein', step: 10 } });
    assert.equal(added.icon, 'fork.knife');
    assert.equal(added.step, 10);
    assert.equal((await call('POST', '/api/habits', { token: coach.token, body: { clientId: elite.id, name: 'Six', kind: 'check', iconKey: 'reading' } })).status, 409);
    assert.equal((await call('PATCH', `/api/habits/${added.id}`, { token: coach.token, body: { iconKey: 'rocket' } })).status, 400);
    const edited = await ok('PATCH', `/api/habits/${added.id}`, { token: coach.token, body: { target: 160, iconKey: 'supplement' } });
    assert.equal(edited.target, 160);
    assert.equal(edited.icon, 'pills');
  });

  test('a day is done at the minimum; a rest day is neither done nor missed', async () => {
    const habits = (await ok('GET', '/api/habits', { token: elite.token })).habits.filter(h => !h.healthKind);
    assert.equal(habits.length, 3); // water, creatine, protein (sleep and steps come from Health)
    const yesterday = addDays(today, -1), twoAgo = addDays(today, -2);
    let h = await ok('GET', '/api/habits', { token: elite.token });
    assert.equal(h.dayMinimum, 3); // ceil(60% of 5)
    assert.equal(h.dayDone, false);
    for (const x of habits) await ok('PUT', `/api/habits/${x.id}/days/${today}`, { token: elite.token, body: { done: true, value: x.target } });
    h = await ok('GET', '/api/habits', { token: elite.token });
    assert.equal(h.doneCount, 3);
    assert.equal(h.dayDone, true);
    // Yesterday nothing: missed. Then JK makes it a rest day: not missed any more.
    assert.equal(h.missedYesterday, true);
    assert.equal((await call('POST', `/api/clients/${elite.id}/rest-days`, { token: elite.token, body: { date: yesterday } })).status, 403);
    await ok('POST', `/api/clients/${elite.id}/rest-days`, { token: coach.token, body: { date: yesterday, reason: 'Travelling' } });
    h = await ok('GET', '/api/habits', { token: elite.token });
    assert.equal(h.missedYesterday, false);
    assert.equal(h.consistency.rest, 1);
    assert.equal(h.consistency.done, 1);
    // Two of five two days ago is not the minimum; with the coach's minimum of 2 it is.
    for (const x of habits.slice(0, 2)) await ok('PUT', `/api/habits/${x.id}/days/${twoAgo}`, { token: elite.token, body: { done: true } });
    let week = await ok('GET', `/api/habits/week?from=${twoAgo}&to=${today}`, { token: elite.token });
    assert.deepEqual(week.days.map(d => [d.done, d.rest]), [[false, false], [false, true], [true, false]]);
    assert.equal(week.days[1].restReason, 'Travelling');
    await ok('PATCH', `/api/coach/clients/${elite.id}/settings`, { token: coach.token, body: { dayMinimum: 2 } });
    week = await ok('GET', `/api/habits/week?from=${twoAgo}&to=${today}`, { token: elite.token });
    assert.equal(week.days[0].done, true);
    const hist = await ok('GET', `/api/habits/history?clientId=${elite.id}`, { token: coach.token });
    assert.equal(hist.days.length, 28);
    assert.ok(hist.habits[0].rate7 !== undefined);
    const list = await ok('GET', '/api/coach/clients', { token: coach.token });
    const row = list.clients.find(c => c.id === elite.id);
    assert.deepEqual(row.habitWeek.slice(-3).map(d => d.state), ['done', 'rest', 'done']);
    await ok('DELETE', `/api/clients/${elite.id}/rest-days/${yesterday}`, { token: coach.token });
    await ok('PATCH', `/api/coach/clients/${elite.id}/settings`, { token: coach.token, body: { dayMinimum: null } });
  });
});

describe('Goals (item 4)', () => {
  test('weight and record goals work out where the client is', async () => {
    for (const [d, v] of [[-20, 84], [-6, 80.4], [-3, 80.0], [0, 79.6]]) await ok('POST', '/api/measurements', { token: elite.token, body: { date: addDays(today, d), kind: 'weight', value: v } });
    assert.equal((await call('POST', '/api/goals', { token: elite.token, body: { clientId: elite.id, title: 'x' } })).status, 403);
    const g = await ok('POST', '/api/goals', { token: coach.token, body: { clientId: elite.id, title: 'Down to 75 kg by March', metric: 'weight', baseline: 84, target: 75,
      startDate: addDays(today, -20), targetDate: addDays(today, 50), status: 'active' } });
    assert.equal(g.current, 80); // the 7-day average of 80.4, 80.0, 79.6
    assert.equal(g.remaining, 5);
    assert.equal(g.remainingLabel, '5 kg to go');
    assert.equal(g.delta, -4);
    assert.equal(g.sourceLabel, 'From your weigh-ins, 7-day average');
    assert.deepEqual(g.weekOf, { week: 3, weeks: 10 });
    const mine = await ok('GET', '/api/goal', { token: elite.token });
    assert.equal(mine.goal.id, g.id);
    // Activating another pauses this one; a record goal reads the best logged load.
    const w = await ok('POST', '/api/workouts', { token: elite.token, body: { date: today, title: 'Squats', items: [{ exerciseId: 'ex_back-squat', sets: 1, reps: '5', load: '100 kg' }] } });
    await ok('PUT', `/api/workouts/${w.id}/items/${w.items[0].id}/sets/1`, { token: elite.token, body: { load: '102.5 kg', reps: 5 } });
    const r = await ok('POST', '/api/goals', { token: coach.token, body: { clientId: elite.id, title: 'Squat 120 kg', metric: 'record', exerciseId: 'ex_back-squat', baseline: 90, target: 120, status: 'active' } });
    assert.equal(r.current, 102.5);
    assert.equal(r.progressPct, 42);
    const all = await ok('GET', `/api/goals?clientId=${elite.id}`, { token: coach.token });
    assert.deepEqual(all.goals.map(x => x.status), ['active', 'paused']);
    await ok('DELETE', `/api/goals/${r.id}`, { token: coach.token });
    await ok('PATCH', `/api/goals/${g.id}`, { token: coach.token, body: { status: 'active', chapterName: 'Chapter two' } });
    assert.equal((await ok('GET', '/api/today', { token: elite.token })).goal.chapterName, 'Chapter two');
  });

  test('onboarding answers leave a draft goal for JK', async () => {
    const n = person('Nia New', 'client', { coachId: coach.id, plan: 'performance' });
    await ok('PUT', '/api/me/onboarding', { token: n.token, body: { goals: ['fatloss'] } });
    const goals = await ok('GET', `/api/goals?clientId=${n.id}`, { token: coach.token });
    assert.equal(goals.goals[0].status, 'draft');
    assert.equal(goals.goals[0].suggestion, 'Fat loss');
    assert.equal((await ok('GET', '/api/goal', { token: n.token })).pending, true);
  });
});

describe('Letters (item 8)', () => {
  test('publishing schedules for Monday 07:00; delivered letters are read and answered', async () => {
    await ok('POST', '/api/checkins', { token: performance.token, body: { energy: 4, sleep: 3, stress: 2, pain: [], note: 'ok', win: 'All sessions done', struggle: 'Sleep' } });
    const week = (await ok('GET', '/api/checkins', { token: performance.token })).checkins[0].week;
    const draft = await ok('PUT', '/api/reports', { token: coach.token, body: { clientId: performance.id, week, headline: 'Strongest week yet.', keep: 'Squat up 5 kg.', adjust: 'Lights out by 10:30.', question: 'What got in the way on Thursday?' } });
    assert.equal(draft.letterStatus, 'draft');
    assert.equal(draft.summary, 'Strongest week yet.');
    assert.ok(draft.context.week, 'the composer gets the week\'s figures');
    const scheduled = await ok('PUT', '/api/reports', { token: coach.token, body: { clientId: performance.id, week, headline: 'Strongest week yet.', keep: 'Squat up 5 kg.', adjust: 'Lights out by 10:30.', question: 'What got in the way on Thursday?', status: 'published' } });
    assert.equal(scheduled.letterStatus, 'scheduled');
    assert.equal(new Date(scheduled.deliverAt).getUTCDay(), 1, 'a Monday');
    assert.ok(Date.parse(scheduled.deliverAt) > Date.now());
    assert.equal((await ok('GET', '/api/reports', { token: performance.token })).reports.length, 0, 'not before deliverAt');
    assert.equal((await call('GET', `/api/reports/${scheduled.id}`, { token: performance.token })).status, 404);
    // Publishing marked the check-in replied.
    assert.ok((await ok('GET', '/api/checkins', { token: performance.token })).checkins[0].reviewedAt);
    // "Publish now".
    const now = await ok('PUT', '/api/reports', { token: coach.token, body: { id: scheduled.id, clientId: performance.id, headline: 'Strongest week yet.', keep: 'Squat up 5 kg.', adjust: 'Lights out by 10:30.', question: 'What got in the way on Thursday?', status: 'published', deliverAt: 'now' } });
    assert.equal(now.letterStatus, 'published');
    const list = await ok('GET', '/api/reports', { token: performance.token });
    assert.equal(list.unread, 1);
    const t = await ok('GET', '/api/today', { token: performance.token });
    assert.equal(t.coachLine.source, 'letter');
    assert.equal(t.coachLine.unread, true);
    await ok('POST', `/api/reports/${now.id}/read`, { token: performance.token });
    assert.equal((await ok('GET', '/api/today', { token: performance.token })).coachLine.text, 'Lights out by 10:30.');
    const answered = await ok('POST', `/api/reports/${now.id}/answer`, { token: performance.token, body: { answer: 'A late meeting.' } });
    assert.equal(answered.answer, 'A late meeting.');
    assert.equal(answered.scoreTrio.length, 3);
    const msgs = (await ok('GET', '/api/messages', { token: performance.token })).messages;
    assert.ok(msgs.some(m => m.kind === 'letter' && m.reportId === now.id));
    assert.ok(msgs.some(m => m.kind === 'answer' && m.text === 'A late meeting.'));
    // The timeline shows the letter once (not its note) and the check-in.
    const tl = await ok('GET', '/api/timeline', { token: performance.token });
    assert.equal(tl.items.filter(i => i.kind === 'letter').length, 1);
    assert.ok(tl.items.some(i => i.kind === 'checkin' && i.checkin.win === 'All sessions done'));
    assert.ok(!tl.items.some(i => i.kind === 'message' && i.message.kind === 'letter'));
    // Reply to JK quotes the letter.
    const reply = await ok('POST', '/api/messages', { token: performance.token, body: { text: 'Thanks', reportId: now.id } });
    assert.equal(reply.reportId, now.id);
    // A delivered letter cannot go back to draft; other coaches cannot touch it.
    assert.equal((await call('PUT', '/api/reports', { token: coach.token, body: { id: now.id, clientId: performance.id, headline: 'x' } })).status, 409);
    assert.equal((await call('POST', `/api/reports/${now.id}/answer`, { token: elite.token, body: { answer: 'x' } })).status, 404);
  });

  test('old builds still publish at once with summary, wins and focus; the new fields mirror them', async () => {
    const week = mondayOf(addDays(today, -14));
    const r = await ok('PUT', '/api/reports', { token: coach.token, body: { clientId: elite.id, week, summary: 'Good week. More next time.', wins: 'PB', focus: 'Sleep', status: 'published' } });
    assert.equal(r.letterStatus, 'published');
    assert.equal(r.headline, 'Good week.');
    assert.equal(r.keep, 'PB');
    assert.equal(r.adjust, 'Sleep');
    // A milestone letter shares the week with the weekly one.
    const m = await ok('PUT', '/api/reports', { token: coach.token, body: { clientId: elite.id, week, kind: 'milestone', headline: 'Twelve weeks.', milestoneKey: 'twelveWeeks', status: 'published', deliverAt: 'now' } });
    assert.notEqual(m.id, r.id);
    assert.equal(m.kind, 'milestone');
  });
});

describe('Media (item 10)', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
  test('upload, ranged reads, who may see it, and erasure with the account', async () => {
    assert.equal((await call('POST', '/api/media', { token: elite.token, raw: Buffer.from('nope'), headers: { 'content-type': 'image/jpeg' } })).status, 415);
    assert.equal((await call('POST', '/api/media', { token: elite.token, raw: jpeg, headers: { 'content-type': 'application/pdf' } })).status, 415);
    const m = await ok('POST', '/api/media?purpose=mealPhoto', { token: elite.token, raw: jpeg, headers: { 'content-type': 'image/jpeg' } });
    assert.equal(m.kind, 'image');
    const full = await call('GET', m.url, { token: elite.token });
    assert.equal(full.status, 200);
    assert.equal(full.body.length, jpeg.length);
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    const part = await call('GET', m.url, { token: coach.token, headers: { range: 'bytes=0-3' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), `bytes 0-3/${jpeg.length}`);
    assert.deepEqual([...part.body], [0xff, 0xd8, 0xff, 0xe0]);
    assert.equal((await call('GET', m.url, { token: elite.token, headers: { range: 'bytes=-10' } })).body.length, 10);
    assert.equal((await call('GET', m.url, { token: elite.token, headers: { range: 'bytes=99999-' } })).status, 416);
    assert.equal((await call('GET', m.url, { token: foundation.token })).status, 404);
    assert.equal((await call('GET', m.url, { token: otherCoach.token })).status, 404);
    // A meal photo goes to JK only while the coach has meal photos on.
    assert.equal((await call('POST', '/api/messages', { token: elite.token, body: { mediaId: m.id, kind: 'mealPhoto' } })).status, 403);
    // The coach's portrait is seen by his clients, through Me.
    const portrait = await ok('POST', '/api/media?purpose=avatar', { token: coach.token, raw: jpeg, headers: { 'content-type': 'image/jpeg' } });
    const me = await ok('GET', '/api/me', { token: foundation.token });
    assert.equal(me.coach.avatarMediaId, portrait.id);
    assert.equal((await call('GET', me.coach.avatarUrl, { token: foundation.token })).status, 200);
    assert.equal((await call('GET', me.coach.avatarUrl, { token: otherCoach.token })).status, 404);
    // Export lists it; deleting the account removes the file.
    const gone = person('Gone Soon', 'client', { coachId: coach.id, plan: 'elite' });
    const g = await ok('POST', '/api/media', { token: gone.token, raw: jpeg, headers: { 'content-type': 'image/jpeg' } });
    const exp = (await call('GET', '/api/me/export', { token: gone.token })).body;
    assert.equal(exp.media[0].id, g.id);
    assert.ok(readdirSync(join(dataDir, 'media')).some(f => f.startsWith(g.id)));
    await ok('DELETE', '/api/me', { token: gone.token });
    assert.ok(!readdirSync(join(dataDir, 'media')).some(f => f.startsWith(g.id)));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM media WHERE id=?').get(g.id).n, 0);
  });
});

describe('Needs you (item 16)', () => {
  test('pain first, then priority-plan unread above other unread; letters due counted', async () => {
    const c2 = person('Coach Two', 'coach');
    const a = person('Ann Foundation', 'client', { coachId: c2.id, plan: 'foundation' });
    const b = person('Bea Elite', 'client', { coachId: c2.id, plan: 'elite' });
    const p = person('Pip Pain', 'client', { coachId: c2.id, plan: 'performance' });
    const send = (who, text, hoursAgo) => db.prepare("INSERT INTO messages (id, client_id, from_id, from_role, text, at) VALUES (?,?,?,'client',?,?)")
      .run(newId('m'), who.id, who.id, text, new Date(Date.now() - hoursAgo * 3_600_000).toISOString());
    send(a, 'Quick question about Thursday', 5); // older, but Foundation
    send(b, 'Can we move Friday?', 1);
    send(p, 'My knee hurts after squats', 0.5);
    const out = await ok('GET', '/api/coach/needs-you', { token: c2.token });
    assert.deepEqual(out.items.slice(0, 3).map(i => i.client.name), ['Pip Pain', 'Bea Elite', 'Ann Foundation']);
    assert.equal(out.items[0].reasons[0].kind, 'pain');
    assert.equal(out.items[1].reasons[0].kind, 'priorityUnread');
    assert.match(out.items[1].reasonLine, /Elite · same-day reply/);
    assert.equal(out.items[1].primaryAction.label, 'Reply');
    assert.equal(new Set(out.items.map(i => i.client.id)).size, out.items.length, 'each client once');
    assert.equal(out.lettersDue.count, 2); // Bea (Elite) and Pip (Performance); Foundation has no letters
    assert.ok(out.lettersDue.estMinutes > 0);
    assert.equal((await call('GET', '/api/coach/needs-you', { token: a.token })).status, 403);
  });
});

describe('Today (item 7)', () => {
  test('the Next card follows the priority order', () => {
    const c3 = person('Coach Three', 'coach');
    const s = person('Sid Session', 'client', { coachId: c3.id, plan: 'performance' });
    // A Saturday at 09:00 London: a check-in is due (Friday to Monday).
    const sat = addDays(mondayOf(today), 5);
    const now = londonToUtc(sat, '09:00');
    const client = s.row();
    const next = () => todayFor(db, config, s.row(), now).next;
    const workout = (date, time, title = 'Lower Strength') => db.prepare(`INSERT INTO workouts (id, client_id, date, title, starts_at, location, published, published_at, edited_at, edited_by, created_by)
      VALUES (?,?,?,?,?,'Studio',1,?,?,'coach',?)`).run(newId('w'), client.id, date, title, time, nowIso(), nowIso(), c3.id);
    // Nothing planned: rest, but the check-in comes first.
    assert.equal(next().kind, 'checkin');
    assert.deepEqual(next().alsoDue, []);
    // A form too: still the check-in, with the form as "also due".
    db.prepare("INSERT INTO form_requests (id, client_id, name, questions, sent_at) VALUES (?,?,'Monthly review','[{\"id\":\"a\"},{\"id\":\"b\"}]',?)").run(newId('fr'), client.id, nowIso());
    assert.deepEqual(next().alsoDue.map(d => d.label), ['Monthly review']);
    // A session within three hours beats both.
    workout(sat, '11:00');
    assert.equal(next().kind, 'session');
    assert.equal(next().buttonLabel, 'Start session');
    assert.equal(next().alsoDue.length, 2);
    // Check-in done: the form; form done: today's later workout.
    db.prepare("INSERT INTO checkins (id, client_id, week, energy, sleep, pain, note, submitted_at) VALUES (?,?,?,4,4,'[]','',?)").run(newId('c'), client.id, mondayOf(sat), nowIso());
    db.prepare('UPDATE workouts SET starts_at=? WHERE client_id=?').run('18:00', client.id);
    assert.equal(next().kind, 'form');
    assert.equal(next().title, 'Monthly review · 2 questions');
    db.prepare('UPDATE form_requests SET answers=?, submitted_at=? WHERE client_id=?').run('{}', nowIso(), client.id);
    assert.equal(next().kind, 'workout');
    assert.equal(next().buttonLabel, 'View session');
    // No workout today: a rest day naming what comes next (a 1:1 booked for Monday merges in).
    db.prepare('DELETE FROM workouts WHERE client_id=?').run(client.id);
    db.prepare("INSERT INTO bookings (id, coach_id, client_id, kind, start, end, location, title, uses_credit, created_at) VALUES (?,?,?,'video',?,?,'Video call','Video call with Coach Three',1,?)")
      .run(newId('b'), c3.id, client.id, londonToUtc(addDays(sat, 2), '18:00').toISOString(), londonToUtc(addDays(sat, 2), '19:00').toISOString(), nowIso());
    db.prepare("INSERT INTO workouts (id, client_id, date, title, published, edited_at, edited_by, created_by, completed_at) VALUES (?,?,?,'Old',1,?,'coach',?,?)").run(newId('w'), client.id, addDays(sat, -3), nowIso(), c3.id, nowIso());
    assert.equal(next().kind, 'rest');
    assert.match(next().title, /^Rest day\. Next: Video call with Coach Three, Monday 18:00\.$/);
    // On Monday afternoon the video call is within three hours: Details until there is a link, then Join.
    const mon = londonToUtc(addDays(sat, 2), '16:00');
    // (Monday's due check-in is still last week's, already in.)
    let n = todayFor(db, config, s.row(), mon).next;
    assert.equal(n.kind, 'videoCall');
    assert.equal(n.buttonLabel, 'Details');
    db.prepare('UPDATE bookings SET meeting_url=? WHERE client_id=?').run('https://meet.example.com/sid', client.id);
    n = todayFor(db, config, s.row(), mon).next;
    assert.equal(n.buttonLabel, 'Join');
    assert.equal(n.item.meetingUrl, 'https://meet.example.com/sid');
    assert.equal(weekday(sat), 6);
  });

  test('From JK goes stale after the rhythm plus three days; Foundation reads JK\'s latest message', async () => {
    const t = await ok('GET', '/api/today', { token: foundation.token });
    assert.equal(t.coachLine.source, 'message');
    assert.match(t.coachLine.text, /^Welcome to JK Performance/);
    db.prepare("UPDATE messages SET at=? WHERE client_id=? AND from_role='coach'").run(new Date(Date.now() - 11 * 86_400_000).toISOString(), foundation.id);
    assert.equal((await ok('GET', '/api/today', { token: foundation.token })).coachLine, null);
    await ok('PATCH', `/api/coach/clients/${foundation.id}/settings`, { token: coach.token, body: { coachLine: 'Easy week: walk, sleep, eat well.' } });
    const o = await ok('GET', '/api/today', { token: foundation.token });
    assert.equal(o.coachLine.source, 'override');
    assert.equal(o.week.length, 7);
  });

  test('session feel is stored as a number and shown as a word', async () => {
    const w = await ok('POST', '/api/workouts', { token: elite.token, body: { date: today, title: 'Upper', items: [] } });
    const done = await ok('POST', `/api/workouts/${w.id}/complete`, { token: elite.token, body: { feel: 3, note: 'Last set was a grind' } });
    assert.equal(done.feel, 3);
    assert.equal(done.feelWord, 'Hard');
    const draft = await ok('GET', `/api/checkins/draft?week=${mondayOf(today)}`, { token: elite.token });
    assert.ok(draft.feel.some(f => f.word === 'Hard'));
  });
});

describe('Migration (items 5, 8, 4)', () => {
  test('old habits get IconKeys, old reports get letter fields, clients get draft goals, and the file is backed up first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jk-migrate-'));
    const file = join(dir, 'jk.sqlite');
    let d = openStore(file);
    const u = newId('u');
    d.prepare("INSERT INTO users (id, name, role, created_at, profile) VALUES (?, 'Old Client', 'client', ?, ?)").run(u, nowIso(), JSON.stringify({ goals: ['strength'] }));
    d.prepare("INSERT INTO habits (id, client_id, name, kind, target, icon, created_at) VALUES ('h1', ?, 'Water', 'count', 3, 'drop', ?)").run(u, nowIso());
    d.prepare("INSERT INTO habits (id, client_id, name, kind, target, icon, created_at) VALUES ('h2', ?, 'Steps', 'count', 10000, 'shoeprints.fill', ?)").run(u, nowIso());
    d.prepare("INSERT INTO habits (id, client_id, name, kind, target, icon, created_at) VALUES ('h3', ?, 'Odd', 'check', 1, 'star', ?)").run(u, nowIso());
    d.prepare("INSERT INTO form_requests (id, client_id, name, questions, sent_at, answers, submitted_at) VALUES ('fr1', ?, 'Intake', '[]', ?, ?, ?)").run(u, nowIso(), JSON.stringify({ goal: 'Squat 140 kg' }), nowIso());
    d.prepare("INSERT INTO reports (id, client_id, week, summary, wins, focus, published_at, created_at, updated_at) VALUES ('r1', ?, '2026-11-09', 'Good week, Sam. Every session done.', 'Squat PB', 'Sleep', ?, ?, ?)").run(u, nowIso(), nowIso(), nowIso());
    d.prepare("DELETE FROM meta WHERE key='atelier_v1'").run();
    d.prepare("UPDATE habits SET icon_key=NULL").run();
    d.prepare("UPDATE reports SET headline=NULL").run();
    d.close();
    // An old database still had the one-report-per-week constraint; the reopen drops it and keeps the rows.
    const legacy = new DatabaseSync(file);
    legacy.exec(`CREATE TABLE r_old AS SELECT * FROM reports; DROP TABLE reports;
      CREATE TABLE reports (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, coach_id TEXT, week TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '', wins TEXT NOT NULL DEFAULT '', focus TEXT NOT NULL DEFAULT '', published_at TEXT, read_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (client_id, week));
      INSERT INTO reports SELECT id, client_id, coach_id, week, summary, wins, focus, published_at, read_at, created_at, updated_at FROM r_old; DROP TABLE r_old;`);
    legacy.close();
    d = openStore(file);
    assert.deepEqual(d.prepare('SELECT id, icon_key FROM habits ORDER BY id').all().map(r => [r.id, r.icon_key]), [['h1', 'water'], ['h2', 'steps'], ['h3', 'custom']]);
    const r = d.prepare("SELECT * FROM reports WHERE id='r1'").get();
    assert.equal(r.headline, 'Good week, Sam.');
    assert.equal(r.keep, 'Squat PB');
    assert.equal(r.adjust, 'Sleep');
    assert.equal(r.kind, 'weekly');
    assert.ok(r.delivered_at, 'old published reports count as delivered (no second notice)');
    assert.doesNotMatch(d.prepare("SELECT sql FROM sqlite_master WHERE name='reports'").get().sql, /UNIQUE/);
    const g = d.prepare('SELECT * FROM goals WHERE client_id=?').get(u);
    assert.equal(g.status, 'draft');
    assert.equal(g.title, 'Squat 140 kg');
    assert.equal(g.suggestion, 'Get stronger');
    assert.ok(readdirSync(dir).some(f => f.includes('pre-atelier_v1')), 'backed up before migrating');
    assert.ok(existsSync(file));
    d.close();
  });
});
