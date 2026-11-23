import { clientFor, initials, requireCoach } from './access.mjs';
import { adherence } from './coach.mjs';
import { emit } from './events.mjs';
import { flaggedAnswers, sendForm } from './forms.mjs';
import { fail, num, oneOf, str } from './http.mjs';
import { cappedSentToday, outreachOf, outreachSettings, sendMessage } from './messages.mjs';
import { notifyCoach } from './notifications.mjs';
import { allActions, allFacts, hooks } from './registry.mjs';
import { coachPref, newId, nowIso, setCoachPref, tx } from './store.mjs';
import { render } from './templating.mjs';
import { addDays, daysBetween, londonDay, londonToUtc, weekday } from './time.mjs';
import { layProgram } from './training.mjs';

/**
 * Facts, rules, tags, segments, audiences and actions (docs/design/desk-v2.md
 * 3.4 and 3.5). A fact is a named per-client value ("core.daysQuiet"); rules
 * are one JSON shape everywhere (segments, automation conditions, audiences);
 * an action is one thing an automation or a bulk command does for a client.
 */

const URGENT_WORDS = /\b(pain|painful|injur\w*|hurt\w*|sharp|swollen|swelling|numb\w*|dizz\w*|faint\w*|sick|unwell)\b/i;
const IDS = 'SELECT value FROM json_each(?)';
const dayOf = iso => (iso ? londonDay(new Date(iso)) : null);
const maxDay = (...days) => days.filter(Boolean).sort().at(-1) ?? null;

// MARK: - Attended sessions

/**
 * Past, non-cancelled sessions per client (1:1s and classes they joined) whose
 * start is in [fromIso, toIso) and before now, minus the bookings features say
 * did not count (hooks('quiet'): no-shows, late cancels).
 * Returns Map<clientId, [{bookingId, start}]>.
 */
export function attendedSessions(db, coachId, clientIds, fromIso, toIso, now = new Date()) {
  const out = new Map(clientIds.map(id => [id, []]));
  if (!clientIds.length) return out;
  const to = toIso && toIso < now.toISOString() ? toIso : now.toISOString();
  const ids = JSON.stringify(clientIds);
  const rows = db.prepare(`SELECT client_id, id, start FROM bookings WHERE coach_id=? AND client_id IN (${IDS}) AND cancelled_at IS NULL AND start>=? AND start<?
    UNION ALL SELECT a.user_id, b.id, b.start FROM class_attendees a JOIN bookings b ON b.id=a.booking_id
      WHERE b.coach_id=? AND a.user_id IN (${IDS}) AND b.cancelled_at IS NULL AND b.start>=? AND b.start<? ORDER BY 3`)
    .all(coachId, ids, fromIso, to, coachId, ids, fromIso, to);
  const quiet = new Set();
  for (const [f, fn] of hooks('quiet')) {
    try { for (const id of fn(db, coachId, clientIds, fromIso) ?? []) quiet.add(id); } catch (e) { console.error(`quiet hook of ${f.name} failed`, e); }
  }
  for (const r of rows) if (!quiet.has(r.id)) out.get(r.client_id)?.push({ bookingId: r.id, start: r.start });
  return out;
}

// MARK: - Facts

/** The fact catalogue: `[{id, label, type, options?, feature, aiDerived}]`. */
export const factCatalogue = () => allFacts().map(({ compute: _c, ...f }) => f);

/** Days until the next yearly anniversary of joining (0 on the day; 29 Feb falls back to 28 Feb). */
function anniversaryIn(createdAt, today) {
  const joined = dayOf(createdAt);
  const md = joined.slice(5);
  const on = year => {
    if (md !== '02-29') return `${year}-${md}`;
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return `${year}-02-${leap ? '29' : '28'}`;
  };
  const year = Math.max(Number(today.slice(0, 4)), Number(joined.slice(0, 4)) + 1);
  let next = on(year);
  if (next < today) next = on(year + 1);
  return daysBetween(today, next);
}

/** The built-in core.* facts for a batch of clients. */
function coreFacts(db, coachId, clients, { today, now, want }) {
  const ids = clients.map(c => c.id);
  const json = JSON.stringify(ids);
  const out = new Map(clients.map(c => [c.id, {}]));
  const group = (sql, ...args) => new Map(db.prepare(sql).all(...args).map(r => [r.k, r.v]));
  const needs = id => want.has(id);

  if (needs('core.daysQuiet') || needs('core.sessionsAttended14')) {
    const lastMsg = group(`SELECT client_id k, MAX(at) v FROM messages WHERE from_role='client' AND client_id IN (${IDS}) GROUP BY client_id`, json);
    const lastDone = group(`SELECT client_id k, MAX(completed_at) v FROM workouts WHERE client_id IN (${IDS}) GROUP BY client_id`, json);
    const lastSet = group(`SELECT w.client_id k, MAX(s.at) v FROM set_logs s JOIN workout_items i ON i.id=s.item_id JOIN workouts w ON w.id=i.workout_id
      WHERE w.client_id IN (${IDS}) GROUP BY w.client_id`, json);
    const lastCheckin = group(`SELECT client_id k, MAX(submitted_at) v FROM checkins WHERE client_id IN (${IDS}) GROUP BY client_id`, json);
    const lastHabit = group(`SELECT h.client_id k, MAX(d.date) v FROM habit_days d JOIN habits h ON h.id=d.habit_id
      WHERE h.client_id IN (${IDS}) AND (d.done=1 OR d.value>0) AND d.date<=? GROUP BY h.client_id`, json, today);
    const year = attendedSessions(db, coachId, ids, londonToUtc(addDays(today, -400)).toISOString(), now.toISOString(), now);
    const from14 = londonToUtc(addDays(today, -14)).toISOString();
    for (const c of clients) {
      const sessions = year.get(c.id) ?? [];
      const last = maxDay(dayOf(lastMsg.get(c.id)), dayOf(lastDone.get(c.id)), dayOf(lastSet.get(c.id)), dayOf(lastCheckin.get(c.id)),
        lastHabit.get(c.id), dayOf(sessions.at(-1)?.start)) ?? dayOf(c.created_at);
      out.get(c.id)['core.daysQuiet'] = Math.max(0, daysBetween(last, today));
      out.get(c.id)['core.sessionsAttended14'] = sessions.filter(s => s.start >= from14).length;
    }
  }
  if (needs('core.daysSinceWorkout')) {
    const lastDone = group(`SELECT client_id k, MAX(completed_at) v FROM workouts WHERE client_id IN (${IDS}) GROUP BY client_id`, json);
    for (const c of clients) {
      const d = dayOf(lastDone.get(c.id));
      out.get(c.id)['core.daysSinceWorkout'] = d ? Math.max(0, daysBetween(d, today)) : null;
    }
  }
  if (needs('core.unread')) {
    const unread = group(`SELECT client_id k, COUNT(*) v FROM messages WHERE from_role='client' AND read_at IS NULL AND client_id IN (${IDS}) GROUP BY client_id`, json);
    for (const c of clients) out.get(c.id)['core.unread'] = unread.get(c.id) ?? 0;
  }
  if (needs('core.pain14')) {
    const from = londonToUtc(addDays(today, -14)).toISOString();
    const pain = new Set(db.prepare(`SELECT DISTINCT client_id FROM checkins WHERE client_id IN (${IDS}) AND submitted_at>=? AND pain<>'[]'`).all(json, from).map(r => r.client_id));
    for (const m of db.prepare(`SELECT client_id, text FROM messages WHERE from_role='client' AND client_id IN (${IDS}) AND at>=?`).all(json, from)) {
      if (URGENT_WORDS.test(m.text)) pain.add(m.client_id);
    }
    for (const f of db.prepare(`SELECT * FROM form_requests WHERE client_id IN (${IDS}) AND submitted_at>=?`).all(json, from)) {
      if (flaggedAnswers(f).length) pain.add(f.client_id);
    }
    for (const c of clients) out.get(c.id)['core.pain14'] = pain.has(c.id);
  }
  if (needs('core.nextSessionDays')) {
    const next = group(`SELECT k, MIN(v) v FROM (
        SELECT client_id k, start v FROM bookings WHERE client_id IN (${IDS}) AND cancelled_at IS NULL AND start>?
        UNION ALL SELECT a.user_id, b.start FROM class_attendees a JOIN bookings b ON b.id=a.booking_id WHERE a.user_id IN (${IDS}) AND b.cancelled_at IS NULL AND b.start>?)
      GROUP BY k`, json, now.toISOString(), json, now.toISOString());
    for (const c of clients) {
      const d = dayOf(next.get(c.id));
      out.get(c.id)['core.nextSessionDays'] = d ? daysBetween(today, d) : null;
    }
  }
  if (needs('core.tags')) {
    const tags = new Map();
    for (const r of db.prepare(`SELECT ct.client_id, ct.tag_id FROM client_tags ct JOIN tags t ON t.id=ct.tag_id WHERE t.coach_id=? AND ct.client_id IN (${IDS}) ORDER BY t.name`).all(coachId, json)) {
      tags.set(r.client_id, [...(tags.get(r.client_id) ?? []), r.tag_id]);
    }
    for (const c of clients) out.get(c.id)['core.tags'] = tags.get(c.id) ?? [];
  }
  const outreach = needs('core.outreachPaused')
    ? new Map(db.prepare(`SELECT client_id, paused FROM client_outreach WHERE client_id IN (${IDS})`).all(json).map(r => [r.client_id, !!r.paused])) : null;
  for (const c of clients) {
    const f = out.get(c.id);
    if (needs('core.plan')) f['core.plan'] = c.plan;
    if (needs('core.daysSinceJoined')) f['core.daysSinceJoined'] = Math.max(0, daysBetween(dayOf(c.created_at), today));
    if (needs('core.anniversaryInDays')) f['core.anniversaryInDays'] = anniversaryIn(c.created_at, today);
    if (needs('core.outreachPaused')) f['core.outreachPaused'] = outreach.get(c.id) ?? false;
    if (needs('core.adherence28')) f['core.adherence28'] = adherence(db, c.id, today);
    if (needs('core.onboarded')) f['core.onboarded'] = !!c.onboarded_at;
  }
  return out;
}

/**
 * Facts for a batch of a coach's clients: Map<clientId, {[factId]: value}>.
 * `only` limits it to some facts; by default everything except core.segments,
 * which is computed only when asked for. A provider that throws gives null for
 * its fact (and is logged). Client ids that are not this coach's are ignored.
 */
export function clientFacts(db, coachId, clientIds, { only = null, today = null, now = new Date() } = {}) {
  const day = today ?? londonDay(now);
  const catalogue = allFacts();
  const want = new Set(only ?? catalogue.map(f => f.id).filter(id => id !== 'core.segments'));
  const clients = clientIds.length
    ? db.prepare(`SELECT * FROM users WHERE role='client' AND coach_id=? AND id IN (${IDS})`).all(coachId, JSON.stringify([...new Set(clientIds)]))
    : [];
  const out = coreFacts(db, coachId, clients, { today: day, now, want });
  const ids = clients.map(c => c.id);
  for (const f of catalogue) {
    if (f.feature === 'core' || !want.has(f.id)) continue;
    let values = null;
    try { values = f.compute(db, coachId, ids, day); } catch (e) { console.error(`Fact ${f.id} failed`, e); }
    for (const id of ids) {
      const v = values instanceof Map ? values.get(id) : values?.[id];
      out.get(id)[f.id] = v === undefined ? null : v;
    }
  }
  if (want.has('core.segments')) {
    const segments = db.prepare('SELECT id, rules FROM segments WHERE coach_id=?').all(coachId).map(s => ({ id: s.id, rules: JSON.parse(s.rules) }));
    const referenced = [...new Set(segments.flatMap(s => factsIn(s.rules)))].filter(id => id !== 'core.segments' && !want.has(id));
    const extra = referenced.length ? clientFacts(db, coachId, ids, { only: referenced, today: day, now }) : null;
    for (const id of ids) {
      const facts = { ...out.get(id), ...(extra?.get(id) ?? {}) };
      out.get(id)['core.segments'] = segments.filter(s => { try { return evaluate(s.rules, facts); } catch { return false; } }).map(s => s.id);
    }
  }
  return out;
}

// MARK: - Rules

export const OPERATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'has', 'hasNot', 'isSet', 'isNotSet', 'between'];
const MAX_RULES = 20;

/** Every fact id a rules object refers to. */
export function factsIn(rules) {
  if (!rules || typeof rules !== 'object') return [];
  if (Array.isArray(rules.rules)) return rules.rules.flatMap(factsIn);
  return typeof rules.fact === 'string' ? [rules.fact] : [];
}

/**
 * Check a rules object; returns it, or throws a 400 naming the path, e.g.
 * "rules[1].rules[0].op is not known". Groups nest one level; at most 20 rules.
 */
export function validateRules(rules, { facts = allFacts(), name = 'rules' } = {}) {
  const known = new Map(facts.map(f => [f.id, f]));
  let count = 0;
  const group = (g, path, level) => {
    if (!g || typeof g !== 'object' || Array.isArray(g)) fail(400, `${path} must be a group {match, rules}`);
    if (!['all', 'any'].includes(g.match)) fail(400, `${path}.match must be all or any`);
    if (!Array.isArray(g.rules)) fail(400, `${path}.rules must be a list`);
    g.rules.forEach((r, i) => {
      const p = `${path}.rules[${i}]`.replace(/^rules\.rules/, 'rules');
      if (r && typeof r === 'object' && 'match' in r) {
        if (level >= 1) fail(400, `${p} nests too deep (one level of groups at most)`);
        group(r, p, level + 1);
      } else rule(r, p);
    });
  };
  const rule = (r, path) => {
    if (++count > MAX_RULES) fail(400, `${name} has more than ${MAX_RULES} rules`);
    if (!r || typeof r !== 'object') fail(400, `${path} must be a rule {fact, op, value}`);
    if (!known.has(r.fact)) fail(400, `${path}.fact is not known`);
    if (!OPERATORS.includes(r.op)) fail(400, `${path}.op is not known`);
    const v = r.value;
    if (['in', 'notIn'].includes(r.op) && !Array.isArray(v)) fail(400, `${path}.value must be a list`);
    if (r.op === 'between' && !(Array.isArray(v) && v.length === 2)) fail(400, `${path}.value must be [from, to]`);
    if (!['isSet', 'isNotSet', 'in', 'notIn', 'between'].includes(r.op) && (v === undefined || (typeof v === 'object' && v !== null))) fail(400, `${path}.value is required`);
  };
  group(rules, name, 0);
  return rules;
}

const isSet = v => v !== null && v !== undefined && !(Array.isArray(v) && !v.length);
const cmp = (a, b, f) => (a === null || a === undefined || b === null || b === undefined ? false : f(a, b));

function test(r, facts) {
  const v = facts[r.fact];
  switch (r.op) {
    case 'eq': return Array.isArray(v) ? v.includes(r.value) : v === r.value;
    case 'ne': return Array.isArray(v) ? !v.includes(r.value) : v !== r.value;
    case 'gt': return cmp(v, r.value, (a, b) => a > b);
    case 'gte': return cmp(v, r.value, (a, b) => a >= b);
    case 'lt': return cmp(v, r.value, (a, b) => a < b);
    case 'lte': return cmp(v, r.value, (a, b) => a <= b);
    case 'in': return v !== null && v !== undefined && r.value.includes(v);
    case 'notIn': return !r.value.includes(v);
    case 'has': return Array.isArray(v) && v.includes(r.value);
    case 'hasNot': return !Array.isArray(v) || !v.includes(r.value);
    case 'isSet': return isSet(v);
    case 'isNotSet': return !isSet(v);
    case 'between': return cmp(v, r.value[0], (a, b) => a >= b) && cmp(v, r.value[1], (a, b) => a <= b);
    default: return false;
  }
}

/** Does a client's facts object match the rules? An empty group matches everyone. */
export function evaluate(rules, facts) {
  if (!rules) return true;
  if (Array.isArray(rules.rules)) {
    const results = rules.rules.map(r => evaluate(r, facts));
    return rules.match === 'any' ? !rules.rules.length || results.some(Boolean) : results.every(Boolean);
  }
  return test(rules, facts);
}

// MARK: - Audiences

/**
 * The clients an audience means: the union of `clientIds`, the members of
 * `segmentId` and the matches of `rules`, always within the coach's own
 * clients of the same demo-ness. Unknown ids are ignored. purpose 'broadcast'
 * drops "no broadcasts" clients; 'broadcast' and 'automated' drop paused ones
 * and refuse rules on AI-derived facts (400). Returns client rows; the array's
 * `skipped` property says how many were dropped and why.
 */
export function resolveAudience(db, coachId, audience, { purpose = 'any', now = new Date(), today = null } = {}) {
  if (!audience || typeof audience !== 'object' || Array.isArray(audience)) fail(400, 'audience must be {clientIds?, segmentId?, rules?}');
  const coach = db.prepare("SELECT * FROM users WHERE id=? AND role='coach'").get(coachId);
  if (!coach) fail(404, 'Not found');
  const ruleSets = [];
  if (audience.rules) ruleSets.push(validateRules(audience.rules));
  if (audience.segmentId) {
    const seg = db.prepare('SELECT rules FROM segments WHERE id=? AND coach_id=?').get(audience.segmentId, coachId);
    if (!seg) fail(404, 'Not found');
    ruleSets.push(JSON.parse(seg.rules));
  }
  if (['broadcast', 'automated'].includes(purpose)) {
    const ai = new Set(allFacts().filter(f => f.aiDerived).map(f => f.id));
    if (ruleSets.some(r => factsIn(r).some(id => ai.has(id)))) fail(400, 'Audiences that message clients can\'t use AI judgements');
  }
  const all = db.prepare("SELECT * FROM users WHERE role='client' AND coach_id=? AND is_demo=? ORDER BY name").all(coachId, coach.is_demo);
  const chosen = new Set();
  if (audience.clientIds !== undefined) {
    if (!Array.isArray(audience.clientIds) || audience.clientIds.length > 5000) fail(400, 'audience.clientIds must be a list');
    const wanted = new Set(audience.clientIds.filter(id => typeof id === 'string'));
    for (const c of all) if (wanted.has(c.id)) chosen.add(c.id);
  }
  if (ruleSets.length) {
    const facts = clientFacts(db, coachId, all.map(c => c.id), { only: [...new Set(ruleSets.flatMap(factsIn))], now, today });
    for (const c of all) if (ruleSets.some(r => evaluate(r, facts.get(c.id) ?? {}))) chosen.add(c.id);
  }
  const skipped = { outreachPaused: 0, noBroadcasts: 0 };
  const rows = all.filter(c => chosen.has(c.id)).filter(c => {
    if (purpose !== 'broadcast' && purpose !== 'automated') return true;
    const o = outreachOf(db, c.id);
    if (o.paused) { skipped.outreachPaused++; return false; }
    if (purpose === 'broadcast' && o.noBroadcasts) { skipped.noBroadcasts++; return false; }
    return true;
  });
  return Object.assign(rows, { skipped });
}

// MARK: - Tags

export const TAG_COLORS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'];
const tagOut = t => ({ id: t.id, name: t.name, color: t.color, ...(t.n !== undefined ? { count: t.n } : {}) });

/** Add or remove one tag on a client (no checks: callers own them). Emits client.tagged / client.untagged on a change. */
export function setClientTag(db, { coachId, clientId, tagId, on, by = 'coach' }) {
  const tag = db.prepare('SELECT name FROM tags WHERE id=?').get(tagId);
  const changed = on
    ? db.prepare('INSERT OR IGNORE INTO client_tags (client_id, tag_id, added_at, added_by) VALUES (?,?,?,?)').run(clientId, tagId, nowIso(), by).changes
    : db.prepare('DELETE FROM client_tags WHERE client_id=? AND tag_id=?').run(clientId, tagId).changes;
  if (changed) emit(db, on ? 'client.tagged' : 'client.untagged', { coachId, clientId, summary: `${on ? 'Tagged' : 'Untagged'} ${tag?.name ?? ''}`.trim(), tagId, by });
  return changed > 0;
}

const ownTag = (ctx, id) => {
  const t = ctx.db.prepare('SELECT * FROM tags WHERE id=? AND coach_id=?').get(id, ctx.user.id);
  if (!t) fail(404, 'Not found');
  return t;
};

function tagFields(ctx, partial) {
  const b = ctx.body;
  const out = {};
  if (!partial || b.name !== undefined) out.name = str(b.name, 'name', { max: 40 });
  if (b.color !== undefined) out.color = oneOf(b.color, 'color', TAG_COLORS);
  return out;
}

function listTags(_req, ctx) {
  requireCoach(ctx);
  const rows = ctx.db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM client_tags ct JOIN users u ON u.id=ct.client_id AND u.coach_id=t.coach_id WHERE ct.tag_id=t.id) n
    FROM tags t WHERE t.coach_id=? ORDER BY t.name`).all(ctx.user.id);
  return { tags: rows.map(tagOut) };
}

function createTag(_req, ctx) {
  requireCoach(ctx);
  const f = tagFields(ctx, false);
  if (ctx.db.prepare('SELECT 1 FROM tags WHERE coach_id=? AND name=?').get(ctx.user.id, f.name)) fail(409, 'You already have a tag with that name');
  const id = newId('tg');
  ctx.db.prepare('INSERT INTO tags (id, coach_id, name, color, created_at) VALUES (?,?,?,?,?)').run(id, ctx.user.id, f.name, f.color ?? 'chart-1', nowIso());
  return { tag: tagOut(ctx.db.prepare('SELECT * FROM tags WHERE id=?').get(id)) };
}

function updateTag(_req, ctx) {
  requireCoach(ctx);
  const t = ownTag(ctx, ctx.params.id);
  const f = tagFields(ctx, true);
  if (f.name && f.name !== t.name && ctx.db.prepare('SELECT 1 FROM tags WHERE coach_id=? AND name=?').get(ctx.user.id, f.name)) fail(409, 'You already have a tag with that name');
  ctx.db.prepare('UPDATE tags SET name=?, color=? WHERE id=?').run(f.name ?? t.name, f.color ?? t.color, t.id);
  return { tag: tagOut(ctx.db.prepare('SELECT * FROM tags WHERE id=?').get(t.id)) };
}

function deleteTag(_req, ctx) {
  requireCoach(ctx);
  const t = ownTag(ctx, ctx.params.id);
  ctx.db.prepare('DELETE FROM tags WHERE id=?').run(t.id);
  return { ok: true };
}

const tagsOf = (db, coachId, clientId) => db.prepare('SELECT t.* FROM client_tags ct JOIN tags t ON t.id=ct.tag_id WHERE ct.client_id=? AND t.coach_id=? ORDER BY t.name').all(clientId, coachId).map(tagOut);

function tagIdsOf(ctx, list, name) {
  if (!Array.isArray(list) || list.length > 100 || list.some(id => typeof id !== 'string')) fail(400, `${name} must be a list of tag ids`);
  for (const id of list) ownTag(ctx, id);
  return [...new Set(list)];
}

function putClientTags(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.params.id);
  const wanted = tagIdsOf(ctx, ctx.body.tagIds, 'tagIds');
  tx(ctx.db, () => {
    const current = tagsOf(ctx.db, ctx.user.id, client.id).map(t => t.id);
    for (const id of wanted) if (!current.includes(id)) setClientTag(ctx.db, { coachId: ctx.user.id, clientId: client.id, tagId: id, on: true });
    for (const id of current) if (!wanted.includes(id)) setClientTag(ctx.db, { coachId: ctx.user.id, clientId: client.id, tagId: id, on: false });
  });
  return { tags: tagsOf(ctx.db, ctx.user.id, client.id) };
}

/** Every id must be one of the coach's clients; one foreign id fails the whole request (404) and writes nothing. */
export function ownClients(ctx, ids, name = 'clientIds') {
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => typeof id !== 'string')) fail(400, `${name} must be a list of client ids`);
  return [...new Set(ids)].map(id => clientFor(ctx, id));
}

function bulkTags(_req, ctx) {
  requireCoach(ctx);
  const clients = ownClients(ctx, ctx.body.clientIds);
  const add = tagIdsOf(ctx, ctx.body.add ?? [], 'add');
  const remove = tagIdsOf(ctx, ctx.body.remove ?? [], 'remove');
  let changed = 0;
  tx(ctx.db, () => {
    for (const c of clients) {
      for (const id of add) changed += setClientTag(ctx.db, { coachId: ctx.user.id, clientId: c.id, tagId: id, on: true }) ? 1 : 0;
      for (const id of remove) changed += setClientTag(ctx.db, { coachId: ctx.user.id, clientId: c.id, tagId: id, on: false }) ? 1 : 0;
    }
  });
  return { changed };
}

// MARK: - Segments

function segmentCount(db, coachId, rules) {
  return resolveAudience(db, coachId, { rules }).length;
}

const segmentOut = (db, s) => ({ id: s.id, name: s.name, description: s.description, rules: JSON.parse(s.rules), pinned: !!s.pinned, count: segmentCount(db, s.coach_id, JSON.parse(s.rules)), updatedAt: s.updated_at });

function segmentFields(ctx) {
  const b = ctx.body;
  const rules = validateRules(b.rules);
  if (factsIn(rules).includes('core.segments')) fail(400, 'A segment can\'t be built from other segments');
  return {
    name: str(b.name, 'name', { max: 80 }), description: str(b.description ?? '', 'description', { max: 500, min: 0 }),
    rules, pinned: b.pinned === undefined ? false : !!b.pinned,
  };
}

function listSegments(_req, ctx) {
  requireCoach(ctx);
  return { segments: ctx.db.prepare('SELECT * FROM segments WHERE coach_id=? ORDER BY pinned DESC, name').all(ctx.user.id).map(s => segmentOut(ctx.db, s)) };
}

function createSegment(_req, ctx) {
  requireCoach(ctx);
  const f = segmentFields(ctx);
  const id = newId('sg');
  ctx.db.prepare('INSERT INTO segments (id, coach_id, name, description, rules, pinned, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, ctx.user.id, f.name, f.description, JSON.stringify(f.rules), f.pinned ? 1 : 0, nowIso(), nowIso());
  return { segment: segmentOut(ctx.db, ctx.db.prepare('SELECT * FROM segments WHERE id=?').get(id)) };
}

function ownSegment(ctx) {
  requireCoach(ctx);
  const s = ctx.db.prepare('SELECT * FROM segments WHERE id=? AND coach_id=?').get(ctx.params.id, ctx.user.id);
  if (!s) fail(404, 'Not found');
  return s;
}

function updateSegment(_req, ctx) {
  const s = ownSegment(ctx);
  const f = segmentFields(ctx);
  ctx.db.prepare('UPDATE segments SET name=?, description=?, rules=?, pinned=?, updated_at=? WHERE id=?').run(f.name, f.description, JSON.stringify(f.rules), f.pinned ? 1 : 0, nowIso(), s.id);
  return { segment: segmentOut(ctx.db, ctx.db.prepare('SELECT * FROM segments WHERE id=?').get(s.id)) };
}

function deleteSegment(_req, ctx) {
  const s = ownSegment(ctx);
  ctx.db.prepare('DELETE FROM segments WHERE id=?').run(s.id);
  return { ok: true };
}

function previewSegment(_req, ctx) {
  requireCoach(ctx);
  const audience = ctx.body.audience ?? (ctx.body.rules ? { rules: ctx.body.rules } : null);
  if (!audience) fail(400, 'Send rules or an audience');
  const rows = resolveAudience(ctx.db, ctx.user.id, audience);
  return { count: rows.length, clients: rows.slice(0, 50).map(c => ({ id: c.id, name: c.name, initials: initials(c.name) })) };
}

// MARK: - Facts, prefs and outreach routes

function listFacts(_req, ctx) {
  requireCoach(ctx);
  return { facts: factCatalogue().map(f => ({ id: f.id, label: f.label, type: f.type, ...(f.options ? { options: f.options } : {}), feature: f.feature, ...(f.aiDerived ? { aiDerived: true } : {}) })) };
}

function clientFactsRoute(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.params.id);
  const all = factCatalogue().map(f => f.id);
  return { facts: clientFacts(ctx.db, ctx.user.id, [client.id], { only: all }).get(client.id) };
}

const PREF_KEY = /^[a-zA-Z0-9.-]{1,64}$/;

function getPref(_req, ctx) {
  requireCoach(ctx);
  if (!PREF_KEY.test(ctx.params.key)) fail(400, 'key must be letters, digits, dots and dashes');
  return { value: coachPref(ctx.db, ctx.user.id, ctx.params.key, null) };
}

function putPref(_req, ctx) {
  requireCoach(ctx);
  if (!PREF_KEY.test(ctx.params.key)) fail(400, 'key must be letters, digits, dots and dashes');
  if (!('value' in ctx.body)) fail(400, 'value is required');
  if (JSON.stringify(ctx.body.value ?? null).length > 16 * 1024) fail(413, 'value is limited to 16 KB');
  setCoachPref(ctx.db, ctx.user.id, ctx.params.key, ctx.body.value);
  return { ok: true };
}

function outreachOut(db, coachId, clientId) {
  return { outreach: { ...outreachOf(db, clientId), sentToday: cappedSentToday(db, clientId), cap: outreachSettings(db, coachId).dailyCap } };
}

function getOutreach(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.params.id);
  return outreachOut(ctx.db, ctx.user.id, client.id);
}

function putOutreach(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.params.id);
  const cur = outreachOf(ctx.db, client.id);
  const b = ctx.body;
  for (const k of ['paused', 'noBroadcasts']) if (b[k] !== undefined && typeof b[k] !== 'boolean') fail(400, `${k} must be true or false`);
  const next = {
    paused: b.paused ?? cur.paused, noBroadcasts: b.noBroadcasts ?? cur.noBroadcasts,
    note: b.note === undefined ? cur.note : str(b.note, 'note', { max: 500, min: 0 }),
  };
  ctx.db.prepare(`INSERT INTO client_outreach (client_id, coach_id, paused, no_broadcasts, note, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(client_id) DO UPDATE SET coach_id=excluded.coach_id, paused=excluded.paused, no_broadcasts=excluded.no_broadcasts, note=excluded.note, updated_at=excluded.updated_at`)
    .run(client.id, ctx.user.id, next.paused ? 1 : 0, next.noBroadcasts ? 1 : 0, next.note, nowIso());
  return outreachOut(ctx.db, ctx.user.id, client.id);
}

// MARK: - Actions

const nextMonday = d => addDays(d, (8 - weekday(d)) % 7);

/** Lookups the action builder fills id-typed params from: forms, programs, tags, segments. */
export function foundationLookups(db, coachId) {
  return {
    forms: db.prepare('SELECT id, name FROM forms WHERE coach_id=? ORDER BY name').all(coachId),
    programs: db.prepare('SELECT id, name FROM programs WHERE coach_id=? ORDER BY name').all(coachId),
    tags: db.prepare('SELECT id, name, color FROM tags WHERE coach_id=? ORDER BY name').all(coachId),
    segments: db.prepare('SELECT id, name FROM segments WHERE coach_id=? ORDER BY name').all(coachId),
  };
}

/** The action catalogue for the builder: `[{id, label, params, clientFacing, feature, critical?}]` (no functions). */
export const actionCatalogue = () => allActions().map(({ run: _r, options: _o, ...a }) => a);

const BUILTIN = {
  'message.send': (db, config, ctx) => {
    const { text } = render(db, ctx.coachId, ctx.client, ctx.params.text, { extra: ctx.extra });
    const out = sendMessage(db, config, { coachId: ctx.coachId, clientId: ctx.client.id, text, via: ctx.via ?? 'automation', now: ctx.now });
    return out.message ? 'Sent' : out.deferredUntil ? `Deferred to ${londonDay(new Date(out.deferredUntil)) === londonDay(ctx.now) ? '' : 'tomorrow '}${new Date(out.deferredUntil).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })}` : `Skipped: ${out.skipped}`;
  },
  'form.send': (db, config, ctx) => {
    const form = db.prepare('SELECT * FROM forms WHERE id=? AND coach_id=?').get(ctx.params.formId, ctx.coachId);
    if (!form) return 'Skipped: no form';
    const coach = db.prepare('SELECT name FROM users WHERE id=?').get(ctx.coachId);
    sendForm(db, config, form, ctx.client, { coachName: coach?.name, emit: true });
    return 'Sent';
  },
  'program.assign': (db, _config, ctx) => {
    const program = db.prepare('SELECT * FROM programs WHERE id=? AND coach_id=?').get(ctx.params.programId, ctx.coachId);
    if (!program) return 'Skipped: no program';
    const today = londonDay(ctx.now);
    const start = ctx.params.start === 'today' ? today : nextMonday(today);
    const n = layProgram(db, program, ctx.client.id, start, ctx.coachId, { publish: true });
    return `Laid ${n} workouts from ${start}`;
  },
  'tag.add': (db, _config, ctx) => {
    if (!db.prepare('SELECT 1 FROM tags WHERE id=? AND coach_id=?').get(ctx.params.tagId, ctx.coachId)) return 'Skipped: no tag';
    return setClientTag(db, { coachId: ctx.coachId, clientId: ctx.client.id, tagId: ctx.params.tagId, on: true, by: 'automation' }) ? 'Tagged' : 'Already tagged';
  },
  'tag.remove': (db, _config, ctx) => {
    if (!db.prepare('SELECT 1 FROM tags WHERE id=? AND coach_id=?').get(ctx.params.tagId, ctx.coachId)) return 'Skipped: no tag';
    return setClientTag(db, { coachId: ctx.coachId, clientId: ctx.client.id, tagId: ctx.params.tagId, on: false, by: 'automation' }) ? 'Untagged' : 'Not tagged';
  },
  'coach.notify': (db, config, ctx) => {
    const body = ctx.params.body ? render(db, ctx.coachId, ctx.client, ctx.params.body, { extra: ctx.extra }).text : '';
    const title = render(db, ctx.coachId, ctx.client, ctx.params.title, { extra: ctx.extra }).text;
    const n = notifyCoach(db, config, ctx.coachId, { clientId: ctx.client.id, kind: 'automation', title, body, path: `/clients/${ctx.client.id}`, icon: 'bolt', now: ctx.now, dedupe: ctx.dedupe ?? null });
    return n ? 'Notified' : 'Skipped: already notified';
  },
};

/**
 * Check an action's params against its ParamSpecs; returns the cleaned params
 * (defaults filled) or throws a 400 naming the param.
 */
export function checkParams(actionId, params = {}) {
  const action = allActions().find(a => a.id === actionId);
  if (!action) fail(400, `Unknown action ${actionId}`);
  if (typeof params !== 'object' || params === null || Array.isArray(params)) fail(400, 'params must be an object');
  const out = {};
  for (const p of action.params ?? []) {
    let v = params[p.key] ?? p.default;
    if (v === undefined || v === null || v === '') {
      if (p.required) fail(400, `${p.key} is required`);
      continue;
    }
    if (['number', 'money'].includes(p.type)) v = num(v, p.key, { int: p.type === 'money' });
    else if (p.type === 'enum') v = oneOf(v, p.key, (p.options ?? []).map(o => (typeof o === 'object' ? o.value : o)));
    else if (p.type === 'day') { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(v)) fail(400, `${p.key} must be YYYY-MM-DD`); }
    else v = str(v, p.key, { max: ['longtext', 'template'].includes(p.type) ? 4000 : 200 });
    out[p.key] = v;
  }
  return out;
}

/**
 * Do one action for one client, synchronously, inside the caller's tx.
 * ctx: {coachId, client (row), params, now, via?, event?, extra?, dedupe?}.
 * Returns a short outcome ("Sent", "Skipped: no form", "Created task").
 * Refuses (throws) a client who is not this coach's.
 */
export function runAction(db, config, actionId, ctx) {
  const action = allActions().find(a => a.id === actionId);
  if (!action) throw new Error(`Unknown action ${actionId}`);
  const client = db.prepare("SELECT * FROM users WHERE id=? AND role='client' AND coach_id=?").get(ctx.client?.id, ctx.coachId);
  if (!client) fail(404, 'Not found');
  const full = { ...ctx, client, now: ctx.now ?? new Date(), params: ctx.params ?? {} };
  const run = action.feature === 'core' ? BUILTIN[actionId] : action.run;
  return String(run(db, config, full) ?? 'Done');
}

export function factRoutes(r) {
  r.add('GET', '/api/facts', listFacts);
  r.add('GET', '/api/facts/clients/:id', clientFactsRoute);
  r.add('GET', '/api/tags', listTags);
  r.add('POST', '/api/tags', createTag);
  r.add('PATCH', '/api/tags/:id', updateTag);
  r.add('DELETE', '/api/tags/:id', deleteTag);
  r.add('PUT', '/api/coach/clients/:id/tags', putClientTags);
  r.add('POST', '/api/coach/clients/tags', bulkTags);
  r.add('GET', '/api/segments', listSegments);
  r.add('POST', '/api/segments/preview', previewSegment);
  r.add('POST', '/api/segments', createSegment);
  r.add('PUT', '/api/segments/:id', updateSegment);
  r.add('DELETE', '/api/segments/:id', deleteSegment);
  r.add('GET', '/api/coach/prefs/:key', getPref);
  r.add('PUT', '/api/coach/prefs/:key', putPref);
  r.add('GET', '/api/coach/clients/:id/outreach', getOutreach);
  r.add('PUT', '/api/coach/clients/:id/outreach', putOutreach);
}
