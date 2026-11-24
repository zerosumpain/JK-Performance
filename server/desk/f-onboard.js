/*
 * WP2 onboarding checklist (docs/design/desk-v2.md F27): the Client 360
 * Overview card (progress ring, steps with ticks and their source, a nudge
 * about the next step, manual tick and untick), the Today widget
 * ("3 onboarding · 1 stuck") and Settings › Onboarding (the template).
 */
import {
  api, busy, button, confirmBox, errorLine, field, fill, firstName, fmtShort, h, icon, link, londonParts, registerSettingsSection, registerWidget, ring, toast,
} from './core.js';
import { emptyHero, skeleton } from './ui.js';
import { openMessage } from './f-crm.js';

const enc = encodeURIComponent;
const SOURCE = { auto: 'ticked itself', coach: 'ticked by you' };

/**
 * The Overview card for one client. Draws nothing (and returns false) when the
 * client has no checklist or it is complete, unless `always`.
 */
export async function onboardingCard(box, client, { always = false, onChange = null } = {}) {
  let data;
  try { data = await api('GET', `/api/coach/clients/${enc(client.id)}/onboarding`); } catch (err) { fill(box, errorLine(err)); return true; }
  const draw = () => {
    if (!data.started) {
      if (!always) { fill(box); return; }
      fill(box, h('div', { class: 'onb-empty' }, h('p', { class: 'muted m0' }, `${firstName(client.name)} joined before checklists, so they count as onboarded.`),
        button('Start onboarding', e => busy(e.currentTarget, null, async () => { data = await api('POST', `/api/coach/clients/${enc(client.id)}/onboarding`, { start: true }); draw(); onChange?.(); }), { small: true })));
      return;
    }
    const toggle = async (s, done) => {
      try { data = await api('POST', `/api/coach/clients/${enc(client.id)}/onboarding`, { step: s.key, done }); draw(); onChange?.(); } catch (err) { toast(err.message, { error: true }); }
    };
    fill(box,
      h('div', { class: 'onb-head' },
        h('div', { class: 'onb-ring' }, ring(data.pct, { size: 64, stroke: 5, label: `${data.pct}% onboarded` }), h('span', { class: 'onb-pct t-num' }, `${data.done}/${data.total}`)),
        h('div', { class: 'grow' },
          h('div', { class: 'onb-title' }, data.completedAt ? 'Onboarding complete' : data.stalled ? `Stuck for ${data.stuckDays} days` : `${data.total - data.done} to go`),
          h('div', { class: 'small muted' }, data.completedAt ? `Done ${fmtShort(londonParts(data.completedAt).day)}` : `Started ${fmtShort(londonParts(data.startedAt).day)}${data.stuckDays ? ` · last step ${data.stuckDays === 1 ? 'yesterday' : `${data.stuckDays} days ago`}` : ''}`)),
        data.nextStep ? h('button', { type: 'button', class: 'btn small' + (data.stalled ? ' primary' : ''), onclick: () => openMessage(client, { category: 'onboarding', title: `Nudge: ${data.nextStep.label.toLowerCase()}`, text: `Hi ${firstName(client.name)}, ${data.nextStep.nudge}` }) }, icon('send', 16), 'Nudge') : null),
      h('ol', { class: 'onb-steps' }, data.steps.map(s => h('li', { class: 'onb-step' + (s.done ? ' done' : '') + (data.nextStep?.key === s.key ? ' next' : '') },
        h('button', { type: 'button', class: 'onb-tick', role: 'checkbox', 'aria-checked': String(s.done), 'aria-label': `${s.label}: ${s.done ? 'done' : 'to do'}`,
          title: s.done ? 'Untick' : 'Tick by hand', onclick: async () => {
            if (s.done && !await confirmBox(`Untick “${s.label}”?`, { ok: 'Untick' })) return;
            toggle(s, !s.done);
          } }, s.done ? icon('check', 16) : null),
        h('div', { class: 'grow' }, h('div', { class: 'onb-label' }, s.label),
          s.done ? h('div', { class: 'tiny muted' }, `${SOURCE[s.by] ?? 'done'} · ${fmtShort(londonParts(s.doneAt).day)}`) : data.nextStep?.key === s.key ? h('div', { class: 'tiny tone-accent' }, 'Next up') : null)))));
  };
  draw();
  return data.started && (!data.completedAt || always);
}

registerWidget({ id: 'onboarding', title: 'Onboarding', size: 's', order: 44, async render(body, view) {
  fill(body, skeleton('lines', { rows: 2 }));
  try {
    const { clients } = await api('GET', '/api/onboarding');
    if (view && !view.fresh?.()) return;
    const stuck = clients.filter(c => c.stalled).length;
    fill(body,
      h('div', { class: 'onb-w' }, h('span', { class: 'ui-tile-num' }, String(clients.length)), h('span', { class: 'small muted' }, `onboarding${stuck ? ` · ${stuck} stuck` : ''}`)),
      clients.length ? h('ul', { class: 'onb-w-list' }, clients.slice(0, 3).map(c => h('li', null, link(`/clients/${enc(c.client.id)}`, { class: 'onb-w-row' },
        h('span', { class: 'clamp1 grow' }, c.client.name), h('span', { class: `tiny t-num ${c.stalled ? 'tone-attention' : 'muted'}` }, `${c.done}/${c.total}`))))) : h('p', { class: 'small muted' }, 'Everyone is onboarded.'),
      link('/clients?stage=onboarding', { class: 'ui-tile-action' }, 'See them', icon('chevron_right', 16)));
  } catch (err) { fill(body, errorLine(err)); }
} });

// MARK: - Settings › Onboarding (the template)

const KIND_LABEL = { event: 'Ticks itself on an event', fact: 'Ticks itself when true', manual: 'You tick it' };

registerSettingsSection({ id: 'onboarding', label: 'Onboarding', icon: 'checklist', order: 45, async render(box) {
  box.append(skeleton('card'));
  let t, forms;
  try {
    [t, forms] = await Promise.all([api('GET', '/api/onboarding/template').then(r => r.template), api('GET', '/api/forms').then(r => r.forms).catch(() => [])]);
  } catch (err) { fill(box, errorLine(err)); return; }
  let steps = t.steps.map(s => ({ ...s }));
  let stallDays = t.stallDays;
  const listBox = h('ol', { class: 'onb-edit' });
  const status = h('div');
  const stall = h('input', { type: 'number', min: '1', max: '60', value: String(stallDays), class: 'onb-stall', oninput: e => { stallDays = Number(e.target.value) || 5; } });
  const draw = () => {
    fill(listBox, steps.map((s, i) => h('li', { class: 'onb-edit-row' + (s.hidden ? ' hidden-step' : '') },
      h('div', { class: 'onb-edit-move' },
        h('button', { type: 'button', class: 'ui-icon-btn small', 'aria-label': `Move ${s.label} up`, disabled: i === 0, onclick: () => { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; draw(); } }, icon('arrow_upward', 16)),
        h('button', { type: 'button', class: 'ui-icon-btn small', 'aria-label': `Move ${s.label} down`, disabled: i === steps.length - 1, onclick: () => { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; draw(); } }, icon('arrow_downward', 16))),
      h('div', { class: 'grow' },
        h('input', { type: 'text', class: 'onb-edit-label', maxlength: '80', value: s.label, 'aria-label': 'Step label', oninput: e => { s.label = e.target.value; } }),
        h('div', { class: 'tiny muted' }, KIND_LABEL[s.kind], s.kind === 'event' ? ` · ${s.event}` : s.kind === 'fact' ? ` · ${s.fact}` : '', s.hidden ? ' · hidden here (that feature is off)' : ''),
        s.kind === 'event' && s.event === 'form.submitted' ? h('select', { class: 'onb-edit-ref', 'aria-label': `Form for ${s.label}`, onchange: e => { s.ref = e.target.value || null; } },
          h('option', { value: '', selected: !s.ref }, 'Any form with a matching name'),
          forms.map(f => h('option', { value: f.id, selected: s.ref === f.id }, f.name))) : null),
      h('button', { type: 'button', class: 'ui-icon-btn small', 'aria-label': `Remove ${s.label}`, disabled: steps.length <= 1, onclick: () => { steps.splice(i, 1); draw(); } }, icon('close', 16)))));
  };
  const addManual = button('Add a step you tick', () => {
    if (steps.length >= 12) { toast('Twelve steps at most.', { error: true }); return; }
    let n = 1;
    while (steps.some(s => s.key === `custom${n}`)) n++;
    steps.push({ key: `custom${n}`, label: 'New step', kind: 'manual' });
    draw();
  }, { small: true });
  const save = button('Save template', e => busy(e.currentTarget, status, async () => {
    const out = await api('PUT', '/api/onboarding/template', { steps: steps.map(({ hidden: _h, ...s }) => s), stallDays });
    steps = out.template.steps.map(s => ({ ...s }));
    draw();
    toast('Onboarding template saved.');
  }), { kind: 'primary' });
  fill(box,
    h('h2', { class: 'crm-set-h' }, 'Onboarding'),
    h('p', { class: 'muted' }, 'The path every new client walks. Steps tick themselves as things happen; you can tick or untick any by hand. A checklist starts when someone joins, or from their page.'),
    listBox,
    h('div', { class: 'row gap4 onb-edit-foot' }, addManual, h('span', { class: 'grow' }), field('Stalled after (days)', stall)),
    status, h('div', { class: 'row end' }, save));
  draw();
  if (!steps.length) listBox.replaceWith(emptyHero({ icon: 'checklist', title: 'No steps', line: 'Add a step to start.' }));
} });
