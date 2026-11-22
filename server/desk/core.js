/*
 * JK Performance coach web app: the shared core. Plain DOM, no framework.
 * Every piece of data goes on the page with textContent (via h()), never as
 * HTML. Screens live in their own modules and register hash routes here:
 *
 *   route('/clients/:id/:tab?', (el, params, view) => { ... });
 *
 * `view.fresh()` is false once the user has moved on, so a slow request that
 * finishes late doesn't draw over the next screen. `view.onLeave(fn)` runs fn
 * when the screen goes (stop polling there).
 */

// MARK: - Token and API

const TOKEN_KEY = 'jk.desk.token';
let token = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch { token = null; }
export const getToken = () => token;
export function setToken(value) {
  token = value;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* private window: keep it in memory only */ }
}

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Called when the server says the session has gone (main.js shows sign-in). */
let onSignedOut = () => {};
export const setSignedOutHandler = fn => { onSignedOut = fn; };

export async function api(method, path, body) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection.');
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.status === 401 && token && !path.startsWith('/api/auth/')) {
    setToken(null);
    onSignedOut('Your session ended. Sign in again.');
    throw new ApiError(401, 'Signed out');
  }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`);
  return data;
}

/** A binary GET (photos, exports) as a Blob, with the session header. */
export async function apiBlob(path) {
  const res = await fetch(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, `Request failed (${res.status})`);
  return res.blob();
}

/** Query string from an object; empty values are left out. */
export const q = params => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, v);
  return s.toString();
};

// MARK: - DOM

/** h('div', {class: 'x', onclick}, 'text', child, [more]): children are text or nodes; null/false skipped. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const add = c => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

/** Replace an element's children; arrays flatten and null/false vanish, as in h(). */
export function fill(el, ...children) {
  el.replaceChildren(...h('div', null, ...children).childNodes);
  return el;
}

export const errorLine = e => h('p', { class: 'error', role: 'alert' }, e instanceof Error ? e.message : String(e));
export const loading = () => h('p', { class: 'muted' }, 'Loading…');

// MARK: - Icons (inline SVG paths, 24×24, stroked)

const ICONS = {
  today: 'M4 5h16v15H4zM4 9h16M9 3v4M15 3v4',
  clients: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6',
  schedule: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  messages: 'M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z',
  programs: 'M4 6h16M4 12h16M4 18h10',
  guides: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21a2 2 0 0 1 2-2h13',
  account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  business: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  warning: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  form: 'M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  bubble: 'M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z',
  moon: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  calendar: 'M4 5h16v15H4zM4 9h16M9 3v4M15 3v4',
  heart: 'M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z',
  dumbbell: 'M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  video: 'M3 7h12v10H3zM15 10l6-3v10l-6-3',
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6',
  signout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  checklist: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  chart: 'M3 20h18M4 16l5-5 4 3 7-8',
  fork: 'M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1-3 4-3 8h3',
  star: 'M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1-4.5-4.2 6.1-.8z',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
};
const SVG = 'http://www.w3.org/2000/svg';
/** icon('today', 18): an inline stroked icon. Unknown names draw a dot. */
export function icon(name, size = 18) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true'); svg.classList.add('icon');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', ICONS[name] || 'M12 12h.01');
  svg.append(path);
  return svg;
}

// MARK: - Colours (the iPhone app's: JK.urgent, JK.waiting, JK.slot(kind))

export const COLOR = { urgent: 'var(--urgent)', waiting: 'var(--waiting)', inPerson: 'var(--in-person)', video: 'var(--video)', group: 'var(--group)' };
export const slotColor = kind => (kind === 'video' ? COLOR.video : kind === 'group' ? COLOR.group : COLOR.inPerson);

// MARK: - Dates (London days as YYYY-MM-DD strings; maths in UTC noon)

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const parseDay = s => new Date(s + 'T12:00:00Z');
export const dayStr = d => d.toISOString().slice(0, 10);
export function addDays(s, n) { const d = parseDay(s); d.setUTCDate(d.getUTCDate() + n); return dayStr(d); }
export function mondayOf(s) { const w = parseDay(s).getUTCDay(); return addDays(s, w === 0 ? -6 : 1 - w); }
export const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86_400_000);

const londonFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** The London calendar day and clock time of an instant. */
export const londonParts = iso => {
  const f = Object.fromEntries(londonFmt.formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return { day: `${f.year}-${f.month}-${f.day}`, time: `${f.hour}:${f.minute}` };
};
export const todayLondon = () => londonParts(new Date()).day;

/** "Mon 3 Nov" */
export const fmtDay = s => { const d = parseDay(s); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
/** "3 Nov" */
export const fmtShort = s => { const d = parseDay(s); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
/** "Monday" */
export const fmtWeekday = s => DAYS_LONG[parseDay(s).getUTCDay()];
/** "14:30" in London, from an ISO instant. */
export const fmtTime = iso => (iso ? londonParts(iso).time : '');
/** "3 Nov, 14:30" in London. */
export const fmtWhen = iso => {
  if (!iso) return '';
  const { day, time } = londonParts(iso);
  return `${fmtShort(day)}, ${time}`;
};
/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", else the date. */
export function fmtRelative(iso) {
  if (!iso) return '';
  const secs = (Date.now() - new Date(iso)) / 1000;
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  const days = daysBetween(londonParts(iso).day, todayLondon());
  if (days === 0) return `${Math.floor(secs / 3600)} h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return fmtShort(londonParts(iso).day);
}
/** "in 25 min", "in 2 h 10 min", or null once it has started. */
export function fmtCountdown(iso) {
  const mins = Math.round((new Date(iso) - Date.now()) / 60000);
  if (mins <= 0) return null;
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.floor(mins / 60), rest = mins % 60;
  return rest ? `in ${hrs} h ${rest} min` : `in ${hrs} h`;
}
export const fmtMinutes = m => (m === null || m === undefined ? '—' : `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`);
export const fmtNum = v => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-GB'));
export const fmtMoney = pence => (pence === null || pence === undefined ? '—' : `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 })}`);
export const firstName = name => String(name || '').split(' ')[0];
export const initials = name => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

// MARK: - Drafts kept in this browser

export function readDraft(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
export function writeDraft(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage off */ }
}
export function clearDraft(key) {
  try { localStorage.removeItem(key); } catch { /* storage off */ }
}

// MARK: - Components (the iPhone app's Theme.swift, for the web)

/** A screen's title block: eyebrow over a large title, with buttons on the right. */
export const screenHeader = (eyebrow, title, ...actions) => h('header', { class: 'screen-head' },
  h('div', null, eyebrow ? h('div', { class: 'eyebrow m0' }, eyebrow) : null, h('h1', null, title)),
  actions.length ? h('div', { class: 'row' }, actions) : null);

/** Small caps section label, with optional text on the right. */
export const eyebrow = (text, trailing) => h('div', { class: 'eyebrow spread' }, h('span', null, text), trailing ? h('span', { class: 'eyebrow-trailing' }, trailing) : null);

export const card = (attrs, ...children) => h('div', { ...(attrs || {}), class: 'card' + (attrs?.class ? ` ${attrs.class}` : '') }, ...children);

/** A rounded label. `tint` is a COLOR value; `on` fills it silver. */
export const chip = (text, { on = false, tint = null } = {}) => h('span', { class: 'chip' + (on ? ' on' : ''), style: tint ? { color: tint, borderColor: tint } : null }, text);

export const dot = (color, size = 8) => h('span', { class: 'dot', style: { background: color, width: `${size}px`, height: `${size}px` } });

/** Initials in a circle. */
export const avatar = (nameOrInitials, size = 32) => h('span', { class: 'avatar', style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` } },
  nameOrInitials && nameOrInitials.length <= 3 && nameOrInitials === nameOrInitials.toUpperCase() ? nameOrInitials : initials(nameOrInitials));

/** An anchor to a route (keeps middle-click / new tab working). */
export const link = (path, attrs, ...children) => h('a', { ...(attrs || {}), href: '#' + path }, ...children);

/** A tappable row: avatar, name, detail, chevron. `to` is a route path, or pass onclick. */
export const personRow = (person, detail, to, { onclick, trailing } = {}) => {
  const inner = [avatar(person.initials || person.name, 32),
    h('div', { class: 'grow' }, h('div', { class: 'strong' }, person.name), detail ? h('div', { class: 'small faint clamp2' }, detail) : null),
    trailing || null, icon('chevron', 14)];
  return to ? link(to, { class: 'person-row' }, inner) : h('button', { class: 'person-row', onclick }, inner);
};

/** The Today grid's card: icon, big number (or value), title, detail. */
export function summaryCard({ icon: name, title, count = null, value = null, detail = '', tint = null, countLabel = null, to = null, onclick = null, disabled = false }) {
  const muted = value === null && (count ?? 0) === 0;
  const body = [
    h('div', { class: 'spread' }, h('span', { style: { color: tint || 'var(--faint)' } }, icon(name, 16)), tint ? dot(tint, 7) : null),
    h('div', { class: 'row baseline gap4' }, h('span', { class: 'big-num' + (muted ? ' faint' : '') }, value ?? String(count ?? 0)), countLabel ? h('span', { class: 'small faint' }, countLabel) : null),
    h('div', { class: 'small strong' }, title),
    h('div', { class: 'tiny faint clamp2 reserve2' }, detail),
  ];
  const attrs = { class: 'summary-card' + (disabled ? ' disabled' : ''), style: tint ? { borderColor: `color-mix(in srgb, ${tint} 45%, transparent)` } : null };
  if (disabled) return h('div', attrs, body);
  if (to) return link(to, attrs, body);
  return h('button', { ...attrs, onclick }, body);
}

/** An empty state: an icon, a title and a line under it. */
export const emptyCard = (name, title, detail) => card({ class: 'empty' }, h('div', { class: 'faint' }, icon(name, 22)), h('div', { class: 'strong' }, title), detail ? h('div', { class: 'small muted' }, detail) : null);

/** Segmented control: [[value, label], …]. Calls onchange(value). */
export function segmented(options, value, onchange) {
  return h('div', { class: 'segmented', role: 'tablist' }, options.map(([v, label]) => h('button', {
    class: v === value ? 'sel' : '', role: 'tab', 'aria-selected': String(v === value), onclick: () => onchange(v),
  }, label)));
}

/** A big stat tile: value over label. */
export const stat = (v, k, tint) => h('div', { class: 'stat' }, h('div', { class: 'v', style: tint ? { color: tint } : null }, v), h('div', { class: 'k' }, k));

/** A labelled form field: label then the control. */
export const field = (label, control, hint) => h('div', { class: 'field' }, h('label', null, label), control, hint ? h('div', { class: 'tiny faint' }, hint) : null);

export const button = (text, onclick, { kind = '', small = false, disabled = false, title } = {}) =>
  h('button', { class: `btn${kind ? ` ${kind}` : ''}${small ? ' small' : ''}`, onclick, disabled, title, type: 'button' }, text);

/** Run an async action from a button: disables it, shows errors in `status`. */
export async function busy(btn, status, fn) {
  if (btn) btn.disabled = true;
  if (status) fill(status);
  try {
    return await fn();
  } catch (err) {
    if (status) fill(status, errorLine(err));
    else toast(err.message || String(err), { error: true });
    return undefined;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// MARK: - Sheets, confirmations, toasts

/**
 * A modal sheet (the iPhone app's .sheet). build(body, close) fills it and may
 * return a footer element. Resolves with whatever close(value) is called with
 * (undefined when dismissed).
 */
export function sheet(title, build, { wide = false } = {}) {
  return new Promise(resolve => {
    const dialog = h('dialog', { class: 'sheet' + (wide ? ' wide' : '') });
    let done = false;
    const close = value => {
      if (done) return;
      done = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    const body = h('div', { class: 'sheet-body' });
    const head = h('div', { class: 'sheet-head' }, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close() }, icon('close', 18)));
    dialog.append(head, body);
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    document.body.append(dialog);
    const footer = build(body, close);
    if (footer instanceof Node) dialog.append(h('div', { class: 'sheet-foot' }, footer));
    dialog.showModal();
  });
}

/** A yes/no question. Resolves true when confirmed. */
export function confirmBox(message, { ok = 'OK', danger = false, detail = null } = {}) {
  return sheet(message, (body, close) => {
    if (detail) body.append(h('p', { class: 'muted m0' }, detail));
    return h('div', { class: 'row end' }, button('Cancel', () => close(false)), button(ok, () => close(true), { kind: danger ? 'danger-fill' : 'primary' }));
  }).then(v => v === true);
}

/** A short note in the corner that fades. */
export function toast(text, { error = false } = {}) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast' + (error ? ' bad' : '') }, text);
  box.append(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3200);
}

// MARK: - Router (hash routes: #/clients/u_123/plan)

const routes = [];
/** route('/clients/:id/:tab?', render). A trailing ? makes the last segment optional. */
export function route(pattern, render, { nav = null } = {}) {
  const keys = [];
  const src = pattern.replace(/\/:(\w+)(\?)?/g, (_, k, opt) => { keys.push(k); return opt ? '(?:/([^/]+))?' : '/([^/]+)'; });
  routes.push({ regex: new RegExp(`^${src}/?$`), keys, render, nav: nav ?? pattern.split('/')[1] });
}

let current = null; // { leave: [fns], seq }
let seq = 0;
let outlet = () => null;
let onNav = () => {};
/** main.js hands over the element screens draw into, and a callback for the sidebar's selection. */
export function startRouter(getOutlet, navChanged) {
  outlet = getOutlet;
  onNav = navChanged;
  window.addEventListener('hashchange', render);
  render();
}
export const currentPath = () => decodeURIComponent(location.hash.replace(/^#/, '')) || '/today';
/** Go to a route. `replace` swaps the history entry instead of adding one. */
export function go(path, { replace = false } = {}) {
  if (replace) { history.replaceState(null, '', '#' + path); render(); }
  else if (location.hash === '#' + path) render();
  else location.hash = path;
}
/** Redraw the current screen (after a save, say). */
export const refresh = () => render();

function render() {
  const el = outlet();
  if (!el) return;
  if (current) for (const fn of current.leave) { try { fn(); } catch { /* ignore */ } }
  const path = currentPath();
  const mine = ++seq;
  current = { leave: [], seq: mine };
  const view = { fresh: () => mine === seq, onLeave: fn => current?.seq === mine && current.leave.push(fn) };
  for (const r of routes) {
    const m = r.regex.exec(path);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1] === undefined ? undefined : decodeURIComponent(m[i + 1])]));
    onNav(r.nav);
    el.replaceChildren();
    window.scrollTo(0, 0);
    Promise.resolve(r.render(el, params, view)).catch(err => { if (view.fresh()) fill(el, errorLine(err)); });
    return;
  }
  onNav(null);
  fill(el, screenHeader(null, 'Not found'), h('p', { class: 'muted' }, 'That page doesn’t exist. '), link('/today', null, 'Go to Today'));
}

// MARK: - Shared state

/** Who's signed in, and the coach's client list (loaded once, refreshed on demand). */
export const state = { me: null, clients: null, plans: null };
export async function clients(force = false) {
  if (!state.clients || force) state.clients = (await api('GET', '/api/coach/clients')).clients;
  return state.clients;
}
/** The coach's plans (names, prices) and the feature catalogue, loaded once. */
export async function plans(force = false) {
  if (!state.plans || force) state.plans = await api('GET', '/api/plans');
  return state.plans;
}
/** A plan's name as the coach has it, once plans() has loaded; else from the id. */
export const planName = id => state.plans?.plans.find(p => p.id === (id || 'none'))?.name
  ?? (!id || id === 'none' ? 'Free' : id[0].toUpperCase() + id.slice(1));
export const clientById = id => state.clients?.find(c => c.id === id) || null;

/** The sidebar's unread badge; screens call this after reading a thread. */
let badgeListener = () => {};
export const setBadgeListener = fn => { badgeListener = fn; };
export const refreshBadges = () => badgeListener();
