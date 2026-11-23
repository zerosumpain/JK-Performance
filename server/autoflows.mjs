import { clientFor, initials, requireCoach } from './access.mjs';
import { fail, day as dayField, num, oneOf, str } from './http.mjs';
import { sendForm } from './forms.mjs';
import { sendMessage } from './messages.mjs';
import { newId, nowIso, tx } from './store.mjs';
import { addDays, londonDay, weekday } from './time.mjs';
import { layProgram } from './training.mjs';

/**
 * Autoflows: a coach's routine written down once and run for every client.
 * A flow is a list of steps, each "on day N, do X": send a message, send a
 * form, or put a program on the calendar. A `join` flow starts by itself
 * when a new client signs up to the coach; a `manual` one (return from
 * injury, event countdown) starts when the coach enrols someone.
 *
 * Each client's progress through a flow is a run. `runDue` does whatever has
 * fallen due; it runs on enrolment, on sign-up and every few minutes, and
 * remembers each step it did, so a step happens once even if the server was
 * down on the day (it then happens late, not never).
 */

const ACTIONS = ['message', 'form', 'program'];

function cleanSteps(db, coachId, list) {
  if (!Array.isArray(list) || !list.length || list.length > 30) fail(400, 'steps must be a list of 1 to 30');
  const seen = new Set();
  return list.map((s, i) => {
    const name = `steps[${i}]`;
    const id = str(s?.id ?? newId('s'), `${name}.id`, { max: 40 });
    if (seen.has(id)) fail(400, `${name}.id is repeated`);
    seen.add(id);
    const out = { id, day: num(s.day, `${name}.day`, { min: 0, max: 365, int: true }), action: oneOf(s.action, `${name}.action`, ACTIONS) };
    if (out.action === 'message') out.text = str(s.text, `${name}.text`, { max: 2000 });
    if (out.action === 'form') {
      out.formId = str(s.formId, `${name}.formId`, { max: 40 });
      if (!db.prepare('SELECT 1 FROM forms WHERE id=? AND coach_id=?').get(out.formId, coachId)) fail(400, `${name}.formId is not one of your forms`);
    }
    if (out.action === 'program') {
      out.programId = str(s.programId, `${name}.programId`, { max: 40 });
      if (!db.prepare('SELECT 1 FROM programs WHERE id=? AND coach_id=?').get(out.programId, coachId)) fail(400, `${name}.programId is not one of your programs`);
    }
    return out;
  }).sort((a, b) => a.day - b.day);
}

/** What a step does, in words: "Form · PAR-Q health check". */
function stepLabel(db, s) {
  if (s.action === 'message') return `Message · ${s.text.length > 60 ? `${s.text.slice(0, 59)}…` : s.text}`;
  if (s.action === 'form') return `Form · ${db.prepare('SELECT name FROM forms WHERE id=?').get(s.formId)?.name ?? 'removed form'}`;
  return `Program · ${db.prepare('SELECT name FROM programs WHERE id=?').get(s.programId)?.name ?? 'removed program'}`;
}

function runOut(db, flow, run) {
  const steps = JSON.parse(flow.steps);
  const done = JSON.parse(run.done);
  const next = steps.find(s => !done[s.id]);
  const client = db.prepare('SELECT id, name FROM users WHERE id=?').get(run.client_id);
  return {
    id: run.id, autoflowId: flow.id, autoflowName: flow.name,
    client: client ? { id: client.id, name: client.name, initials: initials(client.name) } : null,
    startDay: run.start_day, stepsDone: steps.filter(s => done[s.id]).length, steps: steps.length, stoppedAt: run.stopped_at,
    next: next && !run.stopped_at ? { day: next.day, date: addDays(run.start_day, next.day), label: stepLabel(db, next) } : null,
    log: steps.filter(s => done[s.id]).map(s => ({ stepId: s.id, label: stepLabel(db, s), at: done[s.id].at, outcome: done[s.id].outcome })),
  };
}

function flowOut(db, f) {
  const runs = db.prepare('SELECT * FROM autoflow_runs WHERE autoflow_id=? ORDER BY created_at DESC').all(f.id);
  return {
    id: f.id, name: f.name, trigger: f.trigger, active: !!f.active, updatedAt: f.updated_at,
    steps: JSON.parse(f.steps).map(s => ({ ...s, label: stepLabel(db, s) })),
    runs: runs.map(r => runOut(db, f, r)),
  };
}

// MARK: - Running

const firstName = name => name.split(' ')[0];
const nextMonday = d => addDays(d, (8 - weekday(d)) % 7);

function doStep(db, config, flow, run, step, client, today) {
  if (step.action === 'message') {
    // Governed like every automated send (docs/design/desk-v2.md 3.5): capped, held in quiet hours, skipped when paused.
    const text = step.text.replaceAll('{first}', firstName(client.name));
    const out = sendMessage(db, config, { coachId: flow.coach_id, clientId: client.id, text, via: 'autoflow' });
    return out.message ? 'sent' : out.deferredUntil ? `deferred to ${out.deferredUntil}` : `skipped: ${out.skipped}`;
  }
  if (step.action === 'form') {
    const form = db.prepare('SELECT * FROM forms WHERE id=?').get(step.formId);
    if (!form) return 'skipped: the form was deleted';
    sendForm(db, config, form, client, { autoflowId: flow.id, coachName: db.prepare('SELECT name FROM users WHERE id=?').get(flow.coach_id)?.name });
    return 'sent';
  }
  const program = db.prepare('SELECT * FROM programs WHERE id=?').get(step.programId);
  if (!program) return 'skipped: the program was deleted';
  // Programs are laid out from a Monday; workouts go live so the client sees them.
  const start = nextMonday(today);
  const n = layProgram(db, program, client.id, start, flow.coach_id, { publish: true });
  return `${n} workouts from ${start}`;
}

/** Do every step that has fallen due. Optionally just one client's runs. Returns how many steps ran. */
export function runDue(db, config, { clientId = null, today = londonDay() } = {}) {
  const runs = db.prepare(`SELECT r.*, f.coach_id, f.steps, f.name flow_name FROM autoflow_runs r JOIN autoflows f ON f.id=r.autoflow_id
    WHERE r.stopped_at IS NULL AND f.active=1 ${clientId ? 'AND r.client_id=?' : ''}`).all(...(clientId ? [clientId] : []));
  let ran = 0;
  for (const run of runs) {
    const client = db.prepare("SELECT * FROM users WHERE id=? AND role='client'").get(run.client_id);
    const flow = { id: run.autoflow_id, coach_id: run.coach_id, steps: run.steps, name: run.flow_name };
    // A client who moved to another coach leaves their old coach's flows.
    if (!client || client.coach_id !== run.coach_id) {
      db.prepare('UPDATE autoflow_runs SET stopped_at=? WHERE id=?').run(nowIso(), run.id);
      continue;
    }
    const done = JSON.parse(run.done);
    for (const step of JSON.parse(run.steps)) {
      if (done[step.id] || addDays(run.start_day, step.day) > today) continue;
      try {
        const outcome = tx(db, () => doStep(db, config, flow, run, step, client, today));
        done[step.id] = { at: nowIso(), outcome };
      } catch (e) {
        console.warn(`Autoflow ${run.autoflow_id} step ${step.id}: ${e.message}`);
        done[step.id] = { at: nowIso(), outcome: 'failed' };
      }
      db.prepare('UPDATE autoflow_runs SET done=? WHERE id=?').run(JSON.stringify(done), run.id);
      ran++;
    }
  }
  return ran;
}

function enrolRun(db, flow, clientId, start) {
  const existing = db.prepare('SELECT * FROM autoflow_runs WHERE autoflow_id=? AND client_id=?').get(flow.id, clientId);
  if (existing && !existing.stopped_at) fail(409, 'Already in this autoflow');
  if (existing) db.prepare('DELETE FROM autoflow_runs WHERE id=?').run(existing.id);
  const id = newId('ar');
  db.prepare('INSERT INTO autoflow_runs (id, autoflow_id, client_id, start_day, created_at) VALUES (?,?,?,?,?)').run(id, flow.id, clientId, start, nowIso());
  return id;
}

/** A new client signed up: start their coach's join flows. */
export function startJoinFlows(db, config, client) {
  if (!client?.coach_id || client.is_demo) return;
  const flows = db.prepare("SELECT * FROM autoflows WHERE coach_id=? AND trigger='join' AND active=1").all(client.coach_id);
  for (const f of flows) enrolRun(db, f, client.id, londonDay());
  if (flows.length) runDue(db, config, { clientId: client.id });
}

/** Run due steps every few minutes for as long as the server is up. */
export function startAutoflowClock(db, config, everyMs = 5 * 60_000) {
  const tick = () => { try { runDue(db, config); } catch (e) { console.warn(`Autoflows: ${e.message}`); } };
  tick();
  return setInterval(tick, everyMs);
}

// MARK: - Routes

function ownFlow(ctx) {
  requireCoach(ctx);
  const f = ctx.db.prepare('SELECT * FROM autoflows WHERE id=? AND coach_id=?').get(ctx.params.id, ctx.user.id);
  if (!f) fail(404, 'Not found');
  return f;
}

function fields(ctx) {
  const b = ctx.body;
  return {
    name: str(b.name, 'name', { max: 80 }), trigger: oneOf(b.trigger ?? 'manual', 'trigger', ['join', 'manual']),
    active: b.active === undefined ? true : !!b.active, steps: cleanSteps(ctx.db, ctx.user.id, b.steps),
  };
}

function list(_req, ctx) {
  requireCoach(ctx);
  return { autoflows: ctx.db.prepare('SELECT * FROM autoflows WHERE coach_id=? ORDER BY trigger, name').all(ctx.user.id).map(f => flowOut(ctx.db, f)) };
}

function create(_req, ctx) {
  requireCoach(ctx);
  const f = fields(ctx);
  const id = newId('af');
  ctx.db.prepare('INSERT INTO autoflows (id, coach_id, name, trigger, active, steps, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, ctx.user.id, f.name, f.trigger, f.active ? 1 : 0, JSON.stringify(f.steps), nowIso(), nowIso());
  return flowOut(ctx.db, ctx.db.prepare('SELECT * FROM autoflows WHERE id=?').get(id));
}

function update(_req, ctx) {
  const flow = ownFlow(ctx);
  const f = fields(ctx);
  ctx.db.prepare('UPDATE autoflows SET name=?, trigger=?, active=?, steps=?, updated_at=? WHERE id=?')
    .run(f.name, f.trigger, f.active ? 1 : 0, JSON.stringify(f.steps), nowIso(), flow.id);
  // Turning a flow back on (or adding an early step) can make something due now.
  runDue(ctx.db, ctx.config);
  return flowOut(ctx.db, ctx.db.prepare('SELECT * FROM autoflows WHERE id=?').get(flow.id));
}

function remove(_req, ctx) {
  const flow = ownFlow(ctx);
  ctx.db.prepare('DELETE FROM autoflows WHERE id=?').run(flow.id);
  return { ok: true };
}

/** Start a client on a flow from `startDate` (default today); anything already due happens now. */
function enrol(_req, ctx) {
  const flow = ownFlow(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  const start = dayField(ctx.body.startDate, 'startDate', { optional: true }) ?? londonDay();
  if (start < addDays(londonDay(), -30)) fail(400, 'startDate can be at most 30 days ago');
  const id = enrolRun(ctx.db, flow, client.id, start);
  runDue(ctx.db, ctx.config, { clientId: client.id });
  return runOut(ctx.db, ctx.db.prepare('SELECT * FROM autoflows WHERE id=?').get(flow.id), ctx.db.prepare('SELECT * FROM autoflow_runs WHERE id=?').get(id));
}

function stop(_req, ctx) {
  const flow = ownFlow(ctx);
  const run = ctx.db.prepare('SELECT * FROM autoflow_runs WHERE id=? AND autoflow_id=?').get(ctx.params.runId, flow.id);
  if (!run) fail(404, 'Not found');
  ctx.db.prepare('UPDATE autoflow_runs SET stopped_at=COALESCE(stopped_at, ?) WHERE id=?').run(nowIso(), run.id);
  return { ok: true };
}

/** The flows one client is in, for their page. */
function clientRuns(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.params.id);
  const rows = ctx.db.prepare('SELECT r.* FROM autoflow_runs r JOIN autoflows f ON f.id=r.autoflow_id WHERE r.client_id=? AND f.coach_id=? ORDER BY r.created_at DESC').all(client.id, ctx.user.id);
  return { runs: rows.map(r => runOut(ctx.db, ctx.db.prepare('SELECT * FROM autoflows WHERE id=?').get(r.autoflow_id), r)) };
}

export function autoflowRoutes(r) {
  r.add('GET', '/api/autoflows', list);
  r.add('POST', '/api/autoflows', create);
  r.add('PUT', '/api/autoflows/:id', update);
  r.add('DELETE', '/api/autoflows/:id', remove);
  r.add('POST', '/api/autoflows/:id/enrol', enrol);
  r.add('DELETE', '/api/autoflows/:id/runs/:runId', stop);
  r.add('GET', '/api/coach/clients/:id/autoflows', clientRuns);
}
