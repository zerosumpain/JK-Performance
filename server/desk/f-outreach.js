/*
 * F17 Scheduled messages and segment broadcasts (WP5): /broadcasts (list and
 * the five-step wizard: Audience, Message, Preview, When, Send), the
 * composer's "Schedule" tool, scheduled messages as ghost bubbles above a
 * thread's composer, the Today "Scheduled" widget, Settings › Outreach (daily
 * cap and quiet hours), the "Message" bulk action and + New broadcast.
 */
import {
  api, busy, clients as loadClients, confirmBox, fill, fmtDay, go, h, icon, londonParts, prefs, registerBulkAction, registerCommand, registerComposerTool,
  registerNav, registerQuickCreate, registerSettingsSection, registerWidget, route, setCrumbs, toast, todayLondon,
} from './core.js';
import { composer } from './composer.js';
import { avatarStack, countUp, dataTable, emptyHero, pageHead, popover, progressBar, segmentedNav, skeleton, tagPicker, wizard } from './ui.js';

const enc = encodeURIComponent;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

registerNav({ id: 'broadcasts', label: 'Broadcasts', icon: 'campaign', group: 'engage', order: 40, path: '/broadcasts' });
registerQuickCreate({ id: 'broadcast', label: 'Broadcast', icon: 'campaign', order: 80, run: () => go('/broadcasts/new') });
registerCommand({ id: 'new-broadcast', label: 'New broadcast', icon: 'campaign', run: () => go('/broadcasts/new') });
registerBulkAction({ id: 'message', label: 'Message', icon: 'campaign', scope: 'clients', run: async ids => {
  const r = await api('POST', '/api/broadcasts', { name: `Message to ${plural(ids.length, 'client')}`, body: '', audience: { clientIds: ids } });
  go(`/broadcasts/${enc(r.broadcast.id)}`);
} });

// MARK: - Time words

function dayOffset(iso) {
  const { day } = londonParts(iso);
  return Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${todayLondon()}T12:00:00Z`)) / 86_400_000);
}
/** "Today 07:00", "Tomorrow 07:00", "Mon 1 Dec 07:00". */
export function whenWords(iso) {
  if (!iso) return '';
  const { day, time } = londonParts(iso);
  const d = dayOffset(iso);
  return `${d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday' : fmtDay(day)} ${time}`;
}
/** The UTC instant of a London day and "HH:MM" (DST-safe: the offset is read back from Intl). */
export function londonInstant(day, clock) {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = clock.split(':').map(Number);
  const wanted = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = londonParts(new Date(guess).toISOString());
    const [py, pm, pd] = p.day.split('-').map(Number);
    const [ph, pmin] = p.time.split(':').map(Number);
    guess += wanted - Date.UTC(py, pm - 1, pd, ph, pmin);
  }
  return new Date(guess).toISOString();
}
const addDay = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** Quick picks: this evening, tomorrow 07:00, next Monday 07:00. */
function suggestions() {
  const today = todayLondon();
  const now = Date.now();
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = addDay(today, ((8 - wd) % 7) || 7);
  return [
    { label: 'This evening', detail: '18:00', at: londonInstant(today, '18:00') },
    { label: 'Tomorrow morning', detail: '07:00', at: londonInstant(addDay(today, 1), '07:00') },
    { label: 'Monday morning', detail: `${fmtDay(monday)} 07:00`, at: londonInstant(monday, '07:00') },
  ].filter(s => Date.parse(s.at) > now + 60_000);
}

/** A date + time picker for "Pick a time". Returns {el, value() → iso|null}. */
function pickTime(initialIso = null) {
  const start = initialIso ? londonParts(initialIso) : { day: addDay(todayLondon(), 1), time: '07:00' };
  const date = h('input', { type: 'date', value: start.day, min: todayLondon(), 'aria-label': 'Day' });
  const time = h('input', { type: 'time', value: start.time, step: '300', 'aria-label': 'Time' });
  return { el: h('div', { class: 'ob-pick' }, date, time), value: () => (date.value && time.value ? londonInstant(date.value, time.value) : null), date, time };
}

// MARK: - Composer: "Schedule"

const scheduledChanged = clientId => document.dispatchEvent(new CustomEvent('ob-scheduled', { detail: { clientId } }));

registerComposerTool({
  id: 'schedule', icon: 'schedule_send', label: 'Schedule', order: 40,
  run: (c, ctx) => {
    popover(ctx.anchor, (box, close) => {
      const status = h('div');
      if (!c.clientId) { box.append(h('p', { class: 'small muted pad-s' }, 'Scheduling works in a client’s thread.')); return; }
      const send = async at => {
        const text = c.getText().trim();
        if (!text) { fill(status, h('p', { class: 'error small' }, 'Write the message first.')); return; }
        const r = await api('POST', '/api/scheduled-messages', { clientId: c.clientId, text, sendAt: at });
        close();
        c.setText('');
        scheduledChanged(c.clientId);
        toast(`Scheduled · ${whenWords(r.item.sendAt)}`, { undo: async () => { await api('DELETE', `/api/scheduled-messages/${enc(r.item.id)}`); c.setText(text); scheduledChanged(c.clientId); } });
      };
      const picker = pickTime();
      box.append(h('div', { class: 'ob-sched-title' }, icon('schedule_send', 16), 'Send later'),
        h('div', { class: 'ob-sched-list' }, suggestions().map(s => h('button', { type: 'button', class: 'ob-sched-opt', onclick: e => busy(e.currentTarget, status, () => send(s.at)) },
          h('span', null, s.label), h('span', { class: 'faint t-num' }, s.detail)))),
        h('div', { class: 'ob-sched-custom' }, h('div', { class: 'small faint' }, 'Pick a time'), picker.el,
          h('button', { type: 'button', class: 'btn small primary', onclick: e => busy(e.currentTarget, status, async () => { const at = picker.value(); if (at) await send(at); }) }, 'Schedule')),
        h('p', { class: 'tiny faint m0' }, 'Goes at exactly that time, as you wrote it: names fill in when it sends.'), status);
      requestAnimationFrame(() => box.querySelector('button')?.focus());
    }, { className: 'ob-sched', label: 'Send later' });
  },
});

// MARK: - Ghost bubbles: scheduled messages above a thread's composer

function threadClientId(pane) {
  if (pane.dataset.clientId) return pane.dataset.clientId;
  const a = pane.querySelector('a[href^="#/clients/"]');
  return a ? decodeURIComponent(a.getAttribute('href').slice('#/clients/'.length).split(/[/?]/)[0]) : null;
}

function editScheduled(item, done) {
  import('./ui.js').then(({ slideOver }) => slideOver('Edit scheduled message', (body, close) => {
    const ta = h('textarea', { rows: '6', maxlength: '4000', value: item.text, 'aria-label': 'Message' });
    const picker = pickTime(item.sendAt);
    const status = h('div');
    body.append(h('div', { class: 'field' }, h('label', null, 'Message'), ta), h('div', { class: 'field' }, h('label', null, 'Send at'), picker.el), status);
    return h('div', { class: 'ob-foot' }, h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Cancel'),
      h('button', { type: 'button', class: 'btn primary', onclick: e => busy(e.currentTarget, status, async () => {
        await api('PATCH', `/api/scheduled-messages/${enc(item.id)}`, { text: ta.value, sendAt: picker.value() });
        close(); toast('Scheduled message updated'); done();
      }) }, 'Save'));
  }));
}

async function drawTray(tray, clientId) {
  let items = [];
  try { items = (await api('GET', `/api/scheduled-messages?${new URLSearchParams({ clientId, status: 'scheduled', oneOff: '1' })}`)).items; } catch { items = []; }
  if (!tray.isConnected) return;
  tray.hidden = !items.length;
  fill(tray, items.map(it => h('div', { class: 'ob-ghost' },
    h('div', { class: 'ob-ghost-bubble' }, withVars(it.text)),
    h('div', { class: 'ob-ghost-meta' }, icon('schedule_send', 14), h('span', { class: 't-num' }, `Scheduled · ${whenWords(it.sendAt)}`),
      h('button', { type: 'button', class: 'ob-ghost-btn', onclick: () => editScheduled(it, () => drawTray(tray, clientId)) }, 'Edit'),
      h('button', { type: 'button', class: 'ob-ghost-btn', onclick: async () => {
        await api('DELETE', `/api/scheduled-messages/${enc(it.id)}`);
        toast('Scheduled message cancelled');
        drawTray(tray, clientId);
      } }, 'Cancel')))));
}

/** The thread pane (messages.js) has no hook for extras, so the tray finds each composer as it appears. */
function attachTrays(root) {
  for (const compose of root.querySelectorAll?.('.thread-compose') ?? []) {
    if (compose.previousElementSibling?.classList.contains('ob-tray')) continue;
    const pane = compose.closest('.thread-pane') || compose.parentElement;
    const clientId = pane && threadClientId(pane);
    if (!clientId) continue;
    const tray = h('div', { class: 'ob-tray', hidden: true, 'aria-label': 'Scheduled messages', 'data-client': clientId });
    compose.before(tray);
    drawTray(tray, clientId);
  }
}
new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) attachTrays(n.classList?.contains('thread-compose') ? n.parentElement : n); })
  .observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('ob-scheduled', e => { for (const t of document.querySelectorAll('.ob-tray')) if (t.dataset.client === e.detail.clientId) drawTray(t, e.detail.clientId); });

// MARK: - Today: the "Scheduled" widget

registerWidget({
  id: 'scheduled', title: 'Scheduled', icon: 'schedule_send', size: 'm', order: 60,
  render: async body => {
    const s = await api('GET', '/api/outreach/summary');
    const rows = [
      ...s.broadcasts.map(b => ({ at: b.sendAt, title: b.name, detail: `Broadcast · ${plural(b.recipients, 'person', 'people')}`, path: `/broadcasts/${b.id}`, glyph: 'campaign' })),
      ...s.upcoming.map(u => ({ at: u.sendAt, title: u.client?.name ?? 'Client', detail: u.text, path: `/messages/${u.clientId}`, glyph: 'schedule_send' })),
    ].sort((a, b) => a.at.localeCompare(b.at)).slice(0, 5);
    if (!rows.length) { fill(body, h('p', { class: 'small muted' }, 'Nothing queued. Use the clock in any composer to send later.')); return; }
    fill(body, h('ul', { class: 'ob-widget' }, rows.map(r => h('li', null, h('a', { href: `#${r.path}`, class: 'ob-widget-row' },
      h('span', { class: 'ob-widget-when t-num' }, whenWords(r.at)),
      h('span', { class: 'ob-widget-text' }, h('b', null, icon(r.glyph, 14), r.title), h('span', { class: 'small muted clamp1' }, r.detail)))))),
    s.held ? h('p', { class: 'tiny faint m0' }, `${plural(s.held, 'automated message')} held for quiet hours or the daily cap.`) : null);
  },
});

// MARK: - Settings › Outreach

registerSettingsSection({
  id: 'outreach', label: 'Outreach', icon: 'schedule_send', order: 40,
  render: async box => {
    const s = await api('GET', '/api/outreach/summary');
    let cap = s.settings.dailyCap;
    let quiet = s.settings.quietHours;
    const status = h('div');
    const capN = h('b', { class: 'ob-cap-n t-num' }, String(cap));
    const step = d => { cap = Math.max(0, Math.min(10, cap + d)); capN.textContent = String(cap); };
    const on = h('input', { type: 'checkbox', role: 'switch', checked: !!quiet, onchange: e => { start.disabled = end.disabled = !e.target.checked; } });
    const start = h('input', { type: 'time', value: quiet?.start ?? '21:00', step: '900', disabled: !quiet, 'aria-label': 'Quiet from' });
    const end = h('input', { type: 'time', value: quiet?.end ?? '07:30', step: '900', disabled: !quiet, 'aria-label': 'Quiet until' });
    fill(box,
      h('p', { class: 'muted' }, 'Rules for every message the desk sends on its own: automations, sequences, campaign nudges and broadcasts. What you type yourself is never held.'),
      h('section', { class: 'ob-set' },
        h('div', { class: 'ob-set-row' }, h('div', { class: 'grow' }, h('b', null, 'Daily limit per client'), h('div', { class: 'small muted' }, 'Automated and broadcast messages a client can get in one day. Extra ones wait for the next morning.')),
          h('div', { class: 'ob-stepper' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fewer', onclick: () => step(-1) }, '−'), capN, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'More', onclick: () => step(1) }, icon('add', 16)))),
        h('div', { class: 'ob-set-row' }, h('div', { class: 'grow' }, h('b', null, 'Quiet hours'), h('div', { class: 'small muted' }, 'London time. Automated messages that fall inside wait until it ends.')),
          h('label', { class: 'au-switch' }, on)),
        h('div', { class: 'ob-quiet' }, h('span', { class: 'small muted' }, 'From'), start, h('span', { class: 'small muted' }, 'until'), end)),
      h('section', { class: 'ob-govern' },
        h('h3', null, 'Who follows which rule'),
        h('ul', null,
          [['edit', 'Messages you type', 'Sent straight away, always.'], ['schedule_send', 'Scheduled one-offs', 'Sent at exactly the time you picked.'],
            ['bolt', 'Automations, sequences, nudges', 'Daily limit and quiet hours; skipped if a client’s outreach is paused.'],
            ['campaign', 'Broadcasts', 'As above, and never to clients who opted out of broadcasts.']].map(([g, t, d]) => h('li', null, icon(g, 16), h('div', null, h('b', null, t), h('div', { class: 'small muted' }, d)))))),
      h('div', { class: 'ob-set-stats small muted' }, `${plural(s.held, 'message')} waiting now · ${plural(s.atCap, 'client')} at today’s limit · ${plural(s.scheduled, 'one-off')} scheduled`),
      status,
      h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn primary', onclick: e => busy(e.currentTarget, status, async () => {
        if (on.checked && start.value === end.value) throw new Error('Quiet hours need different start and end times');
        await prefs.set('outreach.dailyCap', cap);
        await prefs.set('outreach.quietHours', on.checked ? { start: start.value, end: end.value } : null);
        quiet = on.checked ? { start: start.value, end: end.value } : null;
        toast('Outreach rules saved');
      }) }, 'Save')));
  },
});

// MARK: - The list

function pctBar(label, pct, tone) {
  return h('div', { class: 'ob-pct' }, h('div', { class: 'ob-pct-top' }, h('span', null, label), h('b', { class: 't-num' }, `${pct}%`)),
    h('div', { class: 'ob-pct-track' }, h('span', { class: `ob-pct-fill ob-fill-${tone}`, style: { '--w': `${pct}%` } })));
}

function broadcastRow(b) {
  const sent = b.status === 'sent';
  return h('a', { href: `#/broadcasts/${enc(b.id)}`, class: `ob-row ob-${b.status}` },
    h('div', { class: 'ob-row-main' },
      h('div', { class: 'ob-row-top' }, h('span', { class: 'ob-row-glyph' }, icon(b.status === 'draft' ? 'edit_note' : b.status === 'scheduled' ? 'schedule_send' : 'campaign', 18)),
        h('span', { class: 'ob-row-name' }, b.name)),
      h('div', { class: 'ob-row-sub' },
        h('span', { class: 'ob-aud' }, icon(b.audience?.everyone ? 'group' : b.audience?.segmentId ? 'filter_alt' : b.audience?.tagIds ? 'label' : 'person', 13), b.audienceLabel),
        h('span', { class: 'faint' }, b.status === 'draft' ? `Draft · edited ${whenWords(b.updatedAt ?? b.createdAt)}` : b.status === 'scheduled' ? `Goes ${whenWords(b.sendAt)}` : b.status === 'cancelled' ? 'Cancelled' : `Sent ${whenWords(b.sentAt)}`)),
      b.body ? h('p', { class: 'ob-row-body' }, withVars(b.body)) : null),
    h('div', { class: 'ob-row-side' },
      b.faces?.length ? avatarStack(b.faces, { max: 5, size: 26 }) : null,
      b.recipients ? h('span', { class: 'small muted t-num' }, plural(b.recipients, 'recipient')) : null,
      sent && b.stats ? h('div', { class: 'ob-row-pcts' }, pctBar('Read', b.stats.readPct, 'read'), pctBar('Replied', b.stats.replyPct, 'reply')) : null));
}

route('/broadcasts', async (el, _p, view) => {
  setCrumbs([{ label: 'Engage' }, { label: 'Broadcasts', path: '/broadcasts' }]);
  const kpis = h('div', { class: 'ob-kpis' }, [1, 2, 3, 4].map(() => h('div', { class: 'ob-kpi' }, skeleton('lines', { rows: 2 }))));
  const listBox = h('div', { class: 'ob-list' }, skeleton('table', { rows: 4 }));
  fill(el, pageHead({ eyebrow: 'Engage', title: 'Broadcasts', accent: 'personal, at scale', sub: 'One message, written once, arriving in each client’s thread with their name in it.',
    actions: [h('a', { href: '#/broadcasts/new', class: 'btn primary' }, icon('add', 18), 'New broadcast')] }), kpis, listBox);
  const { broadcasts } = await api('GET', '/api/broadcasts');
  if (!view.fresh()) return;
  const sent = broadcasts.filter(b => b.status === 'sent');
  const avg = k => (sent.length ? Math.round(sent.reduce((t, b) => t + (b.stats?.[k] ?? 0), 0) / sent.length) : 0);
  const reached = sent.reduce((t, b) => t + (b.stats?.delivered ?? 0), 0);
  const next = broadcasts.filter(b => b.status === 'scheduled').sort((a, b) => a.sendAt.localeCompare(b.sendAt))[0];
  const kpi = (label, n, suffix, detail, cls = '') => { const v = h('b', { class: 'ob-kpi-n t-num' }, '0'); countUp(v, n, { format: x => `${Math.round(x)}${suffix}` }); return h('div', { class: `ob-kpi ${cls}` }, h('div', { class: 'ob-kpi-label' }, label), v, h('div', { class: 'ob-kpi-detail' }, detail)); };
  fill(kpis,
    kpi('Sent', sent.length, '', `${plural(reached, 'message')} delivered`, 'ob-kpi-hero'),
    kpi('Read rate', avg('readPct'), '%', 'Average across sent broadcasts'),
    kpi('Reply rate', avg('replyPct'), '%', 'A reply within 72 hours'),
    h('div', { class: 'ob-kpi' }, h('div', { class: 'ob-kpi-label' }, 'Next up'), h('b', { class: 'ob-kpi-next' }, next ? whenWords(next.sendAt) : 'Nothing booked'), h('div', { class: 'ob-kpi-detail clamp1' }, next ? next.name : 'Schedule one from the wizard')));
  if (!broadcasts.length) {
    fill(listBox, emptyHero({ icon: 'campaign', title: 'Say it once, to everyone who needs it', line: 'Pick a tag or a segment, write with {first}, preview it, and send now or tomorrow at 07:00.', action: { label: 'New broadcast', path: '/broadcasts/new' } }));
    return;
  }
  const group = (label, list) => (list.length ? [h('h2', { class: 'ob-section' }, label, h('span', { class: 'ob-count t-num' }, String(list.length))), h('div', { class: 'ob-rows' }, list.map(broadcastRow))] : null);
  fill(listBox, group('Drafts', broadcasts.filter(b => b.status === 'draft')), group('Scheduled', broadcasts.filter(b => ['scheduled', 'sending'].includes(b.status))),
    group('Sent', sent), group('Cancelled', broadcasts.filter(b => b.status === 'cancelled')));
});

route('/broadcasts/new', async (el, _p, view) => {
  fill(el, skeleton('card', { rows: 3 }));
  const ids = (view.query.get('clients') ?? '').split(',').filter(Boolean);
  const r = await api('POST', '/api/broadcasts', { name: 'New broadcast', body: '', audience: ids.length ? { clientIds: ids } : { everyone: true } });
  if (view.fresh()) go(`/broadcasts/${enc(r.broadcast.id)}`, { replace: true });
});

// MARK: - One broadcast: the wizard (draft) or the report (sent)

route('/broadcasts/:id', async (el, p, view) => {
  if (p.id === 'new') return;
  fill(el, skeleton('card', { rows: 3 }), skeleton('table', { rows: 4 }));
  let data;
  try { data = await api('GET', `/api/broadcasts/${enc(p.id)}`); } catch (err) {
    if (view.fresh()) fill(el, emptyHero({ icon: 'campaign', title: err.status === 404 ? 'That broadcast isn’t here' : 'Could not load it', line: err.status === 404 ? 'It may have been deleted.' : err.message, action: { label: 'All broadcasts', path: '/broadcasts' } }));
    return;
  }
  if (!view.fresh()) return;
  const b = data.broadcast;
  setCrumbs([{ label: 'Engage' }, { label: 'Broadcasts', path: '/broadcasts' }, { label: b.name, path: `/broadcasts/${b.id}` }]);
  if (b.status === 'draft') return draftWizard(el, b, view);
  return report(el, b, view);
});

async function report(el, b, view) {
  const s = b.stats ?? {};
  const actions = [];
  if (b.status === 'scheduled') actions.push(h('button', { type: 'button', class: 'btn danger', onclick: async () => {
    if (!(await confirmBox(`Cancel “${b.name}”?`, { ok: 'Cancel broadcast', danger: true, detail: `It won’t go to the ${plural(b.recipients, 'person', 'people')} it was booked for.` }))) return;
    await api('DELETE', `/api/broadcasts/${enc(b.id)}`);
    toast('Broadcast cancelled');
    go(`/broadcasts/${enc(b.id)}`);
  } }, icon('block', 17), 'Cancel broadcast'));
  actions.push(h('button', { type: 'button', class: 'btn', onclick: e => busy(e.currentTarget, null, async () => {
    const r = await api('POST', '/api/broadcasts', { name: `${b.name} (again)`.slice(0, 80), body: b.body, audience: b.audience });
    go(`/broadcasts/${enc(r.broadcast.id)}`);
  }) }, icon('content_copy', 17), 'Send again'));
  const when = b.status === 'sent' ? `Sent ${whenWords(b.sentAt)}` : b.status === 'scheduled' ? `Goes ${whenWords(b.sendAt)}` : b.status === 'cancelled' ? 'Cancelled' : 'Sending…';
  const big = (label, value, sub, cls = '') => h('div', { class: `ob-stat ${cls}` }, h('div', { class: 'ob-kpi-label' }, label), h('b', { class: 'ob-stat-n t-num' }, value), sub ? h('div', { class: 'ob-kpi-detail' }, sub) : null);
  const table = dataTable({
    label: 'Recipients', rowKey: r => r.client.id, initialSort: { key: 'name', dir: 1 },
    columns: [
      { key: 'name', label: 'Client', sort: r => r.client.name, render: r => h('a', { href: `#/messages/${enc(r.client.id)}`, class: 'ob-who' }, h('span', { class: 'avatar', style: { width: '28px', height: '28px', fontSize: '11px' } }, r.client.initials), r.client.name) },
      { key: 'outcome', label: 'Delivery', render: r => h('span', { class: 'small' + (r.delivered ? '' : r.status === 'scheduled' ? ' muted' : ' tone-attention') }, r.delivered ? `Delivered ${whenWords(r.deliveredAt)}` : r.outcome ?? 'Queued') },
      { key: 'read', label: 'Read', sort: r => r.readAt ?? '', render: r => (r.readAt ? h('span', { class: 'ob-yes' }, icon('done_all', 16), whenWords(r.readAt)) : h('span', { class: 'faint' }, '—')) },
      { key: 'replied', label: 'Replied', sort: r => r.repliedAt ?? '', render: r => (r.repliedAt ? h('span', { class: 'ob-yes ob-reply' }, icon('reply', 16), whenWords(r.repliedAt)) : h('span', { class: 'faint' }, '—')) },
    ],
    rows: b.people, empty: 'Nobody yet.',
  });
  fill(el,
    pageHead({ eyebrow: `Broadcast · ${when}`, title: b.name, sub: b.audienceLabel, actions }),
    h('div', { class: 'ob-report' },
      h('section', { class: 'ob-message' }, h('div', { class: 'ui-eyebrow' }, 'The message'), h('div', { class: 'ob-bubble' }, withVars(b.body)),
        h('p', { class: 'tiny faint' }, 'Each client got it with their own details filled in.')),
      h('section', { class: 'ob-stats' },
        big('Recipients', String(s.recipients ?? b.recipients), s.skipped ? `${s.skipped} skipped` : s.held ? `${s.held} held for quiet hours` : null, 'ob-stat-hero'),
        big('Delivered', String(s.delivered ?? 0), null),
        h('div', { class: 'ob-stat' }, h('div', { class: 'ob-kpi-label' }, 'Read'), h('b', { class: 'ob-stat-n t-num' }, `${s.readPct ?? 0}%`), progressBar(s.readPct ?? 0, { tone: 'data' }), h('div', { class: 'ob-kpi-detail' }, `${s.read ?? 0} of ${s.delivered ?? 0}`)),
        h('div', { class: 'ob-stat' }, h('div', { class: 'ob-kpi-label' }, 'Replied'), h('b', { class: 'ob-stat-n t-num' }, `${s.replyPct ?? 0}%`), progressBar(s.replyPct ?? 0, { tone: 'accent' }), h('div', { class: 'ob-kpi-detail' }, `${s.replied ?? 0} within 72 hours`)))),
    h('h2', { class: 'ob-section' }, 'Who got it', h('span', { class: 'ob-count t-num' }, String(b.people.length))), table.el);
  void view;
}

function withVars(text) {
  const out = [];
  let last = 0;
  for (const m of String(text ?? '').matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h('span', { class: 'ob-v' }, m[1]));
    last = m.index + m[0].length;
  }
  if (last < String(text ?? '').length) out.push(String(text).slice(last));
  return out;
}

async function draftWizard(el, b, view) {
  const [tags, segments, people, vars] = await Promise.all([
    api('GET', '/api/tags').then(r => r.tags).catch(() => []), api('GET', '/api/segments').then(r => r.segments).catch(() => []),
    loadClients().catch(() => []), api('GET', '/api/templates/variables').then(r => r.variables).catch(() => []),
  ]);
  if (!view.fresh()) return;
  const aud = b.audience ?? {};
  const data = {
    name: b.name, body: b.body,
    mode: aud.everyone ? 'everyone' : aud.segmentId ? 'segment' : aud.tagIds?.length ? 'tags' : aud.clientIds?.length ? 'people' : 'everyone',
    tagIds: aud.tagIds ?? [], segmentId: aud.segmentId ?? segments[0]?.id ?? null, clientIds: aud.clientIds ?? [],
    when: 'now', sendAt: null, preview: null,
  };
  const audience = () => (data.mode === 'everyone' ? { everyone: true } : data.mode === 'segment' ? { segmentId: data.segmentId } : data.mode === 'tags' ? { tagIds: data.tagIds } : { clientIds: data.clientIds });
  let saveTimer = null;
  const persist = () => api('PUT', `/api/broadcasts/${enc(b.id)}`, { name: data.name.trim() || 'Untitled broadcast', body: data.body, audience: audience() });
  const persistSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => persist().catch(() => {}), 600); };
  let previewSeq = 0;
  async function refreshPreview() {
    const mine = ++previewSeq;
    try { const r = await api('POST', '/api/broadcasts/preview', { audience: audience(), body: data.body }); if (mine === previewSeq) data.preview = r; return r; } catch (err) { if (mine === previewSeq) data.preview = { count: 0, error: err.message }; return data.preview; }
  }
  const nameInput = h('input', { class: 'ob-name-input', value: data.name, maxlength: '80', 'aria-label': 'Broadcast name', oninput: e => { data.name = e.target.value; persistSoon(); } });

  const steps = [
    {
      id: 'audience', label: 'Audience',
      render(box) {
        const count = h('div', { class: 'ob-count-box', 'aria-live': 'polite' }, skeleton('lines', { rows: 1 }));
        const controls = h('div', { class: 'ob-aud-controls' });
        const update = async () => {
          persistSoon();
          const r = await refreshPreview();
          if (!box.isConnected) return;
          const n = h('b', { class: 'ob-count-n t-num' }, '0');
          countUp(n, r.count ?? 0);
          const skipped = (r.skipped?.noBroadcasts ?? 0) + (r.skipped?.outreachPaused ?? 0);
          fill(count, h('div', { class: 'ob-count-line' }, n, h('span', null, r.count === 1 ? 'person' : 'people')),
            r.people?.length ? avatarStack(r.people, { max: 8, size: 30 }) : null,
            skipped ? h('div', { class: 'small muted' }, [r.skipped.noBroadcasts ? `${r.skipped.noBroadcasts} skipped: no broadcasts` : null, r.skipped.outreachPaused ? `${r.skipped.outreachPaused} skipped: outreach paused` : null].filter(Boolean).join(' · ')) : null,
            r.count > r.max ? h('div', { class: 'small tone-attention' }, `At most ${r.max} people per broadcast`) : null,
            r.error ? h('div', { class: 'error small' }, r.error) : null);
          box.dispatchEvent(new CustomEvent('ui-change', { bubbles: true }));
        };
        const drawControls = () => {
          if (data.mode === 'everyone') fill(controls, h('p', { class: 'muted m0' }, 'Every client of yours who hasn’t opted out of broadcasts.'));
          else if (data.mode === 'tags') fill(controls, tags.length ? [h('p', { class: 'small muted' }, 'Anyone with any of these tags.'), tagPicker({ selected: data.tagIds, all: tags, onChange: ids => { data.tagIds = ids; update(); } })] : h('p', { class: 'muted' }, 'No tags yet. Tag clients from their page.'));
          else if (data.mode === 'segment') fill(controls, segments.length ? h('select', { 'aria-label': 'Segment', onchange: e => { data.segmentId = e.target.value; update(); } }, segments.map(s => h('option', { value: s.id, selected: s.id === data.segmentId }, `${s.name} · ${s.count}`))) : h('p', { class: 'muted' }, 'No segments yet.'));
          else {
            const search = h('input', { type: 'search', placeholder: 'Find a client', 'aria-label': 'Find a client' });
            const list = h('div', { class: 'ob-people' });
            const drawPeople = () => {
              const q = search.value.trim().toLowerCase();
              fill(list, people.filter(c => !q || c.name.toLowerCase().includes(q)).map(c => h('label', { class: 'ob-person' + (data.clientIds.includes(c.id) ? ' on' : '') },
                h('input', { type: 'checkbox', checked: data.clientIds.includes(c.id), onchange: e => { data.clientIds = e.target.checked ? [...data.clientIds, c.id] : data.clientIds.filter(x => x !== c.id); drawPeople(); update(); } }),
                h('span', { class: 'avatar', style: { width: '28px', height: '28px', fontSize: '11px' } }, c.initials || c.name.split(' ').map(w => w[0]).join('').slice(0, 2)), c.name)));
            };
            search.addEventListener('input', drawPeople);
            drawPeople();
            fill(controls, search, list);
          }
        };
        box.append(h('div', { class: 'ob-step-grid' },
          h('div', null, h('div', { class: 'field' }, h('label', null, 'Name (only you see it)'), nameInput),
            h('div', { class: 'field' }, h('label', null, 'Who gets it'), segmentedNav([['everyone', 'Everyone'], ['tags', 'Tags'], ['segment', 'Segment'], ['people', 'Pick people']], data.mode, m => { data.mode = m; drawControls(); update(); }, { label: 'Audience' })),
            controls),
          h('aside', { class: 'ob-count-card' }, h('div', { class: 'ui-eyebrow' }, 'It goes to'), count)));
        drawControls();
        update();
      },
      valid: () => (data.preview?.count ?? 0) > 0 && data.preview.count <= (data.preview.max ?? 300) && data.name.trim().length > 0,
    },
    {
      id: 'message', label: 'Message',
      render(box) {
        const c = composer({ audience: audience(), initial: data.body, placeholder: 'Hi {first}, …', label: 'Broadcast message', onSend: async ({ text, mediaId }) => {
          if (mediaId) throw new Error('Voice notes and attachments can’t go in a broadcast');
          data.body = text;
          await persist();
          box.closest('.ui-wizard')?.querySelector('.ui-wiz-foot .btn.primary')?.click();
        } });
        c.el.addEventListener('input', () => { data.body = c.getText(); persistSoon(); box.dispatchEvent(new CustomEvent('ui-change', { bubbles: true })); });
        const chips = h('div', { class: 'ob-vars', role: 'group', 'aria-label': 'Insert a variable' }, vars.slice(0, 12).map(v => h('button', { type: 'button', class: 'ob-var', title: v.label, onclick: () => { c.insert(`{${v.name}}`); data.body = c.getText(); persistSoon(); box.dispatchEvent(new CustomEvent('ui-change', { bubbles: true })); } }, `{${v.name}}`)));
        box.append(h('p', { class: 'muted small' }, 'Write it once. {first} and friends fill in for each person. The template and AI check tools work here; voice notes don’t go in broadcasts.'), c.el, chips);
        requestAnimationFrame(() => c.focus());
      },
      valid: () => data.body.trim().length > 0,
    },
    {
      id: 'preview', label: 'Preview',
      render(box) {
        const list = h('div', { class: 'ob-samples' }, skeleton('card', { rows: 3 }));
        box.append(list);
        persist().catch(() => {});
        refreshPreview().then(r => {
          if (!box.isConnected) return;
          fill(list,
            r.unknown?.length ? h('p', { class: 'ob-unknown' }, icon('warning', 16), `Not a variable: ${r.unknown.map(n => `{${n}}`).join(', ')}. Fix it before sending.`) : null,
            h('p', { class: 'muted small' }, `How it reads for ${plural(r.samples.length, 'of them', 'of them')}, filled in exactly as each will get it:`),
            r.samples.map(s => h('div', { class: 'ob-sample' }, h('div', { class: 'ob-sample-who' }, h('span', { class: 'avatar', style: { width: '26px', height: '26px', fontSize: '10px' } }, s.client.initials), s.client.name),
              h('div', { class: 'ob-bubble' }, s.text),
              s.empty.length ? h('div', { class: 'tiny faint' }, `Empty for ${s.client.name.split(' ')[0]}: ${s.empty.map(m => `{${m}}`).join(', ')}`) : null)));
          box.dispatchEvent(new CustomEvent('ui-change', { bubbles: true }));
        });
      },
      valid: () => !(data.preview?.unknown?.length),
    },
    {
      id: 'when', label: 'When',
      render(box) {
        const picker = pickTime(data.sendAt);
        const opts = suggestions();
        const pane = h('div', { class: 'ob-when-pane' });
        const sync = () => box.dispatchEvent(new CustomEvent('ui-change', { bubbles: true }));
        const draw = () => fill(pane, data.when === 'now'
          ? h('p', { class: 'muted' }, 'It goes as soon as you confirm. Anyone inside your quiet hours gets it when they end.')
          : [h('div', { class: 'ob-sched-list ob-when-opts' }, opts.map(o => h('button', { type: 'button', class: 'ob-sched-opt' + (data.sendAt === o.at ? ' on' : ''), onclick: () => { data.sendAt = o.at; draw(); sync(); } }, h('span', null, o.label), h('span', { class: 'faint t-num' }, o.detail)))),
            h('div', { class: 'small faint' }, 'Or pick a time'), picker.el]);
        for (const inp of [picker.date, picker.time]) inp.addEventListener('change', () => { data.sendAt = picker.value(); draw(); sync(); });
        box.append(segmentedNav([['now', 'Send now'], ['later', 'Schedule']], data.when, w => { data.when = w; if (w === 'later' && !data.sendAt) data.sendAt = opts[1]?.at ?? opts[0]?.at ?? picker.value(); draw(); sync(); }, { label: 'When' }), pane);
        draw();
      },
      valid: () => data.when === 'now' || (data.sendAt && Date.parse(data.sendAt) > Date.now()),
    },
    {
      id: 'send', label: 'Send',
      render(box) {
        const n = data.preview?.count ?? 0;
        box.append(h('div', { class: 'ob-confirm' },
          h('span', { class: 'ob-confirm-glyph' }, icon(data.when === 'now' ? 'send' : 'schedule_send', 26)),
          h('div', { class: 'ob-confirm-n t-num' }, String(n)),
          h('div', { class: 'ob-confirm-line' }, `${n === 1 ? 'person' : 'people'} · ${data.when === 'now' ? 'now' : whenWords(data.sendAt)}`),
          h('div', { class: 'ob-bubble ob-confirm-msg' }, withVars(data.body)),
          h('p', { class: 'small muted' }, 'The list is fixed when you confirm: anyone tagged later won’t get it. Daily limits and quiet hours still apply.')));
      },
      valid: () => (data.preview?.count ?? 0) > 0,
    },
  ];
  const wiz = wizard(steps, {
    finishLabel: 'Send',
    data,
    onFinish: async () => {
      const n = data.preview?.count ?? 0;
      if (!(await confirmBox(data.when === 'now' ? `Send to ${plural(n, 'person', 'people')} now?` : `Schedule for ${plural(n, 'person', 'people')}, ${whenWords(data.sendAt)}?`, { ok: data.when === 'now' ? 'Send' : 'Schedule' }))) return;
      clearTimeout(saveTimer);
      await persist();
      const r = await api('POST', `/api/broadcasts/${enc(b.id)}/send`, data.when === 'now' ? {} : { sendAt: data.sendAt });
      toast(data.when === 'now' ? `Sent to ${plural(r.broadcast.recipients, 'person', 'people')}` : `Scheduled · ${whenWords(data.sendAt)}`);
      go(`/broadcasts/${enc(b.id)}`);
    },
  });
  const discard = h('button', { type: 'button', class: 'btn text danger', onclick: async () => {
    if (!(await confirmBox('Delete this draft?', { ok: 'Delete', danger: true }))) return;
    clearTimeout(saveTimer);
    await api('DELETE', `/api/broadcasts/${enc(b.id)}`);
    go('/broadcasts');
  } }, icon('delete', 16), 'Delete draft');
  fill(el, pageHead({ eyebrow: 'New broadcast', title: data.name || 'New broadcast', sub: 'Drafts save as you go.', actions: [discard] }), h('div', { class: 'ob-wizard' }, wiz.el));
  view.onLeave(() => { clearTimeout(saveTimer); persist().catch(() => {}); });
}
