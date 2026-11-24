/**
 * F23 Coach tasks (docs/design/desk-v2.md, WP8): the quick-add parser, London
 * buckets, the due clock (once), the task.create action, hooks, isolation,
 * reassignment, export and erasure.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { assertNoRowsFor, fakeToday, makeWorld } from './helpers.mjs';
import { runAction } from '../facts.mjs';
import { bucketOf, parseTask } from '../features/tasks.mjs';
import { addDays, londonToUtc, mondayOf } from '../time.mjs';

let w;
before(async () => { w = await makeWorld(); });
after(() => w.close());

const CLIENTS = [{ id: 'u_sam', name: 'Sam Carter' }, { id: 'u_priya', name: 'Priya Shah' }, { id: 'u_alex', name: 'Alex Morgan' }];

describe('the quick-add parser', () => {
  // Tuesday 24 November 2026, 10:00 London (GMT).
  const today = '2026-11-24';
  const now = londonToUtc(today, '10:00');
  const cases = [
    ['Call Sam tomorrow 9am #billing !high', { title: 'Call Sam', dueOn: '2026-11-25', dueTime: '09:00', clientId: 'u_sam', tags: ['billing'], priority: 'high' }],
    ['Send Priya her race plan by Fri', { title: 'Send Priya her race plan', dueOn: '2026-11-27', clientId: 'u_priya' }],
    ['Review the block next mon', { title: 'Review the block', dueOn: '2026-11-30', dueTime: null }],
    ['Ring Alex fri 5pm', { title: 'Ring Alex', dueOn: '2026-11-27', dueTime: '17:00', clientId: 'u_alex' }],
    ['Order bands 15 Dec', { title: 'Order bands', dueOn: '2026-12-15' }],
    ['Book the hall Dec 15th', { title: 'Book the hall', dueOn: '2026-12-15' }],
    ['Renew insurance 3 Jan', { title: 'Renew insurance', dueOn: '2027-01-03' }],
    ['Check the plan in 3 days', { title: 'Check the plan', dueOn: '2026-11-27' }],
    ['New block in 2 weeks', { title: 'New block', dueOn: '2026-12-08' }],
    ['Stretch routine today', { title: 'Stretch routine', dueOn: today, dueTime: null }],
    ['Call Alex 14:30', { title: 'Call Alex', dueOn: today, dueTime: '14:30' }],
    ['Call Alex 8am', { title: 'Call Alex', dueOn: '2026-11-25', dueTime: '08:00' }],
    ['Write letters tue', { title: 'Write letters', dueOn: today }],
    ['Write letters wednesday', { title: 'Write letters', dueOn: '2026-11-25' }],
    ['Tidy the studio next week !low', { title: 'Tidy the studio', dueOn: '2026-11-30', priority: 'low' }],
    ['call sam carter tonight', { title: 'call sam carter', dueOn: today, dueTime: '19:00', clientId: 'u_sam' }],
    ['Lunch with Sammy', { title: 'Lunch with Sammy', dueOn: null, clientId: null }],
    ['Pay rent 31 Feb', { title: 'Pay rent 31 Feb', dueOn: null }],
    ['Prep the talk at noon #talks #talks', { title: 'Prep the talk', dueOn: today, dueTime: '12:00', tags: ['talks'] }],
    ['Plan Priya 2026-12-01', { title: 'Plan Priya', dueOn: '2026-12-01', clientId: 'u_priya' }],
  ];
  for (const [text, want] of cases) {
    test(`"${text}"`, () => {
      const got = parseTask(text, { today, now, clients: CLIENTS });
      for (const [k, v] of Object.entries(want)) assert.deepEqual(got[k], v, `${k} of "${text}"`);
      if (want.dueOn && got.dueTime) assert.equal(got.dueAt, londonToUtc(want.dueOn, got.dueTime).toISOString());
      if (!got.dueTime) assert.equal(got.dueAt, null);
    });
  }
  test('a first name two clients share only matches with the full name', () => {
    const clients = [...CLIENTS, { id: 'u_sam2', name: 'Sam Jones' }];
    assert.equal(parseTask('Call Sam', { today, now, clients }).clientId, null);
    assert.equal(parseTask('Call Sam Jones', { today, now, clients }).clientId, 'u_sam2');
  });
  test('times are London wall-clock in BST too', () => {
    const got = parseTask('Call Sam 9am', { today: '2026-07-01', now: londonToUtc('2026-07-01', '06:00'), clients: CLIENTS });
    assert.equal(got.dueOn, '2026-07-01');
    assert.equal(got.dueAt, '2026-07-01T08:00:00.000Z');
  });
});

describe('buckets in London time', () => {
  test('across the week, including a Monday in BST and a Sunday', () => {
    const monday = '2026-06-29';
    const t = (o) => ({ status: 'open', due_on: null, done_at: null, ...o });
    assert.equal(bucketOf(t({ due_on: '2026-06-28' }), monday), 'overdue');
    assert.equal(bucketOf(t({ due_on: monday }), monday), 'today');
    assert.equal(bucketOf(t({ due_on: '2026-07-05' }), monday), 'week');
    assert.equal(bucketOf(t({ due_on: '2026-07-06' }), monday), 'later');
    assert.equal(bucketOf(t({}), monday), 'none');
    // Monday 00:30 BST is Sunday 23:30 UTC: done this week. Sunday 23:30 BST is not.
    assert.equal(bucketOf(t({ status: 'done', done_at: '2026-06-28T23:30:00.000Z' }), monday), 'done');
    assert.equal(bucketOf(t({ status: 'done', done_at: '2026-06-28T22:30:00.000Z' }), monday), null);
    const sunday = '2026-07-05';
    assert.equal(bucketOf(t({ due_on: '2026-07-06' }), sunday), 'later', 'on Sunday, tomorrow is next week');
  });

  test('the list counts buckets on the injected day', async () => {
    const { today } = fakeToday();
    const at = londonToUtc(today, '12:00').toISOString();
    const mk = body => w.ok('POST', `/api/tasks?at=${at}`, { as: w.coach, body });
    await mk({ title: 'Late thing', dueOn: addDays(today, -1) });
    await mk({ title: 'Now thing', dueOn: today });
    await mk({ title: 'Someday' });
    const r = await w.ok('GET', `/api/tasks?at=${at}`, { as: w.coach });
    assert.equal(r.today, today);
    assert.equal(r.weekEnd, addDays(mondayOf(today), 6));
    assert.equal(r.tasks.find(x => x.title === 'Late thing').bucket, 'overdue');
    assert.equal(r.tasks.find(x => x.title === 'Now thing').bucket, 'today');
    assert.equal(r.tasks.find(x => x.title === 'Someday').bucket, 'none');
    assert.ok(r.counts.overdue >= 1 && r.counts.today >= 1 && r.counts.none >= 1);
    const only = await w.ok('GET', `/api/tasks?bucket=overdue&at=${at}`, { as: w.coach });
    assert.ok(only.tasks.every(x => x.bucket === 'overdue'));
  });
});

describe('the task API', () => {
  test('create, edit, done and undo, snooze, delete', async () => {
    const at = '2026-11-24T10:00:00.000Z';
    const { task } = await w.ok('POST', `/api/tasks?at=${at}`, { as: w.coach, body: { title: 'Call Sam', clientId: w.client.id, dueOn: '2026-11-25', dueTime: '09:30', tags: ['#Billing'], priority: 'high' } });
    assert.equal(task.client.id, w.client.id);
    assert.equal(task.dueAt, '2026-11-25T09:30:00.000Z');
    assert.deepEqual(task.tags, ['billing']);
    // Moving the day keeps the time.
    let t = (await w.ok('PATCH', `/api/tasks/${task.id}?at=${at}`, { as: w.coach, body: { dueOn: '2026-11-27' } })).task;
    assert.equal(t.dueAt, '2026-11-27T09:30:00.000Z');
    t = (await w.ok('POST', `/api/tasks/${task.id}/done?at=${at}`, { as: w.coach })).task;
    assert.equal(t.status, 'done');
    assert.equal(t.bucket, 'done');
    await w.ok('POST', `/api/tasks/${task.id}/done?at=${at}`, { as: w.coach });
    await w.settle();
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM events WHERE type='task.done'").get().n, 1, 'done twice emits once');
    t = (await w.ok('POST', `/api/tasks/${task.id}/reopen?at=${at}`, { as: w.coach })).task;
    assert.equal(t.status, 'open');
    t = (await w.ok('POST', `/api/tasks/${task.id}/snooze?at=${at}`, { as: w.coach, body: { until: '2026-12-01' } })).task;
    assert.equal(t.dueOn, '2026-12-01');
    assert.equal(t.dueAt, '2026-12-01T09:30:00.000Z');
    assert.equal((await w.call('POST', `/api/tasks/${task.id}/snooze?at=${at}`, { as: w.coach, body: { until: '2026-11-01' } })).status, 400);
    assert.equal((await w.call('POST', '/api/tasks', { as: w.coach, body: { title: '' } })).status, 400);
    assert.equal((await w.call('POST', '/api/tasks', { as: w.coach, body: { title: 'x', priority: 'urgent' } })).status, 400);
    await w.ok('DELETE', `/api/tasks/${task.id}`, { as: w.coach });
    assert.equal((await w.call('GET', `/api/tasks/${task.id}`, { as: w.coach })).status, 404);
  });

  test('parse answers with the coach\'s own clients', async () => {
    const p = await w.ok('POST', '/api/tasks/parse?at=2026-11-24T10:00:00.000Z', { as: w.coach, body: { text: 'Call Sam tomorrow 9am #billing !high' } });
    assert.equal(p.clientId, w.client.id);
    assert.equal(p.title, 'Call Sam');
    assert.equal(p.dueOn, '2026-11-25');
  });

  test('search, diary, timeline and badges hooks', async () => {
    const at = '2026-11-24T10:00:00.000Z';
    const { task } = await w.ok('POST', `/api/tasks?at=${at}`, { as: w.coach, body: { title: 'Zebra stretch review', clientId: w.client.id, dueOn: '2026-11-24' } });
    const s = await w.ok('GET', '/api/search?q=zebra', { as: w.coach });
    assert.ok(s.results.some(r => r.type === 'task' && r.id === task.id));
    const { hooks } = await import('../registry.mjs');
    const coach = w.coach.row;
    const [[, diary]] = hooks('diary').filter(([f]) => f.name === 'tasks');
    assert.ok(diary(w.db, coach, '2026-11-24').some(i => i.title === 'Zebra stretch review' && i.kind === 'task'));
    const [[, timeline]] = hooks('timeline').filter(([f]) => f.name === 'tasks');
    assert.ok(timeline(w.db, coach, w.client.row, null, 20).some(i => i.title.includes('Zebra')));
    const b = await w.ok('GET', '/api/coach/badges', { as: w.coach });
    assert.ok(b.badges.tasks >= 1);
  });
});

describe('the due clock', () => {
  test('a task with a time notifies once at that time', async () => {
    const created = '2026-11-24T08:00:00.000Z';
    const { task } = await w.ok('POST', `/api/tasks?at=${created}`, { as: w.coach, body: { title: 'Ring the physio', dueAt: '2026-11-24T11:00:00.000Z' } });
    const notices = () => w.db.prepare("SELECT COUNT(*) n FROM coach_notifications WHERE kind='task' AND path LIKE ?").get(`%${task.id}`).n;
    await w.tick('tasks.due', new Date('2026-11-24T10:59:00.000Z'));
    assert.equal(notices(), 0, 'not before it is due');
    await w.tick('tasks.due', new Date('2026-11-24T11:00:30.000Z'));
    await w.tick('tasks.due', new Date('2026-11-24T11:01:30.000Z'));
    await w.settle();
    assert.equal(notices(), 1, 'exactly once');
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM events WHERE type='task.due' AND payload LIKE ?").get(`%${task.id}%`).n, 1);
    // Snoozing re-arms it for the new time.
    await w.ok('POST', `/api/tasks/${task.id}/snooze?at=2026-11-24T11:05:00.000Z`, { as: w.coach, body: { until: '2026-11-24T15:00:00.000Z' } });
    await w.tick('tasks.due', new Date('2026-11-24T15:00:10.000Z'));
    await w.tick('tasks.due', new Date('2026-11-24T15:01:10.000Z'));
    assert.equal(notices(), 2);
  });

  test('a dated task without a time is due at 08:00 London; one made already overdue stays quiet', async () => {
    const { task } = await w.ok('POST', '/api/tasks?at=2026-07-01T06:00:00.000Z', { as: w.coach, body: { title: 'Summer plan', dueOn: '2026-07-02' } });
    const late = (await w.ok('POST', '/api/tasks?at=2026-07-03T12:00:00.000Z', { as: w.coach, body: { title: 'Already late', dueOn: '2026-07-02' } })).task;
    const n = id => w.db.prepare("SELECT COUNT(*) n FROM coach_notifications WHERE kind='task' AND path LIKE ?").get(`%${id}`).n;
    await w.tick('tasks.due', new Date('2026-07-02T06:59:00.000Z')); // 07:59 BST
    assert.equal(n(task.id), 0);
    await w.tick('tasks.due', new Date('2026-07-02T07:00:30.000Z')); // 08:00 BST
    assert.equal(n(task.id), 1);
    await w.tick('tasks.due', new Date('2026-07-03T12:01:00.000Z'));
    assert.equal(n(late.id), 0);
    assert.equal(w.db.prepare('SELECT due_notified FROM tasks WHERE id=?').get(late.id).due_notified, '2026-07-02', 'marked, so never sent later');
  });
});

describe('the task.create action', () => {
  test('renders the title for the client and records where it came from', async () => {
    const now = new Date('2026-11-24T10:00:00.000Z');
    const out = runAction(w.db, w.config, 'task.create', { coachId: w.coach.id, client: { id: w.client.id }, params: { title: 'Call {first} about the knee', notes: 'For {name}', dueInDays: 2, priority: 'high' }, now });
    assert.equal(out, 'Created task');
    const t = w.db.prepare("SELECT * FROM tasks WHERE title='Call Sam about the knee'").get();
    assert.ok(t);
    assert.equal(t.notes, 'For Sam Carter');
    assert.equal(t.due_on, '2026-11-26');
    assert.equal(t.priority, 'high');
    assert.equal(t.source, 'automation');
    runAction(w.db, w.config, 'task.create', { coachId: w.coach.id, client: { id: w.client.id }, params: { title: 'Voice follow-up' }, now, event: { type: 'voice.flagged', payload: { messageId: 'm_1' } } });
    const v = w.db.prepare("SELECT * FROM tasks WHERE title='Voice follow-up'").get();
    assert.equal(v.source, 'voice');
    assert.equal(v.source_ref, 'm_1');
    await w.settle();
    assert.ok(w.db.prepare("SELECT 1 FROM events WHERE type='task.created' AND client_id=?").get(w.client.id));
  });
});

describe('isolation, reassignment, export and erasure', () => {
  let other, otherClient, mine;
  before(async () => {
    other = await w.signIn('wp8-coach2', 'coach2@example.com');
    otherClient = w.user('Olive Other', 'client', other.id);
    mine = (await w.ok('POST', '/api/tasks', { as: w.coach, body: { title: 'Mine only', clientId: w.client.id } })).task;
  });

  test('every task route is a 404 across coaches, and a client gets 403', async () => {
    const routes = [['GET', `/api/tasks/${mine.id}`], ['PATCH', `/api/tasks/${mine.id}`, { title: 'x' }], ['DELETE', `/api/tasks/${mine.id}`],
      ['POST', `/api/tasks/${mine.id}/done`], ['POST', `/api/tasks/${mine.id}/reopen`], ['POST', `/api/tasks/${mine.id}/snooze`, { until: '2099-01-01' }]];
    for (const [method, path, body] of routes) assert.equal((await w.call(method, path, { as: other, body })).status, 404, `${method} ${path}`);
    assert.equal((await w.call('POST', '/api/tasks', { as: other, body: { title: 'Steal', clientId: w.client.id } })).status, 404, 'clientId must be own');
    assert.equal((await w.call('GET', `/api/tasks?clientId=${w.client.id}`, { as: other })).status, 404);
    assert.ok(!(await w.ok('GET', '/api/tasks', { as: other })).tasks.some(t => t.id === mine.id));
    for (const [method, path, body] of [['GET', '/api/tasks'], ['POST', '/api/tasks', { title: 'x' }], ['POST', '/api/tasks/parse', { text: 'x' }], ['GET', `/api/tasks/${mine.id}`]]) {
      assert.equal((await w.call(method, path, { as: w.client, body })).status, 403, `client ${method} ${path}`);
    }
    assert.equal((await w.call('PATCH', `/api/tasks/${mine.id}`, { as: w.coach, body: { clientId: otherClient.id } })).status, 404);
  });

  test('a reassigned client\'s tasks move with them', async () => {
    const moved = w.user('Mover Client', 'client', w.coach.id);
    const { task } = await w.ok('POST', '/api/tasks', { as: w.coach, body: { title: 'About the mover', clientId: moved.id } });
    w.db.prepare('UPDATE users SET coach_id=? WHERE id=?').run(other.id, moved.id);
    assert.equal((await w.call('GET', `/api/tasks/${task.id}`, { as: w.coach })).status, 404, 'the old coach loses it');
    assert.equal((await w.ok('GET', `/api/tasks/${task.id}`, { as: other })).task.title, 'About the mover', 'the new coach has it');
  });

  test('the client export has the tasks about them, and erasure leaves nothing', async () => {
    const leaver = await w.signIn('wp8-leaver', 'leaver@example.com', { givenName: 'Lee', familyName: 'Ver' });
    await w.ok('POST', '/api/tasks', { as: w.coach, body: { title: 'Lee follow-up', clientId: leaver.id } });
    const exp = await w.ok('GET', '/api/me/export', { as: leaver });
    assert.deepEqual(exp.features.tasks.tasks.map(t => t.title), ['Lee follow-up']);
    await w.ok('DELETE', '/api/me', { as: leaver });
    assertNoRowsFor(w.db, leaver.id);
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM tasks WHERE title='Lee follow-up'").get().n, 0);
  });
});
