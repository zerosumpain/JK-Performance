/**
 * The feature registry (docs/design/desk-v2.md 3.1). This module has NO
 * imports, on purpose: foundation and existing modules import it and read it
 * at call time, while only the entry points (main.mjs, app.mjs and the test
 * helpers) import server/features.mjs, which fills it. That keeps the
 * top-level-await loader out of every import cycle.
 *
 * It also holds the foundation's own catalogue entries (built-in events,
 * facts, actions and variables) as plain data, so the catalogue readers work
 * whether or not a feature is loaded. The code behind the built-ins lives in
 * events.mjs, facts.mjs and templating.mjs.
 */

/** Filled once by features.mjs, then frozen. Each entry is a feature module's `feature` object. */
export const FEATURES = [];
let frozen = false;

/** features.mjs only: install the validated features (once). */
export function installFeatures(list) {
  if (frozen) throw new Error('Features are already installed');
  FEATURES.push(...list);
  Object.freeze(FEATURES);
  frozen = true;
}

export const featuresInstalled = () => frozen;

let schemaRunner = null;
/** features.mjs only: register its schema runner, so modules that cannot import the loader (demo.mjs) can still run it. */
export function setSchemaRunner(fn) { schemaRunner = fn; }
/** Run every feature's idempotent DDL on `db` if the loader is present (a no-op otherwise). */
export function ensureFeatureSchemas(db) { schemaRunner?.(db); }

/** Namespaces and exact ids the foundation keeps for itself (3.11). */
export const RESERVED_NAMESPACES = ['core', 'message', 'checkin', 'form', 'workout', 'membership', 'letter', 'commitment', 'day', 'tag', 'coach', 'program'];
export const RESERVED_EXACT = ['client.joined', 'client.tagged', 'client.untagged', 'booking.created', 'booking.cancelled'];

/** Events the foundation emits from existing code (3.2). */
export const FOUNDATION_EVENTS = {
  'client.joined': { label: 'A client joined', payload: ['email'] },
  'client.tagged': { label: 'A tag was added to a client', payload: ['tagId', 'by'] },
  'client.untagged': { label: 'A tag was removed from a client', payload: ['tagId', 'by'] },
  'message.sent': { label: 'A message was sent to a client', payload: ['messageId', 'kind', 'mediaId', 'via'] },
  'message.received': { label: 'A client sent a message', payload: ['messageId', 'kind', 'mediaId'] },
  'checkin.submitted': { label: 'A client sent a weekly check-in', payload: ['checkinId', 'week', 'pain'] },
  'form.sent': { label: 'A form was sent', payload: ['requestId', 'formId'] },
  'form.submitted': { label: 'A client answered a form', payload: ['requestId', 'formId', 'flagged'] },
  'booking.created': { label: 'A session was booked', payload: ['bookingId', 'kind', 'start', 'purpose', 'byRole', 'late', 'refunded'] },
  'booking.cancelled': { label: 'A session was cancelled', payload: ['bookingId', 'kind', 'start', 'purpose', 'byRole', 'late', 'refunded'] },
  'workout.completed': { label: 'A client finished a workout', payload: ['workoutId', 'feel'] },
  'membership.changed': { label: 'A client changed plan', payload: ['from', 'to'] },
  'letter.published': { label: 'A letter was published', payload: ['reportId', 'kind'] },
  'letter.delivered': { label: 'A letter was delivered', payload: ['reportId', 'kind'] },
  'commitment.reviewed': { label: 'A client reviewed a commitment', payload: ['commitmentId', 'outcome'] },
  'day.started': { label: 'The coach\'s day started (05:00)', payload: ['day'] },
};

export const PLAN_OPTIONS = [
  { value: 'none', label: 'No plan' }, { value: 'foundation', label: 'Foundation' },
  { value: 'performance', label: 'Performance' }, { value: 'elite', label: 'Elite' },
];

/** Built-in facts (3.4); facts.mjs computes them. */
export const FOUNDATION_FACTS = {
  'core.plan': { label: 'Plan', type: 'enum', options: PLAN_OPTIONS },
  'core.daysSinceJoined': { label: 'Days since joining', type: 'days' },
  'core.daysQuiet': { label: 'Days quiet', type: 'days' },
  'core.sessionsAttended14': { label: 'Sessions attended (14 days)', type: 'number' },
  'core.anniversaryInDays': { label: 'Days to joining anniversary', type: 'days' },
  'core.outreachPaused': { label: 'Outreach paused', type: 'bool' },
  'core.daysSinceWorkout': { label: 'Days since last workout', type: 'days' },
  'core.adherence28': { label: 'Adherence (28 days, %)', type: 'number' },
  'core.unread': { label: 'Unread messages', type: 'number' },
  'core.pain14': { label: 'Pain flagged (14 days)', type: 'bool' },
  'core.nextSessionDays': { label: 'Days to next session', type: 'days' },
  'core.onboarded': { label: 'Onboarded', type: 'bool' },
  'core.tags': { label: 'Tags', type: 'tags' },
  'core.segments': { label: 'Segments', type: 'tags' },
};

const TEMPLATE = (key, label) => ({ key, label, type: 'template', required: true });

/** Built-in actions (3.5); facts.mjs runs them. */
export const FOUNDATION_ACTIONS = {
  'message.send': { label: 'Send a message', clientFacing: true, params: [TEMPLATE('text', 'Message')] },
  'form.send': { label: 'Send a form', clientFacing: true, params: [{ key: 'formId', label: 'Form', type: 'form', required: true }] },
  'program.assign': {
    label: 'Put a program on the calendar', clientFacing: true,
    params: [{ key: 'programId', label: 'Program', type: 'program', required: true },
      { key: 'start', label: 'Starting', type: 'enum', options: [{ value: 'nextMonday', label: 'Next Monday' }, { value: 'today', label: 'Today' }], default: 'nextMonday' }],
  },
  'tag.add': { label: 'Add a tag', clientFacing: false, params: [{ key: 'tagId', label: 'Tag', type: 'tag', required: true }] },
  'tag.remove': { label: 'Remove a tag', clientFacing: false, params: [{ key: 'tagId', label: 'Tag', type: 'tag', required: true }] },
  'coach.notify': {
    label: 'Notify me', clientFacing: false,
    params: [{ key: 'title', label: 'Title', type: 'text', required: true }, { key: 'body', label: 'Detail', type: 'template' }],
  },
};

/** Built-in template variables (3.5); templating.mjs fills them. */
export const FOUNDATION_VARIABLES = {
  first: { label: 'First name' }, name: { label: 'Full name' }, coach: { label: 'Coach name' }, coachFirst: { label: 'Coach first name' },
  plan: { label: 'Plan name' }, nextSession: { label: 'Next session ("Tue 4 Nov at 07:00")' }, nextSessionDay: { label: 'Next session day' },
  daysQuiet: { label: 'Days quiet' }, streak: { label: 'Minimum-day streak' }, today: { label: 'Today' }, yearsCoached: { label: 'Years coached' },
};

// MARK: - Readers (call time only)

/** `[[feature, fn], …]` for every feature that defines hook `name`. */
export const hooks = name => FEATURES.filter(f => typeof f[name] === 'function').map(f => [f, f[name].bind(f)]);

export const featureNames = () => FEATURES.map(f => f.name);

/** Every event type: the foundation's, then each feature's `emits`. */
export function allEvents() {
  const out = Object.entries(FOUNDATION_EVENTS).map(([type, e]) => ({ type, ...e, aiDerived: false, feature: 'core' }));
  for (const f of FEATURES) for (const [type, e] of Object.entries(f.emits ?? {})) out.push({ type, label: e.label ?? type, payload: e.payload ?? [], aiDerived: !!e.aiDerived, feature: f.name });
  return out;
}

/** Every fact: the foundation's (computed in facts.mjs) and each feature's (with `compute`). */
export function allFacts() {
  const out = Object.entries(FOUNDATION_FACTS).map(([id, f]) => ({ id, ...f, aiDerived: false, feature: 'core' }));
  for (const f of FEATURES) for (const [id, x] of Object.entries(f.facts ?? {})) out.push({ id, ...x, aiDerived: !!x.aiDerived, feature: f.name });
  return out;
}

/** Every action: the foundation's (run in facts.mjs) and each feature's (with `run`). Unknown clientFacing counts as true. */
export function allActions() {
  const out = Object.entries(FOUNDATION_ACTIONS).map(([id, a]) => ({ id, ...a, feature: 'core' }));
  for (const f of FEATURES) for (const [id, a] of Object.entries(f.actions ?? {})) out.push({ id, ...a, clientFacing: a.clientFacing !== false, params: a.params ?? [], feature: f.name });
  return out;
}

/** Every template variable. Features may not declare AI-derived variables (the loader refuses them). */
export function allVariables() {
  const out = Object.entries(FOUNDATION_VARIABLES).map(([name, v]) => ({ name, ...v, aiDerived: false, feature: 'core' }));
  for (const f of FEATURES) for (const [name, v] of Object.entries(f.variables ?? {})) out.push({ name, ...v, aiDerived: !!v.aiDerived, feature: f.name });
  return out;
}
