/**
 * The coach diary and session notes (F22, docs/design/desk-v2.md WP7):
 * the journal per day, the agenda merged from every feature's diary hook,
 * notes per booking and attendee, the recap message, attendance events and
 * facts, the quiet hook, isolation, export and erasure.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { attendedSessions, clientFacts } from '../facts.mjs';
import { newId, nowIso } from '../store.mjs';
import { addDays, londonDay, londonToUtc } from '../time.mjs';

const { makeWorld, assertNoRowsFor, fakeToday } = await import('./helpers.mjs');

let w, coach, coach2, sam, kim;
const { today } = fakeToday();
const at = (d, t) => londonToUtc(d, t).toISOString();
const booking = (client, kind, start, { coachId = coach.id, title = '1:1 with John Kelly' } = {}) => {
  const id = newId('b');
  w.db.prepare('INSERT INTO bookings (id, coach_id, client_id, kind, start, end, location, title, uses_credit, capacity, created_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)')
    .run(id, coachId, client?.id ?? null, kind, start, new Date(Date.parse(start) + 3_600_000).toISOString(), 'Studio 2', title, kind === 'group' ? 8 : null, nowIso());
  return id;
};
const events = type => w.db.prepare('SELECT * FROM events WHERE type=? ORDER BY seq').all(type).map(e => ({ ...e, payload: JSON.parse(e.payload) }));
const ago = days => new Date(Date.now() - days * 86_400_000).toISOString();

before(async () => {
  w = await makeWorld();
  coach = w.coach;
  coach2 = await w.signIn('helper-coach2', 'coach2@example.com', { givenName: 'Kate', familyName: 'Lane' });
  sam = w.client;
  kim = await w.signIn('helper-kim', 'kim@example.com', { givenName: 'Kim', familyName: 'Lee' });
});
after(() => w.close());

describe('the journal', () => {
  test('one entry per day, upserted; diary.written once, with no text', async () => {
    const day = addDays(today, -1);
    const a = await w.ok('PUT', `/api/diary/${day}`, { as: coach, body: { body: 'Good session with Sam.', mood: 4, tags: ['Training', 'training', 'wins'] } });
    assert.deepEqual(a.entry.tags, ['training', 'wins']);
    const b = await w.ok('PUT', `/api/diary/${day}`, { as: coach, body: { body: 'Good session with Sam. Long day after.' } });
    assert.equal(b.entry.mood, 4, 'an autosave without mood keeps it');
    assert.equal(b.entry.words, 7);
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM diary_entries WHERE coach_id=?').get(coach.id).n, 1);
    const written = events('diary.written');
    assert.equal(written.length, 1);
    assert.ok(!JSON.stringify(written[0]).includes('Good session'), 'no text in the event');
    assert.equal((await w.call('PUT', `/api/diary/${day}`, { as: coach, body: { body: 'x', mood: 9 } })).status, 400);
    const strip = await w.ok('GET', `/api/diary?from=${addDays(today, -30)}&to=${today}`, { as: coach });
    assert.deepEqual(strip.days, [{ day, words: 7, mood: 4 }]);
    const got = await w.ok('GET', `/api/diary/${day}`, { as: coach });
    assert.equal(got.entry.body, 'Good session with Sam. Long day after.');
  });

  test('the palette finds diary text, scoped to the coach', async () => {
    const r = await w.ok('GET', '/api/search?q=long%20day', { as: coach });
    assert.ok(r.results.some(x => x.type === 'diary' && x.path === `/diary/${addDays(today, -1)}`));
    const other = await w.ok('GET', '/api/search?q=long%20day', { as: coach2 });
    assert.ok(!other.results.some(x => x.type === 'diary'));
  });
});

describe('the agenda', () => {
  test('sessions, holds, busy time, time off and letters on one day, time-ordered', async () => {
    const day = addDays(today, 30);
    const b = booking(sam, 'inperson', at(day, '07:00'));
    booking(null, 'group', at(day, '18:00'), { title: 'Conditioning · Group' });
    await w.ok('POST', '/api/calendar/holds', { as: coach, body: { kind: 'admin', title: 'Programming time', start: at(day, '13:00'), end: at(day, '15:00') } });
    await w.ok('POST', '/api/calendar/time-off', { as: coach, body: { start: at(day, '16:00'), end: at(day, '17:00'), allDay: false, reason: 'Dentist' } });
    w.db.prepare("INSERT INTO reports (id, client_id, coach_id, week, summary, published_at, deliver_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(newId('r'), sam.id, coach.id, day, 'Letter', nowIso(), at(day, '08:00'), nowIso(), nowIso());
    const { agenda } = await w.ok('GET', `/api/diary/${day}`, { as: coach });
    assert.deepEqual(agenda.map(a => a.kind), ['timeOff', 'session', 'letter', 'hold', 'session']);
    const s = agenda.find(a => a.bookingId === b);
    assert.equal(s.title, 'Sam Carter');
    assert.equal(s.source, 'diary');
    assert.equal(agenda.find(a => a.kind === 'hold').source, 'calsync');
    const coach2View = await w.ok('GET', `/api/diary/${day}`, { as: coach2 });
    assert.equal(coach2View.agenda.length, 0);
  });
});

describe('session notes', () => {
  let oneId, classId;
  test('a note per booking and client, including each attendee of a class', async () => {
    oneId = booking(sam, 'inperson', ago(2));
    classId = booking(null, 'group', ago(3), { title: 'Conditioning · Group' });
    for (const c of [sam, kim]) w.db.prepare('INSERT INTO class_attendees (booking_id, user_id) VALUES (?,?)').run(classId, c.id);
    const empty = await w.ok('GET', `/api/sessions/${classId}/notes`, { as: coach });
    assert.deepEqual(empty.notes.map(n => [n.client.name, n.attendance]), [['Kim Lee', null], ['Sam Carter', null]]);
    await w.ok('PUT', `/api/sessions/${classId}/notes`, { as: coach, body: { clientId: kim.id, attendance: 'attended', focus: 'Pacing' } });
    await w.ok('PUT', `/api/sessions/${classId}/notes`, { as: coach, body: { clientId: kim.id, wins: 'Held the pace' } });
    await w.ok('PUT', `/api/sessions/${classId}/notes`, { as: coach, body: { clientId: sam.id, attendance: 'noShow' } });
    const after1 = await w.ok('GET', `/api/sessions/${classId}/notes`, { as: coach });
    assert.deepEqual(after1.notes.map(n => [n.client.name, n.attendance, n.focus, n.wins]), [['Kim Lee', 'attended', 'Pacing', 'Held the pace'], ['Sam Carter', 'noShow', '', '']]);
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM session_notes WHERE booking_id=?').get(classId).n, 2);
    const outsider = w.user('Not There', 'client', coach.id);
    assert.equal((await w.call('PUT', `/api/sessions/${classId}/notes`, { as: coach, body: { clientId: outsider.id, focus: 'x' } })).status, 404, 'not on the class');
    const future = booking(sam, 'inperson', at(addDays(today, 10), '07:00'));
    assert.equal((await w.call('PUT', `/api/sessions/${future}/notes`, { as: coach, body: { clientId: sam.id, attendance: 'attended' } })).status, 400);
    await w.ok('PUT', `/api/sessions/${future}/notes`, { as: coach, body: { clientId: sam.id, attendance: 'lateCancel' } });
  });

  test('attendance events fire when attendance is first set or changed, with the policy', async () => {
    await w.ok('PUT', '/api/calendar/prefs', { as: coach, body: { noShowFeePence: 2500, cancelFeePence: 1000 } });
    const attended0 = events('booking.attended').length, noShow0 = events('booking.noShow').length;
    await w.ok('PUT', `/api/sessions/${oneId}/notes`, { as: coach, body: { clientId: sam.id, attendance: 'attended', focus: 'Squat depth', did: 'Squats 5×5', wins: 'Fast top set', next: 'Add 2.5 kg', privateNote: 'Stressed at work' } });
    await w.ok('PUT', `/api/sessions/${oneId}/notes`, { as: coach, body: { clientId: sam.id, attendance: 'attended' } });
    assert.equal(events('booking.attended').length, attended0 + 1, 'the same value again emits nothing');
    await w.ok('PUT', `/api/sessions/${oneId}/notes`, { as: coach, body: { clientId: sam.id, attendance: 'noShow' } });
    const ns = events('booking.noShow').at(-1);
    assert.equal(events('booking.noShow').length, noShow0 + 1);
    assert.deepEqual(ns.payload.policy, { forfeitCredit: true, feePence: 2500 });
    assert.equal(ns.payload.bookingId, oneId);
    assert.equal(events('booking.lateCancel').at(-1).payload.policy.feePence, 0, 'the earlier late cancel was set before the fee');
    await w.ok('PUT', `/api/sessions/${oneId}/notes`, { as: coach, body: { clientId: sam.id, attendance: 'attended' } });
  });

  test('share sends exactly one message: focus, wins and next, never the private note', async () => {
    const before = w.db.prepare('SELECT COUNT(*) n FROM messages WHERE client_id=?').get(sam.id).n;
    const { messageId } = await w.ok('POST', `/api/sessions/${oneId}/notes/share`, { as: coach, body: { clientId: sam.id } });
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM messages WHERE client_id=?').get(sam.id).n, before + 1);
    const m = w.db.prepare('SELECT * FROM messages WHERE id=?').get(messageId);
    assert.match(m.text, /^Session recap · /);
    assert.match(m.text, /Focus: Squat depth/);
    assert.match(m.text, /Next time: Add 2\.5 kg/);
    assert.ok(!m.text.includes('Stressed') && !m.text.includes('Squats 5×5'));
    assert.equal(m.via, 'coachAction');
    const blank = booking(kim, 'inperson', ago(1));
    assert.equal((await w.call('POST', `/api/sessions/${blank}/notes/share`, { as: coach, body: { clientId: kim.id } })).status, 400);
  });

  test('no-shows and late cancels are not attended (quiet hook), and the facts and attendance route agree', async () => {
    const map = attendedSessions(w.db, coach.id, [sam.id], ago(30), nowIso());
    const ids = map.get(sam.id).map(x => x.bookingId);
    assert.ok(ids.includes(oneId));
    assert.ok(!ids.includes(classId), 'the class Sam missed does not count');
    const facts = clientFacts(w.db, coach.id, [sam.id], { only: ['diary.noShows90', 'diary.attendance90'] }).get(sam.id);
    assert.equal(facts['diary.noShows90'], 1);
    assert.equal(facts['diary.attendance90'], 50);
    const a = await w.ok('GET', `/api/coach/clients/${sam.id}/attendance`, { as: coach });
    assert.deepEqual([a.rate, a.attended, a.noShow, a.total], [50, 1, 1, 2]);
    assert.equal(a.sessions.find(s => s.bookingId === oneId).note.focus, 'Squat depth');
    assert.equal(a.sessions.find(s => s.bookingId === oneId).shared, true);
  });
});

describe('isolation, export and erasure', () => {
  test('another coach gets 404s; a client gets 403s', async () => {
    const b = w.db.prepare('SELECT booking_id FROM session_notes WHERE client_id=? LIMIT 1').get(sam.id).booking_id;
    for (const [method, path, body] of [['GET', `/api/sessions/${b}/notes`], ['PUT', `/api/sessions/${b}/notes`, { clientId: sam.id, focus: 'x' }],
      ['POST', `/api/sessions/${b}/notes/share`, { clientId: sam.id }], ['GET', `/api/coach/clients/${sam.id}/attendance`]]) {
      assert.equal((await w.call(method, path, { as: coach2, body })).status, 404, `${method} ${path}`);
    }
    for (const [method, path] of [['GET', `/api/diary/${today}`], ['PUT', `/api/diary/${today}`], ['GET', '/api/diary'], ['GET', `/api/sessions/${b}/notes`], ['GET', `/api/coach/clients/${sam.id}/attendance`]]) {
      assert.equal((await w.call(method, path, { as: sam, body: method === 'PUT' ? { body: 'x' } : undefined })).status, 403, `${method} ${path}`);
    }
    assert.equal((await w.ok('GET', `/api/diary?from=${addDays(today, -30)}&to=${today}`, { as: coach2 })).days.length, 0);
  });

  test('a client moved to another coach: the old coach no longer sees their notes', async () => {
    const lee = w.user('Lee Mover', 'client', coach.id);
    const b = booking(lee, 'inperson', ago(4));
    await w.ok('PUT', `/api/sessions/${b}/notes`, { as: coach, body: { clientId: lee.id, attendance: 'attended', focus: 'Mobility' } });
    w.db.prepare('UPDATE users SET coach_id=? WHERE id=?').run(coach2.id, lee.id);
    assert.equal((await w.ok('GET', `/api/sessions/${b}/notes`, { as: coach })).notes.length, 0);
    assert.equal((await w.call('GET', `/api/coach/clients/${lee.id}/attendance`, { as: coach })).status, 404);
    assert.equal((await w.call('GET', `/api/coach/clients/${lee.id}/attendance`, { as: coach2 })).status, 200);
  });

  test('the coach export has the diary; the client export has their notes, private note included; erasure leaves nothing', async () => {
    const coachExport = (await w.call('GET', '/api/me/export', { as: coach })).body;
    assert.ok(coachExport.features.diary.diary.some(d => d.body.includes('Good session')));
    const samExport = (await w.call('GET', '/api/me/export', { as: sam })).body;
    const notes = samExport.features.diary.sessionNotes;
    assert.ok(notes.some(n => n.private_note === 'Stressed at work'));
    assert.ok(!JSON.stringify(samExport).includes('Good session'), 'never the coach’s diary');
    await w.ok('DELETE', '/api/me', { as: sam });
    assertNoRowsFor(w.db, sam.id);
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM session_notes WHERE client_id=?').get(sam.id).n, 0);
  });

  test('the demo builds journal entries, notes and a no-show, and emits nothing', async () => {
    const { buildDemo } = await import('../demo.mjs');
    await w.settle();
    const before = w.db.prepare('SELECT COUNT(*) n FROM events').get().n;
    buildDemo(w.db, londonDay(), w.config);
    const demo = w.db.prepare("SELECT id FROM users WHERE apple_sub='demo-coach'").get();
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM diary_entries WHERE coach_id=?').get(demo.id).n, 20);
    assert.ok(w.db.prepare('SELECT COUNT(*) n FROM session_notes WHERE coach_id=?').get(demo.id).n >= 5);
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM session_notes WHERE coach_id=? AND attendance='noShow'").get(demo.id).n, 1);
    assert.ok(w.db.prepare('SELECT COUNT(*) n FROM busy_blocks WHERE coach_id=?').get(demo.id).n > 50);
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM waitlist WHERE coach_id=?').get(demo.id).n, 2);
    const conflicts = (await import('../features/calsync.mjs')).computeConflicts(w.db, demo.id, nowIso(), new Date(Date.now() + 28 * 86_400_000).toISOString());
    assert.equal(conflicts.filter(c => c.severity === 'high').length, 1, conflicts.map(c => c.text).join(' | '));
    assert.match(conflicts.find(c => c.severity === 'high').text, /Dentist/);
    buildDemo(w.db, londonDay(), w.config);
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM diary_entries WHERE coach_id=?').get(demo.id).n, 20, 'a rebuild replaces, never doubles');
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM events').get().n, before);
  });
});
