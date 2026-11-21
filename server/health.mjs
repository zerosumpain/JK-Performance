import { clientFor } from './access.mjs';
import { day, fail, instant, num, oneOf, str } from './http.mjs';
import { nowIso, tx } from './store.mjs';
import { addDays, londonDay } from './time.mjs';

export const HEALTH_KINDS = ['steps', 'sleep', 'restingHr', 'activeKcal', 'weight', 'distance'];
const BOUNDS = { steps: 200_000, sleep: 1_440, restingHr: 250, activeKcal: 20_000, weight: 400, distance: 1_000 };

/**
 * One day of Apple Health for a person. Sums for counts (steps, energy,
 * distance, sleep minutes); the latest reading for levels (resting HR, weight).
 * A sample's day is the London day it ENDS on, so a night's sleep belongs to
 * the morning after.
 */
export function healthDay(db, userId, date) {
  const sum = kind => db.prepare('SELECT SUM(value) v FROM health_samples WHERE user_id=? AND kind=? AND date=?').get(userId, kind, date).v;
  const last = kind => db.prepare('SELECT value v FROM health_samples WHERE user_id=? AND kind=? AND date=? ORDER BY end DESC LIMIT 1').get(userId, kind, date)?.v ?? null;
  const steps = sum('steps'), sleep = sum('sleep'), kcal = sum('activeKcal'), distance = sum('distance');
  return {
    date,
    steps: steps === null ? null : Math.round(steps),
    sleepMinutes: sleep === null ? null : Math.round(sleep),
    restingHr: last('restingHr'),
    activeKcal: kcal === null ? null : Math.round(kcal),
    weight: last('weight'),
    distanceKm: distance === null ? null : Math.round(distance * 10) / 10,
  };
}

function postSamples(_req, ctx) {
  const samples = ctx.body.samples;
  if (!Array.isArray(samples) || samples.length > 2000) fail(400, 'samples must be a list of up to 2000');
  const user = ctx.user;
  // A demo account is shared and fake: never store a real phone's health in it.
  if (user.is_demo) return { stored: 0, ignored: true };
  const upsert = ctx.db.prepare(`INSERT INTO health_samples (user_id, id, kind, date, start, end, value, received_at) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id, id) DO UPDATE SET kind=excluded.kind, date=excluded.date, start=excluded.start, end=excluded.end, value=excluded.value, received_at=excluded.received_at`);
  const weight = ctx.db.prepare('INSERT INTO measurements (user_id, date, kind, value) VALUES (?,?,\'weight\',?) ON CONFLICT(user_id, date, kind) DO UPDATE SET value=excluded.value');
  let stored = 0;
  tx(ctx.db, () => {
    samples.forEach((s, i) => {
      const id = str(s.id, `samples[${i}].id`, { max: 120 });
      const kind = oneOf(s.kind, `samples[${i}].kind`, HEALTH_KINDS);
      const start = instant(s.start, `samples[${i}].start`), end = instant(s.end, `samples[${i}].end`);
      const value = num(s.value, `samples[${i}].value`, { min: 0, max: BOUNDS[kind] });
      const date = londonDay(new Date(end));
      upsert.run(user.id, id, kind, date, start, end, value, nowIso());
      // Progress measurements are shown to the coach, so Health weight joins them only with consent.
      if (kind === 'weight' && user.health_share) weight.run(user.id, date, Math.round(value * 10) / 10);
      stored++;
    });
  });
  return { stored };
}

/**
 * Apple Health is the client's: they see their own always; their coach sees it
 * only while the client has said yes to sharing (`health_share`). Turning
 * sharing off hides it from the coach at once; nothing is copied elsewhere.
 */
export const healthVisible = (viewer, client) => viewer.id === client.id || !!client.health_share;

function visibleClient(ctx) {
  const client = clientFor(ctx, ctx.query.clientId);
  if (!healthVisible(ctx.user, client)) fail(403, 'health_not_shared');
  return client;
}

function summary(_req, ctx) {
  const client = visibleClient(ctx);
  return healthDay(ctx.db, client.id, day(ctx.query.date, 'date', { optional: true }) ?? londonDay());
}

// MARK: - Activities (Apple Health workouts: runs, rides, gym sessions…)

const activityOut = a => ({
  id: a.id, type: a.type, date: a.date, start: a.start, end: a.end, minutes: Math.round(a.minutes),
  kcal: a.kcal === null ? null : Math.round(a.kcal), distanceKm: a.distance_km === null ? null : Math.round(a.distance_km * 100) / 100,
  avgHr: a.avg_hr === null ? null : Math.round(a.avg_hr), source: a.source,
});

export function activitiesBetween(db, userId, from, to) {
  return db.prepare('SELECT * FROM health_activities WHERE user_id=? AND date>=? AND date<=? ORDER BY start DESC LIMIT 200')
    .all(userId, from, to).map(activityOut);
}

function postActivities(_req, ctx) {
  const list = ctx.body.activities;
  if (!Array.isArray(list) || list.length > 500) fail(400, 'activities must be a list of up to 500');
  const user = ctx.user;
  if (user.is_demo) return { stored: 0, ignored: true };
  const opt = (v, name, max) => num(v, name, { min: 0, max, optional: true });
  const upsert = ctx.db.prepare(`INSERT INTO health_activities (user_id, id, type, date, start, end, minutes, kcal, distance_km, avg_hr, source, received_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id, id) DO UPDATE SET type=excluded.type, date=excluded.date, start=excluded.start, end=excluded.end, minutes=excluded.minutes,
      kcal=excluded.kcal, distance_km=excluded.distance_km, avg_hr=excluded.avg_hr, source=excluded.source, received_at=excluded.received_at`);
  let stored = 0;
  tx(ctx.db, () => {
    list.forEach((a, i) => {
      const at = `activities[${i}]`;
      const start = instant(a.start, `${at}.start`), end = instant(a.end, `${at}.end`);
      upsert.run(user.id, str(a.id, `${at}.id`, { max: 120 }), str(a.type, `${at}.type`, { max: 40 }), londonDay(new Date(start)), start, end,
        num(a.minutes, `${at}.minutes`, { min: 0, max: 2880 }), opt(a.kcal, `${at}.kcal`, 20_000), opt(a.distanceKm, `${at}.distanceKm`, 1_000),
        opt(a.avgHr, `${at}.avgHr`, 250), str(a.source, `${at}.source`, { max: 60, optional: true, min: 0 }), nowIso());
      stored++;
    });
  });
  return { stored };
}

function activities(_req, ctx) {
  const client = visibleClient(ctx);
  const to = day(ctx.query.to, 'to', { optional: true }) ?? londonDay();
  const from = day(ctx.query.from, 'from', { optional: true }) ?? addDays(to, -27);
  return { activities: activitiesBetween(ctx.db, client.id, from, to) };
}

/** Seven days of daily figures ending `to`, and the activities in them: the coach's Health tab. */
function week(_req, ctx) {
  const client = clientFor(ctx, ctx.query.clientId);
  if (!healthVisible(ctx.user, client)) return { shared: false, days: [], activities: [] };
  const to = day(ctx.query.to, 'to', { optional: true }) ?? londonDay();
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(healthDay(ctx.db, client.id, addDays(to, -i)));
  return { shared: true, sharedSince: client.health_share_at, days, activities: activitiesBetween(ctx.db, client.id, addDays(to, -6), to) };
}

// MARK: - Consent

function setSharing(_req, ctx) {
  if (ctx.user.role !== 'client') fail(403, 'Clients only');
  if (typeof ctx.body.share !== 'boolean') fail(400, 'share must be true or false');
  const share = ctx.body.share;
  ctx.db.prepare('UPDATE users SET health_share=?, health_share_at=? WHERE id=?').run(share ? 1 : 0, share ? nowIso() : null, ctx.user.id);
  return devicesOf(ctx.db, ctx.db.prepare('SELECT * FROM users WHERE id=?').get(ctx.user.id));
}

/** Withdraw: erase every synced sample and activity, and stop sharing. */
function eraseHealth(_req, ctx) {
  tx(ctx.db, () => {
    ctx.db.prepare('DELETE FROM health_samples WHERE user_id=?').run(ctx.user.id);
    ctx.db.prepare('DELETE FROM health_activities WHERE user_id=?').run(ctx.user.id);
    ctx.db.prepare('UPDATE users SET health_share=0, health_share_at=NULL WHERE id=?').run(ctx.user.id);
  });
  return devicesOf(ctx.db, ctx.db.prepare('SELECT * FROM users WHERE id=?').get(ctx.user.id));
}

function devicesOf(db, user) {
  const last = db.prepare('SELECT MAX(received_at) at FROM health_samples WHERE user_id=?').get(user.id).at;
  const acts = db.prepare('SELECT COUNT(*) n, MAX(start) at FROM health_activities WHERE user_id=?').get(user.id);
  return {
    appleHealth: !!last, lastSampleAt: last, activityCount: acts.n, lastActivityAt: acts.at,
    sharing: !!user.health_share, sharingSince: user.health_share_at,
  };
}

const devices = (_req, ctx) => devicesOf(ctx.db, ctx.user);

export function healthRoutes(r) {
  r.add('POST', '/api/health/samples', postSamples);
  r.add('POST', '/api/health/activities', postActivities);
  r.add('GET', '/api/health/activities', activities);
  r.add('GET', '/api/health/summary', summary);
  r.add('GET', '/api/health/week', week);
  r.add('GET', '/api/health/devices', devices);
  r.add('PUT', '/api/health/sharing', setSharing);
  r.add('DELETE', '/api/health/data', eraseHealth);
}
