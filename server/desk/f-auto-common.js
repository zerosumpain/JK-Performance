/*
 * F15 automations (WP5): what the list, the recipes and the builder share.
 * The catalogue (events, actions, facts, variables, lookups) is loaded once;
 * words() mirror the server's sentences, so the canvas reads as plain English
 * while the coach edits, before anything is saved.
 */
import { api, h, icon, pill } from './core.js';

let catalogueP = null;
/** GET /api/automations/catalogue, once (force to reload after creating a tag or form). */
export function catalogue(force = false) {
  if (!catalogueP || force) catalogueP = api('GET', '/api/automations/catalogue').catch(err => { catalogueP = null; throw err; });
  return catalogueP;
}

export const enc = encodeURIComponent;
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lower = s => (s ? s[0].toLowerCase() + s.slice(1) : s);
export const clip = (s, n = 60) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** The only steps an automation that uses an AI judgement may have (server: AI_SAFE_ACTIONS). */
export const AI_SAFE = ['coach.notify', 'task.create', 'tag.add', 'tag.remove', 'ai.draft'];

const ACTION_ICON = {
  'message.send': 'chat_bubble', 'form.send': 'edit_note', 'program.assign': 'format_list_bulleted', 'tag.add': 'label', 'tag.remove': 'label',
  'coach.notify': 'notifications_active', 'task.create': 'task_alt', 'ai.draft': 'auto_awesome', 'offer.issue': 'sell', 'pulse.send': 'sentiment_satisfied',
  'campaign.enrol': 'rocket_launch', 'invoice.create': 'receipt_long', 'accountability.nudge': 'checklist',
};
export const actionIcon = id => ACTION_ICON[id] ?? (id?.startsWith('ai.') ? 'auto_awesome' : 'bolt');
const EVENT_ICON = [
  [/^booking\.(cancelled|noShow|lateCancel)$/, 'event_busy'], [/^booking\./, 'calendar_month'], [/^message\.received$/, 'forum'], [/^message\./, 'chat_bubble'],
  [/^client\.joined$/, 'person_add'], [/^client\.(tagged|untagged)$/, 'label'], [/^client\./, 'monitor_heart'], [/^checkin\./, 'checklist'], [/^form\./, 'description'],
  [/^workout\./, 'fitness_center'], [/^commitment\./, 'flag'], [/^(payment|invoice|package|billing)\./, 'payments'], [/^campaign\./, 'rocket_launch'],
  [/^voice\./, 'graphic_eq'], [/^ai\./, 'auto_awesome'], [/^letter\./, 'drafts'], [/^membership\./, 'workspace_premium'], [/^lead\./, 'person_search'],
  [/^(pulse|insights)\./, 'sentiment_satisfied'], [/^onboarding\./, 'checklist'], [/^day\./, 'sunny'],
];
export const eventIcon = type => EVENT_ICON.find(([re]) => re.test(type ?? ''))?.[1] ?? 'bolt';
export const triggerIcon = t => (t?.type === 'schedule' ? 'event_repeat' : t?.type === 'enters' ? 'filter_alt' : t?.type === 'manual' ? 'person_add' : eventIcon(t?.event));

export const STATUS = { live: ['On', 'ok'], paused: ['Paused', 'attention'], draft: ['Draft', 'data'] };
export const statusPill = s => pill(...(STATUS[s] ?? [s, 'data']));
export const RUN_STATUS = { active: ['Waiting', 'data'], done: ['Done', 'ok'], stopped: ['Stopped', 'attention'], failed: ['Failed', 'urgent'] };
export const runPill = s => pill(...(RUN_STATUS[s] ?? [s, 'data']));

// MARK: - Words (mirror server/features/automations.mjs)

const OP_WORD = { eq: 'is', ne: 'is not', gt: '>', gte: '≥', lt: '<', lte: '≤', in: 'is any of', notIn: 'is none of', has: 'has', hasNot: 'does not have', isSet: 'is set', isNotSet: 'is not set', between: 'between' };

export function whereWords(where = {}) {
  return Object.entries(where ?? {}).map(([k, v]) => {
    if (v === true) return k === 'byRole' ? '' : k;
    if (v === false) return `not ${k}`;
    if (k === 'byRole') return `by the ${v}`;
    if (k === 'hoursBefore') return `${v} hours before`;
    // Payload values are ids ("atRisk", "noShow"): read them as words.
    const said = typeof v === 'string' ? v.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() : Array.isArray(v) ? v.join(' or ') : v;
    return `${k} ${said}`;
  }).filter(Boolean).join(', ');
}

/** "Days quiet ≥ 5 and Tags has VIP". */
export function rulesWords(rules, cat) {
  if (!rules?.rules?.length) return '';
  const facts = new Map((cat?.facts ?? []).map(f => [f.id, f]));
  const tags = new Map((cat?.lookups?.tags ?? []).map(t => [t.value, t.label]));
  const val = (f, v) => {
    if (Array.isArray(v)) return v.map(x => val(f, x)).join(', ');
    if (f?.type === 'tags') return tags.get(v) ?? v;
    if (f?.type === 'enum') return f.options?.find(o => o.value === v)?.label ?? v;
    if (f?.type === 'bool') return v ? 'yes' : 'no';
    if (f?.type === 'money' && typeof v === 'number') return `£${(v / 100).toFixed(0)}`;
    return v;
  };
  const one = r => {
    if (r.rules) return `(${r.rules.map(one).join(r.match === 'any' ? ' or ' : ' and ')})`;
    const f = facts.get(r.fact);
    const v = r.op === 'between' && Array.isArray(r.value) ? r.value.map(x => val(f, x)).join('–') : val(f, r.value);
    return `${f?.label ?? KNOWN_LABELS[r.fact] ?? r.fact} ${OP_WORD[r.op] ?? r.op}${['isSet', 'isNotSet'].includes(r.op) ? '' : ` ${v ?? '…'}`}`;
  };
  return rules.rules.map(one).join(rules.match === 'any' ? ' or ' : ' and ');
}

/** Labels for ids other parts of the desk provide, so a recipe still reads well before they are merged in. */
export const KNOWN_LABELS = {
  'client.stageChanged': 'A client changed lifecycle stage', 'booking.upcoming': 'A session is coming up', 'booking.noShow': 'A client missed a session',
  'payment.recorded': 'A payment came in', 'package.low': 'A package is running low', 'campaign.enrolled': 'A client joined a campaign',
  'campaign.completed': 'A client finished a campaign', 'onboarding.stalled': 'Onboarding stalled', 'voice.flagged': 'A voice note was flagged',
  'crm.birthdayInDays': 'Days to birthday', 'crm.daysSinceEnded': 'Days since coaching ended', 'billing.packageExpiresDays': 'Days until a package expires',
  'billing.credits': 'Package sessions left', 'task.create': 'Add a task for me', 'offer.issue': 'Send a personal offer code', 'pulse.send': 'Send a pulse survey',
};
export function eventLabel(type, cat) { return cat?.events?.find(e => e.type === type)?.label ?? KNOWN_LABELS[type] ?? type ?? 'something happens'; }
export function actionLabel(id, cat) { return cat?.actions?.find(a => a.id === id)?.label ?? KNOWN_LABELS[id] ?? id; }

export function triggerWords(t, cat) {
  if (!t) return 'Choose a trigger';
  if (t.type === 'event') {
    if (!t.event) return 'When something happens';
    const w = whereWords(t.where);
    return `When ${lower(eventLabel(t.event, cat))}${w ? ` (${w})` : ''}`;
  }
  if (t.type === 'schedule') {
    const d = t.days ?? [];
    const days = d.length === 7 ? 'Every day' : d.length === 5 && d.every(x => x <= 5) ? 'Every weekday' : d.length ? `Every ${d.map(x => DAY_NAMES[x - 1]).join(' and ')}` : 'On no days yet';
    let who = 'for everyone';
    if (t.audience?.segmentId) who = `for everyone in ${cat?.lookups?.segments?.find(s => s.value === t.audience.segmentId)?.label ?? 'a segment'}`;
    else if (t.audience?.tagIds?.length) who = `for everyone tagged ${t.audience.tagIds.map(id => cat?.lookups?.tags?.find(x => x.value === id)?.label ?? 'a tag').join(' or ')}`;
    return `${days} at ${t.at || '08:00'}, ${who}`;
  }
  if (t.type === 'enters') return `When a client starts to match: ${rulesWords(t.rules, cat) || '…'}`;
  return 'When you add someone';
}

export function waitWords(s) {
  const parts = [];
  if (s.days) parts.push(plural(s.days, 'day'));
  if (s.hours) parts.push(plural(s.hours, 'hour'));
  if (!parts.length) return s.at ? `Wait until ${s.at}` : 'Carry straight on';
  return `Wait ${parts.join(' and ')}${s.at ? `, then at ${s.at}` : ''}`;
}

const lookupLabel = (cat, kind, id) => cat?.lookups?.[kind]?.find(x => x.value === id)?.label ?? '';

/** The step's sentence and, separately, its quoted detail (for the canvas). */
export function stepParts(s, cat) {
  if (s.type === 'wait') return { title: waitWords(s), detail: '' };
  const p = s.params ?? {};
  let detail = '';
  if (s.action === 'message.send') detail = p.text ?? '';
  else if (s.action === 'coach.notify' || s.action === 'task.create') detail = [p.title, p.body].filter(Boolean).join(' · ');
  else if (s.action === 'ai.draft') detail = p.note ?? '';
  else {
    const spec = cat?.actions?.find(a => a.id === s.action);
    for (const ps of spec?.params ?? []) {
      const kind = { tag: 'tags', form: 'forms', program: 'programs', segment: 'segments', campaign: 'campaigns', package: 'packages', discount: 'discounts' }[ps.type];
      if (kind && p[ps.key]) { detail = lookupLabel(cat, kind, p[ps.key]); break; }
    }
  }
  return { title: actionLabel(s.action, cat), detail };
}

export function stepWords(s, cat) {
  const { title, detail } = stepParts(s, cat);
  const quoted = detail && ['message.send', 'coach.notify', 'task.create'].includes(s.action) ? `“${clip(detail)}”` : detail;
  return `${title}${quoted ? `: ${quoted}` : ''}${s.if?.rules?.length ? ` (only if ${rulesWords(s.if, cat)})` : ''}`;
}

export function sentence(a, cat) {
  const steps = (a.steps ?? []).map(s => lower(stepWords(s, cat)));
  const cond = a.conditions?.rules?.length ? `, if ${rulesWords(a.conditions, cat)}` : '';
  return `${triggerWords(a.trigger, cat)}${cond}${steps.length ? `: ${steps.join(', then ')}` : ': nothing yet'}.`;
}

/** What a step still needs before it can go live ("Choose a form"), or null. */
export function stepProblem(s, cat) {
  if (s.type === 'wait') return s.days || s.hours || s.at ? null : 'Set how long to wait';
  const spec = cat?.actions?.find(a => a.id === s.action);
  if (!spec) return 'Not available yet';
  for (const p of spec.params ?? []) {
    const v = s.params?.[p.key];
    if (p.required && (v === undefined || v === null || v === '')) return `${p.type === 'template' || p.type === 'text' || p.type === 'longtext' ? 'Write' : 'Choose'} ${lower(p.label)}`;
  }
  return null;
}

/** Does anything in this automation come from an AI judgement? */
export function usesAi(a, cat) {
  const aiEvents = new Set((cat?.events ?? []).filter(e => e.aiDerived).map(e => e.type));
  const aiFacts = new Set((cat?.facts ?? []).filter(f => f.aiDerived).map(f => f.id));
  const factsIn = r => (!r ? [] : Array.isArray(r.rules) ? r.rules.flatMap(factsIn) : r.fact ? [r.fact] : []);
  if (a.trigger?.type === 'event' && aiEvents.has(a.trigger.event)) return true;
  return [a.trigger?.rules, a.conditions, ...(a.steps ?? []).map(s => s.if)].some(r => factsIn(r).some(f => aiFacts.has(f)));
}

// MARK: - The little flow on cards: trigger ● wait ● step

/** A compact, decorative picture of the flow: trigger glyph, then each step joined by a line. */
export function miniFlow(a, { max = 7 } = {}) {
  const steps = a.steps ?? [];
  const shown = steps.slice(0, max);
  const parts = [h('span', { class: 'au-mf-node au-mf-trigger', title: 'Trigger' }, icon(triggerIcon(a.trigger), 15))];
  for (const s of shown) {
    parts.push(h('span', { class: 'au-mf-line' }));
    if (s.type === 'wait') {
      const t = s.days ? `${s.days}d` : s.hours ? `${s.hours}h` : s.at || '·';
      parts.push(h('span', { class: 'au-mf-wait', title: waitWords(s) }, t));
    } else parts.push(h('span', { class: 'au-mf-node', title: s.action }, icon(actionIcon(s.action), 15)));
  }
  if (steps.length > max) parts.push(h('span', { class: 'au-mf-line' }), h('span', { class: 'au-mf-more' }, `+${steps.length - max}`));
  parts.push(h('span', { class: 'au-mf-line au-mf-tail' }), h('span', { class: 'au-mf-end', 'aria-hidden': 'true' }));
  return h('div', { class: 'au-mf', 'aria-hidden': 'true' }, parts);
}

/** "3 min ago", "Tue 4 Nov" for run times. */
export function ago(iso) {
  if (!iso) return 'Never';
  const ms = Date.now() - Date.parse(iso);
  if (ms < 0) {
    const m = Math.round(-ms / 60_000);
    return m < 60 ? `in ${m} min` : m < 48 * 60 ? `in ${Math.round(m / 60)} h` : `in ${Math.round(m / 1440)} days`;
  }
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

/** Text with its `{variables}` drawn as small accent chips (all through text nodes). */
export function withVars(text) {
  const out = [];
  let last = 0;
  for (const m of String(text ?? '').matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h('span', { class: 'au-v' }, m[1]));
    last = m.index + m[0].length;
  }
  if (last < String(text ?? '').length) out.push(String(text).slice(last));
  return out;
}
