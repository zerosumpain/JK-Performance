/*
 * Today (the coach's home), the lists behind its cards, and Business.
 * Ported from the iPhone app: CoachTodayView + TodayCards, PeopleListView,
 * FeedbackDueView, SessionRow and BusinessView (Coach/TodayCards.swift and
 * Coach/CoachViews.swift).
 */
import {
  COLOR, MONTHS_LONG, api, avatar, card, emptyCard, errorLine, eyebrow, fill, firstName, fmtCountdown, fmtDay,
  fmtMoney, fmtRelative, fmtShort, fmtTime, h, icon, link, loading, parseDay, personRow, q, route, screenHeader,
  segmented, slotColor, stat, summaryCard, todayLondon,
} from './core.js';

// MARK: - Helpers (the Swift TodayCards' private ones)

const kindLabel = kind => (kind === 'video' ? 'Video' : kind === 'group' ? 'Group' : '1:1');
const isGroup = s => s.kind === 'group';
/** Where a session opens: a 1:1 → the client; a class → its page in Schedule. */
const sessionPath = s => (s.client && !isGroup(s) ? `/clients/${encodeURIComponent(s.client.id)}` : `/schedule/class/${encodeURIComponent(s.id)}`);
const clientPath = (id, tab) => `/clients/${encodeURIComponent(id)}${tab ? `/${tab}` : ''}`;
/** "Sam, Priya +2" */
function names(list) {
  if (!list || !list.length) return null;
  return list.slice(0, 2).map(firstName).join(', ') + (list.length > 2 ? ` +${list.length - 2}` : '');
}
function oldest(people) {
  const ats = (people || []).map(p => p.at).filter(Boolean).sort();
  return ats[0] || null;
}
const weekdayShort = day => fmtDay(day).split(' ')[0];
const isOverdue = due => !!(due && due.dueBy && todayLondon() > due.dueBy);
function dueText(due) {
  if (!due || !due.dueBy) return '';
  if (isOverdue(due)) return `Week of ${fmtShort(due.week)} · was due ${weekdayShort(due.dueBy)}`;
  return due.dueBy === todayLondon() ? 'Due today' : `Due ${weekdayShort(due.dueBy)} ${fmtShort(due.dueBy)}`;
}

/** A back link over a pushed screen (the iPhone's navigation back button). */
const backLink = (to, label) => link(to, { class: 'back-link' }, icon('back', 14), label);

/** Load JSON for a screen; draws loading/error with a retry, and ignores a stale answer. */
async function loadInto(el, view, path, draw) {
  const body = h('div');
  el.append(body);
  const run = async () => {
    fill(body, loading());
    try {
      const data = await api('GET', path);
      if (view.fresh()) fill(body, draw(data));
    } catch (err) {
      if (view.fresh()) fill(body, errorLine(err), h('button', { class: 'btn small', type: 'button', onclick: run }, 'Try again'));
    }
  };
  await run();
}

// MARK: - Today

route('/today', async (el, _params, view) => {
  const date = todayLondon();
  el.append(screenHeader(`Coach · ${fmtDay(date)}`, 'Today',
    link('/account', { class: 'icon-btn', 'aria-label': 'Account', title: 'Account' }, icon('account', 18)),
    link('/business', { class: 'jk-mark', 'aria-label': 'Business', title: 'Business' }, 'JK')));
  const body = h('div', { class: 'today' }, loading());
  el.append(body);
  let timer = null;
  const load = async (quiet = false) => {
    if (!quiet) fill(body, loading());
    try {
      const t = await api('GET', `/api/coach/today?${q({ date })}`);
      if (view.fresh()) fill(body, todayCards(t));
    } catch (err) {
      if (view.fresh() && !quiet) fill(body, errorLine(err), h('button', { class: 'btn small', type: 'button', onclick: () => load() }, 'Try again'));
    }
  };
  await load();
  // Countdowns and "to go" move with the clock; the iPhone redraws on pull-to-refresh.
  timer = setInterval(() => { if (!document.hidden) load(true); }, 60_000);
  view.onLeave(() => clearInterval(timer));
});

function todayCards(t) {
  const sessions = [...(t.sessions || [])].sort((a, b) => a.start.localeCompare(b.start));
  const now = Date.now();
  const upcoming = sessions.filter(s => Date.parse(s.end) > now);
  const out = [];

  if (t.urgent && t.urgent.length) out.push(urgentCard(t.urgent));

  const checkins = t.checkinsToReview ?? 0;
  const forms = t.formsToReview ?? 0;
  const quiet = t.quiet || [];
  const due = t.feedbackDue;
  const dueCount = due?.clients?.length ?? 0;
  const firstQuiet = quiet[0];
  out.push(h('div', { class: 'today-grid' },
    nextSessionCard(sessions, upcoming),
    summaryCard({
      icon: 'bubble', title: 'Messages', count: t.unread ?? 0, countLabel: 'unread',
      detail: t.unreadClients?.[0]?.at ? `Newest ${fmtRelative(t.unreadClients[0].at)} · ${names(t.unreadClients.map(c => c.name)) ?? ''}` : 'No unread',
      tint: (t.unread ?? 0) > 0 ? COLOR.waiting : null, to: '/messages',
    }),
    summaryCard({
      icon: 'pencil', title: 'Check-ins', count: checkins,
      detail: oldest(t.checkinClients) ? `Oldest ${fmtRelative(oldest(t.checkinClients))}` : 'All replied',
      tint: checkins > 0 ? COLOR.waiting : null, to: '/today/checkins', disabled: checkins === 0,
    }),
    summaryCard({
      icon: 'form', title: 'Forms to read', count: forms,
      detail: names(t.formClients?.map(c => c.name)) ?? 'Nothing new',
      tint: forms > 0 ? COLOR.waiting : null, to: '/programs/forms',
    }),
    summaryCard({
      icon: 'bubble', title: 'Feedback to write', count: dueCount,
      detail: dueCount === 0 ? 'All published' : dueText(due),
      tint: dueCount > 0 && isOverdue(due) ? COLOR.urgent : dueCount > 0 ? COLOR.waiting : null,
      to: '/today/feedback-due', disabled: dueCount === 0,
    }),
    summaryCard({
      icon: 'moon', title: 'Gone quiet', count: quiet.length,
      detail: firstQuiet ? `${firstName(firstQuiet.name)} · ${firstQuiet.days} days` : 'Everyone’s in touch',
      to: '/today/quiet', disabled: quiet.length === 0,
    }),
    summaryCard({ icon: 'bolt', title: 'Autoflows', count: t.upcoming?.length ?? 0, countLabel: 'this week', detail: autoflowDetail(t.upcoming), to: '/programs/autoflows' }),
    summaryCard({ icon: 'calendar', title: 'This week', count: t.sessionsLeftThisWeek ?? 0, detail: 'sessions still to come', to: '/schedule' }),
  ));

  const inactive = (t.attention || []).filter(a => a.kind === 'inactive');
  const lower = h('div', { class: 'today-lower' + (inactive.length ? '' : ' single') });
  if (inactive.length) {
    lower.append(h('section', null,
      eyebrow('No training lately'),
      card({ class: 'flush' }, inactive.map(a => personRow(a.client, a.reason, clientPath(a.client.id))))));
  }
  const nextId = upcoming[0]?.id;
  lower.append(h('section', null,
    eyebrow('Sessions today', sessions.length ? `${upcoming.length} to go` : null),
    sessions.length
      ? h('div', { class: 'session-list' }, sessions.map(s => sessionRow(s, s.id === nextId)))
      : h('p', { class: 'small faint m0' }, 'Nothing booked today.')));
  out.push(lower);
  return out;
}

function urgentCard(items) {
  return card({ class: 'flush urgent-card' },
    h('div', { class: 'urgent-head' }, icon('warning', 14), items.length === 1 ? 'Needs you first' : `${items.length} need you first`),
    items.map(a => personRow(a.client, a.reason, clientPath(a.client.id, 'feedback'))));
}

function nextSessionCard(sessions, upcoming) {
  const next = upcoming[0];
  if (next) {
    return summaryCard({
      icon: 'clock', title: 'Next session', value: fmtTime(next.start),
      detail: `${next.client?.name ?? next.title ?? kindLabel(next.kind)} · ${fmtCountdown(next.start) ?? 'now'}`,
      tint: slotColor(next.kind), to: sessionPath(next),
    });
  }
  return summaryCard({
    icon: 'clock', title: 'Sessions today', value: sessions.length ? 'Done' : 'None',
    detail: sessions.length ? `All ${sessions.length} finished` : 'Nothing booked', to: '/schedule',
  });
}

function autoflowDetail(upcoming) {
  const first = upcoming?.[0];
  if (!first) return 'Nothing due';
  const when = first.date === todayLondon() ? 'today' : weekdayShort(first.date);
  return `${firstName(first.client.name)} · ${first.action} ${when}`;
}

/** One of today's sessions: times, a colour bar for the kind, who, and Next / done. */
function sessionRow(s, isNext) {
  const done = Date.parse(s.end) < Date.now();
  const who = s.client ? s.client.name : (s.title || 'Group');
  const count = s.attendeeCount ?? s.attendees?.length ?? 0;
  const bar = h('span', { class: 'slot-bar', style: { background: slotColor(s.kind), opacity: done ? '0.4' : '1' } });
  const trailing = isNext ? h('span', { class: 'next-pill' }, 'Next') : done ? icon('check', 14) : icon('chevron', 14);
  return h('div', { class: 'session-row' + (done ? ' done' : '') },
    h('div', { class: 'session-times' }, h('div', { class: 'strong' }, fmtTime(s.start)), h('div', { class: 'faint' }, fmtTime(s.end))),
    link(sessionPath(s), { class: 'session-card' + (isNext ? ' next' : '') },
      bar,
      avatar(s.client ? s.client.name : 'G', 28),
      h('div', { class: 'grow' },
        h('div', { class: 'strong clamp1' }, isGroup(s) ? `${who} · ${count} clients` : who),
        h('div', { class: 'tiny faint clamp1' }, [s.title, kindLabel(s.kind)].filter(Boolean).join(' · '))),
      trailing));
}

// MARK: - The lists behind the cards

const LISTS = {
  checkins: {
    title: 'Check-ins to reply to',
    rows: t => (t.checkinClients || []).map(p => ({ person: p, detail: p.at ? `Sent ${fmtRelative(p.at)}` : '', tab: 'feedback' })),
  },
  quiet: {
    title: 'Not spoken to lately',
    rows: t => (t.quiet || []).map(p => ({ person: p, detail: `No contact in ${p.days} days`, tab: 'plan' })),
  },
  'feedback-due': {
    title: 'Feedback to write',
    eyebrow: t => (t.feedbackDue?.week ? `Week of ${fmtShort(t.feedbackDue.week)}` : 'Today'),
    rows: t => (t.feedbackDue?.clients || []).map(p => ({ person: p, detail: null, tab: 'feedback' })),
  },
};

route('/today/:list', async (el, { list }, view) => {
  const spec = LISTS[list];
  el.append(backLink('/today', 'Today'));
  if (!spec) {
    el.append(screenHeader(null, 'Not found'), h('p', { class: 'muted' }, 'That list doesn’t exist.'));
    return;
  }
  const head = h('div', null, screenHeader('Today', spec.title));
  el.append(head);
  await loadInto(el, view, `/api/coach/today?${q({ date: todayLondon() })}`, t => {
    if (spec.eyebrow) fill(head, screenHeader(spec.eyebrow(t), spec.title));
    const rows = spec.rows(t);
    if (!rows.length) return emptyCard('check', 'Nothing waiting');
    return h('div', { class: 'people-grid' }, rows.map(r => card({ class: 'flush' }, personRow(r.person, r.detail, clientPath(r.person.id, r.tab)))));
  });
}, { nav: 'today' });

// MARK: - Business

const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** The MRR area chart: a line with a fading fill, no axes (as the iPhone draws it). */
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
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'mrr-chart', role: 'img', 'aria-label': 'Monthly recurring revenue over the period' });
  const id = `mrr-fill-${Math.random().toString(36).slice(2, 8)}`;
  const grad = svgEl('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(svgEl('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0.3' }), svgEl('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' }));
  const defs = svgEl('defs', {});
  defs.append(grad);
  svg.append(defs,
    svgEl('path', { d: `${line}L${W},${H}L0,${H}Z`, fill: `url(#${id})` }),
    svgEl('path', { d: line, fill: 'none', stroke: '#fff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }));
  return svg;
}

const delta = v => (v < 0 ? `−${Math.abs(v)}` : v > 0 ? `+${v}` : `${v}`);
const attentionIcon = kind => (kind === 'checkin' ? 'form' : 'warning');

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
    eyebrow('Members by plan', link('/business/plans', { class: 'row gap4' }, icon('tag', 13), 'Plans & prices')),
    b.plans && b.plans.length ? h('div', { class: 'stats' }, b.plans.map(p => stat(String(p.members), p.name))) : null,
    eyebrow('Needs attention', 'Auto-flagged'),
    b.attention.length
      ? card({ class: 'flush' }, b.attention.map(a => personRow(a.client, a.reason, clientPath(a.client.id), {
        trailing: h('span', { class: 'muted' }, icon(attentionIcon(a.kind), 15)),
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
    fill(head, screenHeader(`Coach · ${month}`, 'Business', segmented([['week', 'Week'], ['month', 'Month']], period, v => { period = v; draw(); })));
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

