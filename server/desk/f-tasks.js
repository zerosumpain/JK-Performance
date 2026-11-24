/*
 * F23 Coach tasks (docs/design/desk-v2.md, WP8): the /tasks board, a kanban by
 * due bucket with natural quick-add ("Call Sam tomorrow 9am #billing !high",
 * parsed on the server), the task slide-over (#…?panel=task:<id>), the Today
 * widget, the client 360 "Tasks" tab, the "Add task" client action and the
 * "+ New › Task" quick-create.
 *
 * Every piece of task text goes on the page through h() (textContent).
 */
import {
  addDays, api, avatar, button, clients, confirmBox, errorLine, fill, firstName, fmtDay, fmtRelative, fmtTime, h, icon, londonParts, link, live, mondayOf,
  registerClientAction, registerClientTab, registerCommand, registerNav, registerPanel, registerQuickCreate, registerWidget, ring, route, setCrumbs, toast, todayLondon,
} from './core.js';
import { dateField, emptyHero, inlineEdit, kanban, kbd, menu, openPanel, pageHead, segmentedNav, skeleton, slideOver, timeField } from './ui.js';

const enc = encodeURIComponent;
const COLUMNS = [
  { id: 'overdue', label: 'Overdue', tone: 'urgent' },
  { id: 'today', label: 'Today', tone: 'accent' },
  { id: 'week', label: 'This week', tone: 'data' },
  { id: 'later', label: 'Later' },
  { id: 'none', label: 'No date' },
  { id: 'done', label: 'Done this week', tone: 'ok' },
];
const SOURCE = {
  manual: null,
  automation: { icon: 'bolt', word: 'From an automation' },
  voice: { icon: 'mic', word: 'From a voice note' },
  ai: { icon: 'auto_awesome', word: 'Suggested by AI' },
  dunning: { icon: 'receipt_long', word: 'From a payment reminder' },
};
const PRIORITY = { high: { word: 'High', icon: 'flag', tone: 'attention' }, normal: { word: 'Normal' }, low: { word: 'Low' } };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Something about tasks changed: open screens and widgets reload. */
const changed = () => window.dispatchEvent(new CustomEvent('tasks:changed'));

// MARK: - Words

/** "Today 12:30", "Tomorrow", "2 days late", "Thu 26 Nov". */
export function dueLabel(t, today = todayLondon()) {
  if (!t.dueOn) return null;
  const time = t.dueTime ? ` ${t.dueTime}` : '';
  if (t.dueOn === today) return `Today${time}`;
  if (t.dueOn === addDays(today, 1)) return `Tomorrow${time}`;
  if (t.dueOn === addDays(today, -1)) return `Yesterday${time}`;
  if (t.dueOn < today) { const n = Math.round((Date.parse(today) - Date.parse(t.dueOn)) / 86_400_000); return `${n} days late`; }
  return `${fmtDay(t.dueOn)}${time}`;
}

function clientChip(c, { small = true } = {}) {
  if (!c) return null;
  return h('span', { class: 'tk-client' + (small ? ' small' : '') }, avatar(c.initials || c.name, small ? 18 : 22), h('span', null, small ? firstName(c.name) : c.name));
}

// MARK: - Actions

async function setDone(t, done = true) {
  const out = await api('POST', `/api/tasks/${enc(t.id)}/${done ? 'done' : 'reopen'}`);
  changed();
  if (done) toast(`Done: ${t.title}`, { undo: async () => { await api('POST', `/api/tasks/${enc(t.id)}/reopen`); changed(); } });
  return out.task;
}

function snoozeChoices(today = todayLondon()) {
  const now = new Date();
  const later = new Date(now.getTime() + 3 * 3_600_000);
  const monday = addDays(mondayOf(today), 7);
  return [
    { label: 'Later today', detail: fmtTime(new Date(Math.ceil(later.getTime() / 3_600_000) * 3_600_000).toISOString()), until: new Date(Math.ceil(later.getTime() / 3_600_000) * 3_600_000).toISOString(), ok: londonParts(later.toISOString()).day === today },
    { label: 'Tomorrow', detail: fmtDay(addDays(today, 1)), until: addDays(today, 1), ok: true },
    { label: 'In 3 days', detail: fmtDay(addDays(today, 3)), until: addDays(today, 3), ok: true },
    { label: 'Next week', detail: fmtDay(monday), until: monday, ok: true },
  ].filter(c => c.ok);
}

function snoozeMenu(anchor, t) {
  menu(anchor, snoozeChoices().map(c => ({
    label: c.label, detail: c.detail, icon: 'snooze',
    onclick: async () => {
      try {
        const before = { dueOn: t.dueOn, dueAt: t.dueAt };
        await api('POST', `/api/tasks/${enc(t.id)}/snooze`, { until: c.until });
        changed();
        toast(`Snoozed to ${c.label.toLowerCase()}`, { undo: async () => { await api('PATCH', `/api/tasks/${enc(t.id)}`, before); changed(); } });
      } catch (err) { toast(err.message, { error: true }); }
    },
  })), { label: 'Snooze until' });
}

// MARK: - Quick add

/**
 * The natural-language line: a live preview (parsed on the server as you type)
 * with removable client, date, tag and priority chips; Enter creates it.
 * `fixedClient` (the client tab) pins the client.
 */
export function quickAdd({ fixedClient = null, onCreated = null, autofocus = false, compact = false } = {}) {
  const input = h('input', {
    class: 'tk-qa-input', type: 'text', maxlength: '400', autocomplete: 'off', spellcheck: 'true', autofocus: autofocus ? true : null,
    placeholder: fixedClient ? `Add a task for ${firstName(fixedClient.name)}… “send race plan fri #race”` : 'Add a task… try “Call Sam tomorrow 9am #billing !high”',
    'aria-label': 'New task', 'aria-describedby': 'tk-qa-help',
  });
  const preview = h('div', { class: 'tk-qa-preview', 'aria-live': 'polite' });
  let parsed = null, dropClient = false, seq = 0, timer = null;
  const drawPreview = () => {
    if (!parsed || !input.value.trim()) { preview.replaceChildren(); return; }
    const p = parsed;
    const chips = [];
    if (p.dueOn) chips.push(h('span', { class: 'tk-chip' }, icon('calendar_month', 14), dueLabel({ dueOn: p.dueOn, dueTime: p.dueTime }) ?? p.dueOn));
    const who = fixedClient ?? (p.clientId && !dropClient ? { id: p.clientId, name: p.clientName } : null);
    if (who) {
      chips.push(h('span', { class: 'tk-chip on' }, avatar(who.name, 16), who.name,
        fixedClient ? null : h('button', { type: 'button', class: 'tk-chip-x', 'aria-label': `Don’t link ${who.name}`, onclick: () => { dropClient = true; drawPreview(); input.focus(); } }, icon('close', 12))));
    }
    for (const t of p.tags) chips.push(h('span', { class: 'tk-chip tag' }, `#${t}`));
    if (p.priority !== 'normal') chips.push(h('span', { class: `tk-chip prio-${p.priority}` }, icon('flag', 14), `${PRIORITY[p.priority].word} priority`));
    preview.replaceChildren(h('span', { class: 'tk-qa-title' }, p.title || 'Untitled'), ...chips);
  };
  const doParse = async () => {
    const text = input.value.trim();
    const mine = ++seq;
    if (!text) { parsed = null; drawPreview(); return null; }
    const p = await api('POST', '/api/tasks/parse', { text });
    if (mine === seq) { parsed = p; drawPreview(); }
    return p;
  };
  input.addEventListener('input', () => { dropClient = false; clearTimeout(timer); timer = setTimeout(() => doParse().catch(() => {}), 180); });
  input.addEventListener('keydown', async e => {
    if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; parsed = null; drawPreview(); return; }
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    clearTimeout(timer);
    if (!input.value.trim()) return;
    input.disabled = true;
    try {
      const p = await doParse();
      if (!p?.title) { toast('Give the task a few words as well as a date.', { error: true }); return; }
      const clientId = fixedClient?.id ?? (dropClient ? null : p.clientId);
      const { task } = await api('POST', '/api/tasks', { title: p.title, clientId, dueOn: p.dueOn, dueAt: p.dueAt, tags: p.tags, priority: p.priority });
      input.value = ''; parsed = null; dropClient = false; drawPreview();
      changed();
      onCreated?.(task);
      toast(`Added: ${task.title}`, { action: { label: 'Open', run: () => openPanel('task', task.id) }, undo: async () => { await api('DELETE', `/api/tasks/${enc(task.id)}`); changed(); } });
    } catch (err) {
      toast(err.message, { error: true });
    } finally {
      input.disabled = false;
      input.focus();
    }
  });
  const el = h('div', { class: 'tk-qa' + (compact ? ' compact' : '') },
    h('label', { class: 'tk-qa-box' }, h('span', { class: 'tk-qa-plus', 'aria-hidden': 'true' }, icon('add', 20)), input, compact ? null : h('span', { class: 'tk-qa-kbd', 'aria-hidden': 'true' }, kbd('↵'))),
    preview,
    compact ? null : h('p', { class: 'tk-qa-help', id: 'tk-qa-help' }, 'Dates: today, tomorrow, fri, next mon, 15 Dec, in 3 days. Times: 9am, 14:30. ', h('b', null, '#tag'), ' and ', h('b', null, '!high'), '. A client’s name links them.'));
  el.focus = () => input.focus();
  return el;
}

// MARK: - Task panel (slide-over)

function sourceLine(t) {
  const s = SOURCE[t.source];
  if (!s) return null;
  return h('div', { class: 'tk-source' }, icon(s.icon, 16), h('span', null, s.word), t.sourcePath ? link(t.sourcePath, { class: 'tk-source-link' }, 'Open', icon('open_in_new', 14)) : null);
}

/** The task's fields, editable in place; each change saves at once. */
function taskBody(body, close, task, { setTitle } = {}) {
  let t = task;
  const save = async patch => {
    try {
      t = (await api('PATCH', `/api/tasks/${enc(t.id)}`, patch)).task;
      changed();
      draw();
    } catch (err) { toast(err.message, { error: true }); draw(); }
  };
  const draw = async () => {
    setTitle?.(t.status === 'done' ? 'Done' : 'Task');
    const list = await clients().catch(() => []);
    const clientSel = h('select', { 'aria-label': 'Client', onchange: e => save({ clientId: e.target.value || null }) },
      h('option', { value: '' }, 'No client'), list.map(c => h('option', { value: c.id, selected: c.id === t.client?.id }, c.name)));
    const date = dateField({ value: t.dueOn ?? '', label: 'Due day', onChange: v => save({ dueOn: v || null }) });
    const time = timeField({ value: t.dueTime ?? '', label: 'Due time', onChange: v => save({ dueTime: v || null }) });
    const notes = h('textarea', { class: 'tk-notes', rows: '5', placeholder: 'Notes: what to say, what to check…', 'aria-label': 'Notes', maxlength: '4000' });
    notes.value = t.notes;
    notes.addEventListener('blur', () => { if (notes.value !== t.notes) save({ notes: notes.value }); });
    const tagInput = h('input', { class: 'tk-tag-input', placeholder: 'Add tag', 'aria-label': 'Add a tag', maxlength: '30' });
    tagInput.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ',') return;
      e.preventDefault();
      const v = tagInput.value.trim().replace(/^#/, '').toLowerCase();
      if (v && !t.tags.includes(v)) save({ tags: [...t.tags, v] });
    });
    const doneBtn = t.status === 'done'
      ? button('Reopen', async () => { t = await setDone(t, false); draw(); }, { kind: '' })
      : h('button', { type: 'button', class: 'btn primary', onclick: async () => { t = await setDone(t, true); close(); } }, icon('check', 18), 'Mark done');
    const snoozeBtn = h('button', { type: 'button', class: 'btn', onclick: e => snoozeMenu(e.currentTarget, t) }, icon('snooze', 18), 'Snooze');
    const delBtn = h('button', { type: 'button', class: 'btn text danger', onclick: async () => {
      if (!await confirmBox('Delete this task?', { ok: 'Delete', danger: true, detail: t.title })) return;
      await api('DELETE', `/api/tasks/${enc(t.id)}`); changed(); close(); toast('Task deleted');
    } }, icon('delete', 18), 'Delete');
    fill(body,
      h('div', { class: 'tk-panel-title' + (t.status === 'done' ? ' done' : '') }, inlineEdit(t.title, v => save({ title: v }), { label: 'Title', placeholder: 'What needs doing?' })),
      h('div', { class: 'tk-panel-meta' },
        t.status === 'done' ? h('span', { class: 'pill' }, h('span', { class: 'dot bg-ok' }), `Done ${fmtRelative(t.doneAt)}`) : null,
        t.dueOn && t.status !== 'done' ? h('span', { class: `pill${t.bucket === 'overdue' ? ' tk-late' : ''}` }, icon('calendar_month', 14), dueLabel(t)) : null,
        t.client ? link(`/clients/${enc(t.client.id)}`, { class: 'pill tk-pill-client', onclick: () => close() }, avatar(t.client.initials, 18), t.client.name) : null,
        sourceLine(t)),
      h('div', { class: 'tk-panel-actions' }, doneBtn, t.status === 'done' ? null : snoozeBtn, h('span', { class: 'grow' }), delBtn),
      h('div', { class: 'tk-form' },
        h('div', { class: 'tk-row' }, h('span', { class: 'tk-label' }, 'Client'), clientSel),
        h('div', { class: 'tk-row' }, h('span', { class: 'tk-label' }, 'Due'), h('span', { class: 'tk-when' }, date, time,
          t.dueOn ? h('button', { type: 'button', class: 'ui-icon-btn', 'aria-label': 'Clear the date', onclick: () => save({ dueOn: null }) }, icon('close', 16)) : null)),
        h('div', { class: 'tk-row' }, h('span', { class: 'tk-label' }, 'Priority'),
          segmentedNav([['low', 'Low'], ['normal', 'Normal'], ['high', 'High']], t.priority, v => save({ priority: v }), { label: 'Priority' })),
        h('div', { class: 'tk-row' }, h('span', { class: 'tk-label' }, 'Tags'), h('span', { class: 'tk-tags' },
          t.tags.map(tag => h('span', { class: 'tk-chip tag' }, `#${tag}`, h('button', { type: 'button', class: 'tk-chip-x', 'aria-label': `Remove ${tag}`, onclick: () => save({ tags: t.tags.filter(x => x !== tag) }) }, icon('close', 12)))),
          tagInput)),
        h('div', { class: 'tk-row top' }, h('span', { class: 'tk-label' }, 'Notes'), notes)),
      h('p', { class: 'tk-foot small muted' }, `Added ${fmtRelative(t.createdAt)}`));
  };
  draw();
}

registerPanel('task', id => ({
  title: 'Task',
  build(body, close, opts) {
    body.append(skeleton('card'));
    api('GET', `/api/tasks/${enc(id)}`).then(({ task }) => taskBody(body, close, task, opts))
      .catch(err => body.replaceChildren(errorLine(err.status === 404 ? 'That task is gone.' : err)));
  },
}));

/** A new task: the quick-add line, pre-linked to a client when given. */
export function openNewTask({ client = null } = {}) {
  slideOver(client ? `New task · ${firstName(client.name)}` : 'New task', (body, close) => {
    const qa = quickAdd({ fixedClient: client, autofocus: true, onCreated: task => { close(); openPanel('task', task.id); } });
    body.append(h('p', { class: 'muted small tk-new-line' }, 'Write it the way you’d say it. Enter adds it; you can fill in the rest after.'), qa);
    requestAnimationFrame(() => qa.focus());
  });
}

// MARK: - Cards and rows

function card(t, onOpen) {
  const s = SOURCE[t.source];
  const due = t.status === 'done' ? null : dueLabel(t);
  return h('div', { class: `tk-card prio-${t.priority}${t.status === 'done' ? ' done' : ''}` },
    h('button', {
      type: 'button', class: 'tk-check', 'aria-label': t.status === 'done' ? `Reopen ${t.title}` : `Mark ${t.title} done`, title: t.status === 'done' ? 'Reopen' : 'Done (e)',
      onclick: async e => {
        e.stopPropagation();
        const cardEl = e.currentTarget.closest('.ui-kb-card');
        cardEl?.classList.add('tk-completing');
        try { await setDone(t, t.status !== 'done'); } catch (err) { cardEl?.classList.remove('tk-completing'); toast(err.message, { error: true }); }
      },
    }, icon('check', 14)),
    h('div', { class: 'tk-card-main', onclick: () => onOpen(t) },
      h('div', { class: 'tk-card-title' }, t.title),
      h('div', { class: 'tk-card-meta' },
        t.client ? clientChip(t.client) : null,
        due ? h('span', { class: `tk-due${t.bucket === 'overdue' ? ' late' : ''}` }, icon(t.bucket === 'overdue' ? 'alarm' : 'schedule', 13), due) : null,
        t.status === 'done' && t.doneAt ? h('span', { class: 'tk-due' }, icon('done_all', 13), fmtRelative(t.doneAt)) : null,
        s ? h('span', { class: 'tk-src', title: s.word, 'aria-label': s.word }, icon(s.icon, 14)) : null),
      t.tags.length ? h('div', { class: 'tk-card-tags' }, t.tags.slice(0, 3).map(tag => h('span', { class: 'tk-tag' }, `#${tag}`))) : null),
    t.priority === 'high' ? h('span', { class: 'tk-flag', title: 'High priority', 'aria-label': 'High priority' }, icon('flag', 15, { filled: true })) : null);
}

/** One row in a list (widget, client tab): check, title, when. */
function row(t, { hideClient = false } = {}) {
  const due = dueLabel(t);
  return h('li', { class: `tk-row-item prio-${t.priority}${t.status === 'done' ? ' done' : ''}` },
    h('button', { type: 'button', class: 'tk-check', 'aria-label': t.status === 'done' ? `Reopen ${t.title}` : `Mark ${t.title} done`,
      onclick: async e => { e.currentTarget.closest('li')?.classList.add('tk-completing'); try { await setDone(t, t.status !== 'done'); } catch (err) { toast(err.message, { error: true }); } } }, icon('check', 14)),
    h('button', { type: 'button', class: 'tk-row-main', onclick: () => openPanel('task', t.id) },
      h('span', { class: 'tk-row-title' }, t.title),
      h('span', { class: 'tk-row-meta' }, t.client && !hideClient ? firstName(t.client.name) : null, t.client && !hideClient && due ? ' · ' : null,
        due ? h('span', { class: t.bucket === 'overdue' ? 'tk-late-text' : null }, due) : null)),
    t.priority === 'high' ? h('span', { class: 'tk-flag', 'aria-label': 'High priority' }, icon('flag', 14, { filled: true })) : null);
}

// MARK: - The board (/tasks)

/** Where a card dropped in a column should land, from its new neighbours. */
function positionAt(list, index) {
  const before = list[index - 1], after = list[index];
  if (before && after) return (before.position + after.position) / 2;
  if (before) return before.position + 1;
  if (after) return after.position - 1;
  return 0;
}

function dueFor(col, today) {
  if (col === 'today') return today;
  if (col === 'week') {
    const d = addDays(today, 1);
    if (d > addDays(mondayOf(today), 6)) throw new Error('No days left this week: drop it on Later');
    return d;
  }
  if (col === 'later') return addDays(mondayOf(today), 7);
  if (col === 'none') return null;
  throw new Error('Pick a day: drop it on Today or later');
}

route('/tasks', async (el, _params, view) => {
  setCrumbs([{ label: 'Schedule' }, { label: 'Tasks', path: '/tasks' }]);
  let data = null;
  let filter = 'all';
  const sub = h('span');
  const ringBox = h('span', { class: 'tk-week' });
  const head = pageHead({ eyebrow: 'Schedule', title: 'Tasks', accent: 'in hand', sub, actions: [ringBox, h('button', { type: 'button', class: 'btn primary', onclick: () => openNewTask() }, icon('add', 18), 'New task')] });
  const qa = quickAdd();
  const filters = segmentedNav([['all', 'Everything'], ['clients', 'About clients'], ['mine', 'My own'], ['high', 'High priority']], filter, v => { filter = v; draw(); }, { label: 'Show' });
  const boardBox = h('div', { class: 'tk-board' }, skeleton('table', { rows: 4 }));
  el.append(head, h('section', { class: 'tk-top' }, qa, h('div', { class: 'tk-filters' }, filters, h('span', { class: 'tk-keys small muted' }, kbd('e'), ' done ', kbd('s'), ' snooze ', kbd('j'), kbd('k'), ' move'))), boardBox);
  let board = null;

  const shown = () => (data?.tasks ?? []).filter(t => t.bucket && (filter === 'all' || (filter === 'clients' && t.client) || (filter === 'mine' && !t.client) || (filter === 'high' && t.priority === 'high')));
  const open = t => openPanel('task', t.id);
  function drawHead() {
    const c = data.counts;
    fill(sub, [c.overdue ? plural(c.overdue, 'overdue task').replace('overdue tasks', 'overdue') : null, `${c.today} due today`, `${c.week} more this week`, `${c.done} done this week`].filter(Boolean).join(' · '));
    const total = c.done + c.overdue + c.today + c.week;
    const pct = total ? Math.round((c.done / total) * 100) : 0;
    fill(ringBox, h('span', { class: 'tk-week-ring' }, ring(pct, { size: 40, stroke: 3, label: `${c.done} of ${total} this week done` }), h('span', { class: 'tk-week-pct', 'aria-hidden': 'true' }, `${pct}%`)),
      h('span', { class: 'tk-week-text' }, h('b', null, `${c.done} of ${total}`), h('span', null, 'this week')));
  }
  function draw() {
    if (!data) return;
    drawHead();
    const items = shown();
    if (!data.tasks.length) {
      boardBox.replaceChildren(emptyHero({ icon: 'task_alt', title: 'A clear list.', line: 'Add the first thing on your mind above: “Call Sam tomorrow 9am”.' }));
      return;
    }
    if (!board) {
      board = kanban({
        columns: COLUMNS, items, columnOf: t => t.bucket, render: t => card(t, open), onOpen: open, label: 'Tasks by due day',
        sum: list => (list.some(t => t.priority === 'high') ? `${list.filter(t => t.priority === 'high').length} high` : ''),
        async onMove(t, col, index) {
          const today = data.today;
          const others = shown().filter(x => x.bucket === col && x.id !== t.id);
          const position = positionAt(others, index);
          if (col === 'done') { if (t.status !== 'done') await setDone(t, true); return; }
          if (t.status === 'done') await api('POST', `/api/tasks/${enc(t.id)}/reopen`);
          if (col === t.bucket) { await api('PATCH', `/api/tasks/${enc(t.id)}`, { position }); changed(); return; }
          const dueOn = dueFor(col, today);
          await api('PATCH', `/api/tasks/${enc(t.id)}`, { dueOn, position });
          changed();
        },
      });
      boardBox.replaceChildren(board.el);
    } else board.setItems(items);
  }
  async function load() {
    try {
      data = await api('GET', '/api/tasks');
      if (view.fresh()) draw();
    } catch (err) { if (view.fresh()) boardBox.replaceChildren(errorLine(err)); }
  }
  let pending = null;
  const reload = () => { clearTimeout(pending); pending = setTimeout(load, 120); };
  window.addEventListener('tasks:changed', reload);
  const offs = ['task.created', 'task.done', 'task.due'].map(type => live.on(type, reload));
  // List keys on a focused card: e done, s snooze, j/k move.
  const onKey = e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const cardEl = document.activeElement?.closest?.('.ui-kb-card');
    if (!cardEl || !boardBox.contains(cardEl) || cardEl.getAttribute('aria-pressed') === 'true') return;
    const t = data?.tasks.find(x => x.id === cardEl.dataset.key);
    if (!t) return;
    if (e.key === 'e') { e.preventDefault(); setDone(t, t.status !== 'done').catch(err => toast(err.message, { error: true })); }
    else if (e.key === 's' && t.status !== 'done') { e.preventDefault(); snoozeMenu(cardEl, t); }
    else if (e.key === 'j' || e.key === 'k') {
      e.preventDefault();
      const cards = [...boardBox.querySelectorAll('.ui-kb-card')];
      cards[Math.max(0, Math.min(cards.length - 1, cards.indexOf(cardEl) + (e.key === 'j' ? 1 : -1)))]?.focus();
    }
  };
  document.addEventListener('keydown', onKey);
  view.onLeave(() => { window.removeEventListener('tasks:changed', reload); offs.forEach(off => off()); document.removeEventListener('keydown', onKey); clearTimeout(pending); });
  await load();
}, { nav: 'tasks' });

// MARK: - Registrations

registerNav({ id: 'tasks', label: 'Tasks', icon: 'task_alt', group: 'schedule', order: 30, badge: true, badgeOn: ['task.created', 'task.done', 'task.due'] });
registerQuickCreate({ id: 'task', label: 'Task', icon: 'task_alt', order: 45, run: () => openNewTask() });
registerCommand({ id: 'task-new', label: 'New task', icon: 'task_alt', group: 'Actions', run: () => openNewTask() });
registerClientAction({ id: 'add-task', label: 'Add task', icon: 'task_alt', order: 40, run: client => openNewTask({ client }) });

registerWidget({
  id: 'tasks', title: 'Tasks', icon: 'task_alt', size: 's', order: 70,
  async render(box, view) {
    const draw = async () => {
      const data = await api('GET', '/api/tasks?status=open');
      if (!view.fresh()) return;
      const due = data.tasks.filter(t => t.bucket === 'overdue' || t.bucket === 'today');
      const next = due.length ? due : data.tasks.filter(t => t.bucket === 'week');
      fill(box,
        h('div', { class: 'tk-w-head' }, h('span', { class: 't-number' }, String(due.length)),
          h('span', { class: 'tk-w-k' }, due.length ? (data.counts.overdue ? 'due' : 'due today') : 'nothing due today', data.counts.overdue ? h('span', { class: 'tk-late-text' }, ` · ${data.counts.overdue} overdue`) : null)),
        next.length ? h('ul', { class: 'tk-list' }, next.slice(0, 4).map(row)) : h('p', { class: 'muted small' }, 'A clear day. Enjoy it.'),
        link('/tasks', { class: 'tk-w-more' }, next.length > 4 ? `${next.length - 4} more` : 'All tasks', icon('chevron_right', 16)));
    };
    const reload = () => draw().catch(() => {});
    window.addEventListener('tasks:changed', reload);
    view.onLeave?.(() => window.removeEventListener('tasks:changed', reload));
    await draw();
  },
});

registerClientTab({
  key: 'tasks', label: 'Tasks', order: 85,
  async render(box, { client, view }) {
    const who = { id: client?.id, name: client?.name ?? 'Client' };
    const list = h('div', { class: 'tk-tab-list' }, skeleton('lines', { rows: 3 }));
    box.append(h('div', { class: 'tk-tab' }, quickAdd({ fixedClient: who, compact: true }), list));
    const draw = async () => {
      const data = await api('GET', `/api/tasks?status=all&clientId=${enc(who.id)}`);
      if (!view.fresh()) return;
      const open = data.tasks.filter(t => t.status === 'open');
      const done = data.tasks.filter(t => t.status === 'done').sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1)).slice(0, 8);
      const group = (label, items) => (items.length ? h('section', { class: 'tk-group' }, h('h3', { class: 'tk-group-label' }, label, h('span', { class: 'ui-count' }, String(items.length))), h('ul', { class: 'tk-list' }, items.map(t => row(t, { hideClient: true })))) : null);
      fill(list, open.length || done.length ? [
        group('Overdue', open.filter(t => t.bucket === 'overdue')), group('Today', open.filter(t => t.bucket === 'today')),
        group('Coming up', open.filter(t => t.bucket === 'week' || t.bucket === 'later')), group('No date', open.filter(t => t.bucket === 'none')),
        group('Done', done)] : emptyHero({ icon: 'task_alt', title: `Nothing on for ${firstName(who.name)}.`, line: 'Add a to-do above, and it shows here and on your board.' }));
    };
    const reload = () => draw().catch(() => {});
    window.addEventListener('tasks:changed', reload);
    view.onLeave?.(() => window.removeEventListener('tasks:changed', reload));
    await draw();
  },
});
