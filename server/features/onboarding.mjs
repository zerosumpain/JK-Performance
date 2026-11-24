import { clientFor, initials, requestNow, requireCoach } from '../access.mjs';
import { emit } from '../events.mjs';
import { clientFacts, evaluate, OPERATORS } from '../facts.mjs';
import { fail, num, str } from '../http.mjs';
import { allEvents, allFacts } from '../registry.mjs';
import { nowIso, tx } from '../store.mjs';
import { addDays, daysBetween, londonDay, londonToUtc } from '../time.mjs';

/**
 * WP2: the onboarding checklist (F27, docs/design/desk-v2.md). One template per
 * coach (up to 12 steps); a checklist per client, started on client.joined or
 * by the coach. Event steps tick from the event bus, fact steps on every
 * event for the client and nightly. A ticked step stays ticked unless the
 * coach unticks it. Completion emits onboarding.completed once (F7 moves the
 * client to Active); a stall of `stallDays` without progress emits
 * onboarding.stalled once per stall.
 *
 * Clients with no checklist row (everyone who joined before desk v2) count as
 * complete: onboarding.pct is null for them.
 */

const KINDS = ['event', 'fact', 'manual'];
const MAX_STEPS = 12;
const KEY = /^[a-z][a-zA-Z0-9]{0,30}$/;
const IDS = 'SELECT value FROM json_each(?)';

/** The default template (F27). `ref` is the chosen form or guide; a missing ref matches by form name. */
const DEFAULT_STEPS = [
  { key: 'parq', label: 'Health questionnaire returned', kind: 'event', event: 'form.submitted', ref: null },
  { key: 'waiver', label: 'Terms and waiver agreed', kind: 'event', event: 'form.submitted', ref: null },
  { key: 'goal', label: 'Goal set', kind: 'fact', fact: 'onboarding.hasGoal', op: 'eq', value: true },
  { key: 'program', label: 'First program laid', kind: 'fact', fact: 'onboarding.hasProgram', op: 'eq', value: true },
  { key: 'booking', label: 'First session booked', kind: 'event', event: 'booking.created' },
  { key: 'billing', label: 'Billing in place', kind: 'event', event: 'invoice.issued', also: ['package.sold', 'billing.scheduleCreated'] },
  { key: 'guide', label: 'Welcome guide read', kind: 'event', event: 'guide.opened', ref: null },
  { key: 'app', label: 'App set up', kind: 'fact', fact: 'core.onboarded', op: 'eq', value: true },
  { key: 'notifications', label: 'Notifications on', kind: 'fact', fact: 'onboarding.notificationsOn', op: 'eq', value: true },
];
/** With no chosen form, these steps match a submitted form by its name. */
const NAME_MATCH = { parq: /par-?q|health/i, waiver: /waiver|terms|agreement|consent/i };
const NUDGE = {
  parq: 'Could you fill in the health questionnaire when you get two minutes? It lets me plan around anything I should know.',
  waiver: 'Quick one: the terms and waiver are waiting for you in the app. Once that is done we are all set.',
  goal: 'Let us pin down your goal this week, so every session points at it. What would make the next three months a win?',
  program: 'Your first program is on its way. Anything I should know about your week before I lay it out?',
  booking: 'Shall we get your first session in the diary? Pick any slot that suits in the app.',
  billing: 'Just need to get your membership set up so everything is in place. I will send the details over.',
  guide: 'I have put a short welcome guide in the app. Five minutes, and it explains how we will work together.',
  app: 'Have you had a chance to set up the app yet? It takes two minutes and everything lives there.',
  notifications: 'Turn notifications on for the app if you can, so you never miss a message or a session reminder.',
};

const dayOf = iso => (iso ? londonDay(new Date(iso)) : null);
const nowFor = today => (today === londonDay() ? new Date() : londonToUtc(today, '12:00'));

// MARK: - Template

const eventTypes = () => new Set(allEvents().map(e => e.type));
const factIds = () => new Set(allFacts().map(f => f.id));

/** The coach's template: {steps, stallDays, updatedAt}. Defaults when they have not saved one. */
function templateOf(db, coachId) {
  const row = db.prepare('SELECT * FROM onboarding_templates WHERE coach_id=?').get(coachId);
  if (!row) return { steps: defaultSteps(db, coachId), stallDays: 5, updatedAt: null, isDefault: true };
  return { steps: JSON.parse(row.steps), stallDays: row.stall_days, updatedAt: row.updated_at, isDefault: false };
}

/** The defaults, with the coach's PAR-Q and waiver forms chosen where their names make it obvious. */
function defaultSteps(db, coachId) {
  const forms = db.prepare('SELECT id, name FROM forms WHERE coach_id=? ORDER BY created_at').all(coachId);
  return DEFAULT_STEPS.map(s => {
    if (s.key in NAME_MATCH) return { ...s, ref: forms.find(f => NAME_MATCH[s.key].test(f.name))?.id ?? null };
    return { ...s };
  });
}

/** A step is hidden when what it waits for does not exist here (no billing, no guidebook). */
function hidden(step, types = eventTypes(), facts = factIds()) {
  if (step.kind === 'event') return ![step.event, ...(step.also ?? [])].some(t => types.has(t));
  if (step.kind === 'fact') return !facts.has(step.fact);
  return false;
}

function visibleSteps(template) {
  const types = eventTypes(), facts = factIds();
  return template.steps.filter(s => !hidden(s, types, facts));
}

function validateTemplate(body) {
  const steps = body.steps;
  if (!Array.isArray(steps) || !steps.length || steps.length > MAX_STEPS) fail(400, `steps must be a list of 1 to ${MAX_STEPS} steps`);
  const types = eventTypes(), facts = factIds();
  const keys = new Set();
  const out = steps.map((s, i) => {
    const p = `steps[${i}]`;
    if (!s || typeof s !== 'object') fail(400, `${p} must be a step`);
    if (typeof s.key !== 'string' || !KEY.test(s.key)) fail(400, `${p}.key must be a short word`);
    if (keys.has(s.key)) fail(400, `${p}.key is used twice`);
    keys.add(s.key);
    const label = str(s.label, `${p}.label`, { max: 80 });
    if (!KINDS.includes(s.kind)) fail(400, `${p}.kind must be event, fact or manual`);
    const step = { key: s.key, label, kind: s.kind };
    if (s.kind === 'event') {
      const list = [s.event, ...(Array.isArray(s.also) ? s.also : [])];
      if (list.some(t => typeof t !== 'string' || !types.has(t))) fail(400, `${p}.event is not a known event`);
      step.event = s.event;
      if (Array.isArray(s.also) && s.also.length) step.also = s.also.slice(0, 4);
      step.ref = s.ref === undefined || s.ref === null || s.ref === '' ? null : str(s.ref, `${p}.ref`, { max: 64 });
    } else if (s.kind === 'fact') {
      if (typeof s.fact !== 'string' || !facts.has(s.fact)) fail(400, `${p}.fact is not a known fact`);
      const op = s.op ?? 'eq';
      if (!OPERATORS.includes(op)) fail(400, `${p}.op is not known`);
      step.fact = s.fact;
      step.op = op;
      step.value = s.value === undefined ? true : s.value;
      if (typeof step.value === 'object' && step.value !== null && !Array.isArray(step.value)) fail(400, `${p}.value must be a plain value`);
    }
    return step;
  });
  const stallDays = body.stallDays === undefined ? 5 : num(body.stallDays, 'stallDays', { min: 1, max: 60, int: true });
  return { steps: out, stallDays };
}

// MARK: - Checklist state

const checklistRow = (db, clientId) => db.prepare('SELECT * FROM onboarding_clients WHERE client_id=?').get(clientId);
const doneOf = (db, clientId) => new Map(db.prepare('SELECT step_key, done_at, by FROM onboarding_steps WHERE client_id=?').all(clientId).map(r => [r.step_key, r]));

/** {started, startedAt, completedAt, pct, done, total, nextStep, stuckDays, steps:[{key, label, kind, done, doneAt, by}]} */
function checklistOut(db, client, today = londonDay()) {
  const row = checklistRow(db, client.id);
  const template = templateOf(db, client.coach_id);
  const steps = visibleSteps(template);
  if (!row) return { started: false, startedAt: null, completedAt: null, pct: null, done: 0, total: steps.length, nextStep: null, stuckDays: null, stalled: false,
    steps: steps.map(s => ({ key: s.key, label: s.label, kind: s.kind, done: false, doneAt: null, by: null })) };
  const done = doneOf(db, client.id);
  const list = steps.map(s => ({ key: s.key, label: s.label, kind: s.kind, done: done.has(s.key), doneAt: done.get(s.key)?.done_at ?? null, by: done.get(s.key)?.by ?? null }));
  const n = list.filter(s => s.done).length;
  const pct = row.completed_at ? 100 : list.length ? Math.round((100 * n) / list.length) : 100;
  const next = list.find(s => !s.done) ?? null;
  const stuckDays = row.completed_at ? null : Math.max(0, daysBetween(dayOf(row.last_progress_at), today));
  return {
    started: true, startedAt: row.started_at, completedAt: row.completed_at, pct, done: n, total: list.length,
    nextStep: row.completed_at || !next ? null : { key: next.key, label: next.label, nudge: NUDGE[next.key] ?? `A quick nudge about "${next.label.toLowerCase()}" when you have a minute.` },
    stuckDays, stalled: !!row.stalled_at && !row.completed_at && row.stalled_at >= row.last_progress_at, steps: list,
  };
}

/** Tick one step (idempotent). Returns whether it was new. */
function tick(db, client, key, { by = 'auto', now = new Date() }) {
  const added = db.prepare('INSERT OR IGNORE INTO onboarding_steps (client_id, step_key, done_at, by) VALUES (?,?,?,?)').run(client.id, key, now.toISOString(), by).changes;
  if (!added) return false;
  db.prepare('UPDATE onboarding_clients SET last_progress_at=? WHERE client_id=?').run(now.toISOString(), client.id);
  emit(db, 'onboarding.stepDone', { coachId: client.coach_id, clientId: client.id, summary: `Onboarding: ${labelOf(db, client, key)}`, step: key });
  return true;
}

const labelOf = (db, client, key) => templateOf(db, client.coach_id).steps.find(s => s.key === key)?.label ?? key;

/** Every visible step done and not yet recorded as complete: record it and emit onboarding.completed (once). */
function checkComplete(db, client, now) {
  const row = checklistRow(db, client.id);
  if (!row || row.completed_at) return false;
  const steps = visibleSteps(templateOf(db, client.coach_id));
  const done = doneOf(db, client.id);
  if (!steps.every(s => done.has(s.key))) return false;
  const claimed = db.prepare('UPDATE onboarding_clients SET completed_at=? WHERE client_id=? AND completed_at IS NULL').run(now.toISOString(), client.id).changes;
  if (claimed) emit(db, 'onboarding.completed', { coachId: client.coach_id, clientId: client.id, summary: 'Onboarding complete' });
  return !!claimed;
}

/** Fact steps for a batch of clients (rows of one coach): tick what is now true. */
function evaluateFacts(db, coachId, clients, { today, now }) {
  if (!clients.length) return 0;
  const steps = visibleSteps(templateOf(db, coachId)).filter(s => s.kind === 'fact');
  if (!steps.length) return 0;
  const facts = clientFacts(db, coachId, clients.map(c => c.id), { only: [...new Set(steps.map(s => s.fact))], today, now });
  let n = 0;
  for (const c of clients) {
    const f = facts.get(c.id) ?? {};
    for (const s of steps) {
      let ok = false;
      try { ok = evaluate({ fact: s.fact, op: s.op ?? 'eq', value: s.value ?? true }, f); } catch { ok = false; }
      if (ok && tick(db, c, s.key, { now })) n++;
    }
  }
  return n;
}

/** Does this event tick this step for this client? */
function eventTicks(db, step, e) {
  if (step.kind !== 'event' || ![step.event, ...(step.also ?? [])].includes(e.type)) return false;
  if (e.type === 'form.submitted') {
    if (step.ref) return e.payload.formId === step.ref;
    const rx = NAME_MATCH[step.key];
    if (!rx) return true;
    const name = db.prepare('SELECT name FROM form_requests WHERE id=? AND client_id=?').get(e.payload.requestId ?? '', e.clientId)?.name
      ?? db.prepare('SELECT name FROM forms WHERE id=?').get(e.payload.formId ?? '')?.name ?? '';
    return rx.test(name);
  }
  if (e.type === 'guide.opened' && step.ref) return e.payload.guideId === step.ref;
  return true;
}

/** Start a client's checklist (no-op when it exists). Returns whether it started. */
function start(db, client, now) {
  const at = now.toISOString();
  const made = db.prepare('INSERT OR IGNORE INTO onboarding_clients (client_id, coach_id, started_at, last_progress_at) VALUES (?,?,?,?)').run(client.id, client.coach_id, at, at).changes;
  if (made) {
    evaluateFacts(db, client.coach_id, [client], { today: londonDay(now), now });
    checkComplete(db, client, now);
  }
  return !!made;
}

/** The nightly pass for one coach: fact steps, completion and stalls. */
function nightly(db, coachId, today) {
  const now = nowFor(today);
  const clients = db.prepare(`SELECT u.* FROM onboarding_clients o JOIN users u ON u.id=o.client_id AND u.coach_id=? AND u.role='client' WHERE o.completed_at IS NULL`).all(coachId);
  if (!clients.length) return;
  evaluateFacts(db, coachId, clients, { today, now });
  const template = templateOf(db, coachId);
  for (const c of clients) {
    if (checkComplete(db, c, now)) continue;
    const row = checklistRow(db, c.id);
    const days = daysBetween(dayOf(row.last_progress_at), today);
    // Once per stall: again only after new progress (last_progress_at moves past stalled_at) and a new stall.
    if (days >= template.stallDays && (!row.stalled_at || row.stalled_at < row.last_progress_at)) {
      const out = checklistOut(db, c, today);
      db.prepare('UPDATE onboarding_clients SET stalled_at=? WHERE client_id=?').run(now.toISOString(), c.id);
      emit(db, 'onboarding.stalled', { coachId, clientId: c.id, summary: `Onboarding stuck ${days} days`, days, nextStep: out.nextStep?.key ?? null });
    }
  }
}

// MARK: - Routes

function getTemplate(_req, ctx) {
  requireCoach(ctx);
  const t = templateOf(ctx.db, ctx.user.id);
  const types = eventTypes(), facts = factIds();
  return { template: { ...t, steps: t.steps.map(s => ({ ...s, hidden: hidden(s, types, facts) })) } };
}

function putTemplate(_req, ctx) {
  requireCoach(ctx);
  const t = validateTemplate(ctx.body);
  for (const s of t.steps) {
    if (s.kind === 'event' && s.ref && s.event === 'form.submitted' && !ctx.db.prepare('SELECT 1 FROM forms WHERE id=? AND coach_id=?').get(s.ref, ctx.user.id)) fail(404, 'Not found');
  }
  ctx.db.prepare(`INSERT INTO onboarding_templates (coach_id, steps, stall_days, updated_at) VALUES (?,?,?,?)
    ON CONFLICT(coach_id) DO UPDATE SET steps=excluded.steps, stall_days=excluded.stall_days, updated_at=excluded.updated_at`).run(ctx.user.id, JSON.stringify(t.steps), t.stallDays, nowIso());
  return getTemplate(_req, ctx);
}

function getChecklist(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.params.id);
  return checklistOut(ctx.db, client, londonDay(requestNow(ctx)));
}

function postChecklist(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.params.id);
  const now = requestNow(ctx);
  const b = ctx.body;
  if (b.start === true) {
    tx(ctx.db, () => { if (!start(ctx.db, client, now)) fail(409, 'Onboarding has already started for this client'); });
  } else if (typeof b.step === 'string') {
    if (typeof b.done !== 'boolean') fail(400, 'done must be true or false');
    if (!checklistRow(ctx.db, client.id)) fail(409, 'Start onboarding first');
    if (!visibleSteps(templateOf(ctx.db, ctx.user.id)).some(s => s.key === b.step)) fail(400, 'step is not on the checklist');
    tx(ctx.db, () => {
      if (b.done) {
        if (!tick(ctx.db, client, b.step, { by: 'coach', now })) ctx.db.prepare("UPDATE onboarding_steps SET by='coach' WHERE client_id=? AND step_key=?").run(client.id, b.step);
        checkComplete(ctx.db, client, now);
      } else {
        ctx.db.prepare('DELETE FROM onboarding_steps WHERE client_id=? AND step_key=?').run(client.id, b.step);
      }
    });
  } else fail(400, 'Send {start: true} or {step, done}');
  return checklistOut(ctx.db, client, londonDay(now));
}

function listOnboarding(_req, ctx) {
  requireCoach(ctx);
  const today = londonDay(requestNow(ctx));
  const clients = ctx.db.prepare(`SELECT u.* FROM onboarding_clients o JOIN users u ON u.id=o.client_id AND u.coach_id=? AND u.role='client'
    WHERE o.completed_at IS NULL ORDER BY o.started_at`).all(ctx.user.id);
  return {
    clients: clients.map(c => {
      const out = checklistOut(ctx.db, c, today);
      return { client: { id: c.id, name: c.name, initials: initials(c.name), plan: c.plan }, pct: out.pct, done: out.done, total: out.total,
        stuckDays: out.stuckDays, stalled: out.stalled, nextStep: out.nextStep, startedAt: out.startedAt };
    }),
  };
}

// MARK: - Facts

function factFor(db, coachId, ids, fn) {
  if (!ids.length) return new Map();
  return fn(JSON.stringify(ids));
}

// MARK: - Demo

/** Rory 6 of 9 and moving; Tom stuck at 3 of 9 for a week. Everyone else has no checklist (complete). */
function demoBuild(db, ctx) {
  feature.schema(db);
  const { coach, today, byName } = ctx;
  db.prepare(`DELETE FROM onboarding_steps WHERE client_id IN (SELECT id FROM users WHERE coach_id=?)`).run(coach.id);
  db.prepare('DELETE FROM onboarding_clients WHERE coach_id=? OR client_id IN (SELECT id FROM users WHERE coach_id=?)').run(coach.id, coach.id);
  db.prepare('DELETE FROM onboarding_templates WHERE coach_id=?').run(coach.id);
  const at = (ago, t = '10:00') => londonToUtc(addDays(today, -ago), t).toISOString();
  const now = nowFor(today);
  const steps = visibleSteps({ steps: defaultSteps(db, coach.id) });
  const facts = clientFacts(db, coach.id, [byName.Rory?.id, byName.Tom?.id].filter(Boolean), { only: [...new Set(steps.filter(s => s.kind === 'fact').map(s => s.fact))], today, now });
  const factTrue = (c, s) => { try { return evaluate({ fact: s.fact, op: s.op, value: s.value }, facts.get(c.id) ?? {}); } catch { return false; } };
  const plan = (c, want, { startedAgo, lastAgo, stalledAgo = null }) => {
    if (!c) return;
    db.prepare('INSERT INTO onboarding_clients (client_id, coach_id, started_at, completed_at, last_progress_at, stalled_at) VALUES (?,?,?,?,?,?)')
      .run(c.id, coach.id, at(startedAgo), null, at(lastAgo), stalledAgo === null ? null : at(stalledAgo, '05:05'));
    // Fact steps that are already true tick first (the nightly run would tick them anyway), then the chosen others, oldest first.
    const ticked = steps.filter(s => s.kind === 'fact' && factTrue(c, s)).map(s => s.key);
    for (const key of want) if (ticked.length < want.length && !ticked.includes(key) && steps.some(s => s.key === key)) ticked.push(key);
    ticked.forEach((key, i, list) => {
      const ago = startedAgo - Math.round(((startedAgo - lastAgo) * (i + 1)) / list.length);
      db.prepare('INSERT INTO onboarding_steps (client_id, step_key, done_at, by) VALUES (?,?,?,?)').run(c.id, key, at(ago, '11:30'), steps.find(s => s.key === key)?.kind === 'manual' ? 'coach' : 'auto');
    });
  };
  plan(byName.Rory, ['parq', 'app', 'goal', 'program', 'waiver', 'booking'], { startedAgo: 42, lastAgo: 2 });
  plan(byName.Tom, ['parq', 'app', 'program'], { startedAgo: 21, lastAgo: 7, stalledAgo: 2 });
}

// MARK: - The feature

export const feature = {
  name: 'onboarding',
  namespaces: ['onboarding'],

  schema(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS onboarding_templates (
        coach_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        steps TEXT NOT NULL, stall_days INTEGER NOT NULL DEFAULT 5, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS onboarding_clients (
        client_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        started_at TEXT NOT NULL, completed_at TEXT, last_progress_at TEXT NOT NULL, stalled_at TEXT);
      CREATE TABLE IF NOT EXISTS onboarding_steps (
        client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        step_key TEXT NOT NULL, done_at TEXT NOT NULL, by TEXT NOT NULL DEFAULT 'auto' CHECK (by IN ('auto','coach')),
        PRIMARY KEY (client_id, step_key));`);
  },

  routes(r) {
    r.add('GET', '/api/onboarding/template', getTemplate);
    r.add('PUT', '/api/onboarding/template', putTemplate);
    r.add('GET', '/api/onboarding', listOnboarding);
    r.add('GET', '/api/coach/clients/:id/onboarding', getChecklist);
    r.add('POST', '/api/coach/clients/:id/onboarding', postChecklist);
  },

  on: {
    'client.joined': (db, _config, e) => {
      const client = e.clientId && db.prepare("SELECT * FROM users WHERE id=? AND role='client' AND coach_id=?").get(e.clientId, e.coachId);
      if (client) start(db, client, new Date(e.at));
    },
    'day.started': (db, _config, e) => { if (e.coachId) nightly(db, e.coachId, e.payload.day ?? londonDay(new Date(e.at))); },
    // Every other event for a client with an open checklist: event steps, then fact steps.
    '*': (db, _config, e) => {
      if (!e.clientId || !e.coachId || e.type.startsWith('onboarding.') || e.type === 'day.started' || e.type === 'client.joined') return;
      const row = checklistRow(db, e.clientId);
      if (!row || row.completed_at) return;
      // Only the client's current coach's events count: a stored coach id is never trusted.
      const client = db.prepare("SELECT * FROM users WHERE id=? AND role='client' AND coach_id=?").get(e.clientId, e.coachId);
      if (!client) return;
      const now = new Date(e.at);
      for (const s of visibleSteps(templateOf(db, client.coach_id))) if (eventTicks(db, s, e)) tick(db, client, s.key, { now });
      evaluateFacts(db, client.coach_id, [client], { today: londonDay(now), now });
      checkComplete(db, client, now);
    },
  },

  emits: {
    'onboarding.stepDone': { label: 'An onboarding step was done', payload: ['step'] },
    'onboarding.completed': { label: 'Onboarding complete', payload: [] },
    'onboarding.stalled': { label: 'Onboarding stalled', payload: ['days', 'nextStep'] },
  },

  facts: {
    'onboarding.pct': {
      label: 'Onboarding done (%)', type: 'number',
      compute(db, coachId, ids, today) {
        const out = new Map();
        for (const c of db.prepare(`SELECT u.* FROM users u JOIN onboarding_clients o ON o.client_id=u.id WHERE u.coach_id=? AND u.id IN (${IDS})`).all(coachId, JSON.stringify(ids))) {
          out.set(c.id, checklistOut(db, c, today).pct);
        }
        return out;
      },
    },
    'onboarding.stuckDays': {
      label: 'Days since onboarding progress', type: 'days',
      compute: (db, coachId, ids, today) => factFor(db, coachId, ids, json => new Map(db.prepare(`SELECT o.client_id, o.last_progress_at FROM onboarding_clients o
        JOIN users u ON u.id=o.client_id AND u.coach_id=? WHERE o.client_id IN (${IDS}) AND o.completed_at IS NULL`).all(coachId, json)
        .map(r => [r.client_id, Math.max(0, daysBetween(dayOf(r.last_progress_at), today))]))),
    },
    'onboarding.hasGoal': {
      label: 'Has a goal set', type: 'bool',
      compute: (db, _coachId, ids) => factFor(db, null, ids, json => {
        const yes = new Set(db.prepare(`SELECT DISTINCT client_id FROM goals WHERE client_id IN (${IDS}) AND status IN ('active','reached')`).all(json).map(r => r.client_id));
        return new Map(ids.map(id => [id, yes.has(id)]));
      }),
    },
    'onboarding.hasProgram': {
      label: 'Has a program laid', type: 'bool',
      compute: (db, _coachId, ids) => factFor(db, null, ids, json => {
        const yes = new Set(db.prepare(`SELECT DISTINCT client_id FROM workouts WHERE client_id IN (${IDS})`).all(json).map(r => r.client_id));
        return new Map(ids.map(id => [id, yes.has(id)]));
      }),
    },
    'onboarding.notificationsOn': {
      label: 'Notifications on', type: 'bool',
      compute: (db, _coachId, ids) => factFor(db, null, ids, json => {
        const yes = new Set(db.prepare(`SELECT u.id FROM users u WHERE u.id IN (${IDS}) AND u.notifications_on=1 AND EXISTS (SELECT 1 FROM push_tokens p WHERE p.user_id=u.id)`).all(json).map(r => r.id));
        return new Map(ids.map(id => [id, yes.has(id)]));
      }),
    },
  },

  needs(db, coach, clients, today) {
    const mine = new Set(clients.map(c => c.id));
    const out = [];
    for (const c of db.prepare(`SELECT u.* FROM onboarding_clients o JOIN users u ON u.id=o.client_id AND u.coach_id=? WHERE o.completed_at IS NULL AND o.stalled_at IS NOT NULL AND o.stalled_at>=o.last_progress_at`).all(coach.id)) {
      if (!mine.has(c.id)) continue;
      const s = checklistOut(db, c, today);
      if (!s.nextStep) continue;
      out.push({ clientId: c.id, kind: 'onboardingStalled', rank: 5, iconKey: 'checklist', at: checklistRow(db, c.id).last_progress_at,
        text: `Onboarding stuck ${s.stuckDays} days: waiting on ${s.nextStep.label.toLowerCase()}`, action: { label: 'Nudge', path: `/clients/${encodeURIComponent(c.id)}` } });
    }
    return out;
  },

  exportFor(db, user) {
    if (user.role !== 'client') return {};
    const row = checklistRow(db, user.id);
    return {
      checklist: row ? { startedAt: row.started_at, completedAt: row.completed_at, lastProgressAt: row.last_progress_at } : null,
      steps: db.prepare('SELECT step_key AS key, done_at AS doneAt, by FROM onboarding_steps WHERE client_id=? ORDER BY done_at').all(user.id),
    };
  },

  demo: { build: demoBuild },
};

/** Exposed for tests only (never import a feature file from another feature). */
export const _test = { nightly, templateOf, checklistOut };
