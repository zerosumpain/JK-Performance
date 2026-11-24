/*
 * The desk-v2 component kit (docs/design/desk-v2.md 2.4). Every component
 * builds DOM with h() and textContent, takes a plain options object, returns
 * an element (or {el, …methods} where stated) and is reachable with the
 * keyboard. Classes start with ui-; styles live in ui.css. Motion is in CSS
 * only, so prefers-reduced-motion turns it off in one place.
 */
import {
  api, avatar, fill, firstName, fmtDay, fmtTime, h, hashQuery, icon, link, londonParts, onHashQuery, prefs, registered,
  setHashQuery, toast, todayLondon,
} from './core.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let uid = 0;
const nextId = prefix => `${prefix}${++uid}`;
const kids = body => (body === undefined || body === null ? [] : Array.isArray(body) ? body : [body]);

// MARK: - Layers (Esc closes the top one)

const layers = [];
/** Register an open layer (menu, popover, slide-over, palette). Esc closes the newest. Returns remove(). */
export function pushLayer(close) {
  const entry = { close };
  layers.push(entry);
  return () => { const i = layers.indexOf(entry); if (i >= 0) layers.splice(i, 1); };
}
export const layerOpen = () => layers.length > 0;
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !layers.length || e.defaultPrevented) return;
  if (document.querySelector('dialog[open]')) return; // a native sheet handles its own Esc
  e.preventDefault();
  layers.at(-1).close();
});

/** Keep Tab inside `box` while it is open. Returns off(). */
export function trapFocus(box) {
  const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const onKey = e => {
    if (e.key !== 'Tab') return;
    const items = [...box.querySelectorAll(sel)].filter(x => x.offsetParent !== null || x === document.activeElement);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items.at(-1);
    if (e.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  };
  box.addEventListener('keydown', onKey);
  return () => box.removeEventListener('keydown', onKey);
}

// MARK: - Screen header (2.3): eyebrow, display title with an italic accent word, subtitle, actions

/**
 * pageHead({eyebrow, title, accent, sub, actions}): `accent` is the word drawn
 * in italic champagne after the title ("Good morning, *JK*"). At most one
 * primary button among the actions.
 */
export function pageHead({ eyebrow = null, title, accent = null, sub = null, actions = [] }) {
  return h('header', { class: 'ui-head' },
    h('div', { class: 'ui-head-text' },
      eyebrow ? h('div', { class: 'ui-eyebrow' }, eyebrow) : null,
      h('h1', { class: 'ui-display' }, title, accent ? [' ', h('em', null, accent)] : null),
      sub ? h('p', { class: 'ui-head-sub' }, sub) : null),
    kids(actions).length ? h('div', { class: 'ui-head-actions' }, kids(actions)) : null);
}

// MARK: - Tiles and the bento grid (2.3)

const SIZES = ['s', 'm', 'l', 'xl', 'full'];
const SIZE_LABEL = { s: 'Small', m: 'Medium', l: 'Large', xl: 'Extra large', full: 'Full width' };

/**
 * tile({id, title, eyebrow, icon, size='m', tall=false, hero=false, action:{label, path|onclick}, body, loading=false}).
 * The element carries `.body` (the body box) so a caller can fill it later.
 */
export function tile({ id = null, title = null, eyebrow = null, icon: glyph = null, size = 'm', tall = false, hero = false, action = null, body = null, loading = false } = {}) {
  const bodyEl = h('div', { class: 'ui-tile-body' }, loading ? skeleton('lines', { rows: 3 }) : kids(body));
  const act = action ? (action.path
    ? link(action.path, { class: 'ui-tile-action' }, action.label, icon('chevron_right', 16))
    : h('button', { type: 'button', class: 'ui-tile-action', onclick: action.onclick }, action.label, icon('chevron_right', 16))) : null;
  const head = title || eyebrow || glyph || act ? h('div', { class: 'ui-tile-head' },
    glyph ? h('span', { class: 'ui-tile-icon' }, icon(glyph, 18)) : null,
    h('div', { class: 'ui-tile-titles' },
      eyebrow ? h('div', { class: 'ui-tile-eyebrow' }, eyebrow) : null,
      title ? h('h2', { class: 'ui-tile-title' }, title) : null),
    act) : null;
  const el = h('section', {
    class: `ui-tile ui-s-${SIZES.includes(size) ? size : 'm'}${tall ? ' ui-tall' : ''}${hero ? ' ui-hero' : ''}`,
    'data-tile': id, 'aria-label': title || eyebrow || null,
  }, head, bodyEl);
  el.body = bodyEl;
  el.tileSize = size;
  return el;
}

/**
 * bento(el, tiles, {editable, onLayout}): lays out tile() elements in the
 * 12-column grid. Each tile needs data-tile (its id). In edit mode a tile can
 * be dragged (or moved with the arrow keys on its handle), resized from a menu
 * and hidden; onLayout([{id, size, hidden}]) gets every change.
 * Returns {el, setEditing(on), layout(), apply(layout)}.
 */
export function bento(el, tiles, { editable = false, onLayout = null } = {}) {
  el.classList.add('ui-bento');
  let order = [...tiles];
  const hidden = new Set();
  let editing = false;
  const layout = () => order.map(t => ({ id: t.dataset.tile, size: t.tileSize || 'm', hidden: hidden.has(t.dataset.tile) }));
  const emit = () => onLayout?.(layout());
  const setSize = (t, size) => {
    for (const s of SIZES) t.classList.remove(`ui-s-${s}`);
    t.classList.add(`ui-s-${size}`);
    t.tileSize = size;
  };
  const move = (t, delta) => {
    const i = order.indexOf(t), j = Math.max(0, Math.min(order.length - 1, i + delta));
    if (i === j) return;
    order.splice(i, 1);
    order.splice(j, 0, t);
    draw();
    emit();
  };
  let dragging = null;
  const controls = t => {
    const id = t.dataset.tile;
    const handle = h('button', {
      type: 'button', class: 'ui-bento-handle', draggable: 'true', 'aria-label': `Move ${t.getAttribute('aria-label') || id}. Arrow keys move it.`,
      onkeydown: e => {
        const d = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
        if (!d) return;
        e.preventDefault();
        move(t, d);
        t.querySelector('.ui-bento-handle')?.focus();
      },
      ondragstart: e => { dragging = t; t.classList.add('ui-dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); },
      ondragend: () => { t.classList.remove('ui-dragging'); dragging = null; for (const x of order) x.classList.remove('ui-drop'); },
    }, icon('drag_indicator', 18));
    const sizeBtn = h('button', { type: 'button', class: 'ui-bento-btn', 'aria-label': `Size: ${SIZE_LABEL[t.tileSize || 'm']}`, title: 'Size',
      onclick: e => menu(e.currentTarget, SIZES.map(s => ({ label: SIZE_LABEL[s], icon: s === t.tileSize ? 'check' : null, onclick: () => { setSize(t, s); draw(); emit(); } }))) },
    icon('grid_view', 16));
    const eye = h('button', { type: 'button', class: 'ui-bento-btn', 'aria-pressed': String(!hidden.has(id)), 'aria-label': hidden.has(id) ? 'Show tile' : 'Hide tile',
      onclick: () => { if (hidden.has(id)) hidden.delete(id); else hidden.add(id); draw(); emit(); } },
    icon(hidden.has(id) ? 'visibility_off' : 'visibility', 16));
    return h('div', { class: 'ui-bento-tools' }, handle, sizeBtn, eye);
  };
  el.addEventListener('dragover', e => {
    if (!dragging) return;
    e.preventDefault();
    const over = e.target.closest?.('.ui-tile');
    for (const x of order) x.classList.toggle('ui-drop', x === over && x !== dragging);
  });
  el.addEventListener('drop', e => {
    if (!dragging) return;
    e.preventDefault();
    const over = e.target.closest?.('.ui-tile');
    if (over && over !== dragging) {
      order.splice(order.indexOf(dragging), 1);
      order.splice(order.indexOf(over), 0, dragging);
      draw();
      emit();
    }
  });
  function draw() {
    for (const t of order) {
      t.querySelector(':scope > .ui-bento-tools')?.remove();
      t.classList.toggle('ui-editing', editing);
      t.classList.toggle('ui-muted', editing && hidden.has(t.dataset.tile));
      t.hidden = !editing && hidden.has(t.dataset.tile);
      if (editing) t.prepend(controls(t));
    }
    el.replaceChildren(...order);
    el.classList.toggle('ui-bento-edit', editing);
  }
  draw();
  return {
    el,
    layout,
    setEditing(on) { editing = !!on; draw(); },
    /** Apply a saved layout: known ids reorder, resize and hide; tiles it does not name keep their place at the end. */
    apply(saved) {
      if (!Array.isArray(saved)) return;
      const byId = new Map(order.map(t => [t.dataset.tile, t]));
      const next = [];
      for (const s of saved) {
        const t = byId.get(s.id);
        if (!t) continue;
        byId.delete(s.id);
        if (SIZES.includes(s.size)) setSize(t, s.size);
        if (s.hidden) hidden.add(s.id); else hidden.delete(s.id);
        next.push(t);
      }
      order = [...next, ...byId.values()];
      draw();
    },
  };
}

// MARK: - Skeletons

/** skeleton('lines'|'card'|'table'|'chart', {rows=3}): shimmer placeholders instead of "Loading…". */
export function skeleton(kind = 'lines', { rows = 3 } = {}) {
  const bar = (w, cls = '') => h('span', { class: `ui-sk ${cls}`, style: { width: w } });
  const widths = ['92%', '76%', '84%', '58%', '70%', '88%'];
  let body;
  if (kind === 'card') body = [bar('40%', 'ui-sk-title'), ...Array.from({ length: rows }, (_, i) => bar(widths[i % widths.length]))];
  else if (kind === 'table') body = Array.from({ length: rows }, () => h('div', { class: 'ui-sk-row' }, h('span', { class: 'ui-sk ui-sk-dot' }), bar('34%'), bar('22%'), bar('16%')));
  else if (kind === 'chart') body = [h('div', { class: 'ui-sk-chart' }, Array.from({ length: 12 }, (_, i) => h('span', { class: 'ui-sk', style: { height: `${30 + ((i * 37) % 60)}%` } })))];
  else body = Array.from({ length: rows }, (_, i) => bar(widths[i % widths.length]));
  return h('div', { class: `ui-skeleton ui-sk-${kind}`, role: 'status', 'aria-label': 'Loading' }, body);
}

// MARK: - Slide-over (1.3): right-hand panel, 480 or 720 px, at most two deep

const slides = [];
/**
 * slideOver(title, build(body, close), {wide, onClose, deepLink}) → {el, close}.
 * `deepLink` ('client:u_123') is written to the hash query (?panel=…) so a
 * reload reopens it through registerPanel. Esc closes it; focus is trapped
 * and returns to where it came from.
 */
export function slideOver(title, build, { wide = false, onClose = null, deepLink = null, className = '' } = {}) {
  if (slides.length >= 2) slides[0].close(); // stacks at most two deep: the oldest goes
  const opener = document.activeElement;
  const titleId = nextId('so');
  const body = h('div', { class: 'ui-slide-body' });
  const foot = h('div', { class: 'ui-slide-foot', hidden: true });
  const titleEl = h('h2', { id: titleId, class: 'ui-slide-title' }, title);
  const panel = h('aside', { class: 'ui-slide' + (wide ? ' wide' : '') + (className ? ` ${className}` : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    h('header', { class: 'ui-slide-head' }, titleEl,
      h('button', { type: 'button', class: 'ui-icon-btn', 'aria-label': 'Close', onclick: () => close() }, icon('close', 18))),
    body, foot);
  const scrim = h('div', { class: 'ui-scrim', onclick: () => close() });
  const host = h('div', { class: 'ui-slide-host' }, scrim, panel);
  let closed = false;
  const untrap = trapFocus(panel);
  const unlayer = pushLayer(() => close());
  const entry = { deepLink, host: null, close: () => close() };
  function close(value) {
    if (closed) return;
    closed = true;
    untrap(); unlayer();
    slides.splice(slides.indexOf(entry), 1);
    slides.at(-1)?.host.classList.remove('under');
    host.classList.add('out');
    setTimeout(() => host.remove(), reduced() ? 0 : 200);
    if (deepLink && hashQuery().get('panel') === deepLink) setHashQuery({ panel: slides.at(-1)?.deepLink ?? null });
    document.body.classList.toggle('ui-slide-open', slides.length > 0);
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    onClose?.(value);
  }
  entry.host = host;
  // A second panel slides over the first, which steps back and dims.
  slides.at(-1)?.host.classList.add('under');
  slides.push(entry);
  document.body.append(host);
  document.body.classList.add('ui-slide-open');
  if (deepLink) setHashQuery({ panel: deepLink });
  const footer = build(body, close, { setTitle: t => { titleEl.textContent = t; } });
  if (footer instanceof Node) { foot.hidden = false; foot.append(footer); }
  requestAnimationFrame(() => {
    host.classList.add('in');
    (panel.querySelector('[autofocus]') || panel).focus({ preventScroll: true });
  });
  return { el: panel, body, close };
}

/** Open the panel a deep link names (?panel=kind:id), if its kind is registered. */
function syncPanels() {
  const want = hashQuery().get('panel');
  for (const s of [...slides]) if (s.deepLink && s.deepLink !== want) s.close();
  if (!want || slides.some(s => s.deepLink === want)) return;
  const cut = want.indexOf(':');
  const kind = cut < 0 ? want : want.slice(0, cut), id = cut < 0 ? '' : want.slice(cut + 1);
  const open = registered.panel(kind);
  if (!open) return;
  const spec = open(id);
  if (spec) slideOver(spec.title, spec.build, { wide: spec.wide, deepLink: want });
}
onHashQuery(syncPanels);
/** Open a registered panel by kind and id (palette ⌘Enter, list rows). */
export function openPanel(kind, id) {
  const open = registered.panel(kind);
  if (!open) return false;
  const spec = open(id);
  if (!spec) return false;
  slideOver(spec.title, spec.build, { wide: spec.wide, deepLink: `${kind}:${id}` });
  return true;
}

// MARK: - Popover and menu

/** Place `box` under (or above, when there is no room) `anchor`, inside the viewport. */
function place(box, anchor) {
  const r = anchor.getBoundingClientRect();
  const bw = box.offsetWidth, bh = box.offsetHeight, vw = innerWidth, vh = innerHeight;
  let top = r.bottom + 6;
  if (top + bh > vh - 8 && r.top - bh - 6 > 8) top = r.top - bh - 6;
  let left = r.left;
  if (left + bw > vw - 8) left = Math.max(8, r.right - bw);
  box.style.top = `${Math.max(8, top)}px`;
  box.style.left = `${Math.max(8, left)}px`;
}

/** popover(anchorEl, build(box, close)) → {el, close}: a floating panel anchored to a control. */
export function popover(anchor, build, { className = '', role = 'dialog', label = null } = {}) {
  const box = h('div', { class: `ui-pop ${className}`, role, 'aria-label': label });
  let closed = false;
  const outside = e => { if (!box.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onResize = () => close();
  const unlayer = pushLayer(() => { close(); anchor.focus?.(); });
  function close() {
    if (closed) return;
    closed = true;
    unlayer();
    document.removeEventListener('pointerdown', outside, true);
    removeEventListener('resize', onResize);
    anchor.setAttribute?.('aria-expanded', 'false');
    box.remove();
  }
  build(box, close);
  document.body.append(box);
  place(box, anchor);
  anchor.setAttribute?.('aria-expanded', 'true');
  requestAnimationFrame(() => box.classList.add('in'));
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  addEventListener('resize', onResize);
  return { el: box, close };
}

/**
 * menu(anchorEl, items:[{label, icon, kbd, danger, detail, onclick} | 'sep']):
 * a popover menu with arrow-key navigation; it flips above when there is no room below.
 */
export function menu(anchor, items, { label = 'Menu' } = {}) {
  return popover(anchor, (box, close) => {
    const buttons = [];
    for (const it of items) {
      if (it === 'sep') { box.append(h('div', { class: 'ui-menu-sep', role: 'separator' })); continue; }
      if (!it) continue;
      const b = h('button', {
        type: 'button', role: 'menuitem', class: 'ui-menu-item' + (it.danger ? ' danger' : ''), disabled: it.disabled, tabindex: '-1',
        onclick: () => { close(); it.onclick?.(); },
      }, it.icon ? icon(it.icon, 18) : h('span', { class: 'ui-menu-gap' }),
      h('span', { class: 'grow' }, it.label, it.detail ? h('span', { class: 'ui-menu-detail' }, it.detail) : null),
      it.kbd ? kbd(it.kbd) : null);
      buttons.push(b);
      box.append(b);
    }
    box.addEventListener('keydown', e => {
      const i = buttons.indexOf(document.activeElement);
      const go = j => { e.preventDefault(); buttons[(j + buttons.length) % buttons.length]?.focus(); };
      if (e.key === 'ArrowDown') go(i + 1);
      else if (e.key === 'ArrowUp') go(i < 0 ? buttons.length - 1 : i - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(buttons.length - 1);
      else if (e.key === 'Tab') close();
    });
    requestAnimationFrame(() => buttons.find(b => !b.disabled)?.focus());
  }, { className: 'ui-menu', role: 'menu', label });
}

// MARK: - Tabs and segmented control

/**
 * tabs([{id, label, badge}], value, onchange, {sync:'tab'}): an underline tab
 * bar with arrow keys. With `sync`, the chosen tab is kept in the hash query
 * under that key, so it survives a reload. Returns the element (.setValue(id)).
 */
export function tabs(options, value, onchange, { sync = null, label = 'Sections' } = {}) {
  if (sync && hashQuery().get(sync) && options.some(o => o.id === hashQuery().get(sync))) value = hashQuery().get(sync);
  const bar = h('div', { class: 'ui-tabs', role: 'tablist', 'aria-label': label });
  const draw = () => {
    bar.replaceChildren(...options.map(o => h('button', {
      type: 'button', role: 'tab', class: 'ui-tab' + (o.id === value ? ' sel' : ''), 'aria-selected': String(o.id === value), tabindex: o.id === value ? '0' : '-1',
      onclick: () => pick(o.id),
    }, o.label, o.badge ? h('span', { class: 'ui-count' }, String(o.badge)) : null)));
  };
  const pick = (id, focus = false) => {
    value = id;
    if (sync) setHashQuery({ [sync]: id });
    draw();
    if (focus) bar.querySelector('.sel')?.focus();
    onchange?.(id);
  };
  bar.addEventListener('keydown', e => {
    const i = options.findIndex(o => o.id === value);
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    pick(options[(i + d + options.length) % options.length].id, true);
  });
  draw();
  bar.setValue = id => { value = id; draw(); };
  bar.value = () => value;
  return bar;
}

/** segmentedNav(options, value, onchange): a pill segmented control. options: [{id, label}] or [[id, label]]. */
export function segmentedNav(options, value, onchange, { label = 'View' } = {}) {
  const opts = options.map(o => (Array.isArray(o) ? { id: o[0], label: o[1] } : o));
  const el = h('div', { class: 'ui-seg', role: 'radiogroup', 'aria-label': label });
  const draw = () => el.replaceChildren(...opts.map(o => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(o.id === value), class: o.id === value ? 'sel' : '', tabindex: o.id === value ? '0' : '-1',
    onclick: () => { value = o.id; draw(); onchange?.(o.id); },
  }, o.icon ? icon(o.icon, 16) : null, o.label)));
  el.addEventListener('keydown', e => {
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const i = opts.findIndex(o => o.id === value);
    value = opts[(i + d + opts.length) % opts.length].id;
    draw();
    el.querySelector('.sel')?.focus();
    onchange?.(value);
  });
  draw();
  return el;
}

// MARK: - Data table

/**
 * dataTable({columns:[{key, label, align, sort, width, render}], rows, rowKey, onRow, selectable,
 *   bulkActions:[{label, icon, run(rows)}], empty, filter:true, initialSort}) → {el, setRows, selected}.
 * `sort` is true (by the key's value) or a function row → comparable. Arrow keys move between rows; Enter opens one.
 */
export function dataTable({ columns, rows = [], rowKey = r => r.id, onRow = null, selectable = false, bulkActions = [], empty = 'Nothing here yet.', filter = true, initialSort = null, label = 'Table' }) {
  let data = rows;
  let sort = initialSort ? { ...initialSort } : null; // {key, dir: 1|-1}
  let query = '';
  const chosen = new Set();
  const search = filter ? h('input', { type: 'search', class: 'ui-table-filter', placeholder: 'Filter', 'aria-label': `Filter ${label.toLowerCase()}`, oninput: e => { query = e.target.value.trim().toLowerCase(); draw(); } }) : null;
  const head = h('thead');
  const body = h('tbody');
  const table = h('table', { class: 'ui-table', 'aria-label': label }, head, body);
  const bulkBar = h('div', { class: 'ui-bulk', hidden: true, role: 'toolbar', 'aria-label': 'Bulk actions' });
  const el = h('div', { class: 'ui-table-wrap' }, search ? h('div', { class: 'ui-table-tools' }, h('span', { class: 'ui-table-search' }, icon('search', 16), search)) : null,
    h('div', { class: 'ui-table-scroll' }, table), bulkBar);

  const valueOf = (row, col) => (typeof col.sort === 'function' ? col.sort(row) : row[col.key]);
  const text = row => columns.map(c => { const v = row[c.key]; return v === null || v === undefined ? '' : typeof v === 'object' ? '' : String(v); }).join(' ').toLowerCase();
  const shown = () => {
    let out = query ? data.filter(r => text(r).includes(query)) : [...data];
    if (sort) {
      const col = columns.find(c => c.key === sort.key);
      if (col) out.sort((a, b) => { const x = valueOf(a, col), y = valueOf(b, col); return (x === y ? 0 : x === null || x === undefined ? 1 : y === null || y === undefined ? -1 : x < y ? -1 : 1) * sort.dir; });
    }
    return out;
  };
  function drawBulk() {
    bulkBar.hidden = chosen.size === 0;
    if (!chosen.size) return;
    const picked = data.filter(r => chosen.has(rowKey(r)));
    bulkBar.replaceChildren(h('span', { class: 'ui-bulk-count' }, `${chosen.size} selected`),
      ...bulkActions.map(a => h('button', { type: 'button', class: 'btn small', onclick: async e => {
        e.currentTarget.disabled = true;
        try { await a.run(picked); } catch (err) { toast(err.message || String(err), { error: true }); } finally { e.currentTarget.disabled = false; }
      } }, a.icon ? icon(a.icon, 16) : null, a.label)),
      h('button', { type: 'button', class: 'btn small text', onclick: () => { chosen.clear(); draw(); } }, 'Clear'));
  }
  function draw() {
    const list = shown();
    const allOn = list.length > 0 && list.every(r => chosen.has(rowKey(r)));
    head.replaceChildren(h('tr', null,
      selectable ? h('th', { class: 'ui-col-check' }, h('input', { type: 'checkbox', 'aria-label': 'Select all', checked: allOn,
        onchange: e => { for (const r of list) { if (e.target.checked) chosen.add(rowKey(r)); else chosen.delete(rowKey(r)); } draw(); } })) : null,
      columns.map(c => {
        const on = sort?.key === c.key;
        const th = h('th', { class: `ui-al-${c.align || 'left'}`, style: c.width ? { width: c.width } : null, 'aria-sort': on ? (sort.dir > 0 ? 'ascending' : 'descending') : null });
        if (c.sort) th.append(h('button', { type: 'button', class: 'ui-sort' + (on ? ' on' : ''), onclick: () => { sort = { key: c.key, dir: on ? -sort.dir : 1 }; draw(); } },
          c.label, icon(on && sort.dir < 0 ? 'arrow_downward' : 'arrow_upward', 14)));
        else th.append(c.label);
        return th;
      })));
    if (!list.length) {
      body.replaceChildren(h('tr', null, h('td', { class: 'ui-table-empty', colspan: String(columns.length + (selectable ? 1 : 0)) }, query ? 'Nothing matches that filter.' : empty)));
    } else {
      body.replaceChildren(...list.map((r, i) => {
        const key = rowKey(r);
        const tr = h('tr', { class: chosen.has(key) ? 'sel' : '', tabindex: i === 0 ? '0' : '-1', 'data-key': key,
          onclick: e => { if (onRow && !e.target.closest('input,button,a,select')) onRow(r); } },
        selectable ? h('td', { class: 'ui-col-check' }, h('input', { type: 'checkbox', 'aria-label': 'Select row', checked: chosen.has(key),
          onchange: e => { if (e.target.checked) chosen.add(key); else chosen.delete(key); tr.classList.toggle('sel', e.target.checked); drawBulk(); headCheck(); } })) : null,
        columns.map(c => h('td', { class: `ui-al-${c.align || 'left'}` }, c.render ? c.render(r) : (r[c.key] ?? '—'))));
        if (onRow) tr.classList.add('ui-clickable');
        return tr;
      }));
    }
    drawBulk();
  }
  const headCheck = () => { const box = head.querySelector('input'); if (box) { const list = shown(); box.checked = list.length > 0 && list.every(r => chosen.has(rowKey(r))); } };
  body.addEventListener('keydown', e => {
    const tr = e.target.closest('tr');
    if (!tr || e.target !== tr) return;
    const rowsEls = [...body.children];
    const i = rowsEls.indexOf(tr);
    const goTo = j => { const n = rowsEls[Math.max(0, Math.min(rowsEls.length - 1, j))]; if (n) { tr.tabIndex = -1; n.tabIndex = 0; n.focus(); } };
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); goTo(i + 1); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); goTo(i - 1); }
    else if (e.key === 'Enter' && onRow) { const r = data.find(x => String(rowKey(x)) === tr.dataset.key); if (r) onRow(r); }
    else if ((e.key === ' ' || e.key === 'x') && selectable) { e.preventDefault(); tr.querySelector('input')?.click(); }
  });
  draw();
  return {
    el,
    setRows(next) { data = next; for (const k of [...chosen]) if (!data.some(r => rowKey(r) === k)) chosen.delete(k); draw(); },
    selected: () => data.filter(r => chosen.has(rowKey(r))),
    clearSelection() { chosen.clear(); draw(); },
  };
}

// MARK: - Kanban

/**
 * kanban({columns:[{id, label, tone, collapsed}], items, columnOf(item), render(item), onMove(item, toColumn, index) → Promise,
 *   onOpen(item), sum(items) → text, itemKey}) → {el, setItems}.
 * Drag and drop, or the keyboard: Space picks a card up, arrows move it, Space drops, Esc cancels.
 * Moves are optimistic; a failed onMove puts the card back with an error toast.
 */
export function kanban({ columns, items = [], columnOf, render, onMove = null, onOpen = null, sum = null, itemKey = i => i.id, label = 'Board' }) {
  let data = [...items];
  let place = new Map(); // String(key) → {col, index}: where moves have put a card (optimistic)
  const el = h('div', { class: 'ui-kanban', role: 'region', 'aria-label': label });
  const say = h('div', { class: 'ui-sr', 'aria-live': 'assertive' });
  let held = null; // keyboard pick-up: {key, snapshot, from:{col, index}}
  let dragKey = null;
  const k = it => String(itemKey(it));
  const colOf = it => place.get(k(it))?.col ?? columnOf(it);
  const inCol = id => data.map((it, i) => [it, place.get(k(it))?.index ?? 1e6 + i]).filter(([it]) => colOf(it) === id).sort((a, b) => a[1] - b[1]).map(([it]) => it);
  const labelOf = id => columns.find(c => c.id === id)?.label ?? id;
  /** Put a card at (col, index), renumbering that column so the order is exact. */
  const setPlace = (it, col, index) => {
    inCol(col).filter(x => x !== it).forEach((x, i) => place.set(k(x), { col, index: i }));
    place.set(k(it), { col, index: index - 0.5 });
    inCol(col).forEach((x, i) => place.set(k(x), { col, index: i }));
  };
  async function commit(it, snapshot) {
    const col = colOf(it), index = inCol(col).indexOf(it);
    draw();
    if (!onMove) return;
    try { await onMove(it, col, index); } catch (err) {
      place = snapshot;
      draw();
      toast(`Couldn’t move it: ${err.message || err}`, { error: true });
    }
  }
  function draw() {
    el.replaceChildren(say, ...columns.map(c => {
      const list = inCol(c.id);
      const zone = h('div', { class: 'ui-kb-list', 'data-col': c.id });
      zone.addEventListener('dragover', e => { if (dragKey) { e.preventDefault(); zone.classList.add('ui-drop'); } });
      zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('ui-drop'); });
      zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('ui-drop');
        const it = data.find(x => k(x) === dragKey);
        if (!it) return;
        const cards = [...zone.querySelectorAll('.ui-kb-card')].filter(card => card.dataset.key !== dragKey);
        const i = cards.findIndex(card => e.clientY < card.getBoundingClientRect().top + card.offsetHeight / 2);
        const snapshot = new Map(place);
        const before = { col: colOf(it), index: inCol(colOf(it)).indexOf(it) };
        setPlace(it, c.id, i < 0 ? cards.length : i);
        if (before.col === colOf(it) && before.index === inCol(c.id).indexOf(it)) { draw(); return; }
        commit(it, snapshot);
      });
      for (const it of list) {
        const key = k(it);
        zone.append(h('div', {
          class: 'ui-kb-card' + (held?.key === key ? ' ui-held' : ''), tabindex: '0', draggable: 'true', 'data-key': key, role: 'button',
          'aria-roledescription': 'Draggable card', 'aria-describedby': 'ui-kb-help', 'aria-pressed': held?.key === key ? 'true' : null,
          ondragstart: e => { dragKey = key; e.currentTarget.classList.add('ui-dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', key); },
          ondragend: e => { dragKey = null; e.currentTarget.classList.remove('ui-dragging'); },
          ondblclick: () => onOpen?.(it),
          onkeydown: e => keyOnCard(e, it),
        }, render(it)));
      }
      if (!list.length) zone.append(h('div', { class: 'ui-kb-empty' }, 'Nothing here'));
      return h('section', { class: 'ui-kb-col' + (c.collapsed ? ' collapsed' : ''), 'aria-label': c.label },
        h('header', { class: 'ui-kb-head' },
          c.tone ? h('span', { class: `dot bg-${c.tone}`, 'aria-hidden': 'true' }) : null,
          h('span', { class: 'ui-kb-label' }, c.label), h('span', { class: 'ui-count' }, String(list.length)),
          sum ? h('span', { class: 'ui-kb-sum' }, sum(list)) : null),
        zone);
    }));
    if (!document.getElementById('ui-kb-help')) document.body.append(h('div', { id: 'ui-kb-help', class: 'ui-sr' }, 'Press Space to pick up, arrow keys to move, Space to drop, Escape to cancel. Enter opens the card.'));
    if (held) el.querySelector(`[data-key="${CSS.escape(held.key)}"]`)?.focus();
  }
  function keyOnCard(e, it) {
    const key = k(it);
    if (e.key === 'Enter' && !held) { onOpen?.(it); return; }
    if (e.key === ' ') {
      e.preventDefault();
      if (!held) {
        held = { key, snapshot: new Map(place), from: { col: colOf(it), index: inCol(colOf(it)).indexOf(it) } };
        say.textContent = `Picked up, in ${labelOf(colOf(it))}. Use the arrow keys, then Space to drop.`;
        draw();
        return;
      }
      if (held.key !== key) return;
      const { snapshot, from } = held;
      held = null;
      say.textContent = `Dropped in ${labelOf(colOf(it))}.`;
      if (from.col === colOf(it) && from.index === inCol(colOf(it)).indexOf(it)) { draw(); return; }
      commit(it, snapshot);
      return;
    }
    if (!held || held.key !== key) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      place = held.snapshot;
      held = null;
      say.textContent = 'Move cancelled.';
      draw();
      el.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus();
      return;
    }
    const ci = columns.findIndex(c => c.id === colOf(it));
    const idx = inCol(colOf(it)).indexOf(it);
    const size = inCol(colOf(it)).length;
    let target = null;
    if (e.key === 'ArrowRight' && ci < columns.length - 1) target = [columns[ci + 1].id, inCol(columns[ci + 1].id).length];
    else if (e.key === 'ArrowLeft' && ci > 0) target = [columns[ci - 1].id, inCol(columns[ci - 1].id).length];
    else if (e.key === 'ArrowUp' && idx > 0) target = [colOf(it), idx - 1];
    else if (e.key === 'ArrowDown' && idx < size - 1) target = [colOf(it), idx + 1];
    if (!target) return;
    e.preventDefault();
    setPlace(it, target[0], target[1]);
    say.textContent = `${labelOf(colOf(it))}, position ${inCol(colOf(it)).indexOf(it) + 1}.`;
    draw();
  }
  draw();
  return { el, setItems(next) { data = [...next]; place = new Map(); held = null; draw(); } };
}

// MARK: - Timeline

const dayHeading = day => (day === todayLondon() ? 'Today' : fmtDay(day));
/** timeline([{at, icon, tone, title, detail, path}], {groupByDay=true}): a vertical rail with day headers. */
export function timeline(items, { groupByDay = true } = {}) {
  const out = h('ol', { class: 'ui-timeline' });
  let last = null;
  for (const it of items) {
    const day = it.at ? londonParts(it.at).day : null;
    if (groupByDay && day && day !== last) { out.append(h('li', { class: 'ui-tl-day' }, dayHeading(day))); last = day; }
    const inner = [
      h('span', { class: `ui-tl-dot${it.tone ? ` tone-${it.tone}` : ''}` }, icon(it.icon || 'timeline', 16)),
      h('div', { class: 'ui-tl-text' },
        h('div', { class: 'ui-tl-title' }, it.title, it.at ? h('time', { class: 'ui-tl-time', datetime: it.at }, fmtTime(it.at)) : null),
        it.detail ? h('div', { class: 'ui-tl-detail' }, it.detail) : null),
    ];
    out.append(h('li', { class: 'ui-tl-item' }, it.path ? link(it.path, { class: 'ui-tl-link' }, inner) : inner));
  }
  if (!items.length) out.append(h('li', { class: 'ui-tl-empty' }, 'Nothing yet.'));
  return out;
}

// MARK: - Wizard

/**
 * wizard([{id, label, render(box, data), valid(data)}], {onFinish(data), finishLabel, data}) → {el, data, refresh()}.
 * Not an element: append `.el` (refresh() re-checks the current step's valid()).
 * A stepper with Back and Next; Next stays disabled until the step is valid.
 */
export function wizard(steps, { onFinish, finishLabel = 'Finish', data = {} } = {}) {
  let at = 0;
  const rail = h('ol', { class: 'ui-wiz-steps' });
  const box = h('div', { class: 'ui-wiz-body' });
  const status = h('div', { class: 'ui-wiz-status', role: 'status' });
  const back = h('button', { type: 'button', class: 'btn', onclick: () => { if (at > 0) { at--; draw(); } } }, 'Back');
  const next = h('button', { type: 'button', class: 'btn primary', onclick: async () => {
    if (!isValid()) return;
    if (at < steps.length - 1) { at++; draw(); return; }
    next.disabled = true;
    try { await onFinish?.(data); } catch (err) { status.replaceChildren(h('p', { class: 'error' }, err.message || String(err))); } finally { next.disabled = !isValid(); }
  } });
  const isValid = () => { try { return steps[at].valid ? !!steps[at].valid(data) : true; } catch { return false; } };
  const check = () => { next.disabled = !isValid(); };
  box.addEventListener('input', check);
  box.addEventListener('change', check);
  box.addEventListener('ui-change', check);
  function draw() {
    rail.replaceChildren(...steps.map((s, i) => h('li', { class: i === at ? 'now' : i < at ? 'done' : '', 'aria-current': i === at ? 'step' : null },
      h('span', { class: 'ui-wiz-n' }, i < at ? icon('check', 14) : String(i + 1)), h('span', null, s.label))));
    box.replaceChildren();
    status.replaceChildren();
    steps[at].render(box, data);
    back.hidden = at === 0;
    next.textContent = at === steps.length - 1 ? finishLabel : 'Next';
    check();
  }
  const el = h('div', { class: 'ui-wizard' }, rail, box, status, h('div', { class: 'ui-wiz-foot' }, back, next));
  draw();
  return { el, data, refresh: check };
}

// MARK: - Rule builder (Rules JSON, 3.4)

const OPS = {
  number: [['eq', '='], ['ne', '≠'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['between', 'between'], ['isSet', 'is set'], ['isNotSet', 'is not set']],
  bool: [['eq', 'is']],
  enum: [['eq', 'is'], ['ne', 'is not'], ['in', 'is any of'], ['notIn', 'is none of']],
  tags: [['has', 'has'], ['hasNot', 'does not have']],
  day: [['eq', 'on'], ['lt', 'before'], ['gt', 'after'], ['between', 'between'], ['isSet', 'is set'], ['isNotSet', 'is not set']],
};
OPS.money = OPS.number;
OPS.days = OPS.number;
const opsFor = type => OPS[type] || OPS.number;

/**
 * ruleBuilder({facts:[{id, label, type, options}], value, onChange, count: rules → Promise<number>})
 * → {el, value()}, not an element: append `.el`. One level of nested any/all groups, at most 20 rules.
 */
export function ruleBuilder({ facts = [], value = null, onChange = null, count = null, tags = [] }) {
  let rules = value && value.rules ? structuredClone(value) : { match: 'all', rules: [] };
  const el = h('div', { class: 'ui-rules' });
  const countEl = h('span', { class: 'ui-rules-count', 'aria-live': 'polite' });
  let countTimer = null;
  const total = r => r.rules.reduce((n, x) => n + (x.rules ? x.rules.length : 1), 0);
  const changed = () => {
    onChange?.(structuredClone(rules));
    el.dispatchEvent(new CustomEvent('ui-change', { bubbles: true }));
    if (count) {
      clearTimeout(countTimer);
      countTimer = setTimeout(async () => {
        try { const n = await count(structuredClone(rules)); countEl.textContent = `${n} match${n === 1 ? '' : 'es'}`; } catch { countEl.textContent = ''; }
      }, 250);
    }
  };
  const factOf = id => facts.find(f => f.id === id);
  const valueControl = (rule, rerender) => {
    const f = factOf(rule.fact);
    const type = f?.type || 'number';
    if (rule.op === 'isSet' || rule.op === 'isNotSet') return null;
    const set = v => { rule.value = v; changed(); };
    if (type === 'bool') {
      return h('select', { 'aria-label': 'Value', onchange: e => set(e.target.value === 'true') }, h('option', { value: 'true', selected: rule.value !== false }, 'yes'), h('option', { value: 'false', selected: rule.value === false }, 'no'));
    }
    if (type === 'enum' || type === 'tags') {
      const opts = type === 'tags' ? tags.map(t => ({ value: t.id, label: t.name })) : (f?.options || []);
      if (rule.op === 'in' || rule.op === 'notIn') {
        const cur = new Set(Array.isArray(rule.value) ? rule.value : []);
        return h('div', { class: 'ui-rule-multi', role: 'group', 'aria-label': 'Values' }, opts.map(o => h('label', { class: 'ui-check-chip' + (cur.has(o.value) ? ' on' : '') },
          h('input', { type: 'checkbox', checked: cur.has(o.value), onchange: e => { if (e.target.checked) cur.add(o.value); else cur.delete(o.value); set([...cur]); rerender(); } }), o.label)));
      }
      return h('select', { 'aria-label': 'Value', onchange: e => set(e.target.value) }, opts.map(o => h('option', { value: o.value, selected: rule.value === o.value }, o.label)));
    }
    const input = (v, onv) => h('input', { type: type === 'day' ? 'date' : 'number', value: v ?? '', class: 'ui-rule-num', 'aria-label': 'Value',
      oninput: e => onv(type === 'day' ? e.target.value : e.target.value === '' ? null : Number(type === 'money' ? Math.round(Number(e.target.value) * 100) : e.target.value)) });
    if (rule.op === 'between') {
      const pair = Array.isArray(rule.value) ? [...rule.value] : [null, null];
      return h('span', { class: 'ui-rule-between' }, input(type === 'money' && pair[0] !== null ? pair[0] / 100 : pair[0], v => { pair[0] = v; set([...pair]); }), 'and',
        input(type === 'money' && pair[1] !== null ? pair[1] / 100 : pair[1], v => { pair[1] = v; set([...pair]); }));
    }
    return input(type === 'money' && typeof rule.value === 'number' ? rule.value / 100 : rule.value, set);
  };
  const ruleRow = (rule, parent, rerender) => {
    const f = factOf(rule.fact);
    const ops = opsFor(f?.type);
    return h('div', { class: 'ui-rule' },
      h('select', { 'aria-label': 'Fact', onchange: e => { rule.fact = e.target.value; rule.op = opsFor(factOf(rule.fact)?.type)[0][0]; rule.value = null; changed(); rerender(); } },
        facts.map(x => h('option', { value: x.id, selected: x.id === rule.fact }, x.label))),
      h('select', { 'aria-label': 'Operator', onchange: e => { rule.op = e.target.value; if (rule.op === 'between' || rule.op === 'in' || rule.op === 'notIn') rule.value = []; changed(); rerender(); } },
        ops.map(([v, l]) => h('option', { value: v, selected: v === rule.op }, l))),
      valueControl(rule, rerender),
      h('button', { type: 'button', class: 'ui-icon-btn small', 'aria-label': 'Remove rule', onclick: () => { parent.rules.splice(parent.rules.indexOf(rule), 1); changed(); rerender(); } }, icon('close', 16)));
  };
  const group = (g, depth, rerender) => {
    const adder = (label, make) => h('button', { type: 'button', class: 'btn small text', disabled: total(rules) >= 20, onclick: () => { g.rules.push(make()); changed(); rerender(); } }, icon('add', 16), label);
    const newRule = () => ({ fact: facts[0]?.id, op: opsFor(facts[0]?.type)[0][0], value: null });
    return h('div', { class: 'ui-rule-group' + (depth ? ' nested' : '') },
      h('div', { class: 'ui-rule-match' }, 'Match',
        h('select', { 'aria-label': 'Match', onchange: e => { g.match = e.target.value; changed(); } }, h('option', { value: 'all', selected: g.match === 'all' }, 'all'), h('option', { value: 'any', selected: g.match === 'any' }, 'any')),
        'of these',
        depth ? h('button', { type: 'button', class: 'ui-icon-btn small', 'aria-label': 'Remove group', onclick: () => { rules.rules.splice(rules.rules.indexOf(g), 1); changed(); rerender(); } }, icon('close', 16)) : null),
      g.rules.map(r => (r.rules ? group(r, depth + 1, rerender) : ruleRow(r, g, rerender))),
      h('div', { class: 'ui-rule-add' }, facts.length ? adder('Rule', newRule) : h('span', { class: 'faint small' }, 'No facts available'),
        depth === 0 && facts.length ? adder('Group', () => ({ match: 'any', rules: [newRule()] })) : null));
  };
  const draw = () => { fill(el, group(rules, 0, draw), count ? countEl : null); };
  draw();
  if (count) changed();
  return { el, value: () => structuredClone(rules) };
}

// MARK: - Tags

const TAG_TONES = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'];
/** tagChip(tag, {onRemove}): a tag in its chart colour (tag.color ∈ chart-1..6). */
export function tagChip(tag, { onRemove = null } = {}) {
  const tone = TAG_TONES.includes(tag.color) ? tag.color : 'chart-1';
  return h('span', { class: `ui-tag ui-${tone}` }, h('span', { class: 'ui-tag-dot', 'aria-hidden': 'true' }), tag.name,
    onRemove ? h('button', { type: 'button', class: 'ui-tag-x', 'aria-label': `Remove ${tag.name}`, onclick: () => onRemove(tag) }, icon('close', 14)) : null);
}

/**
 * tagPicker({selected:[id], all:[tag], onChange(ids), allowCreate}): chips plus an
 * Add button with a searchable list. With allowCreate a new name is created
 * through POST /api/tags (or `allowCreate(name)` → tag when it is a function).
 */
export function tagPicker({ selected = [], all = [], onChange = null, allowCreate = false }) {
  let ids = [...selected];
  let tags = [...all];
  const el = h('div', { class: 'ui-tagpicker' });
  const commit = () => { draw(); onChange?.([...ids]); };
  const addBtn = h('button', { type: 'button', class: 'ui-tag ui-tag-add', 'aria-haspopup': 'listbox', onclick: () => open() }, icon('add', 14), 'Tag');
  function open() {
    popover(addBtn, (box, close) => {
      const input = h('input', { type: 'search', placeholder: allowCreate ? 'Find or create a tag' : 'Find a tag', 'aria-label': 'Tag name' });
      const listEl = h('div', { class: 'ui-tag-list', role: 'listbox' });
      const drawList = () => {
        const q = input.value.trim().toLowerCase();
        const matches = tags.filter(t => !ids.includes(t.id) && t.name.toLowerCase().includes(q));
        fill(listEl, matches.map(t => h('button', { type: 'button', role: 'option', class: 'ui-tag-opt', onclick: () => { ids.push(t.id); commit(); close(); } }, tagChip(t))),
          allowCreate && q && !tags.some(t => t.name.toLowerCase() === q) ? h('button', { type: 'button', role: 'option', class: 'ui-tag-opt', onclick: async () => {
            try {
              const made = typeof allowCreate === 'function' ? await allowCreate(input.value.trim()) : (await api('POST', '/api/tags', { name: input.value.trim() })).tag;
              tags.push(made); ids.push(made.id); commit(); close();
            } catch (err) { toast(err.message || String(err), { error: true }); }
          } }, icon('add', 16), `Create “${input.value.trim()}”`) : null,
          !matches.length && !(allowCreate && q) ? h('div', { class: 'faint small pad-s' }, 'No tags') : null);
      };
      input.addEventListener('input', drawList);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); listEl.querySelector('button')?.click(); } });
      box.append(input, listEl);
      drawList();
      requestAnimationFrame(() => input.focus());
    }, { className: 'ui-tag-pop', label: 'Add a tag' });
  }
  function draw() {
    el.replaceChildren(...ids.map(id => tags.find(t => t.id === id)).filter(Boolean).map(t => tagChip(t, { onRemove: () => { ids = ids.filter(x => x !== t.id); commit(); } })), addBtn);
  }
  draw();
  return el;
}

// MARK: - People, scores and numbers

/** avatarStack([{name, initials}], {max=4}): overlapping avatars with +N. */
export function avatarStack(people, { max = 4, size = 28 } = {}) {
  const shown = people.slice(0, max);
  return h('span', { class: 'ui-avatars', role: 'img', 'aria-label': people.map(p => p.name).join(', ') },
    shown.map(p => avatar(p.initials || p.name, size)),
    people.length > max ? h('span', { class: 'avatar ui-more', style: { width: `${size}px`, height: `${size}px` } }, `+${people.length - max}`) : null);
}

const BANDS = [[70, 'ok', 'Healthy'], [45, 'attention', 'Watch'], [0, 'urgent', 'At risk']];
/**
 * scoreRing(score 0–100, {size=56, label, band}): a ring in the band colour, the
 * number in the centre and the band word beneath. `band` is {word, tone} (tone:
 * ok | attention | urgent | data); without it the bands are 70+ / 45+ / below.
 */
export function scoreRing(score, { size = 56, label = 'Health', band = null } = {}) {
  const v = score === null || score === undefined ? null : Math.max(0, Math.min(100, Math.round(score)));
  const [, tone, word] = band ? [0, band.tone, band.word] : v === null ? [0, 'data', 'No score'] : BANDS.find(([min]) => v >= min);
  const stroke = Math.max(3, Math.round(size / 14));
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const svg = svgNode('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, 'aria-hidden': 'true' },
    svgNode('circle', { class: 'ui-ring-track', cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke }),
    svgNode('circle', { class: 'ui-ring-arc', cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke, 'stroke-linecap': 'round',
      'stroke-dasharray': `${(c * (v ?? 0) / 100).toFixed(2)} ${c.toFixed(2)}`, transform: `rotate(-90 ${size / 2} ${size / 2})` }));
  return h('span', { class: `ui-score tone-${tone}`, role: 'img', 'aria-label': `${label}: ${v ?? 'none'}${v === null ? '' : ' of 100'}, ${word}` },
    h('span', { class: 'ui-score-ring', style: { width: `${size}px`, height: `${size}px` } }, svg, h('span', { class: 'ui-score-n', style: { fontSize: `${Math.round(size * 0.32)}px` } }, v === null ? '–' : String(v))),
    h('span', { class: 'ui-score-word' }, word));
}

const SVGNS = 'http://www.w3.org/2000/svg';
function svgNode(tag, attrs, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  el.append(...children.filter(Boolean));
  return el;
}

/** countUp(el, to, {format, dur=600}): animates a number on first paint (instant under reduced motion). */
export function countUp(el, to, { format = n => Math.round(n).toLocaleString('en-GB'), dur = 600, from = 0 } = {}) {
  if (reduced() || !Number.isFinite(to)) { el.textContent = format(to); return; }
  const start = performance.now();
  const step = now => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - (1 - p) ** 3;
    el.textContent = format(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** moneyInput({value pence, onChange(pence), label}): a £ input that stores integer pence. */
export function moneyInput({ value = null, onChange = null, label = 'Amount', min = 0 } = {}) {
  const input = h('input', { type: 'text', inputmode: 'decimal', 'aria-label': label, autocomplete: 'off', value: value === null || value === undefined ? '' : (value / 100).toFixed(2), placeholder: '0.00' });
  const read = () => {
    const raw = input.value.replace(/[£,\s]/g, '');
    if (raw === '') return null;
    if (!/^\d+(\.\d{0,2})?$/.test(raw)) return NaN;
    return Math.round(Number(raw) * 100);
  };
  input.addEventListener('input', () => { const p = read(); input.setAttribute('aria-invalid', String(Number.isNaN(p) || (p !== null && p < min))); if (!Number.isNaN(p)) onChange?.(p); });
  input.addEventListener('blur', () => { const p = read(); if (p !== null && !Number.isNaN(p)) input.value = (p / 100).toFixed(2); });
  const el = h('span', { class: 'ui-money' }, h('span', { class: 'ui-money-sign', 'aria-hidden': 'true' }, '£'), input);
  el.input = input;
  el.pence = read;
  return el;
}

/** dateField({value 'YYYY-MM-DD', onChange, min, max, label}): a native date input (London days). */
export const dateField = ({ value = '', onChange = null, min = null, max = null, label = 'Date' } = {}) =>
  h('input', { type: 'date', class: 'ui-date', value, min, max, 'aria-label': label, onchange: e => onChange?.(e.target.value) });
/** timeField({value 'HH:MM', onChange, step=300, label}). */
export const timeField = ({ value = '', onChange = null, step = 300, label = 'Time' } = {}) =>
  h('input', { type: 'time', class: 'ui-time', value, step: String(step), 'aria-label': label, onchange: e => onChange?.(e.target.value) });
/** dateRange({from, to, onChange({from, to})}): two days; `to` never before `from`. */
export function dateRange({ from = '', to = '', onChange = null } = {}) {
  const a = dateField({ value: from, label: 'From', onChange: v => { from = v; b.min = v; if (to && v && to < v) { to = v; b.value = v; } onChange?.({ from, to }); } });
  const b = dateField({ value: to, min: from || null, label: 'To', onChange: v => { to = v; onChange?.({ from, to }); } });
  return h('span', { class: 'ui-range' }, a, h('span', { class: 'faint' }, '–'), b);
}

/** kbd('⌘K') or kbd('g i'): key caps. */
export function kbd(keys) {
  const parts = String(keys).trim().split(/\s+/);
  const caps = k => [...(k.length > 1 && /^[⌘⇧⌥⌃]+./.test(k) ? [...k.match(/^[⌘⇧⌥⌃]+/)[0], k.replace(/^[⌘⇧⌥⌃]+/, '')] : [k])];
  return h('span', { class: 'ui-kbd-group' }, parts.map((p, i) => [i ? h('span', { class: 'ui-kbd-then' }, 'then') : null, caps(p).map(c => h('kbd', { class: 'ui-kbd' }, c))]));
}

/** emptyHero({icon, title, line, action:{label, path|onclick}}): a large empty state with the serif title. */
export function emptyHero({ icon: glyph = null, title, line = null, action = null }) {
  return h('div', { class: 'ui-empty' },
    glyph ? h('span', { class: 'ui-empty-icon' }, icon(glyph, 28)) : h('span', { class: 'brand-rule', 'aria-hidden': 'true' }),
    h('h2', { class: 'ui-empty-title' }, title),
    line ? h('p', { class: 'ui-empty-line' }, line) : null,
    action ? (action.path ? link(action.path, { class: 'btn' }, action.label) : h('button', { type: 'button', class: 'btn', onclick: action.onclick }, action.label)) : null);
}

/** inlineEdit(value, onSave(next) → Promise, {multiline, placeholder}): click to edit, Enter saves, Esc cancels. */
export function inlineEdit(value, onSave, { multiline = false, placeholder = 'Add…', label = 'Edit' } = {}) {
  const el = h('span', { class: 'ui-inline' });
  const show = () => el.replaceChildren(h('button', { type: 'button', class: 'ui-inline-view' + (value ? '' : ' empty'), 'aria-label': `${label}: ${value || 'empty'}`, onclick: edit },
    value || placeholder, icon('edit', 14)));
  function edit() {
    const input = h(multiline ? 'textarea' : 'input', { class: 'ui-inline-input', value: value ?? '', placeholder, 'aria-label': label, rows: multiline ? '3' : null });
    let done = false;
    const save = async () => {
      if (done) return;
      done = true;
      const next = input.value.trim();
      if (next === (value ?? '')) { show(); return; }
      input.disabled = true;
      try { await onSave(next); value = next; show(); } catch (err) { toast(err.message || String(err), { error: true }); done = false; input.disabled = false; input.focus(); }
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done = true; show(); el.querySelector('button')?.focus(); }
      else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
    });
    input.addEventListener('blur', save);
    el.replaceChildren(input);
    input.focus();
    input.select?.();
  }
  show();
  return el;
}

/** progressBar(pct, {tone, label}): a thin bar; the label is announced and shown. */
export function progressBar(pct, { tone = 'accent', label = null } = {}) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  return h('div', { class: 'ui-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(v)), 'aria-label': label || 'Progress' },
    label ? h('div', { class: 'ui-progress-label' }, h('span', null, label), h('span', { class: 't-num' }, `${Math.round(v)}%`)) : null,
    h('div', { class: 'ui-progress-track' }, h('div', { class: `ui-progress-fill bg-${tone}`, style: { '--pct': `${v}%` } })));
}

/**
 * splitView({key, panes:[left, right], initial=340, min=240, max=560}) → element.
 * A draggable (and arrow-key) divider; the width is saved in prefs desk.split.<key>.
 * Below 1100 px the panes stack and the caller shows one at a time.
 */
export function splitView({ key, panes, initial = 340, min = 240, max = 560 }) {
  const pref = `desk.split.${key}`;
  let width = Number(prefs.peek(pref, initial)) || initial;
  const el = h('div', { class: 'ui-split' });
  const apply = () => el.style.setProperty('--split', `${width}px`);
  const save = () => prefs.set(pref, width).catch(() => {});
  const divider = h('div', { class: 'ui-split-bar', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-label': 'Resize panes', 'aria-valuemin': String(min), 'aria-valuemax': String(max), 'aria-valuenow': String(width) });
  divider.addEventListener('pointerdown', e => {
    e.preventDefault();
    const startX = e.clientX, startW = width;
    divider.setPointerCapture(e.pointerId);
    const onMove = ev => { width = Math.max(min, Math.min(max, startW + ev.clientX - startX)); apply(); };
    const onUp = () => { divider.removeEventListener('pointermove', onMove); divider.removeEventListener('pointerup', onUp); divider.setAttribute('aria-valuenow', String(width)); save(); };
    divider.addEventListener('pointermove', onMove);
    divider.addEventListener('pointerup', onUp);
  });
  divider.addEventListener('keydown', e => {
    const d = { ArrowLeft: -16, ArrowRight: 16 }[e.key];
    if (!d) return;
    e.preventDefault();
    width = Math.max(min, Math.min(max, width + d));
    apply();
    divider.setAttribute('aria-valuenow', String(width));
    save();
  });
  el.append(h('div', { class: 'ui-split-a' }, panes[0]), divider, h('div', { class: 'ui-split-b' }, panes[1]));
  apply();
  prefs.get(pref, initial).then(v => { if (Number(v)) { width = Number(v); apply(); } }).catch(() => {});
  return el;
}

/** flash(el): the live-update highlight (an accent wash for 1.2 s). */
export function flash(el) {
  if (!el) return;
  el.classList.remove('ui-flash');
  void el.offsetWidth;
  el.classList.add('ui-flash');
  setTimeout(() => el.classList.remove('ui-flash'), 1300);
}

// MARK: - Client quick view (the default `client` panel; WP2 may register a richer one)

/** A client's card in a slide-over: who, plan, and the ways to act on them. */
export function clientQuickView(c, body, close) {
  body.append(
    h('div', { class: 'ui-qv-head' }, avatar(c.initials || c.name, 56),
      h('div', null, h('div', { class: 'ui-qv-name' }, c.name), h('div', { class: 'small muted' }, [c.email, c.plan ? `${c.plan[0].toUpperCase()}${c.plan.slice(1)} plan` : null].filter(Boolean).join(' · ')))),
    h('div', { class: 'ui-qv-actions' },
      link(`/clients/${encodeURIComponent(c.id)}`, { class: 'btn primary', onclick: () => close() }, 'Open client'),
      link(`/messages/${encodeURIComponent(c.id)}`, { class: 'btn', onclick: () => close() }, icon('chat_bubble', 16), `Message ${firstName(c.name)}`),
      registered.clientActions().map(a => h('button', { type: 'button', class: 'btn', onclick: () => { close(); a.run(c); } }, a.icon ? icon(a.icon, 16) : null, a.label))));
  if (c.reason || c.demand?.text) body.append(h('p', { class: 'small muted' }, c.reason || c.demand.text));
}

