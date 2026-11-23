/*
 * Clients: the coach's client list (three groups, each row with its habit
 * week) and one client's page. The page opens on the Overview (goal, habit
 * week, latest check-in, letter composer: overview.js and letters.js) with the
 * studio's tabs beside it: Plan (write and publish workouts, assign a
 * programme), Letters (letters, check-ins, forms and autoflows), Sessions,
 * Progress and Health.
 */
import {
  COLOR, DAYS, MONTHS, addDays, api, apiBlob, avatar, busy, button, card, chip, clientById, clients, confirmBox, dot,
  emptyCard, errorLine, eyebrow, field, fill, firstName, fmtRelative, fmtShort, fmtTime, fmtWeekday, h, icon, link, loading, londonParts,
  mondayOf, parseDay, q, route, screenHeader, segmented, sheet, svgEl, toast, todayLondon, weekDots,
  planName, plans,
} from './core.js';
import { overviewTab, statusPills } from './overview.js';
import { lettersSection } from './letters.js';

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
// MARK: - Client text (the iPhone app's ClientText)

const WAITING_KINDS = ['urgent', 'message', 'form', 'checkin'];
/** Something of theirs is waiting on the coach. */
const needsYou = c => WAITING_KINDS.includes(c.demand?.kind ?? '');
const quietOrIdle = c => c.demand?.kind === 'quiet' || c.demand?.kind === 'inactive';
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


// MARK: - Small pieces

const iconTile = node => h('span', { class: 'cl-tile' }, node);

/** A stat tile with a label over a value, and an optional small line under it (the iPhone's StatTile). */
const tile = (label, value, deltaText) => h('div', { class: 'cl-stat' },
  h('div', { class: 'k' }, label), h('div', { class: 'v' }, value), deltaText ? h('div', { class: 'd' }, deltaText) : null);

/** A dashed full-width button ("+ Add exercise from the library"). */
const dashed = (text, onclick) => h('button', { class: 'cl-dashed', type: 'button', onclick }, icon('plus', 18), text);

/** "Weekday / day number" block with a title and detail (the iPhone's UpcomingRow). */
function upcomingRow(dayString, title, detail, { chevron = true, onclick = null } = {}) {
  const inner = [
    h('div', { class: 'cl-date' }, h('div', { class: 'wd' }, weekdayOf(dayString).toUpperCase()), h('div', { class: 'dn' }, String(parseDay(dayString).getUTCDate()))),
    h('div', { class: 'grow' }, h('div', { class: 'cl-title' }, title), h('div', { class: 'tiny faint' }, detail)),
    chevron ? icon('chevron', 18) : null,
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
  }, icon(iconName, 18), label);
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

const checkCircle = on => h('span', { class: 'cl-check' + (on ? ' on' : '') }, on ? icon('check', 18) : null);

// MARK: - Clients list

route('/clients', async (el, _params, view) => {
  await plans().catch(() => null); // the coach's plan names
  const search = h('input', { type: 'search', placeholder: 'Search clients', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search clients' });
  const listBox = h('div');
  el.append(
    screenHeader(null, 'Clients'),
    h('label', { class: 'cl-search' }, icon('search', 20), search),
    listBox);

  const row = (c, withReason) => {
    const line = withReason ? reasonOf(c) : planName(c.plan);
    return link(`/clients/${enc(c.id)}`, { class: 'cl-row' },
      avatar(c.initials || c.name, 36),
      h('div', { class: 'grow' },
        h('div', { class: 'row gap4 cl-row-name' }, h('span', { class: 'strong clamp1' }, c.name),
          c.unread > 0 ? h('span', { class: 'muted', title: `${c.unread} unread` }, icon('unread', 16, { label: `${c.unread} unread` })) : null),
        h('div', { class: 'small muted clamp2', title: line }, withReason ? `${planName(c.plan)} · ${line}` : line)),
      c.habitWeek?.length ? weekDots(c.habitWeek) : null);
  };
  const group = (title, list, withReason) => (list.length ? h('section', { class: 'cl-group' },
    title ? h('div', { class: 'cl-group-head' }, h('h2', null, title), h('span', { class: 'small muted t-num' }, String(list.length))) : null,
    card({ class: 'flush' + (title ? '' : ' cl-rows') }, list.map(c => row(c, withReason)))) : null);

  let all = null;
  const draw = () => {
    if (!all) return;
    const query = search.value.trim().toLowerCase();
    const shown = all.filter(c => !query || c.name.toLowerCase().includes(query));
    if (!shown.length) {
      fill(listBox, emptyCard('people', all.length ? 'No one by that name.' : 'No clients yet.', all.length ? null : 'Clients appear here when they sign up.'));
    } else if (!query) {
      // The server sends them most-in-need first; three groups, side by side on a wide screen.
      fill(listBox, h('div', { class: 'cl-groups' },
        group('Needs you', shown.filter(needsYou), true),
        group('Check in with', shown.filter(quietOrIdle), true),
        group('On track', shown.filter(c => !needsYou(c) && !quietOrIdle(c)), false)));
    } else {
      fill(listBox, group(null, shown, true));
    }
  };
  search.addEventListener('input', draw);
  await loadInto(listBox, view, () => clients(true), list => { all = list; draw(); });
});

// MARK: - One client

const TABS = [['overview', 'Overview'], ['plan', 'Plan'], ['letters', 'Letters'], ['sessions', 'Sessions'], ['progress', 'Progress'], ['health', 'Health']];
/** Old and deep-link names: Feedback became Letters, Habits moved into the Overview. */
const ALIASES = { feedback: 'letters', habits: 'overview', letter: 'overview', checkins: 'letters', forms: 'letters', autoflows: 'letters' };
/** Sections of the Letters tab other screens may link to: #/clients/<id>/forms scrolls there. */
const LETTERS_SECTIONS = ['checkins', 'forms', 'autoflows'];
const details = new Map(); // client id → last GET /api/coach/clients/:id, so switching tabs doesn't flash

route('/clients/:id/:tab?', async (el, params, view) => {
  plans().catch(() => null);
  const id = params.id;
  const anchor = LETTERS_SECTIONS.includes(params.tab) ? params.tab : null;
  const tab = TABS.some(([k]) => k === params.tab) ? params.tab : ALIASES[params.tab] ?? 'overview';
  const summary = clientById(id);
  const head = h('div');
  const body = h('div', { class: 'cl-tab' });
  const ctx = { id, view, name: summary?.name || details.get(id)?.client.name || 'Client', planName: planName(summary?.plan) };
  ctx.first = () => firstName(ctx.name);
  ctx.exercisePicker = exercisePicker;
  ctx.assignProgram = () => assignProgramSheet({ client: { id, name: ctx.name } });
  ctx.sendForm = () => sendFormSheet(ctx);

  const drawHead = (detail, error) => {
    const c = detail?.client;
    if (c) { ctx.name = c.name; ctx.planName = planName(c.plan); }
    const sub = c ? [c.name, planName(c.plan), c.since ? `since ${monthYear(c.since)}` : null].filter(Boolean).join(' · ') : ' ';
    fill(head,
      h('div', { class: 'cl-crumb' }, link('/clients', { class: 'small muted' }, icon('back', 16), 'Clients')),
      h('div', { class: 'cl-head' },
        avatar(c?.initials || ctx.name, 48),
        h('div', { class: 'grow' }, h('h1', null, ctx.first()), h('div', { class: 'small muted' }, sub)),
        detail ? h('div', { class: 'row gap4' }, statusPills(detail)) : null,
        link(`/messages/${enc(id)}`, { class: 'btn', title: `Message ${ctx.first()}` }, icon('reply', 18), 'Message')),
      error ? errorLine(error) : null,
      h('nav', { class: 'tabs', 'aria-label': 'Client' }, TABS.map(([k, label]) =>
        link(`/clients/${enc(id)}/${k}`, { class: 'tab' + (k === tab ? ' sel' : ''), 'aria-current': k === tab ? 'page' : null }, label))));
  };
  drawHead(details.get(id) || null);
  el.append(head, body);

  // The header loads beside the tab; the Overview shares the same request.
  let pending = null;
  ctx.reloadDetail = () => {
    pending = api('GET', `/api/coach/clients/${enc(id)}`).then(d => {
      details.set(id, d);
      if (view.fresh()) drawHead(d);
      return d;
    });
    pending.catch(err => { if (view.fresh()) drawHead(details.get(id) || null, err); });
    return pending;
  };
  ctx.detail = () => pending;
  ctx.reloadDetail();

  if (tab === 'overview') { await overviewTab(body, ctx, { openLetter: params.tab === 'letter' }); return; }
  const draw = { plan: planTab, letters: lettersTab, health: healthTab, sessions: sessionsTab, progress: progressTab }[tab];
  await draw(body, ctx, { anchor });
});

/** Send one of the coach's forms to this client. */
function sendFormSheet(ctx) {
  return sheet(`Send a form to ${ctx.first()}`, (body, close) => {
    const list = h('div', null, loading());
    const status = h('div');
    body.append(list, status);
    api('GET', '/api/forms').then(f => {
      fill(list, f.forms.length ? card({ class: 'flush' }, f.forms.map(form => h('button', {
        class: 'cl-pick', type: 'button',
        onclick: e => busy(e.currentTarget, status, async () => {
          await api('POST', `/api/forms/${enc(form.id)}/send`, { clientId: ctx.id });
          toast(`Sent ${form.name} to ${ctx.first()}.`);
          close(true);
        }),
      }, iconTile(icon('form', 20)), h('div', { class: 'grow' }, h('div', { class: 'strong' }, form.name), form.questions ? h('div', { class: 'small muted' }, `${form.questions.length} questions`) : null), icon('send', 18)))) : emptyCard('form', 'No forms yet.', 'Write one under Programs › Forms.'));
    }, err => fill(list, errorLine(err)));
    return h('div', { class: 'row end' }, button('Close', () => close(false)));
  });
}

// MARK: - Plan tab

function workoutDraft(w) {
  return {
    id: w.id, date: w.date, title: w.title, startsAt: w.startsAt || '', location: w.location || '', notes: w.notes || '',
    items: w.items.slice().sort((a, b) => a.order - b.order).map(i => ({
      id: i.id, exerciseId: i.exercise.id, exerciseName: i.exercise.name, sets: i.sets, reps: i.reps, load: i.load || '', rpe: i.rpe || '', note: i.note || '', tempo: i.tempo || '',
    })),
    published: w.published, editedBy: w.editedBy, editedAt: w.editedAt, completedAt: w.completedAt,
    loggedSets: w.items.reduce((n, i) => n + i.logged.length, 0),
  };
}
const newDraft = date => ({ id: null, date, title: '', startsAt: '', location: '', notes: '', items: [], published: false, editedBy: null, editedAt: null, completedAt: null, loggedSets: 0 });
/** The fields that are saved, to tell a changed draft from the saved one. */
const draftShape = d => JSON.stringify([d.date, d.title, d.startsAt, d.location, d.notes, d.items.map(i => [i.id, i.exerciseId, Number(i.sets), i.reps, i.load, i.rpe, i.note, i.tempo])]);
function workoutInput(d, clientId) {
  return {
    date: d.date, title: d.title.trim(), startsAt: d.startsAt.trim() || null, location: d.location.trim() || null, notes: d.notes,
    items: d.items.map(i => ({
      ...(i.id ? { id: i.id } : {}), exerciseId: i.exerciseId, sets: Number(i.sets), reps: String(i.reps).trim(), load: String(i.load).trim(),
      rpe: String(i.rpe).trim() || null, note: String(i.note).trim() || null, tempo: String(i.tempo ?? '').trim() || null,
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
    button(h('span', { class: 'row gap4' }, icon('programs', 18), 'Assign a programme'), async () => {
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
            h('button', { class: 'icon-btn cl-sm', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [d.items[i - 1], d.items[i]] = [d.items[i], d.items[i - 1]]; redraw(); } }, icon('up', 16)),
            h('button', { class: 'icon-btn cl-sm', type: 'button', 'aria-label': 'Move down', disabled: i === d.items.length - 1, onclick: () => { [d.items[i + 1], d.items[i]] = [d.items[i], d.items[i + 1]]; redraw(); } }, icon('down', 16)),
            h('button', { class: 'icon-btn cl-sm', type: 'button', 'aria-label': 'Remove', onclick: () => { d.items.splice(i, 1); redraw(); } }, icon('trash', 18)))),
        h('div', { class: 'cl-item-fields' },
          input('Sets', 'sets', { type: 'number', min: '1', max: '20', inputmode: 'numeric' }, 'narrow'),
          input('Reps', 'reps', { placeholder: '10', maxlength: '30' }),
          input('Load', 'load', { placeholder: '60 kg', maxlength: '30' }),
          input('RPE', 'rpe', { placeholder: '7–8', maxlength: '10' }, 'narrow'),
          input('Note', 'note', { placeholder: 'Cue for the client', maxlength: '300' }, 'cl-f-note'),
          input('Tempo', 'tempo', { placeholder: '3-1-1', maxlength: '7', title: 'Down, pause, drive in seconds (3-1-1); optional' }, 'narrow')));
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
            d.items.push({ id: null, exerciseId: ex.id, exerciseName: ex.name, sets: 3, reps: '10', load: '', rpe: '', note: '', tempo: '' });
            itemsEditor(itemsBox);
            syncButtons();
          }))),
      notice ? h('p', { class: 'ok row gap4' }, icon('check', 18), notice) : null,
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
        fill(status, h('p', { class: 'ok row gap4' }, icon('check', 18), `Created ${created} draft workouts. Publish them from the client's Plan tab.`));
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

async function lettersTab(box, ctx, { anchor }) {
  const letters = h('section', { id: 'cl-letters' });
  const checkins = h('section', { id: 'cl-checkins' });
  const automation = h('section', { id: 'cl-automation' });
  // Letters on the left; check-ins (read only: the letter is the reply) and forms and autoflows beside them.
  fill(box, h('div', { class: 'cl-fb' },
    h('div', { class: 'cl-fb-reports' }, h('h2', { class: 'cl-h2' }, 'Letters'), letters),
    h('div', { class: 'cl-fb-checkins' }, h('h2', { class: 'cl-h2' }, 'Check-ins'), checkins),
    h('div', { class: 'cl-fb-auto' }, automation)));
  await Promise.allSettled([lettersSection(letters, ctx), checkinsSection(checkins, ctx), automationSection(automation, ctx)]);
  if (anchor && ctx.view.fresh()) {
    box.querySelector(anchor === 'checkins' ? '.cl-fb-checkins' : anchor === 'forms' ? '#cl-forms' : '#cl-autoflows')?.scrollIntoView({ block: 'start' });
  }
}

/** Weekly check-ins, read only. The reply is the week's letter (the per-check-in reply box is gone). */
async function checkinsSection(box, ctx) {
  await loadInto(box, ctx.view, () => api('GET', `/api/checkins?${q({ clientId: ctx.id })}`), d => {
    const list = d.checkins.slice().sort((a, b) => b.week.localeCompare(a.week));
    if (!list.length) { fill(box, emptyCard('checkIn', 'No check-ins yet.')); return; }
    fill(box, card({ class: 'flush' }, list.map(c => h('div', { class: 'cl-checkin' },
      h('div', { class: 'spread' }, h('span', { class: 'strong' }, `Week of ${fmtShort(c.week)}`),
        h('span', { class: 'small muted row gap4' }, c.reviewedAt ? [icon('check', 16), 'Letter written'] : 'Waiting for the letter')),
      h('div', { class: 'small t-num' }, [`Energy ${c.energy} of 5`, `Sleep ${c.sleep} of 5`, c.stress ? `Stress ${c.stress} of 5` : null].filter(Boolean).join(' · ')),
      c.pain.length ? h('div', { class: 'small row gap4 tone-urgent' }, icon('pain', 16), `Sore: ${c.pain.join(', ')}`) : null,
      c.win ? h('div', { class: 'small' }, h('span', { class: 'muted' }, 'Win: '), c.win) : null,
      c.struggle ? h('div', { class: 'small' }, h('span', { class: 'muted' }, 'Struggle: '), c.struggle) : null,
      c.note ? h('div', { class: 'small' }, h('span', { class: 'muted' }, 'Note: '), c.note) : null,
      c.reply ? h('div', { class: 'small muted row gap4' }, icon('reply', 16), c.reply) : null))));
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
    h('span', { class: 'faint' }, icon('chevron', 18)));
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
          h('div', { class: 'small strong row gap4', style: { color: COLOR.urgent } }, icon('pain', 16), 'Answered yes to'),
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
          r.client ? link(`/messages/${enc(r.client.id)}`, { class: 'btn', onclick: () => close(changed) }, icon('bubble', 18), `Message ${firstName(r.client.name)}`) : null,
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
      iconTile(icon('bolt', 18), 26),
      h('div', { class: 'grow' }, h('div', { class: 'small strong' }, run.autoflowName ?? 'Autoflow'), h('div', { class: 'tiny faint clamp2' }, detail)),
      h('span', { class: 'tiny muted cl-num' }, `${run.stepsDone}/${run.steps}`),
      !run.stoppedAt && run.next ? h('button', {
        class: 'icon-btn cl-sm', type: 'button', 'aria-label': 'Stop', title: 'Stop',
        onclick: async () => {
          const ok = await confirmBox(`Stop this autoflow for ${ctx.name}?`, { ok: 'Stop', danger: true, detail: 'What already happened stays; nothing more is sent.' });
          if (!ok) return;
          await busy(null, status, async () => { await api('DELETE', `/api/autoflows/${enc(run.autoflowId)}/runs/${enc(run.id)}`); onChanged(); });
        },
      }, icon('stop', 18)) : null),
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
    fill(body,
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
  return svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'cl-chart', role: 'img', 'aria-label': `Body weight from ${fmtN(values[0])} to ${fmtN(values.at(-1))} kg` },
    svgEl('polyline', { points: pts.join(' '), fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }));
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
