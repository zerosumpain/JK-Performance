import { dayRule, dayStates, dueWeek, habitDay, habitOut, habitsOf } from './daily.mjs';
import { activeGoalRow, goalOut } from './goals.mjs';
import { healthDay } from './health.mjs';
import { fail } from './http.mjs';
import { planOf } from './plans.mjs';
import { resolvedMeetingUrl } from './bookings.mjs';
import { deliverDue, letterLine } from './reports.mjs';
import { featuresOf, rhythmOf } from './settings.mjs';
import { addDays, daysBetween, londonClock, londonDay, londonToUtc, mondayOf, weekday } from './time.mjs';

/**
 * GET /api/today: everything the client's Today screen draws, in one payload
 * built only from what JK assigned and the plan includes. Workouts, the
 * client's own bookings and the classes they joined are merged into one
 * agenda, so Today can never say "Rest day" while a class is booked. Free
 * clients get a reduced payload (never a 403, and nothing member-only).
 */

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayName = date => DAY_NAMES[weekday(date) - 1];
const clockOf = iso => londonClock(new Date(iso));
const firstLine = text => (text ?? '').trim().split('\n')[0].slice(0, 160);
const HOUR = 3_600_000;

/** The line From JK shows, or null (Free, nothing yet, or stale: older than the rhythm plus three days). */
export function coachLineOf(db, client, f, today) {
  if (!f.messaging && !f.checkin) return null;
  const rhythm = rhythmOf(db, client);
  const staleAfterDays = (rhythm.days ?? 7) + 3;
  const now = new Date().toISOString();
  let line = null;
  if (f.checkin) {
    const r = db.prepare(`SELECT * FROM reports WHERE client_id=? AND published_at IS NOT NULL AND COALESCE(deliver_at, published_at)<=?
      ORDER BY COALESCE(deliver_at, published_at) DESC LIMIT 1`).get(client.id, now);
    if (r) {
      const at = r.deliver_at ?? r.published_at;
      const deliveredToday = londonDay(new Date(at)) === today;
      // On its delivery day, while unread, the headline; after that, JK's Adjust line.
      const text = !r.read_at && deliveredToday ? r.headline || letterLine(r) : letterLine(r);
      line = { text, source: 'letter', letterId: r.id, messageId: null, unread: !r.read_at, at,
        caption: r.kind === 'milestone' ? 'JK · A letter' : `JK · ${dayName(londonDay(new Date(at)))}'s letter` };
    }
  }
  if (!line && f.messaging) {
    const m = db.prepare("SELECT * FROM messages WHERE client_id=? AND from_role='coach' AND kind='text' ORDER BY at DESC LIMIT 1").get(client.id);
    if (m) {
      const d = londonDay(new Date(m.at));
      line = { text: firstLine(m.text), source: 'message', letterId: null, messageId: m.id, unread: !m.read_at, at: m.at,
        caption: d === today ? 'JK · Today' : `JK · ${dayName(d)}` };
    }
  }
  if (client.coach_line && client.coach_line_at && (!line || client.coach_line_at > line.at)) {
    line = { text: client.coach_line, source: 'override', letterId: null, messageId: null, unread: false, at: client.coach_line_at, caption: 'JK' };
  }
  if (!line || !line.text) return null;
  if (daysBetween(londonDay(new Date(line.at)), today) > staleAfterDays) return null;
  return { ...line, staleAfterDays };
}

/** Workouts, own 1:1s and joined classes from `now` on, as one sorted agenda (each with a start instant when it has one). */
function agenda(db, client, f, today, now) {
  const items = [];
  if (f.programme) {
    for (const w of db.prepare('SELECT * FROM workouts WHERE client_id=? AND published=1 AND completed_at IS NULL AND date>=? AND date<=? ORDER BY date, starts_at').all(client.id, today, addDays(today, 21))) {
      const start = w.starts_at ? londonToUtc(w.date, w.starts_at).toISOString() : null;
      items.push({ type: 'workout', id: w.id, date: w.date, title: w.title, start, end: start ? new Date(Date.parse(start) + HOUR).toISOString() : null, location: w.location, row: w });
    }
  }
  const lo = new Date(now.getTime() - 4 * HOUR).toISOString(), hi = londonToUtc(addDays(today, 22)).toISOString();
  for (const b of db.prepare(`SELECT * FROM bookings WHERE cancelled_at IS NULL AND start>=? AND start<? AND (client_id=? OR id IN (SELECT booking_id FROM class_attendees WHERE user_id=?)) ORDER BY start`)
    .all(lo, hi, client.id, client.id)) {
    if (Date.parse(b.end) <= now.getTime()) continue;
    items.push({ type: b.kind === 'video' ? 'video' : b.kind === 'group' ? 'class' : 'oneToOne', id: b.id, date: londonDay(new Date(b.start)), title: b.title, start: b.start, end: b.end, location: b.location, row: b });
  }
  return items.sort((a, b) => (a.start ?? `${a.date}T23:59`).localeCompare(b.start ?? `${b.date}T23:59`));
}

const when = item => (item.start ? clockOf(item.start) : null);
const titleLine = (...parts) => parts.filter(Boolean).join(' · ');

/** The Next card: one thing, in the spec's priority order, with anything else due as a caption. */
function nextOf(db, client, f, today, now) {
  const plan = planOf(db, client);
  if (plan.id === 'none') {
    return { kind: 'membership', title: 'See what coaching includes', detail: null, buttonLabel: 'Have a look', action: 'membership', item: null, alsoDue: [] };
  }
  const items = agenda(db, client, f, today, now);
  const soon = items.find(i => i.start && Date.parse(i.start) <= now.getTime() + 3 * HOUR && Date.parse(i.end) > now.getTime());

  const due = [];
  if (f.checkin) {
    const week = dueWeek(today);
    const wd = weekday(today);
    if ((wd >= 5 || wd === 1) && !db.prepare('SELECT 1 FROM checkins WHERE client_id=? AND week=?').get(client.id, week)) {
      due.push({ kind: 'checkin', title: 'A minute on your week', detail: null, buttonLabel: 'Begin check-in', action: 'checkin', item: { week }, caption: 'Check-in' });
    }
  }
  const form = db.prepare('SELECT * FROM form_requests WHERE client_id=? AND submitted_at IS NULL ORDER BY sent_at LIMIT 1').get(client.id);
  if (form) {
    const n = JSON.parse(form.questions).length;
    due.push({ kind: 'form', title: `${form.name} · ${n} question${n === 1 ? '' : 's'}`, detail: null, buttonLabel: 'Fill in', action: 'form', item: { formRequestId: form.id }, caption: form.name });
  }
  const alsoDue = chosen => due.filter(d => d !== chosen).map(d => ({ kind: d.kind, label: d.caption }));
  const strip = ({ caption: _c, ...rest }) => rest;

  // A client who has not trained or met JK yet: "Your welcome session" / "Your first workout".
  const isNew = !db.prepare('SELECT 1 FROM workouts WHERE client_id=? AND completed_at IS NOT NULL LIMIT 1').get(client.id)
    && !db.prepare('SELECT 1 FROM bookings WHERE client_id=? AND cancelled_at IS NULL AND start<? LIMIT 1').get(client.id, now.toISOString());

  const fromItem = (i, kindIfLater) => {
    const meetingUrl = i.type === 'video' ? resolvedMeetingUrl(db, i.row) : null;
    const dateWord = i.date === today ? null : i.date === addDays(today, 1) ? 'Tomorrow' : dayName(i.date);
    if (i.type === 'workout') {
      return { kind: kindIfLater ?? 'session', title: isNew ? 'Your first workout' : titleLine(i.title, dateWord, when(i), i.location), detail: isNew ? titleLine(i.title, when(i), i.location) : null,
        buttonLabel: kindIfLater === 'workout' ? 'View session' : kindIfLater === 'booking' ? 'See your week' : 'Start session',
        action: kindIfLater === 'booking' ? 'yourWeek' : kindIfLater === 'workout' ? 'viewSession' : 'startSession', item: { workoutId: i.id, date: i.date, start: i.start } };
    }
    if (i.type === 'video') {
      return { kind: kindIfLater ?? 'videoCall', title: isNew && f.sessions ? 'Your welcome session' : titleLine('Video call with JK', dateWord, when(i)),
        detail: null, buttonLabel: kindIfLater ? 'See your week' : meetingUrl ? 'Join' : 'Details', action: kindIfLater ? 'yourWeek' : meetingUrl ? 'join' : 'details',
        item: { bookingId: i.id, date: i.date, start: i.start, meetingUrl } };
    }
    return { kind: kindIfLater ?? 'session', title: isNew && f.sessions && i.type === 'oneToOne' ? 'Your welcome session' : titleLine(i.title, dateWord, when(i), i.location), detail: null,
      buttonLabel: kindIfLater ? 'See your week' : 'Details', action: kindIfLater ? 'yourWeek' : 'details', item: { bookingId: i.id, date: i.date, start: i.start, meetingUrl: null } };
  };

  if (soon) return { ...fromItem(soon), alsoDue: alsoDue(null) };
  if (due.length) return { ...strip(due[0]), alsoDue: alsoDue(due[0]) };
  const later = items.find(i => i.type === 'workout' && i.date === today);
  if (later) return { ...fromItem(later, 'workout'), alsoDue: [] };
  const nextBooking = items.find(i => i.type !== 'workout');
  const nextWorkout = items.find(i => i.type === 'workout');
  const trainsToday = items.some(i => i.date === today);
  if (nextBooking && trainsToday) return { ...fromItem(nextBooking, 'booking'), alsoDue: [] };
  // Nothing today: a rest day, with what comes next.
  const upcoming = [nextBooking, nextWorkout].filter(Boolean).sort((a, b) => (a.start ?? `${a.date}T23:59`).localeCompare(b.start ?? `${b.date}T23:59`))[0];
  if (!upcoming) return { kind: 'rest', title: 'Rest day.', detail: null, buttonLabel: 'See your week', action: 'yourWeek', item: null, alsoDue: [] };
  if (isNew) return { ...fromItem(upcoming, 'booking'), alsoDue: [] };
  const nextDay = upcoming.date === addDays(today, 1) ? 'tomorrow' : dayName(upcoming.date);
  return { kind: 'rest', title: `Rest day. Next: ${upcoming.title}, ${nextDay}${when(upcoming) ? ` ${when(upcoming)}` : ''}.`, detail: null,
    buttonLabel: 'See your week', action: 'yourWeek', item: { date: upcoming.date, workoutId: upcoming.type === 'workout' ? upcoming.id : null, bookingId: upcoming.type !== 'workout' ? upcoming.id : null }, alsoDue: [] };
}

export function todayFor(db, config, client, now = new Date()) {
  const today = londonDay(now);
  deliverDue(db, config, { clientId: client.id });
  const f = featuresOf(db, client);
  const plan = planOf(db, client);
  const free = plan.id === 'none';
  const out = {
    date: today, firstName: client.name.split(' ')[0], plan: plan.id, features: f,
    goal: null, goalPending: false, coachLine: null,
    habits: [], dayDone: false, doneCount: 0, dayMinimum: 0, rest: null, consistency: null, missedYesterday: false, week: [],
    next: null,
    unreadMessages: 0,
  };
  if (!free) {
    if (f.progress) {
      const g = activeGoalRow(db, client.id);
      out.goal = goalOut(db, g, today);
      out.goalPending = !g;
    }
    if (f.habits) {
      const health = healthDay(db, client.id, today);
      out.habits = habitsOf(db, client.id).map(h => habitOut(h, habitDay(db, h, today, health)));
      Object.assign(out, dayRule(db, client, { today }));
      const monday = mondayOf(today);
      out.week = dayStates(db, client, monday, addDays(monday, 6), { today })
        .map(s => ({ date: s.date, done: s.done, rest: s.rest, restReason: s.restReason, today: s.today, future: s.future }));
    }
    out.coachLine = coachLineOf(db, client, f, today);
    if (f.messaging) out.unreadMessages = db.prepare("SELECT COUNT(*) n FROM messages WHERE client_id=? AND from_role='coach' AND read_at IS NULL").get(client.id).n;
  }
  out.next = nextOf(db, client, f, today, now);
  return out;
}

function today(_req, ctx) {
  if (ctx.user.role !== 'client') {
    // A coach may look at a client's Today (preview); the payload is the client's.
    if (!ctx.query.clientId) fail(400, 'clientId is required');
    const c = ctx.db.prepare("SELECT * FROM users WHERE id=? AND role='client' AND coach_id=?").get(ctx.query.clientId, ctx.user.id);
    if (!c) fail(404, 'Not found');
    return todayFor(ctx.db, ctx.config, c);
  }
  return todayFor(ctx.db, ctx.config, ctx.user);
}

export function todayRoutes(r) {
  r.add('GET', '/api/today', today);
}
