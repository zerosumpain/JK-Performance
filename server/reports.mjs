import { clientFor, requireCoach } from './access.mjs';
import { checkinDraft, checkinOut, dayStates } from './daily.mjs';
import { activeGoalRow, goalOut } from './goals.mjs';
import { activitiesBetween, healthDay, healthVisible } from './health.mjs';
import { day, fail, instant, num, oneOf, str } from './http.mjs';
import { attachableMedia } from './media.mjs';
import { milestoneSuggestions } from './milestones.mjs';
import { notify } from './push.mjs';
import { rhythmOf } from './settings.mjs';
import { firstSentence, newId, nowIso, tx } from './store.mjs';
import { addDays, londonClock, londonDay, londonToUtc, mondayOf, weekday } from './time.mjs';
import { workoutOut } from './training.mjs';

/** The week a coach would be writing up: last week until Friday, then this one. */
export const feedbackWeek = (today = londonDay()) => (today >= addDays(mondayOf(today), 4) ? mondayOf(today) : addDays(mondayOf(today), -7));

/**
 * Letters (formerly weekly feedback): the coach's letter on one client's week
 * (Monday to Sunday), with that week's numbers and the next week's plan beside
 * it. A letter has a headline, one thing to keep, one to adjust (which becomes
 * the line on the client's Today), one question the client can answer inline,
 * and optionally a voice or video note. Kinds: weekly, or milestone (suggested
 * by the server, written by JK). A draft is the coach's alone. Publishing
 * schedules delivery (default Monday 07:00 London; "now" is allowed); the
 * client sees a letter only once its deliverAt has passed, when a note goes
 * into their thread and a push goes out. The old summary/wins/focus fields stay
 * as aliases of headline/keep/adjust. Written from the apps or the desk.
 */

/** The figures for a week, as the viewer may see them (Apple Health only with consent). */
export function weekStats(db, viewer, client, week) {
  const end = addDays(week, 6);
  const today = londonDay();
  const w = db.prepare('SELECT COUNT(*) planned, SUM(completed_at IS NOT NULL) done FROM workouts WHERE client_id=? AND published=1 AND date>=? AND date<=?')
    .get(client.id, week, end);
  const sets = db.prepare('SELECT COUNT(*) n FROM set_logs s JOIN workout_items i ON i.id=s.item_id JOIN workouts wo ON wo.id=i.workout_id WHERE wo.client_id=? AND wo.date>=? AND wo.date<=?')
    .get(client.id, week, end).n;
  // Habit days ticked by hand or reached, over the days of the week so far.
  const habits = db.prepare('SELECT id FROM habits WHERE client_id=?').all(client.id);
  const lastDay = end < today ? end : today;
  let habitDays = 0, habitDone = 0;
  if (habits.length && lastDay >= week) {
    const days = Math.round((Date.parse(lastDay) - Date.parse(week)) / 86_400_000) + 1;
    habitDays = days * habits.length;
    habitDone = db.prepare(`SELECT COUNT(*) n FROM habit_days WHERE done=1 AND date>=? AND date<=? AND habit_id IN (${habits.map(() => '?').join(',')})`)
      .get(week, lastDay, ...habits.map(h => h.id)).n;
  }
  const c = db.prepare('SELECT energy, sleep, pain, note, submitted_at FROM checkins WHERE client_id=? AND week=?').get(client.id, week);
  const weights = db.prepare("SELECT value FROM measurements WHERE user_id=? AND kind='weight' AND date>=? AND date<=? ORDER BY date").all(client.id, week, end);
  const out = {
    workoutsPlanned: w.planned, workoutsDone: w.done ?? 0, setsLogged: sets,
    habitsPct: habitDays ? Math.round((100 * habitDone) / habitDays) : null,
    checkin: c ? { energy: c.energy, sleep: c.sleep, pain: JSON.parse(c.pain), note: c.note, submittedAt: c.submitted_at } : null,
    weightStart: weights[0]?.value ?? null, weightEnd: weights.at(-1)?.value ?? null,
    healthShared: healthVisible(viewer, client),
    avgSteps: null, avgSleepMinutes: null, activities: null,
  };
  if (out.healthShared) {
    const days = [];
    for (let i = 0; i < 7; i++) days.push(healthDay(db, client.id, addDays(week, i)));
    const avg = key => {
      const v = days.map(d => d[key]).filter(x => x !== null);
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
    };
    out.avgSteps = avg('steps');
    out.avgSleepMinutes = avg('sleepMinutes');
    const acts = activitiesBetween(db, client.id, week, end);
    out.activities = { count: acts.length, minutes: acts.reduce((a, x) => a + x.minutes, 0), types: [...new Set(acts.map(a => a.type))].slice(0, 6) };
  }
  return out;
}

/** The plan for the week after `week`: published workouts, plus drafts for the coach. */
function nextPlan(db, viewer, clientId, week) {
  const from = addDays(week, 7), to = addDays(week, 13);
  const rows = db.prepare(`SELECT * FROM workouts WHERE client_id=? AND date>=? AND date<=? ${viewer.role === 'client' ? 'AND published=1' : ''} ORDER BY date, starts_at`)
    .all(clientId, from, to);
  return { from, to, workouts: rows.map(r => workoutOut(db, r, { withItems: false })) };
}

const MEDIA_KINDS = ['audio', 'video'];
const visibleSql = "published_at IS NOT NULL AND (deliver_at IS NULL OR deliver_at <= ?)";

/** Monday 07:00 Europe/London: the next one after `now` (today's, if it is Monday before seven). */
export function nextDelivery(now = new Date()) {
  const today = londonDay(now);
  const monday = weekday(today) === 1 && londonClock(now) < '07:00' ? today : addDays(mondayOf(today), 7);
  return londonToUtc(monday, '07:00').toISOString();
}

/** draft | scheduled (published, waiting for deliverAt) | published (delivered). */
const statusOf = (r, now = nowIso()) => (!r.published_at ? 'draft' : r.deliver_at && r.deliver_at > now ? 'scheduled' : 'published');

/** The client's Today line from a letter: JK's override if he set one, else Adjust. */
export const letterLine = r => r.focus_override || r.adjust || r.focus || r.headline || firstSentence(r.summary) || null;

/** Week dots for the letter and a ScoreTrio: three numbers, each with what it is made from. */
function letterFigures(db, viewer, client, week, stats) {
  const states = dayStates(db, client, week, addDays(week, 6), { useHealth: healthVisible(viewer, client) });
  const counted = states.filter(s => !s.future && !s.rest && s.total > 0);
  const trio = [
    { key: 'sessions', label: 'Sessions', value: `${stats.workoutsDone} of ${stats.workoutsPlanned}`, source: 'Workouts JK planned for the week, and the ones you completed' },
    { key: 'days', label: 'Days done', value: `${counted.filter(s => s.done).length} of ${counted.length}`, source: 'Days you met JK\'s habit minimum; rest days not counted' },
    stats.avgSteps !== null
      ? { key: 'steps', label: 'Steps', value: stats.avgSteps.toLocaleString('en-GB'), source: 'Daily average from Apple Health or Health Connect' }
      : { key: 'sets', label: 'Sets', value: String(stats.setsLogged), source: 'Sets you logged in the week' },
  ];
  return { weekDots: states.map(s => ({ date: s.date, done: s.done, rest: s.rest, future: s.future })), scoreTrio: trio };
}

export function reportOut(db, viewer, r, client, { full = false } = {}) {
  const coach = r.coach_id ? db.prepare('SELECT name FROM users WHERE id=?').get(r.coach_id) : null;
  const base = {
    id: r.id, clientId: r.client_id, week: r.week, weekEnd: addDays(r.week, 6),
    summary: r.summary, wins: r.wins, focus: r.focus,
    status: r.published_at ? 'published' : 'draft', publishedAt: r.published_at, readAt: r.read_at, updatedAt: r.updated_at,
    coachName: coach?.name ?? null,
    // The letter
    kind: r.kind ?? 'weekly', letterStatus: statusOf(r),
    headline: r.headline ?? (firstSentence(r.summary) || null), keep: r.keep ?? (r.wins || null), adjust: r.adjust ?? (r.focus || null),
    question: r.question ?? null, answer: r.answer ?? null, answeredAt: r.answered_at ?? null,
    mediaId: r.media_id ?? null, mediaKind: r.media_kind ?? null, mediaUrl: r.media_id ? `/api/media/${r.media_id}` : null, durationSec: r.duration_sec ?? null,
    goalId: r.goal_id ?? null, deliverAt: r.deliver_at ?? r.published_at ?? null, deliveredAt: r.delivered_at ?? null,
    focusOverride: r.focus_override ?? null, todayLine: letterLine(r), milestoneKey: r.milestone_key ?? null,
  };
  if (!full) return base;
  const stats = weekStats(db, viewer, client, r.week);
  const out = { ...base, stats, plan: nextPlan(db, viewer, client.id, r.week), ...letterFigures(db, viewer, client, r.week, stats) };
  if (viewer.role === 'coach') {
    // The composer's pinned context: check-in answers, session ratings, habit week, goal and milestone suggestions.
    const c = db.prepare('SELECT * FROM checkins WHERE client_id=? AND week=?').get(client.id, r.week);
    out.context = {
      checkin: c ? checkinOut(c) : null, week: checkinDraft(db, viewer, client, r.week),
      goal: goalOut(db, activeGoalRow(db, client.id)), rhythm: rhythmOf(db, client),
      milestones: milestoneSuggestions(db, client), suggestedDeliverAt: nextDelivery(),
    };
  }
  return out;
}

const mondayParam = (v, name) => {
  const d = day(v, name);
  if (mondayOf(d) !== d) fail(400, `${name} must be a Monday`);
  return d;
};

/** The report row a caller may see: a client only their own delivered ones. */
function visibleReport(ctx, id) {
  const r = ctx.db.prepare('SELECT * FROM reports WHERE id=?').get(id);
  if (!r) fail(404, 'Not found');
  const client = clientFor(ctx, r.client_id);
  if (ctx.user.role === 'client' && statusOf(r) !== 'published') fail(404, 'Not found');
  return { r, client };
}

/**
 * Hand over every letter whose time has come: a note in the client's thread
 * (kind "letter", so the timeline shows the letter, not the note) and a push.
 * Runs on a clock and before a client's reads, so delivery never waits on it.
 */
export function deliverDue(db, config, { clientId = null } = {}) {
  const now = nowIso();
  const rows = db.prepare(`SELECT * FROM reports WHERE published_at IS NOT NULL AND delivered_at IS NULL AND (deliver_at IS NULL OR deliver_at <= ?) ${clientId ? 'AND client_id=?' : ''}`)
    .all(...(clientId ? [now, clientId] : [now]));
  for (const r of rows) {
    const coach = r.coach_id ? db.prepare('SELECT name FROM users WHERE id=?').get(r.coach_id) : null;
    const headline = r.headline || firstSentence(r.summary);
    const claimed = db.prepare('UPDATE reports SET delivered_at=? WHERE id=? AND delivered_at IS NULL').run(now, r.id).changes;
    if (!claimed) continue;
    const text = r.kind === 'milestone' ? `A letter from ${coach?.name ?? 'your coach'}: ${headline}` : `Your letter for the week of ${weekLabel(r.week)} is here: ${headline}`;
    db.prepare("INSERT INTO messages (id, client_id, from_id, from_role, text, at, kind, report_id) VALUES (?,?,?,'coach',?,?,'letter',?)")
      .run(newId('m'), r.client_id, r.coach_id, text, r.deliver_at && r.deliver_at < now ? r.deliver_at : now, r.id);
    notify(db, config, r.client_id, { title: `A letter from ${coach?.name ?? 'your coach'}`, body: headline, kind: 'report', id: r.id, clientId: r.client_id });
  }
  return rows.length;
}

export function startLetterClock(db, config, everyMs = 60_000) {
  return setInterval(() => {
    try { deliverDue(db, config); } catch (e) { console.warn(`Letter delivery failed: ${e.message}`); }
  }, everyMs);
}

function list(_req, ctx) {
  const client = clientFor(ctx, ctx.query.clientId);
  if (ctx.user.role === 'client') deliverDue(ctx.db, ctx.config, { clientId: client.id });
  const drafts = ctx.user.role === 'coach';
  const kind = ctx.query.kind ? oneOf(ctx.query.kind, 'kind', ['weekly', 'milestone']) : null;
  const rows = ctx.db.prepare(`SELECT * FROM reports WHERE client_id=? ${drafts ? '' : `AND ${visibleSql}`} ${kind ? 'AND kind=?' : ''} ORDER BY week DESC, created_at DESC LIMIT 52`)
    .all(client.id, ...(drafts ? [] : [nowIso()]), ...(kind ? [kind] : []));
  return {
    reports: rows.map(r => reportOut(ctx.db, ctx.user, r, client)),
    unread: rows.filter(r => statusOf(r) === 'published' && !r.read_at).length,
    // The week a coach would naturally be writing up: last week until Friday, then this one.
    suggestedWeek: feedbackWeek(),
  };
}

function get(_req, ctx) {
  if (ctx.user.role === 'client') deliverDue(ctx.db, ctx.config, { clientId: ctx.user.id });
  const { r, client } = visibleReport(ctx, ctx.params.id);
  if (ctx.user.role === 'client' && !r.read_at) {
    ctx.db.prepare('UPDATE reports SET read_at=? WHERE id=?').run(nowIso(), r.id);
    r.read_at = nowIso();
  }
  return reportOut(ctx.db, ctx.user, r, client, { full: true });
}

function markRead(_req, ctx) {
  if (ctx.user.role !== 'client') fail(403, 'Clients only');
  const { r } = visibleReport(ctx, ctx.params.id);
  const at = r.read_at ?? nowIso();
  ctx.db.prepare('UPDATE reports SET read_at=? WHERE id=?').run(at, r.id);
  return { ok: true, readAt: at };
}

/** The client answers the letter's question inline; the answer also goes into the thread, quoting the letter. */
function answer(_req, ctx) {
  if (ctx.user.role !== 'client') fail(403, 'Clients only');
  const { r, client } = visibleReport(ctx, ctx.params.id);
  const text = str(ctx.body.answer, 'answer', { max: 2000 });
  const now = nowIso();
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE reports SET answer=?, answered_at=?, read_at=COALESCE(read_at, ?) WHERE id=?').run(text, now, now, r.id);
    ctx.db.prepare("INSERT INTO messages (id, client_id, from_id, from_role, text, at, kind, report_id) VALUES (?,?,?,'client',?,?,'answer',?)")
      .run(newId('m'), client.id, ctx.user.id, text, now, r.id);
  });
  notify(ctx.db, ctx.config, client.coach_id, { title: ctx.user.name, body: `Answered: ${r.question ?? 'your letter'}`, kind: 'message', clientId: client.id });
  return reportOut(ctx.db, ctx.user, ctx.db.prepare('SELECT * FROM reports WHERE id=?').get(r.id), client, { full: true });
}

/** The coach's editor for a week: the saved weekly letter, or an empty one, with the figures, plan and context. */
function forWeek(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.query.clientId);
  const week = mondayParam(ctx.params.week, 'week');
  const r = ctx.db.prepare("SELECT * FROM reports WHERE client_id=? AND week=? AND kind='weekly'").get(client.id, week)
    ?? { id: null, client_id: client.id, coach_id: ctx.user.id, week, summary: '', wins: '', focus: '', published_at: null, read_at: null, updated_at: null, kind: 'weekly' };
  return reportOut(ctx.db, ctx.user, r, client, { full: true });
}

const NEW_FIELDS = ['headline', 'keep', 'adjust', 'question', 'mediaId', 'goalId', 'focusOverride', 'kind', 'deliverAt', 'milestoneKey', 'id'];

/**
 * Write or publish a letter. Weekly letters are one per client and week; a
 * milestone letter is new each time unless `id` names it. Old app builds send
 * only summary/wins/focus and publish at once (as before); a body with any of
 * the letter fields schedules for Monday 07:00 unless deliverAt is "now" or an
 * instant. Publishing marks that week's check-in replied.
 */
function save(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const client = clientFor(ctx, b.clientId);
  const legacy = !NEW_FIELDS.some(k => b[k] !== undefined);
  const kind = oneOf(b.kind ?? 'weekly', 'kind', ['weekly', 'milestone']);
  const status = oneOf(b.status ?? 'draft', 'status', ['draft', 'published']);
  const text = (v, name, max = 4000) => str(v ?? '', name, { max, min: 0 });
  const line = (v, name) => (v === undefined || v === null ? null : str(v, name, { max: 300, min: 0 }) || null);
  let prior = null;
  if (b.id !== undefined) {
    prior = ctx.db.prepare('SELECT * FROM reports WHERE id=? AND client_id=?').get(str(b.id, 'id', { max: 40 }), client.id);
    if (!prior) fail(404, 'Not found');
  }
  const week = b.week !== undefined ? mondayParam(b.week, 'week') : prior?.week ?? (kind === 'milestone' ? mondayOf(londonDay()) : mondayParam(b.week, 'week'));
  if (!prior && kind === 'weekly') prior = ctx.db.prepare("SELECT * FROM reports WHERE client_id=? AND week=? AND kind='weekly'").get(client.id, week) ?? null;

  let headline = line(b.headline, 'headline'), keep = line(b.keep, 'keep'), adjust = line(b.adjust, 'adjust');
  let summary = b.summary === undefined ? null : text(b.summary, 'summary');
  let wins = b.wins === undefined ? null : text(b.wins, 'wins');
  let focus = b.focus === undefined ? null : text(b.focus, 'focus');
  if (legacy) {
    summary ??= ''; wins ??= ''; focus ??= '';
    headline = firstSentence(summary) || null; keep = wins || null; adjust = focus || null;
  } else {
    summary ??= headline ?? ''; wins ??= keep ?? ''; focus ??= adjust ?? '';
  }
  const question = line(b.question, 'question');
  const media = attachableMedia(ctx, b.mediaId, 'mediaId', client);
  if (media && !MEDIA_KINDS.includes(media.kind)) fail(400, 'mediaId must be a voice or video note');
  if (media && (media.duration_sec ?? 0) > 90) fail(400, 'Voice and video notes are 90 seconds at most');
  const goalId = b.goalId ? str(b.goalId, 'goalId', { max: 40 }) : null;
  if (goalId && !ctx.db.prepare('SELECT 1 FROM goals WHERE id=? AND client_id=?').get(goalId, client.id)) fail(400, 'goalId is not this client\'s goal');
  const focusOverride = line(b.focusOverride, 'focusOverride');
  const milestoneKey = b.milestoneKey ? str(b.milestoneKey, 'milestoneKey', { max: 80 }) : prior?.milestone_key ?? null;
  if (status === 'published' && !headline && !summary && !wins && !focus && !media) fail(400, 'Write something before publishing');

  const now = nowIso();
  let deliverAt = prior?.deliver_at ?? null;
  if (status === 'published') {
    const requested = b.deliverAt === undefined || b.deliverAt === null ? null : b.deliverAt === 'now' ? now : instant(b.deliverAt, 'deliverAt');
    if (!prior?.published_at || !prior?.delivered_at) deliverAt = requested ?? (prior?.published_at ? prior.deliver_at : legacy ? now : nextDelivery());
  } else {
    deliverAt = null;
  }
  const id = tx(ctx.db, () => {
    if (prior?.delivered_at && status === 'draft') fail(409, 'This letter has already been delivered');
    const publishedAt = status === 'published' ? prior?.published_at ?? now : null;
    const values = [summary, wins, focus, publishedAt, ctx.user.id, now, kind, headline, keep, adjust, question, media?.id ?? null, media?.kind ?? null,
      media?.duration_sec ?? null, goalId, deliverAt, focusOverride, milestoneKey];
    let rowId = prior?.id;
    if (prior) {
      ctx.db.prepare(`UPDATE reports SET summary=?, wins=?, focus=?, published_at=?, coach_id=?, updated_at=?, kind=?, headline=?, keep=?, adjust=?, question=?,
        media_id=?, media_kind=?, duration_sec=?, goal_id=?, deliver_at=?, focus_override=?, milestone_key=? WHERE id=?`).run(...values, prior.id);
    } else {
      rowId = newId('r');
      ctx.db.prepare(`INSERT INTO reports (summary, wins, focus, published_at, coach_id, updated_at, kind, headline, keep, adjust, question, media_id, media_kind,
        duration_sec, goal_id, deliver_at, focus_override, milestone_key, id, client_id, week, created_at) VALUES (${Array(22).fill('?').join(',')})`)
        .run(...values, rowId, client.id, week, now);
    }
    // Publishing marks that week's check-in replied (the reply arrives as the letter).
    if (status === 'published' && kind === 'weekly') {
      ctx.db.prepare("UPDATE checkins SET reviewed_at=COALESCE(reviewed_at, ?), reply=COALESCE(reply, ?) WHERE client_id=? AND week=?").run(now, headline ?? '', client.id, week);
    }
    return rowId;
  });
  deliverDue(ctx.db, ctx.config, { clientId: client.id });
  return reportOut(ctx.db, ctx.user, ctx.db.prepare('SELECT * FROM reports WHERE id=?').get(id), client, { full: true });
}

function remove(_req, ctx) {
  requireCoach(ctx);
  const { r } = visibleReport(ctx, ctx.params.id);
  ctx.db.prepare('DELETE FROM reports WHERE id=?').run(r.id);
  return { ok: true };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const weekLabel = week => `${Number(week.slice(8, 10))} ${MONTHS[Number(week.slice(5, 7)) - 1]}`;

export function reportRoutes(r) {
  r.add('GET', '/api/reports', list);
  r.add('PUT', '/api/reports', save);
  r.add('GET', '/api/reports/week/:week', forWeek);
  r.add('GET', '/api/reports/:id', get);
  r.add('POST', '/api/reports/:id/read', markRead);
  r.add('POST', '/api/reports/:id/answer', answer);
  r.add('DELETE', '/api/reports/:id', remove);
}
