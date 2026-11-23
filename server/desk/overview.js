/*
 * A client's Overview (the default tab of a client's page), the same layout
 * as the coach's phone app: GoalCard, HabitWeekGrid with Edit habits and rest
 * days, the latest check-in with "Write this week's letter", the next session,
 * health sparklines, and rows into the rest of the studio.
 * (docs/design/atelier-spec.md, "Coach screens" 3.)
 */
import {
  DAYS, HABIT_KEYS, HABIT_KEY_LABEL, addDays, api, button, busy, card, confirmBox, daysBetween, errorLine, field,
  fill, fmtShort, fmtTime, fmtWeekday, h, icon, link, loading, londonParts, mediaImage, parseDay, pill, q, ring, segmented,
  sheet, sparkline, state, toast, todayLondon, weekDots,
} from './core.js';
import { letterComposer } from './letters.js';
import { parSection } from './par.js';

const enc = encodeURIComponent;
const fmtN = (v, digits = 1) => (v === null || v === undefined ? '–' : Number(v).toLocaleString('en-GB', { maximumFractionDigits: digits }));
const pad2 = n => String(n).padStart(2, '0');
const fmtHM = m => { const t = Math.round(m); return `${Math.floor(t / 60)}h ${pad2(t % 60)}m`; };
const weekdayOf = s => DAYS[parseDay(s).getUTCDay()];
const parseNum = s => { const v = Number(String(s ?? '').replace(',', '.').trim()); return String(s ?? '').trim() !== '' && Number.isFinite(v) ? v : null; };

/** A section heading: sans headline with optional actions on the right. */
export const sectionHead = (title, ...actions) => h('div', { class: 'ov-head' }, h('h2', null, title), actions.length ? h('div', { class: 'row gap4' }, actions) : null);

/** The features of a client's plan, once the coach's plans have loaded (null: unknown, show everything). */
export function planFeatures(planId) {
  const p = state.plans?.plans.find(x => x.id === (planId || 'none'));
  return p ? new Set(p.features) : null;
}
const has = (features, f) => !features || features.has(f);

/**
 * StatusPills for the header: at most two, each a word plus a dot.
 */
export function statusPills(detail) {
  const c = detail.client;
  const out = [];
  const ci = detail.latestCheckin;
  if (c.demand?.urgent?.length || (ci && ci.pain?.length && !ci.reviewedAt)) out.push(pill('Pain flagged', 'urgent'));
  if (ci && !ci.reviewedAt) out.push(pill('Check-in in', 'attention'));
  if (c.unread > 0) out.push(pill('Unread message', 'attention'));
  if (c.demand?.kind === 'quiet') out.push(pill('Gone quiet', 'attention'));
  if (c.demand?.kind === 'inactive') out.push(pill('No training lately', 'attention'));
  if (!out.length) out.push(pill('On track', 'ok'));
  return out.slice(0, 2);
}

// MARK: - Overview

export async function overviewTab(box, ctx, { openLetter = false } = {}) {
  fill(box, loading());
  let detail;
  try {
    detail = await ctx.detail();
  } catch (err) {
    if (ctx.view.fresh()) fill(box, errorLine(err), button('Try again', () => overviewTab(box, ctx), { small: true }));
    return;
  }
  if (!ctx.view.fresh()) return;
  const features = planFeatures(detail.client.plan);
  const reload = async () => { await ctx.reloadDetail(); if (ctx.view.fresh()) overviewTab(box, ctx); };
  const writeLetter = async opts => { const changed = await letterComposer(ctx, opts); if (changed && ctx.view.fresh()) reload(); };

  const goalBox = h('section', { class: 'ov-sec' });
  const parBox = h('section', { class: 'ov-sec' });
  const habitBox = h('section', { class: 'ov-sec' });
  const checkinBox = h('section', { class: 'ov-sec' });
  const healthBox = h('section', { class: 'ov-sec' });
  fill(box, h('div', { class: 'ov-grid' },
    h('div', { class: 'ov-main' },
      has(features, 'progress') ? goalBox : null,
      has(features, 'progress') || has(features, 'checkin') ? parBox : null,
      has(features, 'habits') ? habitBox : null,
      has(features, 'checkin') ? checkinBox : null),
    h('div', { class: 'ov-side' },
      nextSection(detail),
      detail.healthShared ? healthBox : null,
      rowsSection(ctx, detail, features, writeLetter),
      aboutSection(detail.profile, ctx.first()))));

  goalSection(goalBox, ctx, detail, reload);
  if (has(features, 'progress') || has(features, 'checkin')) parSection(parBox, ctx, sectionHead);
  if (has(features, 'checkin')) checkinSection(checkinBox, ctx, detail, writeLetter);
  if (detail.healthShared) healthSection(healthBox, ctx);
  if (has(features, 'habits')) await habitSection(habitBox, ctx, detail, features, reload);
  if (openLetter && ctx.view.fresh()) writeLetter({});
}

// MARK: - GoalCard

const METRICS = [
  ['weight', 'Body weight'], ['waist', 'Waist'], ['measurement', 'A measurement'], ['record', 'A lift (best logged load)'],
  ['habit', 'A habit'], ['custom', 'Something else (you update it)'],
];
const MEASURES = [['weight', 'Weight'], ['bodyFat', 'Body fat'], ['waist', 'Waist'], ['restingHr', 'Resting heart rate']];
const DEFAULT_UNIT = { weight: 'kg', waist: 'cm', record: 'kg', habit: 'days', custom: '' };

function goalSection(box, ctx, detail, reload) {
  const goals = detail.goals || [];
  const active = goals.find(g => g.status === 'active');
  const draft = goals.find(g => g.status === 'draft');
  const edit = async (g, extra) => { if (await goalSheet(ctx, g, extra)) reload(); };

  if (active) {
    const g = active;
    const weeksLeft = g.weekOf ? Math.max(0, g.weekOf.weeks - g.weekOf.week) : null;
    const figure = (k, v) => h('div', { class: 'ov-fig' }, h('div', { class: 'small muted' }, k), h('div', { class: 't-num ov-fig-v' }, v === null || v === undefined ? '–' : `${fmtN(v)}${g.unit ? ` ${g.unit}` : ''}`));
    fill(box, sectionHead('Goal', button('Edit', () => edit(g), { small: true })),
      card({ class: 'ov-goal' },
        h('div', { class: 'ov-goal-top' },
          ring(g.progressPct ?? 0, { size: 44, label: `${g.progressPct ?? 0}% of the way` }),
          h('div', { class: 'grow' },
            h('div', { class: 't-title' }, g.title),
            g.chapterName ? h('div', { class: 'small muted' }, `Chapter: ${g.chapterName}`) : null)),
        h('div', { class: 'ov-figs' }, figure('Start', g.baseline), figure('Now', g.current), figure('Target', g.target)),
        h('div', { class: 'row ov-goal-foot' },
          h('span', { class: 'small' }, [g.reached ? 'Reached' : g.remainingLabel, weeksLeft !== null ? `${weeksLeft} week${weeksLeft === 1 ? '' : 's'} left` : null].filter(Boolean).join(' · ')),
          g.onTrack === true ? pill('On track', 'ok') : g.onTrack === false ? pill('Worth a look', 'attention') : null),
        g.sourceLabel ? h('div', { class: 'small muted' }, g.sourceLabel) : null));
    return;
  }
  if (draft) {
    fill(box, sectionHead('Goal'),
      card({ class: 'ov-goal' },
        h('div', { class: 'row' }, h('span', { class: 'muted' }, icon('goal', 20)), h('span', { class: 'small muted' }, 'Draft')),
        draft.title ? h('div', { class: 't-title' }, draft.title) : null,
        h('p', { class: 'muted' }, draft.suggestion ? `Suggested from onboarding: ${draft.suggestion}. Set the goal.` : 'A goal is waiting to be set.'),
        button('Set the goal', () => edit(draft, { activate: true }))));
    return;
  }
  fill(box, sectionHead('Goal'),
    card({ class: 'ov-goal' },
      h('p', { class: 'muted m0' }, `${ctx.first()} has no goal yet. Their Today shows “JK will set your goal with you this week.”`),
      h('div', { class: 'mt' }, button('Set a goal', () => edit(null)))));
}

/** Create or edit a goal. Resolves true when saved. */
function goalSheet(ctx, goal, { activate = false } = {}) {
  return sheet(goal?.id ? (goal.status === 'draft' ? 'Set the goal' : 'Edit goal') : 'New goal', (body, close) => {
    const g = goal || {};
    let metric = g.metric || 'weight';
    let exercise = g.exerciseId ? { id: g.exerciseId, name: g.exerciseName } : null;
    const title = h('input', { class: 'serif-input', value: g.title || '', maxlength: '120', placeholder: 'Down to 75 kg by March' });
    const metricSel = h('select', null, METRICS.map(([v, l]) => h('option', { value: v, selected: v === metric }, l)));
    const measureSel = h('select', null, MEASURES.map(([v, l]) => h('option', { value: v, selected: v === (g.measureKey || 'weight') }, l)));
    const habitSel = h('select', null, h('option', { value: '' }, 'Loading…'));
    const exBtn = button(exercise ? exercise.name : 'Choose an exercise', async () => {
      const ex = await ctx.exercisePicker();
      if (ex) { exercise = ex; exBtn.textContent = ex.name; }
    });
    const unit = h('input', { value: g.unit ?? DEFAULT_UNIT[metric] ?? '', maxlength: '12', placeholder: 'kg' });
    const baseline = h('input', { inputmode: 'decimal', value: g.baseline ?? '', placeholder: '84.6' });
    const target = h('input', { inputmode: 'decimal', value: g.target ?? '', placeholder: '75' });
    const current = h('input', { inputmode: 'decimal', value: g.currentValue ?? g.current ?? '', placeholder: 'Now' });
    const start = h('input', { type: 'date', value: g.startDate || todayLondon() });
    const end = h('input', { type: 'date', value: g.targetDate || '' });
    const why = h('textarea', { rows: '2', maxlength: '300', placeholder: 'In their words, if they gave one' }, g.why || '');
    const chapter = h('input', { value: g.chapterName || '', maxlength: '60', placeholder: 'Optional, written by you (shown on Progress)' });
    const measureRow = field('Measurement', measureSel), habitRow = field('Habit', habitSel), exRow = field('Exercise', exBtn), currentRow = field('Now', current);
    const status = h('div');
    const sync = () => {
      metric = metricSel.value;
      measureRow.hidden = metric !== 'measurement';
      habitRow.hidden = metric !== 'habit';
      exRow.hidden = metric !== 'record';
      currentRow.hidden = metric !== 'custom';
      save.disabled = !title.value.trim();
    };
    metricSel.addEventListener('change', () => { if (!unit.value || Object.values(DEFAULT_UNIT).includes(unit.value)) unit.value = DEFAULT_UNIT[metricSel.value] ?? unit.value; sync(); });
    title.addEventListener('input', sync);
    api('GET', `/api/habits?${q({ clientId: ctx.id, date: todayLondon() })}`).then(d => {
      fill(habitSel, d.habits.length ? d.habits.map(hb => h('option', { value: hb.id, selected: hb.id === g.habitId }, hb.name)) : h('option', { value: '' }, 'No habits yet'));
    }, () => fill(habitSel, h('option', { value: '' }, 'Could not load habits')));

    const save = button(goal?.id && !activate ? 'Save' : 'Set goal', async () => {
      const b = {
        title: title.value.trim(), metric, unit: unit.value.trim() || null,
        baseline: parseNum(baseline.value), target: parseNum(target.value),
        startDate: start.value || null, targetDate: end.value || null, why: why.value.trim() || null, chapterName: chapter.value.trim() || null,
        measureKey: metric === 'measurement' ? measureSel.value : null,
        exerciseId: metric === 'record' ? exercise?.id ?? null : null,
        habitId: metric === 'habit' ? habitSel.value || null : null,
        currentValue: metric === 'custom' ? parseNum(current.value) : undefined,
      };
      if (activate || !goal?.id) b.status = 'active';
      await busy(save, status, async () => {
        if (goal?.id) await api('PATCH', `/api/goals/${enc(goal.id)}`, b);
        else await api('POST', '/api/goals', { clientId: ctx.id, ...b });
        toast(`Goal set for ${ctx.first()}.`);
        close(true);
      });
    }, { kind: 'primary' });
    const remove = goal?.id ? h('button', {
      class: 'btn danger', type: 'button', onclick: async () => {
        if (!await confirmBox('Delete this goal?', { ok: 'Delete goal', danger: true })) return;
        await busy(null, status, async () => { await api('DELETE', `/api/goals/${enc(goal.id)}`); close(true); });
      },
    }, 'Delete') : h('span');

    fill(body,
      goal?.suggestion ? h('p', { class: 'muted m0' }, `Suggested from onboarding: ${goal.suggestion}.`) : null,
      field('The sentence', title, `${ctx.first()} sees this on Today, in the serif.`),
      field('Measured by', metricSel), measureRow, exRow, habitRow,
      h('div', { class: 'grid3' }, field('Start', baseline), field('Target', target), field('Unit', unit)),
      currentRow,
      h('div', { class: 'grid2' }, field('From', start), field('By', end)),
      field('Why', why), field('Chapter name', chapter), status);
    sync();
    setTimeout(() => title.focus(), 0);
    return h('div', { class: 'spread' }, remove, h('div', { class: 'row end' }, button('Cancel', () => close(false)), save));
  }).then(v => v === true);
}

// MARK: - HabitWeekGrid

/** "Travelling · Tue 17 to Thu 19 Nov": consecutive days with the same reason become one range. */
function restRanges(list) {
  const days = [...list].sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  for (const d of days) {
    const last = out.at(-1);
    if (last && addDays(last.to, 1) === d.date && (last.reason || '') === (d.reason || '')) { last.to = d.date; last.dates.push(d.date); } else out.push({ from: d.date, to: d.date, reason: d.reason, dates: [d.date] });
  }
  return out;
}
const rangeText = r => (r.from === r.to ? `${weekdayOf(r.from)} ${fmtShort(r.from)}` : `${weekdayOf(r.from)} to ${weekdayOf(r.to)} ${fmtShort(r.to)}`);

function trendGlyph(now, prev) {
  if (now === null || now === undefined || prev === null || prev === undefined) return h('span', { class: 'small muted' }, '–');
  const diff = Math.round((now - prev) * 100);
  const key = diff > 0 ? 'trendUp' : diff < 0 ? 'trendDown' : 'trendFlat';
  const word = diff > 0 ? `up ${diff} points on last week` : diff < 0 ? `down ${-diff} points on last week` : 'same as last week';
  return h('span', { class: 'row gap4 ov-trend muted', title: word }, icon(key, 16, { label: word }), h('span', { class: 'small t-num' }, diff === 0 ? 'Same' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)} pts`));
}

async function habitSection(box, ctx, detail, features, reload) {
  const today = todayLondon();
  fill(box, sectionHead('Habits this week'), loading());
  let hist;
  try {
    hist = await api('GET', `/api/habits/history?${q({ clientId: ctx.id, from: addDays(today, -6), to: today })}`);
  } catch (err) {
    if (ctx.view.fresh()) fill(box, sectionHead('Habits this week'), errorLine(err));
    return;
  }
  if (!ctx.view.fresh()) return;
  const settings = detail.settings || {};
  const editBtn = button('Edit habits', async () => { if (await habitsSheet(ctx, hist.habits, settings, features)) reload(); }, { small: true });
  const restBtn = button('Give a rest day', async () => { if (await restDaySheet(ctx)) reload(); }, { small: true });
  const dayStates = hist.days.map(d => ({ date: d.date, done: d.dayDone, rest: d.rest, today: d.date === today }));
  const doneDays = hist.days.filter(d => d.dayDone).length, countable = hist.days.filter(d => !d.rest).length;
  const minimum = settings.dayMinimum ?? hist.days.at(-1)?.minimum;

  const grid = h('div', { class: 'hw-grid', role: 'table', 'aria-label': 'Habits over the last seven days' },
    h('div', { class: 'hw-row hw-days', role: 'row' }, h('span', { role: 'columnheader' }, ''),
      h('span', { class: 'hw-dots', role: 'columnheader' }, hist.days.map(d => h('span', { class: 'hw-day' + (d.date === today ? ' today' : '') }, weekdayOf(d.date).slice(0, 1)))),
      h('span', { class: 'small muted', role: 'columnheader' }, 'Week'), h('span', { class: 'small muted', role: 'columnheader' }, 'vs last')),
    hist.habits.map(hb => {
      const doneToday = hb.days.at(-1)?.done;
      const nonRest = hb.days.filter(d => !d.rest);
      return h('div', { class: 'hw-row', role: 'row' },
        h('span', { class: 'hw-name', role: 'cell' }, h('span', { class: doneToday ? 'tone-accent' : 'muted' }, icon(hb.iconKey || 'custom', 20, { filled: !!doneToday })),
          h('span', { class: 'clamp1' }, hb.name), hb.healthKind ? h('span', { class: 'muted', title: 'From Apple Health or Health Connect' }, icon('fromHealth', 12, { label: 'From Health' })) : null),
        h('span', { class: 'hw-dotcell', role: 'cell' }, weekDots(hb.days.map(d => ({ date: d.date, done: d.done, rest: d.rest })), { big: true })),
        h('span', { class: 'small t-num', role: 'cell' }, `${nonRest.filter(d => d.done).length} of ${nonRest.length}`),
        h('span', { role: 'cell' }, trendGlyph(hb.rate7, hb.rate7Prev)));
    }),
    h('div', { class: 'hw-row hw-total', role: 'row' },
      h('span', { class: 'hw-name strong', role: 'cell' }, 'Day done'),
      h('span', { class: 'hw-dotcell', role: 'cell' }, weekDots(dayStates, { big: true })),
      h('span', { class: 'small t-num', role: 'cell' }, `${doneDays} of ${countable}`),
      h('span', { role: 'cell' })));

  const rest = (detail.restDays || []).filter(r => r.date >= addDays(today, -7));
  const restList = rest.length ? h('div', { class: 'hw-rest' }, restRanges(rest).map(r => h('div', { class: 'row hw-rest-row' },
    h('span', { class: 'muted' }, icon('rest', 18)),
    h('span', { class: 'grow small' }, [r.reason, rangeText(r)].filter(Boolean).join(' · ')),
    h('button', {
      class: 'btn text small', type: 'button', 'aria-label': `Remove rest ${rangeText(r)}`,
      onclick: async () => {
        if (!await confirmBox(r.dates.length > 1 ? 'Remove these rest days?' : 'Remove this rest day?', { ok: 'Remove', danger: true })) return;
        await busy(null, null, async () => { for (const d of r.dates) await api('DELETE', `/api/clients/${enc(ctx.id)}/rest-days/${d}`); reload(); });
      },
    }, 'Remove')))) : null;

  fill(box, sectionHead('Habits this week', restBtn, editBtn),
    hist.habits.length
      ? card({ class: 'hw-card' }, grid,
        h('p', { class: 'small muted hw-rule' }, `A day is done at ${minimum} of ${hist.habits.length}${settings.dayMinimumIsDefault ? ' (the default)' : ''}. A miss lowers the count; rest days count neither way.`),
        restList)
      : card(null, h('p', { class: 'muted m0' }, 'No habits yet. Up to five, from the catalogue.'), restList));
}

/** Up to five habits, the day minimum and (with 'nutrition') macro targets. Resolves true when anything was saved. */
function habitsSheet(ctx, current, settings, features) {
  return sheet(`Habits for ${ctx.first()}`, (body, close) => {
    const rows = current.map(hb => ({ ...hb, orig: hb }));
    const removed = [];
    let dayMin = settings.dayMinimumIsDefault ? '' : String(settings.dayMinimum ?? '');
    const list = h('div', { class: 'he-list' });
    const minBox = h('div');
    const status = h('div');
    const withNutrition = has(features, 'nutrition');
    const macroInputs = withNutrition ? ['kcal', 'protein', 'carbs', 'fat'].map(k => ({ k, input: h('input', { inputmode: 'decimal', placeholder: { kcal: '2500', protein: '170', carbs: '260', fat: '80' }[k] }) })) : [];
    let macrosLoaded = null;
    if (withNutrition) {
      api('GET', `/api/habits?${q({ clientId: ctx.id, date: todayLondon() })}`).then(d => {
        const t = d.nutrition?.targets;
        macrosLoaded = t || null;
        for (const m of macroInputs) m.input.value = t?.[m.k] ?? '';
      }, () => { /* left empty */ });
    }

    const drawMin = () => {
      const n = rows.length;
      const def = Math.max(1, Math.ceil(n * 0.6));
      fill(minBox, field('Day minimum', h('select', { onchange: e => { dayMin = e.target.value; } },
        h('option', { value: '', selected: dayMin === '' }, `Default: ${n ? def : '–'} of ${n}`),
        Array.from({ length: Math.min(5, Math.max(n, 1)) }, (_, i) => h('option', { value: String(i + 1), selected: dayMin === String(i + 1) }, `${i + 1} of ${n}`))),
      'A day counts once this many habits are done.'));
    };

    const draw = () => {
      fill(list, rows.map((r, i) => habitEditor(r, i)),
        rows.length < 5
          ? h('button', { class: 'he-add', type: 'button', onclick: () => { rows.push({ id: null, name: '', kind: 'check', target: 1, unit: '', step: null, iconKey: 'custom', healthKind: null }); draw(); } }, icon('add', 18), `Add a habit (${rows.length} of 5)`)
          : h('p', { class: 'small muted' }, 'Five habits is the most. Remove one to add another.'));
      drawMin();
    };

    function habitEditor(r, i) {
      const picker = h('div', { class: 'he-icons', hidden: true }, HABIT_KEYS.map(k => h('button', {
        type: 'button', class: 'he-icon' + (k === r.iconKey ? ' sel' : ''), 'aria-label': HABIT_KEY_LABEL[k], 'aria-pressed': String(k === r.iconKey), title: HABIT_KEY_LABEL[k],
        onclick: () => { r.iconKey = k; draw(); },
      }, icon(k, 22, { filled: k === r.iconKey }))));
      const glyph = h('button', { class: 'he-glyph', type: 'button', 'aria-label': `Glyph: ${HABIT_KEY_LABEL[r.iconKey] ?? r.iconKey}. Change`, onclick: () => { picker.hidden = !picker.hidden; } }, icon(r.iconKey || 'custom', 24));
      const input = (key, attrs) => h('input', { ...attrs, value: r[key] ?? '', oninput: e => { r[key] = e.target.value; } });
      const isCount = r.kind === 'count';
      return h('div', { class: 'he-row' },
        h('div', { class: 'he-top' }, glyph,
          h('div', { class: 'grow' }, input('name', { maxlength: '40', placeholder: 'Water', 'aria-label': 'Habit name' })),
          segmented([['check', 'Tick off'], ['count', 'Count']], r.kind, v => { r.kind = v; if (v === 'check' && !r.healthKind) r.target = 1; draw(); }),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Remove ${r.name || 'habit'}`, onclick: () => { if (r.id) removed.push(r); rows.splice(i, 1); draw(); } }, icon('trash', 18))),
        picker,
        h('div', { class: 'he-fields' },
          isCount || r.healthKind ? h('div', null, h('label', null, 'Target'), input('target', { inputmode: 'decimal', placeholder: '3' })) : null,
          isCount || r.healthKind ? h('div', null, h('label', null, 'Unit'), input('unit', { maxlength: '12', placeholder: 'L' })) : null,
          isCount ? h('div', null, h('label', null, 'Step'), input('step', { inputmode: 'decimal', placeholder: '0.5' })) : null,
          h('div', null, h('label', null, 'From Health'), h('select', {
            onchange: e => {
              r.healthKind = e.target.value || null;
              if (r.healthKind === 'sleep') { r.kind = 'check'; r.target = 7; r.unit = 'h'; r.iconKey = 'sleep'; if (!r.name) r.name = 'Sleep'; }
              if (r.healthKind === 'steps') { r.kind = 'count'; r.target = 10000; r.unit = 'steps'; r.step = 1000; r.iconKey = 'steps'; if (!r.name) r.name = 'Steps'; }
              draw();
            },
          }, [['', 'No'], ['steps', 'Steps'], ['sleep', 'Sleep']].map(([v, l]) => h('option', { value: v, selected: (r.healthKind || '') === v }, l))))));
    }

    const save = button('Save', async () => {
      await busy(save, status, async () => {
        for (const r of rows) if (!String(r.name).trim()) throw new Error('Every habit needs a name.');
        for (const r of removed) await api('DELETE', `/api/habits/${enc(r.id)}`);
        for (const [i, r] of rows.entries()) {
          const withTarget = r.kind === 'count' || r.healthKind;
          const b = {
            name: String(r.name).trim(), kind: r.kind, iconKey: r.iconKey || 'custom', healthKind: r.healthKind || null,
            target: withTarget ? (parseNum(r.target) ?? 1) : 1, unit: withTarget ? String(r.unit ?? '').trim() : '',
            ...(r.kind === 'count' && parseNum(r.step) !== null ? { step: parseNum(r.step) } : {}),
          };
          if (r.id) {
            const o = r.orig;
            const changed = ['name', 'kind', 'iconKey', 'healthKind', 'target', 'unit', 'step'].some(k => b[k] !== undefined && b[k] !== (o[k] ?? (k === 'healthKind' ? null : o[k])));
            if (changed || o.position !== i) await api('PATCH', `/api/habits/${enc(r.id)}`, { ...b, position: i });
          } else {
            await api('POST', '/api/habits', { clientId: ctx.id, ...b });
          }
        }
        const wanted = dayMin === '' ? null : Number(dayMin);
        if (wanted !== (settings.dayMinimumIsDefault ? null : settings.dayMinimum)) await api('PATCH', `/api/coach/clients/${enc(ctx.id)}/settings`, { dayMinimum: wanted });
        if (withNutrition) {
          const vals = Object.fromEntries(macroInputs.map(m => [m.k, parseNum(m.input.value)]));
          const any = Object.values(vals).some(v => v !== null);
          const same = macrosLoaded && macroInputs.every(m => vals[m.k] === (macrosLoaded[m.k] ?? null));
          if (any && !same) {
            if (Object.values(vals).some(v => v === null)) throw new Error('Fill in all four macro targets, or none.');
            await api('PUT', '/api/nutrition/targets', { clientId: ctx.id, ...vals });
          }
        }
        toast('Habits saved.');
        close(true);
      });
    }, { kind: 'primary' });

    fill(body,
      h('p', { class: 'muted m0' }, `Up to five, each with a glyph from the catalogue. ${ctx.first()} ticks them off on Today.`),
      list, minBox,
      withNutrition ? h('div', null, h('h3', { class: 'mt' }, 'Macro targets'), h('p', { class: 'small muted m0' }, 'The Fuel ring on Today needs all four. Food logging works without them.'),
        h('div', { class: 'grid4 mt-s' }, macroInputs.map(m => field({ kcal: 'kcal', protein: 'Protein g', carbs: 'Carbs g', fat: 'Fat g' }[m.k], m.input)))) : null,
      status);
    draw();
    return h('div', { class: 'row end' }, button('Cancel', () => close(false)), save);
  }, { wide: true }).then(v => v === true);
}

/** Give a rest day (date plus an optional reason). Resolves true when given. */
function restDaySheet(ctx) {
  return sheet('Give a rest day', (body, close) => {
    const date = h('input', { type: 'date', value: todayLondon() });
    const reason = h('input', { maxlength: '80', placeholder: 'Travelling' });
    const status = h('div');
    const give = button('Give rest day', async () => {
      if (!date.value) return;
      await busy(give, status, async () => {
        await api('POST', `/api/clients/${enc(ctx.id)}/rest-days`, { date: date.value, reason: reason.value.trim() || null });
        toast(`${fmtWeekday(date.value)} is a rest day for ${ctx.first()}.`);
        close(true);
      });
    }, { kind: 'primary' });
    body.append(h('p', { class: 'muted m0' }, 'A rest day is neither done nor missed. Their habits show “Rest” that day.'),
      field('Day', date), field('Reason (optional)', reason, `${ctx.first()} sees it beside the day.`), status);
    return h('div', { class: 'row end' }, button('Cancel', () => close(false)), give);
  }).then(v => v === true);
}

// MARK: - Latest check-in

function checkinSection(box, ctx, detail, writeLetter) {
  const c = detail.latestCheckin;
  const letterBtn = h('button', { class: 'btn primary block', type: 'button', onclick: () => writeLetter({}) }, icon('letter', 20), 'Write this week’s letter');
  if (!c) {
    fill(box, sectionHead('Latest check-in'), card(null, h('p', { class: 'muted m0' }, `No check-in from ${ctx.first()} yet.`)), letterBtn);
    return;
  }
  const w = c.week || {};
  const score = (k, v) => h('div', { class: 'ov-fig' }, h('div', { class: 'small muted' }, k), h('div', { class: 't-num ov-fig-v' }, v === null || v === undefined ? '–' : `${v} of 5`));
  const when = c.submittedAt ? `${fmtWeekday(londonParts(c.submittedAt).day)} ${fmtTime(c.submittedAt)}` : '';
  fill(box, sectionHead('Latest check-in', h('span', { class: 'small muted' }, `Week of ${fmtShort(w.week || c.week)}`)),
    card({ class: 'ov-checkin' },
      h('div', { class: 'small muted' }, [`Checked in ${when}`, c.reviewedAt ? 'letter written' : null].filter(Boolean).join(' · ')),
      h('div', { class: 'ov-figs' }, score('Energy', c.energy), score('Sleep', c.sleep), score('Stress', c.stress)),
      c.pain?.length ? h('div', { class: 'row gap4 tone-urgent ov-pain' }, icon('pain', 18), h('span', null, `Sore: ${c.pain.join(', ')}`)) : null,
      c.win ? h('div', { class: 'ov-quote' }, h('div', { class: 'small muted' }, 'Win'), h('div', null, c.win)) : null,
      c.struggle ? h('div', { class: 'ov-quote' }, h('div', { class: 'small muted' }, 'Struggle'), h('div', null, c.struggle)) : null,
      c.note ? h('div', { class: 'ov-quote' }, h('div', { class: 'small muted' }, 'Note'), h('div', null, c.note)) : null,
      c.photoIds?.length ? h('div', { class: 'ov-photos' }, c.photoIds.map(id => mediaImage(`/api/media/${enc(id)}`, 'Check-in photo', { loading: 'lazy' }))) : null,
      w.feel?.length ? h('div', { class: 'ov-feel' }, h('div', { class: 'small muted' }, 'Sessions'),
        w.feel.map(f => h('div', { class: 'spread small' }, h('span', null, `${weekdayOf(f.date)} · ${f.title}`), h('span', { class: 'muted' }, f.word ?? '–')))) : null,
      w.sessionsPlanned ? h('div', { class: 'small muted' }, `${w.sessionsDone} of ${w.sessionsPlanned} sessions · habits ${w.habits ? `${w.habits.done} of ${w.habits.days} days` : '–'}${w.avgSteps ? ` · ${fmtN(w.avgSteps, 0)} steps a day` : ''}`) : null),
    letterBtn);
}

// MARK: - Next session, health, rows, about

function nextSection(detail) {
  const b = detail.nextBooking, w = detail.nextWorkout;
  if (!b && !w) return null;
  const row = (glyph, title, when) => h('div', { class: 'ov-next-row' }, h('span', { class: 'muted' }, icon(glyph, 20)),
    h('div', { class: 'grow' }, h('div', null, title), h('div', { class: 'small muted' }, when)));
  return h('section', { class: 'ov-sec' }, sectionHead('Next'),
    card({ class: 'next flush' },
      w ? row('workout', w.title, [`${weekdayOf(w.date)} ${fmtShort(w.date)}`, w.startsAt, w.location].filter(Boolean).join(' · ')) : null,
      b ? row(b.kind === 'video' ? 'video' : b.kind === 'group' ? 'group' : 'oneToOne', b.title || (b.kind === 'video' ? 'Video call' : '1:1'),
        [`${weekdayOf(londonParts(b.start).day)} ${fmtShort(londonParts(b.start).day)}`, fmtTime(b.start), b.location].filter(Boolean).join(' · ')) : null));
}

async function healthSection(box, ctx) {
  fill(box, sectionHead('Health'), loading());
  try {
    const w = await api('GET', `/api/health/week?${q({ clientId: ctx.id })}`);
    if (!ctx.view.fresh()) return;
    const days = w.days || [];
    const latest = k => [...days].reverse().find(d => d[k] !== null && d[k] !== undefined)?.[k] ?? null;
    const line = (label, key, fmt) => h('div', { class: 'ov-health-row' },
      h('div', { class: 'grow' }, h('div', { class: 'small muted' }, label), h('div', { class: 't-num' }, latest(key) === null ? '–' : fmt(latest(key)))),
      h('span', { class: 'tone-data' }, sparkline(days.map(d => d[key]), { label: `${label}, last 7 days` })));
    fill(box, sectionHead('Health', h('span', { class: 'small muted' }, 'Last 7 days')),
      card({ class: 'flush' }, line('Steps', 'steps', v => fmtN(v, 0)), line('Sleep', 'sleepMinutes', fmtHM), line('Resting HR', 'restingHr', v => `${fmtN(v, 0)} bpm`)));
  } catch (err) {
    if (ctx.view.fresh()) fill(box, sectionHead('Health'), errorLine(err));
  }
}

function rowsSection(ctx, detail, features, writeLetter) {
  const base = `/clients/${enc(ctx.id)}`;
  const row = (glyph, title, detailText, attrs) => {
    const inner = [h('span', { class: 'muted' }, icon(glyph, 20)), h('div', { class: 'grow' }, h('div', null, title), detailText ? h('div', { class: 'small muted' }, detailText) : null), h('span', { class: 'muted' }, icon('chevron', 18))];
    return attrs.href ? link(attrs.href, { class: 'ov-row' }, inner) : h('button', { class: 'ov-row', type: 'button', onclick: attrs.onclick }, inner);
  };
  const since = detail.client.since;
  const day = since ? daysBetween(since, todayLondon()) + 1 : null;
  return h('section', { class: 'ov-sec' }, sectionHead('Studio'),
    day !== null && day <= 7 ? h('p', { class: 'small muted' }, `Week 1 onboarding · day ${day} of 7`) : null,
    card({ class: 'flush' },
      has(features, 'programme') ? row('week', 'Plan', 'This week, write and publish', { href: `${base}/plan` }) : null,
      has(features, 'programme') ? row('programs', 'Assign programme', 'Lay one down from a start date', { onclick: () => ctx.assignProgram() }) : null,
      has(features, 'sessions') ? row('oneToOne', 'Sessions', 'Booked and past', { href: `${base}/sessions` }) : null,
      has(features, 'checkin') ? row('letter', 'Letters', 'Weekly and milestone', { href: `${base}/letters` }) : null,
      has(features, 'checkin') ? null : row('reply', 'Message', null, { href: `/messages/${enc(ctx.id)}` }),
      row('form', 'Send a form', null, { onclick: () => ctx.sendForm() }),
      row('checklist', 'Read answers', 'Forms and autoflows', { href: `${base}/forms` }),
      row('record', 'Progress', 'Weight, records and photos', { href: `${base}/progress` })));
}

const GOAL_WORD = { strength: 'Get stronger', muscle: 'Build muscle', fatloss: 'Lose fat', fitness: 'Get fitter', performance: 'Perform in my sport', mobility: 'Move better', health: 'Feel healthier' };
const EXPERIENCE = { new: 'New to training', some: 'Some experience', experienced: 'Experienced' };
const TIME = { morning: 'mornings', midday: 'middays', evening: 'evenings', varies: 'times vary' };

function aboutSection(profile, first) {
  if (!profile) return h('section', { class: 'ov-sec' }, sectionHead('About'), h('p', { class: 'small muted' }, `${first} hasn’t answered the first-run questions yet.`));
  const week = [profile.daysPerWeek ? `${profile.daysPerWeek} day${profile.daysPerWeek === 1 ? '' : 's'} a week` : null, TIME[profile.preferredTime] ?? null].filter(Boolean).join(', ');
  return h('section', { class: 'ov-sec' }, sectionHead('About'),
    card(null,
      profile.goals?.length ? h('div', null, profile.goals.map(g => GOAL_WORD[g] ?? g).join(' · ')) : null,
      h('div', { class: 'small muted' }, [EXPERIENCE[profile.experience], week].filter(Boolean).join(' · ') || 'No answers about training yet'),
      profile.injuries ? h('div', { class: 'small mt-s' }, h('span', { class: 'muted' }, 'To know: '), profile.injuries) : null));
}

