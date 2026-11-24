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

import { SYMBOLS } from './symbols.js';
export { live } from './live.js';

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

/** Upload a file's bytes as the raw body (POST /api/media). Returns the JSON answer. */
export async function apiUpload(path, file, type) {
  let res;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'content-type': type, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: file });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection.');
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Upload failed (${res.status})`);
  return data;
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
    // Inline style only through the CSSOM: the CSP (style-src 'self') blocks a style attribute.
    else if (k === 'style' && typeof v === 'string') el.style.cssText = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (val === null || val === undefined || val === false) continue;
        if (prop.startsWith('--')) el.style.setProperty(prop, String(val));
        else el.style[prop] = val;
      }
    }
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

// MARK: - Icons (Material Symbols Rounded, weight 300; symbols.js)

/**
 * The IconKey catalogue (docs/design/atelier-spec.md, "Iconography"), plus the
 * desk's own utility names. Every name maps to one Material Symbol.
 */
const ICON_NAMES = {
  // Tabs
  today: 'sunny', progress: 'trending_up', jk: 'chat_bubble', coachToday: 'inbox', clients: 'group', messages: 'chat_bubble',
  // Goals and progress
  goal: 'flag', milestone: 'sports_score', record: 'military_tech', photos: 'photo_library', measurement: 'straighten',
  week: 'calendar_month', calendarFeed: 'event_repeat',
  // Habits (the closed catalogue the coach picks from)
  water: 'water_drop', sleep: 'bedtime', steps: 'directions_walk', protein: 'restaurant', supplement: 'pill', energy: 'bolt',
  mobility: 'self_improvement', mindfulness: 'spa', reading: 'menu_book', sunlight: 'wb_twilight', custom: 'check_circle',
  fromHealth: 'favorite', rest: 'bedtime_off',
  // Sessions
  workout: 'fitness_center', oneToOne: 'person', video: 'videocam', group: 'groups', book: 'event_available',
  // Coach and feedback
  letter: 'drafts', checkIn: 'monitor_heart', form: 'description', voiceNote: 'graphic_eq', play: 'play_circle',
  formCheck: 'video_call', mealPhoto: 'photo_camera', guide: 'auto_stories', reply: 'reply',
  // Coach reasons
  pain: 'healing', unread: 'chat_bubble', priority: 'arrow_circle_up', quiet: 'bedtime_off', noTraining: 'fitness_center',
  priorityUnread: 'arrow_circle_up', checkinLetterDue: 'drafts', formAnswers: 'description',
  // Utility
  done: 'check', chevron: 'chevron_right', add: 'add', trendUp: 'north_east', trendFlat: 'east', trendDown: 'south_east',
  lock: 'lock', settings: 'settings',
  // The desk's own
  schedule: 'calendar_month', programs: 'format_list_bulleted', guides: 'auto_stories', account: 'account_circle',
  business: 'bar_chart', back: 'chevron_left', plus: 'add', close: 'close', check: 'check', warning: 'warning',
  bolt: 'bolt', pencil: 'edit', bubble: 'chat_bubble', moon: 'bedtime', clock: 'schedule', calendar: 'calendar_month',
  heart: 'favorite', dumbbell: 'fitness_center', trash: 'delete', search: 'search', people: 'group', signout: 'logout',
  checklist: 'checklist', chart: 'show_chart', fork: 'restaurant', star: 'star', tag: 'sell', upload: 'upload', mic: 'mic',
  up: 'arrow_upward', down: 'arrow_downward', stop: 'stop_circle', send: 'send', expand: 'expand_more',
  collapse: 'expand_less', link: 'link', image: 'image', scheduleSend: 'schedule_send', person: 'person',
};
/** The habit glyphs the coach may choose (Habit.iconKey). */
export const HABIT_KEYS = ['water', 'sleep', 'steps', 'protein', 'supplement', 'energy', 'mobility', 'mindfulness', 'reading', 'sunlight', 'custom'];
export const HABIT_KEY_LABEL = {
  water: 'Water', sleep: 'Sleep', steps: 'Steps', protein: 'Fuel', supplement: 'Supplement', energy: 'Energy',
  mobility: 'Mobility', mindfulness: 'Mindfulness', reading: 'Reading', sunlight: 'Sunlight', custom: 'Other',
};

const SVG = 'http://www.w3.org/2000/svg';
/**
 * icon('water', 20, { filled: true, label: 'Water' }): an inline glyph in the
 * text colour. `filled` is for done or selected states only. With a label the
 * glyph is announced; without one it is decoration. Unknown names draw a dot.
 */
export function icon(name, size = 20, { filled = false, label = null } = {}) {
  const sym = SYMBOLS[ICON_NAMES[name] ?? name];
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', sym?.[2] || '0 -960 960 960');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('fill', 'currentColor');
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); } else svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', sym ? (filled && sym[1] ? sym[1] : sym[0]) : 'M480-400q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Z');
  svg.append(path);
  return svg;
}

/** The JK monogram (docs/design/brand/jk-monogram.svg), in the accent. */
export function monogram(size = 32, { label = 'JK' } = {}) {
  // The silver "JK." mark (docs/design/brand/jk-mark-silver-1024.png): heavy sans
  // letters in currentColor and a chrome dot (.mono-dot, coloured by app.css).
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label);
  svg.classList.add('monogram');
  const text = document.createElementNS(SVG, 'text');
  for (const [k, v] of Object.entries({ x: '43', y: '72', 'text-anchor': 'middle', 'font-size': '66', 'font-weight': '800', 'letter-spacing': '-2',
    'font-family': '"Inter Display","Inter",-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif' })) text.setAttribute(k, v);
  text.textContent = 'JK';
  const dot = document.createElementNS(SVG, 'circle');
  dot.setAttribute('cx', '89'); dot.setAttribute('cy', '65'); dot.setAttribute('r', '7.5');
  dot.classList.add('mono-dot');
  svg.append(text, dot);
  return svg;
}

export const svgEl = (tag, attrs, ...kids) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
};

// MARK: - Colours (status tokens; always beside a word and a glyph)

export const COLOR = {
  urgent: 'var(--urgent)', waiting: 'var(--attention)', attention: 'var(--attention)', ok: 'var(--on-track)', data: 'var(--data)',
  accent: 'var(--accent)', inPerson: 'var(--kind-inperson)', video: 'var(--kind-video)', group: 'var(--kind-group)',
};
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

/** A rounded label. `tint` is a COLOR value; `on` fills it with the control colour. */
export const chip = (text, { on = false, tint = null } = {}) => h('span', { class: 'chip' + (on ? ' on' : ''), style: tint ? { color: tint, borderColor: tint } : null }, text);

export const dot = (color, size = 8) => h('span', { class: 'dot', style: { background: color, width: `${size}px`, height: `${size}px` } });

/** Initials in a circle on raised (40% of the diameter); `photo` is an /api/media URL; `coach` adds the accent ring. */
export const avatar = (nameOrInitials, size = 32, { photo = null, coach = false } = {}) => h('span', {
  class: 'avatar' + (coach ? ' coach' : ''), style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px` },
}, photo ? mediaImage(photo, '') : (nameOrInitials && nameOrInitials.length <= 3 && nameOrInitials === nameOrInitials.toUpperCase() ? nameOrInitials : initials(nameOrInitials)));

/** An anchor to a route (keeps middle-click / new tab working). */
export const link = (path, attrs, ...children) => h('a', { ...(attrs || {}), href: '#' + path }, ...children);

/** A tappable row: avatar, name, detail, chevron. `to` is a route path, or pass onclick. */
export const personRow = (person, detail, to, { onclick, trailing } = {}) => {
  const inner = [avatar(person.initials || person.name, 32),
    h('div', { class: 'grow' }, h('div', { class: 'strong' }, person.name), detail ? h('div', { class: 'small faint clamp2' }, detail) : null),
    trailing || null, icon('chevron', 18)];
  return to ? link(to, { class: 'person-row' }, inner) : h('button', { class: 'person-row', onclick }, inner);
};

/** The Today grid's card: icon, big number (or value), title, detail. */
export function summaryCard({ icon: name, title, count = null, value = null, detail = '', tint = null, countLabel = null, to = null, onclick = null, disabled = false }) {
  const muted = value === null && (count ?? 0) === 0;
  const body = [
    h('div', { class: 'spread' }, h('span', { style: { color: tint || 'var(--muted)' } }, icon(name, 18)), tint ? dot(tint, 7) : null),
    h('div', { class: 'row baseline gap4' }, h('span', { class: 'big-num' + (muted ? ' faint' : '') }, value ?? String(count ?? 0)), countLabel ? h('span', { class: 'small faint' }, countLabel) : null),
    h('div', { class: 'small strong' }, title),
    h('div', { class: 'tiny faint clamp2 reserve2' }, detail),
  ];
  const attrs = { class: 'summary-card' + (disabled ? ' disabled' : ''), style: tint ? { borderColor: `color-mix(in srgb, ${tint} 45%, transparent)` } : null };
  if (disabled) return h('div', attrs, body);
  if (to) return link(to, attrs, body);
  return h('button', { ...attrs, onclick }, body);
}

/**
 * An empty state: the brand rule and one serif italic line, with an optional
 * sans line under it. (The icon argument is kept for old callers; glyphs are
 * not boxed or repeated on empty states.)
 */
export const emptyCard = (_name, title, detail) => card({ class: 'empty' },
  h('span', { class: 'brand-rule', 'aria-hidden': 'true' }),
  h('div', { class: 't-quote-s' }, title),
  detail ? h('div', { class: 'small muted' }, detail) : null);

/** The page-level empty state: rule, then quote italic 19 ("All caught up"). */
export const emptyState = (line, detail) => h('div', { class: 'empty-state' },
  h('span', { class: 'brand-rule', 'aria-hidden': 'true' }),
  h('div', { class: 't-quote' }, line),
  detail ? h('div', { class: 'small muted' }, detail) : null);

/** StatusPill: a word plus a dot. tone: urgent | attention | ok | data. */
export const pill = (word, tone = 'data') => h('span', { class: 'pill' }, h('span', { class: `dot bg-${tone}`, 'aria-hidden': 'true' }), word);

/**
 * WeekDots: seven days, each done (accent), notDone (ring), rest (a short
 * dash, no dot) or future; today carries a text-colour ring. Accepts the
 * server's habitWeek ({date, state}) or DayState ({date, done, rest, today, future}).
 */
export function weekDots(days, { big = false, label = true } = {}) {
  const today = todayLondon();
  const stateOf = d => d.state ?? (d.rest ? 'rest' : d.done ? 'done' : d.future ? 'future' : 'notDone');
  const words = { done: 'done', notDone: 'not done', rest: 'rest day', future: 'to come' };
  const summary = (days || []).map(d => `${DAYS[parseDay(d.date).getUTCDay()]} ${words[stateOf(d)]}`).join(', ');
  return h('span', { class: 'week-dots' + (big ? ' big' : ''), role: label ? 'img' : null, 'aria-label': label ? summary : null, title: summary },
    (days || []).map(d => {
      const st = stateOf(d);
      const isToday = d.today ?? d.date === today;
      return h('span', { class: `wd ${st}${isToday && st !== 'rest' ? ' today' : ''}` });
    }));
}

/** A small line chart in slate: no fill, no axes. values may contain nulls. */
export function sparkline(values, { width = 120, height = 28, label = '' } = {}) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v !== null && v !== undefined);
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'sparkline', role: 'img', 'aria-label': label });
  if (pts.length < 2) return svg;
  const vs = pts.map(p => p[1]);
  const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const x = i => (i / Math.max(values.length - 1, 1)) * (width - 4) + 2;
  const y = v => height - 3 - ((v - lo) / span) * (height - 6);
  svg.append(svgEl('polyline', { points: pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '), fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  const [li, lv] = pts.at(-1);
  svg.append(svgEl('circle', { cx: x(li).toFixed(1), cy: y(lv).toFixed(1), r: 2, fill: 'currentColor' }));
  return svg;
}

/** Ring: the shared progress arc (track plus an accent sweep), `pct` 0–100. */
export function ring(pct, { size = 44, stroke = 3, label = '' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(100, pct ?? 0)) / 100;
  return svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'ring', role: 'img', 'aria-label': label },
    // Colours come from app.css classes: SVG presentation attributes do not resolve var().
    svgEl('circle', { class: 'ring-track', cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke }),
    svgEl('circle', { class: 'ring-sweep', cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke, 'stroke-linecap': 'round',
      'stroke-dasharray': `${(c * f).toFixed(2)} ${c.toFixed(2)}`, transform: `rotate(-90 ${size / 2} ${size / 2})` }));
}

/** A labelled on/off switch row. Calls onchange(checked). */
export function switchRow(text, checked, onchange, { detail = null } = {}) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked, onchange: e => onchange(e.target.checked, e.target) });
  return h('label', { class: 'switch' }, h('span', { class: 'grow' }, h('span', null, text), detail ? h('div', { class: 'small muted' }, detail) : null), input);
}

/** An <img> for an /api/media URL (the bytes need the session header). */
export function mediaImage(url, alt, attrs = {}) {
  const img = h('img', { alt, ...attrs });
  if (url) apiBlob(url).then(b => { img.src = URL.createObjectURL(b); }, () => { img.remove(); });
  return img;
}

/** Segmented control: [[value, label], …]. Calls onchange(value). */
export function segmented(options, value, onchange) {
  return h('div', { class: 'segmented', role: 'tablist' }, options.map(([v, label]) => h('button', {
    class: v === value ? 'sel' : '', role: 'tab', 'aria-selected': String(v === value), onclick: () => onchange(v),
  }, label)));
}

/** A big stat tile: value over label. */
export const stat = (v, k, tint) => h('div', { class: 'stat' }, h('div', { class: 'v', style: tint ? { color: tint } : null }, v), h('div', { class: 'k' }, k));

/** A labelled form field: label then the control. */
let fieldSeq = 0;
export const field = (label, control, hint) => {
  // Tie the label (and hint) to the control, so it is announced and clickable.
  let forId = null, hintId = null;
  if (control instanceof Element && ['INPUT', 'SELECT', 'TEXTAREA'].includes(control.tagName)) {
    if (!control.id) control.id = `f${++fieldSeq}`;
    forId = control.id;
    if (hint) { hintId = `${forId}-hint`; control.setAttribute('aria-describedby', hintId); }
  }
  return h('div', { class: 'field' }, h('label', { for: forId }, label), control, hint ? h('div', { class: 'tiny faint', id: hintId }, hint) : null);
};

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

/**
 * A short note at the bottom centre that fades. `undo` (async) adds an Undo
 * button that runs the inverse; `action: {label, run}` adds another button.
 * A hairline under the note counts down `ms`. Returns {close}.
 */
export function toast(text, { error = false, undo = null, action = null, ms = null } = {}) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const life = ms ?? (undo || action ? 6000 : error ? 5000 : 3200);
  let timer = null;
  const close = () => {
    clearTimeout(timer);
    t.classList.add('out');
    setTimeout(() => t.remove(), 320);
  };
  const btn = (label, run) => h('button', { type: 'button', class: 'toast-btn', onclick: async () => {
    close();
    try { await run(); } catch (err) { toast(err.message || String(err), { error: true }); }
  } }, label);
  const t = h('div', { class: 'toast' + (error ? ' bad' : ''), role: error ? 'alert' : 'status' },
    error ? icon('error', 18) : null,
    h('span', { class: 'toast-text' }, text),
    undo ? btn('Undo', undo) : null,
    action ? btn(action.label, action.run) : null,
    h('span', { class: 'toast-life', style: { '--life': `${life}ms` } }));
  box.append(t);
  // Hovering holds the note; leaving restarts its clock.
  const arm = () => { clearTimeout(timer); timer = setTimeout(close, life); };
  t.addEventListener('mouseenter', () => { clearTimeout(timer); t.classList.add('hold'); });
  t.addEventListener('mouseleave', () => { t.classList.remove('hold'); arm(); });
  arm();
  return { close };
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
  window.removeEventListener('hashchange', hashChanged);
  window.addEventListener('hashchange', hashChanged);
  render();
}
let renderedPath = null;
let renderedQuery = null;
// The query the screen was drawn for, without the keys the shell owns (`panel`).
const screenQuery = () => { const q = hashQuery(); q.delete('panel'); q.sort(); return q.toString(); };
function hashChanged() {
  // Only a shell-owned key changed (a panel opened or closed): keep the screen.
  // Any other query change (?kit=1, ?tab=…) redraws, as a pasted link expects.
  if (currentPath() === renderedPath && screenQuery() === renderedQuery && document.contains(outlet())) {
    for (const fn of queryListeners) { try { fn(); } catch (err) { console.warn(err); } }
    return;
  }
  render();
}
/** The route part of the hash (before any `?`), decoded. */
export const currentPath = () => decodeURIComponent(location.hash.replace(/^#/, '').split('?')[0]) || '/today';
/**
 * The hash's query (`#/clients?panel=client:u_1`): panels, synced tabs and harness flags, never part of the route.
 * A hashchange that changes only `panel` keeps the screen; any other query change redraws it.
 */
export const hashQuery = () => new URLSearchParams(location.hash.split('?').slice(1).join('?'));
/**
 * Change the hash query without redrawing the screen or adding history
 * (slide-over deep links). `null` removes a key.
 */
export function setHashQuery(changes) {
  const params = hashQuery();
  for (const [k, v] of Object.entries(changes)) { if (v === null || v === undefined) params.delete(k); else params.set(k, v); }
  const base = location.hash.split('?')[0] || '#/today';
  const qs = params.toString();
  history.replaceState(history.state, '', base + (qs ? `?${qs}` : ''));
  // The screen made this change itself (tabs({sync})), so it already shows it.
  if (currentPath() === renderedPath) renderedQuery = screenQuery();
}
/** fn() runs when only the hash query changes (Back over a panel, a pasted deep link). Returns off(). */
const queryListeners = new Set();
export const onHashQuery = fn => { queryListeners.add(fn); return () => queryListeners.delete(fn); };
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
  renderedPath = path;
  renderedQuery = screenQuery();
  const mine = ++seq;
  current = { leave: [], seq: mine };
  const view = { fresh: () => mine === seq, onLeave: fn => current?.seq === mine && current.leave.push(fn), query: hashQuery() };
  setCrumbs(null);
  for (const r of routes) {
    const m = r.regex.exec(path);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1] === undefined ? undefined : decodeURIComponent(m[i + 1])]));
    onNav(r.nav);
    el.replaceChildren();
    window.scrollTo(0, 0);
    for (const fn of queryListeners) { try { fn(); } catch (err) { console.warn(err); } }
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

// MARK: - Foundation probe (WP0-S endpoints may be absent: a server without them answers 404)

let caps = null;
/**
 * GET /api/coach/capabilities, once: {features:[name], ai:{provider}, absent}.
 * `absent` means the server has no desk-v2 foundation; the shell then calls no
 * other foundation endpoint, so it runs quietly against an older server.
 */
export function capabilities(force = false) {
  if (!caps || force) {
    caps = api('GET', '/api/coach/capabilities')
      .then(c => ({ features: [], ...c, absent: false }))
      .catch(err => ({ features: [], ai: null, absent: true, failed: err.status !== 404 }));
  }
  return caps;
}
export const hasFeature = async name => (await capabilities()).features.includes(name);
/**
 * A foundation call: null when the foundation is absent or the endpoint
 * answers 404 (not built yet), so callers draw nothing instead of an error.
 */
export async function foundationApi(method, path, body) {
  const c = await capabilities();
  if (c.absent) return null;
  try { return await api(method, path, body); } catch (err) { if (err.status === 404) return null; throw err; }
}

// MARK: - Coach preferences (coach_prefs, with a local cache)

const PREF_LOCAL = 'jk.desk.pref.';
const prefCache = new Map();
const prefLocal = key => { try { const v = localStorage.getItem(PREF_LOCAL + key); return v === null ? undefined : JSON.parse(v); } catch { return undefined; } };
/**
 * prefs.get(key) / prefs.set(key, value): the coach's desk preferences, kept
 * on the server (GET/PUT /api/coach/prefs/:key) and mirrored in this browser,
 * so the theme and rail apply before the first request. Without the
 * foundation they live in this browser only. Keys match ^[a-z0-9.-]{1,64}$.
 */
export const prefs = {
  /** The cached value right now (no request): the server's once loaded, else this browser's. */
  peek(key, fallback = null) {
    if (prefCache.has(key)) return prefCache.get(key) ?? fallback;
    return prefLocal(key) ?? fallback;
  },
  async get(key, fallback = null) {
    if (prefCache.has(key)) return prefCache.get(key) ?? fallback;
    let value = prefLocal(key);
    try {
      const out = await foundationApi('GET', `/api/coach/prefs/${encodeURIComponent(key)}`);
      // The server's value wins when it has one; when it has none, this browser's
      // copy (saved while the server was unreachable) is kept and sent up.
      if (out && out.value !== null && out.value !== undefined) value = out.value;
      else if (out && value !== undefined) foundationApi('PUT', `/api/coach/prefs/${encodeURIComponent(key)}`, { value }).catch(() => {});
    } catch { /* keep the local copy */ }
    prefCache.set(key, value);
    return value ?? fallback;
  },
  async set(key, value) {
    prefCache.set(key, value);
    try { if (value === null || value === undefined) localStorage.removeItem(PREF_LOCAL + key); else localStorage.setItem(PREF_LOCAL + key, JSON.stringify(value)); } catch { /* storage off */ }
    await foundationApi('PUT', `/api/coach/prefs/${encodeURIComponent(key)}`, { value: value ?? null });
  },
};

// MARK: - Registries (desk v2, docs/design/desk-v2.md 3.9). Register at module top level.

const REG = {
  nav: new Map(), command: new Map(), quickCreate: new Map(), widget: new Map(), clientTab: new Map(), clientAction: new Map(),
  bulkAction: new Map(), composerTool: new Map(), sendGuard: new Map(), slash: new Map(), settings: new Map(), searchRenderer: new Map(),
  panel: new Map(),
};
const registryListeners = new Set();
// Registrations in one tick are told once per kind (a module registering a quick-create and a nav item redraws both hosts).
const registryQueued = new Set();
function changed(kind) {
  if (registryQueued.has(kind)) return;
  const first = !registryQueued.size;
  registryQueued.add(kind);
  if (!first) return;
  queueMicrotask(() => {
    const kinds = [...registryQueued];
    registryQueued.clear();
    for (const k of kinds) for (const fn of registryListeners) { try { fn(k); } catch (err) { console.warn(err); } }
  });
}
/** fn(kind) after registrations change (hosts already on screen redraw). Returns off(). */
export const onRegistryChange = fn => { registryListeners.add(fn); return () => registryListeners.delete(fn); };

function put(kind, key, item, { fallback = false } = {}) {
  if (!key || typeof key !== 'string') throw new Error(`register ${kind}: an id is required`);
  const map = REG[kind];
  const old = map.get(key);
  // Registering an existing id merges into it, later wins per key; a `fallback` registration only fills gaps.
  map.set(key, old ? (fallback ? { ...item, ...old } : { ...old, ...item }) : { ...item });
  changed(kind);
}
/** Every register* call takes an optional second argument {fallback: true}: fill gaps only, never overwrite. */
const byOrder = (a, b) => (a.order ?? 100) - (b.order ?? 100) || String(a.label ?? a.id ?? a.key).localeCompare(String(b.label ?? b.id ?? b.key));
const list = kind => [...REG[kind].values()].sort(byOrder);

/** Sidebar groups, in order, with their labels. */
export const NAV_GROUPS = [['command', 'Command'], ['clients', 'Clients'], ['engage', 'Engage'], ['schedule', 'Schedule'], ['business', 'Business'], ['build', 'Build'], ['settings', 'Settings']];

/**
 * registerNav({id, label, icon, group, order, badge, badgeOn, mobile, path}).
 * `path` defaults to /<id>. `mobile` puts it in the phone's bottom bar: true
 * or a slot number (lower first; the bar shows four plus More). main.js
 * registers the existing screens with {fallback: true}, so a package's
 * refinement (registered earlier, at import) is never overwritten.
 */
export function registerNav(item, opts) {
  if (item.group && !NAV_GROUPS.some(([g]) => g === item.group)) throw new Error(`registerNav ${item.id}: unknown group ${item.group}`);
  put('nav', item.id, item, opts);
}
/** registerCommand({id, label, group = 'Actions', icon, keys, when, run}): palette actions and shortcuts ("g i", "⌘⇧N"). */
export const registerCommand = (item, opts) => put('command', item.id, { group: 'Actions', ...item }, opts);
/** registerQuickCreate({id, label, icon, order, run}): the top bar's + New menu. */
export const registerQuickCreate = (item, opts) => put('quickCreate', item.id, item, opts);
/** registerWidget({id, title, size: s|m|l|xl|full, tall, order, defaultOn = true, render: async (bodyEl, view) => {}}): Today tiles. */
export const registerWidget = (item, opts) => put('widget', item.id, { size: 'm', tall: false, defaultOn: true, ...item }, opts);
/** registerClientTab({key, label, order, render: async (box, {client, detail, view}) => {}}). */
export const registerClientTab = (item, opts) => put('clientTab', item.key, item, opts);
/** registerClientAction({id, label, icon, order, run: client => {}}): client header buttons and palette "… for <client>". */
export const registerClientAction = (item, opts) => put('clientAction', item.id, item, opts);
/** registerBulkAction({id, label, icon, scope: 'clients', run: async clientIds => {}}). */
export const registerBulkAction = (item, opts) => put('bulkAction', item.id, { scope: 'clients', ...item }, opts);
/** registerComposerTool({id, icon, label, order, run: (composer, ctx) => {}}). */
export const registerComposerTool = (item, opts) => put('composerTool', item.id, item, opts);
/** registerSendGuard({id, order, check: async (draft, ctx) => ({ok: true}) | ({ok: false, panel})}). No guard may send by itself. */
export const registerSendGuard = (item, opts) => put('sendGuard', item.id, item, opts);
/** registerSlash({id, label, detail, run: composer => {}}): the composer's `/` menu. */
export const registerSlash = (item, opts) => put('slash', item.id, item, opts);
/** registerSettingsSection({id, label, icon, order, render: async box => {}}): /account/:section. */
export const registerSettingsSection = (item, opts) => put('settings', item.id, item, opts);
/** registerSearchRenderer(type, result => Element): custom palette rows for one result type. */
export const registerSearchRenderer = (type, render) => put('searchRenderer', type, { type, render });
/**
 * registerPanel(kind, (id, {wide}) => ({title, build(body, close), wide})): a
 * slide-over that a deep link (#/route?panel=<kind>:<id>) can reopen.
 */
export const registerPanel = (kind, open, opts) => put('panel', kind, { kind, open }, opts);

/** Read-only views of the registries, sorted by `order` (hosts call these when they draw). */
export const registered = {
  nav: () => list('nav'),
  commands: () => list('command'),
  quickCreates: () => list('quickCreate'),
  widgets: () => list('widget'),
  clientTabs: () => list('clientTab'),
  clientActions: () => list('clientAction'),
  bulkActions: scope => list('bulkAction').filter(a => !scope || a.scope === scope),
  composerTools: () => list('composerTool'),
  sendGuards: () => list('sendGuard'),
  slash: () => list('slash'),
  settings: () => list('settings'),
  searchRenderer: type => REG.searchRenderer.get(type)?.render ?? null,
  panel: kind => REG.panel.get(kind)?.open ?? null,
};

// MARK: - Breadcrumbs (the top bar)

let crumbs = null;
let crumbListener = () => {};
/** setCrumbs([{label, path}]): the top bar's trail for this screen; reset on every route change. */
export function setCrumbs(list) { crumbs = list && list.length ? list : null; crumbListener(crumbs); }
export const setCrumbListener = fn => { crumbListener = fn; fn(crumbs); };
