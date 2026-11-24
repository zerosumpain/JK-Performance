/*
 * F13 Campaigns (WP4): the Board (progress matrix, leaderboard, spend, the
 * invited list, Nudge behind and the announcement) and Enrol (who, how they
 * join, fee and code, the invitation preview) tabs.
 */
import {
  api, avatar, clients as loadClients, confirmBox, fill, fmtDay, fmtRelative, foundationApi, go, hasFeature, h, icon, link, ring, switchRow, toast,
} from './core.js';
import { composer } from './composer.js';
import { enc, enrolPill, money, plural } from './f-campaigns-common.js';
import { spendBar } from './f-campaigns-design.js';
import { emptyHero, scoreRing, segmentedNav, skeleton, slideOver, tile } from './ui.js';

const heat = pct => (pct >= 90 ? 4 : pct >= 65 ? 3 : pct >= 35 ? 2 : pct > 0 ? 1 : 0);

/** A slide-over composer that sends through `send(text)` (no guard sends by itself; the coach presses Send). */
function composeSheet(title, detail, initial, send) {
  slideOver(title, (body, close) => {
    const c = composer({ placeholder: 'Write to them…', initial, label: title, onSend: async ({ text }) => { await send(text); close(); } });
    body.append(h('p', { class: 'small muted' }, detail), c.el);
    requestAnimationFrame(() => c.focus());
  });
}

export async function renderBoard(box, ctx) {
  box.append(skeleton('card', { rows: 6 }));
  let b;
  try { b = await api('GET', `/api/campaigns/${enc(ctx.id)}/board`); } catch (err) { fill(box, h('p', { class: 'error' }, err.message)); return; }
  if (!ctx.view.fresh()) return;
  const c = b.campaign;
  const active = b.clients.filter(r => ['active', 'paused', 'completed'].includes(r.enrolment.status));
  const behind = active.filter(r => r.behind);
  if (!active.length && !b.invited.length) {
    fill(box, emptyHero({ icon: 'group', title: 'Nobody in yet', line: c.status === 'live' ? 'Invite people from the Enrol tab. They see the dates, the fee and the kit before they say yes.' : 'Make the campaign live, then invite people.',
      action: { label: 'Invite people', path: `/campaigns/${enc(ctx.id)}/enrol` } }));
    return;
  }
  const avg = active.length ? Math.round(active.reduce((s, r) => s + r.pct, 0) / active.length) : 0;
  const nudgeBtn = h('button', { type: 'button', class: 'btn', disabled: !behind.length, onclick: () => composeSheet(`Nudge ${plural(behind.length, 'person', 'people')} behind`,
    `To ${behind.map(r => r.client.name.split(' ')[0]).join(', ')}. Sent as a bulk nudge: quiet hours and the daily cap apply.`,
    `Quick one about ${c.name}: you've slipped a little behind. Pick one thing from today's plan and tick it off, that's all.`,
    async text => {
      const r = await api('POST', `/api/campaigns/${enc(ctx.id)}/nudge`, { text, clientIds: behind.map(x => x.client.id) });
      toast([r.sent ? `${r.sent} sent` : null, r.deferred ? `${r.deferred} held for the morning` : null, r.skipped ? `${r.skipped} skipped (outreach paused)` : null].filter(Boolean).join(' · ') || 'Nothing sent.');
    }) }, icon('front_hand', 16), behind.length ? `Nudge ${behind.length} behind` : 'Nobody behind');
  const announceBtn = h('button', { type: 'button', class: 'btn', onclick: () => composeSheet('Announcement', `To everyone in ${c.name} (${plural(active.filter(r => r.enrolment.status !== 'completed').length, 'person', 'people')}).`, '',
    async text => { const r = await api('POST', `/api/campaigns/${enc(ctx.id)}/announce`, { text }); toast(`Sent to ${plural(r.sent, 'person', 'people')}.`); }) }, icon('campaign', 16), 'Announce');

  // KPI tiles
  const spentAll = b.totals.spentPence, expAll = b.totals.expectedSpendPence;
  const kpis = h('div', { class: 'cg-kpis' },
    tile({ eyebrow: 'Enrolled', icon: 'group', hero: true, body: [h('div', { class: 'ui-tile-num' }, String(active.length), c.capacity ? h('span', { class: 'cg-of' }, ` of ${c.capacity}`) : null),
      h('div', { class: 'small muted' }, [c.placesLeft !== null ? plural(c.placesLeft, 'place') + ' left' : 'No limit', b.invited.filter(x => x.enrolment.status === 'invited').length ? `${b.invited.filter(x => x.enrolment.status === 'invited').length} invited` : null].filter(Boolean).join(' · '))] }),
    tile({ eyebrow: 'Average progress', icon: 'donut_large', body: h('div', { class: 'cg-kpi-ring' }, scoreRing(avg, { size: 64, label: 'Average progress', band: { word: c.today ? `Day ${c.today} of ${c.lengthDays}` : `${c.lengthDays} days`, tone: 'data' } })) }),
    tile({ eyebrow: 'Behind pace', icon: 'flag', body: [h('div', { class: 'ui-tile-num' + (behind.length ? ' cg-warn' : '') }, String(behind.length)), h('div', { class: 'small muted' }, behind.length ? behind.map(r => r.client.name.split(' ')[0]).join(', ') : 'Everyone on pace')] }),
    tile({ eyebrow: 'Spend reported', icon: 'payments', body: [h('div', { class: 'ui-tile-num' }, money(spentAll)), h('div', { class: 'small muted' }, `of ${money(expAll)} expected`),
      h('div', { class: 'ui-progress-track cg-mini' }, h('div', { class: 'ui-progress-fill bg-accent', style: { '--pct': `${Math.min(100, expAll ? (spentAll / expAll) * 100 : 0)}%` } }))] }));

  // Progress matrix: clients × phases
  const invoices = new Map();
  const matrix = h('div', { class: 'cg-matrix-wrap' });
  const drawMatrix = () => fill(matrix, h('table', { class: 'cg-matrix', 'aria-label': 'Progress by client and phase' },
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Client'), h('th', { scope: 'col' }, 'Done'),
      b.phases.map(p => h('th', { scope: 'col', class: 'cg-mx-ph' }, h('span', { class: `cg-dot c-${p.color}`, 'aria-hidden': 'true' }), p.name)),
      h('th', { scope: 'col' }, 'Pace'), h('th', { scope: 'col', class: 'r' }, 'Points'), h('th', { scope: 'col', class: 'r' }, 'Spend'), invoices.size ? h('th', { scope: 'col' }, 'Invoice') : null)),
    h('tbody', null, b.clients.map(r => {
      const e = r.enrolment;
      const inv = invoices.get(e.id);
      return h('tr', { class: e.status === 'dropped' ? 'gone' : r.behind ? 'behind' : '' },
        h('th', { scope: 'row' }, link(`/clients/${enc(r.client.id)}/campaigns`, { class: 'cg-mx-who' }, avatar(r.client.initials, 30),
          h('span', null, h('b', null, r.client.name), h('span', { class: 'cg-mx-sub' }, e.status === 'active' ? `Day ${e.day}${r.rank ? ` · #${r.rank}` : ''}` : enrolPill(e.status))))),
        h('td', null, h('span', { class: 'cg-mx-ring' }, ring(r.pct, { size: 34, stroke: 3, label: `${r.pct}% done` }), h('span', null, `${r.pct}%`))),
        r.cells.map((cell, i) => h('td', { class: 'cg-mx-cell' }, h('span', { class: `cg-heat h${heat(cell.due ? cell.duePct : 0)}${cell.due ? '' : ' future'}`, title: `${b.phases[i].name}: ${cell.due ? `${cell.duePct}% of what's due` : 'not started'}` },
          cell.due ? `${cell.duePct}%` : '·'))),
        h('td', null, r.behind ? h('span', { class: 'cg-pace bad' }, icon('flag', 14), `${r.pace}% · behind`) : e.status === 'paused' ? h('span', { class: 'cg-pace' }, icon('pause_circle', 14), 'Paused') : h('span', { class: 'cg-pace ok' }, icon('check', 14), `${r.pace}%`)),
        h('td', { class: 'r t-num' }, String(r.points)),
        h('td', { class: 'r t-num' }, money(r.spentPence)),
        invoices.size ? h('td', null, inv ? link(`/billing/invoices/${enc(inv.id)}`, { class: 'cg-inv' }, icon('receipt_long', 14), inv.status ?? 'Invoice') : h('span', { class: 'faint' }, e.feePence ? '—' : 'No fee')) : null);
    }))));
  drawMatrix();
  if (c.feePence && await hasFeature('billing')) {
    Promise.all(b.clients.map(r => api('GET', `/api/billing/invoices?sourceRef=${enc(r.enrolment.id)}`).then(x => { const inv = (x.invoices ?? [])[0]; if (inv) invoices.set(r.enrolment.id, inv); }).catch(() => {})))
      .then(() => { if (invoices.size && ctx.view.fresh()) drawMatrix(); });
  }

  // Leaderboard
  const ranked = b.clients.filter(r => r.rank).slice(0, 6);
  const top = ranked[0]?.points || 1;
  const leader = tile({ title: 'Leaderboard', icon: 'military_tech', size: 'l', body: h('ol', { class: 'cg-lb' }, ranked.map(r => h('li', null,
    h('span', { class: 'cg-lb-rank' + (r.rank === 1 ? ' gold' : '') }, String(r.rank)), avatar(r.client.initials, 28), h('span', { class: 'cg-lb-name' }, r.client.name),
    h('span', { class: 'cg-lb-bar' }, h('span', { style: { '--w': `${(r.points / top) * 100}%` } })), h('b', { class: 't-num' }, `${r.points}`)))) });
  const spend = tile({ title: 'Spend: expected and reported', icon: 'shopping_bag', size: 'l', body: [h('div', { class: 'cg-spendbars' }, active.map(spendBar)),
    h('div', { class: 'cg-legend small muted' }, h('span', null, h('i', { class: 'cg-key exp' }), 'Expected'), h('span', null, h('i', { class: 'cg-key act' }), 'Reported'))] });
  const challenge = b.challenge ? tile({ title: b.challenge.title, eyebrow: 'Linked challenge', icon: 'local_fire_department', size: 'l', body: h('ol', { class: 'cg-lb' }, b.challenge.leaderboard.slice(0, 6).map(r => h('li', null,
    h('span', { class: 'cg-lb-rank' }, String(r.rank)), avatar(r.client.initials, 28), h('span', { class: 'cg-lb-name' }, r.client.name), h('b', { class: 't-num' }, `${r.value} km`)))) }) : null;

  // The invited list
  const invited = h('section', { class: 'cg-card' }, h('div', { class: 'cg-card-head' }, h('div', null, h('h2', null, 'Invitations'), h('p', { class: 'small muted m0' }, 'Pending, waitlisted and declined.'))),
    b.invited.length ? h('ul', { class: 'cg-inv-list' }, b.invited.map(x => {
      const e = x.enrolment;
      return h('li', null, avatar(x.client.initials, 32), h('div', { class: 'grow' }, h('b', null, x.client.name),
        h('div', { class: 'small muted' }, e.status === 'declined' ? `Answered ${fmtRelative(e.respondedAt)}${e.note ? ` · ${e.note}` : ''}` : `Invited ${fmtRelative(e.invitedAt)} · answer by ${fmtDay(e.respondBy)}`)),
      enrolPill(e.status),
      e.status === 'invited' ? h('button', { type: 'button', class: 'btn small', onclick: async ev => {
        ev.currentTarget.disabled = true;
        try { await api('POST', `/api/campaigns/${enc(ctx.id)}/enrolments/${enc(e.id)}/resend`); toast(`Invitation sent again to ${x.client.name.split(' ')[0]}.`); } catch (err) { toast(err.message, { error: true }); }
      } }, icon('send', 14), 'Resend') : null,
      ['invited', 'waitlisted'].includes(e.status) ? h('button', { type: 'button', class: 'btn small text', onclick: async () => {
        if (!await confirmBox(`Withdraw ${x.client.name.split(' ')[0]}'s invitation?`, { ok: 'Withdraw' })) return;
        await api('DELETE', `/api/campaigns/${enc(ctx.id)}/enrolments/${enc(e.id)}`);
        toast('Invitation withdrawn.');
        ctx.redraw();
      } }, 'Withdraw') : null);
    })) : h('p', { class: 'cg-blank-line' }, 'No open invitations.'));

  fill(box,
    h('div', { class: 'cg-board-actions' }, h('span', { class: 'small muted grow' }, `Updated ${fmtRelative(new Date().toISOString())}`), announceBtn, nudgeBtn),
    kpis,
    b.clients.length ? [
      h('section', { class: 'cg-card' }, h('div', { class: 'cg-card-head' }, h('div', null, h('h2', null, 'Progress'), h('p', { class: 'small muted m0' }, 'Each cell is the share of that phase\'s activities done so far. Behind means under 70% of what is due.'))), matrix),
      h('div', { class: 'ui-bento cg-board-bento' }, leader, spend, challenge)]
      : h('section', { class: 'cg-card cg-blank' }, h('p', { class: 't-quote-s m0' }, 'Nobody has accepted yet.'), h('p', { class: 'small muted' }, 'The board fills in as people accept: progress by phase, points, pace and what they spend.')),
    invited);
}

// MARK: - Enrol

export async function renderEnrol(box, ctx) {
  const c = ctx.doc.campaign;
  if (c.status !== 'live') {
    box.append(emptyHero({ icon: 'rocket_launch', title: c.status === 'draft' ? 'Make it live to invite people' : 'This campaign is not running',
      line: c.status === 'draft' ? 'Check the design, the kit and the dates, then go live. Nothing is sent until you invite.' : 'Reopen it from the header to invite more people.',
      action: c.status === 'draft' ? { label: 'Go live', onclick: () => ctx.setStatus('live') } : null }));
    return;
  }
  const state = { who: 'clients', ids: new Set(), segmentId: null, mode: 'invite', startOn: '', code: '', discountPence: 0, invoice: true, lay: false };
  const [all, board, segments] = await Promise.all([loadClients(), api('GET', `/api/campaigns/${enc(ctx.id)}/board`).catch(() => ({ clients: [], invited: [] })), foundationApi('GET', '/api/segments').catch(() => null)]);
  if (!ctx.view.fresh()) return;
  const existing = new Map([...board.clients, ...board.invited].map(r => [r.client.id, r.enrolment.status]));
  const hasPrograms = ctx.doc.activities.some(a => a.kind === 'workout' && a.linkRef);

  const preview = h('div', { class: 'cg-bubble' }, skeleton('lines', { rows: 5 }));
  const sendBtn = h('button', { type: 'button', class: 'btn primary cg-send' });
  let timer = null;
  const refreshPreview = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const first = [...state.ids][0] ?? null;
      try {
        const r = await api('POST', `/api/campaigns/${enc(ctx.id)}/invitation-preview`, { clientId: first, startOn: state.startOn || undefined, discountCode: state.code || undefined, discountPence: state.discountPence || undefined });
        fill(preview, r.text.split('\n').map(line => h('p', null, line.replace(/https?:\/\/\S+/, '[private plan link]'))));
      } catch (err) { fill(preview, h('p', { class: 'error' }, err.message)); }
    }, 250);
  };
  const count = () => (state.who === 'clients' ? state.ids.size : null);
  const drawSend = () => {
    const n = count();
    sendBtn.disabled = state.who === 'clients' ? !n : !state.segmentId;
    fill(sendBtn, icon(state.mode === 'invite' ? 'send' : 'how_to_reg', 18),
      state.mode === 'invite' ? (n === null ? 'Invite the segment' : `Send ${plural(n || 0, 'invitation')}`) : (n === null ? 'Enrol the segment now' : `Enrol ${plural(n || 0, 'person', 'people')} now`));
  };

  // Who
  const search = h('input', { type: 'search', placeholder: 'Search clients', 'aria-label': 'Search clients' });
  const people = h('div', { class: 'cg-people', role: 'group', 'aria-label': 'Clients' });
  const drawPeople = () => {
    const q = search.value.trim().toLowerCase();
    fill(people, all.filter(x => !q || x.name.toLowerCase().includes(q)).map(x => {
      const st = existing.get(x.id);
      const blocked = st && !['declined', 'dropped'].includes(st);
      return h('label', { class: 'cg-person' + (state.ids.has(x.id) ? ' on' : '') + (blocked ? ' off' : '') },
        h('input', { type: 'checkbox', checked: state.ids.has(x.id), disabled: blocked, onchange: e => { if (e.target.checked) state.ids.add(x.id); else state.ids.delete(x.id); e.target.closest('.cg-person').classList.toggle('on', e.target.checked); drawSend(); refreshPreview(); } }),
        avatar(x.initials, 30), h('span', { class: 'grow' }, x.name), st ? enrolPill(st) : null);
    }));
  };
  search.addEventListener('input', drawPeople);
  const segSel = h('select', { 'aria-label': 'Segment', onchange: e => { state.segmentId = e.target.value || null; drawSend(); } }, h('option', { value: '' }, 'Choose a segment…'),
    (segments?.segments ?? []).map(s => h('option', { value: s.id }, `${s.name} (${s.count})`)));
  const whoBox = h('div');
  const drawWho = () => fill(whoBox, state.who === 'clients' ? [h('div', { class: 'cg-people-tools' }, search,
    h('button', { type: 'button', class: 'btn small text', onclick: () => { for (const x of all) { const st = existing.get(x.id); if (!st || ['declined', 'dropped'].includes(st)) state.ids.add(x.id); } drawPeople(); drawSend(); refreshPreview(); } }, 'Select all'),
    h('button', { type: 'button', class: 'btn small text', onclick: () => { state.ids.clear(); drawPeople(); drawSend(); refreshPreview(); } }, 'Clear')), people]
    : segments ? [segSel, h('p', { class: 'small faint' }, 'Everyone in the segment right now. People already in the campaign are skipped.')] : h('p', { class: 'muted' }, 'Segments are not available on this server.'));

  // Fee and code
  const codeStatus = h('span', { class: 'small', role: 'status' });
  const code = h('input', { value: '', placeholder: 'Discount code (optional)', 'aria-label': 'Discount code', maxlength: '40', oninput: e => { state.code = e.target.value.trim().toUpperCase(); state.discountPence = 0; codeStatus.textContent = ''; refreshPreview(); } });
  const checkCode = h('button', { type: 'button', class: 'btn small', onclick: async () => {
    if (!state.code) return;
    if (!await hasFeature('billing')) { codeStatus.textContent = 'Billing checks the code on the invoice.'; return; }
    try {
      const r = await api('POST', '/api/offers/discounts/check', { code: state.code, amountPence: c.feePence, clientId: [...state.ids][0] });
      state.discountPence = Math.min(c.feePence, r.discountPence ?? r.amountOffPence ?? 0);
      codeStatus.className = 'small ok';
      codeStatus.textContent = state.discountPence ? `Valid: ${money(state.discountPence)} off` : 'Valid';
    } catch (err) { codeStatus.className = 'small error'; codeStatus.textContent = err.message; state.discountPence = 0; }
    refreshPreview();
  } }, 'Check');

  const startField = c.startMode === 'rolling' ? h('div', { class: 'field' }, h('label', null, 'Start on (optional)'),
    h('input', { type: 'date', min: new Date().toISOString().slice(0, 10), onchange: e => { state.startOn = e.target.value; refreshPreview(); } }), h('span', { class: 'small faint' }, 'Empty: each person starts the day they accept.'))
    : h('div', { class: 'cg-fact' }, icon('calendar_month', 18), h('div', null, h('b', null, 'Fixed dates'), h('div', { class: 'small muted' }, `${fmtDay(c.startsOn)} for everyone. Late joiners are not held to the days before they joined.`)));

  sendBtn.addEventListener('click', async () => {
    const body = { mode: state.mode, invoice: state.invoice, layProgram: state.lay, ...(state.startOn ? { startOn: state.startOn } : {}), ...(state.code ? { discountCode: state.code, discountPence: state.discountPence } : {}),
      ...(state.who === 'clients' ? { clientIds: [...state.ids] } : { audience: { segmentId: state.segmentId } }) };
    if (state.mode === 'inPerson' && !await confirmBox('Enrol them now?', { ok: 'Enrol', detail: 'Use this only when they said yes in person. It starts at once and raises the fee.' })) return;
    sendBtn.disabled = true;
    try {
      const r = await api('POST', `/api/campaigns/${enc(ctx.id)}/enrol`, body);
      const parts = [r.invited ? `${plural(r.invited, 'invitation')} sent` : null, r.enrolled ? `${r.enrolled} enrolled` : null, r.waitlisted ? `${r.waitlisted} waitlisted` : null, r.skipped.length ? `${r.skipped.length} skipped` : null];
      toast(parts.filter(Boolean).join(' · ') || 'Nobody new to invite.');
      go(`/campaigns/${enc(ctx.id)}/board`);
    } catch (err) { toast(err.message, { error: true }); sendBtn.disabled = false; }
  });

  fill(box, h('div', { class: 'cg-enrol' },
    h('div', { class: 'cg-enrol-main' },
      h('section', { class: 'cg-card' }, h('div', { class: 'cg-card-head' }, h('div', null, h('h2', null, 'Who'), h('p', { class: 'small muted m0' }, 'People already in or invited are greyed out.')),
        segmentedNav([['clients', 'Pick clients'], ['segment', 'A segment']], state.who, v => { state.who = v; drawWho(); drawSend(); }, { label: 'Audience' })), whoBox),
      h('section', { class: 'cg-card' }, h('div', { class: 'cg-card-head' }, h('div', null, h('h2', null, 'How they join'))),
        segmentedNav([['invite', 'Invite: they accept in the app or on their plan page'], ['inPerson', 'Agreed in person: starts now']], state.mode, v => { state.mode = v; drawSend(); }, { label: 'How they join' }),
        h('div', { class: 'cg-enrol-grid' }, startField,
          h('div', { class: 'field' }, h('label', null, `Fee ${c.feePence ? money(c.feePence) : ': none'}`), c.feePence ? h('div', { class: 'row' }, code, checkCode) : h('span', { class: 'small faint' }, 'Set a fee in Settings.'), codeStatus)),
        c.feePence ? switchRow('Raise an invoice when they accept', state.invoice, v => { state.invoice = v; }, { detail: 'Nothing is charged on invitation.' }) : null,
        hasPrograms ? switchRow('Lay the linked programs', state.lay, v => { state.lay = v; }, { detail: 'On acceptance, workout programs go on their calendar as drafts for you to publish.' }) : null)),
    h('aside', { class: 'cg-enrol-side' },
      h('div', { class: 'cg-preview-label' }, icon('chat_bubble', 14), 'The invitation, as they get it'),
      h('div', { class: 'cg-thread' }, h('div', { class: 'cg-thread-who' }, avatar('JK', 26, { coach: true }), h('span', null, 'Coach JK')), preview),
      sendBtn)));
  drawWho(); drawPeople(); drawSend(); refreshPreview();
}
