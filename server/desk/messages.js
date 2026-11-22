/*
 * Messages: the coach's conversations (the iPhone app's CoachThreadsView) and
 * one client's thread (MessagesThreadView, coach side).
 *
 * Wide screens: the thread list on the left, the conversation on the right.
 * Phone width: the list at #/messages, the thread at #/messages/<clientId>.
 * Both poll every 15 seconds while on screen, as the iPhone app does.
 */
import {
  api, avatar, clearDraft, clients, emptyCard, errorLine, fill, fmtShort, fmtTime, h, icon, link, loading, londonParts,
  q, readDraft, refreshBadges, route, screenHeader, state, todayLondon, writeDraft, DAYS, MONTHS, parseDay,
} from './core.js';

const POLL_MS = 15_000;
/** The last thread list, so moving between conversations draws at once. */
let threadsCache = null;

/** A paper plane for the send button (core.js has no such icon): the core icon with its path swapped. */
function planeIcon(size) {
  const svg = icon('chevron', size);
  svg.firstChild.setAttribute('d', 'M21 3L10 14M21 3l-7 18-4-7-7-4z');
  return svg;
}

const draftKey = id => `jk.desk.msgdraft.${id}`;
const fmtShortDay = s => { const d = parseDay(s); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
/** "Today 14:30" or "Mon 3 Nov 14:30": the label above each day's first message. */
const dayLabel = iso => { const { day, time } = londonParts(iso); return day === todayLondon() ? `Today ${time}` : `${fmtShortDay(day)} ${time}`; };

route('/messages/:id?', async (el, { id }, view) => {
  const listBox = h('div', { class: 'thread-list' });
  const pane = h('section', { class: 'thread-pane' });
  const layout = h('div', { class: 'msg-layout' + (id ? ' has-thread' : '') },
    h('div', { class: 'msg-side' }, screenHeader('Coach', 'Messages'), listBox), pane);
  el.append(layout);

  // MARK: Thread list

  let threads = threadsCache;
  let listError = null;
  const drawList = () => {
    if (!threads) { fill(listBox, listError ? errorLine(listError) : loading()); return; }
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

  // MARK: Conversation

  if (!id) {
    fill(pane, h('div', { class: 'pane-empty' }, emptyCard('bubble', 'Choose a conversation', 'Pick a client on the left to read and reply.')));
    return;
  }
  const known = threads?.find(t => t.client.id === id)?.client || state.clients?.find(c => c.id === id) || null;
  await openThread(pane, id, known?.name, view, () => {
    const t = threads?.find(x => x.client.id === id);
    if (t && t.unread) { t.unread = 0; drawList(); }
    refreshBadges();
  }, m => {
    // Keep the list's preview in step with what was just sent.
    const t = threads?.find(x => x.client.id === id);
    if (t) { t.last = m; threads.sort((a, b) => (b.last?.at ?? '').localeCompare(a.last?.at ?? '')); drawList(); }
  });
});

/** The conversation with one client: bubbles by day, a composer, and polling for new messages. */
async function openThread(pane, clientId, knownName, view, onRead, onSent) {
  let name = knownName || '';
  const title = h('div', { class: 'strong' }, name || 'Client');
  const head = h('header', { class: 'thread-head' },
    link('/messages', { class: 'icon-btn thread-back', 'aria-label': 'All conversations' }, icon('back', 16)),
    avatar(name || '?', 30),
    h('div', { class: 'grow' }, title, h('div', { class: 'tiny faint' }, 'Client')),
    link(`/clients/${encodeURIComponent(clientId)}`, { class: 'btn small' }, 'Open client'));
  const log = h('div', { class: 'thread-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Messages' }, loading());
  const sendError = h('div', { class: 'thread-error' });
  const input = h('textarea', { class: 'composer', rows: '1', maxlength: '4000', placeholder: 'Message', 'aria-label': 'Message' });
  const sendBtn = h('button', { class: 'send-btn', type: 'button', 'aria-label': 'Send', title: 'Send (Enter)', onclick: () => send() }, planeIcon(17));
  fill(pane, head, log, sendError, h('div', { class: 'compose-row' }, input, sendBtn));

  let messages = null;
  const me = state.me?.id;

  const draft = readDraft(draftKey(clientId));
  if (typeof draft === 'string') input.value = draft;
  const sizeInput = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; };
  const syncSend = () => { sendBtn.disabled = !input.value.trim(); };
  input.addEventListener('input', () => {
    sizeInput(); syncSend();
    if (input.value) writeDraft(draftKey(clientId), input.value); else clearDraft(draftKey(clientId));
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  syncSend();

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
      out.push(h('div', { class: 'bubble ' + (mine ? 'me' : 'them') },
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
      onRead();
      return;
    }
    const seen = new Set(messages.map(m => m.id));
    const fresh = out.messages.filter(m => !seen.has(m.id));
    if (fresh.length) { messages.push(...fresh); draw(); onRead(); }
  }

  async function send() {
    const text = input.value.trim();
    if (!text || sendBtn.disabled) return;
    sendBtn.disabled = true;
    fill(sendError);
    try {
      const m = await api('POST', '/api/messages', { clientId, text });
      if (!view.fresh()) return;
      if (!messages.some(x => x.id === m.id)) messages.push(m);
      input.value = '';
      clearDraft(draftKey(clientId));
      sizeInput();
      draw.first = true;
      draw();
      onSent(m);
    } catch (err) {
      fill(sendError, errorLine(err));
    } finally {
      syncSend();
    }
  }

  try {
    await load();
  } catch (err) {
    if (view.fresh()) fill(log, errorLine(err.status === 404 ? 'That client isn’t one of yours.' : err));
    return;
  }
  if (!view.fresh()) return;
  if (!name) {
    // Opened straight from a link before the list arrived: find the name.
    let found = threadsCache?.find(x => x.client.id === clientId)?.client;
    if (!found) { try { found = (await clients()).find(c => c.id === clientId); } catch { found = null; } }
    if (!view.fresh()) return;
    if (found) {
      name = found.name;
      fill(title, name);
      head.replaceChild(avatar(name, 30), head.children[1]);
      if (!messages.length) draw();
    }
  }
  if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true });
  const timer = setInterval(() => { if (view.fresh()) load().catch(() => { /* try again next tick */ }); }, POLL_MS);
  view.onLeave(() => clearInterval(timer));
}
