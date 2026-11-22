import { clientFor, initials, requireCoach } from './access.mjs';
import { bookingOut } from './bookings.mjs';
import { profileOf } from './account.mjs';
import { CLIENT_GUIDES, GUIDES } from './catalogue.mjs';
import { hasFeature } from './settings.mjs';
import { habitWeekOf } from './daily.mjs';
import { monthlyPricesAt, plansFor } from './plans.mjs';
import { dueWeek } from './daily.mjs';
import { flaggedAnswers } from './forms.mjs';
import { healthDay, healthVisible } from './health.mjs';
import { day, fail, oneOf } from './http.mjs';
import { addDays, daysBetween, londonDay, londonToUtc, mondayOf } from './time.mjs';
import { workoutOut } from './training.mjs';

const INACTIVE_DAYS = 7;

/** Completed ÷ published workouts dated in the last 28 days, as a whole percentage; null with none due. */
export function adherence(db, clientId, today = londonDay()) {
  const row = db.prepare('SELECT COUNT(*) due, SUM(completed_at IS NOT NULL) done FROM workouts WHERE client_id=? AND published=1 AND date>? AND date<=?')
    .get(clientId, addDays(today, -28), today);
  return row.due ? Math.round((100 * (row.done ?? 0)) / row.due) : null;
}

// Words in a client's unread message that mean "read this first".
const URGENT_WORDS = /\b(pain|painful|injur\w*|hurt\w*|sharp|swollen|swelling|numb\w*|dizz\w*|faint\w*|sick|unwell)\b/i;
const QUIET_DAYS = 7;

/**
 * How much a client needs the coach right now, and why. Highest first:
 * urgent (pain or a health "yes"), an unread message, a form or check-in to
 * read, then nobody's spoken to them in a while, then no training lately.
 * `at` orders clients within a kind: newest message first, longest silence first.
 */
function demandOf(db, c, { flags, unreadRows, today }) {
  const urgent = [];
  for (const m of unreadRows) if (URGENT_WORDS.test(m.text)) { urgent.push({ reason: `Mentions ${m.text.match(URGENT_WORDS)[0].toLowerCase()} in a message`, at: m.at }); break; }
  const checkin = db.prepare('SELECT * FROM checkins WHERE client_id=? AND reviewed_at IS NULL ORDER BY week DESC LIMIT 1').get(c.id);
  const pain = checkin ? JSON.parse(checkin.pain) : [];
  if (checkin && pain.length && checkin.energy <= 2) urgent.push({ reason: `${pain.join(', ')} pain and low energy in check-in`, at: checkin.submitted_at });
  const forms = db.prepare('SELECT * FROM form_requests WHERE client_id=? AND submitted_at IS NOT NULL AND reviewed_at IS NULL ORDER BY submitted_at DESC').all(c.id);
  for (const f of forms) {
    const yes = flaggedAnswers(f);
    if (yes.length) { urgent.push({ reason: `Answered yes on ${f.name}`, at: f.submitted_at }); break; }
  }
  const contact = db.prepare(`SELECT MAX(at) at FROM (
      SELECT MAX(at) at FROM messages WHERE client_id=? AND from_role='coach'
      UNION ALL SELECT MAX(reviewed_at) FROM checkins WHERE client_id=?
      UNION ALL SELECT MAX(published_at) FROM reports WHERE client_id=?)`).get(c.id, c.id, c.id).at;
  const quietDays = daysBetween(londonDay(new Date(contact ?? c.created_at)), today);
  const base = { urgent: urgent.map(u => u.reason), lastContactAt: contact, quietDays };
  if (urgent.length) return { ...base, kind: 'urgent', reason: urgent[0].reason, at: urgent[0].at, rank: 5 };
  if (unreadRows.length) return { ...base, kind: 'message', reason: unreadRows.length === 1 ? 'Sent you a message' : `Sent you ${unreadRows.length} messages`, at: unreadRows[0].at, rank: 4 };
  if (forms.length) return { ...base, kind: 'form', reason: `Filled in ${forms[0].name}`, at: forms[0].submitted_at, rank: 3 };
  if (checkin) return { ...base, kind: 'checkin', reason: pain.length ? `Check-in mentions ${pain.join(', ').toLowerCase()}` : 'Check-in to reply to', at: checkin.submitted_at, rank: 2 };
  if (quietDays >= QUIET_DAYS) return { ...base, kind: 'quiet', reason: contact ? `No contact in ${quietDays} days` : `Not contacted since joining ${quietDays} days ago`, at: contact, rank: 1 };
  const idle = flags.find(f => f.startsWith('no-workout'));
  if (idle) return { ...base, kind: 'inactive', reason: idle === 'no-workout-yet' ? 'Has not logged a workout yet' : `No workout in ${idle.match(/\d+/)[0]} days`, at: null, rank: 1 };
  return { ...base, kind: 'ok', reason: null, at: null, rank: 0 };
}

/** Most in need first; see `demandOf`. */
export function byDemand(a, b) {
  const x = a.demand, y = b.demand;
  if (x.rank !== y.rank) return y.rank - x.rank;
  if (x.kind === 'quiet' || x.kind === 'inactive') return y.quietDays - x.quietDays || a.name.localeCompare(b.name);
  return (y.at ?? '').localeCompare(x.at ?? '') || a.name.localeCompare(b.name);
}

function clientSummary(db, c, today = londonDay()) {
  const lastDone = db.prepare('SELECT MAX(completed_at) at FROM workouts WHERE client_id=?').get(c.id).at;
  const anyPlanned = db.prepare('SELECT 1 FROM workouts WHERE client_id=? AND published=1 LIMIT 1').get(c.id);
  const week = dueWeek(today);
  const checkinDue = !db.prepare('SELECT 1 FROM checkins WHERE client_id=? AND week=?').get(c.id, week);
  const unreadRows = db.prepare("SELECT text, at FROM messages WHERE client_id=? AND from_role='client' AND read_at IS NULL ORDER BY at DESC").all(c.id);
  const lastMessage = db.prepare('SELECT at, from_role FROM messages WHERE client_id=? ORDER BY at DESC LIMIT 1').get(c.id);
  const flags = [];
  const idleDays = lastDone ? daysBetween(londonDay(new Date(lastDone)), today) : null;
  if (anyPlanned && (idleDays === null || idleDays >= INACTIVE_DAYS)) flags.push(idleDays === null ? 'no-workout-yet' : `no-workout-${idleDays}d`);
  if (checkinDue && week < addDays(today, -7)) flags.push('checkin-overdue');
  return {
    id: c.id, name: c.name, initials: initials(c.name), plan: c.plan, since: c.created_at.slice(0, 10),
    adherence: adherence(db, c.id, today), lastWorkoutAt: lastDone, checkinDue, flags, unread: unreadRows.length,
    lastMessageAt: lastMessage?.at ?? null, lastMessageFrom: lastMessage?.from_role ?? null,
    demand: demandOf(db, c, { flags, unreadRows, today }),
    // Seven day states (done, notDone, rest) for the week ending today, under the day rule.
    habitWeek: habitWeekOf(db, c, today),
  };
}

const myClients = (db, coach) => db.prepare("SELECT * FROM users WHERE role='client' AND coach_id=? ORDER BY name").all(coach.id);

function clients(_req, ctx) {
  requireCoach(ctx);
  return { clients: myClients(ctx.db, ctx.user).map(c => clientSummary(ctx.db, c)).sort(byDemand) };
}

function clientDetail(_req, ctx) {
  requireCoach(ctx);
  const c = clientFor(ctx, ctx.params.id);
  const today = londonDay();
  const next = ctx.db.prepare('SELECT * FROM workouts WHERE client_id=? AND date>=? ORDER BY date, starts_at LIMIT 1').get(c.id, today);
  const shared = healthVisible(ctx.user, c);
  return {
    client: clientSummary(ctx.db, c, today), profile: profileOf(c), healthShared: shared, health: shared ? healthDay(ctx.db, c.id, today) : null,
    nextWorkout: next ? workoutOut(ctx.db, next) : null,
  };
}

/** Clients who need a nudge: urgent first, then no workout lately or the check-in overdue. */
function attentionList(db, clients, today) {
  const out = [];
  const summaries = clients.map(c => clientSummary(db, c, today)).sort(byDemand);
  for (const s of summaries) {
    const ref = { id: s.id, name: s.name, initials: s.initials };
    for (const reason of s.demand.urgent) out.push({ client: ref, kind: 'urgent', reason });
  }
  for (const s of summaries) {
    const ref = { id: s.id, name: s.name, initials: s.initials };
    for (const f of s.flags) {
      if (f.startsWith('no-workout')) out.push({ client: ref, kind: 'inactive', reason: f === 'no-workout-yet' ? 'Has not logged a workout yet' : `No workout logged in ${f.match(/\d+/)[0]} days` });
      if (f === 'checkin-overdue') out.push({ client: ref, kind: 'checkin', reason: 'Weekly check-in overdue' });
    }
  }
  return out;
}

/** The week a coach would be writing up: last week until Friday, then this one. */
export const feedbackWeek = (today = londonDay()) => (today >= addDays(mondayOf(today), 4) ? mondayOf(today) : addDays(mondayOf(today), -7));

function today(_req, ctx) {
  requireCoach(ctx);
  const date = day(ctx.query.date, 'date', { optional: true }) ?? londonDay();
  const sessions = ctx.db.prepare('SELECT * FROM bookings WHERE coach_id=? AND cancelled_at IS NULL AND start>=? AND start<? ORDER BY start')
    .all(ctx.user.id, londonToUtc(date).toISOString(), londonToUtc(addDays(date, 1)).toISOString());
  const all = myClients(ctx.db, ctx.user);
  const summaries = all.map(c => clientSummary(ctx.db, c)).sort(byDemand);
  const ref = c => ({ id: c.id, name: c.name, initials: c.initials ?? initials(c.name) });
  const unread = summaries.reduce((n, c) => n + c.unread, 0);
  const n = Number(date.replaceAll('-', '')) % GUIDES.tips.length;
  // The to-do list: whose feedback for the week isn't published, check-ins without a reply.
  const week = feedbackWeek();
  const published = new Set(ctx.db.prepare('SELECT client_id FROM reports WHERE week=? AND published_at IS NOT NULL').all(week).map(r => r.client_id));
  const members = all.filter(c => c.plan !== 'none');
  const checkins = ctx.db.prepare(`SELECT k.client_id, MIN(k.submitted_at) at FROM checkins k JOIN users u ON u.id=k.client_id
    WHERE u.coach_id=? AND k.reviewed_at IS NULL GROUP BY k.client_id ORDER BY at`).all(ctx.user.id);
  const forms = ctx.db.prepare(`SELECT r.client_id, MIN(r.submitted_at) at, COUNT(*) n FROM form_requests r JOIN users u ON u.id=r.client_id
    WHERE u.coach_id=? AND r.submitted_at IS NOT NULL AND r.reviewed_at IS NULL GROUP BY r.client_id ORDER BY at`).all(ctx.user.id);
  const byId = new Map(summaries.map(c => [c.id, c]));
  // What the autoflows will do next: the coming week's steps, soonest first.
  const upcoming = [];
  for (const run of ctx.db.prepare(`SELECT r.*, f.steps, f.name flow FROM autoflow_runs r JOIN autoflows f ON f.id=r.autoflow_id
      WHERE f.coach_id=? AND f.active=1 AND r.stopped_at IS NULL`).all(ctx.user.id)) {
    const done = JSON.parse(run.done);
    for (const step of JSON.parse(run.steps)) {
      const on = addDays(run.start_day, step.day);
      if (done[step.id] || on > addDays(date, 7) || !byId.has(run.client_id)) continue;
      upcoming.push({ client: ref(byId.get(run.client_id)), date: on < date ? date : on, autoflow: run.flow, action: step.action });
    }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  const weekEnd = londonToUtc(addDays(mondayOf(date), 7)).toISOString();
  const weekLeft = ctx.db.prepare('SELECT COUNT(*) n FROM bookings WHERE coach_id=? AND cancelled_at IS NULL AND start>=? AND start<?')
    .get(ctx.user.id, new Date().toISOString(), weekEnd).n;
  return {
    date, sessions: sessions.map(b => bookingOut(ctx.db, b, ctx.user)),
    activeClients: members.length, totalClients: all.length, unread,
    tip: GUIDES.tips[n],
    feedbackDue: { week, dueBy: addDays(week, 7), clients: members.filter(c => !published.has(c.id)).map(c => ({ id: c.id, name: c.name, initials: initials(c.name) })) },
    checkinsToReview: checkins.length,
    checkinClients: checkins.filter(k => byId.has(k.client_id)).map(k => ({ ...ref(byId.get(k.client_id)), at: k.at })),
    formsToReview: forms.reduce((t, f) => t + f.n, 0),
    formClients: forms.filter(f => byId.has(f.client_id)).map(f => ({ ...ref(byId.get(f.client_id)), at: f.at })),
    unreadClients: summaries.filter(c => c.unread > 0).map(c => ({ ...ref(c), at: c.lastMessageAt }))
      .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')),
    urgent: summaries.flatMap(c => c.demand.urgent.map(reason => ({ client: ref(c), kind: 'urgent', reason }))),
    quiet: summaries.filter(c => c.demand.quietDays >= QUIET_DAYS).sort((a, b) => b.demand.quietDays - a.demand.quietDays)
      .map(c => ({ ...ref(c), days: c.demand.quietDays })),
    upcoming: upcoming.slice(0, 8),
    sessionsLeftThisWeek: weekLeft,
    attention: attentionList(ctx.db, all, londonDay()).slice(0, 5),
  };
}

/**
 * Monthly recurring revenue on any day, rebuilt from the membership history:
 * each client's plan as of that day, at the monthly price that applied then.
 */
function mrrOn(db, coachId, dayString) {
  const end = londonToUtc(addDays(dayString, 1)).toISOString();
  const rows = db.prepare(`SELECT e.user_id, e.plan FROM membership_events e JOIN users u ON u.id = e.user_id
    WHERE u.coach_id=? AND u.is_demo = (SELECT is_demo FROM users WHERE id=?) AND e.at < ? ORDER BY e.at`).all(coachId, coachId, end);
  const current = new Map();
  for (const r of rows) current.set(r.user_id, r.plan);
  let pence = 0;
  const prices = monthlyPricesAt(db, coachId, end);
  for (const plan of current.values()) pence += prices.get(plan) ?? 0;
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
  const attention = attentionList(ctx.db, all, today);
  return {
    period, mrrPence: now.pence, mrrDeltaPct: then.pence ? Math.round((100 * (now.pence - then.pence)) / then.pence) : null, series,
    active: now.members, new: joined, churned,
    adherence: rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null,
    attention: attention.slice(0, 10),
    plans: plansFor(ctx.db, ctx.user.id).map(p => ({ id: p.id, name: p.name, monthlyPence: p.monthlyPence, members: [...now.plans.values()].filter(v => v === p.id).length })),
  };
}

function guides(_req, ctx) {
  requireCoach(ctx);
  return GUIDES;
}

const guideSummary = g => ({ id: g.id, title: g.title, summary: g.summary, minutes: g.minutes, tags: g.tags });

/**
 * JK's guides for clients. Every plan includes 'guides' (Free too), and this is
 * exempt from requireMember. A plan the coach has taken guides off gets an empty
 * list rather than a 403, so the JK tab never fails. Coaches see them too.
 */
function clientGuides(_req, ctx) {
  if (!hasFeature(ctx.db, ctx.user, 'guides')) return { guides: [] };
  return { guides: CLIENT_GUIDES.map(guideSummary) };
}

function clientGuide(_req, ctx) {
  const g = CLIENT_GUIDES.find(x => x.id === ctx.params.id);
  if (!g || !hasFeature(ctx.db, ctx.user, 'guides')) fail(404, 'Not found');
  return { ...guideSummary(g), body: g.body };
}

export function coachRoutes(r) {
  r.add('GET', '/api/coach/today', today);
  r.add('GET', '/api/coach/clients', clients);
  r.add('GET', '/api/coach/clients/:id', clientDetail);
  r.add('GET', '/api/coach/business', business);
  r.add('GET', '/api/guides', guides);
  r.add('GET', '/api/client/guides', clientGuides);
  r.add('GET', '/api/client/guides/:id', clientGuide);
}
