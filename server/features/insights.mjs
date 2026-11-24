import { initials, ownRow, requireCoach, requestNow } from '../access.mjs';
import { emit } from '../events.mjs';
import { attendedSessions, clientFacts, resolveAudience, validateRules } from '../facts.mjs';
import { sendForm } from '../forms.mjs';
import { fail, num, oneOf, str } from '../http.mjs';
import { outreachOf } from '../messages.mjs';
import { notifyCoach } from '../notifications.mjs';
import { allFacts } from '../registry.mjs';
import { newId, nowIso, tx } from '../store.mjs';
import { addDays, daysBetween, londonClock, londonDay, londonToUtc, weekday } from '../time.mjs';

/**
 * F25 Engagement insights (docs/design/desk-v2.md): when clients are active
 * (a London weekday × hour heatmap), how many are active each day, the mix of
 * what they do, the most engaged and the quietest; retention cohorts by join
 * month; and pulse / NPS surveys sent through the existing forms machinery (so
 * the apps need no change), answered in form_requests.
 *
 * Activity is client-originated: a message from the client, a training session
 * logged (sets), a workout completed, a check-in, a habit day ticked and an
 * attended session. Habit ticks carry a day but no time, so they count in the
 * daily line, the mix and the rankings, but not in the hour heatmap.
 *
 * Every number is scoped to the coach's own clients with the coach's demo flag,
 * so the demo world never reaches a real coach's insights.
 */

export const KINDS = { message: 'Messages', sets: 'Training logged', workout: 'Workouts done', checkin: 'Check-ins', habit: 'Habit days', session: 'Sessions attended' };
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NPS_QUESTION = 'How likely are you to recommend JK to a friend? (0–10)';
const NEW_CLIENT_GRACE_DAYS = 14;
const LAPSED_DAYS = 28;
const SURVEY_HOUR = '10:00';
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// MARK: - Months

export const monthOf = day => day.slice(0, 7);
export function monthAdd(month, n) {
  const [y, m] = month.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}
export const monthDiff = (a, b) => { const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); };
const monthLabel = m => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const quarterOf = day => `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;

// MARK: - Activity

/** The coach's clients for insights: role client, this coach, the coach's demo flag. */
function clientsOf(db, coach) {
  return db.prepare("SELECT * FROM users WHERE role='client' AND coach_id=? AND is_demo=? ORDER BY name").all(coach.id, coach.is_demo ? 1 : 0);
}

/**
 * Client activity in [fromIso, toIso): [{clientId, kind, at|null, day}]. One
 * row per message, training session logged, workout completed, check-in,
 * habit day and attended session.
 */
export function activityOf(db, coachId, clientIds, fromIso, toIso, now = new Date()) {
  if (!clientIds.length) return [];
  const ids = JSON.stringify(clientIds);
  const IN = 'IN (SELECT value FROM json_each(?))';
  const out = [];
  const add = (clientId, kind, at, day = null) => out.push({ clientId, kind, at, day: day ?? londonDay(new Date(at)) });
  for (const r of db.prepare(`SELECT client_id, at FROM messages WHERE from_role='client' AND client_id ${IN} AND at>=? AND at<?`).all(ids, fromIso, toIso)) add(r.client_id, 'message', r.at);
  for (const r of db.prepare(`SELECT w.client_id, MIN(l.at) at FROM set_logs l JOIN workout_items i ON i.id=l.item_id JOIN workouts w ON w.id=i.workout_id
      WHERE w.client_id ${IN} AND l.at>=? AND l.at<? GROUP BY w.id`).all(ids, fromIso, toIso)) add(r.client_id, 'sets', r.at);
  for (const r of db.prepare(`SELECT client_id, completed_at at FROM workouts WHERE client_id ${IN} AND completed_at>=? AND completed_at<?`).all(ids, fromIso, toIso)) add(r.client_id, 'workout', r.at);
  for (const r of db.prepare(`SELECT client_id, submitted_at at FROM checkins WHERE client_id ${IN} AND submitted_at>=? AND submitted_at<?`).all(ids, fromIso, toIso)) add(r.client_id, 'checkin', r.at);
  const fromDay = londonDay(new Date(fromIso)), toDay = londonDay(new Date(Date.parse(toIso) - 1));
  for (const r of db.prepare(`SELECT h.client_id, d.date FROM habit_days d JOIN habits h ON h.id=d.habit_id
      WHERE h.client_id ${IN} AND d.done=1 AND d.date>=? AND d.date<=? GROUP BY h.client_id, d.date`).all(ids, fromDay, toDay)) add(r.client_id, 'habit', null, r.date);
  for (const [clientId, list] of attendedSessions(db, coachId, clientIds, fromIso, toIso, now)) for (const s of list) add(clientId, 'session', s.start);
  return out;
}

const londonHour = iso => Number(londonClock(new Date(iso)).slice(0, 2));
/** Heatmap row (0 = Monday … 6 = Sunday) and column (London hour) of an instant: correct across BST changes. */
export const heatCell = iso => { const d = londonDay(new Date(iso)); return [weekday(d) - 1, londonHour(iso)]; };

/** GET /api/insights/engagement?days=90 */
function engagement(_req, ctx) {
  requireCoach(ctx);
  const days = ctx.query.days === undefined ? 90 : num(Number(ctx.query.days), 'days', { min: 7, max: 365, int: true });
  const now = requestNow(ctx), today = londonDay(now);
  const from = addDays(today, -(days - 1));
  const coach = ctx.user;
  const clients = clientsOf(ctx.db, coach);
  const items = activityOf(ctx.db, coach.id, clients.map(c => c.id), londonToUtc(from).toISOString(), now.toISOString(), now);
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const it of items) if (it.at) { const [r, c] = heatCell(it.at); heat[r][c]++; }
  const perDay = new Map();
  const per = new Map(clients.map(c => [c.id, { days: new Set(), events: 0, last: null }]));
  const mix = Object.fromEntries(Object.keys(KINDS).map(k => [k, 0]));
  for (const it of items) {
    mix[it.kind]++;
    if (!perDay.has(it.day)) perDay.set(it.day, new Set());
    perDay.get(it.day).add(it.clientId);
    const p = per.get(it.clientId);
    if (!p) continue;
    p.days.add(it.day); p.events++;
    if (!p.last || it.day > p.last) p.last = it.day;
  }
  const daily = [];
  for (let d = from; d <= today; d = addDays(d, 1)) daily.push({ day: d, active: perDay.get(d)?.size ?? 0 });
  // The last activity before the window, for "quiet since".
  const lastEver = new Map();
  if (clients.length) {
    for (const it of activityOf(ctx.db, coach.id, clients.map(c => c.id), londonToUtc(addDays(today, -400)).toISOString(), now.toISOString(), now)) {
      if (!lastEver.get(it.clientId) || it.day > lastEver.get(it.clientId)) lastEver.set(it.clientId, it.day);
    }
  }
  const people = clients.map(c => {
    const p = per.get(c.id);
    const last = lastEver.get(c.id) ?? null;
    return {
      client: { id: c.id, name: c.name, initials: initials(c.name), plan: c.plan }, activeDays: p.days.size, events: p.events,
      lastActive: last, daysQuiet: last ? daysBetween(last, today) : null, share: Math.round((p.days.size / days) * 100),
    };
  });
  // Lapsed people (no plan, nothing for four weeks) stay in the heatmap and the daily line, but not in the rankings.
  const current = people.filter(p => !(p.client.plan === 'none' && (p.daysQuiet === null || p.daysQuiet > LAPSED_DAYS)));
  const top = [...current].sort((a, b) => b.activeDays - a.activeDays || b.events - a.events || a.client.name.localeCompare(b.client.name)).slice(0, 10);
  const quiet = [...current].sort((a, b) => a.activeDays - b.activeDays || (b.daysQuiet ?? 1e9) - (a.daysQuiet ?? 1e9) || a.client.name.localeCompare(b.client.name)).slice(0, 10);
  let peak = null;
  heat.forEach((row, r) => row.forEach((v, c) => { if (v && (!peak || v > peak.n)) peak = { weekday: WEEKDAY_LABELS[r], hour: c, n: v }; }));
  const week = daily.slice(-7);
  return {
    days, from, to: today, rows: WEEKDAY_LABELS, heatmap: heat, daily,
    mix: Object.entries(mix).map(([kind, n]) => ({ kind, label: KINDS[kind], n })),
    top, quiet, bands: bandsOf(ctx.db, coach, clients, today),
    summary: {
      clients: current.length, lapsed: people.length - current.length, activeWeek: new Set(items.filter(i => i.day >= addDays(today, -6)).map(i => i.clientId)).size,
      avgDaily: daily.length ? Math.round((daily.reduce((s, d) => s + d.active, 0) / daily.length) * 10) / 10 : 0,
      avgDailyWeek: week.length ? Math.round((week.reduce((s, d) => s + d.active, 0) / week.length) * 10) / 10 : 0,
      events: items.length, peak,
    },
  };
}

const CRM_BANDS = [['thriving', 'Thriving'], ['steady', 'Steady'], ['watch', 'Watch'], ['atRisk', 'At risk']];
/** Health bands from the crm.band fact when WP2's health score is there; else adherence bands (core.adherence28). */
function bandsOf(db, coach, clients, today) {
  const ids = clients.map(c => c.id);
  if (!ids.length) return null;
  const known = new Set(allFacts().map(f => f.id));
  if (known.has('crm.band')) {
    const facts = clientFacts(db, coach.id, ids, { only: ['crm.band'], today });
    const counts = new Map();
    for (const id of ids) { const b = facts.get(id)?.['crm.band'] ?? 'none'; counts.set(b, (counts.get(b) ?? 0) + 1); }
    const options = allFacts().find(f => f.id === 'crm.band')?.options;
    const labels = options?.length ? options.map(o => [o.value, o.label]) : CRM_BANDS;
    return { source: 'crm', label: 'Client health', items: [...labels.map(([band, label]) => ({ band, label, n: counts.get(band) ?? 0 })), ...(counts.get('none') ? [{ band: 'none', label: 'No score', n: counts.get('none') }] : [])] };
  }
  const facts = clientFacts(db, coach.id, ids, { only: ['core.adherence28'], today });
  const band = v => (v === null || v === undefined ? 'none' : v >= 80 ? 'thriving' : v >= 60 ? 'steady' : v >= 40 ? 'watch' : 'atRisk');
  const counts = new Map();
  for (const id of ids) { const b = band(facts.get(id)?.['core.adherence28']); counts.set(b, (counts.get(b) ?? 0) + 1); }
  return {
    source: 'adherence', label: 'Training adherence (28 days)',
    items: [['thriving', '80% and up'], ['steady', '60–79%'], ['watch', '40–59%'], ['atRisk', 'Under 40%'], ['none', 'Nothing due']].map(([b, label]) => ({ band: b, label, n: counts.get(b) ?? 0 })),
  };
}

// MARK: - Cohorts

/**
 * The cohort maths. people: [{joinMonth, active: Set<'YYYY-MM'>}]; current:
 * the month it is. Each cohort (join month) gives, for 0…age months since
 * joining, the % of its people active that month. The average lifetime is the
 * mean of (last active month − join month + 1), at least 1; survival at k is
 * the share, among people whose cohort is at least k months old, still active
 * in month k or later.
 */
export function buildCohorts(people, current) {
  const by = new Map();
  for (const p of people) {
    if (p.joinMonth > current) continue;
    if (!by.has(p.joinMonth)) by.set(p.joinMonth, []);
    by.get(p.joinMonth).push(p);
  }
  const cohorts = [...by.keys()].sort().map(month => {
    const list = by.get(month);
    const age = monthDiff(month, current);
    const retained = [];
    for (let k = 0; k <= age; k++) {
      const m = monthAdd(month, k);
      retained.push(Math.round((list.filter(p => p.active.has(m)).length / list.length) * 1000) / 10);
    }
    return { month, label: monthLabel(month), size: list.length, retained };
  });
  const lastOffset = p => { const ms = [...p.active].filter(m => m >= p.joinMonth && m <= current).sort(); return ms.length ? monthDiff(p.joinMonth, ms.at(-1)) : -1; };
  const included = people.filter(p => p.joinMonth <= current);
  const lifetimes = included.map(p => Math.max(1, lastOffset(p) + 1));
  const maxAge = included.reduce((m, p) => Math.max(m, monthDiff(p.joinMonth, current)), 0);
  const survival = [];
  for (let k = 0; k <= maxAge; k++) {
    const eligible = included.filter(p => monthDiff(p.joinMonth, current) >= k);
    if (!eligible.length) break;
    survival.push({ month: k, pct: Math.round((eligible.filter(p => lastOffset(p) >= k).length / eligible.length) * 1000) / 10, of: eligible.length });
  }
  return {
    cohorts, survival,
    avgLifetimeMonths: lifetimes.length ? Math.round((lifetimes.reduce((a, b) => a + b, 0) / lifetimes.length) * 10) / 10 : null,
  };
}

/**
 * Which months a client was active in, from the join month to `today`'s: any
 * activity that month, or a plan other than none with an activity in the 30
 * days before the month's end (today, for the current month).
 */
export function activeMonths(joinDay, activityDays, planAt, today) {
  const days = [...new Set(activityDays)].sort();
  const months = new Set(days.map(monthOf));
  const out = new Set();
  const current = monthOf(today);
  for (let m = monthOf(joinDay); m <= current; m = monthAdd(m, 1)) {
    if (months.has(m)) { out.add(m); continue; }
    const end = m === current ? today : addDays(`${monthAdd(m, 1)}-01`, -1);
    if (planAt(end) === 'none') continue;
    const since = addDays(end, -30);
    if (days.some(d => d > since && d <= end)) out.add(m);
  }
  return out;
}

/** GET /api/insights/cohorts?months=12 */
function cohorts(_req, ctx) {
  requireCoach(ctx);
  const months = ctx.query.months === undefined ? 12 : num(Number(ctx.query.months), 'months', { min: 1, max: 36, int: true });
  const now = requestNow(ctx), today = londonDay(now);
  const current = monthOf(today);
  const first = monthAdd(current, -(months - 1));
  const clients = clientsOf(ctx.db, ctx.user).filter(c => monthOf(londonDay(new Date(c.created_at))) >= first);
  const earliest = clients.reduce((m, c) => (c.created_at < m ? c.created_at : m), now.toISOString());
  const items = activityOf(ctx.db, ctx.user.id, clients.map(c => c.id), earliest, now.toISOString(), now);
  const daysOf = new Map(clients.map(c => [c.id, []]));
  for (const it of items) daysOf.get(it.clientId)?.push(it.day);
  const plans = ctx.db.prepare('SELECT plan, at FROM membership_events WHERE user_id=? ORDER BY at');
  const people = clients.map(c => {
    const events = plans.all(c.id);
    const planAt = day => {
      const cut = londonToUtc(addDays(day, 1)).toISOString();
      const e = events.filter(x => x.at < cut).at(-1);
      return e ? e.plan : events.length ? 'none' : c.plan;
    };
    const joinDay = londonDay(new Date(c.created_at));
    return { joinMonth: monthOf(joinDay), active: activeMonths(joinDay, daysOf.get(c.id), planAt, today) };
  });
  return { months, current, ...buildCohorts(people, current) };
}

// MARK: - NPS

/** NPS from 0–10 scores: % promoters (9–10) minus % detractors (0–6). */
export function npsOf(scores) {
  const n = scores.length;
  const promoters = scores.filter(s => s >= 9).length, detractors = scores.filter(s => s <= 6).length;
  return { nps: n ? Math.round(((promoters - detractors) / n) * 100) : null, promoters, passives: n - promoters - detractors, detractors, responses: n };
}
export const npsCategory = s => (s >= 9 ? 'promoter' : s >= 7 ? 'passive' : 'detractor');
const scoreOfNps = answers => { const v = Number.parseInt(answers?.nps, 10); return Number.isInteger(v) && v >= 0 && v <= 10 ? v : null; };

/** GET /api/insights/nps?months=12 */
function nps(_req, ctx) {
  requireCoach(ctx);
  const months = ctx.query.months === undefined ? 12 : num(Number(ctx.query.months), 'months', { min: 1, max: 36, int: true });
  const now = requestNow(ctx), today = londonDay(now);
  const first = monthAdd(monthOf(today), -(months - 1));
  const rows = ctx.db.prepare(`SELECT r.*, u.name client_name FROM form_requests r
      JOIN users u ON u.id=r.client_id AND u.coach_id=? AND u.is_demo=?
      JOIN pulse_surveys s ON s.form_id=r.form_id AND s.coach_id=? AND s.kind='nps'
      WHERE r.submitted_at IS NOT NULL AND r.submitted_at>=? ORDER BY r.submitted_at DESC`)
    .all(ctx.user.id, ctx.user.is_demo ? 1 : 0, ctx.user.id, londonToUtc(`${first}-01`).toISOString());
  const answered = rows.map(r => ({ r, a: JSON.parse(r.answers ?? '{}') })).map(({ r, a }) => ({ r, score: scoreOfNps(a), why: typeof a.why === 'string' ? a.why.trim() : '' }))
    .filter(x => x.score !== null);
  const trend = [];
  for (let m = first; m <= monthOf(today); m = monthAdd(m, 1)) {
    const list = answered.filter(x => monthOf(londonDay(new Date(x.r.submitted_at))) === m).map(x => x.score);
    trend.push({ month: m, label: monthLabel(m), nps: npsOf(list).nps, responses: list.length });
  }
  return {
    ...npsOf(answered.map(x => x.score)), months, trend,
    comments: answered.filter(x => x.why).slice(0, 20).map(x => ({
      client: { id: x.r.client_id, name: x.r.client_name, initials: initials(x.r.client_name) }, score: x.score, category: npsCategory(x.score), text: x.why, at: x.r.submitted_at,
    })),
  };
}

// MARK: - Surveys

export const CADENCES = ['once', 'monthly', 'quarterly', 'afterDays'];

/** The period a survey's send belongs to: 'once', '2026-11', '2026-Q4' or 'after'. */
export function periodOf(cadence, today) {
  if (cadence === 'monthly') return monthOf(today);
  if (cadence === 'quarterly') return quarterOf(today);
  if (cadence === 'afterDays') return 'after';
  return 'once';
}

function cleanAudience(db, coachId, a) {
  if (a === undefined || a === null) return {};
  if (typeof a !== 'object' || Array.isArray(a)) fail(400, 'audience must be {clientIds?, segmentId?, rules?}');
  const out = {};
  if (a.clientIds !== undefined) {
    if (!Array.isArray(a.clientIds) || a.clientIds.length > 1000 || a.clientIds.some(id => typeof id !== 'string')) fail(400, 'audience.clientIds must be a list of client ids');
    for (const id of a.clientIds) if (!db.prepare("SELECT 1 FROM users WHERE id=? AND role='client' AND coach_id=?").get(id, coachId)) fail(404, 'Not found');
    if (a.clientIds.length) out.clientIds = [...new Set(a.clientIds)];
  }
  if (a.segmentId !== undefined && a.segmentId !== null) {
    if (!db.prepare('SELECT 1 FROM segments WHERE id=? AND coach_id=?').get(String(a.segmentId), coachId)) fail(404, 'Not found');
    out.segmentId = a.segmentId;
  }
  if (a.rules !== undefined && a.rules !== null) out.rules = validateRules(a.rules, { name: 'audience.rules' });
  return out;
}

const isEveryone = a => !a.clientIds?.length && !a.segmentId && !a.rules;

/** The survey's audience as client rows, outreach-paused clients dropped (purpose 'automated'). */
function audienceOf(db, survey) {
  const a = JSON.parse(survey.audience || '{}');
  if (isEveryone(a)) {
    const ids = db.prepare("SELECT u.id FROM users u JOIN users c ON c.id=? WHERE u.role='client' AND u.coach_id=c.id AND u.is_demo=c.is_demo").all(survey.coach_id).map(r => r.id);
    return ids.length ? resolveAudience(db, survey.coach_id, { clientIds: ids }, { purpose: 'automated' }) : [];
  }
  try { return resolveAudience(db, survey.coach_id, a, { purpose: 'automated' }); } catch (e) { console.warn(`Survey ${survey.id}: audience failed: ${e.message}`); return []; }
}

function surveyOut(db, s) {
  const form = db.prepare('SELECT name, questions FROM forms WHERE id=?').get(s.form_id);
  const stats = db.prepare(`SELECT COUNT(p.request_id) sent, COUNT(r.submitted_at) answered, MAX(CASE WHEN p.request_id IS NOT NULL THEN p.at END) last FROM pulse_sends p
    JOIN users u ON u.id=p.client_id AND u.coach_id=? LEFT JOIN form_requests r ON r.id=p.request_id WHERE p.survey_id=?`).get(s.coach_id, s.id);
  let score = null;
  const answers = db.prepare(`SELECT r.answers FROM form_requests r JOIN users u ON u.id=r.client_id AND u.coach_id=? WHERE r.form_id=? AND r.submitted_at IS NOT NULL`).all(s.coach_id, s.form_id)
    .map(r => JSON.parse(r.answers ?? '{}'));
  if (s.kind === 'nps') score = npsOf(answers.map(scoreOfNps).filter(v => v !== null)).nps;
  else {
    const vals = answers.flatMap(a => Object.values(a).filter(v => typeof v === 'number'));
    score = vals.length ? Math.round((vals.reduce((x, y) => x + y, 0) / vals.length) * 10) / 10 : null;
  }
  return {
    id: s.id, kind: s.kind, cadence: s.cadence, afterDays: s.after_days, audience: JSON.parse(s.audience || '{}'), status: s.status, formId: s.form_id,
    name: form?.name ?? 'Survey', questions: JSON.parse(form?.questions ?? '[]').map(q => ({ id: q.id, kind: q.kind, label: q.label })),
    createdAt: s.created_at, sent: stats.sent, answered: stats.answered, lastSentAt: stats.last, score,
  };
}

function listSurveys(_req, ctx) {
  requireCoach(ctx);
  return { surveys: ctx.db.prepare('SELECT * FROM pulse_surveys WHERE coach_id=? ORDER BY status, created_at DESC').all(ctx.user.id).map(s => surveyOut(ctx.db, s)) };
}

/** The form behind a new survey: NPS (0–10 choice and a reason) or a pulse of 1–3 scale questions. */
function surveyForm(kind, questions, name) {
  if (kind === 'nps') {
    return {
      name: name ?? 'Would you recommend JK?', intro: 'Two quick questions. Your honest answer helps JK coach you better.',
      questions: [
        { id: 'nps', kind: 'choice', label: NPS_QUESTION, options: Array.from({ length: 11 }, (_, i) => String(i)) },
        { id: 'why', kind: 'long', label: 'What\'s the main reason?', required: false },
      ],
    };
  }
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 3) fail(400, 'questions must list 1 to 3 questions');
  return {
    name: name ?? 'Quick pulse', intro: 'Thirty seconds, 1 to 5 on each.',
    questions: questions.map((q, i) => ({ id: `q${i + 1}`, kind: 'scale', label: `${str(typeof q === 'string' ? q : q?.label, `questions[${i}]`, { max: 200 })} (1–5)`.replace(/ \(1–5\) \(1–5\)$/, ' (1–5)') })),
  };
}

function createSurvey(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const kind = oneOf(b.kind, 'kind', ['nps', 'pulse']);
  const cadence = oneOf(b.cadence ?? 'once', 'cadence', CADENCES);
  const afterDays = cadence === 'afterDays' ? num(b.afterDays, 'afterDays', { min: 1, max: 730, int: true }) : null;
  const audience = cleanAudience(ctx.db, ctx.user.id, b.audience);
  const name = str(b.name ?? null, 'name', { max: 80, optional: true });
  const form = surveyForm(kind, b.questions, name);
  const at = nowIso();
  const id = newId('ps');
  tx(ctx.db, () => {
    const formId = newId('f');
    ctx.db.prepare('INSERT INTO forms (id, coach_id, name, intro, questions, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(formId, ctx.user.id, form.name, form.intro, JSON.stringify(form.questions), at, at);
    ctx.db.prepare('INSERT INTO pulse_surveys (id, coach_id, form_id, kind, cadence, after_days, audience, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, ctx.user.id, formId, kind, cadence, afterDays, JSON.stringify(audience), 'active', at);
  });
  return { survey: surveyOut(ctx.db, ctx.db.prepare('SELECT * FROM pulse_surveys WHERE id=?').get(id)) };
}

function patchSurvey(_req, ctx) {
  requireCoach(ctx);
  const s = ownRow(ctx, 'pulse_surveys', ctx.params.id);
  const b = ctx.body;
  const sets = {};
  if (b.status !== undefined) sets.status = oneOf(b.status, 'status', ['active', 'paused']);
  if (b.cadence !== undefined) sets.cadence = oneOf(b.cadence, 'cadence', CADENCES);
  const cadence = sets.cadence ?? s.cadence;
  if (b.afterDays !== undefined || (sets.cadence === 'afterDays' && !s.after_days)) sets.after_days = cadence === 'afterDays' ? num(b.afterDays, 'afterDays', { min: 1, max: 730, int: true }) : null;
  if (b.audience !== undefined) sets.audience = JSON.stringify(cleanAudience(ctx.db, ctx.user.id, b.audience));
  const keys = Object.keys(sets);
  if (keys.length) ctx.db.prepare(`UPDATE pulse_surveys SET ${keys.map(k => `${k}=?`).join(', ')} WHERE id=?`).run(...keys.map(k => sets[k]), s.id);
  return { survey: surveyOut(ctx.db, ctx.db.prepare('SELECT * FROM pulse_surveys WHERE id=?').get(s.id)) };
}

/** Deleting a survey stops it and drops it from Insights; the form and each client's answers stay on their record. */
function deleteSurvey(_req, ctx) {
  requireCoach(ctx);
  const s = ownRow(ctx, 'pulse_surveys', ctx.params.id);
  ctx.db.prepare('DELETE FROM pulse_surveys WHERE id=?').run(s.id);
  return { ok: true };
}

/**
 * Send a survey to whoever is due: each client at most once per period
 * (pulse_sends claims the (survey, client, period) row before sendForm, in one
 * transaction). Clients with outreach paused are skipped. Recurring surveys
 * skip clients in their first 14 days; afterDays sends once a client reaches
 * the day (no older client is swept up when a survey is made).
 * Returns {sent, skipped}.
 */
export function sendSurvey(db, config, survey, { now = new Date(), clientIds = null } = {}) {
  const today = londonDay(now);
  const period = periodOf(survey.cadence, today);
  const form = db.prepare('SELECT * FROM forms WHERE id=? AND coach_id=?').get(survey.form_id, survey.coach_id);
  const coach = db.prepare('SELECT name FROM users WHERE id=?').get(survey.coach_id);
  if (!form || !coach) return { sent: 0, skipped: 0 };
  let audience = audienceOf(db, survey);
  if (clientIds) audience = audience.filter(c => clientIds.includes(c.id));
  const created = londonDay(new Date(survey.created_at));
  let sent = 0, skipped = audience.skipped ? audience.skipped.outreachPaused : 0;
  for (const c of audience) {
    const joined = londonDay(new Date(c.created_at));
    const age = daysBetween(joined, today);
    if (survey.cadence === 'afterDays') {
      const due = addDays(joined, survey.after_days);
      if (age < survey.after_days || due < addDays(created, -7)) { skipped++; continue; }
    } else if (!clientIds && age < NEW_CLIENT_GRACE_DAYS) { skipped++; continue; }
    const done = tx(db, () => {
      if (!db.prepare('INSERT OR IGNORE INTO pulse_sends (survey_id, client_id, period, request_id, at) VALUES (?,?,?,NULL,?)').run(survey.id, c.id, period, now.toISOString()).changes) return false;
      const r = sendForm(db, config, form, c, { coachName: coach.name, emit: true });
      db.prepare('UPDATE pulse_sends SET request_id=? WHERE survey_id=? AND client_id=? AND period=?').run(r.id, survey.id, c.id, period);
      emit(db, 'pulse.sent', { coachId: survey.coach_id, clientId: c.id, summary: `Sent ${form.name}`, surveyId: survey.id, kind: survey.kind, requestId: r.id });
      return true;
    });
    if (done) sent++;
  }
  return { sent, skipped };
}

function sendNow(_req, ctx) {
  requireCoach(ctx);
  const s = ownRow(ctx, 'pulse_surveys', ctx.params.id);
  let clientIds = null;
  if (ctx.body.clientIds !== undefined) {
    if (!Array.isArray(ctx.body.clientIds) || !ctx.body.clientIds.length) fail(400, 'clientIds must be a list of client ids');
    for (const id of ctx.body.clientIds) if (!ctx.db.prepare("SELECT 1 FROM users WHERE id=? AND role='client' AND coach_id=?").get(String(id), ctx.user.id)) fail(404, 'Not found');
    clientIds = ctx.body.clientIds;
  }
  return sendSurvey(ctx.db, ctx.config, s, { now: requestNow(ctx), clientIds });
}

/** The 10:00 London clock: every active survey sends what is due (idempotent per period). */
export function runSurveys(db, config, now = new Date()) {
  if (londonClock(now) < SURVEY_HOUR) return { sent: 0 };
  let sent = 0;
  for (const s of db.prepare("SELECT * FROM pulse_surveys WHERE status='active' ORDER BY created_at").all()) {
    try { sent += sendSurvey(db, config, s, { now }).sent; } catch (e) { console.error(`Survey ${s.id} failed`, e); }
  }
  return { sent };
}

/** form.submitted on a survey's form: emit pulse.answered, and tell the coach about a detractor (urgent). */
function onSubmitted(db, config, event) {
  const formId = event.payload?.formId;
  if (!formId || !event.coachId) return;
  const s = db.prepare('SELECT * FROM pulse_surveys WHERE form_id=? AND coach_id=?').get(formId, event.coachId);
  if (!s) return;
  const r = db.prepare('SELECT * FROM form_requests WHERE id=?').get(event.payload.requestId ?? '');
  if (!r?.answers) return;
  const a = JSON.parse(r.answers);
  let score;
  if (s.kind === 'nps') score = scoreOfNps(a);
  else {
    const vals = Object.values(a).filter(v => typeof v === 'number');
    score = vals.length ? Math.round((vals.reduce((x, y) => x + y, 0) / vals.length) * 10) / 10 : null;
  }
  if (score === null) return;
  emit(db, 'pulse.answered', { coachId: s.coach_id, clientId: r.client_id, summary: s.kind === 'nps' ? `NPS ${score}/10` : `Pulse ${score}/5`, surveyId: s.id, kind: s.kind, score, requestId: r.id });
  if (s.kind === 'nps' && score <= 6) {
    const client = db.prepare('SELECT name FROM users WHERE id=?').get(r.client_id);
    const why = typeof a.why === 'string' ? a.why.trim() : '';
    notifyCoach(db, config, s.coach_id, {
      clientId: r.client_id, kind: 'detractor', title: `Detractor: ${(client?.name ?? 'A client').split(' ')[0]} scored ${score}/10`,
      body: why ? why.slice(0, 160) : 'No reason given.', path: '/insights/nps', icon: 'sentiment_dissatisfied', tone: 'urgent', dedupe: `pulse:${r.id}`,
      now: new Date(event.at),
    });
  }
}

// MARK: - Demo

const ALUMNI = [
  ['Grace Lee', 'performance', 4], ['Owen Hughes', 'foundation', 2], ['Mia Turner', 'elite', 5], ['Ben Walsh', 'foundation', 3],
  ['Chloe Adams', 'performance', 3], ['Jack Doyle', 'foundation', 2],
];
const NPS_SCRIPT = [
  [10, 'Sessions are the best hour of my week. I actually look forward to Mondays now.'], [9, ''], [7, ''], [10, ''], [6, 'Hard to get an evening slot some weeks.'],
  [9, ''], [8, 'Great plan, I just wish the app reminded me about check-ins.'], [10, ''], [9, ''], [4, ''], [9, ''], [7, ''],
  [10, 'Stronger than I have ever been, and I actually enjoy it. Thank you JK.'], [8, ''],
];

function demoBuild(db, ctx) {
  schema(db);
  const { coach, today, rng } = ctx;
  const at = (d, t = '10:00') => londonToUtc(d, t).toISOString();
  db.prepare('DELETE FROM pulse_surveys WHERE coach_id=?').run(coach.id);

  // Cohorts need people who joined over eight months; when the demo world has fewer than six join months, add alumni who did.
  db.prepare("DELETE FROM users WHERE apple_sub LIKE 'demo-ins-%' AND is_demo=1 AND coach_id=?").run(coach.id);
  const current = monthOf(today);
  const listed = () => db.prepare("SELECT * FROM users WHERE role='client' AND coach_id=? AND is_demo=1").all(coach.id);
  const have = new Set(listed().map(c => monthOf(londonDay(new Date(c.created_at)))).filter(m => monthDiff(m, current) <= 7));
  const missing = [7, 6, 5, 4, 3, 2, 1].map(k => monthAdd(current, -k)).filter(m => !have.has(m));
  const need = Math.max(0, 6 - have.size);
  missing.slice(0, need).forEach((month, i) => {
    const [name, plan, stayed] = ALUMNI[i % ALUMNI.length];
    const id = newId('u');
    const joined = `${month}-${String(4 + i * 3).padStart(2, '0')}`;
    const left = addDays(`${monthAdd(month, stayed)}-01`, 12);
    const end = left < today ? left : today;
    db.prepare("INSERT INTO users (id, apple_sub, email, name, role, coach_id, plan, plan_since, is_demo, created_at, onboarded_at) VALUES (?,?,NULL,?,'client',?,?,?,1,?,?)")
      .run(id, `demo-ins-${i}`, name, coach.id, end === left ? 'none' : plan, at(joined), at(joined, '09:00'), at(joined, '09:30'));
    db.prepare('INSERT INTO membership_events (user_id, plan, at) VALUES (?,?,?)').run(id, plan, at(joined, '09:00'));
    if (end === left) db.prepare('INSERT INTO membership_events (user_id, plan, at) VALUES (?,?,?)').run(id, 'none', at(left, '09:00'));
    // While they trained: two workouts a week, a weekly check-in and the odd message.
    for (let d = joined; d < end; d = addDays(d, 1)) {
      const wd = weekday(d);
      if ((wd === 2 || wd === 4) && rng.chance(0.85)) {
        db.prepare(`INSERT INTO workouts (id, client_id, date, title, published, published_at, edited_at, edited_by, completed_at, created_by) VALUES (?,?,?,?,1,?,?,'coach',?,?)`)
          .run(newId('w'), id, d, wd === 2 ? 'Full body A' : 'Full body B', at(d, '07:00'), at(d, '07:00'), at(d, rng.chance(0.5) ? '07:20' : '18:40'), coach.id);
      }
      if (wd === 5) {
        db.prepare("INSERT OR IGNORE INTO checkins (id, client_id, week, energy, sleep, pain, note, submitted_at) VALUES (?,?,?,?,?,'[]','',?)")
          .run(newId('c'), id, addDays(d, -4), rng.int(2, 5), rng.int(2, 5), at(d, rng.chance(0.5) ? '19:30' : '21:10'));
      }
      if (rng.chance(0.12)) {
        db.prepare("INSERT INTO messages (id, client_id, from_id, from_role, text, at, read_at) VALUES (?,?,?,'client',?,?,?)")
          .run(newId('m'), id, id, rng.pick(['Done today!', 'Quick one: can I swap Thursday?', 'Felt great this morning.', 'Struggled with the last set.']), at(d, rng.pick(['07:45', '12:30', '20:15'])), at(d, '21:00'));
      }
    }
  });

  const clients = listed();
  const insertForm = (name, intro, questions, made) => {
    const id = newId('f');
    db.prepare('INSERT INTO forms (id, coach_id, name, intro, questions, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(id, coach.id, name, intro, JSON.stringify(questions), made, made);
    return id;
  };
  const request = (formId, form, client, sentAt, answers, submittedAt) => {
    const id = newId('fr');
    db.prepare('INSERT INTO form_requests (id, form_id, client_id, name, intro, questions, sent_at, answers, submitted_at, reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, formId, client.id, form.name, form.intro, JSON.stringify(form.questions), sentAt, answers ? JSON.stringify(answers) : null, answers ? submittedAt : null, answers ? submittedAt : null);
    return id;
  };
  const send = db.prepare('INSERT OR IGNORE INTO pulse_sends (survey_id, client_id, period, request_id, at) VALUES (?,?,?,?,?)');

  // NPS, monthly since about seven months ago: fourteen answers over six months (NPS about +43), four with a reason.
  const npsForm = surveyForm('nps', null, null);
  const npsMade = at(addDays(`${monthAdd(current, -6)}-01`, -3), '09:00');
  const npsFormId = insertForm(npsForm.name, npsForm.intro, npsForm.questions, npsMade);
  const npsId = newId('ps');
  db.prepare("INSERT INTO pulse_surveys (id, coach_id, form_id, kind, cadence, after_days, audience, status, created_at) VALUES (?,?,?,'nps','monthly',NULL,'{}','active',?)")
    .run(npsId, coach.id, npsFormId, npsMade);
  let script = 0;
  for (let k = 5; k >= 0; k--) {
    const month = monthAdd(current, -k);
    const sendDay = k === 0 ? (today >= `${month}-03` ? `${month}-03` : `${month}-01`) : `${month}-03`;
    const eligible = clients.filter(c => daysBetween(londonDay(new Date(c.created_at)), sendDay) >= NEW_CLIENT_GRACE_DAYS)
      .filter(c => !c.apple_sub?.startsWith('demo-ins-') || db.prepare('SELECT 1 FROM membership_events WHERE user_id=? AND plan=\'none\' AND at<?').get(c.id, at(sendDay)) === undefined);
    // The script spread evenly over the months left. Only answered ones get a form request: an unanswered
    // demo form would sit on the client's Home (Sam's is App Review's), so those are claimed sends only.
    const answering = Math.ceil((NPS_SCRIPT.length - script) / (k + 1));
    eligible.forEach((c, i) => {
      const answer = i < answering && script < NPS_SCRIPT.length ? NPS_SCRIPT[script++] : null;
      if (!answer) { send.run(npsId, c.id, month, null, at(sendDay)); return; }
      let submitted = addDays(sendDay, 1 + (i % 3));
      if (submitted > today) submitted = today;
      const rid = request(npsFormId, npsForm, c, at(sendDay), { nps: String(answer[0]), ...(answer[1] ? { why: answer[1] } : {}) }, at(submitted, submitted === today ? '07:40' : '19:40'));
      send.run(npsId, c.id, month, rid, at(sendDay));
    });
  }

  // A quarterly pulse: three 1–5 questions, last quarter's answered.
  const pulseForm = surveyForm('pulse', ['How energised do you feel this month?', 'How well does training fit your week?', 'How supported do you feel by JK?'], 'Quarterly pulse');
  const pulseMade = at(addDays(today, -150), '09:00');
  const pulseFormId = insertForm(pulseForm.name, pulseForm.intro, pulseForm.questions, pulseMade);
  const pulseId = newId('ps');
  db.prepare("INSERT INTO pulse_surveys (id, coach_id, form_id, kind, cadence, after_days, audience, status, created_at) VALUES (?,?,?,'pulse','quarterly',NULL,'{}','active',?)")
    .run(pulseId, coach.id, pulseFormId, pulseMade);
  const qMonth = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1;
  const quarterStart = `${today.slice(0, 4)}-${String(qMonth).padStart(2, '0')}-01`;
  const lastQuarterDay = addDays(quarterStart, -40);
  for (const c of clients.filter(x => x.created_at < at(addDays(lastQuarterDay, -NEW_CLIENT_GRACE_DAYS)))) {
    const answers = { q1: rng.int(3, 5), q2: rng.int(2, 5), q3: rng.int(4, 5) };
    const rid = request(pulseFormId, pulseForm, c, at(lastQuarterDay), answers, at(addDays(lastQuarterDay, 1), '20:05'));
    send.run(pulseId, c.id, quarterOf(lastQuarterDay), rid, at(lastQuarterDay));
  }
  // This quarter's: claimed for everyone due (so the clock sends nothing new), half already answered.
  const thisQuarter = quarterOf(today);
  const sentDay = addDays(today, -6) < quarterStart ? quarterStart : addDays(today, -6);
  clients.forEach((c, i) => {
    if (daysBetween(londonDay(new Date(c.created_at)), today) < NEW_CLIENT_GRACE_DAYS) return;
    if (c.apple_sub?.startsWith('demo-ins-') && c.plan === 'none') return;
    const answeredOn = addDays(sentDay, 1) > today ? today : addDays(sentDay, 1);
    const rid = i % 2 === 0 ? request(pulseFormId, pulseForm, c, at(sentDay), { q1: rng.int(3, 5), q2: rng.int(3, 5), q3: 5 }, at(answeredOn, '07:20')) : null;
    send.run(pulseId, c.id, thisQuarter, rid, at(sentDay));
  });
  // This month's NPS: claimed for everyone due, so the 10:00 clock leaves the demo alone.
  for (const c of clients) {
    if (daysBetween(londonDay(new Date(c.created_at)), today) < NEW_CLIENT_GRACE_DAYS) continue;
    send.run(npsId, c.id, current, null, at(today, '10:00'));
  }
}

// MARK: - The feature

function schema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS pulse_surveys (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('nps','pulse')),
      cadence TEXT NOT NULL CHECK (cadence IN ('once','monthly','quarterly','afterDays')),
      after_days INTEGER, audience TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
      created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pulse_sends (
      survey_id TEXT NOT NULL REFERENCES pulse_surveys(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      period TEXT NOT NULL,
      request_id TEXT, at TEXT NOT NULL, PRIMARY KEY (survey_id, client_id, period));
    CREATE INDEX IF NOT EXISTS pulse_sends_client ON pulse_sends(client_id);`);
}

export const feature = {
  name: 'insights',
  namespaces: ['pulse', 'insights'],
  schema,
  routes(r) {
    r.add('GET', '/api/insights/engagement', engagement);
    r.add('GET', '/api/insights/cohorts', cohorts);
    r.add('GET', '/api/insights/nps', nps);
    r.add('GET', '/api/insights/surveys', listSurveys);
    r.add('POST', '/api/insights/surveys', createSurvey);
    r.add('PATCH', '/api/insights/surveys/:id', patchSurvey);
    r.add('DELETE', '/api/insights/surveys/:id', deleteSurvey);
    r.add('POST', '/api/insights/surveys/:id/send', sendNow);
  },
  clocks: [{ id: 'insights.pulse', everyMs: 10 * 60_000, run: (db, config, now) => runSurveys(db, config, now) }],
  on: { 'form.submitted': onSubmitted },
  emits: {
    'pulse.sent': { label: 'A pulse or NPS survey was sent', payload: ['surveyId', 'kind', 'requestId'] },
    'pulse.answered': { label: 'A client answered a pulse or NPS survey', payload: ['surveyId', 'kind', 'score', 'requestId'] },
  },
  actions: {
    'pulse.send': {
      label: 'Send a pulse or NPS survey', clientFacing: true,
      params: [{ key: 'surveyId', label: 'Survey', type: 'text', required: true }],
      options: (db, coachId) => db.prepare('SELECT s.id value, f.name label FROM pulse_surveys s JOIN forms f ON f.id=s.form_id WHERE s.coach_id=? ORDER BY f.name').all(coachId),
      run(db, config, ctx) {
        const s = db.prepare('SELECT * FROM pulse_surveys WHERE id=? AND coach_id=?').get(ctx.params.surveyId, ctx.coachId);
        if (!s) return 'Skipped: no survey';
        if (outreachOf(db, ctx.client.id).paused) return 'Skipped: outreach paused';
        const form = db.prepare('SELECT * FROM forms WHERE id=?').get(s.form_id);
        const coach = db.prepare('SELECT name FROM users WHERE id=?').get(ctx.coachId);
        const period = periodOf(s.cadence, londonDay(ctx.now));
        if (!db.prepare('INSERT OR IGNORE INTO pulse_sends (survey_id, client_id, period, request_id, at) VALUES (?,?,?,NULL,?)').run(s.id, ctx.client.id, period, ctx.now.toISOString()).changes) return 'Skipped: already sent';
        const r = sendForm(db, config, form, ctx.client, { coachName: coach?.name, emit: true });
        db.prepare('UPDATE pulse_sends SET request_id=? WHERE survey_id=? AND client_id=? AND period=?').run(r.id, s.id, ctx.client.id, period);
        emit(db, 'pulse.sent', { coachId: ctx.coachId, clientId: ctx.client.id, summary: `Sent ${form.name}`, surveyId: s.id, kind: s.kind, requestId: r.id });
        return 'Sent';
      },
    },
  },
  exportFor(db, user) {
    if (user.role !== 'client') return {};
    return {
      surveys: db.prepare('SELECT p.period, p.request_id requestId, p.at, s.kind FROM pulse_sends p LEFT JOIN pulse_surveys s ON s.id=p.survey_id WHERE p.client_id=? ORDER BY p.at').all(user.id),
    };
  },
  demo: { build: demoBuild },
};
