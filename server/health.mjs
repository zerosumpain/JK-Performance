import { clientFor } from './access.mjs';
import { day, fail, instant, num, oneOf, str } from './http.mjs';
import { nowIso, tx } from './store.mjs';
import { londonDay } from './time.mjs';

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
      if (kind === 'weight') weight.run(user.id, date, Math.round(value * 10) / 10);
      stored++;
    });
  });
  return { stored };
}

function summary(_req, ctx) {
  const client = clientFor(ctx, ctx.query.clientId);
  return healthDay(ctx.db, client.id, day(ctx.query.date, 'date', { optional: true }) ?? londonDay());
}

function devices(_req, ctx) {
  const last = ctx.db.prepare('SELECT MAX(received_at) at FROM health_samples WHERE user_id=?').get(ctx.user.id).at;
  return { appleHealth: !!last, lastSampleAt: last };
}

export function healthRoutes(r) {
  r.add('POST', '/api/health/samples', postSamples);
  r.add('GET', '/api/health/summary', summary);
  r.add('GET', '/api/health/devices', devices);
}
