/*
 * Today: the Command Centre (desk v2, F1) and Business.
 *
 * Today is a bento of tiles, every one from registerWidget: WP1's five
 * (needs, today-sessions, inbox, letters, activity, in f-command-widgets.js)
 * and whatever other packages register. The header greets the coach and
 * says the day in one line from GET /api/command/summary; Brief me opens the
 * AI morning brief, Customise lets the coach drag, resize and hide tiles
 * (saved in coach prefs desk.today.layout). Tiles refresh themselves on live
 * events, so the screen never redraws as a whole.
 */
import {
  MONTHS_LONG, api, card, emptyCard, errorLine, eyebrow, fill, fmtMoney, h, icon, link, loading, parseDay, personRow, prefs, q,
  registered, route, screenHeader, segmented, stat, state, svgEl, toast, todayLondon,
} from './core.js';
import { coachFirst, greeting, onRefresh, openBrief, summary } from './f-command-core.js';
import { bento, tile } from './ui.js';

const enc = encodeURIComponent;
const clientPath = (id, tab) => `/clients/${enc(id)}${tab ? `/${tab}` : ''}`;
/** A back link over a pushed screen (the iPhone's navigation back button). */
const backLink = (to, label) => link(to, { class: 'back-link' }, icon('back', 16), label);
const LAYOUT_KEY = 'desk.today.layout';
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// MARK: - Today

/** "Tuesday 24 November". */
const longDate = day => { const d = parseDay(day); return `${DAYS_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]}`; };

/** "4 people need you · 6 sessions · 7 in your inbox · £360 due", each number set off. */
function dayLine(s) {
  const part = (n, text, { tone = null, to = null } = {}) => {
    const inner = [h('strong', { class: `t-num${tone ? ` tone-${tone}` : ''}` }, String(n)), ` ${text}`];
    return to ? link(to, { class: 'cmd-line-part' }, inner) : h('span', { class: 'cmd-line-part' }, inner);
  };
  const parts = [
    s.needs ? part(s.needs, s.needs === 1 ? 'person needs you' : 'people need you') : h('span', { class: 'cmd-line-part' }, 'Nobody is waiting on you'),
    s.urgent ? h('span', { class: 'cmd-line-part cmd-line-urgent' }, icon('healing', 15), h('strong', { class: 't-num' }, String(s.urgent)), ' urgent') : null,
    part(s.sessionsToday, s.sessionsToday === 1 ? 'session' : 'sessions', { to: '/schedule' }),
    s.inbox ? part(s.inbox, 'in your inbox', { to: '/inbox' }) : null,
    s.duePence ? h('span', { class: 'cmd-line-part' }, h('strong', { class: 't-num' }, fmtMoney(s.duePence)), ' due') : null,
  ].filter(Boolean);
  return parts.flatMap((p, i) => (i ? [h('span', { class: 'cmd-line-sep', 'aria-hidden': 'true' }, '·'), p] : [p]));
}

route('/today', async (el, _params, view) => {
  const day = todayLondon();
  const line = h('p', { class: 'cmd-day-line' }, h('span', { class: 'ui-sk cmd-line-sk' }));
  const briefBtn = h('button', { type: 'button', class: 'btn primary cmd-brief-btn', onclick: openBrief }, icon('auto_awesome', 18), 'Brief me');
  const customBtn = h('button', { type: 'button', class: 'btn cmd-custom-btn', 'aria-pressed': 'false' }, icon('tune', 18), 'Customise');
  const head = h('header', { class: 'cmd-head' },
    h('div', { class: 'cmd-head-text' },
      h('div', { class: 'ui-eyebrow cmd-date' }, longDate(day)),
      h('h1', { class: 'cmd-hello' }, `${greeting()}, `, h('em', null, coachFirst(state.me?.name))),
      line),
    h('div', { class: 'cmd-head-actions' }, briefBtn, customBtn));
  const editBar = h('div', { class: 'cmd-editbar', hidden: true, role: 'region', 'aria-label': 'Customise Today' });
  const grid = await widgetGrid(view, { editable: true });
  el.append(head, editBar, grid);

  const drawLine = async () => {
    try { const s = await summary(); if (view.fresh()) fill(line, dayLine(s)); } catch { if (view.fresh()) fill(line, 'Here is your day.'); }
  };
  drawLine();
  onRefresh(view, drawLine);

  let editing = false;
  const setEditing = on => {
    editing = on;
    grid.bento?.setEditing(on);
    customBtn.setAttribute('aria-pressed', String(on));
    customBtn.classList.toggle('on', on);
    fill(customBtn, icon(on ? 'check' : 'tune', 18), on ? 'Done' : 'Customise');
    editBar.hidden = !on;
  };
  fill(editBar, icon('drag_indicator', 18),
    h('span', { class: 'grow' }, 'Drag a tile by its handle (or use the arrow keys on it), pick a size, or hide it. Changes save as you go.'),
    h('button', { type: 'button', class: 'btn small', onclick: async () => {
      await prefs.set(LAYOUT_KEY, null).catch(() => {});
      grid.reset?.();
      grid.bento?.setEditing(true);
      toast('Today is back to its default layout');
    } }, icon('undo', 16), 'Reset'));
  customBtn.addEventListener('click', () => setEditing(!editing));
  view.onLeave(() => { if (editing) setEditing(false); });
});

/**
 * Every registered widget as a tile, in the coach's saved order and sizes.
 * Widgets with defaultOn:false start hidden (Customise shows them). `all`
 * (the kit harness) shows every widget. With `editable`, the returned element
 * carries `.bento` ({setEditing}) and `.reset()`, and layout changes save to
 * prefs desk.today.layout.
 */
export async function widgetGrid(view, { all = false, editable = false } = {}) {
  const widgets = registered.widgets();
  const box = h('section', { class: 'reg-widgets cmd-grid', 'aria-label': 'Today' });
  if (!widgets.length) return box;
  const make = w => {
    const t = tile({ id: w.id, title: w.title, eyebrow: w.eyebrow, icon: w.icon, size: w.size, tall: w.tall, hero: w.hero, action: w.action, loading: true });
    t.classList.add(`cmd-tile-${w.id}`);
    Promise.resolve().then(() => { t.body.replaceChildren(); return w.render(t.body, view); })
      .catch(err => { if (view.fresh()) t.body.replaceChildren(errorLine(err)); });
    return t;
  };
  const defaults = () => widgets.map(w => ({ id: w.id, size: w.size, hidden: !all && w.defaultOn === false }));
  let b = null;
  const build = layout => {
    const grid = h('div');
    box.replaceChildren(grid);
    b = bento(grid, widgets.map(make), editable ? { editable: true, onLayout: next => prefs.set(LAYOUT_KEY, next).catch(err => toast(err.message, { error: true })) } : {});
    b.apply(layout);
    box.bento = b;
  };
  const saved = all ? null : await prefs.get(LAYOUT_KEY, null).catch(() => null);
  const layout = Array.isArray(saved)
    // Widgets the saved layout does not know yet keep their defaults (shown or hidden), after the saved ones.
    ? [...saved, ...defaults().filter(d => !saved.some(s => s.id === d.id))]
    : defaults();
  build(layout);
  box.reset = () => b.apply(defaults());
  return box;
}

// MARK: - Business

/** The MRR line: slate, no fill, no axes. */
function mrrChart(series) {
  const points = series.map(s => s.pence / 100);
  if (points.length < 2) return null;
  const W = 600, H = 90;
  const max = Math.max(...points), min = Math.min(...points);
  const span = Math.max(max - min, 1);
  const lo = min - span * 0.1, hi = max + span * 0.1;
  const x = i => (i / (points.length - 1)) * W;
  const y = v => H - ((v - lo) / (hi - lo)) * H;
  const line = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'mrr-chart', role: 'img', 'aria-label': 'Monthly recurring revenue over the period' },
    svgEl('path', { d: line, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }));
}

const delta = v => (v < 0 ? `−${Math.abs(v)}` : v > 0 ? `+${v}` : `${v}`);
const attentionIcon = kind => (kind === 'checkin' ? 'checkIn' : kind === 'payment' ? 'tag' : 'noTraining');

function businessBody(b) {
  return [
    card({ class: 'mrr-card' },
      h('div', { class: 'spread' }, h('div', { class: 'eyebrow m0' }, 'Monthly recurring revenue'),
        b.mrrDeltaPct !== null && b.mrrDeltaPct !== undefined ? h('span', { class: 'delta-badge' }, `${delta(b.mrrDeltaPct)}%`) : null),
      h('div', { class: 'mrr-value' }, fmtMoney(b.mrrPence)),
      mrrChart(b.series || [])),
    h('div', { class: 'grid4 biz-stats' },
      stat(String(b.active), 'Active'), stat(String(b.new), 'New'), stat(String(b.churned), 'Churned'),
      stat(b.adherence === null || b.adherence === undefined ? '–' : `${b.adherence}%`, 'Adherence')),
    eyebrow('Members by plan', link('/business/plans', { class: 'row gap4' }, icon('tag', 16), 'Plans & prices')),
    b.plans && b.plans.length ? h('div', { class: 'stats' }, b.plans.map(p => stat(String(p.members), p.name))) : null,
    eyebrow('Needs attention', 'Auto-flagged'),
    b.attention.length
      ? card({ class: 'flush' }, b.attention.map(a => personRow(a.client, a.reason, clientPath(a.client.id), {
        trailing: h('span', { class: 'muted' }, icon(attentionIcon(a.kind), 18)),
      })))
      : emptyCard('check', 'Everyone’s on track'),
  ];
}

route('/business', async (el, _params, view) => {
  let period = 'month';
  const month = MONTHS_LONG[parseDay(todayLondon()).getUTCMonth()];
  const head = h('div');
  const body = h('div');
  el.append(backLink('/today', 'Today'), head, body);
  const draw = async () => {
    fill(head, screenHeader(month, 'Business', segmented([['week', 'Week'], ['month', 'Month']], period, v => { period = v; draw(); })));
    fill(body, loading());
    const asked = period;
    try {
      const b = await api('GET', `/api/coach/business?${q({ period })}`);
      if (view.fresh() && asked === period) fill(body, businessBody(b));
    } catch (err) {
      if (view.fresh()) fill(body, errorLine(err), h('button', { class: 'btn small', type: 'button', onclick: draw }, 'Try again'));
    }
  };
  await draw();
}, { nav: 'today' });

