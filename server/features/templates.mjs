import { clientFor, ownRow, requestNow, requireCoach } from '../access.mjs';
import { fail, oneOf, str } from '../http.mjs';
import { newId, nowIso } from '../store.mjs';
import { render, variableCatalogue } from '../templating.mjs';

/**
 * F16 Message templates and snippets (docs/design/desk-v2.md, WP5). A coach's
 * best messages, one keystroke away: `/checkin` in any composer drops a
 * personalised message in. Templates are coach-owned rows (no client data);
 * rendering goes through the foundation's templating, so AI output can never
 * be quoted and unknown `{names}` are reported, never invented.
 */

export const CATEGORIES = ['general', 'welcome', 'onboarding', 'nudge', 'celebrate', 'billing', 'renewal', 'session', 'campaign', 'winback', 'checkin'];
const SHORTCUT = /^[a-z0-9][a-z0-9-]{0,23}$/;
const VAR = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

/** Examples for the built-in variables, for the chips in the editor. */
const EXAMPLES = {
  first: 'Sam', name: 'Sam Carter', coach: 'John Kelly', coachFirst: 'John', plan: 'Performance', nextSession: 'Tue 4 Nov at 07:00',
  nextSessionDay: 'Tue 4 Nov', daysQuiet: '6', streak: '12', today: 'Mon 3 Nov', yearsCoached: '1',
};

/** The variable names a body uses, in order, once each. */
export const variablesIn = text => [...new Set([...String(text ?? '').matchAll(VAR)].map(m => m[1]))];

export const templateOut = t => ({
  id: t.id, name: t.name, body: t.body, category: t.category, shortcut: t.shortcut, uses: t.uses, lastUsedAt: t.last_used_at,
  variables: variablesIn(t.body), createdAt: t.created_at, updatedAt: t.updated_at,
});

/** A shortcut as typed ("/CheckIn", "checkin") → "checkin", or null; 400 for anything else. */
function cleanShortcut(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') fail(400, 'shortcut must be text');
  const s = v.trim().replace(/^\//, '').toLowerCase();
  if (!SHORTCUT.test(s)) fail(400, 'shortcut must be 1–24 letters, digits or dashes');
  return s;
}

function fields(ctx, current = null) {
  const b = ctx.body;
  return {
    name: b.name === undefined && current ? current.name : str(b.name, 'name', { max: 80 }),
    body: b.body === undefined && current ? current.body : str(b.body, 'body', { max: 4000 }),
    category: b.category === undefined ? current?.category ?? 'general' : oneOf(b.category, 'category', CATEGORIES),
    shortcut: b.shortcut === undefined ? current?.shortcut ?? null : cleanShortcut(b.shortcut),
  };
}

function shortcutFree(db, coachId, shortcut, exceptId = null) {
  if (!shortcut) return;
  const other = db.prepare('SELECT id FROM message_templates WHERE coach_id=? AND shortcut=?').get(coachId, shortcut);
  if (other && other.id !== exceptId) fail(409, `You already use /${shortcut}`);
}

// MARK: - Routes

function list(_req, ctx) {
  requireCoach(ctx);
  const rows = ctx.db.prepare('SELECT * FROM message_templates WHERE coach_id=? ORDER BY category, name').all(ctx.user.id);
  return { templates: rows.map(templateOut), categories: CATEGORIES };
}

function create(_req, ctx) {
  requireCoach(ctx);
  const f = fields(ctx);
  shortcutFree(ctx.db, ctx.user.id, f.shortcut);
  if (ctx.db.prepare('SELECT COUNT(*) n FROM message_templates WHERE coach_id=?').get(ctx.user.id).n >= 500) fail(413, 'At most 500 templates');
  const id = newId('mt');
  const at = nowIso();
  ctx.db.prepare('INSERT INTO message_templates (id, coach_id, name, body, category, shortcut, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, ctx.user.id, f.name, f.body, f.category, f.shortcut, at, at);
  return { template: templateOut(ctx.db.prepare('SELECT * FROM message_templates WHERE id=?').get(id)) };
}

function getOne(_req, ctx) {
  requireCoach(ctx);
  return { template: templateOut(ownRow(ctx, 'message_templates', ctx.params.id)) };
}

function update(_req, ctx) {
  requireCoach(ctx);
  const t = ownRow(ctx, 'message_templates', ctx.params.id);
  const f = fields(ctx, t);
  shortcutFree(ctx.db, ctx.user.id, f.shortcut, t.id);
  ctx.db.prepare('UPDATE message_templates SET name=?, body=?, category=?, shortcut=?, updated_at=? WHERE id=?')
    .run(f.name, f.body, f.category, f.shortcut, nowIso(), t.id);
  return { template: templateOut(ctx.db.prepare('SELECT * FROM message_templates WHERE id=?').get(t.id)) };
}

function remove(_req, ctx) {
  requireCoach(ctx);
  const t = ownRow(ctx, 'message_templates', ctx.params.id);
  ctx.db.prepare('DELETE FROM message_templates WHERE id=?').run(t.id);
  return { ok: true };
}

/** {templateId? | text?, clientId} → {text, missing, empty}: the message as this client would get it. No side effects. */
function renderRoute(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const client = clientFor(ctx, b.clientId);
  let text;
  if (b.templateId !== undefined && b.templateId !== null) text = ownRow(ctx, 'message_templates', b.templateId).body;
  else text = str(b.text, 'text', { max: 4000 });
  const out = render(ctx.db, ctx.user.id, client, text, { now: requestNow(ctx) });
  return { text: out.text, missing: out.missing, empty: out.empty };
}

function used(_req, ctx) {
  requireCoach(ctx);
  const t = ownRow(ctx, 'message_templates', ctx.params.id);
  ctx.db.prepare('UPDATE message_templates SET uses=uses+1, last_used_at=? WHERE id=?').run(nowIso(), t.id);
  return { template: templateOut(ctx.db.prepare('SELECT * FROM message_templates WHERE id=?').get(t.id)) };
}

function variables(_req, ctx) {
  requireCoach(ctx);
  return { variables: variableCatalogue().map(v => ({ name: v.name, label: v.label, example: v.example ?? EXAMPLES[v.name] ?? '', feature: v.feature })) };
}

// MARK: - Schema

function schema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS message_templates (
    id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, body TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('general','welcome','onboarding','nudge','celebrate','billing','renewal','session','campaign','winback','checkin')),
    shortcut TEXT, uses INTEGER NOT NULL DEFAULT 0, last_used_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS message_templates_shortcut ON message_templates(coach_id, shortcut) WHERE shortcut IS NOT NULL;
  CREATE INDEX IF NOT EXISTS message_templates_coach ON message_templates(coach_id, category);`);
}

// MARK: - Demo

const DEMO = [
  ['Weekly check-in', 'checkin', 'checkin', 'Morning {first}! Quick check-in: how did the week feel, 1 to 10? Anything sore? Your next session is {nextSession}.', 41],
  ['Welcome aboard', 'welcome', 'welcome', 'Welcome to JK Performance, {first}! Fill in the intake form when you get a minute and I\'ll build your first block around it.', 18],
  ['Great session', 'celebrate', 'great', 'Brilliant work today, {first}. That is exactly the kind of session that adds up. Proud of you.', 37],
  ['Missed you', 'nudge', 'missed', 'Hey {first}, missed you this week. No guilt, life happens. What would make the next session easy to get to?', 22],
  ['Invoice reminder', 'billing', 'invoice', 'Hi {first}, a gentle nudge that this month\'s invoice is open. Shout if anything looks off.', 9],
  ['Reschedule', 'session', 'reschedule', 'No problem, {first}. I\'ve freed up your slot. Which of these works instead? Reply with a day and I\'ll lock it in.', 14],
  ['Win-back', 'winback', 'winback', 'Hi {first}, it\'s been a while! I\'ve kept your notes. If you fancy picking things back up, I\'d love to have you back.', 6],
  ['Onboarding: first week', 'onboarding', 'firstweek', 'You\'re a week in, {first}. Log every set, even the bad ones: the numbers are how we build. Questions? Fire away.', 11],
  ['Renewal coming up', 'renewal', 'renew', 'Hi {first}, your current block finishes soon. Want me to plan the next one? I\'ve got a few ideas based on how you\'ve been moving.', 7],
  ['Campaign kick-off', 'campaign', 'kickoff', 'Day one, {first}! Your plan is up in the app. Start easy, be consistent, and tell me how it feels.', 5],
  ['Session tomorrow', 'session', 'tomorrow', 'See you {nextSession}, {first}. Bring water and an appetite for squats.', 26],
  ['Quiet nudge', 'nudge', 'nudge', 'Hey {first}, it\'s been {daysQuiet} days. Even a 10-minute walk counts. What\'s one small thing you can do today?', 19],
];

/**
 * The demo builder creates its table if needed and clears the demo coach's
 * rows itself: older tests build the demo before createApp has run feature
 * schemas, so a demo.tables entry would make the foundation's wipe fail.
 */
function buildDemo(db, { coach, today }) {
  schema(db);
  db.prepare('DELETE FROM message_templates WHERE coach_id=?').run(coach.id);
  const at = d => `${d}T09:00:00.000Z`;
  const day = (offset) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  DEMO.forEach(([name, category, shortcut, body, uses], i) => {
    db.prepare(`INSERT INTO message_templates (id, coach_id, name, body, category, shortcut, uses, last_used_at, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(newId('mt'), coach.id, name, body, category, shortcut, uses, uses ? at(day(-((i * 3) % 9))) : null, at(day(-60 + i)), at(day(-20 + i)));
  });
}

// MARK: - The feature

export const feature = {
  name: 'templates',
  namespaces: ['template'],
  exact: [],

  schema,

  routes(r) {
    r.add('GET', '/api/templates/variables', variables);
    r.add('POST', '/api/templates/render', renderRoute);
    r.add('GET', '/api/templates', list);
    r.add('POST', '/api/templates', create);
    r.add('GET', '/api/templates/:id', getOne);
    r.add('PUT', '/api/templates/:id', update);
    r.add('DELETE', '/api/templates/:id', remove);
    r.add('POST', '/api/templates/:id/used', used);
  },

  /** Palette results: templates by name, shortcut or text. */
  search(db, coach, q, limit) {
    const like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
    return db.prepare(`SELECT * FROM message_templates WHERE coach_id=? AND (name LIKE ? ESCAPE '\\' OR shortcut LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')
      ORDER BY uses DESC LIMIT ?`).all(coach.id, like, like, like, limit).map(t => ({
      type: 'template', id: t.id, title: t.name, detail: t.shortcut ? `/${t.shortcut} · ${t.body.slice(0, 80)}` : t.body.slice(0, 90),
      path: `/templates?open=${t.id}`, icon: 'description', score: t.name.toLowerCase().includes(q.toLowerCase()) ? 0.7 : 0.4, at: t.updated_at,
    }));
  },

  /** A coach's export carries their templates; a client has none. */
  exportFor(db, user) {
    if (user.role !== 'coach') return {};
    return { templates: db.prepare('SELECT * FROM message_templates WHERE coach_id=? ORDER BY name').all(user.id).map(templateOut) };
  },

  demo: { build: buildDemo },
};
