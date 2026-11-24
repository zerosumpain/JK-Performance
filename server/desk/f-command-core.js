/*
 * Command (WP1): what the Today screen, its tiles and the Inbox share.
 *
 * - A short-lived cache for the requests several tiles make at once
 *   (needs-you, the summary, the inbox counts), dropped whenever a live
 *   event arrives, so one screen draw costs one request per endpoint.
 * - The "letters only" switch the Letters tile flips and the Needs-you tile obeys.
 * - The Brief me slide-over (POST /api/command/brief).
 * - London wall-clock helpers for snoozing.
 */
import { api, fill, firstName, h, icon, live, state } from './core.js';
import { skeleton, slideOver } from './ui.js';

// MARK: - Cached loads

const cache = new Map(); // path -> {at, promise}
const FRESH_MS = 4_000;
/** GET `path`, sharing one request between callers for a few seconds. */
export function load(path, { fresh = false } = {}) {
  const hit = cache.get(path);
  if (!fresh && hit && Date.now() - hit.at < FRESH_MS) return hit.promise;
  const promise = api('GET', path);
  cache.set(path, { at: Date.now(), promise });
  promise.catch(() => cache.delete(path));
  return promise;
}
/** Forget every cached answer (after a write or a live event). */
export const invalidate = () => cache.clear();

/**
 * Call fn() (debounced) when a live event arrives, when the desk polls (no
 * stream), on `jk:inbox-changed`, and once a minute; all stops when the screen
 * goes. `types` limits the live events (by prefix, e.g. 'booking.').
 */
export function onRefresh(view, fn, { types = null, everyMs = 60_000, wait = 700 } = {}) {
  let timer = null;
  const kick = () => { clearTimeout(timer); timer = setTimeout(() => { invalidate(); if (view.fresh()) fn(); }, wait); };
  const offLive = live.on('*', ev => {
    if (ev.type === 'live.connected') return;
    if (ev.type === 'poll' || !types || types.some(t => ev.type.startsWith(t))) kick();
  });
  const onChanged = () => kick();
  window.addEventListener('jk:inbox-changed', onChanged);
  const tick = setInterval(() => { if (!document.hidden) kick(); }, everyMs);
  view.onLeave(() => { offLive(); clearTimeout(timer); clearInterval(tick); window.removeEventListener('jk:inbox-changed', onChanged); });
}

export const needsYou = opts => load('/api/coach/needs-you', opts);
export const summary = opts => load('/api/command/summary', opts);

// MARK: - The letters-only switch (Letters tile → Needs-you tile)

const bus = new EventTarget();
let lettersOnly = false;
export const getLettersOnly = () => lettersOnly;
export function setLettersOnly(on) {
  lettersOnly = !!on;
  bus.dispatchEvent(new Event('letters'));
}
/** fn() when the letters-only switch changes. Returns off(). */
export function onLetters(fn) {
  bus.addEventListener('letters', fn);
  return () => bus.removeEventListener('letters', fn);
}

// MARK: - Names and greetings

/** "JK" for "Coach JK", "John" for "John Kelly". */
export const coachFirst = name => firstName(String(name || '').replace(/^coach\s+/i, '')) || 'Coach';
export function greeting(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23' }).format(date));
  return hour >= 4 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 18 ? 'Good afternoon' : 'Good evening';
}

// MARK: - London wall clock

const parts = date => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).formatToParts(date).map(p => [p.type, p.value]));
/** The UTC Date of a London day ("YYYY-MM-DD") at "HH:MM", correct across clock changes. */
export function londonAt(day, clock = '00:00') {
  const [y, m, d] = day.split('-').map(Number), [hh, mm] = clock.split(':').map(Number);
  const wanted = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const f = parts(new Date(guess));
    guess += wanted - Date.UTC(+f.year, +f.month - 1, +f.day, +f.hour, +f.minute);
  }
  return new Date(guess);
}
/** The London day and clock of a Date. */
export const londonNow = (date = new Date()) => { const f = parts(date); return { day: `${f.year}-${f.month}-${f.day}`, clock: `${f.hour}:${f.minute}` }; };

// MARK: - Brief me

const BULLET_ICONS = ['group', 'healing', 'calendar_month', 'drafts', 'bolt'];

/** The 5-bullet morning brief in a slide-over. Nothing is sent: it only reads. */
export function openBrief() {
  slideOver('Morning brief', (body, close, { setTitle }) => {
    const list = h('div', { class: 'cmd-brief' }, skeleton('lines', { rows: 5 }));
    const meta = h('div', { class: 'cmd-brief-meta' });
    const again = h('button', { type: 'button', class: 'btn small' }, icon('sync', 16), 'Again');
    const run = async () => {
      again.disabled = true;
      fill(list, skeleton('lines', { rows: 5 }));
      try {
        const out = await api('POST', '/api/command/brief');
        setTitle(out.title || 'Brief');
        fill(list, h('ol', { class: 'cmd-brief-list' }, out.bullets.map((b, i) => h('li', { class: 'cmd-brief-item', style: { '--i': String(i) } },
          h('span', { class: 'cmd-brief-icon', 'aria-hidden': 'true' }, icon(BULLET_ICONS[i] || 'bolt', 18)), h('span', null, b)))));
        fill(meta,
          h('span', { class: `cmd-ai-chip ${out.provider === 'stub' ? 'stub' : 'on'}` }, icon('auto_awesome', 14), out.provider === 'stub' ? 'AI · stub' : `AI · ${out.model || 'on'}`),
          h('span', null, `Drafted ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(new Date(out.at))}`));
      } catch (err) {
        fill(list, h('p', { class: 'error', role: 'alert' }, err.message));
      } finally { again.disabled = false; }
    };
    again.addEventListener('click', run);
    const me = state.me?.name ? coachFirst(state.me.name) : 'Coach';
    body.append(
      h('p', { class: 'cmd-brief-lede' }, `${greeting()}, `, h('em', null, me), '. Here is your day.'),
      list, meta,
      h('p', { class: 'tiny faint cmd-brief-note' }, icon('shield', 14), 'Built from counts, first names and Needs-you reasons. Nothing is sent to anyone.'));
    run();
    return h('div', { class: 'row end' }, again, h('button', { type: 'button', class: 'btn small primary', onclick: () => close() }, 'Done'));
  });
}
