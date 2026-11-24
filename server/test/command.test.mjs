/**
 * WP1 Command (docs/design/desk-v2.md F1–F4): the summary, the activity feed,
 * the morning brief, search, the default notifications and the Inbox.
 *
 * Features load from a temp FEATURES_DIR (honoured only with NODE_ENV=test):
 * the real command feature, plus two fixtures: `zz-provider` adds Inbox items
 * (one of them for a client of another coach, which must be dropped) and a
 * search result, and `zz-broken` throws from every hook.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const FEATURES = mkdtempSync(join(tmpdir(), 'jk-command-features-'));
const real = pathToFileURL(new URL('../features/command.mjs', import.meta.url).pathname).href;
writeFileSync(join(FEATURES, 'command.mjs'), `export { feature } from ${JSON.stringify(real)};\n`);
writeFileSync(join(FEATURES, 'zz-provider.mjs'), `export const feature = {
  name: 'zz-provider',
  inbox(db, coach) {
    const other = db.prepare("SELECT id FROM users WHERE role='client' AND coach_id<>? LIMIT 1").get(coach.id);
    return [
      { key: 'lead:ld_fixture', kind: 'lead', clientId: null, title: 'New lead: Morgan Lee', preview: 'Wants 1:1s', at: '2026-01-01T09:00:00.000Z', icon: 'person_add', tone: 'ok', path: '/pipeline/ld_fixture',
        actions: [{ id: 'convert', label: 'Convert', method: 'POST', url: '/api/leads/ld_fixture/convert' }, { id: 'bad', label: 'Bad', method: 'POST', url: 'https://evil.example/' }] },
      ...(other ? [{ key: 'lead:foreign', kind: 'lead', clientId: other.id, title: 'Not yours' }] : []),
    ];
  },
  search(db, coach, q) { return q === 'fixture' ? [{ type: 'lead', id: 'ld_fixture', title: 'Fixture lead', detail: 'From a hook', path: '/pipeline/ld_fixture', icon: 'person_add', score: 0.9 }] : []; },
};\n`);
writeFileSync(join(FEATURES, 'zz-broken.mjs'), `export const feature = {
  name: 'zz-broken',
  inbox() { throw new Error('broken inbox provider'); },
  search() { throw new Error('broken search provider'); },
  badges() { throw new Error('broken badges'); },
};\n`);
process.env.NODE_ENV = 'test';
process.env.FEATURES_DIR = FEATURES;

const { makeWorld, assertNoRowsFor, fakeToday } = await import('./helpers.mjs');
const { addDays, londonToUtc } = await import('../time.mjs');
const { newId, nowIso, setCoachPref } = await import('../store.mjs');
const { emit } = await import('../events.mjs');
const { buildDemo } = await import('../demo.mjs');

// Broken hooks log on purpose; keep the output readable.
const quiet = console.error;
before(() => { console.error = (...a) => { if (!/broken|zz-broken/.test(String(a[0]))) quiet(...a); }; });
after(() => { console.error = quiet; });

let w, coach2, other;
before(async () => {
  w = await makeWorld();
  coach2 = await w.signIn('c2', 'coach2@example.com', { givenName: 'Kim', familyName: 'Cole' });
  other = w.user('Olly Other', 'client', coach2.id);
  await w.settle();
});
after(() => w.close());

const { today, now } = fakeToday();
const at = (d, t) => londonToUtc(d, t).toISOString();
const msg = (clientId, text, { from = 'client', when = nowIso(), read = null, kind = 'text' } = {}) => {
  const id = newId('m');
  w.db.prepare('INSERT INTO messages (id, client_id, from_id, from_role, text, at, read_at, kind) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, clientId, clientId, from, text, when, read, kind);
  return id;
};
const checkin = (clientId, week, pain = [], note = 'Good week') => {
  const id = newId('c');
  w.db.prepare('INSERT INTO checkins (id, client_id, week, energy, sleep, pain, note, submitted_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, clientId, week, 4, 3, JSON.stringify(pain), note, nowIso());
  return id;
};
const formRequest = (clientId, answers, questions = [{ id: 'heart', kind: 'yesno', flag: true, label: 'Heart condition?' }, { id: 'more', kind: 'long', label: 'Anything else?' }]) => {
  const id = newId('fr');
  w.db.prepare('INSERT INTO form_requests (id, client_id, name, intro, questions, sent_at, answers, submitted_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, clientId, 'PAR-Q health check', '', JSON.stringify(questions), nowIso(), JSON.stringify(answers), nowIso());
  return id;
};
const inbox = async (as = w.coach, query = '') => w.ok('GET', `/api/inbox${query}`, { as });

describe('F1: summary, activity and the brief', () => {
  test('the summary counts match the needs-you output', async () => {
    msg(w.client.id, 'Can we move Thursday?');
    const needs = await w.ok('GET', '/api/coach/needs-you', { as: w.coach });
    const s = await w.ok('GET', '/api/command/summary', { as: w.coach });
    assert.equal(s.needs, needs.items.length);
    assert.equal(s.sessionsToday, needs.sessionsToday.total);
    assert.equal(s.lettersDue, needs.lettersDue.count);
    assert.equal(s.urgent, needs.items.filter(i => i.rank === 1).length);
    const box = await inbox();
    assert.equal(s.inbox, box.counts.all);
    assert.equal(s.duePence, null, 'no billing fact without the billing feature');
    assert.equal((await w.call('GET', '/api/command/summary', { as: w.client })).status, 403);
  });

  test('activity is coach-scoped, survives reassignment and pages with before', async () => {
    for (let i = 0; i < 5; i++) emit(w.db, 'workout.completed', { coachId: w.coach.id, clientId: w.client.id, summary: `Finished Day ${i}`, workoutId: `w${i}`, feel: 3 });
    emit(w.db, 'workout.completed', { coachId: coach2.id, clientId: other.id, summary: 'Finished Secret', workoutId: 'wx', feel: 3 });
    emit(w.db, 'day.started', { coachId: w.coach.id, day: today });
    await w.settle();
    const page1 = await w.ok('GET', '/api/command/activity?limit=3', { as: w.coach });
    assert.equal(page1.items.length, 3);
    assert.ok(page1.items.every(i => i.seq && i.type !== 'day.started'));
    assert.deepEqual(page1.items.map(i => i.summary), ['Finished Day 4', 'Finished Day 3', 'Finished Day 2']);
    assert.equal(page1.items[0].client.name, 'Sam Carter');
    assert.equal(page1.items[0].path, `/clients/${w.client.id}/plan`);
    const page2 = await w.ok('GET', `/api/command/activity?limit=3&before=${page1.next}`, { as: w.coach });
    assert.deepEqual(page2.items.slice(0, 2).map(i => i.summary), ['Finished Day 1', 'Finished Day 0']);
    assert.ok(page2.items.every(i => !page1.items.some(p => p.key === i.key)), 'no overlap between pages');
    const all = await w.ok('GET', '/api/command/activity?limit=100', { as: w.coach });
    assert.ok(!JSON.stringify(all).includes('Secret'), 'a second coach’s events are never returned');
    const theirs = await w.ok('GET', '/api/command/activity?limit=100', { as: coach2 });
    assert.ok(theirs.items.some(i => i.summary === 'Finished Secret'));
    assert.ok(!theirs.items.some(i => /Day \d/.test(i.summary)));
    assert.equal((await w.call('GET', '/api/command/activity?before=yesterday', { as: w.coach })).status, 400);

    // Reassignment: the old coach no longer sees the moved client's rows; the new one does.
    const moved = w.user('Mo Moved', 'client', w.coach.id);
    emit(w.db, 'workout.completed', { coachId: w.coach.id, clientId: moved.id, summary: 'Finished Moved', workoutId: 'wm', feel: 3 });
    await w.settle();
    assert.ok((await w.ok('GET', '/api/command/activity?limit=100', { as: w.coach })).items.some(i => i.summary === 'Finished Moved'));
    w.db.prepare('UPDATE users SET coach_id=? WHERE id=?').run(coach2.id, moved.id);
    msg(moved.id, 'Hello new coach');
    assert.ok(!(await w.ok('GET', '/api/command/activity?limit=100', { as: w.coach })).items.some(i => i.summary === 'Finished Moved'));
    assert.ok(!(await inbox()).items.some(i => i.clientId === moved.id), 'the old coach’s inbox drops the moved client');
    assert.ok((await inbox(coach2)).items.some(i => i.clientId === moved.id), 'the new coach’s inbox has them');
    w.db.prepare('DELETE FROM users WHERE id=?').run(moved.id);
  });

  test('history fills the feed before the first event (summaries only, never bodies)', async () => {
    const fresh = await w.signIn('c3', 'coach3@example.com');
    w.db.prepare("UPDATE users SET role='coach', coach_id=NULL WHERE id=?").run(fresh.id);
    const c = w.user('Hana Hist', 'client', fresh.id);
    msg(c.id, 'A private body text', { when: new Date(Date.now() - 3_600_000).toISOString() });
    const out = await w.ok('GET', '/api/command/activity', { as: fresh });
    const m = out.items.find(i => i.type === 'message.received');
    assert.ok(m && m.history && m.seq === null);
    assert.equal(m.summary, 'Message');
    assert.ok(!JSON.stringify(out).includes('private body'));
    assert.ok(out.items.some(i => i.type === 'client.joined' && i.client.name === 'Hana Hist'));
    w.db.prepare('DELETE FROM users WHERE id IN (?,?)').run(c.id, fresh.id);
  });

  test('the brief uses the labelled stub when no key is set', async () => {
    const b = await w.ok('POST', '/api/command/brief', { as: w.coach });
    assert.equal(b.provider, 'stub');
    assert.equal(b.title, '[Stub] Brief');
    assert.equal(b.bullets.length, 5);
    assert.ok(b.bullets.every(x => typeof x === 'string' && x.length > 10));
    assert.ok(!b.bullets.join(' ').includes('Carter'), 'first names only');
    const call = w.db.prepare("SELECT * FROM ai_calls WHERE coach_id=? AND purpose='brief' ORDER BY at DESC").get(w.coach.id);
    assert.equal(call.provider, 'stub');
    assert.equal((await w.call('POST', '/api/command/brief', { as: w.client })).status, 403);
  });

  test('the demo coach gets the stub even with a key in config; a real coach reaches the provider', async () => {
    const w2 = await makeWorld({ config: { ai: { key: 'fake-key', model: 'some/model', audioModel: null, dailyCalls: 300, dailyAudioSeconds: 7200, clientDailyNotes: 20, clientDailyAudioSeconds: 1800, disabled: false, baseUrl: 'https://openrouter.ai/api/v1' } } });
    try {
      const calls = [];
      w2.onFetch(async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return { ok: true, status: 200, json: async () => ({ model: 'some/model', choices: [{ message: { content: JSON.stringify({ bullets: ['One thing', 'Two things', 'Three things'] }) } }] }) };
      });
      const demo = w2.user('Demo Coach', 'coach', null, { isDemo: true });
      const b = await w2.ok('POST', '/api/command/brief', { as: demo });
      assert.equal(b.provider, 'stub');
      assert.equal(b.title, '[Stub] Brief');
      assert.equal(calls.length, 0, 'no network for a demo coach');
      const real = await w2.ok('POST', '/api/command/brief', { as: w2.coach });
      assert.equal(real.provider, 'openrouter');
      assert.equal(real.title, 'Brief');
      assert.deepEqual(real.bullets, ['One thing', 'Two things', 'Three things']);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].body.provider.data_collection, 'deny');
      assert.ok(!calls[0].body.messages[1].content[0].text.includes('Carter'), 'surnames never go to the model');
    } finally { w2.close(); }
  });
});

describe('F2: search', () => {
  test('/api/search merges the built-ins and the hooks, and a throwing hook is skipped', async () => {
    msg(w.client.id, 'fixture talk in a message');
    checkin(w.client.id, '2025-01-06', [], 'fixture note about sleep');
    const out = await w.ok('GET', '/api/search?q=fixture', { as: w.coach });
    const types = new Set(out.results.map(r => r.type));
    assert.ok(types.has('message'), 'built-in messages');
    assert.ok(types.has('lead'), 'a feature hook');
    assert.ok(types.has('checkin'), 'command’s own check-in hook');
    const ck = out.results.find(r => r.type === 'checkin');
    assert.equal(ck.path, `/clients/${w.client.id}/checkins`);
  });

  test('q under 2 characters is a 400; LIKE wildcards are literal; coaches are scoped', async () => {
    assert.equal((await w.call('GET', '/api/search?q=a', { as: w.coach })).status, 400);
    msg(other.id, 'olly secret fixture plan');
    checkin(other.id, '2025-01-06', [], 'olly checkin words');
    const pct = await w.ok('GET', '/api/search?q=%25%25', { as: w.coach });
    assert.equal(pct.results.length, 0, '"%%" matches nothing literal');
    const under = await w.ok('GET', '/api/search?q=__', { as: w.coach });
    assert.equal(under.results.filter(r => r.type === 'checkin').length, 0);
    const mine = await w.ok('GET', '/api/search?q=olly', { as: w.coach });
    assert.equal(mine.results.length, 0, 'another coach’s client, message and check-in are invisible');
    const theirs = await w.ok('GET', '/api/search?q=olly', { as: coach2 });
    assert.ok(theirs.results.some(r => r.type === 'checkin'));
    assert.equal((await w.call('GET', '/api/search?q=olly', { as: w.client })).status, 403);
  });

  test('the demo coach sees only demo rows', async () => {
    buildDemo(w.db, today, w.config);
    const demo = w.db.prepare("SELECT * FROM users WHERE apple_sub='demo-coach'").get();
    const { issueSession } = await import('../auth.mjs');
    const token = issueSession(w.db, demo.id);
    msg(w.client.id, 'Quick one about Thursday');
    const out = await w.ok('GET', '/api/search?q=Thursday', { token });
    assert.ok(out.results.length > 0);
    const demoIds = new Set(w.db.prepare('SELECT id FROM users WHERE is_demo=1').all().map(u => u.id));
    for (const r of out.results.filter(x => x.type === 'message' || x.type === 'checkin')) {
      const clientId = r.path.split('/')[2];
      assert.ok(demoIds.has(clientId), `${r.type} ${r.title} is a demo row`);
    }
    // The demo world gives every Command Centre tile something to show.
    const atNow = `?at=${encodeURIComponent(now.toISOString())}`;
    const s = await w.ok('GET', `/api/command/summary${atNow}`, { token });
    assert.ok(s.needs >= 4 && s.sessionsToday >= 3 && s.inbox >= 3, JSON.stringify(s));
    const box = await w.ok('GET', `/api/inbox${atNow}`, { token });
    for (const k of ['message', 'form', 'checkin', 'flag']) assert.ok(box.counts[k] > 0, `demo inbox has ${k}`);
    assert.ok(box.counts.snoozed >= 1);
    const feed = await w.ok('GET', `/api/command/activity${atNow}`, { token });
    assert.ok(feed.items.length >= 10, 'the demo feed is alive');
    const bell = await w.ok('GET', '/api/notifications', { token });
    assert.ok(bell.unread >= 1);
  });
});

describe('F3: default notifications', () => {
  const notes = (kind, coachId = w.coach.id) => w.db.prepare('SELECT * FROM coach_notifications WHERE coach_id=? AND kind=?').all(coachId, kind);

  test('each handler creates exactly one notification (dedupe works)', async () => {
    // client.joined: a new sign-up.
    const ella = await w.signIn('ella', 'ella@example.com', { givenName: 'Ella', familyName: 'Hughes' });
    await w.settle();
    emit(w.db, 'client.joined', { coachId: w.coach.id, clientId: ella.id, summary: 'Joined', email: 'ella@example.com' });
    await w.settle();
    const joined = notes('newClient').filter(n => n.client_id === ella.id);
    assert.equal(joined.length, 1);
    assert.equal(joined[0].title, 'New client: Ella Hughes');

    // booking.cancelled by the client (late).
    const start = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const bid = newId('b');
    w.db.prepare("INSERT INTO bookings (id, coach_id, client_id, kind, start, end, title, created_at) VALUES (?,?,?,'inperson',?,?,'1:1',?)")
      .run(bid, w.coach.id, w.client.id, start, new Date(Date.parse(start) + 3_600_000).toISOString(), nowIso());
    await w.ok('DELETE', `/api/bookings/${bid}`, { as: w.client });
    await w.settle();
    const cancelled = notes('cancellation');
    assert.equal(cancelled.length, 1);
    assert.match(cancelled[0].title, /^Sam cancelled (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+ \w{3} \d\d:\d\d \(late\)$/);
    // A coach cancelling is not news to the coach.
    const bid2 = newId('b');
    w.db.prepare("INSERT INTO bookings (id, coach_id, client_id, kind, start, end, title, created_at) VALUES (?,?,?,'inperson',?,?,'1:1',?)")
      .run(bid2, w.coach.id, w.client.id, new Date(Date.now() + 86_400_000 * 3).toISOString(), new Date(Date.now() + 86_400_000 * 3 + 3_600_000).toISOString(), nowIso());
    await w.ok('DELETE', `/api/bookings/${bid2}`, { as: w.coach });
    await w.settle();
    assert.equal(notes('cancellation').length, 1);

    // form.submitted with a flag: through the real endpoints.
    const form = await w.ok('POST', '/api/forms', { as: w.coach, body: { name: 'PAR-Q', questions: [{ id: 'heart', kind: 'yesno', flag: true, label: 'Heart condition?' }] } });
    const req = await w.ok('POST', `/api/forms/${form.id ?? form.form?.id}/send`, { as: w.coach, body: { clientId: w.client.id } });
    await w.ok('POST', `/api/form-requests/${req.id}/answers`, { as: w.client, body: { answers: { heart: true } } });
    await w.settle();
    const flags = notes('healthFlag');
    assert.equal(flags.length, 1);
    assert.equal(flags[0].title, 'Health flag on PAR-Q: Sam');
    assert.equal(flags[0].tone, 'urgent');

    // checkin.submitted with pain, submitted twice: one notification.
    const body = { energy: 3, sleep: 3, pain: ['Knee'], note: 'Knee niggle' };
    await w.ok('POST', '/api/checkins', { as: w.client, body });
    await w.ok('POST', '/api/checkins', { as: w.client, body });
    await w.settle();
    const pain = notes('pain');
    assert.equal(pain.length, 1, 'a re-submit is deduped');
    assert.equal(pain[0].title, 'Pain reported in check-in: Sam');
    assert.equal(pain[0].body, 'Sore: knee');
    // A check-in without pain says nothing.
    emit(w.db, 'checkin.submitted', { coachId: w.coach.id, clientId: w.client.id, checkinId: 'none', week: today, pain: false });
    await w.settle();
    assert.equal(notes('pain').length, 1);
    // An event about another coach's client never notifies this coach.
    emit(w.db, 'client.joined', { coachId: w.coach.id, clientId: other.id, email: 'o@example.com' });
    await w.settle();
    assert.equal(notes('newClient').filter(n => n.client_id === other.id).length, 0);
    w.db.prepare('DELETE FROM users WHERE id=?').run(ella.id);
  });

  test('turning a kind off suppresses it; settings validate', async () => {
    const s = await w.ok('PUT', '/api/command/notify-settings', { as: w.coach, body: { kinds: { newClient: false }, pushUrgent: false, quietHours: { start: '21:30', end: '07:00' } } });
    assert.equal(s.kinds.find(k => k.kind === 'newClient').on, false);
    assert.equal(s.kinds.find(k => k.kind === 'pain').on, true);
    assert.equal(s.pushUrgent, false);
    assert.deepEqual(s.quietHours, { start: '21:30', end: '07:00' });
    const zed = await w.signIn('zed', 'zed@example.com', { givenName: 'Zed', familyName: 'Ray' });
    emit(w.db, 'client.joined', { coachId: w.coach.id, clientId: zed.id, email: 'zed@example.com' });
    await w.settle();
    assert.equal(notes('newClient').filter(n => n.client_id === zed.id).length, 0);
    assert.equal((await w.call('PUT', '/api/command/notify-settings', { as: w.coach, body: { kinds: { nope: true } } })).status, 400);
    assert.equal((await w.call('PUT', '/api/command/notify-settings', { as: w.coach, body: { quietHours: { start: '25:00', end: '07:00' } } })).status, 400);
    const none = await w.ok('PUT', '/api/command/notify-settings', { as: w.coach, body: { quietHours: null, kinds: { newClient: true }, pushUrgent: true } });
    assert.equal(none.quietHours, null);
    assert.equal((await w.ok('GET', '/api/command/notify-settings', { as: coach2 })).kinds.every(k => k.on), true, 'per coach');
    assert.equal((await w.call('GET', '/api/command/notify-settings', { as: w.client })).status, 403);
    w.db.prepare('DELETE FROM users WHERE id=?').run(zed.id);
  });

  test('the read and count endpoints work', async () => {
    const before = (await w.ok('GET', '/api/notifications/count', { as: w.coach })).unread;
    assert.ok(before >= 3);
    const list = await w.ok('GET', '/api/notifications?unread=1', { as: w.coach });
    const one = list.items[0];
    const after1 = await w.ok('POST', '/api/notifications/read', { as: w.coach, body: { ids: [one.id] } });
    assert.equal(after1.unread, before - 1);
    assert.equal((await w.call('POST', '/api/notifications/read', { as: coach2, body: { ids: [list.items[1].id] } })).status, 404);
    assert.equal((await w.ok('POST', '/api/notifications/read', { as: w.coach, body: { all: true } })).unread, 0);
  });

  test('the stream receives a notification from a handler', async () => {
    const ac = new AbortController();
    const res = await fetch(`${w.base}/api/coach/stream`, { headers: { authorization: `Bearer ${w.coach.token}` }, signal: ac.signal });
    const reader = res.body.getReader();
    let text = '';
    const until = async re => { while (!re.test(text)) { const { value, done } = await reader.read(); if (done) break; text += Buffer.from(value).toString('utf8'); } };
    await until(/: connected/);
    const ivy = await w.signIn('ivy', 'ivy@example.com', { givenName: 'Ivy', familyName: 'Stone' });
    emit(w.db, 'client.joined', { coachId: w.coach.id, clientId: ivy.id, email: 'ivy@example.com' });
    await w.settle();
    await until(/event: notification\ndata: .*New client: Ivy Stone/);
    assert.match(text, /"kind":"newClient"/);
    ac.abort();
    w.db.prepare('DELETE FROM users WHERE id=?').run(ivy.id);
  });
});

describe('F4: the Inbox', () => {
  let tia;
  before(() => {
    tia = w.user('Tia Inbox', 'client', w.coach.id);
    w.db.prepare("UPDATE messages SET read_at=? WHERE from_role='client' AND read_at IS NULL").run(nowIso());
    w.db.prepare('UPDATE checkins SET reviewed_at=? WHERE reviewed_at IS NULL').run(nowIso());
    w.db.prepare('UPDATE form_requests SET reviewed_at=? WHERE reviewed_at IS NULL AND submitted_at IS NOT NULL').run(nowIso());
  });

  test('every core kind appears; a provider that throws does not break it; foreign provider items are dropped', async () => {
    msg(tia.id, 'Thursday works for me');
    const voiceClient = w.user('Vic Voice', 'client', w.coach.id);
    msg(voiceClient.id, '', { kind: 'voice' });
    const painClient = w.user('Pam Pain', 'client', w.coach.id);
    msg(painClient.id, 'My shoulder is painful after bench');
    checkin(tia.id, '2025-02-03', [], 'Solid week, slept well');
    checkin(painClient.id, '2025-02-03', ['Lower back']);
    formRequest(tia.id, { heart: false, more: 'All good' });
    formRequest(painClient.id, { heart: true });
    const box = await inbox();
    const kinds = new Set(box.items.map(i => i.kind));
    for (const k of ['message', 'voice', 'checkin', 'form', 'flag', 'lead']) assert.ok(kinds.has(k), `has ${k}`);
    const flags = box.items.filter(i => i.kind === 'flag');
    assert.deepEqual(flags.map(i => i.key.split(':')[1]).sort(), ['checkin', 'form', 'thread']);
    assert.ok(flags.every(i => i.tone === 'urgent' && i.client.name === 'Pam Pain'));
    assert.equal(box.items[0].tone, 'urgent', 'flags come first');
    assert.ok(!box.items.some(i => i.key === 'lead:foreign'), 'an item for another coach’s client is dropped');
    const lead = box.items.find(i => i.key === 'lead:ld_fixture');
    assert.deepEqual(lead.actions.map(a => a.id), ['convert'], 'actions must be /api/ paths');
    assert.equal(box.counts.all, box.items.length);
    assert.equal(box.counts.flag, 3);
    assert.equal(box.counts.message, 1);
    assert.equal(box.counts.voice, 1);
    assert.equal(box.items.find(i => i.kind === 'form').title, 'Answered PAR-Q health check');
    assert.equal(box.items.find(i => i.key.startsWith('flag:form:')).title, 'Health flag on PAR-Q health check');
    const onlyForms = await inbox(w.coach, '?filter=form');
    assert.ok(onlyForms.items.every(i => i.kind === 'form') && onlyForms.items.length === 1);
    assert.equal((await w.call('GET', '/api/inbox?filter=%25bad', { as: w.coach })).status, 400);
    assert.equal((await w.call('GET', '/api/inbox', { as: w.client })).status, 403);
    // Badges: the open count, even with a provider whose badges hook throws.
    const badges = await w.ok('GET', '/api/coach/badges', { as: w.coach });
    assert.equal(badges.badges.inbox, box.counts.all);
    w.db.prepare('DELETE FROM users WHERE id IN (?,?)').run(voiceClient.id, painClient.id);
  });

  test('done hides an item, and a new message makes the thread reappear', async () => {
    const box = await inbox();
    const thread = box.items.find(i => i.clientId === tia.id && i.kind === 'message');
    await w.ok('POST', '/api/inbox/state', { as: w.coach, body: { keys: [thread.key], status: 'done' } });
    await w.settle();
    let now1 = await inbox();
    assert.ok(!now1.items.some(i => i.key === thread.key));
    assert.ok((await inbox(w.coach, '?filter=done')).items.some(i => i.key === thread.key && i.status === 'done'));
    assert.equal(now1.counts.done, 1);
    const ev = w.db.prepare("SELECT * FROM events WHERE type='inbox.done' AND coach_id=? ORDER BY seq DESC").get(w.coach.id);
    assert.equal(ev.client_id, tia.id);
    assert.equal(JSON.parse(ev.payload).key, thread.key);
    msg(tia.id, 'Actually, one more thing');
    now1 = await inbox();
    const back = now1.items.find(i => i.clientId === tia.id && i.kind === 'message');
    assert.ok(back && back.key !== thread.key, 'the new message reopens the thread under a new key');
    assert.equal(back.title, 'Sent 2 messages');
    // Reopen (status open) brings a done item back.
    const ck = now1.items.find(i => i.kind === 'checkin');
    await w.ok('POST', '/api/inbox/state', { as: w.coach, body: { keys: [ck.key], status: 'done' } });
    assert.ok(!(await inbox()).items.some(i => i.key === ck.key));
    await w.ok('POST', '/api/inbox/state', { as: w.coach, body: { keys: [ck.key], status: 'open' } });
    assert.ok((await inbox()).items.some(i => i.key === ck.key));
  });

  test('snooze hides an item until its time passes', async () => {
    const box = await inbox();
    const form = box.items.find(i => i.kind === 'form');
    const until = new Date(Date.now() + 2 * 3_600_000).toISOString();
    assert.equal((await w.call('POST', '/api/inbox/state', { as: w.coach, body: { keys: [form.key], status: 'snoozed' } })).status, 400, 'until is required');
    assert.equal((await w.call('POST', '/api/inbox/state', { as: w.coach, body: { keys: [form.key], status: 'snoozed', until: new Date(Date.now() - 60_000).toISOString() } })).status, 400, 'until in the past');
    await w.ok('POST', '/api/inbox/state', { as: w.coach, body: { keys: [form.key], status: 'snoozed', until } });
    const hidden = await inbox();
    assert.ok(!hidden.items.some(i => i.key === form.key));
    const snoozed = await inbox(w.coach, '?filter=snoozed');
    assert.equal(snoozed.items.find(i => i.key === form.key).snoozeUntil, until);
    assert.ok(hidden.counts.snoozed >= 1);
    const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const back = await inbox(w.coach, `?at=${encodeURIComponent(later)}`);
    assert.ok(back.items.some(i => i.key === form.key && i.status === 'open'), 'back once the time has passed');
  });

  test('coach isolation: another coach cannot see or change these items; one unknown key writes nothing', async () => {
    const box = await inbox();
    const key = box.items.find(i => i.kind === 'checkin').key;
    assert.ok(!(await inbox(coach2)).items.some(i => i.key === key));
    assert.equal((await w.call('POST', '/api/inbox/state', { as: coach2, body: { keys: [key], status: 'done' } })).status, 404);
    assert.equal((await w.call('POST', '/api/inbox/state', { as: w.coach, body: { keys: [key, 'thread:nope:nope'], status: 'done' } })).status, 404);
    assert.ok((await inbox()).items.some(i => i.key === key), 'nothing was written');
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM inbox_state WHERE coach_id=?').get(coach2.id).n, 0);
    assert.equal((await w.call('POST', '/api/inbox/state', { as: w.client, body: { keys: [key], status: 'done' } })).status, 403);
    assert.equal((await w.call('POST', '/api/inbox/state', { as: w.coach, body: { keys: [], status: 'done' } })).status, 400);
    assert.equal((await w.call('POST', '/api/inbox/state', { as: w.coach, body: { keys: [key], status: 'archived' } })).status, 400);
  });

  test('the prune clock deletes rows for items gone over 60 days, keeps the rest', async () => {
    const old = new Date(Date.now() - 61 * 86_400_000).toISOString();
    w.db.prepare("INSERT INTO inbox_state (coach_id, item_key, client_id, status, updated_at) VALUES (?, 'thread:gone:m_gone', NULL, 'done', ?)").run(w.coach.id, old);
    const live = (await inbox()).items[0].key;
    w.db.prepare("INSERT OR REPLACE INTO inbox_state (coach_id, item_key, client_id, status, updated_at) VALUES (?, ?, NULL, 'done', ?)").run(w.coach.id, live, old);
    assert.equal(await w.tick('inbox.prune', new Date()), 1);
    assert.ok(!w.db.prepare("SELECT 1 FROM inbox_state WHERE item_key='thread:gone:m_gone'").get());
    assert.ok(w.db.prepare('SELECT 1 FROM inbox_state WHERE item_key=?').get(live), 'a done row whose item still exists stays');
  });

  test('export carries the inbox state, and erasure leaves no rows', async () => {
    const box = await inbox();
    const item = box.items.find(i => i.clientId === tia.id);
    await w.ok('POST', '/api/inbox/state', { as: w.coach, body: { keys: [item.key], status: 'done' } });
    const tiaToken = tia.token;
    const exp = await w.ok('GET', '/api/me/export', { token: tiaToken });
    assert.ok(exp.features.command.inboxState.some(r => r.key === item.key && r.status === 'done'));
    assert.ok(!('clientId' in exp.features.command.inboxState[0]));
    const coachExp = await w.ok('GET', '/api/me/export', { as: w.coach });
    assert.ok(coachExp.features.command.inboxState.some(r => r.key === item.key && r.clientId === tia.id));
    await w.ok('DELETE', '/api/me', { token: tiaToken });
    assertNoRowsFor(w.db, tia.id);
  });
});

describe('every command route', () => {
  const ROUTES = [
    ['GET', '/api/command/summary'], ['GET', '/api/command/activity'], ['POST', '/api/command/brief', {}],
    ['GET', '/api/command/notify-settings'], ['PUT', '/api/command/notify-settings', { pushUrgent: true }],
    ['GET', '/api/inbox'], ['POST', '/api/inbox/state', { keys: ['thread:x:y'], status: 'done' }],
  ];
  test('a client gets 403 and a signed-out caller 401 from every route', async () => {
    for (const [method, path, body] of ROUTES) {
      assert.equal((await w.call(method, path, { as: w.client, body })).status, 403, `${method} ${path}`);
      assert.equal((await w.call(method, path, { body })).status, 401, `${method} ${path} signed out`);
    }
  });
  test('the only id-bearing route, POST /api/inbox/state, answers 404 for another coach’s key', async () => {
    const theirs = w.user('Una Theirs', 'client', coach2.id);
    msg(theirs.id, 'For coach two only');
    const key = (await inbox(coach2)).items.find(i => i.clientId === theirs.id).key;
    assert.equal((await w.call('POST', '/api/inbox/state', { as: w.coach, body: { keys: [key], status: 'snoozed', until: new Date(Date.now() + 3_600_000).toISOString() } })).status, 404);
    assert.equal((await w.call('POST', '/api/inbox/state', { as: w.coach, body: { keys: [key], status: 'open' } })).status, 404);
  });
});

void addDays; void at; void now; void setCoachPref;
