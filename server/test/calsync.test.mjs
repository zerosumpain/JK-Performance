/**
 * Calendar connections, holds, conflicts, buffers and time off (F20), and the
 * slot finder, standing sessions, reschedule, waitlist, reminders and the
 * cancellation policy (F21). docs/design/desk-v2.md, WP7.
 *
 * Every date is a weekday at least two weeks out, so the tests read the same
 * on any day (FAKE_TODAY only moves the helper's `today`, not the wall clock).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { emit } from '../events.mjs';
import { FEATURES } from '../registry.mjs';
import { newId, nowIso } from '../store.mjs';
import { addDays, londonDay, londonToUtc, weekday } from '../time.mjs';

const { makeWorld, assertNoRowsFor } = await import('./helpers.mjs');

const nextMonday = d => { for (let x = d; ; x = addDays(x, 1)) if (weekday(x) === 1) return x; };
const D = nextMonday(addDays(londonDay(), 15)); // a Monday 15–21 days out
const at = (d, t) => londonToUtc(d, t).toISOString();
const ics = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flat(), 'END:VCALENDAR'].join('\r\n');
const vevent = (uid, title, start, end, ...extra) => ['BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${title}`, `DTSTART:${start.replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`, `DTEND:${end.replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`, ...extra, 'END:VEVENT'];
const FEED_URL = 'https://cal.example.com/private-abc123secret/basic.ics';
const RULES = [1, 2, 3, 4, 5].map(wd => ({ weekday: wd, start: '07:00', end: '12:00', kind: 'inperson', slotMinutes: 60, location: 'Studio 2' }))
  .concat([{ weekday: 1, start: '13:00', end: '15:00', kind: 'video', slotMinutes: 60, location: '' }]);

let w, coach, coach2, sam, kim, other, feed, fetched;
const calsync = () => FEATURES.find(f => f.name === 'calsync');
const rawBooking = (client, kind, start, minutes = 60, { coachId = coach.id, createdAt = nowIso(), cancelled = null } = {}) => {
  const id = newId('b');
  w.db.prepare('INSERT INTO bookings (id, coach_id, client_id, kind, start, end, location, title, uses_credit, created_at, cancelled_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)')
    .run(id, coachId, client?.id ?? null, kind, start, new Date(Date.parse(start) + minutes * 60_000).toISOString(), 'Studio 2', '1:1 with John Kelly', createdAt, cancelled);
  return id;
};
const events = type => w.db.prepare('SELECT * FROM events WHERE type=? ORDER BY seq').all(type).map(e => ({ ...e, payload: JSON.parse(e.payload) }));

before(async () => {
  feed = () => ({ status: 200, body: ics(vevent('dentist', 'Dentist', at(D, '09:00'), at(D, '10:00')), vevent('physio', 'Physio', at(addDays(D, 7), '09:30'), at(addDays(D, 7), '10:00')),
    vevent('lunch', 'Lunch', at(addDays(D, 9), '14:00'), at(addDays(D, 9), '14:30'))), etag: '"v1"' });
  fetched = [];
  w = await makeWorld({ config: { calFetch: async (url, opts) => { fetched.push({ url, ...opts }); return feed(url, opts); } } });
  coach = w.coach;
  coach2 = await w.signIn('helper-coach2', 'coach2@example.com', { givenName: 'Kate', familyName: 'Lane' });
  sam = w.client;
  kim = await w.signIn('helper-kim', 'kim@example.com', { givenName: 'Kim', familyName: 'Lee' });
  other = w.user('Olly Other', 'client', coach2.id);
  await w.ok('PUT', '/api/availability', { as: coach, body: { rules: RULES } });
});
after(() => w.close());

describe('calendar sources', () => {
  test('private, insecure and odd addresses are refused, and so is the demo coach', async () => {
    for (const url of ['https://127.0.0.1/a.ics', 'https://10.0.0.1/a.ics', 'https://100.83.68.108/a.ics', 'http://cal.example.com/a.ics', 'https://cal.example.com:8443/a.ics']) {
      const r = await w.call('POST', '/api/calendar/sources', { as: coach, body: { label: 'X', url } });
      assert.equal(r.status, 400, url);
    }
    const demo = w.user('Demo Coach', 'coach', null, { isDemo: true });
    const r = await w.call('POST', '/api/calendar/sources', { as: demo, body: { label: 'X', url: FEED_URL } });
    assert.equal(r.status, 403);
    assert.equal(fetched.length, 0, 'nothing was fetched');
  });

  test('a feed that is not iCal is refused with the reason', async () => {
    const keep = feed;
    feed = () => ({ status: 200, body: '<html>Sign in</html>' });
    const r = await w.call('POST', '/api/calendar/sources', { as: coach, body: { label: 'X', url: FEED_URL } });
    feed = keep;
    assert.equal(r.status, 400);
    assert.match(r.body.error, /not an iCal calendar/);
  });

  test('a source is stored encrypted; its address never comes back; titles only when asked', async () => {
    const { source } = await w.ok('POST', '/api/calendar/sources', { as: coach, body: { label: 'Personal', url: `webcal://cal.example.com/private-abc123secret/basic.ics`, color: 'chart-2' } });
    assert.equal(fetched.at(-1).url, FEED_URL, 'webcal became https');
    assert.equal(source.urlHint, 'cal.example.com/…/basic.ics');
    assert.equal(source.eventCount, 3);
    const row = w.db.prepare('SELECT * FROM calendar_sources WHERE id=?').get(source.id);
    assert.ok(!row.url_enc.includes('abc123secret'));
    for (const body of [source, await w.ok('GET', '/api/calendar/sources', { as: coach }), await w.ok('GET', `/api/calendar/busy?from=${D}&to=${addDays(D, 9)}`, { as: coach })]) {
      assert.ok(!JSON.stringify(body).includes('abc123secret'), 'the address is never in a response');
    }
    let busy = await w.ok('GET', `/api/calendar/busy?from=${D}&to=${D}`, { as: coach });
    assert.deepEqual(busy.blocks.map(b => [b.title, b.start, b.color]), [[null, at(D, '09:00'), 'chart-2']]);
    await w.ok('PATCH', `/api/calendar/sources/${source.id}`, { as: coach, body: { showTitles: true } });
    busy = await w.ok('GET', `/api/calendar/busy?from=${D}&to=${D}`, { as: coach });
    assert.equal(busy.blocks[0].title, 'Dentist');
    await w.ok('POST', `/api/calendar/sources/${source.id}/sync`, { as: coach });
    assert.equal(fetched.at(-1).etag, null, 'Sync now does not send the stored etag');
  });
});

describe('slots, buffers, notice, cap and time off', () => {
  test('busy time closes a slot, and createBooking gives 409 on it', async () => {
    const { slots } = await w.ok('GET', `/api/slots?from=${D}&to=${D}&kind=inperson`, { as: coach });
    const nine = slots.find(s => s.start === at(D, '09:00'));
    assert.equal(nine.open, false);
    assert.match(nine.reason, /Dentist/);
    const r = await w.call('POST', '/api/bookings', { as: coach, body: { clientId: sam.id, kind: 'inperson', start: at(D, '09:00') } });
    assert.equal(r.status, 409);
  });

  test('buffers and the daily cap', async () => {
    await w.ok('PUT', '/api/calendar/prefs', { as: coach, body: { bufferAfter: 10, maxPerDay: 2, travelGap: 15 } });
    await w.ok('POST', '/api/bookings', { as: coach, body: { clientId: sam.id, kind: 'inperson', start: at(D, '07:00') } });
    let { slots } = await w.ok('GET', `/api/slots?from=${D}&to=${D}&kind=inperson`, { as: coach });
    assert.match(slots.find(s => s.start === at(D, '08:00')).reason, /buffer/);
    await w.ok('POST', '/api/bookings', { as: coach, body: { clientId: kim.id, kind: 'inperson', start: at(D, '10:00') } });
    ({ slots } = await w.ok('GET', `/api/slots?from=${D}&to=${D}&kind=inperson`, { as: coach }));
    assert.match(slots.find(s => s.start === at(D, '11:00')).reason, /already 2 sessions/);
    // Kim (a client) sees the same: nothing open on D.
    const mine = await w.ok('GET', `/api/slots?from=${D}&to=${D}&kind=inperson`, { as: kim });
    assert.equal(mine.slots.filter(s => s.open).length, 0);
    await w.ok('PUT', '/api/calendar/prefs', { as: coach, body: { maxPerDay: null } });
  });

  test('minimum notice applies to clients, not the coach', async () => {
    let d = addDays(londonDay(), 2);
    while (weekday(d) > 5) d = addDays(d, 1);
    await w.ok('PUT', '/api/calendar/prefs', { as: coach, body: { minNoticeHours: 168 } });
    const client = await w.ok('GET', `/api/slots?from=${d}&to=${d}&kind=inperson`, { as: kim });
    assert.ok(client.slots.length && client.slots.every(s => !s.open && s.reason === 'too soon'));
    const coachView = await w.ok('GET', `/api/slots?from=${d}&to=${d}&kind=inperson`, { as: coach });
    assert.ok(coachView.slots.some(s => s.open));
    await w.ok('PUT', '/api/calendar/prefs', { as: coach, body: { minNoticeHours: 0 } });
  });

  test('time off closes whole days and warns about bookings inside it', async () => {
    const t = await w.ok('POST', '/api/calendar/time-off', { as: coach, body: { start: D, end: addDays(D, 1), reason: 'Long weekend' } });
    assert.equal(t.item.startDay, D);
    assert.equal(t.item.endDay, addDays(D, 1));
    assert.equal(t.conflicts.length, 2, 'the two bookings on D');
    const { slots } = await w.ok('GET', `/api/slots?from=${addDays(D, 1)}&to=${addDays(D, 1)}&kind=inperson`, { as: coach });
    assert.ok(slots.every(s => !s.open && s.reason === 'time off'));
    await w.ok('DELETE', `/api/calendar/time-off/${t.item.id}`, { as: coach });
    const items = (await w.ok('GET', '/api/calendar/time-off', { as: coach })).items;
    assert.ok(!items.some(i => i.id === t.item.id));
  });

  test('bank holidays are added once', async () => {
    const a = await w.ok('POST', '/api/calendar/time-off/bank-holidays', { as: coach, body: { years: [2026, 2027] } });
    assert.equal(a.added, 16);
    const b = await w.ok('POST', '/api/calendar/time-off/bank-holidays', { as: coach, body: { years: [2027] } });
    assert.equal(b.added, 0);
    w.db.prepare('DELETE FROM time_off WHERE coach_id=?').run(coach.id);
  });
});

describe('conflicts and holds', () => {
  const E = addDays(D, 7);
  test('each kind is found, and an ignored key is left out', async () => {
    rawBooking(sam, 'inperson', at(E, '07:00'));
    rawBooking(kim, 'inperson', at(E, '07:30')); // overlap
    rawBooking(sam, 'inperson', at(E, '09:00'), 45); // over Physio 09:30
    rawBooking(kim, 'inperson', at(E, '10:00'));
    rawBooking(sam, 'inperson', at(E, '11:05'), 30); // 5 min after: buffer
    await w.ok('POST', '/api/calendar/time-off', { as: coach, body: { start: addDays(E, 1), end: addDays(E, 1), reason: 'Course' } });
    rawBooking(kim, 'inperson', at(addDays(E, 1), '07:00')); // in time off
    const hold = (await w.ok('POST', '/api/calendar/holds', { as: coach, body: { kind: 'admin', title: 'Programming', start: at(addDays(E, 2), '12:00'), end: at(addDays(E, 2), '13:00') } })).hold;
    rawBooking(sam, 'inperson', at(addDays(E, 2), '12:30')); // over the hold
    await w.ok('POST', '/api/calendar/holds', { as: coach, body: { kind: 'consult', start: at(addDays(E, 2), '13:45'), end: at(addDays(E, 2), '14:15') } }); // over Lunch
    rawBooking(kim, 'video', at(addDays(E, 3), '07:00'));
    rawBooking(sam, 'inperson', at(addDays(E, 3), '08:12')); // 12 min after a video: travel
    await w.ok('PUT', '/api/calendar/prefs', { as: coach, body: { maxPerDay: 4 } });
    const { conflicts } = await w.ok('GET', `/api/calendar/conflicts?from=${E}&to=${addDays(E, 3)}`, { as: coach });
    const kinds = new Set(conflicts.map(c => c.kind));
    for (const k of ['overlap', 'buffer', 'external', 'timeOff', 'capacity', 'travel']) assert.ok(kinds.has(k), k);
    assert.ok(conflicts.some(c => c.kind === 'overlap' && c.b.type === 'hold' && c.b.id === hold.id), 'booking × hold');
    assert.ok(conflicts.some(c => c.a.type === 'hold' && c.b.type === 'external' && c.b.title === 'Lunch'), 'hold × busy');
    const ext = conflicts.find(c => c.kind === 'external' && c.a.type === 'booking');
    assert.equal(ext.severity, 'high');
    assert.match(ext.text, /overlaps Physio \(Personal\)/);
    await w.ok('POST', '/api/calendar/conflicts/ignore', { as: coach, body: { key: ext.key } });
    const again = await w.ok('GET', `/api/calendar/conflicts?from=${E}&to=${addDays(E, 3)}`, { as: coach });
    assert.ok(!again.conflicts.some(c => c.key === ext.key));
    assert.deepEqual(again.ignored, [ext.key]);
    assert.equal(again.conflicts.length, conflicts.length - 1);
    await w.ok('PUT', '/api/calendar/prefs', { as: coach, body: { maxPerDay: null } });
  });

  test('a hold blocks slots, refuses to overlap a booking, and goes out in the feed without the lead', async () => {
    const F = addDays(D, 14);
    const { hold } = await w.ok('POST', '/api/calendar/holds', { as: coach, body: { kind: 'consult', title: 'Consult: Hannah Lewis', leadId: 'ld_hannah', start: at(F, '11:00'), end: at(F, '12:00') } });
    assert.equal(events('hold.created').at(-1).payload.holdId, hold.id);
    const { slots } = await w.ok('GET', `/api/slots?from=${F}&to=${F}&kind=inperson`, { as: coach });
    assert.match(slots.find(s => s.start === at(F, '11:00')).reason, /Hannah/);
    rawBooking(sam, 'inperson', at(F, '07:00'));
    const clash = await w.call('POST', '/api/calendar/holds', { as: coach, body: { kind: 'admin', title: 'X', start: at(F, '07:30'), end: at(F, '08:00') } });
    assert.equal(clash.status, 409);
    const { url } = await w.ok('POST', '/api/calendar/feed', { as: coach });
    const res = await fetch(url.replace('https://jk.example.com', w.base));
    const text = await res.text();
    assert.match(text, /SUMMARY:Consult\r\n/);
    assert.ok(!text.includes('Hannah'), 'no lead name in the feed');
    // lead.deleted clears the lead and its name.
    emit(w.db, 'lead.deleted', { coachId: coach.id, leadId: 'ld_hannah' });
    await w.settle();
    const row = w.db.prepare('SELECT * FROM calendar_holds WHERE id=?').get(hold.id);
    assert.equal(row.lead_id, null);
    assert.equal(row.title, 'Consult');
  });

  test('a trial hold converts into exactly one booking', async () => {
    const F = addDays(D, 15);
    const { hold } = await w.ok('POST', '/api/calendar/holds', { as: coach, body: { kind: 'trial', start: at(F, '08:00'), end: at(F, '09:00') } });
    const before = events('booking.created').length;
    const { booking } = await w.ok('POST', `/api/calendar/holds/${hold.id}/convert`, { as: coach, body: { clientId: kim.id } });
    assert.equal(booking.start, at(F, '08:00'));
    assert.equal(booking.client.id, kim.id);
    assert.equal(events('booking.created').length, before + 1);
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM calendar_holds WHERE id=?').get(hold.id).n, 0);
    const consult = (await w.ok('POST', '/api/calendar/holds', { as: coach, body: { kind: 'consult', start: at(F, '10:00'), end: at(F, '10:30') } })).hold;
    assert.equal((await w.call('POST', `/api/calendar/holds/${consult.id}/convert`, { as: coach, body: { clientId: kim.id } })).status, 400);
  });

  test('a new high-severity clash after a sync notifies once and emits calendar.conflict', async () => {
    const G = addDays(D, 21);
    rawBooking(sam, 'inperson', at(G, '07:00'));
    const keep = feed;
    feed = () => ({ status: 200, body: ics(vevent('school', 'School assembly', at(G, '07:15'), at(G, '07:45'))), etag: '"v2"' });
    const source = w.db.prepare('SELECT * FROM calendar_sources WHERE coach_id=?').get(coach.id);
    w.db.prepare('UPDATE calendar_sources SET next_sync_at=? WHERE id=?').run(new Date(0).toISOString(), source.id);
    const now = new Date(Date.parse(at(G, '07:00')) - 10 * 86_400_000);
    await w.tick('calendar.sync', now);
    const n1 = w.db.prepare("SELECT COUNT(*) n FROM coach_notifications WHERE coach_id=? AND kind='calendar.conflict'").get(coach.id).n;
    assert.equal(n1, 1);
    assert.equal(events('calendar.conflict').length, 1);
    w.db.prepare('UPDATE calendar_sources SET next_sync_at=? WHERE id=?').run(new Date(0).toISOString(), source.id);
    await w.tick('calendar.sync', now);
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM coach_notifications WHERE coach_id=? AND kind='calendar.conflict'").get(coach.id).n, 1);
    // A failing feed is recorded without the address and backs off an hour.
    feed = () => { throw new Error(`connect ECONNREFUSED for ${FEED_URL}`); };
    w.db.prepare('UPDATE calendar_sources SET next_sync_at=? WHERE id=?').run(new Date(0).toISOString(), source.id);
    await w.tick('calendar.sync', now);
    const failed = w.db.prepare('SELECT * FROM calendar_sources WHERE id=?').get(source.id);
    assert.equal(failed.sync_failed, 1);
    assert.ok(!failed.last_error.includes('abc123secret'));
    assert.ok(Date.parse(failed.next_sync_at) >= now.getTime() + 59 * 60_000);
    feed = keep;
  });
});

describe('the slot finder', () => {
  test('suggestions skip busy time and rank deterministically, with reasons', async () => {
    const H = addDays(D, 28);
    // Sam's usual: Tuesdays at 07:00.
    for (const k of [1, 2, 3]) rawBooking(sam, 'inperson', at(addDays(londonDay(), -7 * k - ((weekday(londonDay()) + 5) % 7)), '07:00'));
    w.db.prepare("UPDATE users SET profile=? WHERE id=?").run(JSON.stringify({ preferredTime: 'morning' }), sam.id);
    rawBooking(kim, 'inperson', at(H, '09:00'));
    const q = `/api/calendar/find?clientId=${sam.id}&kind=inperson&from=${H}&to=${addDays(H, 4)}`;
    const a = await w.ok('GET', q, { as: coach });
    const b = await w.ok('GET', q, { as: coach });
    assert.deepEqual(a, b, 'deterministic');
    assert.equal(a.suggestions.length, 8);
    assert.ok(!a.suggestions.some(s => s.start === at(H, '09:00')), 'never a busy time');
    const top = a.suggestions[0];
    assert.equal(top.start, at(addDays(H, 1), '07:00'));
    assert.ok(top.reasons.some(r => /usual Tue 07:00/.test(r)), top.reasons.join(' | '));
    for (let i = 1; i < a.suggestions.length; i++) assert.ok(a.suggestions[i - 1].score >= a.suggestions[i].score);
    const evening = await w.ok('GET', `${q}&prefer=evening`, { as: coach });
    assert.equal(evening.suggestions.length, 0, 'no evening slots in these rules');
    const hold = await w.ok('GET', `/api/calendar/find?from=${H}&to=${H}&minutes=30`, { as: coach });
    assert.ok(hold.suggestions.length > 0 && hold.suggestions.every(s => Date.parse(s.end) - Date.parse(s.start) === 30 * 60_000));
  });
});

describe('standing sessions, reschedule and cancellation policy', () => {
  test('a 12-week series over a week off books 11, reports the skip, and "this and following" cancels the rest', async () => {
    const S = addDays(D, 3); // a Thursday
    const off = addDays(S, 21);
    await w.ok('POST', '/api/calendar/time-off', { as: coach, body: { start: off, end: addDays(off, 4), reason: 'Holiday' } });
    const r = await w.ok('POST', '/api/bookings/series', { as: coach, body: { clientId: kim.id, kind: 'inperson', start: at(S, '11:00'), minutes: 60, weeks: 12 } });
    assert.equal(r.booked.length, 11);
    assert.deepEqual(r.skipped, [{ start: at(off, '11:00'), reason: 'time off' }]);
    assert.ok(r.booked.every(b => b.seriesId === r.seriesId));
    assert.equal(events('booking.series').at(-1).payload.count, 11);
    const sixth = r.booked[5];
    const c = await w.ok('POST', `/api/bookings/series/${r.seriesId}/cancel`, { as: coach, body: { from: sixth.start } });
    assert.equal(c.cancelled, 6);
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM bookings WHERE series_id=?').get(r.seriesId).n, 5);
    assert.equal((await w.call('POST', `/api/bookings/series/${r.seriesId}/cancel`, { as: coach2, body: {} })).status, 404);
  });

  test('reschedule: the coach moves to any free time, a clash is a 409, a client needs notice and an open slot', async () => {
    const R = addDays(D, 2); // a Wednesday
    const { id } = await w.ok('POST', '/api/bookings', { as: coach, body: { clientId: kim.id, kind: 'inperson', start: at(R, '07:00') } });
    rawBooking(sam, 'inperson', at(R, '10:00'));
    assert.equal((await w.call('POST', `/api/bookings/${id}/reschedule`, { as: coach, body: { start: at(R, '10:30') } })).status, 409);
    const moved = await w.ok('POST', `/api/bookings/${id}/reschedule`, { as: coach, body: { start: at(R, '08:15'), message: 'Moved us to 08:15, see you then.' } });
    assert.equal(moved.booking.start, at(R, '08:15'));
    const ev = events('booking.rescheduled').at(-1);
    assert.deepEqual([ev.payload.from, ev.payload.to, ev.payload.byRole], [at(R, '07:00'), at(R, '08:15'), 'coach']);
    assert.ok(w.db.prepare("SELECT 1 FROM messages WHERE client_id=? AND text LIKE 'Moved us%'").get(kim.id), 'the optional message went');
    // Kim moves it to an open slot on another day.
    const back = await w.ok('POST', `/api/bookings/${id}/reschedule`, { as: kim, body: { start: at(addDays(R, 1), '07:00') } });
    assert.equal(events('booking.rescheduled').at(-1).payload.byRole, 'client');
    assert.equal(back.booking.start, at(addDays(R, 1), '07:00'));
    assert.equal((await w.call('POST', `/api/bookings/${id}/reschedule`, { as: kim, body: { start: at(addDays(R, 1), '07:20') } })).status, 400, 'not a slot');
    assert.equal((await w.call('POST', `/api/bookings/${id}/reschedule`, { as: sam, body: { start: at(addDays(R, 1), '09:00') } })).status, 404, 'not Sam’s');
    const soon = rawBooking(kim, 'inperson', new Date(Date.now() + 3 * 3_600_000).toISOString());
    assert.equal((await w.call('POST', `/api/bookings/${soon}/reschedule`, { as: kim, body: { start: at(addDays(R, 1), '09:00') } })).status, 400, 'inside the notice');
  });

  test('a late cancel carries the policy; an early one does not', async () => {
    await w.ok('PUT', '/api/calendar/prefs', { as: coach, body: { cancelFeePence: 1500, cancelForfeitCredit: true } });
    const soon = rawBooking(kim, 'inperson', new Date(Date.now() + 5 * 3_600_000).toISOString());
    const late = await w.ok('DELETE', `/api/bookings/${soon}`, { as: kim });
    assert.deepEqual([late.late, late.refunded], [true, false]);
    let ev = events('booking.cancelled').at(-1);
    assert.deepEqual(ev.payload.policy, { forfeitCredit: true, feePence: 1500 });
    assert.equal(ev.payload.late, true);
    const early = rawBooking(kim, 'inperson', at(addDays(D, 3), '07:00'));
    await w.ok('DELETE', `/api/bookings/${early}`, { as: kim });
    ev = events('booking.cancelled').at(-1);
    assert.equal(ev.payload.policy, undefined);
    assert.equal(ev.payload.late, false);
  });
});

describe('waitlist and reminders', () => {
  test('a cancelled slot is matched to the waitlist; the coach offers it with one message', async () => {
    const W = addDays(D, 3); // a Thursday
    const { item } = await w.ok('POST', '/api/waitlist', { as: kim, body: { kind: 'inperson', fromDay: W, toDay: addDays(W, 2), prefer: 'morning', note: 'Any morning' } });
    assert.equal(item.status, 'waiting');
    const freed = rawBooking(sam, 'inperson', at(W, '09:00'));
    await w.ok('DELETE', `/api/bookings/${freed}`, { as: coach });
    await w.settle();
    const entry = w.db.prepare('SELECT * FROM waitlist WHERE id=?').get(item.id);
    assert.equal(entry.match_start, at(W, '09:00'));
    assert.equal(events('waitlist.matched').at(-1).payload.waitlistId, item.id);
    const note = w.db.prepare("SELECT * FROM coach_notifications WHERE coach_id=? AND kind='waitlist.matched'").get(coach.id);
    assert.match(note.title, /Slot freed .* 1 on the waitlist/);
    const inbox = calsync().inbox(w.db, coach.row);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].actions[0].url, `/api/waitlist/${item.id}/offer`);
    const list = await w.ok('GET', '/api/waitlist', { as: coach });
    assert.equal(list.items[0].client.name, 'Kim Lee');
    const before = w.db.prepare('SELECT COUNT(*) n FROM messages WHERE client_id=?').get(kim.id).n;
    const offered = await w.ok('POST', `/api/waitlist/${item.id}/offer`, { as: coach, body: { start: at(W, '09:00') } });
    assert.equal(offered.item.status, 'offered');
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM messages WHERE client_id=?').get(kim.id).n, before + 1);
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM bookings WHERE client_id=? AND start=?').get(kim.id, at(W, '09:00')).n, 0, 'never booked on their behalf');
  });

  test('reminders go once at 24 h and at 2 h, never for cancelled sessions', async () => {
    const T = addDays(D, 4); // a Friday
    await w.ok('PUT', '/api/push/token', { as: sam, body: { token: 'ab'.repeat(32) } });
    const start = at(T, '07:00');
    const live = rawBooking(sam, 'inperson', start, 60, { createdAt: at(addDays(T, -10), '09:00') });
    rawBooking(sam, 'inperson', at(T, '09:00'), 60, { createdAt: at(addDays(T, -10), '09:00'), cancelled: nowIso() });
    const pushesBefore = w.pushes.length;
    const t24 = new Date(Date.parse(start) - 23 * 3_600_000);
    await w.tick('calendar.reminders', t24);
    await w.tick('calendar.reminders', t24);
    await w.tick('calendar.reminders', new Date(t24.getTime() + 10 * 60_000));
    const rows = () => w.db.prepare('SELECT hours FROM booking_reminders WHERE client_id=? ORDER BY hours').all(sam.id).map(r => r.hours);
    assert.deepEqual(rows(), [24]);
    const t2 = new Date(Date.parse(start) - 90 * 60_000);
    await w.tick('calendar.reminders', t2);
    await w.tick('calendar.reminders', t2);
    assert.deepEqual(rows(), [2, 24]);
    await w.settle();
    const mine = w.pushes.slice(pushesBefore).filter(p => p.kind === 'booking');
    assert.equal(mine.length, 2);
    assert.match(mine[0].aps.alert.body, /Tomorrow 07:00 · 1:1 with John/);
    assert.match(mine[1].aps.alert.body, /In 2 hours/);
    assert.deepEqual(events('booking.upcoming').filter(e => e.payload.bookingId === live).map(e => e.payload.hoursBefore), [24, 2]);
  });
});

describe('isolation, export and erasure', () => {
  test('another coach gets a 404 for every id; a client gets a 403 on coach routes', async () => {
    const src = w.db.prepare('SELECT id FROM calendar_sources WHERE coach_id=?').get(coach.id).id;
    const hold = w.db.prepare('SELECT id FROM calendar_holds WHERE coach_id=?').get(coach.id).id;
    const off = (await w.ok('POST', '/api/calendar/time-off', { as: coach, body: { start: addDays(D, 40), end: addDays(D, 40) } })).item.id;
    const wait = w.db.prepare('SELECT id FROM waitlist').get().id;
    const booking = rawBooking(sam, 'inperson', at(addDays(D, 42), '07:00'));
    const routes = [
      ['PATCH', `/api/calendar/sources/${src}`, { label: 'X' }], ['DELETE', `/api/calendar/sources/${src}`], ['POST', `/api/calendar/sources/${src}/sync`],
      ['DELETE', `/api/calendar/time-off/${off}`], ['PATCH', `/api/calendar/holds/${hold}`, { title: 'X' }], ['DELETE', `/api/calendar/holds/${hold}`],
      ['POST', `/api/calendar/holds/${hold}/convert`, { clientId: other.id }], ['POST', `/api/waitlist/${wait}/offer`, { start: at(addDays(D, 5), '07:00') }],
      ['DELETE', `/api/waitlist/${wait}`], ['POST', `/api/bookings/${booking}/reschedule`, { start: at(addDays(D, 42), '09:00') }],
      ['GET', `/api/calendar/find?clientId=${sam.id}`], ['POST', '/api/waitlist', { clientId: sam.id, fromDay: D, toDay: D }],
    ];
    for (const [method, path, body] of routes) assert.equal((await w.call(method, path, { as: coach2, body })).status, 404, `${method} ${path}`);
    assert.equal((await w.ok('GET', '/api/calendar/sources', { as: coach2 })).sources.length, 0);
    assert.equal((await w.ok('GET', '/api/waitlist', { as: coach2 })).items.length, 0);
    assert.equal((await w.ok('GET', `/api/calendar/conflicts?from=${D}&to=${addDays(D, 20)}`, { as: coach2 })).conflicts.length, 0);
    for (const [method, path] of [['GET', '/api/calendar/sources'], ['GET', '/api/calendar/prefs'], ['PUT', '/api/calendar/prefs'], ['GET', '/api/calendar/conflicts'],
      ['GET', '/api/calendar/holds'], ['POST', '/api/calendar/holds'], ['GET', '/api/calendar/busy'], ['GET', '/api/calendar/find'], ['GET', '/api/waitlist'],
      ['POST', '/api/calendar/time-off'], ['POST', '/api/bookings/series']]) {
      assert.equal((await w.call(method, path, { as: sam, body: method === 'GET' ? undefined : {} })).status, 403, `${method} ${path}`);
    }
  });

  test('a client moved to another coach takes their waitlist entry with them', async () => {
    const lee = w.user('Lee Mover', 'client', coach.id);
    const { item } = await w.ok('POST', '/api/waitlist', { as: coach, body: { clientId: lee.id, kind: 'any', fromDay: D, toDay: addDays(D, 6) } });
    w.db.prepare('UPDATE users SET coach_id=? WHERE id=?').run(coach2.id, lee.id);
    assert.ok(!(await w.ok('GET', '/api/waitlist', { as: coach })).items.some(i => i.id === item.id));
    assert.equal((await w.call('DELETE', `/api/waitlist/${item.id}`, { as: coach })).status, 404);
    assert.ok((await w.ok('GET', '/api/waitlist', { as: coach2 })).items.some(i => i.id === item.id));
  });

  test('exports carry the calendar data; deleting the client leaves no rows', async () => {
    const coachExport = (await w.call('GET', '/api/me/export', { as: coach })).body;
    assert.ok(coachExport.features.calsync.timeOff.length > 0);
    assert.ok(!JSON.stringify(coachExport).includes('abc123secret'), 'never the address');
    const kimExport = (await w.call('GET', '/api/me/export', { as: kim })).body;
    assert.ok(kimExport.features.calsync.waitlist.length > 0);
    await w.ok('DELETE', '/api/me', { as: kim });
    assertNoRowsFor(w.db, kim.id);
    await w.ok('DELETE', '/api/me', { as: sam });
    assertNoRowsFor(w.db, sam.id);
  });
});
