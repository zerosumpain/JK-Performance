/*
 * WP3 Offers (docs/design/desk-v2.md F12): /offers with Discounts and codes,
 * Referrals and Performance. Discounts are applied by the ledger when an
 * invoice is issued; this screen makes and switches them, generates codes,
 * runs the referral programme (a code and link per client, the reward, the
 * leaderboard) and shows what each offer cost and earned.
 */
import { api, avatar, busy, button, confirmBox, errorLine, field, fill, fmtDay, go, h, icon, registerCommand, registerNav, route, setCrumbs, sheet, todayLondon, toast, clients } from './core.js';
import { countUp, dataTable, dateField, emptyHero, moneyInput, pageHead, segmentedNav, skeleton, tabs, tile } from './ui.js';
import { barChart } from './charts.js';
import { enc, money } from './f-billing-common.js';
import { pickClient } from './f-billing.js';

registerNav({ id: 'offers', label: 'Offers', icon: 'sell', group: 'business', order: 20,
  tabs: [{ id: 'referrals', label: 'Referrals', path: '/offers/referrals' }, { id: 'performance', label: 'Offer performance', path: '/offers/performance' }] });
registerCommand({ id: 'go-offers', label: 'Go to Offers', group: 'Jump to', icon: 'sell', run: () => go('/offers') });
registerCommand({ id: 'new-offer', label: 'New discount code…', icon: 'percent', run: () => go('/offers/discounts?new=1') });

const TABS = [['discounts', 'Discounts and codes'], ['referrals', 'Referrals'], ['performance', 'Performance']];
const APPLIES = { any: 'Anything', plan: 'Plans', package: 'Packages', campaign: 'Campaigns', session: 'Sessions' };
const REF_STATUS = { pending: ['Enquired', 'hourglass_empty', 'data'], joined: ['Joined', 'how_to_reg', 'attention'], qualified: ['Qualified', 'verified', 'ok'], rewarded: ['Rewarded', 'redeem', 'ok'], void: ['Void', 'block', 'quiet'] };

/** Copy text, with a fallback for plain-http previews (no async clipboard there). */
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = h('textarea', { class: 'of-copybuf', 'aria-hidden': 'true' }, text);
    document.body.append(t); t.select();
    try { document.execCommand('copy'); } finally { t.remove(); }
  }
  toast('Copied');
}

route('/offers/:tab?', async (el, params, view) => {
  const tab = TABS.some(t => t[0] === params.tab) ? params.tab : 'discounts';
  if (tab !== 'discounts') setCrumbs([{ label: 'Offers', path: '/offers' }, { label: TABS.find(t => t[0] === tab)[1] }]);
  const sub = h('p', { class: 'ui-head-sub' }, ' ');
  const newBtn = h('button', { type: 'button', class: 'btn primary', onclick: async () => { if (await discountSheet()) go('/offers/discounts'); } }, icon('add', 18), 'New offer');
  const head = pageHead({ eyebrow: 'Business', title: 'Offers', accent: tab === 'referrals' ? 'and referrals' : null, actions: [newBtn] });
  head.querySelector('.ui-head-text').append(sub);
  const body = h('div', { class: 'of-body' }, skeleton('table', { rows: 5 }));
  el.append(head, tabs(TABS.map(([id, label]) => ({ id, label })), tab, id => go(id === 'discounts' ? '/offers' : `/offers/${id}`), { label: 'Offer sections' }), body);
  const redraw = () => { if (view.fresh()) draw(); };
  const draw = async () => {
    try {
      if (tab === 'discounts') await discountsTab(body, sub, view, redraw);
      else if (tab === 'referrals') await referralsTab(body, sub, view, redraw);
      else await performanceTab(body, sub, view);
    } catch (err) { if (view.fresh()) fill(body, errorLine(err)); }
  };
  await draw();
  if (new URLSearchParams(location.hash.split('?')[1] || '').get('new') === '1' && tab === 'discounts') { if (await discountSheet()) redraw(); }
}, { nav: 'offers' });

// MARK: - Discounts

const windowText = d => (d.startsOn || d.endsOn ? `${d.startsOn ? fmtDay(d.startsOn) : 'Now'} – ${d.endsOn ? fmtDay(d.endsOn) : 'open'}` : 'Always');
const codeTag = code => (code ? h('span', { class: 'of-code' }, code) : h('span', { class: 'of-code manual' }, 'Manual'));
const offerState = d => (!d.active ? ['Off', 'block', 'quiet'] : d.live ? ['Live', 'bolt', 'ok'] : d.startsOn && d.startsOn > todayLondon() ? ['Scheduled', 'schedule', 'data'] : ['Ended', 'stop_circle', 'quiet']);
const pill = ([word, glyph, tone]) => h('span', { class: `bl-status bl-tone-${tone}` }, icon(glyph, 14), word);

async function discountsTab(body, sub, view, redraw) {
  const { discounts } = await api('GET', '/api/offers/discounts');
  if (!view.fresh()) return;
  const general = discounts.filter(d => !d.client);
  const personal = discounts.filter(d => d.client);
  const live = general.filter(d => d.live);
  sub.textContent = `${live.length} live · ${general.reduce((n, d) => n + d.redemptions, 0)} redemptions · ${money(general.reduce((n, d) => n + d.discountedPence, 0))} given away, ${money(general.reduce((n, d) => n + d.revenuePence, 0))} earned`;
  const table = dataTable({
    label: 'Discounts', rows: general, initialSort: { key: 'redemptions', dir: -1 }, empty: 'No offers yet.',
    onRow: async r => { if (await discountSheet(r)) redraw(); },
    columns: [
      { key: 'code', label: 'Code', sort: r => r.code ?? '', render: r => codeTag(r.code) },
      { key: 'name', label: 'Offer', sort: true, render: r => h('div', null, h('div', { class: 'strong' }, r.name), h('div', { class: 'small muted' }, `${r.label} · ${APPLIES[r.appliesTo]}${r.firstInvoiceOnly ? ' · first invoice only' : ''}`)) },
      { key: 'window', label: 'Window', render: r => h('span', { class: 'small' }, windowText(r)) },
      { key: 'redemptions', label: 'Used', align: 'right', sort: true, render: r => h('span', { class: 't-num' }, r.maxRedemptions ? `${r.redemptions} / ${r.maxRedemptions}` : String(r.redemptions)) },
      { key: 'discounted', label: 'Given', align: 'right', sort: r => r.discountedPence, render: r => h('span', { class: 't-num muted' }, money(r.discountedPence)) },
      { key: 'revenue', label: 'Earned', align: 'right', sort: r => r.revenuePence, render: r => h('b', { class: 't-num' }, money(r.revenuePence)) },
      { key: 'state', label: 'Status', sort: r => offerState(r)[0], render: r => pill(offerState(r)) },
      { key: 'x', label: '', align: 'right', render: r => (r.code ? h('button', { type: 'button', class: 'ui-icon-btn small', 'aria-label': `Copy ${r.code}`, onclick: e => { e.stopPropagation(); copy(r.code); } }, icon('content_copy', 16)) : null) },
    ],
  });
  fill(body,
    general.length ? h('div', { class: 'of-cards' }, live.slice(0, 3).map(d => h('button', { type: 'button', class: 'of-card', onclick: async () => { if (await discountSheet(d)) redraw(); } },
      h('div', { class: 'spread' }, codeTag(d.code), pill(offerState(d))),
      h('div', { class: 'of-card-big' }, d.label),
      h('div', { class: 'small muted' }, d.name),
      h('div', { class: 'of-card-foot' }, h('span', null, h('b', { class: 't-num' }, String(d.redemptions)), ' used'), h('span', null, h('b', { class: 't-num' }, money(d.revenuePence)), ' earned'))))) : null,
    general.length ? table.el : emptyHero({ icon: 'sell', title: 'No offers yet.', line: 'A promo code for January, 15% off for returning clients, a founding-member price: make one and use it on any invoice.', action: { label: 'New offer', onclick: async () => { if (await discountSheet()) redraw(); } } }),
    personal.length ? h('details', { class: 'of-personal' }, h('summary', null, icon('key', 16), `Personal single-use codes (${personal.length})`),
      dataTable({ label: 'Personal codes', rows: personal, filter: false, columns: [
        { key: 'code', label: 'Code', render: r => codeTag(r.code) },
        { key: 'client', label: 'For', render: r => h('span', { class: 'bl-client' }, avatar(r.client.initials, 22), h('span', null, r.client.name)) },
        { key: 'name', label: 'Offer', render: r => `${r.label} · ${r.name}` },
        { key: 'origin', label: 'From', render: r => h('span', { class: 'small muted' }, r.origin === 'referral' ? 'Referral reward' : 'Personal offer') },
        { key: 'used', label: 'Used', align: 'right', render: r => (r.redemptions ? h('span', { class: 'tone-ok small row gap4' }, icon('check', 14), 'Used') : h('span', { class: 'small muted' }, 'Not yet')) },
      ] }).el) : null);
}

function discountSheet(d = null) {
  return sheet(d ? d.name : 'New offer', (body, close) => {
    const v = { code: d?.code ?? '', name: d?.name ?? '', kind: d?.kind ?? 'percent', value: d?.value ?? 1000, appliesTo: d?.appliesTo ?? 'any', startsOn: d?.startsOn ?? '', endsOn: d?.endsOn ?? '',
      maxRedemptions: d?.maxRedemptions ?? null, perClientMax: d?.perClientMax ?? 1, firstInvoiceOnly: d?.firstInvoiceOnly ?? false, active: d?.active ?? true };
    const status = h('div', { role: 'status' });
    const codeIn = h('input', { value: v.code, maxlength: '24', class: 'of-code-in', placeholder: 'NEWYEAR20 (blank for a manual discount)', oninput: e => { v.code = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''); e.target.value = v.code; } });
    const gen = h('button', { type: 'button', class: 'btn small', onclick: async () => { const { code } = await api('POST', '/api/offers/discounts/generate', { prefix: v.name.split(/\s+/)[0] || 'JK' }); v.code = code; codeIn.value = code; } }, icon('auto_awesome', 16), 'Generate');
    const valueBox = h('div');
    const drawValue = () => fill(valueBox, v.kind === 'percent'
      ? field('Percent off', h('input', { type: 'number', min: '1', max: '100', step: '0.5', value: String(v.value / 100), oninput: e => { v.value = Math.round(Number(e.target.value) * 100); } }))
      : field('Amount off', moneyInput({ value: v.value, label: 'Amount off', onChange: x => { v.value = x; } })));
    drawValue();
    body.append(
      field('Name', h('input', { value: v.name, maxlength: '80', placeholder: 'January Reset 20%', oninput: e => { v.name = e.target.value; } })),
      h('div', { class: 'field' }, h('label', null, 'Code'), h('div', { class: 'row' }, codeIn, gen)),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', null, 'Kind'), segmentedNav([['percent', '% off'], ['fixed', '£ off']], v.kind, k => { v.kind = k; v.value = k === 'percent' ? 1000 : 1000; drawValue(); }, { label: 'Kind' })),
        valueBox),
      field('Applies to', h('select', { onchange: e => { v.appliesTo = e.target.value; } }, Object.entries(APPLIES).map(([k, l]) => h('option', { value: k, selected: k === v.appliesTo }, l)))),
      h('div', { class: 'grid2' }, field('From', dateField({ value: v.startsOn, label: 'From', onChange: x => { v.startsOn = x; } })), field('Until', dateField({ value: v.endsOn, label: 'Until', onChange: x => { v.endsOn = x; } }))),
      h('div', { class: 'grid2' },
        field('Total uses', h('input', { type: 'number', min: '1', placeholder: 'No limit', value: v.maxRedemptions ?? '', oninput: e => { v.maxRedemptions = e.target.value ? Number(e.target.value) : null; } })),
        field('Uses per client', h('input', { type: 'number', min: '1', value: String(v.perClientMax), oninput: e => { v.perClientMax = Number(e.target.value) || 1; } }))),
      h('label', { class: 'bl-check' }, h('input', { type: 'checkbox', checked: v.firstInvoiceOnly, onchange: e => { v.firstInvoiceOnly = e.target.checked; } }), h('span', null, 'New clients only (their first invoice)')),
      d ? h('label', { class: 'bl-check' }, h('input', { type: 'checkbox', checked: v.active, onchange: e => { v.active = e.target.checked; } }), h('span', null, 'Live')) : null,
      d ? h('div', { class: 'of-stats' }, h('div', null, h('b', { class: 't-num' }, String(d.redemptions)), h('span', { class: 'small muted' }, 'redemptions')), h('div', null, h('b', { class: 't-num' }, money(d.discountedPence)), h('span', { class: 'small muted' }, 'given')), h('div', null, h('b', { class: 't-num' }, money(d.revenuePence)), h('span', { class: 'small muted' }, 'earned'))) : null,
      status);
    const payload = () => ({ ...v, code: v.code || null, startsOn: v.startsOn || null, endsOn: v.endsOn || null });
    const send = d ? h('button', { type: 'button', class: 'btn', onclick: async () => {
      const list = await clients();
      const c = await pickClient(list, 'Send a personal code to…');
      if (!c) return;
      const out = await api('POST', `/api/offers/discounts/${enc(d.id)}/issue`, { clientId: c.id, send: true });
      toast(`${out.code} sent to ${c.name.split(' ')[0]}`);
      close(true);
    } }, icon('send', 16), 'Send personal code') : null;
    const del = d ? h('button', { type: 'button', class: 'btn text danger', onclick: async () => {
      if (!(await confirmBox(`Remove ${d.name}?`, { ok: 'Remove', danger: true, detail: d.redemptions ? 'It has been used, so it is switched off instead and its history stays.' : 'It has never been used.' }))) return;
      await api('DELETE', `/api/offers/discounts/${enc(d.id)}`); toast('Offer removed'); close(true);
    } }, 'Remove') : null;
    const save = button(d ? 'Save' : 'Create offer', () => busy(save, status, async () => {
      if (d) await api('PUT', `/api/offers/discounts/${enc(d.id)}`, payload()); else await api('POST', '/api/offers/discounts', payload());
      toast(d ? 'Offer saved' : 'Offer created'); close(true);
    }), { kind: 'primary' });
    return h('div', { class: 'spread' }, h('div', { class: 'row' }, del, send), h('div', { class: 'row' }, button('Cancel', () => close()), save));
  }, { wide: true });
}

// MARK: - Referrals

async function referralsTab(body, sub, view, redraw) {
  const data = await api('GET', '/api/offers/referrals');
  if (!view.fresh()) return;
  const s = data.settings;
  const rewarded = data.referrals.filter(r => r.status === 'rewarded').length;
  sub.textContent = s.active ? `Programme live · ${s.rewardText} for every friend whose first invoice is paid · ${rewarded} rewarded so far` : 'The programme is off. Switch it on and give every client a link to share.';
  const v = { active: s.active, rewardKind: s.rewardKind, rewardValue: s.rewardValue, notifyReferrer: s.notifyReferrer, message: s.message };
  const status = h('div', { role: 'status' });
  const valueBox = h('div');
  const drawValue = () => fill(valueBox, v.rewardKind === 'credit' ? field('Credit', moneyInput({ value: v.rewardValue, label: 'Credit', onChange: x => { v.rewardValue = x; } }))
    : v.rewardKind === 'sessions' ? field('Free sessions', h('input', { type: 'number', min: '1', max: '20', value: String(v.rewardValue > 20 ? 1 : v.rewardValue), oninput: e => { v.rewardValue = Number(e.target.value); } }))
      : field('Percent off', h('input', { type: 'number', min: '1', max: '100', value: String(v.rewardValue > 100 ? v.rewardValue / 100 : v.rewardValue), oninput: e => { v.rewardValue = Math.round(Number(e.target.value) * 100); } })));
  drawValue();
  const save = button('Save programme', () => busy(save, status, async () => { await api('PUT', '/api/offers/referrals/settings', v); toast('Referral programme saved'); redraw(); }), { kind: 'primary', small: true });
  const settings = tile({ id: 'programme', eyebrow: 'The programme', title: 'What a referral earns', icon: 'handshake', size: 'l', hero: true, body: [
    h('label', { class: 'bl-check' }, h('input', { type: 'checkbox', checked: v.active, onchange: e => { v.active = e.target.checked; } }), h('span', null, h('b', null, 'Programme on'), h('span', { class: 'small muted' }, ' · clients see their code and link'))),
    h('div', { class: 'field' }, h('label', null, 'Reward'), segmentedNav([['credit', 'Account credit'], ['sessions', 'Free sessions'], ['percentNext', '% off next invoice']], v.rewardKind, k => { v.rewardKind = k; v.rewardValue = k === 'credit' ? 2000 : k === 'sessions' ? 1 : 2000; drawValue(); }, { label: 'Reward' })),
    valueBox,
    h('p', { class: 'small muted' }, 'It qualifies when the friend’s first invoice is paid. The reward is applied once, automatically.'),
    h('label', { class: 'bl-check' }, h('input', { type: 'checkbox', checked: v.notifyReferrer, onchange: e => { v.notifyReferrer = e.target.checked; } }), h('span', null, 'Tell them in their thread when they earn it')),
    h('div', { class: 'row end' }, status, save)] });

  const board = tile({ id: 'board', eyebrow: 'Leaderboard', title: 'Your best ambassadors', icon: 'military_tech', size: 'l', body: data.leaderboard.length
    ? h('ol', { class: 'of-board' }, data.leaderboard.slice(0, 6).map((l, i) => h('li', null, h('span', { class: `of-rank${i === 0 ? ' gold' : ''}` }, String(i + 1)), avatar(l.client.initials, 32),
      h('span', { class: 'grow strong' }, l.client.name), h('span', { class: 'small muted' }, `${l.referred} referred`), h('b', { class: 't-num' }, `${l.rewarded}`), h('span', { class: 'small muted' }, 'rewarded'))))
    : h('div', { class: 'bl-w-clear' }, icon('handshake', 22), h('span', null, 'No referrals yet.')) });
  // The chain at a glance: enquired → joined → qualified → rewarded.
  const counts = Object.keys(REF_STATUS).filter(k => k !== 'void').map(k => [k, data.referrals.filter(r => r.status === k).length]);
  board.body.append(h('ol', { class: 'of-chain', 'aria-label': 'Referrals by stage' }, counts.map(([k, n]) => h('li', null,
    h('span', { class: `of-chain-n t-num bl-tone-${REF_STATUS[k][2]}` }, String(n)), h('span', { class: 'small muted row gap4' }, icon(REF_STATUS[k][1], 14), REF_STATUS[k][0])))));

  const makeCode = h('button', { type: 'button', class: 'btn small', onclick: async () => {
    const c = await pickClient(await clients(), 'Make a referral code for…');
    if (!c) return;
    const out = await api('POST', '/api/offers/referrals/codes', { clientId: c.id });
    await copy(out.link);
    redraw();
  } }, icon('add', 16), 'Code for a client');
  const codes = tile({ id: 'codes', eyebrow: 'Codes and links', title: 'Share links', icon: 'link', size: 'full', action: null, body: [
    h('div', { class: 'spread of-codes-head' }, h('span', { class: 'small muted' }, 'Each link opens your enquiry page with the code filled in.'), makeCode),
    data.codes.length ? h('ul', { class: 'of-codes' }, data.codes.map(c => h('li', null, avatar(c.client.initials, 28), h('span', { class: 'strong of-codes-name' }, c.client.name), h('span', { class: 'of-code' }, c.code),
      h('span', { class: 'of-link small muted clamp1' }, c.link),
      h('button', { type: 'button', class: 'btn small', onclick: () => copy(c.link) }, icon('content_copy', 16), 'Copy link')))) : h('p', { class: 'muted small' }, 'No codes yet: clients get theirs the first time they open it in the app, or make one here.')] });

  const table = tile({ id: 'referrals', eyebrow: 'Referrals', icon: 'how_to_reg', size: 'full', body: dataTable({ label: 'Referrals', rows: data.referrals, initialSort: { key: 'updated', dir: -1 }, empty: 'No referrals yet.',
    columns: [
      { key: 'referrer', label: 'From', sort: r => r.referrer?.name ?? '', render: r => h('span', { class: 'bl-client' }, avatar(r.referrer.initials, 24), h('span', null, r.referrer.name)) },
      { key: 'referee', label: 'Friend', sort: r => r.refereeName, render: r => r.refereeName },
      { key: 'status', label: 'Status', sort: r => Object.keys(REF_STATUS).indexOf(r.status), render: r => pill(REF_STATUS[r.status]) },
      { key: 'reward', label: 'Reward', render: r => h('span', { class: 'small muted' }, r.rewardText ?? '—') },
      { key: 'updated', label: 'Updated', sort: r => r.updatedAt, render: r => fmtDay(r.updatedAt.slice(0, 10)) },
      { key: 'x', label: '', align: 'right', render: r => (['pending', 'joined'].includes(r.status) ? h('button', { type: 'button', class: 'btn small text', onclick: async () => { if (!(await confirmBox('Void this referral?', { ok: 'Void', danger: true }))) return; await api('POST', `/api/offers/referrals/${enc(r.id)}/void`); toast('Referral voided'); redraw(); } }, 'Void') : null) },
    ] }).el });
  fill(body, h('div', { class: 'ui-bento of-bento' }, settings, board, codes, table));
}

// MARK: - Performance

async function performanceTab(body, sub, view) {
  const p = await api('GET', '/api/offers/performance');
  if (!view.fresh()) return;
  sub.textContent = `Discounts cost ${money(p.discountCostPence)} and earned ${money(p.discountRevenuePence)} · referred clients paid ${money(p.referredRevenuePence)}`;
  const stat = (id, eyebrow, glyph, pence, line, tone = null) => { const n = h('div', { class: `ui-tile-num${tone ? ` tone-${tone}` : ''}` }); countUp(n, pence, { format: v => money(Math.round(v)) }); return tile({ id, eyebrow, icon: glyph, size: 's', body: [n, h('div', { class: 'small muted' }, line)] }); };
  const roi = p.discountCostPence ? (p.discountRevenuePence / p.discountCostPence) : null;
  const used = p.offers.filter(o => o.redemptions);
  fill(body, h('div', { class: 'ui-bento of-bento' },
    stat('earned', 'Earned with offers', 'savings', p.discountRevenuePence, 'paid on invoices that used a code', 'ok'),
    stat('cost', 'Cost of discounts', 'percent', p.discountCostPence, roi ? `£${roi.toFixed(1)} back for every £1 given` : 'Nothing given away yet'),
    stat('referred', 'From referred clients', 'handshake', p.referredRevenuePence, `${p.referredClients} client${p.referredClients === 1 ? '' : 's'} came by referral`, 'ok'),
    stat('refcost', 'Referral rewards', 'redeem', p.referralCostPence, 'credit given to referrers'),
    tile({ id: 'redemptions', eyebrow: 'Redemptions per offer', icon: 'bar_chart', size: 'l', body: used.length ? barChart({ height: 220, ariaLabel: 'Redemptions per offer', bars: used.map((o, i) => ({ label: o.code ?? o.name.split(' ')[0], value: o.redemptions, tone: (i % 6) + 1 })) }) : h('p', { class: 'muted' }, 'No redemptions yet.') }),
    tile({ id: 'value', eyebrow: 'Given and earned', icon: 'bar_chart', size: 'l', body: used.length ? barChart({ height: 220, stacked: true, ariaLabel: 'Given and earned per offer', yFormat: v => `£${Math.round(v)}`,
      bars: used.map(o => ({ label: o.code ?? o.name.split(' ')[0], parts: [{ label: 'Earned', value: o.revenuePence / 100, tone: 3 }, { label: 'Given', value: o.discountedPence / 100, tone: 5 }] })) }) : h('p', { class: 'muted' }, 'Nothing yet.') })));
}
