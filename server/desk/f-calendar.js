/*
 * Calendar (WP7, F20 and F21): Settings › Calendars and Settings ›
 * Availability, the slot finder, booking (with "repeat weekly"), holds,
 * reschedule, the conflicts slide-over, the Today widgets, the client
 * "Book" action, palette commands and quick-create.
 *
 * Every write goes through the server, which re-checks the slot; the desk
 * only previews. All text is set with textContent through h().
 */
import {
  addDays, api, busy, button, clientById, clients, confirmBox, errorLine, field, fill, firstName, fmtRelative, go, h, icon,
  londonParts, mondayOf, prefs as deskPrefs, q, registerClientAction, registerCommand, registerNav, registerPanel, registerQuickCreate,
  registerSettingsSection, registerWidget, sheet, state as deskState, switchRow, toast, todayLondon,
} from './core.js';
import { composer } from './composer.js';
import { emptyHero, menu, moneyInput, segmentedNav, skeleton, slideOver } from './ui.js';
import { HOLD_WORD, KIND_WORD, londonIso, longDay, shortDay, spanOf, whenOf } from './f-calendar-lib.js';

const COLORS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'];
const COLOR_NAME = { 'chart-1': 'Champagne', 'chart-2': 'Slate', 'chart-3': 'Sage', 'chart-4': 'Lilac', 'chart-5': 'Amber', 'chart-6': 'Stone' };
/** Where each provider hides its secret iCal address (F20). */
const PROVIDERS = [
  { id: 'google', name: 'Google', steps: ['Open Google Calendar on a computer and go to Settings.', 'Under “Settings for my calendars”, pick your calendar.', 'Scroll to “Integrate calendar” and copy “Secret address in iCal format”.'] },
  { id: 'outlook', name: 'Outlook', steps: ['Open Outlook on the web and go to Settings › Calendar.', 'Choose “Shared calendars”, then “Publish a calendar”.', 'Pick your calendar, “Can view when I’m busy”, Publish, then copy the ICS link.'] },
  { id: 'apple', name: 'Apple', steps: ['Open the Calendar app on a Mac (or iCloud.com).', 'Right-click your calendar and choose “Share Calendar”.', 'Tick “Public Calendar” and copy the webcal:// link.'] },
];
const enc = encodeURIComponent;
const changed = () => window.dispatchEvent(new CustomEvent('jk:calendar-changed'));

// MARK: - Nav, commands, quick-create, client action

registerNav({ id: 'schedule', label: 'Calendar', icon: 'calendar_month', group: 'schedule', order: 10, badge: true, badgeOn: ['calendar.conflict', 'booking.created', 'booking.cancelled', 'booking.rescheduled', 'hold.created'], mobile: 40 });
registerCommand({ id: 'calendar.find', label: 'Find a slot for…', icon: 'travel_explore', group: 'Calendar', run: () => openFinder({}) });
registerCommand({ id: 'calendar.hold', label: 'Hold time', icon: 'front_hand', group: 'Calendar', run: () => openHold({}) });
registerCommand({ id: 'calendar.conflicts', label: 'Show calendar clashes', icon: 'event_busy', group: 'Calendar', run: () => openConflicts() });
registerCommand({ id: 'calendar.timeoff', label: 'Add time off', icon: 'event_busy', group: 'Calendar', run: () => go('/account/calendars') });
registerQuickCreate({ id: 'booking', label: 'Booking', icon: 'event_available', order: 40, run: () => openBook({}) });
registerQuickCreate({ id: 'hold', label: 'Hold', icon: 'front_hand', order: 41, run: () => openHold({}) });
registerClientAction({ id: 'book', label: 'Book', icon: 'event_available', order: 30, run: client => openFinder({ client }) });

// MARK: - Small pieces

const toneOf = sev => (sev === 'high' ? 'urgent' : 'attention');
export const severityPill = sev => h('span', { class: `cal-sev tone-${toneOf(sev)}` }, icon(sev === 'high' ? 'error' : 'warning', 14), sev === 'high' ? 'Clash' : 'Check');
const colorSwatch = (token, attrs = {}) => h('span', { class: 'cal-swatch', style: { '--src': `var(--${token})` }, 'aria-hidden': 'true', ...attrs });
const num = (value, attrs = {}) => h('input', { type: 'number', inputmode: 'numeric', value: value === null || value === undefined ? '' : String(value), ...attrs });

async function clientList() {
  try { return await clients(); } catch { return []; }
}

function clientSelect(list, value, onchange, { label = 'Client' } = {}) {
  return h('select', { 'aria-label': label, onchange: e => onchange(e.target.value || null) },
    h('option', { value: '' }, 'Choose a client…'),
    list.map(c => h('option', { value: c.id, selected: c.id === value }, c.name)));
}

// MARK: - The slot finder (F21)

/**
 * openFinder({client, hold: {kind, title, leadId}, from, to, onDone}): the slot
 * finder. With a client it books (or proposes); in hold mode it holds the time.
 */
export function openFinder({ client = null, hold = null, from = null, to = null, onDone = null } = {}) {
  const today = todayLondon();
  const st = {
    clientId: client?.id ?? null, kind: 'inperson', minutes: hold ? 30 : null, prefer: 'any',
    from: from && from > today ? from : today, to: to ?? addDays(from && from > today ? from : today, 13), hold,
  };
  slideOver(hold ? 'Find time to hold' : 'Find a slot', (body, close) => {
    const form = h('div', { class: 'cal-finder-form' });
    const results = h('div', { class: 'cal-finder-results', 'aria-live': 'polite' });
    body.append(form, results);
    let seq = 0;
    const run = async () => {
      const mine = ++seq;
      if (!hold && !st.clientId) { fill(results, emptyHero({ icon: 'travel_explore', title: 'Who is it for?', line: 'Pick a client and the finder ranks the best times for you both.' })); return; }
      fill(results, skeleton('card', { rows: 2 }), skeleton('card', { rows: 2 }));
      try {
        const out = await api('GET', `/api/calendar/find?${q({ clientId: hold ? null : st.clientId, kind: hold ? null : st.kind, minutes: st.minutes, from: st.from, to: st.to, prefer: st.prefer })}`);
        if (mine !== seq) return;
        drawResults(out.suggestions, out.warning);
      } catch (err) { if (mine === seq) fill(results, errorLine(err)); }
    };
    const who = () => clientById(st.clientId) || (client && client.id === st.clientId ? client : null);
    function drawResults(list, warning = null) {
      const warn = warning ? h('div', { class: 'cal-finder-warn' }, icon('pause_circle', 16), warning) : null;
      if (!list.length) { fill(results, warn, emptyHero({ icon: 'event_busy', title: 'Nothing free.', line: 'Try a longer range, another kind of session, or any time of day.' })); return; }
      const best = Math.max(...list.map(s => s.score)), worst = Math.min(...list.map(s => s.score));
      fill(results, warn, h('div', { class: 'cal-eyebrow' }, `Top ${list.length} times`), list.map((s, i) => {
        const p = londonParts(s.start);
        const pct = best === worst ? 100 : Math.round(30 + 70 * (s.score - worst) / (best - worst));
        const status = h('div');
        const act = async (btn, fn) => busy(btn, status, fn);
        const actions = hold
          ? [button(h('span', { class: 'row gap4' }, icon('front_hand', 16), 'Hold'), e => act(e.currentTarget, async () => {
            await api('POST', '/api/calendar/holds', { kind: hold.kind || 'consult', title: hold.title || undefined, leadId: hold.leadId || undefined, start: s.start, end: s.end });
            toast(`Held ${whenOf(s.start)}`); changed(); close(); onDone?.(s);
          }), { kind: i === 0 ? 'primary' : '', small: true })]
          : [button('Book', e => act(e.currentTarget, async () => {
            await api('POST', '/api/bookings', { clientId: st.clientId, kind: s.kind, start: s.start });
            toast(`Booked ${firstName(who()?.name)} · ${whenOf(s.start)}`); changed(); close(); onDone?.(s);
          }), { kind: i === 0 ? 'primary' : '', small: true }),
          // Propose opens a composer the coach reads and sends (the normal send guards run); nothing goes until they press Send.
          button('Propose', () => proposeSlot(who() ?? { id: st.clientId, name: '' }, s), { small: true })];
        return h('article', { class: 'cal-sugg' + (i === 0 ? ' best' : '') },
          h('div', { class: 'cal-sugg-when' },
            h('div', { class: 'cal-sugg-day' }, shortDay(p.day)),
            h('div', { class: 'cal-sugg-time t-num' }, p.time),
            h('div', { class: 'tiny faint' }, `${spanOf(s.start, s.end)} · ${KIND_WORD[s.kind] ?? s.kind}`)),
          h('div', { class: 'cal-sugg-body' },
            i === 0 ? h('span', { class: 'cal-best' }, icon('star', 14), 'Best fit') : null,
            h('ul', { class: 'cal-reasons' }, s.reasons.map(r => h('li', null, r))),
            h('div', { class: 'cal-fit', role: 'img', 'aria-label': `Fit ${pct} of 100` }, h('span', { style: { '--pct': `${pct}%` } })),
            status),
          h('div', { class: 'cal-sugg-actions' }, actions));
      }));
    }
    async function drawForm() {
      const list = hold ? [] : await clientList();
      const prefer = segmentedNav([['any', 'Any'], ['morning', 'Morning'], ['midday', 'Midday'], ['evening', 'Evening']], st.prefer, v => { st.prefer = v; run(); }, { label: 'Time of day' });
      const kind = segmentedNav([['inperson', '1:1 in person'], ['video', 'Video']], st.kind, v => { st.kind = v; run(); }, { label: 'Kind' });
      const fromIn = h('input', { type: 'date', value: st.from, min: today, onchange: e => { st.from = e.target.value || today; if (st.to < st.from) { st.to = addDays(st.from, 13); toIn.value = st.to; } run(); } });
      const toIn = h('input', { type: 'date', value: st.to, min: st.from, onchange: e => { st.to = e.target.value || addDays(st.from, 13); run(); } });
      const length = h('select', { onchange: e => { st.minutes = Number(e.target.value) || null; run(); } },
        [[15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1½ hours']].map(([v, l]) => h('option', { value: String(v), selected: v === st.minutes }, l)));
      fill(form,
        hold ? h('p', { class: 'small muted m0' }, `Holding time for ${hold.title || HOLD_WORD[hold.kind] || 'a consult'}. Holds block client slots and show on your calendar.`)
          : field('Client', clientSelect(list, st.clientId, v => { st.clientId = v; run(); })),
        hold ? field('Length', length) : field('Kind', kind),
        h('div', { class: 'grid2' }, field('From', fromIn), field('To', toIn)),
        field('Time of day', prefer));
    }
    drawForm().then(run);
  }, { wide: false, className: 'cal-panel', deepLink: client ? `finder:${client.id}` : hold ? null : 'finder:any' });
}

/** A proposal for one suggested time, in a composer: read, edit, Send. The slot isn't held. */
function proposeSlot(client, s) {
  const name = firstName(client.name) || 'there';
  const text = `Hi ${name}, how does ${whenOf(s.start).replace(' · ', ' at ')} look for our next ${KIND_WORD[s.kind] === 'Video' ? 'video call' : 'session'}? If it suits, book it in the app soon: the slot isn't held for you.`;
  slideOver(`Propose a time to ${name}`, (body, close) => {
    const c = composer({
      clientId: client.id, initial: text, label: `Message to ${client.name || name}`, placeholder: `Write to ${name}`,
      onSend: async ({ text: t, mediaId, kind }) => {
        await api('POST', '/api/messages', { clientId: client.id, text: t, ...(mediaId ? { mediaId } : {}), ...(kind && kind !== 'text' ? { kind } : {}) });
        toast(`Proposed to ${name}`);
        close();
      },
    });
    body.append(h('p', { class: 'small muted' }, `${shortDay(londonParts(s.start).day)} ${londonParts(s.start).time} · ${KIND_WORD[s.kind] ?? s.kind}. Nothing is sent until you press Send.`), c.el);
    requestAnimationFrame(() => c.focus());
  });
}

// The deep link reopens the real finder (the panel host calls this when ?panel=finder:<id> is pasted).
registerPanel('finder', id => {
  queueMicrotask(() => openFinder({ client: id && id !== 'any' ? (clientById(id) || { id, name: 'Client' }) : null }));
  return null;
});

// MARK: - Book a session (with "repeat weekly")

/**
 * openBook({client, day, time, kind}): book a 1:1 in one of your slots, once
 * or weekly for N weeks (a standing series). Shows what a series skipped.
 */
export function openBook({ client = null, day = null, time = null, kind = 'inperson', onDone = null } = {}) {
  const today = todayLondon();
  const st = { clientId: client?.id ?? null, day: day && day >= today ? day : today, kind, chosen: null, purpose: '', repeat: false, weeks: 8, want: time };
  slideOver('Book a session', (body, close) => {
    const head = h('div');
    const slotBox = h('div', { class: 'cal-slots' });
    const summary = h('div', { class: 'cal-book-summary' });
    const status = h('div');
    const result = h('div');
    body.append(head, slotBox, summary, status, result);
    let seq = 0;
    const confirm = h('button', { type: 'button', class: 'btn primary', disabled: true, onclick: () => book() }, 'Confirm booking');

    async function drawHead() {
      const list = await clientList();
      const strip = h('div', { class: 'cal-daystrip', role: 'group', 'aria-label': 'Day' });
      const monday = mondayOf(st.day);
      for (let i = 0; i < 7; i++) {
        const d = addDays(monday, i);
        strip.append(h('button', { type: 'button', class: 'cal-daypill' + (d === st.day ? ' on' : ''), disabled: d < today, 'aria-pressed': String(d === st.day), onclick: () => { st.day = d; st.want = null; drawHead(); loadSlots(); } },
          h('span', { class: 'tiny' }, shortDay(d).split(' ')[0]), h('strong', null, shortDay(d).split(' ')[1])));
      }
      fill(head,
        field('Client', clientSelect(list, st.clientId, v => { st.clientId = v; drawSummary(); })),
        field('Kind', segmentedNav([['inperson', '1:1 in person'], ['video', 'Video call']], st.kind, v => { st.kind = v; loadSlots(); }, { label: 'Kind' })),
        h('div', { class: 'cal-weeknav' },
          h('button', { type: 'button', class: 'ui-icon-btn', 'aria-label': 'Previous week', disabled: mondayOf(st.day) <= mondayOf(today), onclick: () => { st.day = addDays(st.day, -7) < today ? today : addDays(st.day, -7); drawHead(); loadSlots(); } }, icon('chevron_left', 18)),
          h('span', { class: 'small muted' }, `Week of ${shortDay(monday)}`),
          h('button', { type: 'button', class: 'ui-icon-btn', 'aria-label': 'Next week', onclick: () => { st.day = addDays(st.day, 7); drawHead(); loadSlots(); } }, icon('chevron_right', 18))),
        strip);
    }
    async function loadSlots() {
      const mine = ++seq;
      st.chosen = null;
      fill(slotBox, skeleton('lines', { rows: 2 }));
      drawSummary();
      try {
        const { slots } = await api('GET', `/api/slots?${q({ from: st.day, to: st.day, kind: st.kind })}`);
        if (mine !== seq) return;
        const upcoming = slots.filter(s => Date.parse(s.start) > Date.now());
        if (st.want) st.chosen = upcoming.find(s => s.open && londonParts(s.start).time === st.want) ?? null;
        if (!upcoming.length) { fill(slotBox, h('p', { class: 'small faint' }, 'No hours on this day for this kind of session. Edit your hours under Availability.')); drawSummary(); return; }
        fill(slotBox, h('div', { class: 'cal-slotgrid' }, upcoming.map(s => h('button', {
          type: 'button', class: 'cal-slot' + (st.chosen?.start === s.start ? ' on' : '') + (s.open ? '' : ' taken'), disabled: !s.open,
          title: s.open ? `${spanOf(s.start, s.end)} · ${s.location || KIND_WORD[s.kind]}` : `Not free: ${s.reason}`, 'aria-pressed': String(st.chosen?.start === s.start),
          onclick: () => { st.chosen = s; loadSlotsPaint(); drawSummary(); },
        }, h('span', { class: 't-num' }, londonParts(s.start).time), s.open ? null : h('span', { class: 'cal-slot-why' }, s.reason)))));
        drawSummary();
      } catch (err) { if (mine === seq) fill(slotBox, errorLine(err)); }
    }
    const loadSlotsPaint = () => slotBox.querySelectorAll('.cal-slot').forEach(b => {
      const on = b.querySelector('.t-num')?.textContent === (st.chosen && londonParts(st.chosen.start).time);
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
    function drawSummary() {
      confirm.disabled = !st.chosen || !st.clientId;
      confirm.textContent = st.repeat ? `Book ${st.weeks} weeks` : 'Confirm booking';
      const weeks = num(st.weeks, { min: '2', max: '26', step: '1', 'aria-label': 'Weeks', oninput: e => { st.weeks = Math.max(2, Math.min(26, Number(e.target.value) || 2)); drawSummaryText(); } });
      const text = h('div', { class: 'small' });
      const drawSummaryText = () => {
        confirm.textContent = st.repeat ? `Book ${st.weeks} weeks` : 'Confirm booking';
        fill(text, st.chosen ? `${longDay(londonParts(st.chosen.start).day)} · ${spanOf(st.chosen.start, st.chosen.end)}${st.repeat ? `, then weekly for ${st.weeks} weeks` : ''}` : 'Pick a time');
      };
      drawSummaryText();
      fill(summary,
        field('Purpose', h('select', { onchange: e => { st.purpose = e.target.value; } },
          [['', 'None'], ['planning', 'Planning session'], ['review', 'Accountability session']].map(([v, l]) => h('option', { value: v, selected: v === st.purpose }, l)))),
        h('div', { class: 'cal-repeat' }, switchRow('Repeat weekly', st.repeat, on => { st.repeat = on; drawSummary(); }, { detail: 'A standing session. Clashes are skipped and listed.' }),
          st.repeat ? h('label', { class: 'cal-weeks' }, weeks, h('span', { class: 'small muted' }, 'weeks')) : null),
        h('div', { class: 'cal-book-line' }, icon('event_available', 18), text));
    }
    async function book() {
      await busy(confirm, status, async () => {
        const c = clientById(st.clientId);
        if (st.repeat) {
          const out = await api('POST', '/api/bookings/series', { clientId: st.clientId, kind: st.kind, start: st.chosen.start, minutes: Math.round((Date.parse(st.chosen.end) - Date.parse(st.chosen.start)) / 60_000), weeks: st.weeks, purpose: st.purpose || null });
          changed();
          fill(result, h('div', { class: 'cal-series-result' },
            h('div', { class: 'strong' }, `${out.booked.length} sessions booked`),
            out.skipped.length ? [h('p', { class: 'small muted' }, `Skipped ${out.skipped.length}:`), h('ul', { class: 'cal-skips' }, out.skipped.map(s => h('li', null,
              h('span', null, `${shortDay(londonParts(s.start).day)}: ${s.reason}`),
              button('Find another time', () => openFinder({ client: c || { id: st.clientId, name: 'Client' }, from: londonParts(s.start).day, to: addDays(londonParts(s.start).day, 6) }), { small: true }))))] : h('p', { class: 'small muted' }, 'Every week was free.')));
          toast(`Booked ${out.booked.length} weekly sessions${out.skipped.length ? `, ${out.skipped.length} skipped` : ''}`);
          onDone?.();
          if (!out.skipped.length) close();
        } else {
          await api('POST', '/api/bookings', { clientId: st.clientId, kind: st.kind, start: st.chosen.start, purpose: st.purpose || null });
          toast(`Booked ${firstName(c?.name)} · ${whenOf(st.chosen.start)}`);
          changed(); onDone?.(); close();
        }
      });
    }
    drawHead().then(loadSlots);
    return h('div', { class: 'cal-foot' }, h('span', { class: 'tiny faint' }, 'Times are London. The client is told.'), confirm);
  }, { className: 'cal-panel' });
}

// MARK: - Hold time

/** openHold({start, end, kind, title, leadId}): a coach-only block (consult, trial or admin). */
export function openHold({ start = null, end = null, kind = 'admin', title = '', leadId = null, onDone = null } = {}) {
  const today = todayLondon();
  const p = start ? londonParts(start) : { day: today, time: '12:00' };
  const st = { kind, title, day: p.day, time: p.time, minutes: start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 60_000) : 60 };
  slideOver('Hold time', (body, close) => {
    const status = h('div');
    const titleIn = h('input', { value: st.title, maxlength: '80', placeholder: HOLD_WORD[st.kind], oninput: e => { st.title = e.target.value; } });
    const draw = () => fill(body,
      field('Kind', segmentedNav([['consult', 'Consult'], ['trial', 'Trial'], ['admin', 'Admin']], st.kind, v => { st.kind = v; titleIn.placeholder = v === 'admin' ? 'Programming time' : HOLD_WORD[v]; }, { label: 'Kind' })),
      field('Title', titleIn, 'Shown to you only. The calendar feed says “Consult” or “Trial”, never a name.'),
      h('div', { class: 'grid2' },
        field('Day', h('input', { type: 'date', value: st.day, min: today, onchange: e => { st.day = e.target.value; } })),
        field('Starts', h('input', { type: 'time', value: st.time, step: '900', onchange: e => { st.time = e.target.value; } }))),
      field('Length', h('select', { onchange: e => { st.minutes = Number(e.target.value); } },
        [[15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1½ hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours']].map(([v, l]) => h('option', { value: String(v), selected: v === st.minutes }, l)))),
      h('p', { class: 'small muted' }, 'A hold blocks client booking slots, shows on your calendar and in the diary.'),
      status);
    draw();
    const save = h('button', { type: 'button', class: 'btn primary', onclick: () => busy(save, status, async () => {
      if (!st.day || !st.time) throw new Error('Choose when it starts.');
      const s = londonIso(st.day, st.time);
      await api('POST', '/api/calendar/holds', { kind: st.kind, title: st.title.trim() || undefined, start: s, end: new Date(Date.parse(s) + st.minutes * 60_000).toISOString(), leadId });
      toast(`Held ${whenOf(s)}`); changed(); onDone?.(); close();
    }) }, 'Hold this time');
    return h('div', { class: 'cal-foot' }, button('Find a free time', () => { close(); openFinder({ hold: { kind: st.kind, title: st.title, leadId } }); }), save);
  }, { className: 'cal-panel' });
}

// MARK: - Reschedule (F21)

/** Confirm a move, with an optional message to the client. Resolves true when moved. */
export function confirmMove(b, start, { reason = null } = {}) {
  const end = new Date(Date.parse(start) + (Date.parse(b.end) - Date.parse(b.start))).toISOString();
  const first = firstName(b.client?.name || '');
  return sheet('Move this session?', (body, close) => {
    const msg = h('textarea', { rows: '3', maxlength: '2000', placeholder: 'Optional message' });
    msg.value = b.client ? `Hi ${first}, I’ve moved our session to ${whenOf(start).replace(' · ', ' at ')}. Shout if that doesn’t work.` : '';
    const status = h('div');
    fill(body,
      h('div', { class: 'cal-move' },
        h('div', { class: 'cal-move-from' }, h('div', { class: 'tiny faint' }, 'From'), h('div', { class: 'strong' }, whenOf(b.start))),
        icon('chevron_right', 20),
        h('div', { class: 'cal-move-to' }, h('div', { class: 'tiny faint' }, 'To'), h('div', { class: 'strong' }, `${shortDay(londonParts(start).day)} · ${spanOf(start, end)}`))),
      reason ? h('p', { class: 'cal-warn' }, icon('warning', 16), `Heads up: ${reason}. The server checks again.`) : null,
      b.client ? field(`Message to ${first}`, msg, 'Sent from you when the move is saved. Leave it empty to only notify the app.') : null,
      status);
    const ok = h('button', { type: 'button', class: 'btn primary', onclick: () => busy(ok, status, async () => {
      await api('POST', `/api/bookings/${enc(b.id)}/reschedule`, { start, message: msg.value.trim() || null });
      toast(`Moved to ${whenOf(start)}`); changed(); close(true);
    }) }, 'Move it');
    return h('div', { class: 'row end' }, button('Cancel', () => close(false)), ok);
  }).then(v => v === true);
}

/** Move a session by picking a day and time (the keyboard way to drag). */
export function moveSheet(b) {
  const p = londonParts(b.start);
  return sheet('Move to…', (body, close) => {
    const day = h('input', { type: 'date', value: p.day, min: todayLondon() });
    const time = h('input', { type: 'time', value: p.time, step: '900' });
    fill(body, h('div', { class: 'grid2' }, field('Day', day), field('Starts', time)), h('p', { class: 'small muted' }, 'Or drag the session on the calendar.'));
    return h('div', { class: 'row end' }, button('Cancel', () => close(false)), button('Next', async () => {
      if (!day.value || !time.value) return;
      close(false);
      await confirmMove(b, londonIso(day.value, time.value));
    }, { kind: 'primary' }));
  });
}

// MARK: - Conflicts (F20)

export function openConflicts() {
  slideOver('Calendar clashes', (body, close) => {
    body.append(skeleton('card', { rows: 2 }), skeleton('card', { rows: 2 }));
    const from = todayLondon();
    const load = async () => {
      try {
        const { conflicts, ignored } = await api('GET', `/api/calendar/conflicts?${q({ from, to: addDays(from, 41) })}`);
        draw(conflicts, ignored);
      } catch (err) { fill(body, errorLine(err)); }
    };
    function draw(list, ignored) {
      if (!list.length) { fill(body, emptyHero({ icon: 'event_available', title: 'No clashes.', line: `Nothing overlaps in the next six weeks${ignored.length ? ` (${ignored.length} ignored)` : ''}.` })); return; }
      fill(body, h('p', { class: 'small muted m0' }, `${list.length} in the next six weeks. Fix or ignore each one; your clients never see them.`),
        h('ol', { class: 'cal-conflicts' }, list.map(c => {
          const status = h('div');
          const bookingSide = [c.a, c.b].find(x => x.type === 'booking');
          const fixes = [];
          if (bookingSide) {
            fixes.push(button(h('span', { class: 'row gap4' }, icon('travel_explore', 16), 'Move'), async () => {
              const b = await findBookingNear(bookingSide.id, bookingSide.start);
              if (!b) { toast('That session has gone.', { error: true }); load(); return; }
              close();
              if (b.client && b.kind !== 'group') openFinder({ client: b.client, from: londonParts(b.start).day });
              else moveSheet(b);
            }, { small: true }));
            fixes.push(button('Cancel session', async e => {
              if (!(await confirmBox('Cancel this session?', { ok: 'Cancel it', danger: true, detail: 'The client is told. As the coach, the credit comes back.' }))) return;
              await busy(e.target, status, async () => { await api('DELETE', `/api/bookings/${enc(bookingSide.id)}`); toast('Cancelled'); changed(); load(); });
            }, { small: true }));
          }
          if (c.kind === 'timeOff') fixes.push(button('Edit time off', () => { close(); go('/account/calendars'); }, { small: true }));
          fixes.push(button('Ignore this clash', async e => {
            await busy(e.target, status, async () => {
              await api('POST', '/api/calendar/conflicts/ignore', { key: c.key });
              toast('Clash ignored. It stays hidden while both sides are unchanged.');
              changed(); load();
            });
          }, { small: true }));
          const b = c.b;
          return h('li', { class: `cal-conflict sev-${c.severity}` },
            h('div', { class: 'cal-conflict-top' }, severityPill(c.severity), h('span', { class: 'tiny faint' }, whenOf(c.a.start))),
            h('p', { class: 'cal-conflict-text' }, conflictWords(c)),
            b.type === 'external' ? h('p', { class: 'tiny faint m0' }, `From your ${b.label || 'connected'} calendar${b.allDay ? ' · all day' : ''}`) : null,
            h('div', { class: 'cal-conflict-fixes' }, fixes), status);
        })));
    }
    load();
  }, { className: 'cal-panel', deepLink: 'conflicts:open' });
}
registerPanel('conflicts', () => { queueMicrotask(() => openConflicts()); return null; });

/** "Sam Carter 1:1 Tue 07:00 overlaps *Dentist* (Google)": the other side in italics. */
function conflictWords(c) {
  const b = c.b;
  const i = b.title ? c.text.lastIndexOf(b.title) : -1;
  if (i < 0) return c.text;
  return [c.text.slice(0, i), h('em', null, b.title), c.text.slice(i + b.title.length)];
}

/** Find one booking by id around a hint day (there is no GET by id). */
export async function findBookingNear(id, iso) {
  const day = iso ? londonParts(iso).day : todayLondon();
  for (const [from, to] of [[addDays(day, -1), addDays(day, 1)], [addDays(todayLondon(), -60), addDays(todayLondon(), 30)], [addDays(todayLondon(), 31), addDays(todayLondon(), 120)]]) {
    const { bookings } = await api('GET', `/api/bookings?${q({ from, to })}`);
    const hit = bookings.find(b => b.id === id);
    if (hit) return hit;
  }
  return null;
}

// MARK: - Availability and rules (F20, F21): weekly hours, buffers, limits, the cancellation policy

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The whole availability form into `box`; resolves when loaded. `onSaved` after a save. */
export async function availabilityForm(box, { onSaved = null, compact = false } = {}) {
  fill(box, skeleton('card', { rows: 4 }));
  let rules, p;
  try {
    const [a, b] = await Promise.all([api('GET', '/api/availability'), api('GET', '/api/calendar/prefs')]);
    rules = a.rules.map(r => ({ ...r })).sort((x, y) => x.weekday - y.weekday || x.start.localeCompare(y.start));
    p = { ...b.prefs };
  } catch (err) { fill(box, errorLine(err)); return; }
  const status = h('div');
  const list = h('div', { class: 'cal-rules' });
  const drawRules = () => fill(list, rules.length ? rules.map(r => {
    const set = key => e => { r[key] = e.target.value; };
    return h('div', { class: 'cal-rule' },
      h('select', { 'aria-label': 'Day', onchange: e => { r.weekday = Number(e.target.value); } }, WEEKDAYS.map((w, i) => h('option', { value: String(i + 1), selected: r.weekday === i + 1 }, w))),
      h('input', { type: 'time', step: '300', value: r.start, 'aria-label': 'Start', onchange: set('start') }),
      h('span', { class: 'faint', 'aria-hidden': 'true' }, '–'),
      h('input', { type: 'time', step: '300', value: r.end, 'aria-label': 'End', onchange: set('end') }),
      h('select', { 'aria-label': 'Kind', onchange: e => { r.kind = e.target.value; } }, [['inperson', 'In person'], ['video', 'Video']].map(([v, l]) => h('option', { value: v, selected: r.kind === v }, l))),
      h('label', { class: 'cal-rule-len' }, num(r.slotMinutes, { min: '15', max: '240', step: '5', 'aria-label': 'Slot minutes', oninput: e => { r.slotMinutes = Number(e.target.value); } }), h('span', { class: 'tiny faint' }, 'min')),
      h('input', { value: r.location ?? '', maxlength: '80', placeholder: r.kind === 'video' ? 'Video call' : 'Studio 2', 'aria-label': 'Location', oninput: set('location') }),
      h('button', { type: 'button', class: 'ui-icon-btn', 'aria-label': 'Remove these hours', onclick: () => { rules.splice(rules.indexOf(r), 1); drawRules(); } }, icon('delete', 18)));
  }) : h('p', { class: 'small faint' }, 'No hours: clients can’t book until you add some.'));
  drawRules();
  const n = (key, label, hint, { min = 0, max = 60, unit = 'min', nullable = false } = {}) => field(label, h('span', { class: 'cal-num' },
    num(p[key], { min: String(min), max: String(max), placeholder: nullable ? 'No limit' : '0', oninput: e => { p[key] = e.target.value === '' && nullable ? null : Number(e.target.value); } }), h('span', { class: 'small faint' }, unit)), hint);
  const fee = key => moneyInput({ value: p[key], label: key === 'cancelFeePence' ? 'Late-cancel fee' : 'No-show fee', onChange: v => { p[key] = v ?? 0; } });
  const save = h('button', { type: 'button', class: 'btn primary', onclick: () => busy(save, status, async () => {
    const clean = rules.map(r => ({ ...r, slotMinutes: Number(r.slotMinutes), location: r.location || '' }));
    await api('PUT', '/api/availability', { rules: clean });
    const body = Object.fromEntries(['bufferBefore', 'bufferAfter', 'minNoticeHours', 'maxPerDay', 'travelGap', 'cancelNoticeHours', 'cancelFeePence', 'noShowFeePence']
      .map(k => [k, p[k] === null || p[k] === '' ? (k === 'maxPerDay' ? null : 0) : Number(p[k])]));
    body.cancelForfeitCredit = !!p.cancelForfeitCredit;
    const out = await api('PUT', '/api/calendar/prefs', body);
    p = { ...out.prefs };
    toast('Availability saved'); changed(); onSaved?.();
  }) }, 'Save availability');
  fill(box,
    h('section', { class: 'cal-set' },
      h('header', null, h('h3', null, 'Weekly hours'), h('p', { class: 'small muted' }, 'When clients can book. Times are London; existing bookings stay put.')),
      list, h('div', null, button(h('span', { class: 'row gap4' }, icon('add', 16), 'Add hours'), () => {
        const last = rules.at(-1);
        rules.push({ weekday: Math.min((last?.weekday ?? 0) + 1, 7), start: last?.start ?? '07:00', end: last?.end ?? '19:00', kind: last?.kind ?? 'inperson', slotMinutes: last?.slotMinutes ?? 60, location: last?.location ?? 'Studio 2' });
        drawRules();
      }, { small: true }))),
    h('section', { class: 'cal-set' },
      h('header', null, h('h3', null, 'Buffers and limits'), h('p', { class: 'small muted' }, p.configured ? 'Breathing room between sessions, and how late clients can book.' : 'Not set yet: nothing is applied until you save. We suggest a 10-minute buffer and 12 hours’ notice.')),
      h('div', { class: compact ? 'grid2' : 'grid3' },
        n('bufferBefore', 'Buffer before', 'Kept free before each session.'),
        n('bufferAfter', 'Buffer after', 'Kept free after each session.'),
        n('travelGap', 'Travel gap', 'In person after a video call.', { max: 120 }),
        n('minNoticeHours', 'Minimum notice', 'Clients can’t book sooner.', { max: 168, unit: 'hours' }),
        n('maxPerDay', 'Most sessions a day', 'Empty for no limit.', { min: 1, max: 20, unit: 'a day', nullable: true }))),
    h('section', { class: 'cal-set' },
      h('header', null, h('h3', null, 'Cancellation policy'), h('p', { class: 'small muted' }, 'Shown to clients when they book. Fees only ever make a draft invoice line for you to confirm.')),
      h('div', { class: compact ? 'grid2' : 'grid3' },
        n('cancelNoticeHours', 'Notice to cancel', 'Later than this is a late cancel.', { max: 168, unit: 'hours' }),
        field('Late-cancel fee', fee('cancelFeePence')),
        field('No-show fee', fee('noShowFeePence'))),
      switchRow('Late cancels use up the session credit', !!p.cancelForfeitCredit, on => { p.cancelForfeitCredit = on; }, { detail: 'Off: a late cancel still gives the credit back.' })),
    status,
    h('div', { class: 'cal-set-foot' }, save));
}

/** The availability form in a wide slide-over (from /schedule). */
export function openAvailability() {
  slideOver('Availability and rules', body => { availabilityForm(body, { compact: true }); }, { wide: true, className: 'cal-panel' });
}

registerSettingsSection({ id: 'availability', label: 'Availability', icon: 'schedule', order: 31, render: box => availabilityForm(box) });

// MARK: - Settings › Calendars (F20)

registerSettingsSection({ id: 'calendars', label: 'Calendars', icon: 'calendar_month', order: 30, render: calendarsSection });

async function calendarsSection(box) {
  const sources = h('div', { class: 'cal-sources' });
  const connect = h('div');
  const off = h('div');
  box.replaceChildren(
    h('header', { class: 'cal-set-intro' }, h('h2', { class: 't-title' }, 'Calendars'),
      h('p', { class: 'muted' }, 'Your personal calendar’s busy time blocks out the slots clients can book, and the desk warns you about clashes. Only “busy” is kept unless you ask for titles.')),
    h('section', { class: 'cal-set' }, h('header', null, h('h3', null, 'Connected')), sources),
    h('section', { class: 'cal-set' }, h('header', null, h('h3', null, 'Connect a calendar')), connect),
    h('section', { class: 'cal-set' }, h('header', null, h('h3', null, 'Time off'), h('p', { class: 'small muted' }, 'Holidays and days away. Nobody can book inside them.')), off));
  drawConnect(connect, () => loadSources());
  const loadSources = async () => {
    fill(sources, skeleton('table', { rows: 2 }));
    try {
      const out = await api('GET', '/api/calendar/sources');
      fill(sources, out.sources.length ? out.sources.map(s => sourceRow(s, loadSources)) : h('p', { class: 'small faint' }, 'None yet. Connect Google, Outlook or Apple below.'));
    } catch (err) { fill(sources, errorLine(err)); }
  };
  loadSources();
  timeOffBlock(off);
}

function sourceRow(s, reload) {
  const status = h('div');
  const state = !s.active ? ['Paused', 'data', 'pause_circle'] : !s.ok ? ['Not syncing', 'urgent', 'error'] : s.lastError ? ['Synced with a warning', 'attention', 'warning'] : ['Synced', 'ok', 'check_circle'];
  const more = h('button', { type: 'button', class: 'ui-icon-btn', 'aria-label': `More for ${s.label}`, onclick: e => menu(e.currentTarget, [
    { label: s.showTitles ? 'Hide event titles' : 'Show event titles to me', icon: s.showTitles ? 'visibility_off' : 'visibility', onclick: () => patch({ showTitles: !s.showTitles }) },
    { label: s.active ? 'Pause' : 'Resume', icon: s.active ? 'pause' : 'play_arrow', onclick: () => patch({ active: !s.active }) },
    'sep',
    ...COLORS.map(c => ({ label: `Colour: ${COLOR_NAME[c]}`, icon: c === s.color ? 'check' : null, onclick: () => patch({ color: c }) })),
    'sep',
    { label: 'Remove', icon: 'link_off', danger: true, onclick: async () => {
      if (!(await confirmBox(`Remove ${s.label}?`, { ok: 'Remove', danger: true, detail: 'Its busy time stops blocking your slots. The address is deleted.' }))) return;
      await busy(null, status, async () => { await api('DELETE', `/api/calendar/sources/${enc(s.id)}`); toast('Calendar removed'); changed(); reload(); });
    } },
  ], { label: s.label }) }, icon('more_horiz', 18));
  const patch = body => busy(null, status, async () => { await api('PATCH', `/api/calendar/sources/${enc(s.id)}`, body); changed(); reload(); });
  // The demo's calendars are simulated: nothing to fetch, so no button that can only fail.
  const sync = deskState.me?.isDemo ? null : h('button', { type: 'button', class: 'btn small', onclick: () => busy(sync, status, async () => { await api('POST', `/api/calendar/sources/${enc(s.id)}/sync`); toast('Synced'); changed(); reload(); }) }, icon('sync', 16), 'Sync now');
  return h('div', { class: 'cal-source' },
    colorSwatch(s.color, { class: 'cal-swatch big' }),
    h('div', { class: 'grow' },
      h('div', { class: 'cal-source-name' }, s.label, s.showTitles ? h('span', { class: 'cal-tag' }, 'Titles shown') : h('span', { class: 'cal-tag' }, 'Busy only')),
      h('div', { class: 'tiny faint' }, s.urlHint),
      h('div', { class: 'cal-source-state' }, h('span', { class: `cal-state tone-${state[1]}` }, icon(state[2], 14), state[0]),
        h('span', { class: 'tiny muted' }, [s.lastSyncedAt ? `Last synced ${fmtRelative(s.lastSyncedAt)}` : 'Never synced', `${s.eventCount} events`].join(' · '))),
      s.lastError ? h('div', { class: 'tiny muted cal-source-err' }, s.lastError) : null,
      status),
    sync, more);
}

function drawConnect(box, onAdded) {
  if (deskState.me?.isDemo) {
    fill(box, h('div', { class: 'cal-demo-note' }, icon('lightbulb', 18), h('p', { class: 'small muted' }, 'Demo: these calendars are simulated. Sign in as a real coach to connect Google, Outlook or Apple.')));
    return;
  }
  let provider = PROVIDERS[0];
  const st = { label: '', url: '', color: 'chart-4', showTitles: false };
  const status = h('div');
  const steps = h('ol', { class: 'cal-steps' });
  const swatches = h('div', { class: 'cal-colors', role: 'radiogroup', 'aria-label': 'Colour' });
  const drawSwatches = () => fill(swatches, COLORS.map(c => h('button', { type: 'button', role: 'radio', class: 'cal-color' + (c === st.color ? ' on' : ''), 'aria-checked': String(c === st.color), 'aria-label': COLOR_NAME[c], title: COLOR_NAME[c], onclick: () => { st.color = c; drawSwatches(); } }, colorSwatch(c))));
  const drawSteps = () => fill(steps, provider.steps.map(s => h('li', null, s)));
  const label = h('input', { maxlength: '60', placeholder: 'Personal', oninput: e => { st.label = e.target.value; } });
  const url = h('input', { type: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: 'https://… or webcal://…', oninput: e => { st.url = e.target.value; } });
  const add = h('button', { type: 'button', class: 'btn primary', onclick: () => busy(add, status, async () => {
    if (!st.url.trim()) throw new Error('Paste the secret iCal address first.');
    await api('POST', '/api/calendar/sources', { label: st.label.trim() || provider.name, url: st.url.trim(), color: st.color, showTitles: st.showTitles });
    url.value = ''; st.url = ''; label.value = ''; st.label = '';
    toast('Calendar connected'); changed(); onAdded();
  }) }, icon('link', 16), 'Connect');
  drawSteps(); drawSwatches();
  fill(box,
    h('div', { class: 'cal-providers' }, segmentedNav(PROVIDERS.map(p => [p.id, p.name]), provider.id, v => { provider = PROVIDERS.find(p => p.id === v); label.placeholder = `${provider.name} calendar`; drawSteps(); }, { label: 'Provider' })),
    h('div', { class: 'cal-connect' },
      h('div', { class: 'cal-connect-help' }, h('div', { class: 'cal-eyebrow' }, 'Where to find it'), steps,
        h('p', { class: 'tiny faint' }, 'The address is a secret: it is stored encrypted, never shown again, and only ever read from here.')),
      h('div', { class: 'cal-connect-form' },
        field('Secret iCal address', url),
        h('div', { class: 'grid2' }, field('Name', label), field('Colour', swatches)),
        switchRow('Show event titles to me', st.showTitles, on => { st.showTitles = on; }, { detail: 'Off: only “Busy” is stored.' }),
        status, h('div', { class: 'cal-set-foot' }, add))));
}

async function timeOffBlock(box) {
  const status = h('div');
  const list = h('div', { class: 'cal-off-list' });
  const today = todayLondon();
  const st = { from: addDays(today, 7), to: addDays(today, 11), reason: '' };
  const load = async () => {
    try {
      const { items } = await api('GET', '/api/calendar/time-off');
      const ahead = items.filter(t => t.endDay >= today);
      fill(list, ahead.length ? ahead.map(t => h('div', { class: 'cal-off' },
        h('span', { class: 'cal-off-icon' }, icon('event_busy', 18)),
        h('div', { class: 'grow' }, h('div', { class: 'strong small' }, t.reason || 'Time off'),
          h('div', { class: 'tiny muted' }, t.allDay ? (t.startDay === t.endDay ? longDay(t.startDay) : `${shortDay(t.startDay)} – ${shortDay(t.endDay)}`) : `${whenOf(t.start)}–${londonParts(t.end).time}`)),
        h('button', { type: 'button', class: 'ui-icon-btn', 'aria-label': `Remove ${t.reason || 'time off'}`, onclick: () => busy(null, status, async () => {
          await api('DELETE', `/api/calendar/time-off/${enc(t.id)}`); toast('Time off removed'); changed(); load();
        }) }, icon('delete', 18)))) : h('p', { class: 'small faint' }, 'No time off booked.'));
    } catch (err) { fill(list, errorLine(err)); }
  };
  const add = h('button', { type: 'button', class: 'btn', onclick: () => busy(add, status, async () => {
    const out = await api('POST', '/api/calendar/time-off', { start: st.from, end: st.to, reason: st.reason.trim(), allDay: true });
    toast('Time off added'); changed(); load();
    if (out.conflicts.length) fill(status, h('div', { class: 'cal-warn' }, icon('warning', 16), `${out.conflicts.length} session${out.conflicts.length === 1 ? ' is' : 's are'} inside it: ${out.conflicts.slice(0, 3).map(c => `${c.title} ${whenOf(c.start)}`).join(', ')}.`, ' ', h('a', { href: '#/schedule?panel=conflicts:open' }, 'See clashes')));
  }) }, 'Add time off');
  const year = Number(today.slice(0, 4));
  const bank = h('button', { type: 'button', class: 'btn', onclick: () => busy(bank, status, async () => {
    const out = await api('POST', '/api/calendar/time-off/bank-holidays', { years: [year, year + 1] });
    toast(out.added ? `Added ${out.added} bank holidays` : 'Bank holidays already there'); changed(); load();
  }) }, icon('flag', 16), `Bank holidays (England) ${year}–${year + 1}`);
  fill(box, list,
    h('div', { class: 'cal-off-form' },
      field('From', h('input', { type: 'date', value: st.from, min: today, onchange: e => { st.from = e.target.value; } })),
      field('To', h('input', { type: 'date', value: st.to, min: today, onchange: e => { st.to = e.target.value; } })),
      field('Reason', h('input', { maxlength: '80', placeholder: 'Holiday', oninput: e => { st.reason = e.target.value; } })),
      h('div', { class: 'cal-off-actions' }, add)),
    h('div', { class: 'row' }, bank), status);
  load();
}

// MARK: - Today widgets: conflicts (s) and the week ahead

registerWidget({
  id: 'conflicts', title: 'Clashes', icon: 'event_busy', size: 's', order: 45,
  render: async body => {
    const from = todayLondon();
    const { conflicts } = await api('GET', `/api/calendar/conflicts?${q({ from, to: addDays(from, 13) })}`);
    const high = conflicts.filter(c => c.severity === 'high').length;
    body.append(
      h('div', { class: 'cal-w-num' }, h('span', { class: 't-number' }, String(conflicts.length)), h('span', { class: 'small muted' }, conflicts.length === 1 ? 'clash, next 2 weeks' : 'clashes, next 2 weeks')),
      conflicts.length ? h('ul', { class: 'cal-w-list' }, conflicts.slice(0, 2).map(c => h('li', null, severityPill(c.severity), h('span', { class: 'small clamp2' }, c.text))))
        : h('p', { class: 'small faint' }, 'Nothing overlaps. Your calendar is clean.'),
      conflicts.length ? h('button', { type: 'button', class: 'btn small', onclick: () => openConflicts() }, high ? `Fix ${high} now` : 'Review') : null);
  },
});

// Remember the last Calendar view between visits (per browser and on the server).
export const viewPref = { get: () => deskPrefs.peek('desk.schedule.view', 'week'), set: v => deskPrefs.set('desk.schedule.view', v).catch(() => {}) };

