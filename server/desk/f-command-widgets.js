/*
 * Command (WP1, F1): the five Command Centre tiles WP1 owns, all through
 * registerWidget: needs, today-sessions, inbox, letters and activity. Each
 * draws into the body the Today screen hands it and refreshes itself on live
 * events (onRefresh), so the screen never redraws as a whole.
 */
import {
  api, avatar, clients, fill, firstName, fmtCountdown, fmtRelative, fmtTime, h, icon, link, live, registerWidget, state, todayLondon,
} from './core.js';
import { getLettersOnly, load, needsYou, onLetters, onRefresh, setLettersOnly } from './f-command-core.js';
import { avatarStack, countUp, emptyHero, flash, openPanel, skeleton } from './ui.js';

const enc = encodeURIComponent;
const clientPath = (id, tab) => `/clients/${enc(id)}${tab ? `/${tab}` : ''}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A big number that counts up the first time it is drawn, then just changes. */
function bigNumber(value, { cls = '' } = {}) {
  const el = h('span', { class: `cmd-big ${cls}` }, '0');
  countUp(el, value);
  return el;
}
const errorBox = (err, retry) => h('div', { class: 'cmd-tile-error' }, h('p', { class: 'error', role: 'alert' }, err.message || String(err)),
  h('button', { type: 'button', class: 'btn small', onclick: retry }, 'Try again'));

// MARK: - needs (l, tall, hero): who needs you, ranked, one action each

const ACTION_PATH = {
  writeLetter: c => clientPath(c.id, 'letter'),
  reply: c => `/messages/${enc(c.id)}`,
  nudge: c => `/messages/${enc(c.id)}`,
  readAnswers: c => clientPath(c.id, 'forms'),
  readThoughts: c => clientPath(c.id),
};
const ACTION_ICON = { writeLetter: 'drafts', reply: 'reply', nudge: 'send', readAnswers: 'description', readThoughts: 'lightbulb' };
const REASON_TONE = { pain: 'urgent', priorityUnread: 'attention' };

function needsRow(item) {
  const c = item.client;
  const seen = new Set();
  const glyphs = (item.reasons || []).filter(r => !seen.has(r.iconKey) && seen.add(r.iconKey)).slice(0, 3)
    .map(r => h('span', { class: `cmd-glyph tone-${REASON_TONE[r.kind] || 'muted'}`, title: r.text }, icon(r.iconKey || r.kind, 17, { label: r.text })));
  const a = item.primaryAction;
  const to = a && ACTION_PATH[a.kind] ? ACTION_PATH[a.kind](c) : a?.kind === 'feature' ? a.path : null;
  const urgent = item.rank === 1;
  return h('li', { class: `cmd-need${urgent ? ' urgent' : ''}`, 'data-client': c.id },
    h('button', { type: 'button', class: 'cmd-need-main', 'aria-label': `${c.name}: ${item.reasonLine}. Open a quick view.`, onclick: () => openPanel('client', c.id) },
      avatar(c.initials || c.name, 40),
      h('span', { class: 'cmd-need-text' },
        h('span', { class: 'cmd-need-name' }, h('span', { class: 'strong clamp1' }, c.name),
          urgent ? h('span', { class: 'cmd-flag tone-urgent' }, icon('healing', 14), 'Urgent')
            : item.reasons?.[0]?.kind === 'priorityUnread' ? h('span', { class: 'cmd-flag tone-attention' }, icon('arrow_circle_up', 14), 'Priority') : null),
        h('span', { class: 'cmd-need-why clamp1' }, item.reasonLine))),
    h('span', { class: 'cmd-need-glyphs' }, glyphs),
    to ? link(to, { class: `btn small cmd-need-act${urgent ? ' primary' : ''}` }, icon(ACTION_ICON[a.kind] || 'chevron_right', 16), a.label || 'Open') : null);
}

registerWidget({
  id: 'needs', title: 'Needs you', icon: 'front_hand', size: 'l', tall: true, hero: true, order: 10,
  render: async (body, view) => {
    let data = null;
    const draw = () => {
      if (!data || !view.fresh()) return;
      const only = getLettersOnly();
      let items = data.items || [];
      const due = data.lettersDue;
      if (only && due) {
        const byId = new Map(items.map(i => [i.client.id, i]));
        items = due.clients.map(c => byId.get(c.id) ?? {
          client: { ...c, firstName: firstName(c.name) }, rank: 4, priority: false,
          reasons: [{ kind: 'checkinLetterDue', iconKey: 'letter', text: c.media ? 'Letter due · with a voice or video note' : 'Letter due' }],
          reasonLine: c.media ? 'Letter due · with a voice or video note' : 'Letter due', primaryAction: { kind: 'writeLetter', label: 'Write letter' },
        });
      }
      const urgent = items.filter(i => i.rank === 1).length;
      const head = h('div', { class: 'cmd-need-head' },
        bigNumber(items.length, { cls: 'serif' }),
        h('div', { class: 'cmd-need-sub' },
          h('div', { class: 'strong' }, only ? (items.length === 1 ? 'letter due' : 'letters due') : items.length === 1 ? 'person needs you' : 'people need you'),
          h('div', { class: 'small muted' }, only ? 'Showing letters only' : urgent ? `${urgent} urgent · most pressing first` : 'Most pressing first')),
        only ? h('button', { type: 'button', class: 'btn small text', onclick: () => setLettersOnly(false) }, 'Show everyone') : null);
      if (!items.length) {
        fill(body, head, emptyHero({ title: 'All caught up.', line: 'Nobody is waiting on you. Go coach someone.' }));
        return;
      }
      fill(body, head, h('ol', { class: 'cmd-needs', 'aria-label': 'Needs you, most pressing first' }, items.map(needsRow)));
    };
    const reload = async () => {
      try { data = await needsYou(); draw(); } catch (err) { if (view.fresh()) fill(body, errorBox(err, reload)); }
    };
    await reload();
    view.onLeave(onLetters(draw));
    onRefresh(view, reload);
  },
});

// MARK: - today-sessions (l): the day as a rail, then the list

const KIND_LABEL = { video: 'Video call', group: 'Class', inperson: '1:1' };
const minutesOf = iso => { const [hh, mm] = fmtTime(iso).split(':').map(Number); return hh * 60 + mm; };

/** Pairs of sessions that overlap (a local check; F20 conflicts join when present). */
function overlaps(list) {
  const out = new Set();
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    if (Date.parse(list[i].start) < Date.parse(list[j].end) && Date.parse(list[j].start) < Date.parse(list[i].end)) { out.add(list[i].id); out.add(list[j].id); }
  }
  return out;
}
const who = b => (b.kind === 'group' ? (b.title || 'Class') : b.client?.name || b.title || 'Session');

function dayRail(list, clash) {
  const now = new Date();
  const lo = Math.min(6 * 60, ...list.map(b => minutesOf(b.start))), hi = Math.max(21 * 60, ...list.map(b => minutesOf(b.end)));
  const pct = m => `${(((m - lo) / (hi - lo)) * 100).toFixed(2)}%`;
  const nowM = minutesOf(now.toISOString());
  const marks = [];
  for (let m = Math.ceil(lo / 180) * 180; m <= hi; m += 180) marks.push(m);
  return h('div', { class: 'cmd-rail', role: 'img', 'aria-label': `${plural(list.length, 'session')} between ${fmtTime(list[0]?.start) || '06:00'} and ${fmtTime(list.at(-1)?.end) || '21:00'}` },
    h('div', { class: 'cmd-rail-track' },
      list.map(b => h('span', {
        class: `cmd-rail-block k-${b.kind}${Date.parse(b.end) < now.getTime() ? ' past' : ''}${clash.has(b.id) ? ' clash' : ''}`,
        style: { left: pct(minutesOf(b.start)), width: `max(6px, ${(((minutesOf(b.end) - minutesOf(b.start)) / (hi - lo)) * 100).toFixed(2)}%)` },
        title: `${fmtTime(b.start)} ${who(b)}`,
      })),
      nowM >= lo && nowM <= hi ? h('span', { class: 'cmd-rail-now', style: { left: pct(nowM) } }) : null),
    h('div', { class: 'cmd-rail-scale', 'aria-hidden': 'true' }, marks.map(m => h('span', { style: { left: pct(m) } }, `${String(Math.floor(m / 60)).padStart(2, '0')}:00`))));
}

function sessionRow(b, clash, nextId) {
  const now = Date.now();
  const done = Date.parse(b.end) <= now, on = Date.parse(b.start) <= now && !done;
  const status = on ? h('span', { class: 'cmd-sess-now' }, h('span', { class: 'cmd-live-dot', 'aria-hidden': 'true' }), 'Now')
    : done ? h('span', { class: 'cmd-sess-done' }, icon('check', 15), 'Done')
      : b.id === nextId ? h('span', { class: 'cmd-sess-next' }, fmtCountdown(b.start) || 'Next') : null;
  const people = b.kind === 'group' ? b.attendees || [] : [];
  return h('li', { class: `cmd-sess k-${b.kind}${done ? ' past' : ''}${on ? ' on' : ''}` },
    h('span', { class: 'cmd-sess-time t-num' }, fmtTime(b.start)),
    h('span', { class: 'cmd-sess-bar', 'aria-hidden': 'true' }),
    link(b.client ? clientPath(b.client.id, 'sessions') : '/schedule', { class: 'cmd-sess-main' },
      h('span', { class: 'strong clamp1' }, who(b)),
      h('span', { class: 'small muted clamp1' },
        [...new Set([b.purpose === 'planning' ? 'Planning session' : b.purpose === 'review' ? 'Review call' : KIND_LABEL[b.kind], b.location || null,
          people.length ? plural(people.length, 'person', 'people') : null].filter(Boolean))].join(' · '))),
    people.length ? avatarStack(people, { max: 3, size: 24 }) : null,
    clash.has(b.id) || b.conflict ? h('span', { class: 'cmd-flag tone-attention' }, icon('event_busy', 14), 'Overlaps') : null,
    status);
}

registerWidget({
  id: 'today-sessions', title: 'Today’s sessions', icon: 'calendar_month', size: 'l', order: 40, action: { label: 'Calendar', path: '/schedule' },
  render: async (body, view) => {
    const reload = async () => {
      try {
        const day = todayLondon();
        const { bookings } = await load(`/api/bookings?from=${day}&to=${day}`);
        if (!view.fresh()) return;
        const list = bookings.filter(b => !b.cancelled);
        if (!list.length) { fill(body, emptyHero({ icon: 'event_available', title: 'No sessions today.', line: 'A clear day: letters, programming, or a rest.', action: { label: 'Open the calendar', path: '/schedule' } })); return; }
        const clash = overlaps(list);
        const next = list.find(b => Date.parse(b.start) > Date.now());
        const done = list.filter(b => Date.parse(b.end) <= Date.now()).length;
        fill(body,
          h('div', { class: 'cmd-sess-head' }, bigNumber(list.length), h('span', { class: 'small muted' }, `${list.length === 1 ? 'session' : 'sessions'} · ${done} done`),
            next ? h('span', { class: 'cmd-sess-up' }, 'Next ', h('strong', null, firstName(who(next))), ` at ${fmtTime(next.start)}`) : null),
          dayRail(list, clash),
          h('ol', { class: 'cmd-sessions' }, list.slice(0, 6).map(b => sessionRow(b, clash, next?.id))),
          list.length > 6 ? link('/schedule', { class: 'small muted' }, `and ${list.length - 6} more`) : null);
      } catch (err) { if (view.fresh()) fill(body, errorBox(err, reload)); }
    };
    await reload();
    onRefresh(view, reload, { types: ['booking.', 'calendar.', 'hold.'] });
  },
});

// MARK: - inbox (s): open items by kind

const KIND_META = [
  ['flag', 'Flags', 'urgent'], ['message', 'Messages', 'data'], ['voice', 'Voice', 'video'], ['checkin', 'Check-ins', 'ok'],
  ['form', 'Forms', 'accent'], ['draft', 'Drafts', 'muted'], ['lead', 'Leads', 'attention'], ['waitlist', 'Waitlist', 'muted'],
];

registerWidget({
  id: 'inbox', title: 'Inbox', icon: 'inbox', size: 's', order: 20, action: { label: 'Open', path: '/inbox' },
  render: async (body, view) => {
    const reload = async () => {
      try {
        const { counts } = await load('/api/inbox?limit=1');
        if (!view.fresh()) return;
        const parts = KIND_META.filter(([k]) => counts[k] > 0);
        if (!counts.all) { fill(body, h('div', { class: 'cmd-zero' }, h('span', { class: 'cmd-big serif' }, '0'), h('div', { class: 'small muted' }, 'Inbox zero. Go coach someone.'))); return; }
        fill(body,
          h('div', { class: 'cmd-stat' }, bigNumber(counts.all), h('span', { class: 'small muted' }, counts.all === 1 ? 'open item' : 'open items')),
          h('div', { class: 'cmd-stack', role: 'img', 'aria-label': parts.map(([k, label]) => `${label} ${counts[k]}`).join(', ') },
            parts.map(([k, , tone]) => h('span', { class: `cmd-seg t-${tone}`, style: { flexGrow: String(counts[k]) } }))),
          h('ul', { class: 'cmd-legend' }, parts.map(([k, label, tone]) => h('li', null,
            link(`/inbox/${k}`, null, h('span', { class: `cmd-key t-${tone}`, 'aria-hidden': 'true' }), label, h('span', { class: 't-num strong' }, String(counts[k])))))),
          counts.snoozed ? h('div', { class: 'tiny faint cmd-snoozed' }, icon('snooze', 13), ` ${counts.snoozed} snoozed`) : null);
      } catch (err) { if (view.fresh()) fill(body, errorBox(err, reload)); }
    };
    await reload();
    onRefresh(view, reload);
  },
});

// MARK: - letters (s): letters due this week, with the letters-only switch

registerWidget({
  id: 'letters', title: 'Letters due', icon: 'drafts', size: 's', order: 30,
  render: async (body, view) => {
    let data = null;
    const draw = () => {
      if (!data || !view.fresh()) return;
      const due = data.lettersDue || { count: 0, clients: [] };
      if (!due.count) {
        fill(body, h('div', { class: 'cmd-zero' }, h('span', { class: 'cmd-done-ring' }, icon('check', 22)), h('div', { class: 'small muted' }, 'Every letter this week is written.')));
        return;
      }
      const only = getLettersOnly();
      fill(body,
        h('div', { class: 'cmd-stat' }, bigNumber(due.count), h('span', { class: 'small muted' }, `about ${due.estMinutes} min`)),
        h('div', { class: 'cmd-letters-who' }, avatarStack(due.clients.map(c => ({ name: c.name, initials: c.initials })), { max: 5, size: 28 }),
          h('span', { class: 'small muted clamp1' }, due.clients.slice(0, 3).map(c => firstName(c.name)).join(', ') + (due.clients.length > 3 ? '…' : ''))),
        h('button', { type: 'button', class: `btn small cmd-letters-toggle${only ? ' on' : ''}`, 'aria-pressed': String(only), onclick: () => setLettersOnly(!getLettersOnly()) },
          icon(only ? 'visibility' : 'filter_alt', 15), only ? 'Showing letters only' : 'Show only letters'));
    };
    const reload = async () => {
      try { data = await needsYou(); draw(); } catch (err) { if (view.fresh()) fill(body, errorBox(err, reload)); }
    };
    await reload();
    view.onLeave(onLetters(draw));
    view.onLeave(() => setLettersOnly(false));
    onRefresh(view, reload, { types: ['letter.', 'checkin.'] });
  },
});

// MARK: - activity (full): the live feed

const lowerFirst = s => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
/** Who did it and what, as a sentence: ["Priya", "sent a message"], ["You", "messaged Sam"]. */
export function phrase(type, summary, client) {
  const who = client ? firstName(client.name) : null;
  const s = summary || '';
  if (!who) return [null, s];
  switch (type) {
    case 'message.received': return [who, /^voice/i.test(s) ? 'sent a voice note' : 'sent a message'];
    case 'message.sent': return ['You', `messaged ${who}`];
    case 'checkin.submitted': return [who, 'sent their weekly check-in'];
    case 'form.sent': return ['You', `sent ${who} ${s.replace(/^Sent\s+/, '')}`];
    case 'letter.published': return ['You', `published ${who}’s letter`];
    case 'letter.delivered': return [who, 'got their letter'];
    case 'client.joined': return [client.name, 'joined'];
    case 'client.tagged': return ['You', `tagged ${who} ${s.replace(/^Tagged\s+/, '')}`];
    case 'client.untagged': return ['You', `untagged ${who}`];
    case 'membership.changed': return [who, `moved plan · ${s.replace(/^Plan:\s*/, '')}`];
    default: return [who, lowerFirst(s)];
  }
}

function activityRow(a, { fresh = false } = {}) {
  const [actor, text] = phrase(a.type, a.summary, a.client);
  const parts = [
    h('span', { class: `cmd-act-icon tone-${a.tone || 'data'}` }, icon(a.icon || 'bolt', 16)),
    h('span', { class: 'cmd-act-text clamp1' }, actor ? h('span', { class: 'strong' }, actor, ' ') : null, h('span', { class: actor ? 'muted' : '' }, text)),
    h('time', { class: 'cmd-act-time', datetime: a.at, title: new Date(a.at).toLocaleString('en-GB') }, fmtRelative(a.at)),
  ];
  const el = h('li', { class: 'cmd-act', 'data-key': a.key }, a.path ? link(a.path, { class: 'cmd-act-row' }, parts) : h('span', { class: 'cmd-act-row' }, parts));
  if (fresh) requestAnimationFrame(() => flash(el));
  return el;
}

/** A streamed event as a feed row (names from the client list). */
function fromLive(ev) {
  const c = ev.clientId ? state.clients?.find(x => x.id === ev.clientId) : null;
  const look = {
    'message.received': ['chat_bubble', 'data'], 'message.sent': ['send', 'data'], 'checkin.submitted': ['monitor_heart', 'data'], 'form.submitted': ['description', 'data'],
    'booking.created': ['event_available', 'ok'], 'booking.cancelled': ['event_busy', 'attention'], 'workout.completed': ['fitness_center', 'ok'], 'client.joined': ['person_add', 'ok'],
    'letter.published': ['drafts', 'accent'], 'letter.delivered': ['drafts', 'accent'],
  }[ev.type] ?? ['bolt', 'data'];
  const path = !ev.clientId ? null : ev.type.startsWith('message.') ? `/messages/${enc(ev.clientId)}` : clientPath(ev.clientId);
  return { key: `ev:${ev.seq}`, seq: ev.seq, type: ev.type, at: new Date().toISOString(), summary: ev.summary || ev.type, icon: look[0], tone: look[1],
    client: c ? { id: c.id, name: c.name } : null, path };
}
const QUIET_TYPES = new Set(['day.started', 'inbox.done', 'notification', 'poll', 'live.connected']);

registerWidget({
  id: 'activity', title: 'Activity', icon: 'timeline', size: 'full', order: 900,
  render: async (body, view) => {
    const tileEl = body.closest('.ui-tile');
    const status = h('span', { class: 'cmd-live' });
    const drawStatus = mode => fill(status, h('span', { class: `cmd-live-dot${mode === 'stream' ? '' : ' off'}`, 'aria-hidden': 'true' }), mode === 'stream' ? 'Live' : 'Updating every 30 s');
    drawStatus(live.mode);
    tileEl?.querySelector('.ui-tile-head')?.append(status);
    view.onLeave(live.onStatus(drawStatus));
    const list = h('ol', { class: 'cmd-acts', 'aria-live': 'polite', 'aria-label': 'Latest activity' });
    const more = h('button', { type: 'button', class: 'btn small text cmd-more' }, 'Show more');
    let next = null;
    const page = async (append = false) => {
      const out = await api('GET', `/api/command/activity?limit=${append ? 20 : 12}${append && next ? `&before=${enc(next)}` : ''}`);
      if (!view.fresh()) return;
      next = out.next;
      const known = new Set([...list.children].map(li => li.dataset.key));
      const rows = out.items.filter(a => !known.has(a.key)).map(a => activityRow(a));
      if (append) list.append(...rows); else list.replaceChildren(...rows);
      more.hidden = !next;
      if (!list.children.length) fill(body, emptyHero({ icon: 'timeline', title: 'Quiet so far.', line: 'Messages, check-ins, bookings and workouts land here as they happen.' }));
    };
    more.addEventListener('click', () => page(true).catch(() => {}));
    fill(body, skeleton('table', { rows: 4 }));
    try {
      await page();
      if (view.fresh() && list.children.length) fill(body, list, more);
    } catch (err) { if (view.fresh()) fill(body, errorBox(err, () => page())); return; }
    clients().catch(() => null);
    const off = live.on('*', ev => {
      if (QUIET_TYPES.has(ev.type) || !ev.seq) { if (ev.type === 'poll') page().catch(() => {}); return; }
      if (list.querySelector(`[data-key="ev:${ev.seq}"]`)) return;
      if (!list.isConnected) fill(body, list, more);
      list.prepend(activityRow(fromLive(ev), { fresh: true }));
      while (list.children.length > 40) list.lastElementChild.remove();
    });
    view.onLeave(off);
  },
});
