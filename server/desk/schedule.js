/*
 * Schedule: the coach's week (the iPhone app's ScheduleView), booking a client
 * or creating a class (CoachBookSheet, BookSessionView), weekly availability
 * (AvailabilitySheet) and a session's detail (ClassDetailView).
 *
 * Wide screens get the full seven-day grid with time rows; at phone width the
 * week becomes a day strip and that day's sessions as rows (SessionRow).
 *
 *   #/schedule
 *   #/schedule/class/<bookingId>[/<YYYY-MM-DD>]   (the day is an optional hint
 *     for finding the booking; other screens may link without it)
 */
import {
  addDays, api, avatar, busy, button, clients, confirmBox, DAYS, emptyCard, errorLine, eyebrow, field, fill,
  fmtShort, fmtTime, go, h, icon, initials, link, loading, londonParts, mondayOf, MONTHS, parseDay, q, route,
  screenHeader, segmented, sheet, slotColor, todayLondon, toast, DAYS_LONG,
} from './core.js';

// MARK: - Module state (kept while the coach moves between screens)

const FILTERS = [['all', 'All'], ['inperson', '1:1'], ['video', 'Video'], ['group', 'Group']];
const LEGEND = [['inperson', '1:1 in person'], ['video', 'Video call'], ['group', 'Group class']];
const KIND_LABEL = { video: 'Video', group: 'Group', inperson: '1:1' };
const ui = { monday: null, filter: 'all', day: null };
/** Bookings seen lately, by id, so a session's page opens without a search. */
const seen = new Map();

const keeps = (filter, b) => filter === 'all' || b.kind === filter;
const isGroup = b => b.kind === 'group';
const kindLabel = b => KIND_LABEL[b.kind] || '1:1';
const weekOf = monday => Array.from({ length: 7 }, (_, i) => addDays(monday, i));
const minutesOf = time => { const [hh, mm] = time.split(':').map(Number); return hh * 60 + mm; };
/** "Monday 23 Nov" (the iPhone app's Fmt.longDay). */
const fmtLongDay = s => { const d = parseDay(s); return `${DAYS_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const fmtShortDay = s => { const d = parseDay(s); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

/** A London wall-clock time on a London day, as a UTC ISO instant (handles BST). */
function londonToUtcIso(day, time) {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const want = Date.UTC(y, m - 1, d, hh, mm);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = londonParts(new Date(guess).toISOString());
    const [py, pm, pd] = p.day.split('-').map(Number);
    const [ph, pmin] = p.time.split(':').map(Number);
    guess += want - Date.UTC(py, pm - 1, pd, ph, pmin);
  }
  return new Date(guess).toISOString();
}

async function loadWeek(monday) {
  const { bookings } = await api('GET', `/api/bookings?${q({ from: monday, to: addDays(monday, 6) })}`);
  for (const b of bookings) seen.set(b.id, b);
  return bookings;
}

/** Where a session opens: the client for a 1:1 (as the iPhone app does), else the class page. */
const sessionPath = b => (b.client && !isGroup(b) ? `/clients/${encodeURIComponent(b.client.id)}` : `/schedule/class/${encodeURIComponent(b.id)}/${londonParts(b.start).day}`);

// MARK: - Schedule (week grid)

route('/schedule', async (el, _params, view) => {
  const today = todayLondon();
  if (!ui.monday) ui.monday = mondayOf(today);
  const days = weekOf(ui.monday);
  if (!ui.day || !days.includes(ui.day)) ui.day = days.includes(today) ? today : days[0];

  let bookings = null;
  let error = null;
  const setWeek = monday => { ui.monday = monday; ui.day = null; go('/schedule'); };

  const head = screenHeader(`Week of ${fmtShort(days[0])}`, 'Schedule',
    h('button', { class: 'icon-btn square', 'aria-label': 'Availability', title: 'Availability', onclick: () => availabilitySheet() }, icon('clock', 17)),
    h('button', { class: 'btn primary pill', type: 'button', onclick: () => openBook() }, icon('plus', 18), 'Book'));
  const weekNav = h('div', { class: 'sched-weeknav' },
    h('button', { class: 'icon-btn', 'aria-label': 'Previous week', onclick: () => setWeek(addDays(ui.monday, -7)) }, icon('back', 16)),
    button('This week', () => setWeek(mondayOf(today)), { small: true }),
    h('button', { class: 'icon-btn', 'aria-label': 'Next week', onclick: () => setWeek(addDays(ui.monday, 7)) }, icon('chevron', 16)));
  const filters = h('div', { class: 'sched-filters', role: 'group', 'aria-label': 'Filter sessions' });
  const body = h('div', null, loading());
  el.append(head, weekNav, filters, body);

  async function openBook() {
    const day = days.includes(today) ? (ui.day >= today ? ui.day : today) : ui.day;
    const done = await bookSheet(day);
    if (done) { toast(done === 'class' ? 'Class created' : 'Booked'); load(); }
  }

  function drawFilters() {
    fill(filters, FILTERS.map(([v, label]) => {
      const count = (bookings || []).filter(b => keeps(v, b)).length;
      return h('button', { class: 'chip' + (ui.filter === v ? ' on' : ''), 'aria-pressed': String(ui.filter === v), onclick: () => { ui.filter = v; draw(); } }, `${label} · ${count}`);
    }));
  }

  function draw() {
    drawFilters();
    if (!bookings) {
      fill(body, error ? card(errorLine(error), button('Try again', load, { small: true })) : loading());
      return;
    }
    const shown = bookings.filter(b => keeps(ui.filter, b));
    fill(body,
      error ? errorLine(error) : null,
      weekGrid(days, shown, today),
      dayView(days, shown, today, () => draw()),
      legend(),
      h('p', { class: 'tiny faint' }, h('span', { class: 'wide-only' }, 'Click a block for details. '), h('span', { class: 'narrow-only' }, 'Tap a session for details. '), 'The clock button edits your weekly availability.'));
  }

  async function load() {
    try {
      const out = await loadWeek(ui.monday);
      if (!view.fresh()) return;
      bookings = out;
      error = null;
    } catch (err) {
      if (!view.fresh()) return;
      error = err;
    }
    draw();
  }

  draw();
  await load();
});

const card = (...children) => h('div', { class: 'card' }, ...children);

/** The colour key for the kinds of session on the grid. */
const legend = () => h('div', { class: 'sched-legend' }, LEGEND.map(([kind, label]) =>
  h('span', { class: 'row gap4' }, h('span', { class: 'swatch', style: { background: slotColor(kind) } }), h('span', { class: 'tiny muted' }, label))));

/** Side-by-side lanes for sessions that overlap on one day. */
function lanes(items) {
  const sorted = [...items].sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  let cluster = [], clusterEnd = -1;
  const finish = () => { const n = Math.max(...cluster.map(c => c.lane)) + 1; cluster.forEach(c => { c.lanes = n; }); };
  for (const it of sorted) {
    if (cluster.length && it.top >= clusterEnd) { finish(); cluster = []; clusterEnd = -1; }
    const used = new Set(cluster.filter(c => c.bottom > it.top).map(c => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    it.lane = lane;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.bottom);
  }
  if (cluster.length) finish();
  return sorted;
}

/** Seven day columns with time rows (wide screens). */
function weekGrid(days, shown, today) {
  const items = shown.map(b => {
    const s = londonParts(b.start), e = londonParts(b.end);
    const startMin = minutesOf(s.time);
    let endMin = e.day === s.day ? minutesOf(e.time) : 24 * 60;
    endMin = Math.max(endMin, startMin + 30);
    return { b, day: s.day, top: startMin, bottom: endMin };
  });
  // The iPhone grid runs 06:00 to 21:00; stretch it if a session falls outside.
  let first = 6, last = 20;
  for (const it of items) { first = Math.min(first, Math.floor(it.top / 60)); last = Math.max(last, Math.ceil(it.bottom / 60) - 1); }
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const ROW = 46; // px per hour
  const nowParts = londonParts(new Date().toISOString());

  const hourCol = h('div', { class: 'wg-hours' }, h('div', { class: 'wg-head' }), hours.map(hr => h('div', { class: 'wg-hour', style: { height: `${ROW}px` } }, `${String(hr).padStart(2, '0')}:00`)));
  const cols = days.map(day => {
    const isToday = day === today;
    const d = parseDay(day);
    const blocks = lanes(items.filter(it => it.day === day)).map(it => {
      const b = it.b;
      const top = (it.top - first * 60) / 60 * ROW;
      const height = Math.max(18, (it.bottom - it.top) / 60 * ROW - 2);
      const color = slotColor(b.kind);
      const who = isGroup(b) ? (b.title || 'Group class') : (b.client?.name || b.title || '1:1');
      const sub = isGroup(b) ? `${fmtTime(b.start)} · ${b.attendeeCount ?? b.attendees?.length ?? 0}${b.capacity ? `/${b.capacity}` : ''}` : `${fmtTime(b.start)} · ${kindLabel(b)}`;
      const past = new Date(b.end) < new Date();
      return link(sessionPath(b), {
        class: 'wg-block' + (past ? ' past' : ''),
        title: `${who}\n${fmtTime(b.start)}–${fmtTime(b.end)} · ${kindLabel(b)}${b.location ? ` · ${b.location}` : ''}`,
        style: {
          top: `${top}px`, height: `${height}px`,
          left: `calc(${(it.lane / it.lanes) * 100}% + 2px)`, width: `calc(${100 / it.lanes}% - 4px)`,
          background: `color-mix(in srgb, ${color} 24%, transparent)`,
          borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
          boxShadow: `inset 3px 0 0 ${color}`,
        },
      }, h('span', { class: 'wg-who' }, who), height >= 30 ? h('span', { class: 'wg-sub' }, sub) : null);
    });
    let nowLine = null;
    if (isToday) {
      const m = minutesOf(nowParts.time);
      if (m >= first * 60 && m < (last + 1) * 60) nowLine = h('div', { class: 'wg-now', style: { top: `${(m - first * 60) / 60 * ROW}px` } });
    }
    return h('div', { class: 'wg-col' },
      h('div', { class: 'wg-head' + (isToday ? ' today' : '') }, h('span', null, DAYS[d.getUTCDay()]), ' ', h('strong', null, String(d.getUTCDate()))),
      h('div', { class: 'wg-body', style: { height: `${hours.length * ROW}px` } },
        hours.map((_, i) => h('div', { class: 'wg-line', style: { top: `${i * ROW}px` } })),
        nowLine, blocks));
  });
  return h('div', { class: 'week-grid' }, hourCol, cols);
}

/** Phone width: a day strip and that day's sessions as rows. */
function dayView(days, shown, today, redraw) {
  const marked = new Set(shown.map(b => londonParts(b.start).day));
  const strip = h('div', { class: 'day-strip' }, days.map(day => {
    const d = parseDay(day);
    const on = day === ui.day;
    return h('button', { class: 'day-pill' + (on ? ' on' : '') + (day === today ? ' today' : ''), 'aria-pressed': String(on), onclick: () => { ui.day = day; redraw(); } },
      h('span', { class: 'tiny' }, DAYS[d.getUTCDay()]), h('span', { class: 'strong' }, String(d.getUTCDate())),
      h('span', { class: 'mark' + (marked.has(day) ? ' on' : '') }));
  }));
  const list = shown.filter(b => londonParts(b.start).day === ui.day).sort((a, b) => a.start.localeCompare(b.start));
  const now = Date.now();
  const next = list.find(b => new Date(b.start) > now);
  return h('div', { class: 'day-view' }, strip,
    eyebrow(fmtLongDay(ui.day), list.length ? `${list.length} session${list.length === 1 ? '' : 's'}` : null),
    list.length ? h('div', { class: 'stack' }, list.map(b => sessionRow(b, b === next))) : emptyCard('calendar', 'Nothing booked', 'Use Book to add a client or a class.'));
}

/** The iPhone app's SessionRow: times, colour bar, who, what, and Next / done. */
export function sessionRow(b, isNext = false) {
  const done = new Date(b.end) < new Date();
  const who = b.client ? b.client.name : (b.title || 'Group');
  const count = b.attendeeCount ?? b.attendees?.length ?? 0;
  return h('div', { class: 'session-row' + (done ? ' done' : '') },
    h('div', { class: 'sr-times' }, h('div', { class: 'tiny strong' }, fmtTime(b.start)), h('div', { class: 'sr-end' }, fmtTime(b.end))),
    link(sessionPath(b), { class: 'sr-card' + (isNext ? ' next' : '') },
      h('span', { class: 'sr-bar', style: { background: slotColor(b.kind) } }),
      avatar(b.client ? initials(b.client.name) : 'G', 28),
      h('div', { class: 'grow' },
        h('div', { class: 'strong small clamp1' }, isGroup(b) ? `${who} · ${count} clients` : who),
        h('div', { class: 'tiny faint clamp1' }, [b.title, kindLabel(b)].filter(Boolean).join(' · '))),
      isNext ? h('span', { class: 'next-pill' }, 'Next') : done ? icon('check', 18) : h('span', { class: 'faint' }, icon('chevron', 18))));
}

// MARK: - Session (class) detail

/** Find a booking by id: the cache, then the hinted day, then up to four months either side of today. */
async function findBooking(id, hint) {
  const cached = seen.get(id);
  const tries = [];
  const around = cached ? londonParts(cached.start).day : (/^\d{4}-\d{2}-\d{2}$/.test(hint || '') ? hint : null);
  if (around) tries.push([around, around]);
  const today = todayLondon();
  tries.push([addDays(today, -1), addDays(today, 60)], [addDays(today, -62), addDays(today, -2)], [addDays(today, 61), addDays(today, 122)], [addDays(today, -125), addDays(today, -63)]);
  for (const [from, to] of tries) {
    const { bookings } = await api('GET', `/api/bookings?${q({ from, to })}`);
    for (const b of bookings) seen.set(b.id, b);
    const hit = bookings.find(b => b.id === id);
    if (hit) return hit;
  }
  return null;
}

route('/schedule/class/:id/:day?', async (el, { id, day }, view) => {
  const back = link('/schedule', { class: 'back-link' }, icon('back', 18), 'Schedule');
  el.append(back, loading());
  const b = await findBooking(id, day);
  if (!view.fresh()) return;
  if (!b) {
    fill(el, back, emptyCard('calendar', 'Session not found', 'It may have been cancelled.'));
    return;
  }
  const s = londonParts(b.start);
  const people = b.attendees?.length ? b.attendees : (b.client ? [b.client] : []);
  const count = b.attendeeCount ?? b.attendees?.length ?? 0;
  const status = h('div');
  const cancellable = b.cancellable !== false && new Date(b.start) > new Date();
  const cancelBtn = cancellable ? button(isGroup(b) ? 'Cancel class' : 'Cancel booking', async () => {
    if (!(await confirmBox('Cancel this?', { ok: 'Cancel it', danger: true, detail: isGroup(b) ? 'Everyone booked on it loses their place.' : `${b.client?.name || 'The client'} is told.` }))) return;
    await busy(cancelBtn, status, async () => {
      await api('DELETE', `/api/bookings/${encodeURIComponent(b.id)}`);
      seen.delete(b.id);
      toast(isGroup(b) ? 'Class cancelled' : 'Booking cancelled');
      go('/schedule');
    });
  }, { kind: 'danger' }) : null;

  fill(el, back,
    h('div', { class: 'class-head' },
      h('span', { class: 'swatch big', style: { background: slotColor(b.kind) } }),
      h('div', null,
        h('h1', null, b.title || kindLabel(b)),
        h('div', { class: 'small muted' }, `${fmtLongDay(s.day)} · ${fmtTime(b.start)}–${fmtTime(b.end)}`),
        b.location ? h('div', { class: 'small faint' }, b.location) : null)),
    isGroup(b) ? null : h('div', { class: 'mt sched-purpose' }, field('Purpose', purposeSelect(b.purpose, async v => {
      await busy(null, status, async () => {
        const out = await api('PATCH', `/api/bookings/${encodeURIComponent(b.id)}`, { purpose: v });
        b.purpose = out.purpose;
        toast(v ? `Marked as ${PURPOSES.find(x => x[0] === v)[1].toLowerCase()}` : 'Purpose cleared');
      });
    }), 'Planning and accountability sessions appear on the client’s Plan and Review.')),
    eyebrow('Attendees', b.capacity ? `${count} of ${b.capacity}` : null),
    people.length
      ? h('div', { class: 'card flush' }, people.map(p => link(`/clients/${encodeURIComponent(p.id)}`, { class: 'person-row' },
        avatar(initials(p.name), 28), h('div', { class: 'grow' }, p.name), icon('chevron', 18))))
      : emptyCard('people', 'Nobody yet'),
    status,
    cancelBtn ? h('div', { class: 'mt' }, cancelBtn) : null);
});

// MARK: - Book: class or client session (CoachBookSheet)

/** Resolves true when something was booked or created. */
function bookSheet(day) {
  return sheet('Book', (body, close) => {
    let mode = 'client';
    const draw = () => {
      fill(body, segmented([['client', 'Book a client'], ['group', 'Create a class']], mode, v => { mode = v; draw(); }), h('div', { class: 'mt' }, mode === 'client' ? clientPicker() : classForm()));
    };

    function clientPicker() {
      const box = h('div', null, loading());
      clients().then(list => {
        fill(box, list.length
          ? h('div', { class: 'card flush' }, list.map(c => h('button', { class: 'person-row', type: 'button', onclick: () => fill(body, bookSession(c, day, () => draw(), close)) },
            avatar(c.initials || c.name, 28), h('div', { class: 'grow' }, c.name), icon('chevron', 18))))
          : emptyCard('clients', 'No clients yet'));
      }).catch(err => fill(box, errorLine(err), button('Try again', () => draw(), { small: true })));
      return box;
    }

    function classForm() {
      // Default: 17:00 on the chosen day, or an hour from now if that has passed.
      let startDay = day, startTime = '17:00';
      if (new Date(londonToUtcIso(startDay, startTime)) < new Date()) {
        const soon = new Date(Date.now() + 3_600_000);
        soon.setUTCMinutes(Math.ceil(soon.getUTCMinutes() / 15) * 15, 0, 0);
        ({ day: startDay, time: startTime } = londonParts(soon.toISOString()));
      }
      const title = h('input', { value: 'Conditioning · Group', maxlength: '80' });
      const date = h('input', { type: 'date', value: startDay, min: todayLondon() });
      const time = h('input', { type: 'time', value: startTime, step: '300' });
      const minutes = h('input', { type: 'number', value: '60', min: '15', max: '180', step: '15' });
      const capacity = h('input', { type: 'number', value: '8', min: '1', max: '50', step: '1' });
      const location = h('input', { value: 'Studio 2', maxlength: '80' });
      const status = h('div');
      const create = button('Create class', async () => {
        await busy(create, status, async () => {
          const mins = Number(minutes.value), cap = Number(capacity.value);
          if (!title.value.trim()) throw new Error('Give the class a title.');
          if (!date.value || !time.value) throw new Error('Choose when it starts.');
          if (!Number.isInteger(mins) || mins < 15 || mins > 180) throw new Error('Length is 15 to 180 minutes.');
          if (!Number.isInteger(cap) || cap < 1 || cap > 50) throw new Error('Capacity is 1 to 50.');
          const start = londonToUtcIso(date.value, time.value);
          if (new Date(start) < new Date()) throw new Error('That time has passed.');
          const end = new Date(new Date(start).getTime() + mins * 60_000).toISOString();
          await api('POST', '/api/classes', { title: title.value.trim(), start, end, capacity: cap, location: location.value.trim() });
          close('class');
        });
      }, { kind: 'primary' });
      title.addEventListener('input', () => { create.disabled = !title.value.trim(); });
      return h('div', null,
        field('Title', title),
        h('div', { class: 'grid2' }, field('Starts', date), field('Time (London)', time)),
        h('div', { class: 'grid2' }, field('Minutes', minutes), field('Capacity', capacity)),
        field('Location', location),
        status,
        h('div', { class: 'mt' }, create),
        h('p', { class: 'tiny faint' }, 'Clients see every class you create and join for free.'));
    }

    draw();
    return h('div', { class: 'row end' }, button('Done', () => close()));
  }, { wide: true });
}

// MARK: - Book a client into a slot (BookSessionView, coach side)

const SLOT_KINDS = [['inperson', '1:1 · in person'], ['video', 'Video call']];
/** What a 1:1 is for: the client app shows planning sessions on Plan and accountability sessions on Review. */
const PURPOSES = [['', 'None'], ['planning', 'Planning session'], ['review', 'Accountability session']];
const purposeSelect = (value, onchange) => h('select', { onchange: e => onchange(e.target.value || null) },
  PURPOSES.map(([v, l]) => h('option', { value: v, selected: v === (value || '') }, l)));

function bookSession(client, initialDay, onBack, close) {
  const today = todayLondon();
  let day = initialDay < today ? today : initialDay;
  let kind = 'inperson';
  let purpose = null;
  let chosen = null;
  let slots = null;
  let loadSeq = 0;

  const root = h('div');
  const slotBox = h('div');
  const summary = h('div', { class: 'card' });
  const status = h('div');
  const confirm = button('Confirm booking', async () => {
    if (!chosen) return;
    await busy(confirm, status, async () => {
      await api('POST', '/api/bookings', { start: chosen.start, kind, clientId: client.id, purpose });
      close(true);
    });
  }, { kind: 'primary' });
  confirm.classList.add('wide-btn');

  const kindLabelOf = () => SLOT_KINDS.find(k => k[0] === kind)[1];
  function drawSummary() {
    confirm.disabled = !chosen;
    fill(summary,
      h('div', { class: 'spread small' }, h('span', null, chosen ? `${fmtShortDay(londonParts(chosen.start).day)} · ${fmtTime(chosen.start)}–${fmtTime(chosen.end)}` : 'Pick a time'), h('span', null, chosen?.location || kindLabelOf())),
      h('div', { class: 'divider' }),
      h('div', { class: 'spread small faint' }, h('span', null, 'Uses 1 credit'), h('span', null, kindLabelOf())));
  }
  function drawSlots() {
    if (!slots) { fill(slotBox, h('p', { class: 'muted' }, 'Finding times…')); return; }
    const upcoming = slots.filter(s => new Date(s.start) > new Date());
    if (!upcoming.length) { fill(slotBox, emptyCard('clock', 'No times this day', 'Try another day or session type.')); return; }
    fill(slotBox, h('div', { class: 'slot-grid' }, upcoming.map(s => h('button', {
      type: 'button', class: 'slot' + (chosen?.start === s.start ? ' on' : '') + (s.open ? '' : ' taken'), disabled: !s.open,
      'aria-pressed': String(chosen?.start === s.start),
      onclick: () => { chosen = s; drawSlots(); drawSummary(); },
    }, fmtTime(s.start)))));
  }
  async function loadSlots() {
    const mine = ++loadSeq;
    chosen = null; slots = null;
    drawSlots(); drawSummary();
    try {
      const out = await api('GET', `/api/slots?${q({ from: day, to: day, kind })}`);
      if (mine !== loadSeq) return;
      slots = out.slots.sort((a, b) => a.start.localeCompare(b.start));
      drawSlots();
    } catch (err) {
      if (mine !== loadSeq) return;
      fill(slotBox, errorLine(err), button('Try again', loadSlots, { small: true }));
    }
  }
  function draw() {
    const monday = mondayOf(day);
    const days = weekOf(monday);
    fill(root,
      h('button', { class: 'link small back-btn', type: 'button', onclick: onBack }, icon('back', 18), 'All clients'),
      h('div', { class: 'card row' }, avatar(client.initials || client.name, 34), h('span', { class: 'strong' }, `Booking for ${client.name}`)),
      h('div', { class: 'sched-weeknav' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous week', disabled: monday <= mondayOf(today), onclick: () => { day = addDays(day, -7) < today ? today : addDays(day, -7); draw(); } }, icon('back', 16)),
        h('span', { class: 'small muted' }, `Week of ${fmtShort(monday)}`),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next week', onclick: () => { day = addDays(day, 7); draw(); } }, icon('chevron', 16))),
      h('div', { class: 'day-strip' }, days.map(d => {
        const p = parseDay(d);
        return h('button', { type: 'button', class: 'day-pill' + (d === day ? ' on' : ''), disabled: d < today, 'aria-pressed': String(d === day), onclick: () => { day = d; draw(); } },
          h('span', { class: 'tiny' }, DAYS[p.getUTCDay()]), h('span', { class: 'strong' }, String(p.getUTCDate())));
      })),
      h('div', { class: 'mt' }, segmented(SLOT_KINDS, kind, v => { kind = v; draw(); })),
      h('div', { class: 'mt' }, field('Purpose', purposeSelect(purpose, v => { purpose = v; }), 'Planning and accountability sessions appear on the client’s Plan and Review.')),
      h('div', { class: 'mt' }, slotBox),
      summary, status, confirm,
      h('p', { class: 'tiny faint center' }, 'Free cancellation up to 24h before'));
    loadSlots();
  }
  draw();
  return root;
}

// MARK: - Availability (AvailabilitySheet)

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function availabilitySheet() {
  return sheet('Availability', (body, close) => {
    let rules = null;
    const status = h('div');
    const list = h('div');
    const save = button('Save availability', async () => {
      await busy(save, status, async () => {
        const clean = rules.map(r => ({ ...r, slotMinutes: Number(r.slotMinutes), location: r.location || '' }));
        await api('PUT', '/api/availability', { rules: clean });
        toast('Availability saved');
        close(true);
      });
    }, { kind: 'primary' });
    save.disabled = true;
    const add = button(h('span', { class: 'row gap4' }, icon('plus', 18), 'Add hours'), () => {
      const last = rules.at(-1);
      rules.push({ weekday: Math.min((last?.weekday ?? 0) + 1, 7), start: last?.start ?? '07:00', end: last?.end ?? '19:00', kind: last?.kind ?? 'inperson', slotMinutes: last?.slotMinutes ?? 60, location: last?.location ?? '' });
      draw();
    });

    function ruleCard(r) {
      const input = (key, attrs) => h('input', { ...attrs, value: String(r[key] ?? ''), oninput: e => { r[key] = e.target.value; } });
      const kindBox = h('div');
      const location = input('location', { maxlength: '80', placeholder: r.kind === 'video' ? 'Video call' : 'Studio 2' });
      const drawKind = () => fill(kindBox, segmented([['inperson', 'In person'], ['video', 'Video']], r.kind, v => {
        r.kind = v; location.placeholder = v === 'video' ? 'Video call' : 'Studio 2'; drawKind();
      }));
      drawKind();
      return h('div', { class: 'card' },
        h('div', { class: 'spread' },
          h('select', { class: 'weekday-select', 'aria-label': 'Day', onchange: e => { r.weekday = Number(e.target.value); } },
            WEEKDAYS.map((w, i) => h('option', { value: String(i + 1), selected: r.weekday === i + 1 }, w))),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove these hours', onclick: () => { rules.splice(rules.indexOf(r), 1); draw(); } }, icon('trash', 18))),
        h('div', { class: 'avail-times' },
          field('Start', input('start', { type: 'time', step: '300' })),
          field('End', input('end', { type: 'time', step: '300' })),
          field('Slot min', input('slotMinutes', { type: 'number', min: '15', max: '240', step: '5' }))),
        kindBox,
        field('Location', location));
    }

    function draw() {
      fill(list, rules.length ? null : emptyCard('clock', 'No availability', 'Clients can’t book until you add hours.'), rules.map(ruleCard));
    }

    fill(body, loading());
    api('GET', '/api/availability').then(out => {
      rules = out.rules.map(r => ({ ...r })).sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
      fill(body, list, h('div', { class: 'row' }, add), status);
      save.disabled = false;
      draw();
    }).catch(err => fill(body, errorLine(err)));

    return h('div', { class: 'spread' }, h('span', { class: 'tiny faint' }, 'Times are Europe/London. Existing bookings stay put.'),
      h('div', { class: 'row' }, button('Cancel', () => close()), save));
  });
}

