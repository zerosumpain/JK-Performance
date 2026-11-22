import { clientFor, requireCoach, requireMember } from './access.mjs';
import { healthDay, healthVisible } from './health.mjs';
import { day, fail, num, oneOf, str } from './http.mjs';
import { notify } from './push.mjs';
import { defaultMinimum } from './settings.mjs';
import { iconKeyFor, newId, nowIso, tx } from './store.mjs';
import { addDays, daysBetween, londonDay, mondayOf } from './time.mjs';

/** The closed habit glyph catalogue (IconKey names), and the SF Symbol old app builds draw for each. */
export const HABIT_ICON_KEYS = ['water', 'sleep', 'steps', 'protein', 'supplement', 'energy', 'mobility', 'mindfulness', 'reading', 'sunlight', 'custom'];
export const ICON_KEY_SF = { water: 'drop', sleep: 'moon', steps: 'shoeprints.fill', protein: 'fork.knife', supplement: 'pills', energy: 'bolt',
  mobility: 'figure.flexibility', mindfulness: 'leaf', reading: 'book', sunlight: 'sunrise', custom: 'checkmark.circle' };
export const MAX_HABITS = 5;

// MARK: - Habits

/**
 * A habit's value on a day. Health-backed habits (steps, sleep) read Apple
 * Health unless the person ticked them by hand; sleep is shown in hours.
 */
export function habitDay(db, habit, date, health, prefetched) {
  const row = prefetched !== undefined ? prefetched : db.prepare('SELECT value, done FROM habit_days WHERE habit_id=? AND date=?').get(habit.id, date);
  let value = row?.value ?? null;
  let source = 'manual';
  if (habit.health_kind && health) {
    const fromHealth = habit.health_kind === 'steps' ? health.steps : habit.health_kind === 'sleep' && health.sleepMinutes !== null ? Math.round(health.sleepMinutes / 6) / 10 : null;
    if (fromHealth !== null && fromHealth !== undefined) { value = fromHealth; source = 'health'; }
  }
  const reached = value !== null && value >= habit.target;
  const done = !!row?.done || (habit.kind === 'count' && reached) || (habit.health_kind !== null && reached);
  return { value, done, source };
}

/** The +/- step for a count habit: what the coach set, or a sensible one for the target. */
const stepOf = h => h.step ?? (h.kind !== 'count' ? 1 : h.target >= 1000 ? 1000 : h.target >= 20 ? 10 : h.target > 5 ? 1 : 0.5);

export const habitOut = (h, d) => ({
  id: h.id, name: h.name, kind: h.kind, target: h.target, unit: h.unit, icon: h.icon, healthKind: h.health_kind,
  iconKey: h.icon_key ?? iconKeyFor(h.icon), step: stepOf(h), introducedAt: h.introduced_at ?? h.created_at, position: h.position, ...d,
});

export const habitsOf = (db, clientId) => db.prepare('SELECT * FROM habits WHERE client_id=? ORDER BY position, created_at').all(clientId);

// MARK: - The day rule

const introducedDay = h => londonDay(new Date(h.introduced_at ?? h.created_at));

/**
 * Each day in [from, to] under the one habit rule: a day is done when the
 * client's minimum (the coach's number, or ceil(60%) of the habits that
 * existed that day) is met. A rest day JK granted is neither done nor missed.
 * Future days are never done. One query for the ticks, one per day for Health.
 */
export function dayStates(db, client, from, to, { useHealth = true, today = londonDay() } = {}) {
  const habits = habitsOf(db, client.id);
  const rows = new Map();
  if (habits.length) {
    for (const r of db.prepare(`SELECT habit_id, date, value, done FROM habit_days WHERE date>=? AND date<=? AND habit_id IN (${habits.map(() => '?').join(',')})`)
      .all(from, to, ...habits.map(h => h.id))) rows.set(`${r.habit_id}|${r.date}`, r);
  }
  const rests = new Map(db.prepare('SELECT date, reason FROM rest_days WHERE client_id=? AND date>=? AND date<=?').all(client.id, from, to).map(r => [r.date, r.reason]));
  const needsHealth = useHealth && habits.some(h => h.health_kind);
  const out = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const active = habits.filter(h => introducedDay(h) <= date);
    const future = date > today;
    const health = needsHealth && !future ? healthDay(db, client.id, date) : null;
    const doneCount = future ? 0 : active.filter(h => habitDay(db, h, date, health, rows.get(`${h.id}|${date}`) ?? null).done).length;
    const minimum = Math.min(client.day_minimum ?? defaultMinimum(active.length), active.length);
    const rest = rests.has(date);
    out.push({ date, done: !future && !rest && active.length > 0 && doneCount >= minimum, rest, restReason: rest ? rests.get(date) ?? null : null,
      doneCount, total: active.length, minimum, today: date === today, future });
  }
  return out;
}

/** "22 of the last 28 days": done days over the 28 ending today (today counts only once done); rest days count as neither. */
export function consistencyOf(states) {
  const counted = states.filter(s => !s.rest && s.total > 0 && !(s.today && !s.done) && !s.future);
  return { done: counted.filter(s => s.done).length, days: counted.length, rest: states.filter(s => s.rest).length, window: states.length };
}

/** Where a client stands today under the day rule (the /api/habits and /api/today fields). */
export function dayRule(db, client, { useHealth = true, today = londonDay() } = {}) {
  const states = dayStates(db, client, addDays(today, -27), today, { useHealth, today });
  const now = states.at(-1), yesterday = states.at(-2);
  return {
    dayDone: now.done, doneCount: now.doneCount, dayMinimum: now.minimum,
    rest: now.rest ? { date: today, reason: now.restReason } : null,
    consistency: consistencyOf(states),
    missedYesterday: !!yesterday && yesterday.total > 0 && !yesterday.rest && !yesterday.done,
  };
}

/** Consecutive days done under the minimum rule, ending today (if done) or yesterday; rest days are skipped, not breaks. */
export function minimumStreak(db, client, today = londonDay(), { useHealth = true } = {}) {
  let streak = 0;
  let to = today;
  for (let chunk = 0; chunk < 7; chunk++) {
    const from = addDays(to, -59);
    const states = dayStates(db, client, from, to, { useHealth, today }).reverse();
    for (const s of states) {
      if (s.today && !s.done) continue;
      if (s.rest) continue;
      if (!s.done) return streak;
      streak++;
    }
    to = addDays(from, -1);
  }
  return streak;
}

/** Seven day states for the coach's lists: the week ending today. */
export function habitWeekOf(db, client, today = londonDay()) {
  return dayStates(db, client, addDays(today, -6), today, { useHealth: !!client.health_share, today })
    .map(s => ({ date: s.date, state: s.rest ? 'rest' : s.done ? 'done' : 'notDone' }));
}

/** Consecutive days, ending today (if complete) or yesterday, with every habit done. */
export function habitStreak(db, clientId, today = londonDay(), { useHealth = true } = {}) {
  const habits = habitsOf(db, clientId);
  if (!habits.length) return 0;
  const complete = date => {
    const health = useHealth ? healthDay(db, clientId, date) : null;
    return habits.every(h => habitDay(db, h, date, health).done);
  };
  let date = complete(today) ? today : addDays(today, -1);
  let streak = 0;
  while (streak < 365 && complete(date)) { streak++; date = addDays(date, -1); }
  return streak;
}

function nutritionOut(db, clientId, date) {
  const t = db.prepare('SELECT * FROM nutrition_targets WHERE client_id=?').get(clientId);
  const entries = db.prepare('SELECT * FROM nutrition_entries WHERE client_id=? AND date=? ORDER BY at').all(clientId, date);
  const total = k => Math.round(entries.reduce((a, e) => a + e[k], 0));
  return {
    date,
    targets: t ? { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat } : null,
    totals: { kcal: total('kcal'), protein: total('protein'), carbs: total('carbs'), fat: total('fat') },
    entries: entries.map(e => ({ id: e.id, name: e.name, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat, at: e.at })),
  };
}

function listHabits(_req, ctx) {
  requireMember(ctx);
  const client = clientFor(ctx, ctx.query.clientId);
  const date = day(ctx.query.date, 'date', { optional: true }) ?? londonDay();
  // A coach sees Apple Health figures only with the client's consent.
  const useHealth = healthVisible(ctx.user, client);
  const health = useHealth ? healthDay(ctx.db, client.id, date) : null;
  return {
    date,
    habits: habitsOf(ctx.db, client.id).map(h => habitOut(h, habitDay(ctx.db, h, date, health))),
    streak: habitStreak(ctx.db, client.id, londonDay(), { useHealth }),
    nutrition: nutritionOut(ctx.db, client.id, date),
    ...dayRule(ctx.db, client, { useHealth }),
  };
}

const RANGE_MAX = 92;
function rangeOf(query, defFrom, defTo) {
  const from = day(query.from, 'from', { optional: true }) ?? defFrom;
  const to = day(query.to, 'to', { optional: true }) ?? (query.from ? addDays(from, 6) : defTo);
  if (to < from) fail(400, 'to is before from');
  if (daysBetween(from, to) > RANGE_MAX) fail(400, `At most ${RANGE_MAX} days at a time`);
  return { from, to };
}

/** The week dots: one call, each day done / rest / today under the day rule. Defaults to this Monday to Sunday. */
function habitWeek(_req, ctx) {
  const client = clientFor(ctx, ctx.query.clientId);
  const today = londonDay();
  const { from, to } = rangeOf(ctx.query, mondayOf(today), addDays(mondayOf(today), 6));
  const days = dayStates(ctx.db, client, from, to, { useHealth: healthVisible(ctx.user, client), today });
  return { from, to, dayMinimum: days.at(-1)?.minimum ?? 0, days };
}

/** Per habit and per day, for Progress level 3 and the coach's HabitWeekGrid. Defaults to the last 28 days. */
function habitHistory(_req, ctx) {
  const client = clientFor(ctx, ctx.query.clientId);
  const today = londonDay();
  const { from, to } = rangeOf(ctx.query, addDays(today, -27), today);
  const useHealth = healthVisible(ctx.user, client);
  const lo = from < addDays(to, -27) ? from : addDays(to, -27);
  const habits = habitsOf(ctx.db, client.id);
  const healthByDay = new Map();
  const healthOn = date => {
    if (!useHealth || date > today) return null;
    if (!healthByDay.has(date)) healthByDay.set(date, healthDay(ctx.db, client.id, date));
    return healthByDay.get(date);
  };
  const days = dayStates(ctx.db, client, lo, to, { useHealth, today });
  const rest = new Set(days.filter(d => d.rest).map(d => d.date));
  const rate = (h, hi, n) => {
    let done = 0, count = 0;
    for (let i = 0; i < n; i++) {
      const d = addDays(hi, -i);
      if (d > today || rest.has(d) || introducedDay(h) > d) continue;
      if (d === today && !habitDay(ctx.db, h, d, healthOn(d)).done) continue;
      count++;
      if (habitDay(ctx.db, h, d, healthOn(d)).done) done++;
    }
    return count ? Math.round((100 * done) / count) / 100 : null;
  };
  const out = habits.map(h => {
    const list = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const v = d > today ? { value: null, done: false, source: 'manual' } : habitDay(ctx.db, h, d, healthOn(d));
      list.push({ date: d, ...v, rest: rest.has(d) });
    }
    return { ...habitOut(h, {}), days: list, rate7: rate(h, to, 7), rate7Prev: rate(h, addDays(to, -7), 7), rate28: rate(h, to, 28) };
  });
  const windowDays = days.filter(d => d.date >= addDays(to, -27));
  return {
    from, to, habits: out,
    days: days.filter(d => d.date >= from).map(d => ({ date: d.date, dayDone: d.done, rest: d.rest, restReason: d.restReason, doneCount: d.doneCount, total: d.total, minimum: d.minimum })),
    consistency: consistencyOf(windowDays),
  };
}

/** iconKey (closed catalogue) and icon (the SF name old builds draw) from whichever the caller sent. */
function iconsFrom(b, current = null) {
  if (b.iconKey !== undefined) {
    const key = oneOf(b.iconKey, 'iconKey', HABIT_ICON_KEYS);
    return { iconKey: key, icon: b.icon !== undefined ? str(b.icon, 'icon', { max: 40 }) : ICON_KEY_SF[key] };
  }
  if (b.icon !== undefined) {
    const icon = str(b.icon, 'icon', { max: 40 });
    return { iconKey: iconKeyFor(icon), icon };
  }
  return current ?? { iconKey: 'custom', icon: 'checkmark' };
}

function createHabit(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  const b = ctx.body;
  const id = newId('h');
  const { iconKey, icon } = iconsFrom(b);
  tx(ctx.db, () => {
    // Five habits at most. Clients who already have more keep them until JK chooses.
    if (ctx.db.prepare('SELECT COUNT(*) n FROM habits WHERE client_id=?').get(client.id).n >= MAX_HABITS) fail(409, `A client can have at most ${MAX_HABITS} habits`);
    const position = ctx.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM habits WHERE client_id=?').get(client.id).p;
    ctx.db.prepare('INSERT INTO habits (id, client_id, name, kind, target, unit, icon, health_kind, position, created_at, icon_key, step, introduced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      id, client.id, str(b.name, 'name', { max: 40 }), oneOf(b.kind, 'kind', ['check', 'count']),
      num(b.target ?? 1, 'target', { min: 0, max: 1_000_000 }), str(b.unit ?? '', 'unit', { max: 12, min: 0 }),
      icon, b.healthKind ? oneOf(b.healthKind, 'healthKind', ['steps', 'sleep']) : null,
      position, nowIso(), iconKey, num(b.step, 'step', { min: 0.01, max: 100_000, optional: true }), nowIso());
  });
  const h = ctx.db.prepare('SELECT * FROM habits WHERE id=?').get(id);
  return habitOut(h, habitDay(ctx.db, h, londonDay(), healthVisible(ctx.user, client) ? healthDay(ctx.db, client.id, londonDay()) : null));
}

function ownHabit(ctx) {
  const h = ctx.db.prepare('SELECT * FROM habits WHERE id=?').get(ctx.params.id);
  if (!h) fail(404, 'Not found');
  clientFor(ctx, h.client_id);
  return h;
}

function updateHabit(_req, ctx) {
  requireCoach(ctx);
  const h = ownHabit(ctx);
  const b = ctx.body;
  const { iconKey, icon } = iconsFrom(b, { iconKey: h.icon_key ?? iconKeyFor(h.icon), icon: h.icon });
  ctx.db.prepare('UPDATE habits SET name=?, kind=?, target=?, unit=?, icon=?, icon_key=?, step=?, health_kind=?, position=? WHERE id=?').run(
    b.name === undefined ? h.name : str(b.name, 'name', { max: 40 }),
    b.kind === undefined ? h.kind : oneOf(b.kind, 'kind', ['check', 'count']),
    b.target === undefined ? h.target : num(b.target, 'target', { min: 0, max: 1_000_000 }),
    b.unit === undefined ? h.unit : str(b.unit, 'unit', { max: 12, min: 0 }),
    icon, iconKey,
    b.step === undefined ? h.step : num(b.step, 'step', { min: 0.01, max: 100_000, optional: true }),
    b.healthKind === undefined ? h.health_kind : b.healthKind === null ? null : oneOf(b.healthKind, 'healthKind', ['steps', 'sleep']),
    b.position === undefined ? h.position : num(b.position, 'position', { min: 0, max: 100, int: true }), h.id);
  const fresh = ctx.db.prepare('SELECT * FROM habits WHERE id=?').get(h.id);
  const owner = ctx.db.prepare('SELECT * FROM users WHERE id=?').get(h.client_id);
  return habitOut(fresh, habitDay(ctx.db, fresh, londonDay(), healthVisible(ctx.user, owner) ? healthDay(ctx.db, h.client_id, londonDay()) : null));
}

// MARK: - Rest days (JK grants them; a rest day is neither done nor missed)

function listRestDays(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.params.id);
  const today = londonDay();
  const { from, to } = rangeOf(ctx.query, addDays(today, -28), addDays(today, 28));
  return { restDays: ctx.db.prepare('SELECT date, reason, created_at FROM rest_days WHERE client_id=? AND date>=? AND date<=? ORDER BY date').all(client.id, from, to)
    .map(r => ({ date: r.date, reason: r.reason, grantedAt: r.created_at })) };
}

function addRestDay(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.params.id);
  const date = day(ctx.body.date, 'date');
  const reason = str(ctx.body.reason, 'reason', { max: 80, optional: true, min: 0 }) || null;
  ctx.db.prepare('INSERT INTO rest_days (client_id, date, reason, granted_by, created_at) VALUES (?,?,?,?,?) ON CONFLICT(client_id, date) DO UPDATE SET reason=excluded.reason')
    .run(client.id, date, reason, ctx.user.id, nowIso());
  return { date, reason };
}

function removeRestDay(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.params.id);
  ctx.db.prepare('DELETE FROM rest_days WHERE client_id=? AND date=?').run(client.id, day(ctx.params.date, 'date'));
  return { ok: true };
}

function deleteHabit(_req, ctx) {
  requireCoach(ctx);
  const h = ownHabit(ctx);
  ctx.db.prepare('DELETE FROM habits WHERE id=?').run(h.id);
  return { ok: true };
}

function setHabitDay(_req, ctx) {
  requireMember(ctx);
  const h = ownHabit(ctx);
  const date = day(ctx.params.date, 'date');
  const value = num(ctx.body.value, 'value', { min: 0, max: 1_000_000, optional: true });
  const done = ctx.body.done === undefined ? null : !!ctx.body.done;
  const prior = ctx.db.prepare('SELECT value, done FROM habit_days WHERE habit_id=? AND date=?').get(h.id, date);
  ctx.db.prepare('INSERT INTO habit_days (habit_id, date, value, done) VALUES (?,?,?,?) ON CONFLICT(habit_id, date) DO UPDATE SET value=excluded.value, done=excluded.done')
    .run(h.id, date, value ?? prior?.value ?? null, done === null ? (prior?.done ?? 0) : done ? 1 : 0);
  const owner = ctx.db.prepare('SELECT * FROM users WHERE id=?').get(h.client_id);
  return habitOut(h, habitDay(ctx.db, h, date, healthVisible(ctx.user, owner) ? healthDay(ctx.db, h.client_id, date) : null));
}

// MARK: - Nutrition

function setTargets(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  const b = ctx.body;
  ctx.db.prepare('INSERT INTO nutrition_targets (client_id, kcal, protein, carbs, fat) VALUES (?,?,?,?,?) ON CONFLICT(client_id) DO UPDATE SET kcal=excluded.kcal, protein=excluded.protein, carbs=excluded.carbs, fat=excluded.fat').run(
    client.id, num(b.kcal, 'kcal', { min: 0, max: 10000 }), num(b.protein, 'protein', { min: 0, max: 1000 }),
    num(b.carbs, 'carbs', { min: 0, max: 2000 }), num(b.fat, 'fat', { min: 0, max: 1000 }));
  return nutritionOut(ctx.db, client.id, londonDay());
}

function addEntry(_req, ctx) {
  requireMember(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  const b = ctx.body;
  const date = day(b.date, 'date');
  ctx.db.prepare('INSERT INTO nutrition_entries (id, client_id, date, name, kcal, protein, carbs, fat, at) VALUES (?,?,?,?,?,?,?,?,?)').run(
    newId('n'), client.id, date, str(b.name, 'name', { max: 80 }), num(b.kcal, 'kcal', { min: 0, max: 10000 }),
    num(b.protein ?? 0, 'protein', { min: 0, max: 1000 }), num(b.carbs ?? 0, 'carbs', { min: 0, max: 2000 }), num(b.fat ?? 0, 'fat', { min: 0, max: 1000 }), nowIso());
  return nutritionOut(ctx.db, client.id, date);
}

function deleteEntry(_req, ctx) {
  requireMember(ctx);
  const e = ctx.db.prepare('SELECT * FROM nutrition_entries WHERE id=?').get(ctx.params.id);
  if (!e) fail(404, 'Not found');
  clientFor(ctx, e.client_id);
  ctx.db.prepare('DELETE FROM nutrition_entries WHERE id=?').run(e.id);
  return nutritionOut(ctx.db, e.client_id, e.date);
}

// MARK: - Weekly check-ins

export const checkinOut = c => ({ id: c.id, clientId: c.client_id, week: c.week, energy: c.energy, sleep: c.sleep, pain: JSON.parse(c.pain), note: c.note, submittedAt: c.submitted_at, reviewedAt: c.reviewed_at, reply: c.reply,
  stress: c.stress ?? null, win: c.win ?? null, struggle: c.struggle ?? null, photoIds: c.photo_ids ? JSON.parse(c.photo_ids) : [] });

export const FEEL_WORDS = { 1: 'Easy', 2: 'Steady', 3: 'Hard', 4: 'Very hard', 5: 'Max' };

/** The figures a check-in card shows read-only: the week's steps and sleep, habit consistency, sessions and how they felt. */
export function checkinDraft(db, viewer, client, week) {
  const end = addDays(week, 6);
  const today = londonDay();
  const shared = healthVisible(viewer, client);
  const lastDay = end < today ? end : today;
  const health = [];
  if (shared) for (let d = week; d <= lastDay; d = addDays(d, 1)) health.push(healthDay(db, client.id, d));
  const avg = key => {
    const v = health.map(h => h[key]).filter(x => x !== null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const states = dayStates(db, client, week, end, { useHealth: shared, today });
  const sessions = db.prepare('SELECT id, title, date, completed_at, feel FROM workouts WHERE client_id=? AND published=1 AND date>=? AND date<=? ORDER BY date').all(client.id, week, end);
  return {
    week, weekEnd: end, avgSteps: avg('steps'), avgSleepMinutes: avg('sleepMinutes'), healthShared: shared,
    habits: consistencyOf(states.filter(s => !s.future)),
    sessionsDone: sessions.filter(w => w.completed_at).length, sessionsPlanned: sessions.length,
    feel: sessions.filter(w => w.feel).map(w => ({ workoutId: w.id, title: w.title, date: w.date, feel: w.feel, word: FEEL_WORDS[w.feel] })),
  };
}

function draftCheckin(_req, ctx) {
  const client = clientFor(ctx, ctx.query.clientId);
  return checkinDraft(ctx.db, ctx.user, client, ctx.query.week ? day(ctx.query.week, 'week') : dueWeek());
}

/** The week a check-in is due for: this week's, filed from Friday; before then, last week's. */
export function dueWeek(today = londonDay()) {
  const monday = mondayOf(today);
  return addDays(today, 0) >= addDays(monday, 4) ? monday : addDays(monday, -7);
}

function listCheckins(_req, ctx) {
  requireMember(ctx);
  const client = clientFor(ctx, ctx.query.clientId);
  const rows = ctx.db.prepare('SELECT * FROM checkins WHERE client_id=? ORDER BY week DESC LIMIT 52').all(client.id);
  return { checkins: rows.map(checkinOut), dueWeek: dueWeek() };
}

function submitCheckin(_req, ctx) {
  requireMember(ctx);
  if (ctx.user.role !== 'client') fail(403, 'Clients only');
  const b = ctx.body;
  const pain = Array.isArray(b.pain) ? b.pain.slice(0, 8).map((p, i) => str(p, `pain[${i}]`, { max: 30 })) : [];
  const stress = num(b.stress, 'stress', { min: 1, max: 5, int: true, optional: true });
  const win = str(b.win || null, 'win', { max: 500, optional: true });
  const struggle = str(b.struggle || null, 'struggle', { max: 500, optional: true });
  if (b.photoIds !== undefined && (!Array.isArray(b.photoIds) || b.photoIds.length > 6)) fail(400, 'photoIds must be a list of up to 6');
  const photoIds = (b.photoIds ?? []).map((id, i) => {
    const v = str(id, `photoIds[${i}]`, { max: 40 });
    const own = ctx.db.prepare('SELECT 1 FROM photos WHERE id=? AND user_id=?').get(v, ctx.user.id)
      ?? ctx.db.prepare("SELECT 1 FROM media WHERE id=? AND owner_id=? AND kind='image'").get(v, ctx.user.id);
    if (!own) fail(400, `photoIds[${i}] is not one of your photos`);
    return v;
  });
  const week = dueWeek();
  const id = newId('c');
  const first = !ctx.db.prepare('SELECT 1 FROM checkins WHERE client_id=? AND week=?').get(ctx.user.id, week);
  ctx.db.prepare(`INSERT INTO checkins (id, client_id, week, energy, sleep, pain, note, submitted_at, stress, win, struggle, photo_ids) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(client_id, week) DO UPDATE SET energy=excluded.energy, sleep=excluded.sleep, pain=excluded.pain, note=excluded.note, submitted_at=excluded.submitted_at,
      stress=excluded.stress, win=excluded.win, struggle=excluded.struggle, photo_ids=excluded.photo_ids`).run(
    id, ctx.user.id, week, num(b.energy, 'energy', { min: 1, max: 5, int: true }), num(b.sleep, 'sleep', { min: 1, max: 5, int: true }),
    JSON.stringify(pain), str(b.note ?? '', 'note', { max: 2000, min: 0 }), nowIso(), stress, win, struggle, JSON.stringify(photoIds));
  if (first) notify(ctx.db, ctx.config, ctx.user.coach_id, { title: ctx.user.name, body: 'Sent their weekly check-in.', kind: 'checkin', clientId: ctx.user.id });
  return checkinOut(ctx.db.prepare('SELECT * FROM checkins WHERE client_id=? AND week=?').get(ctx.user.id, week));
}

function reviewCheckin(_req, ctx) {
  requireCoach(ctx);
  const c = ctx.db.prepare('SELECT * FROM checkins WHERE id=?').get(ctx.params.id);
  if (!c) fail(404, 'Not found');
  clientFor(ctx, c.client_id);
  ctx.db.prepare('UPDATE checkins SET reviewed_at=?, reply=? WHERE id=?').run(nowIso(), str(ctx.body.reply ?? '', 'reply', { max: 2000, min: 0 }), c.id);
  return checkinOut(ctx.db.prepare('SELECT * FROM checkins WHERE id=?').get(c.id));
}

export function dailyRoutes(r) {
  r.add('GET', '/api/habits', listHabits);
  r.add('GET', '/api/habits/week', habitWeek);
  r.add('GET', '/api/habits/history', habitHistory);
  r.add('POST', '/api/habits', createHabit);
  r.add('PATCH', '/api/habits/:id', updateHabit);
  r.add('DELETE', '/api/habits/:id', deleteHabit);
  r.add('GET', '/api/clients/:id/rest-days', listRestDays);
  r.add('POST', '/api/clients/:id/rest-days', addRestDay);
  r.add('DELETE', '/api/clients/:id/rest-days/:date', removeRestDay);
  r.add('GET', '/api/checkins/draft', draftCheckin);
  r.add('PUT', '/api/habits/:id/days/:date', setHabitDay);
  r.add('PUT', '/api/nutrition/targets', setTargets);
  r.add('POST', '/api/nutrition/entries', addEntry);
  r.add('DELETE', '/api/nutrition/entries/:id', deleteEntry);
  r.add('GET', '/api/checkins', listCheckins);
  r.add('POST', '/api/checkins', submitCheckin);
  r.add('POST', '/api/checkins/:id/review', reviewCheckin);
}
