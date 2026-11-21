'use strict';
/*
 * JK Performance coach desk. Plain DOM, no framework. Every piece of data is
 * put on the page with textContent (via h()), never as HTML.
 */

// MARK: - Token and API

const TOKEN_KEY = 'jk.desk.token';
let token = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch { token = null; }

function setToken(value) {
  token = value;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* private window: keep it in memory only */ }
}

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function api(method, path, body) {
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
    renderSignIn('Your session ended. Sign in again.');
    throw new ApiError(401, 'Signed out');
  }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`);
  return data;
}

const q = params => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, v);
  return s.toString();
};

// MARK: - DOM helper

/** h('div', {class: 'x', onclick}, 'text', child, [more]) — children are text or nodes; null/false skipped. */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
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
function fill(el, ...children) {
  el.replaceChildren(...h('div', null, ...children).childNodes);
  return el;
}

const errorLine = e => h('p', { class: 'error', role: 'alert' }, e instanceof Error ? e.message : String(e));
const loading = () => h('p', { class: 'muted' }, 'Loading…');

// MARK: - Dates (London days as YYYY-MM-DD strings; maths in UTC noon)

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parseDay = s => new Date(s + 'T12:00:00Z');
const dayStr = d => d.toISOString().slice(0, 10);
function addDays(s, n) { const d = parseDay(s); d.setUTCDate(d.getUTCDate() + n); return dayStr(d); }
function mondayOf(s) { const w = parseDay(s).getUTCDay(); return addDays(s, w === 0 ? -6 : 1 - w); }
function todayLondon() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const f = Object.fromEntries(p.map(x => [x.type, x.value]));
  return `${f.year}-${f.month}-${f.day}`;
}
const fmtDay = s => { const d = parseDay(s); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const fmtShort = s => { const d = parseDay(s); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const fmtMinutes = m => (m === null || m === undefined ? '—' : `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`);
const fmtNum = v => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-GB'));
const fmtWhen = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const PLAN_NAMES = { none: 'No plan', foundation: 'Foundation', performance: 'Performance', elite: 'Elite' };
function flagText(f) {
  if (f === 'no-workout-yet') return 'No workout yet';
  if (f === 'checkin-overdue') return 'Check-in overdue';
  const m = /^no-workout-(\d+)d$/.exec(f);
  return m ? `Idle ${m[1]} days` : f;
}

// MARK: - State

const state = { me: null, clients: [], client: null, tab: 'feedback', week: null, planWeek: null, exercises: null };
let viewSeq = 0; // a tab render that finishes after the user moved on is dropped
const app = () => document.getElementById('app');

// MARK: - Sign in

function renderSignIn(message) {
  state.me = null;
  const input = h('input', { id: 'code', autocomplete: 'one-time-code', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'ABCD-EFGH', maxlength: '40', 'aria-label': 'Sign-in code' });
  const status = h('div');
  const button = h('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
  const form = h('form', {
    onsubmit: async e => {
      e.preventDefault();
      const code = input.value.trim();
      if (!code) return;
      button.disabled = true;
      status.replaceChildren();
      try {
        let out;
        try {
          out = await api('POST', '/api/auth/link', { code });
        } catch (err) {
          if (err.status !== 401) throw err;
          out = await api('POST', '/api/auth/code', { code }); // the local demo coach code
        }
        if (out.me.role !== 'coach') {
          const t = out.token;
          setToken(t);
          try { await api('POST', '/api/auth/logout'); } catch { /* ignore */ }
          setToken(null);
          throw new Error('The coach desk is for coaches. Clients use the iPhone app.');
        }
        setToken(out.token);
        state.me = out.me;
        await startDesk();
      } catch (err) {
        fill(status, errorLine(err.status === 401 ? 'That code is not valid or has expired. Make a new one in the app.' : err));
      } finally {
        button.disabled = false;
      }
    },
  },
  h('label', { for: 'code' }, 'Code'), input, h('div', { class: 'row mt' }, button), status);
  fill(app(), h('div', { class: 'signin' },
    h('div', { class: 'mark' }, 'JK'),
    h('h1', { class: 'mt' }, 'Coach desk'),
    h('p', { class: 'muted' }, 'Write weekly feedback, plans and check-in replies from a computer.'),
    h('div', { class: 'card' },
      h('p', { class: 'm0' }, 'In the app: Guides › Coach desk on the web, then type the 8-character code here. Codes last 10 minutes and work once.'),
      form),
    message ? h('p', { class: 'muted small' }, message) : null));
  input.focus();
}

async function signOut() {
  try { await api('POST', '/api/auth/logout'); } catch { /* signing out anyway */ }
  setToken(null);
  renderSignIn('Signed out.');
}

// MARK: - Shell

async function startDesk() {
  fill(app(), h('p', { class: 'muted pad' }, 'Loading clients…'));
  try {
    state.clients = (await api('GET', '/api/coach/clients')).clients;
  } catch (err) {
    if (err.status === 401) return;
    fill(app(), h('div', { class: 'pad' }, errorLine(err), h('button', { class: 'btn', onclick: startDesk }, 'Try again')));
    return;
  }
  renderShell();
}

function renderShell() {
  const side = h('nav', { class: 'side', 'aria-label': 'Clients' });
  const main = h('main', { class: 'main', id: 'main' });
  fill(app(), 
    h('header', { class: 'top' },
      h('div', { class: 'row' }, h('div', { class: 'mark' }, 'JK'), h('h1', null, 'Coach desk')),
      h('div', { class: 'row' }, h('span', { class: 'muted small' }, state.me?.name || ''), h('button', { class: 'btn small', onclick: signOut }, 'Sign out'))),
    h('div', { class: 'layout' }, side, main));
  renderClientList();
  if (state.client) renderClient();
  else fill(main, h('p', { class: 'muted' }, state.clients.length ? 'Choose a client.' : 'No clients yet. New sign-ups appear here.'));
}

function renderClientList() {
  const side = document.querySelector('.side');
  if (!side) return;
  fill(side, 
    h('div', { class: 'eyebrow side-eyebrow' }, `Clients · ${state.clients.length}`),
    state.clients.map(c => h('button', {
      class: 'client' + (state.client?.id === c.id ? ' sel' : ''),
      onclick: () => { state.client = c; state.week = null; state.planWeek = null; renderClientList(); renderClient(); },
    },
    h('div', { class: 'spread' }, h('span', { class: 'name' }, c.name), c.unread ? h('span', { class: 'badge', title: 'Unread messages' }, String(c.unread)) : null),
    h('div', { class: 'small muted' }, [PLAN_NAMES[c.plan] || c.plan, c.adherence === null || c.adherence === undefined ? null : `${c.adherence}% adherence`].filter(Boolean).join(' · ')),
    (c.flags || []).length || c.checkinDue ? h('div', null,
      (c.flags || []).map(f => h('span', { class: 'chip' }, flagText(f))),
      c.checkinDue && !(c.flags || []).includes('checkin-overdue') ? h('span', { class: 'chip' }, 'Check-in due') : null) : null)));
}

const TABS = [['feedback', 'Feedback'], ['plan', 'Plan'], ['checkins', 'Check-ins'], ['health', 'Health']];

function renderClient() {
  const c = state.client;
  const main = document.getElementById('main');
  const body = h('div', { id: 'tab' });
  fill(main, 
    h('div', { class: 'spread' },
      h('div', null, h('h2', null, c.name), h('div', { class: 'small muted' }, `${PLAN_NAMES[c.plan] || c.plan} · since ${fmtShort(c.since)}`))),
    h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([id, label]) => h('button', {
      class: 'tab' + (state.tab === id ? ' sel' : ''), role: 'tab', 'aria-selected': String(state.tab === id),
      onclick: () => { state.tab = id; renderClient(); },
    }, label))),
    body);
  const seq = ++viewSeq;
  const fresh = () => seq === viewSeq;
  ({ feedback: feedbackTab, plan: planTab, checkins: checkinsTab, health: healthTab })[state.tab](body, fresh);
}

// MARK: - Feedback

async function feedbackTab(body, fresh) {
  const c = state.client;
  fill(body, loading());
  let list, report;
  try {
    list = await api('GET', `/api/reports?${q({ clientId: c.id })}`);
    if (!state.week) state.week = list.suggestedWeek;
    report = await api('GET', `/api/reports/week/${state.week}?${q({ clientId: c.id })}`);
  } catch (err) {
    if (fresh()) fill(body, errorLine(err));
    return;
  }
  if (!fresh()) return;

  const go = n => { state.week = addDays(state.week, 7 * n); feedbackTab(body, fresh); };
  const s = report.stats;
  const stat = (v, k) => h('div', { class: 'stat' }, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k));
  const figures = [
    stat(`${s.workoutsDone}/${s.workoutsPlanned}`, 'Workouts done'),
    stat(fmtNum(s.setsLogged), 'Sets logged'),
    stat(s.habitsPct === null ? '—' : `${s.habitsPct}%`, 'Habits hit'),
    stat(s.weightStart === null ? '—' : s.weightStart === s.weightEnd ? `${s.weightEnd} kg` : `${s.weightStart}→${s.weightEnd}`, 'Weight'),
  ];
  if (s.healthShared) {
    figures.push(stat(fmtNum(s.avgSteps), 'Avg steps'), stat(fmtMinutes(s.avgSleepMinutes), 'Avg sleep'));
    if (s.activities) figures.push(stat(`${s.activities.count} · ${s.activities.minutes} min`, s.activities.types.length ? s.activities.types.join(', ') : 'Activities'));
  }

  const summary = h('textarea', { id: 'summary', value: report.summary, placeholder: 'Training, consistency, how they felt…' });
  const wins = h('textarea', { id: 'wins', value: report.wins, placeholder: 'Records, streaks, things done well' });
  const focus = h('textarea', { id: 'focus', value: report.focus, placeholder: 'One to three things for the week ahead' });
  const status = h('div');
  const published = report.status === 'published';
  const save = async st => {
    fill(status, h('p', { class: 'muted small' }, 'Saving…'));
    try {
      await api('PUT', '/api/reports', { clientId: c.id, week: state.week, summary: summary.value, wins: wins.value, focus: focus.value, status: st });
      if (!fresh()) return;
      await feedbackTab(body, fresh);
      const line = body.querySelector('#saved');
      if (line) fill(line, h('p', { class: 'ok' }, st === 'published' ? `Published. ${c.name} can read it in the app.` : 'Draft saved.'));
    } catch (err) {
      fill(status, errorLine(err));
    }
  };

  fill(body, 
    h('div', { class: 'spread mt' },
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => go(-1), 'aria-label': 'Previous week' }, '‹'),
        h('h3', null, `Week of ${fmtDay(report.week)} – ${fmtDay(report.weekEnd)}`),
        h('button', { class: 'btn small', onclick: () => go(1), 'aria-label': 'Next week' }, '›')),
      h('span', { class: 'chip' + (published ? ' on' : '') }, published ? (report.readAt ? `Published · read ${fmtWhen(report.readAt)}` : 'Published · not read yet') : report.id ? 'Draft' : 'Not started')),
    h('div', { class: 'eyebrow' }, 'The week in numbers'),
    h('div', { class: 'stats' }, figures),
    s.healthShared ? null : h('p', { class: 'small faint' }, 'Apple Health not shared.'),
    s.checkin ? h('div', { class: 'card' },
      h('div', { class: 'spread' }, h('b', null, 'Check-in'), h('span', { class: 'small muted' }, `Energy ${s.checkin.energy}/5 · Sleep ${s.checkin.sleep}/5`)),
      s.checkin.pain.length ? h('div', null, s.checkin.pain.map(p => h('span', { class: 'chip' }, p))) : null,
      s.checkin.note ? h('p', { class: 'mt-s' }, s.checkin.note) : null)
      : h('p', { class: 'small faint' }, 'No check-in for this week.'),
    h('div', { class: 'eyebrow' }, `Next week's plan · ${fmtShort(report.plan.from)} – ${fmtShort(report.plan.to)}`),
    report.plan.workouts.length
      ? h('ul', { class: 'list card' }, report.plan.workouts.map(w => h('li', { class: 'spread' },
        h('span', null, `${fmtDay(w.date)}${w.startsAt ? ` ${w.startsAt}` : ''} · ${w.title}`),
        h('span', { class: 'chip' + (w.published ? ' on' : '') }, w.published ? 'Published' : 'Draft'))))
      : h('p', { class: 'small faint' }, 'Nothing planned yet. Add it on the Plan tab.'),
    h('div', { class: 'eyebrow' }, 'Your feedback'),
    h('label', { for: 'summary' }, 'How the week went'), summary,
    h('label', { for: 'wins' }, 'Wins'), wins,
    h('label', { for: 'focus' }, 'Focus for next week'), focus,
    h('div', { class: 'row mt' },
      h('button', { class: 'btn primary', onclick: () => save('published') }, published ? 'Update' : 'Publish'),
      h('button', { class: 'btn', onclick: () => save('draft') }, published ? 'Unpublish (save as draft)' : 'Save draft')),
    status, h('div', { id: 'saved' }),
    h('div', { class: 'eyebrow' }, 'History'),
    list.reports.length ? h('ul', { class: 'list' }, list.reports.map(r => h('li', { class: 'spread' },
      h('button', { class: 'btn small', onclick: () => { state.week = r.week; feedbackTab(body, fresh); } }, `Week of ${fmtShort(r.week)}`),
      h('span', { class: 'row' },
        h('span', { class: 'chip' + (r.status === 'published' ? ' on' : '') }, r.status === 'published' ? (r.readAt ? 'Read' : 'Published') : 'Draft'),
        h('button', {
          class: 'btn small danger',
          onclick: async () => {
            if (!confirm(`Delete the feedback for the week of ${fmtShort(r.week)}? The client will no longer see it.`)) return;
            try { await api('DELETE', `/api/reports/${encodeURIComponent(r.id)}`); if (fresh()) feedbackTab(body, fresh); } catch (err) { fill(status, errorLine(err)); }
          },
        }, 'Delete')))))
      : h('p', { class: 'small faint' }, 'No feedback written yet.'));
}

// MARK: - Plan

async function loadExercises() {
  if (!state.exercises) state.exercises = (await api('GET', '/api/exercises')).exercises;
  return state.exercises;
}

async function planTab(body, fresh) {
  const c = state.client;
  if (!state.planWeek) state.planWeek = mondayOf(todayLondon());
  const from = state.planWeek, to = addDays(from, 6);
  fill(body, loading());
  let workouts;
  try {
    workouts = (await api('GET', `/api/workouts?${q({ clientId: c.id, from, to })}`)).workouts;
  } catch (err) {
    if (fresh()) fill(body, errorLine(err));
    return;
  }
  if (!fresh()) return;
  const editorBox = h('div');
  const go = n => { state.planWeek = addDays(state.planWeek, 7 * n); planTab(body, fresh); };
  const stateChip = w => w.completedAt ? h('span', { class: 'chip on' }, 'Completed')
    : w.published ? h('span', { class: 'chip on' }, 'Published') : h('span', { class: 'chip' }, 'Draft');
  fill(body, 
    h('div', { class: 'spread mt' },
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => go(-1), 'aria-label': 'Previous week' }, '‹'),
        h('h3', null, `${fmtDay(from)} – ${fmtDay(to)}`),
        h('button', { class: 'btn small', onclick: () => go(1), 'aria-label': 'Next week' }, '›')),
      h('button', { class: 'btn primary', onclick: () => openEditor(editorBox, null, body, fresh) }, 'New workout')),
    workouts.length ? h('ul', { class: 'list card' }, workouts.map(w => h('li', { class: 'spread' },
      h('div', null,
        h('div', null, h('b', null, w.title)),
        h('div', { class: 'small muted' }, [fmtDay(w.date), w.startsAt, w.location, `${w.doneCount}/${w.itemCount} exercises done`].filter(Boolean).join(' · '))),
      h('div', { class: 'row' }, stateChip(w), h('button', { class: 'btn small', onclick: () => openEditor(editorBox, w.id, body, fresh) }, 'Edit')))))
      : h('p', { class: 'muted' }, 'Nothing planned this week.'),
    editorBox);
}

async function openEditor(box, id, body, fresh) {
  const c = state.client;
  fill(box, loading());
  let w, exercises;
  try {
    [exercises, w] = await Promise.all([loadExercises(), id ? api('GET', `/api/workouts/${encodeURIComponent(id)}`) : null]);
  } catch (err) {
    fill(box, errorLine(err));
    return;
  }
  if (!fresh()) return;
  const date = h('input', { type: 'date', value: w?.date || state.planWeek });
  const title = h('input', { value: w?.title || '', placeholder: 'Lower Body Strength', maxlength: '80' });
  const startsAt = h('input', { type: 'time', value: w?.startsAt || '' });
  const location = h('input', { value: w?.location || '', placeholder: 'Studio 2', maxlength: '80' });
  const notes = h('textarea', { value: w?.notes || '', placeholder: 'Warm-up, intent, anything to know', maxlength: '1000' });
  let items = (w?.items || []).slice().sort((a, b) => a.order - b.order).map(i => ({
    id: i.id, exerciseId: i.exercise.id, sets: i.sets, reps: i.reps, load: i.load || '', rpe: i.rpe || '', note: i.note || '', logged: i.logged.length,
  }));
  const itemsBox = h('div', { class: 'items' });
  const status = h('div');

  const byCategory = {};
  for (const e of exercises) (byCategory[e.category] ||= []).push(e);
  const exerciseSelect = (value, onchange) => h('select', { onchange, 'aria-label': 'Exercise' },
    h('option', { value: '', disabled: true, selected: !value }, 'Choose an exercise'),
    Object.entries(byCategory).map(([cat, list]) => h('optgroup', { label: cat },
      list.map(e => h('option', { value: e.id, selected: e.id === value }, e.name)))));

  function drawItems() {
    fill(itemsBox, ...items.map((it, i) => {
      const field = (key, attrs, label) => h('div', { class: key === 'note' ? 'note' : null },
        h('label', null, label),
        h('input', { ...attrs, value: it[key], oninput: e => { it[key] = e.target.value; } }));
      return h('div', { class: 'item' },
        h('div', { class: 'ex' }, h('label', null, `${i + 1}. Exercise${it.logged ? ` · ${it.logged} sets logged` : ''}`), exerciseSelect(it.exerciseId, e => { it.exerciseId = e.target.value; })),
        field('sets', { type: 'number', min: '1', max: '20' }, 'Sets'),
        field('reps', { placeholder: '8', maxlength: '30' }, 'Reps'),
        field('load', { placeholder: '80 kg', maxlength: '30' }, 'Load'),
        field('rpe', { placeholder: '8', maxlength: '10' }, 'RPE'),
        field('note', { placeholder: 'Tempo, cues', maxlength: '300' }, 'Note'),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', disabled: i === 0, 'aria-label': 'Move up', onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; drawItems(); } }, '↑'),
          h('button', { class: 'btn small', disabled: i === items.length - 1, 'aria-label': 'Move down', onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; drawItems(); } }, '↓'),
          h('button', { class: 'btn small danger', 'aria-label': 'Remove', onclick: () => { items.splice(i, 1); drawItems(); } }, '✕')));
    }));
  }
  drawItems();

  const payload = () => ({
    clientId: id ? undefined : c.id,
    date: date.value, title: title.value.trim(), startsAt: startsAt.value || null, location: location.value.trim() || null, notes: notes.value,
    items: items.map(it => ({
      ...(it.id ? { id: it.id } : {}), exerciseId: it.exerciseId, sets: Number(it.sets), reps: String(it.reps).trim(),
      load: String(it.load).trim(), rpe: String(it.rpe).trim() || null, note: String(it.note).trim() || null,
    })),
  });
  const check = p => {
    if (!p.date) return 'Choose a date.';
    if (!p.title) return 'Give the workout a title.';
    const bad = p.items.findIndex(i => !i.exerciseId || !Number.isInteger(i.sets) || i.sets < 1 || !i.reps);
    return bad >= 0 ? `Exercise ${bad + 1} needs an exercise, sets and reps.` : null;
  };
  const save = async publish => {
    const p = payload();
    const problem = check(p);
    if (problem) { fill(status, errorLine(problem)); return; }
    fill(status, h('p', { class: 'muted small' }, 'Saving…'));
    try {
      let saved = id ? await api('PUT', `/api/workouts/${encodeURIComponent(id)}`, p) : await api('POST', '/api/workouts', p);
      if (publish && !saved.published) saved = await api('POST', `/api/workouts/${encodeURIComponent(saved.id)}/publish`);
      if (!fresh()) return;
      state.planWeek = mondayOf(saved.date);
      await planTab(body, fresh);
    } catch (err) {
      fill(status, errorLine(err));
    }
  };

  fill(box, h('div', { class: 'card' },
    h('div', { class: 'spread' }, h('h3', null, id ? 'Edit workout' : 'New workout'),
      w ? h('span', { class: 'small muted' }, w.completedAt ? `Completed ${fmtWhen(w.completedAt)}` : w.published ? 'Published: the client sees changes at once' : 'Draft: hidden from the client') : null),
    h('div', { class: 'grid4' },
      h('div', null, h('label', null, 'Date'), date),
      h('div', null, h('label', null, 'Title'), title),
      h('div', null, h('label', null, 'Starts'), startsAt),
      h('div', null, h('label', null, 'Location'), location)),
    h('label', null, 'Notes'), notes,
    h('div', { class: 'eyebrow' }, 'Exercises'),
    itemsBox,
    h('button', { class: 'btn small', onclick: () => { items.push({ id: null, exerciseId: '', sets: 3, reps: '8', load: '', rpe: '', note: '', logged: 0 }); drawItems(); } }, '+ Add exercise'),
    h('div', { class: 'row mt' },
      h('button', { class: 'btn primary', onclick: () => save(true) }, w?.published ? 'Save' : 'Save and publish'),
      w?.published ? null : h('button', { class: 'btn', onclick: () => save(false) }, 'Save draft'),
      h('button', { class: 'btn', onclick: () => box.replaceChildren() }, 'Close'),
      id ? h('button', {
        class: 'btn danger',
        onclick: async () => {
          if (!confirm(`Delete "${w.title}"${w.items.some(i => i.logged.length) ? ' and its logged sets' : ''}?`)) return;
          try { await api('DELETE', `/api/workouts/${encodeURIComponent(id)}`); if (fresh()) planTab(body, fresh); } catch (err) { fill(status, errorLine(err)); }
        },
      }, 'Delete') : null),
    status));
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// MARK: - Check-ins

async function checkinsTab(body, fresh) {
  const c = state.client;
  fill(body, loading());
  let data;
  try {
    data = await api('GET', `/api/checkins?${q({ clientId: c.id })}`);
  } catch (err) {
    if (fresh()) fill(body, errorLine(err));
    return;
  }
  if (!fresh()) return;
  if (!data.checkins.length) { fill(body, h('p', { class: 'muted' }, `${c.name} hasn't sent a weekly check-in yet.`)); return; }
  fill(body, ...data.checkins.map(ci => {
    const reply = h('textarea', { value: ci.reply || '', placeholder: 'Reply to this check-in', maxlength: '2000' });
    const status = h('div');
    return h('div', { class: 'card' },
      h('div', { class: 'spread' }, h('b', null, `Week of ${fmtShort(ci.week)}`), h('span', { class: 'small muted' }, `Sent ${fmtWhen(ci.submittedAt)}`)),
      h('div', { class: 'small muted' }, `Energy ${ci.energy}/5 · Sleep ${ci.sleep}/5`),
      ci.pain.length ? h('div', null, ci.pain.map(p => h('span', { class: 'chip' }, p))) : null,
      ci.note ? h('p', null, ci.note) : null,
      h('label', null, ci.reviewedAt ? `Your reply · ${fmtWhen(ci.reviewedAt)}` : 'Your reply'), reply,
      h('div', { class: 'row mt' }, h('button', {
        class: 'btn',
        onclick: async () => {
          try {
            await api('POST', `/api/checkins/${encodeURIComponent(ci.id)}/review`, { reply: reply.value });
            fill(status, h('p', { class: 'ok' }, 'Reply saved.'));
          } catch (err) { fill(status, errorLine(err)); }
        },
      }, 'Save reply')),
      status);
  }));
}

// MARK: - Health

async function healthTab(body, fresh) {
  const c = state.client;
  fill(body, loading());
  let data;
  try {
    data = await api('GET', `/api/health/week?${q({ clientId: c.id })}`);
  } catch (err) {
    if (fresh()) fill(body, errorLine(err));
    return;
  }
  if (!fresh()) return;
  if (!data.shared) {
    fill(body, h('div', { class: 'card' }, h('p', { class: 'm0' },
      `${c.name} hasn't shared Apple Health with you. They can turn it on in the app: Account › Health & devices.`)));
    return;
  }
  const cols = [['Steps', d => fmtNum(d.steps)], ['Sleep', d => fmtMinutes(d.sleepMinutes)], ['Resting HR', d => (d.restingHr === null ? '—' : Math.round(d.restingHr))],
    ['Active kcal', d => fmtNum(d.activeKcal)], ['Distance', d => (d.distanceKm === null ? '—' : `${d.distanceKm} km`)]];
  fill(body, 
    data.sharedSince ? h('p', { class: 'small faint' }, `Shared since ${fmtWhen(data.sharedSince)}`) : null,
    h('div', { class: 'card scroll' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Day'), cols.map(([k]) => h('th', null, k)))),
      h('tbody', null, data.days.map(d => h('tr', null, h('td', null, fmtDay(d.date)), cols.map(([, f]) => h('td', null, String(f(d))))))))),
    h('div', { class: 'eyebrow' }, 'Activities · last 7 days'),
    data.activities.length ? h('ul', { class: 'list card' }, data.activities.map(a => h('li', { class: 'spread' },
      h('div', null, h('b', null, a.type), h('div', { class: 'small muted' }, [fmtWhen(a.start), a.source].filter(Boolean).join(' · '))),
      h('div', { class: 'small' }, [`${a.minutes} min`, a.distanceKm ? `${a.distanceKm} km` : null, a.kcal ? `${a.kcal} kcal` : null, a.avgHr ? `${a.avgHr} bpm` : null].filter(Boolean).join(' · ')))))
      : h('p', { class: 'muted' }, 'No activities recorded this week.'));
}

// MARK: - Boot

async function boot() {
  if (!token) { renderSignIn(); return; }
  try {
    const me = await api('GET', '/api/me');
    if (me.role !== 'coach') { setToken(null); renderSignIn('The coach desk is for coaches.'); return; }
    state.me = me;
    await startDesk();
  } catch (err) {
    if (err.status === 401) return; // api() already showed sign-in
    fill(app(), h('div', { class: 'pad' }, errorLine(err), h('button', { class: 'btn', onclick: boot }, 'Try again')));
  }
}

boot();
