/*
 * F15 The automation builder (WP5): /automations/:id/:tab? (Build, Runs).
 *
 * Build is a vertical flow, centred on a dotted canvas: the trigger, an
 * optional "only if" node, then the steps joined by connector lines with a
 * "+" in each gap. Steps drag to reorder (or move with the arrow keys on their
 * handle); clicking a node opens the inspector, whose fields come from the
 * catalogue's ParamSpecs. Every node reads as a sentence, and the whole
 * automation reads as one above the canvas. "Test on…" shows what would
 * happen for a client, with the messages rendered, and sends nothing.
 */
import {
  api, busy, clients as loadClients, confirmBox, fill, fmtDay, go, h, icon, londonParts, route, setCrumbs, todayLondon, toast,
} from './core.js';
import {
  AI_SAFE, DAY_NAMES, DAY_SHORT, actionIcon, ago, catalogue, enc, rulesWords, runPill, sentence, statusPill, stepParts, stepProblem,
  pendingOpen, triggerIcon, triggerWords, usesAi, waitWords, whereFields, whereWords, withVars,
} from './f-auto-common.js';
import { dataTable, emptyHero, inlineEdit, menu, moneyInput, popover, ruleBuilder, segmentedNav, skeleton, slideOver, tabs, timeline } from './ui.js';

const ID_LOOKUP = { tag: 'tags', form: 'forms', program: 'programs', segment: 'segments', campaign: 'campaigns', package: 'packages', discount: 'discounts' };
const editable = a => structuredClone({ name: a.name, description: a.description, trigger: a.trigger, conditions: a.conditions, steps: a.steps, settings: a.settings });
const newStepId = steps => { let n = steps.length + 1; while (steps.some(s => s.id === `s${n}`)) n++; return `s${n}`; };

/** "Today 08:30", "Tomorrow 07:30", "Thu 27 Nov 09:00". */
function whenWords(iso) {
  const { day, time } = londonParts(iso);
  const today = todayLondon();
  const d = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  return `${d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === -1 ? 'Yesterday' : fmtDay(day)} ${time}`;
}

// MARK: - Param controls (one per ParamSpec type)

function variableChips(cat, target) {
  return h('div', { class: 'au-vars', role: 'group', 'aria-label': 'Insert a variable' },
    (cat.variables ?? []).slice(0, 14).map(v => h('button', {
      type: 'button', class: 'au-var', title: v.label, onclick: () => {
        target.setRangeText(`{${v.name}}`, target.selectionStart ?? target.value.length, target.selectionEnd ?? target.value.length, 'end');
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.focus();
      },
    }, `{${v.name}}`)));
}

function templatePicker(anchor, onPick) {
  popover(anchor, (box, close) => {
    const search = h('input', { type: 'search', placeholder: 'Find a template', 'aria-label': 'Find a template' });
    const list = h('div', { class: 'au-tpl-list', role: 'listbox' }, skeleton('lines', { rows: 3 }));
    let all = [];
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const rows = all.filter(t => !q || t.name.toLowerCase().includes(q) || (t.shortcut ?? '').includes(q) || t.body.toLowerCase().includes(q)).slice(0, 12);
      fill(list, rows.length ? rows.map(t => h('button', { type: 'button', role: 'option', class: 'au-tpl-opt', onclick: () => { close(); onPick(t); } },
        h('span', { class: 'strong' }, t.name), t.shortcut ? h('span', { class: 'au-tpl-sc' }, `/${t.shortcut}`) : null,
        h('span', { class: 'small muted clamp2' }, t.body))) : h('p', { class: 'small faint pad-s' }, 'No templates match.'));
    };
    search.addEventListener('input', draw);
    box.append(search, list);
    api('GET', '/api/templates').then(r => { all = r.templates; draw(); }).catch(err => fill(list, h('p', { class: 'error' }, err.message)));
    requestAnimationFrame(() => search.focus());
  }, { className: 'au-tpl-pop', label: 'Templates' });
}

function paramControl(spec, value, set, cat) {
  const id = `au-p-${spec.key}`;
  if (spec.type === 'template' || spec.type === 'longtext') {
    const ta = h('textarea', { id, rows: '5', maxlength: '4000', value: value ?? '', placeholder: spec.type === 'template' ? 'Hi {first}, …' : '', oninput: e => set(e.target.value) });
    return h('div', { class: 'au-param' }, h('div', { class: 'au-param-head' }, h('label', { for: id }, spec.label, spec.required ? null : h('span', { class: 'faint' }, ' (optional)')),
      spec.type === 'template' ? h('button', { type: 'button', class: 'btn small text', onclick: e => templatePicker(e.currentTarget, t => { ta.value = t.body; set(t.body); api('POST', `/api/templates/${enc(t.id)}/used`).catch(() => {}); }) }, icon('description', 15), 'Insert template') : null),
    ta, spec.type === 'template' ? variableChips(cat, ta) : null);
  }
  let control;
  if (spec.type === 'number') control = h('input', { id, type: 'number', value: value ?? '', oninput: e => set(e.target.value === '' ? null : Number(e.target.value)) });
  else if (spec.type === 'money') { control = moneyInput({ value: value ?? null, onChange: set, label: spec.label }); control.input.id = id; }
  else if (spec.type === 'day') control = h('input', { id, type: 'date', value: value ?? '', onchange: e => set(e.target.value || null) });
  else if (spec.type === 'enum') {
    const unset = (value ?? spec.default) == null;
    control = h('select', { id, onchange: e => set(e.target.value || null) }, unset ? h('option', { value: '' }, `Choose ${spec.label.toLowerCase()}…`) : null,
      (spec.options ?? []).map(o => (typeof o === 'object' ? o : { value: o, label: o }))
        .map(o => h('option', { value: o.value, selected: (value ?? spec.default) === o.value }, o.label)));
  } else if (ID_LOOKUP[spec.type]) {
    const opts = cat.lookups?.[ID_LOOKUP[spec.type]] ?? [];
    control = opts.length
      ? h('select', { id, onchange: e => set(e.target.value || null) }, h('option', { value: '' }, `Choose ${spec.label.toLowerCase()}…`), opts.map(o => h('option', { value: o.value, selected: value === o.value }, o.label)))
      : h('p', { class: 'small faint m0', id }, `No ${ID_LOOKUP[spec.type]} yet.`);
  } else control = h('input', { id, type: 'text', maxlength: '200', value: value ?? '', placeholder: spec.key === 'title' ? 'Call {first}' : '', oninput: e => set(e.target.value) });
  return h('div', { class: 'au-param' }, h('label', { for: id }, spec.label, spec.required ? null : h('span', { class: 'faint' }, ' (optional)')), control);
}

function numberField(label, value, { min = 0, max = 365, onChange, suffix = '' }) {
  const id = `au-n-${Math.random().toString(36).slice(2, 8)}`;
  return h('div', { class: 'au-num' }, h('label', { for: id }, label),
    h('span', { class: 'au-num-box' }, h('input', { id, type: 'number', min: String(min), max: String(max), value: String(value ?? 0), inputmode: 'numeric',
      oninput: e => { const n = Math.max(min, Math.min(max, Math.round(Number(e.target.value) || 0))); onChange(n); } }), suffix ? h('span', { class: 'faint small' }, suffix) : null));
}

const factsForRules = cat => (cat.facts ?? []).filter(f => f.id !== 'core.segments');
const tagsForRules = cat => (cat.lookups?.tags ?? []).map(t => ({ id: t.value, name: t.label }));

// MARK: - The screen

route('/automations/:id/:tab?', async (el, p, view) => {
  const id = p.id;
  fill(el, skeleton('card', { rows: 3 }), skeleton('chart'));
  let cat, saved;
  try {
    [cat, saved] = await Promise.all([catalogue(true), api('GET', `/api/automations/${enc(id)}`).then(r => r.automation)]);
  } catch (err) {
    if (!view.fresh()) return;
    fill(el, emptyHero({ icon: 'bolt', title: err.status === 404 ? 'That automation isn’t here' : 'Could not load it', line: err.status === 404 ? 'It may have been deleted.' : err.message, action: { label: 'All automations', path: '/automations' } }));
    return;
  }
  if (!view.fresh()) return;
  let a = editable(saved);
  let dirty = false;
  let selected = null; // the node whose inspector is open: 'trigger' | 'conditions' | step id
  let tab = p.tab === 'runs' ? 'runs' : 'build';

  setCrumbs([{ label: 'Engage' }, { label: 'Automations', path: '/automations' }, { label: saved.name, path: `/automations/${id}` }]);

  // Header
  const nameEl = h('h1', { class: 'au-b-name ui-display' });
  const statusSlot = h('span');
  const dirtyDot = h('span', { class: 'au-dirty', hidden: true }, h('span', { class: 'au-dirty-dot' }), 'Unsaved');
  const saveBtn = h('button', { type: 'button', class: 'btn', disabled: true, onclick: e => busy(e.currentTarget, null, save) }, 'Save');
  const goBtn = h('button', { type: 'button', class: 'btn primary', onclick: e => busy(e.currentTarget, null, toggleLive) });
  const testBtn = h('button', { type: 'button', class: 'btn', onclick: () => testPanel() }, icon('science', 17), 'Test on…');
  const moreBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'More', onclick: e => menu(e.currentTarget, [
    saved.status === 'live' ? { label: 'Pause', icon: 'pause', onclick: () => setStatus('paused') } : null,
    saved.status !== 'draft' ? { label: 'Back to draft (stops runs)', icon: 'edit_note', onclick: () => setStatus('draft') } : null,
    { label: 'Duplicate', icon: 'content_copy', onclick: duplicate },
    'sep',
    { label: 'Delete', icon: 'delete', danger: true, onclick: remove },
  ]) }, icon('more_horiz', 18));
  const sentenceEl = h('p', { class: 'au-sentence-text' });
  const needsEl = h('div', { class: 'au-sentence-needs' });
  const head = h('header', { class: 'au-b-head' },
    h('div', { class: 'au-b-title' }, h('div', { class: 'ui-eyebrow' }, 'Automation'), h('div', { class: 'au-b-namerow' }, nameEl, statusSlot, dirtyDot)),
    h('div', { class: 'au-b-actions' }, testBtn, saveBtn, goBtn, moreBtn));
  const hero = h('section', { class: 'au-sentence', 'aria-label': 'The automation in one sentence' }, h('span', { class: 'au-sentence-mark', 'aria-hidden': 'true' }, icon('bolt', 18)), sentenceEl, needsEl);
  const bodyBox = h('div', { class: 'au-b-body' });
  const bar = tabs([{ id: 'build', label: 'Build' }, { id: 'runs', label: 'Runs', badge: saved.stats?.active || null }], tab, t => {
    tab = t;
    history.replaceState(null, '', `#/automations/${id}${t === 'runs' ? '/runs' : ''}`);
    drawBody();
  }, { label: 'Automation views' });
  fill(el, head, hero, bar, bodyBox);

  function drawHead() {
    fill(nameEl, inlineEdit(a.name, async v => { a.name = v || 'Untitled automation'; changed(); }, { label: 'Name', placeholder: 'Name this automation' }));
    fill(statusSlot, statusPill(saved.status));
    dirtyDot.hidden = !dirty;
    saveBtn.disabled = !dirty;
    fill(goBtn, saved.status === 'live' ? [icon('pause', 17), 'Pause'] : [icon('play_arrow', 17), 'Turn on']);
    goBtn.classList.toggle('primary', saved.status !== 'live');
    fill(sentenceEl, withVars(sentence(a, cat)));
    const needs = saved.needs ?? [];
    fill(needsEl, needs.length ? [icon('hub', 14), `Waiting for ${needs.join(', ')}: it can be saved, but not turned on, until that part of the desk is there.`] : null);
    needsEl.hidden = !needs.length;
  }

  function changed() {
    dirty = true;
    drawHead();
    if (tab === 'build') drawCanvas();
  }

  // MARK: Saving and status

  const payload = () => ({ name: a.name, description: a.description, trigger: a.trigger, conditions: a.conditions?.rules?.length ? a.conditions : null, steps: a.steps, settings: a.settings });
  async function save({ quiet = false } = {}) {
    const r = await api('PUT', `/api/automations/${enc(id)}`, payload());
    saved = r.automation;
    a = editable(saved);
    dirty = false;
    drawHead();
    if (tab === 'build') drawCanvas();
    if (!quiet) toast('Saved');
  }
  async function setStatus(status) {
    try {
      if (dirty) await save({ quiet: true });
      saved = (await api('POST', `/api/automations/${enc(id)}/status`, { status })).automation;
      drawHead();
      toast(status === 'live' ? 'It’s on. New triggers start runs from now.' : status === 'paused' ? 'Paused. Waiting runs hold until you turn it back on.' : 'Back to draft. Running clients were stopped.');
    } catch (err) {
      toast(err.message, { error: true });
    }
  }
  const toggleLive = () => setStatus(saved.status === 'live' ? 'paused' : 'live');
  async function duplicate() {
    try {
      const r = await api('POST', '/api/automations', { ...payload(), name: `${a.name} (copy)`.slice(0, 80) });
      go(`/automations/${enc(r.automation.id)}`);
    } catch (err) { toast(err.message, { error: true }); }
  }
  async function remove() {
    if (!(await confirmBox(`Delete “${a.name}”?`, { ok: 'Delete', danger: true, detail: 'Its runs and their logs go too. Anything already sent stays sent.' }))) return;
    try { await api('DELETE', `/api/automations/${enc(id)}`); toast('Deleted'); go('/automations'); } catch (err) { toast(err.message, { error: true }); }
  }
  view.onLeave(() => { if (dirty) toast('You left with unsaved changes to the automation', { action: { label: 'Go back', run: () => go(`/automations/${id}`) } }); });

  // MARK: Build

  const canvas = h('div', { class: 'au-canvas' });
  const side = h('aside', { class: 'au-side', 'aria-label': 'How it runs' });
  let dragFrom = null;

  function connector(index, { last = false } = {}) {
    const plus = h('button', { type: 'button', class: 'au-plus', 'aria-label': last ? 'Add a step at the end' : `Add a step here (before step ${index + 1})`,
      onclick: e => addMenu(e.currentTarget, index) }, icon('add', 16));
    const c = h('div', { class: 'au-conn' + (last ? ' last' : ''), 'data-at': String(index) }, h('span', { class: 'au-conn-line' }), plus);
    c.addEventListener('dragover', e => { if (dragFrom === null) return; e.preventDefault(); c.classList.add('drop'); });
    c.addEventListener('dragleave', () => c.classList.remove('drop'));
    c.addEventListener('drop', e => {
      e.preventDefault();
      c.classList.remove('drop');
      if (dragFrom === null) return;
      moveStep(dragFrom, index > dragFrom ? index - 1 : index);
      dragFrom = null;
    });
    return c;
  }

  function nodeShell({ kind, kicker, glyph, title, detail = null, chips = [], onOpen, extra = null, idx = null, sel = false, bubble = false }) {
    const open = h('button', { type: 'button', class: 'au-node-open', onclick: onOpen, 'aria-label': `${kicker}: ${title}. Edit` });
    const node = h('div', { class: `au-node au-node-${kind}` + (sel ? ' sel' : ''), 'data-idx': idx === null ? null : String(idx) },
      open,
      h('div', { class: 'au-node-head' },
        h('span', { class: 'au-node-glyph' }, icon(glyph, 18)),
        h('span', { class: 'au-node-kicker' }, kicker),
        idx !== null ? h('span', { class: 'au-node-n t-num' }, String(idx + 1)) : null,
        h('span', { class: 'grow' }), extra),
      h('div', { class: 'au-node-title' }, title),
      detail ? h('div', { class: bubble ? 'au-node-bubble' : 'au-node-detail' }, withVars(detail)) : null,
      chips.length ? h('div', { class: 'au-node-chips' }, chips) : null);
    return node;
  }
  const chip = (glyph, text, tone = '') => h('span', { class: `au-nchip${tone ? ` ${tone}` : ''}` }, icon(glyph, 13), text);

  function triggerNode() {
    const t = a.trigger;
    const ev = t.type === 'event' ? cat.events.find(e => e.type === t.event) : null;
    const chips = [];
    if (t.type === 'event' && whereWords(t.where)) chips.push(chip('filter_alt', whereWords(t.where)));
    if (ev?.aiDerived) chips.push(chip('auto_awesome', 'AI judgement: coach-side steps only', 'ai'));
    if (t.type === 'event' && t.event && !ev) chips.push(chip('hub', 'Not available yet', 'warn'));
    const kicker = { event: 'When', schedule: 'On a schedule', enters: 'When someone matches', manual: 'When you add someone' }[t.type];
    return nodeShell({ kind: 'trigger', kicker, glyph: triggerIcon(t), title: triggerWords(t, cat), chips, onOpen: inspectTrigger, sel: selected === 'trigger' });
  }

  function conditionsNode() {
    if (!a.conditions?.rules?.length) {
      return h('button', { type: 'button', class: 'au-only-if', onclick: inspectConditions }, icon('filter_alt', 15), 'Only if… (add a condition)');
    }
    return nodeShell({ kind: 'cond', kicker: 'Only if', glyph: 'filter_alt', title: rulesWords(a.conditions, cat), onOpen: inspectConditions, sel: selected === 'conditions',
      chips: [chip('person_search', 'Checked when a run would start')] });
  }

  function stepNode(s, i) {
    const { title, detail } = stepParts(s, cat);
    const problem = stepProblem(s, cat);
    const ai = usesAi(a, cat);
    const chips = [];
    if (s.if?.rules?.length) chips.push(chip('filter_alt', `Only if ${rulesWords(s.if, cat)}`));
    if (s.critical) chips.push(chip('flag', 'Critical: stops the run if it fails'));
    if (s.type === 'action' && ai && !AI_SAFE.includes(s.action)) chips.push(chip('block', 'Refused on an AI trigger', 'warn'));
    if (problem) chips.push(chip('warning', problem, 'warn'));
    const handle = h('button', {
      type: 'button', class: 'au-handle', 'aria-label': `Move step ${i + 1}. Use the up and down arrow keys`, title: 'Drag to reorder, or use the arrow keys',
      onkeydown: e => {
        const d = { ArrowUp: -1, ArrowDown: 1 }[e.key];
        if (!d) return;
        e.preventDefault();
        const to = i + d;
        if (to < 0 || to >= a.steps.length) return;
        moveStep(i, to);
        requestAnimationFrame(() => canvas.querySelector(`.au-node[data-idx="${to}"] .au-handle`)?.focus());
      },
    }, icon('drag_indicator', 18));
    const more = h('button', { type: 'button', class: 'au-node-more', 'aria-label': `Step ${i + 1} options`, onclick: e => menu(e.currentTarget, [
      { label: 'Edit', icon: 'edit', onclick: () => inspectStep(s.id) },
      { label: 'Move up', icon: 'arrow_upward', disabled: i === 0, onclick: () => moveStep(i, i - 1) },
      { label: 'Move down', icon: 'arrow_downward', disabled: i === a.steps.length - 1, onclick: () => moveStep(i, i + 1) },
      { label: 'Duplicate', icon: 'content_copy', onclick: () => { a.steps.splice(i + 1, 0, { ...structuredClone(s), id: newStepId(a.steps) }); changed(); } },
      'sep',
      { label: 'Delete step', icon: 'delete', danger: true, onclick: () => deleteStep(i) },
    ]) }, icon('more_horiz', 18));
    const kicker = s.type === 'wait' ? 'Wait' : i === 0 ? 'Then' : 'Then';
    const node = nodeShell({
      kind: s.type === 'wait' ? 'wait' : s.action === 'message.send' ? 'msg' : 'act', kicker, glyph: s.type === 'wait' ? 'hourglass_empty' : actionIcon(s.action),
      title, detail: detail || null, bubble: s.action === 'message.send' && !!detail, chips, idx: i, onOpen: () => inspectStep(s.id), sel: selected === s.id,
      extra: [handle, more],
    });
    node.draggable = true;
    node.addEventListener('dragstart', e => { dragFrom = i; node.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); canvas.classList.add('au-dragging'); });
    node.addEventListener('dragend', () => { dragFrom = null; node.classList.remove('dragging'); canvas.classList.remove('au-dragging'); });
    return node;
  }

  function drawCanvas() {
    const flow = [triggerNode(), h('div', { class: 'au-conn' }, h('span', { class: 'au-conn-line' })), conditionsNode()];
    a.steps.forEach((s, i) => { flow.push(connector(i), stepNode(s, i)); });
    flow.push(connector(a.steps.length, { last: true }));
    flow.push(h('div', { class: 'au-end' }, icon('flag', 15), a.steps.length ? 'Run finishes' : 'Add the first step with +'));
    fill(canvas, h('div', { class: 'au-flow' }, flow));
    drawSide();
  }

  function moveStep(from, to) {
    if (from === to || to < 0 || to >= a.steps.length) return;
    const [s] = a.steps.splice(from, 1);
    a.steps.splice(to, 0, s);
    changed();
  }
  function deleteStep(i) {
    const [gone] = a.steps.splice(i, 1);
    changed();
    toast('Step removed', { undo: async () => { a.steps.splice(i, 0, gone); changed(); } });
  }

  function addMenu(anchor, index) {
    const ai = usesAi(a, cat);
    const groups = [['Message', ['message.send', 'form.send', 'program.assign']], ['You', ['coach.notify', 'task.create', 'ai.draft']], ['Tags', ['tag.add', 'tag.remove']]];
    const known = new Set(groups.flatMap(g => g[1]));
    const others = cat.actions.filter(x => !known.has(x.id));
    const item = x => ({ label: x.label, icon: actionIcon(x.id), disabled: ai && !AI_SAFE.includes(x.id), detail: ai && !AI_SAFE.includes(x.id) ? 'Not on an AI trigger' : null, onclick: () => insert(index, x) });
    const items = [{ label: 'Wait', icon: 'hourglass_empty', detail: 'A delay, or until a time of day', onclick: () => insert(index, null) }, 'sep'];
    for (const [, ids] of groups) {
      const list = ids.map(i => cat.actions.find(x => x.id === i)).filter(Boolean);
      if (list.length) items.push(...list.map(item), 'sep');
    }
    items.push(...others.map(item));
    if (items.at(-1) === 'sep') items.pop();
    menu(anchor, items, { label: 'Add a step' });
  }

  function insert(index, action) {
    if (a.steps.length >= 20) { toast('An automation has at most 20 steps', { error: true }); return; }
    const sid = newStepId(a.steps);
    const step = action
      ? { id: sid, type: 'action', action: action.id, params: Object.fromEntries((action.params ?? []).filter(p => p.default !== undefined).map(p => [p.key, p.default])) }
      : { id: sid, type: 'wait', days: 1, hours: 0, at: '09:00' };
    a.steps.splice(index, 0, step);
    changed();
    inspectStep(sid);
  }

  // MARK: Inspectors

  function inspector(key, title, build) {
    selected = key;
    drawCanvas();
    slideOver(title, (body, close) => {
      build(body, close);
      return h('div', { class: 'au-insp-foot' }, h('span', { class: 'small faint grow' }, 'Changes show on the canvas as you type.'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => close() }, 'Done'));
    }, { onClose: () => { selected = null; drawCanvas(); }, className: 'au-insp' });
  }

  function inspectTrigger() {
    inspector('trigger', 'Trigger', body => {
      const t = a.trigger;
      const box = h('div', { class: 'au-insp-sec' });
      const pick = segmentedNav([['event', 'An event'], ['schedule', 'A schedule'], ['enters', 'Starts to match'], ['manual', 'By hand']], t.type, type => {
        if (type === a.trigger.type) return;
        a.trigger = type === 'event' ? { type, event: null, where: {} }
          : type === 'schedule' ? { type, days: [1], at: '08:00', audience: { everyone: true } }
            : type === 'enters' ? { type, rules: { match: 'all', rules: [{ fact: 'core.daysQuiet', op: 'gte', value: 5 }] } } : { type };
        changed();
        drawFields();
      }, { label: 'Trigger type' });
      body.append(h('div', { class: 'au-insp-sec' }, pick), box);
      function drawFields() {
        const tr = a.trigger;
        if (tr.type === 'event') {
          const groups = new Map();
          for (const e of cat.events) { const g = e.feature === 'core' ? 'Everyday' : e.feature[0].toUpperCase() + e.feature.slice(1); groups.set(g, [...(groups.get(g) ?? []), e]); }
          const sel = h('select', { id: 'au-ev', onchange: e => { tr.event = e.target.value; tr.where = {}; changed(); drawFields(); } },
            tr.event ? null : h('option', { value: '', selected: true, disabled: true }, 'Choose what starts it…'),
            [...groups].map(([g, list]) => h('optgroup', { label: g }, list.map(e => h('option', { value: e.type, selected: e.type === tr.event }, `${e.label}${e.aiDerived ? ' (AI)' : ''}`)))));
          const ev = cat.events.find(e => e.type === tr.event);
          const fields = whereFields(ev, cat);
          const where = h('div', { class: 'au-where' });
          const set = (k, v) => { tr.where = { ...tr.where }; if (v === undefined) delete tr.where[k]; else tr.where[k] = v; changed(); };
          fill(where, fields.map(f => {
            const cur = tr.where?.[f.key];
            const id = `au-where-${f.key}`;
            let control;
            if (f.type === 'bool' || f.type === 'enum') {
              const opts = f.type === 'bool' ? [['true', 'Yes'], ['false', 'No']] : f.options.map(([v, l]) => [String(v), l]);
              control = h('select', { id, onchange: e => {
                const v = e.target.value;
                if (v === '') set(f.key, undefined);
                else if (f.type === 'bool') set(f.key, v === 'true');
                else { const o = f.options.find(([x]) => String(x) === v); set(f.key, o ? o[0] : v); }
              } }, h('option', { value: '', selected: cur === undefined }, 'Any'), opts.map(([v, l]) => h('option', { value: v, selected: cur !== undefined && String(cur) === v }, l)));
            } else {
              control = h('input', { id, type: f.type === 'number' ? 'number' : 'text', value: cur === undefined ? '' : String(cur), placeholder: 'Any',
                oninput: e => { const v = e.target.value.trim(); set(f.key, v === '' ? undefined : f.type === 'number' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v); } });
            }
            return h('div', { class: 'au-where-row' }, h('label', { class: 'au-where-key', for: id }, f.label), control);
          }));
          fill(box, h('div', { class: 'field' }, h('label', { for: 'au-ev' }, 'When this happens'), sel),
            ev?.aiDerived ? h('p', { class: 'au-ai-note' }, icon('auto_awesome', 16), 'This comes from an AI judgement. Automations that start from it can only notify you, add a task, tag or draft: never message the client.') : null,
            fields.length ? h('div', { class: 'field' }, h('label', null, 'Only when'), where) : null);
        } else if (tr.type === 'schedule') {
          const days = h('div', { class: 'au-days', role: 'group', 'aria-label': 'Days' }, DAY_SHORT.map((d, i) => h('button', {
            type: 'button', class: 'au-day' + (tr.days.includes(i + 1) ? ' on' : ''), 'aria-pressed': String(tr.days.includes(i + 1)), 'aria-label': DAY_NAMES[i],
            onclick: () => { tr.days = tr.days.includes(i + 1) ? tr.days.filter(x => x !== i + 1) : [...tr.days, i + 1].sort(); changed(); drawFields(); },
          }, d)));
          const time = h('input', { type: 'time', id: 'au-at', value: tr.at, step: '300', onchange: e => { if (e.target.value) { tr.at = e.target.value; changed(); } } });
          const aud = h('select', { id: 'au-aud', onchange: e => {
            const [k, v] = e.target.value.split(':');
            tr.audience = k === 'seg' ? { segmentId: v } : k === 'tag' ? { tagIds: [v] } : { everyone: true };
            changed();
          } }, h('option', { value: 'all' }, 'Everyone'),
          (cat.lookups.segments ?? []).length ? h('optgroup', { label: 'Segments' }, cat.lookups.segments.map(s => h('option', { value: `seg:${s.value}`, selected: tr.audience?.segmentId === s.value }, s.label))) : null,
          (cat.lookups.tags ?? []).length ? h('optgroup', { label: 'Tags' }, cat.lookups.tags.map(t2 => h('option', { value: `tag:${t2.value}`, selected: tr.audience?.tagIds?.[0] === t2.value }, t2.label))) : null);
          fill(box, h('div', { class: 'field' }, h('label', null, 'On'), days), h('div', { class: 'field' }, h('label', { for: 'au-at' }, 'At (London time)'), time),
            h('div', { class: 'field' }, h('label', { for: 'au-aud' }, 'For'), aud),
            h('p', { class: 'small muted' }, 'Fires once per slot. Clients whose outreach is paused are left out.'));
        } else if (tr.type === 'enters') {
          const rb = ruleBuilder({ facts: factsForRules(cat), value: tr.rules, tags: tagsForRules(cat), onChange: v => { tr.rules = v; changed(); },
            count: rules => api('POST', '/api/segments/preview', { rules }).then(r => r.count) });
          fill(box, h('p', { class: 'small muted' }, 'A run starts when a client starts to match. The first check only notes who already matches, so turning it on never floods anyone.'), rb.el);
        } else {
          fill(box, h('p', { class: 'muted' }, 'You add people yourself: from a client’s page, or select several in Clients and choose “Start automation”.'));
        }
      }
      drawFields();
    });
  }

  function inspectConditions() {
    inspector('conditions', 'Only if…', (body, close) => {
      if (!a.conditions) a.conditions = { match: 'all', rules: [] };
      const rb = ruleBuilder({ facts: factsForRules(cat), value: a.conditions, tags: tagsForRules(cat), onChange: v => { a.conditions = v; changed(); },
        count: rules => api('POST', '/api/segments/preview', { rules }).then(r => r.count) });
      body.append(h('p', { class: 'small muted' }, 'Checked when a run would start. Anyone who doesn’t match is skipped.'), rb.el,
        h('button', { type: 'button', class: 'btn small text danger', onclick: () => { a.conditions = null; changed(); close(); } }, icon('delete', 15), 'Remove conditions'));
    });
  }

  function inspectStep(sid) {
    const s = a.steps.find(x => x.id === sid);
    if (!s) return;
    const i = a.steps.indexOf(s);
    inspector(sid, s.type === 'wait' ? `Step ${i + 1} · Wait` : `Step ${i + 1} · ${stepParts(s, cat).title}`, (body, close) => {
      if (s.type === 'wait') {
        const preview = h('p', { class: 'au-wait-preview' });
        const atOn = h('input', { type: 'checkbox', role: 'switch', checked: !!s.at, 'aria-label': 'At a time of day' });
        const at = h('input', { type: 'time', value: s.at ?? '09:00', step: '300', disabled: !s.at, 'aria-label': 'Time of day' });
        const upd = () => { fill(preview, icon('hourglass_empty', 16), waitWords(s)); changed(); };
        atOn.addEventListener('change', () => { s.at = atOn.checked ? at.value || '09:00' : null; at.disabled = !atOn.checked; upd(); });
        at.addEventListener('change', () => { if (at.value) { s.at = at.value; upd(); } });
        body.append(h('div', { class: 'au-wait-grid' },
          numberField('Days', s.days, { max: 365, onChange: n => { s.days = n; upd(); } }),
          numberField('Hours', s.hours, { max: 72, onChange: n => { s.hours = n; upd(); } })),
        h('label', { class: 'switch au-switch-row' }, h('span', { class: 'grow' }, 'Then at a time of day', h('div', { class: 'small muted' }, 'London time, so it stays put when the clocks change.')), atOn), at, preview);
        fill(preview, icon('hourglass_empty', 16), waitWords(s));
      } else {
        const spec = cat.actions.find(x => x.id === s.action);
        if (!spec) {
          body.append(emptyHero({ icon: 'hub', title: 'Not available yet', line: `${s.action} comes from a part of the desk that isn’t here yet. The step is kept; the automation can’t go on until it is.` }));
        } else {
          if (!spec.clientFacing) body.append(h('p', { class: 'au-insp-note' }, icon('shield', 15), 'Coach-side: the client never sees this step.'));
          else body.append(h('p', { class: 'au-insp-note' }, icon('verified', 15), spec.id === 'message.send' ? 'Governed: capped per client per day, held in quiet hours, skipped if their outreach is paused.' : 'The client sees this.'));
          for (const ps of spec.params ?? []) body.append(paramControl(ps, s.params?.[ps.key], v => { s.params = { ...s.params, [ps.key]: v }; if (v === null || v === '') delete s.params[ps.key]; changed(); }, cat));
        }
        const ifBox = h('div', { class: 'au-if' });
        const drawIf = () => {
          if (!s.if) { fill(ifBox, h('button', { type: 'button', class: 'btn small', onclick: () => { s.if = { match: 'all', rules: [] }; drawIf(); } }, icon('filter_alt', 15), 'Only do this if…')); return; }
          const rb = ruleBuilder({ facts: factsForRules(cat), value: s.if, tags: tagsForRules(cat), onChange: v => { s.if = v.rules.length ? v : v; changed(); } });
          fill(ifBox, h('div', { class: 'au-if-head' }, h('b', null, 'Only if'), h('span', { class: 'small muted grow' }, 'Checked when the step runs; if not, it is skipped and logged.'),
            h('button', { type: 'button', class: 'btn small text', onclick: () => { delete s.if; changed(); drawIf(); } }, 'Remove')), rb.el);
        };
        drawIf();
        const crit = h('label', { class: 'switch au-switch-row' }, h('span', { class: 'grow' }, 'Critical', h('div', { class: 'small muted' }, 'If this step fails, stop the run instead of carrying on.')),
          h('input', { type: 'checkbox', role: 'switch', checked: !!s.critical, onchange: e => { if (e.target.checked) s.critical = true; else delete s.critical; changed(); } }));
        body.append(ifBox, crit);
      }
      body.append(h('div', { class: 'au-insp-danger' }, h('button', { type: 'button', class: 'btn small text danger', onclick: () => { close(); deleteStep(a.steps.indexOf(s)); } }, icon('delete', 15), 'Delete step')));
    });
  }

  // MARK: The side panel: settings and a checklist

  let summaryP = null;
  function drawSide() {
    const st = a.settings;
    const mode = st.reentry === 'never' ? 'never' : st.reentry === 'always' ? 'always' : 'cooldown';
    const cool = h('div', { hidden: mode !== 'cooldown' }, numberField('Cooldown', st.reentry?.cooldownDays ?? 14, { min: 1, max: 365, suffix: 'days', onChange: n => { st.reentry = { cooldownDays: n }; changed(); } }));
    const stopReply = (st.stopOn ?? []).includes('message.received');
    const problems = [];
    if (!a.steps.some(s => s.type === 'action')) problems.push('Add at least one action');
    a.steps.forEach((s, i) => { const pr = stepProblem(s, cat); if (pr) problems.push(`Step ${i + 1}: ${pr}`); });
    if (a.trigger.type === 'schedule' && !a.trigger.days?.length) problems.push('Pick at least one day');
    if (a.trigger.type === 'event' && !a.trigger.event) problems.push('Choose the event that starts it');
    for (const n of saved.needs ?? []) problems.push(`Needs ${n}`);
    const govern = h('p', { class: 'small muted au-govern' }, icon('verified', 15), 'Messages follow your outreach rules.');
    summaryP ??= api('GET', '/api/outreach/summary').catch(() => null);
    summaryP.then(sum => {
      if (!sum) return;
      const q = sum.settings.quietHours;
      fill(govern, icon('verified', 15), `At most ${sum.settings.dailyCap} automated messages per client a day${q ? `, held ${q.start}–${q.end}` : ''}. `,
        h('a', { href: '#/account/outreach' }, 'Change'));
    });
    fill(side,
      h('section', { class: 'au-side-card' + (problems.length ? '' : ' ready') },
        h('h2', { class: 'au-side-title' }, icon(problems.length ? 'checklist' : 'check_circle', 18), problems.length ? 'Before it can go on' : 'Ready to go'),
        problems.length ? h('ul', { class: 'au-checklist' }, problems.map(x => h('li', null, x))) : h('p', { class: 'small muted m0' }, 'Every step is complete. Test it on a client, then turn it on.')),
      h('section', { class: 'au-side-card' },
        h('h2', { class: 'au-side-title' }, icon('tune', 18), 'How it runs'),
        h('div', { class: 'au-side-field' }, h('div', { class: 'au-side-label' }, 'Can someone go through it again?'),
          segmentedNav([['never', 'Once'], ['cooldown', 'After a break'], ['always', 'Every time']], mode, m => {
            st.reentry = m === 'never' ? 'never' : m === 'always' ? 'always' : { cooldownDays: st.reentry?.cooldownDays ?? 14 };
            changed();
          }, { label: 'Re-entry' }), cool),
        h('label', { class: 'switch au-switch-row' }, h('span', { class: 'grow' }, 'Stop when the client replies'),
          h('input', { type: 'checkbox', role: 'switch', checked: stopReply, onchange: e => { st.stopOn = e.target.checked ? [...new Set([...(st.stopOn ?? []), 'message.received'])] : (st.stopOn ?? []).filter(x => x !== 'message.received'); changed(); } })),
        h('label', { class: 'switch au-switch-row' }, h('span', { class: 'grow' }, 'Wait out quiet hours before starting'),
          h('input', { type: 'checkbox', role: 'switch', checked: st.quietHours !== false, onchange: e => { st.quietHours = e.target.checked; changed(); } })),
        numberField('At most', st.maxPerDay ?? 50, { min: 1, max: 1000, suffix: 'starts a day', onChange: n => { st.maxPerDay = n; changed(); } }),
        govern),
      h('section', { class: 'au-side-card au-side-stats' },
        h('h2', { class: 'au-side-title' }, icon('monitoring', 18), 'Last 30 days'),
        h('div', { class: 'au-side-nums' },
          h('div', null, h('b', { class: 't-num' }, String(saved.stats?.runs30 ?? 0)), h('span', null, 'runs')),
          h('div', null, h('b', { class: 't-num' }, String(saved.stats?.active ?? 0)), h('span', null, 'waiting')),
          h('div', { class: saved.stats?.errors30 ? 'tone-attention' : '' }, h('b', { class: 't-num' }, String(saved.stats?.errors30 ?? 0)), h('span', null, 'errors'))),
        h('button', { type: 'button', class: 'btn small text', onclick: () => { bar.setValue('runs'); tab = 'runs'; history.replaceState(null, '', `#/automations/${id}/runs`); drawBody(); } }, 'See every run', icon('chevron_right', 15))));
  }

  // MARK: Test on…

  function testPanel() {
    slideOver('Test on a client', (body) => {
      const status = h('div');
      const pickBox = h('div', { class: 'field' }, h('label', { for: 'au-test-client' }, 'Client'), skeleton('lines', { rows: 1 }));
      const pretend = a.trigger.type === 'event' ? h('input', { type: 'checkbox', role: 'switch', checked: true }) : null;
      const out = h('div', { class: 'au-test-out' }, h('div', { class: 'au-test-empty' }, icon('science', 28), h('p', { class: 't-quote-s' }, 'Pick a client to see their run, step by step.')));
      let select = null;
      loadClients().then(list => {
        select = h('select', { id: 'au-test-client' }, list.map(c => h('option', { value: c.id }, c.name)));
        fill(pickBox, h('label', { for: 'au-test-client' }, 'Client'), select);
      }).catch(err => fill(pickBox, h('p', { class: 'error' }, err.message)));
      const run = h('button', { type: 'button', class: 'btn primary', onclick: e => busy(e.currentTarget, status, async () => {
        if (!select?.value) return;
        if (dirty) await save({ quiet: true });
        const body2 = { clientId: select.value };
        if (pretend?.checked) body2.event = { type: a.trigger.event, payload: a.trigger.where ?? {} };
        const r = await api('POST', `/api/automations/${enc(id)}/test`, body2);
        const name = select.selectedOptions[0]?.textContent ?? 'They';
        fill(out,
          h('div', { class: 'au-test-verdict ' + (r.willRun ? 'yes' : 'no') }, icon(r.willRun ? 'check_circle' : 'block', 20),
            h('div', null, h('b', null, r.willRun ? `It would start for ${name}` : `It would not start for ${name}`), r.reason ? h('div', { class: 'small' }, `Because: ${r.reason}`) : null)),
          h('ol', { class: 'au-test-tl' }, r.timeline.map(t => h('li', { class: `au-tt au-tt-${t.kind}` + (t.skipped ? ' skipped' : '') },
            h('span', { class: 'au-tt-dot' }, icon(t.kind === 'trigger' ? triggerIcon(a.trigger) : t.kind === 'wait' ? 'hourglass_empty' : actionIcon(a.steps.find(s => s.id === t.stepId)?.action), 15)),
            h('div', { class: 'au-tt-body' },
              h('div', { class: 'au-tt-when t-num' }, whenWords(t.at)),
              h('div', { class: 'au-tt-what' }, t.rendered && a.steps.find(s => s.id === t.stepId) ? stepParts(a.steps.find(s => s.id === t.stepId), cat).title : t.description),
              t.rendered ? h('div', { class: 'au-tt-bubble' }, t.rendered) : null,
              t.missing?.length ? h('div', { class: 'au-tt-note warn' }, icon('warning', 13), `Unknown: ${t.missing.map(m => `{${m}}`).join(', ')}`) : null,
              t.note ? h('div', { class: 'au-tt-note' }, icon('schedule', 13), t.note) : null,
              t.skipped ? h('div', { class: 'au-tt-note warn' }, icon('block', 13), `Skipped: ${t.skipped}`) : null)))),
          h('p', { class: 'au-test-safe' }, icon('shield', 15), 'Nothing was sent, saved or logged. Test mode only reads.'));
      }) }, icon('science', 17), 'Run test');
      body.append(h('p', { class: 'muted small' }, 'See exactly what this client would get and when, with every message filled in. Nothing is sent.'),
        pickBox, pretend ? h('label', { class: 'switch au-switch-row' }, h('span', { class: 'grow' }, 'Pretend the trigger just happened', h('div', { class: 'small muted' }, triggerWords(a.trigger, cat))), pretend) : null,
        h('div', { class: 'row' }, run), status, out);
    }, { wide: true, className: 'au-test' });
  }

  // MARK: Runs

  async function drawRuns() {
    fill(bodyBox, skeleton('table', { rows: 5 }));
    const { runs } = await api('GET', `/api/automations/${enc(id)}/runs`);
    if (!view.fresh() || tab !== 'runs') return;
    if (!runs.length) {
      fill(bodyBox, emptyHero({ icon: 'timeline', title: 'No runs yet', line: saved.status === 'live' ? 'The next time the trigger happens, a run appears here with its full log.' : 'Turn it on and every run shows here, step by step.' }));
      return;
    }
    let filter = 'all';
    const counts = Object.fromEntries(['active', 'done', 'stopped', 'failed'].map(s => [s, runs.filter(r => r.status === s).length]));
    const stats = h('div', { class: 'au-run-stats' },
      [['active', 'Waiting', 'hourglass_empty'], ['done', 'Done', 'check_circle'], ['stopped', 'Stopped', 'pause_circle'], ['failed', 'Failed', 'error']].map(([k, l, g]) =>
        h('div', { class: `au-run-stat au-rs-${k}` }, icon(g, 18), h('b', { class: 't-num' }, String(counts[k])), h('span', null, l))));
    const table = dataTable({
      label: 'Runs', rowKey: r => r.id, initialSort: { key: 'startedAt', dir: -1 },
      columns: [
        { key: 'client', label: 'Client', sort: r => r.client?.name ?? '', render: r => h('span', { class: 'au-run-who' }, h('span', { class: 'avatar', style: { width: '28px', height: '28px', fontSize: '11px' } }, r.client?.initials ?? '?'), r.client?.name ?? 'Unknown') },
        { key: 'startedAt', label: 'Started', sort: true, render: r => h('span', { title: new Date(r.startedAt).toLocaleString('en-GB') }, ago(r.startedAt)) },
        { key: 'status', label: 'Status', sort: true, render: r => runPill(r.status) },
        { key: 'step', label: 'Where it is', render: r => h('span', { class: 'small' + (r.failed ? ' tone-attention' : '') }, r.current ? `${r.current.waiting ? 'Waiting, then: ' : ''}${r.current.description}` : `${r.log.at(-1)?.outcome ?? ''}${r.failed && r.status === 'done' ? ' · a step failed' : ''}`) },
        { key: 'nextAt', label: 'Next', sort: true, align: 'right', render: r => (r.nextAt && r.status === 'active' ? whenWords(r.nextAt) : '—') },
      ],
      rows: runs, onRow: openRun, empty: 'No runs match.',
    });
    const seg = segmentedNav([['all', `All ${runs.length}`], ['active', 'Waiting'], ['done', 'Done'], ['stopped', 'Stopped'], ['failed', 'Failed']], filter, f => {
      filter = f; table.setRows(f === 'all' ? runs : runs.filter(r => r.status === f));
    }, { label: 'Filter runs' });
    fill(bodyBox, stats, h('div', { class: 'au-run-bar' }, seg), table.el);
  }

  function openRun(r) {
    slideOver(`${r.client?.name ?? 'Run'} · ${saved.name}`, (body, close) => {
      const items = [...r.log].reverse().map(l => ({
        at: l.at, icon: l.step ? (a.steps[l.step.index]?.type === 'wait' ? 'hourglass_empty' : actionIcon(a.steps[l.step.index]?.action)) : /^Stopped/.test(l.outcome) ? 'stop_circle' : /^Finished/.test(l.outcome) ? 'flag' : 'bolt',
        tone: /^(failed|refused)/i.test(l.outcome) ? 'urgent' : /^(Skipped|Deferred|Stopped)/.test(l.outcome) ? 'attention' : /^(Sent|Notified|Created|Tagged|Finished)/.test(l.outcome) ? 'ok' : null,
        title: l.outcome, detail: l.step ? `Step ${l.step.index + 1}: ${l.step.description}` : null,
      }));
      body.append(h('div', { class: 'au-run-head' }, runPill(r.status), h('span', { class: 'small muted' }, `Started ${ago(r.startedAt)}`),
        r.status === 'active' && r.nextAt ? h('span', { class: 'small muted' }, `· next step ${whenWords(r.nextAt)}`) : null), timeline(items));
      if (r.status !== 'active') return null;
      return h('div', { class: 'au-insp-foot' }, h('span', { class: 'small faint grow' }, 'Stopping ends this run; nothing more is sent.'),
        h('button', { type: 'button', class: 'btn danger', onclick: e => busy(e.currentTarget, null, async () => {
          await api('POST', `/api/automations/runs/${enc(r.id)}/stop`);
          close();
          toast(`Stopped for ${r.client?.name ?? 'them'}`);
          drawRuns();
        }) }, icon('stop_circle', 17), 'Stop run'));
    }, { wide: false });
  }

  function drawBody() {
    if (tab === 'runs') { drawRuns().catch(err => fill(bodyBox, h('p', { class: 'error' }, err.message))); return; }
    fill(bodyBox, h('div', { class: 'au-build' }, h('div', { class: 'au-canvas-wrap' }, canvas), side));
    drawCanvas();
  }

  drawHead();
  drawBody();
  // A fresh "When something happens" draft: pick its event first.
  if (pendingOpen.triggerFor === id) {
    pendingOpen.triggerFor = null;
    if (tab === 'build') { inspectTrigger(); requestAnimationFrame(() => document.getElementById('au-ev')?.focus()); }
  }
});

