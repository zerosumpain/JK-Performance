import { clientFor, initials, requireCoach, requestNow } from '../access.mjs';
import { dayStates, minimumStreak } from '../daily.mjs';
import { emit } from '../events.mjs';
import { clientFacts, ownClients } from '../facts.mjs';
import { day as dayParam, fail, num, oneOf, str } from '../http.mjs';
import { sendMessage } from '../messages.mjs';
import { notifyCoach } from '../notifications.mjs';
import { newId, tx } from '../store.mjs';
import { render } from '../templating.mjs';
import { addDays, londonClock, londonDay, londonToUtc, mondayOf } from '../time.mjs';

/**
 * F24 The accountability board (docs/design/desk-v2.md): who kept their word
 * this week across every client, from existing tables only (commitments, the
 * day minimum through dayStates, workouts, check-ins). Nothing here writes to
 * those tables.
 *
 *   score = round(100 × (0.4·C + 0.3·H + 0.2·T + 0.1·K))
 *   C  commitments: kept 1, mostly .5, missed 0, over those set; an open one
 *      counts (as 0) only once the week has ended; none set → .5 and the flag
 *      noCommitments; all still open mid-week → 1 (not yet applicable).
 *   H  days the minimum was met / days elapsed (today only once met; rest days
 *      and days with no habits are neither); nothing elapsed → 1.
 *   T  workouts completed / workouts due (published, dated before today, or
 *      already done); none due → 1.
 *   K  this week's check-in: 1 if sent; 0 once it is due (Friday of the week),
 *      else 1.
 *
 * The current week is always live. accountability_weeks is a snapshot written
 * when a week closes (Monday 05:00 London clock) for history and trends.
 * Streak milestones (7, 14, 30, 60, 100 days of the minimum) fire once per
 * crossing, checked on day.started against the streak last seen.
 */

export const MILESTONES = [7, 14, 30, 60, 100];
const OUTCOME_VALUE = { kept: 1, mostly: 0.5, missed: 0 };
export const FILTERS = ['all', 'missed', 'noCommitments', 'atRisk', 'topStreaks'];
const AT_RISK_FROM = '18:00';
const LAPSED_DAYS = 28;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// MARK: - The score

/**
 * One client's week, from existing tables. `week` is a London Monday; `today`
 * the London day it is (for the current week, the day so far). Returns
 * {score, parts:{c, h, t, k}, commitments, days, minimumDays, workouts, checkin, checkinDue, flags, ended}.
 */
export function weekParts(db, client, week, { today = londonDay(), now = new Date() } = {}) {
  const sunday = addDays(week, 6);
  const ended = today > sunday;

  const commitments = db.prepare('SELECT text, outcome FROM commitments WHERE client_id=? AND week=? ORDER BY position, created_at').all(client.id, week)
    .map(c => ({ text: c.text, outcome: c.outcome ?? 'open' }));
  const counted = commitments.filter(c => c.outcome !== 'open' || ended);
  const noCommitments = commitments.length === 0;
  const c = noCommitments ? 0.5 : !counted.length ? 1 : counted.reduce((s, x) => s + (OUTCOME_VALUE[x.outcome] ?? 0), 0) / counted.length;

  const states = today < week ? [] : dayStates(db, client, week, sunday, { useHealth: !!client.health_share, today });
  const elapsed = states.filter(s => !s.future && !s.rest && s.total > 0 && !(s.today && !s.done));
  const h = elapsed.length ? elapsed.filter(s => s.done).length / elapsed.length : 1;
  const days = states.map(s => ({
    date: s.date,
    state: s.rest ? 'rest' : s.future ? 'future' : s.total === 0 ? 'none' : s.done ? 'done' : s.today ? 'today' : 'missed',
  }));

  const ws = db.prepare('SELECT date, completed_at FROM workouts WHERE client_id=? AND published=1 AND date>=? AND date<=?').all(client.id, week, sunday);
  const done = ws.filter(w => w.completed_at).length;
  const due = ws.filter(w => w.completed_at || w.date < today || ended).length;
  const t = due ? Math.min(1, done / due) : 1;

  const checkin = !!db.prepare('SELECT 1 FROM checkins WHERE client_id=? AND week=?').get(client.id, week);
  const checkinDue = today >= addDays(week, 4);
  const k = checkin ? 1 : checkinDue ? 0 : 1;

  const score = Math.round(100 * (0.4 * c + 0.3 * h + 0.2 * t + 0.1 * k));
  const flags = [];
  if (noCommitments) flags.push('noCommitments');
  const missed = commitments.some(x => x.outcome === 'missed' || (ended && x.outcome === 'open'))
    || days.some(x => x.state === 'missed') || due > done || (checkinDue && !checkin);
  if (missed) flags.push('missed');
  const r3 = v => Math.round(v * 1000) / 1000;
  return {
    score, parts: { c: r3(c), h: r3(h), t: r3(t), k }, commitments: commitments.slice(0, 3), days, minimumDays: days.map(x => x.state === 'done'),
    workouts: { done, planned: ws.length, due }, checkin, checkinDue, flags, ended,
    daysMet: elapsed.filter(s => s.done).length, daysElapsed: elapsed.length,
    todayState: days.find(x => x.date === today)?.state ?? null,
  };
}

const streakOf = (db, client, today) => minimumStreak(db, client, today, { useHealth: !!client.health_share });

/** The day a streak of `streak` days (as of `today`) last counted: today once met, else yesterday. */
function streakEnd(db, client, today) {
  const s = dayStates(db, client, today, today, { useHealth: !!client.health_share, today })[0];
  return s?.done ? today : addDays(today, -1);
}

// MARK: - Rows and access (client-linked rows always join the client's CURRENT coach, 6.1)

/** Everyone except lapsed people: no plan and nothing from them for four weeks. */
function onBoard(db, coachId, clients, today) {
  const lapsed = clients.filter(c => c.plan === 'none');
  if (!lapsed.length) return clients;
  const facts = clientFacts(db, coachId, lapsed.map(c => c.id), { only: ['core.daysQuiet'], today });
  return clients.filter(c => c.plan !== 'none' || !((facts.get(c.id)?.['core.daysQuiet'] ?? 999) > LAPSED_DAYS));
}

const clientOut = u => ({ id: u.id, name: u.name, initials: initials(u.name), plan: u.plan });
const clientsOf = (db, coachId) => db.prepare("SELECT * FROM users WHERE role='client' AND coach_id=? ORDER BY name").all(coachId);

function snapshot(db, coachId, clientId, week) {
  const r = db.prepare(`SELECT w.* FROM accountability_weeks w JOIN users u ON u.id=w.client_id AND u.coach_id=? WHERE w.client_id=? AND w.week=?`).get(coachId, clientId, week);
  return r ? { week: r.week, score: r.score, parts: JSON.parse(r.parts) } : null;
}

/** Scores for the `n` weeks ending with `week`: snapshots where written, else computed now. Oldest first. */
function trendOf(db, coachId, client, week, n, { today, now }) {
  const out = [];
  const joined = mondayOf(londonDay(new Date(client.created_at)));
  for (let i = n - 1; i >= 0; i--) {
    const w = addDays(week, -7 * i);
    if (w < joined) { out.push(null); continue; }
    const snap = w < mondayOf(today) ? snapshot(db, coachId, client.id, w) : null;
    out.push(snap ? snap.score : weekParts(db, client, w, { today, now }).score);
  }
  return out;
}

function nowAndToday(ctx) { const now = requestNow(ctx); return { now, today: londonDay(now) }; }

function weekOf(ctx, today) {
  const w = ctx.query.week ? mondayOf(dayParam(ctx.query.week, 'week')) : mondayOf(today);
  if (w > mondayOf(today)) fail(400, 'week must not be in the future');
  return w;
}

// MARK: - Routes

/** GET /api/accountability?week=&filter= : the board. */
function board(_req, ctx) {
  requireCoach(ctx);
  const { now, today } = nowAndToday(ctx);
  const week = weekOf(ctx, today);
  const sunday = addDays(week, 6);
  const current = week === mondayOf(today);
  const asOf = current ? today : sunday;
  const filter = ctx.query.filter ? oneOf(ctx.query.filter, 'filter', FILTERS) : 'all';
  const end = londonToUtc(addDays(sunday, 1)).toISOString();
  const clients = onBoard(ctx.db, ctx.user.id, clientsOf(ctx.db, ctx.user.id).filter(c => c.created_at < end), today);
  const lastNudge = ctx.db.prepare('SELECT MAX(n.at) at FROM accountability_nudges n JOIN users u ON u.id=n.client_id AND u.coach_id=? WHERE n.client_id=?');
  const late = current && londonClock(now) >= AT_RISK_FROM;
  let rows = clients.map(c => {
    // A past week is judged as closed (open commitments count), so it reads with the real today.
    const p = weekParts(ctx.db, c, week, { today, now });
    const streak = streakOf(ctx.db, c, asOf);
    const flags = [...p.flags];
    if (late && streak > 0 && p.todayState === 'today') flags.push('atRisk');
    if (streak >= 7) flags.push('topStreak');
    return {
      client: clientOut(c), score: p.score, parts: p.parts, commitments: p.commitments, minimumDays: p.minimumDays, days: p.days,
      workouts: { done: p.workouts.done, planned: p.workouts.planned }, checkin: p.checkin, checkinDue: p.checkinDue, streak,
      trend: trendOf(ctx.db, ctx.user.id, c, week, 8, { today: asOf, now }), flags, lastNudgeAt: lastNudge.get(ctx.user.id, c.id).at ?? null,
      daysMet: p.daysMet, daysElapsed: p.daysElapsed,
    };
  });
  const all = rows;
  if (filter === 'missed') rows = rows.filter(r => r.flags.includes('missed'));
  else if (filter === 'noCommitments') rows = rows.filter(r => r.flags.includes('noCommitments'));
  else if (filter === 'atRisk') rows = rows.filter(r => r.flags.includes('atRisk'));
  else if (filter === 'topStreaks') rows = rows.filter(r => r.streak >= 7).sort((a, b) => b.streak - a.streak);
  const milestones = ctx.db.prepare(`SELECT m.*, u.name, u.plan FROM accountability_milestones m JOIN users u ON u.id=m.client_id AND u.coach_id=?
    WHERE m.reached_on>=? AND m.reached_on<=? ORDER BY m.milestone DESC, m.reached_on`).all(ctx.user.id, week, sunday)
    .map(m => ({
      client: { id: m.client_id, name: m.name, initials: initials(m.name), plan: m.plan }, streak: m.milestone, reachedOn: m.reached_on,
      celebratedAt: ctx.db.prepare("SELECT MAX(at) at FROM accountability_nudges WHERE client_id=? AND kind='celebrate' AND at>=?").get(m.client_id, londonToUtc(m.reached_on).toISOString()).at ?? null,
    }));
  const sum = (list, f) => list.reduce((s, r) => s + f(r), 0);
  const set = sum(all, r => r.commitments.length);
  const kept = sum(all, r => r.commitments.filter(c => c.outcome === 'kept').length + 0.5 * r.commitments.filter(c => c.outcome === 'mostly').length);
  const counts = Object.fromEntries(FILTERS.map(f => [f, f === 'all' ? all.length : f === 'topStreaks' ? all.filter(r => r.streak >= 7).length
    : all.filter(r => r.flags.includes(f)).length]));
  return {
    week, weekEnd: sunday, today, current, filter, rows, milestones, counts,
    summary: {
      clients: all.length, avgScore: all.length ? Math.round(sum(all, r => r.score) / all.length) : null,
      commitmentsSet: set, commitmentsKept: kept, commitmentsOpen: sum(all, r => r.commitments.filter(c => c.outcome === 'open').length), daysMet: sum(all, r => r.daysMet), daysElapsed: sum(all, r => r.daysElapsed),
      checkins: all.filter(r => r.checkin).length, checkinsDue: all.filter(r => r.checkinDue).length,
      nudges: ctx.db.prepare('SELECT COUNT(*) n FROM accountability_nudges n JOIN users u ON u.id=n.client_id AND u.coach_id=? WHERE n.week=?').get(ctx.user.id, week).n,
      bestStreak: all.reduce((b, r) => Math.max(b, r.streak), 0),
    },
  };
}

function checkText(ctx) {
  return str(ctx.body.text, 'text', { max: 4000 });
}

/** POST /api/accountability/preview {clientIds, text}: each person's message, rendered (no side effects). */
function preview(_req, ctx) {
  requireCoach(ctx);
  const clients = ownClients(ctx, ctx.body.clientIds);
  const text = checkText(ctx);
  const { now } = nowAndToday(ctx);
  return {
    previews: clients.slice(0, 100).map(c => {
      const r = render(ctx.db, ctx.user.id, c, text, { now });
      return { clientId: c.id, name: c.name, text: r.text, missing: r.missing, empty: r.empty };
    }),
  };
}

/**
 * Send a nudge or celebration to one client (via 'nudge', so the outreach
 * governor applies) and log it. Returns {sent|deferred|skipped, reason}.
 */
function nudgeOne(db, config, { coachId, client, text, kind, now }) {
  const body = text.trim();
  if (!body) return { skipped: true, reason: 'empty message' };
  const out = sendMessage(db, config, { coachId, clientId: client.id, text: body, via: 'nudge', now });
  if (out.skipped) return { skipped: true, reason: out.skipped };
  const week = mondayOf(londonDay(now));
  db.prepare('INSERT INTO accountability_nudges (id, coach_id, client_id, week, kind, message_id, at) VALUES (?,?,?,?,?,?,?)')
    .run(newId('an'), coachId, client.id, week, kind, out.message?.id ?? null, now.toISOString());
  emit(db, 'accountability.nudged', {
    coachId, clientId: client.id, summary: kind === 'celebrate' ? 'Celebrated' : 'Nudged', kind, messageId: out.message?.id ?? null, deferred: !!out.deferredUntil,
  });
  return out.message ? { sent: true } : { deferred: true, until: out.deferredUntil };
}

/** POST /api/accountability/nudge {clientIds, text (a template), kind}: one message each, names rendered. */
function nudge(_req, ctx) {
  requireCoach(ctx);
  const clients = ownClients(ctx, ctx.body.clientIds);
  const text = checkText(ctx);
  const kind = ctx.body.kind === undefined ? 'nudge' : oneOf(ctx.body.kind, 'kind', ['nudge', 'celebrate']);
  const { now } = nowAndToday(ctx);
  const rendered = clients.map(c => ({ c, r: render(ctx.db, ctx.user.id, c, text, { now }) }));
  const missing = [...new Set(rendered.flatMap(x => x.r.missing))];
  if (missing.length) fail(400, `Unknown variable {${missing[0]}}`);
  const result = { sent: 0, deferred: 0, skipped: [] };
  tx(ctx.db, () => {
    for (const { c, r } of rendered) {
      const out = nudgeOne(ctx.db, ctx.config, { coachId: ctx.user.id, client: c, text: r.text, kind, now });
      if (out.sent) result.sent++;
      else if (out.deferred) result.deferred++;
      else result.skipped.push({ clientId: c.id, reason: out.reason });
    }
  });
  return result;
}

/** GET /api/coach/clients/:id/accountability?weeks=12 : snapshots and the live week, oldest first. */
function clientHistory(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.params.id);
  const n = ctx.query.weeks === undefined ? 12 : num(Number(ctx.query.weeks), 'weeks', { min: 1, max: 52, int: true });
  const { now, today } = nowAndToday(ctx);
  const current = mondayOf(today);
  const joined = mondayOf(londonDay(new Date(client.created_at)));
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) {
    const w = addDays(current, -7 * i);
    if (w < joined) continue;
    const snap = i > 0 ? snapshot(ctx.db, ctx.user.id, client.id, w) : null;
    if (snap) weeks.push({ ...snap, live: false });
    else {
      const p = weekParts(ctx.db, client, w, { today, now });
      weeks.push({ week: w, score: p.score, parts: p.parts, live: true });
    }
  }
  const p = weekParts(ctx.db, client, current, { today, now });
  return {
    weeks, streak: streakOf(ctx.db, client, today), current: { ...p, week: current },
    nudges: ctx.db.prepare('SELECT kind, week, at FROM accountability_nudges WHERE client_id=? ORDER BY at DESC LIMIT 10').all(client.id),
    milestones: ctx.db.prepare('SELECT milestone streak, reached_on reachedOn FROM accountability_milestones WHERE client_id=? ORDER BY reached_on DESC LIMIT 10').all(client.id),
  };
}

// MARK: - Clocks and handlers

/** The London Monday of the last closed week: Monday 05:00 closes the week before. */
export function closedWeek(now) {
  const today = londonDay(now), monday = mondayOf(today);
  return today === monday && londonClock(now) < '05:00' ? addDays(monday, -14) : addDays(monday, -7);
}

/** Snapshot every client's last closed week, once (INSERT OR IGNORE on (client, week)). Returns how many it wrote. */
export function closeWeeks(db, now = new Date()) {
  const week = closedWeek(now);
  const end = londonToUtc(addDays(week, 7)).toISOString();
  const rows = db.prepare(`SELECT u.* FROM users u WHERE u.role='client' AND u.coach_id IS NOT NULL AND u.created_at<?
    AND NOT EXISTS (SELECT 1 FROM accountability_weeks w WHERE w.client_id=u.id AND w.week=?) LIMIT 2000`).all(end, week);
  let n = 0;
  for (const c of rows) {
    const p = weekParts(db, c, week, { today: londonDay(now), now });
    n += db.prepare('INSERT OR IGNORE INTO accountability_weeks (client_id, coach_id, week, score, parts) VALUES (?,?,?,?,?)')
      .run(c.id, c.coach_id, week, p.score, JSON.stringify({ ...p.parts, flags: p.flags })).changes;
  }
  return n;
}

/**
 * Streak milestones for one coach on `today`: each milestone the streak has
 * crossed since it was last seen fires once (a row, an event, a notification).
 * The first sighting of a client only records the streak.
 */
export function checkMilestones(db, config, coachId, today, now = new Date()) {
  const fired = [];
  for (const c of clientsOf(db, coachId)) {
    const streak = streakOf(db, c, today);
    const prev = db.prepare('SELECT streak FROM accountability_streaks WHERE client_id=?').get(c.id);
    db.prepare(`INSERT INTO accountability_streaks (client_id, coach_id, streak, day) VALUES (?,?,?,?)
      ON CONFLICT(client_id) DO UPDATE SET coach_id=excluded.coach_id, streak=excluded.streak, day=excluded.day`).run(c.id, coachId, streak, today);
    if (!prev) continue;
    for (const m of MILESTONES) {
      if (!(prev.streak < m && streak >= m)) continue;
      const reached = addDays(streakEnd(db, c, today), -(streak - m));
      if (!db.prepare('INSERT OR IGNORE INTO accountability_milestones (client_id, coach_id, milestone, reached_on, at) VALUES (?,?,?,?,?)')
        .run(c.id, coachId, m, reached, now.toISOString()).changes) continue;
      emit(db, 'accountability.milestone', { coachId, clientId: c.id, summary: `${m}-day streak`, streak: m });
      notifyCoach(db, config, coachId, {
        clientId: c.id, kind: 'streak', title: `${c.name.split(' ')[0]} hit a ${m}-day streak`, body: 'Their day minimum, every day. Send congrats?',
        path: `/accountability?celebrate=${c.id}`, icon: 'local_fire_department', tone: 'ok', dedupe: `streak:${c.id}:${m}:${reached}`, now,
      });
      fired.push({ clientId: c.id, streak: m });
    }
  }
  return fired;
}

/** A commitment reviewed after its week closed: rewrite that week's snapshot. */
function onReviewed(db, _config, event) {
  const cm = db.prepare('SELECT client_id, week FROM commitments WHERE id=?').get(event.payload?.commitmentId ?? '');
  if (!cm) return;
  const snap = db.prepare('SELECT 1 FROM accountability_weeks WHERE client_id=? AND week=?').get(cm.client_id, cm.week);
  if (!snap) return;
  const client = db.prepare('SELECT * FROM users WHERE id=?').get(cm.client_id);
  if (!client) return;
  const now = new Date(event.at);
  const p = weekParts(db, client, cm.week, { today: londonDay(now), now });
  db.prepare('UPDATE accountability_weeks SET score=?, parts=? WHERE client_id=? AND week=?').run(p.score, JSON.stringify({ ...p.parts, flags: p.flags }), cm.client_id, cm.week);
}

// MARK: - Demo

const PROMISES = {
  Sam: ['Three sessions', 'Lights out by eleven', 'Protein at breakfast', 'Mobility before lower days', 'A walk after lunch'],
  Priya: ['Two easy runs and one tempo', 'Sleep eight hours on four nights', 'Fuel the long run properly', 'Stretch after every run', 'One rest day, no guilt'],
  Alex: ['Four sessions', 'Log every set', 'Hit 160 g protein daily', 'In bed by midnight on work nights', 'Ten minutes of mobility'],
  Leo: ['Two mobility sessions', 'Stand up every hour at the desk', 'Walk to the station', 'Back routine before bed', 'Ten thousand steps on three days'],
  Rory: ['Three runs, one easy', 'Calf raises after every run', 'Foam roll on rest days', 'No intervals two days running', 'Breakfast before the morning run'],
  Tom: ['Two circuits', 'Track dinner four nights', 'No takeaway midweek', 'Water bottle on the desk', 'Walk at lunch'],
};

function demoBuild(db, ctx) {
  schema(db);
  const { coach, clients, byName, today, rng } = ctx;
  const ids = JSON.stringify(clients.map(c => c.id));
  for (const t of ['accountability_nudges', 'accountability_weeks', 'accountability_milestones', 'accountability_streaks']) {
    db.prepare(`DELETE FROM ${t} WHERE client_id IN (SELECT value FROM json_each(?))`).run(ids);
  }
  const monday = mondayOf(today);
  const at = (d, t = '09:00') => londonToUtc(d, t).toISOString();
  const now = londonToUtc(today, '12:00');
  const insertCommitment = db.prepare(`INSERT INTO commitments (id, client_id, week, position, text, outcome, created_by, created_at, accepted_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);

  // Commitments over eight weeks, where the person has none yet (buildPar seeds Sam's latest two weeks).
  const keepRate = { Sam: 0.8, Priya: 0.9, Alex: 0.7, Leo: 0.45, Rory: 0.75, Tom: 0.35 };
  for (const c of clients) {
    const first = c.name.split(' ')[0];
    const pool = PROMISES[first];
    if (!pool) continue;
    const joined = londonDay(new Date(c.created_at));
    for (let k = 0; k < 8; k++) {
      const w = addDays(monday, -7 * k);
      if (addDays(w, 6) < joined) continue;
      if (db.prepare('SELECT 1 FROM commitments WHERE client_id=? AND week=?').get(c.id, w)) continue;
      // Tom has set nothing this week; everyone else agreed two or three in their weekend session.
      if (k === 0 && first === 'Tom') continue;
      const n = rng.chance(0.6) ? 3 : 2;
      const start = rng.int(0, pool.length - 1);
      for (let i = 0; i < n; i++) {
        const roll = rng();
        const rate = keepRate[first] ?? 0.7;
        // This week: mostly still open; the odd one already ticked off.
        const outcome = k === 0 ? (i === 0 && rng.chance(0.5) ? 'kept' : null) : roll < rate ? 'kept' : roll < rate + (1 - rate) / 2 ? 'mostly' : 'missed';
        const made = at(addDays(w, -1), '19:00');
        insertCommitment.run(newId('cm'), c.id, w, i, pool[(start + i) % pool.length], outcome, coach.id, made, at(addDays(w, -1), '20:00'), made);
      }
    }
  }

  // Priya: thirty days straight of her day minimum, ending today (the week's milestone on any weekday).
  const priya = byName.Priya;
  if (priya) {
    const habits = db.prepare('SELECT id, kind, target FROM habits WHERE client_id=?').all(priya.id);
    const tick = db.prepare('INSERT INTO habit_days (habit_id, date, value, done) VALUES (?,?,?,1) ON CONFLICT(habit_id, date) DO UPDATE SET value=excluded.value, done=1');
    for (let i = 0; i < 30; i++) for (const h of habits) tick.run(h.id, addDays(today, -i), h.kind === 'count' ? h.target : 1);
    for (const h of habits) db.prepare('DELETE FROM habit_days WHERE habit_id=? AND date=?').run(h.id, addDays(today, -30));
    db.prepare('DELETE FROM rest_days WHERE client_id=? AND date>=?').run(priya.id, addDays(today, -31));
    // Health-backed habits (steps, sleep) read Apple Health: no samples that day, so the break holds.
    db.prepare('DELETE FROM health_samples WHERE user_id=? AND date=?').run(priya.id, addDays(today, -30));
  }

  // Closed weeks: snapshots for the past seven.
  const fresh = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);
  for (const c0 of clients) {
    const c = fresh(c0.id);
    for (let k = 1; k <= 7; k++) {
      const w = addDays(monday, -7 * k);
      if (londonToUtc(addDays(w, 7)).toISOString() <= c.created_at) continue;
      const p = weekParts(db, c, w, { today, now });
      db.prepare('INSERT OR IGNORE INTO accountability_weeks (client_id, coach_id, week, score, parts) VALUES (?,?,?,?,?)')
        .run(c.id, coach.id, w, p.score, JSON.stringify({ ...p.parts, flags: p.flags }));
    }
    // Streaks as of today, and the milestones they crossed (so the next day.started fires only new ones).
    const streak = streakOf(db, c, today);
    db.prepare('INSERT OR REPLACE INTO accountability_streaks (client_id, coach_id, streak, day) VALUES (?,?,?,?)').run(c.id, coach.id, streak, today);
    const end = streakEnd(db, c, today);
    for (const m of MILESTONES) {
      if (streak < m) continue;
      const reached = addDays(end, -(streak - m));
      db.prepare('INSERT OR IGNORE INTO accountability_milestones (client_id, coach_id, milestone, reached_on, at) VALUES (?,?,?,?,?)')
        .run(c.id, coach.id, m, reached, at(reached, '05:00'));
    }
  }

  // A few nudges, with the messages they sent.
  const nudge = (c, daysAgo, kind, text) => {
    if (!c) return;
    const d = addDays(today, -daysAgo);
    if (d < londonDay(new Date(c.created_at))) return;
    const mid = newId('m');
    db.prepare("INSERT INTO messages (id, client_id, from_id, from_role, text, at, read_at, kind, via) VALUES (?,?,?,'coach',?,?,?,'text','nudge')")
      .run(mid, c.id, coach.id, text, at(d, '18:10'), at(d, '19:02'));
    db.prepare('INSERT INTO accountability_nudges (id, coach_id, client_id, week, kind, message_id, at) VALUES (?,?,?,?,?,?,?)')
      .run(newId('an'), coach.id, c.id, mondayOf(d), kind, mid, at(d, '18:10'));
  };
  nudge(byName.Leo, 2, 'nudge', 'Hey Leo, two mobility sessions this week. Ten minutes tonight still counts. You\'ve got this.');
  nudge(byName.Tom, 5, 'nudge', 'Morning Tom! Let\'s set this week\'s two commitments together. What feels doable?');
  nudge(byName.Alex, 8, 'celebrate', 'Four from four last week, Alex. That\'s the standard now.');
  nudge(byName.Sam, 13, 'celebrate', 'Fourteen days straight on your minimum, Sam. Quietly brilliant.');
}

// MARK: - The feature

function schema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS accountability_nudges (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('nudge','celebrate')),
      message_id TEXT, at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS accountability_nudges_client ON accountability_nudges(client_id, at);
    CREATE TABLE IF NOT EXISTS accountability_weeks (
      client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week TEXT NOT NULL, score INTEGER NOT NULL, parts TEXT NOT NULL, PRIMARY KEY (client_id, week));
    CREATE TABLE IF NOT EXISTS accountability_milestones (
      client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      milestone INTEGER NOT NULL, reached_on TEXT NOT NULL, at TEXT NOT NULL,
      PRIMARY KEY (client_id, milestone, reached_on));
    CREATE TABLE IF NOT EXISTS accountability_streaks (
      client_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      streak INTEGER NOT NULL, day TEXT NOT NULL);`);
}

function clientRows(db, coachId, clientIds) {
  if (!clientIds.length) return [];
  return db.prepare("SELECT * FROM users WHERE role='client' AND coach_id=? AND id IN (SELECT value FROM json_each(?))").all(coachId, JSON.stringify(clientIds));
}

export const feature = {
  name: 'accountability',
  namespaces: ['accountability'],
  schema,
  routes(r) {
    r.add('GET', '/api/accountability', board);
    r.add('POST', '/api/accountability/preview', preview);
    r.add('POST', '/api/accountability/nudge', nudge);
    r.add('GET', '/api/coach/clients/:id/accountability', clientHistory);
  },
  clocks: [{ id: 'accountability.weekClose', everyMs: 15 * 60_000, run: (db, _config, now) => closeWeeks(db, now) }],
  on: {
    'commitment.reviewed': onReviewed,
    'day.started': (db, config, event) => { if (event.coachId) checkMilestones(db, config, event.coachId, event.payload?.day ?? londonDay(new Date(event.at)), new Date(event.at)); },
  },
  emits: {
    'accountability.nudged': { label: 'A client was nudged or celebrated', payload: ['kind', 'messageId', 'deferred'] },
    'accountability.milestone': { label: 'A client reached a streak milestone', payload: ['streak'] },
  },
  actions: {
    'accountability.nudge': {
      label: 'Send an accountability nudge', clientFacing: true,
      params: [{ key: 'text', label: 'Message', type: 'template', required: true }],
      run(db, config, ctx) {
        const { text, missing } = render(db, ctx.coachId, ctx.client, ctx.params.text, { extra: ctx.extra, now: ctx.now });
        if (missing.length) return `Skipped: unknown {${missing[0]}}`;
        const out = nudgeOne(db, config, { coachId: ctx.coachId, client: ctx.client, text, kind: 'nudge', now: ctx.now });
        return out.sent ? 'Sent' : out.deferred ? 'Deferred' : `Skipped: ${out.reason}`;
      },
    },
  },
  facts: {
    'accountability.score': {
      label: 'Accountability score (this week)', type: 'number',
      compute(db, coachId, clientIds, today) {
        const out = new Map();
        for (const c of clientRows(db, coachId, clientIds)) out.set(c.id, weekParts(db, c, mondayOf(today), { today }).score);
        return out;
      },
    },
    'accountability.streak': {
      label: 'Day-minimum streak', type: 'days',
      compute(db, coachId, clientIds, today) {
        const out = new Map();
        for (const c of clientRows(db, coachId, clientIds)) out.set(c.id, streakOf(db, c, today));
        return out;
      },
    },
  },
  needs(db, coach, clients, today) {
    const ids = clients.map(c => c.id);
    if (!ids.length) return [];
    return db.prepare(`SELECT m.* FROM accountability_milestones m JOIN users u ON u.id=m.client_id AND u.coach_id=?
      WHERE m.client_id IN (SELECT value FROM json_each(?)) AND m.reached_on>=? AND m.reached_on<=?
      AND NOT EXISTS (SELECT 1 FROM accountability_nudges n WHERE n.client_id=m.client_id AND n.kind='celebrate' AND n.at>=m.at)
      ORDER BY m.milestone DESC`).all(coach.id, JSON.stringify(ids), addDays(today, -6), today)
      .filter((m, i, all) => all.findIndex(x => x.client_id === m.client_id) === i)
      .map(m => ({
        clientId: m.client_id, kind: 'streak', text: `${m.milestone}-day streak`, at: m.at, rank: 8, iconKey: 'local_fire_department',
        action: { label: 'Celebrate', path: `/accountability?celebrate=${m.client_id}` },
      }));
  },
  timeline(db, coach, client, before, limit) {
    if (client.coach_id !== coach.id) return [];
    const cut = before || '9999';
    const items = db.prepare('SELECT * FROM accountability_nudges WHERE client_id=? AND at<? ORDER BY at DESC LIMIT ?').all(client.id, cut, limit)
      .map(n => ({ at: n.at, kind: 'accountability', icon: n.kind === 'celebrate' ? 'celebration' : 'front_hand', tone: n.kind === 'celebrate' ? 'ok' : null,
        title: n.kind === 'celebrate' ? 'Celebrated' : 'Accountability nudge', detail: '', path: '/accountability' }));
    for (const m of db.prepare('SELECT * FROM accountability_milestones WHERE client_id=? AND at<? ORDER BY at DESC LIMIT ?').all(client.id, cut, limit)) {
      items.push({ at: m.at, kind: 'accountability', icon: 'local_fire_department', tone: 'ok', title: `${plural(m.milestone, 'day')} streak`, detail: 'Day minimum met every day', path: '/accountability' });
    }
    return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
  },
  exportFor(db, user) {
    if (user.role !== 'client') return {};
    return {
      weeks: db.prepare('SELECT week, score, parts FROM accountability_weeks WHERE client_id=? ORDER BY week').all(user.id).map(w => ({ week: w.week, score: w.score, parts: JSON.parse(w.parts) })),
      nudges: db.prepare('SELECT week, kind, at FROM accountability_nudges WHERE client_id=? ORDER BY at').all(user.id),
      milestones: db.prepare('SELECT milestone, reached_on reachedOn FROM accountability_milestones WHERE client_id=? ORDER BY reached_on').all(user.id),
    };
  },
  demo: { build: demoBuild },
};
