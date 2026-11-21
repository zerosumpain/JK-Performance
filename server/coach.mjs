import { clientFor, initials, requireCoach } from './access.mjs';
import { bookingOut } from './bookings.mjs';
import { GUIDES, PLANS, planById } from './catalogue.mjs';
import { dueWeek } from './daily.mjs';
import { healthDay, healthVisible } from './health.mjs';
import { day, oneOf } from './http.mjs';
import { addDays, daysBetween, londonDay, londonToUtc } from './time.mjs';
import { workoutOut } from './training.mjs';

const INACTIVE_DAYS = 7;

/** Completed ÷ published workouts dated in the last 28 days, as a whole percentage; null with none due. */
export function adherence(db, clientId, today = londonDay()) {
  const row = db.prepare('SELECT COUNT(*) due, SUM(completed_at IS NOT NULL) done FROM workouts WHERE client_id=? AND published=1 AND date>? AND date<=?')
    .get(clientId, addDays(today, -28), today);
  return row.due ? Math.round((100 * (row.done ?? 0)) / row.due) : null;
}

function clientSummary(db, c, today = londonDay()) {
  const lastDone = db.prepare('SELECT MAX(completed_at) at FROM workouts WHERE client_id=?').get(c.id).at;
  const anyPlanned = db.prepare('SELECT 1 FROM workouts WHERE client_id=? AND published=1 LIMIT 1').get(c.id);
  const week = dueWeek(today);
  const checkinDue = !db.prepare('SELECT 1 FROM checkins WHERE client_id=? AND week=?').get(c.id, week);
  const unread = db.prepare("SELECT COUNT(*) n FROM messages WHERE client_id=? AND from_role='client' AND read_at IS NULL").get(c.id).n;
  const flags = [];
  const idleDays = lastDone ? daysBetween(londonDay(new Date(lastDone)), today) : null;
  if (anyPlanned && (idleDays === null || idleDays >= INACTIVE_DAYS)) flags.push(idleDays === null ? 'no-workout-yet' : `no-workout-${idleDays}d`);
  if (checkinDue && week < addDays(today, -7)) flags.push('checkin-overdue');
  return {
    id: c.id, name: c.name, initials: initials(c.name), plan: c.plan, since: c.created_at.slice(0, 10),
    adherence: adherence(db, c.id, today), lastWorkoutAt: lastDone, checkinDue, flags, unread,
  };
}

const myClients = (db, coach) => db.prepare("SELECT * FROM users WHERE role='client' AND coach_id=? ORDER BY name").all(coach.id);

function clients(_req, ctx) {
  requireCoach(ctx);
  return { clients: myClients(ctx.db, ctx.user).map(c => clientSummary(ctx.db, c)) };
}

function clientDetail(_req, ctx) {
  requireCoach(ctx);
  const c = clientFor(ctx, ctx.params.id);
  const today = londonDay();
  const next = ctx.db.prepare('SELECT * FROM workouts WHERE client_id=? AND date>=? ORDER BY date, starts_at LIMIT 1').get(c.id, today);
  const shared = healthVisible(ctx.user, c);
  return {
    client: clientSummary(ctx.db, c, today), healthShared: shared, health: shared ? healthDay(ctx.db, c.id, today) : null,
    nextWorkout: next ? workoutOut(ctx.db, next) : null,
  };
}

function today(_req, ctx) {
  requireCoach(ctx);
  const date = day(ctx.query.date, 'date', { optional: true }) ?? londonDay();
  const sessions = ctx.db.prepare('SELECT * FROM bookings WHERE coach_id=? AND cancelled_at IS NULL AND start>=? AND start<? ORDER BY start')
    .all(ctx.user.id, londonToUtc(date).toISOString(), londonToUtc(addDays(date, 1)).toISOString());
  const all = myClients(ctx.db, ctx.user);
  const unread = ctx.db.prepare("SELECT COUNT(*) n FROM messages m JOIN users u ON u.id = m.client_id WHERE u.coach_id=? AND m.from_role='client' AND m.read_at IS NULL").get(ctx.user.id).n;
  const n = Number(date.replaceAll('-', '')) % GUIDES.tips.length;
  return {
    date, sessions: sessions.map(b => bookingOut(ctx.db, b, ctx.user)),
    activeClients: all.filter(c => c.plan !== 'none').length, totalClients: all.length, unread,
    tip: GUIDES.tips[n],
  };
}

/**
 * Monthly recurring revenue on any day, rebuilt from the membership history:
 * each client's plan as of that day, priced monthly.
 */
function mrrOn(db, coachId, dayString) {
  const end = londonToUtc(addDays(dayString, 1)).toISOString();
  const rows = db.prepare(`SELECT e.user_id, e.plan FROM membership_events e JOIN users u ON u.id = e.user_id
    WHERE u.coach_id=? AND u.is_demo = (SELECT is_demo FROM users WHERE id=?) AND e.at < ? ORDER BY e.at`).all(coachId, coachId, end);
  const current = new Map();
  for (const r of rows) current.set(r.user_id, r.plan);
  let pence = 0;
  for (const plan of current.values()) pence += planById(plan).monthlyPence;
  return { pence, members: [...current.values()].filter(p => p !== 'none').length, plans: current };
}

function business(_req, ctx) {
  requireCoach(ctx);
  const period = ctx.query.period ? oneOf(ctx.query.period, 'period', ['week', 'month']) : 'month';
  const today = londonDay();
  const span = period === 'week' ? 7 : 30;
  const start = addDays(today, -span);
  const series = [];
  for (let i = 0; i <= span; i += period === 'week' ? 1 : 2) series.push({ date: addDays(start, i), pence: mrrOn(ctx.db, ctx.user.id, addDays(start, i)).pence });
  const now = mrrOn(ctx.db, ctx.user.id, today), then = mrrOn(ctx.db, ctx.user.id, start);
  let joined = 0, churned = 0;
  for (const [id, plan] of now.plans) {
    const before = then.plans.get(id) ?? 'none';
    if (before === 'none' && plan !== 'none') joined++;
    if (before !== 'none' && plan === 'none') churned++;
  }
  const all = myClients(ctx.db, ctx.user);
  const rates = all.map(c => adherence(ctx.db, c.id, today)).filter(v => v !== null);
  const attention = [];
  for (const c of all) {
    const s = clientSummary(ctx.db, c, today);
    for (const f of s.flags) {
      const ref = { id: c.id, name: c.name, initials: s.initials };
      if (f.startsWith('no-workout')) attention.push({ client: ref, kind: 'inactive', reason: f === 'no-workout-yet' ? 'Has not logged a workout yet' : `No workout logged in ${f.match(/\d+/)[0]} days` });
      if (f === 'checkin-overdue') attention.push({ client: ref, kind: 'checkin', reason: 'Weekly check-in overdue' });
    }
  }
  return {
    period, mrrPence: now.pence, mrrDeltaPct: then.pence ? Math.round((100 * (now.pence - then.pence)) / then.pence) : null, series,
    active: now.members, new: joined, churned,
    adherence: rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null,
    attention: attention.slice(0, 10),
    plans: PLANS.filter(p => p.id !== 'none').map(p => ({ id: p.id, name: p.name, members: [...now.plans.values()].filter(v => v === p.id).length })),
  };
}

function guides(_req, ctx) {
  requireCoach(ctx);
  return GUIDES;
}

export function coachRoutes(r) {
  r.add('GET', '/api/coach/today', today);
  r.add('GET', '/api/coach/clients', clients);
  r.add('GET', '/api/coach/clients/:id', clientDetail);
  r.add('GET', '/api/coach/business', business);
  r.add('GET', '/api/guides', guides);
}
