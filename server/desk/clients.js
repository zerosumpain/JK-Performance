/*
 * Clients (docs/design/desk-v2.md F5, WP2): the clients list (a sortable
 * table with stage and pinned-segment views, health rings, onboarding
 * progress and bulk actions) and the Client 360: a hero with the stage menu,
 * plan, tags, the health ring and its factors, money and state chips and every
 * registered client action, over the client tabs. The Overview is overview.js;
 * Timeline and Notes register from f-crm.js. The built-in studio tabs (Plan,
 * Letters, Sessions, Progress, Health) live below.
 *
 * Registry hosts: tabs are registerClientTab entries (the six built-in ones
 * register here), the hero draws registerClientAction buttons (five, then
 * More), and the list feeds registerBulkAction items to the table's bulk bar.
 */
import {
  COLOR, DAYS, MONTHS, addDays, api, apiBlob, avatar, busy, button, capabilities, card, chip, clientById, clients, confirmBox, dot,
  emptyCard, errorLine, eyebrow, field, fill, firstName, fmtRelative, fmtShort, fmtTime, fmtWeekday, go, h, icon, link, loading, londonParts,
  mondayOf, parseDay, q, route, segmented, setHashQuery, sheet, svgEl, switchRow, toast, todayLondon,
  planName, plans, registerClientAction, registerClientTab, registered, setCrumbs,
} from './core.js';
import { dataTable, menu, pageHead, popover, scoreRing, skeleton, slideOver, tagChip, tagPicker, timeline } from './ui.js';
import {
  BAND, EXIT, STAGE, allTags, bandOf, changed as crmChanged, crmClients, dropTags, healthRing, openEnd, openPause, resume, stagePill, trendChip, withScorePopover,
} from './f-crm.js';
import { overviewTab, statusPills } from './overview.js';
import { lettersSection } from './letters.js';

// MARK: - Formatting (the iPhone app's Fmt)

const enc = encodeURIComponent;
const fmtN = (v, digits = 1) => (v === null || v === undefined ? '–' : Number(v).toLocaleString('en-GB', { maximumFractionDigits: digits }));
const pad2 = n => String(n).padStart(2, '0');
/** "8h 06m" */
const fmtHM = m => { const t = Math.round(m); return `${Math.floor(t / 60)}h ${pad2(t % 60)}m`; };
/** "32 min", or "1h 05m" from an hour. */
const fmtDuration = m => { const t = Math.round(m); return t < 60 ? `${t} min` : `${Math.floor(t / 60)}h ${pad2(t % 60)}m`; };
/** "+1.2", "−0.8" */
const fmtDelta = v => (v < 0 ? `−${fmtN(-v)}` : v > 0 ? `+${fmtN(v)}` : fmtN(v));
/** "Mon" for a YYYY-MM-DD day. */
const weekdayOf = s => DAYS[parseDay(s).getUTCDay()];
/** "Monday 3 Nov" for an instant, in London. */
const longDayOf = iso => { const d = londonParts(iso).day; return `${fmtWeekday(d)} ${fmtShort(d)}`; };
/** "Aug 2026" */
const monthYear = s => { const d = parseDay(s); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
// MARK: - Small pieces

const iconTile = node => h('span', { class: 'cl-tile' }, node);

/** A stat tile with a label over a value, and an optional small line under it (the iPhone's StatTile). */
const tile = (label, value, deltaText) => h('div', { class: 'cl-stat' },
  h('div', { class: 'k' }, label), h('div', { class: 'v' }, value), deltaText ? h('div', { class: 'd' }, deltaText) : null);

/** A dashed full-width button ("+ Add exercise from the library"). */
const dashed = (text, onclick) => h('button', { class: 'cl-dashed', type: 'button', onclick }, icon('plus', 18), text);

/** "Weekday / day number" block with a title and detail (the iPhone's UpcomingRow). */
function upcomingRow(dayString, title, detail, { chevron = true, onclick = null } = {}) {
  const inner = [
    h('div', { class: 'cl-date' }, h('div', { class: 'wd' }, weekdayOf(dayString).toUpperCase()), h('div', { class: 'dn' }, String(parseDay(dayString).getUTCDate()))),
    h('div', { class: 'grow' }, h('div', { class: 'cl-title' }, title), h('div', { class: 'tiny faint' }, detail)),
    chevron ? icon('chevron', 18) : null,
  ];
  return onclick ? h('button', { class: 'cl-upcoming', type: 'button', onclick }, inner) : h('div', { class: 'cl-upcoming' }, inner);
}

/** The iPhone's Loadable: loading, then content, or an error with Try again. */
async function loadInto(box, view, loader, draw) {
  fill(box, loading());
  try {
    const data = await loader();
    if (!view.fresh() || !box.isConnected) return;
    fill(box);
    draw(data);
  } catch (err) {
    if (!view.fresh()) return;
    fill(box, errorLine(err), button('Try again', () => loadInto(box, view, loader, draw), { small: true }));
  }
}

/** A small drop-down menu under a button (the iPhone's Menu). items: [[label, fn]]. */
function menuButton(label, iconName, items, { disabled = false } = {}) {
  const wrap = h('span', { class: 'cl-menu' });
  const pop = h('div', { class: 'cl-menu-pop', role: 'menu', hidden: true });
  const close = () => { pop.hidden = true; document.removeEventListener('click', outside, true); };
  const outside = e => { if (!wrap.contains(e.target)) close(); };
  const btn = h('button', {
    class: 'btn small', type: 'button', disabled: disabled || !items.length, 'aria-haspopup': 'menu',
    onclick: () => {
      if (!pop.hidden) { close(); return; }
      pop.hidden = false;
      document.addEventListener('click', outside, true);
    },
  }, icon(iconName, 18), label);
  fill(pop, items.map(([text, fn]) => h('button', { type: 'button', role: 'menuitem', onclick: () => { close(); fn(); } }, text)));
  wrap.append(btn, pop);
  return wrap;
}

/** Seven day buttons, a dot under days in `marked` (the iPhone's DayStrip). */
function dayStrip(monday, selected, marked, onpick) {
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(monday, i));
  return h('div', { class: 'cl-strip' }, days.map(d => h('button', {
    type: 'button', class: d === selected ? 'sel' : '', 'aria-pressed': String(d === selected), onclick: () => onpick(d),
  }, h('span', { class: 'wd' }, weekdayOf(d)), h('span', { class: 'dn' }, String(parseDay(d).getUTCDate())),
  h('span', { class: 'mk' + (marked.has(d) ? ' on' : '') }))));
}

/** "‹  Week of 17 Nov  ›" */
const weekNav = (monday, step, { canBack = true } = {}) => h('div', { class: 'cl-weeknav' },
  h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous week', disabled: !canBack, onclick: () => step(-7) }, icon('back', 16)),
  h('span', { class: 'small muted' }, `Week of ${fmtShort(monday)}`),
  h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next week', onclick: () => step(7) }, icon('chevron', 16)));

const checkCircle = on => h('span', { class: 'cl-check' + (on ? ' on' : '') }, on ? icon('check', 18) : null);

// MARK: - Clients list (F5): stage and segment views over one sortable table

const STAGE_ORDER = ['onboarding', 'active', 'atRisk', 'paused', 'churned', 'alumni'];
const COACHING = new Set(['onboarding', 'active', 'atRisk']);

route('/clients', async (el, _params, view) => {
  await plans().catch(() => null); // the coach's plan names
  setCrumbs([{ label: 'Clients', path: '/clients' }]);
  const sub = h('span', null, ' ');
  const kpis = h('div', { class: 'crm-kpis' }, [0, 1, 2, 3].map(() => h('div', { class: 'crm-kpi' }, skeleton('lines', { rows: 2 }))));
  const viewsBar = h('div', { class: 'crm-views', role: 'toolbar', 'aria-label': 'Views' });
  const note = h('div');
  const tableBox = h('div', { class: 'crm-table' }, skeleton('table', { rows: 8 }));
  el.append(
    pageHead({ eyebrow: 'Clients', title: 'Clients', sub, actions: [
      link('/segments', { class: 'btn' }, icon('filter_alt', 18), 'Segments'),
      link('/retention', { class: 'btn' }, icon('monitor_heart', 18), 'Retention'),
    ] }),
    kpis, viewsBar, note, tableBox);

  let all, onboarding = new Map(), segments = [];
  try {
    const [list, onb, segs] = await Promise.all([
      crmClients(true),
      api('GET', '/api/onboarding').then(r => r.clients).catch(() => []),
      api('GET', '/api/segments').then(r => r.segments).catch(() => []),
    ]);
    all = list;
    onboarding = new Map(onb.map(o => [o.client.id, o]));
    segments = segs;
  } catch (err) {
    if (view.fresh()) fill(tableBox, errorLine(err), button('Try again', () => go('/clients', { replace: true }), { small: true }));
    return;
  }
  if (!view.fresh()) return;
  clients(true).catch(() => null); // keep the shell's client cache (palette, panels) in step

  // KPIs
  const coaching = all.filter(c => COACHING.has(c.stage));
  const scored = coaching.filter(c => c.health !== null && c.health !== undefined);
  const avg = scored.length ? Math.round(scored.reduce((n, c) => n + c.health, 0) / scored.length) : null;
  const atRisk = all.filter(c => c.stage === 'atRisk').length;
  const stuck = [...onboarding.values()].filter(o => o.stalled).length;
  fill(sub, `${all.length} ${all.length === 1 ? 'person' : 'people'} · ${coaching.length} coaching now${all.some(c => c.stage === 'paused') ? ` · ${all.filter(c => c.stage === 'paused').length} paused` : ''}`);
  const kpi = (label, value, detail, { tone = null, ring = null, path = null } = {}) => {
    const inner = [h('div', { class: 'crm-kpi-k' }, label), h('div', { class: 'crm-kpi-v' }, ring, h('span', { class: `t-num crm-kpi-n${tone ? ` tone-${tone}` : ''}` }, value)), h('div', { class: 'tiny muted' }, detail)];
    return path ? link(path, { class: 'crm-kpi' }, inner) : h('div', { class: 'crm-kpi' }, inner);
  };
  fill(kpis,
    kpi('Coaching now', String(coaching.length), `${all.filter(c => c.stage === 'active').length} active · ${all.filter(c => c.stage === 'onboarding').length} onboarding`),
    kpi('Average health', avg === null ? '–' : String(avg), avg === null ? 'No scores yet' : BAND[bandOf(avg)].word, { ring: avg === null ? null : healthDot(avg) }),
    kpi('At risk', String(atRisk), atRisk ? 'Open the radar' : 'Nobody slipping', { tone: atRisk ? 'urgent' : null, path: '/retention' }),
    kpi('Onboarding', String(onboarding.size), stuck ? `${stuck} stuck` : onboarding.size ? 'All moving' : 'Everyone onboarded', { tone: stuck ? 'attention' : null, path: '/clients?stage=onboarding' }));

  // Views: All, by stage, by pinned segment.
  const q0 = view.query;
  let current = q0.get('segment') ? { type: 'segment', id: q0.get('segment') } : q0.get('stage') && STAGE_ORDER.includes(q0.get('stage')) ? { type: 'stage', id: q0.get('stage') } : { type: 'all' };
  const pinned = segments.filter(s => s.pinned || s.id === current.id);
  const counts = Object.fromEntries(STAGE_ORDER.map(s => [s, all.filter(c => c.stage === s).length]));
  const drawViews = () => {
    const chipBtn = (on, label, n, onclick, extra = null) => h('button', { type: 'button', class: 'crm-view' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick }, extra, label, n === null ? null : h('span', { class: 'crm-view-n t-num' }, String(n)));
    fill(viewsBar,
      chipBtn(current.type === 'all', 'All', all.length, () => pick({ type: 'all' })),
      STAGE_ORDER.filter(s => counts[s] || current.id === s).map(s => chipBtn(current.type === 'stage' && current.id === s, STAGE[s].word, counts[s], () => pick({ type: 'stage', id: s }), h('span', { class: `dot bg-${STAGE[s].tone}`, 'aria-hidden': 'true' }))),
      pinned.length ? h('span', { class: 'crm-views-sep', 'aria-hidden': 'true' }) : null,
      pinned.map(s => chipBtn(current.type === 'segment' && current.id === s.id, s.name, s.count, () => pick({ type: 'segment', id: s.id }), icon('star', 14, { filled: true }))),
      link('/segments', { class: 'crm-view ghost' }, icon('add', 14), 'Segment'));
  };
  const pick = async v => {
    current = v;
    setHashQuery({ stage: v.type === 'stage' ? v.id : null, segment: v.type === 'segment' ? v.id : null });
    drawViews();
    await applyView();
  };

  const bulk = registered.bulkActions('clients');
  const hasBalance = all.some(c => c.balancePence !== undefined);
  const columns = [
    { key: 'name', label: 'Client', sort: true, render: c => h('span', { class: 'crm-cell-who' }, avatar(c.initials || c.name, 34),
      h('span', { class: 'crm-cell-name' }, h('span', { class: 'strong clamp1' }, c.name, c.unread ? h('span', { class: 'crm-unread', title: `${c.unread} unread`, 'aria-label': `${c.unread} unread` }) : null),
        h('span', { class: 'tiny muted clamp1' }, c.since ? `Since ${MONTHS[Number(c.since.slice(5, 7)) - 1]} ${c.since.slice(0, 4)}` : ''))) },
    { key: 'stage', label: 'Stage', sort: c => STAGE_ORDER.indexOf(c.stage), render: c => stagePill(c.stage, { manual: c.manual, small: true }) },
    { key: 'health', label: 'Health', sort: c => c.health ?? 1000, render: c => h('span', { class: 'crm-cell-health' }, healthRingSmall(c.health, c.band), trendChip(c.trend)) },
    { key: 'onboarding', label: 'Onboarding', sort: c => onboarding.get(c.id)?.pct ?? 101, render: c => {
      const o = onboarding.get(c.id);
      if (!o) return null;
      return h('span', { class: 'crm-onb' + (o.stalled ? ' stuck' : '') }, h('span', { class: 'crm-onb-bar' }, h('span', { style: { '--pct': `${o.pct}%` } })), h('span', { class: 't-num tiny' }, `${o.done}/${o.total}`));
    } },
    { key: 'planName', label: 'Plan', sort: c => ['none', 'foundation', 'performance', 'elite'].indexOf(c.plan) },
    { key: 'lastActiveAt', label: 'Last active', sort: c => c.lastActiveAt ?? '', render: c => h('span', { class: 'small' + (c.daysQuiet >= 7 ? ' tone-attention' : ' muted') }, c.lastActiveAt ? fmtRelative(c.lastActiveAt) : '—') },
    { key: 'nextSessionAt', label: 'Next session', sort: c => c.nextSessionAt ?? '9', render: c => h('span', { class: 'small' }, c.nextSessionAt ? `${DAYS[parseDay(londonParts(c.nextSessionAt).day).getUTCDay()]} ${fmtShort(londonParts(c.nextSessionAt).day)} · ${fmtTime(c.nextSessionAt)}` : h('span', { class: 'muted' }, '—')) },
    hasBalance ? { key: 'balancePence', label: 'Balance', align: 'right', sort: c => c.balancePence ?? 0, render: c => h('span', { class: 't-num small' + (c.balancePence > 0 ? ' tone-attention' : ' muted') }, c.balancePence ? `£${(c.balancePence / 100).toFixed(2)}` : '—') } : null,
    { key: 'tags', label: 'Tags', render: c => h('span', { class: 'crm-cell-tags', title: c.tags.map(t => t.name).join(', ') || null },
      c.tags.slice(0, 1).map(t => tagChip({ ...t, name: t.name.length > 14 ? `${t.name.slice(0, 13)}…` : t.name })), c.tags.length > 1 ? h('span', { class: 'tiny muted' }, `+${c.tags.length - 1}`) : null) },
  ].filter(Boolean);
  const table = dataTable({
    columns, rows: [], selectable: bulk.length > 0, label: 'Clients', initialSort: { key: 'health', dir: 1 },
    bulkActions: bulk.map(a => ({ label: a.label, icon: a.icon, run: rows => a.run(rows.map(r => r.id)) })),
    onRow: c => go(`/clients/${enc(c.id)}`),
    empty: 'Nobody in this view.',
  });
  table.el.classList.add('crm-dt');
  fill(tableBox, table.el);

  async function applyView() {
    fill(note);
    if (current.type === 'all') return table.setRows(all.filter(c => c.stage !== 'churned' && c.stage !== 'alumni').concat(all.filter(c => c.stage === 'churned' || c.stage === 'alumni')));
    if (current.type === 'stage') return table.setRows(all.filter(c => c.stage === current.id));
    try {
      const r = await api('POST', '/api/segments/preview', { audience: { segmentId: current.id } });
      const ids = new Set(r.clients.map(c => c.id));
      table.setRows(all.filter(c => ids.has(c.id)));
      if (r.count > r.clients.length) fill(note, h('p', { class: 'small muted' }, `Showing the first ${r.clients.length} of ${r.count}.`));
    } catch (err) { fill(note, errorLine(err)); table.setRows([]); }
  }
  drawViews();
  await applyView();
});

/** A small ring for table rows (no band word). */
function healthRingSmall(health, band) {
  if (health === null || health === undefined) return h('span', { class: 'muted small' }, '—');
  const r = scoreRing(health, { size: 32, label: 'Health', band: { word: BAND[band]?.word ?? '', tone: BAND[band]?.tone ?? 'data' } });
  r.classList.add('crm-ring-s');
  return r;
}
const healthDot = v => healthRingSmall(v, bandOf(v));

// MARK: - One client (F5: Client 360)

// The six existing tabs; packages add theirs with registerClientTab({key, label, order, render}).
// render(box, {client, detail, view}) also gets {ctx, anchor} here, which the built-in tabs use.
for (const [key, label, order, draw] of [
  ['overview', 'Overview', 10, (box, { ctx, openLetter }) => overviewTab(box, ctx, { openLetter })],
  ['plan', 'Plan', 30, (box, { ctx, anchor }) => planTab(box, ctx, { anchor })],
  ['letters', 'Letters', 40, (box, { ctx, anchor }) => lettersTab(box, ctx, { anchor })],
  ['sessions', 'Sessions', 50, (box, { ctx, anchor }) => sessionsTab(box, ctx, { anchor })],
  ['progress', 'Progress', 60, (box, { ctx, anchor }) => progressTab(box, ctx, { anchor })],
  ['health', 'Health', 70, (box, { ctx, anchor }) => healthTab(box, ctx, { anchor })],
]) registerClientTab({ key, label, order, render: draw }, { fallback: true });
/** Old and deep-link names: Feedback became Letters, Habits moved into the Overview. */
const ALIASES = { feedback: 'letters', habits: 'overview', letter: 'overview', checkins: 'letters', forms: 'letters', autoflows: 'letters' };
/** Sections of the Letters tab other screens may link to: #/clients/<id>/forms scrolls there. */
const LETTERS_SECTIONS = ['checkins', 'forms', 'autoflows'];
const details = new Map(); // client id → last GET /api/coach/clients/:id, so switching tabs doesn't flash

// Book is a client action that lives here, beside the booking sheet it opens.
registerClientAction({ id: 'book', label: 'Book', icon: 'event_available', order: 20, run: c => bookSessionSheet({ id: c.id, name: c.name, first: () => firstName(c.name) }).then(done => { if (done) crmChanged(c.id); }) });

route('/clients/:id/:tab?', async (el, params, view) => {
  plans().catch(() => null);
  const id = params.id;
  const anchor = LETTERS_SECTIONS.includes(params.tab) ? params.tab : null;
  const tabList = registered.clientTabs();
  const tab = tabList.some(t => t.key === params.tab) ? params.tab : ALIASES[params.tab] ?? 'overview';
  const summary = clientById(id);
  const head = h('div', { class: 'crm-hero-wrap' });
  const body = h('div', { class: 'cl-tab' });
  const ctx = { id, view, name: summary?.name || details.get(id)?.client.name || 'Client', planName: planName(summary?.plan) };
  ctx.first = () => firstName(ctx.name);
  ctx.exercisePicker = exercisePicker;
  ctx.assignProgram = () => assignProgramSheet({ client: { id, name: ctx.name } });
  ctx.sendForm = () => sendFormSheet(ctx);

  const extra = { crm: null, life: null, facts: null, outreach: null, consent: null };
  const drawHead = (detail, error) => {
    const c = detail?.client;
    if (c) { ctx.name = c.name; ctx.planName = planName(c.plan); }
    const who = { id, name: ctx.name, ...(summary || {}), ...(c || {}), ...(extra.crm || {}) };
    setCrumbs([{ label: 'Clients', path: '/clients' }, { label: ctx.name, path: `/clients/${enc(id)}` }, ...(tab === 'overview' ? [] : [{ label: tabList.find(t => t.key === tab)?.label || tab }])]);
    fill(head,
      clientHero({ id, who, detail, extra, ctx, reload: reloadExtra }),
      error ? errorLine(error) : null,
      h('nav', { class: 'ui-tabs crm-tabs', 'aria-label': 'Client' }, tabList.map(t =>
        link(`/clients/${enc(id)}/${t.key}`, { class: 'ui-tab' + (t.key === tab ? ' sel' : ''), 'aria-current': t.key === tab ? 'page' : null }, t.label))));
  };
  drawHead(details.get(id) || null);
  el.append(head, body);

  // The header loads beside the tab; the Overview shares the same request.
  let pending = null;
  ctx.reloadDetail = () => {
    pending = api('GET', `/api/coach/clients/${enc(id)}`).then(d => {
      details.set(id, d);
      if (view.fresh()) drawHead(d);
      return d;
    });
    pending.catch(err => { if (view.fresh()) drawHead(details.get(id) || null, err); });
    return pending;
  };
  ctx.detail = () => pending;
  ctx.reloadDetail();
  // The CRM side of the header (stage, score, tags, money, consent, outreach), each part optional.
  async function reloadExtra() {
    const caps = await capabilities();
    const has = name => caps.features.includes(name);
    const [list, life, facts, outreach, consent] = await Promise.all([
      crmClients(true).catch(() => []),
      api('GET', `/api/coach/clients/${enc(id)}/lifecycle`).catch(() => null),
      api('GET', `/api/facts/clients/${enc(id)}`).then(r => r.facts).catch(() => null),
      api('GET', `/api/coach/clients/${enc(id)}/outreach`).then(r => r.outreach).catch(() => null),
      has('voice') ? api('GET', `/api/coach/clients/${enc(id)}/ai-consent`).catch(() => null) : null,
    ]);
    Object.assign(extra, { crm: list.find(x => x.id === id) ?? null, life, facts, outreach, consent });
    if (view.fresh()) drawHead(details.get(id) || null);
  }
  reloadExtra();
  const onChanged = e => { if ((!e.detail?.clientId || e.detail.clientId === id) && view.fresh()) { reloadExtra(); if (tab === 'overview') ctx.reloadDetail(); } };
  window.addEventListener('crm:changed', onChanged);
  view.onLeave(() => window.removeEventListener('crm:changed', onChanged));

  const entry = tabList.find(t => t.key === tab);
  const client = { id, name: ctx.name, ...(summary || {}) };
  // Built-in tabs load their own data beside the header; a package's tab gets the detail once it is in.
  const builtIn = ['overview', 'plan', 'letters', 'sessions', 'progress', 'health'].includes(tab);
  const detail = details.get(id) || (builtIn ? null : await ctx.detail()?.catch(() => null));
  if (!view.fresh()) return;
  await entry.render(body, { client: { ...client, ...(detail?.client || {}) }, detail, view, ctx, anchor, openLetter: params.tab === 'letter' });
});

const MAIN_ACTIONS = 5; // shown as buttons; the rest go under More

/** The Client 360 hero: who, stage, plan, tags, the health ring, money and state chips, then the actions. */
function clientHero({ id, who, detail, extra, ctx, reload }) {
  const crm = extra.crm, life = extra.life, facts = extra.facts || {};
  const stage = life?.stage ?? crm?.stage ?? null;
  const first = firstName(who.name);
  // Stage pill: a menu to set, clear or end.
  const stageBtn = stage ? h('button', { type: 'button', class: 'crm-stage-btn', 'aria-haspopup': 'menu', 'aria-label': `Stage: ${STAGE[stage].word}. Change`,
    onclick: e => stageMenu(e.currentTarget, who, life, reload) }, stagePill(stage, { manual: life?.manual }), icon('expand_more', 16)) : null;
  const tagsBox = h('div', { class: 'crm-hero-tags' });
  if (crm) {
    allTags().then(all => fill(tagsBox, tagPicker({ selected: crm.tags.map(t => t.id), all, allowCreate: true, onChange: async ids => {
      try { await api('PUT', `/api/coach/clients/${enc(id)}/tags`, { tagIds: ids }); dropTags(); crmChanged(id); } catch (err) { toast(err.message, { error: true }); }
    } }))).catch(() => fill(tagsBox, crm.tags.map(t => tagChip(t))));
  }
  // Ring with its factor popover.
  const ringBox = crm && crm.health !== null ? withScorePopover(h('div', { class: 'crm-hero-ring', role: 'button', 'aria-label': `Health ${crm.health}, ${BAND[crm.band]?.word}. Show why` },
    healthRing(crm.health, crm.band, { size: 84 }), trendChip(crm.trend)), () => api('GET', `/api/coach/clients/${enc(id)}/score`)) : null;
  // Stat chips from facts, when those features are here.
  const money = p => `£${(p / 100).toLocaleString('en-GB', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const stat = (label, value, tone = null) => h('div', { class: 'crm-stat' }, h('div', { class: 'crm-stat-k' }, label), h('div', { class: `crm-stat-v t-num${tone ? ` tone-${tone}` : ''}` }, value));
  const nb = detail?.nextBooking;
  const stats = [
    'billing.balance' in facts ? stat('Balance', facts['billing.balance'] ? money(facts['billing.balance']) : '£0', facts['billing.balance'] > 0 ? 'attention' : null) : null,
    'billing.credits' in facts && facts['billing.credits'] !== null ? stat('Credits left', String(facts['billing.credits'])) : null,
    'billing.ltv' in facts && facts['billing.ltv'] !== null ? stat('Lifetime value', money(facts['billing.ltv'])) : null,
    stat('Next session', nb ? `${fmtShort(londonParts(nb.start).day)} · ${fmtTime(nb.start)}` : crm?.nextSessionAt ? `${fmtShort(londonParts(crm.nextSessionAt).day)} · ${fmtTime(crm.nextSessionAt)}` : 'None booked'),
    facts['campaign.name'] ? stat('Campaign', String(facts['campaign.name'])) : null,
    stat('Last active', crm?.lastActiveAt ? fmtRelative(crm.lastActiveAt) : '—', crm?.daysQuiet >= 7 ? 'attention' : null),
    stat('With you since', who.since ? `${MONTHS[Number(String(who.since).slice(5, 7)) - 1]} ${String(who.since).slice(0, 4)}` : '—'),
  ];
  // State chips: AI consent (WP6), outreach, pause, birthday.
  const o = extra.outreach;
  const outreachChip = o ? h('button', { type: 'button', class: 'crm-state' + (o.paused || o.noBroadcasts ? ' warn' : ''), 'aria-haspopup': 'dialog',
    onclick: e => outreachPopover(e.currentTarget, id, o, reload) }, icon(o.paused ? 'block' : 'campaign', 14), o.paused ? 'Outreach paused' : o.noBroadcasts ? 'No broadcasts' : 'Outreach on') : null;
  const consent = extra.consent;
  const consentChip = consent ? h('span', { class: 'crm-state' + (consent.voice === 'on' ? ' ok' : '') }, icon('graphic_eq', 14), `Voice AI: ${consent.voice === 'on' ? 'allowed' : consent.voice === 'off' ? 'declined' : 'not asked'}`) : null;
  const pauseChip = life?.stage === 'paused' && life.pausedUntil ? h('span', { class: 'crm-state warn' }, icon('pause_circle', 14), `Back ${fmtShort(life.pausedUntil)}`) : null;
  const endedChip = life?.endedAt && ['churned', 'alumni'].includes(life.stage) ? h('span', { class: 'crm-state' }, icon('logout', 14), `Ended ${fmtShort(londonParts(life.endedAt).day)} · ${EXIT[life.exitReason] ?? ''}`) : null;
  const bday = life ? h('button', { type: 'button', class: 'crm-state', onclick: e => birthdayPopover(e.currentTarget, id, life.birthday, reload) }, icon('cake', 14),
    life.birthday ? `Birthday ${Number(life.birthday.slice(3))} ${MONTHS[Number(life.birthday.slice(0, 2)) - 1]}` : 'Add birthday') : null;
  // Actions: the first few as buttons, the rest under More.
  const acts = registered.clientActions();
  const shown = acts.slice(0, MAIN_ACTIONS), rest = acts.slice(MAIN_ACTIONS);
  const actBtn = (a, i) => h('button', { type: 'button', class: 'btn' + (i === 0 ? ' primary' : ''), 'data-action': a.id, onclick: () => a.run(who) }, a.icon ? icon(a.icon, 18) : null, a.label);
  return h('section', { class: 'crm-hero' + (stage ? ` stage-${stage}` : '') },
    h('div', { class: 'crm-hero-top' },
      h('div', { class: 'crm-hero-id' },
        avatar(who.initials || who.name, 72),
        h('div', { class: 'crm-hero-text' },
          h('div', { class: 'ui-eyebrow' }, link('/clients', null, 'Clients')),
          h('h1', { class: 'crm-hero-name' }, who.name || 'Client'),
          h('div', { class: 'crm-hero-pills' }, stageBtn, h('span', { class: 'pill crm-plan' }, icon('workspace_premium', 14), planName(who.plan)), detail ? statusPills(detail) : null))),
      ringBox),
    h('div', { class: 'crm-hero-tagrow' }, tagsBox),
    h('div', { class: 'crm-stats' }, stats),
    h('div', { class: 'crm-hero-states' }, consentChip, outreachChip, pauseChip, endedChip, bday),
    h('div', { class: 'crm-hero-actions' }, shown.map(actBtn),
      rest.length ? h('button', { type: 'button', class: 'btn', 'aria-haspopup': 'menu', onclick: e => menu(e.currentTarget, rest.map(a => ({ label: a.label, icon: a.icon, onclick: () => a.run(who) })), { label: `More for ${first}` }) }, icon('more_horiz', 18), 'More') : null));
}

/** The stage pill's menu: set a stage, clear the override, pause or resume, end, history. */
function stageMenu(anchor, who, life, reload) {
  const set = async stage => {
    try { await api('PUT', `/api/coach/clients/${enc(who.id)}/lifecycle`, { stage }); toast(`${firstName(who.name)} is now ${STAGE[stage].word}.`); crmChanged(who.id); } catch (err) { toast(err.message, { error: true }); }
  };
  const ended = ['churned', 'alumni'].includes(life?.stage);
  menu(anchor, [
    ...(ended ? [{ label: 'Restart coaching', icon: 'play_arrow', onclick: () => set('active') }] : ['active', 'onboarding', 'atRisk'].filter(s => s !== life?.stage).map(s => ({ label: `Set ${STAGE[s].word}`, icon: STAGE[s].icon, onclick: () => set(s) }))),
    life?.stage !== 'alumni' ? { label: 'Set Alumni', icon: 'workspace_premium', onclick: () => set('alumni') } : null,
    life?.manual ? { label: 'Clear my override', detail: 'Let the rules decide', icon: 'undo', onclick: async () => { await api('PUT', `/api/coach/clients/${enc(who.id)}/lifecycle`, { manual: false }); crmChanged(who.id); } } : null,
    'sep',
    life?.stage === 'paused' ? { label: 'Resume now', icon: 'play_arrow', onclick: () => resume(who) } : !ended ? { label: 'Pause…', icon: 'pause_circle', onclick: () => openPause(who) } : null,
    !ended ? { label: 'End coaching…', icon: 'logout', danger: true, onclick: () => openEnd(who) } : null,
    { label: 'History', icon: 'timeline', onclick: () => slideOver(`${firstName(who.name)} · lifecycle`, body => {
      body.append(timeline((life?.history ?? []).map(x => ({ at: x.at, icon: STAGE[x.stage]?.icon, tone: STAGE[x.stage]?.tone === 'accent' ? 'ok' : STAGE[x.stage]?.tone, title: STAGE[x.stage]?.word ?? x.stage, detail: x.reason }))));
    }) },
  ], { label: 'Stage' });
}

function outreachPopover(anchor, id, o, reload) {
  popover(anchor, box => {
    const put = async patch => {
      try { await api('PUT', `/api/coach/clients/${enc(id)}/outreach`, patch); reload(); } catch (err) { toast(err.message, { error: true }); }
    };
    box.append(h('div', { class: 'ui-eyebrow' }, 'Outreach'),
      switchRow('Pause automated messages', o.paused, v => put({ paused: v }), { detail: 'Automations, campaigns and nudges skip them. You can still message.' }),
      switchRow('No broadcasts', o.noBroadcasts, v => put({ noBroadcasts: v }), { detail: 'Left out of segment broadcasts.' }),
      h('p', { class: 'tiny muted m0' }, `${o.sentToday} of ${o.cap} automated messages sent today.`));
  }, { className: 'crm-pop', label: 'Outreach' });
}

function birthdayPopover(anchor, id, current, reload) {
  popover(anchor, (box, close) => {
    const month = h('select', { 'aria-label': 'Month' }, MONTHS.map((m, i) => h('option', { value: String(i + 1).padStart(2, '0'), selected: current?.slice(0, 2) === String(i + 1).padStart(2, '0') }, m)));
    const day = h('input', { type: 'number', min: '1', max: '31', value: current ? String(Number(current.slice(3))) : '', 'aria-label': 'Day', class: 'crm-bday-day' });
    const save = async value => {
      try { await api('PUT', `/api/coach/clients/${enc(id)}/lifecycle`, { birthday: value }); close(); reload(); } catch (err) { toast(err.message, { error: true }); }
    };
    box.append(h('div', { class: 'ui-eyebrow' }, 'Birthday (day and month only)'), h('div', { class: 'row gap4' }, day, month),
      h('div', { class: 'row end gap4 mt-s' }, current ? button('Remove', () => save(null), { small: true, kind: 'text' }) : null,
        button('Save', () => { const d = Number(day.value); if (!(d >= 1 && d <= 31)) { toast('Pick a day.', { error: true }); return; } save(`${month.value}-${String(d).padStart(2, '0')}`); }, { small: true, kind: 'primary' })));
  }, { className: 'crm-pop', label: 'Birthday' });
}

/** Send one of the coach's forms to this client. */
function sendFormSheet(ctx) {
  return sheet(`Send a form to ${ctx.first()}`, (body, close) => {
    const list = h('div', null, loading());
    const status = h('div');
    body.append(list, status);
    api('GET', '/api/forms').then(f => {
      fill(list, f.forms.length ? card({ class: 'flush' }, f.forms.map(form => h('button', {
        class: 'cl-pick', type: 'button',
        onclick: e => busy(e.currentTarget, status, async () => {
          await api('POST', `/api/forms/${enc(form.id)}/send`, { clientId: ctx.id });
          toast(`Sent ${form.name} to ${ctx.first()}.`);
          close(true);
        }),
      }, iconTile(icon('form', 20)), h('div', { class: 'grow' }, h('div', { class: 'strong' }, form.name), form.questions ? h('div', { class: 'small muted' }, `${form.questions.length} questions`) : null), icon('send', 18)))) : emptyCard('form', 'No forms yet.', 'Write one under Programs › Forms.'));
    }, err => fill(list, errorLine(err)));
    return h('div', { class: 'row end' }, button('Close', () => close(false)));
  });
}

// MARK: - Plan tab

function workoutDraft(w) {
  return {
    id: w.id, date: w.date, title: w.title, startsAt: w.startsAt || '', location: w.location || '', notes: w.notes || '',
    items: w.items.slice().sort((a, b) => a.order - b.order).map(i => ({
      id: i.id, exerciseId: i.exercise.id, exerciseName: i.exercise.name, sets: i.sets, reps: i.reps, load: i.load || '', rpe: i.rpe || '', note: i.note || '', tempo: i.tempo || '',
    })),
    published: w.published, editedBy: w.editedBy, editedAt: w.editedAt, completedAt: w.completedAt,
    loggedSets: w.items.reduce((n, i) => n + i.logged.length, 0),
  };
}
const newDraft = date => ({ id: null, date, title: '', startsAt: '', location: '', notes: '', items: [], published: false, editedBy: null, editedAt: null, completedAt: null, loggedSets: 0 });
/** The fields that are saved, to tell a changed draft from the saved one. */
const draftShape = d => JSON.stringify([d.date, d.title, d.startsAt, d.location, d.notes, d.items.map(i => [i.id, i.exerciseId, Number(i.sets), i.reps, i.load, i.rpe, i.note, i.tempo])]);
function workoutInput(d, clientId) {
  return {
    date: d.date, title: d.title.trim(), startsAt: d.startsAt.trim() || null, location: d.location.trim() || null, notes: d.notes,
    items: d.items.map(i => ({
      ...(i.id ? { id: i.id } : {}), exerciseId: i.exerciseId, sets: Number(i.sets), reps: String(i.reps).trim(), load: String(i.load).trim(),
      rpe: String(i.rpe).trim() || null, note: String(i.note).trim() || null, tempo: String(i.tempo ?? '').trim() || null,
    })),
    clientId: d.id ? undefined : clientId,
  };
}

async function planTab(box, ctx) {
  const { id: clientId, view } = ctx;
  let day = todayLondon();
  let week = null; // workouts of the shown week
  let draft = null, saved = null; // the open workout, and its last saved shape
  let notice = null, error = null, working = false;

  const top = h('div', { class: 'spread cl-plan-top' },
    h('span', { class: 'small faint' }, 'Write and publish workouts, or lay down a programme.'),
    button(h('span', { class: 'row gap4' }, icon('programs', 18), 'Assign a programme'), async () => {
      await assignProgramSheet({ client: { id: clientId, name: ctx.name } });
      if (view.fresh()) await loadWeek(); // closed with × after assigning still shows the new drafts
    }, { small: true }));
  const nav = h('div');
  const strip = h('div');
  const content = h('div');
  fill(box, top, nav, strip, content);

  const dayWorkouts = () => (week || []).filter(w => w.date === day);

  const drawNav = () => {
    fill(nav, weekNav(mondayOf(day), n => { day = addDays(day, n); afterDayChange(true); }));
    fill(strip, dayStrip(mondayOf(day), day, new Set((week || []).map(w => w.date)), d => { day = d; afterDayChange(false); }));
  };

  async function afterDayChange(weekMayChange) {
    if (weekMayChange) { week = null; drawNav(); draw(); await loadWeek(); return; }
    drawNav();
    const first = dayWorkouts()[0];
    if (first) await open(first.id); else { draft = null; saved = null; notice = null; draw(); }
  }

  async function loadWeek() {
    const from = mondayOf(day);
    try {
      week = (await api('GET', `/api/workouts?${q({ clientId, from, to: addDays(from, 6) })}`)).workouts;
      error = null;
    } catch (err) {
      error = err;
    }
    if (!view.fresh()) return;
    drawNav();
    const first = dayWorkouts()[0];
    if (week && (!draft || draft.date !== day) && first) await open(first.id);
    else { if (draft && draft.date !== day) { draft = null; saved = null; } draw(); }
  }

  async function refreshWeekQuietly() {
    const from = mondayOf(day);
    try { week = (await api('GET', `/api/workouts?${q({ clientId, from, to: addDays(from, 6) })}`)).workouts; } catch { /* keep the old list */ }
  }

  async function open(id) {
    try {
      const w = await api('GET', `/api/workouts/${enc(id)}`);
      draft = workoutDraft(w);
      saved = draftShape(draft);
      notice = null; error = null;
    } catch (err) {
      error = err;
    }
    if (view.fresh()) { drawNav(); draw(); }
  }

  const valid = d => d.title.trim() !== '' && d.items.length > 0;

  async function save(publish) {
    if (!draft) return;
    working = true; syncButtons();
    try {
      let w;
      if (draftShape(draft) !== saved || !draft.id) {
        const body = workoutInput(draft, clientId);
        w = draft.id ? await api('PUT', `/api/workouts/${enc(draft.id)}`, body) : await api('POST', '/api/workouts', body);
      } else {
        w = await api('GET', `/api/workouts/${enc(draft.id)}`);
      }
      if (publish && !w.published) w = await api('POST', `/api/workouts/${enc(w.id)}/publish`);
      draft = workoutDraft(w);
      saved = draftShape(draft);
      notice = publish ? `Published. ${ctx.name} can see it now.` : w.published ? 'Saved. The client sees the change.' : 'Saved as a draft.';
      error = null;
      await refreshWeekQuietly();
    } catch (err) {
      error = err;
    }
    working = false;
    if (view.fresh()) { drawNav(); draw(); }
  }

  async function remove() {
    if (!draft?.id) return;
    const ok = await confirmBox('Delete this workout?', { ok: 'Delete workout', danger: true, detail: draft.loggedSets ? `${draft.loggedSets} logged sets go with it.` : null });
    if (!ok) return;
    try {
      await api('DELETE', `/api/workouts/${enc(draft.id)}`);
      draft = null; saved = null; notice = null;
      await refreshWeekQuietly();
    } catch (err) {
      error = err;
    }
    if (view.fresh()) { drawNav(); draw(); }
  }

  // Save / Publish follow the draft as it's typed, without redrawing the form.
  let saveBtn = null, publishBtn = null, headTitle = null;
  function syncButtons() {
    if (!draft || !saveBtn) return;
    const same = draftShape(draft) === saved;
    saveBtn.disabled = working || !valid(draft) || same;
    publishBtn.disabled = working || !valid(draft) || (draft.published && same);
    publishBtn.textContent = working ? 'Saving…' : draft.published && same ? 'Published' : `Publish to ${ctx.first()}`;
    if (headTitle) headTitle.textContent = `${fmtWeekday(draft.date)} · ${draft.title.trim() || 'New workout'}`;
  }

  function statusLine(d) {
    const parts = [];
    parts.push(!d.id ? 'Not saved yet' : d.published ? 'Published' : 'Draft · the client can\'t see it');
    if (d.editedAt) parts.push(`last edit by ${d.editedBy === 'coach' ? 'you' : ctx.name} ${fmtRelative(d.editedAt)}`);
    if (d.loggedSets > 0) parts.push(`${d.loggedSets} sets logged`);
    if (d.completedAt) parts.push('completed');
    return parts.join(' · ');
  }

  function textField(label, key, placeholder, attrs = {}) {
    return field(label, h('input', { ...attrs, value: draft[key], placeholder, oninput: e => { draft[key] = e.target.value; syncButtons(); } }));
  }

  function itemsEditor(itemsBox) {
    const d = draft;
    if (!d.items.length) { fill(itemsBox, h('p', { class: 'tiny faint' }, 'No exercises yet.')); return; }
    const redraw = () => { itemsEditor(itemsBox); syncButtons(); };
    fill(itemsBox, d.items.map((it, i) => {
      const input = (label, key, attrs, cls) => h('div', { class: `cl-f ${cls || ''}` }, h('label', null, label),
        h('input', { ...attrs, value: it[key], oninput: e => { it[key] = e.target.value; syncButtons(); } }));
      return h('div', { class: 'cl-item' },
        h('div', { class: 'spread' },
          h('div', { class: 'row gap4' }, h('span', { class: 'strong' }, it.exerciseName || it.exerciseId), it.id ? null : h('span', { class: 'cl-new' }, 'New')),
          h('div', { class: 'row gap4 cl-item-tools' },
            h('button', { class: 'icon-btn cl-sm', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [d.items[i - 1], d.items[i]] = [d.items[i], d.items[i - 1]]; redraw(); } }, icon('up', 16)),
            h('button', { class: 'icon-btn cl-sm', type: 'button', 'aria-label': 'Move down', disabled: i === d.items.length - 1, onclick: () => { [d.items[i + 1], d.items[i]] = [d.items[i], d.items[i + 1]]; redraw(); } }, icon('down', 16)),
            h('button', { class: 'icon-btn cl-sm', type: 'button', 'aria-label': 'Remove', onclick: () => { d.items.splice(i, 1); redraw(); } }, icon('trash', 18)))),
        h('div', { class: 'cl-item-fields' },
          input('Sets', 'sets', { type: 'number', min: '1', max: '20', inputmode: 'numeric' }, 'narrow'),
          input('Reps', 'reps', { placeholder: '10', maxlength: '30' }),
          input('Load', 'load', { placeholder: '60 kg', maxlength: '30' }),
          input('RPE', 'rpe', { placeholder: '7–8', maxlength: '10' }, 'narrow'),
          input('Note', 'note', { placeholder: 'Cue for the client', maxlength: '300' }, 'cl-f-note'),
          input('Tempo', 'tempo', { placeholder: '3-1-1', maxlength: '7', title: 'Down, pause, drive in seconds (3-1-1); optional' }, 'narrow')));
    }));
  }

  function draw() {
    saveBtn = publishBtn = headTitle = null;
    if (error && week === null) {
      fill(content, errorLine(error), button('Try again', () => loadWeek(), { small: true }));
      return;
    }
    if (week === null) { fill(content, loading()); return; }
    const chips = h('div', { class: 'cl-chiprow' },
      dayWorkouts().map(w => h('button', { type: 'button', class: 'cl-chip' + (draft?.id === w.id ? ' on' : ''), onclick: () => open(w.id) },
        w.published ? w.title : `${w.title} · draft`)),
      h('button', { type: 'button', class: 'cl-chip' + (draft && !draft.id ? ' on' : ''), onclick: () => { draft = newDraft(day); saved = null; notice = null; error = null; draw(); } }, '+ New workout'));
    if (!draft) {
      fill(content, chips, dayWorkouts().length ? null
        : emptyCard('calendar', `Nothing planned for ${weekdayOf(day)} ${fmtShort(day)}`, `Use “+ New workout” to write one for ${ctx.name}.`));
      return;
    }
    const d = draft;
    headTitle = h('div', { class: 'strong' });
    const itemsBox = h('div', { class: 'cl-items' });
    saveBtn = button('Save', () => save(false));
    publishBtn = button('Publish', () => save(true), { kind: 'primary' });
    fill(content, chips,
      h('div', { class: 'cl-editor-head' }, headTitle, h('div', { class: 'tiny faint' }, statusLine(d))),
      h('div', { class: 'cl-editor' },
        card({ class: 'cl-editor-fields' },
          textField('Title', 'title', 'Lower Body Strength', { maxlength: '80' }),
          h('div', { class: 'grid2' },
            textField('Starts (HH:mm)', 'startsAt', '11:00', { maxlength: '5', inputmode: 'numeric' }),
            textField('Location', 'location', 'Studio 2', { maxlength: '80' })),
          field('Notes for the client', h('textarea', { value: d.notes, placeholder: 'Optional', maxlength: '1000', rows: '3', oninput: e => { d.notes = e.target.value; syncButtons(); } }))),
        h('div', { class: 'cl-editor-items' },
          eyebrow('Exercises', d.items.length ? String(d.items.length) : null),
          itemsBox,
          dashed('Add exercise from the library', async () => {
            const ex = await exercisePicker();
            if (!ex || draft !== d) return;
            d.items.push({ id: null, exerciseId: ex.id, exerciseName: ex.name, sets: 3, reps: '10', load: '', rpe: '', note: '', tempo: '' });
            itemsEditor(itemsBox);
            syncButtons();
          }))),
      notice ? h('p', { class: 'ok row gap4' }, icon('check', 18), notice) : null,
      error ? errorLine(error) : null,
      h('div', { class: 'row cl-actions' }, saveBtn, publishBtn,
        d.id ? h('button', { class: 'btn danger', type: 'button', onclick: remove }, 'Delete workout') : null));
    itemsEditor(itemsBox);
    syncButtons();
  }

  drawNav();
  draw();
  await loadWeek();
}

/** Pick an exercise from the library (the iPhone's ExercisePickerSheet). Resolves with it, or undefined. */
const CATEGORIES = ['All', 'Legs', 'Push', 'Pull', 'Core', 'Mobility', 'Conditioning'];
function exercisePicker() {
  return sheet('Add exercise', (body, close) => {
    let category = 'All';
    let timer = null, seq = 0;
    const search = h('input', { type: 'search', placeholder: 'Search exercises', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search exercises' });
    const cats = h('div', { class: 'cl-chiprow' });
    const list = h('div');
    const drawCats = () => fill(cats, CATEGORIES.map(c => h('button', { type: 'button', class: 'cl-chip' + (c === category ? ' on' : ''), onclick: () => { category = c; drawCats(); load(0); } }, c)));
    async function load(delay = 250) {
      clearTimeout(timer);
      const mine = ++seq;
      timer = setTimeout(async () => {
        try {
          const { exercises } = await api('GET', `/api/exercises?${q({ q: search.value.trim(), category: category === 'All' ? '' : category })}`);
          if (mine !== seq) return;
          fill(list, exercises.length ? card({ class: 'flush' }, exercises.map(e => h('button', { class: 'cl-pick', type: 'button', onclick: () => close(e) },
            iconTile(icon('dumbbell', 16), 34),
            h('div', { class: 'grow' }, h('div', { class: 'strong' }, e.name), h('div', { class: 'tiny faint' }, `${e.equipment} · ${e.pattern}`)),
            h('span', { class: 'faint' }, icon('plus', 16)))))
            : emptyCard('search', 'No matches'));
        } catch (err) {
          if (mine === seq) fill(list, errorLine(err));
        }
      }, delay);
    }
    search.addEventListener('input', () => load());
    drawCats();
    body.append(h('label', { class: 'cl-search card' }, icon('search', 16), search), cats, list);
    fill(list, loading());
    load(0);
    setTimeout(() => search.focus(), 0);
  });
}

// MARK: - Assign a programme

/**
 * Lay a programme onto a client's calendar as drafts (the iPhone's
 * AssignProgramSheet). Give `client` to choose the programme, or `program` to
 * choose the client. Resolves with the number of workouts created, or
 * undefined when nothing was assigned.
 */
export function assignProgramSheet({ client = null, program = null } = {}) {
  return sheet('Assign programme', (body, close) => {
    let chosen = null, created = null;
    const start = h('input', { type: 'date', value: addDays(todayLondon(), 1), 'aria-label': 'Start date' });
    const listBox = h('div');
    const status = h('div');
    const go = button('Assign', async () => {
      if (created !== null) { close(created); return; }
      if (!chosen || !start.value) return;
      const programId = program ? program.id : chosen;
      const clientId = client ? client.id : chosen;
      await busy(go, status, async () => {
        const out = await api('POST', `/api/programs/${enc(programId)}/assign`, { clientId, startDate: start.value });
        created = out.created;
        fill(status, h('p', { class: 'ok row gap4' }, icon('check', 18), `Created ${created} draft workouts. Publish them from the client's Plan tab.`));
        go.textContent = 'Done';
      });
      go.disabled = false;
    }, { kind: 'primary', disabled: true });
    const pick = id => { chosen = id; go.disabled = created === null && !chosen; draw(); };
    let rows = null;
    const draw = () => {
      if (!rows) return;
      fill(listBox, rows.length ? card({ class: 'flush' }, rows.map(r => h('button', { class: 'cl-pick', type: 'button', 'aria-pressed': String(chosen === r.id), onclick: () => pick(r.id) },
        r.lead, h('div', { class: 'grow' }, h('div', { class: 'strong' }, r.title), r.detail ? h('div', { class: 'tiny faint' }, r.detail) : null), checkCircle(chosen === r.id))))
        : emptyCard(program ? 'people' : 'programs', program ? 'No clients yet' : 'No programmes yet', program ? null : 'Write one under Programs › Programs.'));
    };
    body.append(
      h('h3', { class: 'mb' }, program ? program.name : `For ${client.name}`),
      field('Start date', start),
      eyebrow(program ? 'Client' : 'Programme'),
      listBox, status);
    fill(listBox, loading());
    (program ? api('GET', '/api/coach/clients').then(r => r.clients.slice().sort((a, b) => a.name.localeCompare(b.name))
      .map(c => ({ id: c.id, title: c.name, lead: avatar(c.initials || c.name, 28) })))
      : api('GET', '/api/programs').then(r => r.programs.map(p => ({
        id: p.id, title: p.name, lead: iconTile(icon('programs', 16), 30),
        detail: [p.detail, `${p.weeks} weeks · ${p.daysPerWeek} days a week · ${p.workouts.length} workouts`].filter(Boolean).join(' · '),
      }))))
      .then(r => { rows = r; draw(); }, err => fill(listBox, errorLine(err)));
    return h('div', { class: 'row end' }, button('Cancel', () => close(created ?? undefined)), go);
  });
}

// MARK: - Feedback tab

async function lettersTab(box, ctx, { anchor }) {
  const letters = h('section', { id: 'cl-letters' });
  const checkins = h('section', { id: 'cl-checkins' });
  const automation = h('section', { id: 'cl-automation' });
  // Letters on the left; check-ins (read only: the letter is the reply) and forms and autoflows beside them.
  fill(box, h('div', { class: 'cl-fb' },
    h('div', { class: 'cl-fb-reports' }, h('h2', { class: 'cl-h2' }, 'Letters'), letters),
    h('div', { class: 'cl-fb-checkins' }, h('h2', { class: 'cl-h2' }, 'Check-ins'), checkins),
    h('div', { class: 'cl-fb-auto' }, automation)));
  await Promise.allSettled([lettersSection(letters, ctx), checkinsSection(checkins, ctx), automationSection(automation, ctx)]);
  if (anchor && ctx.view.fresh()) {
    box.querySelector(anchor === 'checkins' ? '.cl-fb-checkins' : anchor === 'forms' ? '#cl-forms' : '#cl-autoflows')?.scrollIntoView({ block: 'start' });
  }
}

/** Weekly check-ins, read only. The reply is the week's letter (the per-check-in reply box is gone). */
async function checkinsSection(box, ctx) {
  await loadInto(box, ctx.view, () => api('GET', `/api/checkins?${q({ clientId: ctx.id })}`), d => {
    const list = d.checkins.slice().sort((a, b) => b.week.localeCompare(a.week));
    if (!list.length) { fill(box, emptyCard('checkIn', 'No check-ins yet.')); return; }
    fill(box, card({ class: 'flush' }, list.map(c => h('div', { class: 'cl-checkin' },
      h('div', { class: 'spread' }, h('span', { class: 'strong' }, `Week of ${fmtShort(c.week)}`),
        h('span', { class: 'small muted row gap4' }, c.reviewedAt ? [icon('check', 16), 'Letter written'] : 'Waiting for the letter')),
      h('div', { class: 'small t-num' }, [`Energy ${c.energy} of 5`, `Sleep ${c.sleep} of 5`, c.stress ? `Stress ${c.stress} of 5` : null].filter(Boolean).join(' · ')),
      c.pain.length ? h('div', { class: 'small row gap4 tone-urgent' }, icon('pain', 16), `Sore: ${c.pain.join(', ')}`) : null,
      c.win ? h('div', { class: 'small' }, h('span', { class: 'muted' }, 'Win: '), c.win) : null,
      c.struggle ? h('div', { class: 'small' }, h('span', { class: 'muted' }, 'Struggle: '), c.struggle) : null,
      c.note ? h('div', { class: 'small' }, h('span', { class: 'muted' }, 'Note: '), c.note) : null,
      c.reply ? h('div', { class: 'small muted row gap4' }, icon('reply', 16), c.reply) : null))));
  });
}

/** Forms sent to this client and the autoflows they're in (the iPhone's ClientAutomationSection). */
async function automationSection(box, ctx) {
  const load = () => Promise.all([
    api('GET', `/api/form-requests?${q({ clientId: ctx.id })}`),
    api('GET', `/api/coach/clients/${enc(ctx.id)}/autoflows`),
    api('GET', '/api/forms'),
    api('GET', '/api/autoflows'),
  ]);
  const again = () => automationSection(box, ctx);
  await loadInto(box, ctx.view, load, ([r, a, f, flows]) => {
    const status = h('div');
    const sendForm = form => busy(null, status, async () => {
      await api('POST', `/api/forms/${enc(form.id)}/send`, { clientId: ctx.id });
      toast(`Sent ${form.name} to ${ctx.first()}.`);
      again();
    });
    const enrol = flow => busy(null, status, async () => {
      await api('POST', `/api/autoflows/${enc(flow.id)}/enrol`, { clientId: ctx.id });
      toast(`${ctx.first()} started ${flow.name}.`);
      again();
    });
    const running = new Set(a.runs.filter(x => !x.stoppedAt).map(x => x.autoflowId));
    fill(box,
      h('div', { class: 'spread cl-sec-head', id: 'cl-forms' }, eyebrow('Forms'),
        menuButton('Send', 'form', f.forms.map(form => [form.name, () => sendForm(form)]))),
      status,
      r.requests.length
        ? card({ class: 'flush' }, r.requests.map(req => formRequestRow(req, () => formResponse(req, ctx).then(changed => { if (changed && ctx.view.fresh()) again(); }))))
        : h('p', { class: 'small faint' }, 'No forms sent yet.'),
      h('div', { class: 'spread cl-sec-head', id: 'cl-autoflows' }, eyebrow('Autoflows'),
        menuButton('Start', 'bolt', flows.autoflows.filter(fl => !running.has(fl.id)).map(fl => [fl.name, () => enrol(fl)]), { disabled: !flows.autoflows.length })),
      a.runs.length ? a.runs.map(run => autoflowRunRow(run, ctx, again)) : h('p', { class: 'small faint' }, 'Not in any autoflow.'));
  });
}

function formRequestRow(r, onclick) {
  const flagged = (r.flagged ?? []).length > 0;
  let line;
  if (r.submittedAt) {
    const yes = flagged ? `Said yes to ${r.flagged.length === 1 ? 'a health question' : 'health questions'} · ` : '';
    line = `${yes}Answered ${fmtRelative(r.submittedAt)}${r.reviewedAt ? ' · read' : ''}`;
  } else {
    line = `Sent ${fmtRelative(r.sentAt)} · not answered yet`;
  }
  return h('button', { class: 'cl-pick', type: 'button', onclick },
    iconTile(icon('form', 16), 30),
    h('div', { class: 'grow' }, h('div', { class: 'strong clamp1' }, r.name),
      h('div', { class: 'tiny', style: { color: flagged && !r.reviewedAt ? COLOR.urgent : 'var(--faint)' } }, line)),
    r.submittedAt && !r.reviewedAt ? dot(flagged ? COLOR.urgent : COLOR.waiting) : null,
    h('span', { class: 'faint' }, icon('chevron', 18)));
}

const answerText = v => (v === undefined || v === null ? '–' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'number' ? `${v} / 5` : String(v));

/** A client's answers, for the coach; opening marks them read (the iPhone's FormResponseView). Resolves true if anything changed. */
function formResponse(start, ctx) {
  return sheet(start.name, (body, close) => {
    let changed = false;
    const draw = r => {
      const flagged = (r.flagged ?? []).length > 0;
      const status = h('div');
      fill(body,
        h('p', { class: 'small faint m0' }, `${r.client?.name ?? 'Client'} · sent ${fmtShort(londonParts(r.sentAt).day)}${r.fromAutoflow ? ' by an autoflow' : ''}`),
        flagged ? card({ class: 'cl-flagged' },
          h('div', { class: 'small strong row gap4', style: { color: COLOR.urgent } }, icon('pain', 16), 'Answered yes to'),
          r.flagged.map(f => h('div', { class: 'small' }, `• ${f}`)),
          h('div', { class: 'tiny faint' }, 'Talk to them before the next hard session.')) : null,
        status,
        !r.submittedAt ? [
          emptyCard('clock', 'Not answered yet', `Sent ${fmtRelative(r.sentAt)}.`),
          h('button', {
            class: 'btn danger', type: 'button', onclick: async () => {
              if (!await confirmBox('Withdraw this form?', { ok: 'Withdraw', danger: true })) return;
              await busy(null, status, async () => { await api('DELETE', `/api/form-requests/${enc(r.id)}`); close(true); });
            },
          }, 'Withdraw form'),
        ] : [
          r.questions.map(qn => {
            const v = r.answers?.[qn.id];
            return card({ class: 'cl-answer' }, h('div', { class: 'tiny faint' }, qn.label),
              h('div', { class: 'strong', style: qn.flag && v === true ? { color: COLOR.urgent } : null }, answerText(v)));
          }),
          r.client ? link(`/messages/${enc(r.client.id)}`, { class: 'btn', onclick: () => close(changed) }, icon('bubble', 18), `Message ${firstName(r.client.name)}`) : null,
        ]);
    };
    draw(start);
    if (start.submittedAt && !start.reviewedAt) {
      api('POST', `/api/form-requests/${enc(start.id)}/review`).then(r => { changed = true; draw(r); }, () => { /* stays unread */ });
    }
    return h('div', { class: 'row end' }, button('Done', () => close(changed)));
  }).then(v => !!v);
}

function autoflowRunRow(run, ctx, onChanged) {
  const status = h('div');
  let detail;
  if (run.stoppedAt) detail = 'Stopped';
  else if (!run.next) detail = 'Finished';
  else detail = `Next ${run.next.date === todayLondon() ? 'today' : fmtShort(run.next.date)}: ${run.next.label}`;
  const fraction = run.steps ? run.stepsDone / run.steps : 0;
  return h('div', { class: 'cl-run' },
    h('div', { class: 'row' },
      iconTile(icon('bolt', 18), 26),
      h('div', { class: 'grow' }, h('div', { class: 'small strong' }, run.autoflowName ?? 'Autoflow'), h('div', { class: 'tiny faint clamp2' }, detail)),
      h('span', { class: 'tiny muted cl-num' }, `${run.stepsDone}/${run.steps}`),
      !run.stoppedAt && run.next ? h('button', {
        class: 'icon-btn cl-sm', type: 'button', 'aria-label': 'Stop', title: 'Stop',
        onclick: async () => {
          const ok = await confirmBox(`Stop this autoflow for ${ctx.name}?`, { ok: 'Stop', danger: true, detail: 'What already happened stays; nothing more is sent.' });
          if (!ok) return;
          await busy(null, status, async () => { await api('DELETE', `/api/autoflows/${enc(run.autoflowId)}/runs/${enc(run.id)}`); onChanged(); });
        },
      }, icon('stop', 18)) : null),
    h('div', { class: 'cl-bar' }, h('div', { style: { width: `${Math.round(fraction * 100)}%` } })),
    status);
}

// MARK: - Health tab

const ACTIVITY_ICON = type => (/(Strength|Functional|Core|Cross)/.test(type) ? 'dumbbell' : /HIIT|cardio/i.test(type) ? 'bolt' : 'heart');
function activityDetail(a) {
  const parts = [fmtDuration(a.minutes)];
  if (a.distanceKm > 0) parts.push(`${fmtN(a.distanceKm)} km`);
  if (a.kcal > 0) parts.push(`${fmtN(a.kcal, 0)} kcal`);
  if (a.avgHr > 0) parts.push(`${fmtN(a.avgHr, 0)} bpm`);
  return parts.join(' · ');
}

async function healthTab(box, ctx) {
  await loadInto(box, ctx.view, () => api('GET', `/api/health/week?${q({ clientId: ctx.id })}`), w => {
    if (!w.shared) {
      fill(box, emptyCard('heart', 'Not shared', `${ctx.first()} hasn't shared Apple Health with you. They can turn it on in Account › Apple Health.`));
      return;
    }
    const cell = v => h('td', null, v);
    fill(box, h('div', { class: 'cl-cols' },
      h('div', null,
        eyebrow('Last 7 days', w.sharedSince ? `Shared since ${fmtShort(londonParts(w.sharedSince).day)}` : null),
        card({ class: 'flush cl-table' }, h('table', null,
          h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Steps'), h('th', null, 'Sleep'), h('th', null, 'RHR'), h('th', null, 'kcal'))),
          h('tbody', null, w.days.slice().reverse().map(d => h('tr', null,
            h('td', { class: 'faint' }, weekdayOf(d.date)),
            cell(d.steps === null ? '–' : fmtN(d.steps, 0)),
            cell(d.sleepMinutes === null ? '–' : fmtHM(d.sleepMinutes)),
            cell(d.restingHr === null ? '–' : fmtN(d.restingHr, 0)),
            cell(d.activeKcal === null ? '–' : fmtN(d.activeKcal, 0)))))))),
      h('div', null,
        eyebrow('Workouts', w.activities.length ? `${w.activities.length} this week` : null),
        w.activities.length
          ? card({ class: 'flush' }, w.activities.map(a => h('div', { class: 'cl-pick static' },
            iconTile(icon(ACTIVITY_ICON(a.type), 16), 32),
            h('div', { class: 'grow' }, h('div', { class: 'strong' }, a.type),
              h('div', { class: 'tiny faint' }, `${weekdayOf(londonParts(a.start).day)} ${fmtShort(londonParts(a.start).day)} · ${fmtTime(a.start)}`)),
            h('span', { class: 'tiny muted cl-right' }, activityDetail(a)))))
          : h('p', { class: 'small faint' }, 'No workouts recorded this week.'))));
  });
}

// MARK: - Sessions tab

const kindLabel = k => (k === 'video' ? 'Video' : k === 'group' ? 'Group' : '1:1');

async function sessionsTab(box, ctx) {
  const reload = () => sessionsTab(box, ctx);
  const today = todayLondon();
  // The server answers at most 62 days at a time: the past month and the next two, asked separately.
  const load = () => Promise.all([
    api('GET', `/api/bookings?${q({ clientId: ctx.id, from: addDays(today, -30), to: today })}`),
    api('GET', `/api/bookings?${q({ clientId: ctx.id, from: addDays(today, 1), to: addDays(today, 60) })}`),
  ]).then(([a, b]) => {
    const seen = new Set();
    return [...a.bookings, ...b.bookings].filter(x => !seen.has(x.id) && seen.add(x.id));
  });
  await loadInto(box, ctx.view, load, list => {
    const now = Date.now();
    const upcoming = list.filter(b => Date.parse(b.end) >= now).sort((x, y) => x.start.localeCompare(y.start));
    const past = list.filter(b => Date.parse(b.end) < now).sort((x, y) => y.start.localeCompare(x.start));
    const row = b => card({ class: 'flush' }, upcomingRow(londonParts(b.start).day, b.title ?? kindLabel(b.kind),
      [`${fmtTime(b.start)}–${fmtTime(b.end)}`, kindLabel(b.kind), b.location].filter(Boolean).join(' · '),
      { onclick: async () => { if (await bookingSheet(b)) reload(); } }));
    fill(box, h('div', { class: 'cl-cols' },
      h('div', null,
        eyebrow('Upcoming'),
        upcoming.length ? upcoming.map(row) : h('p', { class: 'small faint' }, 'Nothing booked.'),
        dashed(`Book a session for ${ctx.name}`, async () => { if (await bookSessionSheet(ctx)) reload(); })),
      h('div', null, past.length ? [eyebrow('Past 30 days'), past.map(row)] : null)));
  });
}

/** One booking or class: who's coming, and cancel (the iPhone's ClassDetailView). Resolves true when cancelled. */
function bookingSheet(b) {
  return sheet(b.title ?? kindLabel(b.kind), (body, close) => {
    const people = b.attendees?.length ? b.attendees : b.client ? [b.client] : [];
    const status = h('div');
    fill(body,
      h('p', { class: 'small muted m0' }, `${longDayOf(b.start)} · ${fmtTime(b.start)}–${fmtTime(b.end)}`),
      b.location ? h('p', { class: 'small faint m0' }, b.location) : null,
      eyebrow('Attendees', b.capacity ? `${b.attendeeCount ?? b.attendees?.length ?? 0} of ${b.capacity}` : null),
      people.length ? card({ class: 'flush' }, people.map(p => h('div', { class: 'cl-pick static' }, avatar(p.name, 28), h('span', null, p.name))))
        : emptyCard('people', 'Nobody yet'),
      status);
    const canCancel = b.cancellable !== false && Date.parse(b.start) > Date.now();
    const cancel = h('button', {
      class: 'btn danger', type: 'button',
      onclick: async () => {
        if (!await confirmBox('Cancel this?', { ok: 'Cancel it', danger: true })) return;
        await busy(cancel, status, async () => { await api('DELETE', `/api/bookings/${enc(b.id)}`); close(true); });
      },
    }, b.kind === 'group' ? 'Cancel class' : 'Cancel booking');
    return h('div', { class: 'spread' }, canCancel ? cancel : h('span'), button('Close', () => close(false)));
  }).then(v => v === true);
}

/** Book a 1:1 or video call for this client from the coach's open slots (the iPhone's BookSessionView). */
function bookSessionSheet(ctx) {
  return sheet('Book a client', (body, close) => {
    const today = todayLondon();
    let day = today, kind = 'inperson', chosen = null, seq = 0;
    const KINDS = [['inperson', '1:1 · in person'], ['video', 'Video call']];
    const label = () => KINDS.find(k => k[0] === kind)[1];
    const nav = h('div'), strip = h('div'), kinds = h('div'), slots = h('div'), summary = card(null), status = h('div');
    const confirmBtn = button('Confirm booking', async () => {
      if (!chosen) return;
      await busy(confirmBtn, status, async () => {
        await api('POST', '/api/bookings', { start: chosen.start, kind, clientId: ctx.id });
        toast(`Booked ${ctx.first()} in.`);
        close(true);
      });
      confirmBtn.disabled = !chosen;
    }, { kind: 'primary', disabled: true });
    const drawTop = () => {
      fill(nav, weekNav(mondayOf(day), n => { const next = addDays(day, n); day = next < today ? today : next; drawTop(); loadSlots(); }, { canBack: mondayOf(day) > mondayOf(today) }));
      fill(strip, dayStrip(mondayOf(day), day, new Set(), d => { if (d < today) return; day = d; drawTop(); loadSlots(); }));
      fill(kinds, segmented(KINDS, kind, v => { kind = v; drawTop(); loadSlots(); }));
    };
    const drawSummary = () => {
      fill(summary,
        h('div', { class: 'spread small' }, h('span', null, chosen ? `${weekdayOf(londonParts(chosen.start).day)} ${fmtShort(londonParts(chosen.start).day)} · ${fmtTime(chosen.start)}–${fmtTime(chosen.end)}` : 'Pick a time'),
          h('span', null, chosen?.location || label())),
        h('div', { class: 'divider' }),
        h('div', { class: 'spread small faint' }, h('span', null, 'Uses 1 credit'), h('span', null, label())));
      confirmBtn.disabled = !chosen;
    };
    async function loadSlots() {
      const mine = ++seq;
      chosen = null; drawSummary();
      fill(slots, h('p', { class: 'small faint' }, 'Finding times…'));
      try {
        const r = await api('GET', `/api/slots?${q({ from: day, to: day, kind })}`);
        if (mine !== seq) return;
        const open = r.slots.filter(s => Date.parse(s.start) > Date.now()).sort((a, b) => a.start.localeCompare(b.start));
        const draw = () => fill(slots, open.length ? h('div', { class: 'cl-slots' }, open.map(s => h('button', {
          type: 'button', class: 'cl-slot' + (chosen?.start === s.start ? ' sel' : '') + (s.open ? '' : ' taken'), disabled: !s.open,
          onclick: () => { chosen = s; draw(); drawSummary(); },
        }, fmtTime(s.start)))) : emptyCard('clock', 'No times this day', 'Try another day or session type.'));
        draw();
      } catch (err) {
        if (mine === seq) fill(slots, errorLine(err), button('Try again', loadSlots, { small: true }));
      }
    }
    body.append(
      card({ class: 'row' }, avatar(ctx.name, 34), h('span', { class: 'strong' }, `Booking for ${ctx.name}`)),
      nav, strip, h('div', { class: 'mt' }, kinds), h('div', { class: 'mt' }, slots), summary, status,
      h('p', { class: 'tiny faint center' }, 'Free cancellation up to 24h before'));
    drawTop();
    loadSlots();
    return h('div', { class: 'row end' }, button('Cancel', () => close(false)), confirmBtn);
  }).then(v => v === true);
}

// MARK: - Progress tab (the client's own Progress screen, read-only for the coach)

const STAT_LABEL = { bodyFat: 'Body fat', waist: 'Waist', restingHr: 'Resting HR', weight: 'Weight' };
const STAT_UNIT = { bodyFat: '%', waist: ' cm', weight: ' kg', restingHr: '' };
let progressRange = '3m';

function weightChart(series) {
  const W = 600, H = 110;
  const values = series.map(p => p.value);
  const low = Math.min(...values) - 1, high = Math.max(...values) + 1;
  const t0 = parseDay(series[0].date).getTime(), t1 = parseDay(series.at(-1).date).getTime();
  const x = d => (t1 === t0 ? 0 : ((parseDay(d).getTime() - t0) / (t1 - t0)) * W);
  const y = v => H - ((v - low) / (high - low)) * H;
  const pts = series.map(p => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`);
  return svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'cl-chart', role: 'img', 'aria-label': `Body weight from ${fmtN(values[0])} to ${fmtN(values.at(-1))} kg` },
    svgEl('polyline', { points: pts.join(' '), fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }));
}

async function progressTab(box, ctx) {
  const urls = [];
  ctx.view.onLeave(() => urls.forEach(u => URL.revokeObjectURL(u)));
  const top = h('div');
  const content = h('div');
  fill(box, top, content);
  const drawTop = since => fill(top, h('div', { class: 'spread' },
    h('span', { class: 'small faint' }, since ? `Since ${fmtShort(since)}` : ''),
    segmented([['3m', '3M'], ['6m', '6M'], ['all', 'All']], progressRange, v => { progressRange = v; progressTab(box, ctx); })));
  drawTop(null);
  await loadInto(content, ctx.view, () => Promise.all([
    api('GET', `/api/progress?${q({ clientId: ctx.id, range: progressRange })}`),
    api('GET', `/api/photos?${q({ clientId: ctx.id })}`),
  ]), ([p, ph]) => {
    drawTop(p.since);
    const series = p.weight?.series ?? [];
    const photos = h('div', { class: 'cl-photos' });
    fill(content, h('div', { class: 'cl-cols' },
      h('div', null,
        card({ class: 'cl-wcard' },
          h('div', { class: 'spread' }, eyebrow('Body weight'), p.weight?.delta !== null && p.weight?.delta !== undefined ? chip(`${fmtDelta(p.weight.delta)} kg`) : null),
          h('div', { class: 'row baseline gap4' }, h('span', { class: 'big-num' }, p.weight?.latest === null || p.weight?.latest === undefined ? '–' : fmtN(p.weight.latest)), h('span', { class: 'small faint' }, 'kg')),
          series.length >= 2 ? weightChart(series) : h('p', { class: 'tiny faint' }, 'Two weigh-ins (or Apple Health) show the trend.')),
        p.stats.length ? h('div', { class: 'cl-tiles3' }, p.stats.map(s => tile(STAT_LABEL[s.kind] ?? s.kind,
          s.latest === null ? '–' : fmtN(s.latest) + (STAT_UNIT[s.kind] ?? ''), s.delta === null || s.delta === undefined ? null : fmtDelta(s.delta)))) : null,
        eyebrow('Progress photos', 'Private to the client and you'),
        photos),
      h('div', null,
        eyebrow('Personal records', 'Best logged load'),
        p.records.length
          ? card({ class: 'flush' }, p.records.map(r => h('div', { class: 'cl-pick static' },
            h('div', { class: 'grow' }, h('div', { class: 'strong' }, r.exercise), h('div', { class: 'tiny faint' }, fmtShort(r.date))),
            h('div', { class: 'cl-right' }, h('div', { class: 'strong' }, `${fmtN(r.kg)} kg`), r.gain ? h('div', { class: 'tiny faint' }, `${fmtDelta(r.gain)} kg`) : null))))
          : emptyCard('dumbbell', 'No records yet', 'They appear once sets are logged.'))));
    if (!ph.photos.length) { fill(photos, h('p', { class: 'small faint' }, 'No photos yet.')); return; }
    // Photos need the session header, so they load as blobs.
    fill(photos, ph.photos.slice().reverse().map(photo => {
      const img = h('img', { alt: `Progress photo, ${fmtShort(photo.date)}`, loading: 'lazy' });
      const btn = h('button', { class: 'cl-photo', type: 'button', onclick: () => { if (img.src) sheet(`Photo · ${fmtShort(photo.date)}`, b => { b.append(h('img', { src: img.src, alt: img.alt, class: 'cl-photo-big' })); }, { wide: true }); } },
        img, h('span', { class: 'tiny' }, fmtShort(photo.date)));
      apiBlob(photo.url).then(blob => {
        const u = URL.createObjectURL(blob);
        urls.push(u);
        if (ctx.view.fresh()) img.src = u; else URL.revokeObjectURL(u);
      }, () => fill(btn, h('span', { class: 'tiny faint' }, 'Could not load')));
      return btn;
    }));
  });
}
