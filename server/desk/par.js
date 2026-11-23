/*
 * Plan · Act · Review on a client's Overview (docs/design/plan-act-review.md,
 * "API contract (coach, web desk)"): the season's aim and when it was planned,
 * three priorities with their status, the week's commitments with the
 * client's outcomes, next week's "Agreed in session", and the latest prep and
 * reflection, read-only. Everything from GET /api/coach/clients/:id/par.
 */
import { api, busy, button, card, errorLine, field, fill, fmtShort, fmtTime, fmtWeekday, h, londonParts, loading, pill, ring, sheet, toast } from './core.js';

const enc = encodeURIComponent;
const STATUSES = [['notyet', 'Not yet'], ['settling', 'Settling in'], ['building', 'Building'], ['strong', 'Strong']];
const OUTCOME = { kept: ['Kept', 'ok'], mostly: ['Mostly', 'data'], missed: ['Missed', 'attention'] };
const sharedWhen = iso => `${fmtWeekday(londonParts(iso).day)} ${fmtShort(londonParts(iso).day)}, ${fmtTime(iso)}`;

const head = (title, ...actions) => h('div', { class: 'spread par-head' }, h('div', { class: 'par-label' }, title), actions.length ? h('div', { class: 'row gap4' }, actions) : null);

/** Fills `box` with the section. `head` is the Overview's section heading builder. */
export async function parSection(box, ctx, sectionHead) {
  fill(box, sectionHead('Plan · Act · Review'), loading());
  let p;
  try {
    p = await api('GET', `/api/coach/clients/${enc(ctx.id)}/par`);
  } catch (err) {
    if (ctx.view.fresh()) fill(box, sectionHead('Plan · Act · Review'), errorLine(err));
    return;
  }
  if (!ctx.view.fresh()) return;
  draw(box, ctx, sectionHead, p);
}

function draw(box, ctx, sectionHead, p) {
  const redraw = next => { if (ctx.view.fresh()) draw(box, ctx, sectionHead, next); };
  const sessions = [p.planning ? `Planning ${p.planning.when}` : null, p.review ? `Review ${p.review.when}` : null].filter(Boolean).join(' · ');
  fill(box, sectionHead('Plan · Act · Review', sessions ? h('span', { class: 'small muted' }, sessions) : null),
    card({ class: 'par' },
      aimBlock(ctx, p, redraw),
      prioritiesBlock(ctx, p, redraw),
      commitmentsBlock(ctx, p, redraw),
      h('div', { class: 'par-block par-pair' }, prepBlock(ctx, p), reflectionBlock(ctx, p))));
}

// MARK: - Aim

function aimBlock(ctx, p, redraw) {
  const edit = button('Edit aim', async () => { const next = await aimSheet(ctx, p); if (next) redraw(next); }, { small: true, disabled: !p.goalId,
    title: p.goalId ? null : 'Set a goal first: the aim belongs to it' });
  const aim = p.aim || p.aimFallback;
  return h('div', { class: 'par-block' },
    head('Plan · This season', edit),
    aim ? h('div', { class: 't-quote par-aim' }, `“${aim}”`) : h('p', { class: 'muted m0' }, `No goal yet. ${ctx.first()} sees “Your direction is set together with JK at your first planning session.”`),
    h('div', { class: 'tiny faint' }, [
      p.aim ? null : aim ? 'From the goal title until you write the aim' : null,
      p.plannedOn ? `Planned together ${fmtShort(p.plannedOn)}` : 'No planning date set',
      p.season ? `${p.season.phaseWord}, ${Math.round(p.season.progress * 100)}% through` : null,
    ].filter(Boolean).join(' · ')));
}

function aimSheet(ctx, p) {
  return sheet('The season’s aim', (body, close) => {
    const aim = h('textarea', { class: 'serif-input', rows: '2', maxlength: '140', placeholder: 'Get strong enough that the hills stop mattering.' }, p.aim || '');
    const planned = h('input', { type: 'date', value: p.plannedOn || '' });
    const status = h('div');
    const save = button('Save', async () => {
      await busy(save, status, async () => {
        const next = await api('PUT', `/api/coach/clients/${enc(ctx.id)}/aim`, { aim: aim.value.trim() || null, plannedOn: planned.value || null });
        toast('Aim saved.');
        close(next);
      });
    }, { kind: 'primary' });
    fill(body,
      field('Aim', aim, `One sentence, 140 characters at most. ${ctx.first()} sees it at the top of Plan; empty uses the goal title.`),
      field('Planned together on', planned, 'The day of the planning session; the season line starts here.'),
      status);
    setTimeout(() => aim.focus(), 0);
    return h('div', { class: 'row end' }, button('Cancel', () => close(null)), save);
  });
}

// MARK: - Priorities

function prioritiesBlock(ctx, p, redraw) {
  const save = async list => api('PUT', `/api/coach/clients/${enc(ctx.id)}/priorities`, { priorities: list.map(x => ({ title: x.title, status: x.status })) });
  const edit = button('Edit', async () => { const next = await prioritiesSheet(ctx, p.priorities, save); if (next) redraw(next); }, { small: true });
  return h('div', { class: 'par-block' },
    head('What matters most', edit),
    p.priorities.length
      ? h('div', { class: 'par-prios' }, p.priorities.map((x, i) => {
        const select = h('select', {
          'aria-label': `Status of ${x.title}`,
          onchange: async e => {
            const list = p.priorities.map((y, j) => (j === i ? { ...y, status: e.target.value } : y));
            const next = await busy(null, null, () => save(list));
            if (next) redraw(next);
          },
        }, STATUSES.map(([v, l]) => h('option', { value: v, selected: v === x.status }, l)));
        return h('div', { class: 'par-prio' }, ring(x.progress * 100, { size: 28, stroke: 2, label: `${x.statusWord}` }),
          h('div', { class: 'grow' }, h('div', { class: 'par-prio-title' }, x.title)), select);
      }))
      : h('p', { class: 'small muted m0' }, 'No priorities yet. Up to three, set together at the planning session.'));
}

function prioritiesSheet(ctx, current, save) {
  return sheet('What matters most', (body, close) => {
    const rows = [0, 1, 2].map(i => ({
      title: h('input', { maxlength: '40', value: current[i]?.title ?? '', placeholder: ['Strength', 'Sleep', 'Joyful runs'][i], 'aria-label': `Priority ${i + 1}` }),
      status: h('select', { 'aria-label': `Status of priority ${i + 1}` }, STATUSES.map(([v, l]) => h('option', { value: v, selected: v === (current[i]?.status ?? 'notyet') }, l))),
    }));
    const status = h('div');
    const saveBtn = button('Save', async () => {
      await busy(saveBtn, status, async () => {
        const next = await save(rows.filter(r => r.title.value.trim()).map(r => ({ title: r.title.value.trim(), status: r.status.value })));
        toast('Priorities saved.');
        close(next);
      });
    }, { kind: 'primary' });
    fill(body,
      h('p', { class: 'muted m0' }, `Up to three. ${ctx.first()} sees each as a ring on Plan; leave a title empty to drop it.`),
      rows.map((r, i) => h('div', { class: 'par-edit-row' }, field(`Priority ${i + 1}`, r.title), field('Status', r.status))),
      status);
    return h('div', { class: 'row end' }, button('Cancel', () => close(null)), saveBtn);
  });
}

// MARK: - Commitments

function commitmentsBlock(ctx, p, redraw) {
  const { current, next, currentWeek, nextWeek } = p.commitments;
  const edit = button('Edit', async () => { const out = await commitmentsSheet(ctx, nextWeek, next); if (out) redraw(out); }, { small: true });
  const accepted = next.length && next.every(c => c.acceptedAt);
  return h('div', { class: 'par-block par-pair' },
    h('div', null,
      head(`What ${ctx.first()} said they’d do · week of ${fmtShort(currentWeek)}`),
      current.length
        ? h('div', { class: 'par-list' }, current.map(c => h('div', { class: 'spread par-item' }, h('span', null, c.text),
          c.outcome ? pill(...OUTCOME[c.outcome]) : h('span', { class: 'tiny faint' }, 'Not rated yet'))))
        : h('p', { class: 'small muted m0' }, 'Nothing agreed for this week.')),
    h('div', null,
      head(`Agreed in session · week of ${fmtShort(nextWeek)}`, edit),
      next.length
        ? h('div', { class: 'par-list' }, next.map((c, i) => h('div', { class: 'row par-item' }, h('span', { class: 'par-num' }, ['i', 'ii', 'iii'][i]), h('span', { class: 'grow' }, c.text))))
        : h('p', { class: 'small muted m0' }, 'Nothing agreed yet. Up to three, after the accountability session.'),
      next.length ? h('div', { class: 'tiny faint mt-s' }, accepted ? `${ctx.first()} is in` : `Waiting for ${ctx.first()}’s “I’m in”`) : null));
}

function commitmentsSheet(ctx, week, current) {
  return sheet('Agreed in session', (body, close) => {
    const inputs = [0, 1, 2].map(i => h('input', { maxlength: '120', value: current[i]?.text ?? '', placeholder: ['Walk after lunch, every weekday', 'Twenty minute run, any pace', ''][i], 'aria-label': `Commitment ${i + 1}` }));
    const status = h('div');
    const save = button('Save', async () => {
      await busy(save, status, async () => {
        const out = await api('PUT', `/api/coach/clients/${enc(ctx.id)}/commitments`, { week, items: inputs.map(x => x.value.trim()).filter(Boolean) });
        toast('Commitments saved.');
        close(out);
      });
    }, { kind: 'primary' });
    fill(body,
      h('p', { class: 'muted m0' }, `For the week of ${fmtShort(week)}. ${ctx.first()} accepts them with “I’m in” and rates them at the next look back. A changed one asks again.`),
      inputs.map((x, i) => field(['i', 'ii', 'iii'][i], x)),
      status);
    setTimeout(() => inputs[0].focus(), 0);
    return h('div', { class: 'row end' }, button('Cancel', () => close(null)), save);
  });
}

// MARK: - Prep and reflection (read-only)

const quote = (label, text) => (text ? h('div', { class: 'ov-quote' }, h('div', { class: 'small muted' }, label), h('div', null, text)) : null);

function prepBlock(ctx, p) {
  const x = p.prep;
  return h('div', null,
    head('Before planning'),
    x
      ? h('div', { class: 'par-read' },
        h('div', { class: 'tiny faint' }, x.sharedAt ? `Shared ${sharedWhen(x.sharedAt)}` : `Draft, not shared yet · last edit ${sharedWhen(x.updatedAt)}`),
        x.feelingWord ? h('div', null, h('span', { class: 'small muted' }, 'The month felt '), h('span', { class: 't-quote-s' }, x.feelingWord.toLowerCase())) : null,
        quote('What felt easier', x.easier), quote('What keeps getting in the way', x.inTheWay))
      : h('p', { class: 'small muted m0' }, `${ctx.first()} hasn’t started preparing yet.`));
}

function reflectionBlock(ctx, p) {
  const x = p.reflection;
  return h('div', null,
    head('Look back'),
    x
      ? h('div', { class: 'par-read' },
        h('div', { class: 'tiny faint' }, `Week of ${fmtShort(x.week)} · shared ${sharedWhen(x.sharedAt)}`),
        x.feelingWord ? h('div', null, h('span', { class: 'small muted' }, 'The week felt '), h('span', { class: 't-quote-s' }, x.feelingWord.toLowerCase())) : null,
        quote('One thing they noticed', x.noticed))
      : h('p', { class: 'small muted m0' }, `No look back from ${ctx.first()} yet.`));
}
