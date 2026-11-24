/*
 * Calendar (WP7, F20 and F21): the coach's week and day, with everything that
 * shapes them. Sessions in their lanes (buffers as faint tails), busy time
 * from connected calendars as hatched bands in the source's colour, holds as
 * muted bands, time off as a full-height band, and a warning badge on every
 * clash. Drag a session to move it (a live check runs while dragging; the
 * server re-checks on drop), click empty space to book or hold, and the
 * Waitlist tab lists who wants a slot.
 *
 *   #/schedule[?day=YYYY-MM-DD]
 *   #/schedule/waitlist
 *   #/schedule/class/<bookingId>[/<YYYY-MM-DD>]
 */
import {
  addDays, api, avatar, busy, button, clients, confirmBox, DAYS, errorLine, field, fill, firstName, go, h, hashQuery, icon, initials, link, live,
  londonParts, mondayOf, parseDay, registerPanel, route, setCrumbs, sheet, toast, todayLondon,
} from './core.js';
import { emptyHero, menu, pageHead, segmentedNav, skeleton, slideOver, tabs } from './ui.js';
import {
  attendanceOf, clockOf, conflictsOf, HOLD_WORD, KIND_WORD, loadPicture, localClash, londonIso, longDay, minutesOf, shortDay, spanOf, whenOf, whoOf,
} from './f-calendar-lib.js';
import { confirmMove, findBookingNear, moveSheet, openAvailability, openBook, openConflicts, openFinder, openHold, viewPref } from './f-calendar.js';
import { openNotes } from './f-diary.js';

const ROW = 52; // px per hour
const SNAP = 15; // minutes
const FILTERS = [['all', 'All'], ['inperson', '1:1'], ['video', 'Video'], ['group', 'Class']];
const ui = { monday: null, day: null, view: null, filter: 'all' };
const enc = encodeURIComponent;
const isGroup = b => b.kind === 'group';
const keeps = b => ui.filter === 'all' || b.kind === ui.filter;
const kindTone = kind => (kind === 'video' ? 'video' : kind === 'group' ? 'group' : 'inperson');
const isoWeek = day => {
  const d = parseDay(day);
  const thursday = new Date(d); thursday.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((thursday - jan4) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
};

/** Where a session opens: its panel (notes, move, cancel). */
export function openSession(b, { onChange = null } = {}) {
  slideOver(whoOf(b), (body, close) => drawSession(body, close, b, onChange), { className: 'cal-panel', deepLink: `session:${b.id}` });
}
registerPanel('session', id => {
  queueMicrotask(async () => {
    const b = await findBookingNear(id, null).catch(() => null);
    if (b) openSession(b); else toast('That session has gone.', { error: true });
  });
  return null;
});

function drawSession(body, close, b, onChange) {
  const p = londonParts(b.start);
  const status = h('div');
  const future = Date.parse(b.start) > Date.now();
  const people = b.attendees?.length ? b.attendees : b.client ? [b.client] : [];
  const actions = [
    h('button', { type: 'button', class: 'btn primary', onclick: () => { close(); openNotes(b); } }, icon('edit_note', 18), future ? 'Plan notes' : 'Notes and attendance'),
    future ? h('button', { type: 'button', class: 'btn', onclick: () => { close(); moveSheet(b); } }, icon('edit_calendar', 18), 'Move') : null,
    future && b.client && !isGroup(b) ? h('button', { type: 'button', class: 'btn', onclick: () => { close(); openFinder({ client: b.client, from: p.day }); } }, icon('travel_explore', 18), 'Find another time') : null,
    b.client && !isGroup(b) ? link(`/clients/${enc(b.client.id)}`, { class: 'btn', onclick: () => close() }, icon('person', 18), `Open ${firstName(b.client.name)}`) : null,
    isGroup(b) ? link(`/schedule/class/${enc(b.id)}/${p.day}`, { class: 'btn', onclick: () => close() }, icon('groups', 18), 'Class page') : null,
  ];
  const cancel = async (series) => {
    const ok = await confirmBox(series ? 'Cancel this and every later session?' : 'Cancel this session?', { ok: 'Cancel', danger: true, detail: isGroup(b) ? 'Everyone booked on it loses their place.' : `${b.client?.name || 'The client'} is told, and the credit comes back.` });
    if (!ok) return;
    await busy(null, status, async () => {
      if (series) {
        const out = await api('POST', `/api/bookings/series/${enc(b.seriesId)}/cancel`, { from: b.start });
        toast(`Cancelled ${out.cancelled} sessions`);
      } else {
        await api('DELETE', `/api/bookings/${enc(b.id)}`);
        toast('Session cancelled');
      }
      window.dispatchEvent(new CustomEvent('jk:calendar-changed'));
      onChange?.(); close();
    });
  };
  fill(body,
    h('div', { class: 'cal-sess-head' },
      h('span', { class: `cal-sess-bar k-${kindTone(b.kind)}`, 'aria-hidden': 'true' }),
      h('div', null,
        h('div', { class: 'cal-sess-when' }, longDay(p.day)),
        h('div', { class: 'cal-sess-time t-num' }, spanOf(b.start, b.end)),
        h('div', { class: 'small muted' }, [KIND_WORD[b.kind], b.location && b.location !== 'Video call' ? b.location : null, b.purpose === 'planning' ? 'Planning session' : b.purpose === 'review' ? 'Accountability session' : null, b.seriesId ? 'Weekly' : null].filter(Boolean).join(' · ')))),
    people.length ? h('div', { class: 'cal-sess-people' }, people.map(x => h('span', { class: 'cal-person' }, avatar(initials(x.name), 26), x.name))) : null,
    h('div', { class: 'cal-sess-actions' }, actions),
    future ? h('div', { class: 'cal-sess-cancel' },
      button('Cancel this session', () => cancel(false), { small: true, kind: 'danger' }),
      b.seriesId ? button('Cancel this and following', () => cancel(true), { small: true, kind: 'danger' }) : null) : null,
    status);
}

// MARK: - The calendar screen

route('/schedule/class/:id/:day?', classPage);

route('/schedule/:tab?', async (el, { tab }, view) => {
  const today = todayLondon();
  const wanted = hashQuery().get('day');
  if (wanted && /^\d{4}-\d\d-\d\d$/.test(wanted)) { ui.monday = mondayOf(wanted); ui.day = wanted; }
  if (!ui.monday) ui.monday = mondayOf(today);
  if (!ui.view) ui.view = viewPref.get() === 'day' ? 'day' : 'week';
  const onWaitlist = tab === 'waitlist';
  setCrumbs([{ label: 'Calendar', path: '/schedule' }, ...(onWaitlist ? [{ label: 'Waitlist' }] : [])]);

  const head = h('div');
  const bar = h('div', { class: 'cal-tabs' });
  const tools = h('div', { class: 'cal-tools' });
  const body = h('div', { class: 'cal-stage' }, skeleton('chart'));
  el.append(head, bar, tools, body);
  let pic = null, waitCount = 0, error = null;

  const days = () => (ui.view === 'day' ? [ui.day] : Array.from({ length: 7 }, (_, i) => addDays(ui.monday, i)));
  const setWeek = monday => { ui.monday = monday; if (!days().includes(ui.day)) ui.day = monday; load(); };

  function drawHead() {
    const range = days();
    const shown = pic ? pic.bookings.filter(keeps) : [];
    const clashes = pic?.conflicts.length ?? 0;
    const sub = pic ? [`${shown.length} session${shown.length === 1 ? '' : 's'}`, `${pic.holds.length} hold${pic.holds.length === 1 ? '' : 's'}`,
      pic.blocks.length ? `${pic.blocks.length} busy from your calendars` : null].filter(Boolean).join(' · ') : 'Loading the week…';
    const conflictsChip = h('button', { type: 'button', class: `cal-clash-chip${clashes ? ' on' : ''}`, onclick: () => openConflicts(), 'aria-label': `Conflicts: ${clashes}` },
      icon(clashes ? 'warning' : 'event_available', 16), clashes ? `Conflicts (${clashes})` : 'No clashes');
    fill(head, pageHead({
      eyebrow: onWaitlist ? 'Schedule' : `Week ${isoWeek(ui.monday)} · ${shortDay(range[0])}${range.length > 1 ? ` – ${shortDay(range.at(-1))}` : ''}`,
      title: onWaitlist ? 'Waitlist' : ui.view === 'day' ? longDay(ui.day).split(' ')[0] : 'Calendar',
      accent: onWaitlist ? null : ui.view === 'day' ? longDay(ui.day).split(' ').slice(1).join(' ') : null,
      sub: onWaitlist ? 'Clients waiting for a slot. When a session frees up, matching people light up here.' : sub,
      actions: [
        onWaitlist ? null : conflictsChip,
        h('button', { type: 'button', class: 'btn', 'aria-label': 'Availability', onclick: () => openAvailability() }, icon('tune', 18), h('span', { class: 'cal-hide-s', 'aria-hidden': 'true' }, 'Availability')),
        h('button', { type: 'button', class: 'btn', 'aria-label': 'Hold time', onclick: () => openHold({ onDone: load }) }, icon('front_hand', 18), h('span', { class: 'cal-hide-s', 'aria-hidden': 'true' }, 'Hold')),
        h('button', { type: 'button', class: 'btn primary', onclick: () => openBook({ day: ui.day >= today ? ui.day : today, onDone: load }) }, icon('add', 18), 'Book'),
      ],
    }));
    fill(bar, tabs([{ id: 'calendar', label: 'Calendar' }, { id: 'waitlist', label: 'Waitlist', badge: waitCount || null }], onWaitlist ? 'waitlist' : 'calendar',
      id => go(id === 'waitlist' ? '/schedule/waitlist' : '/schedule'), { label: 'Calendar sections' }));
  }

  function drawTools() {
    if (onWaitlist) { tools.replaceChildren(); return; }
    const step = ui.view === 'day' ? 1 : 7;
    fill(tools,
      h('div', { class: 'cal-nav' },
        h('button', { type: 'button', class: 'ui-icon-btn', 'aria-label': ui.view === 'day' ? 'Previous day' : 'Previous week', onclick: () => { if (ui.view === 'day') { ui.day = addDays(ui.day, -1); ui.monday = mondayOf(ui.day); } else ui.monday = addDays(ui.monday, -step); load(); } }, icon('chevron_left', 20)),
        button('Today', () => { ui.day = today; setWeek(mondayOf(today)); }, { small: true }),
        h('button', { type: 'button', class: 'ui-icon-btn', 'aria-label': ui.view === 'day' ? 'Next day' : 'Next week', onclick: () => { if (ui.view === 'day') { ui.day = addDays(ui.day, 1); ui.monday = mondayOf(ui.day); } else ui.monday = addDays(ui.monday, step); load(); } }, icon('chevron_right', 20))),
      h('div', { class: 'cal-view cal-hide-m' }, segmentedNav([['week', 'Week'], ['day', 'Day']], ui.view, v => { ui.view = v; viewPref.set(v); if (v === 'day' && !days().includes(ui.day)) ui.day = ui.monday; load(); }, { label: 'View' })),
      h('div', { class: 'cal-filters', role: 'group', 'aria-label': 'Show' }, FILTERS.map(([v, label]) => {
        const n = pic ? pic.bookings.filter(b => v === 'all' || b.kind === v).length : 0;
        return h('button', { type: 'button', class: 'cal-filter' + (ui.filter === v ? ' on' : ''), 'aria-pressed': String(ui.filter === v), onclick: () => { ui.filter = v; draw(); } },
          v === 'all' ? null : h('span', { class: `cal-dot k-${kindTone(v)}`, 'aria-hidden': 'true' }), label, h('span', { class: 'cal-filter-n' }, String(n)));
      })),
      h('div', { class: 'cal-legend cal-hide-m' },
        h('span', null, h('span', { class: 'cal-key busy' }), 'Busy'),
        h('span', null, h('span', { class: 'cal-key hold' }), 'Hold'),
        h('span', null, h('span', { class: 'cal-key off' }), 'Time off'),
        h('span', null, h('span', { class: 'cal-key buf' }), 'Buffer')));
  }

  function draw() {
    drawHead(); drawTools();
    if (onWaitlist) return;
    if (!pic) { fill(body, error ? h('div', { class: 'card' }, errorLine(error), button('Try again', load, { small: true })) : skeleton('chart')); return; }
    fill(body, grid(days(), pic, today, { onChange: load }), dayList(pic, today, d => { ui.day = d; draw(); }, load));
  }

  async function load() {
    if (onWaitlist) { await loadWaitlist(); return; }
    const range = days();
    // The waitlist badge is cheap; the picture is the week (or the day).
    api('GET', '/api/waitlist').then(w => { waitCount = w.items.filter(i => i.matchStart && Date.parse(i.matchStart) > Date.now() && i.status === 'waiting').length || w.items.length; if (view.fresh()) drawHead(); }).catch(() => {});
    try {
      const out = await loadPicture(addDays(range[0], 0), range.at(-1));
      if (!view.fresh()) return;
      pic = out; error = null;
      if (!range.includes(ui.day)) ui.day = range.includes(today) ? today : range[0];
    } catch (err) { if (!view.fresh()) return; error = err; }
    draw();
  }

  async function loadWaitlist() {
    drawHead(); drawTools();
    fill(body, skeleton('card', { rows: 2 }), skeleton('card', { rows: 2 }));
    try {
      const { items } = await api('GET', '/api/waitlist');
      if (!view.fresh()) return;
      waitCount = items.length;
      drawHead();
      fill(body, waitlist(items, loadWaitlist));
    } catch (err) { if (view.fresh()) fill(body, errorLine(err)); }
  }

  const reload = () => { if (view.fresh()) load(); };
  window.addEventListener('jk:calendar-changed', reload);
  const offs = ['booking.created', 'booking.cancelled', 'booking.rescheduled', 'hold.created', 'calendar.conflict', 'waitlist.matched'].map(t => live.on(t, reload));
  view.onLeave(() => { window.removeEventListener('jk:calendar-changed', reload); offs.forEach(off => off()); });
  draw();
  await load();
});

// MARK: - The grid (week or day)

/** Overlapping items share the width in lanes. Items need {top, bottom}. */
function lanes(items) {
  const sorted = [...items].sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  let cluster = [], end = -1;
  const finish = () => { const n = Math.max(...cluster.map(c => c.lane)) + 1; cluster.forEach(c => { c.lanes = n; }); };
  for (const it of sorted) {
    if (cluster.length && it.top >= end) { finish(); cluster = []; end = -1; }
    const used = new Set(cluster.filter(c => c.bottom > it.top).map(c => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    it.lane = lane;
    cluster.push(it);
    end = Math.max(end, it.bottom);
  }
  if (cluster.length) finish();
  return sorted;
}

/** An interval's minutes inside one London day, or null when it misses the day. */
function onDay(day, startIso, endIso) {
  const lo = Date.parse(londonIso(day)), hi = Date.parse(londonIso(addDays(day, 1)));
  const s = Math.max(Date.parse(startIso), lo), e = Math.min(Date.parse(endIso), hi);
  if (e <= s) return null;
  const top = londonParts(new Date(s).toISOString()).day === day ? minutesOf(londonParts(new Date(s).toISOString()).time) : 0;
  const bottom = e >= hi ? 24 * 60 : minutesOf(londonParts(new Date(e).toISOString()).time);
  return { top, bottom: Math.max(bottom, top + 15), full: s <= lo && e >= hi };
}

function grid(days, pic, today, { onChange }) {
  const shown = pic.bookings.filter(keeps);
  const prefs = pic.prefs ?? { bufferBefore: 0, bufferAfter: 0 };
  // Hours: 06:00 to 21:00, stretched to fit whatever is on the grid.
  let first = 6, last = 21;
  for (const d of days) for (const x of [...shown, ...pic.holds]) {
    const m = onDay(d, x.start, x.end);
    if (m) { first = Math.min(first, Math.floor(m.top / 60)); last = Math.max(last, Math.ceil(m.bottom / 60)); }
  }
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const px = mins => ((mins - first * 60) / 60) * ROW;
  const nowP = londonParts(new Date().toISOString());
  const pxH = hours.length * ROW;

  const gutter = h('div', { class: 'cal-gutter', 'aria-hidden': 'true' }, h('div', { class: 'cal-colhead' }),
    h('div', { class: 'cal-hours', style: { height: `${pxH}px` } }, hours.map(hr => h('div', { class: 'cal-hour', style: { top: `${(hr - first) * ROW}px` } }, `${String(hr).padStart(2, '0')}:00`))));

  const cols = days.map(day => {
    const d = parseDay(day);
    const dayBookings = shown.filter(b => onDay(day, b.start, b.end));
    const colBody = h('div', { class: 'cal-colbody', style: { height: `${pxH}px`, '--row': `${ROW}px` }, 'data-day': day });
    // Time off: a full-height (or partial) muted band.
    for (const t of pic.timeOff) {
      const m = onDay(day, t.start, t.end);
      if (!m) continue;
      const top = m.full ? 0 : Math.max(0, px(m.top)), bottom = m.full ? pxH : Math.min(pxH, px(m.bottom));
      colBody.append(h('div', { class: 'cal-off-band', style: { top: `${top}px`, height: `${Math.max(14, bottom - top)}px` }, title: `Time off${t.reason ? `: ${t.reason}` : ''}` },
        h('span', { class: 'cal-off-label' }, icon('event_busy', 14), t.reason || 'Time off')));
    }
    // External busy time: hatched in the source's colour.
    for (const b of pic.blocks) {
      const m = onDay(day, b.start, b.end);
      if (!m) continue;
      if (b.allDay || m.full) {
        colBody.append(h('div', { class: 'cal-allday', style: { '--src': `var(--${b.color})` }, title: `${b.title || 'Busy'} · ${b.label}` }, b.title || 'Busy'));
        continue;
      }
      const top = Math.max(0, px(m.top)), height = Math.max(12, px(m.bottom) - top);
      colBody.append(h('div', { class: 'cal-busy', style: { top: `${top}px`, height: `${height}px`, '--src': `var(--${b.color})` }, title: `${b.title || 'Busy'} · ${spanOf(b.start, b.end)} · ${b.label}` },
        height >= 22 ? h('span', { class: 'cal-busy-title' }, b.title || 'Busy') : null, height >= 38 ? h('span', { class: 'cal-busy-src' }, b.label) : null));
    }
    // Sessions and holds share lanes.
    const items = [
      ...dayBookings.map(b => ({ b, ...onDay(day, b.start, b.end), type: 'booking' })),
      ...pic.holds.filter(x => onDay(day, x.start, x.end)).map(x => ({ x, ...onDay(day, x.start, x.end), type: 'hold' })),
    ];
    for (const it of lanes(items)) {
      const top = px(it.top), height = Math.max(20, px(it.bottom) - top - 2);
      const pos = { top: `${top}px`, height: `${height}px`, left: `calc(${(it.lane / it.lanes) * 100}% + 3px)`, width: `calc(${100 / it.lanes}% - 6px)` };
      if (it.type === 'hold') {
        const hd = it.x;
        const clash = conflictsOf(pic, hd.id);
        colBody.append(h('button', {
          type: 'button', class: 'cal-hold', style: pos, title: `${hd.title} · ${spanOf(hd.start, hd.end)} · ${HOLD_WORD[hd.kind]} hold`,
          onclick: e => holdMenu(e.currentTarget, hd, onChange),
        }, h('span', { class: 'cal-hold-title' }, icon('front_hand', 13), hd.title), height >= 34 ? h('span', { class: 'cal-ev-sub' }, `${spanOf(hd.start, hd.end)} · ${HOLD_WORD[hd.kind]}`) : null,
        clash.length ? badge(clash) : null));
        continue;
      }
      const b = it.b;
      const clash = conflictsOf(pic, b.id);
      const past = Date.parse(b.end) < Date.now();
      const bufBefore = Math.round(prefs.bufferBefore / 60 * ROW), bufAfter = Math.round(prefs.bufferAfter / 60 * ROW);
      const ev = h('div', {
        class: `cal-ev k-${kindTone(b.kind)}${past ? ' past' : ''}${clash.length ? ' clash' : ''}`, style: pos, tabindex: '0', role: 'button',
        'aria-label': `${whoOf(b)}, ${spanOf(b.start, b.end)}, ${KIND_WORD[b.kind]}${clash.length ? `, ${clash.length} clash` : ''}`,
        'data-id': b.id,
      },
      bufBefore && !isGroup(b) ? h('span', { class: 'cal-buf before', style: { height: `${bufBefore}px` }, 'aria-hidden': 'true' }) : null,
      bufAfter ? h('span', { class: 'cal-buf after', style: { height: `${bufAfter}px` }, 'aria-hidden': 'true' }) : null,
      h('span', { class: 'cal-ev-who' }, isGroup(b) ? icon('groups', 13) : null, whoOf(b)),
      height >= 34 ? h('span', { class: 'cal-ev-sub' }, `${spanOf(b.start, b.end)}${isGroup(b) ? ` · ${b.attendeeCount ?? 0}/${b.capacity ?? '–'}` : ` · ${KIND_WORD[b.kind]}`}`) : null,
      height >= 52 && b.seriesId ? h('span', { class: 'cal-ev-sub' }, icon('event_repeat', 12), 'Weekly') : null,
      clash.length ? badge(clash) : null);
      ev.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSession(b, { onChange }); } });
      dragSession(ev, b, pic, { day, first, onChange });
      colBody.append(ev);
    }
    if (day === today) {
      const m = minutesOf(nowP.time);
      if (m >= first * 60 && m < last * 60) colBody.append(h('div', { class: 'cal-now', style: { top: `${px(m)}px` }, 'aria-hidden': 'true' }));
    }
    colBody.addEventListener('click', e => {
      if (e.target !== colBody && !e.target.classList.contains('cal-off-band') && !e.target.classList.contains('cal-busy')) return;
      const r = colBody.getBoundingClientRect();
      const mins = Math.max(first * 60, Math.min(last * 60 - SNAP, first * 60 + Math.floor(((e.clientY - r.top) / ROW) * 60 / SNAP) * SNAP));
      emptyMenu(colBody, day, mins, px, today, onChange);
    });
    const clashes = pic.conflicts.filter(c => londonParts(c.a.start).day === day).length;
    return h('div', { class: 'cal-col' + (day === today ? ' cal-today' : '') + (day < today ? ' before' : '') },
      h('div', { class: 'cal-colhead' },
        h('span', { class: 'cal-dow' }, DAYS[d.getUTCDay()]), h('span', { class: 'cal-dnum' }, String(d.getUTCDate())),
        h('span', { class: 'cal-dmeta' }, dayBookings.length ? `${dayBookings.length} session${dayBookings.length === 1 ? '' : 's'}` : '',
          clashes ? h('span', { class: 'cal-dclash', title: `${clashes} clash${clashes === 1 ? '' : 'es'}` }, icon('warning', 12), String(clashes)) : null)),
      colBody);
  });
  return h('div', { class: `cal-grid${days.length === 1 ? ' one' : ''}`, style: { '--cols': String(days.length) } }, gutter, cols);
}

/** The warning glyph on a clashing item, in the worst severity's tone. */
function badge(clashes) {
  const high = clashes.some(c => c.severity === 'high');
  return h('span', { class: `cal-badge tone-${high ? 'urgent' : 'attention'}`, title: clashes.map(c => c.text).join('\n') }, icon('warning', 13), h('span', { class: 'ui-sr' }, high ? 'Clash' : 'Check'));
}

/** Click on empty space: book or hold there. A marker shows where. */
function emptyMenu(colBody, day, mins, px, today, onChange) {
  colBody.querySelector('.cal-pick')?.remove();
  const marker = h('div', { class: 'cal-pick', style: { top: `${px(mins)}px`, height: `${ROW}px` } }, h('span', null, clockOf(mins)));
  colBody.append(marker);
  const start = londonIso(day, clockOf(mins));
  const past = Date.parse(start) <= Date.now();
  const m = menu(marker, [
    { label: `Book a client at ${shortDay(day)} ${clockOf(mins)}`, icon: 'event_available', disabled: past || day < today, onclick: () => openBook({ day, time: clockOf(mins), onDone: onChange }) },
    { label: 'Hold this time', icon: 'front_hand', disabled: past, onclick: () => openHold({ start, end: new Date(Date.parse(start) + 60 * 60_000).toISOString(), onDone: onChange }) },
  ], { label: 'At this time' });
  const watch = new MutationObserver(() => { if (!m.el.isConnected) { marker.remove(); watch.disconnect(); } });
  watch.observe(document.body, { childList: true });
}

function holdMenu(anchor, hd, onChange) {
  menu(anchor, [
    { label: `${hd.title} · ${spanOf(hd.start, hd.end)}`, icon: 'front_hand', disabled: true },
    'sep',
    { label: 'Rename', icon: 'edit', onclick: () => sheet('Rename the hold', (body, close) => {
      const input = h('input', { value: hd.title, maxlength: '80', 'aria-label': 'Title' });
      const status = h('div');
      fill(body, field('Title', input), status);
      return h('div', { class: 'row end' }, button('Cancel', () => close()), button('Save', e => busy(e.target, status, async () => {
        if (!input.value.trim()) throw new Error('Give it a title.');
        await api('PATCH', `/api/calendar/holds/${enc(hd.id)}`, { title: input.value.trim() });
        close(); onChange();
      }), { kind: 'primary' }));
    }) },
    hd.kind === 'trial' ? { label: 'Turn into a booking…', icon: 'how_to_reg', onclick: () => convertTrial(hd, onChange) } : null,
    { label: 'Release this time', icon: 'delete', danger: true, onclick: async () => {
      await api('DELETE', `/api/calendar/holds/${enc(hd.id)}`).catch(err => toast(err.message, { error: true }));
      toast('Hold released'); onChange();
    } },
  ], { label: hd.title });
}

function convertTrial(hd, onChange) {
  slideOver('Turn the trial into a booking', async (body, close) => {
    const list = await clients().catch(() => []);
    let chosen = null;
    const status = h('div');
    fill(body, h('p', { class: 'small muted' }, `${whenOf(hd.start)}: the hold becomes a 1:1 for the client you pick.`),
      field('Client', h('select', { onchange: e => { chosen = e.target.value || null; } }, h('option', { value: '' }, 'Choose…'), list.map(c => h('option', { value: c.id }, c.name)))),
      status, h('div', { class: 'cal-set-foot' }, button('Book it', async e => busy(e.target, status, async () => {
        if (!chosen) throw new Error('Choose the client.');
        await api('POST', `/api/calendar/holds/${enc(hd.id)}/convert`, { clientId: chosen });
        toast('Trial booked'); onChange(); close();
      }), { kind: 'primary' })));
  }, { className: 'cal-panel' });
}

/**
 * Drag a future session to move it: snaps to 15 minutes and to the day under
 * the pointer, checks locally while dragging (red when it would clash), and
 * asks before saving. A click without a drag opens the session.
 */
function dragSession(ev, b, pic, { first, onChange }) {
  const movable = Date.parse(b.start) > Date.now();
  ev.addEventListener('pointerdown', down => {
    if (down.button !== 0) return;
    const startX = down.clientX, startY = down.clientY;
    const length = Date.parse(b.end) - Date.parse(b.start);
    let ghost = null, target = null;
    const move = e => {
      if (!movable) return;
      if (!ghost && Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
      if (!ghost) {
        ghost = ev.cloneNode(true);
        ghost.classList.add('cal-ghost');
        ghost.removeAttribute('tabindex');
        ev.classList.add('cal-lifted');
        ev.setPointerCapture(down.pointerId);
      }
      ev.style.visibility = 'hidden';
      const under = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.classList?.contains('cal-colbody'));
      ev.style.visibility = '';
      if (!under) return;
      const r = under.getBoundingClientRect();
      const offset = (startY - ev.getBoundingClientRect().top);
      const mins = first * 60 + Math.round(((e.clientY - offset - r.top) / ROW) * 60 / SNAP) * SNAP;
      const day = under.dataset.day;
      const start = londonIso(day, clockOf(Math.max(0, Math.min(24 * 60 - SNAP, mins))));
      const why = localClash(pic, Date.parse(start), Date.parse(start) + length, b.kind, b.id) || (Date.parse(start) <= Date.now() ? 'in the past' : null);
      target = { start, why };
      if (ghost.parentElement !== under) under.append(ghost);
      ghost.style.top = `${((Math.max(0, mins) - first * 60) / 60) * ROW}px`;
      ghost.style.left = '3px'; ghost.style.width = 'calc(100% - 6px)';
      ghost.classList.toggle('bad', !!why);
      ghost.title = why ? `Not free: ${why}` : `Move to ${whenOf(start)}`;
      const label = ghost.querySelector('.cal-ev-sub') || ghost.querySelector('.cal-ev-who');
      if (label) label.textContent = `${londonParts(start).time} ${why ? `· ${why}` : '· free'}`;
    };
    const up = async () => {
      ev.removeEventListener('pointermove', move);
      ev.removeEventListener('pointerup', up);
      ev.removeEventListener('pointercancel', up);
      ev.classList.remove('cal-lifted');
      ghost?.remove();
      if (!ghost) { openSession(b, { onChange }); return; }
      if (!target || target.start === b.start) return;
      if (target.why === 'in the past') { toast('That time has passed.', { error: true }); return; }
      if (await confirmMove(b, target.start, { reason: target.why })) onChange();
    };
    ev.addEventListener('pointermove', move);
    ev.addEventListener('pointerup', up);
    ev.addEventListener('pointercancel', up);
  });
}

// MARK: - Phone width: a day strip and that day's agenda

function dayList(pic, today, pickDay, onChange) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(mondayOf(ui.day), i));
  const marked = new Set(pic.bookings.filter(keeps).map(b => londonParts(b.start).day));
  const strip = h('div', { class: 'cal-daystrip' }, days.map(d => {
    const p = parseDay(d);
    return h('button', { type: 'button', class: 'cal-daypill' + (d === ui.day ? ' on' : '') + (d === today ? ' cal-today' : ''), 'aria-pressed': String(d === ui.day), onclick: () => pickDay(d) },
      h('span', { class: 'tiny' }, DAYS[p.getUTCDay()]), h('strong', null, String(p.getUTCDate())), h('span', { class: 'cal-mark' + (marked.has(d) ? ' on' : '') }));
  }));
  const day = ui.day;
  const rows = [];
  for (const t of pic.timeOff) if (onDay(day, t.start, t.end)) rows.push({ at: t.allDay ? null : t.start, el: agendaRow(t.allDay ? 'All day' : londonParts(t.start).time, 'off', t.reason || 'Time off', 'Time off', 'event_busy') });
  for (const x of pic.blocks) if (onDay(day, x.start, x.end)) rows.push({ at: x.allDay ? null : x.start, el: agendaRow(x.allDay ? 'All day' : londonParts(x.start).time, 'busy', x.title || 'Busy', `${x.allDay ? '' : `${spanOf(x.start, x.end)} · `}${x.label}`, 'event_busy', `var(--${x.color})`) });
  for (const x of pic.holds) if (onDay(day, x.start, x.end)) rows.push({ at: x.start, el: agendaRow(londonParts(x.start).time, 'hold', x.title, `${spanOf(x.start, x.end)} · ${HOLD_WORD[x.kind]} hold`, 'front_hand') });
  for (const b of pic.bookings.filter(keeps)) {
    if (!onDay(day, b.start, b.end)) continue;
    const clash = conflictsOf(pic, b.id);
    const row = agendaRow(londonParts(b.start).time, `k-${kindTone(b.kind)}`, whoOf(b), `${spanOf(b.start, b.end)} · ${KIND_WORD[b.kind]}${b.location && b.location !== 'Video call' ? ` · ${b.location}` : ''}`, isGroup(b) ? 'groups' : b.kind === 'video' ? 'videocam' : 'person', null, clash);
    row.addEventListener('click', () => openSession(b, { onChange }));
    rows.push({ at: b.start, el: row });
  }
  rows.sort((a, b) => (a.at ? 1 : 0) - (b.at ? 1 : 0) || String(a.at).localeCompare(String(b.at)));
  return h('div', { class: 'cal-daylist' }, strip,
    h('div', { class: 'cal-eyebrow spread' }, h('span', null, longDay(day)), h('span', null, `${rows.length} item${rows.length === 1 ? '' : 's'}`)),
    rows.length ? h('div', { class: 'cal-agenda' }, rows.map(r => r.el)) : emptyHero({ icon: 'calendar_month', title: 'A clear day.', line: 'Nothing booked or blocked.', action: { label: 'Book a client', onclick: () => openBook({ day, onDone: onChange }) } }));
}

function agendaRow(time, tone, title, detail, glyph, color = null, clashes = []) {
  return h('button', { type: 'button', class: `cal-arow ${tone}`, style: color ? { '--src': color } : null },
    h('span', { class: 'cal-arow-time t-num' }, time),
    h('span', { class: 'cal-arow-bar', 'aria-hidden': 'true' }),
    h('span', { class: 'cal-arow-icon' }, icon(glyph, 18)),
    h('span', { class: 'grow' }, h('span', { class: 'cal-arow-title' }, title), h('span', { class: 'cal-arow-detail' }, detail)),
    clashes.length ? badge(clashes) : null);
}

// MARK: - Waitlist (F21)

const PREFER = { any: 'Any time', morning: 'Mornings', midday: 'Middays', evening: 'Evenings' };

function waitlist(items, reload) {
  const add = h('button', { type: 'button', class: 'btn', onclick: () => addToWaitlist(reload) }, icon('person_add', 18), 'Add someone');
  if (!items.length) return h('div', null, emptyHero({ icon: 'hourglass_empty', title: 'Nobody is waiting.', line: 'Add a client who wants a session when one frees up. When a booking is cancelled, matches appear here and in your inbox.', action: { label: 'Add someone', onclick: () => addToWaitlist(reload) } }));
  const sorted = [...items].sort((a, b) => (b.matchStart && Date.parse(b.matchStart) > Date.now() ? 1 : 0) - (a.matchStart && Date.parse(a.matchStart) > Date.now() ? 1 : 0) || a.createdAt.localeCompare(b.createdAt));
  return h('div', null, h('div', { class: 'cal-wait-head' }, h('span', { class: 'small muted' }, `${items.length} waiting`), add),
    h('div', { class: 'cal-wait-grid' }, sorted.map(w => {
      const status = h('div');
      const matched = w.matchStart && Date.parse(w.matchStart) > Date.now() && w.status === 'waiting';
      return h('article', { class: 'cal-wait' + (matched ? ' matched' : '') },
        h('div', { class: 'cal-wait-top' }, avatar(w.client?.initials || initials(w.client?.name || '?'), 36),
          h('div', { class: 'grow' }, h('div', { class: 'strong' }, w.client?.name || 'Client'),
            h('div', { class: 'tiny muted' }, `${w.kind === 'any' ? 'Any session' : KIND_WORD[w.kind]} · ${PREFER[w.prefer] ?? w.prefer}`)),
          h('span', { class: `cal-state tone-${w.status === 'offered' ? 'ok' : matched ? 'attention' : 'data'}` }, icon(w.status === 'offered' ? 'send' : matched ? 'notifications_active' : 'hourglass_empty', 14), w.status === 'offered' ? 'Offered' : matched ? 'Slot free' : 'Waiting')),
        h('div', { class: 'cal-wait-window' }, icon('calendar_month', 16), `${shortDay(w.fromDay)} – ${shortDay(w.toDay)}`),
        w.note ? h('p', { class: 'cal-wait-note' }, w.note) : null,
        matched ? h('div', { class: 'cal-wait-match' }, h('div', null, h('div', { class: 'tiny faint' }, 'Freed'), h('div', { class: 'strong' }, whenOf(w.matchStart))),
          h('button', { type: 'button', class: 'btn primary small', onclick: e => busy(e.currentTarget, status, async () => {
            await api('POST', `/api/waitlist/${enc(w.id)}/offer`, { start: w.matchStart });
            toast(`Offered to ${firstName(w.client?.name)}. They book it in the app.`); reload();
          }) }, 'Offer this slot')) : null,
        w.status === 'offered' && w.offeredStart ? h('p', { class: 'tiny muted' }, `Offered ${whenOf(w.offeredStart)}: they book it themselves in the app.`) : null,
        h('div', { class: 'cal-wait-actions' },
          button('Find a slot', () => openFinder({ client: w.client, from: w.fromDay > todayLondon() ? w.fromDay : todayLondon(), to: w.toDay }), { small: true }),
          button('Remove', e => busy(e.target, status, async () => { await api('DELETE', `/api/waitlist/${enc(w.id)}`); toast('Removed from the waitlist'); reload(); }), { small: true })),
        status);
    })));
}

function addToWaitlist(reload) {
  const today = todayLondon();
  const st = { clientId: null, kind: 'any', fromDay: today, toDay: addDays(today, 13), prefer: 'any', note: '' };
  slideOver('Add to the waitlist', async (body, close) => {
    const list = await clients().catch(() => []);
    const status = h('div');
    fill(body,
      field('Client', h('select', { onchange: e => { st.clientId = e.target.value || null; } }, h('option', { value: '' }, 'Choose…'), list.map(c => h('option', { value: c.id }, c.name)))),
      field('Kind', segmentedNav([['any', 'Any'], ['inperson', '1:1'], ['video', 'Video']], st.kind, v => { st.kind = v; }, { label: 'Kind' })),
      h('div', { class: 'grid2' },
        field('From', h('input', { type: 'date', value: st.fromDay, min: today, onchange: e => { st.fromDay = e.target.value; } })),
        field('To', h('input', { type: 'date', value: st.toDay, min: today, onchange: e => { st.toDay = e.target.value; } }))),
      field('Time of day', segmentedNav([['any', 'Any'], ['morning', 'Morning'], ['midday', 'Midday'], ['evening', 'Evening']], st.prefer, v => { st.prefer = v; }, { label: 'Time of day' })),
      field('Note', h('textarea', { rows: '2', maxlength: '280', placeholder: 'After work, any weekday', oninput: e => { st.note = e.target.value; } })),
      status,
      h('div', { class: 'cal-set-foot' }, button('Add to the waitlist', e => busy(e.target, status, async () => {
        if (!st.clientId) throw new Error('Choose the client.');
        await api('POST', '/api/waitlist', { ...st, note: st.note.trim() });
        toast('Added to the waitlist'); reload(); close();
      }), { kind: 'primary' })));
  }, { className: 'cal-panel' });
}

// MARK: - A class (or any session) on its own page

async function classPage(el, { id, day }, view) {
  const back = link('/schedule', { class: 'cal-back' }, icon('chevron_left', 18), 'Calendar');
  el.append(back, skeleton('card', { rows: 3 }));
  const b = await findBookingNear(id, day ? londonIso(day, '12:00') : null).catch(() => null);
  if (!view.fresh()) return;
  setCrumbs([{ label: 'Calendar', path: '/schedule' }, { label: b ? whoOf(b) : 'Session' }]);
  if (!b) { fill(el, back, emptyHero({ icon: 'event_busy', title: 'Session not found.', line: 'It may have been cancelled.', action: { label: 'Back to the calendar', path: '/schedule' } })); return; }
  const p = londonParts(b.start);
  const people = b.attendees?.length ? b.attendees : b.client ? [b.client] : [];
  const notes = await api('GET', `/api/sessions/${enc(b.id)}/notes`).catch(() => ({ notes: [] }));
  if (!view.fresh()) return;
  const byClient = new Map(notes.notes.map(n => [n.clientId, n]));
  fill(el, back,
    pageHead({ eyebrow: `${KIND_WORD[b.kind]} · ${b.location || ''}`, title: b.title || KIND_WORD[b.kind], sub: `${longDay(p.day)} · ${spanOf(b.start, b.end)}`,
      actions: [h('button', { type: 'button', class: 'btn primary', onclick: () => openNotes(b) }, icon('edit_note', 18), 'Notes and attendance'),
        Date.parse(b.start) > Date.now() ? h('button', { type: 'button', class: 'btn', onclick: () => moveSheet(b) }, icon('edit_calendar', 18), 'Move') : null] }),
    h('div', { class: 'cal-eyebrow spread' }, h('span', null, 'Attendees'), h('span', null, b.capacity ? `${people.length} of ${b.capacity}` : String(people.length))),
    people.length ? h('div', { class: 'cal-roster' }, people.map(x => {
      const a = attendanceOf(byClient.get(x.id)?.attendance);
      return link(`/clients/${enc(x.id)}/sessions`, { class: 'cal-roster-row' }, avatar(initials(x.name), 32), h('span', { class: 'grow strong' }, x.name),
        a ? h('span', { class: `cal-state tone-${a[3]}` }, icon(a[2], 14), a[1]) : h('span', { class: 'tiny faint' }, 'Not marked'), icon('chevron_right', 18));
    })) : emptyHero({ icon: 'groups', title: 'Nobody yet.', line: 'Clients join classes from the app.' }));
}

