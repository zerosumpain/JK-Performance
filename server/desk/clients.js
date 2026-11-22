/*
 * Clients: the coach's client list (grouped by what they need) and one
 * client's page with its tabs: Plan (write and publish workouts, assign a
 * programme), Feedback (weekly write-ups, check-in replies, forms and
 * autoflows), Health (Apple Health, if shared), Habits (habits and nutrition
 * targets), Sessions (bookings) and Progress (weight, records, photos).
 * Ported from the iPhone app's ClientsView and ClientDetailView.
 */
import {
  COLOR, DAYS, MONTHS, addDays, api, apiBlob, avatar, busy, button, card, chip, clearDraft, clientById, clients, confirmBox, dot,
  emptyCard, errorLine, eyebrow, field, fill, firstName, fmtRelative, fmtShort, fmtTime, fmtWeekday, h, icon, link, loading, londonParts,
  mondayOf, parseDay, q, readDraft, route, screenHeader, segmented, sheet, toast, todayLondon, writeDraft,
  planName, plans,
} from './core.js';

// MARK: - Formatting (the iPhone app's Fmt)

const enc = encodeURIComponent;
const fmtN = (v, digits = 1) => (v === null || v === undefined ? '–' : Number(v).toLocaleString('en-GB', { maximumFractionDigits: digits }));
const pad2 = n => String(n).padStart(2, '0');
/** "8h 06m" */
const fmtHM = m => { const t = Math.round(m); return `${Math.floor(t / 60)}h ${pad2(t % 60)}m`; };
/** "32 min", or "1h 05m" from an hour. */
const fmtDuration = m => { const t = Math.round(m); return t < 60 ? `${t} min` : `${Math.floor(t / 60)}h ${pad2(t % 60)}m`; };
/** "+1.2", "−0.8" */
const fmtDelta = v => (v < 0 ? `−${fmtN(-v)}` : v > 0 ? `+${fmtN(v)}` : fmtN(v));
/** "Mon" for a YYYY-MM-DD day. */
const weekdayOf = s => DAYS[parseDay(s).getUTCDay()];
/** "Monday 3 Nov" for an instant, in London. */
const longDayOf = iso => { const d = londonParts(iso).day; return `${fmtWeekday(d)} ${fmtShort(d)}`; };
/** "Aug 2026" */
const monthYear = s => { const d = parseDay(s); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const GOAL = { strength: 'Get stronger', muscle: 'Build muscle', fatloss: 'Lose fat', fitness: 'Get fitter', performance: 'Perform in my sport', mobility: 'Move better', health: 'Feel healthier' };
const EXPERIENCE = { new: 'New to training', some: 'Some experience', experienced: 'Experienced' };
const TIME = { morning: 'mornings', midday: 'middays', evening: 'evenings', varies: 'times vary' };

/** The client's answers to the app's first-run questions. */
function aboutCard(profile, first) {
  if (!profile) return h('p', { class: 'tiny faint cl-about' }, `${first} hasn’t answered the first-run questions yet.`);
  const week = [profile.daysPerWeek ? `${profile.daysPerWeek} day${profile.daysPerWeek === 1 ? '' : 's'} a week` : null, TIME[profile.preferredTime] ?? null].filter(Boolean).join(', ');
  return card({ class: 'cl-about' },
    h('div', { class: 'eyebrow m0' }, 'About'),
    profile.goals?.length ? h('div', { class: 'chips' }, profile.goals.map(g => chip(GOAL[g] ?? g, { on: true }))) : null,
    h('div', { class: 'small muted' }, [EXPERIENCE[profile.experience], week].filter(Boolean).join(' · ') || 'No answers about training yet'),
    profile.injuries ? h('div', { class: 'small' }, h('span', { class: 'faint' }, 'To know: '), profile.injuries) : null);
}
const capitalise = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

// MARK: - Client text (the iPhone app's ClientText)

const WAITING_KINDS = ['urgent', 'message', 'form', 'checkin'];
/** Something of theirs is waiting on the coach. */
const needsYou = c => WAITING_KINDS.includes(c.demand?.kind ?? '');
const quietOrIdle = c => c.demand?.kind === 'quiet' || c.demand?.kind === 'inactive';
function tintOf(c) {
  const k = c.demand?.kind;
  if (k === 'urgent') return COLOR.urgent;
  if (k === 'message' || k === 'form' || k === 'checkin') return COLOR.waiting;
  return null;
}
function flagText(f) {
  if (f === 'no-workout-yet') return 'no workout yet';
  if (f === 'checkin-overdue') return 'check-in overdue';
  const m = /^no-workout-(\d+)d$/.exec(f);
  return m ? `no workout in ${m[1]} days` : f.replaceAll('-', ' ');
}
function planLine(c) {
  const parts = [planName(c.plan)];
  if (c.flags?.length) parts.push(flagText(c.flags[0]));
  else if (c.adherence !== null && c.adherence !== undefined) parts.push(`adherence ${c.adherence}%`);
  else if (c.checkinDue) parts.push('check-in due');
  return parts.join(' · ');
}
/** Why they're where they are: "Sent you a message · 2 h ago", else the usual plan line. */
function reasonOf(c) {
  const d = c.demand;
  if (!d?.reason) return planLine(c);
  if (d.at && WAITING_KINDS.includes(d.kind)) return `${d.reason} · ${fmtRelative(d.at)}`;
  return d.reason;
}
/** The tab that answers what they need. */
const tabFor = c => (['urgent', 'form', 'checkin'].includes(c.demand?.kind) ? 'feedback' : 'plan');

// MARK: - Small pieces

const SVG = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
}
function pathIcon(d, size = 18) {
  return svgEl('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon' },
    svgEl('path', { d }));
}
/** The habit icons the iPhone app offers (SF Symbol names), drawn for the web. */
const HABIT_ICONS = {
  'checkmark.circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6',
  drop: 'M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z',
  moon: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z',
  'shoeprints.fill': 'M7 3c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5zM5 15h4v2a2 2 0 0 1-4 0zM17 7c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5zM15 19h4v1a2 2 0 0 1-4 0z',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  leaf: 'M5 19c0-9 6-14 15-14 0 9-5 15-14 15zM5 19l8-8',
  'figure.walk': 'M13 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM10 22l2-7 3 3v4M9 12l2-5 4 3 3 1M11 7l-3 3v3',
  pills: 'M4.5 13.5l6-6a3.5 3.5 0 0 1 5 5l-6 6a3.5 3.5 0 0 1-5-5zM7.5 10.5l5 5',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21a2 2 0 0 1 2-2h13',
  'fork.knife': 'M7 3v18M4 3v5a3 3 0 0 0 6 0V3M17 21V3c-2 0-3 3-3 7h3',
};
const habitIcon = (name, size) => pathIcon(HABIT_ICONS[name] || HABIT_ICONS['checkmark.circle'], size);
const iconTile = (node, size = 32) => h('span', { class: 'cl-tile', style: { width: `${size}px`, height: `${size}px` } }, node);

/** A stat tile with a label over a value, and an optional small line under it (the iPhone's StatTile). */
const tile = (label, value, deltaText) => h('div', { class: 'cl-stat' },
  h('div', { class: 'k' }, label), h('div', { class: 'v' }, value), deltaText ? h('div', { class: 'd' }, deltaText) : null);

/** A dashed full-width button ("+ Add exercise from the library"). */
const dashed = (text, onclick) => h('button', { class: 'cl-dashed', type: 'button', onclick }, icon('plus', 14), text);

/** "Weekday / day number" block with a title and detail (the iPhone's UpcomingRow). */
function upcomingRow(dayString, title, detail, { chevron = true, onclick = null } = {}) {
  const inner = [
    h('div', { class: 'cl-date' }, h('div', { class: 'wd' }, weekdayOf(dayString).toUpperCase()), h('div', { class: 'dn' }, String(parseDay(dayString).getUTCDate()))),
    h('div', { class: 'grow' }, h('div', { class: 'cl-title' }, title), h('div', { class: 'tiny faint' }, detail)),
    chevron ? icon('chevron', 14) : null,
  ];
  return onclick ? h('button', { class: 'cl-upcoming', type: 'button', onclick }, inner) : h('div', { class: 'cl-upcoming' }, inner);
}

/** The iPhone's Loadable: loading, then content, or an error with Try again. */
async function loadInto(box, view, loader, draw) {
  fill(box, loading());
  try {
    const data = await loader();
    if (!view.fresh() || !box.isConnected) return;
    fill(box);
    draw(data);
  } catch (err) {
    if (!view.fresh()) return;
    fill(box, errorLine(err), button('Try again', () => loadInto(box, view, loader, draw), { small: true }));
  }
}

/** A small drop-down menu under a button (the iPhone's Menu). items: [[label, fn]]. */
function menuButton(label, iconName, items, { disabled = false } = {}) {
  const wrap = h('span', { class: 'cl-menu' });
  const pop = h('div', { class: 'cl-menu-pop', role: 'menu', hidden: true });
  const close = () => { pop.hidden = true; document.removeEventListener('click', outside, true); };
  const outside = e => { if (!wrap.contains(e.target)) close(); };
  const btn = h('button', {
    class: 'btn small', type: 'button', disabled: disabled || !items.length, 'aria-haspopup': 'menu',
    onclick: () => {
      if (!pop.hidden) { close(); return; }
      pop.hidden = false;
      document.addEventListener('click', outside, true);
    },
  }, icon(iconName, 14), label);
  fill(pop, items.map(([text, fn]) => h('button', { type: 'button', role: 'menuitem', onclick: () => { close(); fn(); } }, text)));
  wrap.append(btn, pop);
  return wrap;
}

/** Seven day buttons, a dot under days in `marked` (the iPhone's DayStrip). */
function dayStrip(monday, selected, marked, onpick) {
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(monday, i));
  return h('div', { class: 'cl-strip' }, days.map(d => h('button', {
    type: 'button', class: d === selected ? 'sel' : '', 'aria-pressed': String(d === selected), onclick: () => onpick(d),
  }, h('span', { class: 'wd' }, weekdayOf(d)), h('span', { class: 'dn' }, String(parseDay(d).getUTCDate())),
  h('span', { class: 'mk' + (marked.has(d) ? ' on' : '') }))));
}

/** "‹  Week of 17 Nov  ›" */
const weekNav = (monday, step, { canBack = true } = {}) => h('div', { class: 'cl-weeknav' },
  h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous week', disabled: !canBack, onclick: () => step(-7) }, icon('back', 16)),
  h('span', { class: 'small muted' }, `Week of ${fmtShort(monday)}`),
  h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next week', onclick: () => step(7) }, icon('chevron', 16)));

const checkCircle = on => h('span', { class: 'cl-check' + (on ? ' on' : '') }, on ? icon('check', 12) : null);

// MARK: - Clients list

route('/clients', async (el, _params, view) => {
  await plans().catch(() => null); // the coach's plan names
  const search = h('input', { type: 'search', placeholder: 'Search clients', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search clients' });
  const listBox = h('div');
  el.append(
    screenHeader('Coach', 'Clients', link('/programs/programs', { class: 'btn small' }, icon('programs', 14), 'Programs')),
    h('label', { class: 'cl-search card' }, icon('search', 16), search),
    listBox);

  const row = c => {
    const tint = tintOf(c);
    return link(`/clients/${enc(c.id)}/${tabFor(c)}`, { class: 'cl-row' },
      h('span', { class: 'cl-av' }, avatar(c.initials || c.name, 34), tint ? h('span', { class: 'cl-av-dot', style: { background: tint } }) : null),
      h('div', { class: 'grow' },
        h('div', { class: 'strong' }, c.name),
        h('div', { class: 'tiny clamp1', title: reasonOf(c), style: { color: c.demand?.kind === 'urgent' ? COLOR.urgent : 'var(--faint)' } }, reasonOf(c))),
      c.unread > 0 ? h('span', { class: 'muted', title: `${c.unread} unread` }, icon('bubble', 14)) : null,
      h('span', { class: 'faint' }, icon('chevron', 14)));
  };
  const group = (title, list) => (list.length ? h('section', { class: 'cl-group' },
    title ? eyebrow(title, String(list.length)) : null,
    card({ class: 'flush' + (title ? '' : ' cl-rows') }, list.map(row))) : null);

  let all = null;
  const draw = () => {
    if (!all) return;
    const query = search.value.trim().toLowerCase();
    const shown = all.filter(c => !query || c.name.toLowerCase().includes(query));
    if (!shown.length) {
      fill(listBox, emptyCard('people', all.length ? 'No matches' : 'No clients yet', all.length ? null : 'Clients appear here when they sign up.'));
    } else if (!query) {
      // The server sends them most-in-need first; group them so the line between is clear.
      // On a wide screen the three groups sit side by side.
      fill(listBox, h('div', { class: 'cl-groups' },
        group('Needs you', shown.filter(needsYou)),
        group('Check in with', shown.filter(quietOrIdle)),
        group('On track', shown.filter(c => !needsYou(c) && !quietOrIdle(c)))));
    } else {
      fill(listBox, group(null, shown));
    }
  };
  search.addEventListener('input', draw);
  await loadInto(listBox, view, () => clients(true), list => { all = list; draw(); });
});

// MARK: - One client

const TABS = [['plan', 'Plan'], ['feedback', 'Feedback'], ['health', 'Health'], ['habits', 'Habits'], ['sessions', 'Sessions'], ['progress', 'Progress']];
/** Sections of the Feedback tab other screens may link to: #/clients/<id>/checkins scrolls there. */
const FEEDBACK_SECTIONS = ['checkins', 'forms', 'autoflows'];
const details = new Map(); // client id → last GET /api/coach/clients/:id, so switching tabs doesn't flash

route('/clients/:id/:tab?', async (el, params, view) => {
  plans().catch(() => null);
  const id = params.id;
  const anchor = FEEDBACK_SECTIONS.includes(params.tab) ? params.tab : null;
  const tab = anchor ? 'feedback' : TABS.some(([k]) => k === params.tab) ? params.tab : 'plan';
  const summary = clientById(id);
  const head = h('div');
  const body = h('div', { class: 'cl-tab' });
  const ctx = { id, view, name: summary?.name || details.get(id)?.client.name || 'Client' };
  ctx.first = () => firstName(ctx.name);

  const drawHead = (detail, error) => {
    const c = detail?.client;
    if (c) ctx.name = c.name;
    const sub = c ? [planName(c.plan), c.since ? `since ${monthYear(c.since)}` : null].filter(Boolean).join(' · ') : ' ';
    const chips = [];
    if (detail) {
      for (const reason of c.demand?.urgent ?? []) chips.push(chip(`⚠︎ ${reason}`, { tint: COLOR.urgent }));
      if (c.adherence !== null && c.adherence !== undefined) chips.push(chip(`Adherence ${c.adherence}%`));
      for (const f of c.flags ?? []) chips.push(chip(capitalise(flagText(f))));
      if (c.checkinDue) chips.push(chip('Check-in due'));
      if (detail.healthShared === false) chips.push(chip('Health not shared'));
      const hd = detail.health;
      if (hd) {
        if (hd.steps !== null) chips.push(chip(`${fmtN(hd.steps, 0)} steps`));
        if (hd.sleepMinutes !== null) chips.push(chip(`Slept ${fmtHM(hd.sleepMinutes)}`));
        if (hd.restingHr !== null) chips.push(chip(`RHR ${fmtN(hd.restingHr, 0)}`));
      }
      if (detail.nextWorkout) chips.push(chip(`Next: ${detail.nextWorkout.title} ${fmtShort(detail.nextWorkout.date)}`));
    }
    fill(head,
      h('div', { class: 'cl-crumb' }, link('/clients', { class: 'small muted' }, icon('back', 14), 'Clients')),
      h('div', { class: 'cl-head' },
        avatar(c?.initials || ctx.name, 48),
        h('div', { class: 'grow' }, h('h1', null, ctx.name), h('div', { class: 'small faint' }, sub)),
        link(`/messages/${enc(id)}`, { class: 'btn', title: `Message ${ctx.first()}` }, icon('bubble', 16), 'Message')),
      error ? errorLine(error) : null,
      chips.length ? h('div', { class: 'cl-chips' }, chips) : null,
      detail ? aboutCard(detail.profile, ctx.first()) : null,
      h('nav', { class: 'tabs', 'aria-label': 'Client' }, TABS.map(([k, label]) =>
        link(`/clients/${enc(id)}/${k}`, { class: 'tab' + (k === tab ? ' sel' : ''), 'aria-current': k === tab ? 'page' : null }, label))));
  };
  drawHead(details.get(id) || null);
  el.append(head, body);

  // The header loads beside the tab; neither waits for the other.
  api('GET', `/api/coach/clients/${enc(id)}`).then(d => {
    details.set(id, d);
    if (view.fresh()) drawHead(d);
  }, err => { if (view.fresh()) drawHead(details.get(id) || null, err); });

  const draw = { plan: planTab, feedback: feedbackTab, health: healthTab, habits: habitsTab, sessions: sessionsTab, progress: progressTab }[tab];
  await draw(body, ctx, { anchor });
});

// MARK: - Plan tab

function workoutDraft(w) {
  return {
    id: w.id, date: w.date, title: w.title, startsAt: w.startsAt || '', location: w.location || '', notes: w.notes || '',
    items: w.items.slice().sort((a, b) => a.order - b.order).map(i => ({
      id: i.id, exerciseId: i.exercise.id, exerciseName: i.exercise.name, sets: i.sets, reps: i.reps, load: i.load || '', rpe: i.rpe || '', note: i.note || '',
    })),
    published: w.published, editedBy: w.editedBy, editedAt: w.editedAt, completedAt: w.completedAt,
    loggedSets: w.items.reduce((n, i) => n + i.logged.length, 0),
  };
}
const newDraft = date => ({ id: null, date, title: '', startsAt: '', location: '', notes: '', items: [], published: false, editedBy: null, editedAt: null, completedAt: null, loggedSets: 0 });
/** The fields that are saved, to tell a changed draft from the saved one. */
const draftShape = d => JSON.stringify([d.date, d.title, d.startsAt, d.location, d.notes, d.items.map(i => [i.id, i.exerciseId, Number(i.sets), i.reps, i.load, i.rpe, i.note])]);
function workoutInput(d, clientId) {
  return {
    date: d.date, title: d.title.trim(), startsAt: d.startsAt.trim() || null, location: d.location.trim() || null, notes: d.notes,
    items: d.items.map(i => ({
      ...(i.id ? { id: i.id } : {}), exerciseId: i.exerciseId, sets: Number(i.sets), reps: String(i.reps).trim(), load: String(i.load).trim(),
      rpe: String(i.rpe).trim() || null, note: String(i.note).trim() || null,
    })),
    clientId: d.id ? undefined : clientId,
  };
}

async function planTab(box, ctx) {
  const { id: clientId, view } = ctx;
  let day = todayLondon();
  let week = null; // workouts of the shown week
  let draft = null, saved = null; // the open workout, and its last saved shape
  let notice = null, error = null, working = false;

  const top = h('div', { class: 'spread cl-plan-top' },
    h('span', { class: 'small faint' }, 'Write and publish workouts, or lay down a programme.'),
    button(h('span', { class: 'row gap4' }, icon('programs', 14), 'Assign a programme'), async () => {
      await assignProgramSheet({ client: { id: clientId, name: ctx.name } });
      if (view.fresh()) await loadWeek(); // closed with × after assigning still shows the new drafts
    }, { small: true }));
  const nav = h('div');
  const strip = h('div');
  const content = h('div');
  fill(box, top, nav, strip, content);

  const dayWorkouts = () => (week || []).filter(w => w.date === day);

  const drawNav = () => {
    fill(nav, weekNav(mondayOf(day), n => { day = addDays(day, n); afterDayChange(true); }));
    fill(strip, dayStrip(mondayOf(day), day, new Set((week || []).map(w => w.date)), d => { day = d; afterDayChange(false); }));
  };

  async function afterDayChange(weekMayChange) {
    if (weekMayChange) { week = null; drawNav(); draw(); await loadWeek(); return; }
    drawNav();
    const first = dayWorkouts()[0];
    if (first) await open(first.id); else { draft = null; saved = null; notice = null; draw(); }
  }

  async function loadWeek() {
    const from = mondayOf(day);
    try {
      week = (await api('GET', `/api/workouts?${q({ clientId, from, to: addDays(from, 6) })}`)).workouts;
      error = null;
    } catch (err) {
      error = err;
    }
    if (!view.fresh()) return;
    drawNav();
    const first = dayWorkouts()[0];
    if (week && (!draft || draft.date !== day) && first) await open(first.id);
    else { if (draft && draft.date !== day) { draft = null; saved = null; } draw(); }
  }

  async function refreshWeekQuietly() {
    const from = mondayOf(day);
    try { week = (await api('GET', `/api/workouts?${q({ clientId, from, to: addDays(from, 6) })}`)).workouts; } catch { /* keep the old list */ }
  }

  async function open(id) {
    try {
      const w = await api('GET', `/api/workouts/${enc(id)}`);
      draft = workoutDraft(w);
      saved = draftShape(draft);
      notice = null; error = null;
    } catch (err) {
      error = err;
    }
    if (view.fresh()) { drawNav(); draw(); }
  }

  const valid = d => d.title.trim() !== '' && d.items.length > 0;

  async function save(publish) {
    if (!draft) return;
    working = true; syncButtons();
    try {
      let w;
      if (draftShape(draft) !== saved || !draft.id) {
        const body = workoutInput(draft, clientId);
        w = draft.id ? await api('PUT', `/api/workouts/${enc(draft.id)}`, body) : await api('POST', '/api/workouts', body);
      } else {
        w = await api('GET', `/api/workouts/${enc(draft.id)}`);
      }
      if (publish && !w.published) w = await api('POST', `/api/workouts/${enc(w.id)}/publish`);
      draft = workoutDraft(w);
      saved = draftShape(draft);
      notice = publish ? `Published. ${ctx.name} can see it now.` : w.published ? 'Saved. The client sees the change.' : 'Saved as a draft.';
      error = null;
      await refreshWeekQuietly();
    } catch (err) {
      error = err;
    }
    working = false;
    if (view.fresh()) { drawNav(); draw(); }
  }

  async function remove() {
    if (!draft?.id) return;
    const ok = await confirmBox('Delete this workout?', { ok: 'Delete workout', danger: true, detail: draft.loggedSets ? `${draft.loggedSets} logged sets go with it.` : null });
    if (!ok) return;
    try {
      await api('DELETE', `/api/workouts/${enc(draft.id)}`);
      draft = null; saved = null; notice = null;
      await refreshWeekQuietly();
    } catch (err) {
      error = err;
    }
    if (view.fresh()) { drawNav(); draw(); }
  }

  // Save / Publish follow the draft as it's typed, without redrawing the form.
  let saveBtn = null, publishBtn = null, headTitle = null;
  function syncButtons() {
    if (!draft || !saveBtn) return;
    const same = draftShape(draft) === saved;
    saveBtn.disabled = working || !valid(draft) || same;
    publishBtn.disabled = working || !valid(draft) || (draft.published && same);
    publishBtn.textContent = working ? 'Saving…' : draft.published && same ? 'Published' : `Publish to ${ctx.first()}`;
    if (headTitle) headTitle.textContent = `${fmtWeekday(draft.date)} · ${draft.title.trim() || 'New workout'}`;
  }

  function statusLine(d) {
    const parts = [];
    parts.push(!d.id ? 'Not saved yet' : d.published ? 'Published' : 'Draft · the client can\'t see it');
    if (d.editedAt) parts.push(`last edit by ${d.editedBy === 'coach' ? 'you' : ctx.name} ${fmtRelative(d.editedAt)}`);
    if (d.loggedSets > 0) parts.push(`${d.loggedSets} sets logged`);
    if (d.completedAt) parts.push('completed');
    return parts.join(' · ');
  }

  function textField(label, key, placeholder, attrs = {}) {
    return field(label, h('input', { ...attrs, value: draft[key], placeholder, oninput: e => { draft[key] = e.target.value; syncButtons(); } }));
  }

  function itemsEditor(itemsBox) {
    const d = draft;
    if (!d.items.length) { fill(itemsBox, h('p', { class: 'tiny faint' }, 'No exercises yet.')); return; }
    const redraw = () => { itemsEditor(itemsBox); syncButtons(); };
    fill(itemsBox, d.items.map((it, i) => {
      const input = (label, key, attrs, cls) => h('div', { class: `cl-f ${cls || ''}` }, h('label', null, label),
        h('input', { ...attrs, value: it[key], oninput: e => { it[key] = e.target.value; syncButtons(); } }));
      return h('div', { class: 'cl-item' },
        h('div', { class: 'spread' },
          h('div', { class: 'row gap4' }, h('span', { class: 'strong' }, it.exerciseName || it.exerciseId), it.id ? null : h('span', { class: 'cl-new' }, 'New')),
          h('div', { class: 'row gap4 cl-item-tools' },
            h('button', { class: 'icon-btn cl-sm', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [d.items[i - 1], d.items[i]] = [d.items[i], d.items[i - 1]]; redraw(); } }, pathIcon('M12 19V5M6 11l6-6 6 6', 14)),
            h('button', { class: 'icon-btn cl-sm', type: 'button', 'aria-label': 'Move down', disabled: i === d.items.length - 1, onclick: () => { [d.items[i + 1], d.items[i]] = [d.items[i], d.items[i + 1]]; redraw(); } }, pathIcon('M12 5v14M6 13l6 6 6-6', 14)),
            h('button', { class: 'icon-btn cl-sm', type: 'button', 'aria-label': 'Remove', onclick: () => { d.items.splice(i, 1); redraw(); } }, icon('trash', 14)))),
        h('div', { class: 'cl-item-fields' },
          input('Sets', 'sets', { type: 'number', min: '1', max: '20', inputmode: 'numeric' }, 'narrow'),
          input('Reps', 'reps', { placeholder: '10', maxlength: '30' }),
          input('Load', 'load', { placeholder: '60 kg', maxlength: '30' }),
          input('RPE', 'rpe', { placeholder: '7–8', maxlength: '10' }, 'narrow'),
          input('Note', 'note', { placeholder: 'Cue for the client', maxlength: '300' }, 'wide')));
    }));
  }

  function draw() {
    saveBtn = publishBtn = headTitle = null;
    if (error && week === null) {
      fill(content, errorLine(error), button('Try again', () => loadWeek(), { small: true }));
      return;
    }
    if (week === null) { fill(content, loading()); return; }
    const chips = h('div', { class: 'cl-chiprow' },
      dayWorkouts().map(w => h('button', { type: 'button', class: 'cl-chip' + (draft?.id === w.id ? ' on' : ''), onclick: () => open(w.id) },
        w.published ? w.title : `${w.title} · draft`)),
      h('button', { type: 'button', class: 'cl-chip' + (draft && !draft.id ? ' on' : ''), onclick: () => { draft = newDraft(day); saved = null; notice = null; error = null; draw(); } }, '+ New workout'));
    if (!draft) {
      fill(content, chips, dayWorkouts().length ? null
        : emptyCard('calendar', `Nothing planned for ${weekdayOf(day)} ${fmtShort(day)}`, `Use “+ New workout” to write one for ${ctx.name}.`));
      return;
    }
    const d = draft;
    headTitle = h('div', { class: 'strong' });
    const itemsBox = h('div', { class: 'cl-items' });
    saveBtn = button('Save', () => save(false));
    publishBtn = button('Publish', () => save(true), { kind: 'primary' });
    fill(content, chips,
      h('div', { class: 'cl-editor-head' }, headTitle, h('div', { class: 'tiny faint' }, statusLine(d))),
      h('div', { class: 'cl-editor' },
        card({ class: 'cl-editor-fields' },
          textField('Title', 'title', 'Lower Body Strength', { maxlength: '80' }),
          h('div', { class: 'grid2' },
            textField('Starts (HH:mm)', 'startsAt', '11:00', { maxlength: '5', inputmode: 'numeric' }),
            textField('Location', 'location', 'Studio 2', { maxlength: '80' })),
          field('Notes for the client', h('textarea', { value: d.notes, placeholder: 'Optional', maxlength: '1000', rows: '3', oninput: e => { d.notes = e.target.value; syncButtons(); } }))),
        h('div', { class: 'cl-editor-items' },
          eyebrow('Exercises', d.items.length ? String(d.items.length) : null),
          itemsBox,
          dashed('Add exercise from the library', async () => {
            const ex = await exercisePicker();
            if (!ex || draft !== d) return;
            d.items.push({ id: null, exerciseId: ex.id, exerciseName: ex.name, sets: 3, reps: '10', load: '', rpe: '', note: '' });
            itemsEditor(itemsBox);
            syncButtons();
          }))),
      notice ? h('p', { class: 'ok row gap4' }, icon('check', 14), notice) : null,
      error ? errorLine(error) : null,
      h('div', { class: 'row cl-actions' }, saveBtn, publishBtn,
        d.id ? h('button', { class: 'btn danger', type: 'button', onclick: remove }, 'Delete workout') : null));
    itemsEditor(itemsBox);
    syncButtons();
  }

  drawNav();
  draw();
  await loadWeek();
}

/** Pick an exercise from the library (the iPhone's ExercisePickerSheet). Resolves with it, or undefined. */
const CATEGORIES = ['All', 'Legs', 'Push', 'Pull', 'Core', 'Mobility', 'Conditioning'];
function exercisePicker() {
  return sheet('Add exercise', (body, close) => {
    let category = 'All';
    let timer = null, seq = 0;
    const search = h('input', { type: 'search', placeholder: 'Search exercises', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search exercises' });
    const cats = h('div', { class: 'cl-chiprow' });
    const list = h('div');
    const drawCats = () => fill(cats, CATEGORIES.map(c => h('button', { type: 'button', class: 'cl-chip' + (c === category ? ' on' : ''), onclick: () => { category = c; drawCats(); load(0); } }, c)));
    async function load(delay = 250) {
      clearTimeout(timer);
      const mine = ++seq;
      timer = setTimeout(async () => {
        try {
          const { exercises } = await api('GET', `/api/exercises?${q({ q: search.value.trim(), category: category === 'All' ? '' : category })}`);
          if (mine !== seq) return;
          fill(list, exercises.length ? card({ class: 'flush' }, exercises.map(e => h('button', { class: 'cl-pick', type: 'button', onclick: () => close(e) },
            iconTile(icon('dumbbell', 16), 34),
            h('div', { class: 'grow' }, h('div', { class: 'strong' }, e.name), h('div', { class: 'tiny faint' }, `${e.equipment} · ${e.pattern}`)),
            h('span', { class: 'faint' }, icon('plus', 16)))))
            : emptyCard('search', 'No matches'));
        } catch (err) {
          if (mine === seq) fill(list, errorLine(err));
        }
      }, delay);
    }
    search.addEventListener('input', () => load());
    drawCats();
    body.append(h('label', { class: 'cl-search card' }, icon('search', 16), search), cats, list);
    fill(list, loading());
    load(0);
    setTimeout(() => search.focus(), 0);
  });
}

// MARK: - Assign a programme

/**
 * Lay a programme onto a client's calendar as drafts (the iPhone's
 * AssignProgramSheet). Give `client` to choose the programme, or `program` to
 * choose the client. Resolves with the number of workouts created, or
 * undefined when nothing was assigned.
 */
export function assignProgramSheet({ client = null, program = null } = {}) {
  return sheet('Assign programme', (body, close) => {
    let chosen = null, created = null;
    const start = h('input', { type: 'date', value: addDays(todayLondon(), 1), 'aria-label': 'Start date' });
    const listBox = h('div');
    const status = h('div');
    const go = button('Assign', async () => {
      if (created !== null) { close(created); return; }
      if (!chosen || !start.value) return;
      const programId = program ? program.id : chosen;
      const clientId = client ? client.id : chosen;
      await busy(go, status, async () => {
        const out = await api('POST', `/api/programs/${enc(programId)}/assign`, { clientId, startDate: start.value });
        created = out.created;
        fill(status, h('p', { class: 'ok row gap4' }, icon('check', 14), `Created ${created} draft workouts. Publish them from the client's Plan tab.`));
        go.textContent = 'Done';
      });
      go.disabled = false;
    }, { kind: 'primary', disabled: true });
    const pick = id => { chosen = id; go.disabled = created === null && !chosen; draw(); };
    let rows = null;
    const draw = () => {
      if (!rows) return;
      fill(listBox, rows.length ? card({ class: 'flush' }, rows.map(r => h('button', { class: 'cl-pick', type: 'button', 'aria-pressed': String(chosen === r.id), onclick: () => pick(r.id) },
        r.lead, h('div', { class: 'grow' }, h('div', { class: 'strong' }, r.title), r.detail ? h('div', { class: 'tiny faint' }, r.detail) : null), checkCircle(chosen === r.id))))
        : emptyCard(program ? 'people' : 'programs', program ? 'No clients yet' : 'No programmes yet', program ? null : 'Write one under Programs › Programs.'));
    };
    body.append(
      h('h3', { class: 'mb' }, program ? program.name : `For ${client.name}`),
      field('Start date', start),
      eyebrow(program ? 'Client' : 'Programme'),
      listBox, status);
    fill(listBox, loading());
    (program ? api('GET', '/api/coach/clients').then(r => r.clients.slice().sort((a, b) => a.name.localeCompare(b.name))
      .map(c => ({ id: c.id, title: c.name, lead: avatar(c.initials || c.name, 28) })))
      : api('GET', '/api/programs').then(r => r.programs.map(p => ({
        id: p.id, title: p.name, lead: iconTile(icon('programs', 16), 30),
        detail: [p.detail, `${p.weeks} weeks · ${p.daysPerWeek} days a week · ${p.workouts.length} workouts`].filter(Boolean).join(' · '),
      }))))
      .then(r => { rows = r; draw(); }, err => fill(listBox, errorLine(err)));
    return h('div', { class: 'row end' }, button('Cancel', () => close(created ?? undefined)), go);
  });
}

// MARK: - Feedback tab

async function feedbackTab(box, ctx, { anchor }) {
  const reports = h('section', { id: 'cl-feedback' });
  const checkins = h('section', { id: 'cl-checkins' });
  const automation = h('section', { id: 'cl-automation' });
  // Phone: feedback, check-ins, forms and autoflows, as the iPhone. Wide: check-ins get the right-hand column.
  fill(box, h('div', { class: 'cl-fb' },
    h('div', { class: 'cl-fb-reports' }, reports),
    h('div', { class: 'cl-fb-checkins' }, eyebrow('Check-ins'), checkins),
    h('div', { class: 'cl-fb-auto' }, automation)));
  const jobs = [reportsSection(reports, ctx), checkinsSection(checkins, ctx), automationSection(automation, ctx)];
  if (anchor) {
    await Promise.allSettled(jobs);
    if (!ctx.view.fresh()) return;
    const target = box.querySelector(anchor === 'checkins' ? '.cl-fb-checkins' : anchor === 'forms' ? '#cl-forms' : '#cl-autoflows');
    target?.scrollIntoView({ block: 'start' });
  } else {
    await Promise.allSettled(jobs);
  }
}

async function reportsSection(box, ctx) {
  const list = h('div');
  fill(box, eyebrow('Weekly feedback'), list);
  await loadInto(list, ctx.view, () => api('GET', `/api/reports?${q({ clientId: ctx.id })}`), d => {
    const current = d.reports.find(r => r.week === d.suggestedWeek);
    const openWeek = async week => { await reportEditor(ctx, week); if (ctx.view.fresh()) reportsSection(box, ctx); };
    fill(list,
      button(h('span', { class: 'row gap4' }, icon('pencil', 15), `${current ? 'Edit' : 'Write'} feedback · week of ${fmtShort(d.suggestedWeek)}`), () => openWeek(d.suggestedWeek), { kind: 'primary' }),
      d.reports.map(r => h('button', { class: 'cl-report card', type: 'button', onclick: () => openWeek(r.week) },
        h('div', { class: 'grow' },
          h('div', { class: 'strong' }, `Week of ${fmtShort(r.week)}`),
          h('div', { class: 'tiny faint' }, r.status === 'published' ? (r.readAt ? 'Published · read' : 'Published · not read yet') : 'Draft')),
        h('span', { class: 'faint' }, icon('chevron', 14)))));
  });
}

/** Unsaved feedback text kept in this browser (same keys as the old desk, so drafts survive the move). */
const reportDraftKey = (clientId, week) => `jk.desk.draft.${clientId}.${week}`;

/** Write or edit one week's feedback, with that week's figures and next week's plan alongside (the iPhone's ReportEditorSheet). */
function reportEditor(ctx, startWeek) {
  const name = ctx.first();
  return sheet(ctx.name, (body, close) => {
    let week = startWeek;
    let report = null, saving = false, seq = 0;
    const title = h('div', { class: 'strong' });
    const state_ = h('div', { class: 'tiny faint' });
    const nav = h('div', { class: 'cl-weeknav' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous week', onclick: () => shift(-7) }, icon('back', 16)),
      h('div', { class: 'center' }, title, state_),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next week', onclick: () => shift(7) }, icon('chevron', 16)));
    const status = h('div');
    const figures = h('div');
    const plan = h('div');
    const restored = h('p', { class: 'small cl-restored' });
    const area = (label, placeholder) => {
      const t = h('textarea', { placeholder, maxlength: '4000', rows: '4' });
      return { t, el: field(label, t) };
    };
    const summary = area('How the week went', 'Training, consistency, how they felt…');
    const wins = area('Wins', 'Records, streaks, things done well');
    const focus = area('Focus for next week', 'One to three things for the week ahead');
    const boxes = [summary.t, wins.t, focus.t];
    const publishBtn = button('Publish', () => save('published'), { kind: 'primary' });
    const draftBtn = button('Save draft', () => save('draft'));
    const deleteBtn = h('button', { class: 'btn danger', type: 'button', onclick: () => remove() }, 'Delete');
    const empty = () => boxes.every(b => !b.value.trim());

    // Unsaved text from this browser wins over the server's, with a way back.
    let server = null, draftTimer = null;
    const key = () => reportDraftKey(ctx.id, week);
    const differs = v => !!v && !!server && ['summary', 'wins', 'focus'].some(k => (v[k] ?? '') !== server[k]);
    const showRestored = on => fill(restored, on ? ['Restored unsaved text from this browser · ', h('button', {
      class: 'link', type: 'button', onclick: () => {
        summary.t.value = server.summary; wins.t.value = server.wins; focus.t.value = server.focus;
        clearDraft(key()); showRestored(false); sync();
      },
    }, 'Discard')] : null);
    const keep = () => {
      clearTimeout(draftTimer);
      const k = key();
      draftTimer = setTimeout(() => {
        const now = { summary: summary.t.value, wins: wins.t.value, focus: focus.t.value };
        if (differs(now)) writeDraft(k, now); else { clearDraft(k); showRestored(false); }
      }, 400);
    };
    for (const b of boxes) b.addEventListener('input', () => { keep(); sync(); });

    function sync() {
      const published = report?.status === 'published';
      fill(title, `Week of ${fmtShort(week)}`);
      fill(state_, published ? 'Published' : report?.id ? 'Draft' : report ? 'Not started' : ' ');
      publishBtn.textContent = saving ? 'Saving…' : published ? 'Update' : `Publish to ${name}`;
      publishBtn.disabled = saving || !report || empty();
      draftBtn.textContent = published ? 'Unpublish (back to draft)' : 'Save draft';
      draftBtn.disabled = saving || !report;
      deleteBtn.hidden = !report?.id;
      for (const b of boxes) b.disabled = !report;
    }

    function drawReport() {
      const s = report.stats;
      const c = s.checkin;
      fill(figures,
        statsGrid(s),
        c && (c.note || c.pain.length) ? h('p', { class: 'small muted' }, `Check-in: ${[c.pain.length ? `pain ${c.pain.join(', ')}` : null, c.note || null].filter(Boolean).join(' · ')}`) : null,
        s.healthShared ? null : h('p', { class: 'tiny faint' }, `${name} hasn't shared Apple Health with you.`));
      fill(plan, planList(report.plan));
    }

    async function load() {
      const mine = ++seq;
      report = null; server = null;
      fill(status); fill(figures, loading()); fill(plan); showRestored(false);
      for (const b of boxes) b.value = '';
      sync();
      try {
        const r = await api('GET', `/api/reports/week/${week}?${q({ clientId: ctx.id })}`);
        if (mine !== seq) return;
        report = r;
        server = { summary: r.summary, wins: r.wins, focus: r.focus };
        const stored = readDraft(key());
        const start = differs(stored) ? { summary: stored.summary ?? '', wins: stored.wins ?? '', focus: stored.focus ?? '' } : server;
        if (stored && !differs(stored)) clearDraft(key());
        summary.t.value = start.summary; wins.t.value = start.wins; focus.t.value = start.focus;
        showRestored(start !== server);
        drawReport();
      } catch (err) {
        if (mine !== seq) return;
        fill(figures); fill(status, errorLine(err));
      }
      sync();
    }

    function shift(n) {
      clearTimeout(draftTimer);
      // Keep what was typed for the week being left.
      if (server) {
        const now = { summary: summary.t.value, wins: wins.t.value, focus: focus.t.value };
        if (differs(now)) writeDraft(key(), now);
      }
      week = addDays(week, n);
      load();
    }

    async function save(st) {
      saving = true; sync(); fill(status);
      try {
        report = await api('PUT', '/api/reports', { clientId: ctx.id, week, summary: summary.t.value, wins: wins.t.value, focus: focus.t.value, status: st });
        clearTimeout(draftTimer);
        clearDraft(key());
        server = { summary: report.summary, wins: report.wins, focus: report.focus };
        showRestored(false);
        if (st === 'published') { toast(`Published. ${name} can read it in the app.`); saving = false; close(true); return; }
        fill(status, h('p', { class: 'ok' }, report.status === 'published' ? 'Saved.' : 'Draft saved.'));
        drawReport();
      } catch (err) {
        fill(status, errorLine(err));
      }
      saving = false; sync();
    }

    async function remove() {
      if (!report?.id) return;
      const ok = await confirmBox('Delete this week\'s feedback?', { ok: 'Delete', danger: true, detail: report.status === 'published' ? `${name} will no longer see it.` : null });
      if (!ok) return;
      try {
        await api('DELETE', `/api/reports/${enc(report.id)}`);
        clearDraft(key());
        close(true);
      } catch (err) {
        fill(status, errorLine(err));
      }
    }

    body.append(
      nav,
      h('div', { class: 'cl-report-grid' },
        h('div', null, restored, summary.el, wins.el, focus.el, status),
        h('div', null, figures, plan)),
      h('p', { class: 'tiny faint' }, `Publishing shows it on ${name}'s Home and sends them a message.`));
    load();
    return h('div', { class: 'spread cl-sheet-actions' }, deleteBtn, h('div', { class: 'row end' }, draftBtn, publishBtn));
  }, { wide: true });
}

/** The week in numbers. Apple Health figures appear only when shared (the iPhone's ReportStatsGrid). */
function statsGrid(s) {
  const tiles = [
    tile('Sessions', `${s.workoutsDone}/${s.workoutsPlanned}`),
    tile('Sets logged', String(s.setsLogged)),
    tile('Habits', s.habitsPct === null ? '–' : `${s.habitsPct}%`),
  ];
  if (s.healthShared) {
    tiles.push(tile('Avg steps', s.avgSteps === null ? '–' : fmtN(s.avgSteps, 0)));
    tiles.push(tile('Avg sleep', s.avgSleepMinutes === null ? '–' : fmtHM(s.avgSleepMinutes)));
    tiles.push(tile('Workouts', s.activities ? String(s.activities.count) : '–', s.activities?.minutes > 0 ? fmtDuration(s.activities.minutes) : null));
  }
  if (s.weightStart !== null && s.weightEnd !== null) {
    tiles.push(tile('Weight', `${fmtN(s.weightEnd)} kg`, s.weightStart === s.weightEnd ? null : `${fmtDelta(s.weightEnd - s.weightStart)} kg`));
  }
  if (s.checkin) {
    tiles.push(tile('Energy', `${s.checkin.energy}/5`));
    tiles.push(tile('Sleep (felt)', `${s.checkin.sleep}/5`));
  }
  return h('div', null,
    eyebrow('The week in numbers'),
    h('div', { class: 'cl-tiles3' }, tiles),
    s.activities?.types?.length ? h('p', { class: 'tiny faint' }, s.activities.types.join(' · ')) : null);
}

/** Next week's workouts (the iPhone's PlanList). */
function planList(p) {
  return h('div', null,
    eyebrow('Next week\'s plan', `${fmtShort(p.from)} – ${fmtShort(p.to)}`),
    p.workouts.length
      ? card({ class: 'flush' }, p.workouts.map(w => upcomingRow(w.date, w.title,
        [w.startsAt, `${w.itemCount} exercises`, w.published ? null : 'Draft'].filter(Boolean).join(' · '), { chevron: false })))
      : h('p', { class: 'small faint' }, 'Not written yet.'));
}

/** Weekly check-ins with a reply box each (the iPhone's CoachNotesTab). */
async function checkinsSection(box, ctx) {
  await loadInto(box, ctx.view, () => api('GET', `/api/checkins?${q({ clientId: ctx.id })}`), d => {
    const list = d.checkins.slice().sort((a, b) => b.week.localeCompare(a.week));
    if (!list.length) { fill(box, emptyCard('form', 'No check-ins yet')); return; }
    const one = c => {
      const reply = h('textarea', { rows: '1', maxlength: '2000', placeholder: c.reply ? 'Update your reply' : 'Reply to this check-in', 'aria-label': 'Reply' });
      const send = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Send reply', disabled: true }, pathIcon('M4 12l16-8-6 16-2-6z', 16));
      reply.addEventListener('input', () => { send.disabled = !reply.value.trim(); });
      reply.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && reply.value.trim()) send.click(); });
      const holder = card(null);
      send.addEventListener('click', async () => {
        const text = reply.value.trim();
        if (!text) return;
        await busy(send, null, async () => {
          const fresh = await api('POST', `/api/checkins/${enc(c.id)}/review`, { reply: text });
          holder.replaceWith(one(fresh));
        });
      });
      fill(holder,
        h('div', { class: 'spread' }, h('span', { class: 'strong' }, `Week of ${fmtShort(c.week)}`),
          c.reviewedAt ? h('span', { class: 'tiny faint row gap4' }, icon('check', 12), 'Reviewed') : null),
        h('div', { class: 'cl-tiles3 mt-s' }, tile('Energy', `${c.energy}/5`), tile('Sleep', `${c.sleep}/5`), tile('Pain', c.pain.length ? c.pain.join(', ') : 'None')),
        c.note ? h('p', { class: 'small muted' }, c.note) : null,
        c.reply ? h('p', { class: 'small row gap4 cl-reply' }, pathIcon('M9 14L4 9l5-5M4 9h10a6 6 0 0 1 6 6v5', 14), c.reply) : null,
        h('div', { class: 'cl-reply-row' }, reply, send));
      return holder;
    };
    fill(box, list.map(one));
  });
}

/** Forms sent to this client and the autoflows they're in (the iPhone's ClientAutomationSection). */
async function automationSection(box, ctx) {
  const load = () => Promise.all([
    api('GET', `/api/form-requests?${q({ clientId: ctx.id })}`),
    api('GET', `/api/coach/clients/${enc(ctx.id)}/autoflows`),
    api('GET', '/api/forms'),
    api('GET', '/api/autoflows'),
  ]);
  const again = () => automationSection(box, ctx);
  await loadInto(box, ctx.view, load, ([r, a, f, flows]) => {
    const status = h('div');
    const sendForm = form => busy(null, status, async () => {
      await api('POST', `/api/forms/${enc(form.id)}/send`, { clientId: ctx.id });
      toast(`Sent ${form.name} to ${ctx.first()}.`);
      again();
    });
    const enrol = flow => busy(null, status, async () => {
      await api('POST', `/api/autoflows/${enc(flow.id)}/enrol`, { clientId: ctx.id });
      toast(`${ctx.first()} started ${flow.name}.`);
      again();
    });
    const running = new Set(a.runs.filter(x => !x.stoppedAt).map(x => x.autoflowId));
    fill(box,
      h('div', { class: 'spread cl-sec-head', id: 'cl-forms' }, eyebrow('Forms'),
        menuButton('Send', 'form', f.forms.map(form => [form.name, () => sendForm(form)]))),
      status,
      r.requests.length
        ? card({ class: 'flush' }, r.requests.map(req => formRequestRow(req, () => formResponse(req, ctx).then(changed => { if (changed && ctx.view.fresh()) again(); }))))
        : h('p', { class: 'small faint' }, 'No forms sent yet.'),
      h('div', { class: 'spread cl-sec-head', id: 'cl-autoflows' }, eyebrow('Autoflows'),
        menuButton('Start', 'bolt', flows.autoflows.filter(fl => !running.has(fl.id)).map(fl => [fl.name, () => enrol(fl)]), { disabled: !flows.autoflows.length })),
      a.runs.length ? a.runs.map(run => autoflowRunRow(run, ctx, again)) : h('p', { class: 'small faint' }, 'Not in any autoflow.'));
  });
}

function formRequestRow(r, onclick) {
  const flagged = (r.flagged ?? []).length > 0;
  let line;
  if (r.submittedAt) {
    const yes = flagged ? `Said yes to ${r.flagged.length === 1 ? 'a health question' : 'health questions'} · ` : '';
    line = `${yes}Answered ${fmtRelative(r.submittedAt)}${r.reviewedAt ? ' · read' : ''}`;
  } else {
    line = `Sent ${fmtRelative(r.sentAt)} · not answered yet`;
  }
  return h('button', { class: 'cl-pick', type: 'button', onclick },
    iconTile(icon('form', 16), 30),
    h('div', { class: 'grow' }, h('div', { class: 'strong clamp1' }, r.name),
      h('div', { class: 'tiny', style: { color: flagged && !r.reviewedAt ? COLOR.urgent : 'var(--faint)' } }, line)),
    r.submittedAt && !r.reviewedAt ? dot(flagged ? COLOR.urgent : COLOR.waiting) : null,
    h('span', { class: 'faint' }, icon('chevron', 14)));
}

const answerText = v => (v === undefined || v === null ? '–' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'number' ? `${v} / 5` : String(v));

/** A client's answers, for the coach; opening marks them read (the iPhone's FormResponseView). Resolves true if anything changed. */
function formResponse(start, ctx) {
  return sheet(start.name, (body, close) => {
    let changed = false;
    const draw = r => {
      const flagged = (r.flagged ?? []).length > 0;
      const status = h('div');
      fill(body,
        h('p', { class: 'small faint m0' }, `${r.client?.name ?? 'Client'} · sent ${fmtShort(londonParts(r.sentAt).day)}${r.fromAutoflow ? ' by an autoflow' : ''}`),
        flagged ? card({ class: 'cl-flagged' },
          h('div', { class: 'small strong row gap4', style: { color: COLOR.urgent } }, icon('warning', 14), 'Answered yes to'),
          r.flagged.map(f => h('div', { class: 'small' }, `• ${f}`)),
          h('div', { class: 'tiny faint' }, 'Talk to them before the next hard session.')) : null,
        status,
        !r.submittedAt ? [
          emptyCard('clock', 'Not answered yet', `Sent ${fmtRelative(r.sentAt)}.`),
          h('button', {
            class: 'btn danger', type: 'button', onclick: async () => {
              if (!await confirmBox('Withdraw this form?', { ok: 'Withdraw', danger: true })) return;
              await busy(null, status, async () => { await api('DELETE', `/api/form-requests/${enc(r.id)}`); close(true); });
            },
          }, 'Withdraw form'),
        ] : [
          r.questions.map(qn => {
            const v = r.answers?.[qn.id];
            return card({ class: 'cl-answer' }, h('div', { class: 'tiny faint' }, qn.label),
              h('div', { class: 'strong', style: qn.flag && v === true ? { color: COLOR.urgent } : null }, answerText(v)));
          }),
          r.client ? link(`/messages/${enc(r.client.id)}`, { class: 'btn', onclick: () => close(changed) }, icon('bubble', 15), `Message ${firstName(r.client.name)}`) : null,
        ]);
    };
    draw(start);
    if (start.submittedAt && !start.reviewedAt) {
      api('POST', `/api/form-requests/${enc(start.id)}/review`).then(r => { changed = true; draw(r); }, () => { /* stays unread */ });
    }
    return h('div', { class: 'row end' }, button('Done', () => close(changed)));
  }).then(v => !!v);
}

function autoflowRunRow(run, ctx, onChanged) {
  const status = h('div');
  let detail;
  if (run.stoppedAt) detail = 'Stopped';
  else if (!run.next) detail = 'Finished';
  else detail = `Next ${run.next.date === todayLondon() ? 'today' : fmtShort(run.next.date)}: ${run.next.label}`;
  const fraction = run.steps ? run.stepsDone / run.steps : 0;
  return h('div', { class: 'cl-run' },
    h('div', { class: 'row' },
      iconTile(icon('bolt', 14), 26),
      h('div', { class: 'grow' }, h('div', { class: 'small strong' }, run.autoflowName ?? 'Autoflow'), h('div', { class: 'tiny faint clamp2' }, detail)),
      h('span', { class: 'tiny muted cl-num' }, `${run.stepsDone}/${run.steps}`),
      !run.stoppedAt && run.next ? h('button', {
        class: 'icon-btn cl-sm', type: 'button', 'aria-label': 'Stop', title: 'Stop',
        onclick: async () => {
          const ok = await confirmBox(`Stop this autoflow for ${ctx.name}?`, { ok: 'Stop', danger: true, detail: 'What already happened stays; nothing more is sent.' });
          if (!ok) return;
          await busy(null, status, async () => { await api('DELETE', `/api/autoflows/${enc(run.autoflowId)}/runs/${enc(run.id)}`); onChanged(); });
        },
      }, pathIcon('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 9h6v6H9z', 16)) : null),
    h('div', { class: 'cl-bar' }, h('div', { style: { width: `${Math.round(fraction * 100)}%` } })),
    status);
}

// MARK: - Health tab

const ACTIVITY_ICON = type => (/(Strength|Functional|Core|Cross)/.test(type) ? 'dumbbell' : /HIIT|cardio/i.test(type) ? 'bolt' : 'heart');
function activityDetail(a) {
  const parts = [fmtDuration(a.minutes)];
  if (a.distanceKm > 0) parts.push(`${fmtN(a.distanceKm)} km`);
  if (a.kcal > 0) parts.push(`${fmtN(a.kcal, 0)} kcal`);
  if (a.avgHr > 0) parts.push(`${fmtN(a.avgHr, 0)} bpm`);
  return parts.join(' · ');
}

async function healthTab(box, ctx) {
  await loadInto(box, ctx.view, () => api('GET', `/api/health/week?${q({ clientId: ctx.id })}`), w => {
    if (!w.shared) {
      fill(box, emptyCard('heart', 'Not shared', `${ctx.first()} hasn't shared Apple Health with you. They can turn it on in Account › Apple Health.`));
      return;
    }
    const cell = v => h('td', null, v);
    fill(box, h('div', { class: 'cl-cols' },
      h('div', null,
        eyebrow('Last 7 days', w.sharedSince ? `Shared since ${fmtShort(londonParts(w.sharedSince).day)}` : null),
        card({ class: 'flush cl-table' }, h('table', null,
          h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Steps'), h('th', null, 'Sleep'), h('th', null, 'RHR'), h('th', null, 'kcal'))),
          h('tbody', null, w.days.slice().reverse().map(d => h('tr', null,
            h('td', { class: 'faint' }, weekdayOf(d.date)),
            cell(d.steps === null ? '–' : fmtN(d.steps, 0)),
            cell(d.sleepMinutes === null ? '–' : fmtHM(d.sleepMinutes)),
            cell(d.restingHr === null ? '–' : fmtN(d.restingHr, 0)),
            cell(d.activeKcal === null ? '–' : fmtN(d.activeKcal, 0)))))))),
      h('div', null,
        eyebrow('Workouts', w.activities.length ? `${w.activities.length} this week` : null),
        w.activities.length
          ? card({ class: 'flush' }, w.activities.map(a => h('div', { class: 'cl-pick static' },
            iconTile(icon(ACTIVITY_ICON(a.type), 16), 32),
            h('div', { class: 'grow' }, h('div', { class: 'strong' }, a.type),
              h('div', { class: 'tiny faint' }, `${weekdayOf(londonParts(a.start).day)} ${fmtShort(londonParts(a.start).day)} · ${fmtTime(a.start)}`)),
            h('span', { class: 'tiny muted cl-right' }, activityDetail(a)))))
          : h('p', { class: 'small faint' }, 'No workouts recorded this week.'))));
  });
}

// MARK: - Habits tab

async function habitsTab(box, ctx) {
  const reload = () => habitsTab(box, ctx);
  await loadInto(box, ctx.view, () => api('GET', `/api/habits?${q({ clientId: ctx.id, date: todayLondon() })}`), d => {
    const t = d.nutrition.targets;
    const numInput = (label, value, placeholder) => {
      const input = h('input', { type: 'text', inputmode: 'decimal', value: value === undefined || value === null ? '' : String(Math.round(value)), placeholder });
      return { input, el: field(label, input) };
    };
    const kcal = numInput('kcal', t?.kcal, '2500');
    const protein = numInput('Protein g', t?.protein, '170');
    const carbs = numInput('Carbs g', t?.carbs, '260');
    const fat = numInput('Fat g', t?.fat, '80');
    const parse = s => { const v = Number(String(s).replace(',', '.').trim()); return String(s).trim() !== '' && Number.isFinite(v) ? v : null; };
    const fields = [kcal, protein, carbs, fat];
    const status = h('div');
    const saveBtn = button('Save targets', async () => {
      const [k, p, c, f] = fields.map(x => parse(x.input.value));
      await busy(saveBtn, status, async () => {
        await api('PUT', '/api/nutrition/targets', { clientId: ctx.id, kcal: k, protein: p, carbs: c, fat: f });
        fill(status, h('p', { class: 'tiny muted' }, 'Targets saved.'));
      });
      syncSave();
    }, { kind: 'primary' });
    const syncSave = () => { saveBtn.disabled = fields.some(x => parse(x.input.value) === null); };
    for (const x of fields) x.input.addEventListener('input', syncSave);
    syncSave();
    const listStatus = h('div');

    fill(box, h('div', { class: 'cl-cols' },
      h('div', null,
        eyebrow('Daily habits', `${d.streak}-day streak`),
        listStatus,
        d.habits.length
          ? card({ class: 'flush' }, d.habits.map(hb => h('div', { class: 'cl-pick static' },
            iconTile(habitIcon(hb.icon, 16), 32),
            h('div', { class: 'grow' }, h('div', { class: 'strong' }, hb.name),
              h('div', { class: 'tiny faint' }, hb.kind === 'count' ? `${fmtN(hb.value ?? 0)} / ${fmtN(hb.target)} ${hb.unit} today` : hb.done ? 'Done today' : 'Not done today')),
            h('button', {
              class: 'icon-btn cl-sm', type: 'button', 'aria-label': `Remove ${hb.name}`, title: 'Remove',
              onclick: async () => {
                if (!await confirmBox(`Remove “${hb.name}”?`, { ok: 'Remove', danger: true, detail: `It goes from ${ctx.first()}'s Home.` })) return;
                await busy(null, listStatus, async () => { await api('DELETE', `/api/habits/${enc(hb.id)}`); reload(); });
              },
            }, icon('trash', 14)))))
          : emptyCard('check', 'No habits set'),
        button(h('span', { class: 'row gap4' }, icon('plus', 14), 'Add habit'), async () => { if (await addHabitSheet(ctx)) reload(); })),
      h('div', null,
        eyebrow('Nutrition targets', `Today ${fmtN(d.nutrition.totals.kcal, 0)} kcal logged`),
        card(null, h('div', { class: 'grid2' }, kcal.el, protein.el), h('div', { class: 'grid2' }, carbs.el, fat.el), status, saveBtn))));
  });
}

/** New habit (the iPhone's AddHabitSheet). Resolves true when one was added. */
function addHabitSheet(ctx) {
  return sheet('New habit', (body, close) => {
    let kind = 'check', icon_ = 'checkmark.circle', healthKind = 'none';
    const name = h('input', { placeholder: 'Water', maxlength: '40' });
    const target = h('input', { value: '1', inputmode: 'decimal', placeholder: '3' });
    const unit = h('input', { placeholder: 'L', maxlength: '12' });
    const kindBox = h('div'), targetBox = h('div'), iconBox = h('div', { class: 'cl-icons' }), healthBox = h('div'), healthNote = h('div');
    const status = h('div');
    const parse = s => { const v = Number(String(s).replace(',', '.').trim()); return String(s).trim() !== '' && Number.isFinite(v) ? v : null; };
    const add = button('Add habit', () => save(), { kind: 'primary' });
    const sync = () => { add.disabled = !name.value.trim() || (kind === 'count' && parse(target.value) === null); };
    const draw = () => {
      fill(kindBox, segmented([['check', 'Tick off'], ['count', 'Count to a target']], kind, v => { kind = v; draw(); }));
      targetBox.hidden = !(kind === 'count' || healthKind !== 'none');
      fill(iconBox, Object.keys(HABIT_ICONS).map(i => h('button', { type: 'button', class: 'cl-icon-pick' + (i === icon_ ? ' sel' : ''), 'aria-label': i, 'aria-pressed': String(i === icon_), onclick: () => { icon_ = i; draw(); } }, habitIcon(i, 20))));
      fill(healthBox, segmented([['none', 'None'], ['steps', 'Steps'], ['sleep', 'Sleep']], healthKind, v => {
        healthKind = v;
        if (v === 'sleep') { kind = 'check'; target.value = '7'; unit.value = 'h'; icon_ = 'moon'; if (!name.value) name.value = 'Sleep 7h+'; }
        if (v === 'steps') { kind = 'count'; target.value = '10000'; unit.value = 'steps'; icon_ = 'shoeprints.fill'; if (!name.value) name.value = 'Steps'; }
        draw();
      }));
      fill(healthNote, healthKind !== 'none' ? h('p', { class: 'tiny faint' }, 'Filled from the client\'s Apple Health and done once the value reaches the target.') : null);
      sync();
    };
    name.addEventListener('input', sync);
    target.addEventListener('input', sync);
    fill(targetBox, h('div', { class: 'grid2' }, field('Target', target), field('Unit', unit)));
    async function save() {
      // A health habit keeps its target whatever the kind ("Sleep 7h+" is check, 7 h).
      const fromHealth = healthKind !== 'none';
      const withTarget = kind === 'count' || fromHealth;
      await busy(add, status, async () => {
        await api('POST', '/api/habits', {
          clientId: ctx.id, name: name.value.trim(), kind, target: withTarget ? (parse(target.value) ?? 1) : 1,
          unit: withTarget ? unit.value.trim() : '', icon: icon_, healthKind: fromHealth ? healthKind : null,
        });
        close(true);
      });
    }
    body.append(field('Name', name), kindBox, targetBox, eyebrow('Icon'), iconBox, eyebrow('Fill from Apple Health'), healthBox, healthNote, status);
    draw();
    setTimeout(() => name.focus(), 0);
    return h('div', { class: 'row end' }, button('Cancel', () => close(false)), add);
  }).then(v => v === true);
}

// MARK: - Sessions tab

const kindLabel = k => (k === 'video' ? 'Video' : k === 'group' ? 'Group' : '1:1');

async function sessionsTab(box, ctx) {
  const reload = () => sessionsTab(box, ctx);
  const today = todayLondon();
  // The server answers at most 62 days at a time: the past month and the next two, asked separately.
  const load = () => Promise.all([
    api('GET', `/api/bookings?${q({ clientId: ctx.id, from: addDays(today, -30), to: today })}`),
    api('GET', `/api/bookings?${q({ clientId: ctx.id, from: addDays(today, 1), to: addDays(today, 60) })}`),
  ]).then(([a, b]) => {
    const seen = new Set();
    return [...a.bookings, ...b.bookings].filter(x => !seen.has(x.id) && seen.add(x.id));
  });
  await loadInto(box, ctx.view, load, list => {
    const now = Date.now();
    const upcoming = list.filter(b => Date.parse(b.end) >= now).sort((x, y) => x.start.localeCompare(y.start));
    const past = list.filter(b => Date.parse(b.end) < now).sort((x, y) => y.start.localeCompare(x.start));
    const row = b => card({ class: 'flush' }, upcomingRow(londonParts(b.start).day, b.title ?? kindLabel(b.kind),
      [`${fmtTime(b.start)}–${fmtTime(b.end)}`, kindLabel(b.kind), b.location].filter(Boolean).join(' · '),
      { onclick: async () => { if (await bookingSheet(b)) reload(); } }));
    fill(box, h('div', { class: 'cl-cols' },
      h('div', null,
        eyebrow('Upcoming'),
        upcoming.length ? upcoming.map(row) : h('p', { class: 'small faint' }, 'Nothing booked.'),
        dashed(`Book a session for ${ctx.name}`, async () => { if (await bookSessionSheet(ctx)) reload(); })),
      h('div', null, past.length ? [eyebrow('Past 30 days'), past.map(row)] : null)));
  });
}

/** One booking or class: who's coming, and cancel (the iPhone's ClassDetailView). Resolves true when cancelled. */
function bookingSheet(b) {
  return sheet(b.title ?? kindLabel(b.kind), (body, close) => {
    const people = b.attendees?.length ? b.attendees : b.client ? [b.client] : [];
    const status = h('div');
    body.append(
      h('p', { class: 'small muted m0' }, `${longDayOf(b.start)} · ${fmtTime(b.start)}–${fmtTime(b.end)}`),
      b.location ? h('p', { class: 'small faint m0' }, b.location) : null,
      eyebrow('Attendees', b.capacity ? `${b.attendeeCount ?? b.attendees?.length ?? 0} of ${b.capacity}` : null),
      people.length ? card({ class: 'flush' }, people.map(p => h('div', { class: 'cl-pick static' }, avatar(p.name, 28), h('span', null, p.name))))
        : emptyCard('people', 'Nobody yet'),
      status);
    const canCancel = b.cancellable !== false && Date.parse(b.start) > Date.now();
    const cancel = h('button', {
      class: 'btn danger', type: 'button',
      onclick: async () => {
        if (!await confirmBox('Cancel this?', { ok: 'Cancel it', danger: true })) return;
        await busy(cancel, status, async () => { await api('DELETE', `/api/bookings/${enc(b.id)}`); close(true); });
      },
    }, b.kind === 'group' ? 'Cancel class' : 'Cancel booking');
    return h('div', { class: 'spread' }, canCancel ? cancel : h('span'), button('Close', () => close(false)));
  }).then(v => v === true);
}

/** Book a 1:1 or video call for this client from the coach's open slots (the iPhone's BookSessionView). */
function bookSessionSheet(ctx) {
  return sheet('Book a client', (body, close) => {
    const today = todayLondon();
    let day = today, kind = 'inperson', chosen = null, seq = 0;
    const KINDS = [['inperson', '1:1 · in person'], ['video', 'Video call']];
    const label = () => KINDS.find(k => k[0] === kind)[1];
    const nav = h('div'), strip = h('div'), kinds = h('div'), slots = h('div'), summary = card(null), status = h('div');
    const confirmBtn = button('Confirm booking', async () => {
      if (!chosen) return;
      await busy(confirmBtn, status, async () => {
        await api('POST', '/api/bookings', { start: chosen.start, kind, clientId: ctx.id });
        toast(`Booked ${ctx.first()} in.`);
        close(true);
      });
      confirmBtn.disabled = !chosen;
    }, { kind: 'primary', disabled: true });
    const drawTop = () => {
      fill(nav, weekNav(mondayOf(day), n => { const next = addDays(day, n); day = next < today ? today : next; drawTop(); loadSlots(); }, { canBack: mondayOf(day) > mondayOf(today) }));
      fill(strip, dayStrip(mondayOf(day), day, new Set(), d => { if (d < today) return; day = d; drawTop(); loadSlots(); }));
      fill(kinds, segmented(KINDS, kind, v => { kind = v; drawTop(); loadSlots(); }));
    };
    const drawSummary = () => {
      fill(summary,
        h('div', { class: 'spread small' }, h('span', null, chosen ? `${weekdayOf(londonParts(chosen.start).day)} ${fmtShort(londonParts(chosen.start).day)} · ${fmtTime(chosen.start)}–${fmtTime(chosen.end)}` : 'Pick a time'),
          h('span', null, chosen?.location || label())),
        h('div', { class: 'divider' }),
        h('div', { class: 'spread small faint' }, h('span', null, 'Uses 1 credit'), h('span', null, label())));
      confirmBtn.disabled = !chosen;
    };
    async function loadSlots() {
      const mine = ++seq;
      chosen = null; drawSummary();
      fill(slots, h('p', { class: 'small faint' }, 'Finding times…'));
      try {
        const r = await api('GET', `/api/slots?${q({ from: day, to: day, kind })}`);
        if (mine !== seq) return;
        const open = r.slots.filter(s => Date.parse(s.start) > Date.now()).sort((a, b) => a.start.localeCompare(b.start));
        const draw = () => fill(slots, open.length ? h('div', { class: 'cl-slots' }, open.map(s => h('button', {
          type: 'button', class: 'cl-slot' + (chosen?.start === s.start ? ' sel' : '') + (s.open ? '' : ' taken'), disabled: !s.open,
          onclick: () => { chosen = s; draw(); drawSummary(); },
        }, fmtTime(s.start)))) : emptyCard('clock', 'No times this day', 'Try another day or session type.'));
        draw();
      } catch (err) {
        if (mine === seq) fill(slots, errorLine(err), button('Try again', loadSlots, { small: true }));
      }
    }
    body.append(
      card({ class: 'row' }, avatar(ctx.name, 34), h('span', { class: 'strong' }, `Booking for ${ctx.name}`)),
      nav, strip, h('div', { class: 'mt' }, kinds), h('div', { class: 'mt' }, slots), summary, status,
      h('p', { class: 'tiny faint center' }, 'Free cancellation up to 24h before'));
    drawTop();
    loadSlots();
    return h('div', { class: 'row end' }, button('Cancel', () => close(false)), confirmBtn);
  }).then(v => v === true);
}

// MARK: - Progress tab (the client's own Progress screen, read-only for the coach)

const STAT_LABEL = { bodyFat: 'Body fat', waist: 'Waist', restingHr: 'Resting HR', weight: 'Weight' };
const STAT_UNIT = { bodyFat: '%', waist: ' cm', weight: ' kg', restingHr: '' };
let progressRange = '3m';

function weightChart(series) {
  const W = 600, H = 110;
  const values = series.map(p => p.value);
  const low = Math.min(...values) - 1, high = Math.max(...values) + 1;
  const t0 = parseDay(series[0].date).getTime(), t1 = parseDay(series.at(-1).date).getTime();
  const x = d => (t1 === t0 ? 0 : ((parseDay(d).getTime() - t0) / (t1 - t0)) * W);
  const y = v => H - ((v - low) / (high - low)) * H;
  const pts = series.map(p => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`);
  const grad = `cl-wg-${Math.random().toString(36).slice(2, 8)}`;
  return svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'cl-chart', role: 'img', 'aria-label': `Body weight from ${fmtN(values[0])} to ${fmtN(values.at(-1))} kg` },
    svgEl('defs', null, svgEl('linearGradient', { id: grad, x1: 0, y1: 0, x2: 0, y2: 1 },
      svgEl('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0.35' }), svgEl('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' }))),
    svgEl('polygon', { points: `0,${H} ${pts.join(' ')} ${W},${H}`, fill: `url(#${grad})` }),
    svgEl('polyline', { points: pts.join(' '), fill: 'none', stroke: '#fff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }));
}

async function progressTab(box, ctx) {
  const urls = [];
  ctx.view.onLeave(() => urls.forEach(u => URL.revokeObjectURL(u)));
  const top = h('div');
  const content = h('div');
  fill(box, top, content);
  const drawTop = since => fill(top, h('div', { class: 'spread' },
    h('span', { class: 'small faint' }, since ? `Since ${fmtShort(since)}` : ''),
    segmented([['3m', '3M'], ['6m', '6M'], ['all', 'All']], progressRange, v => { progressRange = v; progressTab(box, ctx); })));
  drawTop(null);
  await loadInto(content, ctx.view, () => Promise.all([
    api('GET', `/api/progress?${q({ clientId: ctx.id, range: progressRange })}`),
    api('GET', `/api/photos?${q({ clientId: ctx.id })}`),
  ]), ([p, ph]) => {
    drawTop(p.since);
    const series = p.weight?.series ?? [];
    const photos = h('div', { class: 'cl-photos' });
    fill(content, h('div', { class: 'cl-cols' },
      h('div', null,
        card({ class: 'cl-wcard' },
          h('div', { class: 'spread' }, eyebrow('Body weight'), p.weight?.delta !== null && p.weight?.delta !== undefined ? chip(`${fmtDelta(p.weight.delta)} kg`) : null),
          h('div', { class: 'row baseline gap4' }, h('span', { class: 'big-num' }, p.weight?.latest === null || p.weight?.latest === undefined ? '–' : fmtN(p.weight.latest)), h('span', { class: 'small faint' }, 'kg')),
          series.length >= 2 ? weightChart(series) : h('p', { class: 'tiny faint' }, 'Two weigh-ins (or Apple Health) show the trend.')),
        p.stats.length ? h('div', { class: 'cl-tiles3' }, p.stats.map(s => tile(STAT_LABEL[s.kind] ?? s.kind,
          s.latest === null ? '–' : fmtN(s.latest) + (STAT_UNIT[s.kind] ?? ''), s.delta === null || s.delta === undefined ? null : fmtDelta(s.delta)))) : null,
        eyebrow('Progress photos', 'Private to the client and you'),
        photos),
      h('div', null,
        eyebrow('Personal records', 'Best logged load'),
        p.records.length
          ? card({ class: 'flush' }, p.records.map(r => h('div', { class: 'cl-pick static' },
            h('div', { class: 'grow' }, h('div', { class: 'strong' }, r.exercise), h('div', { class: 'tiny faint' }, fmtShort(r.date))),
            h('div', { class: 'cl-right' }, h('div', { class: 'strong' }, `${fmtN(r.kg)} kg`), r.gain ? h('div', { class: 'tiny faint' }, `${fmtDelta(r.gain)} kg`) : null))))
          : emptyCard('dumbbell', 'No records yet', 'They appear once sets are logged.'))));
    if (!ph.photos.length) { fill(photos, h('p', { class: 'small faint' }, 'No photos yet.')); return; }
    // Photos need the session header, so they load as blobs.
    fill(photos, ph.photos.slice().reverse().map(photo => {
      const img = h('img', { alt: `Progress photo, ${fmtShort(photo.date)}`, loading: 'lazy' });
      const btn = h('button', { class: 'cl-photo', type: 'button', onclick: () => { if (img.src) sheet(`Photo · ${fmtShort(photo.date)}`, b => { b.append(h('img', { src: img.src, alt: img.alt, class: 'cl-photo-big' })); }, { wide: true }); } },
        img, h('span', { class: 'tiny' }, fmtShort(photo.date)));
      apiBlob(photo.url).then(blob => {
        const u = URL.createObjectURL(blob);
        urls.push(u);
        if (ctx.view.fresh()) img.src = u; else URL.revokeObjectURL(u);
      }, () => fill(btn, h('span', { class: 'tiny faint' }, 'Could not load')));
      return btn;
    }));
  });
}
