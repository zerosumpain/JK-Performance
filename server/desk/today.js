/*
 * Today (the coach's home) and Business. Atelier: the next-session strip, the
 * letters-due line and one Needs-you list ranked by severity, from
 * GET /api/coach/needs-you; it ends "All caught up". (The old summary cards,
 * the "No training lately" list and the Autoflows card are gone.)
 */
import {
  MONTHS_LONG, api, avatar, card, emptyCard, emptyState, errorLine, eyebrow, fill, firstName, fmtCountdown, fmtDay, fmtMoney,
  fmtTime, h, icon, link, loading, parseDay, personRow, q, route, screenHeader, segmented, stat, svgEl, todayLondon,
} from './core.js';

const enc = encodeURIComponent;
const kindLabel = kind => (kind === 'video' ? 'Video call' : kind === 'group' ? 'Class' : '1:1');
const clientPath = (id, tab) => `/clients/${enc(id)}${tab ? `/${tab}` : ''}`;
/** A back link over a pushed screen (the iPhone's navigation back button). */
const backLink = (to, label) => link(to, { class: 'back-link' }, icon('back', 16), label);

// MARK: - Today

route('/today', async (el, _params, view) => {
  const date = todayLondon();
  el.append(screenHeader(fmtDay(date), 'Today',
    link('/business', { class: 'icon-btn', 'aria-label': 'Business', title: 'Business' }, icon('business', 20)),
    link('/account', { class: 'icon-btn', 'aria-label': 'Account and settings', title: 'Account and settings' }, icon('settings', 20))));
  const body = h('div', { class: 'today' }, loading());
  el.append(body);
  let lettersOnly = false, last = null;
  const draw = () => { if (last && view.fresh()) fill(body, todayBody(last, lettersOnly, v => { lettersOnly = v; draw(); })); };
  const load = async (quiet = false) => {
    if (!quiet) fill(body, loading());
    try {
      last = await api('GET', '/api/coach/needs-you');
      draw();
    } catch (err) {
      if (view.fresh() && !quiet) fill(body, errorLine(err), h('button', { class: 'btn small', type: 'button', onclick: () => load() }, 'Try again'));
    }
  };
  await load();
  const timer = setInterval(() => { if (!document.hidden) load(true); }, 60_000);
  view.onLeave(() => clearInterval(timer));
});

function todayBody(n, lettersOnly, setLettersOnly) {
  const out = [nextStrip(n.sessionsToday)];
  const due = n.lettersDue;
  if (due && due.count > 0) {
    out.push(h('button', {
      class: 'letters-due' + (lettersOnly ? ' on' : ''), type: 'button', 'aria-pressed': String(lettersOnly),
      title: lettersOnly ? 'Show everyone who needs you' : 'Show only the letters due',
      onclick: () => setLettersOnly(!lettersOnly),
    }, icon('letter', 20), h('span', { class: 'grow' }, `Letters due: ${due.count} · about ${due.estMinutes} min`),
    h('span', { class: 'small muted' }, lettersOnly ? 'Show all' : `Week of ${fmtDay(due.week).slice(4)}`)));
  }
  let items = n.items || [];
  if (lettersOnly && due) {
    const byId = new Map(items.map(i => [i.client.id, i]));
    items = due.clients.map(c => byId.get(c.id) ?? {
      client: { ...c, firstName: firstName(c.name) }, rank: 4, priority: false,
      reasons: [{ kind: 'checkinLetterDue', iconKey: 'letter', text: c.media ? 'Letter due · with a voice or video note' : 'Letter due' }],
      reasonLine: c.media ? 'Letter due · with a voice or video note' : 'Letter due',
      primaryAction: { kind: 'writeLetter', label: 'Write letter' },
    });
  }
  if (items.length) out.push(h('div', { class: 'card flush needs-you', role: 'list', 'aria-label': 'Needs you' }, items.map(needsYouRow)));
  out.push(emptyState('All caught up.', items.length ? null : 'Nothing is waiting on you.'));
  return out;
}

/** "Next: Sam · 07:00 · Studio", "3 of 5 sessions today": opens the schedule. */
function nextStrip(st) {
  const next = st?.next;
  const who = next ? (next.kind === 'group' ? (next.title || 'Class') : firstName(next.client?.name ?? next.title ?? 'Session')) : null;
  const where = next ? (next.location || kindLabel(next.kind)) : null;
  const total = st?.total ?? 0;
  return link('/schedule', { class: 'next-strip' },
    icon(next?.kind === 'video' ? 'video' : next?.kind === 'group' ? 'group' : 'workout', 20),
    h('span', { class: 'grow' },
      next ? h('span', { class: 'strong' }, `Next: ${who} · ${fmtTime(next.start)} · ${where}`) : h('span', { class: 'strong' }, total ? 'No more sessions today' : 'No sessions today'),
      next && fmtCountdown(next.start) ? h('span', { class: 'muted' }, ` · ${fmtCountdown(next.start)}`) : null),
    total ? h('span', { class: 'small muted t-num' }, `${st.done} of ${total} sessions today`) : null,
    icon('chevron', 18));
}

const ACTION_PATH = {
  writeLetter: c => clientPath(c.id, 'letter'),
  reply: c => `/messages/${enc(c.id)}`,
  nudge: c => `/messages/${enc(c.id)}`,
  readAnswers: c => clientPath(c.id, 'forms'),
};
const REASON_TONE = { pain: 'tone-urgent', priorityUnread: 'tone-attention' };

/** One client: avatar, name, reason glyphs, a one-line reason and one action. */
function needsYouRow(item) {
  const c = item.client;
  const seen = new Set();
  const glyphs = (item.reasons || []).filter(r => !seen.has(r.iconKey) && seen.add(r.iconKey)).slice(0, 3)
    .map(r => h('span', { class: REASON_TONE[r.kind] || 'muted' }, icon(r.iconKey || r.kind, 18, { label: r.text })));
  const action = item.primaryAction;
  return h('div', { class: 'ny-row', role: 'listitem' },
    link(clientPath(c.id), { class: 'ny-main' },
      avatar(c.initials || c.name, 36),
      h('div', { class: 'grow' },
        h('div', { class: 'row gap4 ny-name' }, h('span', { class: 'strong' }, c.name)),
        h('div', { class: 'small muted clamp2' }, item.reasonLine)),
      h('span', { class: 'ny-glyphs' }, glyphs)),
    action && ACTION_PATH[action.kind]
      ? link(ACTION_PATH[action.kind](c), { class: 'btn small ny-action' }, action.label)
      : null);
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

