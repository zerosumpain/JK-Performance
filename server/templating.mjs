import { minimumStreak } from './daily.mjs';
import { clientFacts } from './facts.mjs';
import { planOf } from './plans.mjs';
import { allVariables, FEATURES } from './registry.mjs';
import { daysBetween, londonDay } from './time.mjs';

/**
 * Message templates (docs/design/desk-v2.md 3.5): `{name}` variables,
 * case-sensitive. Unknown names are left as written and reported in
 * `missing`; known variables with no value (no session booked) become empty
 * and are reported in `empty`. Plain text only, capped at 4000 characters.
 * No variable may expose AI output: the loader refuses AI-derived variables
 * and render() skips any that slip through.
 */

const VAR = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;
const MAX = 4000;
const first = name => String(name ?? '').trim().split(/\s+/)[0] ?? '';

const fmtDay = iso => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
const fmtTime = iso => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });

function nextSessionOf(db, client, now) {
  const at = now.toISOString();
  return db.prepare(`SELECT MIN(start) s FROM (
      SELECT start FROM bookings WHERE client_id=? AND cancelled_at IS NULL AND start>?
      UNION ALL SELECT b.start FROM class_attendees a JOIN bookings b ON b.id=a.booking_id WHERE a.user_id=? AND b.cancelled_at IS NULL AND b.start>?)`)
    .get(client.id, at, client.id, at).s;
}

/** The built-in variables, each computed only when a template uses it. */
const BUILTIN = {
  first: (_db, _c, client) => first(client.name),
  name: (_db, _c, client) => client.name,
  coach: (_db, coach) => coach?.name ?? 'your coach',
  coachFirst: (_db, coach) => first(coach?.name ?? 'Coach'),
  plan: (db, _c, client) => planOf(db, client)?.name ?? '',
  nextSession: (db, _c, client, now) => { const s = nextSessionOf(db, client, now); return s ? `${fmtDay(s)} at ${fmtTime(s)}` : null; },
  nextSessionDay: (db, _c, client, now) => { const s = nextSessionOf(db, client, now); return s ? fmtDay(s) : null; },
  daysQuiet: (db, coach, client, now) => String(clientFacts(db, client.coach_id ?? coach?.id, [client.id], { only: ['core.daysQuiet'], now }).get(client.id)?.['core.daysQuiet'] ?? ''),
  streak: (db, _c, client, now) => String(minimumStreak(db, client, londonDay(now))),
  today: (_db, _c, _client, now) => fmtDay(now.toISOString()),
  yearsCoached: (_db, _c, client, now) => String(Math.max(0, Math.floor(daysBetween(londonDay(new Date(client.created_at)), londonDay(now)) / 365))),
};

/** The variable catalogue for the builder: `[{name, label, feature}]`. */
export const variableCatalogue = () => allVariables().filter(v => !v.aiDerived).map(({ value: _v, ...v }) => v);

/**
 * Fill `{name}` variables for one client. `extra` adds or overrides variables
 * for this render only ({campaign: 'Spring Reset'}). Returns {text, missing, empty}.
 */
export function render(db, coachId, client, text, { extra = {}, now = new Date() } = {}) {
  const coach = db.prepare('SELECT * FROM users WHERE id=?').get(coachId);
  const features = new Map();
  for (const f of FEATURES) for (const [name, v] of Object.entries(f.variables ?? {})) if (!v.aiDerived) features.set(name, v);
  const cache = new Map();
  const missing = new Set(), empty = new Set();
  const valueOf = name => {
    if (cache.has(name)) return cache.get(name);
    let v;
    if (Object.hasOwn(extra ?? {}, name)) v = extra[name];
    else if (BUILTIN[name]) v = BUILTIN[name](db, coach, client, now);
    else if (features.has(name)) {
      try { v = features.get(name).value(db, coachId, client); } catch (e) { console.error(`Variable {${name}} failed`, e); v = null; }
    } else v = undefined;
    cache.set(name, v);
    return v;
  };
  const out = String(text ?? '').replace(VAR, (whole, name) => {
    const v = valueOf(name);
    if (v === undefined) { missing.add(name); return whole; }
    if (v === null || v === '') { empty.add(name); return ''; }
    return String(v);
  });
  return { text: out.slice(0, MAX), missing: [...missing], empty: [...empty] };
}
