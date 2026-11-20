import { clientFor, requireCoach, requireMember } from './access.mjs';
import { healthDay } from './health.mjs';
import { day, fail, num, oneOf, str } from './http.mjs';
import { newId, nowIso } from './store.mjs';
import { addDays, londonDay, mondayOf } from './time.mjs';

// MARK: - Habits

/**
 * A habit's value on a day. Health-backed habits (steps, sleep) read Apple
 * Health unless the person ticked them by hand; sleep is shown in hours.
 */
function habitDay(db, habit, date, health) {
  const row = db.prepare('SELECT value, done FROM habit_days WHERE habit_id=? AND date=?').get(habit.id, date);
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

const habitOut = (h, d) => ({ id: h.id, name: h.name, kind: h.kind, target: h.target, unit: h.unit, icon: h.icon, healthKind: h.health_kind, ...d });

const habitsOf = (db, clientId) => db.prepare('SELECT * FROM habits WHERE client_id=? ORDER BY position, created_at').all(clientId);

/** Consecutive days, ending today (if complete) or yesterday, with every habit done. */
export function habitStreak(db, clientId, today = londonDay()) {
  const habits = habitsOf(db, clientId);
  if (!habits.length) return 0;
  const complete = date => {
    const health = healthDay(db, clientId, date);
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
  const health = healthDay(ctx.db, client.id, date);
  return {
    date,
    habits: habitsOf(ctx.db, client.id).map(h => habitOut(h, habitDay(ctx.db, h, date, health))),
    streak: habitStreak(ctx.db, client.id),
    nutrition: nutritionOut(ctx.db, client.id, date),
  };
}

function createHabit(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  const b = ctx.body;
  const id = newId('h');
  const position = ctx.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM habits WHERE client_id=?').get(client.id).p;
  ctx.db.prepare('INSERT INTO habits (id, client_id, name, kind, target, unit, icon, health_kind, position, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    id, client.id, str(b.name, 'name', { max: 40 }), oneOf(b.kind, 'kind', ['check', 'count']),
    num(b.target ?? 1, 'target', { min: 0, max: 1_000_000 }), str(b.unit ?? '', 'unit', { max: 12, min: 0 }),
    str(b.icon ?? 'checkmark', 'icon', { max: 40 }), b.healthKind ? oneOf(b.healthKind, 'healthKind', ['steps', 'sleep']) : null,
    position, nowIso());
  const h = ctx.db.prepare('SELECT * FROM habits WHERE id=?').get(id);
  return habitOut(h, habitDay(ctx.db, h, londonDay(), healthDay(ctx.db, client.id, londonDay())));
}

function ownHabit(ctx) {
  const h = ctx.db.prepare('SELECT * FROM habits WHERE id=?').get(ctx.params.id);
  if (!h) fail(404, 'Not found');
  clientFor(ctx, h.client_id);
  return h;
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
  return habitOut(h, habitDay(ctx.db, h, date, healthDay(ctx.db, h.client_id, date)));
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

const checkinOut = c => ({ id: c.id, clientId: c.client_id, week: c.week, energy: c.energy, sleep: c.sleep, pain: JSON.parse(c.pain), note: c.note, submittedAt: c.submitted_at, reviewedAt: c.reviewed_at, reply: c.reply });

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
  const week = dueWeek();
  const id = newId('c');
  ctx.db.prepare(`INSERT INTO checkins (id, client_id, week, energy, sleep, pain, note, submitted_at) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(client_id, week) DO UPDATE SET energy=excluded.energy, sleep=excluded.sleep, pain=excluded.pain, note=excluded.note, submitted_at=excluded.submitted_at`).run(
    id, ctx.user.id, week, num(b.energy, 'energy', { min: 1, max: 5, int: true }), num(b.sleep, 'sleep', { min: 1, max: 5, int: true }),
    JSON.stringify(pain), str(b.note ?? '', 'note', { max: 2000, min: 0 }), nowIso());
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
  r.add('POST', '/api/habits', createHabit);
  r.add('DELETE', '/api/habits/:id', deleteHabit);
  r.add('PUT', '/api/habits/:id/days/:date', setHabitDay);
  r.add('PUT', '/api/nutrition/targets', setTargets);
  r.add('POST', '/api/nutrition/entries', addEntry);
  r.add('DELETE', '/api/nutrition/entries/:id', deleteEntry);
  r.add('GET', '/api/checkins', listCheckins);
  r.add('POST', '/api/checkins', submitCheckin);
  r.add('POST', '/api/checkins/:id/review', reviewCheckin);
}
