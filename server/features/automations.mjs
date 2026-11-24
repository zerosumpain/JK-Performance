import { initials, ownRow, requestNow, requireCoach } from '../access.mjs';
import { emit } from '../events.mjs';
import { actionCatalogue, checkParams, clientFacts, evaluate, factCatalogue, factsIn, foundationLookups, ownClients, resolveAudience, runAction, validateRules } from '../facts.mjs';
import { clock as clockField, fail, num, oneOf, str } from '../http.mjs';
import { outreachOf, outreachSettings } from '../messages.mjs';
import { inWindow, notifyCoach, windowEnd } from '../notifications.mjs';
import { allActions, allEvents, allFacts, featureNames } from '../registry.mjs';
import { newId, nowIso, tx } from '../store.mjs';
import { render, variableCatalogue } from '../templating.mjs';
import { addDays, londonClock, londonDay, londonToUtc, weekday } from '../time.mjs';

/**
 * F15 The automation builder (docs/design/desk-v2.md, WP5): "when X happens,
 * if Y, do Z". An automation is a trigger (an event, a weekly schedule, a
 * client entering a set of rules, or a manual enrolment), optional conditions
 * and up to 20 steps (waits and actions). Each client's way through it is a
 * run; a 30 s clock advances runs step by step, each step in its own
 * transaction with its log line, so a crash means late, never twice.
 *
 * Messages go through the foundation's outreach governor (sendMessage via
 * 'automation'): capped, held in quiet hours, skipped for paused clients.
 * Anything AI-derived may only drive coach-side steps (6.3): saving or turning
 * on such an automation with a client-facing step is refused, and the engine
 * re-checks at run time.
 */

export const MAX_STEPS = 20;
const LOG_CAP = 50;
const DAY_MS = 86_400_000;
/** The only steps an automation that uses an AI judgement may contain (6.3, D5). */
export const AI_SAFE_ACTIONS = ['coach.notify', 'task.create', 'tag.add', 'tag.remove', 'ai.draft'];
/** Steps that still run for a paused client (crm.stage = paused). */
const PAUSE_EXEMPT = ['coach.notify', 'task.create'];
const STEP_ID = /^[a-zA-Z0-9_-]{1,40}$/;
const EVENT_ID = /^[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.]+$/;
const WHERE_KEY = /^[a-zA-Z][a-zA-Z0-9]{0,40}$/;
export const AI_REFUSAL = 'Steps that message clients can\'t run on AI judgements';

const person = u => (u ? { id: u.id, name: u.name, initials: initials(u.name) } : null);
const parse = (s, fallback = null) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
const fmtWhen = iso => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// MARK: - Shape and validation

function cleanWhere(where) {
  if (where === undefined || where === null) return {};
  if (typeof where !== 'object' || Array.isArray(where)) fail(400, 'trigger.where must be an object');
  const keys = Object.keys(where);
  if (keys.length > 10) fail(400, 'trigger.where has more than 10 keys');
  const out = {};
  for (const k of keys) {
    if (!WHERE_KEY.test(k)) fail(400, `trigger.where.${k} is not a payload key`);
    const v = where[k];
    if (!['string', 'number', 'boolean'].includes(typeof v) || (typeof v === 'string' && v.length > 80)) fail(400, `trigger.where.${k} must be text, a number or true/false`);
    out[k] = v;
  }
  return out;
}

function cleanScheduleAudience(db, coachId, a) {
  if (a === undefined || a === null) return { everyone: true };
  if (typeof a !== 'object' || Array.isArray(a)) fail(400, 'trigger.audience must be an object');
  if (a.segmentId) {
    if (!db.prepare('SELECT 1 FROM segments WHERE id=? AND coach_id=?').get(a.segmentId, coachId)) fail(404, 'Not found');
    return { segmentId: a.segmentId };
  }
  if (Array.isArray(a.tagIds) && a.tagIds.length) {
    if (a.tagIds.length > 20 || a.tagIds.some(id => typeof id !== 'string')) fail(400, 'trigger.audience.tagIds must be a list of tag ids');
    for (const id of a.tagIds) if (!db.prepare('SELECT 1 FROM tags WHERE id=? AND coach_id=?').get(id, coachId)) fail(404, 'Not found');
    return { tagIds: [...new Set(a.tagIds)] };
  }
  return { everyone: true };
}

function cleanTrigger(db, coachId, t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) fail(400, 'trigger is required');
  const type = oneOf(t.type, 'trigger.type', ['event', 'schedule', 'enters', 'manual']);
  if (type === 'event') {
    if (typeof t.event !== 'string' || !EVENT_ID.test(t.event)) fail(400, 'trigger.event must be an event type');
    if (t.event.startsWith('automation.')) fail(400, 'An automation can\'t start from another automation');
    return { type, event: t.event, where: cleanWhere(t.where) };
  }
  if (type === 'schedule') {
    if (!Array.isArray(t.days) || !t.days.length || t.days.some(d => !Number.isInteger(d) || d < 1 || d > 7)) fail(400, 'trigger.days must be weekdays 1 (Monday) to 7 (Sunday)');
    return { type, days: [...new Set(t.days)].sort(), at: clockField(t.at, 'trigger.at'), audience: cleanScheduleAudience(db, coachId, t.audience) };
  }
  if (type === 'enters') {
    const rules = validateRules(t.rules, { name: 'trigger.rules' });
    if (!rules.rules.length) fail(400, 'trigger.rules needs at least one rule');
    return { type, rules };
  }
  return { type };
}

/**
 * Steps: waits {days 0–365, hours 0–72, at "HH:MM"|null} and actions
 * {action, params, if, critical}. Params of a known action are checked when
 * `strict` (turning on); a draft keeps what the coach has so far.
 */
function cleanSteps(list, { strict = false } = {}) {
  if (list === undefined || list === null) list = [];
  if (!Array.isArray(list) || list.length > MAX_STEPS) fail(400, `steps must be a list of at most ${MAX_STEPS}`);
  const seen = new Set();
  const actions = new Map(allActions().map(a => [a.id, a]));
  return list.map((s, i) => {
    const name = `steps[${i}]`;
    if (!s || typeof s !== 'object') fail(400, `${name} must be a step`);
    let id = s.id === undefined || s.id === null || s.id === '' ? `s${i + 1}` : str(s.id, `${name}.id`, { max: 40 });
    if (s.id === undefined && seen.has(id)) id = newId('s').replace('_', '');
    if (!STEP_ID.test(id)) fail(400, `${name}.id must be letters, digits, dashes or underscores`);
    if (seen.has(id)) fail(400, `${name}.id is repeated`);
    seen.add(id);
    const type = oneOf(s.type, `${name}.type`, ['wait', 'action']);
    if (type === 'wait') {
      const out = {
        id, type,
        days: num(s.days ?? 0, `${name}.days`, { min: 0, max: 365, int: true }),
        hours: num(s.hours ?? 0, `${name}.hours`, { min: 0, max: 72, int: true }),
        at: s.at ? clockField(s.at, `${name}.at`) : null,
      };
      if (strict && !out.days && !out.hours && !out.at) fail(400, `${name} waits for nothing`);
      return out;
    }
    if (typeof s.action !== 'string' || !EVENT_ID.test(s.action)) fail(400, `${name}.action must be an action id`);
    if (s.params !== undefined && (typeof s.params !== 'object' || s.params === null || Array.isArray(s.params))) fail(400, `${name}.params must be an object`);
    let params = s.params ?? {};
    if (JSON.stringify(params).length > 8000) fail(400, `${name}.params is too long`);
    const known = actions.get(s.action);
    if (strict && !known) fail(400, `${name}.action ${s.action} is not available`);
    if (known) {
      try { params = checkParams(s.action, params); } catch (e) {
        if (strict) fail(400, `${name}: ${e.message}`);
      }
    }
    const out = { id, type, action: s.action, params };
    if (s.if) {
      const rules = validateRules(s.if, { name: `${name}.if` });
      if (rules.rules.length) out.if = rules;
    }
    if (s.critical) out.critical = true;
    return out;
  });
}

const DEFAULT_SETTINGS = { reentry: 'never', quietHours: true, stopOn: ['message.received'], maxPerDay: 50 };

function cleanSettings(s) {
  if (s === undefined || s === null) return { ...DEFAULT_SETTINGS };
  if (typeof s !== 'object' || Array.isArray(s)) fail(400, 'settings must be an object');
  const out = { ...DEFAULT_SETTINGS };
  if (s.reentry !== undefined) {
    if (s.reentry === 'never' || s.reentry === 'always') out.reentry = s.reentry;
    else if (s.reentry && typeof s.reentry === 'object') out.reentry = { cooldownDays: num(s.reentry.cooldownDays, 'settings.reentry.cooldownDays', { min: 1, max: 365, int: true }) };
    else fail(400, 'settings.reentry must be never, always or {cooldownDays}');
  }
  if (s.quietHours !== undefined) {
    if (typeof s.quietHours !== 'boolean') fail(400, 'settings.quietHours must be true or false');
    out.quietHours = s.quietHours;
  }
  if (s.stopOn !== undefined) {
    if (!Array.isArray(s.stopOn) || s.stopOn.length > 10 || s.stopOn.some(e => typeof e !== 'string' || !EVENT_ID.test(e))) fail(400, 'settings.stopOn must be a list of event types');
    out.stopOn = [...new Set(s.stopOn)];
  }
  if (s.maxPerDay !== undefined) out.maxPerDay = num(s.maxPerDay, 'settings.maxPerDay', { min: 1, max: 1000, int: true });
  return out;
}

/** The AI-derived inputs an automation uses: its trigger event, its rules' facts, segment rules (6.3). */
export function aiInputs(db, a) {
  const events = new Map(allEvents().map(e => [e.type, e]));
  const aiFacts = new Set(allFacts().filter(f => f.aiDerived).map(f => f.id));
  const out = [];
  const t = a.trigger ?? {};
  if (t.type === 'event' && events.get(t.event)?.aiDerived) out.push(t.event);
  const rules = [t.rules, a.conditions, ...(a.steps ?? []).map(s => s.if)];
  if (t.audience?.segmentId) rules.push(parse(db.prepare('SELECT rules FROM segments WHERE id=?').get(t.audience.segmentId)?.rules));
  for (const r of rules) for (const id of factsIn(r)) if (aiFacts.has(id)) out.push(id);
  return [...new Set(out)];
}

/** Refuse (400) an automation that would let an AI judgement make something reach a client. */
function aiGuard(db, a) {
  if (!aiInputs(db, a).length) return;
  if ((a.steps ?? []).some(s => s.type === 'action' && !AI_SAFE_ACTIONS.includes(s.action))) fail(400, AI_REFUSAL);
}

/** Everything an automation needs before it may go live. */
function validateLive(db, a) {
  const steps = cleanSteps(a.steps, { strict: true });
  if (!steps.some(s => s.type === 'action')) fail(400, 'Add at least one action before turning it on');
  if (a.trigger.type === 'event' && !allEvents().some(e => e.type === a.trigger.event)) fail(400, `The event ${a.trigger.event} is not available`);
  for (const e of a.settings.stopOn ?? []) if (!allEvents().some(x => x.type === e)) fail(400, `settings.stopOn: ${e} is not available`);
  aiGuard(db, { ...a, steps });
  return steps;
}

function cleanAutomation(db, coachId, b, current = null) {
  if (JSON.stringify(b ?? {}).length > 64_000) fail(413, 'That automation is too big');
  const has = k => b[k] !== undefined;
  const out = {
    name: has('name') || !current ? str(b.name, 'name', { max: 80 }) : current.name,
    description: has('description') ? str(b.description ?? '', 'description', { max: 300, min: 0 }) : current?.description ?? '',
    trigger: has('trigger') || !current ? cleanTrigger(db, coachId, b.trigger) : current.trigger,
    conditions: has('conditions') ? (b.conditions ? validateRules(b.conditions, { name: 'conditions' }) : null) : current?.conditions ?? null,
    steps: has('steps') || !current ? cleanSteps(b.steps) : current.steps,
    settings: has('settings') || !current ? cleanSettings(b.settings) : current.settings,
  };
  if (out.conditions && !out.conditions.rules.length) out.conditions = null;
  aiGuard(db, out);
  return out;
}

const rowParts = r => ({ ...r, trigger: parse(r.trigger, { type: 'manual' }), conditions: parse(r.conditions), steps: parse(r.steps, []), settings: { ...DEFAULT_SETTINGS, ...parse(r.settings, {}) } });

// MARK: - Words ("Wait 2 days, then at 07:30")

const eventLabel = type => allEvents().find(e => e.type === type)?.label ?? type;
const actionOf = id => allActions().find(a => a.id === id) ?? null;
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const OP_WORD = { eq: 'is', ne: 'is not', gt: '>', gte: '≥', lt: '<', lte: '≤', in: 'is any of', notIn: 'is none of', has: 'has', hasNot: 'does not have', isSet: 'is set', isNotSet: 'is not set', between: 'between' };
const lower = s => (s ? s[0].toLowerCase() + s.slice(1) : s);
const clip = (s, n = 60) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function whereWords(where = {}) {
  return Object.entries(where).map(([k, v]) => {
    if (v === true) return k === 'byRole' ? '' : k;
    if (v === false) return `not ${k}`;
    if (k === 'byRole') return `by the ${v}`;
    if (k === 'hoursBefore') return `${v} hours before`;
    return `${k} ${v}`;
  }).filter(Boolean).join(', ');
}

function rulesWords(rules) {
  const facts = new Map(allFacts().map(f => [f.id, f]));
  const one = r => {
    if (r.rules) return `(${r.rules.map(one).join(r.match === 'any' ? ' or ' : ' and ')})`;
    const v = Array.isArray(r.value) ? r.value.join(r.op === 'between' ? '–' : ', ') : r.value;
    return `${facts.get(r.fact)?.label ?? r.fact} ${OP_WORD[r.op] ?? r.op}${['isSet', 'isNotSet'].includes(r.op) ? '' : ` ${v}`}`;
  };
  return rules?.rules?.length ? rules.rules.map(one).join(rules.match === 'any' ? ' or ' : ' and ') : '';
}

export function triggerWords(db, coachId, t) {
  if (t.type === 'event') {
    const w = whereWords(t.where);
    return `When ${lower(eventLabel(t.event))}${w ? ` (${w})` : ''}`;
  }
  if (t.type === 'schedule') {
    const days = t.days.length === 7 ? 'Every day' : t.days.length === 5 && t.days.every(d => d <= 5) ? 'Every weekday' : `Every ${t.days.map(d => DAY_NAMES[d - 1]).join(' and ')}`;
    let who = 'for everyone';
    if (t.audience?.segmentId) who = `for everyone in ${db.prepare('SELECT name FROM segments WHERE id=? AND coach_id=?').get(t.audience.segmentId, coachId)?.name ?? 'a removed segment'}`;
    else if (t.audience?.tagIds?.length) who = `for everyone tagged ${t.audience.tagIds.map(id => db.prepare('SELECT name FROM tags WHERE id=? AND coach_id=?').get(id, coachId)?.name ?? 'a removed tag').join(' or ')}`;
    return `${days} at ${t.at}, ${who}`;
  }
  if (t.type === 'enters') return `When a client starts to match: ${rulesWords(t.rules)}`;
  return 'When you add someone';
}

export function waitWords(s) {
  const parts = [];
  if (s.days) parts.push(plural(s.days, 'day'));
  if (s.hours) parts.push(plural(s.hours, 'hour'));
  if (!parts.length) return s.at ? `Wait until ${s.at}` : 'Carry straight on';
  return `Wait ${parts.join(' and ')}${s.at ? `, then at ${s.at}` : ''}`;
}

export function stepWords(db, coachId, s) {
  if (s.type === 'wait') return waitWords(s);
  const a = actionOf(s.action);
  const label = a?.label ?? s.action;
  const p = s.params ?? {};
  let detail = '';
  if (s.action === 'message.send') detail = p.text ? `“${clip(p.text)}”` : '';
  else if (s.action === 'coach.notify' || s.action === 'task.create') detail = p.title ? `“${clip(p.title)}”` : '';
  else if (['tag.add', 'tag.remove'].includes(s.action)) detail = db.prepare('SELECT name FROM tags WHERE id=? AND coach_id=?').get(p.tagId, coachId)?.name ?? '';
  else if (s.action === 'form.send') detail = db.prepare('SELECT name FROM forms WHERE id=? AND coach_id=?').get(p.formId, coachId)?.name ?? '';
  else if (s.action === 'program.assign') detail = db.prepare('SELECT name FROM programs WHERE id=? AND coach_id=?').get(p.programId, coachId)?.name ?? '';
  return `${label}${detail ? `: ${detail}` : ''}${s.if ? ` (only if ${rulesWords(s.if)})` : ''}`;
}

/** The whole automation in one sentence. */
export function sentence(db, coachId, a) {
  const steps = a.steps.map(s => lower(stepWords(db, coachId, s)));
  const cond = a.conditions ? `, if ${rulesWords(a.conditions)}` : '';
  return `${triggerWords(db, coachId, a.trigger)}${cond}${steps.length ? `: ${steps.join(', then ')}` : ': nothing yet'}.`;
}

// MARK: - Time

/**
 * When a wait ends, from `base`. Without `at`: `days` London calendar days
 * later at the same wall-clock time (so a DST change never shifts it), plus
 * `hours`. With `at`: on the London day `days` after (base + hours), at that
 * London time; with days 0 that is the next time the clock reads `at`.
 */
export function waitUntil(base, { days = 0, hours = 0, at = null }) {
  if (!at) {
    const t = days ? londonToUtc(addDays(londonDay(base), days), londonClock(base)).getTime() + (base.getTime() % 60_000) : base.getTime();
    return new Date(t + hours * 3_600_000);
  }
  const shifted = new Date(base.getTime() + hours * 3_600_000);
  const day = addDays(londonDay(shifted), days);
  const target = londonToUtc(day, at);
  return target.getTime() >= shifted.getTime() ? target : londonToUtc(addDays(day, 1), at);
}

// MARK: - Runs

function appendLog(log, entry) {
  const next = [...log, entry];
  return next.length > LOG_CAP ? [next[0], ...next.slice(-(LOG_CAP - 1))] : next;
}

function logRun(db, run, entry, fields = {}) {
  const log = appendLog(parse(run.log, []), entry);
  const sets = ['log=?'], args = [JSON.stringify(log)];
  for (const [k, v] of Object.entries(fields)) { sets.push(`${k}=?`); args.push(v); }
  db.prepare(`UPDATE automation_runs SET ${sets.join(', ')} WHERE id=?`).run(...args, run.id);
  run.log = JSON.stringify(log);
  Object.assign(run, fields);
}

function finishRun(db, run, status, outcome, now) {
  logRun(db, run, { stepId: null, at: now.toISOString(), outcome }, { status, finished_at: now.toISOString(), next_at: null });
  const type = status === 'done' ? 'automation.finished' : status === 'failed' ? 'automation.failed' : null;
  if (type) emit(db, type, { coachId: run.coach_id, clientId: run.client_id, summary: `${status === 'done' ? 'Finished' : 'Failed'} · ${db.prepare('SELECT name FROM automations WHERE id=?').get(run.automation_id)?.name ?? 'automation'}`, automationId: run.automation_id, runId: run.id });
}

const hasClientFacing = a => a.steps.some(s => s.type === 'action' && actionOf(s.action)?.clientFacing !== false);

/**
 * Can this client start a run now? Returns null, or the reason they cannot
 * ("already running", "conditions not met"). Reads only.
 */
function startBlocker(db, a, client, now) {
  if (!client || client.coach_id !== a.coach_id || client.role !== 'client') return 'not your client';
  if (db.prepare("SELECT 1 FROM automation_runs WHERE automation_id=? AND client_id=? AND status='active'").get(a.id, client.id)) return 'already in it';
  const last = db.prepare('SELECT MAX(started_at) at FROM automation_runs WHERE automation_id=? AND client_id=?').get(a.id, client.id).at;
  const re = a.settings.reentry;
  if (last && re === 'never') return 'has been through it before';
  if (last && re?.cooldownDays && Date.parse(last) > now.getTime() - re.cooldownDays * DAY_MS) return `started it in the last ${plural(re.cooldownDays, 'day')}`;
  if (hasClientFacing(a) && outreachOf(db, client.id).paused) return 'outreach paused';
  if (a.conditions) {
    const facts = clientFacts(db, a.coach_id, [client.id], { only: factsIn(a.conditions), now }).get(client.id) ?? {};
    if (!evaluate(a.conditions, facts)) return 'conditions not met';
  }
  return null;
}

/** Start a run for one client (inside the caller's tx). Returns {run} or {skipped: reason}. */
function startRun(db, config, a, client, { now, source = '', triggerSeq = null }) {
  const blocked = startBlocker(db, a, client, now);
  if (blocked) return { skipped: blocked };
  const day = londonDay(now);
  const today = db.prepare('SELECT COUNT(*) n FROM automation_runs WHERE automation_id=? AND started_at>=? AND started_at<?')
    .get(a.id, londonToUtc(day).toISOString(), londonToUtc(addDays(day, 1)).toISOString()).n;
  if (today >= a.settings.maxPerDay) {
    console.warn(`Automation ${a.id} reached its ${a.settings.maxPerDay} starts today; dropped ${client.id}`);
    notifyCoach(db, config, a.coach_id, { kind: 'automation', title: `${a.name} hit its daily limit`, body: `It starts at most ${a.settings.maxPerDay} runs a day; the rest today were dropped.`,
      path: `/automations/${a.id}/runs`, icon: 'bolt', tone: 'attention', dedupe: `automation.cap:${a.id}:${day}`, now });
    return { skipped: 'daily limit reached' };
  }
  let nextAt = now;
  const log = [{ stepId: null, at: now.toISOString(), outcome: `Started${source ? ` · ${source}` : ''}` }];
  if (a.settings.quietHours) {
    const quiet = outreachSettings(db, a.coach_id).quietHours;
    if (inWindow(now, quiet)) {
      nextAt = windowEnd(now, quiet);
      log.push({ stepId: null, at: now.toISOString(), outcome: `Waiting for quiet hours to end (${fmtWhen(nextAt.toISOString())})` });
    }
  }
  const id = newId('aur');
  db.prepare("INSERT INTO automation_runs (id, automation_id, coach_id, client_id, status, step_index, next_at, trigger_seq, log, started_at) VALUES (?,?,?,?,'active',0,?,?,?,?)")
    .run(id, a.id, a.coach_id, client.id, nextAt.toISOString(), triggerSeq, JSON.stringify(log), now.toISOString());
  db.prepare(`INSERT INTO automation_state (automation_id, client_id, inside, last_started_at) VALUES (?,?,0,?)
    ON CONFLICT(automation_id, client_id) DO UPDATE SET last_started_at=excluded.last_started_at`).run(a.id, client.id, now.toISOString());
  emit(db, 'automation.started', { coachId: a.coach_id, clientId: client.id, summary: `Started · ${a.name}`, automationId: a.id, runId: id });
  return { run: db.prepare('SELECT * FROM automation_runs WHERE id=?').get(id) };
}

const pausedFactKnown = () => allFacts().some(f => f.id === 'crm.stage');

/**
 * Do one step of one due run, in the caller's tx. Returns 'continue' when the
 * next step may run now, else 'idle'.
 */
function stepOnce(db, config, runId, now) {
  const run = db.prepare(`SELECT r.* FROM automation_runs r JOIN automations a ON a.id=r.automation_id
    WHERE r.id=? AND r.status='active' AND r.next_at<=? AND a.status='live'`).get(runId, now.toISOString());
  if (!run) return 'idle';
  const a = rowParts(db.prepare('SELECT * FROM automations WHERE id=?').get(run.automation_id));
  const client = db.prepare("SELECT * FROM users WHERE id=? AND role='client'").get(run.client_id);
  if (!client || client.coach_id !== run.coach_id) { finishRun(db, run, 'stopped', 'Stopped: no longer your client', now); return 'idle'; }
  if (run.step_index >= a.steps.length) { finishRun(db, run, 'done', 'Finished', now); return 'idle'; }
  const step = a.steps[run.step_index];
  const at = now.toISOString();
  const next = run.step_index + 1;
  if (step.type === 'wait') {
    const until = waitUntil(now, step);
    if (until.getTime() <= now.getTime()) { db.prepare('UPDATE automation_runs SET step_index=? WHERE id=?').run(next, run.id); return 'continue'; }
    logRun(db, run, { stepId: step.id, at, outcome: `Waiting until ${fmtWhen(until.toISOString())}` }, { step_index: next, next_at: until.toISOString() });
    return 'idle';
  }
  // A paused client's steps wait (except telling the coach), re-checked every 6 hours.
  if (!PAUSE_EXEMPT.includes(step.action) && pausedFactKnown()) {
    const stage = clientFacts(db, run.coach_id, [client.id], { only: ['crm.stage'], now }).get(client.id)?.['crm.stage'];
    if (stage === 'paused') {
      const last = parse(run.log, []).at(-1);
      const deferred = { next_at: new Date(now.getTime() + 6 * 3_600_000).toISOString() };
      if (last?.stepId === step.id && last.outcome === 'Deferred: client paused') db.prepare('UPDATE automation_runs SET next_at=? WHERE id=?').run(deferred.next_at, run.id);
      else logRun(db, run, { stepId: step.id, at, outcome: 'Deferred: client paused' }, deferred);
      return 'idle';
    }
  }
  if (step.if) {
    const facts = clientFacts(db, run.coach_id, [client.id], { only: factsIn(step.if), now }).get(client.id) ?? {};
    if (!evaluate(step.if, facts)) { logRun(db, run, { stepId: step.id, at, outcome: 'Skipped: condition not met' }, { step_index: next }); return 'continue'; }
  }
  const action = actionOf(step.action);
  let outcome;
  let broke = false;
  if (!action) { outcome = `failed: ${step.action} is not available`; broke = true; }
  else if (aiInputs(db, a).length && !AI_SAFE_ACTIONS.includes(step.action)) outcome = 'refused: aiDerived';
  else {
    try {
      outcome = tx(db, () => runAction(db, config, step.action, { coachId: run.coach_id, client, params: step.params ?? {}, now, via: 'automation', dedupe: `aur:${run.id}:${step.id}` }));
    } catch (e) {
      outcome = `failed: ${String(e?.message ?? e).slice(0, 160)}`;
      broke = true;
    }
  }
  if (broke && (step.critical || action?.critical)) {
    logRun(db, run, { stepId: step.id, at, outcome }, { step_index: next });
    finishRun(db, run, 'failed', 'Failed: a critical step did not work', now);
    return 'idle';
  }
  logRun(db, run, { stepId: step.id, at, outcome }, { step_index: next });
  if (next >= a.steps.length) { finishRun(db, run, 'done', 'Finished', now); return 'idle'; }
  return 'continue';
}

/** Run one due run as far as it can go now (each step in its own transaction). */
export function advanceRun(db, config, runId, now) {
  for (let i = 0; i < MAX_STEPS + 2; i++) {
    let r;
    try { r = tx(db, () => stepOnce(db, config, runId, now)); } catch (e) { console.error(`Automation run ${runId} failed`, e); return; }
    if (r !== 'continue') return;
  }
}

/** The 30 s clock: due runs of live automations, oldest first, 100 at a time. */
export function advanceDue(db, config, now = new Date()) {
  const due = db.prepare(`SELECT r.id FROM automation_runs r JOIN automations a ON a.id=r.automation_id
    WHERE r.status='active' AND r.next_at<=? AND a.status='live' ORDER BY r.next_at LIMIT 100`).all(now.toISOString());
  for (const r of due) advanceRun(db, config, r.id, now);
  return due.length;
}

function stopRun(db, run, outcome, now) {
  if (run.status !== 'active') return false;
  finishRun(db, run, 'stopped', outcome, now);
  return true;
}

// MARK: - Triggers

const liveOf = (db, coachId, type) => db.prepare("SELECT * FROM automations WHERE coach_id=? AND status='live' AND json_extract(trigger, '$.type')=?").all(coachId, type).map(rowParts);

/** Every event: stopOn, end of coaching, then event triggers. Synchronous, inside the drain's tx. */
function onEvent(db, config, e) {
  if (!e.coachId || e.type.startsWith('automation.')) return;
  const now = new Date(e.at);
  if (e.clientId) {
    const runs = db.prepare(`SELECT r.*, a.settings FROM automation_runs r JOIN automations a ON a.id=r.automation_id
      WHERE r.client_id=? AND r.coach_id=? AND r.status='active'`).all(e.clientId, e.coachId);
    for (const r of runs) {
      const { settings, ...run } = r;
      if (e.type === 'client.offboarded') stopRun(db, run, 'Stopped: coaching ended', now);
      else if ((parse(settings, {}).stopOn ?? DEFAULT_SETTINGS.stopOn).includes(e.type)) stopRun(db, run, `Stopped: ${lower(eventLabel(e.type))}`, now);
    }
  }
  if (!e.clientId) return;
  // An automation's own message never starts another automation (no loops).
  if (e.type === 'message.sent' && e.payload?.via === 'automation') return;
  const live = liveOf(db, e.coachId, 'event').filter(a => a.trigger.event === e.type);
  if (!live.length) return;
  const client = db.prepare("SELECT * FROM users WHERE id=? AND role='client' AND coach_id=?").get(e.clientId, e.coachId);
  if (!client) return;
  for (const a of live) {
    const where = a.trigger.where ?? {};
    if (!Object.entries(where).every(([k, v]) => e.payload?.[k] === v)) continue;
    startRun(db, config, a, client, { now, source: e.summary || eventLabel(e.type), triggerSeq: e.seq });
  }
}

/** The 15 min clock: who now matches each live "enters" automation. The first look only records. */
export function evaluateEnters(db, config, now = new Date()) {
  let started = 0;
  for (const a of db.prepare("SELECT * FROM automations WHERE status='live' AND json_extract(trigger, '$.type')='enters'").all().map(rowParts)) {
    try {
      const clients = db.prepare("SELECT * FROM users WHERE role='client' AND coach_id=?").all(a.coach_id);
      const facts = clientFacts(db, a.coach_id, clients.map(c => c.id), { only: factsIn(a.trigger.rules), now });
      const first = !a.evaluated_at;
      tx(db, () => {
        for (const c of clients) {
          const inside = evaluate(a.trigger.rules, facts.get(c.id) ?? {}) ? 1 : 0;
          const prev = db.prepare('SELECT inside FROM automation_state WHERE automation_id=? AND client_id=?').get(a.id, c.id)?.inside ?? 0;
          db.prepare(`INSERT INTO automation_state (automation_id, client_id, inside) VALUES (?,?,?)
            ON CONFLICT(automation_id, client_id) DO UPDATE SET inside=excluded.inside`).run(a.id, c.id, inside);
          if (!first && inside && !prev && startRun(db, config, a, c, { now, source: 'Started to match' }).run) started++;
        }
        db.prepare('UPDATE automations SET evaluated_at=? WHERE id=?').run(now.toISOString(), a.id);
      });
    } catch (e) { console.error(`Automation ${a.id}: enters check failed`, e); }
  }
  return started;
}

/** The 1 min clock: weekly schedules, once per slot (automation_slots), never for a slot before it went live. */
export function runSchedules(db, config, now = new Date()) {
  let started = 0;
  const day = londonDay(now);
  for (const a of db.prepare("SELECT * FROM automations WHERE status='live' AND json_extract(trigger, '$.type')='schedule'").all().map(rowParts)) {
    const t = a.trigger;
    if (!t.days.includes(weekday(day))) continue;
    const slotAt = londonToUtc(day, t.at);
    if (slotAt.getTime() > now.getTime() || now.getTime() - slotAt.getTime() > 12 * 3_600_000) continue;
    if (a.live_at && Date.parse(a.live_at) > slotAt.getTime()) continue;
    try {
      tx(db, () => {
        if (!db.prepare('INSERT OR IGNORE INTO automation_slots (automation_id, slot) VALUES (?,?)').run(a.id, `${day}T${t.at}`).changes) return;
        let people;
        const aud = t.audience ?? { everyone: true };
        const purpose = hasClientFacing(a) ? 'automated' : 'any';
        if (aud.segmentId) people = resolveAudience(db, a.coach_id, { segmentId: aud.segmentId }, { purpose, now });
        else if (aud.tagIds?.length) people = resolveAudience(db, a.coach_id, { rules: { match: 'any', rules: aud.tagIds.map(id => ({ fact: 'core.tags', op: 'has', value: id })) } }, { purpose, now });
        else people = resolveAudience(db, a.coach_id, { rules: { match: 'all', rules: [] } }, { purpose, now });
        for (const c of people) if (startRun(db, config, a, c, { now, source: `${DAY_NAMES[weekday(day) - 1]} ${t.at}` }).run) started++;
      });
    } catch (e) { console.error(`Automation ${a.id}: schedule failed`, e); }
  }
  return started;
}

// MARK: - Test mode (no side effects)

/**
 * What would happen for this client: whether it would start, and a timeline of
 * every step with its time and the rendered message. Reads only: nothing is
 * sent, created or emitted.
 */
function simulate(db, a, client, { now, event = null }) {
  let willRun = true, reason = null;
  if (a.trigger.type === 'event' && event) {
    if (event.type && event.type !== a.trigger.event) { willRun = false; reason = `the trigger is ${a.trigger.event}, not ${event.type}`; }
    else if (!Object.entries(a.trigger.where ?? {}).every(([k, v]) => event.payload?.[k] === v)) { willRun = false; reason = `the event does not match (${whereWords(a.trigger.where)})`; }
  }
  if (willRun) { const b = startBlocker(db, a, client, now); if (b) { willRun = false; reason = b; } }
  const ai = aiInputs(db, a).length > 0;
  const quiet = outreachSettings(db, a.coach_id).quietHours;
  let t = now;
  const timeline = [{ at: t.toISOString(), stepId: null, description: `${triggerWords(db, a.coach_id, a.trigger)}${a.conditions ? `, if ${rulesWords(a.conditions)}` : ''}`, kind: 'trigger' }];
  if (a.settings.quietHours && inWindow(t, quiet)) {
    t = windowEnd(t, quiet);
    timeline.push({ at: t.toISOString(), stepId: null, description: 'Waits for quiet hours to end', kind: 'wait' });
  }
  for (const s of a.steps) {
    if (s.type === 'wait') {
      t = waitUntil(t, s);
      timeline.push({ at: t.toISOString(), stepId: s.id, description: waitWords(s), kind: 'wait' });
      continue;
    }
    const item = { at: t.toISOString(), stepId: s.id, description: stepWords(db, a.coach_id, s), kind: 'action' };
    const action = actionOf(s.action);
    if (!action) item.skipped = `${s.action} is not available`;
    else if (ai && !AI_SAFE_ACTIONS.includes(s.action)) item.skipped = 'refused: AI-derived automations can\'t message clients';
    else if (s.if) {
      const facts = clientFacts(db, a.coach_id, [client.id], { only: factsIn(s.if), now }).get(client.id) ?? {};
      if (!evaluate(s.if, facts)) item.skipped = 'condition not met today';
    }
    const p = s.params ?? {};
    if (!item.skipped && s.action === 'message.send' && p.text) {
      const r = render(db, a.coach_id, client, p.text, { now: t });
      item.rendered = r.text;
      if (r.missing.length) item.missing = r.missing;
      if (inWindow(t, quiet)) item.note = `Held until ${fmtWhen(windowEnd(t, quiet).toISOString())} (quiet hours)`;
      else if (outreachOf(db, client.id).paused) item.note = 'Skipped: outreach paused';
    } else if (!item.skipped && ['coach.notify', 'task.create'].includes(s.action) && p.title) {
      item.rendered = [render(db, a.coach_id, client, p.title, { now: t }).text, p.body ? render(db, a.coach_id, client, p.body, { now: t }).text : null].filter(Boolean).join(' · ');
    }
    timeline.push(item);
  }
  return { willRun, ...(reason ? { reason } : {}), timeline };
}

// MARK: - Output

function statsOf(db, id, now = new Date()) {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const s = db.prepare(`SELECT COUNT(*) runs30, SUM(status='active') active, SUM(status='failed') failed,
      SUM(CASE WHEN status<>'failed' AND log LIKE '%"outcome":"failed:%' THEN 1 ELSE 0 END) stepErrors, MAX(started_at) last
    FROM automation_runs WHERE automation_id=? AND started_at>=?`).get(id, since);
  const active = db.prepare("SELECT COUNT(*) n FROM automation_runs WHERE automation_id=? AND status='active'").get(id).n;
  const last = db.prepare('SELECT MAX(started_at) at FROM automation_runs WHERE automation_id=?').get(id).at;
  const byDay = new Map(db.prepare("SELECT substr(started_at,1,10) d, COUNT(*) n FROM automation_runs WHERE automation_id=? AND started_at>=? GROUP BY d")
    .all(id, new Date(now.getTime() - 14 * DAY_MS).toISOString()).map(r => [r.d, r.n]));
  const daily = Array.from({ length: 14 }, (_, i) => byDay.get(new Date(now.getTime() - (13 - i) * DAY_MS).toISOString().slice(0, 10)) ?? 0);
  return { runs30: s.runs30 ?? 0, active, errors30: (s.failed ?? 0) + (s.stepErrors ?? 0), lastRunAt: last ?? null, daily };
}

/** Event, action and fact ids an automation uses that no loaded feature provides. */
function missingOf(a) {
  const events = new Set(allEvents().map(e => e.type));
  const actions = new Set(allActions().map(x => x.id));
  const facts = new Set(allFacts().map(f => f.id));
  const out = [];
  if (a.trigger.type === 'event' && !events.has(a.trigger.event)) out.push(a.trigger.event);
  for (const s of a.steps) if (s.type === 'action' && !actions.has(s.action)) out.push(s.action);
  for (const r of [a.trigger.rules, a.conditions, ...a.steps.map(s => s.if)]) for (const f of factsIn(r)) if (!facts.has(f)) out.push(f);
  return [...new Set(out)];
}

/** Which feature provides an id (for "Needs Tasks"). */
const PROVIDER = [
  [/^task\./, 'tasks', 'Tasks'], [/^(pulse|insights)\./, 'insights', 'Insights'], [/^(offer|referral)\./, 'offers', 'Offers'],
  [/^(invoice|payment|package|billing|refund)\./, 'billing', 'Billing'], [/^campaign\./, 'campaigns', 'Campaigns'],
  [/^(voice)\./, 'voice', 'Voice notes'], [/^ai\./, 'aireview', 'AI'], [/^onboarding\./, 'onboarding', 'Onboarding'],
  [/^(crm|lifecycle)\.|^client\.(stageChanged|paused|resumed|offboarded)$/, 'crm', 'Lifecycle'],
  [/^(diary|session)\.|^booking\.(attended|noShow|lateCancel)$/, 'diary', 'Diary'],
  [/^(calendar|waitlist|hold)\.|^booking\.(rescheduled|upcoming|series)$/, 'calsync', 'Calendar sync'],
  [/^accountability\./, 'accountability', 'Accountability'], [/^lead\./, 'leads', 'Leads'],
];
export const providerOf = id => { const p = PROVIDER.find(([re]) => re.test(id)); return p ? { feature: p[1], label: p[2] } : { feature: null, label: id }; };
const needsOf = missing => [...new Set(missing.map(id => providerOf(id).label))];

function automationOut(db, r, { now = new Date(), withStats = true } = {}) {
  const a = rowParts(r);
  const missing = missingOf(a);
  return {
    id: a.id, name: a.name, description: a.description, status: a.status, trigger: a.trigger, conditions: a.conditions, steps: a.steps, settings: a.settings,
    recipe: a.recipe, fromAutoflowId: a.from_autoflow_id, createdAt: a.created_at, updatedAt: a.updated_at, liveAt: a.live_at ?? null,
    sentence: sentence(db, a.coach_id, a), triggerWords: triggerWords(db, a.coach_id, a.trigger),
    stepWords: Object.fromEntries(a.steps.map(s => [s.id, stepWords(db, a.coach_id, s)])),
    aiDerived: aiInputs(db, a).length > 0, missing, needs: needsOf(missing),
    ...(withStats ? { stats: statsOf(db, a.id, now) } : {}),
  };
}

function runOut(db, r, a) {
  const steps = a.steps;
  const log = parse(r.log, []);
  const byId = new Map(steps.map((s, i) => [s.id, { s, i }]));
  const current = r.status === 'active' ? steps[r.step_index] ?? null : null;
  const lastWait = r.status === 'active' && r.step_index > 0 ? steps[r.step_index - 1] : null;
  return {
    id: r.id, automationId: r.automation_id, client: person({ id: r.client_id, name: r.client_name }), status: r.status,
    startedAt: r.started_at, finishedAt: r.finished_at, nextAt: r.next_at, stepIndex: r.step_index, steps: steps.length,
    current: current ? { id: current.id, description: stepWords(db, a.coach_id, current), waiting: lastWait?.type === 'wait' } : null,
    log: log.map(l => ({ ...l, step: l.stepId && byId.has(l.stepId) ? { index: byId.get(l.stepId).i, description: stepWords(db, a.coach_id, byId.get(l.stepId).s) } : null })),
    failed: log.some(l => /^failed:/.test(l.outcome ?? '')),
  };
}

// MARK: - Catalogue and recipes

const ID_TYPES = { form: 'forms', program: 'programs', tag: 'tags', segment: 'segments', campaign: 'campaigns', package: 'packages', discount: 'discounts' };

function catalogue(db, coachId) {
  const f = foundationLookups(db, coachId);
  const lookups = {
    forms: f.forms.map(x => ({ value: x.id, label: x.name })), programs: f.programs.map(x => ({ value: x.id, label: x.name })),
    tags: f.tags.map(x => ({ value: x.id, label: x.name, color: x.color })), segments: f.segments.map(x => ({ value: x.id, label: x.name })),
  };
  for (const a of allActions()) {
    if (typeof a.options !== 'function') continue;
    let opts = [];
    try { opts = (a.options(db, coachId) ?? []).map(o => ({ value: o.value ?? o.id, label: o.label ?? o.name ?? String(o.value ?? o.id) })); } catch (e) { console.error(`options of ${a.id} failed`, e); }
    for (const p of a.params ?? []) if (ID_TYPES[p.type] && !['forms', 'programs', 'tags', 'segments'].includes(ID_TYPES[p.type])) lookups[ID_TYPES[p.type]] = opts;
  }
  return {
    events: allEvents().filter(e => !e.type.startsWith('automation.')).map(e => ({ type: e.type, label: e.label, payload: e.payload, feature: e.feature, ...(e.aiDerived ? { aiDerived: true } : {}) })),
    actions: actionCatalogue().map(a => ({ id: a.id, label: a.label, params: a.params ?? [], clientFacing: a.clientFacing !== false, feature: a.feature, ...(a.critical ? { critical: true } : {}), aiSafe: AI_SAFE_ACTIONS.includes(a.id) })),
    facts: factCatalogue(), variables: variableCatalogue(), lookups, features: featureNames(),
  };
}

const msg = (text, extra = {}) => ({ type: 'action', action: 'message.send', params: { text }, ...extra });
const note = (title, body) => ({ type: 'action', action: 'coach.notify', params: body ? { title, body } : { title } });
const task = title => ({ type: 'action', action: 'task.create', params: { title } });
const wait = (days, hours = 0, at = null) => ({ type: 'wait', days, hours, at });
const ev = (event, where = {}) => ({ type: 'event', event, where });
const enters = (fact, op, value) => ({ type: 'enters', rules: { match: 'all', rules: [{ fact, op, value }] } });

/** The 18 built-in recipes (F15). `icon` and `tone` are for the gallery. */
export const RECIPES = [
  { id: 'late-cancel', name: 'Late-cancel follow-up', icon: 'event_busy', description: 'A late cancel gets a kind check-in an hour later, and you get a task to call.',
    automation: { trigger: ev('booking.cancelled', { late: true, byRole: 'client' }), steps: [wait(0, 1), msg('Hi {first}, sorry we missed you today. Everything OK? Let\'s find a new time this week.'), task('Call {first} about the late cancel')], settings: { reentry: { cooldownDays: 7 } } } },
  { id: 'no-show', name: 'No-show check-in', icon: 'person_search', description: 'Someone missed a session without a word: a warm message, never a telling-off.',
    automation: { trigger: ev('booking.noShow'), steps: [wait(0, 2), msg('Hey {first}, missed you today. All good? No stress, just want to check in.'), note('No-show: {name}')], settings: { reentry: 'always' } } },
  { id: 'welcome', name: 'Welcome series', icon: 'person_add', description: 'Day 0 hello, the intake form on day 2, and a check-in on day 7.',
    automation: { trigger: ev('client.joined'), steps: [msg('Welcome to JK Performance, {first}! Delighted to have you. Have a look round the app and say hello.'), wait(2, 0, '09:00'), { type: 'action', action: 'form.send', params: {} }, wait(5, 0, '09:00'), msg('One week in, {first}. How is it feeling? Anything I can make easier?')], settings: { reentry: 'never' } } },
  { id: 'quiet-5', name: 'Quiet 5 days nudge', icon: 'snooze', description: 'When someone goes five days without a word or a workout, a light nudge.',
    automation: { trigger: enters('core.daysQuiet', 'gte', 5), steps: [wait(0, 0, '08:00'), msg('Hey {first}, it\'s been {daysQuiet} days. Even a ten-minute walk counts. What\'s one small thing you can do today?')], settings: { reentry: { cooldownDays: 14 } } } },
  { id: 'at-risk', name: 'At-risk alert', icon: 'heart_broken', description: 'When a client slips into At risk, you hear about it and get a call on your list.',
    automation: { trigger: ev('client.stageChanged', { to: 'atRisk' }), steps: [note('{first} is at risk', 'Their health score dropped. A call this week could turn it round.'), task('Offer {first} a check-in call')], settings: { reentry: { cooldownDays: 30 } } } },
  { id: 'session-reminder', name: 'Session reminder', icon: 'alarm', description: 'The day before a session, a friendly reminder with the time.',
    automation: { trigger: ev('booking.upcoming', { hoursBefore: 24 }), steps: [msg('See you {nextSession}, {first}. Bring water and an appetite for work.')], settings: { reentry: 'always', quietHours: true } } },
  { id: 'payment-thanks', name: 'Payment thank-you', icon: 'payments', description: 'A short thank-you when a payment comes in.',
    automation: { trigger: ev('payment.recorded'), steps: [msg('Thanks {first}, payment received. Appreciate you.')], settings: { reentry: 'always' } } },
  { id: 'package-low', name: 'Package running low', icon: 'hourglass_empty', description: 'Two sessions left on a package: a heads-up and a renewal offer.',
    automation: { trigger: ev('package.low'), steps: [msg('Heads up {first}: you have {packageLeft} left on your package. Want me to line up the next block?'), { type: 'action', action: 'offer.issue', params: {} }], settings: { reentry: { cooldownDays: 30 } } } },
  { id: 'nps-30', name: 'NPS at day 30', icon: 'sentiment_satisfied', description: 'A month in, ask how likely they are to recommend you.',
    automation: { trigger: enters('core.daysSinceJoined', 'gte', 30), steps: [wait(0, 0, '10:00'), { type: 'action', action: 'pulse.send', params: {} }], settings: { reentry: 'never' } } },
  { id: 'campaign-kickoff', name: 'Campaign kickoff', icon: 'rocket_launch', description: 'The day someone joins a campaign, a kickoff message.',
    automation: { trigger: ev('campaign.enrolled'), steps: [msg('Day one, {first}! Your plan is up in the app. Start easy, be consistent, and tell me how it feels.')], settings: { reentry: 'always' } } },
  { id: 'missed-commitments', name: 'Missed commitments', icon: 'flag', description: 'A missed commitment gets a supportive message, not a scolding.',
    automation: { trigger: ev('commitment.reviewed', { outcome: 'missed' }), steps: [wait(0, 1), msg('No stress about this week, {first}. What got in the way? Let\'s make next week\'s commitment smaller.')], settings: { reentry: { cooldownDays: 7 } } } },
  { id: 'onboarding-stalled', name: 'Onboarding stalled 5 days', icon: 'checklist', description: 'Onboarding has stalled: a nudge for the next step, and a heads-up for you.',
    automation: { trigger: ev('onboarding.stalled'), steps: [msg('Hi {first}, just one more step to finish setting up. Shout if anything is unclear.'), note('{first}\'s onboarding has stalled')], settings: { reentry: { cooldownDays: 7 } } } },
  { id: 'renewal-offer', name: 'Package renewal offer', icon: 'redeem', description: 'A package nearly expired or nearly used up: a renewal message and a task.',
    automation: { trigger: { type: 'enters', rules: { match: 'any', rules: [{ fact: 'billing.packageExpiresDays', op: 'lte', value: 14 }, { fact: 'billing.credits', op: 'lte', value: 1 }] } },
      steps: [wait(0, 0, '09:00'), msg('Hi {first}, you have {packageLeft} left. Want me to set up the next block so there is no gap?'), task('Renewal chat with {first}')], settings: { reentry: { cooldownDays: 30 } } } },
  { id: 'campaign-next', name: 'Campaign finished, next offer', icon: 'celebration', description: 'Three days after a campaign ends, celebrate and offer the next block.',
    automation: { trigger: ev('campaign.completed'), steps: [wait(3, 0, '09:00'), msg('Three days on from {campaign}, {first}: how are you feeling? I have a follow-on block if you want to keep the momentum.'), task('Offer {first} the next block')], settings: { reentry: 'always' } } },
  { id: 'win-back', name: 'Win-back 60 days after ending', icon: 'handshake', description: 'Two months after coaching ended, a personal offer to come back.',
    automation: { trigger: enters('crm.daysSinceEnded', 'gte', 60), steps: [wait(0, 0, '10:00'), { type: 'action', action: 'offer.issue', params: {} }, msg('Hi {first}, it\'s been a while! I\'ve kept your notes. If you fancy picking things back up, I\'d love to have you back.')], settings: { reentry: 'never' } } },
  { id: 'birthday', name: 'Birthday message', icon: 'cake', description: 'Happy birthday at 09:00 on the day.',
    automation: { trigger: enters('crm.birthdayInDays', 'eq', 0), steps: [wait(0, 0, '09:00'), msg('Happy birthday, {first}! Have a brilliant day. Cake counts as carbs.')], settings: { reentry: { cooldownDays: 300 }, quietHours: false } } },
  { id: 'anniversary', name: 'Coaching anniversary', icon: 'workspace_premium', description: 'On the anniversary of joining, celebrate how far they have come.',
    automation: { trigger: enters('core.anniversaryInDays', 'eq', 0), steps: [wait(0, 0, '09:00'), msg('{yearsCoached} year(s) together today, {first}! Proud of everything you have put in. Here is to the next one.')], settings: { reentry: { cooldownDays: 300 }, quietHours: false } } },
  { id: 'voice-flag', name: 'Voice flag follow-up', icon: 'graphic_eq', description: 'A voice note mentions pain or illness: you are told and get a task. Nothing is sent to the client.',
    automation: { trigger: ev('voice.flagged'), steps: [note('Voice note flag: {first}', 'Listen to the note and follow up yourself.'), task('Follow up {first}\'s voice note')], settings: { reentry: 'always', quietHours: false } }, aiDerived: true },
];

/** Every id a recipe needs from the catalogue. */
function recipeNeeds(r) {
  const a = r.automation;
  return [a.trigger.type === 'event' ? a.trigger.event : null, ...a.steps.filter(s => s.type === 'action').map(s => s.action), ...factsIn(a.trigger.rules)].filter(Boolean);
}

function recipesOut() {
  const have = new Set([...allEvents().map(e => e.type), ...allActions().map(a => a.id), ...allFacts().map(f => f.id)]);
  return RECIPES.map(r => {
    const missing = recipeNeeds(r).filter(id => !have.has(id));
    return { id: r.id, name: r.name, description: r.description, icon: r.icon, aiDerived: !!r.aiDerived, available: !missing.length, needs: needsOf(missing), missing, automation: r.automation };
  });
}

// MARK: - Routes

const ownAutomation = ctx => { requireCoach(ctx); return ownRow(ctx, 'automations', ctx.params.id); };

function getCatalogue(_req, ctx) { requireCoach(ctx); return catalogue(ctx.db, ctx.user.id); }
function getRecipes(_req, ctx) { requireCoach(ctx); return { recipes: recipesOut() }; }

function list(_req, ctx) {
  requireCoach(ctx);
  const now = requestNow(ctx);
  const rows = ctx.db.prepare("SELECT * FROM automations WHERE coach_id=? ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, updated_at DESC").all(ctx.user.id);
  return { automations: rows.map(r => automationOut(ctx.db, r, { now })) };
}

function insertAutomation(db, coachId, f, { recipe = null, fromAutoflowId = null } = {}) {
  if (db.prepare('SELECT COUNT(*) n FROM automations WHERE coach_id=?').get(coachId).n >= 200) fail(413, 'At most 200 automations');
  const id = newId('au');
  const at = nowIso();
  db.prepare(`INSERT INTO automations (id, coach_id, name, description, status, trigger, conditions, steps, settings, recipe, from_autoflow_id, created_at, updated_at)
    VALUES (?,?,?,?,'draft',?,?,?,?,?,?,?,?)`).run(id, coachId, f.name, f.description, JSON.stringify(f.trigger), f.conditions ? JSON.stringify(f.conditions) : null,
    JSON.stringify(f.steps), JSON.stringify(f.settings), recipe, fromAutoflowId, at, at);
  return db.prepare('SELECT * FROM automations WHERE id=?').get(id);
}

function create(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  let recipe = null;
  let body = b;
  if (b.recipe) {
    const r = recipesOut().find(x => x.id === b.recipe);
    if (!r) fail(400, 'recipe is not known');
    if (!r.available) fail(409, `This recipe needs ${r.needs.join(', ')}`);
    recipe = r.id;
    body = { name: r.name, description: r.description, ...r.automation, ...Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'recipe')) };
  }
  const f = cleanAutomation(ctx.db, ctx.user.id, body);
  return { automation: automationOut(ctx.db, insertAutomation(ctx.db, ctx.user.id, f, { recipe }), { now: requestNow(ctx) }) };
}

function getOne(_req, ctx) {
  const r = ownAutomation(ctx);
  return { automation: automationOut(ctx.db, r, { now: requestNow(ctx) }) };
}

function update(_req, ctx) {
  const r = ownAutomation(ctx);
  const current = rowParts(r);
  const f = cleanAutomation(ctx.db, ctx.user.id, ctx.body, current);
  if (r.status === 'live') f.steps = validateLive(ctx.db, { ...current, ...f });
  const triggerChanged = JSON.stringify(f.trigger) !== JSON.stringify(current.trigger);
  ctx.db.prepare(`UPDATE automations SET name=?, description=?, trigger=?, conditions=?, steps=?, settings=?, updated_at=?${triggerChanged ? ', evaluated_at=NULL' : ''} WHERE id=?`)
    .run(f.name, f.description, JSON.stringify(f.trigger), f.conditions ? JSON.stringify(f.conditions) : null, JSON.stringify(f.steps), JSON.stringify(f.settings), nowIso(), r.id);
  return { automation: automationOut(ctx.db, ctx.db.prepare('SELECT * FROM automations WHERE id=?').get(r.id), { now: requestNow(ctx) }) };
}

function remove(_req, ctx) {
  const r = ownAutomation(ctx);
  ctx.db.prepare('DELETE FROM automations WHERE id=?').run(r.id);
  return { ok: true };
}

function setStatus(_req, ctx) {
  const r = ownAutomation(ctx);
  const status = oneOf(ctx.body.status, 'status', ['live', 'paused', 'draft']);
  const now = requestNow(ctx);
  const a = rowParts(r);
  tx(ctx.db, () => {
    if (status === 'live') {
      const steps = validateLive(ctx.db, a);
      // A fresh start: enters triggers record a new baseline, schedules ignore slots before now.
      ctx.db.prepare("UPDATE automations SET status='live', steps=?, live_at=?, evaluated_at=NULL, updated_at=? WHERE id=?").run(JSON.stringify(steps), now.toISOString(), nowIso(), r.id);
    } else {
      ctx.db.prepare('UPDATE automations SET status=?, updated_at=? WHERE id=?').run(status, nowIso(), r.id);
      if (status === 'draft') {
        for (const run of ctx.db.prepare("SELECT * FROM automation_runs WHERE automation_id=? AND status='active'").all(r.id)) stopRun(ctx.db, run, 'Stopped: automation turned off', now);
      }
    }
  });
  return { automation: automationOut(ctx.db, ctx.db.prepare('SELECT * FROM automations WHERE id=?').get(r.id), { now }) };
}

function testRoute(_req, ctx) {
  const r = ownAutomation(ctx);
  const client = ctx.db.prepare("SELECT * FROM users WHERE id=? AND role='client' AND coach_id=?").get(ctx.body.clientId, ctx.user.id);
  if (!client) fail(404, 'Not found');
  const event = ctx.body.event;
  if (event !== undefined && (typeof event !== 'object' || event === null || Array.isArray(event))) fail(400, 'event must be {type, payload}');
  return simulate(ctx.db, rowParts(r), client, { now: requestNow(ctx), event: event ?? null });
}

function enrol(_req, ctx) {
  const r = ownAutomation(ctx);
  const a = rowParts(r);
  if (a.trigger.type !== 'manual') fail(409, 'Only automations that start by hand take enrolments');
  if (a.status !== 'live') fail(409, 'Turn the automation on first');
  const clients = ownClients(ctx, ctx.body.clientIds);
  const now = requestNow(ctx);
  const started = [], skipped = [];
  tx(ctx.db, () => {
    for (const c of clients) {
      const out = startRun(ctx.db, ctx.config, a, c, { now, source: 'Added by you' });
      if (out.run) started.push(out.run.id); else skipped.push({ clientId: c.id, name: c.name, reason: out.skipped });
    }
  });
  for (const id of started) advanceRun(ctx.db, ctx.config, id, now);
  return { started: started.length, skipped };
}

function runsRoute(_req, ctx) {
  const r = ownAutomation(ctx);
  const a = rowParts(r);
  const where = ['r.automation_id=?'], args = [ctx.user.id, r.id];
  if (ctx.query.status) { where.push('r.status=?'); args.push(oneOf(ctx.query.status, 'status', ['active', 'done', 'stopped', 'failed'])); }
  const rows = ctx.db.prepare(`SELECT r.*, u.name client_name FROM automation_runs r JOIN users u ON u.id=r.client_id AND u.coach_id=?
    WHERE ${where.join(' AND ')} ORDER BY r.started_at DESC LIMIT 300`).all(...args);
  return { runs: rows.map(x => runOut(ctx.db, x, a)) };
}

function stopRoute(_req, ctx) {
  requireCoach(ctx);
  const run = ctx.db.prepare(`SELECT r.*, u.name client_name FROM automation_runs r JOIN automations a ON a.id=r.automation_id AND a.coach_id=?
    JOIN users u ON u.id=r.client_id AND u.coach_id=? WHERE r.id=?`).get(ctx.user.id, ctx.user.id, ctx.params.runId);
  if (!run) fail(404, 'Not found');
  const { client_name: _n, ...plain } = run;
  tx(ctx.db, () => stopRun(ctx.db, plain, 'Stopped by you', requestNow(ctx)));
  const a = rowParts(ctx.db.prepare('SELECT * FROM automations WHERE id=?').get(run.automation_id));
  return { run: runOut(ctx.db, { ...ctx.db.prepare('SELECT * FROM automation_runs WHERE id=?').get(run.id), client_name: run.client_name }, a) };
}

/** A draft from a legacy autoflow: join → client.joined, manual → manual; each step becomes a wait plus an action. */
function fromAutoflow(_req, ctx) {
  requireCoach(ctx);
  const flow = ctx.db.prepare('SELECT * FROM autoflows WHERE id=? AND coach_id=?').get(ctx.params.autoflowId, ctx.user.id);
  if (!flow) fail(404, 'Not found');
  const steps = [];
  let day = 0;
  for (const s of parse(flow.steps, []).sort((x, y) => x.day - y.day)) {
    if (s.day > day) { steps.push({ id: `w${steps.length + 1}`, type: 'wait', days: s.day - day, hours: 0, at: '09:00' }); day = s.day; }
    const id = `s${steps.length + 1}`;
    if (s.action === 'message') steps.push({ id, type: 'action', action: 'message.send', params: { text: s.text } });
    else if (s.action === 'form') steps.push({ id, type: 'action', action: 'form.send', params: { formId: s.formId } });
    else if (s.action === 'program') steps.push({ id, type: 'action', action: 'program.assign', params: { programId: s.programId, start: 'nextMonday' } });
  }
  const f = cleanAutomation(ctx.db, ctx.user.id, {
    name: `${flow.name}`.slice(0, 80), description: 'Converted from a sequence. Check it, then turn it on; the old sequence keeps running until you switch it off in Programs.',
    trigger: flow.trigger === 'join' ? { type: 'event', event: 'client.joined' } : { type: 'manual' },
    steps: steps.slice(0, MAX_STEPS), settings: { reentry: 'never' },
  });
  return { automation: automationOut(ctx.db, insertAutomation(ctx.db, ctx.user.id, f, { fromAutoflowId: flow.id }), { now: requestNow(ctx) }) };
}

/** Which automations a client is in right now (Client 360 and the bulk "start automation" sheet). */
function clientRuns(_req, ctx) {
  requireCoach(ctx);
  const client = ctx.db.prepare("SELECT * FROM users WHERE id=? AND role='client' AND coach_id=?").get(ctx.params.id, ctx.user.id);
  if (!client) fail(404, 'Not found');
  const rows = ctx.db.prepare(`SELECT r.*, ? client_name FROM automation_runs r JOIN automations a ON a.id=r.automation_id AND a.coach_id=?
    WHERE r.client_id=? ORDER BY r.started_at DESC LIMIT 50`).all(client.name, ctx.user.id, client.id);
  return { runs: rows.map(r => ({ ...runOut(ctx.db, r, rowParts(ctx.db.prepare('SELECT * FROM automations WHERE id=?').get(r.automation_id))), automation: { id: r.automation_id, name: ctx.db.prepare('SELECT name FROM automations WHERE id=?').get(r.automation_id).name } })) };
}

// MARK: - Schema

function schema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS automations (
    id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live','paused')),
    trigger TEXT NOT NULL, conditions TEXT, steps TEXT NOT NULL, settings TEXT NOT NULL DEFAULT '{}',
    recipe TEXT, from_autoflow_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    live_at TEXT, evaluated_at TEXT);
  CREATE INDEX IF NOT EXISTS automations_coach ON automations(coach_id, status);
  CREATE TABLE IF NOT EXISTS automation_runs (
    id TEXT PRIMARY KEY, automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('active','done','stopped','failed')),
    step_index INTEGER NOT NULL DEFAULT 0, next_at TEXT, trigger_seq INTEGER,
    log TEXT NOT NULL DEFAULT '[]',
    started_at TEXT NOT NULL, finished_at TEXT);
  CREATE INDEX IF NOT EXISTS automation_runs_due ON automation_runs(status, next_at);
  CREATE INDEX IF NOT EXISTS automation_runs_auto ON automation_runs(automation_id, started_at);
  CREATE INDEX IF NOT EXISTS automation_runs_client ON automation_runs(client_id, status);
  CREATE TABLE IF NOT EXISTS automation_state (
    automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    inside INTEGER NOT NULL DEFAULT 0, last_started_at TEXT,
    PRIMARY KEY (automation_id, client_id));
  CREATE TABLE IF NOT EXISTS automation_slots (
    automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    slot TEXT NOT NULL, PRIMARY KEY (automation_id, slot));`);
}

// MARK: - Demo

/**
 * The demo builder creates its tables if needed and clears the demo accounts'
 * rows itself: older tests build the demo before createApp has run feature
 * schemas, so demo.tables would make the foundation's wipe fail.
 */
function buildDemo(db, { coach, clients, byName, today }) {
  schema(db);
  db.prepare('DELETE FROM automation_runs WHERE coach_id=? OR client_id IN (SELECT value FROM json_each(?))').run(coach.id, JSON.stringify(clients.map(c => c.id)));
  db.prepare('DELETE FROM automation_state WHERE client_id IN (SELECT value FROM json_each(?))').run(JSON.stringify(clients.map(c => c.id)));
  db.prepare('DELETE FROM automations WHERE coach_id=?').run(coach.id);
  const at = (offset, clockStr = '09:00') => londonToUtc(addDays(today, offset), clockStr).toISOString();
  const plus = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();
  const hasTasks = allActions().some(a => a.id === 'task.create');
  const adapt = steps => steps.map((s, i) => {
    const out = { id: `s${i + 1}`, ...s };
    if (s.action === 'task.create' && !hasTasks) return { ...out, action: 'coach.notify', params: { title: s.params.title } };
    return out;
  });
  const form = db.prepare("SELECT id FROM forms WHERE coach_id=? ORDER BY name LIMIT 1").get(coach.id);
  const make = (recipeId, status, extra = {}) => {
    const r = RECIPES.find(x => x.id === recipeId);
    const steps = adapt(r.automation.steps).map(s => (s.action === 'form.send' ? { ...s, params: { formId: form?.id ?? '' } } : s));
    const id = newId('au');
    const created = at(-45 + RECIPES.indexOf(r), '10:00');
    db.prepare(`INSERT INTO automations (id, coach_id, name, description, status, trigger, conditions, steps, settings, recipe, created_at, updated_at, live_at, evaluated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, coach.id, extra.name ?? r.name, r.description, status, JSON.stringify(r.automation.trigger), null, JSON.stringify(steps),
      JSON.stringify({ ...DEFAULT_SETTINGS, ...r.automation.settings }), r.id, created, at(-3, '17:20'), status === 'live' ? plus(created, 30) : null, status === 'live' ? at(0, '06:00') : null);
    return { id, steps, name: extra.name ?? r.name };
  };
  const live = {
    late: make('late-cancel', 'live'), welcome: make('welcome', 'live'), quiet: make('quiet-5', 'live'),
    risk: make('at-risk', 'live'), reminder: make('session-reminder', 'live'), birthday: make('birthday', 'live'),
  };
  make('missed-commitments', 'paused');
  make('anniversary', 'draft');

  // Historical runs with believable logs; two still waiting.
  const people = clients;
  const pick = i => people[i % people.length];
  const runs = [];
  const add = (auto, client, startedAt, status, log, extra = {}) => runs.push({ auto, client, startedAt, status, log, ...extra });
  const out = (stepId, iso, outcome) => ({ stepId, at: iso, outcome });
  for (let i = 0; i < 9; i++) {
    const c = pick(i + 1);
    const s = at(-3 - i * 3, ['07:40', '18:10', '06:55'][i % 3]);
    const stopped = i === 4;
    add(live.late, c, s, stopped ? 'stopped' : 'done', [
      out(null, s, 'Started · Cancelled late'), out('s1', s, `Waiting until ${fmtWhen(plus(s, 60))}`),
      ...(stopped ? [out(null, plus(s, 22), 'Stopped: a client sent a message')] : [out('s2', plus(s, 60), 'Sent'), out('s3', plus(s, 60), hasTasks ? 'Created task' : 'Notified'), out(null, plus(s, 60), 'Finished')]),
    ], { finished: stopped ? plus(s, 22) : plus(s, 60) });
  }
  for (let i = 0; i < 8; i++) {
    const c = pick(i);
    const s = at(-2 - i * 3, '06:15');
    const sent = at(-2 - i * 3, '08:00');
    add(live.quiet, c, s, 'done', [out(null, s, 'Started · Started to match'), out('s1', s, `Waiting until ${fmtWhen(sent)}`), out('s2', sent, i === 5 ? 'Skipped: outreach paused' : 'Sent'), out(null, sent, 'Finished')], { finished: sent });
  }
  for (let i = 0; i < 6; i++) {
    const c = pick(i + 2);
    const s = at(-1 - i * 4, '09:00');
    add(live.reminder, c, s, 'done', [out(null, s, 'Started · Session tomorrow'), out('s1', s, i === 3 ? 'Deferred to 07:30' : 'Sent'), out(null, s, 'Finished')], { finished: s });
  }
  for (let i = 0; i < 4; i++) {
    const c = pick(i + 3);
    const s = at(-6 - i * 6, '11:30');
    add(live.risk, c, s, 'done', [out(null, s, 'Started · Moved to At risk'), out('s1', s, 'Notified'), out('s2', s, hasTasks ? 'Created task' : 'Notified'), out(null, s, 'Finished')], { finished: s });
  }
  const failedAt = at(-12, '09:00');
  add(live.birthday, pick(4), failedAt, 'done', [out(null, failedAt, 'Started · Started to match'), out('s2', failedAt, 'Skipped: outreach paused'), out(null, failedAt, 'Finished')], { finished: failedAt });
  const wel = at(-26, '10:15');
  add(live.welcome, byName.Tom ?? pick(5), wel, 'done', [out(null, wel, 'Started · Joined'), out('s1', wel, 'Sent'), out('s2', wel, `Waiting until ${fmtWhen(at(-24, '09:00'))}`),
    out('s3', at(-24, '09:00'), 'failed: the form was removed'), out('s4', at(-24, '09:00'), `Waiting until ${fmtWhen(at(-19, '09:00'))}`), out('s5', at(-19, '09:00'), 'Sent'), out(null, at(-19, '09:00'), 'Finished')], { finished: at(-19, '09:00') });
  // Two waiting right now.
  const w1 = at(-2, '10:05');
  add(live.welcome, byName.Rory ?? pick(4), w1, 'active', [out(null, w1, 'Started · Joined'), out('s1', w1, 'Sent'), out('s2', w1, `Waiting until ${fmtWhen(at(0, '09:00'))}`),
    out('s3', at(0, '09:00'), 'Sent'), out('s4', at(0, '09:00'), `Waiting until ${fmtWhen(at(5, '09:00'))}`)], { stepIndex: 4, nextAt: at(5, '09:00') });
  const w2 = at(0, '06:20');
  add(live.quiet, byName.Tom ?? pick(5), w2, 'active', [out(null, w2, 'Started · Started to match'), out('s1', w2, `Waiting until ${fmtWhen(at(1, '08:00'))}`)], { stepIndex: 1, nextAt: at(1, '08:00') });

  for (const r of runs) {
    db.prepare(`INSERT INTO automation_runs (id, automation_id, coach_id, client_id, status, step_index, next_at, log, started_at, finished_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(newId('aur'), r.auto.id, coach.id, r.client.id, r.status, r.status === 'active' ? r.stepIndex : r.auto.steps.length, r.status === 'active' ? r.nextAt : null,
        JSON.stringify(r.log), r.startedAt, r.status === 'active' ? null : r.finished ?? r.startedAt);
  }
  // The enters automations have already looked at everyone, so turning the world on never floods.
  for (const a of [live.quiet, live.birthday]) {
    for (const c of clients) {
      db.prepare('INSERT OR IGNORE INTO automation_state (automation_id, client_id, inside, last_started_at) VALUES (?,?,?,?)')
        .run(a.id, c.id, a === live.quiet && c.name.startsWith('Tom') ? 1 : 0, runs.filter(r => r.auto === a && r.client.id === c.id).map(r => r.startedAt).sort().at(-1) ?? null);
    }
  }
}

// MARK: - The feature

export const feature = {
  name: 'automations',
  namespaces: ['automation'],
  exact: [],

  schema,

  routes(r) {
    r.add('GET', '/api/automations/catalogue', getCatalogue);
    r.add('GET', '/api/automations/recipes', getRecipes);
    r.add('POST', '/api/automations/runs/:runId/stop', stopRoute);
    r.add('POST', '/api/automations/from-autoflow/:autoflowId', fromAutoflow);
    r.add('GET', '/api/automations', list);
    r.add('POST', '/api/automations', create);
    r.add('GET', '/api/automations/:id', getOne);
    r.add('PUT', '/api/automations/:id', update);
    r.add('DELETE', '/api/automations/:id', remove);
    r.add('POST', '/api/automations/:id/status', setStatus);
    r.add('POST', '/api/automations/:id/test', testRoute);
    r.add('POST', '/api/automations/:id/enrol', enrol);
    r.add('GET', '/api/automations/:id/runs', runsRoute);
    r.add('GET', '/api/coach/clients/:id/automations', clientRuns);
  },

  clocks: [
    { id: 'automations.advance', everyMs: 30_000, run: (db, config, now) => advanceDue(db, config, now) },
    { id: 'automations.enters', everyMs: 15 * 60_000, run: (db, config, now) => evaluateEnters(db, config, now) },
    { id: 'automations.schedule', everyMs: 60_000, run: (db, config, now) => runSchedules(db, config, now) },
  ],

  on: { '*': onEvent },

  emits: {
    'automation.started': { label: 'An automation started for a client', payload: ['automationId', 'runId'] },
    'automation.finished': { label: 'An automation finished for a client', payload: ['automationId', 'runId'] },
    'automation.failed': { label: 'An automation failed for a client', payload: ['automationId', 'runId'] },
  },

  /** Client 360 timeline: runs started and finished. */
  timeline(db, coach, client, before, n) {
    const rows = db.prepare(`SELECT r.*, a.name FROM automation_runs r JOIN automations a ON a.id=r.automation_id AND a.coach_id=?
      WHERE r.client_id=? ${before ? 'AND r.started_at<?' : ''} ORDER BY r.started_at DESC LIMIT ?`).all(coach.id, client.id, ...(before ? [before] : []), n);
    return rows.map(r => ({
      at: r.started_at, kind: 'automation', icon: 'bolt', tone: r.status === 'failed' ? 'attention' : null,
      title: `${r.name} · ${r.status === 'active' ? 'running' : r.status}`, detail: parse(r.log, []).at(-1)?.outcome ?? '', path: `/automations/${r.automation_id}/runs`,
    }));
  },

  /** F8 End coaching: the runs still going (they stop on client.offboarded). */
  offboarding(db, coach, client) {
    const rows = db.prepare(`SELECT r.id, r.next_at, a.name FROM automation_runs r JOIN automations a ON a.id=r.automation_id AND a.coach_id=?
      WHERE r.client_id=? AND r.status='active' ORDER BY r.started_at`).all(coach.id, client.id);
    return rows.length ? { runs: rows.map(r => ({ id: r.id, automation: r.name, nextAt: r.next_at })) } : {};
  },

  /** Subject access: the automation runs about a client (names and logs); a coach gets their automations. */
  exportFor(db, user) {
    if (user.role === 'coach') return { automations: db.prepare('SELECT id, name, status, trigger, steps, created_at FROM automations WHERE coach_id=?').all(user.id) };
    return {
      automationRuns: db.prepare('SELECT r.id, a.name automation, r.status, r.started_at startedAt, r.finished_at finishedAt, r.log FROM automation_runs r JOIN automations a ON a.id=r.automation_id WHERE r.client_id=? ORDER BY r.started_at')
        .all(user.id).map(r => ({ ...r, log: parse(r.log, []) })),
    };
  },

  /** Palette: automations by name. */
  search(db, coach, q, limit) {
    const like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
    return db.prepare("SELECT * FROM automations WHERE coach_id=? AND name LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?").all(coach.id, like, limit)
      .map(a => ({ type: 'automation', id: a.id, title: a.name, detail: `${a.status === 'live' ? 'On' : a.status === 'paused' ? 'Paused' : 'Draft'} · automation`, path: `/automations/${a.id}`, icon: 'bolt', score: 0.6, at: a.updated_at }));
  },

  demo: { build: buildDemo },
};
