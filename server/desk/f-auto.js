/*
 * F15 Automations (WP5): /automations with three tabs (Automations, Recipes,
 * Sequences (legacy)), the nav item, + New, the palette, the "Start an
 * automation" bulk and client actions. The builder is f-auto-builder.js.
 */
import {
  api, busy, button, fill, go, h, icon, link, registerBulkAction, registerClientAction, registerCommand,
  registerNav, registerQuickCreate, route, setCrumbs, sparkline, toast,
} from './core.js';
import { ago, enc, miniFlow, plural, statusPill, triggerIcon } from './f-auto-common.js';
import { countUp, emptyHero, pageHead, skeleton, slideOver, tabs } from './ui.js';

registerNav({ id: 'automations', label: 'Automations', icon: 'bolt', group: 'engage', order: 30, path: '/automations' });
registerQuickCreate({ id: 'automation', label: 'Automation', icon: 'bolt', order: 85, run: () => newAutomation() });
registerCommand({ id: 'go-automations', label: 'Go to Automations', group: 'Jump to', icon: 'bolt', keys: 'g a', run: () => go('/automations') });
registerCommand({ id: 'new-automation', label: 'New automation', icon: 'bolt', run: () => newAutomation() });
registerBulkAction({ id: 'automation-start', label: 'Start automation', icon: 'bolt', scope: 'clients', run: ids => enrolSheet(ids) });
registerClientAction({ id: 'automation-start', label: 'Start an automation', icon: 'bolt', order: 70, run: c => enrolSheet([c.id]) });

// MARK: - New automation (blank or from a recipe)

export async function createFromRecipe(id) {
  const r = await api('POST', '/api/automations', { recipe: id });
  toast(`${r.automation.name} is ready as a draft`);
  go(`/automations/${enc(r.automation.id)}`);
}

const BLANKS = [
  { id: 'event', glyph: 'bolt', title: 'When something happens', line: 'A booking, a message, a check-in, a payment…', trigger: { type: 'event', event: 'booking.cancelled', where: {} } },
  { id: 'schedule', glyph: 'event_repeat', title: 'On a schedule', line: 'Every Monday at 08:00, for a segment or a tag.', trigger: { type: 'schedule', days: [1], at: '08:00', audience: { everyone: true } } },
  { id: 'enters', glyph: 'filter_alt', title: 'When someone starts to match', line: 'Quiet for 5 days, a month in, a package running low.', trigger: { type: 'enters', rules: { match: 'all', rules: [{ fact: 'core.daysQuiet', op: 'gte', value: 5 }] } } },
  { id: 'manual', glyph: 'person_add', title: 'When I add someone', line: 'A sequence you start by hand for chosen clients.', trigger: { type: 'manual' } },
];

export function newAutomation() {
  slideOver('New automation', (body, close) => {
    const name = h('input', { maxlength: '80', placeholder: 'Untitled automation', 'aria-label': 'Name', autofocus: true });
    let pick = 'event';
    const cards = h('div', { class: 'au-blank-grid', role: 'radiogroup', 'aria-label': 'Start with' });
    const draw = () => fill(cards, BLANKS.map(b => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(pick === b.id), class: 'au-blank' + (pick === b.id ? ' on' : ''),
      onclick: () => { pick = b.id; draw(); },
    }, h('span', { class: 'au-blank-icon' }, icon(b.glyph, 22)), h('b', null, b.title), h('span', { class: 'small muted' }, b.line))));
    draw();
    const status = h('div');
    const recipes = h('div', { class: 'au-new-recipes' }, skeleton('lines', { rows: 2 }));
    api('GET', '/api/automations/recipes').then(r => fill(recipes, r.recipes.filter(x => x.available).slice(0, 6).map(x => h('button', {
      type: 'button', class: 'au-new-recipe', onclick: e => busy(e.currentTarget, status, async () => { close(); await createFromRecipe(x.id); }),
    }, icon(x.icon, 18), h('span', { class: 'grow' }, x.name), icon('chevron_right', 16))))).catch(() => recipes.remove());
    body.append(
      h('div', { class: 'field' }, h('label', null, 'Name'), name),
      h('div', { class: 'field' }, h('label', null, 'Start with'), cards),
      h('div', { class: 'field' }, h('label', null, 'Or begin from a recipe'), recipes), status);
    const create = h('button', { type: 'button', class: 'btn primary', onclick: e => busy(e.currentTarget, status, async () => {
      const b = BLANKS.find(x => x.id === pick);
      const r = await api('POST', '/api/automations', { name: name.value.trim() || 'Untitled automation', trigger: b.trigger, steps: [] });
      close();
      go(`/automations/${enc(r.automation.id)}`);
    }) }, icon('add', 16), 'Create draft');
    name.addEventListener('keydown', e => { if (e.key === 'Enter') create.click(); });
    return h('div', { class: 'au-slide-foot' }, h('span', { class: 'small faint grow' }, 'Drafts never run. Turn it on when it reads right.'), button('Cancel', () => close()), create);
  }, { wide: true });
}

// MARK: - Start an automation for chosen clients (bulk and client actions)

export function enrolSheet(clientIds) {
  slideOver(clientIds.length === 1 ? 'Start an automation' : `Start an automation for ${clientIds.length} clients`, (body, close) => {
    const status = h('div');
    const list = h('div', { class: 'au-enrol-list' }, skeleton('lines', { rows: 3 }));
    body.append(h('p', { class: 'muted small' }, 'Automations that start by hand. Each person gets their own run; anyone already in it, or who fails its conditions, is skipped.'), list, status);
    api('GET', '/api/automations').then(r => {
      const manual = r.automations.filter(a => a.trigger.type === 'manual');
      if (!manual.length) {
        fill(list, emptyHero({ icon: 'bolt', title: 'No hand-started automations yet', line: 'Build one that starts “When I add someone”.', action: { label: 'New automation', onclick: () => { close(); newAutomation(); } } }));
        return;
      }
      fill(list, manual.map(a => h('div', { class: 'au-enrol-row' },
        h('span', { class: 'au-enrol-glyph' }, icon('bolt', 18)),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, a.name), h('div', { class: 'small muted clamp2' }, a.sentence)),
        a.status === 'live'
          ? h('button', { type: 'button', class: 'btn small primary', onclick: e => busy(e.currentTarget, status, async () => {
            const out = await api('POST', `/api/automations/${enc(a.id)}/enrol`, { clientIds });
            close();
            const why = out.skipped.length ? ` · ${out.skipped.length} skipped (${[...new Set(out.skipped.map(s => s.reason))].join(', ')})` : '';
            toast(`Started for ${plural(out.started, 'person', 'people')}${why}`, { action: { label: 'See runs', run: () => go(`/automations/${enc(a.id)}/runs`) } });
          }) }, 'Start')
          : h('span', { class: 'small faint' }, a.status === 'draft' ? 'Draft' : 'Paused'))));
    }).catch(err => fill(list, h('p', { class: 'error' }, err.message)));
  });
}

// MARK: - Cards

function automationCard(a, onToggle) {
  const live = a.status === 'live';
  const toggle = h('input', { type: 'checkbox', role: 'switch', checked: live, 'aria-label': `${a.name}: ${live ? 'on' : 'off'}`,
    onclick: e => e.stopPropagation(), onchange: e => onToggle(a, e.target.checked, e.target) });
  const s = a.stats ?? {};
  const max = Math.max(1, ...(s.daily ?? [0]));
  return h('article', { class: `au-card au-${a.status}` + (a.needs.length ? ' au-needs' : '') },
    h('div', { class: 'au-card-top' },
      h('span', { class: 'au-card-glyph' }, icon(triggerIcon(a.trigger), 20)),
      statusPill(a.status), a.aiDerived ? h('span', { class: 'au-chip au-chip-ai', title: 'Starts from an AI judgement: it can only tell you, tag or add tasks' }, icon('auto_awesome', 13), 'AI trigger') : null,
      h('span', { class: 'grow' }),
      h('label', { class: 'au-switch', title: live ? 'Turn off' : 'Turn on' }, toggle)),
    link(`/automations/${enc(a.id)}`, { class: 'au-card-main' },
      h('h3', { class: 'au-card-name' }, a.name),
      h('p', { class: 'au-card-when' }, a.triggerWords)),
    miniFlow(a),
    a.needs.length ? h('div', { class: 'au-card-needs' }, icon('hub', 14), `Needs ${a.needs.join(', ')}`) : null,
    h('div', { class: 'au-card-foot' },
      h('div', { class: 'au-card-stat' }, h('b', { class: 't-num' }, String(s.runs30 ?? 0)), h('span', null, 'runs · 30 days')),
      h('div', { class: 'au-card-bars', 'aria-hidden': 'true' }, (s.daily ?? []).map(n => h('span', { style: { '--h': `${Math.round((n / max) * 100)}%` }, class: n ? 'on' : '' }))),
      h('div', { class: 'au-card-meta' },
        s.active ? h('span', null, icon('hourglass_empty', 13), `${s.active} waiting`) : null,
        h('span', null, icon('timer', 13), ago(s.lastRunAt)),
        s.errors30 ? h('span', { class: 'tone-attention' }, icon('warning', 13), plural(s.errors30, 'error')) : null)));
}

function recipeCard(r, onUse) {
  return h('article', { class: 'au-recipe' + (r.available ? '' : ' off') },
    h('div', { class: 'au-recipe-top' }, h('span', { class: 'au-recipe-glyph' }, icon(r.icon, 22)),
      r.aiDerived ? h('span', { class: 'au-chip au-chip-ai' }, icon('auto_awesome', 13), 'Coach-only') : null),
    h('h3', { class: 'au-recipe-name' }, r.name),
    h('p', { class: 'au-recipe-line' }, r.description),
    miniFlow(r.automation, { max: 5 }),
    h('div', { class: 'au-recipe-foot' },
      r.available
        ? h('button', { type: 'button', class: 'btn small', onclick: e => onUse(r, e.currentTarget) }, icon('add', 16), 'Use recipe')
        : h('span', { class: 'au-recipe-needs' }, icon('lock', 14), `Needs ${r.needs.join(', ')}`)));
}

// MARK: - The screen

route('/automations', async (el, _p, view) => {
  setCrumbs([{ label: 'Engage' }, { label: 'Automations', path: '/automations' }]);
  if (view.query.get('new') === '1') queueMicrotask(newAutomation);
  const head = pageHead({
    eyebrow: 'Engage', title: 'Automations', accent: 'on your behalf',
    sub: 'When something happens, the right message, task or nudge follows. Every send is governed by your outreach rules.',
    actions: [h('button', { type: 'button', class: 'btn primary', onclick: () => newAutomation() }, icon('add', 18), 'New automation')],
  });
  const kpis = h('div', { class: 'au-kpis' }, [1, 2, 3, 4].map(() => h('div', { class: 'au-kpi' }, skeleton('lines', { rows: 2 }))));
  const box = h('div', { class: 'au-tabbody' });
  let tab = 'automations';
  const bar = tabs([{ id: 'automations', label: 'Automations' }, { id: 'recipes', label: 'Recipes' }, { id: 'sequences', label: 'Sequences (legacy)' }], tab, id => { tab = id; draw(); }, { sync: 'tab', label: 'Automation views' });
  tab = bar.value();
  fill(el, head, kpis, bar, box);

  let data = null;
  async function load() {
    const [list, recipes] = await Promise.all([api('GET', '/api/automations'), api('GET', '/api/automations/recipes')]);
    data = { list: list.automations, recipes: recipes.recipes };
  }

  function drawKpis() {
    const list = data.list;
    const n = (v, label, detail, tone) => {
      const num = h('b', { class: 'au-kpi-n t-num' }, '0');
      countUp(num, v);
      return h('div', { class: 'au-kpi' + (tone ? ` ${tone}` : '') }, h('div', { class: 'au-kpi-label' }, label), num, h('div', { class: 'au-kpi-detail' }, detail));
    };
    const live = list.filter(a => a.status === 'live');
    const runs = list.reduce((t, a) => t + (a.stats?.runs30 ?? 0), 0);
    const waiting = list.reduce((t, a) => t + (a.stats?.active ?? 0), 0);
    const errors = list.reduce((t, a) => t + (a.stats?.errors30 ?? 0), 0);
    const daily = Array.from({ length: 14 }, (_, i) => list.reduce((t, a) => t + (a.stats?.daily?.[i] ?? 0), 0));
    const spark = h('span', { class: 'au-kpi-spark' }, sparkline(daily, { width: 120, height: 30, label: 'Runs a day, last 14 days' }));
    fill(kpis,
      n(live.length, 'Live', `${plural(list.length - live.length, 'draft or paused', 'drafts or paused')}`, 'au-kpi-hero'),
      h('div', { class: 'au-kpi' }, h('div', { class: 'au-kpi-label' }, 'Runs · 30 days'), h('div', { class: 'au-kpi-row' }, (() => { const b = h('b', { class: 'au-kpi-n t-num' }, '0'); countUp(b, runs); return b; })(), spark), h('div', { class: 'au-kpi-detail' }, 'Every client a trigger started')),
      n(waiting, 'Waiting now', 'Runs paused on a wait step'),
      n(errors, 'Errors · 30 days', errors ? 'Open an automation to see why' : 'Nothing has gone wrong', errors ? 'au-kpi-warn' : ''));
  }

  async function toggle(a, on, input) {
    input.disabled = true;
    try {
      await api('POST', `/api/automations/${enc(a.id)}/status`, { status: on ? 'live' : 'paused' });
      toast(on ? `${a.name} is on` : `${a.name} is paused`, { undo: async () => { await api('POST', `/api/automations/${enc(a.id)}/status`, { status: on ? 'paused' : 'live' }); await reload(); } });
      await reload();
    } catch (err) {
      input.checked = !on;
      toast(err.message, { error: true, action: { label: 'Open it', run: () => go(`/automations/${enc(a.id)}`) } });
    } finally { input.disabled = false; }
  }

  async function useRecipe(r, btn) {
    btn.disabled = true;
    try { await createFromRecipe(r.id); } catch (err) { toast(err.message, { error: true }); btn.disabled = false; }
  }

  async function drawSequences() {
    fill(box, skeleton('table', { rows: 3 }));
    const flows = (await api('GET', '/api/autoflows')).autoflows;
    if (!view.fresh() || tab !== 'sequences') return;
    if (!flows.length) { fill(box, emptyHero({ icon: 'route', title: 'No sequences', line: 'Sequences were the first kind of automation, built in Programs. New ones are automations now.' })); return; }
    const converted = new Set(data.list.map(a => a.fromAutoflowId).filter(Boolean));
    fill(box, h('p', { class: 'au-legacy-note' }, icon('lightbulb', 16), 'Sequences keep running as they are. Convert one to get waits at a time of day, conditions, tasks and the full run log; then switch the old one off in Programs.'),
      h('div', { class: 'au-legacy' }, flows.map(f => h('article', { class: 'au-legacy-row' },
        h('span', { class: 'au-legacy-glyph' }, icon(f.trigger === 'join' ? 'person_add' : 'route', 20)),
        h('div', { class: 'grow' },
          h('div', { class: 'row' }, h('b', null, f.name), statusPill(f.active ? 'live' : 'paused'), h('span', { class: 'small faint' }, f.trigger === 'join' ? 'Starts when someone joins' : 'Started by hand')),
          h('ol', { class: 'au-legacy-steps' }, f.steps.map(s => h('li', null, h('span', { class: 'au-legacy-day' }, `Day ${s.day}`), s.label))),
          h('div', { class: 'small muted' }, `${plural(f.runs.filter(r => !r.stoppedAt).length, 'person', 'people')} in it`)),
        h('div', { class: 'au-legacy-actions' },
          link(`/programs/autoflows/${enc(f.id)}`, { class: 'btn small' }, icon('edit', 15), 'Edit in Programs'),
          converted.has(f.id)
            ? h('span', { class: 'small faint' }, icon('check', 14), 'Converted')
            : h('button', { type: 'button', class: 'btn small primary', onclick: e => busy(e.currentTarget, null, async () => {
              const r = await api('POST', `/api/automations/from-autoflow/${enc(f.id)}`);
              toast('Converted to a draft automation');
              go(`/automations/${enc(r.automation.id)}`);
            }) }, icon('bolt', 15), 'Convert to automation'))))));
  }

  function draw() {
    if (!data) return;
    if (tab === 'recipes') {
      const ready = data.recipes.filter(r => r.available), later = data.recipes.filter(r => !r.available);
      fill(box, h('p', { class: 'au-section-line' }, `${plural(ready.length, 'recipe')} ready to use. Each one makes a draft you can change before it runs.`),
        h('div', { class: 'au-recipes' }, ready.map(r => recipeCard(r, useRecipe))),
        later.length ? [h('h2', { class: 'au-section-title' }, 'Unlocked by other parts of the desk'), h('div', { class: 'au-recipes' }, later.map(r => recipeCard(r, useRecipe)))] : null);
      return;
    }
    if (tab === 'sequences') { drawSequences().catch(err => fill(box, h('p', { class: 'error' }, err.message))); return; }
    if (!data.list.length) {
      fill(box, emptyHero({ icon: 'bolt', title: 'Nothing on autopilot yet', line: 'Start from a recipe: a late-cancel follow-up, a welcome series or a quiet-client nudge.', action: { label: 'Browse recipes', onclick: () => { bar.setValue('recipes'); tab = 'recipes'; draw(); } } }));
      return;
    }
    const groups = [['live', 'On'], ['paused', 'Paused'], ['draft', 'Drafts']];
    fill(box, groups.map(([st, label]) => {
      const items = data.list.filter(a => a.status === st);
      if (!items.length) return null;
      return [h('h2', { class: 'au-section-title' }, label, h('span', { class: 'au-count t-num' }, String(items.length))), h('div', { class: 'au-grid' }, items.map(a => automationCard(a, toggle)))];
    }));
  }

  async function reload() {
    await load();
    if (!view.fresh()) return;
    drawKpis();
    draw();
  }
  fill(box, h('div', { class: 'au-grid' }, [1, 2, 3].map(() => skeleton('card', { rows: 4 }))));
  await reload();
});

