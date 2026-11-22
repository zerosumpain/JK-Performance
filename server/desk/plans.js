/*
 * Plans & prices (Business › Plans & prices): the coach sets each plan's
 * name, wording, prices, session credits and features for their own clients.
 * The iPhone and Android apps have the same editor (PlansEditorView); clients
 * see the result in the plan walkthrough and on the Membership screen.
 */
import {
  api, busy, button, card, chip, confirmBox, errorLine, eyebrow, field, fill, fmtMoney, h, icon, link, loading,
  plans, route, screenHeader, sheet, state, toast,
} from './core.js';

const FEATURE_ICON = {
  programme: 'dumbbell', messaging: 'bubble', habits: 'checklist', progress: 'chart', checkin: 'form',
  sessions: 'calendar', nutrition: 'fork', priority: 'bolt', guides: 'guides',
};
export const featureIcon = id => icon(FEATURE_ICON[id] || 'check', 18);

/** "Saves 15%" when the annual price beats twelve months. */
export function annualHint(monthly, annual) {
  if (!monthly || !annual) return '';
  const year = monthly * 12;
  const pct = Math.round((100 * (year - annual)) / year);
  return `12 × monthly is ${fmtMoney(year)}` + (pct > 0 ? ` · saves ${pct}%` : pct < 0 ? ` · costs ${-pct}% more` : '');
}

const pounds = pence => (pence / 100).toFixed(pence % 100 ? 2 : 0);
/** "59" or "59.50" → pence; NaN when it isn't a price. */
const toPence = text => {
  const t = String(text).trim().replace(/^£/, '').replace(/,/g, '');
  return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : NaN;
};

function planCard(p, members, onEdit) {
  const free = p.id === 'none';
  return card({ class: 'pl-card' + (p.featured ? ' featured' : '') },
    h('div', { class: 'spread' },
      h('div', null,
        h('div', { class: 'row gap4' }, h('span', { class: 'strong' }, p.name), p.featured ? h('span', { class: 'pl-badge' }, 'Most popular') : null),
        h('div', { class: 'small muted' }, p.detail)),
      h('div', { class: 'pl-price' },
        free ? h('div', { class: 'pl-amount' }, 'Free') : [
          h('div', null, h('span', { class: 'pl-amount' }, fmtMoney(p.monthlyPence)), h('span', { class: 'tiny faint' }, ' / month')),
          h('div', { class: 'tiny faint' }, `${fmtMoney(p.annualPence)} / year`)])),
    h('div', { class: 'pl-meta' },
      chip(`${p.features.length} feature${p.features.length === 1 ? '' : 's'}`),
      p.credits ? chip(`${p.credits} session${p.credits === 1 ? '' : 's'} a month`) : null,
      members === null || members === undefined ? null : chip(`${members} member${members === 1 ? '' : 's'}`),
      p.updatedAt ? h('span', { class: 'tiny faint' }, 'Changed by you') : h('span', { class: 'tiny faint' }, 'Default')),
    h('div', { class: 'row end' }, button(h('span', { class: 'row gap4' }, icon('pencil', 15), 'Edit'), () => onEdit(p), { small: true })));
}

/** What a client reads for this plan, drawn live from the form. */
function preview(p, features) {
  const free = p.id === 'none';
  const list = features.filter(f => p.features.includes(f.id));
  return h('div', { class: 'pl-preview' },
    h('div', { class: 'eyebrow m0' }, 'What clients see'),
    h('div', { class: 'row gap4' }, h('h3', { class: 'm0' }, p.name || '—'), p.featured && !free ? h('span', { class: 'pl-badge' }, 'Most popular') : null),
    free ? null : h('div', null,
      h('span', { class: 'pl-amount' }, Number.isNaN(p.monthlyPence) ? '—' : fmtMoney(p.monthlyPence)), h('span', { class: 'small faint' }, ' / month'),
      h('div', { class: 'tiny faint' }, Number.isNaN(p.annualPence) ? '' : `or ${fmtMoney(p.annualPence)} a year`)),
    h('p', { class: 'small muted' }, p.pitch),
    !free && p.credits ? h('div', { class: 'small' }, `${p.credits} session${p.credits === 1 ? '' : 's'} a month`) : null,
    h('div', { class: 'pl-feats' }, list.map(f => h('div', { class: 'pl-feat' }, h('span', { class: 'pl-ic' }, featureIcon(f.id)),
      h('div', null, h('div', { class: 'small strong' }, f.title), h('div', { class: 'tiny faint' }, f.detail))))));
}

function editPlan(p, features) {
  const free = p.id === 'none';
  return sheet(`Edit ${p.name}`, (body, close) => {
    const status = h('div');
    const input = (value, attrs = {}) => h('input', { value: value ?? '', ...attrs });
    const name = input(p.name, { maxlength: '30' });
    const detail = input(p.detail, { maxlength: '90' });
    const pitch = h('textarea', { maxlength: '400' }, p.pitch);
    const monthly = input(pounds(p.monthlyPence), { inputmode: 'decimal', 'aria-label': 'Monthly price in pounds' });
    const annual = input(pounds(p.annualPence), { inputmode: 'decimal', 'aria-label': 'Annual price in pounds' });
    const credits = input(String(p.credits), { type: 'number', min: '0', max: '31', step: '1' });
    const featured = h('input', { type: 'checkbox', checked: p.featured });
    const hint = h('div', { class: 'tiny faint' });
    const boxes = features.map(f => ({ f, box: h('input', { type: 'checkbox', checked: p.features.includes(f.id), 'aria-label': f.title }) }));
    const side = h('div');

    const current = () => ({
      ...p, name: name.value.trim(), detail: detail.value.trim(), pitch: pitch.value.trim(),
      monthlyPence: free ? 0 : toPence(monthly.value), annualPence: free ? 0 : toPence(annual.value),
      credits: free ? 0 : Number(credits.value), featured: !free && featured.checked,
      features: boxes.filter(b => b.box.checked).map(b => b.f.id),
    });
    const redraw = () => {
      const c = current();
      hint.textContent = free ? '' : annualHint(c.monthlyPence, c.annualPence);
      fill(side, preview(c, features));
    };
    for (const el of [name, detail, pitch, monthly, annual, credits, featured, ...boxes.map(b => b.box)]) el.addEventListener('input', redraw);
    redraw();

    body.append(h('div', { class: 'pl-edit' },
      h('div', null,
        field('Name', name),
        field('Tagline', detail, 'One line under the name, e.g. “Programme + app messaging”.'),
        field('Pitch', pitch, 'Who it’s for, in a sentence or two. Shown on the plan’s page in the walkthrough.'),
        free ? h('p', { class: 'small muted' }, 'The free plan is always free, with no session credits.') : [
          h('div', { class: 'grid2' }, field('Monthly (£)', monthly), field('Annual (£)', annual)),
          hint,
          field('Session credits a month', credits, '1:1 sessions a client on this plan can book each calendar month.'),
          h('label', { class: 'row gap4 pl-check' }, featured, 'Mark as “Most popular”'),
          h('p', { class: 'tiny faint' }, 'Clients see a new price straight away. Nobody is charged while payments are off; once App Store billing is on, change the price in App Store Connect too.'),
        ],
        eyebrow('Included'),
        h('div', { class: 'pl-boxes' }, boxes.map(({ f, box }) => h('label', { class: 'pl-box' }, box, h('span', { class: 'pl-ic' }, featureIcon(f.id)),
          h('span', null, h('div', { class: 'small strong' }, f.title), h('div', { class: 'tiny faint' }, f.detail))))),
        status),
      side));

    const save = button('Save', async () => {
      const c = current();
      if (!free && (Number.isNaN(c.monthlyPence) || Number.isNaN(c.annualPence))) { fill(status, errorLine('Prices are in pounds, like 59 or 59.50.')); return; }
      const out = await busy(save, status, () => api('PUT', `/api/coach/plans/${p.id}`, {
        name: c.name, detail: c.detail, pitch: c.pitch, features: c.features,
        ...(free ? {} : { monthlyPence: c.monthlyPence, annualPence: c.annualPence, credits: c.credits, featured: c.featured }),
      }));
      if (out) close(out);
    }, { kind: 'primary' });
    return h('div', { class: 'row end' }, button('Cancel', () => close()), save);
  }, { wide: true });
}

route('/business/plans', async (el, _params, view) => {
  const body = h('div');
  el.append(
    h('div', { class: 'cl-crumb' }, link('/business', { class: 'small muted' }, icon('back', 14), 'Business')),
    screenHeader('Business', 'Plans & prices'),
    h('p', { class: 'muted small' }, 'What each membership costs and includes. Your clients see these in the app, and new clients step through them in the plan walkthrough.'),
    body);

  const draw = async (force = false) => {
    fill(body, loading());
    try {
      const [{ plans: list, features }, biz] = await Promise.all([plans(force), api('GET', '/api/coach/business').catch(() => null)]);
      if (!view.fresh()) return;
      const members = id => (id === 'none' ? null : biz?.plans?.find(p => p.id === id)?.members ?? 0);
      const onEdit = async p => {
        const out = await editPlan(p, features);
        if (out) { state.plans = out; toast(`${out.plans.find(x => x.id === p.id).name} saved`); draw(); }
      };
      const reset = button('Reset to defaults', async () => {
        if (!(await confirmBox('Reset every plan to the defaults?', { ok: 'Reset', danger: true, detail: 'Names, wording, prices, credits and features all go back to how they started. Clients see the change straight away.' }))) return;
        const out = await busy(reset, null, () => api('POST', '/api/coach/plans/reset'));
        if (out) { state.plans = out; toast('Plans reset'); draw(); }
      }, { small: true });
      fill(body,
        h('div', { class: 'pl-list' }, list.map(p => planCard(p, members(p.id), onEdit))),
        h('div', { class: 'row end' }, reset));
    } catch (err) {
      if (view.fresh()) fill(body, errorLine(err), button('Try again', () => draw(true), { small: true }));
    }
  };
  await draw(true);
}, { nav: 'today' });
