/*
 * Messages: the coach's conversations (the iPhone app's CoachThreadsView) and
 * one client's thread (MessagesThreadView, coach side).
 *
 * Wide screens: the thread list on the left, the conversation on the right.
 * Phone width: the list at #/messages, the thread at #/messages/<clientId>.
 *
 * threadPane(el, clientId, view, {compact}) draws one conversation with the
 * shared composer (composer.js), so composer tools and send guards run; the
 * Inbox (WP1) mounts it too. It polls every 15 seconds and refreshes at once
 * on a live event for this client. It tells its host what happened through
 * DOM events on `el`: 'thread-read' and 'thread-sent' (detail: the message).
 */
import {
  api, avatar, clients, emptyCard, errorLine, fill, fmtShort, fmtTime, h, icon, link, live, londonParts,
  q, refreshBadges, route, screenHeader, setCrumbs, state, todayLondon, DAYS, MONTHS, parseDay,
} from './core.js';
import { composer } from './composer.js';
import { skeleton } from './ui.js';

const POLL_MS = 15_000;
/** The last thread list, so moving between conversations draws at once. */
let threadsCache = null;

const draftKey = id => `jk.desk.msgdraft.${id}`;
const fmtShortDay = s => { const d = parseDay(s); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
/** "Today 14:30" or "Mon 3 Nov 14:30": the label above each day's first message. */
const dayLabel = iso => { const { day, time } = londonParts(iso); return day === todayLondon() ? `Today ${time}` : `${fmtShortDay(day)} ${time}`; };

route('/messages/:id?', async (el, { id }, view) => {
  const listBox = h('div', { class: 'thread-list' });
  const pane = h('section', { class: 'thread-pane' });
  const layout = h('div', { class: 'msg-layout' + (id ? ' has-thread' : '') },
    h('div', { class: 'msg-side' }, screenHeader('Engage', 'Messages'), listBox), pane);
  el.append(layout);

  // MARK: Thread list

  let threads = threadsCache;
  let listError = null;
  const drawList = () => {
    if (!threads) { fill(listBox, listError ? errorLine(listError) : skeleton('table', { rows: 6 })); return; }
    if (!threads.length) { fill(listBox, emptyCard('messages', 'No conversations yet')); return; }
    fill(listBox, listError ? errorLine(listError) : null, h('div', { class: 'card flush' }, threads.map(t => {
      const at = t.last?.at;
      const sel = t.client.id === id;
      return link(`/messages/${encodeURIComponent(t.client.id)}`, { class: 'thread-row' + (sel ? ' sel' : ''), 'aria-current': sel ? 'page' : null },
        avatar(t.client.name, 34),
        h('div', { class: 'grow' },
          h('div', { class: 'spread' },
            h('span', { class: 'strong small clamp1' }, t.client.name),
            at ? h('span', { class: 'tiny faint nowrap' }, londonParts(at).day === todayLondon() ? fmtTime(at) : fmtShort(londonParts(at).day)) : null),
          h('div', { class: 'tiny faint clamp1' }, t.last?.text || 'No messages')),
        t.unread > 0 ? h('span', { class: 'badge' }, String(t.unread)) : null);
    })));
  };
  async function loadList() {
    try {
      const out = (await api('GET', '/api/threads')).threads;
      if (!view.fresh()) return;
      // The open thread is being read, so it has nothing unread.
      for (const t of out) if (t.client.id === id) t.unread = 0;
      threads = threadsCache = out;
      listError = null;
    } catch (err) {
      if (!view.fresh()) return;
      listError = err;
    }
    drawList();
  }
  drawList();
  loadList();
  const listTimer = setInterval(() => { if (view.fresh()) loadList(); }, POLL_MS);
  view.onLeave(() => clearInterval(listTimer));
  view.onLeave(live.on('message.received', () => { if (view.fresh()) loadList(); }));

  // MARK: Conversation

  if (!id) {
    fill(pane, h('div', { class: 'pane-empty' }, emptyCard('bubble', 'Choose a conversation', 'Pick a client on the left to read and reply.')));
    return;
  }
  pane.addEventListener('thread-read', () => {
    const t = threads?.find(x => x.client.id === id);
    if (t && t.unread) { t.unread = 0; drawList(); }
    refreshBadges();
  });
  pane.addEventListener('thread-sent', e => {
    // Keep the list's preview in step with what was just sent.
    const t = threads?.find(x => x.client.id === id);
    if (t) { t.last = e.detail; threads.sort((a, b) => (b.last?.at ?? '').localeCompare(a.last?.at ?? '')); drawList(); }
  });
  pane.addEventListener('thread-name', e => setCrumbs([{ label: 'Messages', path: '/messages' }, { label: e.detail }]));
  await threadPane(pane, id, view);
});

/**
 * One client's conversation: bubbles by day, the shared composer, polling and
 * live refresh. `compact` drops the back link and tightens the head (Inbox).
 * Returns {reload(), composer} once the first load is done.
 */
export async function threadPane(el, clientId, view, { compact = false } = {}) {
  const known = threadsCache?.find(t => t.client.id === clientId)?.client || state.clients?.find(c => c.id === clientId) || null;
  let name = known?.name || '';
  const title = h('div', { class: 'strong' }, name || 'Client');
  const avatarSlot = h('span', null, avatar(name || '?', 30));
  const head = h('header', { class: 'thread-head' },
    compact ? null : link('/messages', { class: 'icon-btn thread-back', 'aria-label': 'All conversations' }, icon('back', 16)),
    avatarSlot,
    h('div', { class: 'grow' }, title, h('div', { class: 'tiny faint' }, 'Client')),
    link(`/clients/${encodeURIComponent(clientId)}`, { class: 'btn small' }, 'Open client'));
  const log = h('div', { class: 'thread-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Messages' }, skeleton('lines', { rows: 4 }));
  const me = state.me?.id;
  let messages = null;

  const box = composer({
    clientId, draftKey: draftKey(clientId), compact, placeholder: 'Message', label: 'Message',
    onSend: async ({ text, mediaId, kind }) => {
      const body = { clientId, text };
      if (mediaId) { body.mediaId = mediaId; if (kind && kind !== 'text') body.kind = kind; }
      const m = await api('POST', '/api/messages', body);
      if (!view.fresh()) return;
      if (!messages.some(x => x.id === m.id)) messages.push(m);
      draw.first = true;
      draw();
      el.dispatchEvent(new CustomEvent('thread-sent', { detail: m }));
    },
  });
  fill(el, head, log, h('div', { class: 'thread-compose' }, box.el));
  el.classList.add('thread-pane');
  if (compact) el.classList.add('compact');

  function draw() {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    if (!messages.length) {
      fill(log, emptyCard('bubble', 'No messages yet', `Say hello to ${name || 'your client'}.`));
      return;
    }
    let lastDay = null;
    const out = [];
    for (const m of messages) {
      const { day, time } = londonParts(m.at);
      if (day !== lastDay) { out.push(h('div', { class: 'day-sep' }, dayLabel(m.at))); lastDay = day; }
      const mine = me ? m.fromId === me : m.fromRole === 'coach';
      out.push(h('div', { class: 'bubble ' + (mine ? 'me' : 'them'), 'data-id': m.id },
        m.workoutId ? h('div', { class: 'bubble-workout' }, h('span', { class: 'tile' }, icon('dumbbell', 18)),
          h('div', null, h('div', { class: 'small strong' }, 'Workout'), h('div', { class: 'tiny sub' }, 'Plan updated · see your Plan tab'))) : null,
        m.text ? h('div', { class: 'text' }, m.text) : null,
        h('div', { class: 'when' }, mine && m.readAt ? `${time} · Read` : time)));
    }
    fill(log, out);
    if (nearBottom || draw.first) log.scrollTop = log.scrollHeight;
    draw.first = false;
  }
  draw.first = true;

  /** First load fetches the thread; each poll asks only for what came after the last one. */
  async function load() {
    const after = messages?.at(-1)?.at;
    const out = await api('GET', `/api/messages?${q({ clientId, after })}`);
    if (!view.fresh()) return;
    if (!messages) {
      messages = out.messages;
      draw();
      el.dispatchEvent(new CustomEvent('thread-read'));
      return;
    }
    const seen = new Set(messages.map(m => m.id));
    const fresh = out.messages.filter(m => !seen.has(m.id));
    if (fresh.length) { messages.push(...fresh); draw(); el.dispatchEvent(new CustomEvent('thread-read')); }
  }

  try {
    await load();
  } catch (err) {
    if (view.fresh()) fill(log, errorLine(err.status === 404 ? 'That client isn’t one of yours.' : err));
    return null;
  }
  if (!view.fresh()) return null;
  if (!name) {
    // Opened straight from a link before the list arrived: find the name.
    let found = threadsCache?.find(x => x.client.id === clientId)?.client;
    if (!found) { try { found = (await clients()).find(c => c.id === clientId); } catch { found = null; } }
    if (!view.fresh()) return null;
    if (found) {
      name = found.name;
      fill(title, name);
      fill(avatarSlot, avatar(name, 30));
      if (!messages.length) draw();
    }
  }
  if (name) el.dispatchEvent(new CustomEvent('thread-name', { detail: name }));
  if (matchMedia('(pointer: fine)').matches) box.focus();
  const reload = () => load().catch(() => { /* try again next tick */ });
  const timer = setInterval(() => { if (view.fresh()) reload(); }, POLL_MS);
  view.onLeave(() => clearInterval(timer));
  view.onLeave(live.on('message.received', ev => { if (view.fresh() && ev.clientId === clientId) reload(); }));
  return { reload, composer: box };
}
