import { clientFor, coachIdOf, requireCoach, requireMember } from './access.mjs';
import { clock, day, fail, instant, num, oneOf, str } from './http.mjs';
import { planOf } from './plans.mjs';
import { coachSettings, meetingUrl } from './settings.mjs';
import { emit } from './events.mjs';
import { sendMessage } from './messages.mjs';
import { notify } from './push.mjs';
import { newId, nowIso, tx } from './store.mjs';
import { addDays, londonClock, londonDay, londonToUtc, monthBounds, weekday } from './time.mjs';

/**
 * Bookings, slots and the calendar engine (docs/design/desk-v2.md F20, F21).
 *
 * A slot is free when nothing in the coach's busy picture touches it: other
 * sessions and holds (widened by the coach's buffers), busy time from their
 * connected calendars, and time off. On top of that come the minimum notice
 * (for clients), the most sessions in a day, and a travel gap before an
 * in-person session that follows a video call. createBooking, standing series
 * and reschedules all re-check with the same function, so a race is a 409.
 *
 * The calendar tables (calendar_prefs, busy_blocks, calendar_sources,
 * calendar_holds, time_off) belong to the calsync feature, which creates them.
 * Every read here is guarded, so a server without that feature keeps the
 * old behaviour.
 */

// The apps' client Sessions tab asks for 30 days back and 60 ahead in one go.
const MAX_RANGE_DAYS = 92;
const MAX_SERIES_WEEKS = 26;

// MARK: - Calendar preferences (calsync's calendar_prefs, read here)

const tablesSeen = new WeakMap(); // db -> Set of table names known to exist

/** Does `name` exist yet? Positive answers are cached; a missing table is asked about again. */
export function hasTable(db, name) {
  let seen = tablesSeen.get(db);
  if (!seen) tablesSeen.set(db, seen = new Set());
  if (seen.has(name)) return true;
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)) { seen.add(name); return true; }
  return false;
}

/** The table defaults (F20), used once a coach has saved their availability rules. */
export const PREF_DEFAULTS = Object.freeze({
  bufferBefore: 0, bufferAfter: 10, minNoticeHours: 12, maxPerDay: null, travelGap: 15,
  cancelNoticeHours: 24, cancelForfeitCredit: true, cancelFeePence: 0, noShowFeePence: 0,
});
/**
 * A coach who has never saved the rules keeps today's behaviour (no buffers,
 * no notice, no travel gap), so turning this on in production moves nobody's
 * bookable times until JK chooses to.
 */
const UNSET = Object.freeze({ ...PREF_DEFAULTS, bufferAfter: 0, minNoticeHours: 0, travelGap: 0 });

export const prefsOut = r => ({
  bufferBefore: r.buffer_before, bufferAfter: r.buffer_after, minNoticeHours: r.min_notice_hours, maxPerDay: r.max_per_day ?? null,
  travelGap: r.travel_gap, cancelNoticeHours: r.cancel_notice_hours, cancelForfeitCredit: !!r.cancel_forfeit_credit,
  cancelFeePence: r.cancel_fee_pence, noShowFeePence: r.noshow_fee_pence, configured: true, updatedAt: r.updated_at,
});

/** The coach's calendar rules, defaults filled in; `configured` says whether they have saved them. */
export function calendarPrefs(db, coachId) {
  const row = hasTable(db, 'calendar_prefs') ? db.prepare('SELECT * FROM calendar_prefs WHERE coach_id=?').get(coachId) : null;
  return row ? prefsOut(row) : { ...UNSET, configured: false, updatedAt: null };
}

/** The cancellation policy (F21) that billing acts on through event payloads. */
export function cancellationPolicy(db, coachId) {
  const p = calendarPrefs(db, coachId);
  return { noticeHours: p.cancelNoticeHours, forfeitCredit: p.cancelForfeitCredit, cancelFeePence: p.cancelFeePence, noShowFeePence: p.noShowFeePence };
}

// MARK: - Credits

/**
 * Session credits for the calendar month containing `date`: the plan's
 * allowance less every credit-using 1:1 booked in that month that wasn't
 * cancelled early enough to be refunded (a refunded booking is deleted).
 */
export function credits(db, user, date = londonDay()) {
  const plan = planOf(db, user);
  const { first, next } = monthBounds(date);
  const used = db.prepare('SELECT COUNT(*) n FROM bookings WHERE client_id=? AND uses_credit=1 AND start>=? AND start<?')
    .get(user.id, londonToUtc(first).toISOString(), londonToUtc(next).toISOString()).n;
  return { creditsTotal: plan.credits, creditsLeft: Math.max(0, plan.credits - used), creditsResetOn: next };
}

// MARK: - Availability

const DEFAULT_RULES = [1, 2, 3, 4, 5].map(weekday => ({ weekday, start: '07:00', end: '19:00', kind: 'inperson', slotMinutes: 60, location: 'Studio 2' }));

export function rulesOf(db, coachId) {
  const row = db.prepare('SELECT body FROM availability WHERE coach_id=?').get(coachId);
  return row ? JSON.parse(row.body).rules : DEFAULT_RULES;
}

function getAvailability(_req, ctx) {
  requireCoach(ctx);
  return { rules: rulesOf(ctx.db, ctx.user.id) };
}

function putAvailability(_req, ctx) {
  requireCoach(ctx);
  const rules = ctx.body.rules;
  if (!Array.isArray(rules) || rules.length > 50) fail(400, 'rules must be a list of up to 50');
  const clean = rules.map((r, i) => {
    const out = {
      weekday: num(r.weekday, `rules[${i}].weekday`, { min: 1, max: 7, int: true }),
      start: clock(r.start, `rules[${i}].start`), end: clock(r.end, `rules[${i}].end`),
      kind: oneOf(r.kind, `rules[${i}].kind`, ['inperson', 'video']),
      slotMinutes: num(r.slotMinutes ?? 60, `rules[${i}].slotMinutes`, { min: 15, max: 240, int: true }),
      location: str(r.location ?? '', `rules[${i}].location`, { max: 80, min: 0 }),
    };
    if (out.end <= out.start) fail(400, `rules[${i}] ends before it starts`);
    return out;
  });
  ctx.db.prepare('INSERT INTO availability (coach_id, body) VALUES (?,?) ON CONFLICT(coach_id) DO UPDATE SET body=excluded.body').run(ctx.user.id, JSON.stringify({ rules: clean }));
  return { rules: clean };
}

// MARK: - The busy picture

const MIN = 60_000;
const KIND_WORD = { inperson: '1:1', video: 'Video', group: 'Class' };
const ms = iso => Date.parse(iso);

/**
 * Everything that occupies the coach between two instants, as
 * `[{type: 'booking'|'hold'|'external'|'timeOff', id, start, end, from, to, kind, title, label}]`
 * where `from`/`to` are epoch ms widened by the buffers (sessions and holds
 * only). `title` is what a clash names ("Sam Carter 1:1", "Dentist", "Busy").
 */
export function busyIntervals(db, coachId, fromIso, toIso, { ignoreBookingId = null, prefs = calendarPrefs(db, coachId) } = {}) {
  const before = prefs.bufferBefore * MIN, after = prefs.bufferAfter * MIN;
  const lo = new Date(ms(fromIso) - 24 * 3_600_000).toISOString(), hi = new Date(ms(toIso) + 24 * 3_600_000).toISOString();
  const out = [];
  const rows = db.prepare(`SELECT b.id, b.kind, b.start, b.end, b.title, u.name client_name FROM bookings b LEFT JOIN users u ON u.id=b.client_id
    WHERE b.coach_id=? AND b.cancelled_at IS NULL AND b.end>? AND b.start<? AND b.id IS NOT ?`).all(coachId, lo, hi, ignoreBookingId);
  for (const b of rows) {
    out.push({ type: 'booking', id: b.id, start: b.start, end: b.end, from: ms(b.start) - before, to: ms(b.end) + after, kind: b.kind,
      title: b.kind === 'group' ? b.title : `${b.client_name ?? 'Client'} ${KIND_WORD[b.kind] ?? '1:1'}`, clientName: b.client_name ?? null });
  }
  if (hasTable(db, 'calendar_holds')) {
    for (const h of db.prepare('SELECT id, kind, title, start, end FROM calendar_holds WHERE coach_id=? AND end>? AND start<?').all(coachId, lo, hi)) {
      out.push({ type: 'hold', id: h.id, start: h.start, end: h.end, from: ms(h.start) - before, to: ms(h.end) + after, kind: h.kind, title: h.title });
    }
  }
  if (hasTable(db, 'busy_blocks')) {
    const blocks = db.prepare(`SELECT k.*, s.label FROM busy_blocks k JOIN calendar_sources s ON s.id=k.source_id
      WHERE k.coach_id=? AND s.active=1 AND k.end>? AND k.start<?`).all(coachId, lo, hi);
    for (const k of blocks) out.push({ type: 'external', id: k.id, key: k.ext_key ?? k.id, start: k.start, end: k.end, from: ms(k.start), to: ms(k.end), allDay: !!k.all_day, title: k.title || 'Busy', label: k.label });
  }
  if (hasTable(db, 'time_off')) {
    for (const t of db.prepare('SELECT id, start, end, reason FROM time_off WHERE coach_id=? AND end>? AND start<?').all(coachId, lo, hi)) {
      out.push({ type: 'timeOff', id: t.id, start: t.start, end: t.end, from: ms(t.start), to: ms(t.end), title: t.reason || 'Time off' });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

/** Sessions on each London day (for the daily cap), from the busy picture. */
function sessionsPerDay(intervals) {
  const out = new Map();
  for (const i of intervals) if (i.type === 'booking') { const d = londonDay(new Date(i.start)); out.set(d, (out.get(d) ?? 0) + 1); }
  return out;
}

const named = i => (i.type === 'external' && i.label ? `${i.title} (${i.label})` : i.title);

/**
 * Why [startMs, endMs) of `kind` cannot be booked, or null when it can.
 * Returns {reason, with} where `with` is the interval in the way.
 */
export function clashOf(intervals, prefs, startMs, endMs, kind, { perDay = null } = {}) {
  for (const i of intervals) {
    if (i.type === 'timeOff' && i.from < endMs && i.to > startMs) return { reason: 'time off', code: 'timeOff', with: i };
  }
  if (prefs.maxPerDay) {
    const d = londonDay(new Date(startMs));
    const n = (perDay ?? sessionsPerDay(intervals)).get(d) ?? 0;
    if (n >= prefs.maxPerDay) return { reason: `already ${n} sessions that day`, code: 'capacity', with: null };
  }
  for (const i of intervals) {
    if (i.type === 'timeOff') continue;
    if (ms(i.start) < endMs && ms(i.end) > startMs) return { reason: `clash with ${named(i)}`, code: i.type === 'external' ? 'external' : 'overlap', with: i };
  }
  // Buffers both ways: their buffer around them, and this session's own buffer around it.
  const before = prefs.bufferBefore * MIN, after = prefs.bufferAfter * MIN;
  for (const i of intervals) {
    if (i.type !== 'booking' && i.type !== 'hold') continue;
    if ((i.from < endMs && i.to > startMs) || (ms(i.start) < endMs + after && ms(i.end) > startMs - before)) return { reason: `too close to ${i.title} (buffer)`, code: 'buffer', with: i };
  }
  if (kind === 'inperson' && prefs.travelGap > 0) {
    for (const i of intervals) {
      if (i.type === 'booking' && i.kind === 'video' && ms(i.end) <= startMs && startMs - ms(i.end) < prefs.travelGap * MIN
        && londonDay(new Date(i.end)) === londonDay(new Date(startMs))) return { reason: `no travel gap after ${i.title}`, code: 'travel', with: i };
    }
  }
  return null;
}

/**
 * Every slot the rules make in [from, to] (London days), with `open` false
 * (and a `reason`) where something is in the way, it has passed, or (with
 * `notice`, for clients) it is inside the coach's minimum notice.
 */
export function slotsFor(db, coachId, from, to, kind, { now = new Date(), notice = false, ignoreBookingId = null } = {}) {
  const rules = rulesOf(db, coachId).filter(r => !kind || r.kind === kind);
  const prefs = calendarPrefs(db, coachId);
  const intervals = busyIntervals(db, coachId, londonToUtc(from).toISOString(), londonToUtc(addDays(to, 1)).toISOString(), { ignoreBookingId, prefs });
  const perDay = sessionsPerDay(intervals);
  const earliest = now.getTime() + (notice ? prefs.minNoticeHours * 3_600_000 : 0);
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const r of rules.filter(r => r.weekday === weekday(d))) {
      const [sh, sm] = r.start.split(':').map(Number), [eh, em] = r.end.split(':').map(Number);
      for (let m = sh * 60 + sm; m + r.slotMinutes <= eh * 60 + em; m += r.slotMinutes) {
        const label = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        const start = londonToUtc(d, label);
        const end = new Date(start.getTime() + r.slotMinutes * MIN);
        let reason = null;
        if (start.getTime() <= now.getTime()) reason = 'passed';
        else if (start.getTime() < earliest) reason = 'too soon';
        else reason = clashOf(intervals, prefs, start.getTime(), end.getTime(), r.kind, { perDay })?.reason ?? null;
        out.push({ start: start.toISOString(), end: end.toISOString(), kind: r.kind, location: r.location, open: !reason, ...(reason ? { reason } : {}) });
      }
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** The coach-side check for any time (not only the rules' grid): null when free, else {reason, code, with}. */
export function freeCheck(db, coachId, startIso, endIso, kind, { ignoreBookingId = null } = {}) {
  const prefs = calendarPrefs(db, coachId);
  const intervals = busyIntervals(db, coachId, startIso, endIso, { ignoreBookingId, prefs });
  return clashOf(intervals, prefs, ms(startIso), ms(endIso), kind);
}

function rangeOf(query) {
  const from = day(query.from, 'from', { optional: true }) ?? londonDay();
  const to = day(query.to, 'to', { optional: true }) ?? addDays(from, 13);
  if (to < from) fail(400, 'to is before from');
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_RANGE_DAYS) fail(400, `At most ${MAX_RANGE_DAYS} days at a time`);
  return { from, to };
}

function listSlots(_req, ctx) {
  requireMember(ctx);
  const coachId = coachIdOf(ctx.user);
  if (!coachId) return { slots: [] };
  const { from, to } = rangeOf(ctx.query);
  const kind = ctx.query.kind ? oneOf(ctx.query.kind, 'kind', ['inperson', 'video']) : null;
  return { slots: slotsFor(ctx.db, coachId, from, to, kind, { notice: ctx.user.role === 'client' }) };
}

// MARK: - Bookings

function bookingOut(db, b, viewer) {
  const client = b.client_id ? db.prepare('SELECT id, name FROM users WHERE id=?').get(b.client_id) : null;
  const attendees = b.kind === 'group' ? db.prepare('SELECT u.id, u.name FROM class_attendees a JOIN users u ON u.id = a.user_id WHERE a.booking_id=? ORDER BY u.name').all(b.id) : [];
  const mine = viewer.role === 'coach' || b.client_id === viewer.id || attendees.some(a => a.id === viewer.id);
  const noticeHours = calendarPrefs(db, b.coach_id).cancelNoticeHours;
  return {
    id: b.id, kind: b.kind, start: b.start, end: b.end, location: b.location, title: b.title, purpose: b.purpose ?? null,
    client: client ? { id: client.id, name: client.name } : null,
    attendees: viewer.role === 'coach' ? attendees.map(a => ({ id: a.id, name: a.name })) : attendees.filter(a => a.id === viewer.id).map(a => ({ id: a.id, name: a.name })),
    attendeeCount: attendees.length, capacity: b.capacity, usesCredit: !!b.uses_credit,
    joined: b.kind === 'group' ? attendees.some(a => a.id === viewer.id) : mine,
    cancellable: mine && Date.parse(b.start) > Date.now(),
    refundable: Date.parse(b.start) - Date.now() >= noticeHours * 3_600_000,
    // A video call's room: its own link, else the coach's default room; null until one exists ("Details", not "Join").
    meetingUrl: mine ? resolvedMeetingUrl(db, b) : null,
    seriesId: b.series_id ?? null,
  };
}

export const resolvedMeetingUrl = (db, b) => b.meeting_url ?? (b.kind === 'video' ? coachSettings(db, b.coach_id).defaultMeetingUrl : null);

/** What a 1:1 is for: a planning session, a weekly accountability (review) session, or nothing said. */
export const PURPOSES = ['planning', 'review'];
const purposeOf = v => (v === null || v === '' ? null : oneOf(v, 'purpose', PURPOSES));

/**
 * The coach changes a booking: its own meeting link and/or its purpose. A body
 * without `purpose` is the old call, which sets (or clears) the meeting link.
 */
function setMeeting(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.db.prepare('SELECT * FROM bookings WHERE id=? AND coach_id=?').get(ctx.params.id, ctx.user.id);
  if (!b) fail(404, 'Not found');
  const body = ctx.body;
  if (body.purpose !== undefined) {
    if (b.kind === 'group' && body.purpose !== null) fail(400, 'A group class has no purpose');
    ctx.db.prepare('UPDATE bookings SET purpose=? WHERE id=?').run(purposeOf(body.purpose), b.id);
  }
  if (body.purpose === undefined || body.meetingUrl !== undefined) {
    ctx.db.prepare('UPDATE bookings SET meeting_url=? WHERE id=?').run(meetingUrl(body.meetingUrl ?? null, 'meetingUrl'), b.id);
  }
  return bookingOut(ctx.db, ctx.db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id), ctx.user);
}

function listBookings(_req, ctx) {
  requireMember(ctx);
  const { from, to } = rangeOf(ctx.query);
  const lo = londonToUtc(from).toISOString(), hi = londonToUtc(addDays(to, 1)).toISOString();
  let rows;
  if (ctx.user.role === 'coach') {
    const client = clientFor(ctx, ctx.query.clientId, { coachMayOmit: true });
    rows = client
      ? ctx.db.prepare(`SELECT * FROM bookings WHERE coach_id=? AND cancelled_at IS NULL AND start>=? AND start<? AND (client_id=? OR id IN (SELECT booking_id FROM class_attendees WHERE user_id=?)) ORDER BY start`).all(ctx.user.id, lo, hi, client.id, client.id)
      : ctx.db.prepare('SELECT * FROM bookings WHERE coach_id=? AND cancelled_at IS NULL AND start>=? AND start<? ORDER BY start').all(ctx.user.id, lo, hi);
  } else {
    // A client sees their own 1:1s and every group class their coach runs (to join).
    rows = ctx.db.prepare(`SELECT * FROM bookings WHERE cancelled_at IS NULL AND start>=? AND start<? AND (client_id=? OR (kind='group' AND coach_id=?)) ORDER BY start`).all(lo, hi, ctx.user.id, ctx.user.coach_id ?? '');
  }
  return { bookings: rows.map(b => bookingOut(ctx.db, b, ctx.user)) };
}

/** Insert one 1:1 (coach or client booking, a series occurrence, a converted hold) and emit booking.created. Inside the caller's tx. */
export function insertBooking(db, { coachId, client, kind, start, end, location, purpose = null, usesCredit, seriesId = null, byRole }) {
  const id = newId('b');
  const coach = db.prepare('SELECT name FROM users WHERE id=?').get(coachId);
  db.prepare('INSERT INTO bookings (id, coach_id, client_id, kind, start, end, location, title, uses_credit, created_at, purpose) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    id, coachId, client.id, kind, start, end, location ?? (kind === 'video' ? 'Video call' : ''),
    `${kind === 'video' ? 'Video call' : '1:1'} with ${coach.name}`, usesCredit ? 1 : 0, nowIso(), purpose);
  // bookings.series_id comes with the calsync feature's schema; only a series sets it.
  if (seriesId) db.prepare('UPDATE bookings SET series_id=? WHERE id=?').run(seriesId, id);
  emit(db, 'booking.created', { coachId, clientId: client.id, summary: `Booked ${shortWhen(start)}`, ...bookingPayload({ id, kind, start, purpose }, byRole) });
  return id;
}

const usesCreditFor = (ctx, client) => planOf(ctx.db, client).credits > 0 || ctx.config.gateServices === false;

function createBooking(_req, ctx) {
  requireMember(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  const coachId = client.coach_id;
  if (!coachId) fail(409, 'You do not have a coach yet');
  const start = instant(ctx.body.start, 'start');
  const kind = oneOf(ctx.body.kind, 'kind', ['inperson', 'video']);
  const purpose = ctx.body.purpose === undefined ? null : purposeOf(ctx.body.purpose);
  const startDay = londonDay(new Date(start));
  // The same check the slot list used: a slot taken (or blocked) since is a 409.
  const slot = slotsFor(ctx.db, coachId, startDay, startDay, kind, { notice: ctx.user.role === 'client' }).find(s => s.start === start);
  if (!slot) fail(400, 'That time is not one of the coach\'s slots');
  if (!slot.open) fail(409, slot.reason === 'passed' ? 'That time has passed' : 'That time has just gone');
  // The coach booking on a client's behalf still uses the client's credit, so the allowance means one thing.
  const usesCredit = usesCreditFor(ctx, client);
  const out = tx(ctx.db, () => {
    if (ctx.config.gateServices && credits(ctx.db, client, startDay).creditsLeft < 1) fail(409, 'No session credits left this month');
    const id = insertBooking(ctx.db, { coachId, client, kind, start: slot.start, end: slot.end, location: kind === 'video' ? 'Video call' : slot.location, purpose, usesCredit, byRole: ctx.user.role });
    return bookingOut(ctx.db, ctx.db.prepare('SELECT * FROM bookings WHERE id=?').get(id), ctx.user);
  });
  const what = `${kind === 'video' ? 'Video call' : '1:1'} · ${when(slot.start)}`;
  if (ctx.user.role === 'coach') notify(ctx.db, ctx.config, client.id, { title: `${ctx.user.name} booked you in`, body: what, kind: 'booking', id: out.id });
  else notify(ctx.db, ctx.config, coachId, { title: `${client.name} booked a session`, body: what, kind: 'booking', id: out.id, clientId: client.id });
  return out;
}

/** Is a cancel at `now` late (inside the coach's notice)? */
const isLate = (policy, b, now) => Date.parse(b.start) - now.getTime() < policy.noticeHours * 3_600_000;

function cancelBooking(_req, ctx) {
  requireMember(ctx);
  const b = ctx.db.prepare('SELECT * FROM bookings WHERE id=? AND cancelled_at IS NULL').get(ctx.params.id);
  if (!b) fail(404, 'Not found');
  const isCoach = ctx.user.role === 'coach' && b.coach_id === ctx.user.id;
  if (!isCoach && b.client_id !== ctx.user.id) fail(404, 'Not found');
  const now = new Date();
  if (Date.parse(b.start) <= now.getTime()) fail(409, 'That session has already started');
  const policy = cancellationPolicy(ctx.db, b.coach_id);
  const late = !isCoach && isLate(policy, b, now);
  // Early enough, the coach cancelling, or a policy that never forfeits: the booking goes, and with it the credit it used.
  const refunded = isCoach || !late || !policy.forfeitCredit;
  tx(ctx.db, () => {
    if (refunded) ctx.db.prepare('DELETE FROM bookings WHERE id=?').run(b.id);
    else ctx.db.prepare('UPDATE bookings SET cancelled_at=? WHERE id=?').run(nowIso(), b.id);
    emit(ctx.db, 'booking.cancelled', { coachId: b.coach_id, clientId: b.client_id, summary: `Cancelled ${shortWhen(b.start)}${late ? ' (late)' : ''}`,
      ...bookingPayload(b, ctx.user.role, { late, refunded }),
      ...(late ? { policy: { forfeitCredit: policy.forfeitCredit, feePence: policy.cancelFeePence } } : {}) });
  });
  if (b.client_id) {
    const other = isCoach ? b.client_id : b.coach_id;
    notify(ctx.db, ctx.config, other, { title: `${ctx.user.name} cancelled`, body: `${b.title ?? 'Session'} · ${when(b.start)}`, kind: 'booking', clientId: b.client_id });
  }
  return { ok: true, refunded, late };
}

/** "Tue 4 Nov 07:00" in London time, for an event summary. */
export const shortWhen = iso => `${new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')} ${new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })}`;

/** The booking.created / booking.cancelled payload (docs/design/desk-v2.md 3.2). */
const bookingPayload = (b, byRole, { late = false, refunded = false } = {}) => ({ bookingId: b.id, kind: b.kind, start: b.start, purpose: b.purpose ?? null, byRole, late, refunded });

/** "Sat 28 Nov, 09:00" in London time, for a notification. */
const when = iso => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// MARK: - Standing sessions (F21)

/**
 * POST /api/bookings/series: the same time each week for N weeks. Every
 * occurrence is checked like a slot; the free ones are booked in one
 * transaction and the rest come back as {start, reason}.
 */
const hasSeries = db => db.prepare('PRAGMA table_info(bookings)').all().some(c => c.name === 'series_id');

function createSeries(_req, ctx) {
  requireCoach(ctx);
  if (!hasSeries(ctx.db)) fail(404, 'Not found');
  const client = clientFor(ctx, ctx.body.clientId);
  const kind = oneOf(ctx.body.kind, 'kind', ['inperson', 'video']);
  const first = instant(ctx.body.start, 'start');
  const minutes = num(ctx.body.minutes ?? 60, 'minutes', { min: 15, max: 240, int: true });
  const weeks = num(ctx.body.weeks, 'weeks', { min: 2, max: MAX_SERIES_WEEKS, int: true });
  const purpose = ctx.body.purpose === undefined ? null : purposeOf(ctx.body.purpose);
  const now = new Date();
  if (Date.parse(first) <= now.getTime()) fail(400, 'That time has passed');
  const firstDay = londonDay(new Date(first)), at = londonClock(new Date(first));
  const location = kind === 'video' ? 'Video call' : (str(ctx.body.location ?? '', 'location', { max: 80, min: 0 }) || rulesOf(ctx.db, ctx.user.id).find(r => r.kind === 'inperson')?.location || 'Studio 2');
  const prefs = calendarPrefs(ctx.db, ctx.user.id);
  const usesCredit = usesCreditFor(ctx, client);
  const seriesId = newId('b');
  const out = tx(ctx.db, () => {
    const lastStart = londonToUtc(addDays(firstDay, 7 * (weeks - 1)), at);
    const intervals = busyIntervals(ctx.db, ctx.user.id, first, new Date(lastStart.getTime() + minutes * MIN).toISOString(), { prefs });
    const booked = [], skipped = [];
    for (let w = 0; w < weeks; w++) {
      const s = londonToUtc(addDays(firstDay, 7 * w), at), e = new Date(s.getTime() + minutes * MIN);
      const clash = clashOf(intervals, prefs, s.getTime(), e.getTime(), kind);
      if (clash) { skipped.push({ start: s.toISOString(), reason: clash.reason }); continue; }
      if (ctx.config.gateServices && usesCredit && credits(ctx.db, client, londonDay(s)).creditsLeft < 1) { skipped.push({ start: s.toISOString(), reason: 'no credits left that month' }); continue; }
      const id = insertBooking(ctx.db, { coachId: ctx.user.id, client, kind, start: s.toISOString(), end: e.toISOString(), location, purpose, usesCredit, seriesId, byRole: 'coach' });
      intervals.push({ type: 'booking', id, start: s.toISOString(), end: e.toISOString(), from: s.getTime() - prefs.bufferBefore * MIN, to: e.getTime() + prefs.bufferAfter * MIN, kind, title: `${client.name} ${KIND_WORD[kind]}` });
      booked.push(id);
    }
    if (booked.length) emit(ctx.db, 'booking.series', { coachId: ctx.user.id, clientId: client.id, summary: `Standing ${KIND_WORD[kind]} · ${booked.length} weeks`, seriesId, count: booked.length });
    return { booked, skipped };
  });
  if (out.booked.length) notify(ctx.db, ctx.config, client.id, { title: `${ctx.user.name} booked you in`, body: `${out.booked.length} weekly sessions from ${when(first)}`, kind: 'booking' });
  return {
    seriesId: out.booked.length ? seriesId : null,
    booked: out.booked.map(id => bookingOut(ctx.db, ctx.db.prepare('SELECT * FROM bookings WHERE id=?').get(id), ctx.user)),
    skipped: out.skipped,
  };
}

/** POST /api/bookings/series/:seriesId/cancel {from?}: this and every later session of a series. */
function cancelSeries(_req, ctx) {
  requireCoach(ctx);
  if (!hasSeries(ctx.db)) fail(404, 'Not found');
  const rows = ctx.db.prepare('SELECT * FROM bookings WHERE series_id=? AND coach_id=? AND cancelled_at IS NULL ORDER BY start').all(ctx.params.seriesId, ctx.user.id);
  if (!rows.length) fail(404, 'Not found');
  const from = ctx.body.from === undefined || ctx.body.from === null ? nowIso() : instant(ctx.body.from, 'from');
  const now = Date.now();
  const gone = rows.filter(b => b.start >= from && Date.parse(b.start) > now);
  tx(ctx.db, () => {
    for (const b of gone) {
      ctx.db.prepare('DELETE FROM bookings WHERE id=?').run(b.id);
      emit(ctx.db, 'booking.cancelled', { coachId: b.coach_id, clientId: b.client_id, summary: `Cancelled ${shortWhen(b.start)}`, ...bookingPayload(b, 'coach', { refunded: true }) });
    }
  });
  if (gone.length && gone[0].client_id) notify(ctx.db, ctx.config, gone[0].client_id, { title: `${ctx.user.name} cancelled`, body: `${gone.length} weekly session${gone.length === 1 ? '' : 's'} from ${when(gone[0].start)}`, kind: 'booking', clientId: gone[0].client_id });
  return { cancelled: gone.length };
}

// MARK: - Reschedule (F21)

/**
 * POST /api/bookings/:id/reschedule {start, message?}. The coach may move any
 * of their bookings to any free time; a client may move their own 1:1 to an
 * open slot, with at least the coach's cancellation notice. A clash is a 409.
 */
function reschedule(_req, ctx) {
  requireMember(ctx);
  const b = ctx.db.prepare('SELECT * FROM bookings WHERE id=? AND cancelled_at IS NULL').get(ctx.params.id);
  const isCoach = ctx.user.role === 'coach' && b?.coach_id === ctx.user.id;
  if (!b || (!isCoach && (b.client_id !== ctx.user.id || b.kind === 'group'))) fail(404, 'Not found');
  const start = instant(ctx.body.start, 'start');
  const now = new Date();
  if (Date.parse(start) <= now.getTime()) fail(400, 'That time has passed');
  if (Date.parse(b.start) <= now.getTime()) fail(409, 'That session has already started');
  if (start === b.start) fail(400, 'That is the same time');
  const length = Date.parse(b.end) - Date.parse(b.start);
  const end = new Date(Date.parse(start) + length).toISOString();
  if (isCoach) {
    const clash = freeCheck(ctx.db, b.coach_id, start, end, b.kind, { ignoreBookingId: b.id });
    if (clash) fail(409, `That time is not free: ${clash.reason}`);
  } else {
    const policy = cancellationPolicy(ctx.db, b.coach_id);
    if (isLate(policy, b, now)) fail(400, `Sessions can be moved up to ${policy.noticeHours} hours before. Message your coach instead.`);
    const d = londonDay(new Date(start));
    const slot = slotsFor(ctx.db, b.coach_id, d, d, b.kind, { now, notice: true, ignoreBookingId: b.id }).find(s => s.start === start);
    if (!slot) fail(400, 'That time is not one of the coach\'s slots');
    if (!slot.open) fail(409, 'That time has just gone');
  }
  const message = ctx.body.message === undefined || ctx.body.message === null || ctx.body.message === '' ? null : str(ctx.body.message, 'message', { max: 2000 });
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE bookings SET start=?, end=? WHERE id=?').run(start, end, b.id);
    emit(ctx.db, 'booking.rescheduled', { coachId: b.coach_id, clientId: b.client_id, summary: `Moved ${shortWhen(b.start)} → ${shortWhen(start)}`,
      bookingId: b.id, from: b.start, to: start, byRole: ctx.user.role });
    if (isCoach && message && b.client_id) sendMessage(ctx.db, ctx.config, { coachId: b.coach_id, clientId: b.client_id, text: message, via: 'coachAction' });
  });
  const body = `${b.title ?? 'Session'} · now ${when(start)}`;
  if (isCoach) {
    const people = b.kind === 'group' ? ctx.db.prepare('SELECT user_id id FROM class_attendees WHERE booking_id=?').all(b.id).map(r => r.id) : [b.client_id].filter(Boolean);
    for (const id of people) notify(ctx.db, ctx.config, id, { title: `${ctx.user.name} moved your session`, body, kind: 'booking', id: b.id });
  } else notify(ctx.db, ctx.config, b.coach_id, { title: `${ctx.user.name} moved a session`, body, kind: 'booking', id: b.id, clientId: b.client_id });
  return { booking: bookingOut(ctx.db, ctx.db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id), ctx.user) };
}

// MARK: - Group classes

function createClass(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const start = instant(b.start, 'start'), end = instant(b.end, 'end');
  if (end <= start) fail(400, 'end is before start');
  const id = newId('b');
  const title = str(b.title, 'title', { max: 80 });
  tx(ctx.db, () => {
    ctx.db.prepare("INSERT INTO bookings (id, coach_id, kind, start, end, location, title, capacity, created_at) VALUES (?,?,'group',?,?,?,?,?,?)").run(
      id, ctx.user.id, start, end, str(b.location ?? '', 'location', { max: 80, min: 0 }), title,
      num(b.capacity, 'capacity', { min: 1, max: 100, int: true }), nowIso());
    emit(ctx.db, 'booking.created', { coachId: ctx.user.id, clientId: null, summary: `${title} · ${shortWhen(start)}`, ...bookingPayload({ id, kind: 'group', start }, 'coach') });
  });
  return bookingOut(ctx.db, ctx.db.prepare('SELECT * FROM bookings WHERE id=?').get(id), ctx.user);
}

function classFor(ctx) {
  const b = ctx.db.prepare("SELECT * FROM bookings WHERE id=? AND kind='group' AND cancelled_at IS NULL").get(ctx.params.id);
  if (!b || b.coach_id !== coachIdOf(ctx.user)) fail(404, 'Not found');
  return b;
}

function joinClass(_req, ctx) {
  requireMember(ctx);
  if (ctx.user.role !== 'client') fail(403, 'Clients only');
  const b = classFor(ctx);
  if (Date.parse(b.start) <= Date.now()) fail(409, 'That class has already started');
  tx(ctx.db, () => {
    const n = ctx.db.prepare('SELECT COUNT(*) n FROM class_attendees WHERE booking_id=?').get(b.id).n;
    const already = ctx.db.prepare('SELECT 1 FROM class_attendees WHERE booking_id=? AND user_id=?').get(b.id, ctx.user.id);
    if (!already && n >= b.capacity) fail(409, 'That class is full');
    ctx.db.prepare('INSERT OR IGNORE INTO class_attendees (booking_id, user_id) VALUES (?,?)').run(b.id, ctx.user.id);
    if (!already) emit(ctx.db, 'booking.created', { coachId: b.coach_id, clientId: ctx.user.id, summary: `Joined ${b.title} · ${shortWhen(b.start)}`, ...bookingPayload(b, 'client') });
  });
  return bookingOut(ctx.db, b, ctx.user);
}

function leaveClass(_req, ctx) {
  requireMember(ctx);
  const b = classFor(ctx);
  tx(ctx.db, () => {
    const left = ctx.db.prepare('DELETE FROM class_attendees WHERE booking_id=? AND user_id=?').run(b.id, ctx.user.id).changes;
    if (left) emit(ctx.db, 'booking.cancelled', { coachId: b.coach_id, clientId: ctx.user.id, summary: `Left ${b.title} · ${shortWhen(b.start)}`, ...bookingPayload(b, ctx.user.role, { refunded: true }) });
  });
  return bookingOut(ctx.db, b, ctx.user);
}

export function bookingRoutes(r) {
  r.add('GET', '/api/availability', getAvailability);
  r.add('PUT', '/api/availability', putAvailability);
  r.add('GET', '/api/slots', listSlots);
  r.add('GET', '/api/bookings', listBookings);
  r.add('POST', '/api/bookings', createBooking);
  r.add('POST', '/api/bookings/series', createSeries);
  r.add('POST', '/api/bookings/series/:seriesId/cancel', cancelSeries);
  r.add('POST', '/api/bookings/:id/reschedule', reschedule);
  r.add('DELETE', '/api/bookings/:id', cancelBooking);
  r.add('PATCH', '/api/bookings/:id', setMeeting);
  r.add('POST', '/api/classes', createClass);
  r.add('POST', '/api/classes/:id/join', joinClass);
  r.add('POST', '/api/classes/:id/leave', leaveClass);
}

export { bookingOut };
