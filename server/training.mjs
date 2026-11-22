import { CATEGORIES } from './catalogue.mjs';
import { canSee, clientFor, requireCoach, requireMember } from './access.mjs';
import { day, fail, num, oneOf, str } from './http.mjs';
import { newId, nowIso, tx } from './store.mjs';
import { addDays, londonDay } from './time.mjs';

/** How a session felt, as the words the apps show (no numbers on client screens). */
export const FEEL_WORDS = { 1: 'Easy', 2: 'Steady', 3: 'Hard', 4: 'Very hard', 5: 'Max' };

// MARK: - Exercises

const exerciseOut = r => ({ id: r.id, name: r.name, equipment: r.equipment, pattern: r.pattern, category: r.category, videoUrl: r.video_url ?? null });

function listExercises(_req, { db, query }) {
  let rows = db.prepare('SELECT * FROM exercises ORDER BY name').all();
  if (query.category && query.category !== 'All') rows = rows.filter(r => r.category === query.category);
  if (query.q) rows = rows.filter(r => r.name.toLowerCase().includes(String(query.q).toLowerCase()));
  return { exercises: rows.map(exerciseOut) };
}

function createExercise(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const id = newId('ex');
  ctx.db.prepare('INSERT INTO exercises (id, name, equipment, pattern, category, video_url, created_by) VALUES (?,?,?,?,?,?,?)').run(
    id, str(b.name, 'name', { max: 80 }), str(b.equipment, 'equipment', { max: 40 }), str(b.pattern, 'pattern', { max: 40 }),
    oneOf(b.category, 'category', CATEGORIES), str(b.videoUrl, 'videoUrl', { max: 500, optional: true }), ctx.user.id);
  return exerciseOut(ctx.db.prepare('SELECT * FROM exercises WHERE id=?').get(id));
}

// MARK: - Loads

/**
 * A load written by a person ("2×20 kg", "100", "BW", "100kg") as kilograms
 * moved, for records: "2×20" is two 20 kg bells, 40 kg. Null when there is no
 * number (bodyweight, a time).
 */
export function loadKg(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(',', '.');
  const pair = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i.exec(t);
  if (pair) return Number(pair[1]) * Number(pair[2]);
  const single = /(\d+(?:\.\d+)?)/.exec(t);
  return single ? Number(single[1]) : null;
}

// MARK: - Workouts

function itemRows(db, workoutId) {
  return db.prepare('SELECT i.*, e.name e_name, e.equipment e_equipment, e.pattern e_pattern, e.category e_category, e.video_url e_video FROM workout_items i JOIN exercises e ON e.id = i.exercise_id WHERE i.workout_id=? ORDER BY i.position').all(workoutId);
}

/** "2×18 × 10": the best set the client logged for this exercise before this workout. */
function previousFor(db, clientId, exerciseId, beforeDate) {
  const rows = db.prepare(`SELECT s.load, s.reps FROM set_logs s JOIN workout_items i ON i.id = s.item_id JOIN workouts w ON w.id = i.workout_id
    WHERE w.client_id=? AND i.exercise_id=? AND w.date < ? ORDER BY w.date DESC LIMIT 20`).all(clientId, exerciseId, beforeDate);
  if (!rows.length) return null;
  const best = rows.reduce((a, b) => ((loadKg(b.load) ?? 0) * 100 + b.reps > (loadKg(a.load) ?? 0) * 100 + a.reps ? b : a));
  return `${best.load} × ${best.reps}`;
}

export function workoutOut(db, w, { withItems = true } = {}) {
  const base = {
    id: w.id, clientId: w.client_id, date: w.date, title: w.title, startsAt: w.starts_at, location: w.location,
    notes: w.notes, published: !!w.published, publishedAt: w.published_at, editedAt: w.edited_at, editedBy: w.edited_by,
    completedAt: w.completed_at, completionNote: w.completion_note, createdBy: w.created_by,
    feel: w.feel ?? null, feelWord: w.feel ? FEEL_WORDS[w.feel] : null,
  };
  const items = itemRows(db, w.id);
  const logsOf = db.prepare('SELECT number, load, reps, rpe, at FROM set_logs WHERE item_id=? ORDER BY number');
  if (!withItems) {
    const done = items.filter(i => logsOf.all(i.id).length >= i.sets).length;
    return { ...base, itemCount: items.length, doneCount: done };
  }
  return {
    ...base,
    items: items.map(i => ({
      id: i.id, order: i.position,
      exercise: { id: i.exercise_id, name: i.e_name, equipment: i.e_equipment, pattern: i.e_pattern, category: i.e_category, videoUrl: i.e_video ?? null },
      sets: i.sets, reps: i.reps, load: i.load, rpe: i.rpe, note: i.note,
      logged: logsOf.all(i.id).map(s => ({ number: s.number, load: s.load, reps: s.reps, rpe: s.rpe, at: s.at })),
      previous: previousFor(db, w.client_id, i.exercise_id, w.date),
    })),
  };
}

/** A workout the caller may see: their own published one, or one of their coach's clients'. */
function visibleWorkout(ctx, id) {
  const w = ctx.db.prepare('SELECT * FROM workouts WHERE id=?').get(id);
  if (!w) fail(404, 'Not found');
  const client = ctx.db.prepare('SELECT * FROM users WHERE id=?').get(w.client_id);
  if (!canSee(ctx.user, client)) fail(404, 'Not found');
  if (ctx.user.role === 'client' && !w.published) fail(404, 'Not found');
  return w;
}

/** Only the coach, or the client for a workout they created, may change its plan. */
function editableWorkout(ctx, id) {
  const w = visibleWorkout(ctx, id);
  if (ctx.user.role === 'client' && w.created_by !== ctx.user.id) fail(403, 'Your coach wrote this workout; ask them to change it');
  return w;
}

function cleanItems(db, items) {
  if (!Array.isArray(items) || items.length > 40) fail(400, 'items must be a list of up to 40');
  return items.map((it, i) => {
    const exerciseId = str(it.exerciseId, `items[${i}].exerciseId`, { max: 80 });
    if (!db.prepare('SELECT 1 FROM exercises WHERE id=?').get(exerciseId)) fail(400, `items[${i}].exerciseId is not in the library`);
    return {
      id: typeof it.id === 'string' && it.id ? it.id : null, exerciseId,
      sets: num(it.sets, `items[${i}].sets`, { min: 1, max: 20, int: true }),
      reps: str(it.reps, `items[${i}].reps`, { max: 30 }),
      load: str(it.load ?? '', `items[${i}].load`, { max: 30, min: 0 }),
      rpe: str(it.rpe, `items[${i}].rpe`, { max: 10, optional: true }),
      note: str(it.note, `items[${i}].note`, { max: 300, optional: true, min: 0 }),
    };
  });
}

/** Replace a workout's items. Items keeping their id keep their logged sets. */
function writeItems(db, workoutId, items) {
  const keep = new Set(items.filter(i => i.id).map(i => i.id));
  const current = db.prepare('SELECT id FROM workout_items WHERE workout_id=?').all(workoutId).map(r => r.id);
  for (const id of current) if (!keep.has(id)) db.prepare('DELETE FROM workout_items WHERE id=?').run(id);
  items.forEach((it, position) => {
    if (it.id && current.includes(it.id)) {
      db.prepare('UPDATE workout_items SET position=?, exercise_id=?, sets=?, reps=?, load=?, rpe=?, note=? WHERE id=?')
        .run(position, it.exerciseId, it.sets, it.reps, it.load, it.rpe, it.note, it.id);
    } else {
      db.prepare('INSERT INTO workout_items (id, workout_id, position, exercise_id, sets, reps, load, rpe, note) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(newId('i'), workoutId, position, it.exerciseId, it.sets, it.reps, it.load, it.rpe, it.note);
    }
  });
}

function workoutFields(b) {
  return {
    date: day(b.date, 'date'), title: str(b.title, 'title', { max: 80 }),
    startsAt: b.startsAt ? str(b.startsAt, 'startsAt', { max: 5 }) : null,
    location: str(b.location, 'location', { max: 80, optional: true, min: 0 }),
    notes: str(b.notes ?? '', 'notes', { max: 1000, min: 0 }),
  };
}

function listWorkouts(_req, ctx) {
  requireMember(ctx);
  const client = clientFor(ctx, ctx.query.clientId);
  const from = day(ctx.query.from, 'from', { optional: true }) ?? addDays(londonDay(), -28);
  const to = day(ctx.query.to, 'to', { optional: true }) ?? addDays(londonDay(), 28);
  const onlyPublished = ctx.user.role === 'client' ? 'AND published=1' : '';
  const rows = ctx.db.prepare(`SELECT * FROM workouts WHERE client_id=? AND date>=? AND date<=? ${onlyPublished} ORDER BY date, starts_at`).all(client.id, from, to);
  return { workouts: rows.map(w => workoutOut(ctx.db, w, { withItems: false })) };
}

function getWorkout(_req, ctx) {
  requireMember(ctx);
  return workoutOut(ctx.db, visibleWorkout(ctx, ctx.params.id));
}

function createWorkout(_req, ctx) {
  requireMember(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  const f = workoutFields(ctx.body);
  const items = cleanItems(ctx.db, ctx.body.items ?? []);
  const id = newId('w');
  const byCoach = ctx.user.role === 'coach';
  tx(ctx.db, () => {
    ctx.db.prepare('INSERT INTO workouts (id, client_id, date, title, starts_at, location, notes, published, published_at, edited_at, edited_by, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, client.id, f.date, f.title, f.startsAt, f.location, f.notes, byCoach ? 0 : 1, byCoach ? null : nowIso(), nowIso(), ctx.user.role, ctx.user.id);
    writeItems(ctx.db, id, items);
  });
  return workoutOut(ctx.db, ctx.db.prepare('SELECT * FROM workouts WHERE id=?').get(id));
}

function updateWorkout(_req, ctx) {
  requireMember(ctx);
  const w = editableWorkout(ctx, ctx.params.id);
  const f = workoutFields(ctx.body);
  const items = cleanItems(ctx.db, ctx.body.items ?? []);
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE workouts SET date=?, title=?, starts_at=?, location=?, notes=?, edited_at=?, edited_by=? WHERE id=?')
      .run(f.date, f.title, f.startsAt, f.location, f.notes, nowIso(), ctx.user.role, w.id);
    writeItems(ctx.db, w.id, items);
  });
  return workoutOut(ctx.db, ctx.db.prepare('SELECT * FROM workouts WHERE id=?').get(w.id));
}

function deleteWorkout(_req, ctx) {
  requireMember(ctx);
  const w = editableWorkout(ctx, ctx.params.id);
  ctx.db.prepare('DELETE FROM workouts WHERE id=?').run(w.id);
  return { ok: true };
}

function publishWorkout(_req, ctx) {
  requireCoach(ctx);
  const w = visibleWorkout(ctx, ctx.params.id);
  ctx.db.prepare('UPDATE workouts SET published=1, published_at=? WHERE id=?').run(nowIso(), w.id);
  return workoutOut(ctx.db, ctx.db.prepare('SELECT * FROM workouts WHERE id=?').get(w.id));
}

function itemOf(ctx, w) {
  const item = ctx.db.prepare('SELECT * FROM workout_items WHERE id=? AND workout_id=?').get(ctx.params.itemId, w.id);
  if (!item) fail(404, 'Not found');
  return item;
}

/** Only the client logs their own sets. */
function loggable(ctx) {
  const w = visibleWorkout(ctx, ctx.params.id);
  if (ctx.user.id !== w.client_id) fail(403, 'Only the client logs sets');
  return w;
}

function putSet(_req, ctx) {
  requireMember(ctx);
  const w = loggable(ctx);
  const item = itemOf(ctx, w);
  const number = Number(ctx.params.number);
  if (!Number.isInteger(number) || number < 1 || number > 20) fail(400, 'set number must be 1–20');
  const load = str(ctx.body.load ?? '', 'load', { max: 30, min: 0 });
  const reps = num(ctx.body.reps, 'reps', { min: 0, max: 200, int: true });
  const rpe = num(ctx.body.rpe, 'rpe', { min: 1, max: 10, optional: true });
  ctx.db.prepare('INSERT INTO set_logs (item_id, number, load, reps, rpe, at) VALUES (?,?,?,?,?,?) ON CONFLICT(item_id, number) DO UPDATE SET load=excluded.load, reps=excluded.reps, rpe=excluded.rpe, at=excluded.at')
    .run(item.id, number, load, reps, rpe, nowIso());
  return workoutOut(ctx.db, ctx.db.prepare('SELECT * FROM workouts WHERE id=?').get(w.id));
}

function deleteSet(_req, ctx) {
  requireMember(ctx);
  const w = loggable(ctx);
  const item = itemOf(ctx, w);
  ctx.db.prepare('DELETE FROM set_logs WHERE item_id=? AND number=?').run(item.id, Number(ctx.params.number));
  return workoutOut(ctx.db, ctx.db.prepare('SELECT * FROM workouts WHERE id=?').get(w.id));
}

function completeWorkout(_req, ctx) {
  requireMember(ctx);
  const w = loggable(ctx);
  ctx.db.prepare('UPDATE workouts SET completed_at=?, completion_note=?, feel=? WHERE id=?')
    .run(nowIso(), str(ctx.body.note, 'note', { max: 500, optional: true, min: 0 }), num(ctx.body.feel, 'feel', { min: 1, max: 5, int: true, optional: true }), w.id);
  return workoutOut(ctx.db, ctx.db.prepare('SELECT * FROM workouts WHERE id=?').get(w.id));
}

// MARK: - Programs

function programOut(db, p) {
  const body = JSON.parse(p.body);
  const clientCount = db.prepare('SELECT COUNT(DISTINCT client_id) n FROM workouts WHERE program_id=?').get(p.id).n;
  // Items are stored by exercise id; the reply carries the exercise itself, as a workout's items do.
  const byId = db.prepare('SELECT * FROM exercises WHERE id=?');
  const workouts = body.workouts.map(w => ({ ...w, items: w.items.map(i => { const e = byId.get(i.exerciseId); return { ...i, exercise: e ? exerciseOut(e) : null }; }) }));
  return { id: p.id, name: p.name, detail: p.detail, daysPerWeek: p.days_per_week, weeks: p.weeks, workouts, clientCount, updatedAt: p.updated_at };
}

function programFields(db, b) {
  if (!Array.isArray(b.workouts) || b.workouts.length > 200) fail(400, 'workouts must be a list of up to 200');
  const workouts = b.workouts.map((w, i) => ({
    dayOffset: num(w.dayOffset, `workouts[${i}].dayOffset`, { min: 0, max: 400, int: true }),
    title: str(w.title, `workouts[${i}].title`, { max: 80 }),
    items: cleanItems(db, w.items ?? []).map(({ id: _id, ...rest }) => rest),
  }));
  return {
    name: str(b.name, 'name', { max: 80 }), detail: str(b.detail ?? '', 'detail', { max: 200, min: 0 }),
    daysPerWeek: num(b.daysPerWeek ?? 3, 'daysPerWeek', { min: 1, max: 7, int: true }),
    weeks: num(b.weeks ?? 4, 'weeks', { min: 1, max: 52, int: true }), workouts,
  };
}

function ownProgram(ctx) {
  requireCoach(ctx);
  const p = ctx.db.prepare('SELECT * FROM programs WHERE id=? AND coach_id=?').get(ctx.params.id, ctx.user.id);
  if (!p) fail(404, 'Not found');
  return p;
}

function listPrograms(_req, ctx) {
  requireCoach(ctx);
  return { programs: ctx.db.prepare('SELECT * FROM programs WHERE coach_id=? ORDER BY updated_at DESC').all(ctx.user.id).map(p => programOut(ctx.db, p)) };
}

function createProgram(_req, ctx) {
  requireCoach(ctx);
  const f = programFields(ctx.db, ctx.body);
  const id = newId('p');
  ctx.db.prepare('INSERT INTO programs (id, coach_id, name, detail, days_per_week, weeks, body, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, ctx.user.id, f.name, f.detail, f.daysPerWeek, f.weeks, JSON.stringify({ workouts: f.workouts }), nowIso());
  return programOut(ctx.db, ctx.db.prepare('SELECT * FROM programs WHERE id=?').get(id));
}

function updateProgram(_req, ctx) {
  const p = ownProgram(ctx);
  const f = programFields(ctx.db, ctx.body);
  ctx.db.prepare('UPDATE programs SET name=?, detail=?, days_per_week=?, weeks=?, body=?, updated_at=? WHERE id=?')
    .run(f.name, f.detail, f.daysPerWeek, f.weeks, JSON.stringify({ workouts: f.workouts }), nowIso(), p.id);
  return programOut(ctx.db, ctx.db.prepare('SELECT * FROM programs WHERE id=?').get(p.id));
}

function deleteProgram(_req, ctx) {
  const p = ownProgram(ctx);
  ctx.db.prepare('DELETE FROM programs WHERE id=?').run(p.id);
  return { ok: true };
}

/**
 * Lay a program onto a client's calendar from `start`. By default the workouts
 * are drafts the coach checks and publishes; an autoflow publishes them.
 */
export function layProgram(db, program, clientId, start, coachId, { publish = false } = {}) {
  const { workouts } = JSON.parse(program.body);
  const now = nowIso();
  tx(db, () => {
    for (const w of workouts) {
      const id = newId('w');
      db.prepare("INSERT INTO workouts (id, client_id, date, title, notes, published, published_at, edited_at, edited_by, created_by, program_id) VALUES (?,?,?,?,'',?,?,?,'coach',?,?)")
        .run(id, clientId, addDays(start, w.dayOffset), w.title, publish ? 1 : 0, publish ? now : null, now, coachId, program.id);
      writeItems(db, id, w.items.map(i => ({ ...i, id: null })));
    }
  });
  return workouts.length;
}

function assignProgram(_req, ctx) {
  const p = ownProgram(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  return { created: layProgram(ctx.db, p, client.id, day(ctx.body.startDate, 'startDate'), ctx.user.id) };
}

export function trainingRoutes(r) {
  r.add('GET', '/api/exercises', listExercises);
  r.add('POST', '/api/exercises', createExercise);
  r.add('GET', '/api/workouts', listWorkouts);
  r.add('POST', '/api/workouts', createWorkout);
  r.add('GET', '/api/workouts/:id', getWorkout);
  r.add('PUT', '/api/workouts/:id', updateWorkout);
  r.add('DELETE', '/api/workouts/:id', deleteWorkout);
  r.add('POST', '/api/workouts/:id/publish', publishWorkout);
  r.add('POST', '/api/workouts/:id/complete', completeWorkout);
  r.add('PUT', '/api/workouts/:id/items/:itemId/sets/:number', putSet);
  r.add('DELETE', '/api/workouts/:id/items/:itemId/sets/:number', deleteSet);
  r.add('GET', '/api/programs', listPrograms);
  r.add('POST', '/api/programs', createProgram);
  r.add('PUT', '/api/programs/:id', updateProgram);
  r.add('DELETE', '/api/programs/:id', deleteProgram);
  r.add('POST', '/api/programs/:id/assign', assignProgram);
}
