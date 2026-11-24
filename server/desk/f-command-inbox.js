/*
 * Command (WP1, F4): the unified Inbox at /inbox and /inbox/<filter>.
 *
 * Three panes: filters with counts, the list, and the item. Messages and voice
 * notes open the thread (threadPane, with the composer and its tools); check-ins
 * and forms open a review view whose "Mark reviewed" calls the existing review
 * endpoints; anything a feature provides opens a card with that item's actions.
 * Done and snooze are optimistic, with Undo. Keys: j/k move, Enter opens,
 * e done, s snooze, r reply, x select. Below 1100 px one pane shows at a time.
 */
import {
  api, avatar, clients, fill, firstName, fmtDay, fmtRelative, go, h, icon, link, refreshBadges, route, setCrumbs, toast,
} from './core.js';
import { invalidate, londonAt, londonNow, onRefresh } from './f-command-core.js';
import { markAllDone } from './f-command.js';
import { threadPane } from './messages.js';
import { dateField, emptyHero, flash, kbd, menu, pageHead, popover, skeleton, splitView, timeField } from './ui.js';

const enc = encodeURIComponent;
const FILTERS = [
  ['all', 'All', 'inbox'], ['flag', 'Flags', 'healing'], ['message', 'Messages', 'chat_bubble'], ['voice', 'Voice', 'graphic_eq'],
  ['checkin', 'Check-ins', 'monitor_heart'], ['form', 'Forms', 'description'], ['draft', 'Drafts', 'edit_note'], ['lead', 'Leads', 'person_add'],
  ['snoozed', 'Snoozed', 'snooze'], ['done', 'Done', 'task_alt'],
];
const KIND_LABEL = { message: 'Message', voice: 'Voice note', checkin: 'Check-in', form: 'Form', flag: 'Flag', draft: 'Draft', lead: 'Lead', waitlist: 'Waitlist' };
const EMPTY = {
  all: ['Inbox zero.', 'Go coach someone.'], snoozed: ['Nothing snoozed.', 'Press s on an item to bring it back later.'],
  done: ['Nothing done yet.', 'Press e on an item to clear it. A new message reopens a thread.'], flag: ['No flags.', 'No pain or health flags waiting. Good.'],
};
const typing = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

// MARK: - Snooze times (London)

function snoozeChoices(now = new Date()) {
  const { day, clock } = londonNow(now);
  const add = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const out = [];
  if (clock < '15:00') out.push({ label: 'Later today', detail: '17:00', until: londonAt(day, '17:00') });
  else if (clock < '20:30') { const t = new Date(now.getTime() + 3 * 3_600_000); out.push({ label: 'Later today', detail: londonNow(t).clock, until: t }); }
  out.push({ label: 'Tomorrow', detail: '07:00', until: londonAt(add(day, 1), '07:00') });
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const monday = add(day, ((8 - dow) % 7) || 7);
  out.push({ label: 'Next Monday', detail: `${fmtDay(monday)} · 07:00`, until: londonAt(monday, '07:00') });
  return out;
}

// MARK: - The screen

route('/inbox/:filter?', async (el, params, view) => {
  const filter = FILTERS.some(([id]) => id === params.filter) ? params.filter : 'all';
  setCrumbs([{ label: 'Inbox', path: '/inbox' }, ...(filter === 'all' ? [] : [{ label: FILTERS.find(f => f[0] === filter)[1] }])]);
  clients().catch(() => null);

  let items = [], counts = null, cursor = null, opened = null;
  const checked = new Set();
  const filterNav = h('nav', { class: 'cmd-ib-filters', 'aria-label': 'Inbox filters' });
  const bulk = h('div', { class: 'cmd-ib-bulk', hidden: true, role: 'region', 'aria-label': 'Selected items' });
  const listEl = h('ul', { class: 'cmd-ib-list', role: 'listbox', 'aria-label': 'Inbox items', tabindex: '0' });
  const listBox = h('div', { class: 'cmd-ib-listbox' }, bulk, h('div', { class: 'cmd-ib-scroll' }, listEl));
  const detail = h('section', { class: 'cmd-ib-detail', 'aria-label': 'Item' });
  const layout = h('div', { class: 'cmd-ib' }, filterNav, splitView({ key: 'inbox', panes: [listBox, detail], initial: 400, min: 300, max: 560 }));
  el.append(
    pageHead({
      eyebrow: 'Command', title: 'Inbox', accent: filter === 'all' ? null : FILTERS.find(f => f[0] === filter)[1].toLowerCase(),
      sub: 'Everything clients send you, in one list. Clear it, snooze it, or act on it.',
      actions: [
        h('span', { class: 'cmd-ib-keys', 'aria-hidden': 'true' }, kbd('j'), kbd('k'), ' move ', kbd('e'), ' done ', kbd('s'), ' snooze ', kbd('r'), ' reply'),
        h('button', { type: 'button', class: 'btn', onclick: () => markAllDone().catch(err => toast(err.message, { error: true })) }, icon('done_all', 18), 'Mark all done'),
      ],
    }),
    layout);

  // Sub-views for the detail pane: a thread's polling stops when another item opens.
  let detailLeave = [];
  let detailSeq = 0;
  const subView = () => {
    for (const fn of detailLeave) { try { fn(); } catch { /* ignore */ } }
    detailLeave = [];
    const mine = ++detailSeq;
    return { fresh: () => view.fresh() && mine === detailSeq, onLeave: fn => detailLeave.push(fn), query: view.query };
  };
  view.onLeave(() => { for (const fn of detailLeave) { try { fn(); } catch { /* ignore */ } } });

  // MARK: Drawing

  function drawFilters() {
    fill(filterNav, FILTERS.map(([id, label, glyph]) => {
      const n = counts ? (id === 'all' ? counts.all : counts[id] ?? 0) : null;
      if (['draft', 'lead', 'voice'].includes(id) && !n && id !== filter) return null; // kinds nothing provides yet stay out of the way
      return link(id === 'all' ? '/inbox' : `/inbox/${id}`, { class: `cmd-ib-filter${id === filter ? ' sel' : ''}${id === 'flag' && n ? ' urgent' : ''}`, 'aria-current': id === filter ? 'page' : null },
        icon(glyph, 18, { filled: id === filter }), h('span', { class: 'grow' }, label), n ? h('span', { class: 'cmd-ib-count t-num' }, String(n)) : null);
    }));
  }

  function rowEl(item) {
    const c = item.client;
    const sel = cursor === item.key;
    const box = h('input', { type: 'checkbox', class: 'cmd-ib-check', 'aria-label': `Select ${item.title}`, checked: checked.has(item.key), tabindex: '-1',
      onclick: e => { e.stopPropagation(); toggleCheck(item.key); } });
    const age = item.status === 'snoozed' ? `until ${fmtWhen(item.snoozeUntil)}` : fmtRelative(item.at);
    return h('li', {
      class: `cmd-ib-row ib-row-${item.tone}${sel ? ' sel' : ''}${opened === item.key ? ' open' : ''}${checked.has(item.key) ? ' checked' : ''}`,
      role: 'option', 'aria-selected': String(sel), id: `ib-${cssId(item.key)}`, 'data-key': item.key,
      onclick: () => { cursor = item.key; open(item); },
    },
    box,
    c ? avatar(c.initials || c.name, 36) : h('span', { class: 'avatar cmd-ib-noav' }, icon(item.icon || 'inbox', 18)),
    h('span', { class: 'cmd-ib-text' },
      h('span', { class: 'cmd-ib-line1' }, h('span', { class: 'strong clamp1' }, c?.name || item.title),
        item.tone === 'urgent' ? h('span', { class: 'cmd-flag tone-urgent' }, icon('healing', 13), 'Urgent') : null,
        h('span', { class: 'cmd-ib-age' }, age)),
      h('span', { class: 'cmd-ib-title' }, h('span', { class: `cmd-ib-kind ib-${item.tone}`, title: KIND_LABEL[item.kind] || item.kind }, icon(item.icon || 'inbox', 14)),
        h('span', { class: 'clamp1' }, c ? item.title : KIND_LABEL[item.kind] || item.kind)),
      item.preview ? h('span', { class: 'cmd-ib-preview clamp2' }, item.preview) : null));
  }
  const cssId = key => key.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fmtWhen = iso => { const { day, clock } = londonNow(new Date(iso)); return day === londonNow().day ? clock : `${fmtDay(day)} ${clock}`; };

  function drawList({ fresh = [] } = {}) {
    if (!items.length) {
      const [title, line] = EMPTY[filter] || ['Nothing here.', 'Items of this kind land here as they arrive.'];
      fill(listEl, h('li', { class: 'cmd-ib-empty' }, emptyHero({ icon: filter === 'all' ? null : 'task_alt', title, line })));
      if (!opened) drawDetailEmpty();
    } else {
      fill(listEl, items.map(rowEl));
      for (const key of fresh) flash(listEl.querySelector(`[data-key="${CSS.escape(key)}"]`));
    }
    listEl.setAttribute('aria-activedescendant', cursor ? `ib-${cssId(cursor)}` : '');
    drawBulk();
    drawFilters();
  }

  function drawBulk() {
    bulk.hidden = !checked.size;
    if (!checked.size) return;
    const keys = [...checked];
    fill(bulk, h('span', { class: 'strong' }, `${keys.length} selected`),
      filter === 'done' || filter === 'snoozed'
        ? h('button', { type: 'button', class: 'btn small', onclick: () => change(keys, 'open') }, icon('undo', 16), 'Reopen')
        : h('button', { type: 'button', class: 'btn small primary', onclick: () => change(keys, 'done') }, icon('done_all', 16), 'Mark done'),
      filter === 'done' ? null : h('button', { type: 'button', class: 'btn small', onclick: e => snoozeMenu(e.currentTarget, keys) }, icon('snooze', 16), 'Snooze'),
      h('button', { type: 'button', class: 'btn small text', onclick: () => { checked.clear(); drawList(); } }, 'Clear'));
  }

  function toggleCheck(key) {
    if (checked.has(key)) checked.delete(key); else checked.add(key);
    const row = listEl.querySelector(`[data-key="${CSS.escape(key)}"]`);
    row?.classList.toggle('checked', checked.has(key));
    const cb = row?.querySelector('.cmd-ib-check');
    if (cb) cb.checked = checked.has(key);
    drawBulk();
  }

  // MARK: Loading and state changes

  async function reload({ first = false } = {}) {
    try {
      const out = await api('GET', `/api/inbox?filter=${enc(filter)}&limit=200`);
      if (!view.fresh()) return;
      const before = new Set(items.map(i => i.key));
      items = out.items;
      counts = out.counts;
      for (const k of [...checked]) if (!items.some(i => i.key === k)) checked.delete(k);
      if (cursor && !items.some(i => i.key === cursor)) cursor = null;
      if (!cursor && items.length && matchMedia('(min-width: 1101px)').matches) cursor = items[0].key;
      drawList({ fresh: first ? [] : items.filter(i => !before.has(i.key)).map(i => i.key) });
      if (first && cursor && matchMedia('(min-width: 1101px)').matches) open(items.find(i => i.key === cursor), { focus: false });
    } catch (err) {
      if (view.fresh() && first) fill(listEl, h('li', null, h('p', { class: 'error', role: 'alert' }, err.message), h('button', { type: 'button', class: 'btn small', onclick: () => reload({ first: true }) }, 'Try again')));
    }
  }

  /** done | snoozed | open for some keys: optimistic, with Undo; rolls back on an error. */
  async function change(keys, status, until = null) {
    const gone = items.filter(i => keys.includes(i.key));
    const keep = items;
    items = items.filter(i => !keys.includes(i.key));
    for (const k of keys) checked.delete(k);
    if (keys.includes(cursor)) cursor = nextAfter(keep, keys);
    if (keys.includes(opened)) { opened = null; if (cursor) open(items.find(i => i.key === cursor), { focus: false }); else drawDetailEmpty(); }
    if (counts) {
      for (const i of gone) {
        if (i.status === 'open') { counts.all--; counts[i.kind] = Math.max(0, (counts[i.kind] || 0) - 1); } else counts[i.status] = Math.max(0, (counts[i.status] || 0) - 1);
        if (status === 'done') counts.done++; else if (status === 'snoozed') counts.snoozed++;
        else { counts.all++; counts[i.kind] = (counts[i.kind] || 0) + 1; }
      }
    }
    drawList();
    try {
      await api('POST', '/api/inbox/state', { keys, status, ...(until ? { until: until.toISOString() } : {}) });
      invalidate();
      refreshBadges();
      const what = keys.length === 1 ? (gone[0]?.client ? firstName(gone[0].client.name) : 'Item') : `${keys.length} items`;
      const word = status === 'done' ? 'done' : status === 'snoozed' ? `snoozed until ${fmtWhen(until.toISOString())}` : 'back in the inbox';
      toast(`${what} · ${word}`, { undo: status === 'open' ? null : async () => { await api('POST', '/api/inbox/state', { keys, status: 'open' }); invalidate(); refreshBadges(); reload(); } });
    } catch (err) {
      items = keep;
      drawList();
      toast(err.message, { error: true });
      reload();
    }
  }
  const nextAfter = (list, keys) => {
    const i = list.findIndex(x => keys.includes(x.key));
    const rest = list.filter(x => !keys.includes(x.key));
    return rest[Math.min(Math.max(0, i), rest.length - 1)]?.key ?? null;
  };

  function snoozeMenu(anchor, keys) {
    menu(anchor, [
      ...snoozeChoices().map(c => ({ label: c.label, detail: c.detail, icon: 'snooze', onclick: () => change(keys, 'snoozed', c.until) })),
      'sep',
      { label: 'Pick a date…', icon: 'calendar_month', onclick: () => pickDate(anchor, keys) },
    ], { label: 'Snooze until' });
  }
  function pickDate(anchor, keys) {
    const { day } = londonNow();
    let d = day, t = '07:00';
    popover(anchor, (box, close) => {
      const go2 = h('button', { type: 'button', class: 'btn small primary' }, 'Snooze');
      go2.addEventListener('click', () => {
        const until = londonAt(d, t);
        if (!d || until.getTime() <= Date.now()) { toast('Pick a time in the future.', { error: true }); return; }
        close();
        change(keys, 'snoozed', until);
      });
      box.append(h('div', { class: 'cmd-ib-pick' }, h('div', { class: 'strong' }, 'Snooze until'),
        h('div', { class: 'row' }, dateField({ value: d, min: day, label: 'Day', onChange: v => { d = v; } }), timeField({ value: t, label: 'Time', onChange: v => { t = v; } })),
        h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn small text', onclick: close }, 'Cancel'), go2)));
      requestAnimationFrame(() => box.querySelector('input')?.focus());
    }, { label: 'Snooze until a date' });
  }

  // MARK: The item pane

  function drawDetailEmpty() {
    layout.classList.remove('has-detail');
    fill(detail, h('div', { class: 'cmd-ib-none' }, h('span', { class: 'brand-rule', 'aria-hidden': 'true' }),
      h('p', { class: 'cmd-ib-none-title' }, items.length ? 'Pick something to work on.' : 'Nothing waiting.'),
      h('p', { class: 'small muted' }, kbd('j'), ' ', kbd('k'), ' to move, ', kbd('↵'), ' to open.')));
  }

  function itemBar(item) {
    const c = item.client;
    return h('header', { class: 'cmd-ib-dhead' },
      h('button', { type: 'button', class: 'ui-icon-btn cmd-ib-back', 'aria-label': 'Back to the list', onclick: () => { layout.classList.remove('has-detail'); opened = null; drawList(); listEl.focus(); } }, icon('chevron_left', 20)),
      h('span', { class: `cmd-ib-dkind ib-${item.tone}` }, icon(item.icon || 'inbox', 16), KIND_LABEL[item.kind] || item.kind),
      h('span', { class: 'grow' }),
      item.status === 'open'
        ? [h('button', { type: 'button', class: 'btn small', title: 'Snooze (s)', onclick: e => snoozeMenu(e.currentTarget, [item.key]) }, icon('snooze', 16), 'Snooze'),
          h('button', { type: 'button', class: 'btn small primary', title: 'Done (e)', onclick: () => change([item.key], 'done') }, icon('check', 16), 'Done')]
        : h('button', { type: 'button', class: 'btn small', onclick: () => change([item.key], 'open') }, icon('undo', 16), 'Back to inbox'),
      c && item.ref?.type !== 'thread' ? link(`/clients/${enc(c.id)}`, { class: 'btn small text' }, `Open ${firstName(c.name)}`) : null);
  }

  async function open(item, { focus = true } = {}) {
    if (!item) return;
    opened = item.key;
    cursor = item.key;
    for (const row of listEl.querySelectorAll('.cmd-ib-row')) {
      const on = row.dataset.key === item.key;
      row.classList.toggle('sel', on); row.classList.toggle('open', on); row.setAttribute('aria-selected', String(on));
    }
    listEl.setAttribute('aria-activedescendant', `ib-${cssId(item.key)}`);
    layout.classList.add('has-detail');
    const sub = subView();
    const pane = h('div', { class: 'cmd-ib-dbody' });
    fill(detail, itemBar(item), pane);
    const ref = item.ref || {};
    try {
      // Moving through the list only previews a thread: opening it marks the messages read, which takes it out of the Inbox.
      if (ref.type === 'thread' && !focus) threadPreview(pane, item);
      else if (ref.type === 'thread') await threadPane(pane, ref.id, sub, { compact: true });
      else if (ref.type === 'checkin') await checkinView(pane, item, sub);
      else if (ref.type === 'form') await formView(pane, item, sub);
      else genericView(pane, item);
    } catch (err) {
      if (sub.fresh()) fill(pane, h('p', { class: 'error', role: 'alert' }, err.message));
    }
    if (focus && ref.type !== 'thread') detail.querySelector('.cmd-ib-dbody')?.focus?.();
  }

  /** A thread's unread messages without opening it (nothing is marked read). Enter, r or the button opens it. */
  function threadPreview(pane, item) {
    const c = item.client;
    fill(pane, h('div', { class: 'cmd-review', tabindex: '-1' },
      h('div', { class: 'cmd-review-who' }, avatar(c?.initials || c?.name || '?', 44),
        h('div', null, h('div', { class: 'cmd-review-name' }, c?.name || item.title), h('div', { class: 'small muted' }, `${item.title} · ${fmtRelative(item.at)}`))),
      item.tone === 'urgent' ? h('div', { class: 'cmd-review-alert' }, icon('healing', 18), h('span', null, h('strong', null, item.title)), h('span', { class: 'small' }, 'Reply before their next session.')) : null,
      h('blockquote', { class: 'cmd-quote' }, item.preview || 'Voice note'),
      h('div', { class: 'row end cmd-review-act' },
        h('span', { class: 'small muted grow' }, 'Opening the thread marks it read.'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => open(item) }, icon('reply', 18), 'Open and reply'))));
  }

  /** After a review elsewhere (Mark reviewed): the item has gone from its provider. */
  function reviewed(item, word) {
    items = items.filter(i => i.key !== item.key);
    if (counts) { counts.all = Math.max(0, counts.all - 1); counts[item.kind] = Math.max(0, (counts[item.kind] || 0) - 1); }
    cursor = items[0]?.key ?? null;
    opened = null;
    drawList();
    if (cursor && matchMedia('(min-width: 1101px)').matches) open(items[0], { focus: false }); else drawDetailEmpty();
    invalidate();
    refreshBadges();
    toast(word);
  }

  async function checkinView(pane, item, sub) {
    fill(pane, skeleton('card', { rows: 4 }));
    const { checkins } = await api('GET', `/api/checkins?clientId=${enc(item.clientId)}`);
    if (!sub.fresh()) return;
    const k = checkins.find(x => x.id === item.ref.id);
    if (!k) { fill(pane, h('p', { class: 'muted' }, 'This check-in is no longer there.')); return; }
    const meter = (label, v, max = 5) => h('div', { class: 'cmd-meter' }, h('span', { class: 'small muted' }, label),
      h('span', { class: 'cmd-meter-dots', role: 'img', 'aria-label': `${label} ${v ?? 'not given'} of ${max}` },
        Array.from({ length: max }, (_, i) => h('span', { class: `cmd-meter-dot${v !== null && i < v ? ' on' : ''}` }))),
      h('span', { class: 't-num strong' }, v === null || v === undefined ? '–' : `${v}/${max}`));
    const reply = h('textarea', { class: 'cmd-ib-reply', rows: '3', maxlength: '2000', placeholder: `A line back to ${firstName(item.client?.name)} (optional). They see it with their check-in.`, 'aria-label': 'Reply' });
    const btn = h('button', { type: 'button', class: 'btn primary' }, icon('task_alt', 18), 'Mark reviewed');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await api('POST', `/api/checkins/${enc(k.id)}/review`, { reply: reply.value.trim() }); reviewed(item, 'Check-in reviewed'); } catch (err) { btn.disabled = false; toast(err.message, { error: true }); }
    });
    fill(pane, h('div', { class: 'cmd-review', tabindex: '-1' },
      h('div', { class: 'cmd-review-who' }, avatar(item.client?.initials || item.client?.name || '?', 44),
        h('div', null, h('div', { class: 'cmd-review-name' }, item.client?.name), h('div', { class: 'small muted' }, `Weekly check-in · week of ${fmtDay(k.week)}`))),
      k.pain?.length ? h('div', { class: 'cmd-review-alert' }, icon('healing', 18), h('span', null, h('strong', null, 'Pain reported: '), k.pain.join(', ')), h('span', { class: 'small' }, 'Check in before the next session.')) : null,
      h('div', { class: 'cmd-meters' }, meter('Energy', k.energy), meter('Sleep', k.sleep), k.stress !== null ? meter('Stress', k.stress) : null),
      k.note ? h('blockquote', { class: 'cmd-quote' }, k.note) : null,
      k.win ? h('div', { class: 'cmd-review-line' }, h('span', { class: 'cmd-review-k tone-ok' }, icon('star', 15), 'Win'), h('span', null, k.win)) : null,
      k.struggle ? h('div', { class: 'cmd-review-line' }, h('span', { class: 'cmd-review-k tone-attention' }, icon('front_hand', 15), 'Struggle'), h('span', null, k.struggle)) : null,
      h('div', { class: 'cmd-review-act' }, reply, h('div', { class: 'row end' }, link(`/clients/${enc(item.clientId)}/letters`, { class: 'btn text' }, 'Write their letter'), btn))));
  }

  async function formView(pane, item, sub) {
    fill(pane, skeleton('card', { rows: 4 }));
    const r = await api('GET', `/api/form-requests/${enc(item.ref.id)}`);
    if (!sub.fresh()) return;
    const flagged = new Set(r.flagged || []);
    const show = (q, a) => (a === undefined || a === null || a === '' ? '–' : a === true ? 'Yes' : a === false ? 'No' : String(a));
    const btn = h('button', { type: 'button', class: 'btn primary' }, icon('task_alt', 18), 'Mark reviewed');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await api('POST', `/api/form-requests/${enc(r.id)}/review`); reviewed(item, 'Form reviewed'); } catch (err) { btn.disabled = false; toast(err.message, { error: true }); }
    });
    fill(pane, h('div', { class: 'cmd-review', tabindex: '-1' },
      h('div', { class: 'cmd-review-who' }, avatar(r.client?.initials || r.client?.name || '?', 44),
        h('div', null, h('div', { class: 'cmd-review-name' }, r.name), h('div', { class: 'small muted' }, `${r.client?.name || ''} · answered ${fmtRelative(r.submittedAt)}`))),
      flagged.size ? h('div', { class: 'cmd-review-alert' }, icon('gpp_maybe', 18), h('span', null, h('strong', null, 'Health flag: '), `${flagged.size} “yes” ${flagged.size === 1 ? 'answer' : 'answers'}`), h('span', { class: 'small' }, 'Talk before the next session.')) : null,
      h('dl', { class: 'cmd-answers' }, (r.questions || []).map(q => {
        const a = r.answers?.[q.id];
        const flag = flagged.has(q.label);
        return [h('dt', { class: flag ? 'flag' : '' }, flag ? icon('gpp_maybe', 15, { label: 'Health flag' }) : null, q.label),
          h('dd', { class: `${flag ? 'flag ' : ''}${typeof a === 'string' && a.length > 60 ? 'long' : ''}` }, show(q, a))];
      })),
      h('div', { class: 'row end cmd-review-act' }, btn)));
  }

  function genericView(pane, item) {
    const actions = (item.actions || []).map(a => {
      const b = h('button', { type: 'button', class: 'btn' }, a.label);
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await api(a.method, a.url, a.body); toast(`${a.label}: done`); invalidate(); refreshBadges(); reload(); } catch (err) { toast(err.message, { error: true }); } finally { b.disabled = false; }
      });
      return b;
    });
    fill(pane, h('div', { class: 'cmd-review', tabindex: '-1' },
      h('div', { class: 'cmd-review-who' }, item.client ? avatar(item.client.initials || item.client.name, 44) : h('span', { class: 'avatar cmd-ib-noav big' }, icon(item.icon || 'inbox', 22)),
        h('div', null, h('div', { class: 'cmd-review-name' }, item.title), h('div', { class: 'small muted' }, [item.client?.name, KIND_LABEL[item.kind] || item.kind].filter(Boolean).join(' · ')))),
      item.preview ? h('blockquote', { class: 'cmd-quote' }, item.preview) : null,
      h('div', { class: 'row end cmd-review-act' }, actions, item.path ? link(item.path, { class: 'btn primary' }, 'Open', icon('chevron_right', 16)) : null)));
  }

  // MARK: Keyboard: j/k move, Enter open, e done, s snooze, r reply, x select

  const onKey = e => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(document.activeElement)) return;
    if (document.querySelector('dialog[open], .ui-slide-host, .pal-host, .ui-pop')) return;
    const i = items.findIndex(x => x.key === cursor);
    const at = i < 0 ? null : items[i];
    const move = d => {
      if (!items.length) return;
      const next = items[Math.max(0, Math.min(items.length - 1, (i < 0 ? -1 : i) + d))];
      cursor = next.key;
      for (const row of listEl.querySelectorAll('.cmd-ib-row')) { const on = row.dataset.key === cursor; row.classList.toggle('sel', on); row.setAttribute('aria-selected', String(on)); }
      listEl.setAttribute('aria-activedescendant', `ib-${cssId(cursor)}`);
      listEl.querySelector('.cmd-ib-row.sel')?.scrollIntoView({ block: 'nearest' });
      if (matchMedia('(min-width: 1101px)').matches) { clearTimeout(onKey.t); onKey.t = setTimeout(() => open(next, { focus: false }), 220); }
    };
    const k = e.key;
    if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (k === 'Enter' && at) { e.preventDefault(); open(at); }
    else if (k === 'x' && at) { e.preventDefault(); toggleCheck(at.key); }
    else if (k === 'e' && (checked.size || at)) {
      e.preventDefault();
      const keys = checked.size ? [...checked] : [at.key];
      change(keys, filter === 'done' || filter === 'snoozed' ? 'open' : 'done');
    } else if (k === 's' && (checked.size || at) && filter !== 'done') {
      e.preventDefault();
      const keys = checked.size ? [...checked] : [at.key];
      snoozeMenu(listEl.querySelector(`[data-key="${CSS.escape(keys[0])}"]`) || listEl, keys);
    } else if (k === 'r' && at) {
      e.preventDefault();
      if (at.ref?.type === 'thread') {
        const focusBox = () => detail.querySelector('textarea')?.focus();
        if (opened === at.key && detail.querySelector('.thread-pane')) focusBox(); else open(at).then(focusBox);
      } else if (at.clientId) go(`/messages/${enc(at.clientId)}`);
      else if (at.path) go(at.path);
    }
  };
  document.addEventListener('keydown', onKey);
  view.onLeave(() => { document.removeEventListener('keydown', onKey); clearTimeout(onKey.t); });

  drawFilters();
  fill(listEl, h('li', null, skeleton('table', { rows: 6 })));
  drawDetailEmpty();
  await reload({ first: true });
  onRefresh(view, () => reload(), { wait: 900 });
});
