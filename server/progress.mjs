import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canSee, clientFor, coachIdOf, initials, requireCoach } from './access.mjs';
import { habitStreak } from './daily.mjs';
import { day, fail, num, oneOf, raw, str } from './http.mjs';
import { newId, nowIso } from './store.mjs';
import { addDays, daysBetween, londonDay } from './time.mjs';
import { loadKg } from './training.mjs';

export const MEASUREMENT_KINDS = ['weight', 'bodyFat', 'waist', 'restingHr'];
const BOUNDS = { weight: [20, 400], bodyFat: [2, 70], waist: [30, 250], restingHr: [25, 200] };
const PHOTO_LIMIT = 8 * 1024 * 1024;
const round1 = v => Math.round(v * 10) / 10;

// MARK: - Progress

function progressOf(db, client, range) {
  const today = londonDay();
  const from = range === '6m' ? addDays(today, -183) : range === 'all' ? '0000-01-01' : addDays(today, -92);
  const series = kind => db.prepare('SELECT date, value FROM measurements WHERE user_id=? AND kind=? AND date>=? ORDER BY date').all(client.id, kind, from);
  // Resting HR also arrives from Apple Health; a manual reading on the day wins.
  const stat = kind => {
    const rows = series(kind);
    if (!rows.length) return { kind, latest: null, delta: null };
    return { kind, latest: rows.at(-1).value, delta: round1(rows.at(-1).value - rows[0].value) };
  };
  const weight = series('weight');
  const first = db.prepare('SELECT MIN(date) d FROM measurements WHERE user_id=?').get(client.id).d;
  // Records: the heaviest logged set per exercise; "gain" is against the first time it was logged.
  const logs = db.prepare(`SELECT e.name, s.load, w.date FROM set_logs s JOIN workout_items i ON i.id = s.item_id
    JOIN workouts w ON w.id = i.workout_id JOIN exercises e ON e.id = i.exercise_id WHERE w.client_id=? ORDER BY w.date`).all(client.id);
  const byExercise = new Map();
  for (const l of logs) {
    const kg = loadKg(l.load);
    if (kg === null) continue;
    const r = byExercise.get(l.name) ?? { exercise: l.name, firstKg: kg, kg: 0, date: l.date };
    if (kg > r.kg) { r.kg = kg; r.date = l.date; }
    byExercise.set(l.name, r);
  }
  const records = [...byExercise.values()].sort((a, b) => b.kg - a.kg).slice(0, 10)
    .map(r => ({ exercise: r.exercise, kg: round1(r.kg), gain: round1(r.kg - r.firstKg), date: r.date }));
  return {
    since: first ?? client.created_at.slice(0, 10),
    weight: {
      latest: weight.at(-1)?.value ?? null,
      delta: weight.length ? round1(weight.at(-1).value - weight[0].value) : null,
      series: weight.map(w => ({ date: w.date, value: w.value })),
    },
    stats: ['bodyFat', 'waist', 'restingHr'].map(stat),
    records,
  };
}

function getProgress(_req, ctx) {
  const client = clientFor(ctx, ctx.query.clientId);
  return progressOf(ctx.db, client, ctx.query.range ? oneOf(ctx.query.range, 'range', ['3m', '6m', 'all']) : '3m');
}

function addMeasurement(_req, ctx) {
  const client = clientFor(ctx, ctx.body.clientId);
  const kind = oneOf(ctx.body.kind, 'kind', MEASUREMENT_KINDS);
  const [lo, hi] = BOUNDS[kind];
  ctx.db.prepare('INSERT INTO measurements (user_id, date, kind, value) VALUES (?,?,?,?) ON CONFLICT(user_id, date, kind) DO UPDATE SET value=excluded.value')
    .run(client.id, day(ctx.body.date, 'date'), kind, round1(num(ctx.body.value, 'value', { min: lo, max: hi })));
  return progressOf(ctx.db, client, '3m');
}

// MARK: - Photos (private to the client and their coach)

const photoDir = ctx => join(ctx.config.dataDir, 'photos');
const photoOut = p => ({ id: p.id, date: p.date, url: `/api/photos/${p.id}` });

function listPhotos(_req, ctx) {
  const client = clientFor(ctx, ctx.query.clientId);
  return { photos: ctx.db.prepare('SELECT * FROM photos WHERE user_id=? ORDER BY date, created_at').all(client.id).map(photoOut) };
}

function uploadPhoto(req, ctx) {
  if (ctx.user.role !== 'client') fail(403, 'Clients only');
  const bytes = ctx.rawBody;
  if (!bytes?.length) fail(400, 'Send the photo as an image/jpeg body');
  if (bytes.length > PHOTO_LIMIT) fail(413, 'Photos are limited to 8 MB');
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) fail(415, 'Photos must be JPEG');
  const id = newId('ph');
  mkdirSync(photoDir(ctx), { recursive: true, mode: 0o700 });
  writeFileSync(join(photoDir(ctx), `${id}.jpg`), bytes, { mode: 0o600 });
  const date = day(ctx.query.date, 'date', { optional: true }) ?? londonDay();
  ctx.db.prepare('INSERT INTO photos (id, user_id, date, bytes, created_at) VALUES (?,?,?,?,?)').run(id, ctx.user.id, date, bytes.length, nowIso());
  return photoOut(ctx.db.prepare('SELECT * FROM photos WHERE id=?').get(id));
}

function photoFor(ctx) {
  if (!/^ph_[A-Za-z0-9_-]+$/.test(ctx.params.id)) fail(404, 'Not found');
  const p = ctx.db.prepare('SELECT * FROM photos WHERE id=?').get(ctx.params.id);
  if (!p) fail(404, 'Not found');
  const owner = ctx.db.prepare('SELECT * FROM users WHERE id=?').get(p.user_id);
  if (!canSee(ctx.user, owner)) fail(404, 'Not found');
  return p;
}

function getPhoto(_req, ctx) {
  const p = photoFor(ctx);
  const body = readFileSync(join(photoDir(ctx), `${p.id}.jpg`));
  return raw(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' }, body);
}

function deletePhoto(_req, ctx) {
  const p = photoFor(ctx);
  if (p.user_id !== ctx.user.id) fail(403, 'Only the client can delete their photos');
  ctx.db.prepare('DELETE FROM photos WHERE id=?').run(p.id);
  rmSync(join(photoDir(ctx), `${p.id}.jpg`), { force: true });
  return { ok: true };
}

/** Remove a person's photo files from disk (the rows go with the user by cascade). */
export function erasePhotos(db, config, userId) {
  for (const p of db.prepare('SELECT id FROM photos WHERE user_id=?').all(userId)) rmSync(join(config.dataDir, 'photos', `${p.id}.jpg`), { force: true });
}

// MARK: - Challenges

function challengeOut(db, c, viewer) {
  const members = db.prepare('SELECT u.id, u.name FROM challenge_members m JOIN users u ON u.id = m.user_id WHERE m.challenge_id=?').all(c.id);
  const dist = db.prepare("SELECT COALESCE(SUM(value), 0) v FROM health_samples WHERE user_id=? AND kind='distance' AND date>=? AND date<=?");
  const scored = members.map(m => ({ id: m.id, name: m.id === viewer.id ? 'You' : m.name.replace(/^(\S+)\s+(\S).*$/, '$1 $2.'), initials: initials(m.name), value: round1(dist.get(m.id, c.start, c.end).v) }))
    .sort((a, b) => b.value - a.value);
  const ranked = scored.map((s, i) => ({ rank: i + 1, ...s, isMe: s.id === viewer.id }));
  const me = ranked.find(r => r.isMe);
  const top = ranked.slice(0, 3);
  if (me && me.rank > 3) top.push(me);
  const today = londonDay();
  const finished = db.prepare(`SELECT c.id, c.target, c.start, c.end FROM challenges c JOIN challenge_members m ON m.challenge_id = c.id WHERE m.user_id=? AND c.end < ?`).all(viewer.id, today);
  const badges = finished.filter(f => dist.get(viewer.id, f.start, f.end).v >= f.target).length;
  return {
    id: c.id, title: c.title, detail: c.detail, metric: c.metric, target: c.target, start: c.start, end: c.end,
    daysLeft: Math.max(0, daysBetween(today, c.end)), members: members.length, joined: !!me, mine: me?.value ?? 0,
    leaderboard: viewer.role === 'coach' ? ranked : top, badges, streak: viewer.role === 'client' ? habitStreak(db, viewer.id) : 0,
  };
}

function listChallenges(_req, ctx) {
  const coachId = coachIdOf(ctx.user);
  const rows = coachId ? ctx.db.prepare('SELECT * FROM challenges WHERE coach_id=? AND end>=? ORDER BY start').all(coachId, addDays(londonDay(), -30)) : [];
  return { challenges: rows.map(c => challengeOut(ctx.db, c, ctx.user)) };
}

function createChallenge(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const start = day(b.start, 'start'), end = day(b.end, 'end');
  if (end < start) fail(400, 'end is before start');
  const id = newId('ch');
  ctx.db.prepare("INSERT INTO challenges (id, coach_id, title, detail, metric, target, start, end, created_at) VALUES (?,?,?,?,'distance',?,?,?,?)").run(
    id, ctx.user.id, str(b.title, 'title', { max: 60 }), str(b.detail ?? '', 'detail', { max: 200, min: 0 }),
    num(b.target, 'target', { min: 1, max: 100000 }), start, end, nowIso());
  return challengeOut(ctx.db, ctx.db.prepare('SELECT * FROM challenges WHERE id=?').get(id), ctx.user);
}

function joinChallenge(_req, ctx) {
  if (ctx.user.role !== 'client') fail(403, 'Clients only');
  const c = ctx.db.prepare('SELECT * FROM challenges WHERE id=? AND coach_id=?').get(ctx.params.id, ctx.user.coach_id ?? '');
  if (!c) fail(404, 'Not found');
  ctx.db.prepare('INSERT OR IGNORE INTO challenge_members (challenge_id, user_id, joined_at) VALUES (?,?,?)').run(c.id, ctx.user.id, nowIso());
  return challengeOut(ctx.db, c, ctx.user);
}

export function progressRoutes(r) {
  r.add('GET', '/api/progress', getProgress);
  r.add('POST', '/api/measurements', addMeasurement);
  r.add('GET', '/api/photos', listPhotos);
  r.add('POST', '/api/photos', uploadPhoto, { rawBody: PHOTO_LIMIT });
  r.add('GET', '/api/photos/:id', getPhoto);
  r.add('DELETE', '/api/photos/:id', deletePhoto);
  r.add('GET', '/api/challenges', listChallenges);
  r.add('POST', '/api/challenges', createChallenge);
  r.add('POST', '/api/challenges/:id/join', joinChallenge);
}

