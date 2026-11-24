/*
 * The coach's diary and session notes (WP7, F22).
 *
 *   #/diary[/YYYY-MM-DD]   the day's agenda beside a journal
 *   session notes          a slide-over from any session (diary, calendar, client)
 *   client › Sessions      past sessions with notes and an attendance ring
 *
 * Keys on /diary: [ and ] move a day, t jumps to today. The journal saves
 * itself two seconds after the coach stops typing.
 */
import {
  addDays, api, avatar, busy, button, clients, errorLine, fill, firstName, go, h, icon, initials, link, londonParts, parseDay, q, registerClientTab,
  registerNav, registerPanel, registerWidget, route, setCrumbs, toast, todayLondon,
} from './core.js';
import { emptyHero, pageHead, scoreRing, segmentedNav, skeleton, slideOver } from './ui.js';
import { ATTENDANCE, attendanceOf, longDay, shortDay, spanOf, whenOf, whoOf } from './f-calendar-lib.js';
import { findBookingNear, openFinder } from './f-calendar.js';

const enc = encodeURIComponent;
const DAY_RE = /^\d{4}-\d\d-\d\d$/;
const MOODS = [[1, 'Rough'], [2, 'Low'], [3, 'Steady'], [4, 'Good'], [5, 'Great']];

registerNav({ id: 'diary', label: 'Diary', icon: 'edit_note', group: 'schedule', order: 20 });

// MARK: - Session notes (slide-over)

/** Notes and attendance for one session: one tab per person on it. */
export function openNotes(b, { onSaved = null } = {}) {
  slideOver(`Notes · ${whoOf(b)}`, (body, close, { setTitle }) => {
    body.append(skeleton('card', { rows: 4 }));
    api('GET', `/api/sessions/${enc(b.id)}/notes`).then(out => {
      setTitle(`${shortDay(londonParts(out.booking.start).day)} · ${whoOf(b)}`);
      if (!out.notes.length) { fill(body, emptyHero({ icon: 'groups', title: 'Nobody on it.', line: 'Notes are kept per client, and nobody is booked on this session.' })); return; }
      let current = out.notes[0].clientId;
      const pane = h('div');
      const pick = out.notes.length > 1 ? segmentedNav(out.notes.map(n => [n.clientId, firstName(n.client.name)]), current, v => { current = v; drawPane(); }, { label: 'Attendee' }) : null;
      const drawPane = () => fill(pane, noteForm(out.booking, out.notes.find(n => n.clientId === current), onSaved));
      fill(body, h('div', { class: 'dy-notes-when' }, icon('schedule', 16), `${longDay(londonParts(out.booking.start).day)} · ${spanOf(out.booking.start, out.booking.end)}`), pick, pane);
      drawPane();
    }).catch(err => fill(body, errorLine(err)));
  }, { wide: true, className: 'dy-panel', deepLink: `notes:${b.id}` });
}
registerPanel('notes', id => {
  queueMicrotask(async () => { const b = await findBookingNear(id, null).catch(() => null); if (b) openNotes(b); });
  return null;
});

function noteForm(booking, note, onSaved) {
  const started = Date.parse(booking.start) <= Date.now();
  const st = { ...note };
  const status = h('div', { class: 'dy-save', 'aria-live': 'polite' });
  let timer = null, saving = Promise.resolve();
  const save = (patch, { quiet = false } = {}) => {
    Object.assign(st, patch);
    saving = saving.then(async () => {
      fill(status, icon('sync', 14), 'Saving…');
      try {
        const out = await api('PUT', `/api/sessions/${enc(booking.id)}/notes`, { clientId: note.clientId, ...patch });
        Object.assign(note, out.note);
        fill(status, icon('check', 14), 'Saved');
        onSaved?.(out.note);
        if (!quiet && patch.attendance) toast(`${firstName(note.client.name)}: ${attendanceOf(patch.attendance)[1].toLowerCase()}`);
      } catch (err) { fill(status, errorLine(err)); }
    });
    return saving;
  };
  const later = patch => { Object.assign(st, patch); clearTimeout(timer); fill(status, 'Editing…'); timer = setTimeout(() => save(patch, { quiet: true }), 900); };
  const att = h('div', { class: 'dy-att', role: 'radiogroup', 'aria-label': 'Attendance' });
  const drawAtt = () => fill(att, ATTENDANCE.map(([id, label, glyph, tone]) => h('button', {
    type: 'button', role: 'radio', class: `dy-att-btn tone-${tone}` + (st.attendance === id ? ' on' : ''), 'aria-checked': String(st.attendance === id),
    disabled: !started && id !== 'lateCancel', title: !started && id !== 'lateCancel' ? 'After the session starts' : null,
    onclick: () => { st.attendance = st.attendance === id ? null : id; drawAtt(); save({ attendance: st.attendance }); },
  }, icon(glyph, 16), label)));
  drawAtt();
  const area = (key, label, hint, rows = 2, cls = '') => {
    const t = h('textarea', { rows: String(rows), class: `dy-field ${cls}`, placeholder: hint, oninput: e => later({ [key]: e.target.value }) });
    t.value = st[key] ?? '';
    return h('label', { class: 'dy-block' }, h('span', { class: 'dy-label' }, label), t);
  };
  const share = h('button', { type: 'button', class: 'btn', onclick: () => busy(share, status, async () => {
    clearTimeout(timer);
    await save({ focus: st.focus, did: st.did, wins: st.wins, next: st.next, privateNote: st.privateNote }, { quiet: true });
    await api('POST', `/api/sessions/${enc(booking.id)}/notes/share`, { clientId: note.clientId });
    note.sharedMessageId = 'sent';
    toast(`Recap sent to ${firstName(note.client.name)}`);
    fill(shared, icon('done_all', 14), 'Recap shared');
  }) }, icon('send', 16), 'Share recap with client');
  const shared = h('span', { class: 'tiny muted dy-shared' }, note.sharedMessageId ? [icon('done_all', 14), 'Recap shared'] : null);
  return h('div', { class: 'dy-form' },
    h('div', { class: 'dy-who' }, avatar(initials(note.client.name), 40), h('div', { class: 'grow' }, h('div', { class: 'strong' }, note.client.name), h('div', { class: 'tiny muted' }, `${booking.kind === 'group' ? booking.title : 'Session'} · ${whenOf(booking.start)}`)),
      link(`/clients/${enc(note.clientId)}/sessions`, { class: 'btn small' }, 'Sessions')),
    h('div', { class: 'dy-label' }, 'Attendance'), att,
    h('div', { class: 'dy-grid' },
      area('focus', 'Focus', 'What the session was about'),
      area('wins', 'Wins', 'What went well'),
      area('did', 'What we did', 'Exercises, loads, drills', 4),
      area('next', 'Next time', 'What to build on')),
    h('div', { class: 'dy-private' }, area('privateNote', 'Private note', 'Only you see this in the desk', 2),
      h('p', { class: 'tiny faint m0' }, icon('lock', 12), ' Private: not shown in the app (but included if the client asks for their data).')),
    h('div', { class: 'dy-form-foot' }, status, h('span', { class: 'grow' }), shared, share,
      h('p', { class: 'tiny faint dy-share-hint' }, 'The recap sends Focus, Wins and Next time as one message. Never what you did in detail or the private note.')));
}

// MARK: - /diary/:day?

route('/diary/:day?', async (el, { day }, view) => {
  const today = todayLondon();
  const d = day && DAY_RE.test(day) ? day : today;
  setCrumbs([{ label: 'Diary', path: '/diary' }, ...(d === today ? [] : [{ label: shortDay(d) }])]);
  const date = parseDay(d);
  const rel = d === today ? 'Today' : d === addDays(today, -1) ? 'Yesterday' : d === addDays(today, 1) ? 'Tomorrow' : null;
  const nav = h('div', { class: 'dy-nav' },
    link(`/diary/${addDays(d, -1)}`, { class: 'ui-icon-btn', 'aria-label': 'Previous day', title: 'Previous day ([)' }, icon('chevron_left', 20)),
    d === today ? null : link('/diary', { class: 'btn small', title: 'Today (t)' }, 'Today'),
    link(`/diary/${addDays(d, 1)}`, { class: 'ui-icon-btn', 'aria-label': 'Next day', title: 'Next day (])' }, icon('chevron_right', 20)),
    h('input', { type: 'date', class: 'dy-date', value: d, 'aria-label': 'Go to a day', onchange: e => { if (DAY_RE.test(e.target.value)) go(`/diary/${e.target.value}`); } }));
  const head = pageHead({ eyebrow: rel ? `${rel} · ${longDay(d).split(' ')[0]}` : longDay(d).split(' ')[0], title: `${date.getUTCDate()} ${longDay(d).split(' ')[2]}`, accent: rel === 'Today' ? 'today' : null, sub: 'Your day, and your own notes on it.', actions: [nav] });
  const agendaBox = h('section', { class: 'dy-agenda', 'aria-label': 'Agenda' }, skeleton('table', { rows: 4 }));
  const journalBox = h('section', { class: 'dy-journal', 'aria-label': 'Journal' }, skeleton('card', { rows: 5 }));
  el.append(head, h('div', { class: 'dy-cols' }, agendaBox, journalBox));

  const onKey = e => {
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('.ui-slide-host, dialog[open]')) return;
    if (e.key === '[') go(`/diary/${addDays(d, -1)}`);
    else if (e.key === ']') go(`/diary/${addDays(d, 1)}`);
    else if (e.key === 't') go('/diary');
  };
  document.addEventListener('keydown', onKey);
  view.onLeave(() => document.removeEventListener('keydown', onKey));

  let data;
  try {
    data = await api('GET', `/api/diary/${d}`);
  } catch (err) { if (view.fresh()) { fill(agendaBox, errorLine(err)); journalBox.replaceChildren(); } return; }
  if (!view.fresh()) return;
  drawAgenda(agendaBox, d, data.agenda, () => api('GET', `/api/diary/${d}`).then(x => { if (view.fresh()) drawAgenda(agendaBox, d, x.agenda); }));
  drawJournal(journalBox, d, data.entry, view);
});

const KIND_LABEL = { session: 'Session', hold: 'Hold', busy: 'Busy', timeOff: 'Time off', letter: 'Letter', task: 'Task', campaign: 'Campaign', birthday: 'Birthday', anniversary: 'Anniversary' };

function drawAgenda(box, d, agenda, reload) {
  const sessions = agenda.filter(a => a.kind === 'session');
  const allDay = agenda.filter(a => !a.at);
  const timed = agenda.filter(a => a.at);
  const marked = sessions.filter(s => s.bookingKind === 'group' ? s.people.every(p => p.attendance) : s.attendance).length;
  const past = sessions.filter(s => Date.parse(s.end ?? s.at) < Date.now()).length;
  fill(box,
    h('header', { class: 'dy-sec-head' }, h('h2', null, 'Agenda'),
      h('span', { class: 'tiny muted' }, sessions.length ? `${sessions.length} session${sessions.length === 1 ? '' : 's'}${past ? ` · ${marked} of ${past} marked` : ''}` : 'No sessions')),
    allDay.length ? h('div', { class: 'dy-allday' }, allDay.map(a => h('div', { class: `dy-chip tone-${a.tone || 'data'}` }, icon(a.icon || 'event', 14), a.title, a.detail ? h('span', { class: 'faint' }, ` · ${a.detail}`) : null))) : null,
    timed.length ? h('ol', { class: 'dy-rail' }, timed.map(a => agendaItem(a, reload)))
      : emptyHero({ icon: 'calendar_month', title: 'Nothing booked.', line: d >= todayLondon() ? 'A clear day. Good for programming, or for a walk.' : 'A quiet day.', action: { label: 'Open the calendar', path: `/schedule?day=${d}` } }));
}

function agendaItem(a, reload) {
  const t = londonParts(a.at).time;
  const kindWord = KIND_LABEL[a.kind] ?? a.kind;
  const main = [
    h('div', { class: 'dy-item-title' }, a.title),
    a.detail ? h('div', { class: 'dy-item-detail' }, a.detail) : null,
  ];
  let extra = null;
  if (a.kind === 'session') {
    const ended = Date.parse(a.end ?? a.at) <= Date.now();
    const booking = { id: a.bookingId, kind: a.bookingKind, start: a.at, end: a.end, title: a.title, client: a.bookingKind === 'group' ? null : a.people[0] ?? null };
    if (a.bookingKind !== 'group' && a.people[0]) {
      const person = a.people[0];
      const att = h('div', { class: 'dy-quick', role: 'group', 'aria-label': `Attendance for ${person.name}` });
      const draw = cur => fill(att, ATTENDANCE.map(([id, label, glyph, tone]) => h('button', {
        type: 'button', class: `dy-qbtn tone-${tone}` + (cur === id ? ' on' : ''), 'aria-pressed': String(cur === id), title: label, 'aria-label': label,
        disabled: !ended && id !== 'lateCancel',
        onclick: async () => {
          const next = cur === id ? null : id;
          draw(next);
          try { await api('PUT', `/api/sessions/${enc(a.bookingId)}/notes`, { clientId: person.id, attendance: next }); toast(next ? `${firstName(person.name)}: ${label.toLowerCase()}` : 'Attendance cleared'); }
          catch (err) { draw(cur); toast(err.message, { error: true }); }
        },
      }, icon(glyph, 15))));
      draw(person.attendance);
      extra = att;
    } else if (a.bookingKind === 'group') {
      const n = a.people.filter(p => p.attendance).length;
      extra = h('span', { class: 'tiny muted' }, `${n}/${a.people.length} marked`);
    }
    main.push(a.noteFocus ? h('div', { class: 'dy-item-note' }, icon('sticky_note_2', 13), a.noteFocus) : null);
    main.push(h('div', { class: 'dy-item-actions' },
      h('button', { type: 'button', class: 'btn small', onclick: () => openNotes(booking, { onSaved: () => reload?.() }) }, icon('edit_note', 15), ended ? 'Notes' : 'Plan'),
      a.path ? link(a.path, { class: 'btn small' }, a.bookingKind === 'group' ? 'Class' : 'Client') : null));
  }
  const body = a.path && a.kind !== 'session' ? link(a.path, { class: 'dy-item-main' }, main) : h('div', { class: 'dy-item-main' }, main);
  return h('li', { class: `dy-item k-${a.kind}${a.tone && a.tone !== 'data' ? ` tone-${a.tone}` : ''}` },
    h('div', { class: 'dy-time' }, h('span', { class: 't-num' }, t), a.end ? h('span', { class: 'dy-time-end' }, londonParts(a.end).time) : null),
    h('span', { class: 'dy-node', 'aria-hidden': 'true' }, icon(a.icon || 'event', 14)),
    h('div', { class: 'dy-card' }, h('div', { class: 'dy-kind' }, kindWord), body, extra));
}

function drawJournal(box, d, entry, view) {
  const st = { body: entry?.body ?? '', mood: entry?.mood ?? null, tags: entry?.tags ?? [] };
  const status = h('span', { class: 'dy-save', 'aria-live': 'polite' }, entry?.updatedAt ? [icon('check', 14), 'Saved'] : null);
  let timer = null, dirty = false, inflight = Promise.resolve();
  const save = () => {
    clearTimeout(timer);
    if (!dirty) return inflight;
    dirty = false;
    const body = { body: st.body, mood: st.mood, tags: st.tags };
    inflight = inflight.then(async () => {
      fill(status, icon('sync', 14), 'Saving…');
      try { await api('PUT', `/api/diary/${d}`, body); fill(status, icon('check', 14), 'Saved'); words.textContent = wordCount(); strip?.refresh(); }
      catch (err) { dirty = true; fill(status, icon('error', 14), err.message); }
    });
    return inflight;
  };
  const touch = () => { dirty = true; fill(status, 'Writing…'); clearTimeout(timer); timer = setTimeout(save, 2000); };
  view.onLeave(() => { if (dirty) save(); });
  const wordCount = () => { const n = (st.body.trim().match(/\S+/g) ?? []).length; return n ? `${n} word${n === 1 ? '' : 's'}` : ''; };
  const words = h('span', { class: 'tiny faint' }, wordCount());
  const text = h('textarea', { class: 'dy-paper', 'aria-label': 'Journal', placeholder: 'How did today go? What did you notice, in them and in you?', oninput: e => { st.body = e.target.value; touch(); }, onblur: () => save() });
  text.value = st.body;
  const moods = h('div', { class: 'dy-moods', role: 'radiogroup', 'aria-label': 'Mood' });
  const drawMoods = () => fill(moods, MOODS.map(([v, label]) => h('button', {
    type: 'button', role: 'radio', class: `dy-mood m${v}` + (st.mood === v ? ' on' : ''), 'aria-checked': String(st.mood === v), 'aria-label': `Mood: ${label}`, title: label,
    onclick: () => { st.mood = st.mood === v ? null : v; drawMoods(); dirty = true; save(); },
  }, h('span', { class: 'dy-mood-dot' }))), h('span', { class: 'tiny muted dy-mood-word' }, st.mood ? MOODS[st.mood - 1][1] : 'Mood'));
  drawMoods();
  const tags = h('div', { class: 'dy-tags' });
  const tagIn = h('input', { class: 'dy-tag-in', maxlength: '24', placeholder: st.tags.length ? 'Add a tag' : 'Tags: training, admin…', 'aria-label': 'Add a tag',
    onkeydown: e => {
      if ((e.key === 'Enter' || e.key === ',') && tagIn.value.trim()) {
        e.preventDefault();
        const t = tagIn.value.trim().toLowerCase().slice(0, 24);
        if (!st.tags.includes(t) && st.tags.length < 10) { st.tags = [...st.tags, t]; dirty = true; save(); }
        tagIn.value = ''; drawTags();
      } else if (e.key === 'Backspace' && !tagIn.value && st.tags.length) { st.tags = st.tags.slice(0, -1); dirty = true; save(); drawTags(); }
    } });
  const drawTags = () => fill(tags, st.tags.map(t => h('span', { class: 'dy-tag' }, `#${t}`, h('button', { type: 'button', class: 'dy-tag-x', 'aria-label': `Remove ${t}`, onclick: () => { st.tags = st.tags.filter(x => x !== t); dirty = true; save(); drawTags(); } }, icon('close', 12)))), tagIn);
  drawTags();
  const stripBox = h('div', { class: 'dy-history' });
  const strip = heatStrip(stripBox, d);
  fill(box,
    h('header', { class: 'dy-sec-head' }, h('h2', null, 'Journal'), h('span', { class: 'row gap4' }, words, status)),
    h('div', { class: 'dy-sheet' }, h('div', { class: 'dy-sheet-date' }, longDay(d)), text, h('div', { class: 'dy-sheet-foot' }, moods)),
    tags,
    stripBox);
}

const WEEKS = 24;
/** The last 24 weeks of writing as a heat strip (darker = more words); each day opens that page. */
function heatStrip(box, current) {
  const today = todayLondon();
  const end = current > today ? current : today;
  const startMonday = (() => { const s = addDays(end, -7 * WEEKS + 1); const w = parseDay(s).getUTCDay(); return addDays(s, w === 0 ? -6 : 1 - w); })();
  const refresh = async () => {
    let days = [];
    try { days = (await api('GET', `/api/diary?${q({ from: startMonday, to: end })}`)).days; } catch { /* the strip is decoration */ }
    const by = new Map(days.map(x => [x.day, x]));
    const cells = [];
    for (let x = startMonday; x <= end; x = addDays(x, 1)) {
      const e = by.get(x);
      const lvl = !e ? 0 : e.words >= 120 ? 4 : e.words >= 60 ? 3 : e.words >= 25 ? 2 : 1;
      cells.push(link(`/diary/${x}`, { class: `dy-cell h${lvl}` + (x === current ? ' cur' : '') + (x > today ? ' future' : ''), title: `${shortDay(x)}${e ? ` · ${e.words} words${e.mood ? ` · mood ${e.mood}` : ''}` : ''}`, 'aria-label': `${longDay(x)}${e ? `, ${e.words} words` : ', nothing written'}` }));
    }
    const written = days.filter(x => x.words > 0).length;
    let streak = 0;
    for (let x = today; by.get(x)?.words; x = addDays(x, -1)) streak++;
    fill(box, h('div', { class: 'dy-sec-head' }, h('h3', null, 'History'), h('span', { class: 'tiny muted' }, `${written} days written in ${WEEKS} weeks${streak > 1 ? ` · ${streak}-day streak` : ''}`)),
      h('div', { class: 'dy-heat', role: 'list' }, cells),
      h('div', { class: 'dy-heat-key tiny faint' }, 'Less', [0, 1, 2, 3, 4].map(l => h('span', { class: `dy-cell h${l}`, 'aria-hidden': 'true' })), 'More'));
  };
  refresh();
  return { refresh };
}

// MARK: - Today widget: the diary (m)

registerWidget({
  id: 'diary', title: 'Today’s diary', icon: 'edit_note', size: 'm', order: 44,
  render: async body => {
    const d = todayLondon();
    const out = await api('GET', `/api/diary/${d}`);
    const timed = out.agenda.filter(a => a.at && Date.parse(a.end ?? a.at) > Date.now()).slice(0, 4);
    const sessions = out.agenda.filter(a => a.kind === 'session');
    const toMark = sessions.filter(s => Date.parse(s.end ?? s.at) < Date.now() && !(s.bookingKind === 'group' ? s.people.every(p => p.attendance) : s.attendance)).length;
    body.append(
      h('div', { class: 'dy-w-top' },
        h('div', null, h('span', { class: 't-number' }, String(sessions.length)), h('span', { class: 'small muted' }, ` session${sessions.length === 1 ? '' : 's'} today`)),
        toMark ? h('span', { class: 'cal-state tone-attention' }, icon('checklist', 14), `${toMark} to mark`) : null),
      timed.length ? h('ul', { class: 'dy-w-list' }, timed.map(a => h('li', null, h('span', { class: 't-num tiny' }, londonParts(a.at).time), icon(a.icon || 'event', 14), h('span', { class: 'clamp1 small' }, a.title))))
        : h('p', { class: 'small faint' }, 'Nothing else on today.'),
      h('div', { class: 'dy-w-foot' }, out.entry?.body ? h('span', { class: 'small muted clamp1 dy-w-quote' }, `“${out.entry.body.slice(0, 90)}”`) : h('span', { class: 'small faint' }, 'Nothing written yet today.'),
        link('/diary', { class: 'btn small' }, out.entry?.body ? 'Open' : 'Write')));
  },
});

// MARK: - Client › Sessions: upcoming, past with notes, and the attendance ring

registerClientTab({ key: 'sessions', label: 'Sessions', order: 50, render: sessionsTab });

async function sessionsTab(box, { client: given, view }) {
  const id = given.id;
  // The host may not know the name yet (a built-in tab draws before the detail loads).
  const client = (await clients().catch(() => [])).find(c => c.id === id) ?? given;
  const today = todayLondon();
  fill(box, skeleton('card', { rows: 3 }));
  let att, upcoming;
  try {
    [att, upcoming] = await Promise.all([
      api('GET', `/api/coach/clients/${enc(id)}/attendance`),
      api('GET', `/api/bookings?${q({ clientId: id, from: today, to: addDays(today, 60) })}`).then(x => x.bookings.filter(b => Date.parse(b.end) >= Date.now())),
    ]);
  } catch (err) { if (view?.fresh?.() !== false) fill(box, errorLine(err)); return; }
  if (view && !view.fresh()) return;
  const reload = () => sessionsTab(box, { client, view });
  let showAll = false;
  const first = firstName(client.name);
  const stat = (n, label, tone) => h('div', { class: 'dy-stat' }, h('span', { class: `t-number${tone ? ` tone-${tone}` : ''}` }, String(n)), h('span', { class: 'tiny muted' }, label));
  const rate = att.rate;
  fill(box, h('div', { class: 'dy-cl' },
    h('section', { class: 'dy-cl-hero' },
      scoreRing(rate, { size: 88, label: 'Attendance', band: rate === null ? { word: 'No sessions yet', tone: 'data' } : rate >= 90 ? { word: 'Reliable', tone: 'ok' } : rate >= 75 ? { word: 'Mostly there', tone: 'attention' } : { word: 'Slipping', tone: 'urgent' } }),
      h('div', { class: 'dy-cl-stats' },
        h('div', { class: 'dy-cl-caption' }, `Attendance, last 6 months`),
        h('div', { class: 'dy-stats' }, stat(att.attended, 'attended'), stat(att.late, 'late', att.late ? 'attention' : null), stat(att.noShow, 'no-shows', att.noShow ? 'urgent' : null), stat(att.lateCancel, 'late cancels', att.lateCancel ? 'attention' : null))),
      h('div', { class: 'dy-cl-actions' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => openFinder({ client }) }, icon('travel_explore', 18), `Find a slot for ${first}`))),
    h('div', { class: 'dy-cl-cols' },
      h('section', null, h('div', { class: 'cal-eyebrow' }, 'Upcoming'),
        upcoming.length ? h('div', { class: 'dy-cl-list' }, upcoming.slice(0, 8).map(b => sessionCard(b, null, reload)))
          : h('p', { class: 'small faint' }, `Nothing booked. Use “Find a slot” to book ${first} in.`)),
      h('section', null, h('div', { class: 'cal-eyebrow' }, 'Past sessions'),
        att.sessions.length ? pastList() : h('p', { class: 'small faint' }, 'No past sessions in the last six months.')))));
  function pastList() {
    const list = h('div', { class: 'dy-cl-list' });
    const draw = () => fill(list, (showAll ? att.sessions : att.sessions.slice(0, 8)).map(s => sessionCard({ id: s.bookingId, kind: s.kind, start: s.start, end: s.end, title: s.title, client }, s, reload)),
      att.sessions.length > 8 && !showAll ? h('button', { type: 'button', class: 'btn small dy-more', onclick: () => { showAll = true; draw(); } }, `Show all ${att.sessions.length}`) : null);
    draw();
    return list;
  }
}

function sessionCard(b, s, reload) {
  const p = londonParts(b.start);
  const a = s ? attendanceOf(s.attendance) : null;
  return h('button', { type: 'button', class: 'dy-sess', onclick: () => openNotes({ ...b, client: b.client }, { onSaved: () => reload() }) },
    h('div', { class: 'dy-sess-date' }, h('span', { class: 'dy-sess-d' }, String(parseDay(p.day).getUTCDate())), h('span', { class: 'tiny' }, shortDay(p.day).split(' ')[2])),
    h('div', { class: 'grow' },
      h('div', { class: 'small strong' }, `${shortDay(p.day).split(' ')[0]} · ${b.kind === 'group' ? b.title : b.kind === 'video' ? 'Video call' : '1:1'} · ${spanOf(b.start, b.end)}`),
      s?.note?.focus ? h('div', { class: 'tiny muted clamp1' }, s.note.focus) : s ? h('div', { class: 'tiny faint' }, 'No notes yet') : h('div', { class: 'tiny faint' }, b.location || 'Booked')),
    s ? (a ? h('span', { class: `cal-state tone-${a[3]}` }, icon(a[2], 14), a[1]) : h('span', { class: 'cal-state tone-data' }, icon('check', 14), 'Counted')) : null,
    s?.shared ? h('span', { class: 'dy-sess-shared', title: 'Recap shared' }, icon('done_all', 14)) : null,
    icon('chevron_right', 18));
}
