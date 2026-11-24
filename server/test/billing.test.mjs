/**
 * F9 invoices and the ledger, F10 packages, credits and recurring billing,
 * F11 dunning (docs/design/desk-v2.md, WP3). Clocks get an injected `now`;
 * routes take ?at= where a day matters. Event handlers stamp events with the
 * wall clock, so the tests that go through them use the real London day.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { assertNoRowsFor, fakeToday, makeWorld } from './helpers.mjs';
import { emit } from '../events.mjs';
import { runFeatureSchemas } from '../features.mjs';
import { clientFacts, runAction } from '../facts.mjs';
import { addMonths, csvCell, expirePackages, runDunning, runRecurring, totalsOf } from '../features/billing.mjs';
import { newId, nowIso, openStore, setCoachPref } from '../store.mjs';
import { render } from '../templating.mjs';
import { addDays, londonDay, londonToUtc } from '../time.mjs';
import { buildDemo } from '../demo.mjs';

const { today, now } = fakeToday();
const realToday = londonDay();
const at = (path, when = now) => `${path}${path.includes('?') ? '&' : '?'}at=${encodeURIComponent(when.toISOString())}`;
const noon = d => londonToUtc(d, '12:00');

let w, coach2, olive, priya;
before(async () => {
  w = await makeWorld();
  coach2 = await w.signIn('wp3-coach2', 'coach2@example.com', { givenName: 'Other', familyName: 'Coach' });
  olive = w.user('Olive Other', 'client', coach2.id);
  priya = w.user('Priya Shah', 'client', w.coach.id);
  setCoachPref(w.db, w.coach.id, 'outreach.quietHours', 'off');
});
after(() => w.close());

const one = (sql, ...a) => w.db.prepare(sql).get(...a);
const rows = (sql, ...a) => w.db.prepare(sql).all(...a);
const line = (unitPence, description = 'Coaching', extra = {}) => ({ description, quantity: 1, unitPence, ...extra });
const draft = (clientId, lines, extra = {}, as = w.coach) => w.ok('POST', at('/api/billing/invoices'), { as, body: { clientId, lines, ...extra } }).then(r => r.invoice);
const issue = (id, body = {}, as = w.coach, when = now) => w.ok('POST', at(`/api/billing/invoices/${id}/issue`, when), { as, body }).then(r => r.invoice);
const pay = (clientId, invoiceId, amountPence, extra = {}, as = w.coach) => w.ok('POST', at('/api/billing/payments'), { as, body: { clientId, invoiceId, amountPence, method: 'bank', receivedOn: today, ...extra } });
const messagesTo = (clientId, via) => rows("SELECT * FROM messages WHERE client_id=? AND from_role='coach' AND via=? ORDER BY at", clientId, via);
const newClient = name => w.user(name, 'client', w.coach.id);

describe('invoices (F9)', () => {
  test('totals, VAT and rounding', async () => {
    assert.deepEqual(totalsOf([{ amount_pence: 1000 }, { amount_pence: 501 }], 300, 2000), { subtotal: 1501, discount: 300, tax: 240, total: 1441 });
    assert.equal(totalsOf([{ amount_pence: 100 }], 500, 0).discount, 100, 'a discount is capped at the subtotal');
    await w.ok('PUT', '/api/billing/settings', { as: w.coach, body: { vatRateBp: 2000 } });
    const inv = await draft(w.client.id, [{ description: 'Half sessions', quantity: 1.5, unitPence: 333 }, line(1001)]);
    // 1.5 × 333 = 499.5 → 500; VAT round(1501 × 0.2) = 300.2 → 300.
    assert.equal(inv.subtotalPence, 1501);
    assert.equal(inv.taxPence, 300);
    assert.equal(inv.totalPence, 1801);
    await w.ok('PUT', '/api/billing/settings', { as: w.coach, body: { vatRateBp: 0 } });
    await w.ok('DELETE', `/api/billing/invoices/${inv.id}`, { as: w.coach });
  });

  test('numbering is gap-free and unique per coach, including two issues in a row', async () => {
    const a = await draft(w.client.id, [line(5000)]);
    const b = await draft(w.client.id, [line(6000)]);
    const [ia, ib] = await Promise.all([issue(a.id), issue(b.id)]);
    const year = today.slice(0, 4);
    const nums = [ia.number, ib.number].sort();
    assert.match(nums[0], new RegExp(`^JK-${year}-\\d{4}$`));
    assert.equal(Number(nums[1].slice(-4)) - Number(nums[0].slice(-4)), 1, 'consecutive');
    const c = await draft(olive.id, [line(1000)], {}, coach2);
    const ic = await issue(c.id, {}, coach2);
    assert.equal(ic.number, `JK-${year}-0001`, 'another coach starts at 1');
    assert.equal(ia.issueOn, today);
    assert.equal(ia.dueOn, addDays(today, 14));
  });

  test('an issued invoice is immutable apart from its note', async () => {
    const inv = await issue((await draft(w.client.id, [line(2000)])).id);
    const r = await w.call('PUT', `/api/billing/invoices/${inv.id}`, { as: w.coach, body: { lines: [line(1)] } });
    assert.equal(r.status, 400);
    const noted = await w.ok('PUT', `/api/billing/invoices/${inv.id}`, { as: w.coach, body: { note: 'Thanks!' } });
    assert.equal(noted.invoice.note, 'Thanks!');
    assert.equal(noted.invoice.totalPence, 2000);
  });

  test('a partial then a full payment moves it to paid, and the receipt sends one message', async () => {
    const c = newClient('Paula Partial');
    const inv = await issue((await draft(c.id, [line(12000)])).id);
    const first = await pay(c.id, inv.id, 5000);
    assert.equal(first.invoice.displayStatus, 'partial');
    assert.equal(first.invoice.status, 'issued');
    const before = messagesTo(c.id, 'coachAction').length;
    const second = await pay(c.id, inv.id, 7000, { sendReceipt: true });
    assert.equal(second.invoice.status, 'paid');
    assert.ok(second.messageId);
    const after = messagesTo(c.id, 'coachAction');
    assert.equal(after.length, before + 1, 'exactly one receipt');
    assert.match(after.at(-1).text, new RegExp(`Thanks, Paula: received £70 on .* for ${inv.number}\\.`));
    await w.settle();
    assert.equal(rows("SELECT * FROM events WHERE type='invoice.paid' AND client_id=?", c.id).length, 1);
    // Removing a payment re-derives the invoice.
    await w.ok('DELETE', `/api/billing/payments/${second.payment.id}`, { as: w.coach });
    assert.equal(one('SELECT status, paid_pence FROM invoices WHERE id=?', inv.id).status, 'issued');
  });

  test('voiding with payments is refused', async () => {
    const c = newClient('Victor Void');
    const inv = await issue((await draft(c.id, [line(3000)])).id);
    await pay(c.id, inv.id, 1000);
    const r = await w.call('POST', `/api/billing/invoices/${inv.id}/void`, { as: w.coach, body: { reason: 'oops' } });
    assert.equal(r.status, 409);
    const other = await issue((await draft(c.id, [line(3000)])).id);
    const v = await w.ok('POST', `/api/billing/invoices/${other.id}/void`, { as: w.coach, body: { reason: 'Wrong client' } });
    assert.equal(v.invoice.status, 'void');
  });

  test('the balance formula, and refunds against credit notes', async () => {
    const c = newClient('Bea Balance');
    const a = await issue((await draft(c.id, [line(10000)])).id);
    await issue((await draft(c.id, [line(4000)])).id);
    await draft(c.id, [line(99900)]); // drafts never count
    await pay(c.id, a.id, 10000);
    await pay(c.id, null, 1500, { invoiceId: undefined }); // account credit
    const bal = () => w.ok('GET', `/api/coach/clients/${c.id}/billing`, { as: w.coach }).then(r => r.balancePence);
    assert.equal(await bal(), 14000 - 10000 - 1500);
    // A refund needs a credit note of the same client.
    const bad = await w.call('POST', '/api/billing/refunds', { as: w.coach, body: { creditNoteId: 'cr_nope', amountPence: 100, method: 'bank', paidOn: today } });
    assert.equal(bad.status, 404);
    const { creditNote } = await w.ok('POST', '/api/billing/credit-notes', { as: w.coach, body: { clientId: c.id, amountPence: 2000, reason: 'Goodwill' } });
    assert.equal(await bal(), 2500 - 2000);
    await w.ok('POST', '/api/billing/refunds', { as: w.coach, body: { creditNoteId: creditNote.id, amountPence: 1200, method: 'bank', paidOn: today } });
    assert.equal(await bal(), 500 + 1200, 'a refund raises the balance by its amount');
    const over = await w.call('POST', '/api/billing/refunds', { as: w.coach, body: { creditNoteId: creditNote.id, amountPence: 900, method: 'bank', paidOn: today } });
    assert.equal(over.status, 400, 'refunds cannot exceed the credit note');
    const facts = clientFacts(w.db, w.coach.id, [c.id], { only: ['billing.balance', 'billing.ltv'] }).get(c.id);
    assert.equal(facts['billing.balance'], 1700);
    assert.equal(facts['billing.ltv'], 11500);
  });

  test('the CSV export: one row per ledger entry in range, escaped, this coach only', async () => {
    const c = newClient('Comma, "Quote" Carter');
    const inv = await issue((await draft(c.id, [line(4200, '=HYPERLINK("x")')])).id);
    await pay(c.id, inv.id, 4200, { reference: 'ref,with,commas' });
    const { creditNote } = await w.ok('POST', '/api/billing/credit-notes', { as: w.coach, body: { clientId: c.id, amountPence: 500, reason: 'Sorry' } });
    await w.ok('POST', '/api/billing/refunds', { as: w.coach, body: { creditNoteId: creditNote.id, amountPence: 500, method: 'cash', paidOn: today } });
    await issue((await draft(olive.id, [line(777)], {}, coach2)).id, {}, coach2);
    const r = await w.call('GET', `/api/billing/export.csv?from=${today}&to=${today}&at=${encodeURIComponent(now.toISOString())}`, { as: w.coach });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="billing-/);
    const csv = r.body.toString('utf8');
    const mine = csv.split('\r\n').filter(l => l.includes('Comma'));
    assert.equal(mine.length, 4, 'invoice, payment, credit note, refund');
    assert.ok(csv.includes('"Comma, ""Quote"" Carter"'), 'commas and quotes are escaped');
    assert.ok(csv.includes('"ref,with,commas"'));
    assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`), 'formulas are defused');
    assert.ok(!csv.includes('Olive'), 'only this coach\'s rows');
    assert.equal(csvCell('-5.00', { numeric: true }), '-5.00');
    const range = await w.call('GET', `/api/billing/export.csv?from=2020-01-01&to=2024-01-01`, { as: w.coach });
    assert.equal(range.status, 400, 'at most two years');
  });

  test('a client sees only their own invoices; another client an empty list', async () => {
    const r = await w.ok('GET', '/api/billing/mine', { as: w.client });
    assert.ok(r.invoices.length >= 1);
    assert.ok(r.invoices.every(i => i.number && i.lines.length));
    const p = await w.ok('GET', '/api/billing/mine', { as: priya });
    assert.deepEqual(p.invoices, []);
    const coachCall = await w.call('GET', '/api/billing/invoices', { as: w.client });
    assert.equal(coachCall.status, 403, 'a client calling a coach endpoint');
  });

  test('issue and send posts one coachAction message with the bank details', async () => {
    await w.ok('PUT', '/api/billing/settings', { as: w.coach, body: { paymentDetails: 'Test Bank\n00-00-00 12345678' } });
    const c = newClient('Sid Send');
    const inv = await issue((await draft(c.id, [line(12000)])).id, { send: true });
    const msgs = messagesTo(c.id, 'coachAction');
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].text, `Invoice ${inv.number} · £120 due ${new Date(`${inv.dueOn}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')}. Pay by bank transfer to Test Bank · 00-00-00 12345678 (ref ${inv.number}).`);
    assert.equal(inv.sentMessageId, msgs[0].id);
  });

  test('the export includes the invoices, and erasing a client removes everything', async () => {
    const c = await w.signIn('wp3-erase', 'erase@example.com', { givenName: 'Erin', familyName: 'Erase' });
    const inv = await issue((await draft(c.id, [line(3000)])).id);
    await pay(c.id, inv.id, 1000);
    const { creditNote } = await w.ok('POST', '/api/billing/credit-notes', { as: w.coach, body: { clientId: c.id, amountPence: 500, reason: 'x' } });
    await w.ok('POST', '/api/billing/refunds', { as: w.coach, body: { creditNoteId: creditNote.id, amountPence: 500, method: 'bank', paidOn: today } });
    const { packages } = await w.ok('GET', '/api/billing/packages', { as: w.coach });
    const pk = packages[0] ?? (await w.ok('POST', '/api/billing/packages', { as: w.coach, body: { name: 'Pack', sessions: 3, pricePence: 9000 } })).package;
    await w.ok('POST', `/api/billing/packages/${pk.id}/sell`, { as: w.coach, body: { clientId: c.id, invoice: true } });
    await w.ok('POST', '/api/billing/schedules', { as: w.coach, body: { clientId: c.id, label: 'Monthly', amountPence: 5000, interval: 'month', nextOn: addDays(today, 3) } });
    const exp = await w.call('GET', '/api/me/export', { as: c });
    const data = Buffer.isBuffer(exp.body) ? JSON.parse(exp.body.toString('utf8')) : exp.body;
    assert.equal(data.features.billing.invoices[0].number, inv.number);
    assert.equal(data.features.billing.payments.length, 1);
    assert.equal(data.features.billing.creditNotes.length, 1);
    await w.settle();
    await w.ok('DELETE', '/api/me', { as: c });
    assertNoRowsFor(w.db, c.id);
    assert.equal(one('SELECT COUNT(*) n FROM invoices WHERE id=?', inv.id).n, 0);
  });
});

describe('isolation', () => {
  test('every route gives 404 across coaches', async () => {
    const inv = await issue((await draft(w.client.id, [line(1000)])).id);
    const { package: pk } = await w.ok('POST', '/api/billing/packages', { as: w.coach, body: { name: 'Iso pack', sessions: 2, pricePence: 2000 } });
    const sold = await w.ok('POST', `/api/billing/packages/${pk.id}/sell`, { as: w.coach, body: { clientId: w.client.id, invoice: false } });
    const { schedule } = await w.ok('POST', '/api/billing/schedules', { as: w.coach, body: { clientId: w.client.id, label: 'Iso', amountPence: 100, interval: 'week', nextOn: addDays(today, 7) } });
    const p = await pay(w.client.id, inv.id, 100);
    const { creditNote } = await w.ok('POST', '/api/billing/credit-notes', { as: w.coach, body: { clientId: w.client.id, amountPence: 100, reason: 'iso' } });
    const { refund } = await w.ok('POST', '/api/billing/refunds', { as: w.coach, body: { creditNoteId: creditNote.id, amountPence: 100, method: 'bank', paidOn: today } });
    const routes = [
      ['GET', `/api/billing/invoices/${inv.id}`], ['PUT', `/api/billing/invoices/${inv.id}`, { note: 'x' }], ['DELETE', `/api/billing/invoices/${inv.id}`],
      ['POST', `/api/billing/invoices/${inv.id}/issue`], ['POST', `/api/billing/invoices/${inv.id}/void`], ['POST', `/api/billing/invoices/${inv.id}/duplicate`],
      ['POST', `/api/billing/invoices/${inv.id}/remind`], ['GET', `/api/billing/invoices/${inv.id}/reminders`], ['POST', `/api/billing/invoices/${inv.id}/reminders`, { paused: true }],
      ['POST', '/api/billing/invoices/bulk', { ids: [inv.id], action: 'remind' }],
      ['POST', '/api/billing/invoices', { clientId: w.client.id, lines: [line(1)] }],
      ['GET', `/api/billing/invoices?clientId=${w.client.id}`],
      ['POST', '/api/billing/payments', { clientId: w.client.id, amountPence: 1, method: 'cash', receivedOn: today }],
      ['DELETE', `/api/billing/payments/${p.payment.id}`],
      ['POST', '/api/billing/credit-notes', { clientId: w.client.id, amountPence: 1, reason: 'x' }],
      ['POST', '/api/billing/refunds', { creditNoteId: creditNote.id, amountPence: 1, method: 'bank', paidOn: today }],
      ['DELETE', `/api/billing/refunds/${refund.id}`],
      ['PUT', `/api/billing/packages/${pk.id}`, { name: 'x' }], ['DELETE', `/api/billing/packages/${pk.id}`],
      ['POST', `/api/billing/packages/${pk.id}/sell`, { clientId: olive.id }],
      ['POST', `/api/billing/client-packages/${sold.clientPackage.id}/adjust`, { delta: 1, reason: 'x' }],
      ['POST', '/api/billing/schedules', { clientId: w.client.id, label: 'x', amountPence: 1, interval: 'week', nextOn: today }],
      ['PATCH', `/api/billing/schedules/${schedule.id}`, { label: 'x' }], ['DELETE', `/api/billing/schedules/${schedule.id}`],
      ['GET', `/api/coach/clients/${w.client.id}/billing`],
    ];
    for (const [method, path, body] of routes) {
      const r = await w.call(method, path, { as: coach2, body });
      assert.equal(r.status, 404, `${method} ${path} → ${r.status}`);
    }
    // Lists are empty, not 404, for the other coach.
    const list = await w.ok('GET', '/api/billing/invoices', { as: coach2 });
    assert.ok(list.invoices.every(i => i.clientId === olive.id));
    for (const [method, path] of [['GET', '/api/billing/overview'], ['GET', '/api/billing/settings'], ['GET', '/api/billing/packages'], ['GET', '/api/billing/schedules'], ['GET', '/api/billing/payments']]) {
      assert.equal((await w.call(method, path, { as: w.client })).status, 403, `client on ${path}`);
    }
  });

  test('a client moved to another coach leaves the old coach\'s billing', async () => {
    const c = newClient('Mo Moved');
    const inv = await issue((await draft(c.id, [line(4500)])).id);
    w.db.prepare('UPDATE users SET coach_id=? WHERE id=?').run(coach2.id, c.id);
    assert.equal((await w.call('GET', `/api/billing/invoices/${inv.id}`, { as: w.coach })).status, 404);
    assert.ok(!(await w.ok('GET', '/api/billing/invoices', { as: w.coach })).invoices.some(i => i.id === inv.id));
    assert.ok((await w.ok('GET', '/api/billing/invoices', { as: coach2 })).invoices.some(i => i.id === inv.id), 'the new coach sees it');
    w.db.prepare('UPDATE users SET coach_id=? WHERE id=?').run(w.coach.id, c.id);
  });
});

describe('packages and recurring billing (F10)', () => {
  const booking = (clientId, start, kind = 'inperson', usesCredit = 1) => {
    const id = newId('b');
    w.db.prepare('INSERT INTO bookings (id, coach_id, client_id, kind, start, end, title, uses_credit, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, w.coach.id, clientId, kind, start, new Date(Date.parse(start) + 3_600_000).toISOString(), '1:1', usesCredit, nowIso());
    return id;
  };
  const payload = (bookingId, extra = {}) => ({ bookingId, kind: 'inperson', start: nowIso(), purpose: null, byRole: 'coach', late: false, refunded: false, ...extra });

  test('a booking takes one credit exactly once, and a refunded cancel gives it back', async () => {
    const c = newClient('Kim Credits');
    const { package: pk } = await w.ok('POST', '/api/billing/packages', { as: w.coach, body: { name: '3 × 1:1', sessions: 3, pricePence: 15000, bookingKind: 'inperson' } });
    const sold = await w.ok('POST', at(`/api/billing/packages/${pk.id}/sell`, noon(realToday)), { as: w.coach, body: { clientId: c.id, invoice: true, issue: true } });
    assert.equal(sold.invoice.status, 'issued');
    const b = booking(c.id, londonToUtc(addDays(realToday, 2), '07:00').toISOString());
    emit(w.db, 'booking.created', { coachId: w.coach.id, clientId: c.id, ...payload(b) });
    emit(w.db, 'booking.created', { coachId: w.coach.id, clientId: c.id, ...payload(b) });
    await w.settle();
    assert.equal(one("SELECT COUNT(*) n FROM credit_moves WHERE booking_id=? AND reason='booking'", b).n, 1);
    assert.equal(one('SELECT sessions_used FROM client_packages WHERE id=?', sold.clientPackage.id).sessions_used, 1);
    // A video booking does not use an in-person pack.
    const v = booking(c.id, londonToUtc(addDays(realToday, 3), '07:00').toISOString(), 'video');
    emit(w.db, 'booking.created', { coachId: w.coach.id, clientId: c.id, ...payload(v, { kind: 'video' }) });
    await w.settle();
    assert.equal(one('SELECT COUNT(*) n FROM credit_moves WHERE booking_id=?', v).n, 0);
    emit(w.db, 'booking.cancelled', { coachId: w.coach.id, clientId: c.id, ...payload(b, { refunded: true }) });
    await w.settle();
    assert.equal(one('SELECT sessions_used FROM client_packages WHERE id=?', sold.clientPackage.id).sessions_used, 0);
    // A late cancel under a forfeit policy keeps the credit taken.
    const b2 = booking(c.id, londonToUtc(addDays(realToday, 4), '07:00').toISOString());
    emit(w.db, 'booking.created', { coachId: w.coach.id, clientId: c.id, ...payload(b2) });
    await w.settle();
    emit(w.db, 'booking.cancelled', { coachId: w.coach.id, clientId: c.id, ...payload(b2, { late: true, refunded: true, policy: { forfeitCredit: true, feePence: 0 } }) });
    await w.settle();
    assert.equal(one('SELECT sessions_used FROM client_packages WHERE id=?', sold.clientPackage.id).sessions_used, 1);
    // Down to the last session emits package.low; at 0 the package is used.
    const b3 = booking(c.id, londonToUtc(addDays(realToday, 5), '07:00').toISOString());
    emit(w.db, 'booking.created', { coachId: w.coach.id, clientId: c.id, ...payload(b3) });
    await w.settle();
    assert.equal(rows("SELECT * FROM events WHERE type='package.low' AND client_id=?", c.id).length, 1);
    const b4 = booking(c.id, londonToUtc(addDays(realToday, 6), '07:00').toISOString());
    emit(w.db, 'booking.created', { coachId: w.coach.id, clientId: c.id, ...payload(b4) });
    await w.settle();
    assert.equal(one('SELECT status FROM client_packages WHERE id=?', sold.clientPackage.id).status, 'used');
    assert.equal(clientFacts(w.db, w.coach.id, [c.id], { only: ['billing.credits'] }).get(c.id)['billing.credits'], null);
  });

  test('a no-show with a fee makes one draft line and issues nothing', async () => {
    const c = newClient('Nina Noshow');
    const b = booking(c.id, londonToUtc(addDays(realToday, -1), '07:00').toISOString());
    emit(w.db, 'booking.noShow', { coachId: w.coach.id, clientId: c.id, bookingId: b, policy: { forfeitCredit: true, feePence: 2500 } });
    emit(w.db, 'booking.noShow', { coachId: w.coach.id, clientId: c.id, bookingId: b, policy: { forfeitCredit: true, feePence: 2500 } });
    await w.settle();
    const invs = rows('SELECT * FROM invoices WHERE client_id=?', c.id);
    assert.equal(invs.length, 1);
    assert.equal(invs[0].status, 'draft');
    assert.equal(invs[0].source, 'policy');
    const lines = rows('SELECT * FROM invoice_lines WHERE invoice_id=?', invs[0].id);
    assert.equal(lines.length, 1);
    assert.match(lines[0].description, /^Missed session · /);
    assert.equal(lines[0].kind, 'session');
    // A zero fee does nothing.
    emit(w.db, 'booking.lateCancel', { coachId: w.coach.id, clientId: c.id, bookingId: booking(c.id, nowIso()), policy: { forfeitCredit: true, feePence: 0 } });
    await w.settle();
    assert.equal(rows('SELECT * FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.client_id=?', c.id).length, 1);
  });

  test('expiry', async () => {
    const c = newClient('Ed Expiry');
    const { package: pk } = await w.ok('POST', '/api/billing/packages', { as: w.coach, body: { name: 'Short', sessions: 2, pricePence: 1000, validDays: 5 } });
    const sold = await w.ok('POST', `/api/billing/packages/${pk.id}/sell`, { as: w.coach, body: { clientId: c.id, invoice: false, startsOn: addDays(realToday, -10) } });
    assert.ok(expirePackages(w.db, new Date()) >= 1);
    assert.equal(one('SELECT status FROM client_packages WHERE id=?', sold.clientPackage.id).status, 'expired');
    assert.equal(expirePackages(w.db, new Date()), 0);
  });

  test('month-end clamping', () => {
    assert.equal(addMonths('2027-01-31', 1), '2027-02-28');
    assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
    assert.equal(addMonths('2027-02-28', 1, 31), '2027-03-31', 'the anchor day comes back');
    assert.equal(addMonths('2027-12-15', 1), '2028-01-15');
  });

  test('the recurring clock is idempotent across two ticks and a re-opened store', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'jk-recur-')), 'db.sqlite');
    let db = openStore(path);
    runFeatureSchemas(db);
    const coachId = newId('u'), clientId = newId('u');
    db.prepare("INSERT INTO users (id, name, role, created_at) VALUES (?, 'Coach', 'coach', ?)").run(coachId, nowIso());
    db.prepare("INSERT INTO users (id, name, role, coach_id, created_at) VALUES (?, 'Rae Recur', 'client', ?, ?)").run(clientId, coachId, nowIso());
    const start = addDays(today, -1);
    db.prepare("INSERT INTO billing_schedules (id, coach_id, client_id, label, amount_pence, interval, next_on, anchor_day, created_at) VALUES ('bs_t', ?, ?, 'Monthly', 9900, 'month', ?, ?, ?)")
      .run(coachId, clientId, start, Number(start.slice(8, 10)), nowIso());
    const cfg = { ...w.config };
    assert.equal(runRecurring(db, cfg, now), 1);
    assert.equal(runRecurring(db, cfg, now), 0);
    db.close();
    db = openStore(path);
    runFeatureSchemas(db);
    assert.equal(runRecurring(db, cfg, now), 0);
    const invs = db.prepare('SELECT * FROM invoices WHERE client_id=?').all(clientId);
    assert.equal(invs.length, 1);
    assert.equal(invs[0].source_ref, `bs_t:${start}`);
    assert.equal(invs[0].status, 'draft', 'a draft unless auto-issue is on');
    assert.equal(db.prepare('SELECT next_on FROM billing_schedules WHERE id=?').get('bs_t').next_on, addMonths(start, 1));
    // Re-running an already-invoiced next_on only advances.
    db.prepare('UPDATE billing_schedules SET next_on=? WHERE id=?').run(start, 'bs_t');
    assert.equal(runRecurring(db, cfg, now), 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n, 1);
    db.close();
  });

  test('discount_cycles = 3 discounts exactly the first 3 recurring invoices', async () => {
    const c = newClient('Dee Discount');
    const { discount } = await w.ok('POST', '/api/offers/discounts', { as: w.coach, body: { name: '20% for 3 months', kind: 'percent', value: 2000, appliesTo: 'plan', perClientMax: 10 } });
    await w.ok('PUT', '/api/billing/settings', { as: w.coach, body: { autoIssueRecurring: true } });
    const start = addDays(today, -200);
    const { schedule } = await w.ok('POST', '/api/billing/schedules', { as: w.coach, body: { clientId: c.id, label: 'Monthly', amountPence: 10000, interval: 'month', nextOn: start, discountId: discount.id, discountCycles: 3 } });
    runRecurring(w.db, w.config, now);
    await w.ok('PUT', '/api/billing/settings', { as: w.coach, body: { autoIssueRecurring: false } });
    const invs = rows("SELECT * FROM invoices WHERE client_id=? AND source='recurring' ORDER BY source_ref", c.id);
    assert.ok(invs.length >= 6);
    assert.deepEqual(invs.slice(0, 5).map(i => i.discount_pence), [2000, 2000, 2000, 0, 0]);
    assert.equal(one('SELECT discount_used FROM billing_schedules WHERE id=?', schedule.id).discount_used, 3);
    assert.ok(invs.every(i => i.status === 'issued'), 'auto-issue issues them');
    assert.equal(rows('SELECT * FROM discount_redemptions WHERE client_id=?', c.id).length, 3);
  });

  test('pause and resume do not back-bill, and resume extends package expiry', async () => {
    const c = newClient('Pat Pause');
    const { schedule } = await w.ok('POST', '/api/billing/schedules', { as: w.coach, body: { clientId: c.id, label: 'Weekly', amountPence: 3000, interval: 'week', nextOn: addDays(realToday, 2) } });
    const { package: pk } = await w.ok('POST', '/api/billing/packages', { as: w.coach, body: { name: 'Pause pack', sessions: 4, pricePence: 1000 } });
    const sold = await w.ok('POST', `/api/billing/packages/${pk.id}/sell`, { as: w.coach, body: { clientId: c.id, invoice: false } });
    emit(w.db, 'client.paused', { coachId: w.coach.id, clientId: c.id, until: addDays(realToday, 21), reason: 'Holiday', days: 21 });
    await w.settle();
    assert.equal(one('SELECT status FROM billing_schedules WHERE id=?', schedule.id).status, 'paused');
    runRecurring(w.db, w.config, noon(addDays(realToday, 10)));
    assert.equal(rows('SELECT * FROM invoices WHERE client_id=?', c.id).length, 0, 'nothing billed while paused');
    // Three weeks pass: the client resumes. next_on moves to the first date on or after today, with no back-billing.
    w.db.prepare('UPDATE billing_schedules SET next_on=? WHERE id=?').run(addDays(realToday, -19), schedule.id);
    emit(w.db, 'client.resumed', { coachId: w.coach.id, clientId: c.id, pausedDays: 21 });
    await w.settle();
    const s = one('SELECT * FROM billing_schedules WHERE id=?', schedule.id);
    assert.equal(s.status, 'active');
    assert.ok(s.next_on >= realToday && s.next_on <= addDays(realToday, 6));
    assert.equal(rows('SELECT * FROM invoices WHERE client_id=?', c.id).length, 0, 'no back-billing');
    const cp = one('SELECT * FROM client_packages WHERE id=?', sold.clientPackage.id);
    assert.equal(cp.expires_on, addDays(sold.clientPackage.expiresOn, 21));
    assert.equal(one("SELECT COUNT(*) n FROM credit_moves WHERE client_package_id=? AND reason='pause:+21d' AND delta=0 AND booking_id IS NULL", cp.id).n, 1);
  });

  test('after client.offboarded: no recurring invoice and no dunning step, unless keepChasing', async () => {
    const c = newClient('Olly Offboard');
    const k = newClient('Kit Keepchasing');
    for (const x of [c, k]) await w.ok('POST', '/api/billing/schedules', { as: w.coach, body: { clientId: x.id, label: 'Monthly', amountPence: 5000, interval: 'month', nextOn: addDays(realToday, 1) } });
    const invC = await issue((await draft(c.id, [line(5000)])).id, { dueOn: addDays(realToday, -3) }, w.coach, noon(addDays(realToday, -17)));
    const invK = await issue((await draft(k.id, [line(5000)])).id, { dueOn: addDays(realToday, -3) }, w.coach, noon(addDays(realToday, -17)));
    emit(w.db, 'client.offboarded', { coachId: w.coach.id, clientId: c.id, exitReason: 'moved', money: 'leave', keepChasing: false, packages: 'expire', at: nowIso() });
    emit(w.db, 'client.offboarded', { coachId: w.coach.id, clientId: k.id, exitReason: 'moved', money: 'leave', keepChasing: true, packages: 'expire', at: nowIso() });
    await w.settle();
    assert.equal(runRecurring(w.db, w.config, noon(addDays(realToday, 40))) >= 0, true);
    assert.equal(rows("SELECT * FROM invoices WHERE client_id IN (?,?) AND source='recurring'", c.id, k.id).length, 0, 'ended schedules bill nothing');
    runDunning(w.db, w.config, noon(realToday));
    assert.equal(rows('SELECT * FROM dunning_log WHERE invoice_id=? AND step>=0', invC.id).length, 0);
    assert.equal(messagesTo(c.id, 'dunning').length, 0);
    assert.equal(rows('SELECT * FROM dunning_log WHERE invoice_id=? AND step>=0', invK.id).length, 1, 'keepChasing still chases');
    // Restarting coaching clears the state; old schedules stay ended.
    emit(w.db, 'client.stageChanged', { coachId: w.coach.id, clientId: c.id, from: 'churned', to: 'active', manual: true });
    await w.settle();
    assert.equal(one('SELECT COUNT(*) n FROM billing_client_state WHERE client_id=?', c.id).n, 0);
    assert.ok(rows('SELECT status FROM billing_schedules WHERE client_id=?', c.id).every(s => s.status === 'ended'));
  });

  test('offboarding with refund and write-off raises credit notes', async () => {
    const c = newClient('Ruth Refund');
    const { package: pk } = await w.ok('POST', '/api/billing/packages', { as: w.coach, body: { name: '4 pack', sessions: 4, pricePence: 20000 } });
    await w.ok('POST', `/api/billing/packages/${pk.id}/sell`, { as: w.coach, body: { clientId: c.id, invoice: true, issue: true } });
    const off = await w.ok('GET', `/api/coach/clients/${c.id}/offboarding`, { as: w.coach }).catch(() => null);
    void off;
    emit(w.db, 'client.offboarded', { coachId: w.coach.id, clientId: c.id, exitReason: 'cost', money: 'writeOff', keepChasing: false, packages: 'refund', at: nowIso() });
    await w.settle();
    const notes = rows('SELECT * FROM credit_notes WHERE client_id=? ORDER BY created_at', c.id);
    assert.deepEqual(notes.map(n => n.amount_pence), [20000]);
    assert.equal(one('SELECT status FROM client_packages WHERE client_id=?', c.id).status, 'cancelled');
    // The unused share refunded the whole invoice, so nothing is left to write off.
    assert.equal((await w.ok('GET', `/api/coach/clients/${c.id}/billing`, { as: w.coach })).balancePence, 0);
  });

  test('campaign.enrolled raises the fee invoice once, with a valid code applied', async () => {
    const c = newClient('Cam Paign');
    await w.ok('POST', '/api/offers/discounts', { as: w.coach, body: { code: 'CAMP10', name: 'Campaign 10%', kind: 'percent', value: 1000, appliesTo: 'campaign' } });
    for (let i = 0; i < 2; i++) emit(w.db, 'campaign.enrolled', { coachId: w.coach.id, clientId: c.id, enrolmentId: 'ce_x1', feePence: 9900, invoice: true, campaignName: 'January Reset', discountCode: 'camp10' });
    emit(w.db, 'campaign.enrolled', { coachId: w.coach.id, clientId: c.id, enrolmentId: 'ce_x2', feePence: 5000, invoice: true, campaignName: 'Ski-fit', discountCode: 'NOPE' });
    await w.settle();
    const invs = rows("SELECT * FROM invoices WHERE client_id=? AND source='campaign' ORDER BY source_ref", c.id);
    assert.equal(invs.length, 2);
    assert.equal(invs[0].discount_pence, 990);
    assert.match(invs[1].note, /NOPE not applied/);
    const found = await w.ok('GET', '/api/billing/invoices?sourceRef=ce_x1', { as: w.coach });
    assert.equal(found.invoices.length, 1);
  });

  test('the invoice.create action, variables and facts', async () => {
    const c = newClient('Ava Action');
    w.db.prepare("UPDATE users SET plan='performance' WHERE id=?").run(c.id);
    const row = one('SELECT * FROM users WHERE id=?', c.id);
    const out = runAction(w.db, w.config, 'invoice.create', { coachId: w.coach.id, client: row, params: { preset: 'planMonth', issue: 'no' }, now });
    assert.equal(out, 'Drafted an invoice');
    const inv = one('SELECT * FROM invoices WHERE client_id=?', c.id);
    assert.equal(inv.total_pence, 9900);
    await issue(inv.id);
    const r = render(w.db, w.coach.id, row, 'You owe {balance}: {oldestInvoice}. Credits {packageLeft}.');
    assert.match(r.text, /^You owe £99: JK-\d{4}-\d{4} \(£99\)\. Credits 0\.$/);
  });
});

describe('dunning (F11)', () => {
  test('the steps happen in order with injected days, once each, never outside 08:00–20:00', async () => {
    const c = newClient('Dana Dunning');
    const inv = await issue((await draft(c.id, [line(12000)])).id, {}, w.coach, noon(today));
    const due = inv.dueOn;
    const tick = (d, clock = '12:00') => runDunning(w.db, w.config, londonToUtc(d, clock));
    const sent = () => messagesTo(c.id, 'dunning').length;
    tick(due);
    assert.equal(sent(), 0, 'not overdue on the due day');
    tick(addDays(due, 1), '07:59');
    assert.equal(sent(), 0, 'too early');
    tick(addDays(due, 1), '20:00');
    assert.equal(sent(), 0, 'too late');
    tick(addDays(due, 1));
    tick(addDays(due, 1));
    let msgs = messagesTo(c.id, 'dunning');
    assert.equal(msgs.length, 1);
    assert.match(msgs[0].text, new RegExp(`^Hi Dana, a quick nudge that invoice ${inv.number} for £120 was due on`));
    await w.settle();
    assert.equal(rows("SELECT * FROM events WHERE type='invoice.overdue' AND client_id=?", c.id).length, 1);
    tick(addDays(due, 7));
    msgs = messagesTo(c.id, 'dunning');
    assert.equal(msgs.length, 2);
    assert.match(msgs[1].text, /is now 7 days overdue/);
    const notes = () => rows("SELECT * FROM coach_notifications WHERE client_id=? AND kind='invoiceOverdue'", c.id).length;
    tick(addDays(due, 14));
    tick(addDays(due, 15));
    assert.equal(messagesTo(c.id, 'dunning').length, 2, 'the coach step sends the client nothing');
    assert.equal(notes(), 1);
    await w.settle();
    assert.equal(rows("SELECT * FROM events WHERE type='invoice.overdue' AND client_id=?", c.id).length, 1, 'overdue is emitted once');
    const inbox = (await import('../features/billing.mjs')).feature.inbox(w.db, w.coach.row);
    assert.ok(inbox.some(i => i.key === `flag:invoice:${inv.id}`));
  });

  test('several steps due at once: only the latest acts', async () => {
    const c = newClient('Late Larry');
    const inv = await issue((await draft(c.id, [line(5000)])).id, {}, w.coach, noon(today));
    runDunning(w.db, w.config, noon(addDays(inv.dueOn, 9)));
    const msgs = messagesTo(c.id, 'dunning');
    assert.equal(msgs.length, 1);
    assert.match(msgs[0].text, /9 days overdue/);
    assert.equal(one('SELECT outcome FROM dunning_log WHERE invoice_id=? AND step=0', inv.id).outcome, 'skipped (a later step was due)');
  });

  test('paid stops further steps; paused stops them', async () => {
    const a = newClient('Paid Pam');
    const b = newClient('Paused Pete');
    const ia = await issue((await draft(a.id, [line(5000)])).id, {}, w.coach, noon(today));
    const ib = await issue((await draft(b.id, [line(5000)])).id, {}, w.coach, noon(today));
    runDunning(w.db, w.config, noon(addDays(ia.dueOn, 1)));
    await pay(a.id, ia.id, 5000);
    await w.ok('POST', `/api/billing/invoices/${ib.id}/reminders`, { as: w.coach, body: { paused: true } });
    runDunning(w.db, w.config, noon(addDays(ia.dueOn, 8)));
    assert.equal(messagesTo(a.id, 'dunning').length, 1);
    assert.equal(messagesTo(b.id, 'dunning').length, 1, 'only the step before the pause');
    const r = await w.ok('GET', `/api/billing/invoices/${ib.id}/reminders`, { as: w.coach });
    assert.equal(r.paused, true);
    assert.equal(r.next, null);
    // A manual reminder is logged as step 100+.
    const m = await w.ok('POST', `/api/billing/invoices/${ib.id}/remind`, { as: w.coach, body: { text: 'Hi Pete, a reminder from me.' } });
    assert.ok(m.messageId);
    assert.equal(one('SELECT step FROM dunning_log WHERE invoice_id=? AND step>=100', ib.id).step, 100);
  });

  test('demo coach clocks still run, with no push', async () => {
    buildDemo(w.db, realToday, w.config);
    const demoCoach = one("SELECT * FROM users WHERE apple_sub='demo-coach'");
    const pushesBefore = w.pushes.length;
    const tom = one("SELECT * FROM users WHERE apple_sub='demo-tom'");
    const tomInv = one("SELECT * FROM invoices WHERE client_id=? AND status='issued'", tom.id);
    assert.ok(tomInv, 'Tom has an overdue invoice in the demo');
    runDunning(w.db, w.config, noon(addDays(tomInv.due_on, 8)));
    assert.equal(rows("SELECT * FROM messages WHERE client_id=? AND via='dunning'", tom.id).length, 1);
    assert.equal(w.pushes.length, pushesBefore, 'demo pushes are skipped');
    // The demo has believable money in it.
    const ov = await w.ok('GET', '/api/billing/overview', { token: (await import('../auth.mjs')).issueSession(w.db, demoCoach.id) });
    assert.ok(ov.outstandingPence > 0 && ov.overduePence > 0 && ov.collectedSeries.some(m => m.pence > 0));
    assert.ok(one('SELECT COUNT(*) n FROM invoices WHERE coach_id=?', demoCoach.id).n >= 20);
  });
});
