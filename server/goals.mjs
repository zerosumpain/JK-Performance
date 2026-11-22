import { clientFor, requireCoach } from './access.mjs';
import { day, fail, num, oneOf, str } from './http.mjs';
import { MEASUREMENT_KINDS } from './progress.mjs';
import { hasFeature } from './settings.mjs';
import { newId, nowIso, tx } from './store.mjs';
import { addDays, daysBetween, londonDay } from './time.mjs';
import { loadKg } from './training.mjs';

/**
 * A client's goal: one measurable sentence JK sets with them ("Down to 75 kg
 * by March"). The server works out where they are from data already stored
 * (weigh-ins, measurements, logged sets, habit ticks), so the apps only draw.
 * One goal is active at a time; drafts come from onboarding for JK to set.
 */

export const METRICS = ['weight', 'waist', 'measurement', 'record', 'habit', 'custom'];
export const GOAL_STATUSES = ['draft', 'active', 'reached', 'paused'];
const DEFAULT_UNIT = { weight: 'kg', waist: 'cm', record: 'kg', habit: 'days' };
const round1 = v => Math.round(v * 10) / 10;
const fmt = v => (Number.isInteger(round1(v)) ? String(round1(v)) : round1(v).toFixed(1));

/** Where the client is now on this goal's metric, and what that figure is made from. */
function currentOf(db, g, today) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  if (g.metric === 'weight') {
    const last = one("SELECT date FROM measurements WHERE user_id=? AND kind='weight' ORDER BY date DESC LIMIT 1", g.client_id)?.date;
    if (!last) return { current: null, sourceLabel: 'From your weigh-ins' };
    const avg = one("SELECT AVG(value) v, COUNT(*) n FROM measurements WHERE user_id=? AND kind='weight' AND date>? AND date<=?", g.client_id, addDays(last, -7), last);
    return { current: round1(avg.v), sourceLabel: avg.n > 1 ? 'From your weigh-ins, 7-day average' : 'From your latest weigh-in' };
  }
  if (g.metric === 'waist' || g.metric === 'measurement') {
    const kind = g.metric === 'waist' ? 'waist' : g.measure_key ?? 'weight';
    const v = one('SELECT value FROM measurements WHERE user_id=? AND kind=? ORDER BY date DESC LIMIT 1', g.client_id, kind)?.value ?? null;
    return { current: v, sourceLabel: 'From your measurements' };
  }
  if (g.metric === 'record' && g.exercise_id) {
    const loads = db.prepare(`SELECT s.load FROM set_logs s JOIN workout_items i ON i.id=s.item_id JOIN workouts w ON w.id=i.workout_id
      WHERE w.client_id=? AND i.exercise_id=?`).all(g.client_id, g.exercise_id).map(r => loadKg(r.load)).filter(v => v !== null);
    return { current: loads.length ? round1(Math.max(...loads)) : null, sourceLabel: 'From your logged sets, best load' };
  }
  if (g.metric === 'habit' && g.habit_id) {
    const n = one('SELECT COUNT(*) n FROM habit_days WHERE habit_id=? AND done=1 AND date>? AND date<=?', g.habit_id, addDays(today, -28), today).n;
    return { current: n, sourceLabel: 'From your habit, the last 28 days' };
  }
  return { current: g.current_value ?? null, sourceLabel: 'Set by JK' };
}

export function goalOut(db, g, today = londonDay()) {
  if (!g) return null;
  const { current, sourceLabel } = currentOf(db, g, today);
  const hasNumbers = g.baseline !== null && g.target !== null && current !== null;
  const span = hasNumbers ? g.target - g.baseline : null;
  const progressPct = hasNumbers && span !== 0 ? Math.max(0, Math.min(100, Math.round((100 * (current - g.baseline)) / span))) : null;
  const direction = g.target !== null ? Math.sign(span ?? (current !== null ? g.target - current : 0)) || 1 : null;
  const remaining = g.target !== null && current !== null ? round1(Math.max(0, (g.target - current) * direction)) : null;
  const unit = g.unit ? ` ${g.unit}` : '';
  let weekOf = null, onTrack = null;
  if (g.start_date && g.target_date && g.target_date > g.start_date) {
    const total = daysBetween(g.start_date, g.target_date);
    const weeks = Math.max(1, Math.ceil(total / 7));
    weekOf = { week: Math.max(1, Math.min(weeks, Math.floor(daysBetween(g.start_date, today) / 7) + 1)), weeks };
    if (progressPct !== null) onTrack = progressPct / 100 >= Math.min(1, Math.max(0, daysBetween(g.start_date, today) / total)) - 0.1;
  }
  const exercise = g.exercise_id ? db.prepare('SELECT name FROM exercises WHERE id=?').get(g.exercise_id)?.name ?? null : null;
  return {
    id: g.id, clientId: g.client_id, title: g.title, metric: g.metric, exerciseId: g.exercise_id, exerciseName: exercise,
    measureKey: g.measure_key, habitId: g.habit_id, unit: g.unit, baseline: g.baseline, target: g.target,
    startDate: g.start_date, targetDate: g.target_date, why: g.why, status: g.status, chapterName: g.chapter_name,
    suggestion: g.suggestion, updatedAt: g.updated_at,
    current, delta: current !== null && g.baseline !== null ? round1(current - g.baseline) : null,
    progressPct, remaining, reached: remaining === 0,
    remainingLabel: remaining === null ? null : remaining === 0 ? 'Reached' : `${fmt(remaining)}${unit} to go`,
    weekOf, onTrack, sourceLabel,
  };
}

/** The client's active goal row (or null). */
export const activeGoalRow = (db, clientId) => db.prepare("SELECT * FROM goals WHERE client_id=? AND status='active' ORDER BY updated_at DESC LIMIT 1").get(clientId) ?? null;

function fields(db, b, client, current = {}) {
  const metric = b.metric === undefined ? current.metric ?? 'custom' : oneOf(b.metric, 'metric', METRICS);
  const out = {
    title: b.title === undefined ? current.title : str(b.title, 'title', { max: 120 }),
    metric,
    exercise_id: current.exercise_id ?? null,
    measure_key: current.measure_key ?? null,
    habit_id: current.habit_id ?? null,
    unit: b.unit === undefined ? current.unit ?? DEFAULT_UNIT[metric] ?? '' : str(b.unit, 'unit', { max: 12, min: 0 }),
    baseline: b.baseline === undefined ? current.baseline ?? null : num(b.baseline, 'baseline', { optional: true }),
    target: b.target === undefined ? current.target ?? null : num(b.target, 'target', { optional: true }),
    current_value: b.currentValue === undefined ? current.current_value ?? null : num(b.currentValue, 'currentValue', { optional: true }),
    start_date: b.startDate === undefined ? current.start_date ?? null : day(b.startDate, 'startDate', { optional: true }),
    target_date: b.targetDate === undefined ? current.target_date ?? null : day(b.targetDate, 'targetDate', { optional: true }),
    why: b.why === undefined ? current.why ?? null : str(b.why || null, 'why', { max: 300, optional: true }),
    status: b.status === undefined ? current.status ?? 'active' : oneOf(b.status, 'status', GOAL_STATUSES),
    chapter_name: b.chapterName === undefined ? current.chapter_name ?? null : str(b.chapterName || null, 'chapterName', { max: 60, optional: true }),
  };
  if (!out.title) fail(400, 'title is required');
  if (b.exerciseId !== undefined) {
    out.exercise_id = b.exerciseId === null ? null : str(b.exerciseId, 'exerciseId', { max: 80 });
    if (out.exercise_id && !db.prepare('SELECT 1 FROM exercises WHERE id=?').get(out.exercise_id)) fail(400, 'exerciseId is not in the library');
  }
  if (b.measureKey !== undefined) out.measure_key = b.measureKey === null ? null : oneOf(b.measureKey, 'measureKey', MEASUREMENT_KINDS);
  if (b.habitId !== undefined) {
    out.habit_id = b.habitId === null ? null : str(b.habitId, 'habitId', { max: 40 });
    if (out.habit_id && !db.prepare('SELECT 1 FROM habits WHERE id=? AND client_id=?').get(out.habit_id, client.id)) fail(400, 'habitId is not one of this client\'s habits');
  }
  if (metric === 'record' && !out.exercise_id) fail(400, 'A record goal needs exerciseId');
  if (metric === 'habit' && !out.habit_id) fail(400, 'A habit goal needs habitId');
  if (metric === 'measurement' && !out.measure_key) fail(400, 'A measurement goal needs measureKey');
  if (out.start_date && out.target_date && out.target_date <= out.start_date) fail(400, 'targetDate must be after startDate');
  return out;
}

function save(db, clientId, id, f, isNew) {
  tx(db, () => {
    // One active goal at a time: activating one pauses the others.
    if (f.status === 'active') db.prepare("UPDATE goals SET status='paused', updated_at=? WHERE client_id=? AND status='active' AND id<>?").run(nowIso(), clientId, id);
    const cols = Object.keys(f);
    if (isNew) {
      db.prepare(`INSERT INTO goals (id, client_id, ${cols.join(', ')}, created_at, updated_at) VALUES (?,?,${cols.map(() => '?').join(',')},?,?)`)
        .run(id, clientId, ...cols.map(c => f[c]), nowIso(), nowIso());
    } else {
      db.prepare(`UPDATE goals SET ${cols.map(c => `${c}=?`).join(', ')}, updated_at=? WHERE id=?`).run(...cols.map(c => f[c]), nowIso(), id);
    }
  });
  return db.prepare('SELECT * FROM goals WHERE id=?').get(id);
}

/** The client's own active goal (plans with 'progress'; anything else gets null, never a 403). A coach may name a client. */
function myGoal(_req, ctx) {
  const client = clientFor(ctx, ctx.query.clientId);
  if (!hasFeature(ctx.db, client, 'progress')) return { goal: null, pending: false };
  const g = activeGoalRow(ctx.db, client.id);
  return { goal: goalOut(ctx.db, g), pending: !g };
}

function listGoals(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.query.clientId);
  const rows = ctx.db.prepare("SELECT * FROM goals WHERE client_id=? ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, updated_at DESC").all(client.id);
  return { goals: rows.map(g => goalOut(ctx.db, g)) };
}

function createGoal(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  const f = fields(ctx.db, ctx.body, client);
  if (!f.start_date && f.status === 'active') f.start_date = londonDay();
  return goalOut(ctx.db, save(ctx.db, client.id, newId('g'), f, true));
}

function ownGoal(ctx) {
  requireCoach(ctx);
  const g = ctx.db.prepare('SELECT * FROM goals WHERE id=?').get(ctx.params.id);
  if (!g) fail(404, 'Not found');
  return { g, client: clientFor(ctx, g.client_id) };
}

function updateGoal(_req, ctx) {
  const { g, client } = ownGoal(ctx);
  const f = fields(ctx.db, ctx.body, client, g);
  if (!f.start_date && f.status === 'active') f.start_date = londonDay();
  return goalOut(ctx.db, save(ctx.db, client.id, g.id, f, false));
}

function deleteGoal(_req, ctx) {
  const { g } = ownGoal(ctx);
  ctx.db.prepare('DELETE FROM goals WHERE id=?').run(g.id);
  return { ok: true };
}

export function goalRoutes(r) {
  r.add('GET', '/api/goal', myGoal);
  r.add('GET', '/api/goals', listGoals);
  r.add('POST', '/api/goals', createGoal);
  r.add('PATCH', '/api/goals/:id', updateGoal);
  r.add('DELETE', '/api/goals/:id', deleteGoal);
}
