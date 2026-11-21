import { clientFor, requireCoach } from './access.mjs';
import { activitiesBetween, healthDay, healthVisible } from './health.mjs';
import { day, fail, oneOf, str } from './http.mjs';
import { notify } from './push.mjs';
import { newId, nowIso, tx } from './store.mjs';
import { addDays, londonDay, mondayOf } from './time.mjs';
import { workoutOut } from './training.mjs';
import { feedbackWeek } from './coach.mjs';

/**
 * Weekly feedback: the coach's written review of one client's week (Monday to
 * Sunday), with that week's numbers and the next week's plan beside it. A
 * draft is the coach's alone; publishing shows it to the client and drops a
 * note in their messages. Written from the app or the web desk (/desk).
 */

/** The figures for a week, as the viewer may see them (Apple Health only with consent). */
export function weekStats(db, viewer, client, week) {
  const end = addDays(week, 6);
  const today = londonDay();
  const w = db.prepare('SELECT COUNT(*) planned, SUM(completed_at IS NOT NULL) done FROM workouts WHERE client_id=? AND published=1 AND date>=? AND date<=?')
    .get(client.id, week, end);
  const sets = db.prepare('SELECT COUNT(*) n FROM set_logs s JOIN workout_items i ON i.id=s.item_id JOIN workouts wo ON wo.id=i.workout_id WHERE wo.client_id=? AND wo.date>=? AND wo.date<=?')
    .get(client.id, week, end).n;
  // Habit days ticked by hand or reached, over the days of the week so far.
  const habits = db.prepare('SELECT id FROM habits WHERE client_id=?').all(client.id);
  const lastDay = end < today ? end : today;
  let habitDays = 0, habitDone = 0;
  if (habits.length && lastDay >= week) {
    const days = Math.round((Date.parse(lastDay) - Date.parse(week)) / 86_400_000) + 1;
    habitDays = days * habits.length;
    habitDone = db.prepare(`SELECT COUNT(*) n FROM habit_days WHERE done=1 AND date>=? AND date<=? AND habit_id IN (${habits.map(() => '?').join(',')})`)
      .get(week, lastDay, ...habits.map(h => h.id)).n;
  }
  const c = db.prepare('SELECT energy, sleep, pain, note, submitted_at FROM checkins WHERE client_id=? AND week=?').get(client.id, week);
  const weights = db.prepare("SELECT value FROM measurements WHERE user_id=? AND kind='weight' AND date>=? AND date<=? ORDER BY date").all(client.id, week, end);
  const out = {
    workoutsPlanned: w.planned, workoutsDone: w.done ?? 0, setsLogged: sets,
    habitsPct: habitDays ? Math.round((100 * habitDone) / habitDays) : null,
    checkin: c ? { energy: c.energy, sleep: c.sleep, pain: JSON.parse(c.pain), note: c.note, submittedAt: c.submitted_at } : null,
    weightStart: weights[0]?.value ?? null, weightEnd: weights.at(-1)?.value ?? null,
    healthShared: healthVisible(viewer, client),
    avgSteps: null, avgSleepMinutes: null, activities: null,
  };
  if (out.healthShared) {
    const days = [];
    for (let i = 0; i < 7; i++) days.push(healthDay(db, client.id, addDays(week, i)));
    const avg = key => {
      const v = days.map(d => d[key]).filter(x => x !== null);
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
    };
    out.avgSteps = avg('steps');
    out.avgSleepMinutes = avg('sleepMinutes');
    const acts = activitiesBetween(db, client.id, week, end);
    out.activities = { count: acts.length, minutes: acts.reduce((a, x) => a + x.minutes, 0), types: [...new Set(acts.map(a => a.type))].slice(0, 6) };
  }
  return out;
}

/** The plan for the week after `week`: published workouts, plus drafts for the coach. */
function nextPlan(db, viewer, clientId, week) {
  const from = addDays(week, 7), to = addDays(week, 13);
  const rows = db.prepare(`SELECT * FROM workouts WHERE client_id=? AND date>=? AND date<=? ${viewer.role === 'client' ? 'AND published=1' : ''} ORDER BY date, starts_at`)
    .all(clientId, from, to);
  return { from, to, workouts: rows.map(r => workoutOut(db, r, { withItems: false })) };
}

function reportOut(db, viewer, r, client, { full = false } = {}) {
  const coach = r.coach_id ? db.prepare('SELECT name FROM users WHERE id=?').get(r.coach_id) : null;
  const base = {
    id: r.id, clientId: r.client_id, week: r.week, weekEnd: addDays(r.week, 6),
    summary: r.summary, wins: r.wins, focus: r.focus,
    status: r.published_at ? 'published' : 'draft', publishedAt: r.published_at, readAt: r.read_at, updatedAt: r.updated_at,
    coachName: coach?.name ?? null,
  };
  if (!full) return base;
  return { ...base, stats: weekStats(db, viewer, client, r.week), plan: nextPlan(db, viewer, client.id, r.week) };
}

const mondayParam = (v, name) => {
  const d = day(v, name);
  if (mondayOf(d) !== d) fail(400, `${name} must be a Monday`);
  return d;
};

/** The report row a caller may see: a client only their own published ones. */
function visibleReport(ctx, id) {
  const r = ctx.db.prepare('SELECT * FROM reports WHERE id=?').get(id);
  if (!r) fail(404, 'Not found');
  const client = clientFor(ctx, r.client_id);
  if (ctx.user.role === 'client' && !r.published_at) fail(404, 'Not found');
  return { r, client };
}

function list(_req, ctx) {
  const client = clientFor(ctx, ctx.query.clientId);
  const drafts = ctx.user.role === 'coach';
  const rows = ctx.db.prepare(`SELECT * FROM reports WHERE client_id=? ${drafts ? '' : 'AND published_at IS NOT NULL'} ORDER BY week DESC LIMIT 52`).all(client.id);
  return {
    reports: rows.map(r => reportOut(ctx.db, ctx.user, r, client)),
    unread: rows.filter(r => r.published_at && !r.read_at).length,
    // The week a coach would naturally be writing up: last week until Friday, then this one.
    suggestedWeek: feedbackWeek(),
  };
}

function get(_req, ctx) {
  const { r, client } = visibleReport(ctx, ctx.params.id);
  if (ctx.user.role === 'client' && !r.read_at) {
    ctx.db.prepare('UPDATE reports SET read_at=? WHERE id=?').run(nowIso(), r.id);
    r.read_at = nowIso();
  }
  return reportOut(ctx.db, ctx.user, r, client, { full: true });
}

/** The coach's editor for a week: the saved report, or an empty one, with the figures and plan. */
function forWeek(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.query.clientId);
  const week = mondayParam(ctx.params.week, 'week');
  const r = ctx.db.prepare('SELECT * FROM reports WHERE client_id=? AND week=?').get(client.id, week)
    ?? { id: null, client_id: client.id, coach_id: ctx.user.id, week, summary: '', wins: '', focus: '', published_at: null, read_at: null, updated_at: null };
  return reportOut(ctx.db, ctx.user, r, client, { full: true });
}

function save(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const client = clientFor(ctx, b.clientId);
  const week = mondayParam(b.week, 'week');
  const status = oneOf(b.status ?? 'draft', 'status', ['draft', 'published']);
  const text = (v, name) => str(v ?? '', name, { max: 4000, min: 0 });
  const summary = text(b.summary, 'summary'), wins = text(b.wins, 'wins'), focus = text(b.focus, 'focus');
  if (status === 'published' && !summary && !wins && !focus) fail(400, 'Write something before publishing');
  const now = nowIso();
  let firstPublish = false;
  const out = tx(ctx.db, () => {
    const prior = ctx.db.prepare('SELECT * FROM reports WHERE client_id=? AND week=?').get(client.id, week);
    const publishedAt = status === 'published' ? prior?.published_at ?? now : null;
    if (prior) {
      ctx.db.prepare('UPDATE reports SET summary=?, wins=?, focus=?, published_at=?, coach_id=?, updated_at=? WHERE id=?')
        .run(summary, wins, focus, publishedAt, ctx.user.id, now, prior.id);
    } else {
      ctx.db.prepare('INSERT INTO reports (id, client_id, coach_id, week, summary, wins, focus, published_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(newId('r'), client.id, ctx.user.id, week, summary, wins, focus, publishedAt, now, now);
    }
    // First publish: a line in the client's messages so they know it's there.
    if (status === 'published' && !prior?.published_at) {
      firstPublish = true;
      ctx.db.prepare("INSERT INTO messages (id, client_id, from_id, from_role, text, at) VALUES (?,?,?,'coach',?,?)")
        .run(newId('m'), client.id, ctx.user.id, `Your feedback for the week of ${weekLabel(week)} is ready. Home › Feedback.`, now);
    }
    const r = ctx.db.prepare('SELECT * FROM reports WHERE client_id=? AND week=?').get(client.id, week);
    return reportOut(ctx.db, ctx.user, r, client, { full: true });
  });
  if (firstPublish) {
    notify(ctx.db, ctx.config, client.id, { title: 'Your weekly feedback', body: `${ctx.user.name} has written up your week of ${weekLabel(week)}.`, kind: 'report', id: out.id, clientId: client.id });
  }
  return out;
}

function remove(_req, ctx) {
  requireCoach(ctx);
  const { r } = visibleReport(ctx, ctx.params.id);
  ctx.db.prepare('DELETE FROM reports WHERE id=?').run(r.id);
  return { ok: true };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const weekLabel = week => `${Number(week.slice(8, 10))} ${MONTHS[Number(week.slice(5, 7)) - 1]}`;

export function reportRoutes(r) {
  r.add('GET', '/api/reports', list);
  r.add('PUT', '/api/reports', save);
  r.add('GET', '/api/reports/week/:week', forWeek);
  r.add('GET', '/api/reports/:id', get);
  r.add('DELETE', '/api/reports/:id', remove);
}
