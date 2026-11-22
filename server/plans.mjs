import { requireCoach } from './access.mjs';
import { primaryCoachId } from './auth.mjs';
import { fail, num, str } from './http.mjs';
import { nowIso, tx } from './store.mjs';

/**
 * Membership plans and what each one includes. The four plan ids are fixed
 * (the apps, bookings and business numbers know them); a coach sets each
 * plan's name, prices, session credits and features for their own clients.
 * A coach who has changed nothing gets DEFAULT_PLANS. Every price change is
 * kept in plan_price_events, so the business numbers for a past day use the
 * price that applied that day.
 *
 * The features are a fixed catalogue: the apps draw each one with its own
 * icon and preview, and the walkthrough an unsubscribed client sees steps
 * through them plan by plan.
 */
export const FEATURES = [
  { id: 'programme', title: 'Your programme', detail: 'Workouts written for you every week, with each exercise, set, rep and load to hit.',
    points: ['Planned around your goal and the days you can train', 'Log every set as you go, even offline', 'Your coach adjusts it from how the week went'] },
  { id: 'messaging', title: 'Message your coach', detail: 'Ask anything, any day, and send a set or a workout to talk it through.',
    points: ['One thread with your coach', 'Share a workout straight into the chat', 'Notifications when they reply'] },
  { id: 'habits', title: 'Daily habits', detail: 'Steps, water, sleep and protein: the small things, ticked off every day.',
    points: ['Targets set with your coach', 'Steps and sleep fill in from your phone', 'Streaks that keep you honest'] },
  { id: 'progress', title: 'Progress and records', detail: 'Body weight, measurements, photos and personal bests, all in one place.',
    points: ['Charts for weight and measurements', 'Private progress photos', 'Personal records spotted for you'] },
  { id: 'checkin', title: 'Weekly check-in and feedback', detail: 'Tell your coach how the week went; get a written report and next week’s plan back.',
    points: ['Energy, sleep and any pain or injury', 'A written report every week', 'Wins and one clear focus for the week ahead'] },
  { id: 'sessions', title: '1:1 sessions', detail: 'Book sessions with your coach, in person or on video, from their live calendar.',
    points: ['Session credits every month', 'Book, move or cancel in the app', 'Reminders and calendar sync'] },
  { id: 'nutrition', title: 'Nutrition coaching', detail: 'Calorie and macro targets set for you, and a food log your coach reviews.',
    points: ['Targets for calories, protein, carbs and fat', 'Quick food logging', 'Feedback on what you actually ate'] },
  { id: 'priority', title: 'Priority support', detail: 'Your messages go to the top of your coach’s list, with same-day replies.',
    points: ['Same-day replies', 'First in the queue', 'Plan changes turned round fast'] },
  { id: 'guides', title: 'Coaching guides', detail: 'Short reads on training, food, sleep and recovery from your coach.',
    points: ['Two-minute reads', 'Training, nutrition and recovery', 'New guides added over time'] },
];
const FEATURE_IDS = FEATURES.map(f => f.id);

export const DEFAULT_PLANS = [
  { id: 'none', name: 'Free', detail: 'Read the guides and see what coaching includes', pitch: 'Look around, read the guides and see how coaching works before you commit.',
    monthlyPence: 0, annualPence: 0, credits: 0, featured: false, features: ['guides'] },
  { id: 'foundation', name: 'Foundation', detail: 'Programme + app messaging',
    pitch: 'For people who train on their own and want a plan that is written for them, with a coach a message away.',
    monthlyPence: 5900, annualPence: 60200, credits: 0, featured: false, features: ['programme', 'messaging', 'habits', 'progress', 'guides'] },
  { id: 'performance', name: 'Performance', detail: 'Programme, 2 sessions / month, weekly check-in',
    pitch: 'Everything in Foundation, plus sessions with your coach every month and a weekly check-in that shapes the next week.',
    monthlyPence: 9900, annualPence: 101000, credits: 2, featured: true, features: ['programme', 'messaging', 'habits', 'progress', 'checkin', 'sessions', 'guides'] },
  { id: 'elite', name: 'Elite', detail: 'Weekly 1:1 sessions, nutrition, priority messaging',
    pitch: 'The full service: a session every week, your nutrition coached alongside your training, and your messages answered first.',
    monthlyPence: 14900, annualPence: 152000, credits: 4, featured: false, features: ['programme', 'messaging', 'habits', 'progress', 'checkin', 'sessions', 'nutrition', 'priority', 'guides'] },
];
export const PLAN_IDS = DEFAULT_PLANS.map(p => p.id);
const MAX_MONTHLY = 100_000; // £1,000
const MAX_ANNUAL = 1_000_000; // £10,000

const fromRow = (base, row) => !row ? { ...base } : {
  id: base.id, name: row.name, detail: row.detail, pitch: row.pitch,
  monthlyPence: row.monthly_pence, annualPence: row.annual_pence, credits: row.credits,
  featured: !!row.featured, features: JSON.parse(row.features).filter(f => FEATURE_IDS.includes(f)),
  updatedAt: row.updated_at,
};

/** A coach's four plans, in order. `coachId` null → the defaults. */
export function plansFor(db, coachId) {
  const rows = coachId ? new Map(db.prepare('SELECT * FROM plan_settings WHERE coach_id=?').all(coachId).map(r => [r.plan, r])) : new Map();
  return DEFAULT_PLANS.map(p => fromRow(p, rows.get(p.id)));
}

const coachOf = user => (user?.role === 'coach' ? user.id : user?.coach_id ?? null);

/** The plan a client is on, as their coach prices it. */
export function planOf(db, user) {
  const id = PLAN_IDS.includes(user.plan) ? user.plan : 'none';
  return plansFor(db, coachOf(user)).find(p => p.id === id);
}

/**
 * Monthly price of each plan on a day (an ISO instant: prices set before it
 * count), from the coach's price history; plans never changed use the default.
 */
export function monthlyPricesAt(db, coachId, beforeIso) {
  const out = new Map(DEFAULT_PLANS.map(p => [p.id, p.monthlyPence]));
  for (const r of db.prepare('SELECT plan, monthly_pence FROM plan_price_events WHERE coach_id=? AND at < ? ORDER BY at, id').all(coachId, beforeIso)) out.set(r.plan, r.monthly_pence);
  return out;
}

// MARK: - Routes

/**
 * Public: the plans and the feature catalogue. Signed in, a client sees their
 * coach's prices and a coach their own; signed out, the main coach's.
 */
function getPlans(_req, ctx) {
  const coachId = coachOf(ctx.user) ?? primaryCoachId(ctx.db, ctx.config);
  return { plans: plansFor(ctx.db, coachId), features: FEATURES };
}

function putPlan(_req, ctx) {
  requireCoach(ctx);
  const id = ctx.params.id;
  if (!PLAN_IDS.includes(id)) fail(404, 'Not found');
  const b = ctx.body;
  const current = plansFor(ctx.db, ctx.user.id).find(p => p.id === id);
  const free = id === 'none';
  const next = {
    name: str(b.name ?? current.name, 'name', { max: 30 }),
    detail: str(b.detail ?? current.detail, 'detail', { max: 90 }),
    pitch: str(b.pitch ?? current.pitch, 'pitch', { max: 400 }),
    monthlyPence: free ? 0 : num(b.monthlyPence ?? current.monthlyPence, 'monthlyPence', { min: 0, max: MAX_MONTHLY, int: true }),
    annualPence: free ? 0 : num(b.annualPence ?? current.annualPence, 'annualPence', { min: 0, max: MAX_ANNUAL, int: true }),
    credits: free ? 0 : num(b.credits ?? current.credits, 'credits', { min: 0, max: 31, int: true }),
    featured: free ? false : (b.featured === undefined ? current.featured : !!b.featured),
    features: current.features,
  };
  if (free && ((b.monthlyPence ?? 0) !== 0 || (b.annualPence ?? 0) !== 0 || (b.credits ?? 0) !== 0)) fail(400, 'The free plan has no price or session credits');
  if (b.features !== undefined) {
    if (!Array.isArray(b.features) || b.features.some(f => !FEATURE_IDS.includes(f))) fail(400, `features must be a list from ${FEATURE_IDS.join(', ')}`);
    next.features = FEATURE_IDS.filter(f => b.features.includes(f)); // catalogue order, no repeats
  }
  if (!next.features.length) fail(400, 'A plan needs at least one feature');
  if (next.features.includes('sessions') && next.credits === 0 && !free) fail(400, 'Give the plan session credits, or take 1:1 sessions off it');
  const at = nowIso();
  tx(ctx.db, () => {
    // One plan at a time is marked "most popular"; the one that had it (stored or default) loses it.
    if (next.featured) {
      for (const p of plansFor(ctx.db, ctx.user.id)) {
        if (p.id !== id && p.featured) save(ctx.db, ctx.user.id, { ...p, featured: false }, at);
      }
    }
    save(ctx.db, ctx.user.id, { id, ...next }, at);
    if (next.monthlyPence !== current.monthlyPence || next.annualPence !== current.annualPence) {
      ctx.db.prepare('INSERT INTO plan_price_events (coach_id, plan, monthly_pence, annual_pence, at) VALUES (?,?,?,?,?)')
        .run(ctx.user.id, id, next.monthlyPence, next.annualPence, at);
    }
  });
  return { plans: plansFor(ctx.db, ctx.user.id), features: FEATURES };
}

function save(db, coachId, p, at) {
  db.prepare(`INSERT INTO plan_settings (coach_id, plan, name, detail, pitch, monthly_pence, annual_pence, credits, featured, features, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT (coach_id, plan) DO UPDATE SET name=excluded.name, detail=excluded.detail, pitch=excluded.pitch,
      monthly_pence=excluded.monthly_pence, annual_pence=excluded.annual_pence, credits=excluded.credits,
      featured=excluded.featured, features=excluded.features, updated_at=excluded.updated_at`)
    .run(coachId, p.id, p.name, p.detail, p.pitch, p.monthlyPence, p.annualPence, p.credits, p.featured ? 1 : 0, JSON.stringify(p.features), at);
}

/** Back to the defaults for every plan (prices are recorded, so history stays right). */
function resetPlans(_req, ctx) {
  requireCoach(ctx);
  const before = plansFor(ctx.db, ctx.user.id);
  const at = nowIso();
  tx(ctx.db, () => {
    ctx.db.prepare('DELETE FROM plan_settings WHERE coach_id=?').run(ctx.user.id);
    for (const d of DEFAULT_PLANS) {
      const b = before.find(p => p.id === d.id);
      if (b.monthlyPence !== d.monthlyPence || b.annualPence !== d.annualPence) {
        ctx.db.prepare('INSERT INTO plan_price_events (coach_id, plan, monthly_pence, annual_pence, at) VALUES (?,?,?,?,?)')
          .run(ctx.user.id, d.id, d.monthlyPence, d.annualPence, at);
      }
    }
  });
  return { plans: plansFor(ctx.db, ctx.user.id), features: FEATURES };
}

export function planRoutes(r) {
  r.add('GET', '/api/plans', getPlans, { public: true });
  r.add('PUT', '/api/coach/plans/:id', putPlan);
  r.add('POST', '/api/coach/plans/reset', resetPlans);
}
