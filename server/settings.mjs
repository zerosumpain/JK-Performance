import { clientFor, requireCoach } from './access.mjs';
import { clock, fail, num, oneOf, str } from './http.mjs';
import { planOf } from './plans.mjs';
import { nowIso } from './store.mjs';

/**
 * Settings that shape what a client sees, in one place:
 * - the coach's own settings (studio tools on the phone, the coach toggles for
 *   form checks, meal photos and challenges, the two reply lines, the default
 *   meeting room, portrait and signature, the letter rhythm per plan), stored
 *   as JSON on the coach's user row;
 * - per-client coaching settings the coach sets (day minimum, letter rhythm
 *   override, an occasional line for Today);
 * - the client's own preferences (notifications on/off and one evening time);
 * - `features`, the one helper every gate uses: the client's plan features plus
 *   the coach toggles and whether macro targets are set.
 */

export const PLAN_FEATURES = ['programme', 'messaging', 'habits', 'progress', 'checkin', 'sessions', 'nutrition', 'priority', 'guides'];
export const COACH_TOGGLES = ['formChecks', 'mealPhotos', 'challenges'];
const RHYTHMS = ['weekly', 'fortnightly', 'none'];

export const COACH_DEFAULTS = {
  studioTools: false,
  formChecks: false,
  mealPhotos: false,
  challenges: false,
  replyExpectation: { standard: 'JK replies most evenings', priority: 'Same-day replies' },
  defaultMeetingUrl: null,
  avatarMediaId: null,
  signatureMediaId: null,
  // Per plan: how often a letter goes out, and whether a voice or video note is expected.
  letterRhythm: {
    elite: { every: 'weekly', media: true },
    performance: { every: 'weekly', media: false },
    foundation: { every: 'none', media: false },
    none: { every: 'none', media: false },
  },
};

/** A coach's settings, defaults filled in. */
export function coachSettings(db, coachId) {
  const row = coachId ? db.prepare('SELECT coach_settings FROM users WHERE id=?').get(coachId) : null;
  let saved = {};
  try { saved = JSON.parse(row?.coach_settings ?? '{}') ?? {}; } catch { saved = {}; }
  return {
    ...COACH_DEFAULTS, ...saved,
    replyExpectation: { ...COACH_DEFAULTS.replyExpectation, ...(saved.replyExpectation ?? {}) },
    letterRhythm: Object.fromEntries(Object.entries(COACH_DEFAULTS.letterRhythm).map(([k, v]) => [k, { ...v, ...(saved.letterRhythm?.[k] ?? {}) }])),
  };
}

const coachIdOf = user => (user.role === 'coach' ? user.id : user.coach_id);

/**
 * What a user's app may show. Every key is always present. For a coach every
 * plan feature is true (they see everything); the toggles are their own.
 */
export function featuresOf(db, user) {
  const settings = coachSettings(db, coachIdOf(user));
  const planFeatures = user.role === 'coach' ? PLAN_FEATURES : planOf(db, user).features;
  const out = Object.fromEntries(PLAN_FEATURES.map(f => [f, planFeatures.includes(f)]));
  for (const t of COACH_TOGGLES) out[t] = !!settings[t];
  out.hasMacroTargets = user.role === 'client' && !!db.prepare('SELECT 1 FROM nutrition_targets WHERE client_id=?').get(user.id);
  return out;
}

export const hasFeature = (db, user, id) => user.role === 'coach' || featuresOf(db, user)[id] === true;

/**
 * The gate for client routes new in the redesign. Like requireMember it is off
 * while GATE_SERVICES is unset (testing); when on, a client whose plan lacks
 * the feature gets 403 feature_not_in_plan. Routes Today and the JK tab call
 * never use it: they return a reduced payload instead.
 */
export function requireFeature(ctx, id) {
  if (ctx.user.role === 'coach' || !ctx.config.gateServices) return;
  if (!hasFeature(ctx.db, ctx.user, id)) fail(403, 'feature_not_in_plan');
}

/**
 * A client's letter rhythm: the plan default the coach set, or the per-client
 * override. Plans without 'checkin' have no letters. `days` is 7 or 14.
 */
export function rhythmOf(db, client) {
  const plan = planOf(db, client);
  if (!plan.features.includes('checkin')) return { every: 'none', days: null, media: false, overridden: false };
  const base = coachSettings(db, client.coach_id).letterRhythm[plan.id] ?? { every: 'weekly', media: false };
  const every = client.letter_rhythm && RHYTHMS.includes(client.letter_rhythm) ? client.letter_rhythm : base.every;
  return { every, days: every === 'weekly' ? 7 : every === 'fortnightly' ? 14 : null, media: !!base.media, overridden: !!client.letter_rhythm };
}

/** The reply line a client sees: the priority line on plans with 'priority'. */
export function replyLineFor(db, client) {
  const s = coachSettings(db, client.coach_id);
  return hasFeature(db, client, 'priority') ? s.replyExpectation.priority : s.replyExpectation.standard;
}

/** Day minimum: what the coach set, or ceil(60% of the habits). */
export const defaultMinimum = habitCount => Math.ceil(habitCount * 0.6);

export const preferencesOf = user => ({ notificationsOn: user.notifications_on !== 0, eveningReminderTime: user.evening_reminder ?? null });

// MARK: - Routes

function getSettings(_req, ctx) {
  requireCoach(ctx);
  return coachSettings(ctx.db, ctx.user.id);
}

function mediaOfCoach(ctx, id, name) {
  if (id === null) return null;
  const m = ctx.db.prepare("SELECT id FROM media WHERE id=? AND owner_id=? AND kind='image'").get(str(id, name, { max: 40 }), ctx.user.id);
  if (!m) fail(400, `${name} is not one of your images`);
  return m.id;
}

function patchSettings(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const current = coachSettings(ctx.db, ctx.user.id);
  const next = { ...current };
  for (const k of ['studioTools', ...COACH_TOGGLES]) if (b[k] !== undefined) next[k] = !!b[k];
  if (b.replyExpectation !== undefined) {
    const r = b.replyExpectation ?? {};
    next.replyExpectation = {
      standard: r.standard === undefined ? current.replyExpectation.standard : str(r.standard, 'replyExpectation.standard', { max: 60 }),
      priority: r.priority === undefined ? current.replyExpectation.priority : str(r.priority, 'replyExpectation.priority', { max: 60 }),
    };
  }
  if (b.defaultMeetingUrl !== undefined) next.defaultMeetingUrl = meetingUrl(b.defaultMeetingUrl, 'defaultMeetingUrl');
  if (b.avatarMediaId !== undefined) next.avatarMediaId = mediaOfCoach(ctx, b.avatarMediaId, 'avatarMediaId');
  if (b.signatureMediaId !== undefined) next.signatureMediaId = mediaOfCoach(ctx, b.signatureMediaId, 'signatureMediaId');
  if (b.letterRhythm !== undefined) {
    if (typeof b.letterRhythm !== 'object' || b.letterRhythm === null) fail(400, 'letterRhythm must be an object');
    next.letterRhythm = { ...current.letterRhythm };
    for (const [plan, v] of Object.entries(b.letterRhythm)) {
      oneOf(plan, 'letterRhythm plan', Object.keys(COACH_DEFAULTS.letterRhythm));
      next.letterRhythm[plan] = {
        every: v?.every === undefined ? current.letterRhythm[plan].every : oneOf(v.every, `letterRhythm.${plan}.every`, RHYTHMS),
        media: v?.media === undefined ? current.letterRhythm[plan].media : !!v.media,
      };
    }
  }
  saveCoachSettings(ctx.db, ctx.user.id, next);
  return coachSettings(ctx.db, ctx.user.id);
}

export function saveCoachSettings(db, coachId, settings) {
  db.prepare('UPDATE users SET coach_settings=? WHERE id=?').run(JSON.stringify(settings), coachId);
}

/** An http(s) link for a video room, or null. */
export function meetingUrl(v, name) {
  if (v === null || v === '') return null;
  const s = str(v, name, { max: 500 });
  let u;
  try { u = new URL(s); } catch { fail(400, `${name} must be a link`); }
  if (!['https:', 'http:'].includes(u.protocol)) fail(400, `${name} must be an http(s) link`);
  return u.toString();
}

function getPreferences(_req, ctx) {
  return preferencesOf(ctx.user);
}

function putPreferences(_req, ctx) {
  const b = ctx.body;
  const on = b.notificationsOn === undefined ? ctx.user.notifications_on !== 0 : !!b.notificationsOn;
  const time = b.eveningReminderTime === undefined ? ctx.user.evening_reminder : clock(b.eveningReminderTime, 'eveningReminderTime', { optional: true });
  ctx.db.prepare('UPDATE users SET notifications_on=?, evening_reminder=? WHERE id=?').run(on ? 1 : 0, time ?? null, ctx.user.id);
  return preferencesOf(ctx.db.prepare('SELECT * FROM users WHERE id=?').get(ctx.user.id));
}

/** A client's coaching settings as the coach sees them. */
export function clientSettingsOut(db, client) {
  const habits = db.prepare('SELECT COUNT(*) n FROM habits WHERE client_id=?').get(client.id).n;
  return {
    dayMinimum: client.day_minimum ?? defaultMinimum(habits), dayMinimumIsDefault: client.day_minimum === null || client.day_minimum === undefined,
    letterRhythm: rhythmOf(db, client), letterRhythmOverride: client.letter_rhythm ?? null,
    coachLine: client.coach_line ? { text: client.coach_line, setAt: client.coach_line_at } : null,
  };
}

function patchClientSettings(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.params.id);
  const b = ctx.body;
  if (b.dayMinimum !== undefined) {
    const v = b.dayMinimum === null ? null : num(b.dayMinimum, 'dayMinimum', { min: 1, max: 5, int: true });
    ctx.db.prepare('UPDATE users SET day_minimum=? WHERE id=?').run(v, client.id);
  }
  if (b.letterRhythm !== undefined) {
    ctx.db.prepare('UPDATE users SET letter_rhythm=? WHERE id=?').run(b.letterRhythm === null ? null : oneOf(b.letterRhythm, 'letterRhythm', RHYTHMS), client.id);
  }
  if (b.coachLine !== undefined) {
    const text = b.coachLine === null || b.coachLine === '' ? null : str(b.coachLine, 'coachLine', { max: 140 });
    ctx.db.prepare('UPDATE users SET coach_line=?, coach_line_at=? WHERE id=?').run(text, text ? nowIso() : null, client.id);
  }
  return clientSettingsOut(ctx.db, ctx.db.prepare('SELECT * FROM users WHERE id=?').get(client.id));
}

export function settingsRoutes(r) {
  r.add('GET', '/api/coach/settings', getSettings);
  r.add('PATCH', '/api/coach/settings', patchSettings);
  r.add('GET', '/api/me/preferences', getPreferences);
  r.add('PUT', '/api/me/preferences', putPreferences);
  r.add('PATCH', '/api/coach/clients/:id/settings', patchClientSettings);
}
