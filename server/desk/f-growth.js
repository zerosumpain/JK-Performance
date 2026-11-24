/*
 * WP11 Growth, part one (docs/design/desk-v2.md F6): the leads pipeline.
 *
 *   /pipeline        a board from Enquiry to Won (Lost folded away), the
 *                    weighted value in play, a 90-day funnel and the sources
 *   /pipeline/:id    the same board with the lead open in a slide-over
 *                    (deep link ?panel=lead:<id>)
 *
 * Also: the Today widget, "+ New › Lead", Settings › Enquiry form, and the
 * helpers the marketing screen (f-growth-marketing.js) shares: the follow-up
 * sheet, copy-to-clipboard and the source and stage chips. Every piece of
 * lead data goes on the page through h() (textContent), never as HTML.
 * Leads are reached by copy and mailto: only (D14): nothing here sends e-mail.
 */
import {
  addDays, api, avatar, busy, button, capabilities, clients, confirmBox, errorLine, field, fill, firstName, fmtDay, fmtMoney, fmtRelative, fmtShort,
  go, h, icon, link, live, londonParts, registerCommand, registerNav, registerPanel, registerQuickCreate, registerSettingsSection, registerWidget,
  route, sheet, state, toast, todayLondon, daysBetween,
} from './core.js';
import { countUp, emptyHero, inlineEdit, kanban, menu, moneyInput, openPanel, pageHead, segmentedNav, skeleton, tile, timeline } from './ui.js';
import { funnel } from './charts.js';

// MARK: - Shared vocabulary

export const enc = encodeURIComponent;
export const STAGES = [
  { id: 'enquiry', label: 'Enquiry', tone: 'data', icon: 'inbox' },
  { id: 'contacted', label: 'Contacted', tone: 'data', icon: 'forum' },
  { id: 'consult', label: 'Consult booked', tone: 'accent', icon: 'event_available' },
  { id: 'trial', label: 'Trial', tone: 'attention', icon: 'fitness_center' },
  { id: 'won', label: 'Won', tone: 'ok', icon: 'how_to_reg' },
  { id: 'lost', label: 'Lost', tone: null, icon: 'heart_broken' },
];
const OPEN = ['enquiry', 'contacted', 'consult', 'trial'];
const PROB = { enquiry: 0.1, contacted: 0.2, consult: 0.4, trial: 0.6, won: 1, lost: 0 };
export const stageOf = id => STAGES.find(s => s.id === id) ?? STAGES[0];
export const SOURCES = [
  ['manual', 'Added by you', 'person_add'], ['enquiryForm', 'Enquiry form', 'description'], ['referral', 'Referral', 'handshake'],
  ['instagram', 'Instagram', 'photo_camera'], ['word', 'Word of mouth', 'forum'], ['event', 'Event', 'celebration'], ['other', 'Other', 'more_horiz'],
];
export const sourceIcon = id => SOURCES.find(s => s[0] === id)?.[2] ?? 'more_horiz';
export const sourceLabel = id => SOURCES.find(s => s[0] === id)?.[1] ?? id;
const LOST_REASONS = [['price', 'Price'], ['timing', 'Timing'], ['location', 'Location'], ['fit', 'Not the right fit'], ['noReply', 'No reply'], ['other', 'Other']];
const ANSWERS = {
  experience: { new: 'New to training', some: 'Some experience', regular: 'Trains regularly', athlete: 'Competitive athlete' },
  times: { early: 'Early mornings', daytime: 'Daytime', evening: 'Evenings', weekend: 'Weekends' },
  budget: { under80: 'Up to £80 a month', '80to150': '£80 to £150 a month', over150: '£150 or more a month', unsure: 'Not sure yet' },
};
const ACTIVITY_ICON = { note: 'sticky_note_2', call: 'forum', email: 'mail', message: 'chat_bubble', stage: 'east', created: 'add', converted: 'how_to_reg' };
const ACTIVITY_TITLE = { note: 'Note', call: 'Call', email: 'E-mail', message: 'Message', stage: 'Stage', created: 'Lead added', converted: 'Became a client' };

/** "£150" for pence; "/mo" is added by the caller where it belongs. */
export const money = p => fmtMoney(Math.round(p ?? 0));
export const perMonth = p => `${money(p)}/mo`;

/** Copy text, with a fallback for the plain-http preview (no async clipboard there). */
export async function copyText(text, done = 'Copied') {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fall back */ }
  if (!ok) {
    const t = h('textarea', { class: 'ld-copybuf', 'aria-hidden': 'true', tabindex: '-1' }, text);
    document.body.append(t);
    t.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; } finally { t.remove(); }
  }
  toast(ok ? done : 'Couldn’t copy: select the text and copy it yourself', { error: !ok });
  return ok;
}

export const stagePill = stage => { const s = stageOf(stage); return h('span', { class: `ld-pill ld-st-${s.id}` }, icon(s.icon, 14), s.label); };
export const sourceChip = (source, text = null) => h('span', { class: 'ld-src' }, icon(sourceIcon(source), 14), text ?? sourceLabel(source));

/** Tell every pipeline view a lead changed (board, KPIs, panels, the marketing screen). */
const changed = () => dispatchEvent(new Event('jk:leads'));
export const onLeadsChanged = fn => { addEventListener('jk:leads', fn); return () => removeEventListener('jk:leads', fn); };
export const openLead = id => openPanel('lead', id);

/** A London wall-clock day and time as a UTC instant (correct across BST). */
function londonIso(day, time) {
  const [y, m, d] = day.split('-').map(Number), [hh, mm] = time.split(':').map(Number);
  const want = Date.UTC(y, m - 1, d, hh, mm);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = londonParts(new Date(guess).toISOString());
    const [py, pm, pd] = p.day.split('-').map(Number), [ph, pmin] = p.time.split(':').map(Number);
    guess += want - Date.UTC(py, pm - 1, pd, ph, pmin);
  }
  return new Date(guess).toISOString();
}

const coachFirst = () => firstName(String(state.me?.name || 'JK').replace(/^coach\s+/i, '')) || 'JK';
const nextLabel = (day, { short = false, today = todayLondon() } = {}) => {
  if (!day) return null;
  const d = daysBetween(today, day);
  if (d < 0) return { text: `Overdue ${-d}d`, late: true };
  if (d === 0) return { text: 'Today', late: true };
  if (d === 1) return { text: 'Tomorrow', late: false };
  return { text: short ? fmtShort(day) : fmtDay(day), late: false };
};

// MARK: - Registrations

registerNav({
  id: 'pipeline', label: 'Pipeline', icon: 'view_kanban', group: 'clients', order: 20, badge: true, badgeOn: ['lead.created', 'lead.stageChanged'],
  path: '/pipeline',
});
registerCommand({ id: 'go-pipeline', label: 'Go to Pipeline', group: 'Jump to', icon: 'view_kanban', keys: 'g p', run: () => go('/pipeline') });
registerCommand({ id: 'new-lead', label: 'Add a lead…', icon: 'person_add', run: () => addLeadSheet() });
registerCommand({ id: 'enquiry-form', label: 'Enquiry form settings', icon: 'description', run: () => go('/account/enquiry-form') });
registerQuickCreate({ id: 'lead', label: 'Lead', icon: 'person_add', order: 15, run: () => addLeadSheet() });
registerPanel('lead', id => ({ title: 'Lead', build: (body, close, ctl) => leadPanel(id, body, close, ctl) }));

// MARK: - The board

route('/pipeline/:id?', async (el, params, view) => {
  if (params.id) { go(`/pipeline?panel=lead:${enc(params.id)}`, { replace: true }); return; }
  const sub = h('p', { class: 'ui-head-sub' }, ' ');
  const head = pageHead({
    eyebrow: 'Clients · Growth', title: 'Pipeline',
    actions: [
      link('/account/enquiry-form', { class: 'btn' }, icon('description', 18), 'Enquiry form'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => addLeadSheet() }, icon('add', 18), 'Add lead'),
    ],
  });
  head.querySelector('.ui-head-text').append(sub);
  const kpis = h('div', { class: 'ui-bento ld-kpis' }, tile({ size: 'l', hero: true, loading: true }), tile({ size: 'l', loading: true }));
  const chips = h('div', { class: 'ld-chips', role: 'list', 'aria-label': 'Sources, last 90 days' });
  const filter = h('input', { type: 'search', class: 'ld-filter', placeholder: 'Filter leads', 'aria-label': 'Filter leads' });
  const lostBtn = h('button', { type: 'button', class: 'btn small ld-lost-toggle', 'aria-pressed': 'false' });
  const boardBox = h('div', { class: 'ld-board' }, skeleton('card', { rows: 4 }));
  el.append(head, kpis, h('div', { class: 'ld-toolbar' }, chips, h('div', { class: 'ld-tools' }, h('span', { class: 'ld-search' }, icon('search', 16), filter), lostBtn)), boardBox);

  let leads = [];
  let board = null;
  const columns = STAGES.map(s => ({ id: s.id, label: s.label, tone: s.tone, collapsed: s.id === 'lost' }));
  const shown = () => {
    const q = filter.value.trim().toLowerCase();
    return q ? leads.filter(l => [l.name, l.email, l.sourceDetail, l.sourceLabel, l.campaignName].some(v => String(v ?? '').toLowerCase().includes(q))) : leads;
  };
  const drawLostBtn = () => {
    const lost = columns.find(c => c.id === 'lost');
    const n = leads.filter(l => l.stage === 'lost').length;
    lostBtn.replaceChildren(icon(lost.collapsed ? 'visibility' : 'visibility_off', 16), lost.collapsed ? `Show lost (${n})` : 'Fold lost');
    lostBtn.setAttribute('aria-pressed', String(!lost.collapsed));
    boardBox.classList.toggle('lost-folded', lost.collapsed);
  };
  lostBtn.addEventListener('click', () => { const lost = columns.find(c => c.id === 'lost'); lost.collapsed = !lost.collapsed; drawLostBtn(); board?.setItems(shown()); });
  filter.addEventListener('input', () => board?.setItems(shown()));

  const drawBoard = () => {
    if (!board) {
      board = kanban({
        label: 'Leads by stage', columns, items: shown(), columnOf: l => l.stage, itemKey: l => l.id,
        render: leadCard, onOpen: l => openLead(l.id),
        sum: list => { const w = list.reduce((n, l) => n + (l.weightedPence || 0), 0); return w ? `${money(w)} wtd` : ''; },
        onMove: async (l, to, index) => {
          const body = { stage: to, position: index };
          if (to === 'lost' && l.stage !== 'lost') {
            const why = await lostSheet(l);
            if (!why) throw new Error('no reason given');
            Object.assign(body, why);
          }
          const { lead } = await api('POST', `/api/leads/${enc(l.id)}/move`, body);
          Object.assign(l, lead);
          drawKpis();
          if (to === 'won' && !lead.client) toast(`${firstName(lead.name)} is won.`, { action: { label: 'Link their account', run: () => convertSheet(lead) } });
          else toast(`Moved to ${stageOf(to).label}`);
        },
      });
      fill(boardBox, board.el);
    } else board.setItems(shown());
    drawLostBtn();
  };

  let funnelData = null, sources = null;
  const drawKpis = () => {
    const open = leads.filter(l => OPEN.includes(l.stage));
    const inPlay = open.reduce((n, l) => n + l.valuePence, 0);
    const weighted = open.reduce((n, l) => n + Math.round(l.valuePence * PROB[l.stage]), 0);
    const since = addDays(todayLondon(), -90);
    const recent = leads.filter(l => londonParts(l.createdAt).day >= since);
    const won = recent.filter(l => l.stage === 'won');
    const rate = recent.length ? Math.round(won.length / recent.length * 100) : null;
    const dueNow = open.filter(l => l.nextActionOn && l.nextActionOn <= todayLondon()).length;
    sub.textContent = `${open.length} open · ${perMonth(inPlay)} in play · ${dueNow ? `${dueNow} due a follow-up` : 'nobody waiting on you'}`;
    const big = h('span', { class: 'ld-big' }, money(0));
    const bar = h('div', { class: 'ld-stagebar', role: 'img', 'aria-label': `In play by stage: ${OPEN.map(s => `${stageOf(s).label} ${money(open.filter(l => l.stage === s).reduce((n, l) => n + l.valuePence, 0))}`).join(', ')}` },
      OPEN.map(s => { const v = open.filter(l => l.stage === s).reduce((n, l) => n + l.valuePence, 0); return v ? h('span', { class: `ld-seg ld-st-${s}`, style: { flexGrow: String(v) } }) : null; }));
    const hero = tile({
      id: 'weighted', size: 'l', hero: true, eyebrow: 'Weighted pipeline', icon: 'savings',
      body: [
        h('div', { class: 'ld-big-row' }, big, h('span', { class: 'ld-per' }, 'a month, weighted')),
        h('p', { class: 'ld-hero-line' }, `${perMonth(inPlay)} in play across ${open.length} open lead${open.length === 1 ? '' : 's'}`),
        bar,
        h('ul', { class: 'ld-legend' }, OPEN.map(s => h('li', null, h('span', { class: `ld-key ld-st-${s}` }), stageOf(s).label, h('b', { class: 't-num' }, String(open.filter(l => l.stage === s).length))))),
        h('div', { class: 'ld-stats' },
          h('div', null, h('b', { class: 't-num' }, String(won.length)), h('span', null, 'won in 90 days')),
          h('div', null, h('b', { class: 't-num' }, rate === null ? '—' : `${rate}%`), h('span', null, 'win rate')),
          h('div', null, h('b', { class: 't-num' }, String(recent.length)), h('span', null, 'new leads'))),
      ],
    });
    countUp(big, weighted / 100, { format: v => `£${Math.round(v).toLocaleString('en-GB')}` });
    const fun = tile({
      id: 'funnel', size: 'l', eyebrow: 'Last 90 days', title: 'Conversion by stage', icon: 'filter_alt',
      body: funnelData ? funnel({ stages: funnelData.stages.map(s => ({ label: s.label, value: s.entered })), ariaLabel: 'Leads reaching each stage, last 90 days' })
        : emptyHero({ title: 'No funnel yet', line: 'It fills in as leads move.' }),
    });
    fill(kpis, hero, fun);
    fill(chips, sources?.length ? sources.map(s => h('span', { class: 'ld-chip', role: 'listitem' }, icon(sourceIcon(s.source), 15), h('span', { class: 'ld-chip-name' }, s.label),
      h('span', { class: 'ld-chip-n t-num' }, `${s.leads} · ${s.won} won${s.conversionPct === null ? '' : ` · ${s.conversionPct}%`}`))) : null);
  };

  const load = async (quiet = false) => {
    try {
      const [list, f, s] = await Promise.all([
        api('GET', '/api/leads'),
        api('GET', '/api/leads/funnel?days=90').catch(() => null),
        api('GET', '/api/marketing/sources?days=90').catch(() => null),
      ]);
      if (!view.fresh()) return;
      leads = list.leads;
      funnelData = f;
      sources = s?.sources ?? null;
      drawKpis();
      if (!leads.length) {
        board = null;
        fill(boardBox, emptyHero({ icon: 'view_kanban', title: 'No leads yet', line: 'Share your enquiry page, or add someone you met at the gym. Every enquiry lands here.', action: { label: 'Add a lead', onclick: () => addLeadSheet() } }));
        drawLostBtn();
        return;
      }
      drawBoard();
    } catch (err) { if (view.fresh() && !quiet) fill(boardBox, errorLine(err)); }
  };
  await load();
  let timer = null;
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => { if (view.fresh()) load(true); }, 250); };
  const offs = [onLeadsChanged(soon), live.on('lead.created', soon), live.on('lead.stageChanged', soon), live.on('lead.deleted', soon)];
  view.onLeave(() => { clearTimeout(timer); offs.forEach(off => off()); });
}, { nav: 'pipeline' });

function leadCard(l) {
  const next = nextLabel(l.nextActionOn, { short: true });
  const detail = l.campaignName ? `For ${l.campaignName}` : l.sourceDetail && !l.sourceDetail.startsWith('code:') ? l.sourceDetail : l.answers?.goal ?? '';
  const status = l.stage === 'won' ? (l.client ? h('span', { class: 'ld-meta tone-ok' }, icon('how_to_reg', 14), 'Client') : h('span', { class: 'ld-meta' }, icon('link_off', 14), 'Not linked'))
    : l.stage === 'lost' ? h('span', { class: 'ld-meta' }, l.lostReasonLabel ?? 'Lost')
    : next ? h('span', { class: `ld-meta${next.late ? ' tone-attention' : ''}` }, icon(next.late ? 'alarm' : 'schedule', 14), next.text) : h('span', { class: 'ld-meta' }, 'No next step');
  return h('div', { class: 'ld-card', onclick: () => openLead(l.id) },
    h('div', { class: 'ld-card-top' }, avatar(l.name, 28),
      h('div', { class: 'grow' }, h('div', { class: 'ld-card-name' }, l.name), detail ? h('div', { class: 'ld-card-detail' }, detail) : null)),
    h('div', { class: 'ld-card-mid' },
      l.valuePence ? h('span', { class: 'ld-card-value t-num' }, money(l.valuePence), h('small', null, '/mo')) : h('span', { class: 'ld-card-value none' }, 'No value'),
      status),
    h('div', { class: 'ld-card-foot' }, sourceChip(l.source), h('span', { class: 'ld-age t-num', title: `Added ${fmtRelative(l.createdAt)}` }, `${l.ageDays}d`)));
}

// MARK: - The lead slide-over

async function leadPanel(id, body, close, { setTitle }) {
  body.append(skeleton('card', { rows: 5 }));
  let lead = null;
  const draw = async () => {
    let data;
    try { data = await api('GET', `/api/leads/${enc(id)}`); } catch (err) { fill(body, errorLine(err.status === 404 ? 'That lead isn’t here any more.' : err)); return; }
    lead = data.lead;
    setTitle(`Lead · ${stageOf(lead.stage).label}`);
    const save = async patch => { const out = await api('PATCH', `/api/leads/${enc(id)}`, patch); lead = out.lead; changed(); return out; };
    const redraw = () => { changed(); draw(); };
    const next = nextLabel(lead.nextActionOn, { short: true });
    fill(body,
      h('div', { class: 'ld-p-head' }, avatar(lead.name, 52),
        h('div', { class: 'grow' },
          h('div', { class: 'ld-p-name' }, inlineEdit(lead.name, v => save({ name: v }), { label: 'Name' })),
          h('div', { class: 'row gap4' }, stagePill(lead.stage), sourceChip(lead.source), lead.client ? link(`/clients/${enc(lead.client.id)}`, { class: 'ld-src ld-linked', onclick: () => close() }, icon('how_to_reg', 14), lead.client.name) : null)),
        h('div', { class: 'ld-p-value' }, h('b', { class: 't-num' }, money(lead.valuePence)), h('span', null, 'a month'),
          OPEN.includes(lead.stage) ? h('small', { class: 't-num' }, `${money(lead.weightedPence)} weighted`) : null)),
      h('div', { class: 'ld-p-actions' },
        actionBtn('event_available', 'Plan consult', () => planSheet(lead, 'consult').then(ok => ok && redraw())),
        actionBtn('fitness_center', 'Plan trial', () => planSheet(lead, 'trial').then(ok => ok && redraw())),
        actionBtn('mail', 'Follow up', () => followUpSheet(lead.id).then(ok => ok && redraw())),
        actionBtn('send', 'App invite', () => copyText(inviteText(lead), 'Invite copied: paste it into a message')),
        lead.client ? null : actionBtn('how_to_reg', 'Convert', () => convertSheet(lead).then(ok => ok && redraw())),
        h('button', { type: 'button', class: 'ld-act', 'aria-haspopup': 'menu', onclick: e => menu(e.currentTarget, [
          ...STAGES.filter(s => s.id !== lead.stage).map(s => ({ label: `Move to ${s.label}`, icon: s.icon, onclick: () => moveTo(lead, s.id).then(ok => ok && redraw()) })),
          'sep',
          { label: 'Delete lead', icon: 'delete', danger: true, onclick: async () => {
            if (!await confirmBox(`Delete ${lead.name}?`, { ok: 'Delete', danger: true, detail: 'The lead and its activity are erased for good. Any calendar hold keeps its time but loses the name.' })) return;
            await busy(null, null, async () => { await api('DELETE', `/api/leads/${enc(id)}`); changed(); close(); toast('Lead deleted'); });
          } },
        ], { label: 'More actions' }) }, icon('more_horiz', 20), h('span', null, 'More'))),
      h('section', { class: 'ld-p-next' + (next?.late ? ' late' : '') },
        icon(next?.late ? 'alarm' : 'schedule', 18),
        h('div', { class: 'grow' }, h('div', { class: 'ld-p-k' }, 'Next action'), h('div', { class: 'ld-p-v' }, next ? next.text : 'Nothing planned')),
        h('input', { type: 'date', class: 'ld-date', value: lead.nextActionOn ?? '', 'aria-label': 'Next action day', onchange: e => save({ nextActionOn: e.target.value || null }).then(redraw).catch(err => toast(err.message, { error: true })) }),
        h('button', { type: 'button', class: 'btn small', onclick: () => save({ nextActionOn: addDays(todayLondon(), 1) }).then(redraw) }, 'Tomorrow'),
        h('button', { type: 'button', class: 'btn small', onclick: () => save({ nextActionOn: addDays(todayLondon(), 7) }).then(redraw) }, '+1 week')),
      h('dl', { class: 'ld-p-facts' },
        fact('E-mail', inlineEdit(lead.email ?? '', v => save({ email: v || null }), { label: 'E-mail', placeholder: 'Add an e-mail' })),
        fact('Phone', inlineEdit(lead.phone ?? '', v => save({ phone: v || null }), { label: 'Phone', placeholder: 'Add a phone number' })),
        fact('Monthly value', inlineEdit(lead.valuePence ? `£${(lead.valuePence / 100).toFixed(0)}` : '', v => {
          const p = Math.round(Number(String(v).replace(/[£,\s]/g, '')) * 100);
          if (!Number.isFinite(p) || p < 0) return Promise.reject(new Error('Type an amount in pounds, like 120'));
          return save({ valuePence: p }).then(redraw);
        }, { label: 'Monthly value in pounds', placeholder: 'Add a value' })),
        fact('Source', h('select', { class: 'ld-select', 'aria-label': 'Source', onchange: e => save({ source: e.target.value }).then(redraw) },
          SOURCES.map(([v, label]) => h('option', { value: v, selected: v === lead.source }, label)))),
        fact('Detail', inlineEdit(lead.sourceDetail?.startsWith('campaign:') ? '' : lead.sourceDetail ?? '', v => save({ sourceDetail: v }), { label: 'Source detail', placeholder: 'Who or where' })),
        lead.referralCode ? fact('Referral code', h('span', { class: 'ld-code' }, lead.referralCode)) : null,
        lead.campaignId ? fact('Offer', h('span', null, lead.campaignName ?? 'A past offer')) : null,
        fact('Added', h('span', null, `${fmtRelative(lead.createdAt)}${lead.consentAt ? ' · consented to contact' : ''}`))),
      answersBlock(lead),
      lead.stage === 'lost' ? h('section', { class: 'ld-p-lost' }, icon('heart_broken', 18),
        h('div', null, h('b', null, `Lost: ${lead.lostReasonLabel ?? 'no reason'}`), lead.lostNote ? h('p', null, lead.lostNote) : null)) : null,
      activityBlock(lead, data.activities, redraw));
  };
  await draw();
}

const actionBtn = (glyph, label, run) => h('button', { type: 'button', class: 'ld-act', onclick: run }, icon(glyph, 20), h('span', null, label));
const fact = (k, v) => [h('dt', null, k), h('dd', null, v)];

function answersBlock(lead) {
  const a = lead.answers || {};
  const rows = [
    a.experience ? ['Training so far', ANSWERS.experience[a.experience] ?? a.experience] : null,
    a.times?.length ? ['Prefers', a.times.map(t => ANSWERS.times[t] ?? t).join(', ')] : null,
    a.budget ? ['Budget', ANSWERS.budget[a.budget] ?? a.budget] : null,
  ].filter(Boolean);
  if (!a.goal && !rows.length) return null;
  return h('section', { class: 'ld-p-answers' },
    h('div', { class: 'ld-p-k' }, 'In their words'),
    a.goal ? h('blockquote', { class: 'ld-quote' }, a.goal) : null,
    rows.length ? h('dl', { class: 'ld-p-facts compact' }, rows.map(([k, v]) => fact(k, v))) : null);
}

function activityBlock(lead, activities, redraw) {
  let kind = 'note';
  const text = h('textarea', { class: 'ld-note', rows: '2', placeholder: 'What happened? A call, a note, a DM…', 'aria-label': 'Activity' });
  const add = h('button', { type: 'button', class: 'btn small primary', onclick: async e => {
    if (!text.value.trim()) { text.focus(); return; }
    await busy(e.currentTarget, null, async () => {
      await api('POST', `/api/leads/${enc(lead.id)}/activities`, { kind, text: text.value.trim() });
      text.value = '';
      redraw();
    });
  } }, 'Add');
  return h('section', { class: 'ld-p-activity' },
    h('div', { class: 'ld-p-k' }, 'Activity'),
    h('div', { class: 'ld-add' }, segmentedNav([['note', 'Note'], ['call', 'Call'], ['email', 'E-mail'], ['message', 'Message']], kind, v => { kind = v; }, { label: 'Kind of activity' }), text, h('div', { class: 'row end' }, add)),
    timeline(activities.map(a => ({ at: a.at, icon: ACTIVITY_ICON[a.kind] ?? 'timeline', tone: a.kind === 'converted' ? 'ok' : a.kind === 'stage' ? 'accent' : null, title: ACTIVITY_TITLE[a.kind] ?? a.kind, detail: a.text }))));
}

async function moveTo(lead, stage) {
  const body = { stage, position: 0 };
  if (stage === 'lost') { const why = await lostSheet(lead); if (!why) return false; Object.assign(body, why); }
  return busy(null, null, async () => { await api('POST', `/api/leads/${enc(lead.id)}/move`, body); toast(`Moved to ${stageOf(stage).label}`); return true; });
}

const inviteText = lead => `Hi ${firstName(lead.name)}, great to have you on board! Download the JK Performance app (iPhone or Android) and sign up${lead.email ? ` with ${lead.email}` : ' with this e-mail address'}, so your account links straight to me: ${location.origin}/\n\n${coachFirst()}`;

// MARK: - Sheets

/** Why was it lost? Resolves {lostReason, lostNote} or null. */
function lostSheet(lead) {
  return sheet(`Why was ${firstName(lead.name)} lost?`, (body, close) => {
    let reason = null;
    const note = h('textarea', { rows: '3', placeholder: 'Optional: anything to remember if they come back', maxlength: '500' });
    const ok = button('Mark lost', () => close({ lostReason: reason, lostNote: note.value.trim() || undefined }), { kind: 'primary', disabled: true });
    body.append(h('p', { class: 'muted m0' }, 'The reason feeds the Sources numbers. Nothing is sent to them.'),
      h('div', { class: 'ld-reasons', role: 'radiogroup', 'aria-label': 'Reason' }, LOST_REASONS.map(([v, label]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': 'false', class: 'chip', onclick: e => {
          reason = v; ok.disabled = false;
          for (const b of e.currentTarget.parentElement.children) { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-checked', String(b === e.currentTarget)); }
        },
      }, label))),
      field('Note', note));
    return h('div', { class: 'row end' }, button('Cancel', () => close(null)), ok);
  });
}

/** + New › Lead. */
export function addLeadSheet() {
  return sheet('Add a lead', (body, close) => {
    const name = h('input', { type: 'text', maxlength: '80', autocomplete: 'off', placeholder: 'Their name', autofocus: true });
    const email = h('input', { type: 'email', maxlength: '190', autocomplete: 'off', placeholder: 'name@example.com' });
    const phone = h('input', { type: 'tel', maxlength: '24', autocomplete: 'off' });
    const source = h('select', null, SOURCES.map(([v, label]) => h('option', { value: v, selected: v === 'word' }, label)));
    const detail = h('input', { type: 'text', maxlength: '120', placeholder: 'Met at park run, Sam’s colleague…' });
    const value = moneyInput({ label: 'Expected monthly value' });
    const note = h('textarea', { rows: '3', maxlength: '2000', placeholder: 'Anything worth remembering' });
    const status = h('div');
    body.append(field('Name', name), h('div', { class: 'ld-two' }, field('E-mail', email), field('Phone', phone)),
      h('div', { class: 'ld-two' }, field('Source', source), field('Monthly value', value, 'What they would likely pay a month')), field('Where from', detail), field('Note', note), status);
    const save = button('Add lead', async e => {
      const pence = value.pence();
      if (Number.isNaN(pence)) { fill(status, errorLine('Type the value in pounds, like 120')); return; }
      await busy(e.currentTarget, status, async () => {
        const { lead } = await api('POST', '/api/leads', { name: name.value, email: email.value.trim() || undefined, phone: phone.value.trim() || undefined, source: source.value, sourceDetail: detail.value.trim(), valuePence: pence ?? 0, note: note.value.trim() || undefined });
        changed();
        close(lead);
        toast(`${firstName(lead.name)} added to Enquiry`, { action: { label: 'Open', run: () => { if (!location.hash.startsWith('#/pipeline')) go('/pipeline'); setTimeout(() => openLead(lead.id), 50); } } });
      });
    }, { kind: 'primary' });
    return h('div', { class: 'row end' }, button('Cancel', () => close()), save);
  });
}

/** Plan a consult or trial: a coach-only calendar hold (F20) when the calendar feature is there, and the next action. */
function planSheet(lead, kind) {
  const what = kind === 'consult' ? 'consult' : 'trial session';
  return sheet(`Plan a ${what} with ${firstName(lead.name)}`, (body, close) => {
    const day = h('input', { type: 'date', value: addDays(todayLondon(), 1), min: todayLondon(), 'aria-label': 'Day' });
    const time = h('input', { type: 'time', value: kind === 'consult' ? '12:30' : '07:00', step: '900', 'aria-label': 'Time' });
    let mins = kind === 'consult' ? 30 : 60;
    const length = segmentedNav([[30, '30 min'], [45, '45 min'], [60, '1 h']], mins, v => { mins = v; }, { label: 'Length' });
    const title = h('input', { type: 'text', maxlength: '80', value: `${kind === 'consult' ? 'Consult' : 'Trial'} · ${firstName(lead.name)}` });
    const status = h('div');
    body.append(h('div', { class: 'ld-two' }, field('Day', day), field('Start', time)), field('Length', length), field('Calendar title', title, 'Holds are yours alone: clients just see the time as taken.'), status);
    const go2 = button(kind === 'consult' ? 'Hold the consult' : 'Hold the trial', async e => {
      if (!day.value || !time.value) { fill(status, errorLine('Pick a day and a start time.')); return; }
      await busy(e.currentTarget, status, async () => {
        const start = londonIso(day.value, time.value);
        const end = new Date(Date.parse(start) + mins * 60_000).toISOString();
        let held = false;
        if ((await capabilities()).features.includes('calsync')) {
          try { await api('POST', '/api/calendar/holds', { leadId: lead.id, kind, start, end, title: title.value.trim() || (kind === 'consult' ? 'Consult' : 'Trial') }); held = true; } catch (err) {
            if (err.status === 409) throw new Error('That time overlaps a booking. Pick another.');
            if (err.status !== 404) throw err;
          }
        }
        await api('PATCH', `/api/leads/${enc(lead.id)}`, { nextActionOn: day.value });
        const target = kind === 'consult' ? 'consult' : 'trial';
        if (['enquiry', 'contacted', 'consult', 'trial'].indexOf(lead.stage) < ['enquiry', 'contacted', 'consult', 'trial'].indexOf(target)) {
          await api('POST', `/api/leads/${enc(lead.id)}/move`, { stage: target, position: 0 });
        }
        await api('POST', `/api/leads/${enc(lead.id)}/activities`, { kind: 'note', text: `${kind === 'consult' ? 'Consult' : 'Trial'} planned for ${fmtDay(day.value)} at ${time.value}${held ? ', held on the calendar' : ''}` });
        changed();
        close(true);
        toast(held ? `Held on your calendar for ${fmtDay(day.value)}` : `Next action set for ${fmtDay(day.value)}`);
      });
    }, { kind: 'primary' });
    return h('div', { class: 'row end' }, button('Cancel', () => close(false)), go2);
  });
}

/** Link the lead to an existing client; then offer to turn a future trial hold into a booking (F20). */
function convertSheet(lead) {
  return sheet(`Link ${firstName(lead.name)} to a client`, (body, close) => {
    const q = h('input', { type: 'search', placeholder: 'Find a client', 'aria-label': 'Find a client', autofocus: true });
    const list = h('div', { class: 'ld-pick' }, skeleton('lines', { rows: 4 }));
    const status = h('div');
    body.append(h('p', { class: 'muted m0' }, 'When someone signs up with the same e-mail this happens by itself. Use this when they joined with another address.'), q, list, status);
    let all = [];
    const draw = () => {
      const s = q.value.trim().toLowerCase();
      const rows = all.filter(c => !s || c.name.toLowerCase().includes(s) || String(c.email ?? '').toLowerCase().includes(s)).slice(0, 30);
      fill(list, rows.length ? rows.map(c => h('button', { type: 'button', class: 'ld-pick-row', onclick: e => busy(e.currentTarget, status, async () => {
        await api('POST', `/api/leads/${enc(lead.id)}/convert`, { clientId: c.id });
        changed();
        close(true);
        toast(`${firstName(lead.name)} is now ${c.name}`);
        await offerTrialBooking(lead, c);
      }) }, avatar(c.name, 32), h('span', { class: 'grow' }, h('b', null, c.name), h('span', { class: 'small muted' }, c.email ?? '')), icon('chevron_right', 18)))
        : h('p', { class: 'muted' }, 'No client matches.'));
    };
    clients().then(c => { all = c; draw(); }).catch(err => fill(list, errorLine(err)));
    q.addEventListener('input', draw);
    return h('div', { class: 'row end' }, button('Cancel', () => close(false)));
  });
}

async function offerTrialBooking(lead, client) {
  try {
    if (!(await capabilities()).features.includes('calsync')) return;
    const from = new Date().toISOString(), to = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const { holds } = await api('GET', `/api/calendar/holds?from=${enc(from)}&to=${enc(to)}`);
    const trial = (holds || []).find(x => x.leadId === lead.id && x.kind === 'trial' && x.start > from);
    if (!trial) return;
    const when = londonParts(trial.start);
    if (!await confirmBox('Turn the trial into a booking?', { ok: 'Book it', detail: `${client.name} has a trial held for ${fmtDay(when.day)} at ${when.time}. Booking it makes it a 1:1 session in their app.` })) return;
    await api('POST', `/api/calendar/holds/${enc(trial.id)}/convert`, { clientId: client.id });
    toast('Trial booked as a 1:1');
  } catch (err) { if (err.status !== 404) toast(err.message || String(err), { error: true }); }
}

/**
 * Follow up a lead with a ready-written note (F28): pick a template, edit it,
 * then Copy or Open in mail. Either logs the follow-up and moves the next
 * action by the template's days. Resolves true when logged.
 */
export function followUpSheet(leadId) {
  return sheet('Follow up', (body, close) => {
    body.append(skeleton('card', { rows: 4 }));
    const foot = h('div', { class: 'row end' }, button('Close', () => close(false)));
    api('GET', `/api/leads/${enc(leadId)}/followups`).then(({ lead, options, suggestedId }) => {
      if (!options.length) { fill(body, emptyHero({ icon: 'description', title: 'No templates', line: 'Add follow-up templates in Marketing › Follow-ups.', action: { label: 'Open Follow-ups', onclick: () => { close(false); go('/marketing/followups'); } } })); return; }
      let pick = options.find(o => o.template.id === suggestedId) ?? options[0];
      const subject = h('input', { type: 'text', 'aria-label': 'Subject' });
      const text = h('textarea', { class: 'ld-fu-body', rows: '10', 'aria-label': 'Message' });
      const mail = h('a', { class: 'btn primary', target: '_self' }, icon('mail', 18), 'Open in mail');
      const status = h('div');
      const log = async channel => {
        try {
          const out = await api('POST', `/api/leads/${enc(leadId)}/followed-up`, { templateId: pick.template.id, channel });
          changed();
          close(true);
          toast(`Logged. Next follow-up ${out.lead.nextActionOn ? fmtDay(out.lead.nextActionOn) : 'not set'}`);
        } catch (err) { fill(status, errorLine(err)); }
      };
      const sync = () => {
        mail.hidden = !lead.email;
        if (lead.email) mail.href = `mailto:${encodeURIComponent(lead.email).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject.value)}&body=${encodeURIComponent(text.value)}`;
      };
      const choose = o => { pick = o; subject.value = o.rendered.subject; text.value = o.rendered.body; sync(); };
      subject.addEventListener('input', sync);
      text.addEventListener('input', sync);
      mail.addEventListener('click', () => { log('mailto'); });
      const picker = h('div', { class: 'ld-fu-picks', role: 'radiogroup', 'aria-label': 'Template' }, options.map(o => h('button', {
        type: 'button', role: 'radio', class: 'chip' + (o === pick ? ' on' : ''), 'aria-checked': String(o === pick),
        onclick: e => { choose(o); for (const b of e.currentTarget.parentElement.children) { const on = b === e.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); } },
      }, `${o.template.name}`, h('span', { class: 'ld-fu-stage' }, stageOf(o.template.stage === 'lost' ? 'lost' : o.template.stage).label))));
      choose(pick);
      fill(body,
        h('div', { class: 'ld-fu-to' }, avatar(lead.name, 36), h('div', { class: 'grow' }, h('b', null, lead.name), h('div', { class: 'small muted' }, lead.email || 'No e-mail: copy it into a DM or text')), stagePill(lead.stage)),
        picker, field('Subject', subject), field('Message', text), status,
        h('p', { class: 'tiny faint' }, 'Nothing is sent from here. Copy it into WhatsApp, Instagram or a text, or open it in your mail app. Either way it is logged on the lead.'));
      foot.replaceChildren(button('Cancel', () => close(false)),
        h('button', { type: 'button', class: 'btn', onclick: async () => { if (await copyText(`${text.value}`, 'Message copied')) log('copy'); } }, icon('content_copy', 18), 'Copy'),
        mail);
      sync();
    }).catch(err => fill(body, errorLine(err)));
    return foot;
  }, { wide: true });
}

// MARK: - Today widget (F1)

registerWidget({
  id: 'pipeline', title: 'Pipeline', icon: 'view_kanban', size: 's', order: 60,
  render: async box => {
    const { leads } = await api('GET', '/api/leads');
    const open = leads.filter(l => OPEN.includes(l.stage));
    const weighted = open.reduce((n, l) => n + Math.round(l.valuePence * PROB[l.stage]), 0);
    const fresh = open.filter(l => l.stage === 'enquiry' && l.ageDays <= 7).length;
    const due = open.filter(l => l.nextActionOn && l.nextActionOn <= todayLondon()).length;
    const num = h('div', { class: 'ui-tile-num serif' }, money(0));
    fill(box, h('div', { class: 'ld-w' },
      num, h('div', { class: 'small muted' }, `a month, weighted · ${open.length} open`),
      h('div', { class: 'ld-stagebar small' }, OPEN.map(s => { const v = open.filter(l => l.stage === s).reduce((n, l) => n + l.valuePence, 0); return v ? h('span', { class: `ld-seg ld-st-${s}`, style: { flexGrow: String(v) } }) : null; })),
      h('div', { class: 'ld-w-foot' },
        fresh ? h('span', { class: 'tone-attention' }, icon('person_add', 14), `${fresh} new`) : h('span', { class: 'muted' }, 'No new enquiries'),
        due ? h('span', { class: 'tone-attention' }, icon('alarm', 14), `${due} due`) : null,
        link('/pipeline', { class: 'ld-w-link' }, 'Open', icon('chevron_right', 14)))));
    countUp(num, weighted / 100, { format: v => `£${Math.round(v).toLocaleString('en-GB')}` });
  },
});

// MARK: - Settings › Enquiry form

registerSettingsSection({
  id: 'enquiry-form', label: 'Enquiry form', icon: 'description', order: 40,
  render: async box => {
    const { form, url } = await api('GET', '/api/leads/form');
    const slug = h('input', { type: 'text', value: form.slug, maxlength: '40', pattern: '[a-z0-9-]{3,40}', 'aria-label': 'Page address', spellcheck: 'false', autocomplete: 'off' });
    const title = h('input', { type: 'text', value: form.title, maxlength: '80' });
    const intro = h('textarea', { rows: '4', maxlength: '600' }, form.intro);
    const picked = new Set(form.fields);
    const FIELDS = [['goal', 'Their goal', 'What would you like to achieve?'], ['experience', 'Training so far', 'New, some, regular or competitive'], ['times', 'Preferred times', 'Mornings, daytime, evenings, weekends'], ['budget', 'Budget', 'Also sets the lead’s expected value']];
    let active = form.active;
    const activeSeg = segmentedNav([[true, 'Open'], [false, 'Closed']], active, v => { active = v; }, { label: 'Form open' });
    const status = h('div');
    const linkBox = h('div');
    const drawLink = u => fill(linkBox, u ? h('div', { class: 'ld-link-card' },
      h('div', { class: 'ld-p-k' }, 'Your public page'),
      h('div', { class: 'ld-link-row' }, h('code', { class: 'ld-url' }, u),
        h('button', { type: 'button', class: 'btn small', onclick: () => copyText(u, 'Link copied') }, icon('content_copy', 16), 'Copy'),
        h('a', { class: 'btn small', href: u, target: '_blank', rel: 'noopener noreferrer' }, icon('open_in_new', 16), 'Open')),
      h('ul', { class: 'ld-link-notes' },
        h('li', null, 'Referral codes are supported: ', h('code', null, '?ref=SAM-K7QP'), ' credits the client who sent them.'),
        h('li', null, 'Public offers add ', h('code', null, '?campaign=…'), ': find each link in Marketing › Offers.'),
        h('li', null, 'No script, a strict security policy, a spam trap and a limit of five enquiries an hour per connection.')))
      : h('p', { class: 'muted' }, 'Save the form to get your public link.'));
    drawLink(url);
    box.append(
      h('h2', { class: 'set-h' }, 'Enquiry form'),
      h('p', { class: 'muted' }, 'A public page where anyone can ask about coaching. Every enquiry lands in your Pipeline and pings the bell.'),
      h('div', { class: 'card ld-form-card' },
        field('Page address', h('div', { class: 'ld-slug' }, h('span', { class: 'faint' }, '/enquire/'), slug), 'Lower-case letters, numbers and dashes.'),
        field('Title', title), field('Introduction', intro),
        h('fieldset', { class: 'ld-fields' }, h('legend', null, 'Questions to ask'),
          FIELDS.map(([id, label, hint]) => h('label', { class: 'ld-field-opt' }, h('input', { type: 'checkbox', checked: picked.has(id), onchange: e => { if (e.target.checked) picked.add(id); else picked.delete(id); } }),
            h('span', null, h('b', null, label), h('span', { class: 'small muted' }, hint))))),
        h('p', { class: 'small muted' }, 'Name, e-mail, phone (optional) and the consent box are always on the form: “JK may contact me about coaching. My details are kept for up to 12 months if I don’t become a client.”'),
        field('Status', activeSeg),
        status,
        h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn primary', onclick: e => busy(e.currentTarget, status, async () => {
          const out = await api('PUT', '/api/leads/form', { slug: slug.value.trim().toLowerCase(), title: title.value, intro: intro.value, fields: [...picked], active });
          drawLink(out.url);
          toast('Enquiry form saved');
        }) }, 'Save'))),
      linkBox);
  },
});

