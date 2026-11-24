import { initials, requestNow, requireCoach } from '../access.mjs';
import { num } from '../http.mjs';
import { monthlyPricesAt } from '../plans.mjs';
import { hooks } from '../registry.mjs';
import { coachPref, setCoachPref } from '../store.mjs';
import { addDays, daysBetween, londonDay, londonToUtc, monthBounds } from '../time.mjs';
// Same package (WP3): revenue reads the ledger that billing keeps.
import { addMonths, balanceOf, monthlyOf } from './billing.mjs';

/**
 * F26 Revenue insights and forecast (docs/design/desk-v2.md, WP3): what JK
 * collected (by payments.received_on, already a London day, never by
 * created_at), what is billed every month (schedules) next to the plan MRR the
 * old Business screen showed, the mix by source, client lifetime value, and a
 * 90-day forecast merged from every feature's `forecast` hook (billing
 * schedules certain, packages and campaigns likely, leads possible). A hook
 * that throws is logged and left out.
 *
 * Everything is read through the client's CURRENT coach, so the demo coach's
 * numbers hold only demo clients and a real coach's only theirs.
 */

const monthKey = d => d.slice(0, 7);
const who = u => ({ id: u.id, name: u.name, initials: initials(u.name) });
const SOURCES = { recurring: 'recurring', package: 'packages', campaign: 'campaigns' };
const CONFIDENCE = ['certain', 'likely', 'possible'];

/** The last `n` months, oldest first, each {key, first, next} (London days). */
function monthsBack(today, n) {
  const start = monthBounds(today).first;
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const first = addMonths(start, -k, 1);
    out.push({ key: monthKey(first), first, next: monthBounds(first).next });
  }
  return out;
}

/** Payments (not voided) of the coach's current clients in [from, to), with the invoice source. */
function paymentsBetween(db, coachId, from, to) {
  return db.prepare(`SELECT p.amount_pence, p.received_on, p.client_id, i.source FROM payments p
    JOIN users cu ON cu.id=p.client_id AND cu.role='client' AND cu.coach_id=?
    LEFT JOIN invoices i ON i.id=p.invoice_id
    WHERE p.voided_at IS NULL AND p.received_on>=? AND p.received_on<?`).all(coachId, from, to);
}

/** Plan MRR at the end of a day, from the membership history at the prices of the time (as the old Business screen). */
function planMrrOn(db, coachId, dayString) {
  const end = londonToUtc(addDays(dayString, 1)).toISOString();
  const rows = db.prepare(`SELECT e.user_id, e.plan FROM membership_events e JOIN users u ON u.id=e.user_id
    WHERE u.coach_id=? AND u.role='client' AND u.is_demo=(SELECT is_demo FROM users WHERE id=?) AND e.at<? ORDER BY e.at, e.id`).all(coachId, coachId, end);
  const current = new Map();
  for (const r of rows) current.set(r.user_id, r.plan);
  const prices = monthlyPricesAt(db, coachId, end);
  let pence = 0;
  for (const plan of current.values()) pence += prices.get(plan) ?? 0;
  return pence;
}

/** Billed MRR at the end of a day: schedules that existed then and had not ended, as money per month. */
function billedMrrOn(db, coachId, dayString) {
  const end = londonToUtc(addDays(dayString, 1)).toISOString();
  let pence = 0;
  for (const s of db.prepare(`SELECT s.* FROM billing_schedules s JOIN users cu ON cu.id=s.client_id AND cu.role='client' AND cu.coach_id=? WHERE s.created_at<?`).all(coachId, end)) {
    if (s.status === 'ended' && (s.ends_on ?? '') < dayString) continue;
    if (s.ends_on && s.ends_on < dayString) continue;
    pence += monthlyOf(s.amount_pence, s.interval);
  }
  return pence;
}

function summary(_req, ctx) {
  requireCoach(ctx);
  const months = ctx.query.months === undefined ? 12 : num(Number(ctx.query.months), 'months', { min: 1, max: 36, int: true });
  const today = londonDay(requestNow(ctx));
  const db = ctx.db, coachId = ctx.user.id;
  const list = monthsBack(today, months);
  const pays = paymentsBetween(db, coachId, list[0].first, addDays(today, 1));
  const collected = list.map(m => ({ month: m.key, pence: pays.filter(p => p.received_on >= m.first && p.received_on < m.next).reduce((n, p) => n + p.amount_pence, 0) }));
  const lastDay = m => (m.next > today ? today : addDays(m.next, -1));
  const billedMrr = list.map(m => ({ month: m.key, pence: billedMrrOn(db, coachId, lastDay(m)) }));
  const planMrr = list.map(m => ({ month: m.key, pence: planMrrOn(db, coachId, lastDay(m)) }));
  const mix = new Map([['recurring', 0], ['packages', 0], ['campaigns', 0], ['other', 0]]);
  for (const p of pays) { const k = SOURCES[p.source] ?? 'other'; mix.set(k, mix.get(k) + p.amount_pence); }
  const total = pays.reduce((n, p) => n + p.amount_pence, 0);
  const payers = new Set(pays.map(p => p.client_id));
  // Lifetime value: everything each paying client has paid, ever.
  const ltv = db.prepare(`SELECT p.client_id, SUM(p.amount_pence) n FROM payments p JOIN users cu ON cu.id=p.client_id AND cu.role='client' AND cu.coach_id=?
    WHERE p.voided_at IS NULL GROUP BY p.client_id`).all(coachId);
  const thisMonth = monthBounds(today);
  const prevFirst = monthBounds(addDays(thisMonth.first, -1)).first;
  const prevSameDay = addDays(prevFirst, daysBetween(thisMonth.first, today));
  const sumBetween = (a, b) => paymentsBetween(db, coachId, a, b).reduce((n, p) => n + p.amount_pence, 0);
  const collectedMonth = sumBetween(thisMonth.first, addDays(today, 1));
  const lastMonthToDate = sumBetween(prevFirst, prevSameDay < thisMonth.first ? addDays(prevSameDay, 1) : thisMonth.first);
  const lastMonthTotal = sumBetween(prevFirst, thisMonth.first);
  const target = coachPref(db, coachId, 'revenue.target', null);
  return {
    collected, billedMrr, planMrr,
    arpcPence: payers.size ? Math.round(total / payers.size / months) : 0,
    avgLtvPence: ltv.length ? Math.round(ltv.reduce((n, r) => n + r.n, 0) / ltv.length) : 0,
    mix: [...mix.entries()].map(([source, pence]) => ({ source, pence })),
    target: Number.isInteger(target) && target > 0 ? target : null,
    month: { collectedPence: collectedMonth, lastMonthToDatePence: lastMonthToDate, lastMonthPence: lastMonthTotal, day: today, daysInMonth: daysBetween(thisMonth.first, thisMonth.next) },
    totals: { collectedPence: total, payingClients: payers.size, billedMrrPence: billedMrr.at(-1).pence, planMrrPence: planMrr.at(-1).pence },
  };
}

/**
 * Forecast lines from every feature's `forecast` hook, in [from, to]:
 * `[{day, pence, label, confidence, source}]`. A throwing hook is skipped.
 */
export function forecastLines(db, coach, fromDay, toDay) {
  const out = [];
  for (const [f, fn] of hooks('forecast')) {
    let lines;
    try { lines = fn(db, coach, fromDay, toDay); } catch (e) { console.error(`forecast hook of ${f.name} failed`, e); continue; }
    for (const l of Array.isArray(lines) ? lines : []) {
      if (!l || typeof l.day !== 'string' || l.day < fromDay || l.day > toDay || !Number.isFinite(l.pence) || l.pence <= 0) continue;
      out.push({ day: l.day, pence: Math.round(l.pence), label: String(l.label ?? '').slice(0, 120), confidence: CONFIDENCE.includes(l.confidence) ? l.confidence : 'possible', source: String(l.source ?? f.name) });
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || CONFIDENCE.indexOf(a.confidence) - CONFIDENCE.indexOf(b.confidence));
}

function forecast(_req, ctx) {
  requireCoach(ctx);
  const span = ctx.query.days === undefined ? 90 : num(Number(ctx.query.days), 'days', { min: 7, max: 365, int: true });
  const today = londonDay(requestNow(ctx));
  const to = addDays(today, span - 1);
  const lines = forecastLines(ctx.db, ctx.user, today, to);
  const days = [];
  for (let i = 0; i < span; i++) {
    const d = addDays(today, i);
    const of = c => lines.filter(l => l.day === d && l.confidence === c).reduce((n, l) => n + l.pence, 0);
    days.push({ day: d, certainPence: of('certain'), likelyPence: of('likely'), possiblePence: of('possible') });
  }
  const sum = c => lines.filter(l => l.confidence === c).reduce((n, l) => n + l.pence, 0);
  return { days, lines, totals: { certainPence: sum('certain'), likelyPence: sum('likely'), possiblePence: sum('possible') } };
}

function clients(_req, ctx) {
  requireCoach(ctx);
  const db = ctx.db;
  const today = londonDay(requestNow(ctx));
  const yearAgo = addDays(today, -365);
  const rows = db.prepare("SELECT * FROM users WHERE role='client' AND coach_id=? ORDER BY name").all(ctx.user.id);
  const out = rows.map(c => {
    const pays = db.prepare('SELECT amount_pence, received_on FROM payments WHERE client_id=? AND voided_at IS NULL').all(c.id);
    return {
      client: { ...who(c), plan: c.plan },
      ltvPence: pays.reduce((n, p) => n + p.amount_pence, 0),
      paid12Pence: pays.filter(p => p.received_on > yearAgo).reduce((n, p) => n + p.amount_pence, 0),
      balancePence: balanceOf(db, c.id),
      monthsActive: new Set(pays.map(p => monthKey(p.received_on))).size,
      tenureDays: Math.max(0, daysBetween(londonDay(new Date(c.created_at)), today)),
      lastPaidOn: pays.reduce((m, p) => (p.received_on > m ? p.received_on : m), '') || null,
    };
  });
  return { clients: out.sort((a, b) => b.ltvPence - a.ltvPence) };
}

function putTarget(_req, ctx) {
  requireCoach(ctx);
  const v = ctx.body.targetPence;
  const pence = v === null ? null : num(v, 'targetPence', { min: 0, max: 100_000_000, int: true });
  setCoachPref(ctx.db, ctx.user.id, 'revenue.target', pence || null);
  return { target: pence || null };
}

export const feature = {
  name: 'revenue',
  namespaces: ['revenue'],
  routes(r) {
    r.add('GET', '/api/revenue/summary', summary);
    r.add('GET', '/api/revenue/forecast', forecast);
    r.add('GET', '/api/revenue/clients', clients);
    r.add('PUT', '/api/revenue/target', putTarget);
  },
  demo: {
    build(db, { coach }) {
      setCoachPref(db, coach.id, 'revenue.target', 250_000);
    },
  },
};

