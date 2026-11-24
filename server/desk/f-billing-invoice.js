/*
 * WP3 Billing: /billing/invoices/:id (docs/design/desk-v2.md F9, F11). The
 * invoice as a sheet of paper (editable while it is a draft: lines with drag
 * to reorder, a discount code, due date and note), with the totals, the
 * status timeline, the reminders and the actions beside it: Issue and send,
 * Record payment, Remind, Credit note, Void, Duplicate and Print. Printing
 * switches the page to the light theme for the paper, then back.
 */
import { addDays, api, busy, button, confirmBox, errorLine, field, fill, firstName, fmtDay, fmtRelative, go, h, hashQuery, icon, link, route, setCrumbs, sheet, todayLondon, toast } from './core.js';
import { dateField, menu, pageHead, skeleton, timeline } from './ui.js';
import { clientChip, creditNoteSheet, enc, lineEditor, methodLabel, money, previewTotals, recordPaymentSheet, statusPill, totalsPanel } from './f-billing-common.js';

// The paper prints in the light theme, whatever the desk shows (no new colours: the light tokens).
let themeBeforePrint = undefined;
addEventListener('beforeprint', () => {
  if (!document.querySelector('.bl-paper')) return;
  themeBeforePrint = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', 'light');
  document.body.classList.add('bl-printing');
});
addEventListener('afterprint', () => {
  if (themeBeforePrint === undefined) return;
  if (themeBeforePrint === null) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', themeBeforePrint);
  themeBeforePrint = undefined;
  document.body.classList.remove('bl-printing');
});

const EVENT_ICON = { created: 'edit_note', issued: 'receipt_long', sent: 'send', payment: 'payments', paymentVoided: 'close', credit: 'undo', reminder: 'schedule_send', paid: 'check_circle', void: 'block' };
const EVENT_TONE = { paid: 'ok', payment: 'ok', reminder: 'attention', void: 'urgent' };

route('/billing/invoices/:id', async (el, { id }, view) => {
  el.append(skeleton('card', { rows: 8 }));
  let d;
  try { d = await api('GET', `/api/billing/invoices/${enc(id)}`); } catch (err) { if (view.fresh()) fill(el, errorLine(err), link('/billing/invoices', { class: 'btn' }, 'Back to invoices')); return; }
  if (!view.fresh()) return;
  draw(el, d, view);
  if (hashQuery().get('chase') === '1' && d.invoice.status === 'issued') remindSheet(d.invoice, () => reload(el, id, view));
}, { nav: 'billing' });

async function reload(el, id, view) {
  const d = await api('GET', `/api/billing/invoices/${enc(id)}`);
  if (view.fresh()) draw(el, d, view);
}

function draw(el, d, view) {
  const i = d.invoice;
  const s = d.settings;
  const draft = i.status === 'draft';
  const again = () => reload(el, i.id, view);
  setCrumbs([{ label: 'Billing', path: '/billing' }, { label: 'Invoices', path: '/billing/invoices' }, { label: i.number ?? 'Draft' }]);

  // Draft state the editor works on.
  const state = { lines: d.lines.map(l => ({ description: l.description, quantity: l.quantity, unitPence: l.unitPence, kind: l.kind, ref: l.ref })), dueOn: i.dueOn ?? (draft ? addDays(todayLondon(), s.dueDays) : ''), note: i.note, code: i.discount?.code ?? '', dirty: false, discountChanged: false };
  const totalsBox = h('div');
  const saveBtn = h('button', { type: 'button', class: 'btn', hidden: true, onclick: () => busy(saveBtn, null, () => saveDraft().then(() => toast('Draft saved'))) }, icon('check', 16), 'Save');
  const markDirty = () => { state.dirty = true; saveBtn.hidden = false; drawTotals(); };
  const drawTotals = () => fill(totalsBox, totalsPanel(draft ? previewTotals(state.lines, state.discountChanged ? 0 : i.discountPence, s.vatRateBp) : { subtotal: i.subtotalPence, discount: i.discountPence, tax: i.taxPence, total: i.totalPence },
    { vatRateBp: s.vatRateBp, paid: draft ? null : i.paidPence, credited: i.creditedPence, outstanding: draft || i.status === 'void' ? null : i.outstandingPence, discountName: i.discount?.name }));
  const saveDraft = async () => {
    const body = { lines: state.lines, dueOn: state.dueOn || null, note: state.note };
    if (state.discountChanged) body.discountCode = state.code || null;
    await api('PUT', `/api/billing/invoices/${enc(i.id)}`, body);
    state.dirty = false;
    await again();
  };

  // MARK: actions
  const primary = [];
  const more = [];
  if (draft) {
    primary.push(saveBtn, h('button', { type: 'button', class: 'btn primary', onclick: e => busy(e.currentTarget, null, async () => { if (state.dirty) await saveDraft(); await issue(true); }) }, icon('send', 16), 'Issue and send'));
    more.push({ label: 'Issue without sending', icon: 'receipt_long', onclick: () => issue(false).catch(err => toast(err.message, { error: true })) },
      { label: 'Duplicate', icon: 'content_copy', onclick: duplicate },
      'sep',
      { label: 'Delete draft', icon: 'close', danger: true, onclick: async () => { if (!(await confirmBox('Delete this draft?', { ok: 'Delete', danger: true }))) return; await api('DELETE', `/api/billing/invoices/${enc(i.id)}`); toast('Draft deleted'); go('/billing/invoices'); } });
  } else if (i.status === 'issued') {
    primary.push(h('button', { type: 'button', class: 'btn', onclick: () => remindSheet(i, again) }, icon('schedule_send', 16), 'Remind'),
      h('button', { type: 'button', class: 'btn primary', onclick: async () => { if (await recordPaymentSheet({ client: i.client, invoice: i })) again(); } }, icon('payments', 16), 'Record payment'));
    more.push({ label: 'Credit note', icon: 'undo', onclick: async () => { if (await creditNoteSheet({ client: i.client, invoice: i })) again(); } },
      { label: 'Duplicate', icon: 'content_copy', onclick: duplicate }, { label: 'Print or save PDF', icon: 'print', kbd: '⌘P', onclick: () => print() },
      'sep', { label: 'Void', icon: 'block', danger: true, disabled: i.paidPence > 0, detail: i.paidPence > 0 ? 'Has payments' : null, onclick: () => voidIt() });
  } else {
    primary.push(h('button', { type: 'button', class: 'btn', onclick: () => print() }, icon('print', 16), 'Print'));
    if (i.status === 'paid') more.push({ label: 'Credit note', icon: 'undo', onclick: async () => { if (await creditNoteSheet({ client: i.client, invoice: i })) again(); } });
    more.push({ label: 'Duplicate', icon: 'content_copy', onclick: duplicate });
  }
  const moreBtn = h('button', { type: 'button', class: 'ui-icon-btn', 'aria-label': 'More actions', 'aria-haspopup': 'menu', onclick: e => menu(e.currentTarget, more, { label: 'Invoice actions' }) }, icon('more_horiz', 20));
  async function issue(send) {
    await api('POST', `/api/billing/invoices/${enc(i.id)}/issue`, { send, dueOn: state.dueOn || undefined });
    toast(send ? `Issued and sent to ${firstName(i.client.name)}` : 'Issued');
    again();
  }
  async function duplicate() { const { invoice } = await api('POST', `/api/billing/invoices/${enc(i.id)}/duplicate`); toast('Copied to a new draft'); go(`/billing/invoices/${enc(invoice.id)}`); }
  async function voidIt() {
    const reason = await sheet(`Void ${i.number}?`, (body, close) => {
      const r = h('textarea', { rows: '2', maxlength: '300', placeholder: 'Raised in error' });
      body.append(h('p', { class: 'muted small m0' }, 'The number stays used and the invoice stays in the ledger, marked void.'), field('Reason', r));
      return h('div', { class: 'row end' }, button('Cancel', () => close()), button('Void invoice', () => close(r.value.trim() || 'Voided'), { kind: 'danger-fill' }));
    });
    if (!reason) return;
    await api('POST', `/api/billing/invoices/${enc(i.id)}/void`, { reason });
    toast('Invoice voided');
    again();
  }
  function print() { window.print(); }

  // MARK: the paper
  const lines = draft ? lineEditor({ lines: state.lines, onChange: ls => { state.lines = ls; markDirty(); } }) : lineEditor({ lines: state.lines, editable: false });
  const codeStatus = h('span', { class: 'small', role: 'status' }, i.discount ? h('span', { class: 'tone-ok row gap4' }, icon('sell', 14), `${i.discount.name}: ${money(i.discountPence)} off`) : null);
  const codeIn = h('input', { class: 'bl-code', value: state.code, placeholder: 'Code', maxlength: '40', 'aria-label': 'Discount code', oninput: e => { state.code = e.target.value.trim().toUpperCase(); state.discountChanged = true; markDirty(); fill(codeStatus, h('span', { class: 'muted' }, 'Applied when you save')); } });
  const paper = h('article', { class: 'bl-paper', 'aria-label': `Invoice ${i.number ?? 'draft'}` },
    h('header', { class: 'bl-paper-head' },
      h('div', null,
        h('div', { class: 'bl-paper-biz' }, s.businessName || 'Your business name'),
        h('div', { class: 'bl-paper-addr' }, s.address || 'Add your address in Billing › Settings'),
        s.vatNumber ? h('div', { class: 'bl-paper-addr' }, `VAT ${s.vatNumber}`) : null),
      h('div', { class: 'bl-paper-id' },
        h('div', { class: 'bl-paper-kicker' }, i.status === 'void' ? 'Invoice · void' : 'Invoice'),
        h('div', { class: 'bl-paper-num t-num' }, i.number ?? 'Draft'),
        h('dl', { class: 'bl-paper-dates' },
          h('dt', null, 'Issued'), h('dd', null, i.issueOn ? fmtDay(i.issueOn) : '—'),
          h('dt', null, 'Due'), h('dd', null, draft ? dateField({ value: state.dueOn, label: 'Due on', onChange: v => { state.dueOn = v; markDirty(); } }) : i.dueOn ? fmtDay(i.dueOn) : '—')))),
    h('div', { class: 'bl-paper-to' }, h('div', { class: 'bl-paper-kicker' }, 'Bill to'), h('div', { class: 'bl-paper-client' }, i.client.name)),
    lines,
    h('div', { class: 'bl-paper-foot' },
      h('div', { class: 'bl-paper-left' },
        draft ? h('div', { class: 'bl-paper-code no-print' }, h('div', { class: 'bl-paper-kicker' }, 'Discount'), h('div', { class: 'row' }, codeIn,
          state.code ? h('button', { type: 'button', class: 'btn small text', onclick: () => { codeIn.value = ''; state.code = ''; state.discountChanged = true; markDirty(); fill(codeStatus); } }, 'Remove') : null), codeStatus) : null,
        h('div', { class: 'bl-paper-pay' }, h('div', { class: 'bl-paper-kicker' }, 'How to pay'),
          h('div', null, s.paymentDetails ? `Bank transfer to ${s.paymentDetails}` : 'Bank details go here (Billing › Settings).'),
          i.number ? h('div', { class: 'small' }, `Reference: ${i.number}`) : null),
        draft ? field('Note', h('textarea', { rows: '2', maxlength: '1000', placeholder: 'A line for the client', oninput: e => { state.note = e.target.value; markDirty(); } }, state.note))
          : i.note ? h('p', { class: 'bl-paper-note' }, i.note) : null),
      totalsBox),
    s.footer ? h('footer', { class: 'bl-paper-footer' }, s.footer) : null,
    i.status === 'paid' ? h('div', { class: 'bl-stamp', 'aria-hidden': 'true' }, 'Paid') : i.status === 'void' ? h('div', { class: 'bl-stamp void', 'aria-hidden': 'true' }, 'Void') : null);
  drawTotals();

  // MARK: the side
  const side = h('aside', { class: 'bl-side' },
    h('section', { class: 'bl-side-card bl-side-sum' },
      h('div', { class: 'spread' }, statusPill(i.displayStatus, { detail: i.daysOverdue ? `${i.daysOverdue} days` : null }), clientChip(i.client)),
      h('div', { class: 'bl-side-big t-num' }, money(draft ? previewTotals(state.lines, i.discountPence, s.vatRateBp).total : i.status === 'issued' ? i.outstandingPence : i.totalPence)),
      h('div', { class: 'small muted' }, draft ? 'Draft total' : i.status === 'issued' ? (i.paidPence ? `left to pay of ${money(i.totalPence)}` : `due ${fmtDay(i.dueOn)}`) : i.status === 'paid' ? `paid ${i.paidAt ? fmtRelative(i.paidAt) : ''}` : 'void'),
      i.source !== 'manual' ? h('div', { class: 'small faint' }, { recurring: 'Raised by a recurring schedule', package: 'Raised for a package', campaign: 'Raised by a campaign enrolment', policy: 'Raised by the cancellation policy: confirm or delete' }[i.source] ?? '') : null),
    i.status === 'issued' ? remindersCard(i, again) : null,
    d.payments.length ? h('section', { class: 'bl-side-card' }, h('h3', null, 'Payments'), h('ul', { class: 'bl-mini' }, d.payments.map(p => h('li', null,
      h('div', { class: 'grow' }, h('div', null, fmtDay(p.receivedOn)), h('div', { class: 'small muted' }, `${methodLabel(p.method)}${p.reference ? ` · ${p.reference}` : ''}`)),
      h('b', { class: `t-num ${p.voidedAt ? 'faint' : 'tone-ok'}` }, p.voidedAt ? h('s', null, money(p.amountPence)) : money(p.amountPence)))))) : null,
    h('section', { class: 'bl-side-card' }, h('h3', null, 'History'), timeline(d.events.slice().reverse().map(e => ({ at: e.at, title: e.title, detail: e.detail, icon: EVENT_ICON[e.kind] ?? 'flag', tone: EVENT_TONE[e.kind] }))))); 

  fill(el,
    pageHead({ eyebrow: draft ? 'Draft invoice' : 'Invoice', title: i.number ?? 'New invoice', accent: draft ? null : null, sub: `${i.client.name} · ${draft ? 'not issued yet' : `issued ${fmtDay(i.issueOn)}`}`, actions: [...primary, moreBtn] }),
    h('div', { class: 'bl-inv' }, paper, side));
}

function remindersCard(i, again) {
  const box = h('section', { class: 'bl-side-card' }, h('h3', null, 'Reminders'), skeleton('lines', { rows: 2 }));
  api('GET', `/api/billing/invoices/${enc(i.id)}/reminders`).then(r => {
    const toggle = h('button', { type: 'button', class: 'btn small', onclick: async () => { await api('POST', `/api/billing/invoices/${enc(i.id)}/reminders`, { paused: !r.paused }); toast(r.paused ? 'Reminders back on' : 'Reminders paused'); again(); } },
      icon(r.paused ? 'play_arrow' : 'pause', 16), r.paused ? 'Resume reminders' : 'Pause reminders');
    const word = { gentle: 'Gentle reminder', firm: 'Firm reminder', coach: 'Your personal word' };
    fill(box, h('h3', null, 'Reminders'),
      r.paused ? h('p', { class: 'small tone-attention row gap4' }, icon('pause_circle', 16), 'Paused for this invoice.')
        : r.next ? h('p', { class: 'small row gap4' }, icon('schedule', 16), `${word[r.next.template] ?? 'Next step'} on ${fmtDay(r.next.on)}`) : h('p', { class: 'small muted' }, 'Every step has happened.'),
      r.log.length ? h('ol', { class: 'bl-steps' }, r.log.filter(l => l.kind !== 'paused').map(l => h('li', null, h('span', { class: 'bl-step-k' }, l.kind === 'manual' ? 'You' : word[l.kind] ?? l.kind), h('span', { class: 'small muted grow' }, l.outcome), h('span', { class: 'small faint' }, fmtDay(l.at.slice(0, 10)))))) : null,
      h('div', { class: 'row' }, toggle));
  }).catch(err => fill(box, errorLine(err)));
  return box;
}

/** Chase now: a reminder the coach reads and edits before it goes (via coachAction, logged as step 100+). */
function remindSheet(i, done) {
  const first = firstName(i.client.name);
  const text = `Hi ${first}, a quick nudge that invoice ${i.number} for ${money(i.outstandingPence)} was due on ${fmtDay(i.dueOn)}. Details are in our last message. Thanks!`;
  return sheet(`Remind ${first}`, (body, close) => {
    const status = h('div', { role: 'status' });
    const area = h('textarea', { rows: '5', maxlength: '4000', 'aria-label': 'Reminder' }, text);
    body.append(h('p', { class: 'small muted m0' }, `Goes into ${first}’s thread now, from you.`), area, status);
    const send = button('Send reminder', () => busy(send, status, async () => { await api('POST', `/api/billing/invoices/${enc(i.id)}/remind`, { text: area.value.trim() }); toast('Reminder sent'); close(true); done?.(); }), { kind: 'primary' });
    return h('div', { class: 'row end' }, button('Cancel', () => close()), send);
  });
}
