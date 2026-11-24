import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runDue } from './autoflows.mjs';
import { seedDemo } from './demo.mjs';
import { drainEvents, emitDayStarted, pruneEvents } from './events.mjs';
import { sendDeferred } from './messages.mjs';
import { pruneNotifications, pushDueNotifications } from './notifications.mjs';
import { FOUNDATION_VARIABLES, RESERVED_EXACT, RESERVED_NAMESPACES, FEATURES, installFeatures, setSchemaRunner } from './registry.mjs';
import { deliverDue } from './reports.mjs';
import { addColumn, tx } from './store.mjs';
import { londonClock, londonDay } from './time.mjs';

/**
 * The feature loader (docs/design/desk-v2.md 3.1). The ONLY module with a
 * top-level await, and imported only by entry points (main.mjs, app.mjs,
 * server/test/helpers.mjs). It imports every server/features/<name>.mjs in
 * name order, validates each `feature` object and fills the registry. Any
 * mistake in a feature file stops the server at start-up, never later.
 *
 * FEATURES_DIR replaces the folder, but only when NODE_ENV=test.
 */

const KEYS = new Set(['name', 'namespaces', 'exact', 'schema', 'routes', 'clocks', 'on', 'emits', 'actions', 'facts', 'variables',
  'needs', 'inbox', 'search', 'forecast', 'diary', 'timeline', 'exportFor', 'messageExtras', 'quiet', 'badges', 'meFeatures',
  'renewals', 'offboarding', 'publicOffers', 'demo']);
const HOOKS = ['schema', 'routes', 'needs', 'inbox', 'search', 'forecast', 'diary', 'timeline', 'exportFor', 'messageExtras', 'quiet', 'badges',
  'meFeatures', 'renewals', 'offboarding', 'publicOffers'];
const FILE = /^[a-z0-9-]+\.mjs$/;
const NAMESPACE = /^[a-z][a-zA-Z0-9]*$/;
const ID = /^[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.]+$/;
const TABLE = /^[a-z_]+$/;

const bad = (name, message) => { throw new Error(`Feature ${name}: ${message}`); };
const isAsync = fn => fn?.constructor?.name === 'AsyncFunction';

/**
 * Check a list of `{ file, feature }` pairs (file name without .mjs) and return
 * the features. Throws on: an unknown key; a duplicate name; a name that is not
 * the file name; an id outside the feature's namespaces and `exact` list; two
 * features claiming one namespace or exact id (including a namespace that
 * covers another owner's exact id); a foundation-reserved id; a variable
 * name used twice or already a foundation variable; an AI-derived variable;
 * an async event handler.
 */
export function validateFeatures(list) {
  const nsOwner = new Map(RESERVED_NAMESPACES.map(n => [n, 'foundation']));
  const exactOwner = new Map(RESERVED_EXACT.map(n => [n, 'foundation']));
  const names = new Set();
  const clockIds = new Set();
  const variableOwner = new Map(Object.keys(FOUNDATION_VARIABLES).map(v => [v, 'foundation']));
  const claimed = (owner, what) => owner === 'foundation' ? `${what} is reserved by the foundation` : `${what} is already claimed by ${owner}`;
  for (const { file, feature: f } of list) {
    if (!f || typeof f !== 'object') bad(file, 'must export a `feature` object');
    const name = f.name;
    if (name !== file) bad(file, `name "${name}" must equal the file name "${file}"`);
    if (names.has(name)) bad(name, 'the name is used twice');
    names.add(name);
    for (const key of Object.keys(f)) if (!KEYS.has(key)) bad(name, `unknown key "${key}"`);
    for (const key of HOOKS) if (f[key] !== undefined && typeof f[key] !== 'function') bad(name, `${key} must be a function`);
    const namespaces = f.namespaces ?? [];
    const exact = f.exact ?? [];
    if (!Array.isArray(namespaces) || namespaces.some(n => !NAMESPACE.test(n))) bad(name, 'namespaces must be a list of lower-case words');
    if (!Array.isArray(exact) || exact.some(id => !ID.test(id))) bad(name, 'exact must be a list of ids like "booking.rescheduled"');
    for (const n of namespaces) {
      if (nsOwner.has(n)) bad(name, claimed(nsOwner.get(n), `namespace "${n}"`));
      for (const [id, owner] of exactOwner) if (owner !== name && id.startsWith(`${n}.`)) bad(name, `namespace "${n}" covers id "${id}", which ${owner === 'foundation' ? 'is reserved by the foundation' : `is claimed by ${owner}`}`);
      nsOwner.set(n, name);
    }
    for (const id of exact) {
      if (exactOwner.has(id)) bad(name, claimed(exactOwner.get(id), `id "${id}"`));
      const prefix = id.split('.')[0], ns = nsOwner.get(prefix);
      if (ns && ns !== name) bad(name, `id "${id}" is in namespace "${prefix}", which ${ns === 'foundation' ? 'is reserved by the foundation' : `is claimed by ${ns}`}`);
      exactOwner.set(id, name);
    }
    const owns = id => exact.includes(id) || namespaces.some(n => id.startsWith(`${n}.`));
    for (const group of ['emits', 'actions', 'facts']) {
      const entries = f[group] ?? {};
      if (typeof entries !== 'object' || Array.isArray(entries)) bad(name, `${group} must be an object`);
      for (const [id, spec] of Object.entries(entries)) {
        if (!ID.test(id)) bad(name, `${group} id "${id}" is not like "namespace.name"`);
        if (!owns(id)) bad(name, `${group} id "${id}" is outside its namespaces and exact ids`);
        if (!spec || typeof spec !== 'object') bad(name, `${group}.${id} must be an object`);
        if (group === 'actions' && typeof spec.run !== 'function') bad(name, `action ${id} needs run(db, config, ctx)`);
        if (group === 'facts' && typeof spec.compute !== 'function') bad(name, `fact ${id} needs compute(db, coachId, clientIds, today)`);
        if (group === 'facts' && !['number', 'money', 'days', 'bool', 'enum', 'tags', 'day'].includes(spec.type)) bad(name, `fact ${id} has an unknown type`);
      }
    }
    for (const [v, spec] of Object.entries(f.variables ?? {})) {
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(v)) bad(name, `variable "${v}" must be a plain word`);
      if (spec?.aiDerived) bad(name, `variable "${v}" is AI-derived; no template may quote a model`);
      if (typeof spec?.value !== 'function') bad(name, `variable ${v} needs value(db, coachId, client)`);
      if (variableOwner.has(v)) bad(name, claimed(variableOwner.get(v), `variable "${v}"`));
      variableOwner.set(v, name);
    }
    for (const [type, fn] of Object.entries(f.on ?? {})) {
      if (type !== '*' && !ID.test(type)) bad(name, `on "${type}" is not an event type`);
      if (typeof fn !== 'function' || isAsync(fn)) bad(name, `on "${type}" must be a synchronous function`);
    }
    for (const c of f.clocks ?? []) {
      if (!c || typeof c.id !== 'string' || !(c.everyMs >= 1000) || typeof c.run !== 'function') bad(name, 'each clock needs {id, everyMs ≥ 1000, run}');
      if (clockIds.has(c.id) || c.id.startsWith('core.')) bad(name, `clock id "${c.id}" is used twice`);
      clockIds.add(c.id);
    }
    if (f.demo !== undefined) {
      const d = f.demo;
      for (const k of Object.keys(d)) if (!['tables', 'media', 'build'].includes(k)) bad(name, `unknown demo key "${k}"`);
      for (const k of Object.keys(d.tables ?? {})) {
        if (!['client', 'user', 'coach'].includes(k)) bad(name, `demo.tables.${k} must be client, user or coach`);
        if (!Array.isArray(d.tables[k]) || d.tables[k].some(t => !TABLE.test(t))) bad(name, `demo.tables.${k} must be a list of table names`);
      }
      if (d.build !== undefined && (typeof d.build !== 'function' || isAsync(d.build))) bad(name, 'demo.build must be a synchronous function');
      for (const m of d.media ?? []) if (!m?.key || !m?.file || !m?.mime) bad(name, 'each demo.media entry needs {key, file, mime}');
    }
  }
  return list.map(x => x.feature);
}

/** The folder features load from. */
export function featuresDir(env = process.env) {
  if (env.NODE_ENV === 'test' && env.FEATURES_DIR) return env.FEATURES_DIR;
  return fileURLToPath(new URL('./features/', import.meta.url));
}

async function load(dir) {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(n => FILE.test(n)).sort();
  const list = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(join(dir, file)).href);
    list.push({ file: file.slice(0, -4), feature: mod.feature });
  }
  return validateFeatures(list);
}

installFeatures(await load(featuresDir()));

// MARK: - Schemas

const schemasDone = new WeakSet();

/** Every feature's idempotent DDL, after the core schema. Safe to call more than once. */
export function runFeatureSchemas(db) {
  if (schemasDone.has(db)) return;
  for (const f of FEATURES) {
    if (!f.schema) continue;
    f.schema(db, { addColumn: (table, column, ddl) => addColumn(db, table, column, ddl), tx: fn => tx(db, fn) });
  }
  schemasDone.add(db);
}
setSchemaRunner(runFeatureSchemas);

// MARK: - Clocks (3.6)

/** The foundation's clocks; `now` always comes from the argument. */
function foundationClocks(config) {
  const clocks = [
    { id: 'core.events', everyMs: 10_000, run: (db, cfg) => drainEvents(db, cfg) },
    { id: 'core.autoflows', everyMs: 5 * 60_000, run: (db, cfg, now) => runDue(db, cfg, { today: londonDay(now) }) },
    { id: 'core.letters', everyMs: 60_000, run: (db, cfg) => deliverDue(db, cfg) },
    { id: 'core.dayStarted', everyMs: 60_000, run: (db, cfg, now) => emitDayStarted(db, now) },
    { id: 'core.deferred', everyMs: 60_000, run: (db, cfg, now) => sendDeferred(db, cfg, now) },
    { id: 'core.urgentPush', everyMs: 60_000, run: (db, cfg, now) => pushDueNotifications(db, cfg, now) },
    { id: 'core.prune', everyMs: 24 * 3_600_000, run: (db, cfg, now) => ({ events: pruneEvents(db, now), notifications: pruneNotifications(db, now) }) },
  ];
  if (config.demoCode || config.demoCoachCode) {
    // Rebuild the demo world once a night, after 03:00 London, so its "today" stays today.
    clocks.push({
      id: 'core.demo', everyMs: 10 * 60_000,
      run: (db, cfg, now) => {
        if (londonClock(now) < '03:00') return false;
        const built = seedDemo(db, londonDay(now), cfg);
        if (built) console.log('Rebuilt the demo world for today');
        return built;
      },
    });
  }
  return clocks;
}

function allClocks(config) {
  return [...foundationClocks(config), ...FEATURES.flatMap(f => f.clocks ?? [])];
}

const running = new Map(); // `${id}` -> promise of an async run still going

async function runClock(db, config, clock, now) {
  if (running.has(clock.id)) return { skipped: 'still running' };
  let result;
  try {
    result = clock.run(db, config, now);
    if (result && typeof result.then === 'function') {
      running.set(clock.id, result);
      result = await result;
    }
  } catch (e) {
    console.error(`Clock ${clock.id} failed`, e);
    result = { error: e.message };
  } finally {
    running.delete(clock.id);
  }
  return result;
}

/**
 * Start every clock: the foundation's and each feature's. The first run of each
 * is 5 s after start-up, so the boot stays fast. Returns stop().
 */
export function startClocks(db, config, { firstDelayMs = 5_000 } = {}) {
  const timers = [];
  for (const clock of allClocks(config)) {
    const tick = () => { runClock(db, config, clock, new Date()); };
    timers.push(setTimeout(() => {
      tick();
      timers.push(setInterval(tick, clock.everyMs));
    }, firstDelayMs));
  }
  return () => { for (const t of timers) { clearTimeout(t); clearInterval(t); } };
}

/** Tests: run one clock now, with an injected `now`. Resolves to what the clock returned. */
export async function tickClock(db, config, id, now = new Date()) {
  const clock = allClocks(config).find(c => c.id === id);
  if (!clock) throw new Error(`No clock ${id}`);
  return runClock(db, config, clock, now);
}
