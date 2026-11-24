/*
 * WP3 Billing: shared desk pieces (docs/design/desk-v2.md F9–F12). Status
 * pills (always a word and a glyph), the line editor with drag (and keyboard)
 * reordering, the payment, credit-note and refund sheets, the CSV download
 * and the quick-create invoice wizard. Everything goes through h() with
 * textContent; money is integer pence and shown with fmtMoney.
 */
import {
  addDays, api, apiBlob, avatar, busy, button, clients, errorLine, field, fill, firstName, fmtDay, fmtMoney, go, h, icon, plans, sheet,
  todayLondon, toast,
} from './core.js';
import { dateField, moneyInput, skeleton, slideOver, wizard } from './ui.js';

export const STATUS = {
  draft: { word: 'Draft', icon: 'edit_note', tone: 'data' },
  issued: { word: 'Sent', icon: 'schedule_send', tone: 'data' },
  partial: { word: 'Part-paid', icon: 'hourglass_empty', tone: 'attention' },
  overdue: { word: 'Overdue', icon: 'warning', tone: 'urgent' },
  paid: { word: 'Paid', icon: 'check_circle', tone: 'ok' },
  void: { word: 'Void', icon: 'block', tone: 'quiet' },
  credited: { word: 'Credited', icon: 'undo', tone: 'data' },
  active: { word: 'Active', icon: 'sync', tone: 'ok' },
  paused: { word: 'Paused', icon: 'pause_circle', tone: 'attention' },
  ended: { word: 'Ended', icon: 'stop_circle', tone: 'quiet' },
  used: { word: 'Used up', icon: 'done_all', tone: 'quiet' },
  expired: { word: 'Expired', icon: 'hourglass_empty', tone: 'quiet' },
  cancelled: { word: 'Cancelled', icon: 'block', tone: 'quiet' },
};
/** A status pill: glyph, word and tone together (Atelier: colour never alone). */
export function statusPill(status, { detail = null } = {}) {
  const s = STATUS[status] ?? { word: status, icon: 'flag', tone: 'data' };
  return h('span', { class: `bl-status bl-tone-${s.tone}` }, icon(s.icon, 14), s.word, detail ? h('span', { class: 'bl-status-detail' }, detail) : null);
}

export const METHODS = [['bank', 'Bank transfer'], ['card', 'Card'], ['cash', 'Cash'], ['other', 'Other']];
export const methodLabel = m => (METHODS.find(x => x[0] === m) ?? [m, m])[1];
export const KIND_LABEL = { plan: 'Plan', session: 'Session', package: 'Package', campaign: 'Campaign', kit: 'Kit', custom: 'Custom' };
export const INTERVAL_LABEL = { week: 'week', fourWeeks: '4 weeks', month: 'month' };
export const money = p => fmtMoney(p ?? 0);
export const enc = encodeURIComponent;

/** A big serif money figure with an optional tone and caption. */
export const bigMoney = (pence, { tone = null, caption = null, size = 'l' } = {}) => h('div', { class: `bl-big bl-big-${size}` },
  h('div', { class: `bl-big-n t-num${tone ? ` tone-${tone}` : ''}` }, money(pence)), caption ? h('div', { class: 'bl-big-cap' }, caption) : null);

/** A client chip: avatar and name, linking to the client's billing tab. */
export const clientChip = (c, { link: linkTo = true } = {}) => {
  if (!c) return h('span', { class: 'faint' }, '—');
  const inner = [avatar(c.initials || c.name, 24), h('span', { class: 'bl-client-name' }, c.name)];
  return linkTo ? h('a', { class: 'bl-client', href: `#/clients/${enc(c.id)}/billing`, onclick: e => e.stopPropagation() }, inner) : h('span', { class: 'bl-client' }, inner);
};

// MARK: - Line editor

let lineSeq = 0;
/**
 * lineEditor({lines, onChange, editable}) → element with .lines(). Rows can be
 * dragged by their handle or moved with Alt+↑/↓ (and the move buttons).
 * Lines are {description, quantity, unitPence, kind}.
 */
export function lineEditor({ lines = [], onChange = null, editable = true }) {
  let rows = lines.map(l => ({ key: ++lineSeq, description: l.description ?? '', quantity: l.quantity ?? 1, unitPence: l.unitPence ?? 0, kind: l.kind ?? 'custom', ref: l.ref ?? null }));
  const el = h('div', { class: 'bl-lines' });
  const changed = () => { onChange?.(out()); el.dispatchEvent(new CustomEvent('ui-change', { bubbles: true })); };
  const out = () => rows.filter(r => r.description.trim() || r.unitPence).map(({ description, quantity, unitPence, kind, ref }) => ({ description: description.trim(), quantity: Number(quantity) || 1, unitPence: unitPence || 0, kind, ref }));
  let dragKey = null;
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    draw();
    changed();
    el.querySelectorAll('.bl-line')[j]?.querySelector('.bl-line-desc')?.focus();
  };
  function row(r, i) {
    const amount = h('span', { class: 'bl-line-amount t-num' }, money(Math.round((Number(r.quantity) || 0) * (r.unitPence || 0))));
    const refresh = () => { amount.textContent = money(Math.round((Number(r.quantity) || 0) * (r.unitPence || 0))); changed(); };
    if (!editable) {
      return h('div', { class: 'bl-line ro' },
        h('div', { class: 'bl-line-main' }, h('div', { class: 'bl-line-text' }, r.description), h('div', { class: 'bl-line-meta' }, `${KIND_LABEL[r.kind] ?? r.kind} · ${r.quantity} × ${money(r.unitPence)}`)),
        amount);
    }
    const unit = moneyInput({ value: r.unitPence, label: 'Unit price', onChange: p => { r.unitPence = p; refresh(); } });
    const tr = h('div', {
      class: 'bl-line', 'data-key': String(r.key),
      ondragover: e => { if (dragKey !== null) { e.preventDefault(); tr.classList.add('bl-drop'); } },
      ondragleave: () => tr.classList.remove('bl-drop'),
      ondrop: e => {
        e.preventDefault();
        tr.classList.remove('bl-drop');
        const from = rows.findIndex(x => x.key === dragKey);
        if (from < 0 || from === i) return;
        const [moved] = rows.splice(from, 1);
        rows.splice(i, 0, moved);
        dragKey = null;
        draw();
        changed();
      },
      onkeydown: e => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(i, e.key === 'ArrowUp' ? -1 : 1); } },
    },
    h('button', { type: 'button', class: 'bl-line-handle', draggable: 'true', 'aria-label': `Move line ${i + 1}. Alt and the arrow keys move it.`,
      ondragstart: e => { dragKey = r.key; tr.classList.add('bl-dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(r.key)); },
      ondragend: () => { tr.classList.remove('bl-dragging'); dragKey = null; },
      onkeydown: e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); move(i, e.key === 'ArrowUp' ? -1 : 1); } },
    }, icon('drag_indicator', 18)),
    h('input', { class: 'bl-line-desc', value: r.description, placeholder: 'What for', 'aria-label': 'Description', maxlength: '200', oninput: e => { r.description = e.target.value; changed(); } }),
    h('select', { class: 'bl-line-kind', 'aria-label': 'Kind', onchange: e => { r.kind = e.target.value; changed(); } },
      Object.entries(KIND_LABEL).map(([k, l]) => h('option', { value: k, selected: k === r.kind }, l))),
    h('input', { class: 'bl-line-qty t-num', type: 'number', min: '0.01', step: '0.5', value: String(r.quantity), 'aria-label': 'Quantity', oninput: e => { r.quantity = e.target.value; refresh(); } }),
    unit,
    amount,
    h('button', { type: 'button', class: 'ui-icon-btn small', 'aria-label': `Remove line ${i + 1}`, onclick: () => { rows.splice(i, 1); draw(); changed(); } }, icon('close', 16)));
    return tr;
  }
  function draw() {
    fill(el,
      editable ? h('div', { class: 'bl-line-headrow', 'aria-hidden': 'true' }, h('span'), h('span', null, 'Description'), h('span', null, 'Kind'), h('span', null, 'Qty'), h('span', null, 'Unit'), h('span', { class: 'bl-al-r' }, 'Amount'), h('span')) : null,
      rows.map(row),
      !rows.length ? h('div', { class: 'bl-lines-empty' }, 'No lines yet.') : null,
      editable ? h('button', { type: 'button', class: 'btn small text bl-add-line', onclick: () => { rows.push({ key: ++lineSeq, description: '', quantity: 1, unitPence: 0, kind: 'custom' }); draw(); el.querySelector('.bl-line:last-of-type .bl-line-desc')?.focus(); } },
        icon('add', 16), 'Add a line') : null);
  }
  draw();
  el.lines = out;
  el.add = l => { rows.push({ key: ++lineSeq, description: l.description, quantity: l.quantity ?? 1, unitPence: l.unitPence ?? 0, kind: l.kind ?? 'custom', ref: l.ref ?? null }); draw(); changed(); };
  return el;
}

/** Client-side totals for a preview (the server is the source of truth). */
export function previewTotals(lines, discountPence = 0, vatRateBp = 0) {
  const subtotal = lines.reduce((n, l) => n + Math.round((Number(l.quantity) || 0) * (l.unitPence || 0)), 0);
  const discount = Math.min(discountPence || 0, subtotal);
  const tax = Math.round((subtotal - discount) * vatRateBp / 10_000);
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}

/** The totals panel: subtotal, discount, VAT and the total in serif. */
export function totalsPanel(t, { vatRateBp = 0, paid = null, credited = 0, outstanding = null, discountName = null } = {}) {
  const row = (k, v, cls = '') => h('div', { class: `bl-tot-row ${cls}` }, h('span', null, k), h('span', { class: 't-num' }, v));
  return h('div', { class: 'bl-totals' },
    row('Subtotal', money(t.subtotal)),
    t.discount ? row(discountName ? `Discount · ${discountName}` : 'Discount', `−${money(t.discount)}`, 'bl-tot-discount') : null,
    vatRateBp ? row(`VAT ${(vatRateBp / 100).toLocaleString('en-GB')}%`, money(t.tax)) : null,
    h('div', { class: 'bl-tot-total' }, h('span', null, 'Total'), h('span', { class: 'bl-tot-big t-num' }, money(t.total))),
    paid !== null ? row('Paid', money(paid), 'bl-tot-paid') : null,
    credited ? row('Credited', money(credited)) : null,
    outstanding !== null ? row('Outstanding', money(outstanding), outstanding > 0 ? 'bl-tot-due' : 'bl-tot-settled') : null);
}

// MARK: - Sheets: payment, credit note, refund

/** Record a payment (never "charge": the money moved outside the app). Resolves with the server's answer, or undefined. */
export function recordPaymentSheet({ client, invoice = null }) {
  return sheet(invoice ? `Record payment · ${invoice.number}` : `Record payment · ${client.name}`, (body, close) => {
    let amount = invoice ? Math.max(0, invoice.outstandingPence ?? invoice.totalPence - invoice.paidPence) : null;
    let method = 'bank';
    const status = h('div', { role: 'status' });
    const amountIn = moneyInput({ value: amount, label: 'Amount', onChange: p => { amount = p; } });
    const day = dateField({ value: todayLondon(), label: 'Received on', max: todayLondon() });
    const ref = h('input', { placeholder: invoice?.number ?? 'Reference', maxlength: '120' });
    const receipt = h('input', { type: 'checkbox', id: 'bl-receipt' });
    const methods = h('div', { class: 'bl-methods', role: 'radiogroup', 'aria-label': 'Method' });
    const drawMethods = () => fill(methods, METHODS.map(([v, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === method), class: `bl-method${v === method ? ' sel' : ''}`,
      onclick: () => { method = v; drawMethods(); } }, icon({ bank: 'account_balance_wallet', card: 'payments', cash: 'savings', other: 'more_horiz' }[v], 18), l)));
    drawMethods();
    body.append(
      h('p', { class: 'muted small m0' }, 'A record of money you received outside the app. Nothing is charged.'),
      field('Amount', amountIn),
      h('div', { class: 'field' }, h('label', null, 'Method'), methods),
      h('div', { class: 'grid2' }, field('Received on', day), field('Reference', ref)),
      h('label', { class: 'bl-check', for: 'bl-receipt' }, receipt, h('span', null, h('b', null, 'Send a receipt'), h('span', { class: 'small muted' }, ` · a thank-you in ${firstName(client.name)}’s thread`))),
      status);
    const save = button('Record payment', () => busy(save, status, async () => {
      if (!amount || amount <= 0) throw new Error('Enter the amount received');
      const out = await api('POST', '/api/billing/payments', { clientId: client.id, invoiceId: invoice?.id ?? undefined, amountPence: amount, method, receivedOn: day.value, reference: ref.value.trim() || undefined, sendReceipt: receipt.checked });
      toast(`${money(amount)} recorded${receipt.checked ? ' · receipt sent' : ''}`);
      close(out);
    }), { kind: 'primary' });
    return h('div', { class: 'row end' }, button('Cancel', () => close()), save);
  });
}

export function creditNoteSheet({ client, invoice = null }) {
  return sheet(invoice ? `Credit note · ${invoice.number}` : `Credit note · ${client.name}`, (body, close) => {
    let amount = null;
    const status = h('div', { role: 'status' });
    const reason = h('textarea', { rows: '2', maxlength: '300', placeholder: 'Session cancelled by JK' });
    body.append(h('p', { class: 'muted small m0' }, 'Reduces what the client owes. To pay money back, record a refund against it afterwards.'),
      field('Amount', moneyInput({ label: 'Amount', onChange: p => { amount = p; } })), field('Reason', reason), status);
    const save = button('Raise credit note', () => busy(save, status, async () => {
      const out = await api('POST', '/api/billing/credit-notes', { clientId: client.id, invoiceId: invoice?.id ?? undefined, amountPence: amount, reason: reason.value.trim() });
      toast('Credit note raised');
      close(out);
    }), { kind: 'primary' });
    return h('div', { class: 'row end' }, button('Cancel', () => close()), save);
  });
}

export function refundSheet({ creditNote }) {
  return sheet(`Refund · ${money(creditNote.amountPence - (creditNote.refundedPence || 0))} available`, (body, close) => {
    let amount = creditNote.amountPence - (creditNote.refundedPence || 0);
    let method = 'bank';
    const status = h('div', { role: 'status' });
    const day = dateField({ value: todayLondon(), label: 'Paid on' });
    const ref = h('input', { maxlength: '120', placeholder: 'Reference' });
    body.append(h('p', { class: 'muted small m0' }, 'Record money you paid back. Nothing moves from here.'),
      field('Amount', moneyInput({ value: amount, label: 'Amount', onChange: p => { amount = p; } })),
      field('Method', h('select', { onchange: e => { method = e.target.value; } }, METHODS.map(([v, l]) => h('option', { value: v }, l)))),
      h('div', { class: 'grid2' }, field('Paid on', day), field('Reference', ref)), status);
    const save = button('Record refund', () => busy(save, status, async () => {
      const out = await api('POST', '/api/billing/refunds', { creditNoteId: creditNote.id, amountPence: amount, method, paidOn: day.value, reference: ref.value.trim() || undefined });
      toast('Refund recorded');
      close(out);
    }), { kind: 'primary' });
    return h('div', { class: 'row end' }, button('Cancel', () => close()), save);
  });
}

/** Download the accountant's CSV for a range of London days. */
export async function downloadCsv(from, to) {
  const blob = await apiBlob(`/api/billing/export.csv?from=${enc(from)}&to=${enc(to)}`);
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `billing-${from}-to-${to}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// MARK: - The quick-create invoice wizard

const monthName = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });

/**
 * "Invoice…": a slide-over wizard. Client, then lines (presets: this month's
 * plan at the plan price, a session pack, a campaign fee, custom), then the
 * due date, then Issue and send or Save draft.
 */
export function invoiceWizard({ clientId = null } = {}) {
  slideOver('New invoice', (body, close) => {
    body.append(skeleton('card', { rows: 4 }));
    Promise.all([clients(), plans().catch(() => null), api('GET', '/api/billing/settings'), api('GET', '/api/billing/packages').catch(() => ({ packages: [] }))]).then(([list, planInfo, { settings }, { packages }]) => {
      const data = { clientId, lines: [], dueOn: addDays(todayLondon(), settings.dueDays), note: '', code: '', discount: null };
      const clientOf = () => list.find(c => c.id === data.clientId);
      const priceOf = c => planInfo?.plans?.find(p => p.id === (c?.plan || 'none'));
      let editor = null;
      const steps = [
        { id: 'client', label: 'Client', valid: d => !!d.clientId, render(box, d) {
          const q = h('input', { type: 'search', placeholder: 'Find a client', 'aria-label': 'Find a client', class: 'bl-find' });
          const listEl = h('div', { class: 'bl-pick', role: 'radiogroup', 'aria-label': 'Client' });
          const draw = () => {
            const s = q.value.trim().toLowerCase();
            fill(listEl, list.filter(c => !s || c.name.toLowerCase().includes(s)).map(c => h('button', { type: 'button', role: 'radio', 'aria-checked': String(c.id === d.clientId), class: `bl-pick-row${c.id === d.clientId ? ' sel' : ''}`,
              onclick: () => { d.clientId = c.id; d.lines = []; draw(); box.dispatchEvent(new CustomEvent('ui-change', { bubbles: true })); } },
            avatar(c.initials || c.name, 32), h('span', { class: 'grow' }, h('span', { class: 'strong' }, c.name), h('span', { class: 'small muted' }, ` · ${priceOf(c)?.name ?? 'No plan'}`)),
            c.id === d.clientId ? icon('check_circle', 18, { filled: true }) : null)));
          };
          q.addEventListener('input', draw);
          box.append(q, listEl);
          draw();
          requestAnimationFrame(() => q.focus());
        } },
        { id: 'lines', label: 'Lines', valid: d => d.lines.length > 0 && d.lines.every(l => l.description && l.unitPence >= 0), render(box, d) {
          const c = clientOf();
          const plan = priceOf(c);
          const today = todayLondon();
          editor = lineEditor({ lines: d.lines, onChange: ls => { d.lines = ls; } });
          const preset = (label, glyph, detail, line, disabled = false) => h('button', { type: 'button', class: 'bl-preset', disabled, onclick: () => editor.add(line()) },
            h('span', { class: 'bl-preset-icon' }, icon(glyph, 20)), h('span', { class: 'bl-preset-text' }, h('b', null, label), h('span', null, detail)));
          const packPick = h('select', { 'aria-label': 'Package', class: 'bl-pack-pick' }, packages.filter(p => p.active).map(p => h('option', { value: p.id }, `${p.name} · ${money(p.pricePence)}`)));
          box.append(
            h('div', { class: 'bl-presets' },
              preset('This month’s plan', 'workspace_premium', plan?.monthlyPence ? `${plan.name} · ${money(plan.monthlyPence)}` : 'No paid plan', () => ({ description: `${plan.name} coaching · ${monthName(today)}`, quantity: 1, unitPence: plan.monthlyPence, kind: 'plan' }), !plan?.monthlyPence),
              preset('A session pack', 'inventory_2', packages.length ? 'From your catalogue' : 'No packages yet', () => { const p = packages.find(x => x.id === packPick.value) ?? packages[0]; return { description: `${p.name}${p.description ? ` · ${p.description}` : ''}`, quantity: 1, unitPence: p.pricePence, kind: 'package', ref: p.id }; }, !packages.length),
              preset('A campaign fee', 'rocket_launch', 'Name it and price it', () => ({ description: 'Campaign fee', quantity: 1, unitPence: 0, kind: 'campaign' })),
              preset('Custom', 'edit_note', 'Kit, sessions, anything', () => ({ description: '', quantity: 1, unitPence: 0, kind: 'custom' }))),
            packages.length ? h('div', { class: 'bl-pack-row small muted' }, 'Pack for the preset:', packPick) : null,
            editor);
        } },
        { id: 'due', label: 'Due and offer', valid: () => true, render(box, d) {
          const status = h('div', { class: 'small', role: 'status' });
          const code = h('input', { value: d.code, placeholder: 'NEWYEAR20', maxlength: '40', class: 'bl-code', 'aria-label': 'Discount code',
            oninput: e => { d.code = e.target.value.trim().toUpperCase(); d.discount = null; fill(status); } });
          const check = button('Apply', async () => {
            if (!d.code) return;
            const r = await api('POST', '/api/offers/discounts/check', { code: d.code, clientId: d.clientId, lines: d.lines.map(l => ({ kind: l.kind, amountPence: Math.round(l.quantity * l.unitPence) })) }).catch(err => ({ ok: false, reason: err.message }));
            d.discount = r.ok ? { amountPence: r.amountPence, name: r.discount?.name } : null;
            fill(status, r.ok ? h('span', { class: 'tone-ok row gap4' }, icon('check_circle', 16), `${money(r.amountPence)} off · ${r.discount?.name ?? ''}`) : h('span', { class: 'tone-attention row gap4' }, icon('warning', 16), r.reason));
          }, { small: true });
          box.append(
            h('div', { class: 'grid2' },
              field('Due on', dateField({ value: d.dueOn, min: todayLondon(), label: 'Due on', onChange: v => { d.dueOn = v; } }), `Default: ${settings.dueDays} days after issue`),
              h('div', { class: 'field' }, h('label', null, 'Discount code'), h('div', { class: 'row' }, code, check), status)),
            field('Note on the invoice', h('textarea', { rows: '3', maxlength: '1000', placeholder: 'Thanks for a great month of training.', oninput: e => { d.note = e.target.value; } }, d.note)));
        } },
        { id: 'review', label: 'Review', valid: d => d.lines.length > 0, render(box, d) {
          const c = clientOf();
          const t = previewTotals(d.lines, d.discount?.amountPence ?? 0, settings.vatRateBp);
          const saveDraft = button('Save as draft', () => busy(saveDraft, null, () => submit(false)), { small: false });
          box.append(
            h('div', { class: 'bl-review' },
              h('div', { class: 'bl-review-who' }, avatar(c.initials || c.name, 40), h('div', null, h('div', { class: 'strong' }, c.name), h('div', { class: 'small muted' }, `Due ${fmtDay(d.dueOn)}`))),
              lineEditor({ lines: d.lines, editable: false }),
              totalsPanel(t, { vatRateBp: settings.vatRateBp, discountName: d.discount?.name }),
              h('p', { class: 'small muted' }, settings.paymentDetails ? `Issuing sends “Invoice … · ${money(t.total)} due ${fmtDay(d.dueOn)}. Pay by bank transfer to ${settings.paymentDetails.split('\n').join(' · ')}” into ${firstName(c.name)}’s thread.` : 'Add your bank details in Billing › Settings so the message tells them where to pay.')),
            h('div', { class: 'row end' }, saveDraft));
        } },
      ];
      async function submit(send) {
        const { invoice } = await api('POST', '/api/billing/invoices', { clientId: data.clientId, lines: data.lines, dueOn: data.dueOn, note: data.note || undefined, discountCode: data.discount ? data.code : undefined });
        if (send) await api('POST', `/api/billing/invoices/${invoice.id}/issue`, { send: true, dueOn: data.dueOn });
        toast(send ? 'Invoice issued and sent' : 'Draft saved', { action: { label: 'Open', run: () => go(`/billing/invoices/${invoice.id}`) } });
        close();
        window.dispatchEvent(new CustomEvent('bl-changed'));
      }
      const wiz = wizard(clientId ? steps.slice(1) : steps, { data, finishLabel: 'Issue and send', onFinish: () => submit(true) });
      fill(body, wiz.el);
    }).catch(err => fill(body, errorLine(err)));
  }, { wide: true });
}
