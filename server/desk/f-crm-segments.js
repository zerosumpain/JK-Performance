/*
 * WP2 Segments (docs/design/desk-v2.md F7): /segments lists saved segments
 * with live counts, plus starter suggestions; /segments/:id (or /segments/new)
 * edits one with the rule builder, a live member preview and pin-to-list.
 * Tags and segments are foundation endpoints (3.4).
 */
import { api, avatar, busy, button, confirmBox, errorLine, field, fill, go, h, icon, link, route, setCrumbs, toast } from './core.js';
import { avatarStack, emptyHero, pageHead, ruleBuilder, skeleton } from './ui.js';
import { allTags } from './f-crm.js';

const enc = encodeURIComponent;

/** Built-in starter segments (F7). `needs` lists facts that must exist for the starter to show. */
const STARTERS = [
  { key: 'quiet', name: 'Quiet 5+ days', icon: 'hourglass_empty', description: 'Anyone who has gone quiet for five days or more.', rules: { match: 'all', rules: [{ fact: 'core.daysQuiet', op: 'gte', value: 5 }] } },
  { key: 'top', name: 'Performance & Elite', icon: 'workspace_premium', description: 'Everyone on the two top plans.', rules: { match: 'all', rules: [{ fact: 'core.plan', op: 'in', value: ['performance', 'elite'] }] } },
  { key: 'atrisk', name: 'At risk', icon: 'warning', description: 'Clients the lifecycle rules have marked At risk.', rules: { match: 'all', rules: [{ fact: 'crm.stage', op: 'eq', value: 'atRisk' }] } },
  { key: 'new', name: 'New this month', icon: 'person_add', description: 'Joined in the last 30 days.', rules: { match: 'all', rules: [{ fact: 'core.daysSinceJoined', op: 'lte', value: 30 }] } },
  { key: 'nosession', name: 'No session booked', icon: 'event_busy', description: 'Nothing in the diary with you.', rules: { match: 'all', rules: [{ fact: 'core.nextSessionDays', op: 'isNotSet' }] } },
  { key: 'owes', name: 'Owes money', icon: 'receipt_long', needs: ['billing.balance'], description: 'A balance outstanding.', rules: { match: 'all', rules: [{ fact: 'billing.balance', op: 'gt', value: 0 }] } },
  { key: 'upgrade', name: 'Upgrade candidates', icon: 'trending_up', description: 'Foundation or Performance, adherence 80%+ and health 75+.', rules: { match: 'any', rules: [
    { match: 'all', rules: [{ fact: 'core.plan', op: 'eq', value: 'foundation' }, { fact: 'core.adherence28', op: 'gte', value: 80 }, { fact: 'crm.health', op: 'gte', value: 75 }] },
    { match: 'all', rules: [{ fact: 'core.plan', op: 'eq', value: 'performance' }, { fact: 'core.adherence28', op: 'gte', value: 80 }, { fact: 'crm.health', op: 'gte', value: 75 }] }] } },
  { key: 'stuck', name: 'Stuck in onboarding', icon: 'checklist', needs: ['onboarding.stuckDays'], description: 'No onboarding step ticked for five days.', rules: { match: 'all', rules: [{ fact: 'onboarding.stuckDays', op: 'gte', value: 5 }] } },
];

let factsCache = null;
const facts = () => (factsCache ??= api('GET', '/api/facts').then(r => r.facts.filter(f => f.id !== 'core.segments')).catch(err => { factsCache = null; throw err; }));
const factIds = rules => (rules?.rules ?? []).flatMap(r => (r.rules ? factIds(r) : [r.fact]));

/** A short sentence for a rules object, from the fact labels. */
function describe(rules, list) {
  const label = id => list.find(f => f.id === id)?.label ?? id;
  const OPS = { eq: 'is', ne: 'is not', gt: '>', gte: '≥', lt: '<', lte: '≤', in: 'is one of', notIn: 'is none of', has: 'has', hasNot: 'has no', isSet: 'is set', isNotSet: 'is not set', between: 'between' };
  const val = (r, f) => {
    if (['isSet', 'isNotSet'].includes(r.op)) return '';
    const opt = v => f?.options?.find(o => o.value === v)?.label ?? (typeof v === 'boolean' ? (v ? 'yes' : 'no') : f?.type === 'money' && typeof v === 'number' ? `£${(v / 100).toFixed(0)}` : String(v));
    return Array.isArray(r.value) ? r.value.map(opt).join(r.op === 'between' ? '–' : ', ') : opt(r.value);
  };
  const one = r => (r.rules ? `(${r.rules.map(one).join(r.match === 'any' ? ' or ' : ' and ')})` : `${label(r.fact)} ${OPS[r.op] ?? r.op} ${val(r, list.find(f => f.id === r.fact))}`.trim());
  return (rules.rules ?? []).map(one).join(rules.match === 'any' ? ' or ' : ' and ') || 'Everyone';
}

// MARK: - List

route('/segments', async (el, _params, view) => {
  setCrumbs([{ label: 'Clients', path: '/clients' }, { label: 'Segments', path: '/segments' }]);
  const box = h('div', { class: 'crm-sg-body' }, skeleton('card'));
  el.append(pageHead({ eyebrow: 'Clients', title: 'Segments', sub: 'Saved groups that keep themselves up to date. Use them in broadcasts, automations, campaigns and the clients list.',
    actions: [link('/segments/new', { class: 'btn primary' }, icon('add', 18), 'New segment')] }), box);
  let segments, list;
  try { [{ segments }, list] = await Promise.all([api('GET', '/api/segments'), facts()]); } catch (err) { if (view.fresh()) fill(box, errorLine(err)); return; }
  if (!view.fresh()) return;
  const have = new Set(list.map(f => f.id));
  const starters = STARTERS.filter(s => factIds(s.rules).every(id => have.has(id)) && !segments.some(x => x.name === s.name));
  const pin = async (s, on) => {
    await api('PUT', `/api/segments/${enc(s.id)}`, { name: s.name, description: s.description, rules: s.rules, pinned: on });
    toast(on ? `“${s.name}” is pinned to the clients list.` : 'Unpinned.');
    go('/segments', { replace: true });
  };
  fill(box,
    segments.length ? h('div', { class: 'crm-sg-grid' }, segments.map(s => h('article', { class: 'crm-sg-card' + (s.pinned ? ' pinned' : '') },
      h('div', { class: 'crm-sg-card-top' },
        h('div', { class: 'crm-sg-count' }, h('span', { class: 'crm-sg-count-n t-num' }, String(s.count)), h('span', { class: 'tiny muted' }, s.count === 1 ? 'client' : 'clients')),
        h('button', { type: 'button', class: 'ui-icon-btn' + (s.pinned ? ' tone-accent' : ''), 'aria-pressed': String(s.pinned), 'aria-label': s.pinned ? `Unpin ${s.name}` : `Pin ${s.name} to the clients list`,
          title: s.pinned ? 'Pinned to the clients list' : 'Pin to the clients list', onclick: () => pin(s, !s.pinned) }, icon('star', 18, { filled: s.pinned }))),
      link(`/segments/${enc(s.id)}`, { class: 'crm-sg-card-link' }, h('h2', { class: 'crm-sg-name' }, s.name)),
      s.description ? h('p', { class: 'small muted crm-sg-desc' }, s.description) : null,
      h('p', { class: 'tiny crm-sg-rules' }, icon('filter_alt', 14), describe(s.rules, list)),
      h('div', { class: 'crm-sg-card-foot' }, link(`/clients?segment=${enc(s.id)}`, { class: 'btn small' }, 'See them'), link(`/segments/${enc(s.id)}`, { class: 'btn small text' }, 'Edit')))))
      : emptyHero({ icon: 'filter_alt', title: 'No segments yet', line: 'Start from a suggestion below, or build your own with the rule builder.', action: { label: 'New segment', path: '/segments/new' } }),
    starters.length ? h('section', { class: 'crm-sg-starters' },
      h('div', { class: 'ui-eyebrow' }, 'Suggestions'),
      h('div', { class: 'crm-sg-starter-grid' }, starters.map(s => link(`/segments/new?starter=${s.key}`, { class: 'crm-sg-starter' },
        h('span', { class: 'crm-sg-starter-icon' }, icon(s.icon, 20)),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, s.name), h('div', { class: 'small muted' }, s.description)),
        icon('add', 18))))) : null);
});

// MARK: - Editor

route('/segments/:id', async (el, params, view) => {
  const isNew = params.id === 'new';
  setCrumbs([{ label: 'Clients', path: '/clients' }, { label: 'Segments', path: '/segments' }, { label: isNew ? 'New' : 'Edit' }]);
  const box = h('div', null, skeleton('card'));
  el.append(box);
  let list, tags, seg = null;
  try {
    [list, tags] = await Promise.all([facts(), allTags().catch(() => [])]);
    if (!isNew) {
      seg = (await api('GET', '/api/segments')).segments.find(s => s.id === params.id);
      if (!seg) { fill(box, emptyHero({ icon: 'filter_alt', title: 'That segment is gone', action: { label: 'All segments', path: '/segments' } })); return; }
    }
  } catch (err) { if (view.fresh()) fill(box, errorLine(err)); return; }
  if (!view.fresh()) return;
  const starter = isNew ? STARTERS.find(s => s.key === view.query.get('starter')) : null;
  const state = { name: seg?.name ?? starter?.name ?? '', description: seg?.description ?? starter?.description ?? '', rules: seg?.rules ?? starter?.rules ?? { match: 'all', rules: [] }, pinned: !!seg?.pinned };
  const name = h('input', { type: 'text', maxlength: '80', value: state.name, placeholder: 'Quiet Performance clients', oninput: e => { state.name = e.target.value; } });
  const desc = h('input', { type: 'text', maxlength: '500', value: state.description, placeholder: 'What this group is for (optional)', oninput: e => { state.description = e.target.value; } });
  const members = h('div', { class: 'crm-sg-members' });
  const countEl = h('div', { class: 'crm-sg-big t-num' }, '–');
  let seq = 0;
  const preview = async rules => {
    const mine = ++seq;
    try {
      const r = await api('POST', '/api/segments/preview', { rules });
      if (mine !== seq || !view.fresh()) return r.count;
      countEl.textContent = String(r.count);
      fill(members, r.clients.length ? [avatarStack(r.clients, { max: 7, size: 32 }), h('ul', { class: 'crm-sg-member-list' }, r.clients.slice(0, 12).map(c => h('li', null, link(`/clients/${enc(c.id)}`, { class: 'crm-sg-member' }, avatar(c.initials || c.name, 26), h('span', { class: 'clamp1' }, c.name))))),
        r.count > 12 ? h('p', { class: 'tiny muted' }, `and ${r.count - 12} more`) : null] : h('p', { class: 'small muted' }, 'Nobody matches yet.'));
      return r.count;
    } catch (err) {
      // A rule still being written (no value yet) is a 400: show a hint, not an error.
      if (mine === seq) fill(members, err.status === 400 ? h('p', { class: 'small muted' }, 'Finish the rule to see who matches.') : errorLine(err));
      if (mine === seq && err.status === 400) countEl.textContent = '–';
      throw err;
    }
  };
  const builder = ruleBuilder({ facts: list.map(f => ({ ...f, label: f.aiDerived ? `${f.label} (AI)` : f.label })), value: state.rules, tags, onChange: r => { state.rules = r; }, count: preview });
  const status = h('div');
  const pinBox = h('label', { class: 'crm-check' }, h('input', { type: 'checkbox', checked: state.pinned, onchange: e => { state.pinned = e.target.checked; } }), 'Pin to the clients list');
  const save = button(isNew ? 'Save segment' : 'Save changes', e => busy(e.currentTarget, status, async () => {
    if (!state.name.trim()) throw new Error('Give it a name.');
    const body = { name: state.name.trim(), description: state.description.trim(), rules: builder.value(), pinned: state.pinned };
    const out = isNew ? await api('POST', '/api/segments', body) : await api('PUT', `/api/segments/${enc(seg.id)}`, body);
    toast(`Saved “${out.segment.name}” · ${out.segment.count} ${out.segment.count === 1 ? 'client' : 'clients'}.`);
    go(`/segments`);
  }), { kind: 'primary' });
  const del = isNew ? null : button('Delete', async () => {
    if (!await confirmBox(`Delete “${seg.name}”?`, { ok: 'Delete', danger: true, detail: 'Broadcasts and automations that use it stop matching anyone.' })) return;
    await api('DELETE', `/api/segments/${enc(seg.id)}`);
    toast('Segment deleted.');
    go('/segments');
  }, { kind: 'danger' });
  fill(box,
    pageHead({ eyebrow: 'Segments', title: isNew ? 'New' : state.name, accent: isNew ? 'segment' : null, sub: 'Pick facts about your clients; the count and the people update as you go.' }),
    h('div', { class: 'crm-sg-editor' },
      h('section', { class: 'crm-sg-form' },
        field('Name', name), field('Description', desc),
        h('div', { class: 'ui-eyebrow crm-sg-rules-h' }, 'Who is in it'),
        builder.el,
        pinBox, status,
        h('div', { class: 'row gap4 crm-sg-actions' }, del, h('span', { class: 'grow' }), link('/segments', { class: 'btn' }, 'Cancel'), save)),
      h('aside', { class: 'crm-sg-preview', 'aria-label': 'Live preview' },
        h('div', { class: 'ui-eyebrow' }, 'Matches now'), countEl, members,
        h('p', { class: 'tiny muted' }, 'Broadcasts and automations re-check membership when they run, so the group stays current.'))));
});
