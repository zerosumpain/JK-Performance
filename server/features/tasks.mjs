import { clientFor, initials, requireCoach, requestNow } from '../access.mjs';
import { emit } from '../events.mjs';
import { clock, day as dayParam, fail, instant, num, oneOf, str } from '../http.mjs';
import { notifyCoach } from '../notifications.mjs';
import { likeAny, matchScore } from '../search.mjs';
import { newId, nowIso, tx } from '../store.mjs';
import { render } from '../templating.mjs';
import { addDays, londonClock, londonDay, londonToUtc, mondayOf, weekday } from '../time.mjs';

/**
 * F23 Coach tasks (docs/design/desk-v2.md): JK's own to-do list, next to his
 * clients. A task may name one client; automations (task.create), voice notes
 * and dunning can make them too, and carry a source link back.
 *
 * Access: a task with no client belongs to the coach who wrote it; a task about
 * a client belongs to that client's CURRENT coach (6.1: a stored coach_id on a
 * client-linked row is never trusted), so a reassigned client's open tasks move
 * with them.
 *
 * Buckets are London days: overdue (due before today), today, week (after today
 * up to Sunday of this London week), later, none (no date) and done (finished
 * since Monday 00:00 London). Older done tasks are only listed with status=done.
 */

export const PRIORITIES = ['low', 'normal', 'high'];
export const SOURCES = ['manual', 'automation', 'voice', 'ai', 'dunning'];
export const BUCKETS = ['overdue', 'today', 'week', 'later', 'none', 'done'];
const STALE_MS = 36 * 3_600_000; // a due notice more than 36 h late is dropped, never sent
const TAG = /^[a-z0-9][a-z0-9_-]{0,29}$/;

// MARK: - Natural parsing ("Call Sam tomorrow 9am #billing !high")

const WEEKDAYS = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
};
const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const WD = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|');
const MO = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const LEAD = '(?:(?:by|on|due|for|before)\\s+)?';
const pad = n => String(n).padStart(2, '0');
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A real calendar day, or null ("31 Feb" is not one). */
function realDay(y, m, d) {
  const s = `${y}-${pad(m)}-${pad(d)}`;
  const t = new Date(`${s}T12:00:00Z`);
  return t.getUTCMonth() + 1 === m && t.getUTCDate() === d ? s : null;
}

/** The next `wd` (1 = Monday) on or after `today`. */
const onOrAfter = (today, wd) => addDays(today, (wd - weekday(today) + 7) % 7);

/**
 * Date phrases, tried in order; each returns {day, time?} or null for a match
 * that is not a date after all. The phrase (and a leading by/on/due) is removed
 * from the title.
 */
const DATE_RULES = [
  [new RegExp(`\\b${LEAD}(today|tonight|tomorrow|tmrw|tmr)\\b`, 'i'), (m, today) => {
    const w = m[1].toLowerCase();
    if (w === 'today') return { day: today };
    if (w === 'tonight') return { day: today, time: '19:00' };
    return { day: addDays(today, 1) };
  }],
  [new RegExp(`\\b${LEAD}in\\s+(\\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\\s+(days?|weeks?)\\b`, 'i'), (m, today) => {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()];
    return { day: addDays(today, m[2].toLowerCase().startsWith('week') ? n * 7 : n) };
  }],
  [new RegExp(`\\b${LEAD}next\\s+week\\b`, 'i'), (_m, today) => ({ day: addDays(mondayOf(today), 7) })],
  // "next mon": that weekday in next London week (Mon–Sun).
  [new RegExp(`\\b${LEAD}next\\s+(${WD})\\b`, 'i'), (m, today) => ({ day: addDays(mondayOf(today), 7 + WEEKDAYS[m[1].toLowerCase()] - 1) })],
  // "2026-12-15"
  [new RegExp(`\\b${LEAD}(\\d{4})-(\\d{2})-(\\d{2})\\b`, 'i'), m => { const d = realDay(+m[1], +m[2], +m[3]); return d ? { day: d } : null; }],
  // "15 Dec", "15th December", "Dec 15": this year, or next year once it has passed.
  [new RegExp(`\\b${LEAD}(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MO})\\b`, 'i'), (m, today) => nextDate(today, MONTHS[m[2].toLowerCase()], +m[1])],
  [new RegExp(`\\b${LEAD}(${MO})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'), (m, today) => nextDate(today, MONTHS[m[1].toLowerCase()], +m[2])],
  // "fri", "this friday": the next one, today included.
  [new RegExp(`\\b${LEAD}(?:this\\s+)?(${WD})\\b`, 'i'), (m, today) => ({ day: onOrAfter(today, WEEKDAYS[m[1].toLowerCase()]) })],
];

function nextDate(today, month, dayOfMonth) {
  const y = Number(today.slice(0, 4));
  const d = realDay(y, month, dayOfMonth);
  if (!d) return null;
  return { day: d >= today ? d : realDay(y + 1, month, dayOfMonth) ?? d };
}

const TIME_RULES = [
  [/\b(?:at\s+)?(noon|midday)\b/i, () => '12:00'],
  [/\b(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i, m => {
    let hh = Number(m[1]);
    const mm = Number(m[2] ?? 0);
    if (hh < 1 || hh > 12 || mm > 59) return null;
    if (m[3].toLowerCase() === 'pm' && hh < 12) hh += 12;
    if (m[3].toLowerCase() === 'am' && hh === 12) hh = 0;
    return `${pad(hh)}:${pad(mm)}`;
  }],
  [/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i, m => `${pad(m[1])}:${m[2]}`],
];

/**
 * Parse a quick-add line. `clients` are `{id, name}` rows: a full name, or a
 * first name that only one client has, matched case-insensitively on word
 * boundaries (the name stays in the title). Dates: today, tomorrow, tonight,
 * weekday names (on or after today), "next mon" (next week's), "next week",
 * "in 3 days", "in 2 weeks", "15 Dec", "Dec 15", "2026-12-15". Times: 9am,
 * 5:30pm, 14:30, noon. A time with no date is today if still ahead, else
 * tomorrow. `#tag` and `!high` / `!low`.
 * Returns {title, dueOn, dueAt, dueTime, clientId, clientName, tags, priority}.
 */
export function parseTask(text, { today = londonDay(), now = new Date(), clients = [] } = {}) {
  let rest = ` ${String(text ?? '').replace(/\s+/g, ' ').trim()} `;
  const cut = m => { rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`; };
  let priority = 'normal';
  const p = /(^|\s)!(high|low|normal|h|l)(?=\s|$)/i.exec(rest);
  if (p) { priority = { h: 'high', l: 'low' }[p[2].toLowerCase()] ?? p[2].toLowerCase(); cut(p); }
  const tags = [];
  for (let m; (m = /(^|\s)#([a-zA-Z0-9][\w-]{0,29})(?=\s|$|[,.;!?])/.exec(rest));) {
    const t = m[2].toLowerCase();
    if (!tags.includes(t) && tags.length < 10) tags.push(t);
    cut(m);
  }
  let dueOn = null, time = null;
  for (const [re, fn] of DATE_RULES) {
    const m = re.exec(rest);
    if (!m) continue;
    const got = fn(m, today);
    if (!got?.day) continue;
    dueOn = got.day;
    time = got.time ?? null;
    cut(m);
    break;
  }
  for (const [re, fn] of TIME_RULES) {
    const m = re.exec(rest);
    if (!m) continue;
    const t = fn(m);
    if (!t) continue;
    time = t;
    cut(m);
    break;
  }
  if (time && !dueOn) dueOn = londonToUtc(today, time).getTime() > now.getTime() ? today : addDays(today, 1);
  const title = rest.replace(/\s+/g, ' ').trim().replace(/(\s+(by|on|at|due|for|before|-|–|,))+$/i, '').replace(/^[-–,:\s]+|[-–,:\s]+$/g, '').trim();

  // Clients: a full name first (longest wins), else a first name that is unique.
  let client = null;
  const hay = ` ${String(text ?? '').toLowerCase()} `;
  const has = name => new RegExp(`(^|[^\\p{L}])${escapeRe(name.toLowerCase())}(?=[^\\p{L}]|$)`, 'u').test(hay);
  for (const c of [...clients].sort((a, b) => b.name.length - a.name.length)) if (c.name.includes(' ') && has(c.name)) { client = c; break; }
  if (!client) {
    const byFirst = new Map();
    for (const c of clients) {
      const f = c.name.trim().split(/\s+/)[0].toLowerCase();
      byFirst.set(f, byFirst.has(f) ? null : c);
    }
    for (const [f, c] of byFirst) if (c && f.length > 1 && has(f)) { client = c; break; }
  }
  return {
    title: title.slice(0, 200), dueOn, dueAt: dueOn && time ? londonToUtc(dueOn, time).toISOString() : null, dueTime: dueOn && time ? time : null,
    clientId: client?.id ?? null, clientName: client?.name ?? null, tags, priority,
  };
}

// MARK: - Buckets

/** Which board column a task sits in, by London day. `now` decides "done this week". */
export function bucketOf(t, today, now = new Date()) {
  if (t.status === 'done') return t.done_at && t.done_at >= londonToUtc(mondayOf(today)).toISOString() ? 'done' : null;
  if (!t.due_on) return 'none';
  if (t.due_on < today) return 'overdue';
  if (t.due_on === today) return 'today';
  return t.due_on <= addDays(mondayOf(today), 6) ? 'week' : 'later';
}

/** When a task falls due: its time, or 08:00 London on its day. */
export const dueInstant = t => (t.due_at ? new Date(t.due_at) : t.due_on ? londonToUtc(t.due_on, '08:00') : null);
const dueKey = t => t.due_at ?? t.due_on ?? null;

// MARK: - Rows and access

const VISIBLE = `FROM tasks t LEFT JOIN users u ON u.id=t.client_id
  WHERE ((t.client_id IS NULL AND t.coach_id=?) OR (t.client_id IS NOT NULL AND u.coach_id=? AND u.role='client'))`;

function sourcePath(t) {
  if (t.source === 'dunning') return t.source_ref ? `/billing/invoices/${t.source_ref}` : '/billing';
  if (t.source === 'automation') return t.source_ref && /^au_/.test(t.source_ref) ? `/automations/${t.source_ref}` : '/automations';
  if ((t.source === 'voice' || t.source === 'ai') && t.client_id) return `/messages/${t.client_id}`;
  return null;
}

export function taskOut(t, today = londonDay(), now = new Date()) {
  return {
    id: t.id, title: t.title, notes: t.notes,
    client: t.client_id && t.client_name ? { id: t.client_id, name: t.client_name, initials: initials(t.client_name) } : null,
    dueOn: t.due_on, dueAt: t.due_at, dueTime: t.due_at ? londonClock(new Date(t.due_at)) : null,
    priority: t.priority, tags: JSON.parse(t.tags || '[]'), status: t.status, snoozedUntil: t.snoozed_until,
    source: t.source, sourceRef: t.source_ref, sourcePath: sourcePath(t),
    createdAt: t.created_at, doneAt: t.done_at, position: t.position, bucket: bucketOf(t, today, now),
  };
}

/** A task this coach may see and change, or 404. */
function taskFor(ctx, id) {
  const t = ctx.db.prepare(`SELECT t.*, u.name client_name ${VISIBLE} AND t.id=?`).get(ctx.user.id, ctx.user.id, String(id ?? ''));
  if (!t) fail(404, 'Not found');
  return t;
}

const reload = (db, id) => db.prepare('SELECT t.*, u.name client_name FROM tasks t LEFT JOIN users u ON u.id=t.client_id WHERE t.id=?').get(id);

function cleanTags(v, name = 'tags') {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 10) fail(400, `${name} must be a list of up to 10 tags`);
  const out = [];
  for (const [i, raw] of v.entries()) {
    const t = str(raw, `${name}[${i}]`, { max: 30 }).toLowerCase().replace(/^#/, '');
    if (!TAG.test(t)) fail(400, `${name}[${i}] must be letters, numbers, - or _`);
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** dueOn / dueAt from a body, together: a dueAt sets the day it falls on. */
function cleanDue(b, prev = null, now = new Date()) {
  let dueOn = prev?.due_on ?? null, dueAt = prev?.due_at ?? null;
  if (b.dueOn !== undefined) {
    dueOn = b.dueOn === null ? null : dayParam(b.dueOn, 'dueOn');
    // Moving the day keeps the time of day, unless a new time comes too.
    if (dueOn && dueAt && b.dueAt === undefined) dueAt = londonToUtc(dueOn, londonClock(new Date(dueAt))).toISOString();
    if (!dueOn) dueAt = null;
  }
  if (b.dueAt !== undefined) {
    dueAt = b.dueAt === null ? null : instant(b.dueAt, 'dueAt');
    if (dueAt) dueOn = londonDay(new Date(dueAt));
  }
  // dueTime ("HH:MM" London, or null) sets the time on the due day (today when there is none).
  if (b.dueTime !== undefined) {
    if (b.dueTime === null || b.dueTime === '') dueAt = null;
    else {
      const t = clock(b.dueTime, 'dueTime');
      dueOn = dueOn ?? londonDay(now);
      dueAt = londonToUtc(dueOn, t).toISOString();
    }
  }
  return { dueOn, dueAt };
}

/** Insert a task (HTTP, the task.create action, other code). Returns the row. Emits task.created. */
export function createTask(db, { coachId, clientId = null, title, notes = '', dueOn = null, dueAt = null, priority = 'normal', tags = [], source = 'manual', sourceRef = null, now = new Date(), aiDerived = false }) {
  const id = newId('tk');
  const at = now.toISOString();
  const top = db.prepare('SELECT MIN(position) p FROM tasks WHERE coach_id=?').get(coachId).p;
  db.prepare(`INSERT INTO tasks (id, coach_id, client_id, title, notes, due_on, due_at, priority, tags, status, source, source_ref, created_at, position)
    VALUES (?,?,?,?,?,?,?,?,?,'open',?,?,?,?)`).run(id, coachId, clientId, title, notes, dueOn, dueAt, priority, JSON.stringify(tags), source, sourceRef, at, (top ?? 0) - 1);
  // A task made from an AI judgement (voice analysis, an AI-driven automation) carries the taint: task.created can't make anything message the client (6.3).
  emit(db, 'task.created', { coachId, clientId, summary: `Task: ${title.slice(0, 80)}`, taskId: id, source, ...(aiDerived || ['voice', 'ai'].includes(source) ? { aiDerived: true } : {}) });
  return reload(db, id);
}

// MARK: - Routes

function today(ctx) { const now = requestNow(ctx); return { now, today: londonDay(now) }; }

function list(_req, ctx) {
  requireCoach(ctx);
  const { now, today: d } = today(ctx);
  const status = ctx.query.status ? oneOf(ctx.query.status, 'status', ['open', 'done', 'all']) : null;
  const bucket = ctx.query.bucket ? oneOf(ctx.query.bucket, 'bucket', BUCKETS) : null;
  const where = [], args = [ctx.user.id, ctx.user.id];
  if (ctx.query.clientId) { where.push('t.client_id=?'); args.push(clientFor(ctx, ctx.query.clientId).id); }
  if (status === 'open') where.push("t.status='open'");
  else if (status === 'done') where.push("t.status='done'");
  else if (!status) { where.push("(t.status='open' OR t.done_at>=?)"); args.push(londonToUtc(mondayOf(d)).toISOString()); }
  const rows = ctx.db.prepare(`SELECT t.*, u.name client_name ${VISIBLE} ${where.map(w => `AND ${w}`).join(' ')}
    ORDER BY t.status='done', t.position, t.due_on IS NULL, t.due_on, t.due_at, t.created_at LIMIT 1000`).all(...args);
  const tasks = rows.map(t => taskOut(t, d, now));
  const counts = Object.fromEntries(BUCKETS.map(b => [b, 0]));
  for (const t of tasks) if (t.bucket) counts[t.bucket]++;
  return { today: d, weekEnd: addDays(mondayOf(d), 6), counts, tasks: bucket ? tasks.filter(t => t.bucket === bucket) : tasks };
}

function create(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const { now } = today(ctx);
  const client = b.clientId ? clientFor(ctx, b.clientId) : null;
  const { dueOn, dueAt } = cleanDue(b, null, now);
  const row = tx(ctx.db, () => createTask(ctx.db, {
    coachId: ctx.user.id, clientId: client?.id ?? null, title: str(b.title, 'title', { max: 200 }),
    notes: str(b.notes ?? '', 'notes', { max: 4000, min: 0 }), dueOn, dueAt,
    priority: b.priority === undefined ? 'normal' : oneOf(b.priority, 'priority', PRIORITIES), tags: cleanTags(b.tags),
    source: b.source === undefined ? 'manual' : oneOf(b.source, 'source', SOURCES), sourceRef: str(b.sourceRef ?? null, 'sourceRef', { max: 80, optional: true }), now,
  }));
  return { task: taskOut(row, londonDay(now), now) };
}

function getOne(_req, ctx) {
  requireCoach(ctx);
  const { now, today: d } = today(ctx);
  return { task: taskOut(taskFor(ctx, ctx.params.id), d, now) };
}

function patch(_req, ctx) {
  requireCoach(ctx);
  const t = taskFor(ctx, ctx.params.id);
  const b = ctx.body;
  const { now, today: d } = today(ctx);
  const sets = {};
  if (b.title !== undefined) sets.title = str(b.title, 'title', { max: 200 });
  if (b.notes !== undefined) sets.notes = str(b.notes ?? '', 'notes', { max: 4000, min: 0 });
  if (b.clientId !== undefined) sets.client_id = b.clientId === null ? null : clientFor(ctx, b.clientId).id;
  if (b.priority !== undefined) sets.priority = oneOf(b.priority, 'priority', PRIORITIES);
  if (b.tags !== undefined) sets.tags = JSON.stringify(cleanTags(b.tags));
  if (b.position !== undefined) sets.position = num(b.position, 'position', { min: -1e12, max: 1e12 });
  if (b.dueOn !== undefined || b.dueAt !== undefined || b.dueTime !== undefined) {
    const { dueOn, dueAt } = cleanDue(b, t, now);
    Object.assign(sets, { due_on: dueOn, due_at: dueAt, snoozed_until: null });
    if (dueKey({ due_on: dueOn, due_at: dueAt }) !== dueKey(t)) sets.due_notified = null;
  }
  // Unlinking the client of a task about someone else's client would hand it to this coach; keep the writer as the owner.
  if (sets.client_id === null && t.client_id) sets.coach_id = ctx.user.id;
  const keys = Object.keys(sets);
  if (keys.length) ctx.db.prepare(`UPDATE tasks SET ${keys.map(k => `${k}=?`).join(', ')} WHERE id=?`).run(...keys.map(k => sets[k]), t.id);
  return { task: taskOut(reload(ctx.db, t.id), d, now) };
}

function markDone(_req, ctx) {
  requireCoach(ctx);
  const t = taskFor(ctx, ctx.params.id);
  const { now, today: d } = today(ctx);
  tx(ctx.db, () => {
    if (ctx.db.prepare("UPDATE tasks SET status='done', done_at=? WHERE id=? AND status='open'").run(now.toISOString(), t.id).changes) {
      emit(ctx.db, 'task.done', { coachId: ctx.user.id, clientId: t.client_id, summary: `Done: ${t.title.slice(0, 80)}`, taskId: t.id });
    }
  });
  return { task: taskOut(reload(ctx.db, t.id), d, now) };
}

function reopen(_req, ctx) {
  requireCoach(ctx);
  const t = taskFor(ctx, ctx.params.id);
  const { now, today: d } = today(ctx);
  ctx.db.prepare("UPDATE tasks SET status='open', done_at=NULL WHERE id=?").run(t.id);
  return { task: taskOut(reload(ctx.db, t.id), d, now) };
}

function snooze(_req, ctx) {
  requireCoach(ctx);
  const t = taskFor(ctx, ctx.params.id);
  const { now, today: d } = today(ctx);
  const raw = ctx.body.until;
  let until, dueOn, dueAt;
  if (typeof raw === 'string' && /^\d{4}-\d\d-\d\d$/.test(raw)) {
    dueOn = dayParam(raw, 'until');
    dueAt = t.due_at ? londonToUtc(dueOn, londonClock(new Date(t.due_at))).toISOString() : null;
    until = (dueAt ? new Date(dueAt) : londonToUtc(dueOn, '08:00')).toISOString();
  } else {
    until = instant(raw, 'until');
    dueAt = until;
    dueOn = londonDay(new Date(until));
  }
  if (until <= now.toISOString()) fail(400, 'until must be in the future');
  ctx.db.prepare("UPDATE tasks SET status='open', done_at=NULL, snoozed_until=?, due_on=?, due_at=?, due_notified=NULL WHERE id=?").run(until, dueOn, dueAt, t.id);
  return { task: taskOut(reload(ctx.db, t.id), d, now) };
}

function remove(_req, ctx) {
  requireCoach(ctx);
  const t = taskFor(ctx, ctx.params.id);
  ctx.db.prepare('DELETE FROM tasks WHERE id=?').run(t.id);
  return { ok: true };
}

function parse(_req, ctx) {
  requireCoach(ctx);
  const { now, today: d } = today(ctx);
  const text = str(ctx.body.text, 'text', { max: 400 });
  const clients = ctx.db.prepare("SELECT id, name FROM users WHERE role='client' AND coach_id=?").all(ctx.user.id);
  return parseTask(text, { today: d, now, clients });
}

// MARK: - The due clock

/**
 * Every minute: open tasks whose moment has come (their time, or 08:00 London
 * on their day) emit task.due and notify the coach, once per due moment
 * (claimed in due_notified before the side effects). A task created already
 * overdue, or a notice more than 36 h late, is marked without a notice.
 */
export function runDue(db, config, now = new Date()) {
  const d = londonDay(now);
  const rows = db.prepare(`SELECT t.*, u.name client_name, u.coach_id client_coach FROM tasks t LEFT JOIN users u ON u.id=t.client_id
    WHERE t.status='open' AND t.due_on IS NOT NULL AND t.due_on<=? AND (t.due_notified IS NULL OR t.due_notified<>COALESCE(t.due_at, t.due_on))
    ORDER BY t.due_on LIMIT 500`).all(d);
  let sent = 0;
  for (const t of rows) {
    const at = dueInstant(t);
    if (!at || at.getTime() > now.getTime()) continue;
    const coachId = t.client_id ? t.client_coach : t.coach_id;
    const quiet = at.getTime() < Date.parse(t.created_at) || now.getTime() - at.getTime() > STALE_MS || !coachId;
    tx(db, () => {
      if (!db.prepare('UPDATE tasks SET due_notified=? WHERE id=? AND (due_notified IS NULL OR due_notified<>?)').run(dueKey(t), t.id, dueKey(t)).changes) return;
      if (quiet) return;
      emit(db, 'task.due', { coachId, clientId: t.client_id, summary: `Due: ${t.title.slice(0, 80)}`, taskId: t.id });
      notifyCoach(db, config, coachId, {
        clientId: t.client_id, kind: 'task', title: `Due: ${t.title.slice(0, 120)}`,
        body: [t.client_name, t.due_at ? `at ${londonClock(at)}` : 'today', t.priority === 'high' ? 'high priority' : null].filter(Boolean).join(' · '),
        path: `/tasks?panel=task:${t.id}`, icon: 'task_alt', tone: t.priority === 'high' ? 'attention' : 'data', dedupe: `task:${t.id}:${dueKey(t)}`, now,
      });
      sent++;
    });
  }
  return sent;
}

// MARK: - Demo

function demoBuild(db, ctx) {
  schema(db);
  const { coach, clients, byName, today } = ctx;
  const ids = JSON.stringify([coach.id, ...clients.map(c => c.id)]);
  db.prepare('DELETE FROM tasks WHERE coach_id IN (SELECT value FROM json_each(?)) OR client_id IN (SELECT value FROM json_each(?))').run(ids, ids);
  const live = today === londonDay();
  const at = (d, t) => londonToUtc(d, t).toISOString();
  const sunday = addDays(mondayOf(today), 6);
  const inWeek = n => { const d = addDays(today, n); return d <= sunday ? d : addDays(today, n); };
  const monday0 = londonToUtc(mondayOf(today)).getTime();
  const doneAt = mins => new Date(Math.max(monday0 + 60_000, (live ? Date.now() : londonToUtc(today, '09:00').getTime()) - mins * 60_000)).toISOString();
  const lastVoice = c => (c ? db.prepare("SELECT id FROM messages WHERE client_id=? AND from_role='client' ORDER BY at DESC LIMIT 1").get(c.id)?.id ?? null : null);
  const rows = [
    ['Call Sam about his left knee', 'Tight after split squats on Tuesday. Check it before Thursday\'s lower session.', byName.Sam, addDays(today, -2), null, 'high', ['injury'], 'manual', null, -6],
    ['Check in with Leo: quiet four days', 'Created by the "Gone quiet" automation.', byName.Leo, addDays(today, -1), null, 'normal', ['retention'], 'automation', null, -4],
    ['Review Priya\'s race-week plan', 'Second run this week? Race is in five weeks.', byName.Priya, today, '12:30', 'high', ['race'], 'manual', null, -3],
    ['Swap Rory\'s Thursday intervals for an easy run', 'From Rory\'s voice note: calf tight after intervals.', byName.Rory, today, null, 'normal', ['programming'], 'voice', lastVoice(byName.Rory), -1],
    ['Chase Tom\'s November invoice', 'Second reminder went out on Friday. Call if nothing by tonight.', byName.Tom, today, '17:00', 'normal', ['billing'], 'dunning', null, -2],
    ['Plan Alex\'s next hypertrophy block', 'Eight weeks, keep the four-day split.', byName.Alex, inWeek(2), null, 'normal', ['programming'], 'manual', null, -5],
    ['Write Sam\'s monthly letter', '', byName.Sam, inWeek(3), '09:00', 'normal', ['letters'], 'manual', null, -1],
    ['Book Priya\'s post-race review', 'Planning session the week after the race.', byName.Priya, addDays(today, 9), null, 'low', ['race'], 'manual', null, -2],
    ['Order two 24 kg kettlebells for the studio', '', null, addDays(today, 12), null, 'low', ['studio'], 'manual', null, -8],
    ['Draft the January reset campaign', 'Four weeks, habits first. Price it for existing clients.', null, null, null, 'normal', ['marketing'], 'manual', null, -9],
  ];
  const insert = db.prepare(`INSERT INTO tasks (id, coach_id, client_id, title, notes, due_on, due_at, priority, tags, status, snoozed_until, source, source_ref, created_at, done_at, position, due_notified)
    VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?)`);
  rows.forEach(([title, notes, client, due, time, priority, tags, source, ref, createdAgo], i) => {
    const dueAt = due && time ? at(due, time) : null;
    // Overdue ones have had their notice already; today's fire on the next clock tick.
    const notified = due && due < today ? (dueAt ?? due) : null;
    insert.run(newId('tk'), coach.id, client?.id ?? null, title, notes, due, dueAt, priority, JSON.stringify(tags), 'open', source, ref,
      at(addDays(today, createdAgo), '08:15'), null, i, notified);
  });
  [['Send Leo the back-care guide', byName.Leo, ['programming'], 95], ['Confirm Rory\'s new 1:1 time', byName.Rory, ['sessions'], 30]]
    .forEach(([title, client, tags, mins], i) => insert.run(newId('tk'), coach.id, client?.id ?? null, title, '', today, null, 'normal', JSON.stringify(tags), 'done', 'manual', null,
      at(addDays(today, -2), '10:00'), doneAt(mins), 100 + i, today));
}

// MARK: - The feature

function schema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
      due_on TEXT, due_at TEXT, priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
      tags TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
      snoozed_until TEXT, source TEXT NOT NULL DEFAULT 'manual', source_ref TEXT,
      created_at TEXT NOT NULL, done_at TEXT, position REAL NOT NULL DEFAULT 0,
      due_notified TEXT);
    CREATE INDEX IF NOT EXISTS tasks_coach_open ON tasks(coach_id, status, due_on);
    CREATE INDEX IF NOT EXISTS tasks_client ON tasks(client_id);`);
}

const clientName = (db, id) => (id ? db.prepare('SELECT name FROM users WHERE id=?').get(id)?.name ?? null : null);

export const feature = {
  name: 'tasks',
  namespaces: ['task'],
  schema,
  routes(r) {
    r.add('GET', '/api/tasks', list);
    r.add('POST', '/api/tasks', create);
    r.add('POST', '/api/tasks/parse', parse);
    r.add('GET', '/api/tasks/:id', getOne);
    r.add('PATCH', '/api/tasks/:id', patch);
    r.add('DELETE', '/api/tasks/:id', remove);
    r.add('POST', '/api/tasks/:id/done', markDone);
    r.add('POST', '/api/tasks/:id/reopen', reopen);
    r.add('POST', '/api/tasks/:id/snooze', snooze);
  },
  clocks: [{ id: 'tasks.due', everyMs: 60_000, run: (db, config, now) => runDue(db, config, now) }],
  emits: {
    'task.created': { label: 'A task was added', payload: ['taskId', 'source'] },
    'task.done': { label: 'A task was done', payload: ['taskId'] },
    'task.due': { label: 'A task fell due', payload: ['taskId'] },
  },
  actions: {
    'task.create': {
      label: 'Create a task for me', clientFacing: false,
      params: [
        { key: 'title', label: 'Task', type: 'template', required: true },
        { key: 'notes', label: 'Notes', type: 'template' },
        { key: 'dueInDays', label: 'Due in (days)', type: 'number', default: 0 },
        { key: 'priority', label: 'Priority', type: 'enum', options: [{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }], default: 'normal' },
      ],
      run(db, _config, ctx) {
        const title = render(db, ctx.coachId, ctx.client, ctx.params.title, { extra: ctx.extra, now: ctx.now }).text.trim().slice(0, 200);
        if (!title) return 'Skipped: empty title';
        const notes = ctx.params.notes ? render(db, ctx.coachId, ctx.client, ctx.params.notes, { extra: ctx.extra, now: ctx.now }).text : '';
        const days = Math.max(0, Math.min(365, Math.round(Number(ctx.params.dueInDays ?? 0)) || 0));
        const type = ctx.event?.type ?? '';
        const source = ctx.source && SOURCES.includes(ctx.source) ? ctx.source
          : type.startsWith('voice.') ? 'voice' : type.startsWith('ai.') ? 'ai' : /^(invoice|billing|payment)\./.test(type) ? 'dunning' : 'automation';
        const ref = ctx.sourceRef ?? (source === 'voice' ? ctx.event?.payload?.messageId : source === 'dunning' ? ctx.event?.payload?.invoiceId : ctx.automationId) ?? null;
        createTask(db, { coachId: ctx.coachId, clientId: ctx.client.id, title, notes, dueOn: addDays(londonDay(ctx.now), days), priority: PRIORITIES.includes(ctx.params.priority) ? ctx.params.priority : 'normal', source, sourceRef: ref ? String(ref).slice(0, 80) : null, now: ctx.now,
          aiDerived: !!ctx.aiDerived || !!ctx.event?.payload?.aiDerived });
        return 'Created task';
      },
    },
  },
  diary(db, coach, day) {
    return db.prepare(`SELECT t.*, u.name client_name ${VISIBLE} AND t.due_on=? ORDER BY t.due_at IS NULL, t.due_at, t.position`).all(coach.id, coach.id, day)
      .map(t => ({
        at: t.due_at, day, kind: 'task', icon: t.status === 'done' ? 'done_all' : 'task_alt', title: t.title,
        detail: [t.client_name, t.status === 'done' ? 'Done' : t.priority === 'high' ? 'High priority' : 'Task due'].filter(Boolean).join(' · '),
        path: `/tasks?panel=task:${t.id}`, tone: t.status === 'done' ? 'ok' : t.priority === 'high' ? 'attention' : 'data',
      }));
  },
  search(db, coach, q, limit) {
    const like = likeAny(q);
    return db.prepare(`SELECT t.*, u.name client_name ${VISIBLE} AND (t.title LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\') ORDER BY t.status='done', t.created_at DESC LIMIT ?`)
      .all(coach.id, coach.id, like, like, limit)
      .map(t => ({
        type: 'task', id: t.id, title: t.title, detail: [t.status === 'done' ? 'Done' : t.due_on ? `Due ${t.due_on}` : 'Task', t.client_name].filter(Boolean).join(' · '),
        path: `/tasks?panel=task:${t.id}`, icon: 'task_alt', score: Math.max(matchScore(t.title, q), matchScore(t.notes, q) * 0.6) * (t.status === 'done' ? 0.7 : 1), at: t.created_at,
      }));
  },
  timeline(db, coach, client, before, limit) {
    if (client.coach_id !== coach.id) return [];
    const cut = before || '9999';
    const items = [];
    for (const t of db.prepare('SELECT * FROM tasks WHERE client_id=? AND created_at<? ORDER BY created_at DESC LIMIT ?').all(client.id, cut, limit)) {
      items.push({ at: t.created_at, kind: 'task', icon: 'task_alt', tone: null, title: `Task added: ${t.title}`, detail: t.due_on ? `Due ${t.due_on}` : '', path: `/tasks?panel=task:${t.id}` });
    }
    for (const t of db.prepare("SELECT * FROM tasks WHERE client_id=? AND status='done' AND done_at<? ORDER BY done_at DESC LIMIT ?").all(client.id, cut, limit)) {
      items.push({ at: t.done_at, kind: 'task', icon: 'done_all', tone: 'ok', title: `Task done: ${t.title}`, detail: '', path: `/tasks?panel=task:${t.id}` });
    }
    return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
  },
  badges(db, coach) {
    const d = londonDay();
    const n = db.prepare(`SELECT COUNT(*) n ${VISIBLE} AND t.status='open' AND t.due_on<=?`).get(coach.id, coach.id, d).n;
    return { tasks: n };
  },
  exportFor(db, user) {
    const out = t => ({ title: t.title, notes: t.notes, dueOn: t.due_on, dueAt: t.due_at, priority: t.priority, status: t.status, source: t.source, createdAt: t.created_at, doneAt: t.done_at });
    if (user.role === 'client') return { tasks: db.prepare('SELECT * FROM tasks WHERE client_id=? ORDER BY created_at').all(user.id).map(out) };
    return { tasks: db.prepare('SELECT * FROM tasks WHERE coach_id=? ORDER BY created_at').all(user.id).map(t => ({ ...out(t), client: clientName(db, t.client_id) })) };
  },
  demo: { build: demoBuild },
};
