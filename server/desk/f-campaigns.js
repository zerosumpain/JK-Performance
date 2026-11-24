/*
 * F13 Bespoke campaigns (docs/design/desk-v2.md, WP4): /campaigns, a gallery
 * of campaign cards, and /campaigns/:id/:tab (Design, Kit & spend, Enrol,
 * Board, Settings). Also registers the nav item, the Client 360 "Campaigns"
 * tab, the "Invite to a campaign" client and bulk actions, the campaigns-live
 * Today widget, the + New entry and palette commands.
 */
import {
  api, busy, button, confirmBox, fill, fmtDay, go, h, icon, link, live, registerBulkAction, registerClientAction, registerClientTab, registerCommand,
  registerNav, registerQuickCreate, registerWidget, ring, route, setCrumbs, toast,
} from './core.js';
import { renderBoard, renderEnrol } from './f-campaigns-board.js';
import { datesLine, enc, enrolPill, kindBadge, money, plural, statusPill, todayIndex, weeksWord } from './f-campaigns-common.js';
import { renderDesign, renderKit, renderSettings } from './f-campaigns-design.js';
import { avatarStack, emptyHero, menu, pageHead, segmentedNav, skeleton, slideOver, tabs } from './ui.js';

// MARK: - Gallery

const TEMPLATES = [
  { id: 'blank', title: 'Blank', glyph: 'edit_note', line: 'Four weeks, one phase. Build it your way.' },
  { id: 'challenge6', title: '6-week challenge', glyph: 'local_fire_department', line: 'Three phases, three sessions a week, measurements at both ends.' },
  { id: 'event12', title: '12-week event build', glyph: 'sports_score', line: 'Base, build, peak and taper, with a long run that grows and a kit list.' },
  { id: 'reset30', title: '30-day habit reset', glyph: 'self_improvement', line: 'A daily habit, a weekly check-in, rolling starts.' },
];

/** The new-campaign wizard: a template, a name, then the design. */
export function newCampaign() {
  let template = 'event12';
  slideOver('New campaign', (body, close) => {
    const name = h('input', { value: '', maxlength: '80', placeholder: 'Spring Marathon Build', 'aria-label': 'Name', autofocus: true });
    const tagline = h('input', { value: '', maxlength: '140', placeholder: 'From 10 km to race day (optional)', 'aria-label': 'Tagline' });
    const cards = h('div', { class: 'cg-templates', role: 'radiogroup', 'aria-label': 'Start from' });
    const draw = () => fill(cards, TEMPLATES.map(t => h('button', { type: 'button', role: 'radio', 'aria-checked': String(template === t.id), class: 'cg-template' + (template === t.id ? ' on' : ''),
      onclick: () => { template = t.id; draw(); if (!name.value) name.placeholder = t.id === 'blank' ? 'My campaign' : t.title; } },
    h('span', { class: 'cg-template-icon' }, icon(t.glyph, 22)), h('b', null, t.title), h('span', { class: 'small muted' }, t.line), template === t.id ? h('span', { class: 'cg-template-tick' }, icon('check_circle', 18, { filled: true })) : null)));
    draw();
    const status = h('div');
    body.append(h('div', { class: 'field' }, h('label', null, 'Start from'), cards),
      h('div', { class: 'field' }, h('label', null, 'Name'), name), h('div', { class: 'field' }, h('label', null, 'Tagline'), tagline), status);
    const create = h('button', { type: 'button', class: 'btn primary', onclick: e => busy(e.currentTarget, status, async () => {
      const r = await api('POST', '/api/campaigns', { name: name.value.trim() || name.placeholder, tagline: tagline.value.trim(), template });
      close();
      go(`/campaigns/${enc(r.campaign.id)}/design`);
    }) }, icon('rocket_launch', 16), 'Create draft');
    name.addEventListener('keydown', e => { if (e.key === 'Enter') create.click(); });
    return h('div', { class: 'cg-slide-foot' }, h('span', { class: 'small faint grow' }, 'Drafts are private. Nothing is sent until you invite.'), button('Cancel', () => close()), create);
  }, { wide: true });
}

function campaignCard(c) {
  const ti = c.status === 'live' ? todayIndex(c) : null;
  const elapsed = c.status === 'ended' ? 100 : ti === null ? 0 : ((ti + 1) / c.lengthDays) * 100;
  const tone = { live: 'c-chart-1', draft: 'c-chart-2', ended: 'c-chart-3', archived: 'c-chart-6' }[c.status];
  return link(`/campaigns/${enc(c.id)}/${c.status === 'draft' ? 'design' : 'board'}`, { class: `cg-tile ${tone}` },
    h('div', { class: 'cg-cover' },
      h('div', { class: 'cg-cover-top' }, statusPill(c.status), ti !== null ? h('span', { class: 'cg-daychip' }, `Day ${ti + 1} of ${c.lengthDays}`) : c.public ? h('span', { class: 'cg-daychip' }, icon('storefront', 13), 'Public') : null),
      h('div', { class: 'cg-cover-name' }, c.name),
      c.tagline ? h('div', { class: 'cg-cover-tag' }, c.tagline) : null,
      h('div', { class: 'cg-elapsed', 'aria-hidden': 'true' }, h('span', { style: { '--w': `${elapsed}%` } }))),
    h('div', { class: 'cg-tile-body' },
      h('div', { class: 'cg-tile-dates' }, icon('calendar_month', 15), datesLine(c)),
      h('div', { class: 'cg-tile-mid' },
        h('div', { class: 'cg-tile-people' },
          c.people.length ? avatarStack(c.people, { max: 4, size: 28 }) : h('span', { class: 'cg-nobody' }, icon('group', 16)),
          h('div', null, h('b', null, c.capacity ? `${c.enrolled} of ${c.capacity} places` : plural(c.enrolled, 'person', 'people')),
            h('div', { class: 'small muted' }, [c.invited ? `${c.invited} invited` : null, c.behind ? `${c.behind} behind` : null].filter(Boolean).join(' · ') || (c.status === 'draft' ? 'Not live yet' : 'No open invitations')))),
        h('div', { class: 'cg-tile-ring' }, ring(c.avgProgress, { size: 52, stroke: 4, label: `Average progress ${c.avgProgress}%` }), h('span', null, `${c.avgProgress}%`))),
      h('div', { class: 'cg-tile-foot' },
        h('span', null, icon('shopping_bag', 14), `Spend ${money(c.expectedSpendPence)}`),
        h('span', null, icon('payments', 14), c.feePence ? `Fee ${money(c.feePence)}` : 'No fee'),
        h('span', null, icon('checklist', 14), plural(c.activityCount, 'activity', 'activities')))));
}

route('/campaigns', async (el, _p, view) => {
  setCrumbs([{ label: 'Engage' }, { label: 'Campaigns', path: '/campaigns' }]);
  const newBtn = h('button', { type: 'button', class: 'btn primary', onclick: newCampaign }, icon('add', 18), 'New campaign');
  const kpis = h('div', { class: 'cg-kpis cg-kpis-top' });
  const grid = h('div', { class: 'cg-gallery' }, [1, 2, 3].map(() => skeleton('card', { rows: 4 })));
  let filter = 'all';
  const bar = h('div', { class: 'cg-filterbar' });
  el.append(pageHead({ eyebrow: 'Engage', title: 'Bespoke', accent: 'campaigns', sub: 'Time-bound programmes with phases, guides, kit and a live board.', actions: [newBtn] }),
    kpis, bar, grid);
  const [mainList, archived] = await Promise.all([api('GET', '/api/campaigns'), api('GET', '/api/campaigns?status=archived')]);
  if (!view.fresh()) return;
  const all = [...mainList.campaigns, ...archived.campaigns];
  const live = all.filter(c => c.status === 'live');
  const enrolled = live.reduce((s, c) => s + c.enrolled, 0);
  const avg = live.length ? Math.round(live.reduce((s, c) => s + c.avgProgress * c.enrolled, 0) / Math.max(1, enrolled)) : 0;
  const behind = live.reduce((s, c) => s + c.behind, 0);
  const kpi = (k, v, sub, extra = '') => h('div', { class: `cg-kpi ${extra}` }, h('div', { class: 'ui-eyebrow' }, k), h('div', { class: 'cg-kpi-v' }, v), h('div', { class: 'small muted' }, sub));
  fill(kpis,
    kpi('Live now', String(live.length), live.length ? live.map(c => c.name).slice(0, 2).join(' · ') : 'None running', 'hero'),
    kpi('People in', String(enrolled), plural(live.reduce((s, c) => s + c.invited, 0), 'invitation') + ' open'),
    kpi('Average progress', `${avg}%`, 'Across live campaigns'),
    kpi('Behind pace', String(behind), behind ? 'Nudge them from the board' : 'Everyone on pace', behind ? 'warn' : ''));
  const counts = s => all.filter(c => (s === 'all' ? c.status !== 'archived' : c.status === s)).length;
  const draw = () => {
    fill(bar, segmentedNav([['all', `All ${counts('all')}`], ['live', `Live ${counts('live')}`], ['draft', `Drafts ${counts('draft')}`], ['ended', `Ended ${counts('ended')}`], ['archived', `Archived ${counts('archived')}`]], filter, v => { filter = v; draw(); }, { label: 'Show' }));
    const shown = all.filter(c => (filter === 'all' ? c.status !== 'archived' : c.status === filter));
    if (!all.length) fill(grid, h('div', { class: 'cg-span' }, emptyHero({ icon: 'rocket_launch', title: 'Your first campaign', line: 'A 12-week marathon build, a January reset, six weeks of ski-fit: time-bound, guided, with a live board.', action: { label: 'New campaign', onclick: newCampaign } })));
    else fill(grid, shown.length ? shown.map(campaignCard) : h('p', { class: 'muted cg-span' }, 'Nothing here.'),
      filter === 'all' || filter === 'draft' ? h('button', { type: 'button', class: 'cg-tile cg-tile-new', onclick: newCampaign }, h('span', { class: 'cg-new-icon' }, icon('add', 26)), h('b', null, 'New campaign'), h('span', { class: 'small muted' }, 'Start from a template')) : null);
  };
  draw();
});

// MARK: - One campaign

const drafts = new Map(); // id -> {doc, dirty}: unsaved edits survive switching tabs
const TABS = [{ id: 'design', label: 'Design' }, { id: 'kit', label: 'Kit & spend' }, { id: 'enrol', label: 'Enrol' }, { id: 'board', label: 'Board' }, { id: 'settings', label: 'Settings' }];

route('/campaigns/:id/:tab?', async (el, params, view) => {
  const id = params.id;
  el.append(skeleton('card', { rows: 6 }));
  let state = drafts.get(id);
  try {
    if (!state || !state.dirty) state = { doc: await api('GET', `/api/campaigns/${enc(id)}`), dirty: false };
  } catch (err) {
    if (!view.fresh()) return;
    fill(el, emptyHero({ icon: 'rocket_launch', title: 'Campaign not found', line: err.message, action: { label: 'All campaigns', path: '/campaigns' } }));
    return;
  }
  if (!view.fresh()) return;
  drafts.set(id, state);
  const c0 = state.doc.campaign;
  const tab = TABS.some(t => t.id === params.tab) ? params.tab : c0.status === 'draft' ? 'design' : 'board';
  setCrumbs([{ label: 'Campaigns', path: '/campaigns' }, { label: c0.name, path: `/campaigns/${enc(id)}` }]);

  let guidesP = null, programsP = null;
  const guideList = [];
  const head = h('div');
  const body = h('div', { class: 'cg-tabbody' });
  const savebar = h('div', { class: 'cg-savebar', role: 'region', 'aria-label': 'Unsaved changes', hidden: !state.dirty });
  const ctx = {
    id, view,
    get doc() { return state.doc; },
    guides: () => (guidesP ??= api('GET', '/api/guidebook').then(r => { guideList.splice(0, guideList.length, ...r.guides); return r.guides; }).catch(() => [])),
    guideTitle: gid => guideList.find(g => g.id === gid)?.title ?? 'Guide',
    programs: () => (programsP ??= api('GET', '/api/programs').then(r => r.programs ?? []).catch(() => [])),
    markDirty() { state.dirty = true; savebar.hidden = false; },
    discard() { drafts.delete(id); },
    redraw: () => drawTab(),
    async setStatus(s) {
      if (state.dirty) await save();
      try {
        const r = await api('POST', `/api/campaigns/${enc(id)}/status`, { status: s });
        state.doc.campaign = { ...state.doc.campaign, ...r.campaign };
        toast({ live: 'Live. Invite people from the Enrol tab.', ended: 'Ended: no more nudges.', archived: 'Archived.', draft: 'Back to draft.' }[s]);
        if (s === 'archived') { drafts.delete(id); go('/campaigns'); return; }
        drawHead(); drawTab();
      } catch (err) { toast(err.message, { error: true }); }
    },
  };
  ctx.guides().then(() => { if (tab === 'design' && view.fresh()) drawTab(); });

  /** The design document as the server wants it: no UI-only keys. */
  const payload = () => {
    const d = state.doc;
    return {
      campaign: { ...d.campaign },
      phases: d.phases.map(p => ({ id: p.id, key: p.key, name: p.name, startDay: p.startDay, endDay: p.endDay, color: p.color, guideId: p.guideId, summary: p.summary })),
      activities: d.activities.map(a => ({ id: a.id, phaseId: a.phaseId, day: a.day, title: a.title, kind: a.kind, detail: a.detail, guideId: a.guideId, blocks: a.blocks, linkRef: a.linkRef, points: a.points, required: a.required, spendPence: a.spendPence })),
      kit: d.kit.map(k => ({ id: k.id, key: k.key, name: k.name, estPence: k.estPence, required: k.required, url: k.url || null, note: k.note })),
    };
  };
  const saveBtn = h('button', { type: 'button', class: 'btn primary' }, icon('check', 16), 'Save changes');
  async function save() {
    saveBtn.disabled = true;
    try {
      const d = state.doc.campaign;
      const out = await api('PUT', `/api/campaigns/${enc(id)}`, { ...payload(), campaign: { name: d.name, tagline: d.tagline, description: d.description, startMode: d.startMode, startsOn: d.startsOn,
        lengthDays: d.lengthDays, feePence: d.feePence, capacity: d.capacity, waitlist: d.waitlist, public: d.public, challengeId: d.challengeId, settings: d.settings, welcomeText: d.welcomeText, completionText: d.completionText } });
      state.doc = out;
      state.dirty = false;
      savebar.hidden = true;
      toast('Saved.');
      drawHead(); drawTab();
      return true;
    } catch (err) { toast(err.message, { error: true }); return false; } finally { saveBtn.disabled = false; }
  }
  saveBtn.addEventListener('click', save);
  fill(savebar, h('span', { class: 'cg-savebar-dot', 'aria-hidden': 'true' }), h('span', { class: 'grow' }, h('b', null, 'Unsaved changes'), h('span', { class: 'small muted' }, ' · ⌘S saves')),
    h('button', { type: 'button', class: 'btn text', onclick: async () => {
      if (!await confirmBox('Discard your changes?', { ok: 'Discard', danger: true })) return;
      drafts.delete(id); go(`/campaigns/${enc(id)}/${tab}`, { replace: true });
    } }, 'Discard'), saveBtn);
  const onKey = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (state.dirty) save(); } };
  document.addEventListener('keydown', onKey);
  view.onLeave(() => document.removeEventListener('keydown', onKey));
  const offLive = live.on('*', ev => { if (tab === 'board' && /^campaign\./.test(ev.type) && view.fresh() && !body.querySelector(':focus')) { clearTimeout(ctx.liveTimer); ctx.liveTimer = setTimeout(drawTab, 800); } });
  view.onLeave(() => offLive?.());

  function drawHead() {
    const c = state.doc.campaign;
    const ti = c.status === 'live' ? todayIndex(c) : null;
    const primary = c.status === 'draft' ? h('button', { type: 'button', class: 'btn primary', onclick: () => ctx.setStatus('live') }, icon('play_arrow', 18), 'Go live')
      : c.status === 'live' ? link(`/campaigns/${enc(id)}/enrol`, { class: 'btn primary' }, icon('person_add', 18), 'Invite people')
        : h('button', { type: 'button', class: 'btn', onclick: () => ctx.setStatus('live') }, icon('play_arrow', 18), 'Reopen');
    const more = h('button', { type: 'button', class: 'ui-icon-btn', 'aria-label': 'More campaign actions', onclick: () => menu(more, [
      { label: 'Duplicate', icon: 'content_copy', onclick: async () => { const r = await api('POST', `/api/campaigns/${enc(id)}/duplicate`); toast('Duplicated as a draft.'); go(`/campaigns/${enc(r.campaign.id)}/design`); } },
      c.status === 'live' ? { label: 'End campaign', icon: 'sports_score', detail: 'Stops the daily nudges', onclick: async () => { if (await confirmBox(`End ${c.name}?`, { ok: 'End it', detail: 'Nudges stop. People can still read their plan and you keep the board.' })) ctx.setStatus('ended'); } } : null,
      c.status === 'live' ? { label: 'Back to draft', icon: 'edit_note', onclick: () => ctx.setStatus('draft') } : null,
      { label: 'Archive', icon: 'archive', onclick: () => ctx.setStatus('archived') },
    ].filter(Boolean)) }, icon('more_horiz', 20));
    fill(head,
      h('div', { class: 'cg-hero' },
        h('div', { class: 'cg-hero-text' },
          h('div', { class: 'cg-hero-meta' }, statusPill(c.status), h('span', null, icon('calendar_month', 14), datesLine(c)), c.feePence ? h('span', null, icon('payments', 14), `Fee ${money(c.feePence)}`) : null,
            c.capacity ? h('span', null, icon('group', 14), `${c.capacity} places`) : null, c.public ? h('span', null, icon('storefront', 14), 'Public offer') : null),
          h('h1', { class: 'ui-display' }, c.name),
          c.tagline ? h('p', { class: 'ui-head-sub' }, c.tagline) : null),
        h('div', { class: 'cg-hero-side' },
          ti !== null ? h('div', { class: 'cg-hero-day' }, h('span', { class: 'ui-eyebrow' }, 'Today'), h('b', null, `Day ${ti + 1}`), h('span', { class: 'small muted' }, `of ${c.lengthDays} · ${fmtDay(new Date().toISOString().slice(0, 10))}`)) : null,
          h('div', { class: 'ui-head-actions' }, primary, more))),
      tabs(TABS, tab, t => go(`/campaigns/${enc(id)}/${t}`, { replace: true }), { label: 'Campaign sections' }));
  }
  async function drawTab() {
    body.replaceChildren();
    const render = { design: renderDesign, kit: renderKit, enrol: renderEnrol, board: renderBoard, settings: renderSettings }[tab];
    try { await render(body, ctx); } catch (err) { console.warn(err); fill(body, h('p', { class: 'error' }, err.message)); }
  }
  fill(el, head, body, savebar);
  drawHead();
  drawTab();
});

// MARK: - Picking a campaign for people (client action, bulk action)

/** "Invite to a campaign" for one or more clients: choose a live campaign and how they join. */
export function inviteToCampaign(clientIds, names = null) {
  slideOver(clientIds.length === 1 ? `Invite ${names?.[0]?.split(' ')[0] ?? 'them'} to a campaign` : `Invite ${clientIds.length} people to a campaign`, (body, close) => {
    let mode = 'invite', chosen = null;
    const list = h('div', { class: 'cg-pick-list', role: 'radiogroup', 'aria-label': 'Campaign' }, skeleton('table', { rows: 3 }));
    const status = h('div');
    const send = h('button', { type: 'button', class: 'btn primary', disabled: true, onclick: e => busy(e.currentTarget, status, async () => {
      if (mode === 'inPerson' && !await confirmBox('Enrol now?', { ok: 'Enrol', detail: 'Only when they said yes in person: it starts at once and raises any fee.' })) return;
      const r = await api('POST', `/api/campaigns/${enc(chosen.id)}/enrol`, { clientIds, mode });
      toast([r.invited ? `${plural(r.invited, 'invitation')} sent` : null, r.enrolled ? `${r.enrolled} enrolled` : null, r.waitlisted ? `${r.waitlisted} waitlisted` : null,
        r.skipped.length ? `${r.skipped.length} already in` : null].filter(Boolean).join(' · ') || 'Nothing to do.', { action: { label: 'Open board', run: () => go(`/campaigns/${enc(chosen.id)}/board`) } });
      close();
    }) }, icon('send', 16), 'Send invitation');
    api('GET', '/api/campaigns?status=live').then(r => {
      if (!r.campaigns.length) { fill(list, emptyHero({ icon: 'rocket_launch', title: 'No live campaigns', line: 'Make one live first.', action: { label: 'Campaigns', path: '/campaigns' } })); return; }
      const draw = () => fill(list, r.campaigns.map(c => h('button', { type: 'button', role: 'radio', 'aria-checked': String(chosen?.id === c.id), class: 'cg-pick' + (chosen?.id === c.id ? ' on' : ''),
        onclick: () => { chosen = c; send.disabled = false; draw(); } },
      h('span', { class: 'cg-pick-dot', 'aria-hidden': 'true' }), h('span', { class: 'grow' }, h('b', null, c.name), h('span', { class: 'small muted' }, `${datesLine(c)} · ${c.feePence ? `fee ${money(c.feePence)}` : 'no fee'} · spend ${money(c.expectedSpendPence)}`)),
      c.placesLeft !== null ? h('span', { class: 'small faint' }, `${c.placesLeft} left`) : null)));
      draw();
    }).catch(err => fill(list, h('p', { class: 'error' }, err.message)));
    body.append(list, h('div', { class: 'field' }, h('label', null, 'How they join'),
      segmentedNav([['invite', 'Invite'], ['inPerson', 'Agreed in person']], mode, v => { mode = v; fill(send, icon(v === 'invite' ? 'send' : 'how_to_reg', 16), v === 'invite' ? 'Send invitation' : 'Enrol now'); }, { label: 'How they join' })),
    h('p', { class: 'small faint' }, 'The invitation states the dates, the fee, the required kit with prices and the optional kit total. Nothing is charged until they accept.'), status);
    return h('div', { class: 'cg-slide-foot' }, h('span', { class: 'grow' }), button('Cancel', () => close()), send);
  });
}

// MARK: - Client 360: Campaigns tab

async function campaignsTab(box, { client, view }) {
  box.append(skeleton('card', { rows: 4 }));
  const r = await api('GET', `/api/coach/clients/${enc(client.id)}/campaigns`);
  if (!view.fresh()) return;
  const first = (client.name || '').split(' ')[0];
  if (!r.enrolments.length) { fill(box, emptyHero({ icon: 'rocket_launch', title: `${first} is in no campaigns`, line: 'Invite them to a live one: they see the dates, the fee and the kit before they say yes.', action: { label: 'Invite to a campaign', onclick: () => inviteToCampaign([client.id], [client.name]) } })); return; }
  fill(box, h('div', { class: 'cg-c360-head' }, h('span', { class: 'small muted grow' }, plural(r.enrolments.length, 'campaign'))),
    h('div', { class: 'cg-c360' }, r.enrolments.map(e => {
      const isOpen = ['active', 'paused'].includes(e.status);
      return h('article', { class: 'cg-card cg-c360-card' + (e.behind ? ' behind' : '') },
        h('div', { class: 'cg-c360-top' },
          isOpen || e.status === 'completed' ? h('span', { class: 'cg-mx-ring big' }, ring(e.pct, { size: 54, stroke: 4, label: `${e.pct}% done` }), h('span', null, `${e.pct}%`)) : h('span', { class: 'cg-c360-icon' }, icon('rocket_launch', 22)),
          h('div', { class: 'grow' }, link(`/campaigns/${enc(e.campaign.id)}/board`, { class: 'cg-c360-name' }, e.campaign.name),
            h('div', { class: 'small muted' }, [isOpen ? `Day ${e.day} of ${e.lengthDays}` : null, e.startOn ? `${fmtDay(e.startOn)} – ${fmtDay(e.endsOn)}` : null, isOpen ? `pace ${e.pace}%` : null, `${e.points} pts`].filter(Boolean).join(' · '))),
          enrolPill(e.status)),
        isOpen ? h('div', { class: 'cg-c360-today' }, h('div', { class: 'ui-eyebrow' }, 'Today'), e.today.length ? h('ul', { class: 'cg-today' }, e.today.map(a => h('li', { class: a.done ? 'done' : '' },
          h('span', { class: 'cg-check', 'aria-hidden': 'true' }, a.done ? icon('check', 14) : null), kindBadge(a.kind, 14), h('span', { class: 'grow' }, a.title), h('span', { class: 'ui-sr' }, a.done ? 'done' : 'not done yet')))) : h('p', { class: 'small faint m0' }, 'Nothing set for today.')) : null,
        h('div', { class: 'cg-c360-foot' },
          h('span', { class: 'small muted' }, icon('shopping_bag', 14), `Spent ${money(e.spentPence)} of ${money(e.expectedSpendPence)} expected`),
          e.feePence ? h('span', { class: 'small muted' }, icon('payments', 14), `Fee ${money(e.feePence)}${e.discountCode ? ` · ${e.discountCode}` : ''}`) : null,
          h('span', { class: 'grow' }),
          e.status === 'invited' ? h('button', { type: 'button', class: 'btn small', onclick: async () => { await api('POST', `/api/campaigns/${enc(e.campaign.id)}/enrolments/${enc(e.id)}/resend`); toast('Invitation sent again.'); } }, 'Resend') : null,
          ['invited', 'waitlisted', 'active', 'paused'].includes(e.status) ? h('button', { type: 'button', class: 'btn small text danger', onclick: async () => {
            if (!await confirmBox(e.status === 'invited' || e.status === 'waitlisted' ? `Withdraw the invitation to ${e.campaign.name}?` : `Unenrol ${first} from ${e.campaign.name}?`, { ok: e.status.startsWith('invit') || e.status === 'waitlisted' ? 'Withdraw' : 'Unenrol', danger: true, detail: isOpen ? 'They stop getting nudges. Their progress stays on the board.' : null })) return;
            await api('DELETE', `/api/campaigns/${enc(e.campaign.id)}/enrolments/${enc(e.id)}`);
            toast('Done.');
            box.replaceChildren();
            campaignsTab(box, { client, view });
          } }, isOpen ? 'Unenrol' : 'Withdraw') : null));
    })));
}
registerClientTab({ key: 'campaigns', label: 'Campaigns', order: 65, render: campaignsTab });

// MARK: - Other registrations

registerNav({ id: 'campaigns', label: 'Campaigns', icon: 'rocket_launch', group: 'engage', order: 20, path: '/campaigns', tabs: [{ id: 'live', label: 'Live campaigns', path: '/campaigns' }] });
registerClientAction({ id: 'campaign-enrol', label: 'Invite to campaign', icon: 'rocket_launch', order: 60, run: client => inviteToCampaign([client.id], [client.name]) });
registerBulkAction({ id: 'campaign-invite', label: 'Invite to campaign', icon: 'rocket_launch', scope: 'clients', run: async ids => inviteToCampaign(ids) });
registerQuickCreate({ id: 'campaign', label: 'Campaign', icon: 'rocket_launch', order: 70, run: newCampaign });
registerCommand({ id: 'campaigns.new', label: 'New campaign', icon: 'rocket_launch', group: 'Actions', run: newCampaign });

registerWidget({ id: 'campaigns-live', title: 'Live campaigns', size: 'm', order: 60, render: async (bodyEl, view) => {
  bodyEl.append(skeleton('lines', { rows: 3 }));
  const r = await api('GET', '/api/campaigns?status=live');
  if (view && view.fresh && !view.fresh()) return;
  if (!r.campaigns.length) { fill(bodyEl, h('p', { class: 'small muted' }, 'No campaign is running. '), link('/campaigns', { class: 'small' }, 'Start one')); return; }
  fill(bodyEl, h('ul', { class: 'cg-widget' }, r.campaigns.slice(0, 4).map(c => {
    const ti = todayIndex(c);
    return h('li', null, link(`/campaigns/${enc(c.id)}/board`, { class: 'cg-widget-row' },
      h('span', { class: 'cg-mx-ring' }, ring(c.avgProgress, { size: 36, stroke: 3, label: `${c.avgProgress}% average` }), h('span', null, `${c.avgProgress}%`)),
      h('span', { class: 'grow' }, h('b', null, c.name), h('span', { class: 'small muted' }, [ti !== null ? `Day ${ti + 1} of ${c.lengthDays}` : weeksWord(c.lengthDays), plural(c.enrolled, 'person', 'people')].join(' · '))),
      c.behind ? h('span', { class: 'cg-pace bad' }, icon('flag', 13), `${c.behind} behind`) : h('span', { class: 'cg-pace ok' }, icon('check', 13), 'On pace')));
  })));
} });

