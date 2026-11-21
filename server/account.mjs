import { randomBytes } from 'node:crypto';
import { codeMatches, endSession, issueSession, upsertAppleUser, verifyAppleToken } from './auth.mjs';
import { credits } from './bookings.mjs';
import { PLANS, planById } from './catalogue.mjs';
import { fail, oneOf, raw, str } from './http.mjs';
import { erasePhotos } from './progress.mjs';
import { hash, nowIso, tx } from './store.mjs';
import { londonDay, monthBounds } from './time.mjs';

export function meOut(db, user) {
  const coach = user.coach_id ? db.prepare('SELECT id, name FROM users WHERE id=?').get(user.coach_id) : null;
  const plan = planById(user.plan);
  return {
    id: user.id, name: user.name, email: user.email, role: user.role, isDemo: !!user.is_demo, createdAt: user.created_at,
    membership: user.role === 'client'
      ? { plan: plan.id, planName: plan.name, since: user.plan_since, renewsOn: plan.id === 'none' ? null : monthBounds(londonDay()).next, ...credits(db, user) }
      : null,
    coach: coach ? { id: coach.id, name: coach.name } : null,
    healthSharing: user.role === 'client' ? !!user.health_share : null,
  };
}

async function signInApple(_req, ctx) {
  const claims = await verifyAppleToken(ctx.body.identityToken, ctx.config.appleAudience, { fetchImpl: ctx.config.fetchImpl });
  const user = upsertAppleUser(ctx.db, ctx.config, claims, ctx.body.fullName);
  return { token: issueSession(ctx.db, user.id), me: meOut(ctx.db, user) };
}

/** The App Review demo (and local testing): a code from the environment signs in as a seeded demo account. */
function signInCode(_req, ctx) {
  const code = ctx.body.code;
  const which = codeMatches(code, ctx.config.demoCode) ? 'demo-client' : codeMatches(code, ctx.config.demoCoachCode) ? 'demo-coach' : null;
  if (!which) fail(401, 'That code is not valid');
  const user = ctx.db.prepare('SELECT * FROM users WHERE apple_sub=?').get(which);
  if (!user) fail(503, 'The demo account is not set up');
  return { token: issueSession(ctx.db, user.id), me: meOut(ctx.db, user) };
}

/**
 * A coach previewing the client side: a session as the demo client "Sam Carter"
 * (demo world only, so no real client's data is reachable this way). Needs the
 * demo world to exist, which DEMO_CODE turns on.
 */
function demoClient(_req, ctx) {
  if (ctx.user.role !== 'coach') fail(403, 'Coaches only');
  const user = ctx.db.prepare("SELECT * FROM users WHERE apple_sub='demo-client'").get();
  if (!user) fail(404, 'The demo client is not set up on this server');
  return { token: issueSession(ctx.db, user.id), me: meOut(ctx.db, user) };
}

// MARK: - Signing in to the web desk with a code from the app

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 letters: no 0/O or 1/I
const CODE_MINUTES = 10;
const normalCode = v => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
let linkFailures = [];

/** A coach, signed in on the phone, asks for a one-time code to type into /desk. */
function linkCode(_req, ctx) {
  if (ctx.user.role !== 'coach') fail(403, 'Coaches only');
  const code = [...randomBytes(8)].map(b => CODE_ALPHABET[b % 32]).join('');
  const expiresAt = Date.now() + CODE_MINUTES * 60_000;
  tx(ctx.db, () => {
    ctx.db.prepare('DELETE FROM link_codes WHERE user_id=? OR expires_at<?').run(ctx.user.id, Date.now());
    ctx.db.prepare('INSERT INTO link_codes (hash, user_id, expires_at, created_at) VALUES (?,?,?,?)').run(hash(code), ctx.user.id, expiresAt, nowIso());
  });
  return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: new Date(expiresAt).toISOString(), url: `${new URL(ctx.config.publicUrl).origin}/desk` };
}

/** The desk trades the code for a 30-day web session. Single use; failures are throttled. */
function signInLink(_req, ctx) {
  const now = Date.now();
  linkFailures = linkFailures.filter(t => now - t < 10 * 60_000);
  if (linkFailures.length >= 30) fail(429, 'Too many tries. Wait a few minutes and get a new code.');
  const row = ctx.db.prepare('SELECT * FROM link_codes WHERE hash=?').get(hash(normalCode(ctx.body.code)));
  if (!row || row.expires_at < now) {
    linkFailures.push(now);
    fail(401, 'That code is not valid or has expired');
  }
  ctx.db.prepare('DELETE FROM link_codes WHERE hash=?').run(row.hash);
  const user = ctx.db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
  return { token: issueSession(ctx.db, user.id, 'web'), me: meOut(ctx.db, user) };
}

function logout(req, ctx) {
  endSession(ctx.db, req);
  return { ok: true };
}

const getMe = (_req, ctx) => meOut(ctx.db, ctx.user);

function patchMe(_req, ctx) {
  if (ctx.body.name !== undefined) ctx.db.prepare('UPDATE users SET name=? WHERE id=?').run(str(ctx.body.name, 'name', { max: 80 }), ctx.user.id);
  return meOut(ctx.db, ctx.db.prepare('SELECT * FROM users WHERE id=?').get(ctx.user.id));
}

/**
 * Erase the account (App Store 5.1.1(v)). Everything keyed to the person goes
 * by cascade; photo files are removed first. A coach with clients is refused:
 * deleting them would orphan the clients' plans and history.
 */
function deleteMe(_req, ctx) {
  const u = ctx.user;
  if (u.role === 'coach' && ctx.db.prepare('SELECT 1 FROM users WHERE coach_id=? LIMIT 1').get(u.id)) {
    fail(409, 'A coach with clients cannot delete their account here; contact support');
  }
  erasePhotos(ctx.db, ctx.config, u.id);
  tx(ctx.db, () => {
    ctx.db.prepare('DELETE FROM workouts WHERE created_by=? AND client_id<>?').run(u.id, u.id);
    ctx.db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  });
  return { ok: true };
}

/** Everything stored about the caller, as one JSON file (UK GDPR subject access / portability). */
function exportMe(_req, ctx) {
  const { db, user } = ctx;
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const out = {
    exportedAt: nowIso(),
    account: meOut(db, user),
    membershipHistory: all('SELECT plan, at FROM membership_events WHERE user_id=? ORDER BY at', user.id),
    workouts: all('SELECT * FROM workouts WHERE client_id=? ORDER BY date', user.id).map(w => ({
      ...w,
      items: all('SELECT i.*, e.name exercise FROM workout_items i JOIN exercises e ON e.id=i.exercise_id WHERE workout_id=? ORDER BY position', w.id)
        .map(i => ({ ...i, sets_logged: all('SELECT number, load, reps, rpe, at FROM set_logs WHERE item_id=?', i.id) })),
    })),
    habits: all('SELECT * FROM habits WHERE client_id=?', user.id).map(h => ({ ...h, days: all('SELECT date, value, done FROM habit_days WHERE habit_id=? ORDER BY date', h.id) })),
    nutritionTargets: all('SELECT kcal, protein, carbs, fat FROM nutrition_targets WHERE client_id=?', user.id),
    nutritionEntries: all('SELECT date, name, kcal, protein, carbs, fat, at FROM nutrition_entries WHERE client_id=? ORDER BY at', user.id),
    checkins: all('SELECT week, energy, sleep, pain, note, submitted_at, reply FROM checkins WHERE client_id=? ORDER BY week', user.id),
    messages: all('SELECT from_role, text, at FROM messages WHERE client_id=? ORDER BY at', user.id),
    bookings: all('SELECT kind, start, end, location, title, cancelled_at FROM bookings WHERE client_id=? ORDER BY start', user.id),
    classes: all('SELECT b.title, b.start, b.end FROM class_attendees a JOIN bookings b ON b.id=a.booking_id WHERE a.user_id=?', user.id),
    measurements: all('SELECT date, kind, value FROM measurements WHERE user_id=? ORDER BY date', user.id),
    photos: all('SELECT id, date, bytes FROM photos WHERE user_id=?', user.id).map(p => ({ ...p, note: 'Download each from /api/photos/<id> while signed in' })),
    healthSharing: { sharedWithCoach: !!user.health_share, since: user.health_share_at },
    healthSamples: all('SELECT kind, date, start, end, value FROM health_samples WHERE user_id=? ORDER BY start', user.id),
    healthActivities: all('SELECT type, date, start, end, minutes, kcal, distance_km, avg_hr, source FROM health_activities WHERE user_id=? ORDER BY start', user.id),
    weeklyFeedback: all('SELECT week, summary, wins, focus, published_at FROM reports WHERE client_id=? AND published_at IS NOT NULL ORDER BY week', user.id),
    challenges: all('SELECT c.title, m.joined_at FROM challenge_members m JOIN challenges c ON c.id=m.challenge_id WHERE m.user_id=?', user.id),
  };
  return raw(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': `attachment; filename="jk-performance-export-${londonDay()}.json"`,
    'cache-control': 'no-store',
  }, JSON.stringify(out, null, 2));
}

/** Testing only: pick a plan with no payment. Refused once real payments are on. */
function setMembership(_req, ctx) {
  if (ctx.config.payments) fail(403, 'Choose a plan through the App Store');
  if (ctx.user.role !== 'client') fail(403, 'Clients only');
  const plan = oneOf(ctx.body.plan, 'plan', PLANS.map(p => p.id));
  if (plan !== ctx.user.plan) recordPlan(ctx.db, ctx.user.id, plan);
  return meOut(ctx.db, ctx.db.prepare('SELECT * FROM users WHERE id=?').get(ctx.user.id));
}

export function recordPlan(db, userId, plan, at = nowIso()) {
  tx(db, () => {
    db.prepare('UPDATE users SET plan=?, plan_since=? WHERE id=?').run(plan, at, userId);
    db.prepare('INSERT INTO membership_events (user_id, plan, at) VALUES (?,?,?)').run(userId, plan, at);
  });
}

const plans = () => ({ plans: PLANS });

export function accountRoutes(r) {
  r.add('POST', '/api/auth/apple', signInApple, { public: true });
  r.add('POST', '/api/auth/code', signInCode, { public: true });
  r.add('POST', '/api/auth/logout', logout, { public: true });
  r.add('POST', '/api/auth/demo-client', demoClient);
  r.add('POST', '/api/auth/link-code', linkCode);
  r.add('POST', '/api/auth/link', signInLink, { public: true });
  r.add('GET', '/api/plans', plans, { public: true });
  r.add('GET', '/api/me', getMe);
  r.add('PATCH', '/api/me', patchMe);
  r.add('DELETE', '/api/me', deleteMe);
  r.add('GET', '/api/me/export', exportMe);
  r.add('POST', '/api/me/membership', setMembership);
}
