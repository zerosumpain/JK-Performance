/*
 * Programs: the coach's templates and automation, as on the iPhone app's
 * ProgramsView (CoachViews.swift) and AutomationViews.swift.
 *
 *   #/programs[/programs|autoflows|forms]   the three tabs
 *   #/programs/programs/<programId>         the list with that programme's editor open
 *   #/programs/autoflows/<autoflowId>       the list with that autoflow's editor open
 *   #/programs/forms/<requestId>            a client's answers to a form
 *
 * Editors are wide sheets (the iPhone's .sheet). A sheet with unsaved changes
 * asks before a stray backdrop click or Escape throws them away; the close
 * button still closes at once, as Cancel does on the iPhone.
 */
import {
  addDays, api, avatar, button, clients, confirmBox, dot, emptyCard, errorLine, eyebrow, field, fill, firstName,
  fmtRelative, fmtShort, go, h, icon, link, loading, londonParts, route, screenHeader, segmented, sheet, toast, todayLondon,
} from './core.js';

// MARK: - Local helpers (candidates for core.js)

/** Icons the shared set lacks; anything else falls back to core's icon(). */
const EXTRA_ICONS = {
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  stop: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5h5v5h-5z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  send: 'M21 3L10 14M21 3l-7 18-4-7-7-4z',
  personPlus: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M19 8v6M16 11h6',
  stack: 'M12 3l9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5',
  chart: 'M4 4v16h16M7 15l4-4 3 3 5-6',
  chevronUp: 'M6 15l6-6 6 6',
  chevronDown: 'M6 9l6 6 6-6',
  doc: 'M6 3h9l4 4v14H6zM15 3v4h4',
  docs: 'M8 3h8l4 4v12H8zM4 7v14h11',
};
const SVG = 'http://www.w3.org/2000/svg';
function ico(name, size = 16) {
  const d = EXTRA_ICONS[name];
  if (!d) return icon(name, size);
  const svg = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': name === 'more' ? '3' : '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  svg.classList.add('icon');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

/** The iPhone's IconTile: an icon in a raised rounded square. */
const iconTile = (name, size = 34) => h('span', { class: 'pg-tile', style: { width: `${size}px`, height: `${size}px` } }, ico(name, Math.round(size * 0.48)));

/** The iPhone's CheckCircle. */
const checkCircle = on => h('span', { class: 'pg-check' + (on ? ' on' : '') }, on ? icon('check', 13) : null);

/** The iPhone's ThinBar. */
const thinBar = fraction => h('div', { class: 'pg-bar' }, h('div', { style: { width: `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%` } }));

/** A text field bound to obj[key]; `onchange` runs after each keystroke. */
function textInput(obj, key, { placeholder = '', multiline = false, onchange = null, type = 'text', label = null } = {}) {
  const el = h(multiline ? 'textarea' : 'input', {
    type: multiline ? null : type, placeholder, value: obj[key] ?? '', 'aria-label': label || placeholder || null,
    oninput: e => { obj[key] = e.target.value; onchange?.(); },
  });
  if (multiline) el.value = obj[key] ?? '';
  return el;
}

/** The iPhone's Stepper: "label  − +". `text(value)` draws the label. */
function stepper(text, get, set, min, max, { onchange = null } = {}) {
  const label = h('span', { class: 'pg-stepper-label' });
  const minus = h('button', { type: 'button', class: 'pg-step-btn', 'aria-label': 'Less' }, '−');
  const plus = h('button', { type: 'button', class: 'pg-step-btn', 'aria-label': 'More' }, '+');
  const draw = () => {
    label.textContent = text(get());
    minus.disabled = get() <= min;
    plus.disabled = get() >= max();
  };
  const bump = by => { set(Math.max(min, Math.min(max(), get() + by))); draw(); onchange?.(); };
  minus.addEventListener('click', () => bump(-1));
  plus.addEventListener('click', () => bump(1));
  draw();
  const wrap = h('div', { class: 'pg-stepper' }, label, h('span', { class: 'pg-step-pair' }, minus, plus));
  wrap.redraw = draw;
  return wrap;
}

/** A labelled checkbox (the iPhone's Toggle). */
const toggle = (text, checked, onchange) => h('label', { class: 'pg-toggle' },
  h('input', { type: 'checkbox', checked, onchange: e => onchange(e.target.checked) }), h('span', null, text));

/** A small icon-only button. */
const iconButton = (name, label, onclick, { disabled = false, danger = false } = {}) =>
  h('button', { type: 'button', class: 'pg-icon-btn' + (danger ? ' danger' : ''), title: label, 'aria-label': label, disabled, onclick }, ico(name, 15));

/**
 * A drop-down menu (the iPhone's Menu): `trigger` is the button's content,
 * items are { label, icon, onclick }. Closes on a pick, outside click or Escape.
 */
function menu(trigger, items, { cls = 'pg-more', label = 'More', align = 'right' } = {}) {
  const list = h('div', { class: `pg-menu-list ${align}`, role: 'menu', hidden: true });
  const btn = h('button', { type: 'button', class: cls, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': label }, trigger);
  const away = e => { if (!wrap.contains(e.target)) close(); };
  const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); } };
  function close() {
    list.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', away, true);
    document.removeEventListener('keydown', key, true);
  }
  function open() {
    list.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', away, true);
    document.addEventListener('keydown', key, true);
    list.querySelector('button')?.focus();
  }
  btn.addEventListener('click', e => { e.stopPropagation(); if (list.hidden) open(); else close(); });
  for (const it of items) {
    list.append(h('button', {
      type: 'button', role: 'menuitem', class: 'pg-menu-item',
      onclick: e => { e.stopPropagation(); close(); it.onclick(); },
    }, it.icon ? ico(it.icon, 15) : null, h('span', null, it.label)));
  }
  const wrap = h('div', { class: 'pg-menu', onclick: e => e.stopPropagation() }, btn, list);
  return wrap;
}

/** Open sheets, closed when the screen goes (browser Back with a sheet open). */
const openSheets = new Set();
function closeSheets() { for (const close of [...openSheets]) close(); }
function openSheet(title, build, opts) {
  let closer = null;
  const p = sheet(title, (body, close) => {
    closer = close;
    openSheets.add(close);
    return build(body, close);
  }, opts);
  return p.finally(() => openSheets.delete(closer));
}

/** Ask before a backdrop click or Escape throws away unsaved changes. */
function guardSheet(body, close, isDirty) {
  const dialog = body.closest('dialog');
  if (!dialog) return;
  let asking = false;
  const ask = async () => {
    if (asking) return;
    asking = true;
    const discard = await confirmBox('Discard your changes?', { ok: 'Discard', danger: true });
    asking = false;
    if (discard) close();
  };
  dialog.addEventListener('click', e => {
    if (e.target === dialog && isDirty()) { e.stopImmediatePropagation(); ask(); }
  }, true);
  dialog.addEventListener('cancel', e => {
    if (isDirty()) { e.preventDefault(); e.stopImmediatePropagation(); ask(); }
  }, true);
}

/** The editors' footer: error line, the chrome save button, and an optional delete. */
function saveFooter({ saveText, canSave, onSave, deleteText = null, onDelete = null }) {
  const status = h('div');
  const save = button(saveText, async () => {
    save.disabled = true;
    fill(status);
    try { await onSave(); } catch (err) { fill(status, errorLine(err)); } finally { refresh(); }
  }, { kind: 'primary' });
  const refresh = () => { save.disabled = !canSave(); };
  refresh();
  const del = onDelete ? button(deleteText, async () => {
    fill(status);
    try { await onDelete(); } catch (err) { fill(status, errorLine(err)); }
  }, { kind: 'danger' }) : null;
  const foot = h('div', null, status, h('div', { class: 'pg-foot-row' }, del || h('span'), save));
  foot.refresh = refresh;
  return foot;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `s${Date.now()}${Math.random().toString(36).slice(2, 8)}`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dayMonth = iso => fmtShort(londonParts(iso).day);

// MARK: - Routes

const TABS = [['programs', 'Programs'], ['autoflows', 'Autoflows'], ['forms', 'Forms']];
const tabLabel = t => TABS.find(([v]) => v === t)?.[1] ?? 'Programs';

route('/programs/:tab?', (el, p, view) => renderScreen(el, p.tab, null, view));
route('/programs/:tab/:id', (el, p, view) => (p.tab === 'forms' ? renderResponse(el, p.id, view) : renderScreen(el, p.tab, p.id, view)));

function renderScreen(el, tabParam, openId, view) {
  view.onLeave(closeSheets);
  if (tabParam && !TABS.some(([v]) => v === tabParam)) { go('/programs', { replace: true }); return; }
  const tab = tabParam || 'programs';
  let reload = () => {};
  const actions = tab === 'programs'
    ? [h('button', { type: 'button', class: 'btn primary small pg-new', onclick: () => editProgram(null, reload) }, icon('plus', 14), 'New')]
    : [];
  const body = h('div', { class: 'pg-body' });
  fill(el,
    screenHeader('Templates & automation', tabLabel(tab), ...actions),
    segmented(TABS, tab, v => go(`/programs/${v}`)),
    body);
  if (tab === 'programs') reload = programsTab(body, view, openId);
  else if (tab === 'autoflows') reload = autoflowsTab(body, view, openId);
  else reload = formsTab(body, view);
}

// MARK: - Programs tab

function programsTab(el, view, openId) {
  const list = h('div');
  el.append(list);
  let opened = false;
  const load = async () => {
    if (!list.firstChild) fill(list, loading());
    try {
      const { programs } = await api('GET', '/api/programs');
      if (!view.fresh()) return;
      fill(list,
        programs.length ? null : emptyCard('programs', 'No programs yet', 'Build a template once, then assign it to any client with a start date.'),
        h('div', { class: 'pg-grid' }, programs.map(p => programRow(p, load))));
      if (openId && !opened) {
        opened = true;
        const p = programs.find(x => x.id === openId);
        if (p) editProgram(p, load).then(() => { if (view.fresh()) go('/programs/programs', { replace: true }); });
        else toast('That program no longer exists.', { error: true });
      }
    } catch (err) {
      if (view.fresh()) fill(list, errorLine(err), button('Try again', load, { small: true }));
    }
  };
  load();
  return load;
}

function programRow(p, reload) {
  const clientsLabel = p.clientCount == null ? 'Template' : p.clientCount === 1 ? '1 client' : `${p.clientCount} clients`;
  return h('div', { class: 'card pg-row pg-click', role: 'button', tabindex: '0',
    onclick: () => editProgram(p, reload),
    onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editProgram(p, reload); } } },
  h('span', { class: 'pg-tile big' }, ico('chart', 22)),
  h('div', { class: 'grow' },
    h('div', { class: 'strong clamp1' }, p.name),
    h('div', { class: 'tiny faint' }, `${p.daysPerWeek} days / week · ${p.weeks} weeks · ${plural(p.workouts.length, 'workout')}`),
    h('span', { class: 'pg-pill' }, clientsLabel)),
  menu(ico('more', 18), [
    { label: 'Edit', icon: 'pencil', onclick: () => editProgram(p, reload) },
    { label: 'Assign to client', icon: 'personPlus', onclick: () => assignProgram(p, reload) },
  ]));
}

/** ProgramDraft: what the editor changes, from a program or blank. */
function programDraft(p) {
  if (!p) return { programId: null, name: '', detail: '', daysPerWeek: 3, weeks: 4, workouts: [] };
  return {
    programId: p.id, name: p.name, detail: p.detail ?? '', daysPerWeek: p.daysPerWeek, weeks: p.weeks,
    workouts: p.workouts.map(w => ({
      localId: uid(), dayOffset: w.dayOffset, title: w.title,
      items: w.items.map(i => ({ localId: uid(), exerciseId: i.exerciseId, exerciseName: i.exercise?.name || i.exerciseId, sets: i.sets, reps: i.reps ?? '', load: i.load ?? '', rpe: i.rpe ?? null, note: i.note ?? null })),
    })),
  };
}

const itemInput = i => ({ exerciseId: i.exerciseId, sets: i.sets, reps: i.reps, load: i.load ?? '', rpe: i.rpe || null, note: i.note || null });

function programInput(d) {
  return {
    name: d.name, detail: d.detail, daysPerWeek: d.daysPerWeek, weeks: d.weeks,
    workouts: [...d.workouts].sort((a, b) => a.dayOffset - b.dayOffset).map(w => ({ dayOffset: w.dayOffset, title: w.title, items: w.items.map(itemInput) })),
  };
}

/** ProgramEditorSheet. Resolves once closed; calls reload after a save or delete. */
function editProgram(program, reload) {
  const d = programDraft(program);
  const snapshot = JSON.stringify(d);
  return openSheet(d.programId ? 'Edit program' : 'New program', (body, close) => {
    guardSheet(body, close, () => JSON.stringify(d) !== snapshot);
    const workoutsEl = h('div');
    let foot = null;
    const changed = () => foot?.refresh();
    const maxDay = () => d.weeks * 7 - 1;
    const steppers = [];

    const drawWorkouts = () => {
      steppers.length = 0;
      fill(workoutsEl, d.workouts.map(w => {
        const itemsEl = h('div');
        const drawItems = () => fill(itemsEl, itemsEditor(w.items, drawItems));
        drawItems();
        const dayStep = stepper(v => `Day ${v + 1}`, () => w.dayOffset, v => { w.dayOffset = v; }, 0, maxDay);
        steppers.push(dayStep);
        return h('div', { class: 'card pg-workout' },
          h('div', { class: 'pg-workout-head' },
            field('Title', textInput(w, 'title', { placeholder: 'Lower Body Strength' })),
            dayStep),
          itemsEl,
          h('div', { class: 'spread mt' },
            button(h('span', { class: 'row gap4' }, icon('plus', 14), 'Add exercise'), () => pickExercise(ex => {
              w.items.push({ localId: uid(), exerciseId: ex.id, exerciseName: ex.name, sets: 3, reps: '10', load: '', rpe: null, note: null });
              drawItems();
            }), { small: true }),
            button(h('span', { class: 'row gap4' }, icon('trash', 14), 'Remove workout'), () => {
              d.workouts = d.workouts.filter(x => x.localId !== w.localId);
              drawWorkouts();
            }, { small: true, kind: 'danger' })));
      }));
    };
    drawWorkouts();

    body.append(
      h('div', { class: 'pg-two' },
        field('Name', textInput(d, 'name', { placeholder: '12-Week Strength Block', onchange: changed })),
        field('Description', textInput(d, 'detail', { placeholder: '4 days / week, barbell focus' }))),
      h('div', { class: 'row pg-gap' },
        stepper(v => `${v} days / week`, () => d.daysPerWeek, v => { d.daysPerWeek = v; }, 1, () => 7),
        stepper(v => `${v} wk`, () => d.weeks, v => { d.weeks = v; }, 1, () => 52, { onchange: () => steppers.forEach(s => s.redraw()) })),
      eyebrow('Workouts', 'Day offset from the start date'),
      workoutsEl,
      button(h('span', { class: 'row gap4' }, icon('plus', 14), 'Add workout'), () => {
        const next = Math.max(-1, ...d.workouts.map(w => w.dayOffset)) + 1;
        d.workouts.push({ localId: uid(), dayOffset: Math.min(next, maxDay()), title: `Workout ${d.workouts.length + 1}`, items: [] });
        drawWorkouts();
      }, { kind: 'pg-ghost' }));

    foot = saveFooter({
      saveText: d.programId ? 'Save program' : 'Create program',
      canSave: () => d.name.trim() !== '',
      onSave: async () => {
        if (d.programId) await api('PUT', `/api/programs/${encodeURIComponent(d.programId)}`, programInput(d));
        else await api('POST', '/api/programs', programInput(d));
        close(true);
        toast(d.programId ? 'Program saved' : 'Program created');
        reload();
      },
      deleteText: 'Delete program',
      onDelete: d.programId ? async () => {
        if (!await confirmBox('Delete this program?', { ok: 'Delete', danger: true, detail: 'Workouts already assigned to clients stay.' })) return;
        await api('DELETE', `/api/programs/${encodeURIComponent(d.programId)}`);
        close(true);
        toast('Program deleted');
        reload();
      } : null,
    });
    return foot;
  }, { wide: true });
}

/**
 * ItemsEditor: rows of exercise prescriptions (sets, reps, load, RPE, note),
 * reorder and delete. `redraw` rebuilds the list after a move or removal.
 */
function itemsEditor(items, redraw) {
  if (!items.length) return h('p', { class: 'tiny faint m0' }, 'No exercises yet.');
  return items.map((item, index) => {
    const sets = h('input', {
      type: 'number', min: '1', max: '20', inputmode: 'numeric', value: String(item.sets), 'aria-label': 'Sets',
      oninput: e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) item.sets = n; },
    });
    const move = by => { const t = index + by; if (t < 0 || t >= items.length) return; [items[index], items[t]] = [items[t], items[index]]; redraw(); };
    return h('div', { class: 'pg-item' },
      h('div', { class: 'spread' },
        h('div', { class: 'strong small clamp1' }, item.exerciseName || item.exerciseId),
        h('div', { class: 'row gap4' },
          iconButton('up', 'Move up', () => move(-1), { disabled: index === 0 }),
          iconButton('down', 'Move down', () => move(1), { disabled: index === items.length - 1 }),
          iconButton('trash', 'Remove', () => { items.splice(index, 1); redraw(); }, { danger: true }))),
      h('div', { class: 'pg-item-fields' },
        h('div', { class: 'field pg-f-sets' }, h('label', null, 'Sets'), sets),
        h('div', { class: 'field pg-f-reps' }, h('label', null, 'Reps'), textInput(item, 'reps', { placeholder: '10', label: 'Reps' })),
        h('div', { class: 'field pg-f-load' }, h('label', null, 'Load'), textInput(item, 'load', { placeholder: '60 kg', label: 'Load' })),
        h('div', { class: 'field pg-f-rpe' }, h('label', null, 'RPE'), textInput(item, 'rpe', { placeholder: '7–8', label: 'RPE' })),
        h('div', { class: 'field pg-f-note' }, h('label', null, 'Note'), textInput(item, 'note', { placeholder: 'Cue for the client', label: 'Note' }))));
  });
}

/** ExercisePickerSheet: search and category chips over GET /api/exercises. */
const EXERCISE_CATEGORIES = ['All', 'Legs', 'Push', 'Pull', 'Core', 'Mobility', 'Conditioning'];
function pickExercise(onPick) {
  return openSheet('Add exercise', (body, close) => {
    let query = '';
    let category = 'All';
    let timer = null;
    let ask = 0;
    const results = h('div', null, loading());
    const chips = h('div', { class: 'pg-chips' });
    const drawChips = () => fill(chips, EXERCISE_CATEGORIES.map(c => h('button', {
      type: 'button', class: 'chip pg-chip' + (c === category ? ' on' : ''), 'aria-pressed': String(c === category),
      onclick: () => { category = c; drawChips(); load(0); },
    }, c)));
    const load = (delay = 250) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const mine = ++ask;
        try {
          const params = new URLSearchParams();
          if (query.trim()) params.set('q', query.trim());
          if (category !== 'All') params.set('category', category);
          const qs = params.toString();
          const { exercises } = await api('GET', `/api/exercises${qs ? `?${qs}` : ''}`);
          if (mine !== ask) return;
          fill(results, exercises.length
            ? h('div', { class: 'card flush' }, exercises.map(ex => h('button', {
              type: 'button', class: 'pg-pick-row', onclick: () => { onPick(ex); close(ex); },
            }, iconTile('dumbbell', 34), h('div', { class: 'grow' }, h('div', { class: 'small strong' }, ex.name), h('div', { class: 'tiny faint' }, `${ex.equipment} · ${ex.pattern}`)), h('span', { class: 'faint' }, icon('plus', 16)))))
            : emptyCard('search', 'No matches'));
        } catch (err) {
          if (mine === ask) fill(results, errorLine(err));
        }
      }, delay);
    };
    const search = h('input', { type: 'search', placeholder: 'Search exercises', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search exercises', oninput: e => { query = e.target.value; load(); } });
    drawChips();
    body.append(h('div', { class: 'pg-search' }, h('span', { class: 'faint' }, icon('search', 16)), search), chips, results);
    load(0);
    setTimeout(() => search.focus(), 0);
    return null;
  });
}

/** AssignProgramSheet: a start date and a client; the workouts arrive as drafts. */
function assignProgram(program, reload) {
  return openSheet('Assign program', (body, close) => {
    let clientId = null;
    let start = addDays(todayLondon(), 1);
    let created = null;
    const listEl = h('div', null, loading());
    const status = h('div');
    const go_ = button('Assign', async () => {
      if (created !== null) { close(true); reload(); return; }
      if (!clientId) return;
      go_.disabled = true;
      fill(status);
      try {
        const out = await api('POST', `/api/programs/${encodeURIComponent(program.id)}/assign`, { clientId, startDate: start });
        created = out.created;
        fill(status, h('p', { class: 'small muted row gap4' }, icon('check', 14), `Created ${created} draft workouts. Publish them from the client's Plan tab.`));
        go_.textContent = 'Done';
      } catch (err) {
        fill(status, errorLine(err));
      } finally {
        go_.disabled = created === null && !clientId;
      }
    }, { kind: 'primary', disabled: true });
    body.append(
      h('h3', null, program.name),
      field('Start date', h('input', { type: 'date', value: start, required: true, oninput: e => { if (e.target.value) start = e.target.value; } })),
      eyebrow('Client'),
      listEl,
      status);
    clientList(listEl, () => clientId, id => { clientId = id; if (created === null) go_.disabled = false; }, { sorted: false });
    return h('div', { class: 'row end' }, go_);
  });
}

/** The client list with check circles used by the assign and client-picker sheets. */
async function clientList(el, getChosen, choose, { sorted = true } = {}) {
  try {
    let list = await clients();
    if (sorted) list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    const draw = () => fill(el, list.length
      ? h('div', { class: 'card flush' }, list.map(c => h('button', {
        type: 'button', class: 'pg-pick-row', 'aria-pressed': String(getChosen() === c.id),
        onclick: () => { choose(c.id); draw(); },
      }, avatar(c.initials || c.name, 28), h('span', { class: 'grow small' }, c.name), checkCircle(getChosen() === c.id))))
      : emptyCard('clients', 'No clients yet'));
    draw();
    return list;
  } catch (err) {
    fill(el, errorLine(err));
    return [];
  }
}

/** ClientPickerSheet: choose one client, then `perform(client)`; errors stay on the sheet. */
function pickClient({ title, action, note = null, perform }) {
  return openSheet(title, (body, close) => {
    let chosen = null;
    let list = [];
    const status = h('div');
    const listEl = h('div', null, loading());
    const btn = button(action, async () => {
      const c = list.find(x => x.id === chosen);
      if (!c) return;
      btn.disabled = true;
      fill(status);
      try {
        await perform(c);
        close(c);
      } catch (err) {
        fill(status, errorLine(err));
        btn.disabled = false;
      }
    }, { kind: 'primary', disabled: true });
    body.append(note ? h('p', { class: 'small faint m0 mb' }, note) : null, listEl, status);
    clientList(listEl, () => chosen, id => { chosen = id; btn.disabled = false; }).then(l => { list = l; });
    return h('div', { class: 'row end' }, btn);
  });
}

// MARK: - Autoflows tab

const STEP_ICON = { message: 'bubble', form: 'form', program: 'dumbbell' };
const capitalised = s => (s ? s[0].toUpperCase() + s.slice(1) : '');

function autoflowsTab(el, view, openId) {
  const list = h('div');
  let opened = false;
  const load = async () => {
    if (!list.firstChild) fill(list, loading());
    try {
      const { autoflows } = await api('GET', '/api/autoflows');
      if (!view.fresh()) return;
      fill(list,
        autoflows.length ? null : emptyCard('bolt', 'No autoflows yet', 'Write your routine once: a welcome message on day 0, the intake form, a check-in on day 7. It then runs for every client.'),
        autoflows.map(f => autoflowCard(f, load)));
      if (openId && !opened) {
        opened = true;
        const f = autoflows.find(x => x.id === openId);
        if (f) editAutoflow(f, load).then(() => { if (view.fresh()) go('/programs/autoflows', { replace: true }); });
        else toast('That autoflow no longer exists.', { error: true });
      }
    } catch (err) {
      if (view.fresh()) fill(list, errorLine(err), button('Try again', load, { small: true }));
    }
  };
  el.append(
    button(h('span', { class: 'row gap4' }, icon('plus', 15), 'New autoflow'), () => editAutoflow(null, load), { kind: 'pg-ghost' }),
    list);
  load();
  return load;
}

const enrol = (flow, reload) => pickClient({
  title: `Start ${flow.name}`, action: 'Start', note: 'Steps already due (day 0) happen straight away.',
  perform: async c => {
    await api('POST', `/api/autoflows/${encodeURIComponent(flow.id)}/enrol`, { clientId: c.id });
    toast(`Started for ${c.name}`);
    reload();
  },
});

function autoflowCard(flow, reload) {
  const runs = flow.runs ?? [];
  const running = runs.filter(r => !r.stoppedAt && r.next);
  const runsEl = h('div', { class: 'pg-runs', hidden: true }, runs.map(r => autoflowRunRow(r, { onChanged: reload })));
  const chevron = h('span');
  const toggleRuns = h('button', { type: 'button', class: 'pg-runs-toggle', 'aria-expanded': 'false', onclick: () => {
    runsEl.hidden = !runsEl.hidden;
    toggleRuns.setAttribute('aria-expanded', String(!runsEl.hidden));
    fill(chevron, ico(runsEl.hidden ? 'chevronDown' : 'chevronUp', 14));
  } }, h('span', null, running.length ? `${running.length} in progress` : `${runs.length} finished`), chevron);
  fill(chevron, ico('chevronDown', 14));
  return h('div', { class: 'card' },
    h('div', { class: 'row pg-nowrap' },
      iconTile(flow.trigger === 'join' ? 'personPlus' : 'bolt', 34),
      h('div', { class: 'grow' },
        h('div', { class: 'strong clamp1' }, flow.name),
        h('div', { class: 'tiny faint' }, flow.trigger === 'join' ? 'Starts when a client joins' : 'Starts when you enrol someone')),
      flow.active ? null : h('span', { class: 'pg-paused' }, 'Paused'),
      menu(ico('more', 18), [
        { label: 'Edit', icon: 'pencil', onclick: () => editAutoflow(flow, reload) },
        { label: 'Start for a client', icon: 'personPlus', onclick: () => enrol(flow, reload) },
      ])),
    h('div', { class: 'pg-steps' }, flow.steps.map(s => h('div', { class: 'pg-step' },
      h('span', { class: 'pg-step-day' }, `Day ${s.day}`),
      h('span', { class: 'faint' }, icon(STEP_ICON[s.action] || 'dumbbell', 13)),
      h('span', { class: 'small clamp1' }, s.label || capitalised(s.action))))),
    runs.length ? [toggleRuns, runsEl] : null);
}

/** AutoflowRunRow: one client's way through a flow, with Stop while it runs. */
function autoflowRunRow(run, { showFlowName = false, onChanged }) {
  const status = h('div');
  let detail;
  if (run.stoppedAt) detail = 'Stopped';
  else if (!run.next) detail = 'Finished';
  else detail = `Next ${run.next.date === todayLondon() ? 'today' : fmtShort(run.next.date)}: ${run.next.label}`;
  const who = showFlowName ? (run.autoflowName || 'Autoflow') : (run.client?.name || 'Client');
  return h('div', { class: 'pg-run' },
    h('div', { class: 'row pg-nowrap' },
      avatar(run.client?.initials || '?', 26),
      h('div', { class: 'grow' },
        run.client && !showFlowName ? link(`/clients/${encodeURIComponent(run.client.id)}`, { class: 'small strong pg-plain' }, who) : h('div', { class: 'small strong' }, who),
        h('div', { class: 'tiny faint clamp2' }, detail)),
      h('span', { class: 'tiny muted pg-num' }, `${run.stepsDone}/${run.steps}`),
      !run.stoppedAt && run.next ? iconButton('stop', 'Stop', async () => {
        const ok = await confirmBox(`Stop this autoflow for ${run.client?.name || 'them'}?`, { ok: 'Stop', danger: true, detail: 'What already happened stays; nothing more is sent.' });
        if (!ok) return;
        try {
          await api('DELETE', `/api/autoflows/${encodeURIComponent(run.autoflowId)}/runs/${encodeURIComponent(run.id)}`);
          await onChanged();
        } catch (err) { fill(status, errorLine(err)); }
      }) : null),
    thinBar(run.steps ? run.stepsDone / run.steps : 0),
    status);
}

function autoflowDraft(f) {
  if (!f) return { flowId: null, name: '', trigger: 'join', active: true, steps: [{ id: uid(), day: 0, action: 'message', text: 'Welcome aboard, {first}!' }] };
  return { flowId: f.id, name: f.name, trigger: f.trigger, active: f.active, steps: f.steps.map(s => ({ ...s })) };
}

const autoflowInput = d => ({
  name: d.name, trigger: d.trigger, active: d.active,
  steps: [...d.steps].sort((a, b) => a.day - b.day).map(({ id, day, action, text, formId, programId }) => ({ id, day, action, text, formId, programId })),
});

/** AutoflowEditorSheet with its StepEditors. */
function editAutoflow(flow, reload) {
  const d = autoflowDraft(flow);
  const snapshot = JSON.stringify(d);
  return openSheet(d.flowId ? 'Edit autoflow' : 'New autoflow', (body, close) => {
    guardSheet(body, close, () => JSON.stringify(d) !== snapshot);
    let forms = [];
    let programs = [];
    let foot = null;
    const changed = () => foot?.refresh();
    const stepsEl = h('div');
    const loadStatus = h('div');

    const stepEditor = step => {
      let control;
      if (step.action === 'message') {
        control = textInput(step, 'text', { placeholder: 'Message', multiline: true });
        control.classList.add('pg-message');
      } else {
        const options = step.action === 'form' ? forms : programs;
        if (!options.length) {
          control = h('p', { class: 'small faint m0' }, step.action === 'form' ? 'Make a form first (Forms tab).' : 'Make a program first (Programs tab).');
        } else {
          const key = step.action === 'form' ? 'formId' : 'programId';
          if (!options.some(o => o.id === step[key])) step[key] = step[key] || '';
          control = h('label', { class: 'pg-select' }, h('span', null, step.action === 'form' ? 'Form' : 'Program'),
            h('select', { onchange: e => { step[key] = e.target.value; } },
              step[key] && options.some(o => o.id === step[key]) ? null : h('option', { value: '', selected: true, disabled: true }, 'Choose…'),
              options.map(o => h('option', { value: o.id, selected: o.id === step[key] }, o.name))));
        }
      }
      return h('div', { class: 'card pg-step-editor' },
        h('div', { class: 'row pg-nowrap' },
          h('span', { class: 'muted' }, icon(STEP_ICON[step.action] || 'dumbbell', 17)),
          stepper(v => `Day ${v}`, () => step.day, v => { step.day = v; }, 0, () => 365),
          h('span', { class: 'grow' }),
          iconButton('trash', 'Remove step', () => { d.steps = d.steps.filter(s => s.id !== step.id); drawSteps(); changed(); }, { danger: true })),
        control);
    };
    const drawSteps = () => fill(stepsEl, d.steps.map(stepEditor));

    const add = (title, iconName, action) => button(h('span', { class: 'row gap4' }, icon(iconName, 14), title), () => {
      const day = Math.max(0, Math.max(-1, ...d.steps.map(s => s.day)) + 1);
      const step = { id: uid(), day, action };
      if (action === 'form') step.formId = forms[0]?.id;
      if (action === 'program') step.programId = programs[0]?.id;
      if (action === 'message') step.text = '';
      d.steps.push(step);
      drawSteps();
      changed();
    }, { small: true });

    const trigger = h('div');
    const drawTrigger = () => fill(trigger, segmented([['join', 'When a client joins'], ['manual', 'When I start it']], d.trigger, v => { d.trigger = v; drawTrigger(); }));
    drawTrigger();

    body.append(
      field('Name', textInput(d, 'name', { placeholder: 'New client onboarding', onchange: changed })),
      trigger,
      h('div', { class: 'mt' }, toggle('Running', d.active, v => { d.active = v; })),
      eyebrow('Steps', 'Day 0 = the day it starts'),
      loadStatus,
      stepsEl,
      h('div', { class: 'row' }, add('Message', 'bubble', 'message'), add('Form', 'form', 'form'), add('Program', 'dumbbell', 'program')),
      h('p', { class: 'tiny faint' }, 'Messages can say {first} for the client’s first name. A program goes live on their calendar from the following Monday.'));
    drawSteps();

    (async () => {
      try {
        const [f, p] = await Promise.all([api('GET', '/api/forms'), api('GET', '/api/programs')]);
        forms = f.forms;
        programs = p.programs;
        drawSteps();
      } catch (err) { fill(loadStatus, errorLine(err)); }
    })();

    foot = saveFooter({
      saveText: d.flowId ? 'Save autoflow' : 'Create autoflow',
      canSave: () => d.name.trim() !== '' && d.steps.length > 0,
      onSave: async () => {
        if (d.flowId) await api('PUT', `/api/autoflows/${encodeURIComponent(d.flowId)}`, autoflowInput(d));
        else await api('POST', '/api/autoflows', autoflowInput(d));
        close(true);
        toast(d.flowId ? 'Autoflow saved' : 'Autoflow created');
        reload();
      },
      deleteText: 'Delete autoflow',
      onDelete: d.flowId ? async () => {
        if (!await confirmBox('Delete this autoflow?', { ok: 'Delete', danger: true, detail: 'Clients part-way through stop where they are. Nothing already sent is taken back.' })) return;
        await api('DELETE', `/api/autoflows/${encodeURIComponent(d.flowId)}`);
        close(true);
        toast('Autoflow deleted');
        reload();
      } : null,
    });
    return foot;
  }, { wide: true });
}

// MARK: - Forms tab

const KINDS = [['text', 'Short answer'], ['long', 'Long answer'], ['scale', 'Scale 1–5'], ['yesno', 'Yes / no'], ['choice', 'Choice']];
const kindName = k => KINDS.find(([v]) => v === k)?.[1] ?? k;
const isFlagged = r => (r.flagged ?? []).length > 0;

function formsTab(el, view) {
  const newHolder = h('div');
  const inboxEl = h('div');
  const formsEl = h('div', null, loading());
  el.append(newHolder, inboxEl, formsEl);
  let templates = [];
  const drawNew = () => fill(newHolder, menu(h('span', { class: 'row gap4' }, icon('plus', 16), 'New form'), [
    { label: 'Blank form', icon: 'doc', onclick: () => editForm({}, load) },
    ...templates.map(t => ({ label: t.name, icon: 'docs', onclick: () => editForm({ template: t }, load) })),
  ], { cls: 'pg-new-form', label: 'New form', align: 'left' }));
  drawNew();

  async function load() {
    try {
      const [data, reqs] = await Promise.all([api('GET', '/api/forms'), api('GET', '/api/form-requests')]);
      if (!view.fresh()) return;
      templates = data.templates ?? [];
      drawNew();
      const inbox = reqs.requests;
      fill(inboxEl, inbox.length ? [
        eyebrow('Answers to read', String(inbox.length)),
        h('div', { class: 'card flush' }, inbox.map(r => formRequestRow(r, { showClient: true }))),
      ] : null);
      fill(formsEl,
        eyebrow('Your forms'),
        data.forms.length ? null : emptyCard('form', 'No forms yet', 'Start from Intake or PAR-Q above, or build your own.'),
        h('div', { class: 'pg-grid' }, data.forms.map(f => formRow(f, load))));
    } catch (err) {
      if (view.fresh()) fill(formsEl, errorLine(err), button('Try again', load, { small: true }));
    }
  }
  load();
  return load;
}

function formLine(f) {
  const parts = [plural(f.questions.length, 'question')];
  if (f.sent > 0) parts.push(`sent ${f.sent}×`);
  if (f.waiting > 0) parts.push(`${f.waiting} not answered`);
  return parts.join(' · ');
}

function formRow(f, reload) {
  const send = () => pickClient({
    title: `Send ${f.name}`, action: 'Send', note: 'They get a notification and find it on their Home screen.',
    perform: async c => {
      await api('POST', `/api/forms/${encodeURIComponent(f.id)}/send`, { clientId: c.id });
      toast(`Sent to ${c.name}`);
      reload();
    },
  });
  return h('div', { class: 'card pg-row pg-click', role: 'button', tabindex: '0',
    onclick: () => editForm({ form: f }, reload),
    onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editForm({ form: f }, reload); } } },
  iconTile('form', 34),
  h('div', { class: 'grow' }, h('div', { class: 'strong clamp1' }, f.name), h('div', { class: 'tiny faint' }, formLine(f))),
  menu(ico('more', 18), [
    { label: 'Send to a client', icon: 'send', onclick: send },
    { label: 'Edit', icon: 'pencil', onclick: () => editForm({ form: f }, reload) },
  ]));
}

/** FormRequestRow: who and which form, how it stands, and a dot while unread. */
export function formRequestRow(r, { showClient = false } = {}) {
  let status;
  if (r.submittedAt) {
    const flagged = isFlagged(r) ? `Said yes to ${r.flagged.length === 1 ? 'a health question' : 'health questions'} · ` : '';
    status = `${flagged}Answered ${fmtRelative(r.submittedAt)}${r.reviewedAt ? ' · read' : ''}`;
  } else {
    status = `Sent ${fmtRelative(r.sentAt)} · not answered yet`;
  }
  const urgent = isFlagged(r) && !r.reviewedAt;
  return link(`/programs/forms/${encodeURIComponent(r.id)}`, { class: 'person-row' },
    showClient ? avatar(r.client?.initials || '?', 30) : iconTile('form', 30),
    h('div', { class: 'grow' },
      h('div', { class: 'strong clamp1' }, showClient ? `${r.client?.name || 'Client'} · ${r.name}` : r.name),
      h('div', { class: 'tiny', style: { color: urgent ? 'var(--urgent)' : 'var(--faint)' } }, status)),
    r.submittedAt && !r.reviewedAt ? dot(isFlagged(r) ? 'var(--urgent)' : 'var(--waiting)') : null,
    icon('chevron', 14));
}

/** One answer as the iPhone shows it: text, "4 / 5", Yes or No. */
function answerText(v) {
  if (v === undefined || v === null || v === '') return '–';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return `${v} / 5`;
  return String(v);
}

/** FormResponseView, as a page. Opening an answered form marks it read. */
async function renderResponse(el, id, view) {
  view.onLeave(closeSheets);
  const back = link('/programs/forms', { class: 'pg-back' }, icon('back', 16), 'Forms');
  fill(el, back, loading());
  let r;
  try {
    r = await api('GET', `/api/form-requests/${encodeURIComponent(id)}`);
  } catch (err) {
    if (view.fresh()) fill(el, back, err.status === 404 ? emptyCard('form', 'Form not found', 'It may have been withdrawn.') : errorLine(err));
    return;
  }
  if (!view.fresh()) return;
  const status = h('div');
  const draw = () => {
    const first = r.client ? firstName(r.client.name) || r.client.name : null;
    fill(el, back,
      h('div', { class: 'pg-response' },
        h('header', { class: 'pg-response-head' },
          h('h1', null, r.name),
          h('div', { class: 'small faint' },
            r.client ? link(`/clients/${encodeURIComponent(r.client.id)}`, { class: 'pg-plain' }, r.client.name) : 'Client',
            ` · sent ${dayMonth(r.sentAt)}${r.fromAutoflow ? ' by an autoflow' : ''}`)),
        status,
        isFlagged(r) ? h('div', { class: 'card pg-flagged' },
          h('div', { class: 'row gap4 small strong', style: { color: 'var(--urgent)' } }, icon('warning', 15), 'Answered yes to'),
          h('ul', { class: 'pg-flag-list' }, r.flagged.map(q => h('li', { class: 'small' }, q))),
          h('div', { class: 'tiny faint' }, 'Talk to them before the next hard session.')) : null,
        r.submittedAt ? [
          h('div', { class: 'pg-answers' }, r.questions.map(q => {
            const a = r.answers?.[q.id];
            return h('div', { class: 'card pg-answer' + (q.kind === 'long' ? ' wide' : '') },
              h('div', { class: 'small faint' }, q.label),
              h('div', { class: 'strong pg-answer-text', style: q.flag && a === true ? { color: 'var(--urgent)' } : null }, answerText(a)));
          })),
          r.client ? h('div', { class: 'row mt' },
            link(`/messages/${encodeURIComponent(r.client.id)}`, { class: 'btn' }, icon('bubble', 15), `Message ${first}`),
            link(`/clients/${encodeURIComponent(r.client.id)}/feedback`, { class: 'btn' }, icon('clients', 15), `${first}'s page`)) : null,
        ] : [
          emptyCard('clock', 'Not answered yet', `Sent ${fmtRelative(r.sentAt)}.`),
          h('div', { class: 'row' }, button('Withdraw form', async () => {
            if (!await confirmBox('Withdraw this form?', { ok: 'Withdraw', danger: true })) return;
            try {
              await api('DELETE', `/api/form-requests/${encodeURIComponent(r.id)}`);
              toast('Form withdrawn');
              go('/programs/forms', { replace: true });
            } catch (err) { fill(status, errorLine(err)); }
          }, { kind: 'danger' })),
        ]));
  };
  draw();
  if (r.submittedAt && !r.reviewedAt) {
    try {
      r = await api('POST', `/api/form-requests/${encodeURIComponent(r.id)}/review`);
    } catch (err) {
      if (view.fresh()) fill(status, errorLine(err));
    }
  }
}

/** FormDraft: from a template, a saved form, or blank. */
function formDraft({ template = null, form = null } = {}) {
  const src = form || template;
  const copy = qs => qs.map(q => ({ ...q, options: q.options ? [...q.options] : undefined, localId: uid() }));
  if (!src) return { formId: null, name: '', intro: '', questions: [{ id: 'q1', kind: 'long', label: '', localId: uid() }] };
  return { formId: form?.id ?? null, name: src.name, intro: src.intro ?? '', questions: copy(src.questions) };
}

/** An id no other question in this form has. */
function nextQuestionId(d) {
  let n = d.questions.length + 1;
  while (d.questions.some(q => q.id === `q${n}`)) n += 1;
  return `q${n}`;
}

const formInput = d => ({
  name: d.name, intro: d.intro,
  questions: d.questions.map(q => {
    const out = { id: q.id, kind: q.kind, label: q.label };
    if (q.kind === 'choice') out.options = q.options ?? [];
    if (q.kind === 'yesno' && q.flag) out.flag = true;
    if (q.required === false) out.required = false;
    return out;
  }),
});

/** FormEditorSheet with its QuestionEditors. */
function editForm(src, reload) {
  const d = formDraft(src);
  const snapshot = JSON.stringify(d);
  return openSheet(d.formId ? 'Edit form' : 'New form', (body, close) => {
    guardSheet(body, close, () => JSON.stringify(d) !== snapshot);
    let foot = null;
    const changed = () => foot?.refresh();
    const count = h('span');
    const questionsEl = h('div');

    const questionEditor = (q, index) => {
      const move = by => { const t = index + by; if (t < 0 || t >= d.questions.length) return; [d.questions[index], d.questions[t]] = [d.questions[t], d.questions[index]]; draw(); };
      let choices = null;
      if (q.kind === 'choice') {
        const holder = { text: (q.options ?? []).join(', ') };
        choices = field('Choices, separated by commas', textInput(holder, 'text', {
          placeholder: 'Yes, No, Not sure',
          onchange: () => { q.options = holder.text.split(',').map(s => s.trim()).filter(Boolean); },
        }));
      }
      return h('div', { class: 'card pg-question' },
        h('div', { class: 'spread' },
          h('span', { class: 'small strong muted' }, `${index + 1}. ${kindName(q.kind)}`),
          h('div', { class: 'row gap4' },
            iconButton('up', 'Move up', () => move(-1), { disabled: index === 0 }),
            iconButton('down', 'Move down', () => move(1), { disabled: index === d.questions.length - 1 }),
            iconButton('trash', 'Remove question', () => { d.questions.splice(index, 1); draw(); }, { danger: true }))),
        field('Question', textInput(q, 'label', { placeholder: 'What do you want to achieve?' })),
        choices,
        h('div', { class: 'row pg-gap' },
          toggle('Required', q.required !== false, v => { if (v) delete q.required; else q.required = false; }),
          q.kind === 'yesno' ? toggle('Flag a yes', q.flag === true, v => { if (v) q.flag = true; else delete q.flag; }) : null));
    };
    const draw = () => {
      count.textContent = String(d.questions.length);
      fill(questionsEl, d.questions.map(questionEditor));
      changed();
    };

    body.append(
      h('div', { class: 'pg-two' },
        field('Name', textInput(d, 'name', { placeholder: 'Intake', onchange: changed })),
        field('Intro (shown at the top)', textInput(d, 'intro', { placeholder: 'A few questions before we start' }))),
      h('div', { class: 'eyebrow spread' }, h('span', null, 'Questions'), h('span', { class: 'eyebrow-trailing' }, count)),
      questionsEl,
      menu(h('span', { class: 'row gap4' }, icon('plus', 14), 'Add question'), KINDS.map(([kind, label]) => ({
        label, onclick: () => {
          d.questions.push({ id: nextQuestionId(d), kind, label: '', options: kind === 'choice' ? ['Option 1', 'Option 2'] : undefined, localId: uid() });
          draw();
        },
      })), { cls: 'pg-add-question', label: 'Add question', align: 'left' }),
      d.formId ? h('p', { class: 'tiny faint' }, 'Forms already sent keep the questions they were sent with.') : null);

    foot = saveFooter({
      saveText: d.formId ? 'Save form' : 'Create form',
      canSave: () => d.name.trim() !== '' && d.questions.length > 0,
      onSave: async () => {
        if (d.formId) await api('PUT', `/api/forms/${encodeURIComponent(d.formId)}`, formInput(d));
        else await api('POST', '/api/forms', formInput(d));
        close(true);
        toast(d.formId ? 'Form saved' : 'Form created');
        reload();
      },
      deleteText: 'Delete form',
      onDelete: d.formId ? async () => {
        if (!await confirmBox('Delete this form?', { ok: 'Delete', danger: true, detail: 'Answers clients already gave stay on their record.' })) return;
        await api('DELETE', `/api/forms/${encodeURIComponent(d.formId)}`);
        close(true);
        toast('Form deleted');
        reload();
      } : null,
    });
    draw();
    return foot;
  }, { wide: true });
}
