import { clientFor, coachIdOf, requireCoach, requireMember } from './access.mjs';
import { clock, day, fail, instant, num, oneOf, str } from './http.mjs';
import { planOf } from './plans.mjs';
import { notify } from './push.mjs';
import { newId, nowIso, tx } from './store.mjs';
import { addDays, londonDay, londonToUtc, monthBounds, weekday } from './time.mjs';

const CANCEL_HOURS = 24;
// The apps' client Sessions tab asks for 30 days back and 60 ahead in one go.
const MAX_RANGE_DAYS = 92;

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

function rulesOf(db, coachId) {
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

/** Every slot the rules make in [from, to], with `open` false where something is already booked or it has passed. */
export function slotsFor(db, coachId, from, to, kind) {
  const rules = rulesOf(db, coachId).filter(r => !kind || r.kind === kind);
  const busy = db.prepare('SELECT start, end FROM bookings WHERE coach_id=? AND cancelled_at IS NULL AND end>? AND start<?')
    .all(coachId, londonToUtc(from).toISOString(), londonToUtc(addDays(to, 1)).toISOString());
  const now = Date.now();
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const r of rules.filter(r => r.weekday === weekday(d))) {
      const [sh, sm] = r.start.split(':').map(Number), [eh, em] = r.end.split(':').map(Number);
      for (let m = sh * 60 + sm; m + r.slotMinutes <= eh * 60 + em; m += r.slotMinutes) {
        const label = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        const start = londonToUtc(d, label);
        const end = new Date(start.getTime() + r.slotMinutes * 60_000);
        const clash = busy.some(b => Date.parse(b.start) < end.getTime() && Date.parse(b.end) > start.getTime());
        out.push({ start: start.toISOString(), end: end.toISOString(), kind: r.kind, location: r.location, open: !clash && start.getTime() > now });
      }
    }
  }
  return out;
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
  return { slots: slotsFor(ctx.db, coachId, from, to, kind) };
}

// MARK: - Bookings

function bookingOut(db, b, viewer) {
  const client = b.client_id ? db.prepare('SELECT id, name FROM users WHERE id=?').get(b.client_id) : null;
  const attendees = b.kind === 'group' ? db.prepare('SELECT u.id, u.name FROM class_attendees a JOIN users u ON u.id = a.user_id WHERE a.booking_id=? ORDER BY u.name').all(b.id) : [];
  const mine = viewer.role === 'coach' || b.client_id === viewer.id || attendees.some(a => a.id === viewer.id);
  return {
    id: b.id, kind: b.kind, start: b.start, end: b.end, location: b.location, title: b.title,
    client: client ? { id: client.id, name: client.name } : null,
    attendees: viewer.role === 'coach' ? attendees.map(a => ({ id: a.id, name: a.name })) : attendees.filter(a => a.id === viewer.id).map(a => ({ id: a.id, name: a.name })),
    attendeeCount: attendees.length, capacity: b.capacity, usesCredit: !!b.uses_credit,
    joined: b.kind === 'group' ? attendees.some(a => a.id === viewer.id) : mine,
    cancellable: mine && Date.parse(b.start) > Date.now(),
    refundable: Date.parse(b.start) - Date.now() >= CANCEL_HOURS * 3_600_000,
  };
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

function createBooking(_req, ctx) {
  requireMember(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  const coachId = client.coach_id;
  if (!coachId) fail(409, 'You do not have a coach yet');
  const start = instant(ctx.body.start, 'start');
  const kind = oneOf(ctx.body.kind, 'kind', ['inperson', 'video']);
  const startDay = londonDay(new Date(start));
  const slot = slotsFor(ctx.db, coachId, startDay, startDay, kind).find(s => s.start === start);
  if (!slot) fail(400, 'That time is not one of the coach\'s slots');
  if (!slot.open) fail(409, 'That slot has just been taken');
  // The coach booking on a client's behalf still uses the client's credit, so the allowance means one thing.
  const usesCredit = planOf(ctx.db, client).credits > 0 || ctx.config.gateServices === false;
  const out = tx(ctx.db, () => {
    if (ctx.config.gateServices && credits(ctx.db, client, startDay).creditsLeft < 1) fail(409, 'No session credits left this month');
    const id = newId('b');
    const coach = ctx.db.prepare('SELECT name FROM users WHERE id=?').get(coachId);
    ctx.db.prepare('INSERT INTO bookings (id, coach_id, client_id, kind, start, end, location, title, uses_credit, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      id, coachId, client.id, kind, slot.start, slot.end, kind === 'video' ? 'Video call' : slot.location,
      `${kind === 'video' ? 'Video call' : '1:1'} with ${coach.name}`, usesCredit ? 1 : 0, nowIso());
    return bookingOut(ctx.db, ctx.db.prepare('SELECT * FROM bookings WHERE id=?').get(id), ctx.user);
  });
  const what = `${kind === 'video' ? 'Video call' : '1:1'} · ${when(slot.start)}`;
  if (ctx.user.role === 'coach') notify(ctx.db, ctx.config, client.id, { title: `${ctx.user.name} booked you in`, body: what, kind: 'booking', id: out.id });
  else notify(ctx.db, ctx.config, coachId, { title: `${client.name} booked a session`, body: what, kind: 'booking', id: out.id, clientId: client.id });
  return out;
}

function cancelBooking(_req, ctx) {
  requireMember(ctx);
  const b = ctx.db.prepare('SELECT * FROM bookings WHERE id=? AND cancelled_at IS NULL').get(ctx.params.id);
  if (!b) fail(404, 'Not found');
  const isCoach = ctx.user.role === 'coach' && b.coach_id === ctx.user.id;
  if (!isCoach && b.client_id !== ctx.user.id) fail(404, 'Not found');
  if (Date.parse(b.start) <= Date.now()) fail(409, 'That session has already started');
  // Early enough (or the coach cancelling): the booking goes, and with it the credit it used.
  const refunded = isCoach || Date.parse(b.start) - Date.now() >= CANCEL_HOURS * 3_600_000;
  if (refunded) ctx.db.prepare('DELETE FROM bookings WHERE id=?').run(b.id);
  else ctx.db.prepare('UPDATE bookings SET cancelled_at=? WHERE id=?').run(nowIso(), b.id);
  if (b.client_id) {
    const other = isCoach ? b.client_id : b.coach_id;
    notify(ctx.db, ctx.config, other, { title: `${ctx.user.name} cancelled`, body: `${b.title ?? 'Session'} · ${when(b.start)}`, kind: 'booking', clientId: b.client_id });
  }
  return { ok: true, refunded };
}

/** "Sat 28 Nov, 09:00" in London time, for a notification. */
const when = iso => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// MARK: - Group classes

function createClass(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const start = instant(b.start, 'start'), end = instant(b.end, 'end');
  if (end <= start) fail(400, 'end is before start');
  const id = newId('b');
  ctx.db.prepare("INSERT INTO bookings (id, coach_id, kind, start, end, location, title, capacity, created_at) VALUES (?,?,'group',?,?,?,?,?,?)").run(
    id, ctx.user.id, start, end, str(b.location ?? '', 'location', { max: 80, min: 0 }), str(b.title, 'title', { max: 80 }),
    num(b.capacity, 'capacity', { min: 1, max: 100, int: true }), nowIso());
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
  });
  return bookingOut(ctx.db, b, ctx.user);
}

function leaveClass(_req, ctx) {
  requireMember(ctx);
  const b = classFor(ctx);
  ctx.db.prepare('DELETE FROM class_attendees WHERE booking_id=? AND user_id=?').run(b.id, ctx.user.id);
  return bookingOut(ctx.db, b, ctx.user);
}

export function bookingRoutes(r) {
  r.add('GET', '/api/availability', getAvailability);
  r.add('PUT', '/api/availability', putAvailability);
  r.add('GET', '/api/slots', listSlots);
  r.add('GET', '/api/bookings', listBookings);
  r.add('POST', '/api/bookings', createBooking);
  r.add('DELETE', '/api/bookings/:id', cancelBooking);
  r.add('POST', '/api/classes', createClass);
  r.add('POST', '/api/classes/:id/join', joinClass);
  r.add('POST', '/api/classes/:id/leave', leaveClass);
}

export { bookingOut };
