/*
 * WP3 Billing (docs/design/desk-v2.md F9–F11): /billing with Overview,
 * Invoices, Payments, Packages, Schedules and Settings; the client 360 Billing
 * tab; the Invoice client action and quick-create; the Overdue widget; the
 * Billing settings section; the invoice slide-over panel; and the nav items
 * for Billing and Plans & prices. All billing is a record of money handled
 * outside the app: the copy says "Record payment", never "Charge".
 */
import {
  addDays, api, avatar, busy, button, clients, confirmBox, errorLine, field, fill, fmtDay, fmtRelative, go, h, icon, link,
  registerClientAction, registerClientTab, registerCommand, registerNav, registerPanel, registerQuickCreate, registerSettingsSection, registerWidget,
  route, setCrumbs, sheet, todayLondon, toast, live,
} from './core.js';
import { countUp, dataTable, dateField, dateRange, emptyHero, menu, moneyInput, openPanel, pageHead, popover, progressBar, segmentedNav, skeleton, tabs, tile, timeline } from './ui.js';
import { barChart } from './charts.js';
import {
  INTERVAL_LABEL, METHODS, bigMoney, clientChip, creditNoteSheet, downloadCsv, enc, invoiceWizard, methodLabel, money, recordPaymentSheet,
  refundSheet, statusPill,
} from './f-billing-common.js';

// MARK: - Registrations

registerNav({ id: 'billing', label: 'Billing', icon: 'receipt_long', group: 'business', order: 10, badge: true, badgeOn: ['invoice.overdue', 'invoice.paid', 'payment.recorded', 'invoice.voided'],
  tabs: [{ id: 'invoices', label: 'Invoices', path: '/billing/invoices' }, { id: 'payments', label: 'Payments', path: '/billing/payments' }, { id: 'packages', label: 'Packages', path: '/billing/packages' },
    { id: 'schedules', label: 'Schedules', path: '/billing/schedules' }, { id: 'settings', label: 'Billing settings', path: '/billing/settings' }] });
registerNav({ id: 'plans', label: 'Plans & prices', icon: 'workspace_premium', group: 'business', order: 60, path: '/business/plans' });
registerCommand({ id: 'go-billing', label: 'Go to Billing', group: 'Jump to', icon: 'receipt_long', keys: 'g b', run: () => go('/billing') });
registerCommand({ id: 'new-invoice', label: 'New invoice…', icon: 'request_quote', run: () => invoiceWizard() });
registerCommand({ id: 'billing-export', label: 'Export billing CSV (last 12 months)', icon: 'download', run: () => downloadCsv(addDays(todayLondon(), -365), todayLondon()).catch(err => toast(err.message, { error: true })) });
registerQuickCreate({ id: 'invoice', label: 'Invoice…', icon: 'request_quote', order: 30, run: () => invoiceWizard() });
registerClientAction({ id: 'invoice', label: 'Invoice', icon: 'request_quote', order: 40, run: c => invoiceWizard({ clientId: c.id }) });
registerPanel('invoice', id => ({ title: 'Invoice', build: (body, close, { setTitle }) => invoicePanel(id, body, close, setTitle) }));

registerWidget({
  id: 'overdue', title: 'Overdue', icon: 'warning', size: 's', order: 52,
  async render(box) {
    const { invoices } = await api('GET', '/api/billing/invoices?status=overdue');
    const total = invoices.reduce((n, i) => n + i.outstandingPence, 0);
    if (!invoices.length) { fill(box, h('div', { class: 'bl-w-clear' }, icon('task_alt', 22), h('span', null, 'Nobody owes you late.'))); return; }
    const n = h('div', { class: 'ui-tile-num tone-urgent' });
    fill(box, n, h('div', { class: 'small muted' }, `${invoices.length} invoice${invoices.length === 1 ? '' : 's'} past due`),
      h('ul', { class: 'bl-w-list' }, invoices.slice(0, 3).map(i => h('li', null, link(`/billing/invoices/${enc(i.id)}`, null, h('span', { class: 'grow clamp1' }, i.client.name), h('span', { class: 'small tone-urgent t-num' }, `${i.daysOverdue}d · ${money(i.outstandingPence)}`))))),
      link('/billing/invoices?status=overdue', { class: 'ui-tile-action' }, 'Chase', icon('chevron_right', 16)));
    countUp(n, total, { format: v => money(Math.round(v)) });
  },
});

registerSettingsSection({ id: 'billing', label: 'Billing', icon: 'receipt_long', order: 40, render: box => billingSettings(box) });

registerClientTab({ key: 'billing', label: 'Billing', order: 60, render: (box, { client, view }) => clientBillingTab(box, client, view) });

// Live: refresh what is on screen when money moves.
let redraw = null;
live.on('*', e => { if (redraw && /^(invoice|payment|refund|package|billing)\./.test(e.type ?? '')) redraw(); });
window.addEventListener('bl-changed', () => redraw?.());

// MARK: - /billing

const TABS = [['overview', 'Overview'], ['invoices', 'Invoices'], ['payments', 'Payments'], ['packages', 'Packages'], ['schedules', 'Schedules'], ['settings', 'Settings']];

route('/billing/:tab?', async (el, params, view) => {
  const tab = TABS.some(t => t[0] === params.tab) ? params.tab : 'overview';
  if (tab !== 'overview') setCrumbs([{ label: 'Billing', path: '/billing' }, { label: TABS.find(t => t[0] === tab)[1] }]);
  const sub = h('p', { class: 'ui-head-sub' }, ' ');
  const exportBtn = h('button', { type: 'button', class: 'btn', onclick: e => exportPopover(e.currentTarget) }, icon('download', 18), 'Export');
  const head = pageHead({ eyebrow: 'Business', title: 'Billing', accent: tab === 'overview' ? 'ledger' : null, actions: [exportBtn, h('button', { type: 'button', class: 'btn primary', onclick: () => invoiceWizard() }, icon('add', 18), 'New invoice')] });
  head.querySelector('.ui-head-text').append(sub);
  const body = h('div', { class: 'bl-body' }, skeleton(tab === 'overview' ? 'chart' : 'table', { rows: 6 }));
  el.append(head, tabs(TABS.map(([id, label]) => ({ id, label })), tab, id => go(id === 'overview' ? '/billing' : `/billing/${id}`), { label: 'Billing sections' }), body);
  const draw = async () => {
    try {
      if (tab === 'overview') await overview(body, sub, view);
      else if (tab === 'invoices') await invoicesTab(body, sub, view);
      else if (tab === 'payments') await paymentsTab(body, sub, view);
      else if (tab === 'packages') await packagesTab(body, sub, view);
      else if (tab === 'schedules') await schedulesTab(body, sub, view);
      else { sub.textContent = 'Your business details, bank details, numbering, VAT and reminders.'; await billingSettings(body); }
    } catch (err) { if (view.fresh()) fill(body, errorLine(err)); }
  };
  redraw = () => { if (view.fresh()) draw(); };
  view.onLeave(() => { redraw = null; });
  await draw();
}, { nav: 'billing' });

function exportPopover(anchor) {
  popover(anchor, (box, close) => {
    let from = addDays(todayLondon(), -365), to = todayLondon();
    const status = h('div', { role: 'status' });
    const go2 = button('Download CSV', () => busy(go2, status, async () => { await downloadCsv(from, to); close(); }), { kind: 'primary', small: true });
    box.append(h('div', { class: 'bl-export' },
      h('div', { class: 'strong' }, 'Export for your accountant'),
      h('p', { class: 'small muted m0' }, 'One row per invoice, payment, credit note and refund. Up to two years.'),
      dateRange({ from, to, onChange: v => { from = v.from; to = v.to; } }),
      h('div', { class: 'row' }, button('This tax year', () => { const y = Number(todayLondon().slice(0, 4)); const start = todayLondon() >= `${y}-04-06` ? `${y}-04-06` : `${y - 1}-04-06`; from = start; to = todayLondon(); go2.click(); }, { small: true }), go2),
      status));
  }, { label: 'Export', className: 'bl-pop' });
}

// MARK: - Overview (bento)

async function overview(body, sub, view) {
  const [o, overdue] = await Promise.all([api('GET', '/api/billing/overview'), api('GET', '/api/billing/invoices?status=overdue')]);
  if (!view.fresh()) return;
  const monthWord = new Date().toLocaleDateString('en-GB', { month: 'long', timeZone: 'Europe/London' });
  sub.textContent = `${money(o.outstandingPence)} outstanding · ${o.overdueCount} overdue · ${money(o.collectedMonthPence)} collected in ${monthWord}`;
  const delta = o.collectedLastMonthToDatePence ? Math.round(((o.collectedMonthPence - o.collectedLastMonthToDatePence) / o.collectedLastMonthToDatePence) * 100) : null;

  const heroNum = h('div', { class: 'bl-hero-n t-num' });
  const hero = tile({ id: 'outstanding', eyebrow: 'Outstanding', title: 'Owed to you now', icon: 'account_balance_wallet', size: 'l', tall: true, hero: true, body: [
    heroNum,
    h('div', { class: 'bl-hero-split' },
      h('div', null, h('div', { class: 'bl-k' }, 'Overdue'), h('div', { class: 'bl-v tone-urgent t-num' }, money(o.overduePence))),
      h('div', null, h('div', { class: 'bl-k' }, 'Not yet due'), h('div', { class: 'bl-v t-num' }, money(o.outstandingPence - o.overduePence))),
      h('div', null, h('div', { class: 'bl-k' }, 'Drafts waiting'), h('div', { class: 'bl-v t-num' }, String(o.draftCount)))),
    h('div', { class: 'bl-hero-chart' }, barChart({ bars: o.collectedSeries.map((m, i) => ({ label: new Date(`${m.month}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }), value: m.pence / 100, tone: i === o.collectedSeries.length - 1 ? 1 : 6 })),
      height: 150, yFormat: v => `£${Math.round(v).toLocaleString('en-GB')}`, ariaLabel: 'Collected per month, last six months' })),
    h('div', { class: 'bl-hero-cap small muted' }, 'Collected per month, last six months'),
  ] });
  countUp(heroNum, o.outstandingPence, { format: v => money(Math.round(v)) });

  const statTile = (id, eyebrow, glyph, pence, line, tone = null, path = null) => {
    const n = h('div', { class: `ui-tile-num${tone ? ` tone-${tone}` : ''}` });
    countUp(n, pence, { format: v => money(Math.round(v)) });
    return tile({ id, eyebrow, icon: glyph, size: 's', body: [n, h('div', { class: 'small muted bl-stat-line' }, line)], action: path ? { label: 'View', path } : null });
  };
  const tiles = [
    hero,
    statTile('overdue', 'Overdue', 'warning', o.overduePence, o.overdueCount ? `${o.overdueCount} invoice${o.overdueCount === 1 ? '' : 's'} past due` : 'Nothing late', o.overduePence ? 'urgent' : null, '/billing/invoices?status=overdue'),
    statTile('collected', 'Collected this month', 'payments', o.collectedMonthPence, delta === null ? 'First month on record' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% on last month to date`, 'ok'),
    statTile('scheduled', 'Next 30 days', 'event_repeat', o.scheduled30Pence, `${o.scheduled30Count} scheduled invoice${o.scheduled30Count === 1 ? '' : 's'}`, null, '/billing/schedules'),
    tile({ id: 'drafts', eyebrow: 'Drafts', icon: 'edit_note', size: 's', action: { label: 'View', path: '/billing/invoices?status=draft' },
      body: [h('div', { class: 'ui-tile-num' }, String(o.draftCount)), h('div', { class: 'small muted bl-stat-line' }, o.draftCount ? `waiting for you to check and send` : 'Nothing waiting')] }),
  ];

  const agedTotal = Object.values(o.aged).reduce((a, b) => a + b, 0) || 1;
  const bands = [['d30', '0–30 days', 'data'], ['d60', '31–60 days', 'attention'], ['d90', '61–90 days', 'attention'], ['older', '90+ days', 'urgent']];
  tiles.push(tile({ id: 'aged', eyebrow: 'Aged debt', title: 'How long it has been owed', icon: 'hourglass_empty', size: 'l', body: [
    h('div', { class: 'bl-aged-stack', role: 'img', 'aria-label': bands.map(([k, l]) => `${l}: ${money(o.aged[k])}`).join(', ') },
      bands.map(([k, , tone]) => (o.aged[k] ? h('span', { class: `bl-aged-seg bg-${tone}`, style: { '--w': `${(o.aged[k] / agedTotal) * 100}%` } }) : null))),
    h('ul', { class: 'bl-aged' }, bands.map(([k, label, tone]) => h('li', null,
      h('span', { class: `bl-aged-dot bg-${tone}` }), h('span', { class: 'grow' }, label),
      h('span', { class: 'bl-aged-bar' }, h('span', { class: `bl-aged-fill bg-${tone}`, style: { '--w': `${(o.aged[k] / agedTotal) * 100}%` } })),
      h('b', { class: 't-num' }, money(o.aged[k]))))),
  ] }));

  const chase = overdue.invoices.slice(0, 6);
  tiles.push(tile({ id: 'chase', eyebrow: 'Needs chasing', title: chase.length ? 'Overdue, oldest first' : 'Nothing to chase', icon: 'schedule_send', size: 'l', body: chase.length
    ? h('ul', { class: 'bl-chase' }, chase.sort((a, b) => b.daysOverdue - a.daysOverdue).map(i => h('li', null,
      avatar(i.client.initials, 32),
      h('div', { class: 'grow' }, h('div', { class: 'strong' }, i.client.name), h('div', { class: 'small muted' }, `${i.number} · ${i.daysOverdue} days overdue${i.remindersPaused ? ' · reminders paused' : ''}`)),
      h('b', { class: 't-num tone-urgent' }, money(i.outstandingPence)),
      h('button', { type: 'button', class: 'btn small', onclick: () => go(`/billing/invoices/${enc(i.id)}?chase=1`) }, 'Chase'))))
    : h('div', { class: 'bl-w-clear' }, icon('task_alt', 22), h('span', null, 'Everyone is up to date. Lovely.')) }));

  tiles.push(tile({ id: 'activity', eyebrow: 'Latest', title: 'Activity', icon: 'timeline', size: 'full', body: o.recent.length
    ? h('div', { class: 'bl-activity' }, timeline(o.recent.map(r => ({ at: r.at, icon: r.icon, tone: r.tone, title: r.title, detail: r.detail, path: r.path }))))
    : h('p', { class: 'muted' }, 'Payments and invoices will appear here.') }));

  const grid = h('div', { class: 'ui-bento bl-bento' }, tiles);
  fill(body, grid);
}

// MARK: - Invoices

const FILTERS = [['all', 'All'], ['draft', 'Drafts'], ['open', 'Open'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['void', 'Void']];

async function invoicesTab(body, sub, view) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  let status = FILTERS.some(f => f[0] === q.get('status')) ? q.get('status') : 'all';
  const tableBox = h('div');
  const counts = h('span', { class: 'small muted' });
  const load = async () => {
    const { invoices } = await api('GET', `/api/billing/invoices${status === 'all' ? '' : `?status=${status}`}`);
    if (!view.fresh()) return;
    const sum = invoices.reduce((n, i) => n + (status === 'paid' ? i.totalPence : i.outstandingPence), 0);
    counts.textContent = `${invoices.length} invoice${invoices.length === 1 ? '' : 's'} · ${money(sum)} ${status === 'paid' ? 'billed' : 'outstanding'}`;
    sub.textContent = 'Every invoice you have raised. Click one for a quick look; open it to edit, record payment or chase.';
    const t = dataTable({
      label: 'Invoices', rows: invoices, selectable: true, initialSort: { key: 'issued', dir: -1 }, empty: status === 'all' ? 'No invoices yet. Raise your first with New invoice.' : 'Nothing in this view.',
      onRow: r => go(`/billing/invoices/${enc(r.id)}`),
      columns: [
        { key: 'number', label: 'Number', sort: r => r.number ?? '', render: r => h('button', { type: 'button', class: 'bl-num-btn', title: 'Quick look', onclick: e => { e.stopPropagation(); openInvoicePanel(r.id); } }, r.number ?? 'Draft') },
        { key: 'client', label: 'Client', sort: r => r.client?.name ?? '', render: r => clientChip(r.client) },
        { key: 'issued', label: 'Issued', sort: r => r.issueOn ?? r.createdAt, render: r => (r.issueOn ? fmtDay(r.issueOn) : h('span', { class: 'faint' }, 'not yet')) },
        { key: 'due', label: 'Due', sort: r => r.dueOn ?? '', render: r => (r.dueOn ? h('span', { class: r.displayStatus === 'overdue' ? 'tone-urgent' : '' }, fmtDay(r.dueOn)) : '—') },
        { key: 'total', label: 'Total', align: 'right', sort: r => r.totalPence, render: r => h('span', { class: 't-num' }, money(r.totalPence)) },
        { key: 'paid', label: 'Paid', align: 'right', sort: r => r.paidPence, render: r => h('span', { class: 't-num muted' }, r.paidPence ? money(r.paidPence) : '—') },
        { key: 'status', label: 'Status', sort: r => r.displayStatus, render: r => statusPill(r.displayStatus, { detail: r.displayStatus === 'overdue' ? `${r.daysOverdue}d` : null }) },
      ],
      bulkActions: [
        { label: 'Send reminders', icon: 'schedule_send', run: async rows => { const out = await api('POST', '/api/billing/invoices/bulk', { ids: rows.map(r => r.id), action: 'remind' }); toast(`${out.done} reminder${out.done === 1 ? '' : 's'} sent${out.skipped ? ` · ${out.skipped} skipped` : ''}`); load(); } },
        { label: 'Void drafts', icon: 'block', run: async rows => {
          if (!(await confirmBox(`Void ${rows.filter(r => r.status === 'draft').length} draft(s)?`, { ok: 'Void', danger: true, detail: 'Only drafts are voided; anything already issued is left alone.' }))) return;
          const out = await api('POST', '/api/billing/invoices/bulk', { ids: rows.map(r => r.id), action: 'voidDrafts' }); toast(`${out.done} voided`); load();
        } },
      ],
    });
    fill(tableBox, t.el);
  };
  fill(body,
    h('div', { class: 'bl-toolbar' }, segmentedNav(FILTERS, status, v => { status = v; load(); }, { label: 'Filter invoices' }), h('span', { class: 'grow' }), counts),
    tableBox);
  await load();
}

/** The invoice slide-over (from lists and the palette): who, what, status and the main actions. */
export const openInvoicePanel = id => openPanel('invoice', id);

async function invoicePanel(id, body, close, setTitle) {
  body.append(skeleton('card', { rows: 5 }));
  try {
    const d = await api('GET', `/api/billing/invoices/${enc(id)}`);
    const i = d.invoice;
    setTitle(i.number ?? 'Draft invoice');
    fill(body,
      h('div', { class: 'bl-panel-head' }, avatar(i.client.initials, 44), h('div', { class: 'grow' }, h('div', { class: 'strong' }, i.client.name), h('div', { class: 'small muted' }, i.issueOn ? `Issued ${fmtDay(i.issueOn)} · due ${fmtDay(i.dueOn)}` : 'Not issued yet')), statusPill(i.displayStatus)),
      bigMoney(i.totalPence, { caption: i.outstandingPence && i.status !== 'draft' ? `${money(i.outstandingPence)} outstanding` : i.status === 'paid' ? 'Paid in full' : null }),
      h('ul', { class: 'bl-panel-lines' }, d.lines.map(l => h('li', null, h('span', { class: 'grow' }, l.description, h('span', { class: 'small muted' }, ` · ${l.quantity} × ${money(l.unitPence)}`)), h('b', { class: 't-num' }, money(l.amountPence))))),
      h('div', { class: 'bl-panel-tl' }, timeline(d.events.slice(-5).reverse().map(e => ({ at: e.at, title: e.title, detail: e.detail, icon: { payment: 'payments', paid: 'check_circle', issued: 'receipt_long', sent: 'send', reminder: 'schedule_send', void: 'block', credit: 'undo' }[e.kind] ?? 'edit_note' })))),
      h('div', { class: 'row' },
        link(`/billing/invoices/${enc(id)}`, { class: 'btn primary', onclick: () => close() }, 'Open invoice'),
        ['issued'].includes(i.status) ? h('button', { type: 'button', class: 'btn', onclick: async () => { const out = await recordPaymentSheet({ client: i.client, invoice: i }); if (out) { close(); window.dispatchEvent(new CustomEvent('bl-changed')); } } }, icon('payments', 16), 'Record payment') : null));
  } catch (err) { fill(body, errorLine(err)); }
}

// MARK: - Payments

async function paymentsTab(body, sub, view) {
  const { payments, creditNotes, refunds } = await api('GET', '/api/billing/payments');
  if (!view.fresh()) return;
  const live = payments.filter(p => !p.voidedAt);
  sub.textContent = `${live.length} payments recorded · ${money(live.reduce((n, p) => n + p.amountPence, 0))} in total`;
  const byMethod = METHODS.map(([m, l]) => ({ m, l, n: live.filter(p => p.method === m).reduce((s, p) => s + p.amountPence, 0) })).filter(x => x.n);
  const recordBtn = h('button', { type: 'button', class: 'btn', onclick: async () => {
    const list = await clients();
    const c = await pickClient(list);
    if (!c) return;
    const out = await recordPaymentSheet({ client: c });
    if (out) paymentsTab(body, sub, view);
  } }, icon('add', 16), 'Payment on account');
  const pays = dataTable({
    label: 'Payments', rows: payments, initialSort: { key: 'received', dir: -1 }, empty: 'No payments recorded yet.',
    onRow: r => (r.invoiceId ? go(`/billing/invoices/${enc(r.invoiceId)}`) : go(`/clients/${enc(r.clientId)}/billing`)),
    columns: [
      { key: 'received', label: 'Received', sort: r => r.receivedOn, render: r => fmtDay(r.receivedOn) },
      { key: 'client', label: 'Client', sort: r => r.client?.name ?? '', render: r => clientChip(r.client) },
      { key: 'invoice', label: 'For', sort: r => r.invoiceNumber ?? '', render: r => (r.invoiceNumber ? h('span', { class: 't-num' }, r.invoiceNumber) : h('span', { class: 'muted' }, 'On account')) },
      { key: 'method', label: 'Method', sort: r => r.method, render: r => methodLabel(r.method) },
      { key: 'reference', label: 'Reference', render: r => h('span', { class: 'muted clamp1' }, r.reference || '—') },
      { key: 'amount', label: 'Amount', align: 'right', sort: r => r.amountPence, render: r => (r.voidedAt ? h('s', { class: 'faint t-num' }, money(r.amountPence)) : h('b', { class: 't-num tone-ok' }, money(r.amountPence))) },
      { key: 'x', label: '', align: 'right', render: r => (r.voidedAt ? h('span', { class: 'small faint' }, 'removed') : h('button', { type: 'button', class: 'ui-icon-btn small', 'aria-label': 'Remove payment', onclick: async e => {
        e.stopPropagation();
        if (!(await confirmBox(`Remove the ${money(r.amountPence)} payment?`, { ok: 'Remove', danger: true, detail: 'It stays in the ledger as removed, and the invoice goes back to unpaid.' }))) return;
        await api('DELETE', `/api/billing/payments/${enc(r.id)}`);
        toast('Payment removed', { undo: null });
        paymentsTab(body, sub, view);
      } }, icon('close', 16))) },
    ],
  });
  const credits = dataTable({
    label: 'Credit notes', rows: creditNotes, filter: false, empty: 'No credit notes.',
    columns: [
      { key: 'createdAt', label: 'Raised', sort: true, render: r => fmtDay(r.createdAt.slice(0, 10)) },
      { key: 'client', label: 'Client', render: r => clientChip(r.client) },
      { key: 'reason', label: 'Reason', render: r => h('span', { class: 'clamp1' }, r.reason) },
      { key: 'amount', label: 'Amount', align: 'right', render: r => h('span', { class: 't-num' }, money(r.amountPence)) },
      { key: 'refund', label: 'Refunded', align: 'right', render: r => (r.refundedPence >= r.amountPence ? h('span', { class: 'small tone-ok row gap4' }, icon('check', 14), 'in full') : h('button', { type: 'button', class: 'btn small', onclick: async () => { if (await refundSheet({ creditNote: r })) paymentsTab(body, sub, view); } }, r.refundedPence ? `${money(r.refundedPence)} · refund more` : 'Record refund')) },
    ],
  });
  fill(body,
    h('div', { class: 'bl-method-strip' }, byMethod.map(x => h('div', { class: 'bl-method-chip' }, h('span', { class: 'small muted' }, x.l), h('b', { class: 't-num' }, money(x.n)))), h('span', { class: 'grow' }), recordBtn),
    pays.el,
    h('h2', { class: 'bl-section' }, 'Credit notes and refunds', h('span', { class: 'small muted' }, ` · ${refunds.filter(r => !r.voidedAt).length} refund${refunds.length === 1 ? '' : 's'} recorded`)),
    credits.el);
}

/** A small client picker sheet. Resolves with a client or undefined. */
export function pickClient(list, title = 'Which client?') {
  return sheet(title, (body, close) => {
    const q = h('input', { type: 'search', placeholder: 'Find a client', 'aria-label': 'Find a client', class: 'bl-find' });
    const box = h('div', { class: 'bl-pick' });
    const draw = () => fill(box, list.filter(c => c.name.toLowerCase().includes(q.value.trim().toLowerCase())).map(c => h('button', { type: 'button', class: 'bl-pick-row', onclick: () => close(c) }, avatar(c.initials || c.name, 32), h('span', { class: 'grow strong' }, c.name))));
    q.addEventListener('input', draw);
    body.append(q, box);
    draw();
    requestAnimationFrame(() => q.focus());
  });
}

// MARK: - Packages

async function packagesTab(body, sub, view) {
  const { packages } = await api('GET', '/api/billing/packages');
  if (!view.fresh()) return;
  sub.textContent = 'Session packs you sell. Credits come off automatically when a client books beyond their plan.';
  const add = h('button', { type: 'button', class: 'btn', onclick: async () => { if (await packageSheet()) packagesTab(body, sub, view); } }, icon('add', 16), 'New package');
  const kind = { any: 'Any session', inperson: 'In person', video: 'Video', group: 'Group class' };
  fill(body,
    h('div', { class: 'bl-toolbar' }, h('span', { class: 'grow small muted' }, `${packages.filter(p => p.active).length} on sale`), add),
    packages.length ? h('div', { class: 'bl-packs' }, packages.map(p => h('article', { class: `bl-pack${p.active ? '' : ' off'}` },
      h('div', { class: 'bl-pack-top' },
        h('div', { class: 'bl-pack-sessions' }, h('span', { class: 'bl-pack-n' }, String(p.sessions)), h('span', { class: 'small muted' }, p.sessions === 1 ? 'session' : 'sessions')),
        h('div', { class: 'grow' }, h('h3', null, p.name), h('div', { class: 'small muted' }, p.description || kind[p.bookingKind])),
        p.active ? null : statusPill('ended')),
      h('div', { class: 'bl-pack-price' }, h('span', { class: 'bl-pack-amount t-num' }, money(p.pricePence)), h('span', { class: 'small muted' }, ` · ${money(p.unitPence)} a session`)),
      h('div', { class: 'bl-pack-meta' }, h('span', { class: 'chip' }, icon('schedule', 14), `Valid ${p.validDays} days`), h('span', { class: 'chip' }, icon(p.bookingKind === 'video' ? 'videocam' : 'group', 14), kind[p.bookingKind]),
        h('span', { class: 'chip' }, `${p.sold} sold · ${p.activeCount} active`)),
      h('div', { class: 'row end' },
        h('button', { type: 'button', class: 'btn small text', onclick: async () => { if (await packageSheet(p)) packagesTab(body, sub, view); } }, 'Edit'),
        p.active ? h('button', { type: 'button', class: 'btn small', onclick: async () => { if (await sellSheet(p)) packagesTab(body, sub, view); } }, icon('sell', 16), 'Sell to client') : null))))
      : emptyHero({ icon: 'inventory_2', title: 'No packages yet.', line: 'Make a session pack (say, 10 × 1:1 valid 3 months) and sell it from here or the client’s Billing tab.', action: { label: 'New package', onclick: () => add.click() } }));
}

function packageSheet(p = null) {
  return sheet(p ? `Edit ${p.name}` : 'New package', (body, close) => {
    const v = { name: p?.name ?? '', description: p?.description ?? '', sessions: p?.sessions ?? 10, pricePence: p?.pricePence ?? null, validDays: p?.validDays ?? 90, bookingKind: p?.bookingKind ?? 'inperson', active: p?.active ?? true };
    const status = h('div', { role: 'status' });
    body.append(
      field('Name', h('input', { value: v.name, maxlength: '80', placeholder: '10 × 1:1', oninput: e => { v.name = e.target.value; } })),
      field('Description', h('input', { value: v.description, maxlength: '300', placeholder: 'Valid 3 months', oninput: e => { v.description = e.target.value; } })),
      h('div', { class: 'grid3' },
        field('Sessions', h('input', { type: 'number', min: '1', max: '200', value: String(v.sessions), oninput: e => { v.sessions = Number(e.target.value); } })),
        field('Price', moneyInput({ value: v.pricePence, label: 'Price', onChange: x => { v.pricePence = x; } })),
        field('Valid (days)', h('input', { type: 'number', min: '1', max: '1000', value: String(v.validDays), oninput: e => { v.validDays = Number(e.target.value); } }))),
      field('Counts for', h('select', { onchange: e => { v.bookingKind = e.target.value; } }, [['inperson', 'In-person 1:1s'], ['video', 'Video calls'], ['group', 'Group classes'], ['any', 'Any session']].map(([k, l]) => h('option', { value: k, selected: k === v.bookingKind }, l)))),
      p ? h('label', { class: 'bl-check' }, h('input', { type: 'checkbox', checked: v.active, onchange: e => { v.active = e.target.checked; } }), h('span', null, 'On sale')) : null,
      status);
    const del = p ? h('button', { type: 'button', class: 'btn text danger', onclick: async () => {
      if (!(await confirmBox(`Remove ${p.name}?`, { ok: 'Remove', danger: true, detail: p.sold ? 'It has been sold, so it is switched off instead; clients keep their credits.' : 'It has never been sold.' }))) return;
      await api('DELETE', `/api/billing/packages/${enc(p.id)}`); toast('Package removed'); close(true);
    } }, 'Remove') : null;
    const save = button(p ? 'Save' : 'Create package', () => busy(save, status, async () => {
      if (p) await api('PUT', `/api/billing/packages/${enc(p.id)}`, v); else await api('POST', '/api/billing/packages', v);
      toast(p ? 'Package saved' : 'Package created'); close(true);
    }), { kind: 'primary' });
    return h('div', { class: 'spread' }, del ?? h('span'), h('div', { class: 'row' }, button('Cancel', () => close()), save));
  });
}

async function sellSheet(p, client = null) {
  const list = client ? [client] : await clients();
  return sheet(`Sell ${p.name}`, (body, close) => {
    let clientId = client?.id ?? null, startsOn = todayLondon(), invoice = true, issue = true;
    const status = h('div', { role: 'status' });
    body.append(
      h('div', { class: 'bl-sell-sum' }, h('span', { class: 'bl-pack-n' }, String(p.sessions)), h('div', { class: 'grow' }, h('div', { class: 'strong' }, p.name), h('div', { class: 'small muted' }, `${money(p.pricePence)} · valid ${p.validDays} days`))),
      client ? null : field('Client', h('select', { onchange: e => { clientId = e.target.value; } }, h('option', { value: '' }, 'Choose…'), list.map(c => h('option', { value: c.id }, c.name)))),
      field('Starts on', dateField({ value: startsOn, label: 'Starts on', onChange: x => { startsOn = x; } })),
      h('label', { class: 'bl-check' }, h('input', { type: 'checkbox', checked: true, onchange: e => { invoice = e.target.checked; } }), h('span', null, 'Raise an invoice for it')),
      h('label', { class: 'bl-check' }, h('input', { type: 'checkbox', checked: true, onchange: e => { issue = e.target.checked; } }), h('span', null, 'Issue and send it now')),
      status);
    const save = button('Sell package', () => busy(save, status, async () => {
      if (!clientId) throw new Error('Choose a client');
      await api('POST', `/api/billing/packages/${enc(p.id)}/sell`, { clientId, startsOn, invoice, issue: invoice && issue });
      toast(`${p.name} sold`); close(true);
    }), { kind: 'primary' });
    return h('div', { class: 'row end' }, button('Cancel', () => close()), save);
  });
}

// MARK: - Schedules

async function schedulesTab(body, sub, view) {
  const [{ schedules }, { discounts }] = await Promise.all([api('GET', '/api/billing/schedules'), api('GET', '/api/offers/discounts').catch(() => ({ discounts: [] }))]);
  if (!view.fresh()) return;
  const active = schedules.filter(s => s.status === 'active');
  sub.textContent = `${active.length} active · ${money(active.reduce((n, s) => n + s.monthlyPence, 0))} a month billed automatically`;
  const add = h('button', { type: 'button', class: 'btn', onclick: async () => { if (await scheduleSheet({ discounts })) schedulesTab(body, sub, view); } }, icon('add', 16), 'New schedule');
  const patch = async (s, change, word) => { await api('PATCH', `/api/billing/schedules/${enc(s.id)}`, change); toast(word); schedulesTab(body, sub, view); };
  fill(body,
    h('div', { class: 'bl-toolbar' }, h('span', { class: 'grow small muted' }, 'Paused clients are never billed; resuming moves the next date forward with no back-billing.'), add),
    schedules.length ? h('div', { class: 'bl-scheds' }, schedules.map(s => h('article', { class: `bl-sched bl-sched-${s.status}` },
      h('div', { class: 'bl-sched-who' }, clientChip(s.client), statusPill(s.status, { detail: s.status === 'paused' && s.pausedUntil ? `until ${fmtDay(s.pausedUntil)}` : null })),
      h('div', { class: 'bl-sched-main' },
        h('div', null, h('div', { class: 'strong' }, s.label), h('div', { class: 'small muted' }, `${money(s.amountPence)} every ${INTERVAL_LABEL[s.interval]}${s.endsOn ? ` · ends ${fmtDay(s.endsOn)}` : ''}`)),
        s.discount ? h('span', { class: 'chip' }, icon('percent', 14), `${s.discount.name}${s.discountCycles ? ` · ${Math.max(0, s.discountCycles - s.discountUsed)} of ${s.discountCycles} left` : ''}`) : null),
      h('div', { class: 'bl-sched-next' }, h('span', { class: 'small muted' }, s.status === 'ended' ? 'Finished' : 'Next'),
        s.preview.map((d, i) => h('span', { class: `bl-date${i === 0 ? ' first' : ''}` }, fmtDay(d)))),
      h('div', { class: 'row end bl-sched-actions' },
        s.status === 'active' ? h('button', { type: 'button', class: 'btn small', onclick: () => patch(s, { status: 'paused' }, 'Schedule paused') }, icon('pause', 16), 'Pause') : null,
        s.status === 'paused' ? h('button', { type: 'button', class: 'btn small', onclick: () => patch(s, { status: 'active' }, 'Schedule resumed') }, icon('play_arrow', 16), 'Resume') : null,
        s.status !== 'ended' ? h('button', { type: 'button', class: 'btn small text', onclick: async () => { if (await confirmBox(`End ${s.label} for ${s.client.name}?`, { ok: 'End schedule', danger: true, detail: 'No further invoices are raised. A new schedule can be made later.' })) patch(s, { status: 'ended' }, 'Schedule ended'); } }, 'End') : null))))
      : emptyHero({ icon: 'event_repeat', title: 'No recurring billing yet.', line: 'Monthly memberships can invoice themselves on schedule, with an introductory discount for the first few months.', action: { label: 'New schedule', onclick: () => add.click() } }));
}

async function scheduleSheet({ discounts = [], client = null } = {}) {
  const list = client ? [client] : await clients();
  return sheet('New recurring schedule', (body, close) => {
    const v = { clientId: client?.id ?? null, label: 'Monthly coaching', amountPence: null, interval: 'month', nextOn: addDays(todayLondon(), 1), endsOn: '', discountId: '', discountCycles: 3 };
    const status = h('div', { role: 'status' });
    const preview = h('div', { class: 'bl-sched-next' });
    const drawPreview = () => {
      const days = [];
      let d = v.nextOn;
      for (let i = 0; i < 3 && d; i++) {
        days.push(d);
        if (v.interval === 'week') d = addDays(d, 7); else if (v.interval === 'fourWeeks') d = addDays(d, 28); else { const [y, m, dd] = d.split('-').map(Number); const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); d = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`; }
      }
      fill(preview, h('span', { class: 'small muted' }, 'First invoices'), days.map((x, i) => h('span', { class: `bl-date${i === 0 ? ' first' : ''}` }, fmtDay(x))));
    };
    body.append(
      client ? null : field('Client', h('select', { onchange: e => { v.clientId = e.target.value; } }, h('option', { value: '' }, 'Choose…'), list.map(c => h('option', { value: c.id }, c.name)))),
      field('Label', h('input', { value: v.label, maxlength: '120', oninput: e => { v.label = e.target.value; } })),
      h('div', { class: 'grid2' },
        field('Amount', moneyInput({ label: 'Amount', onChange: x => { v.amountPence = x; } })),
        field('Every', h('select', { onchange: e => { v.interval = e.target.value; drawPreview(); } }, Object.entries(INTERVAL_LABEL).map(([k, l]) => h('option', { value: k, selected: k === v.interval }, l))))),
      h('div', { class: 'grid2' },
        field('First invoice on', dateField({ value: v.nextOn, label: 'First invoice on', onChange: x => { v.nextOn = x; drawPreview(); } })),
        field('Ends on (optional)', dateField({ value: '', label: 'Ends on', onChange: x => { v.endsOn = x; } }))),
      discounts.length ? h('div', { class: 'grid2' },
        field('Introductory discount', h('select', { onchange: e => { v.discountId = e.target.value; } }, h('option', { value: '' }, 'None'), discounts.filter(d => d.active && !d.client).map(d => h('option', { value: d.id }, `${d.name} · ${d.label}`)))),
        field('For the first', h('input', { type: 'number', min: '1', max: '120', value: '3', oninput: e => { v.discountCycles = Number(e.target.value) || null; } }), 'invoices')) : null,
      preview, status);
    drawPreview();
    const save = button('Start schedule', () => busy(save, status, async () => {
      if (!v.clientId) throw new Error('Choose a client');
      await api('POST', '/api/billing/schedules', { clientId: v.clientId, label: v.label, amountPence: v.amountPence, interval: v.interval, nextOn: v.nextOn, endsOn: v.endsOn || undefined,
        discountId: v.discountId || undefined, discountCycles: v.discountId ? v.discountCycles : undefined });
      toast('Schedule started'); close(true);
    }), { kind: 'primary' });
    return h('div', { class: 'row end' }, button('Cancel', () => close()), save);
  });
}

// MARK: - Settings (also Settings › Billing)

async function billingSettings(box) {
  const { settings: s } = await api('GET', '/api/billing/settings');
  const v = structuredClone(s);
  const status = h('div', { role: 'status' });
  const input = (k, attrs = {}) => h('input', { value: v[k] ?? '', oninput: e => { v[k] = e.target.value; }, ...attrs });
  const area = (k, attrs = {}) => h('textarea', { rows: '3', oninput: e => { v[k] = e.target.value; }, ...attrs }, v[k] ?? '');
  const steps = h('div', { class: 'bl-dunning' });
  const tpl = { gentle: ['Gentle reminder', 'Sends the gentle text'], firm: ['Firm reminder', 'Sends the firm text'], coach: ['Tell me', 'No message: notifies you and makes a task'] };
  const drawSteps = () => fill(steps, v.dunning.map((st, i) => h('div', { class: 'bl-dun-step' },
    h('span', { class: 'bl-dun-n' }, String(i + 1)),
    h('input', { type: 'number', min: '0', max: '180', value: String(st.day), class: 'bl-dun-day', 'aria-label': `Step ${i + 1}: days after due`, oninput: e => { st.day = Number(e.target.value); } }),
    h('span', { class: 'small muted' }, 'days after due:'),
    h('select', { 'aria-label': `Step ${i + 1}: what happens`, onchange: e => { st.template = e.target.value; drawSteps(); } }, Object.entries(tpl).map(([k, [l]]) => h('option', { value: k, selected: k === st.template }, l))),
    h('span', { class: 'small faint grow' }, tpl[st.template][1]),
    h('button', { type: 'button', class: 'ui-icon-btn small', 'aria-label': `Remove step ${i + 1}`, onclick: () => { v.dunning.splice(i, 1); drawSteps(); } }, icon('close', 16)))),
  v.dunning.length < 6 ? h('button', { type: 'button', class: 'btn small text', onclick: () => { v.dunning.push({ day: (v.dunning.at(-1)?.day ?? 0) + 7, template: 'firm' }); drawSteps(); } }, icon('add', 16), 'Add a step') : null);
  drawSteps();
  const text = (k, label, hint) => field(label, h('textarea', { rows: '3', maxlength: '1000', oninput: e => { v.texts[k] = e.target.value; } }, v.texts[k]), hint);
  const save = button('Save billing settings', () => busy(save, status, async () => {
    const out = await api('PUT', '/api/billing/settings', { businessName: v.businessName, address: v.address, paymentDetails: v.paymentDetails, invoicePrefix: v.invoicePrefix, dueDays: Number(v.dueDays),
      vatRateBp: Math.round(Number(v.vatPct ?? v.vatRateBp / 100) * 100), vatNumber: v.vatNumber, footer: v.footer, autoIssueRecurring: !!v.autoIssueRecurring, dunning: v.dunning.map(x => ({ day: Number(x.day), template: x.template })), texts: v.texts });
    Object.assign(v, structuredClone(out.settings));
    toast('Billing settings saved');
  }), { kind: 'primary' });
  fill(box, h('div', { class: 'bl-settings' },
    h('section', { class: 'bl-set-card' }, h('h2', null, icon('storefront', 18), 'On your invoices'),
      h('div', { class: 'grid2' }, field('Business name', input('businessName', { maxlength: '120', placeholder: 'JK Performance' })), field('VAT number', input('vatNumber', { maxlength: '40', placeholder: 'Leave blank if not registered' }))),
      field('Address', area('address', { maxlength: '400' })),
      field('Payment details', area('paymentDetails', { maxlength: '400', placeholder: 'Bank · sort code · account number' }), 'Shown on every invoice and in the message that sends it.'),
      field('Footer', area('footer', { maxlength: '400', rows: '2' }))),
    h('section', { class: 'bl-set-card' }, h('h2', null, icon('tune', 18), 'Numbering, terms and VAT'),
      h('div', { class: 'grid3' },
        field('Invoice prefix', input('invoicePrefix', { maxlength: '12' }), `Next: ${v.invoicePrefix}-${todayLondon().slice(0, 4)}-${String(v.nextNumber).padStart(4, '0')}`),
        field('Due after (days)', h('input', { type: 'number', min: '0', max: '120', value: String(v.dueDays), oninput: e => { v.dueDays = e.target.value; } })),
        field('VAT rate (%)', h('input', { type: 'number', min: '0', max: '25', step: '0.5', value: String(v.vatRateBp / 100), oninput: e => { v.vatPct = e.target.value; } }), '0 until you register.')),
      h('label', { class: 'bl-check' }, h('input', { type: 'checkbox', checked: v.autoIssueRecurring, onchange: e => { v.autoIssueRecurring = e.target.checked; } }),
        h('span', null, h('b', null, 'Issue recurring invoices automatically'), h('span', { class: 'small muted' }, ' · otherwise they wait as drafts and you are told')))),
    h('section', { class: 'bl-set-card' }, h('h2', null, icon('schedule_send', 18), 'Reminders when an invoice is late'),
      h('p', { class: 'small muted m0' }, 'Sent between 08:00 and 20:00, outside quiet hours, and they stop the moment it is paid. Each invoice can pause them.'),
      steps,
      text('gentle', 'Gentle text', 'Variables: {first} {invoiceNumber} {invoiceTotal} {invoiceDue} {daysOverdue}'),
      text('firm', 'Firm text'),
      text('receipt', 'Receipt text', 'Sent when you tick Send receipt: {first} {paymentAmount} {paymentDay} {invoiceNumber}')),
    h('div', { class: 'row end bl-set-save' }, status, save)));
}

// MARK: - Client 360 › Billing

async function clientBillingTab(box, client, view) {
  box.append(skeleton('card', { rows: 5 }));
  let d;
  try { d = await api('GET', `/api/coach/clients/${enc(client.id)}/billing`); } catch (err) { fill(box, errorLine(err)); return; }
  if (!view.fresh()) return;
  const who = { id: client.id, name: client.name, initials: client.initials };
  const reload = () => { fill(box); clientBillingTab(box, client, view); };
  const bal = d.balancePence;
  const actions = h('div', { class: 'row' },
    h('button', { type: 'button', class: 'btn primary', onclick: () => invoiceWizard({ clientId: client.id }) }, icon('add', 16), 'New invoice'),
    h('button', { type: 'button', class: 'btn', onclick: async () => { if (await recordPaymentSheet({ client: who })) reload(); } }, icon('payments', 16), 'Record payment'),
    h('button', { type: 'button', class: 'btn', onclick: e => menu(e.currentTarget, [
      { label: 'Sell a package', icon: 'inventory_2', onclick: async () => { const { packages } = await api('GET', '/api/billing/packages'); const p = packages.find(x => x.active); if (!p) { toast('Make a package first, in Billing › Packages'); return; } const pick = await choosePackage(packages.filter(x => x.active)); if (pick && await sellSheet(pick, who)) reload(); } },
      { label: 'Start recurring billing', icon: 'event_repeat', onclick: async () => { const { discounts } = await api('GET', '/api/offers/discounts').catch(() => ({ discounts: [] })); if (await scheduleSheet({ discounts, client: who })) reload(); } },
      { label: 'Raise a credit note', icon: 'undo', onclick: async () => { if (await creditNoteSheet({ client: who })) reload(); } },
    ], { label: 'More billing actions' }) }, 'More', icon('expand_more', 16)));
  const pkgs = d.packages.filter(p => p.status === 'active');
  fill(box, h('div', { class: 'ui-bento bl-client-bento' },
    tile({ id: 'balance', eyebrow: bal > 0 ? 'Owes you' : bal < 0 ? 'In credit' : 'Balance', icon: 'account_balance_wallet', size: 'l', hero: true, body: [
      bigMoney(Math.abs(bal), { tone: bal > 0 && d.invoices.some(i => i.displayStatus === 'overdue') ? 'urgent' : null, caption: bal > 0 ? `${d.invoices.filter(i => i.outstandingPence > 0).length} open invoice(s)` : bal < 0 ? 'Account credit, used against their next invoice' : 'All square' }),
      h('div', { class: 'bl-hero-split' },
        h('div', null, h('div', { class: 'bl-k' }, 'Lifetime paid'), h('div', { class: 'bl-v t-num' }, money(d.ltvPence))),
        h('div', null, h('div', { class: 'bl-k' }, 'Plan'), h('div', { class: 'bl-v' }, d.plan.name ?? '—', d.plan.monthlyPence ? h('span', { class: 'small muted' }, ` · ${money(d.plan.monthlyPence)}/mo`) : null)),
        h('div', null, h('div', { class: 'bl-k' }, 'Recurring'), h('div', { class: 'bl-v t-num' }, d.schedules.filter(s => s.status === 'active').reduce((n, s) => n + s.monthlyPence, 0) ? `${money(d.schedules.filter(s => s.status === 'active').reduce((n, s) => n + s.monthlyPence, 0))}/mo` : '—'))),
      d.ended ? h('p', { class: 'small tone-attention row gap4' }, icon('stop_circle', 16), `Coaching ended ${fmtRelative(d.ended.at)}. ${d.ended.keepChasing ? 'Still chasing what is owed.' : 'Nothing is billed or chased.'}`) : null,
      actions] }),
    tile({ id: 'packages', eyebrow: 'Packages and recurring', icon: 'inventory_2', size: 'l', body: [
      pkgs.length ? h('div', { class: 'bl-meters' }, pkgs.map(p => h('div', { class: 'bl-meter' },
      h('div', { class: 'spread' }, h('span', { class: 'strong' }, p.name), h('span', { class: `small ${p.left <= 1 ? 'tone-attention' : 'muted'}` }, `${p.left} of ${p.sessionsTotal} left`)),
      progressBar((p.sessionsUsed / p.sessionsTotal) * 100, { tone: p.left <= 1 ? 'attention' : 'accent' }),
      h('div', { class: 'small muted' }, `Expires ${fmtDay(p.expiresOn)} · ${p.expiresInDays} days`, p.moves.length ? ` · last used ${fmtDay(p.moves.find(m => m.delta < 0)?.at?.slice(0, 10) ?? p.startsOn)}` : '')))) : h('div', { class: 'bl-w-clear' }, icon('inventory_2', 22), h('span', null, 'No active packages.')),
      h('div', { class: 'bl-k bl-sub-k' }, 'Recurring billing'),
      d.schedules.length ? h('ul', { class: 'bl-mini' }, d.schedules.map(s => h('li', null,
      h('div', { class: 'grow' }, h('div', { class: 'strong' }, s.label), h('div', { class: 'small muted' }, `${money(s.amountPence)} every ${INTERVAL_LABEL[s.interval]}${s.status === 'active' ? ` · next ${fmtDay(s.nextOn)}` : ''}`)), statusPill(s.status)))) : h('div', { class: 'bl-w-clear' }, icon('event_repeat', 22), h('span', null, 'No recurring billing.'))] }),
    tile({ id: 'invoices', eyebrow: 'Invoices', icon: 'receipt_long', size: 'xl', body: dataTable({ label: 'Invoices', rows: d.invoices, filter: false, onRow: r => go(`/billing/invoices/${enc(r.id)}`), empty: 'No invoices yet.',
      columns: [
        { key: 'number', label: 'Number', render: r => h('span', { class: 't-num' }, r.number ?? 'Draft') },
        { key: 'issueOn', label: 'Issued', render: r => (r.issueOn ? fmtDay(r.issueOn) : '—') },
        { key: 'dueOn', label: 'Due', render: r => (r.dueOn ? fmtDay(r.dueOn) : '—') },
        { key: 'total', label: 'Total', align: 'right', render: r => h('span', { class: 't-num' }, money(r.totalPence)) },
        { key: 'status', label: 'Status', render: r => statusPill(r.displayStatus) },
      ] }).el }),
    tile({ id: 'payments', eyebrow: 'Payments', icon: 'payments', size: 'm', body: d.payments.length ? h('ul', { class: 'bl-mini' }, d.payments.slice(0, 5).map(p => h('li', null,
      h('div', { class: 'grow' }, h('div', null, fmtDay(p.receivedOn)), h('div', { class: 'small muted' }, `${methodLabel(p.method)}${p.invoiceNumber ? ` · ${p.invoiceNumber}` : ' · on account'}`)), h('b', { class: `t-num ${p.voidedAt ? 'faint' : 'tone-ok'}` }, money(p.amountPence))))) : h('p', { class: 'muted' }, 'No payments yet.') })));
}

function choosePackage(list) {
  return sheet('Which package?', (body, close) => {
    body.append(h('div', { class: 'bl-pick' }, list.map(p => h('button', { type: 'button', class: 'bl-pick-row', onclick: () => close(p) },
      h('span', { class: 'bl-pack-n small' }, String(p.sessions)), h('span', { class: 'grow' }, h('span', { class: 'strong' }, p.name), h('span', { class: 'small muted' }, ` · ${money(p.pricePence)}`))))));
  });
}

