import { initials, requestNow, requireCoach } from '../access.mjs';
import { AiError, complete, redactForAi, surnameOf } from '../ai.mjs';
import { emit } from '../events.mjs';
import { clientFacts } from '../facts.mjs';
import { flaggedAnswers } from '../forms.mjs';
import { fail, instant, num, oneOf } from '../http.mjs';
import { needsYou } from '../needs.mjs';
import { notifyCoach, quietWindow, TONES } from '../notifications.mjs';
import { limit as rateLimit } from '../ratelimit.mjs';
import { allEvents, allFacts, featureNames, hooks } from '../registry.mjs';
import { likeAny, matchScore } from '../search.mjs';
import { coachPref, newId, nowIso, setCoachPref, tx } from '../store.mjs';
import { addDays, londonClock, londonDay, londonToUtc, weekday } from '../time.mjs';

/**
 * Command (WP1, docs/design/desk-v2.md F1–F4): the Command Centre's server
 * side, the unified Inbox, the default event → notification handlers and the
 * notification settings.
 *
 * - GET  /api/command/summary            counts for the Today header
 * - GET  /api/command/activity           the live activity feed (events, then history)
 * - POST /api/command/brief              the 5-bullet morning brief (ai.complete, purpose 'brief')
 * - GET  /api/inbox, POST /api/inbox/state   the Inbox and its done/snoozed state
 * - GET/PUT /api/command/notify-settings  Settings › Notifications
 *
 * Everything is coach-only and scoped to the coach's CURRENT clients (a stored
 * coach_id on a client-linked row is never trusted: admin can reassign).
 */

const URGENT_WORDS = /\b(pain|painful|injur\w*|hurt\w*|sharp|swollen|swelling|numb\w*|dizz\w*|faint\w*|sick|unwell)\b/i; // same list as needs.mjs
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const first = name => String(name ?? '').trim().split(/\s+/)[0] || 'Someone';
const enc = encodeURIComponent;
const person = u => (u ? { id: u.id, name: u.name, initials: initials(u.name) } : null);

/** "Tue 4 Nov 07:00" in London time. */
export function whenLabel(iso) {
  const d = new Date(iso);
  const day = londonDay(d);
  return `${DAY[weekday(day) - 1]} ${Number(day.slice(8))} ${MONTH[Number(day.slice(5, 7)) - 1]} ${londonClock(d)}`;
}

/** This coach's client, by id, as of now (null for a foreign, missing or reassigned one). */
const ownClient = (db, coachId, clientId) => (clientId
  ? db.prepare("SELECT * FROM users WHERE id=? AND role='client' AND coach_id=?").get(clientId, coachId) ?? null
  : null);

// MARK: - Inbox (F4)

export const INBOX_KINDS = ['message', 'voice', 'form', 'checkin', 'flag', 'draft', 'lead', 'waitlist', 'testimonial'];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * The core providers: unread client threads, check-ins and form answers not yet
 * reviewed. Anything with pain in it (urgent words in an unread message, a sore
 * area in a check-in, a "yes" on a flagged form question) is a `flag` item
 * instead, keyed `flag:<source>:…`, so the Flags filter is the urgent list and
 * nothing shows twice. A thread's key carries the newest client message id, so
 * a new message reopens a thread marked done.
 */
function coreItems(db, coach) {
  const items = [];
  const unread = db.prepare(`SELECT m.id, m.client_id, m.text, m.kind, m.at FROM messages m
    JOIN users u ON u.id=m.client_id AND u.role='client' AND u.coach_id=?
    WHERE m.from_role='client' AND m.read_at IS NULL ORDER BY m.at`).all(coach.id);
  // With the voice feature loaded, its inbox hook lists each client voice note (with the analysis), so threads leave them out.
  const voiceListed = featureNames().includes('voice');
  const threads = new Map();
  for (const m of unread) if (!(voiceListed && m.kind === 'voice')) threads.set(m.client_id, [...(threads.get(m.client_id) ?? []), m]);
  for (const [clientId, list] of threads) {
    const newest = list.at(-1);
    const pain = list.find(m => URGENT_WORDS.test(m.text ?? ''));
    const voice = newest.kind === 'voice';
    const kind = pain ? 'flag' : voice ? 'voice' : 'message';
    const text = (newest.text ?? '').trim();
    items.push({
      key: `${pain ? 'flag:' : ''}thread:${clientId}:${newest.id}`, kind, clientId,
      title: pain ? `Mentions ${pain.text.match(URGENT_WORDS)[0].toLowerCase()} in a message`
        : voice ? 'Sent a voice note' : list.length === 1 ? 'Sent a message' : `Sent ${list.length} messages`,
      preview: voice && !text ? 'Voice note' : text.slice(0, 280),
      at: newest.at, icon: pain ? 'healing' : voice ? 'graphic_eq' : 'chat_bubble', tone: pain ? 'urgent' : 'data',
      path: `/messages/${enc(clientId)}`, ref: { type: 'thread', id: clientId }, actions: [], source: 'core',
    });
  }
  const checkins = db.prepare(`SELECT k.*, u.name client_name FROM checkins k JOIN users u ON u.id=k.client_id AND u.role='client' AND u.coach_id=?
    WHERE k.reviewed_at IS NULL ORDER BY k.submitted_at`).all(coach.id);
  for (const k of checkins) {
    let pain = [];
    try { pain = JSON.parse(k.pain) ?? []; } catch { pain = []; }
    const sore = pain.length ? `Sore: ${pain.join(', ').toLowerCase()}` : null;
    const lines = [sore, k.note, k.struggle ? `Struggle: ${k.struggle}` : null, k.win ? `Win: ${k.win}` : null].filter(Boolean);
    items.push({
      key: `${pain.length ? 'flag:' : ''}checkin:${k.id}`, kind: pain.length ? 'flag' : 'checkin', clientId: k.client_id,
      title: pain.length ? 'Pain in a weekly check-in' : 'Weekly check-in',
      preview: (lines.join(' · ') || `Energy ${k.energy}/5 · sleep ${k.sleep}/5`).slice(0, 280),
      at: k.submitted_at, icon: pain.length ? 'healing' : 'monitor_heart', tone: pain.length ? 'urgent' : 'data',
      path: `/clients/${enc(k.client_id)}/checkins`, ref: { type: 'checkin', id: k.id, week: k.week }, source: 'core',
      actions: [{ id: 'review', label: 'Mark reviewed', method: 'POST', url: `/api/checkins/${enc(k.id)}/review`, body: { reply: '' } }],
    });
  }
  const forms = db.prepare(`SELECT r.*, u.name client_name FROM form_requests r JOIN users u ON u.id=r.client_id AND u.role='client' AND u.coach_id=?
    WHERE r.submitted_at IS NOT NULL AND r.reviewed_at IS NULL ORDER BY r.submitted_at`).all(coach.id);
  for (const r of forms) {
    const flagged = flaggedAnswers(r);
    items.push({
      key: `${flagged.length ? 'flag:' : ''}form:${r.id}`, kind: flagged.length ? 'flag' : 'form', clientId: r.client_id,
      title: flagged.length ? `Health flag on ${r.name}` : `Answered ${r.name}`,
      preview: flagged.length ? `Yes to: ${flagged.map(q => q.label).join(' · ')}`.slice(0, 280) : formPreview(r),
      at: r.submitted_at, icon: flagged.length ? 'gpp_maybe' : 'description', tone: flagged.length ? 'urgent' : 'data',
      path: `/clients/${enc(r.client_id)}/forms`, ref: { type: 'form', id: r.id }, source: 'core',
      actions: [{ id: 'review', label: 'Mark reviewed', method: 'POST', url: `/api/form-requests/${enc(r.id)}/review` }],
    });
  }
  return items;
}

/** The first written answer of a form, as its preview. */
function formPreview(r) {
  try {
    const answers = JSON.parse(r.answers ?? '{}');
    const q = JSON.parse(r.questions).find(x => typeof answers[x.id] === 'string' && answers[x.id].trim());
    return q ? `${q.label} ${answers[q.id].trim()}`.slice(0, 280) : `${Object.keys(answers).length} answers`;
  } catch { return ''; }
}

/** A provider's item, checked and cleaned; null to drop it. Only this coach's clients (or no client). */
function cleanItem(raw, f, mine) {
  if (!raw || typeof raw.key !== 'string' || !raw.key || raw.key.length > 200 || typeof raw.title !== 'string') return null;
  const clientId = raw.clientId ?? null;
  if (clientId !== null && !mine.has(clientId)) return null;
  const actions = (Array.isArray(raw.actions) ? raw.actions : []).filter(a => a && typeof a.label === 'string'
    && METHODS.includes(String(a.method).toUpperCase()) && typeof a.url === 'string' && a.url.startsWith('/api/'))
    .slice(0, 4).map(a => ({ id: String(a.id ?? a.label), label: a.label.slice(0, 40), method: String(a.method).toUpperCase(), url: a.url, ...(a.body !== undefined ? { body: a.body } : {}) }));
  return {
    key: raw.key, kind: typeof raw.kind === 'string' && raw.kind ? raw.kind.slice(0, 30) : f.name, clientId,
    title: raw.title.slice(0, 200), preview: String(raw.preview ?? '').slice(0, 400), at: typeof raw.at === 'string' ? raw.at : null,
    icon: typeof raw.icon === 'string' ? raw.icon : 'inbox', tone: TONES.includes(raw.tone) ? raw.tone : 'data',
    path: typeof raw.path === 'string' && raw.path.startsWith('/') ? raw.path : null, actions, source: f.name,
  };
}

/**
 * Every Inbox item for a coach, with its state (open, snoozed or done) at `now`.
 * Feature providers (`inbox` hook) join the core ones; one that throws is
 * logged and skipped. A key seen twice keeps its first item.
 */
export function inboxItems(db, coach, { now = new Date() } = {}) {
  const clients = db.prepare("SELECT id, name FROM users WHERE role='client' AND coach_id=?").all(coach.id);
  const byId = new Map(clients.map(c => [c.id, c]));
  const mine = new Set(byId.keys());
  let items = coreItems(db, coach);
  for (const [f, fn] of hooks('inbox')) {
    try {
      const list = fn(db, coach, { now }) ?? [];
      for (const raw of Array.isArray(list) ? list : []) { const item = cleanItem(raw, f, mine); if (item) items.push(item); }
    } catch (e) {
      console.error(`inbox hook of ${f.name} failed`, e);
    }
  }
  const seen = new Set();
  items = items.filter(i => !seen.has(i.key) && seen.add(i.key));
  const states = new Map(db.prepare('SELECT * FROM inbox_state WHERE coach_id=?').all(coach.id).map(s => [s.item_key, s]));
  const at = now.toISOString();
  return items.map(i => {
    const s = states.get(i.key);
    const status = !s ? 'open' : s.status === 'done' ? 'done' : s.snooze_until && s.snooze_until > at ? 'snoozed' : 'open';
    return { ...i, client: person(byId.get(i.clientId)), status, snoozeUntil: status === 'snoozed' ? s.snooze_until : null, stateAt: s?.updated_at ?? null };
  });
}

/** {all, message, voice, …, snoozed, done} for a list of items. */
function countsOf(items) {
  const counts = { all: 0, snoozed: 0, done: 0, ...Object.fromEntries(INBOX_KINDS.map(k => [k, 0])) };
  for (const i of items) {
    if (i.status === 'open') { counts.all++; counts[i.kind] = (counts[i.kind] ?? 0) + 1; } else counts[i.status]++;
  }
  return counts;
}

const openCount = (db, coach, now) => inboxItems(db, coach, { now }).filter(i => i.status === 'open').length;

function getInbox(_req, ctx) {
  requireCoach(ctx);
  const now = requestNow(ctx);
  const filter = ctx.query.filter ?? 'all';
  if (filter !== 'all' && filter !== 'snoozed' && filter !== 'done' && !/^[a-z][a-zA-Z0-9-]{0,29}$/.test(filter)) fail(400, 'filter is not known');
  const max = ctx.query.limit === undefined ? 50 : num(Number(ctx.query.limit), 'limit', { min: 1, max: 200, int: true });
  const all = inboxItems(ctx.db, ctx.user, { now });
  const urgentFirst = (a, b) => (a.tone === 'urgent') - (b.tone === 'urgent');
  let list;
  if (filter === 'snoozed') list = all.filter(i => i.status === 'snoozed').sort((a, b) => a.snoozeUntil.localeCompare(b.snoozeUntil));
  else if (filter === 'done') list = all.filter(i => i.status === 'done').sort((a, b) => String(b.stateAt).localeCompare(String(a.stateAt)));
  else {
    list = all.filter(i => i.status === 'open' && (filter === 'all' || i.kind === filter))
      .sort((a, b) => -urgentFirst(a, b) || String(b.at ?? '').localeCompare(String(a.at ?? '')));
  }
  return { items: list.slice(0, max).map(({ stateAt, ...i }) => i), counts: countsOf(all) };
}

function setInboxState(_req, ctx) {
  requireCoach(ctx);
  const now = requestNow(ctx);
  const { keys } = ctx.body;
  if (!Array.isArray(keys) || !keys.length || keys.length > 500 || keys.some(k => typeof k !== 'string' || !k || k.length > 200)) fail(400, 'keys must be a list of 1 to 500 item keys');
  const status = oneOf(ctx.body.status, 'status', ['done', 'snoozed', 'open']);
  let until = null;
  if (status === 'snoozed') {
    until = instant(ctx.body.until, 'until');
    if (until <= now.toISOString()) fail(400, 'until must be in the future');
  }
  // Only items this coach can see right now: one unknown key fails the whole request and writes nothing.
  const byKey = new Map(inboxItems(ctx.db, ctx.user, { now }).map(i => [i.key, i]));
  for (const key of keys) if (!byKey.has(key)) fail(404, 'Not found');
  const at = nowIso();
  tx(ctx.db, () => {
    for (const key of new Set(keys)) {
      const item = byKey.get(key);
      if (status === 'open') {
        ctx.db.prepare('DELETE FROM inbox_state WHERE coach_id=? AND item_key=?').run(ctx.user.id, key);
        continue;
      }
      ctx.db.prepare(`INSERT INTO inbox_state (coach_id, item_key, client_id, status, snooze_until, updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(coach_id, item_key) DO UPDATE SET client_id=excluded.client_id, status=excluded.status, snooze_until=excluded.snooze_until, updated_at=excluded.updated_at`)
        .run(ctx.user.id, key, item.clientId, status, until, at);
      if (status === 'done') emit(ctx.db, 'inbox.done', { coachId: ctx.user.id, clientId: item.clientId, summary: `Done: ${item.title}`.slice(0, 120), key, kind: item.kind });
    }
  });
  return { ok: true };
}

/**
 * Rows for items that are gone are deleted after 60 days (a done row whose item
 * still exists stays: it is what keeps the item hidden).
 */
export function pruneInbox(db, now = new Date()) {
  const cutoff = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  let gone = 0;
  for (const { coach_id: coachId } of db.prepare('SELECT DISTINCT coach_id FROM inbox_state WHERE updated_at<?').all(cutoff)) {
    const coach = db.prepare("SELECT * FROM users WHERE id=? AND role='coach'").get(coachId);
    if (!coach) continue;
    const live = new Set(inboxItems(db, coach, { now }).map(i => i.key));
    for (const r of db.prepare('SELECT item_key FROM inbox_state WHERE coach_id=? AND updated_at<?').all(coachId, cutoff)) {
      if (!live.has(r.item_key)) gone += db.prepare('DELETE FROM inbox_state WHERE coach_id=? AND item_key=?').run(coachId, r.item_key).changes;
    }
  }
  return gone;
}

// MARK: - Summary (F1)

/** Today's header counts: the needs-you list, sessions, letters and the open Inbox. `duePence` only when billing's fact exists. */
export function commandSummary(db, coach, now = new Date()) {
  const n = needsYou(db, coach, now);
  let duePence = null;
  if (allFacts().some(f => f.id === 'billing.balance')) {
    const ids = db.prepare("SELECT id FROM users WHERE role='client' AND coach_id=?").all(coach.id).map(c => c.id);
    const facts = clientFacts(db, coach.id, ids, { only: ['billing.balance'], now });
    duePence = [...facts.values()].reduce((s, f) => s + Math.max(0, Number(f['billing.balance']) || 0), 0);
  }
  return {
    needs: n.items.length, urgent: n.items.filter(i => i.rank === 1).length,
    sessionsToday: n.sessionsToday.total, sessionsDone: n.sessionsToday.done,
    inbox: openCount(db, coach, now), lettersDue: n.lettersDue.count, duePence,
  };
}

// MARK: - Activity (F1)

const HIDDEN_TYPES = ['day.started', 'inbox.done'];
const LOOK = {
  'message.received': ['chat_bubble', 'data'], 'message.sent': ['send', 'data'], 'checkin.submitted': ['monitor_heart', 'data'],
  'form.submitted': ['description', 'data'], 'form.sent': ['description', 'data'], 'booking.created': ['event_available', 'ok'],
  'booking.cancelled': ['event_busy', 'attention'], 'workout.completed': ['fitness_center', 'ok'], 'membership.changed': ['workspace_premium', 'accent'],
  'letter.published': ['drafts', 'accent'], 'letter.delivered': ['drafts', 'accent'], 'commitment.reviewed': ['task_alt', 'ok'],
  'client.joined': ['person_add', 'ok'], 'client.tagged': ['label', 'data'], 'client.untagged': ['label', 'data'],
};

/** Where an activity row leads. */
function activityPath(type, clientId) {
  if (!clientId) return type.startsWith('booking.') ? '/schedule' : null;
  const c = enc(clientId);
  if (type.startsWith('message.')) return `/messages/${c}`;
  if (type.startsWith('checkin.')) return `/clients/${c}/checkins`;
  if (type.startsWith('form.')) return `/clients/${c}/forms`;
  if (type.startsWith('booking.')) return `/clients/${c}/sessions`;
  if (type.startsWith('workout.')) return `/clients/${c}/plan`;
  if (type.startsWith('letter.')) return `/clients/${c}/letters`;
  return `/clients/${c}`;
}

function activityOut(row, labels) {
  const payload = typeof row.payload === 'string' ? safeJson(row.payload) : row.payload ?? {};
  const [icon, tone0] = LOOK[row.type] ?? ['bolt', 'data'];
  const voice = row.type === 'message.received' && /^voice/i.test(row.summary ?? '');
  const tone = row.type === 'form.submitted' && payload.flagged > 0 ? 'urgent'
    : row.type === 'checkin.submitted' && payload.pain ? 'urgent' : tone0;
  const label = labels.get(row.type) ?? row.type;
  return {
    seq: row.seq ?? null, key: row.seq ? `ev:${row.seq}` : row.key, type: row.type, at: row.at,
    summary: row.summary || label, label, icon: voice ? 'graphic_eq' : icon, tone,
    client: row.client_id && row.name ? { id: row.client_id, name: row.name, initials: initials(row.name) } : null,
    path: activityPath(row.type, row.client_id), history: !row.seq,
  };
}
const safeJson = s => { try { return JSON.parse(s); } catch { return {}; } };

/**
 * History before the coach's first event, from the domain tables, so the feed
 * is not empty on a fresh deploy or a freshly built demo world. Summaries only,
 * never message bodies. The last 30 days, this coach's current clients.
 */
function historyRows(db, coachId, beforeIso, sinceIso, max) {
  const J = "JOIN users u ON u.id=x.client_id AND u.role='client' AND u.coach_id=?";
  const q = (sql, ...args) => db.prepare(sql).all(coachId, ...args, beforeIso, sinceIso, max);
  const rows = [
    ...q(`SELECT 'h:m:'||x.id key, CASE x.from_role WHEN 'client' THEN 'message.received' ELSE 'message.sent' END type, x.client_id, u.name, x.at,
      CASE WHEN x.from_role='client' THEN (CASE x.kind WHEN 'voice' THEN 'Voice note' ELSE 'Message' END) ELSE 'Message sent' END summary
      FROM messages x ${J} WHERE x.kind NOT IN ('letter') AND x.at<? AND x.at>=? ORDER BY x.at DESC LIMIT ?`),
    ...q(`SELECT 'h:w:'||x.id key, 'workout.completed' type, x.client_id, u.name, x.completed_at at, 'Finished '||x.title summary
      FROM workouts x ${J} WHERE x.completed_at IS NOT NULL AND x.completed_at<? AND x.completed_at>=? ORDER BY x.completed_at DESC LIMIT ?`),
    ...q(`SELECT 'h:k:'||x.id key, 'checkin.submitted' type, x.client_id, u.name, x.submitted_at at, 'Weekly check-in' summary,
      json_object('pain', json_array_length(x.pain)>0) payload
      FROM checkins x ${J} WHERE x.submitted_at<? AND x.submitted_at>=? ORDER BY x.submitted_at DESC LIMIT ?`),
    ...q(`SELECT 'h:f:'||x.id key, 'form.submitted' type, x.client_id, u.name, x.submitted_at at, 'Answered '||x.name summary
      FROM form_requests x ${J} WHERE x.submitted_at IS NOT NULL AND x.submitted_at<? AND x.submitted_at>=? ORDER BY x.submitted_at DESC LIMIT ?`),
    ...q(`SELECT 'h:r:'||x.id key, 'letter.published' type, x.client_id, u.name, x.published_at at, 'Letter published' summary
      FROM reports x ${J} WHERE x.published_at IS NOT NULL AND x.published_at<? AND x.published_at>=? ORDER BY x.published_at DESC LIMIT ?`),
    ...db.prepare(`SELECT 'h:u:'||u.id key, 'client.joined' type, u.id client_id, u.name, u.created_at at, 'Joined' summary
      FROM users u WHERE u.role='client' AND u.coach_id=? AND u.created_at<? AND u.created_at>=? ORDER BY u.created_at DESC LIMIT ?`).all(coachId, beforeIso, sinceIso, max),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, max);
}

/**
 * The feed, newest first: the coach's events (types day.started and inbox.done
 * left out; an event about a client who is no longer this coach's is left out),
 * then history from before the first event. `before` is a seq or an ISO instant;
 * `next` is the cursor for the following page (null at the end).
 */
export function activityFeed(db, coach, { before = null, limit = 30, now = new Date() } = {}) {
  const labels = new Map(allEvents().map(e => [e.type, e.label]));
  const where = ['e.coach_id=?', `e.type NOT IN (${HIDDEN_TYPES.map(() => '?').join(',')})`,
    "(e.client_id IS NULL OR EXISTS (SELECT 1 FROM users c WHERE c.id=e.client_id AND c.role='client' AND c.coach_id=e.coach_id))"];
  const args = [coach.id, ...HIDDEN_TYPES];
  const seqCursor = before !== null && /^\d+$/.test(String(before));
  const isoCursor = before !== null && !seqCursor;
  if (seqCursor) { where.push('e.seq<?'); args.push(Number(before)); }
  if (isoCursor) { where.push('e.at<?'); args.push(before); }
  const events = db.prepare(`SELECT e.*, u.name FROM events e LEFT JOIN users u ON u.id=e.client_id
    WHERE ${where.join(' AND ')} ORDER BY e.seq DESC LIMIT ${limit}`).all(...args);
  let rows = events;
  if (rows.length < limit) {
    const firstAt = db.prepare('SELECT MIN(at) at FROM events WHERE coach_id=?').get(coach.id).at ?? now.toISOString();
    const cutoff = isoCursor && before < firstAt ? before : firstAt;
    const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    rows = rows.concat(historyRows(db, coach.id, cutoff, since, limit - rows.length));
  }
  const items = rows.map(r => activityOut(r, labels));
  const last = items.at(-1);
  return { items, next: items.length === limit && last ? (last.seq ? String(last.seq) : last.at) : null };
}

function getActivity(_req, ctx) {
  requireCoach(ctx);
  const max = ctx.query.limit === undefined ? 30 : num(Number(ctx.query.limit), 'limit', { min: 1, max: 100, int: true });
  let before = ctx.query.before ?? null;
  if (before === '') before = null;
  if (before !== null && !/^\d+$/.test(before)) before = instant(before, 'before');
  return activityFeed(ctx.db, ctx.user, { before, limit: max, now: requestNow(ctx) });
}

// MARK: - Morning brief (F1)

const BRIEF_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['bullets'],
  properties: { bullets: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 5 } },
};
const BRIEF_SYSTEM = 'You are the studio assistant of a personal trainer called JK. Write his morning brief: exactly five short bullets, '
  + 'plain British English, warm and direct, most urgent first. Use only the facts given; never invent clients, numbers or advice. '
  + 'First names only. No medical advice: for pain or health flags, say who to check in with.';

/** The facts the brief is built from: counts, first names and needs-you reasons (redacted), today's sessions. */
export function briefFacts(db, coach, now = new Date()) {
  const n = needsYou(db, coach, now);
  const today = londonDay(now);
  const sessions = db.prepare(`SELECT b.start, b.kind, b.title, u.name FROM bookings b LEFT JOIN users u ON u.id=b.client_id AND u.coach_id=b.coach_id
    WHERE b.coach_id=? AND b.cancelled_at IS NULL AND b.start>=? AND b.start<? ORDER BY b.start`)
    .all(coach.id, londonToUtc(today).toISOString(), londonToUtc(addDays(today, 1)).toISOString());
  const people = n.items.slice(0, 6).map(i => ({
    first: i.client.firstName, rank: i.rank, urgent: i.rank === 1,
    reason: redactForAi(i.reasons.slice(0, 2).map(r => r.text).join('; '), { surname: surnameOf(i.client.name) }).slice(0, 160),
  }));
  return {
    day: today, needs: n.items.length, urgent: n.items.filter(i => i.rank === 1).length,
    people, quiet: n.items.filter(i => i.reasons.some(r => r.kind === 'quiet')).map(i => i.client.firstName).slice(0, 4),
    sessions: sessions.map(s => ({ time: londonClock(new Date(s.start)), who: s.kind === 'group' ? s.title : first(s.name ?? s.title), past: Date.parse(s.start) < now.getTime() })),
    lettersDue: n.lettersDue.count, letterMinutes: n.lettersDue.estMinutes, inbox: openCount(db, coach, now),
  };
}

const list = names => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** The deterministic stub: the same five bullets from templates. */
export function stubBrief(f) {
  const lead = f.people[0];
  const upcoming = f.sessions.filter(s => !s.past);
  return [
    f.needs ? `${f.needs} ${f.needs === 1 ? 'person needs' : 'people need'} you. Start with ${lead.first}: ${lead.reason.charAt(0).toLowerCase()}${lead.reason.slice(1)}.` : 'Nobody is waiting on you. A good morning to plan ahead.',
    f.urgent ? `${f.urgent} urgent ${f.urgent === 1 ? 'flag' : 'flags'} (pain or health). Check in with ${list(f.people.filter(p => p.urgent).map(p => p.first))} before their next session.` : 'No pain or health flags this morning.',
    upcoming.length ? `${f.sessions.length} ${f.sessions.length === 1 ? 'session' : 'sessions'} today. Next: ${upcoming[0].who} at ${upcoming[0].time}.` : f.sessions.length ? `All ${f.sessions.length} of today's sessions are done.` : 'No sessions today: time for letters and programming.',
    f.lettersDue ? `${f.lettersDue} ${f.lettersDue === 1 ? 'letter' : 'letters'} due this week, about ${f.letterMinutes} minutes of writing.` : 'Letters are up to date this week.',
    f.quiet.length ? `${list(f.quiet)} ${f.quiet.length === 1 ? 'has' : 'have'} gone quiet. A short personal nudge goes a long way.` : `Inbox: ${f.inbox} open ${f.inbox === 1 ? 'item' : 'items'}.`,
  ];
}

async function brief(_req, ctx) {
  requireCoach(ctx);
  if (!rateLimit(`command.brief:${ctx.user.id}`, { max: 12, perMs: 60_000 })) fail(429, 'Too many briefs. Try again in a minute.');
  const now = requestNow(ctx);
  const facts = briefFacts(ctx.db, ctx.user, now);
  const prompt = `Today is ${facts.day}. The facts, as JSON:\n${JSON.stringify(facts)}\nWrite five bullets for JK's morning.`;
  let out;
  try {
    out = await complete(ctx.db, ctx.config, { user: ctx.user, purpose: 'brief', system: BRIEF_SYSTEM, prompt, schema: BRIEF_SCHEMA, maxTokens: 500, stub: () => ({ json: { bullets: stubBrief(facts) } }) });
  } catch (e) {
    if (e instanceof AiError) fail(e.status, e.message);
    throw e;
  }
  const bullets = (Array.isArray(out.json?.bullets) ? out.json.bullets : []).filter(b => typeof b === 'string' && b.trim()).map(b => b.trim().slice(0, 300)).slice(0, 5);
  return { bullets, provider: out.provider, model: out.model ?? null, at: now.toISOString(), title: out.provider === 'stub' ? '[Stub] Brief' : 'Brief' };
}

// MARK: - Notifications (F3): defaults and settings

/** The kinds WP1 notifies for, each switched by prefs notify.prefs[kind] (default on). */
export const NOTIFY_KINDS = [
  { kind: 'newClient', label: 'New clients', detail: 'Someone signs up with you.', event: 'client.joined' },
  { kind: 'cancellation', label: 'Cancellations', detail: 'A client cancels a session or leaves a class.', event: 'booking.cancelled' },
  { kind: 'healthFlag', label: 'Health flags on forms', detail: 'A “yes” on a PAR-Q or injury question.', event: 'form.submitted', urgent: true },
  { kind: 'pain', label: 'Pain in check-ins', detail: 'A weekly check-in reports a sore area.', event: 'checkin.submitted', urgent: true },
];

/**
 * Other packages' notification kinds (notifyCoach honours notify.prefs for every kind), listed in Settings ›
 * Notifications when their feature is loaded.
 */
const OTHER_KINDS = [
  { kind: 'voiceFlag', feature: 'voice', label: 'Voice notes that need you', detail: 'A client voice note mentions pain, a health worry or something risky.', urgent: true },
  { kind: 'calendar.conflict', feature: 'calsync', label: 'Calendar clashes', detail: 'A session clashes with your calendar or time off.', urgent: true },
  { kind: 'detractor', feature: 'insights', label: 'Low pulse scores', detail: 'A client scores you 6 or below in a pulse survey.', urgent: true },
  { kind: 'waitlist.matched', feature: 'calsync', label: 'Waitlist matches', detail: 'A freed slot suits someone on the waitlist.' },
  { kind: 'lead', feature: 'leads', label: 'New enquiries', detail: 'Someone fills in your enquiry form.' },
  { kind: 'invoiceOverdue', feature: 'billing', label: 'Overdue invoices', detail: 'Dunning reaches the step where a personal word helps.' },
  { kind: 'invoiceDraft', feature: 'billing', label: 'Invoices ready to issue', detail: 'A recurring or campaign invoice is drafted for you.' },
  { kind: 'task', feature: 'tasks', label: 'Tasks due', detail: 'One of your tasks falls due.' },
  { kind: 'streak', feature: 'accountability', label: 'Streak milestones', detail: 'A client reaches a 7, 14, 30, 60 or 100-day streak.' },
  { kind: 'automation', feature: 'automations', label: 'Automation limits', detail: 'An automation hits its daily limit.' },
];
const allNotifyKinds = () => {
  const loaded = new Set(featureNames());
  return [...NOTIFY_KINDS, ...OTHER_KINDS.filter(k => loaded.has(k.feature))];
};

const kindOn = (db, coachId, kind) => {
  const p = coachPref(db, coachId, 'notify.prefs', {});
  return !(p && typeof p === 'object' && p[kind] === false);
};

/** Notify the coach about an event on one of their current clients, if that kind is on. */
function notifyFor(db, config, e, kind, build) {
  if (!e.coachId || !kindOn(db, e.coachId, kind)) return;
  const client = ownClient(db, e.coachId, e.clientId);
  if (!client) return;
  const n = build(client);
  if (!n) return;
  notifyCoach(db, config, e.coachId, { clientId: client.id, kind, ...n });
}

const handlers = {
  'client.joined': (db, config, e) => notifyFor(db, config, e, 'newClient', c => ({
    title: `New client: ${c.name}`, body: 'Say hello and send the intake form.', icon: 'person_add', tone: 'ok', path: `/clients/${enc(c.id)}`, dedupe: `joined:${c.id}`,
  })),
  'booking.cancelled': (db, config, e) => {
    if (e.payload?.byRole !== 'client' || !e.payload?.start) return;
    notifyFor(db, config, e, 'cancellation', c => ({
      title: `${first(c.name)} cancelled ${whenLabel(e.payload.start)}${e.payload.late ? ' (late)' : ''}`,
      body: e.payload.late ? 'Inside the cancellation window: the credit was not refunded.' : '', icon: 'event_busy',
      tone: e.payload.late ? 'attention' : 'data', path: `/clients/${enc(c.id)}/sessions`, dedupe: `cancel:${e.payload.bookingId}:${c.id}`,
    }));
  },
  'form.submitted': (db, config, e) => {
    if (!(Number(e.payload?.flagged) > 0)) return;
    notifyFor(db, config, e, 'healthFlag', c => {
      const r = db.prepare('SELECT * FROM form_requests WHERE id=? AND client_id=?').get(e.payload.requestId, c.id);
      if (!r) return null;
      const flagged = flaggedAnswers(r);
      return {
        title: `Health flag on ${r.name}: ${first(c.name)}`, body: `${flagged.length || e.payload.flagged} “yes” ${flagged.length === 1 ? 'answer needs' : 'answers need'} a word before the next session.`,
        icon: 'gpp_maybe', tone: 'urgent', path: `/clients/${enc(c.id)}/forms`, dedupe: `formflag:${r.id}`,
      };
    });
  },
  'checkin.submitted': (db, config, e) => {
    if (!e.payload?.pain) return;
    notifyFor(db, config, e, 'pain', c => {
      const k = db.prepare('SELECT pain FROM checkins WHERE id=? AND client_id=?').get(e.payload.checkinId, c.id);
      let areas = [];
      try { areas = JSON.parse(k?.pain ?? '[]'); } catch { areas = []; }
      return {
        title: `Pain reported in check-in: ${first(c.name)}`, body: areas.length ? `Sore: ${areas.join(', ').toLowerCase()}` : '',
        icon: 'healing', tone: 'urgent', path: `/clients/${enc(c.id)}/checkins`, dedupe: `pain:${e.payload.checkinId}`,
      };
    });
  },
};

function notifySettingsOut(db, coachId) {
  return {
    kinds: allNotifyKinds().map(k => ({ kind: k.kind, label: k.label, detail: k.detail, urgent: !!k.urgent, on: kindOn(db, coachId, k.kind) })),
    pushUrgent: coachPref(db, coachId, 'notify.push.urgent', true) !== false,
    quietHours: quietWindow(coachPref(db, coachId, 'notify.quietHours'), { start: '22:00', end: '06:30' }),
  };
}

function getNotifySettings(_req, ctx) {
  requireCoach(ctx);
  return notifySettingsOut(ctx.db, ctx.user.id);
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
function putNotifySettings(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body ?? {};
  const known = new Set(allNotifyKinds().map(k => k.kind));
  let kinds = null;
  if (b.kinds !== undefined) {
    if (!b.kinds || typeof b.kinds !== 'object' || Array.isArray(b.kinds)) fail(400, 'kinds must be an object of kind: true|false');
    kinds = { ...(coachPref(ctx.db, ctx.user.id, 'notify.prefs', {}) ?? {}) };
    for (const [k, v] of Object.entries(b.kinds)) {
      if (!known.has(k)) fail(400, `kinds.${k} is not known`);
      if (typeof v !== 'boolean') fail(400, `kinds.${k} must be true or false`);
      kinds[k] = v;
    }
  }
  if (b.pushUrgent !== undefined && typeof b.pushUrgent !== 'boolean') fail(400, 'pushUrgent must be true or false');
  let quiet;
  if (b.quietHours !== undefined) {
    if (b.quietHours === null) quiet = null;
    else if (typeof b.quietHours === 'object' && CLOCK.test(b.quietHours.start ?? '') && CLOCK.test(b.quietHours.end ?? '') && b.quietHours.start !== b.quietHours.end) quiet = { start: b.quietHours.start, end: b.quietHours.end };
    else fail(400, 'quietHours must be {start, end} as different HH:MM times, or null for none');
  }
  tx(ctx.db, () => {
    if (kinds) setCoachPref(ctx.db, ctx.user.id, 'notify.prefs', kinds);
    if (b.pushUrgent !== undefined) setCoachPref(ctx.db, ctx.user.id, 'notify.push.urgent', b.pushUrgent);
    if (quiet !== undefined) setCoachPref(ctx.db, ctx.user.id, 'notify.quietHours', quiet ?? 'off');
  });
  return notifySettingsOut(ctx.db, ctx.user.id);
}

// MARK: - Search (F2): check-in notes

function searchCheckins(db, coach, q, max) {
  const like = likeAny(q);
  return db.prepare(`SELECT k.id, k.client_id, k.week, k.note, k.win, k.struggle, k.submitted_at, u.name FROM checkins k
    JOIN users u ON u.id=k.client_id AND u.role='client' AND u.coach_id=?
    WHERE k.note LIKE ? ESCAPE '\\' OR k.win LIKE ? ESCAPE '\\' OR k.struggle LIKE ? ESCAPE '\\' ORDER BY k.submitted_at DESC LIMIT ?`)
    .all(coach.id, like, like, like, max).map(k => {
      const text = [k.note, k.win, k.struggle].find(t => t && t.toLowerCase().includes(q.toLowerCase())) ?? k.note;
      const i = text.toLowerCase().indexOf(q.toLowerCase());
      const from = Math.max(0, i - 30);
      return {
        type: 'checkin', id: k.id, title: `Check-in · ${k.name}`, detail: `${from ? '…' : ''}${text.slice(from, from + 90)}${from + 90 < text.length ? '…' : ''}`,
        path: `/clients/${enc(k.client_id)}/checkins`, icon: 'monitor_heart', score: matchScore(text, q) * 0.75, at: k.submitted_at,
      };
    });
}

// MARK: - Demo world: a busy, believable Tuesday on any day

function buildDemo(db, ctx) {
  const { coach, byName, today } = ctx;
  // Older test set-ups build the demo on a store that never ran feature schemas,
  // so the table is made here too (idempotent), and wiped here rather than
  // through demo.tables (the foundation's wipe runs before any schema).
  feature.schema(db);
  db.prepare('DELETE FROM inbox_state WHERE coach_id=?').run(coach.id);
  const sam = byName.Sam, priya = byName.Priya, alex = byName.Alex, leo = byName.Leo, rory = byName.Rory, tom = byName.Tom;
  const yesterday = addDays(today, -1);
  const t = (d, clock) => londonToUtc(d, clock).toISOString();
  const message = (client, at, text, { read = false } = {}) => {
    const id = newId('m');
    db.prepare("INSERT INTO messages (id, client_id, from_id, from_role, text, at, read_at, kind, via) VALUES (?,?,?,'client',?,?,?,'text','app')")
      .run(id, client.id, client.id, text, at, read ? at : null);
    return id;
  };
  // Unread threads waiting in the Inbox (yesterday evening, so they read right whatever time the world is built).
  if (alex) message(alex, t(yesterday, '19:42'), 'Quick one: can we swap Thursday to Friday this week? Work dinner came up. Happy to do the session at 7am.');
  if (tom) message(tom, t(yesterday, '21:08'), 'Sorry I went quiet. Rough fortnight at work. Back on it from today, promise. Can we keep sessions short this week?');
  const roryMsg = rory ? message(rory, t(yesterday, '18:15'), 'Calf feels loads better after the swap to the bike. Ok to run Saturday?') : null;
  // Two check-ins still to review: Leo's lower back (a flag), Alex's letter due.
  const latest = c => db.prepare('SELECT id FROM checkins WHERE client_id=? ORDER BY week DESC LIMIT 1').get(c.id);
  for (const c of [leo, alex]) {
    const k = c && latest(c);
    if (k) db.prepare('UPDATE checkins SET reviewed_at=NULL, reply=NULL WHERE id=?').run(k.id);
  }
  // Letters still to write for last week: Alex (written) and Priya (with a voice note).
  for (const c of [alex, priya]) {
    const r = c && db.prepare("SELECT id FROM reports WHERE client_id=? AND kind='weekly' AND published_at IS NOT NULL ORDER BY week DESC LIMIT 1").get(c.id);
    if (!r) continue;
    db.prepare('DELETE FROM messages WHERE report_id=?').run(r.id);
    db.prepare('UPDATE reports SET published_at=NULL, read_at=NULL WHERE id=?').run(r.id);
  }
  // Tom answered the monthly review last night.
  const review = db.prepare("SELECT * FROM forms WHERE coach_id=? AND name='Monthly review'").get(coach.id);
  if (review && tom) {
    db.prepare('INSERT INTO form_requests (id, form_id, client_id, name, intro, questions, sent_at, answers, submitted_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(newId('fr'), review.id, tom.id, review.name, review.intro, review.questions, t(addDays(today, -6), '09:00'),
        JSON.stringify({ proud: 'Two weeks without missing the Monday session.', hard: 'Late nights at work and takeaway on the way home.', enjoy: 3, next: 'Prep lunches on Sunday so I stop buying them.' }),
        t(yesterday, '22:31'));
  }
  // A fuller day: up to four more sessions today, at times that do not clash with the world's own.
  const busy = db.prepare('SELECT start, end FROM bookings WHERE coach_id=? AND cancelled_at IS NULL AND start<? AND end>?');
  const book = (client, kind, clock, minutes, title, { location = '', purpose = null, attendees = [] } = {}) => {
    const start = londonToUtc(today, clock), end = new Date(start.getTime() + minutes * 60_000);
    if (busy.get(coach.id, end.toISOString(), start.toISOString())) return;
    const id = newId('b');
    db.prepare('INSERT INTO bookings (id, coach_id, client_id, kind, start, end, location, title, capacity, purpose, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, coach.id, client?.id ?? null, kind, start.toISOString(), end.toISOString(), location, title, kind === 'group' ? 10 : null, purpose, t(addDays(today, -9), '10:00'));
    for (const a of attendees.filter(Boolean)) db.prepare('INSERT OR IGNORE INTO class_attendees (booking_id, user_id) VALUES (?,?)').run(id, a.id);
  };
  if (sam) book(sam, 'inperson', '06:30', 60, '1:1 with Coach JK', { location: 'The Studio' });
  if (alex) book(alex, 'inperson', '12:15', 45, 'Planning session', { location: 'The Studio', purpose: 'planning' });
  book(null, 'group', '17:30', 60, 'Strength Club · Group', { location: 'The Studio', attendees: [leo, rory, tom, priya] });
  if (rory) book(rory, 'video', '19:15', 30, 'Video call with Coach JK', { purpose: 'review' });
  // The bell: one urgent and one settled notification (never pushed: no push_after).
  const note = (client, kind, title, body, icon, tone, path, at, read) => db.prepare(`INSERT INTO coach_notifications
    (id, coach_id, client_id, kind, title, body, path, icon, tone, created_at, read_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(newId('nt'), coach.id, client.id, kind, title, body, path, icon, tone, at, read ? at : null);
  if (leo) note(leo, 'pain', 'Pain reported in check-in: Leo', 'Sore: lower back', 'healing', 'urgent', `/clients/${enc(leo.id)}/checkins`, t(addDays(today, -4), '18:20'), false);
  if (alex) {
    // Alex moved a session two days ago (cancelled in good time), which is what the bell remembers.
    db.prepare("INSERT INTO bookings (id, coach_id, client_id, kind, start, end, location, title, cancelled_at, created_at) VALUES (?,?,?,'inperson',?,?,'The Studio','1:1 with Coach JK',?,?)")
      .run(newId('b'), coach.id, alex.id, t(addDays(today, -2), '18:30'), t(addDays(today, -2), '19:30'), t(addDays(today, -3), '08:05'), t(addDays(today, -12), '10:00'));
    note(alex, 'cancellation', `Alex cancelled ${whenLabel(t(addDays(today, -2), '18:30'))}`, '', 'event_busy', 'data', `/clients/${enc(alex.id)}/sessions`, t(addDays(today, -3), '08:05'), false);
  }
  if (tom) note(tom, 'newClient', 'New client: Tom Burke', 'Say hello and send the intake form.', 'person_add', 'ok', `/clients/${enc(tom.id)}`, tom.created_at, true);
  // Rory's thread is snoozed until tomorrow morning (it shows under Snoozed).
  if (roryMsg) {
    db.prepare("INSERT INTO inbox_state (coach_id, item_key, client_id, status, snooze_until, updated_at) VALUES (?,?,?,'snoozed',?,?)")
      .run(coach.id, `thread:${rory.id}:${roryMsg}`, rory.id, t(addDays(today, 1), '07:00'), t(yesterday, '18:20'));
  }
  void sam;
}

// MARK: - The feature

export const feature = {
  name: 'command',
  namespaces: ['inbox', 'command'],
  exact: [],
  schema(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS inbox_state (
      coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_key TEXT NOT NULL,
      client_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('done','snoozed')),
      snooze_until TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY (coach_id, item_key));
    CREATE INDEX IF NOT EXISTS inbox_state_client ON inbox_state(client_id);`);
  },
  routes(r) {
    r.add('GET', '/api/command/summary', (_req, ctx) => { requireCoach(ctx); return commandSummary(ctx.db, ctx.user, requestNow(ctx)); });
    r.add('GET', '/api/command/activity', getActivity);
    r.add('POST', '/api/command/brief', brief);
    r.add('GET', '/api/command/notify-settings', getNotifySettings);
    r.add('PUT', '/api/command/notify-settings', putNotifySettings);
    r.add('GET', '/api/inbox', getInbox);
    r.add('POST', '/api/inbox/state', setInboxState);
  },
  clocks: [{ id: 'inbox.prune', everyMs: 6 * 3_600_000, run: (db, _config, now) => pruneInbox(db, now) }],
  on: handlers,
  emits: { 'inbox.done': { label: 'An Inbox item was marked done', payload: ['key', 'kind'] } },
  badges(db, coach) { return { inbox: openCount(db, coach, new Date()) }; },
  search: searchCheckins,
  exportFor(db, user) {
    const rows = user.role === 'coach'
      ? db.prepare('SELECT item_key, client_id, status, snooze_until, updated_at FROM inbox_state WHERE coach_id=? ORDER BY updated_at').all(user.id)
      : db.prepare('SELECT item_key, status, snooze_until, updated_at FROM inbox_state WHERE client_id=? ORDER BY updated_at').all(user.id);
    return { inboxState: rows.map(r => ({ key: r.item_key, ...(r.client_id !== undefined ? { clientId: r.client_id } : {}), status: r.status, snoozeUntil: r.snooze_until, updatedAt: r.updated_at })) };
  },
  demo: { build: buildDemo },
};
