/*
 * The command palette and the keyboard (docs/design/desk-v2.md 1.3, F2).
 *
 * ⌘K / Ctrl K / `/` opens a floating panel: Jump to (every nav item and its
 * tabs), Clients (a local match on the client list), Actions (registerCommand,
 * plus registerClientAction for the best-matching client) and Results (the
 * server's /api/search, 150 ms after typing stops). Arrows move, Enter runs,
 * ⌘Enter opens a client or result in a slide-over, Esc closes. The last five
 * picks come first next time.
 *
 * WP1 replaces the client scorer (setClientScorer) and draws result rows
 * (registerSearchRenderer in core.js); everything else is here.
 */
import {
  api, avatar, capabilities, clients, fill, go, h, icon, planName, registered, sheet, state,
} from './core.js';
import { kbd, openPanel, pushLayer, trapFocus } from './ui.js';

const RECENT_KEY = 'jk.desk.palette.recent';
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
const remember = item => {
  const next = [item, ...readRecent().filter(r => r.key !== item.key)].slice(0, 5);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage off */ }
};

/** A subsequence match with a word-start bonus: 0 (no match) … ~2. */
export function fuzzyScore(text, q) {
  const t = String(text || '').toLowerCase(), s = q.toLowerCase().trim();
  if (!s) return 1;
  if (t.startsWith(s)) return 2;
  if (t.split(/\s+/).some(w => w.startsWith(s))) return 1.7;
  if (t.includes(s)) return 1.3;
  let i = 0, starts = 0;
  for (let j = 0; j < t.length && i < s.length; j++) {
    if (t[j] === s[i]) { if (j === 0 || t[j - 1] === ' ') starts++; i++; }
  }
  return i === s.length ? 0.5 + starts * 0.1 : 0;
}
let clientScorer = (c, q) => fuzzyScore(c.name, q);
/** WP1: replace the local client scorer, (client, query) → score (0 = no match). */
export const setClientScorer = fn => { clientScorer = fn; };

const GO_KEYS = { t: 'today', i: 'inbox', c: 'clients', p: 'pipeline', m: 'messages', s: 'schedule', d: 'diary', b: 'billing', a: 'automations', k: 'tasks' };
const navPath = n => n.path || `/${n.id}`;

let openNow = null;

/** Open the palette (optionally with text already typed). */
export function openPalette(initial = '') {
  if (openNow) { openNow.input.focus(); return; }
  const input = h('input', { class: 'pal-input', type: 'text', value: initial, placeholder: 'Search or jump to…', 'aria-label': 'Search or jump to', autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-list', 'aria-autocomplete': 'list' });
  const list = h('div', { id: 'pal-list', class: 'pal-list', role: 'listbox', 'aria-label': 'Results' });
  const foot = h('div', { class: 'pal-foot' },
    h('span', null, kbd('↑'), kbd('↓'), ' move'), h('span', null, kbd('↵'), ' open'), h('span', null, kbd('⌘↵'), ' preview'), h('span', null, kbd('esc'), ' close'));
  const panel = h('div', { class: 'pal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' },
    h('div', { class: 'pal-search' }, icon('search', 20), input, kbd('esc')), list, foot);
  const host = h('div', { class: 'pal-host' }, h('div', { class: 'pal-scrim', onclick: () => close() }), panel);
  const opener = document.activeElement;
  const untrap = trapFocus(panel);
  const unlayer = pushLayer(() => close());
  let rows = []; // [{key, label, run(preview)}]
  let at = 0;
  let results = [];
  let searchTimer = null;
  let asked = '';
  const caps = capabilities();

  function close() {
    if (!openNow) return;
    openNow = null;
    clearTimeout(searchTimer);
    untrap(); unlayer();
    host.classList.add('out');
    setTimeout(() => host.remove(), 140);
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }
  const run = (row, preview = false) => {
    remember({ key: row.key, label: row.label, detail: row.detail || '', icon: row.icon, path: row.path || null, panel: row.panel || null });
    close();
    row.run(preview);
  };

  function rowEl(row, i) {
    const custom = row.render ? row.render() : null;
    return h('div', {
      id: `pal-${i}`, role: 'option', class: 'pal-row' + (i === at ? ' sel' : ''), 'aria-selected': String(i === at),
      onpointermove: () => { if (at !== i) { at = i; mark(); } },
      onclick: e => run(row, e.metaKey || e.ctrlKey),
    }, custom || [
      row.avatar ? avatar(row.avatar, 26) : h('span', { class: 'pal-icon' }, icon(row.icon || 'chevron_right', 18)),
      h('span', { class: 'pal-label' }, row.label, row.detail ? h('span', { class: 'pal-detail' }, row.detail) : null),
      row.keys ? kbd(row.keys) : null,
    ]);
  }
  function mark() {
    list.querySelectorAll('.pal-row').forEach((el, i) => { el.classList.toggle('sel', i === at); el.setAttribute('aria-selected', String(i === at)); });
    input.setAttribute('aria-activedescendant', `pal-${at}`);
    list.querySelector('.pal-row.sel')?.scrollIntoView({ block: 'nearest' });
  }

  function draw() {
    const q = input.value.trim();
    const groups = [];
    const navs = registered.nav();
    if (!q) {
      const recent = readRecent();
      // Commands cannot be stored, so a recent one is found again by its key.
      const again = r => {
        if (r.key.startsWith('cmd:')) return registered.commands().find(c => `cmd:${c.id}` === r.key)?.run;
        if (r.key.startsWith('ca:')) {
          const [, actionId, clientId] = r.key.split(':');
          const a = registered.clientActions().find(x => x.id === actionId), c = state.clients?.find(x => x.id === clientId);
          return a && c ? () => a.run(c) : null;
        }
        return null;
      };
      const usable = recent.map(r => ({ ...r, cmd: again(r) })).filter(r => r.cmd || r.path || r.panel);
      if (usable.length) groups.push(['Recent', usable.map(r => ({ ...r, run: preview => (r.cmd ? r.cmd() : preview && r.panel ? openPanel(...r.panel) : r.path ? go(r.path) : null) }))]);
    }
    const jump = navs.flatMap(n => [{ key: `nav:${n.id}`, label: n.label, icon: n.icon, path: navPath(n), keys: Object.entries(GO_KEYS).find(([, id]) => id === n.id)?.[0] ? `g ${Object.entries(GO_KEYS).find(([, id]) => id === n.id)[0]}` : null, score: fuzzyScore(n.label, q) },
      ...(n.tabs || []).map(t => ({ key: `nav:${n.id}:${t.id}`, label: `${n.label} › ${t.label}`, icon: n.icon, path: t.path, score: fuzzyScore(`${n.label} ${t.label}`, q) * 0.9 }))])
      .filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, q ? 6 : 12)
      .map(r => ({ ...r, run: () => go(r.path) }));
    if (jump.length) groups.push(['Jump to', jump]);
    let topClient = null;
    if (q && state.clients) {
      const matched = state.clients.map(c => ({ c, score: clientScorer(c, q) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
      topClient = matched[0]?.c ?? null;
      if (matched.length) groups.push(['Clients', matched.map(({ c }) => ({
        key: `client:${c.id}`, label: c.name, detail: [planName(c.plan), c.demand?.text].filter(Boolean).join(' · '), avatar: c.initials || c.name,
        path: `/clients/${encodeURIComponent(c.id)}`, panel: ['client', c.id],
        run: preview => (preview ? openPanel('client', c.id) : go(`/clients/${encodeURIComponent(c.id)}`)),
      }))]);
    }
    const actions = registered.commands().filter(c => { try { return !c.when || c.when(); } catch { return false; } })
      .map(c => ({ key: `cmd:${c.id}`, label: c.label, icon: c.icon || 'bolt', keys: c.keys, group: c.group || 'Actions', score: fuzzyScore(c.label, q), run: () => c.run() }))
      .filter(r => r.score > 0);
    if (topClient) {
      for (const a of registered.clientActions()) {
        const label = `${a.label} · ${topClient.name}`;
        actions.push({ key: `ca:${a.id}:${topClient.id}`, label, icon: a.icon || 'bolt', group: 'Actions', score: 1, run: () => a.run(topClient) });
      }
    }
    const byGroup = new Map();
    for (const a of actions.sort((x, y) => y.score - x.score)) { if (!byGroup.has(a.group)) byGroup.set(a.group, []); byGroup.get(a.group).push(a); }
    for (const [g, items] of byGroup) groups.push([g, items.slice(0, q ? 6 : 8)]);
    if (q.length >= 2 && results.length) groups.push(['Results', results.map(r => ({
      key: `res:${r.type}:${r.id}`, label: r.title, detail: r.detail, icon: r.icon || 'search', path: r.path, panel: [r.type, r.id],
      render: registered.searchRenderer(r.type) ? () => registered.searchRenderer(r.type)(r) : null,
      run: preview => (preview && openPanel(r.type, r.id) ? null : r.path ? go(r.path) : null),
    }))]);
    rows = groups.flatMap(([, items]) => items);
    at = Math.min(at, Math.max(0, rows.length - 1));
    let i = 0;
    fill(list, groups.map(([title, items]) => h('div', { class: 'pal-group', role: 'group', 'aria-label': title },
      h('div', { class: 'pal-group-title', 'aria-hidden': 'true' }, title), items.map(r => rowEl(r, i++)))),
    rows.length ? null : h('div', { class: 'pal-empty' }, q ? `Nothing for “${q}”` : 'Type to search'));
    mark();
  }

  function search() {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { results = []; return; }
    searchTimer = setTimeout(async () => {
      if ((await caps).absent) return;
      asked = q;
      try {
        const out = await api('GET', `/api/search?q=${encodeURIComponent(q)}&limit=12`);
        if (asked !== input.value.trim() || !openNow) return;
        results = out.results || [];
        draw();
      } catch { /* the local groups still work */ }
    }, 150);
  }

  input.addEventListener('input', () => { at = 0; draw(); search(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); at = (at + 1) % Math.max(1, rows.length); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); at = (at - 1 + rows.length) % Math.max(1, rows.length); mark(); }
    else if (e.key === 'Enter' && rows[at]) { e.preventDefault(); run(rows[at], e.metaKey || e.ctrlKey); }
  });
  openNow = { input, close };
  document.body.append(host);
  requestAnimationFrame(() => host.classList.add('in'));
  input.focus();
  draw();
  if (initial) search();
  if (!state.clients) clients().then(() => { if (openNow) draw(); }).catch(() => {});
}

/** The `?` overlay: every shortcut, grouped. */
export function showShortcuts() {
  const groups = [
    ['Anywhere', [['⌘K', 'Search or jump to'], ['/', 'Search'], ['n', 'New…'], ['⌘\\', 'Collapse the sidebar'], ['⌘.', 'Switch theme'], ['?', 'This list'], ['esc', 'Close the top layer']]],
    ['Go to', Object.entries(GO_KEYS).filter(([, id]) => registered.nav().some(n => n.id === id)).map(([k, id]) => [`g ${k}`, registered.nav().find(n => n.id === id).label])],
    ['Lists (Inbox, Tasks, Clients)', [['j', 'Next'], ['k', 'Previous'], ['e', 'Done'], ['s', 'Snooze'], ['r', 'Reply'], ['x', 'Select']]],
    ['Commands', registered.commands().filter(c => c.keys).map(c => [c.keys, c.label])],
  ].filter(([, items]) => items.length);
  sheet('Keyboard shortcuts', body => {
    body.append(h('div', { class: 'pal-keys' }, groups.map(([title, items]) => h('section', null, h('h3', null, title),
      h('dl', null, items.map(([k, label]) => [h('dt', null, kbd(k)), h('dd', null, label)]))))));
    body.append(h('p', { class: 'small muted' }, 'On Windows and Linux, Ctrl stands in for ⌘. Shortcuts do nothing while you are typing, apart from ⌘K and Esc.'));
  }, { wide: true });
}

const typing = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const chord = e => `${e.metaKey || e.ctrlKey ? '⌘' : ''}${e.shiftKey && e.key.length > 1 ? '⇧' : ''}${e.altKey ? '⌥' : ''}${e.key.length === 1 ? e.key.toLowerCase() : e.key}`;
const norm = keys => String(keys).replace(/Ctrl\+?/gi, '⌘').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Install the global keyboard map once. handlers: {quickCreate(), toggleRail(), toggleTheme()}.
 * Registered commands with `keys` ('g i', '⌘⇧n') run first; the built-in `g x` go-to map is the fallback.
 */
export function installShortcuts(handlers) {
  let pending = null, pendingTimer = null;
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (!state.me || document.querySelector('dialog[open]') || document.querySelector('.pal-host')) return;
    if (typing(document.activeElement)) return;
    if (mod && e.key === '\\') { e.preventDefault(); handlers.toggleRail?.(); return; }
    if (mod && e.key === '.') { e.preventDefault(); handlers.toggleTheme?.(); return; }
    const key = chord(e);
    const seqKey = pending ? `${pending} ${key}` : key;
    const cmd = registered.commands().find(c => c.keys && norm(c.keys) === norm(seqKey) && (!c.when || c.when()));
    if (cmd) { e.preventDefault(); pending = null; cmd.run(); return; }
    if (pending === 'g' && !mod) {
      pending = null;
      clearTimeout(pendingTimer);
      const nav = registered.nav().find(n => n.id === GO_KEYS[key]);
      if (nav) { e.preventDefault(); go(navPath(nav)); }
      return;
    }
    if (mod || e.altKey) return;
    if (key === 'g' || registered.commands().some(c => c.keys && norm(c.keys).startsWith(`${key} `))) {
      pending = key;
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => { pending = null; }, 1200);
      return;
    }
    if (key === '/') { e.preventDefault(); openPalette(); }
    else if (e.key === '?') { e.preventDefault(); showShortcuts(); }
    else if (key === 'n') { e.preventDefault(); handlers.quickCreate?.(); }
  });
}
