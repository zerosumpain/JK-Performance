/*
 * Messages: the coach's conversations (the iPhone app's CoachThreadsView) and
 * one client's thread (MessagesThreadView, coach side), redesigned for desk v2 (F19).
 *
 * Wide screens: the thread list on the left, the conversation in the middle and,
 * from 1280 px, a context pane on the right (the client's mini 360). Phone width:
 * the list at #/messages, the thread at #/messages/<clientId>.
 *
 * threadPane(el, clientId, view, {compact}) draws one conversation with the
 * shared composer (composer.js), so composer tools and send guards run; the
 * Inbox (WP1) mounts it too. Bubbles group by sender and day; images open in a
 * lightbox, videos play inline, voice notes are VoiceBubbles (f-voice.js). It
 * polls with `since` every 15 s and refreshes at once on a live event for this
 * client, merging `updated` (a transcript arriving) by id. It tells its host
 * what happened through DOM events on `el`: 'thread-read', 'thread-sent'
 * (detail: the message) and 'thread-name'.
 *
 * `#/messages/<id>?draft=<reviewId>` opens with an AI draft or a draft awaiting
 * approval in the composer (F18); sending it records `approved`.
 */
import {
  api, apiBlob, avatar, clients, emptyCard, errorLine, fill, firstName, fmtShort, fmtTime, foundationApi, h, hasFeature, hashQuery, icon, link, live, londonParts,
  q, refreshBadges, route, screenHeader, setCrumbs, setHashQuery, state, toast, todayLondon, DAYS, MONTHS, parseDay,
} from './core.js';
import { composer } from './composer.js';
import { aiStatus, briefBody } from './f-ai.js';
import { consentChip, fmtSecs, voiceBubble } from './f-voice.js';
import { pushLayer, scoreRing, skeleton } from './ui.js';

const POLL_MS = 15_000;
const enc = encodeURIComponent;
/** The last thread list, so moving between conversations draws at once. */
let threadsCache = null;

const draftKey = id => `jk.desk.msgdraft.${id}`;
const fmtShortDay = s => { const d = parseDay(s); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
/** "Today", "Yesterday" or "Mon 3 Nov": the separator above each day's first message. */
function dayLabel(iso) {
  const { day } = londonParts(iso);
  const today = todayLondon();
  if (day === today) return 'Today';
  const y = parseDay(today); y.setUTCDate(y.getUTCDate() - 1);
  return day === y.toISOString().slice(0, 10) ? 'Yesterday' : fmtShortDay(day);
}
/** The list's preview line: a glyph for voice and media, then the text. */
function preview(m) {
  if (!m) return [h('span', null, 'No messages')];
  const who = m.fromRole === 'coach' ? 'You: ' : '';
  if (m.kind === 'voice') return [icon('mic', 14), h('span', null, `${who}${m.text?.startsWith('Voice note') ? m.text : `Voice note · ${m.text}`}`)];
  if (m.mediaKind === 'image') return [icon('image', 14), h('span', null, `${who}${m.text || 'Photo'}`)];
  if (m.mediaKind === 'video') return [icon('videocam', 14), h('span', null, `${who}${m.text || 'Video'}`)];
  return [h('span', null, `${who}${m.text}`)];
}

route('/messages/:id?', async (el, { id }, view) => {
  const listBox = h('div', { class: 'thread-list' });
  const filter = h('input', { type: 'search', class: 'thread-filter', placeholder: 'Find a conversation', 'aria-label': 'Find a conversation' });
  const pane = h('section', { class: 'thread-pane' });
  const layout = h('div', { class: 'msg-layout' + (id ? ' has-thread' : '') },
    h('div', { class: 'msg-side' }, screenHeader('Engage', 'Messages'), h('div', { class: 'thread-filter-row' }, icon('search', 16), filter), listBox), pane);
  el.append(layout);

  // MARK: Thread list

  let threads = threadsCache;
  let listError = null;
  const drawList = () => {
    if (!threads) { fill(listBox, listError ? errorLine(listError) : skeleton('table', { rows: 6 })); return; }
    if (!threads.length) { fill(listBox, emptyCard('messages', 'No conversations yet')); return; }
    const needle = filter.value.trim().toLowerCase();
    const shown = needle ? threads.filter(t => t.client.name.toLowerCase().includes(needle)) : threads;
    fill(listBox, listError ? errorLine(listError) : null, shown.length ? shown.map(t => {
      const at = t.last?.at;
      const sel = t.client.id === id;
      const flagged = t.last?.voice?.flags?.length;
      return link(`/messages/${enc(t.client.id)}`, { class: 'thread-row' + (sel ? ' sel' : '') + (t.unread ? ' unread' : ''), 'aria-current': sel ? 'page' : null },
        avatar(t.client.name, 38),
        h('div', { class: 'grow' },
          h('div', { class: 'spread' },
            h('span', { class: 'thread-name clamp1' }, t.client.name),
            at ? h('span', { class: 'thread-when nowrap' }, londonParts(at).day === todayLondon() ? fmtTime(at) : fmtShort(londonParts(at).day)) : null),
          h('div', { class: 'thread-preview clamp1' + (flagged ? ' flagged' : '') }, preview(t.last))),
        t.unread > 0 ? h('span', { class: 'badge' }, String(t.unread)) : null);
    }) : h('p', { class: 'small faint thread-none' }, 'No one by that name.'));
  };
  filter.addEventListener('input', drawList);
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
    fill(pane, h('div', { class: 'pane-empty' }, h('div', { class: 'pane-empty-inner' },
      h('span', { class: 'pane-empty-glyph' }, icon('forum', 30)),
      h('h2', { class: 'pane-empty-title' }, 'Pick a conversation'),
      h('p', { class: 'muted small' }, 'Read, listen and reply. Voice notes arrive with a transcript when the client has allowed it.'))));
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

// MARK: - Media: lightbox and inline video

function lightbox(url, alt) {
  const img = h('img', { alt, class: 'msg-lightbox-img' });
  const close = () => { unlayer(); box.remove(); };
  const box = h('div', { class: 'msg-lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': alt, onclick: e => { if (e.target === box) close(); } },
    img, h('button', { type: 'button', class: 'msg-lightbox-x', 'aria-label': 'Close', onclick: () => close() }, icon('close', 20)));
  const unlayer = pushLayer(close);
  document.body.append(box);
  apiBlob(url).then(b => { img.src = URL.createObjectURL(b); }, () => close());
  box.querySelector('button').focus();
}

function mediaBlock(m) {
  if (m.mediaKind === 'image' && m.mediaUrl) {
    const img = h('img', { alt: m.kind === 'mealPhoto' ? 'Meal photo' : 'Photo', class: 'msg-img', loading: 'lazy' });
    apiBlob(m.mediaUrl).then(b => { img.src = URL.createObjectURL(b); }, () => img.classList.add('broken'));
    return h('button', { type: 'button', class: 'msg-media msg-photo', 'aria-label': 'Open the photo', onclick: () => lightbox(m.mediaUrl, img.alt) }, img);
  }
  if (m.mediaKind === 'video' && m.mediaUrl) {
    const box = h('div', { class: 'msg-media msg-video' });
    const poster = h('button', { type: 'button', class: 'msg-video-poster', 'aria-label': m.kind === 'formCheck' ? 'Play the form check' : 'Play the video' },
      h('span', { class: 'msg-video-play' }, icon('play_arrow', 28, { filled: true })), h('span', { class: 'msg-video-label' }, m.kind === 'formCheck' ? 'Form check' : 'Video'));
    poster.addEventListener('click', async () => {
      poster.disabled = true;
      try {
        const b = await apiBlob(m.mediaUrl);
        const v = h('video', { controls: true, playsinline: true, class: 'msg-video-el', preload: 'metadata' });
        v.src = URL.createObjectURL(b);
        box.replaceChildren(v);
        v.play().catch(() => {});
      } catch { poster.disabled = false; toast('That video couldn’t be loaded.', { error: true }); }
    });
    box.append(poster);
    return box;
  }
  return null;
}

// MARK: - The context pane (≥ 1280 px): the client's mini 360

const daysLabel = n => (n === null || n === undefined ? 'None booked' : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`);

async function contextPane(box, clientId, getMessages) {
  const head = h('div', { class: 'ctx-head' });
  const facts = h('div', { class: 'ctx-facts' }, skeleton('lines', { rows: 4 }));
  const voice = h('div', { class: 'ctx-voice' });
  const brief = h('div', { class: 'ctx-brief' });
  fill(box, head, facts, voice, brief);
  const known = threadsCache?.find(t => t.client.id === clientId)?.client || state.clients?.find(c => c.id === clientId);
  const name = known?.name || '';
  // The health score is WP2's (crm); ask only when that feature is on this server (a 404 would show in the console).
  const [f, score, consent, catalogue, tags] = await Promise.all([
    foundationApi('GET', `/api/facts/clients/${enc(clientId)}`).catch(() => null),
    hasFeature('crm').then(on => (on ? foundationApi('GET', `/api/coach/clients/${enc(clientId)}/score`) : null)).catch(() => null),
    api('GET', `/api/coach/clients/${enc(clientId)}/ai-consent`).catch(() => null),
    foundationApi('GET', '/api/facts').catch(() => null),
    foundationApi('GET', '/api/tags').catch(() => null),
  ]);
  const v = f?.facts || {};
  let plan = state.clients?.find(c => c.id === clientId)?.plan;
  if (!plan) { try { plan = (await clients()).find(c => c.id === clientId)?.plan; } catch { plan = null; } }
  const scoreValue = score?.score ?? score?.value ?? null;
  fill(head,
    scoreValue !== null && scoreValue !== undefined ? scoreRing(scoreValue, { size: 64, label: 'Health' }) : avatar(name || '?', 56),
    h('div', { class: 'ctx-name' }, h('div', { class: 'ctx-title' }, name || 'Client'),
      h('div', { class: 'tiny faint' }, [plan && plan !== 'none' ? plan[0].toUpperCase() + plan.slice(1) : null, catLabel(catalogue, v, /stage$/)].filter(Boolean).join(' · ') || 'Client')),
    consent ? consentChip(consent.voice) : null);
  const row = (glyph, k, val, tone = null) => h('div', { class: 'ctx-row' }, icon(glyph, 16), h('span', { class: 'grow faint' }, k), h('span', { class: `strong t-num${tone ? ` tone-${tone}` : ''}` }, val));
  const sentiment = v['voice.sentiment14'];
  const tagNames = (v['core.tags'] || []).map(id => tags?.tags?.find(t => t.id === id)).filter(Boolean);
  const campaign = catLabel(catalogue, v, /^campaign/);
  fill(facts,
    h('div', { class: 'ui-eyebrow' }, 'At a glance'),
    row('calendar_month', 'Next session', daysLabel(v['core.nextSessionDays'])),
    row('bedtime_off', 'Quiet for', v['core.daysQuiet'] === null || v['core.daysQuiet'] === undefined ? '—' : `${v['core.daysQuiet']} day${v['core.daysQuiet'] === 1 ? '' : 's'}`, v['core.daysQuiet'] >= 7 ? 'attention' : null),
    row('task_alt', 'Adherence (28 d)', v['core.adherence28'] === null || v['core.adherence28'] === undefined ? '—' : `${Math.round(v['core.adherence28'])}%`),
    row('healing', 'Pain (14 d)', v['core.pain14'] ? 'Flagged' : 'None', v['core.pain14'] ? 'urgent' : null),
    sentiment !== null && sentiment !== undefined ? row('graphic_eq', 'Voice mood (14 d)', sentiment > 0.25 ? 'Positive' : sentiment < -0.25 ? 'Low' : 'Steady', sentiment < -0.25 ? 'attention' : sentiment > 0.25 ? 'ok' : null) : null,
    campaign ? row('campaign', 'Campaign', campaign) : null,
    tagNames.length ? h('div', { class: 'ctx-tags' }, tagNames.map(t => h('span', { class: `ctx-tag tag-${t.color || 'chart-1'}` }, t.name))) : null,
    link(`/clients/${enc(clientId)}`, { class: 'btn small ctx-open' }, 'Open client 360', icon('open_in_new', 14)));
  drawVoice();
  const btn = h('button', { type: 'button', class: 'btn small', onclick: () => { btn.remove(); briefBody(brief, { id: clientId, name }); } }, icon('summarize', 16), 'Brief me on the last 14 days');
  brief.append(btn);
  function drawVoice() {
    const notes = (getMessages() || []).filter(m => m.kind === 'voice' && m.fromRole === 'client' && m.voice?.status === 'done').slice(-3).reverse();
    fill(voice, notes.length ? [h('div', { class: 'ui-eyebrow' }, 'Recent voice notes'), notes.map(m => h('div', { class: 'ctx-note' },
      h('div', { class: 'spread tiny faint' }, h('span', null, `${dayLabel(m.at)} · ${fmtTime(m.at)}`), h('span', { class: 't-num' }, fmtSecs(m.voice.durationSec))),
      h('div', { class: 'small clamp2' }, m.voice.summary || m.voice.transcript || ''),
      m.voice.flags?.length ? h('div', { class: 'ctx-flag tone-urgent tiny' }, icon('warning', 13), m.voice.flags.map(x => x.kind === 'mentalHealth' ? 'low mood' : x.kind).join(', ')) : null))] : null);
  }
  return { drawVoice };
}

/** The label of the first enum fact whose id matches (stage, campaign), when a feature provides one. */
function catLabel(catalogue, values, re) {
  const fact = catalogue?.facts?.find(x => re.test(x.id) && values[x.id] !== null && values[x.id] !== undefined && values[x.id] !== false);
  if (!fact) return null;
  const val = values[fact.id];
  return fact.options?.find(o => o.value === val)?.label ?? (typeof val === 'string' ? val : null);
}

// MARK: - One conversation

/**
 * One client's conversation: bubbles by day, the shared composer, polling and
 * live refresh. `compact` drops the back link and the context pane (Inbox).
 * Returns {reload(), composer} once the first load is done.
 */
export async function threadPane(el, clientId, view, { compact = false } = {}) {
  const known = threadsCache?.find(t => t.client.id === clientId)?.client || state.clients?.find(c => c.id === clientId) || null;
  let name = known?.name || '';
  const title = h('div', { class: 'thread-title' }, name || 'Client');
  const sub = h('div', { class: 'tiny faint thread-sub' }, 'Client');
  const avatarSlot = h('span', null, avatar(name || '?', 34));
  const head = h('header', { class: 'thread-head' },
    compact ? null : link('/messages', { class: 'icon-btn thread-back', 'aria-label': 'All conversations' }, icon('back', 16)),
    avatarSlot,
    h('div', { class: 'grow' }, title, sub),
    link(`/clients/${enc(clientId)}`, { class: 'btn small' }, 'Open client'));
  const log = h('div', { class: 'thread-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Messages' }, skeleton('lines', { rows: 4 }));
  const ctx = compact ? null : h('aside', { class: 'thread-ctx', 'aria-label': 'About this client' });
  const draftBanner = h('div', { class: 'thread-draft', hidden: true });
  const me = state.me?.id;
  let messages = null;
  let cursor = null;
  let pendingDraft = null; // {id, kind} when the composer holds an AI draft or a draft awaiting approval
  let ctxApi = null;

  const box = composer({
    clientId, draftKey: draftKey(clientId), compact, placeholder: `Message ${firstName(name) || ''}`.trim(), label: 'Message',
    onSend: async ({ text, mediaId, kind, meta }) => {
      const body = { clientId, text };
      if (mediaId) { body.mediaId = mediaId; if (kind && kind !== 'text') body.kind = kind; }
      const m = await api('POST', '/api/messages', body);
      // Record what the coach did with an AI check, and an approved draft (F18). Never blocks the send.
      if (meta?.reviewId) api('POST', `/api/ai/review/${enc(meta.reviewId)}/decision`, { decision: meta.decision || 'sentOriginal', messageId: m.id }).catch(() => {});
      if (pendingDraft) {
        api('POST', `/api/ai/review/${enc(pendingDraft.id)}/decision`, { decision: 'approved', messageId: m.id }).catch(() => {});
        pendingDraft = null;
        draftBanner.hidden = true;
      }
      if (!view.fresh()) return;
      upsert([m]);
      draw.first = true;
      draw();
      el.dispatchEvent(new CustomEvent('thread-sent', { detail: m }));
    },
  });
  const main = h('div', { class: 'thread-main' }, log, h('div', { class: 'thread-compose' }, draftBanner, box.el));
  fill(el, head, h('div', { class: 'thread-body' + (compact ? '' : ' with-ctx') }, main, ctx));
  el.classList.add('thread-pane');
  el.dataset.clientId = clientId; // read by other features' thread extras (WP5's scheduled ghost bubbles)
  if (compact) el.classList.add('compact');

  const upsert = list => {
    for (const m of list) {
      const i = messages.findIndex(x => x.id === m.id);
      if (i >= 0) messages[i] = m; else messages.push(m);
    }
    messages.sort((a, b) => a.at.localeCompare(b.at));
  };

  function bubble(m, { mine, tail }) {
    const voice = m.kind === 'voice';
    const media = voice ? null : mediaBlock(m);
    const showText = voice ? !m.text?.startsWith('Voice note') : !!m.text && !(media && ['Meal photo', 'Form check'].includes(m.text));
    const cls = ['bubble', mine ? 'me' : 'them', voice ? 'voice' : '', media ? 'has-media' : '', tail ? 'tail' : '', m.kind === 'letter' ? 'letter' : ''].filter(Boolean).join(' ');
    return h('div', { class: cls, 'data-id': m.id },
      m.workoutId ? h('div', { class: 'bubble-workout' }, h('span', { class: 'tile' }, icon('dumbbell', 18)),
        h('div', null, h('div', { class: 'small strong' }, 'Workout'), h('div', { class: 'tiny sub' }, 'Plan updated · see your Plan tab'))) : null,
      m.kind === 'letter' ? h('div', { class: 'bubble-letter' }, icon('letter', 16), h('span', null, 'Letter delivered')) : null,
      m.reportId && m.kind !== 'letter' ? h('div', { class: 'bubble-quote' }, icon('reply', 14), 'Reply to your letter') : null,
      media,
      voice ? voiceBubble({ ...m, clientName: name }, { coachView: true, onChanged: () => reload() }) : null,
      showText ? h('div', { class: 'text' }, m.text) : null,
      h('div', { class: 'when' }, fmtTime(m.at), mine && m.readAt ? h('span', { class: 'read' }, icon('done_all', 13), 'Read') : null));
  }

  function draw() {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    if (!messages.length) {
      fill(log, h('div', { class: 'thread-empty' }, h('span', { class: 'pane-empty-glyph' }, icon('chat_bubble', 26)),
        h('h3', { class: 'pane-empty-title' }, `Say hello to ${firstName(name) || 'your client'}`), h('p', { class: 'small muted' }, 'Type below, or press the mic to send a voice note.')));
      return;
    }
    let lastDay = null;
    const out = [];
    messages.forEach((m, i) => {
      const { day } = londonParts(m.at);
      if (day !== lastDay) { out.push(h('div', { class: 'day-sep', role: 'separator' }, h('span', null, dayLabel(m.at)))); lastDay = day; }
      const mine = me ? m.fromId === me : m.fromRole === 'coach';
      const next = messages[i + 1];
      const tail = !next || next.fromRole !== m.fromRole || londonParts(next.at).day !== day || Date.parse(next.at) - Date.parse(m.at) > 5 * 60_000;
      out.push(bubble(m, { mine, tail }));
    });
    fill(log, out);
    if (nearBottom || draw.first) log.scrollTop = log.scrollHeight;
    draw.first = false;
    ctxApi?.drawVoice();
  }
  draw.first = true;

  /** First load fetches the thread; each refresh asks for what came after, and what changed since the cursor. */
  async function load() {
    if (!messages) {
      const out = await api('GET', `/api/messages?${q({ clientId })}`);
      if (!view.fresh()) return;
      messages = out.messages;
      cursor = out.cursor ?? null;
      draw();
      el.dispatchEvent(new CustomEvent('thread-read'));
      return;
    }
    const after = messages.at(-1)?.at;
    const out = await api('GET', `/api/messages?${q({ clientId, after, since: cursor })}`);
    if (!view.fresh()) return;
    const seen = new Set(messages.map(m => m.id));
    const fresh = out.messages.filter(m => !seen.has(m.id));
    const changed = (out.updated || []).filter(u => { const old = messages.find(m => m.id === u.id); return !old || old.updatedAt !== u.updatedAt; });
    if (out.cursor) cursor = out.cursor;
    if (fresh.length || changed.length) {
      upsert([...changed, ...fresh]);
      draw();
      if (fresh.some(m => m.fromRole === 'client')) el.dispatchEvent(new CustomEvent('thread-read'));
    }
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
      fill(avatarSlot, avatar(name, 34));
      box.el.querySelector('.cmp-input')?.setAttribute('placeholder', `Message ${firstName(name)}`);
      if (!messages.length) draw();
    }
  }
  if (name) el.dispatchEvent(new CustomEvent('thread-name', { detail: name }));
  api('GET', `/api/coach/clients/${enc(clientId)}/ai-consent`).then(c => {
    if (!view.fresh()) return;
    fill(sub, c.voice === 'on' ? 'Voice notes transcribed' : c.voice === 'off' ? 'Voice notes not transcribed' : 'Voice transcription not asked yet');
  }, () => {});
  if (ctx) contextPane(ctx, clientId, () => messages).then(a => { ctxApi = a; }, () => fill(ctx));

  // An AI draft or a draft awaiting approval, opened from the Inbox (F18).
  const draftId = compact ? null : hashQuery().get('draft');
  if (draftId) {
    api('GET', `/api/ai/reviews/${enc(draftId)}`).then(({ review: r }) => {
      if (!view.fresh() || r.clientId !== clientId || !['pending', 'pendingApproval'].includes(r.decision)) return;
      const text = r.kind === 'draft' ? r.rewrite : r.draft;
      if (!text) return;
      box.setText(text);
      pendingDraft = { id: r.id, kind: r.kind };
      fill(draftBanner, icon(r.kind === 'draft' ? 'auto_awesome' : 'approval', 15),
        h('span', { class: 'grow' }, r.kind === 'draft' ? 'AI draft. Read it, edit it, then press Send.' : 'Draft awaiting approval. Send it as it is, or edit first.'),
        h('button', { type: 'button', class: 'btn text small', onclick: () => {
          api('POST', `/api/ai/review/${enc(r.id)}/decision`, { decision: 'rejected' }).catch(() => {});
          pendingDraft = null; draftBanner.hidden = true; box.setText('');
        } }, 'Discard'));
      draftBanner.hidden = false;
      setHashQuery({ draft: null });
      box.focus();
    }, () => {});
  }

  aiStatus(); // hides Check and Draft when the coach turned them off
  if (matchMedia('(pointer: fine)').matches) box.focus();
  const reload = () => load().catch(() => { /* try again next tick */ });
  const timer = setInterval(() => { if (view.fresh()) reload(); }, POLL_MS);
  view.onLeave(() => clearInterval(timer));
  for (const type of ['message.received', 'message.sent', 'voice.analysed']) {
    view.onLeave(live.on(type, ev => { if (view.fresh() && ev.clientId === clientId) reload(); }));
  }
  return { reload, composer: box };
}
