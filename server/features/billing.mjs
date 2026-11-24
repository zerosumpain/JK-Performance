import { clientFor, initials, ownRow, requestNow, requireCoach } from '../access.mjs';
import { emit } from '../events.mjs';
import { runAction } from '../facts.mjs';
import { day as dayParam, fail, num, oneOf, raw, str } from '../http.mjs';
import { sendMessage } from '../messages.mjs';
import { notifyCoach } from '../notifications.mjs';
import { planOf } from '../plans.mjs';
import { allActions } from '../registry.mjs';
import { likeAny, matchScore } from '../search.mjs';
import { newId, nowIso, tx } from '../store.mjs';
import { render } from '../templating.mjs';
import { addDays, daysBetween, londonClock, londonDay, londonToUtc, monthBounds } from '../time.mjs';

/**
 * F9 Invoices and the payments ledger, F10 Packages, credits and recurring
 * billing, F11 Dunning, and the discount maths of F12 (docs/design/desk-v2.md,
 * WP3). Billing is a RECORD of money handled outside the app: nothing here
 * charges a card, calls a payment provider or changes users.plan.
 *
 * Money is integer pence; days are London YYYY-MM-DD. Issued invoices are
 * immutable apart from their note: corrections are credit notes or a void.
 *
 * Isolation: every read of client-linked rows joins the client's CURRENT
 * coach (users.coach_id), never the stored coach_id, so a client moved to
 * another coach leaves the old coach's lists (404 / empty) and arrives in the
 * new coach's. Coach-owned catalogue rows (packages, discounts, settings) are
 * scoped by coach_id.
 *
 * The `discounts` and `discount_redemptions` tables live here, not in
 * offers.mjs, because invoices and schedules apply them inside the issue
 * transaction; offers.mjs (same package) owns the discount screens, codes
 * and referrals and reads these tables.
 */

export const METHODS = ['bank', 'cash', 'card', 'other'];
const LINE_KINDS = ['plan', 'session', 'package', 'campaign', 'kit', 'custom'];
const BOOKING_KINDS = ['any', 'inperson', 'video', 'group'];
const INTERVALS = ['week', 'fourWeeks', 'month'];
const APPLIES = ['any', 'plan', 'package', 'campaign', 'session'];
const MAX_UNIT = 10_000_000; // £100,000
const DEFAULT_DUNNING = [{ day: 1, template: 'gentle' }, { day: 7, template: 'firm' }, { day: 14, template: 'coach' }];
export const DEFAULT_TEXTS = {
  gentle: 'Hi {first}, a quick nudge that invoice {invoiceNumber} for {invoiceTotal} was due on {invoiceDue}. Details are in our last message. Thanks!',
  firm: 'Hi {first}, invoice {invoiceNumber} ({invoiceTotal}) is now {daysOverdue} days overdue. Could you sort it this week, or let me know if something\'s up?',
  receipt: 'Thanks, {first}: received {paymentAmount} on {paymentDay} for {invoiceNumber}.',
};
const MANUAL_STEP = 100; // manual reminders are logged as step 100 + n
const PAUSED_STEP = -1;

// MARK: - Small helpers

export const money = p => `${p < 0 ? '−' : ''}£${(Math.abs(p) / 100).toLocaleString('en-GB', { minimumFractionDigits: Math.abs(p) % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const fmtDay = d => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '') : '');
const first = name => String(name ?? '').trim().split(/\s+/)[0] || 'there';
const REQUIRED = Symbol('required');
const who = u => (u ? { id: u.id, name: u.name, initials: initials(u.name) } : null);
const todayOf = ctx => londonDay(requestNow(ctx));
const json = (s, fallback) => { try { return JSON.parse(s) ?? fallback; } catch { return fallback; } };
const bool = (v, name) => { if (v === undefined || v === null) return false; if (typeof v !== 'boolean') fail(400, `${name} must be true or false`); return v; };
const int = (v, name, opts) => num(v, name, { int: true, ...opts });
const text = (v, name, max = 500) => (v === undefined || v === null ? '' : str(v, name, { max, min: 0 }));
const dayOfIso = iso => londonDay(new Date(iso));

/** Add whole months to a day, clamped to the month's end; `anchor` keeps the original day of month (31 Jan → 28 Feb → 31 Mar). */
export function addMonths(d, n, anchor = Number(d.slice(8, 10))) {
  const [y, m] = d.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12), nm = total % 12 + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(anchor, last)).padStart(2, '0')}`;
}

/** The next billing day after `d` for a schedule. */
export function nextBillingDay(d, interval, anchor) {
  if (interval === 'week') return addDays(d, 7);
  if (interval === 'fourWeeks') return addDays(d, 28);
  return addMonths(d, 1, anchor);
}

/** A schedule's amount as money per month: week × 52/12, four weeks × 13/12. */
export const monthlyOf = (amount, interval) => Math.round(interval === 'week' ? amount * 52 / 12 : interval === 'fourWeeks' ? amount * 13 / 12 : amount);


// MARK: - Schema

function schema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS billing_settings (
      coach_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      business_name TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
      payment_details TEXT NOT NULL DEFAULT '',
      invoice_prefix TEXT NOT NULL DEFAULT 'JK', next_number INTEGER NOT NULL DEFAULT 1,
      due_days INTEGER NOT NULL DEFAULT 14, vat_rate_bp INTEGER NOT NULL DEFAULT 0, vat_number TEXT NOT NULL DEFAULT '',
      footer TEXT NOT NULL DEFAULT '', auto_issue_recurring INTEGER NOT NULL DEFAULT 0,
      dunning TEXT NOT NULL DEFAULT '[{"day":1,"template":"gentle"},{"day":7,"template":"firm"},{"day":14,"template":"coach"}]',
      receipt_text TEXT NOT NULL DEFAULT '', gentle_text TEXT NOT NULL DEFAULT '', firm_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      number TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','paid','void')),
      issue_on TEXT, due_on TEXT,
      subtotal_pence INTEGER NOT NULL DEFAULT 0, discount_pence INTEGER NOT NULL DEFAULT 0,
      tax_pence INTEGER NOT NULL DEFAULT 0, total_pence INTEGER NOT NULL DEFAULT 0, paid_pence INTEGER NOT NULL DEFAULT 0,
      discount_id TEXT, note TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      source_ref TEXT, sent_message_id TEXT, void_reason TEXT,
      created_at TEXT NOT NULL, issued_at TEXT, paid_at TEXT, voided_at TEXT,
      UNIQUE (coach_id, number));
    CREATE INDEX IF NOT EXISTS invoices_coach_status ON invoices(coach_id, status, due_on);
    CREATE INDEX IF NOT EXISTS invoices_client ON invoices(client_id);
    CREATE INDEX IF NOT EXISTS invoices_source_ref ON invoices(source_ref);
    CREATE TABLE IF NOT EXISTS invoice_lines (
      id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, description TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1, unit_pence INTEGER NOT NULL, amount_pence INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'custom', ref TEXT);
    CREATE INDEX IF NOT EXISTS invoice_lines_invoice ON invoice_lines(invoice_id, position);
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
      amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
      method TEXT NOT NULL CHECK (method IN ('bank','cash','card','other')),
      received_on TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, voided_at TEXT);
    CREATE INDEX IF NOT EXISTS payments_client ON payments(client_id, received_on);
    CREATE INDEX IF NOT EXISTS payments_invoice ON payments(invoice_id);
    CREATE TABLE IF NOT EXISTS credit_notes (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
      amount_pence INTEGER NOT NULL CHECK (amount_pence > 0), reason TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS credit_notes_client ON credit_notes(client_id);
    CREATE TABLE IF NOT EXISTS refunds (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credit_note_id TEXT NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
      amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
      method TEXT NOT NULL CHECK (method IN ('bank','cash','card','other')),
      paid_on TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, voided_at TEXT);
    CREATE TABLE IF NOT EXISTS packages (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', sessions INTEGER NOT NULL CHECK (sessions BETWEEN 1 AND 200),
      price_pence INTEGER NOT NULL, valid_days INTEGER NOT NULL DEFAULT 90,
      booking_kind TEXT NOT NULL DEFAULT 'any',
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS client_packages (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      package_id TEXT REFERENCES packages(id) ON DELETE SET NULL,
      name TEXT NOT NULL, booking_kind TEXT NOT NULL, sessions_total INTEGER NOT NULL, sessions_used INTEGER NOT NULL DEFAULT 0,
      starts_on TEXT NOT NULL, expires_on TEXT NOT NULL, invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','used','expired','cancelled')),
      created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS client_packages_client ON client_packages(client_id, status, expires_on);
    CREATE TABLE IF NOT EXISTS credit_moves (
      id TEXT PRIMARY KEY, client_package_id TEXT NOT NULL REFERENCES client_packages(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      booking_id TEXT, delta INTEGER NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL,
      UNIQUE (client_package_id, booking_id, reason));
    CREATE INDEX IF NOT EXISTS credit_moves_booking ON credit_moves(booking_id);
    CREATE TABLE IF NOT EXISTS billing_schedules (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL, amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
      interval TEXT NOT NULL CHECK (interval IN ('week','fourWeeks','month')),
      next_on TEXT NOT NULL, ends_on TEXT, discount_id TEXT,
      discount_cycles INTEGER, discount_used INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
      paused_until TEXT, anchor_day INTEGER, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS billing_schedules_due ON billing_schedules(status, next_on);
    CREATE TABLE IF NOT EXISTS billing_client_state (
      client_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ended_at TEXT, keep_chasing INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS dunning_log (
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      step INTEGER NOT NULL, outcome TEXT NOT NULL, message_id TEXT, at TEXT NOT NULL,
      PRIMARY KEY (invoice_id, step));
    CREATE TABLE IF NOT EXISTS discounts (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code TEXT, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
      value INTEGER NOT NULL, applies_to TEXT NOT NULL DEFAULT 'any',
      starts_on TEXT, ends_on TEXT, max_redemptions INTEGER, per_client_max INTEGER NOT NULL DEFAULT 1,
      first_invoice_only INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
      client_id TEXT REFERENCES users(id) ON DELETE CASCADE, origin TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS discounts_code ON discounts(coach_id, code) WHERE code IS NOT NULL;
    CREATE TABLE IF NOT EXISTS discount_redemptions (
      id TEXT PRIMARY KEY, discount_id TEXT NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
      coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL, amount_pence INTEGER NOT NULL, at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS discount_redemptions_discount ON discount_redemptions(discount_id);`);
}

// MARK: - Settings

const SETTINGS_DEFAULT = {
  business_name: '', address: '', payment_details: '', invoice_prefix: 'JK', next_number: 1, due_days: 14, vat_rate_bp: 0, vat_number: '',
  footer: '', auto_issue_recurring: 0, dunning: JSON.stringify(DEFAULT_DUNNING), receipt_text: '', gentle_text: '', firm_text: '', updated_at: null,
};

/** A coach's billing settings row (defaults when none is saved yet; nothing is written). */
export function settingsRow(db, coachId) {
  return db.prepare('SELECT * FROM billing_settings WHERE coach_id=?').get(coachId) ?? { coach_id: coachId, ...SETTINGS_DEFAULT };
}

const settingsOut = s => ({
  businessName: s.business_name, address: s.address, paymentDetails: s.payment_details, invoicePrefix: s.invoice_prefix, nextNumber: s.next_number,
  dueDays: s.due_days, vatRateBp: s.vat_rate_bp, vatNumber: s.vat_number, footer: s.footer, autoIssueRecurring: !!s.auto_issue_recurring,
  dunning: json(s.dunning, DEFAULT_DUNNING),
  texts: { receipt: s.receipt_text || DEFAULT_TEXTS.receipt, gentle: s.gentle_text || DEFAULT_TEXTS.gentle, firm: s.firm_text || DEFAULT_TEXTS.firm },
  defaults: DEFAULT_TEXTS, updatedAt: s.updated_at,
});

function ensureSettings(db, coachId) {
  db.prepare(`INSERT OR IGNORE INTO billing_settings (coach_id, updated_at) VALUES (?, ?)`).run(coachId, nowIso());
  return db.prepare('SELECT * FROM billing_settings WHERE coach_id=?').get(coachId);
}

function getSettings(_req, ctx) {
  requireCoach(ctx);
  return { settings: settingsOut(settingsRow(ctx.db, ctx.user.id)) };
}

function putSettings(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const cur = settingsOut(settingsRow(ctx.db, ctx.user.id));
  const pick = (k, fn) => (b[k] === undefined ? cur[k] : fn(b[k]));
  const prefix = pick('invoicePrefix', v => str(v, 'invoicePrefix', { max: 12 }));
  if (!/^[A-Za-z0-9]{1,12}$/.test(prefix)) fail(400, 'invoicePrefix must be letters and digits');
  let dunning = cur.dunning;
  if (b.dunning !== undefined) {
    if (!Array.isArray(b.dunning) || b.dunning.length > 6) fail(400, 'dunning must be a list of up to 6 steps');
    let last = -1;
    dunning = b.dunning.map((s, i) => {
      const d = int(s?.day, `dunning[${i}].day`, { min: 0, max: 180 });
      if (d <= last) fail(400, 'dunning steps must be in order of days');
      last = d;
      return { day: d, template: oneOf(s?.template, `dunning[${i}].template`, ['gentle', 'firm', 'coach']) };
    });
  }
  const texts = { ...cur.texts };
  if (b.texts !== undefined) {
    if (!b.texts || typeof b.texts !== 'object') fail(400, 'texts must be an object');
    for (const k of ['receipt', 'gentle', 'firm']) if (b.texts[k] !== undefined) texts[k] = str(b.texts[k], `texts.${k}`, { max: 1000 });
  }
  const next = {
    businessName: pick('businessName', v => text(v, 'businessName', 120)),
    address: pick('address', v => text(v, 'address', 400)),
    paymentDetails: pick('paymentDetails', v => text(v, 'paymentDetails', 400)),
    dueDays: pick('dueDays', v => int(v, 'dueDays', { min: 0, max: 120 })),
    vatRateBp: pick('vatRateBp', v => int(v, 'vatRateBp', { min: 0, max: 2500 })),
    vatNumber: pick('vatNumber', v => text(v, 'vatNumber', 40)),
    footer: pick('footer', v => text(v, 'footer', 400)),
    autoIssueRecurring: pick('autoIssueRecurring', v => bool(v, 'autoIssueRecurring')),
  };
  tx(ctx.db, () => {
    ensureSettings(ctx.db, ctx.user.id);
    ctx.db.prepare(`UPDATE billing_settings SET business_name=?, address=?, payment_details=?, invoice_prefix=?, due_days=?, vat_rate_bp=?, vat_number=?,
      footer=?, auto_issue_recurring=?, dunning=?, receipt_text=?, gentle_text=?, firm_text=?, updated_at=? WHERE coach_id=?`)
      .run(next.businessName, next.address, next.paymentDetails, prefix.toUpperCase(), next.dueDays, next.vatRateBp, next.vatNumber, next.footer,
        next.autoIssueRecurring ? 1 : 0, JSON.stringify(dunning),
        texts.receipt === DEFAULT_TEXTS.receipt ? '' : texts.receipt, texts.gentle === DEFAULT_TEXTS.gentle ? '' : texts.gentle,
        texts.firm === DEFAULT_TEXTS.firm ? '' : texts.firm, nowIso(), ctx.user.id);
  });
  return { settings: settingsOut(settingsRow(ctx.db, ctx.user.id)) };
}

// MARK: - Discounts (the maths; offers.mjs owns the screens and codes)

/**
 * Can `discount` apply to these lines for this client today? Returns
 * {ok, amountPence, reason}. Percent rounds down; both kinds are capped at
 * the eligible lines' sum. Limits count redemptions (written on issue).
 */
export function checkDiscount(db, discount, { clientId, lines, today, invoiceId = null }) {
  if (!discount) return { ok: false, reason: 'No such code' };
  if (!discount.active) return { ok: false, reason: 'That offer is switched off' };
  if (discount.client_id && discount.client_id !== clientId) return { ok: false, reason: 'That code belongs to another client' };
  if (discount.starts_on && today < discount.starts_on) return { ok: false, reason: `That offer starts on ${fmtDay(discount.starts_on)}` };
  if (discount.ends_on && today > discount.ends_on) return { ok: false, reason: 'That offer has ended' };
  const used = db.prepare('SELECT COUNT(*) n FROM discount_redemptions WHERE discount_id=? AND (? IS NULL OR invoice_id IS NOT ?)').get(discount.id, invoiceId, invoiceId).n;
  if (discount.max_redemptions !== null && discount.max_redemptions !== undefined && used >= discount.max_redemptions) return { ok: false, reason: 'That offer has been used up' };
  const mine = db.prepare('SELECT COUNT(*) n FROM discount_redemptions WHERE discount_id=? AND client_id=? AND (? IS NULL OR invoice_id IS NOT ?)').get(discount.id, clientId, invoiceId, invoiceId).n;
  if (mine >= discount.per_client_max) return { ok: false, reason: 'Already used by this client' };
  if (discount.first_invoice_only) {
    const before = db.prepare("SELECT COUNT(*) n FROM invoices WHERE client_id=? AND status IN ('issued','paid') AND id IS NOT ?").get(clientId, invoiceId).n;
    if (before) return { ok: false, reason: 'Only for a client\'s first invoice' };
  }
  const eligible = (lines ?? []).filter(l => discount.applies_to === 'any' || l.kind === discount.applies_to);
  if (!eligible.length) return { ok: false, reason: `Applies to ${discount.applies_to} lines only` };
  const base = eligible.reduce((n, l) => n + (l.amount_pence ?? l.amountPence ?? 0), 0);
  const amount = discount.kind === 'percent' ? Math.floor(base * discount.value / 10_000) : Math.min(discount.value, base);
  return { ok: true, amountPence: Math.max(0, Math.min(amount, base)) };
}

export const discountByCode = (db, coachId, code) => (code ? db.prepare('SELECT * FROM discounts WHERE coach_id=? AND code=?').get(coachId, String(code).trim().toUpperCase()) : null);

// MARK: - Invoices: reading

const lineOut = l => ({ id: l.id, position: l.position, description: l.description, quantity: l.quantity, unitPence: l.unit_pence, amountPence: l.amount_pence, kind: l.kind, ref: l.ref });
const linesOf = (db, invoiceId) => db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=? ORDER BY position').all(invoiceId);
const creditedOf = (db, invoiceId) => db.prepare('SELECT COALESCE(SUM(amount_pence),0) n FROM credit_notes WHERE invoice_id=?').get(invoiceId).n;

/** What the client still owes on one invoice (never below zero). */
const outstandingOf = (inv, credited) => (['issued', 'paid'].includes(inv.status) ? Math.max(0, inv.total_pence - inv.paid_pence - credited) : 0);

/** The status shown to people: overdue and partial are derived, never stored. */
export function displayStatus(inv, today, credited = 0) {
  if (inv.status !== 'issued') return inv.status;
  if (inv.total_pence - inv.paid_pence - credited <= 0) return 'credited';
  if (inv.due_on && inv.due_on < today) return 'overdue';
  if (inv.paid_pence > 0) return 'partial';
  return 'issued';
}

function invoiceOut(db, inv, today, client = null) {
  const credited = creditedOf(db, inv.id);
  const status = displayStatus(inv, today, credited);
  const c = client ?? db.prepare('SELECT id, name FROM users WHERE id=?').get(inv.client_id);
  const discount = inv.discount_id ? db.prepare('SELECT id, name, code FROM discounts WHERE id=?').get(inv.discount_id) : null;
  const paused = !!db.prepare('SELECT 1 FROM dunning_log WHERE invoice_id=? AND step=?').get(inv.id, PAUSED_STEP);
  return {
    id: inv.id, number: inv.number, client: who(c), clientId: inv.client_id, status: inv.status, displayStatus: status,
    issueOn: inv.issue_on, dueOn: inv.due_on, subtotalPence: inv.subtotal_pence, discountPence: inv.discount_pence, taxPence: inv.tax_pence,
    totalPence: inv.total_pence, paidPence: inv.paid_pence, creditedPence: credited, outstandingPence: outstandingOf(inv, credited),
    daysOverdue: status === 'overdue' ? daysBetween(inv.due_on, today) : null,
    discount: discount ? { id: discount.id, name: discount.name, code: discount.code } : null,
    note: inv.note, source: inv.source, sourceRef: inv.source_ref, sentMessageId: inv.sent_message_id, voidReason: inv.void_reason,
    remindersPaused: paused, createdAt: inv.created_at, issuedAt: inv.issued_at, paidAt: inv.paid_at, voidedAt: inv.voided_at,
  };
}

/** One of the coach's invoices, by the client's CURRENT coach; else 404. */
function ownInvoice(ctx, id) {
  if (typeof id !== 'string' || !id) fail(404, 'Not found');
  const inv = ctx.db.prepare(`SELECT i.* FROM invoices i JOIN users cu ON cu.id=i.client_id AND cu.role='client' AND cu.coach_id=? WHERE i.id=?`).get(ctx.user.id, id);
  if (!inv) fail(404, 'Not found');
  return inv;
}

const paymentOut = p => ({ id: p.id, clientId: p.client_id, invoiceId: p.invoice_id, amountPence: p.amount_pence, method: p.method, receivedOn: p.received_on,
  reference: p.reference, note: p.note, createdAt: p.created_at, voidedAt: p.voided_at, invoiceNumber: p.invoice_number ?? null, client: p.client_name ? { id: p.client_id, name: p.client_name, initials: initials(p.client_name) } : undefined });
const creditOut = c => ({ id: c.id, clientId: c.client_id, invoiceId: c.invoice_id, amountPence: c.amount_pence, reason: c.reason, createdAt: c.created_at,
  refundedPence: c.refunded ?? 0, invoiceNumber: c.invoice_number ?? null, client: c.client_name ? { id: c.client_id, name: c.client_name, initials: initials(c.client_name) } : undefined });
const refundOut = r => ({ id: r.id, clientId: r.client_id, creditNoteId: r.credit_note_id, amountPence: r.amount_pence, method: r.method, paidOn: r.paid_on, reference: r.reference, createdAt: r.created_at, voidedAt: r.voided_at });

/**
 * A client's balance: Σ issued and paid invoice totals − Σ payments − Σ
 * credit notes + Σ refunds (voided payments and refunds left out).
 * Positive means they owe; negative means account credit.
 */
export function balanceOf(db, clientId) {
  const r = db.prepare(`SELECT
      (SELECT COALESCE(SUM(total_pence),0) FROM invoices WHERE client_id=?1 AND status IN ('issued','paid'))
    - (SELECT COALESCE(SUM(amount_pence),0) FROM payments WHERE client_id=?1 AND voided_at IS NULL)
    - (SELECT COALESCE(SUM(amount_pence),0) FROM credit_notes WHERE client_id=?1)
    + (SELECT COALESCE(SUM(amount_pence),0) FROM refunds WHERE client_id=?1 AND voided_at IS NULL) AS b`).get(clientId);
  return r.b;
}

function invoiceEvents(db, inv) {
  const out = [{ at: inv.created_at, kind: 'created', title: inv.source === 'manual' ? 'Draft created' : `Draft created (${inv.source})` }];
  if (inv.issued_at) out.push({ at: inv.issued_at, kind: 'issued', title: `Issued as ${inv.number}`, detail: inv.due_on ? `Due ${fmtDay(inv.due_on)}` : '' });
  if (inv.sent_message_id) {
    const m = db.prepare('SELECT at FROM messages WHERE id=?').get(inv.sent_message_id);
    if (m) out.push({ at: m.at, kind: 'sent', title: 'Sent to the client\'s thread' });
  }
  for (const p of db.prepare('SELECT * FROM payments WHERE invoice_id=? ORDER BY created_at').all(inv.id)) {
    out.push({ at: p.created_at, kind: p.voided_at ? 'paymentVoided' : 'payment', title: `${p.voided_at ? 'Payment removed' : 'Payment recorded'} · ${money(p.amount_pence)}`, detail: `${p.method} · ${fmtDay(p.received_on)}${p.reference ? ` · ${p.reference}` : ''}` });
  }
  for (const c of db.prepare('SELECT * FROM credit_notes WHERE invoice_id=?').all(inv.id)) out.push({ at: c.created_at, kind: 'credit', title: `Credit note · ${money(c.amount_pence)}`, detail: c.reason });
  for (const d of db.prepare('SELECT * FROM dunning_log WHERE invoice_id=? ORDER BY at').all(inv.id)) {
    out.push({ at: d.at, kind: 'reminder', title: d.step === PAUSED_STEP ? 'Reminders paused' : d.step >= MANUAL_STEP ? 'Reminder sent by you' : `Reminder step ${d.step + 1}`, detail: d.outcome });
  }
  if (inv.paid_at) out.push({ at: inv.paid_at, kind: 'paid', title: 'Paid in full' });
  if (inv.voided_at) out.push({ at: inv.voided_at, kind: 'void', title: 'Voided', detail: inv.void_reason ?? '' });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// MARK: - Invoices: writing

/** Lines from a request: [{description, quantity, unitPence, kind?, ref?}], with amounts. */
function linesFrom(body) {
  if (!Array.isArray(body) || body.length > 50) fail(400, 'lines must be a list of up to 50 lines');
  return body.map((l, i) => {
    const quantity = num(l?.quantity ?? 1, `lines[${i}].quantity`, { min: 0.01, max: 1000 });
    const unit = int(l?.unitPence, `lines[${i}].unitPence`, { min: 0, max: MAX_UNIT });
    return {
      description: str(l?.description, `lines[${i}].description`, { max: 200 }), quantity, unit_pence: unit, amount_pence: Math.round(quantity * unit),
      kind: l?.kind === undefined ? 'custom' : oneOf(l.kind, `lines[${i}].kind`, LINE_KINDS), ref: l?.ref ? str(l.ref, `lines[${i}].ref`, { max: 80 }) : null,
    };
  });
}

/** Subtotal, discount (capped), VAT and total, in pence. VAT is round((subtotal − discount) × rate / 10000). */
export function totalsOf(lines, discountPence, vatRateBp) {
  const subtotal = lines.reduce((n, l) => n + l.amount_pence, 0);
  const discount = Math.max(0, Math.min(discountPence ?? 0, subtotal));
  const tax = Math.round((subtotal - discount) * vatRateBp / 10_000);
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}

function writeLines(db, invoiceId, lines) {
  db.prepare('DELETE FROM invoice_lines WHERE invoice_id=?').run(invoiceId);
  const ins = db.prepare('INSERT INTO invoice_lines (id, invoice_id, position, description, quantity, unit_pence, amount_pence, kind, ref) VALUES (?,?,?,?,?,?,?,?,?)');
  lines.forEach((l, i) => ins.run(newId('il'), invoiceId, i, l.description, l.quantity, l.unit_pence, l.amount_pence, l.kind, l.ref ?? null));
}

/**
 * Recompute a draft's totals from its lines and its discount. A discount that
 * no longer applies is dropped (and the reason returned).
 */
function retotal(db, invoiceId, today) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
  const lines = linesOf(db, invoiceId);
  const s = settingsRow(db, inv.coach_id);
  let discountPence = 0, dropped = null;
  if (inv.discount_id) {
    const d = db.prepare('SELECT * FROM discounts WHERE id=?').get(inv.discount_id);
    const check = checkDiscount(db, d, { clientId: inv.client_id, lines, today, invoiceId });
    if (check.ok) discountPence = check.amountPence;
    else { dropped = check.reason; db.prepare('UPDATE invoices SET discount_id=NULL WHERE id=?').run(invoiceId); }
  }
  const t = totalsOf(lines, discountPence, s.vat_rate_bp);
  db.prepare('UPDATE invoices SET subtotal_pence=?, discount_pence=?, tax_pence=?, total_pence=? WHERE id=?').run(t.subtotal, t.discount, t.tax, t.total, invoiceId);
  return dropped;
}

/** Make a draft invoice (no request): used by routes, the recurring clock, packages, campaigns and the cancellation policy. */
export function createDraft(db, { coachId, clientId, lines, dueOn = null, note = '', source = 'manual', sourceRef = null, discountId = null, today }) {
  const id = newId('iv');
  db.prepare(`INSERT INTO invoices (id, coach_id, client_id, status, due_on, note, source, source_ref, discount_id, created_at) VALUES (?,?,?,'draft',?,?,?,?,?,?)`)
    .run(id, coachId, clientId, dueOn, note, source, sourceRef, discountId, nowIso());
  writeLines(db, id, lines);
  const dropped = retotal(db, id, today);
  return { invoice: db.prepare('SELECT * FROM invoices WHERE id=?').get(id), dropped };
}

/** The next invoice number for a coach, assigned inside the caller's transaction: '<prefix>-<YYYY>-<0001>'. */
function takeNumber(db, coachId, issueDay) {
  const s = ensureSettings(db, coachId);
  let n = s.next_number;
  let number;
  for (;;) {
    number = `${s.invoice_prefix}-${issueDay.slice(0, 4)}-${String(n).padStart(4, '0')}`;
    if (!db.prepare('SELECT 1 FROM invoices WHERE coach_id=? AND number=?').get(coachId, number)) break;
    n++;
  }
  db.prepare('UPDATE billing_settings SET next_number=? WHERE coach_id=?').run(n + 1, coachId);
  return number;
}

/** The thread message for an issued invoice: "Invoice JK-2026-0012 · £120 due Fri 5 Dec. Pay by bank transfer to … (ref JK-2026-0012)". */
function invoiceMessage(db, inv) {
  const s = settingsRow(db, inv.coach_id);
  const details = s.payment_details.split(/\s*\n\s*/).filter(Boolean).join(' · ');
  return `Invoice ${inv.number} · ${money(inv.total_pence)} due ${fmtDay(inv.due_on)}. Pay by bank transfer${details ? ` to ${details}` : ''} (ref ${inv.number}).`;
}

/**
 * Issue a draft: the number is assigned atomically, issue_on is today and
 * due_on issue + due_days unless given. A discount is re-checked and its
 * redemption written now (never on draft). With `send`, the invoice goes into
 * the client's thread through sendMessage (`via`, default coachAction).
 * Runs inside the caller's transaction. Returns the fresh row.
 */
export function issueInvoice(db, config, inv, { today, dueOn = null, send = false, via = 'coachAction', now = new Date(), actingCoachId = inv.coach_id }) {
  if (inv.status !== 'draft') fail(409, 'Only a draft can be issued');
  const lines = linesOf(db, inv.id);
  if (!lines.length) fail(400, 'Add at least one line');
  if (inv.discount_id) {
    const d = db.prepare('SELECT * FROM discounts WHERE id=?').get(inv.discount_id);
    const check = checkDiscount(db, d, { clientId: inv.client_id, lines, today, invoiceId: inv.id });
    if (!check.ok) fail(409, `Discount: ${check.reason}`);
  }
  retotal(db, inv.id, today);
  const fresh = db.prepare('SELECT * FROM invoices WHERE id=?').get(inv.id);
  if (fresh.total_pence <= 0) fail(400, 'There is nothing to bill');
  const s = ensureSettings(db, actingCoachId);
  const number = takeNumber(db, actingCoachId, today);
  const due = dueOn ?? fresh.due_on ?? addDays(today, s.due_days);
  db.prepare(`UPDATE invoices SET status='issued', number=?, coach_id=?, issue_on=?, due_on=?, issued_at=? WHERE id=?`).run(number, actingCoachId, today, due, now.toISOString(), inv.id);
  if (fresh.discount_id && fresh.discount_pence > 0) {
    db.prepare('INSERT INTO discount_redemptions (id, discount_id, coach_id, client_id, invoice_id, amount_pence, at) VALUES (?,?,?,?,?,?,?)')
      .run(newId('dr'), fresh.discount_id, actingCoachId, inv.client_id, inv.id, fresh.discount_pence, now.toISOString());
  }
  const issued = db.prepare('SELECT * FROM invoices WHERE id=?').get(inv.id);
  emit(db, 'invoice.issued', { coachId: actingCoachId, clientId: inv.client_id, summary: `Invoice ${number} · ${money(issued.total_pence)}`,
    invoiceId: inv.id, totalPence: issued.total_pence, dueOn: due, source: issued.source,
    ...(issued.discount_id && issued.discount_pence ? { discountId: issued.discount_id, discountPence: issued.discount_pence } : {}) });
  if (send) {
    const out = sendMessage(db, config, { coachId: actingCoachId, clientId: inv.client_id, text: invoiceMessage(db, issued), via, now });
    if (out.message) db.prepare('UPDATE invoices SET sent_message_id=? WHERE id=?').run(out.message.id, inv.id);
  }
  return db.prepare('SELECT * FROM invoices WHERE id=?').get(inv.id);
}

/** Re-derive an invoice's paid amount and status from its payments; emits invoice.paid when it becomes paid. */
function rederive(db, invoiceId, now = new Date()) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
  if (!inv || inv.status === 'draft' || inv.status === 'void') return inv;
  const paid = db.prepare('SELECT COALESCE(SUM(amount_pence),0) n FROM payments WHERE invoice_id=? AND voided_at IS NULL').get(invoiceId).n;
  if (paid >= inv.total_pence && inv.status !== 'paid') {
    db.prepare("UPDATE invoices SET paid_pence=?, status='paid', paid_at=? WHERE id=?").run(paid, now.toISOString(), invoiceId);
    emit(db, 'invoice.paid', { coachId: inv.coach_id, clientId: inv.client_id, summary: `Paid ${inv.number} · ${money(inv.total_pence)}`, invoiceId, totalPence: inv.total_pence });
  } else if (paid < inv.total_pence && inv.status === 'paid') {
    db.prepare("UPDATE invoices SET paid_pence=?, status='issued', paid_at=NULL WHERE id=?").run(paid, invoiceId);
  } else {
    db.prepare('UPDATE invoices SET paid_pence=? WHERE id=?').run(paid, invoiceId);
  }
  return db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
}

// MARK: - Invoice routes

function listInvoices(_req, ctx) {
  requireCoach(ctx);
  const today = todayOf(ctx);
  const q = ctx.query;
  const where = ['cu.coach_id=?'], args = [ctx.user.id];
  if (q.clientId) { const c = clientFor(ctx, q.clientId); where.push('i.client_id=?'); args.push(c.id); }
  if (q.sourceRef) { where.push('i.source_ref=?'); args.push(String(q.sourceRef).slice(0, 120)); }
  if (q.from) { where.push('COALESCE(i.issue_on, substr(i.created_at,1,10))>=?'); args.push(dayParam(q.from, 'from')); }
  if (q.to) { where.push('COALESCE(i.issue_on, substr(i.created_at,1,10))<=?'); args.push(dayParam(q.to, 'to')); }
  const status = q.status ? oneOf(q.status, 'status', ['draft', 'issued', 'paid', 'void', 'overdue', 'partial', 'open']) : null;
  if (status && ['draft', 'issued', 'paid', 'void'].includes(status)) { where.push('i.status=?'); args.push(status); }
  if (status === 'open' || status === 'overdue' || status === 'partial') where.push("i.status='issued'");
  const rows = ctx.db.prepare(`SELECT i.*, cu.name client_name FROM invoices i JOIN users cu ON cu.id=i.client_id AND cu.role='client'
    WHERE ${where.join(' AND ')} ORDER BY COALESCE(i.issue_on, substr(i.created_at,1,10)) DESC, i.number DESC LIMIT 1000`).all(...args);
  let out = rows.map(r => invoiceOut(ctx.db, r, today, { id: r.client_id, name: r.client_name }));
  if (status === 'overdue') out = out.filter(i => i.displayStatus === 'overdue');
  if (status === 'partial') out = out.filter(i => i.displayStatus === 'partial');
  if (status === 'open') out = out.filter(i => i.outstandingPence > 0);
  return { invoices: out };
}

function invoiceFields(ctx) {
  const b = ctx.body;
  return {
    lines: linesFrom(b.lines ?? []),
    dueOn: b.dueOn === undefined || b.dueOn === null || b.dueOn === '' ? null : dayParam(b.dueOn, 'dueOn'),
    note: text(b.note, 'note', 1000),
  };
}

/** Resolve {discountCode} or {discountId} from a request to a discount row (400 with the reason when it cannot apply). */
function discountFrom(ctx, clientId, lines, invoiceId = null) {
  const b = ctx.body;
  let d = null;
  if (b.discountCode) {
    d = discountByCode(ctx.db, ctx.user.id, str(b.discountCode, 'discountCode', { max: 40 }));
    if (!d) fail(400, 'Discount: No such code');
  } else if (b.discountId) {
    d = ctx.db.prepare('SELECT * FROM discounts WHERE id=? AND coach_id=?').get(String(b.discountId), ctx.user.id);
    if (!d) fail(404, 'Not found');
  }
  if (!d) return null;
  const check = checkDiscount(ctx.db, d, { clientId, lines, today: todayOf(ctx), invoiceId });
  if (!check.ok) fail(400, `Discount: ${check.reason}`);
  return d;
}

function detailOut(db, inv, today) {
  return {
    invoice: invoiceOut(db, inv, today),
    lines: linesOf(db, inv.id).map(lineOut),
    payments: db.prepare('SELECT * FROM payments WHERE invoice_id=? ORDER BY received_on, created_at').all(inv.id).map(paymentOut),
    creditNotes: db.prepare('SELECT c.*, (SELECT COALESCE(SUM(amount_pence),0) FROM refunds r WHERE r.credit_note_id=c.id AND r.voided_at IS NULL) refunded FROM credit_notes c WHERE invoice_id=? ORDER BY created_at').all(inv.id).map(creditOut),
    events: invoiceEvents(db, inv),
    settings: settingsOut(settingsRow(db, inv.coach_id)),
  };
}

function createInvoice(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  const f = invoiceFields(ctx);
  const today = todayOf(ctx);
  const out = tx(ctx.db, () => {
    const d = discountFrom(ctx, client.id, f.lines);
    return createDraft(ctx.db, { coachId: ctx.user.id, clientId: client.id, lines: f.lines, dueOn: f.dueOn, note: f.note, discountId: d?.id ?? null, today }).invoice;
  });
  return { invoice: invoiceOut(ctx.db, out, today) };
}

function getInvoice(_req, ctx) {
  requireCoach(ctx);
  return detailOut(ctx.db, ownInvoice(ctx, ctx.params.id), todayOf(ctx));
}

function updateInvoice(_req, ctx) {
  requireCoach(ctx);
  const inv = ownInvoice(ctx, ctx.params.id);
  const today = todayOf(ctx);
  if (inv.status !== 'draft') {
    // Issued invoices are immutable apart from their note.
    const keys = Object.keys(ctx.body).filter(k => ctx.body[k] !== undefined);
    if (keys.length === 1 && keys[0] === 'note' && inv.status !== 'void') {
      ctx.db.prepare('UPDATE invoices SET note=? WHERE id=?').run(text(ctx.body.note, 'note', 1000), inv.id);
      return { invoice: invoiceOut(ctx.db, ctx.db.prepare('SELECT * FROM invoices WHERE id=?').get(inv.id), today) };
    }
    fail(400, 'An issued invoice can\'t be changed: raise a credit note or void it');
  }
  const f = invoiceFields(ctx);
  tx(ctx.db, () => {
    const clearing = ctx.body.discountCode === null || ctx.body.discountCode === '' || ctx.body.discountId === null;
    const d = clearing ? null : discountFrom(ctx, inv.client_id, f.lines, inv.id);
    const discountId = clearing ? null : d ? d.id : inv.discount_id;
    ctx.db.prepare('UPDATE invoices SET due_on=?, note=?, discount_id=? WHERE id=?').run(f.dueOn, f.note, discountId, inv.id);
    writeLines(ctx.db, inv.id, f.lines);
    retotal(ctx.db, inv.id, today);
  });
  return { invoice: invoiceOut(ctx.db, ctx.db.prepare('SELECT * FROM invoices WHERE id=?').get(inv.id), today) };
}

function deleteInvoice(_req, ctx) {
  requireCoach(ctx);
  const inv = ownInvoice(ctx, ctx.params.id);
  if (inv.status !== 'draft') fail(409, 'Only a draft can be deleted; void an issued invoice instead');
  ctx.db.prepare('DELETE FROM invoices WHERE id=?').run(inv.id);
  return { ok: true };
}

function issueRoute(_req, ctx) {
  requireCoach(ctx);
  const inv = ownInvoice(ctx, ctx.params.id);
  const today = todayOf(ctx);
  const dueOn = ctx.body.dueOn ? dayParam(ctx.body.dueOn, 'dueOn') : null;
  const send = ctx.body.send === undefined ? false : bool(ctx.body.send, 'send');
  const out = tx(ctx.db, () => issueInvoice(ctx.db, ctx.config, inv, { today, dueOn, send, now: requestNow(ctx), actingCoachId: ctx.user.id }));
  return { invoice: invoiceOut(ctx.db, out, today) };
}

function voidRoute(_req, ctx) {
  requireCoach(ctx);
  const inv = ownInvoice(ctx, ctx.params.id);
  const reason = text(ctx.body.reason, 'reason', 300);
  voidInvoice(ctx.db, inv, reason);
  return { invoice: invoiceOut(ctx.db, ctx.db.prepare('SELECT * FROM invoices WHERE id=?').get(inv.id), todayOf(ctx)) };
}

function voidInvoice(db, inv, reason) {
  if (inv.status === 'void') fail(409, 'Already void');
  if (db.prepare('SELECT 1 FROM payments WHERE invoice_id=? AND voided_at IS NULL').get(inv.id)) fail(409, 'This invoice has payments: remove them or raise a credit note instead');
  tx(db, () => {
    db.prepare("UPDATE invoices SET status='void', voided_at=?, void_reason=? WHERE id=?").run(nowIso(), reason || null, inv.id);
    db.prepare('DELETE FROM discount_redemptions WHERE invoice_id=?').run(inv.id);
    if (inv.status !== 'draft') emit(db, 'invoice.voided', { coachId: inv.coach_id, clientId: inv.client_id, summary: `Voided ${inv.number ?? 'a draft'}`, invoiceId: inv.id });
  });
}

function duplicateRoute(_req, ctx) {
  requireCoach(ctx);
  const inv = ownInvoice(ctx, ctx.params.id);
  const today = todayOf(ctx);
  const lines = linesOf(ctx.db, inv.id);
  const out = tx(ctx.db, () => createDraft(ctx.db, { coachId: ctx.user.id, clientId: inv.client_id, lines, note: inv.note, today }).invoice);
  return { invoice: invoiceOut(ctx.db, out, today) };
}

/** Bulk: void drafts or send reminders for many invoices. One foreign id is a 404 and nothing happens. */
function bulkInvoices(_req, ctx) {
  requireCoach(ctx);
  const ids = ctx.body.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(x => typeof x !== 'string')) fail(400, 'ids must be a list of invoice ids');
  const action = oneOf(ctx.body.action, 'action', ['voidDrafts', 'remind']);
  const invs = [...new Set(ids)].map(id => ownInvoice(ctx, id));
  const now = requestNow(ctx);
  let done = 0, skipped = 0;
  tx(ctx.db, () => {
    for (const inv of invs) {
      if (action === 'voidDrafts') {
        if (inv.status !== 'draft') { skipped++; continue; }
        voidInvoice(ctx.db, inv, 'Voided in bulk');
        done++;
      } else {
        if (inv.status !== 'issued' || outstandingOf(inv, creditedOf(ctx.db, inv.id)) <= 0) { skipped++; continue; }
        manualRemind(ctx.db, ctx.config, inv, ctx.user.id, null, now);
        done++;
      }
    }
  });
  return { done, skipped };
}

// MARK: - Payments, credit notes, refunds

function recordPayment(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const client = clientFor(ctx, b.clientId);
  const amount = int(b.amountPence, 'amountPence', { min: 1, max: MAX_UNIT });
  const method = oneOf(b.method, 'method', METHODS);
  const receivedOn = dayParam(b.receivedOn, 'receivedOn');
  const reference = text(b.reference, 'reference', 120);
  const note = text(b.note, 'note', 500);
  const sendReceipt = bool(b.sendReceipt, 'sendReceipt');
  const now = requestNow(ctx);
  let inv = null;
  if (b.invoiceId) {
    inv = ownInvoice(ctx, b.invoiceId);
    if (inv.client_id !== client.id) fail(400, 'That invoice is for another client');
    if (!['issued', 'paid'].includes(inv.status)) fail(409, 'Record payments against issued invoices only');
  }
  const out = tx(ctx.db, () => {
    const id = newId('py');
    ctx.db.prepare('INSERT INTO payments (id, coach_id, client_id, invoice_id, amount_pence, method, received_on, reference, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, ctx.user.id, client.id, inv?.id ?? null, amount, method, receivedOn, reference, note, now.toISOString());
    emit(ctx.db, 'payment.recorded', { coachId: ctx.user.id, clientId: client.id, summary: `Payment ${money(amount)} · ${method}`, paymentId: id, amountPence: amount, method, invoiceId: inv?.id ?? null });
    const fresh = inv ? rederive(ctx.db, inv.id, now) : null;
    let messageId = null;
    if (sendReceipt) {
      const s = settingsOut(settingsRow(ctx.db, ctx.user.id));
      const { text: body } = render(ctx.db, ctx.user.id, client, s.texts.receipt, { now, extra: {
        paymentAmount: money(amount), paymentDay: fmtDay(receivedOn), invoiceNumber: fresh?.number ?? 'your account', invoiceTotal: fresh ? money(fresh.total_pence) : '',
      } });
      const sent = sendMessage(ctx.db, ctx.config, { coachId: ctx.user.id, clientId: client.id, text: body, via: 'coachAction', now });
      messageId = sent.message?.id ?? null;
    }
    return { payment: ctx.db.prepare('SELECT * FROM payments WHERE id=?').get(id), invoice: fresh, messageId };
  });
  return { payment: paymentOut(out.payment), invoice: out.invoice ? invoiceOut(ctx.db, out.invoice, todayOf(ctx)) : null, messageId: out.messageId };
}

function listPayments(_req, ctx) {
  requireCoach(ctx);
  const where = ['cu.coach_id=?'], args = [ctx.user.id];
  if (ctx.query.clientId) { const c = clientFor(ctx, ctx.query.clientId); where.push('p.client_id=?'); args.push(c.id); }
  if (ctx.query.from) { where.push('p.received_on>=?'); args.push(dayParam(ctx.query.from, 'from')); }
  if (ctx.query.to) { where.push('p.received_on<=?'); args.push(dayParam(ctx.query.to, 'to')); }
  const rows = ctx.db.prepare(`SELECT p.*, cu.name client_name, i.number invoice_number FROM payments p JOIN users cu ON cu.id=p.client_id AND cu.role='client'
    LEFT JOIN invoices i ON i.id=p.invoice_id WHERE ${where.join(' AND ')} ORDER BY p.received_on DESC, p.created_at DESC LIMIT 1000`).all(...args);
  const credits = ctx.db.prepare(`SELECT c.*, cu.name client_name, i.number invoice_number,
      (SELECT COALESCE(SUM(amount_pence),0) FROM refunds r WHERE r.credit_note_id=c.id AND r.voided_at IS NULL) refunded
    FROM credit_notes c JOIN users cu ON cu.id=c.client_id AND cu.role='client' LEFT JOIN invoices i ON i.id=c.invoice_id
    WHERE cu.coach_id=? ORDER BY c.created_at DESC LIMIT 500`).all(ctx.user.id);
  const refunds = ctx.db.prepare(`SELECT r.* FROM refunds r JOIN users cu ON cu.id=r.client_id AND cu.role='client' WHERE cu.coach_id=? ORDER BY r.paid_on DESC LIMIT 500`).all(ctx.user.id);
  return { payments: rows.map(paymentOut), creditNotes: credits.map(creditOut), refunds: refunds.map(refundOut) };
}

function ownClientRow(ctx, table, id) {
  if (typeof id !== 'string' || !id) fail(404, 'Not found');
  const row = ctx.db.prepare(`SELECT x.* FROM ${table} x JOIN users cu ON cu.id=x.client_id AND cu.role='client' AND cu.coach_id=? WHERE x.id=?`).get(ctx.user.id, id);
  if (!row) fail(404, 'Not found');
  return row;
}

function deletePayment(_req, ctx) {
  requireCoach(ctx);
  const p = ownClientRow(ctx, 'payments', ctx.params.id);
  if (p.voided_at) return { ok: true };
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE payments SET voided_at=? WHERE id=?').run(nowIso(), p.id);
    if (p.invoice_id) rederive(ctx.db, p.invoice_id, requestNow(ctx));
  });
  return { ok: true };
}

/** Raise a credit note (no request): used by the route, end of coaching and referral rewards. */
export function addCreditNote(db, { coachId, clientId, invoiceId = null, amountPence, reason }) {
  const id = newId('cr');
  db.prepare('INSERT INTO credit_notes (id, coach_id, client_id, invoice_id, amount_pence, reason, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, coachId, clientId, invoiceId, amountPence, reason, nowIso());
  return db.prepare('SELECT * FROM credit_notes WHERE id=?').get(id);
}

function createCreditNote(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const client = clientFor(ctx, b.clientId);
  const amount = int(b.amountPence, 'amountPence', { min: 1, max: MAX_UNIT });
  const reason = str(b.reason, 'reason', { max: 300 });
  let inv = null;
  if (b.invoiceId) {
    inv = ownInvoice(ctx, b.invoiceId);
    if (inv.client_id !== client.id) fail(400, 'That invoice is for another client');
    if (!['issued', 'paid'].includes(inv.status)) fail(409, 'Credit notes go against issued invoices');
    const room = inv.total_pence - creditedOf(ctx.db, inv.id);
    if (amount > room) fail(400, `At most ${money(Math.max(0, room))} can be credited on this invoice`);
  }
  const row = tx(ctx.db, () => addCreditNote(ctx.db, { coachId: ctx.user.id, clientId: client.id, invoiceId: inv?.id ?? null, amountPence: amount, reason }));
  return { creditNote: creditOut(row) };
}

function createRefund(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const cn = ownClientRow(ctx, 'credit_notes', b.creditNoteId);
  const amount = int(b.amountPence, 'amountPence', { min: 1, max: MAX_UNIT });
  const method = oneOf(b.method, 'method', METHODS);
  const paidOn = dayParam(b.paidOn, 'paidOn');
  const reference = text(b.reference, 'reference', 120);
  const row = tx(ctx.db, () => {
    const already = ctx.db.prepare('SELECT COALESCE(SUM(amount_pence),0) n FROM refunds WHERE credit_note_id=? AND voided_at IS NULL').get(cn.id).n;
    if (already + amount > cn.amount_pence) fail(400, `At most ${money(cn.amount_pence - already)} can be refunded against this credit note`);
    const id = newId('rd');
    ctx.db.prepare('INSERT INTO refunds (id, coach_id, client_id, credit_note_id, amount_pence, method, paid_on, reference, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, ctx.user.id, cn.client_id, cn.id, amount, method, paidOn, reference, nowIso());
    emit(ctx.db, 'refund.recorded', { coachId: ctx.user.id, clientId: cn.client_id, summary: `Refund ${money(amount)} · ${method}`, refundId: id, amountPence: amount });
    return ctx.db.prepare('SELECT * FROM refunds WHERE id=?').get(id);
  });
  return { refund: refundOut(row) };
}

function deleteRefund(_req, ctx) {
  requireCoach(ctx);
  const r = ownClientRow(ctx, 'refunds', ctx.params.id);
  if (!r.voided_at) ctx.db.prepare('UPDATE refunds SET voided_at=? WHERE id=?').run(nowIso(), r.id);
  return { ok: true };
}

// MARK: - Overview and export

function overview(_req, ctx) {
  requireCoach(ctx);
  const today = todayOf(ctx);
  const db = ctx.db;
  const open = db.prepare(`SELECT i.*, cu.name client_name FROM invoices i JOIN users cu ON cu.id=i.client_id AND cu.role='client' AND cu.coach_id=? WHERE i.status='issued'`).all(ctx.user.id);
  let outstanding = 0, overdue = 0, overdueCount = 0;
  const aged = { d30: 0, d60: 0, d90: 0, older: 0 };
  for (const inv of open) {
    const due = outstandingOf(inv, creditedOf(db, inv.id));
    if (due <= 0) continue;
    outstanding += due;
    if (inv.due_on < today) { overdue += due; overdueCount++; }
    const age = daysBetween(inv.issue_on, today);
    aged[age <= 30 ? 'd30' : age <= 60 ? 'd60' : age <= 90 ? 'd90' : 'older'] += due;
  }
  const { first: monthStart } = monthBounds(today);
  const collected = db.prepare(`SELECT COALESCE(SUM(p.amount_pence),0) n FROM payments p JOIN users cu ON cu.id=p.client_id AND cu.coach_id=?
    WHERE p.voided_at IS NULL AND p.received_on>=? AND p.received_on<=?`).get(ctx.user.id, monthStart, today).n;
  const lastMonthStart = monthBounds(addDays(monthStart, -1)).first;
  const sameDayLastMonth = addDays(lastMonthStart, daysBetween(monthStart, today));
  const collectedLast = db.prepare(`SELECT COALESCE(SUM(p.amount_pence),0) n FROM payments p JOIN users cu ON cu.id=p.client_id AND cu.coach_id=?
    WHERE p.voided_at IS NULL AND p.received_on>=? AND p.received_on<=?`).get(ctx.user.id, lastMonthStart, sameDayLastMonth < monthStart ? sameDayLastMonth : addDays(monthStart, -1)).n;
  const scheduled = scheduledLines(db, ctx.user.id, today, addDays(today, 30));
  const recent = recentActivity(db, ctx.user.id, 12);
  const drafts = db.prepare(`SELECT COUNT(*) n FROM invoices i JOIN users cu ON cu.id=i.client_id AND cu.coach_id=? WHERE i.status='draft'`).get(ctx.user.id).n;
  const series = [];
  for (let k = 5; k >= 0; k--) {
    const m = monthBounds(addMonths(monthStart, -k, 1));
    const n = db.prepare(`SELECT COALESCE(SUM(p.amount_pence),0) n FROM payments p JOIN users cu ON cu.id=p.client_id AND cu.coach_id=?
      WHERE p.voided_at IS NULL AND p.received_on>=? AND p.received_on<?`).get(ctx.user.id, m.first, m.next).n;
    series.push({ month: m.first.slice(0, 7), pence: n });
  }
  return {
    outstandingPence: outstanding, overduePence: overdue, overdueCount, collectedMonthPence: collected, collectedLastMonthToDatePence: collectedLast,
    scheduled30Pence: scheduled.reduce((n, l) => n + l.pence, 0), scheduled30Count: scheduled.length, draftCount: drafts,
    aged, recent, collectedSeries: series,
  };
}

function recentActivity(db, coachId, limit) {
  const items = [];
  for (const p of db.prepare(`SELECT p.*, cu.name client_name, i.number FROM payments p JOIN users cu ON cu.id=p.client_id AND cu.coach_id=? LEFT JOIN invoices i ON i.id=p.invoice_id
    WHERE p.voided_at IS NULL ORDER BY p.created_at DESC LIMIT ?`).all(coachId, limit)) {
    items.push({ at: p.created_at, kind: 'payment', icon: 'payments', tone: 'ok', title: `${p.client_name} paid ${money(p.amount_pence)}`, detail: `${p.method}${p.number ? ` · ${p.number}` : ''}`, path: p.invoice_id ? `/billing/invoices/${p.invoice_id}` : `/clients/${p.client_id}/billing`, client: who({ id: p.client_id, name: p.client_name }) });
  }
  for (const i of db.prepare(`SELECT i.*, cu.name client_name FROM invoices i JOIN users cu ON cu.id=i.client_id AND cu.coach_id=? WHERE i.issued_at IS NOT NULL ORDER BY i.issued_at DESC LIMIT ?`).all(coachId, limit)) {
    items.push({ at: i.issued_at, kind: 'issued', icon: 'receipt_long', tone: 'data', title: `${i.number} issued to ${i.client_name}`, detail: money(i.total_pence), path: `/billing/invoices/${i.id}`, client: who({ id: i.client_id, name: i.client_name }) });
  }
  for (const d of db.prepare(`SELECT d.*, i.number, i.client_id, cu.name client_name FROM dunning_log d JOIN invoices i ON i.id=d.invoice_id JOIN users cu ON cu.id=i.client_id AND cu.coach_id=?
    WHERE d.step<>? ORDER BY d.at DESC LIMIT ?`).all(coachId, PAUSED_STEP, limit)) {
    items.push({ at: d.at, kind: 'reminder', icon: 'schedule_send', tone: 'attention', title: `Reminder for ${d.number}`, detail: `${d.client_name} · ${d.outcome}`, path: `/billing/invoices/${d.invoice_id}`, client: who({ id: d.client_id, name: d.client_name }) });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

const CSV_HEAD = ['date', 'type', 'number', 'client', 'description', 'net', 'vat', 'total', 'method', 'reference'];
/** One CSV cell: quoted when it holds a comma, quote or newline; text that a spreadsheet would run as a formula is prefixed with '. */
export function csvCell(v, { numeric = false } = {}) {
  let s = v === null || v === undefined ? '' : String(v);
  if (!numeric && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const pounds = p => (p / 100).toFixed(2);

function exportCsv(_req, ctx) {
  requireCoach(ctx);
  const today = todayOf(ctx);
  const from = ctx.query.from ? dayParam(ctx.query.from, 'from') : addDays(today, -365);
  const to = ctx.query.to ? dayParam(ctx.query.to, 'to') : today;
  if (to < from) fail(400, 'to must not be before from');
  if (daysBetween(from, to) > 731) fail(400, 'The range is limited to two years');
  const db = ctx.db, coach = ctx.user.id;
  const rows = [];
  for (const i of db.prepare(`SELECT i.*, cu.name client_name FROM invoices i JOIN users cu ON cu.id=i.client_id AND cu.coach_id=?
    WHERE i.status IN ('issued','paid','void') AND i.issue_on>=? AND i.issue_on<=? ORDER BY i.issue_on, i.number`).all(coach, from, to)) {
    const desc = linesOf(db, i.id).map(l => l.description).join('; ');
    rows.push([i.issue_on, i.status === 'void' ? 'invoice (void)' : 'invoice', i.number, i.client_name, desc, pounds(i.subtotal_pence - i.discount_pence), pounds(i.tax_pence), pounds(i.total_pence), '', '']);
  }
  for (const p of db.prepare(`SELECT p.*, cu.name client_name, i.number FROM payments p JOIN users cu ON cu.id=p.client_id AND cu.coach_id=? LEFT JOIN invoices i ON i.id=p.invoice_id
    WHERE p.voided_at IS NULL AND p.received_on>=? AND p.received_on<=? ORDER BY p.received_on`).all(coach, from, to)) {
    rows.push([p.received_on, 'payment', p.number ?? '', p.client_name, p.note || (p.number ? `Payment for ${p.number}` : 'Payment on account'), '', '', pounds(p.amount_pence), p.method, p.reference]);
  }
  for (const c of db.prepare(`SELECT c.*, cu.name client_name, i.number FROM credit_notes c JOIN users cu ON cu.id=c.client_id AND cu.coach_id=? LEFT JOIN invoices i ON i.id=c.invoice_id
    ORDER BY c.created_at`).all(coach)) {
    const d = dayOfIso(c.created_at);
    if (d < from || d > to) continue;
    rows.push([d, 'credit note', c.number ?? '', c.client_name, c.reason, '', '', pounds(-c.amount_pence), '', '']);
  }
  for (const r of db.prepare(`SELECT r.*, cu.name client_name FROM refunds r JOIN users cu ON cu.id=r.client_id AND cu.coach_id=?
    WHERE r.voided_at IS NULL AND r.paid_on>=? AND r.paid_on<=? ORDER BY r.paid_on`).all(coach, from, to)) {
    rows.push([r.paid_on, 'refund', '', r.client_name, 'Refund', '', '', pounds(-r.amount_pence), r.method, r.reference]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const NUMERIC = new Set([5, 6, 7]);
  const body = [CSV_HEAD.join(','), ...rows.map(r => r.map((v, i) => csvCell(v, { numeric: NUMERIC.has(i) })).join(','))].join('\r\n') + '\r\n';
  return raw(200, {
    'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'content-disposition': `attachment; filename="billing-${from}-to-${to}.csv"`,
  }, body);
}

// MARK: - Client billing (coach), and the client's own

function packageOut(db, p, today) {
  const moves = db.prepare('SELECT * FROM credit_moves WHERE client_package_id=? ORDER BY at DESC LIMIT 30').all(p.id);
  return {
    id: p.id, clientId: p.client_id, packageId: p.package_id, name: p.name, bookingKind: p.booking_kind, sessionsTotal: p.sessions_total,
    sessionsUsed: p.sessions_used, left: Math.max(0, p.sessions_total - p.sessions_used), startsOn: p.starts_on, expiresOn: p.expires_on,
    expiresInDays: daysBetween(today, p.expires_on), invoiceId: p.invoice_id, status: p.status, createdAt: p.created_at,
    moves: moves.map(m => ({ id: m.id, bookingId: m.booking_id, delta: m.delta, reason: m.reason, at: m.at })),
  };
}

function scheduleOut(db, s, today) {
  const preview = [];
  // A paused schedule bills again from the first date on or after its pause ends.
  let d = s.status === 'paused' && s.paused_until ? forwardTo(s, s.paused_until) : s.next_on;
  for (let i = 0; i < 3; i++) {
    if (s.ends_on && d > s.ends_on) break;
    preview.push(d);
    d = nextBillingDay(d, s.interval, s.anchor_day ?? Number(s.next_on.slice(8, 10)));
  }
  const discount = s.discount_id ? db.prepare('SELECT id, name, code, kind, value FROM discounts WHERE id=?').get(s.discount_id) : null;
  const client = db.prepare('SELECT id, name FROM users WHERE id=?').get(s.client_id);
  return {
    id: s.id, client: who(client), clientId: s.client_id, label: s.label, amountPence: s.amount_pence, interval: s.interval, monthlyPence: monthlyOf(s.amount_pence, s.interval),
    nextOn: s.next_on, endsOn: s.ends_on, status: s.status, pausedUntil: s.paused_until, preview: s.status === 'ended' ? [] : preview,
    discount: discount ? { id: discount.id, name: discount.name, code: discount.code, kind: discount.kind, value: discount.value } : null,
    discountCycles: s.discount_cycles, discountUsed: s.discount_used, createdAt: s.created_at, endsInDays: s.ends_on ? daysBetween(today, s.ends_on) : null,
  };
}

function clientBilling(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.params.id);
  const today = todayOf(ctx);
  const db = ctx.db;
  const state = db.prepare('SELECT * FROM billing_client_state WHERE client_id=?').get(client.id);
  return {
    balancePence: balanceOf(db, client.id),
    ltvPence: db.prepare('SELECT COALESCE(SUM(amount_pence),0) n FROM payments WHERE client_id=? AND voided_at IS NULL').get(client.id).n,
    invoices: db.prepare('SELECT * FROM invoices WHERE client_id=? ORDER BY COALESCE(issue_on, substr(created_at,1,10)) DESC, created_at DESC').all(client.id).map(i => invoiceOut(db, i, today, client)),
    payments: db.prepare('SELECT p.*, i.number invoice_number FROM payments p LEFT JOIN invoices i ON i.id=p.invoice_id WHERE p.client_id=? ORDER BY p.received_on DESC').all(client.id).map(paymentOut),
    creditNotes: db.prepare('SELECT c.*, (SELECT COALESCE(SUM(amount_pence),0) FROM refunds r WHERE r.credit_note_id=c.id AND r.voided_at IS NULL) refunded FROM credit_notes c WHERE client_id=? ORDER BY created_at DESC').all(client.id).map(creditOut),
    refunds: db.prepare('SELECT * FROM refunds WHERE client_id=? ORDER BY paid_on DESC').all(client.id).map(refundOut),
    packages: db.prepare('SELECT * FROM client_packages WHERE client_id=? ORDER BY status=\'active\' DESC, expires_on').all(client.id).map(p => packageOut(db, p, today)),
    schedules: db.prepare('SELECT * FROM billing_schedules WHERE client_id=? ORDER BY status=\'active\' DESC, next_on').all(client.id).map(s => scheduleOut(db, s, today)),
    ended: state?.ended_at ? { at: state.ended_at, keepChasing: !!state.keep_chasing } : null,
    plan: { id: client.plan, ...(() => { const p = planOf(db, client); return { name: p?.name, monthlyPence: p?.monthlyPence ?? 0 }; })() },
  };
}

/** GET /api/billing/mine (client): their issued invoices; anyone else gets an empty list, never a 403. */
function mine(_req, ctx) {
  if (ctx.user.role !== 'client') return { balancePence: 0, invoices: [] };
  const today = londonDay(requestNow(ctx));
  const rows = ctx.db.prepare("SELECT * FROM invoices WHERE client_id=? AND status IN ('issued','paid') ORDER BY issue_on DESC").all(ctx.user.id);
  return {
    balancePence: balanceOf(ctx.db, ctx.user.id),
    invoices: rows.map(i => ({
      number: i.number, issueOn: i.issue_on, dueOn: i.due_on, totalPence: i.total_pence, paidPence: i.paid_pence,
      status: displayStatus(i, today, creditedOf(ctx.db, i.id)),
      lines: linesOf(ctx.db, i.id).map(l => ({ description: l.description, quantity: l.quantity, unitPence: l.unit_pence, amountPence: l.amount_pence })),
    })),
  };
}

// MARK: - Packages (F10)

function packageCatalogueOut(db, p) {
  const sold = db.prepare('SELECT COUNT(*) n FROM client_packages WHERE package_id=?').get(p.id).n;
  const active = db.prepare("SELECT COUNT(*) n FROM client_packages cp JOIN users cu ON cu.id=cp.client_id AND cu.coach_id=? WHERE cp.package_id=? AND cp.status='active'").get(p.coach_id, p.id).n;
  return { id: p.id, name: p.name, description: p.description, sessions: p.sessions, pricePence: p.price_pence, validDays: p.valid_days, bookingKind: p.booking_kind,
    active: !!p.active, sold, activeCount: active, unitPence: Math.round(p.price_pence / p.sessions), createdAt: p.created_at };
}

function packageFields(ctx, cur = null) {
  const b = ctx.body;
  const g = (k, fn, fallback) => (b[k] === undefined ? (fallback === REQUIRED ? fail(400, `${k} is required`) : fallback) : fn(b[k]));
  return {
    name: g('name', v => str(v, 'name', { max: 80 }), cur?.name ?? REQUIRED),
    description: g('description', v => text(v, 'description', 300), cur?.description ?? ''),
    sessions: g('sessions', v => int(v, 'sessions', { min: 1, max: 200 }), cur?.sessions ?? REQUIRED),
    pricePence: g('pricePence', v => int(v, 'pricePence', { min: 0, max: MAX_UNIT }), cur?.price_pence ?? REQUIRED),
    validDays: g('validDays', v => int(v, 'validDays', { min: 1, max: 1000 }), cur?.valid_days ?? 90),
    bookingKind: g('bookingKind', v => oneOf(v, 'bookingKind', BOOKING_KINDS), cur?.booking_kind ?? 'any'),
    active: g('active', v => bool(v, 'active'), cur ? !!cur.active : true),
  };
}

function listPackages(_req, ctx) {
  requireCoach(ctx);
  return { packages: ctx.db.prepare('SELECT * FROM packages WHERE coach_id=? ORDER BY active DESC, price_pence').all(ctx.user.id).map(p => packageCatalogueOut(ctx.db, p)) };
}

function createPackage(_req, ctx) {
  requireCoach(ctx);
  const f = packageFields(ctx);
  const id = newId('pk');
  ctx.db.prepare('INSERT INTO packages (id, coach_id, name, description, sessions, price_pence, valid_days, booking_kind, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, ctx.user.id, f.name, f.description, f.sessions, f.pricePence, f.validDays, f.bookingKind, f.active ? 1 : 0, nowIso());
  return { package: packageCatalogueOut(ctx.db, ctx.db.prepare('SELECT * FROM packages WHERE id=?').get(id)) };
}

function updatePackage(_req, ctx) {
  requireCoach(ctx);
  const p = ownRow(ctx, 'packages', ctx.params.id);
  const f = packageFields(ctx, p);
  ctx.db.prepare('UPDATE packages SET name=?, description=?, sessions=?, price_pence=?, valid_days=?, booking_kind=?, active=? WHERE id=?')
    .run(f.name, f.description, f.sessions, f.pricePence, f.validDays, f.bookingKind, f.active ? 1 : 0, p.id);
  return { package: packageCatalogueOut(ctx.db, ctx.db.prepare('SELECT * FROM packages WHERE id=?').get(p.id)) };
}

function deletePackage(_req, ctx) {
  requireCoach(ctx);
  const p = ownRow(ctx, 'packages', ctx.params.id);
  const sold = ctx.db.prepare('SELECT 1 FROM client_packages WHERE package_id=?').get(p.id);
  if (sold) ctx.db.prepare('UPDATE packages SET active=0 WHERE id=?').run(p.id);
  else ctx.db.prepare('DELETE FROM packages WHERE id=?').run(p.id);
  return { ok: true, deactivated: !!sold };
}

/** Sell a package to a client (no request): the client_packages row, optionally an invoice. Inside the caller's tx. */
export function sellPackage(db, config, { coachId, client, pkg, startsOn, invoice = true, issue = false, today, now = new Date(), name = null, sessions = null, validDays = null }) {
  const id = newId('cp');
  const total = sessions ?? pkg.sessions;
  const expires = addDays(startsOn, validDays ?? pkg.valid_days);
  let invRow = null;
  if (invoice && pkg && pkg.price_pence > 0) {
    invRow = createDraft(db, { coachId, clientId: client.id, today, source: 'package', sourceRef: id,
      lines: [{ description: `${pkg.name}${pkg.description ? ` · ${pkg.description}` : ''}`.slice(0, 200), quantity: 1, unit_pence: pkg.price_pence, amount_pence: pkg.price_pence, kind: 'package', ref: pkg.id }] }).invoice;
  }
  db.prepare(`INSERT INTO client_packages (id, coach_id, client_id, package_id, name, booking_kind, sessions_total, sessions_used, starts_on, expires_on, invoice_id, status, created_at)
    VALUES (?,?,?,?,?,?,?,0,?,?,?, 'active', ?)`).run(id, coachId, client.id, pkg?.id ?? null, name ?? pkg.name, pkg?.booking_kind ?? 'any', total, startsOn, expires, invRow?.id ?? null, now.toISOString());
  if (invRow && issue) invRow = issueInvoice(db, config, invRow, { today, send: true, now, actingCoachId: coachId });
  emit(db, 'package.sold', { coachId, clientId: client.id, summary: `Package: ${name ?? pkg.name}`, clientPackageId: id, packageId: pkg?.id ?? null, invoiceId: invRow?.id ?? null });
  return { clientPackage: db.prepare('SELECT * FROM client_packages WHERE id=?').get(id), invoice: invRow };
}

function sellRoute(_req, ctx) {
  requireCoach(ctx);
  const pkg = ownRow(ctx, 'packages', ctx.params.id);
  if (!pkg.active) fail(409, 'That package is switched off');
  const client = clientFor(ctx, ctx.body.clientId);
  const today = todayOf(ctx);
  const startsOn = ctx.body.startsOn ? dayParam(ctx.body.startsOn, 'startsOn') : today;
  const invoice = ctx.body.invoice === undefined ? true : bool(ctx.body.invoice, 'invoice');
  const issue = bool(ctx.body.issue, 'issue');
  const out = tx(ctx.db, () => sellPackage(ctx.db, ctx.config, { coachId: ctx.user.id, client, pkg, startsOn, invoice, issue, today, now: requestNow(ctx) }));
  return { clientPackage: packageOut(ctx.db, out.clientPackage, today), invoice: out.invoice ? invoiceOut(ctx.db, out.invoice, today) : null };
}

function adjustPackage(_req, ctx) {
  requireCoach(ctx);
  const cp = ownClientRow(ctx, 'client_packages', ctx.params.id);
  const delta = int(ctx.body.delta, 'delta', { min: -50, max: 50 });
  if (!delta) fail(400, 'delta must not be 0');
  const reason = str(ctx.body.reason, 'reason', { max: 120 });
  const today = todayOf(ctx);
  tx(ctx.db, () => {
    let used = cp.sessions_used, total = cp.sessions_total;
    if (delta > 0) { if (used >= delta) used -= delta; else { total += delta - used; used = 0; } }
    else { if (used - delta > total) fail(400, `Only ${total - used} session${total - used === 1 ? '' : 's'} left to take`); used -= delta; }
    ctx.db.prepare('INSERT INTO credit_moves (id, client_package_id, client_id, booking_id, delta, reason, at) VALUES (?,?,?,?,?,?,?)')
      .run(newId('cmv'), cp.id, cp.client_id, null, delta, `adjust: ${reason}`, nowIso());
    ctx.db.prepare('UPDATE client_packages SET sessions_used=?, sessions_total=? WHERE id=?').run(used, total, cp.id);
    restatus(ctx.db, cp.id, today);
  });
  return { clientPackage: packageOut(ctx.db, ctx.db.prepare('SELECT * FROM client_packages WHERE id=?').get(cp.id), today) };
}

/** used at 0 left; back to active when credits come back before expiry. */
function restatus(db, cpId, today) {
  const cp = db.prepare('SELECT * FROM client_packages WHERE id=?').get(cpId);
  const left = cp.sessions_total - cp.sessions_used;
  if (left <= 0 && cp.status === 'active') db.prepare("UPDATE client_packages SET status='used' WHERE id=?").run(cpId);
  else if (left > 0 && cp.status === 'used' && cp.expires_on >= today) db.prepare("UPDATE client_packages SET status='active' WHERE id=?").run(cpId);
}

// MARK: - Credits from bookings (event handlers)

/** Is this booking covered by the client's plan credits this month? (credit-using 1:1s, up to the plan's allowance, in booking order) */
function coveredByPlan(db, client, booking) {
  if (!booking || !booking.uses_credit || booking.client_id !== client.id) return false;
  const allowance = planOf(db, client)?.credits ?? 0;
  if (!allowance) return false;
  const { first: mFirst, next } = monthBounds(londonDay(new Date(booking.start)));
  const rank = db.prepare(`SELECT COUNT(*) n FROM bookings WHERE client_id=? AND uses_credit=1 AND cancelled_at IS NULL AND start>=? AND start<? AND (start<? OR (start=? AND id<=?))`)
    .get(client.id, londonToUtc(mFirst).toISOString(), londonToUtc(next).toISOString(), booking.start, booking.start, booking.id).n;
  return rank <= allowance;
}

function onBookingCreated(db, _config, e) {
  if (!e.clientId) return;
  const p = e.payload;
  const client = db.prepare("SELECT * FROM users WHERE id=? AND role='client'").get(e.clientId);
  if (!client) return;
  const booking = db.prepare('SELECT * FROM bookings WHERE id=?').get(p.bookingId);
  if (!booking || booking.cancelled_at) return;
  if (coveredByPlan(db, client, booking)) return;
  const today = londonDay(new Date(e.at));
  const kind = p.kind ?? booking.kind;
  const cp = db.prepare(`SELECT * FROM client_packages WHERE client_id=? AND status='active' AND expires_on>=? AND sessions_used<sessions_total
    AND (booking_kind='any' OR booking_kind=?) ORDER BY expires_on, created_at LIMIT 1`).get(client.id, today, kind);
  if (!cp) return;
  // A booking takes one credit once, across packages too (a repeated event finds its move).
  if (db.prepare("SELECT 1 FROM credit_moves WHERE booking_id=? AND client_id=? AND reason='booking'").get(p.bookingId, client.id)) return;
  const r = db.prepare('INSERT OR IGNORE INTO credit_moves (id, client_package_id, client_id, booking_id, delta, reason, at) VALUES (?,?,?,?,?,?,?)')
    .run(newId('cmv'), cp.id, client.id, p.bookingId, -1, 'booking', nowIso());
  if (!r.changes) return;
  db.prepare('UPDATE client_packages SET sessions_used=sessions_used+1 WHERE id=?').run(cp.id);
  restatus(db, cp.id, today);
  const left = cp.sessions_total - cp.sessions_used - 1;
  if (left === 1) emit(db, 'package.low', { coachId: client.coach_id, clientId: client.id, summary: `${cp.name}: 1 session left`, clientPackageId: cp.id, left });
}

function onBookingCancelled(db, _config, e) {
  if (!e.clientId) return;
  const p = e.payload;
  if (!p.refunded) return;
  if (p.late && p.policy?.forfeitCredit) return;
  const move = db.prepare("SELECT * FROM credit_moves WHERE booking_id=? AND reason='booking' AND client_id=?").get(p.bookingId, e.clientId);
  if (!move) return;
  const r = db.prepare('INSERT OR IGNORE INTO credit_moves (id, client_package_id, client_id, booking_id, delta, reason, at) VALUES (?,?,?,?,?,?,?)')
    .run(newId('cmv'), move.client_package_id, e.clientId, p.bookingId, 1, 'refund', nowIso());
  if (!r.changes) return;
  db.prepare('UPDATE client_packages SET sessions_used=MAX(0, sessions_used-1) WHERE id=?').run(move.client_package_id);
  restatus(db, move.client_package_id, londonDay(new Date(e.at)));
}

/** booking.noShow / booking.lateCancel with a fee: one DRAFT line on a draft invoice (source policy). Never issued. */
function onPolicyFee(kind) {
  return (db, _config, e) => {
    const fee = e.payload?.policy?.feePence;
    if (!e.clientId || !(Number.isInteger(fee) && fee > 0)) return;
    const client = db.prepare("SELECT * FROM users WHERE id=? AND role='client'").get(e.clientId);
    if (!client?.coach_id) return;
    const ref = `${e.payload.bookingId}:${kind}`;
    if (db.prepare('SELECT 1 FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.client_id=? AND l.ref=?').get(client.id, ref)) return;
    const booking = db.prepare('SELECT start FROM bookings WHERE id=?').get(e.payload.bookingId);
    const when = booking ? ` · ${fmtDay(londonDay(new Date(booking.start)))}` : '';
    const line = { description: `${kind === 'lateCancel' ? 'Late cancellation' : 'Missed session'}${when}`, quantity: 1, unit_pence: fee, amount_pence: fee, kind: 'session', ref };
    const today = londonDay(new Date(e.at));
    const draft = db.prepare("SELECT i.* FROM invoices i WHERE i.client_id=? AND i.coach_id=? AND i.status='draft' AND i.source='policy' ORDER BY created_at DESC LIMIT 1").get(client.id, client.coach_id);
    if (draft) {
      const lines = linesOf(db, draft.id);
      db.prepare('INSERT INTO invoice_lines (id, invoice_id, position, description, quantity, unit_pence, amount_pence, kind, ref) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(newId('il'), draft.id, lines.length, line.description, 1, fee, fee, 'session', ref);
      retotal(db, draft.id, today);
    } else {
      createDraft(db, { coachId: client.coach_id, clientId: client.id, lines: [line], source: 'policy', sourceRef: e.payload.bookingId, today, note: 'Cancellation policy fee: confirm or delete.' });
    }
  };
}

// MARK: - Pause, resume, end of coaching (F8 events)

/** The first billing day on or after `today`, stepping a schedule forward (no back-billing). */
function forwardTo(s, today) {
  let d = s.next_on;
  const anchor = s.anchor_day ?? Number(s.next_on.slice(8, 10));
  for (let i = 0; d < today && i < 600; i++) d = nextBillingDay(d, s.interval, anchor);
  return d;
}

function onPaused(db, _config, e) {
  if (!e.clientId) return;
  const until = typeof e.payload?.until === 'string' ? e.payload.until.slice(0, 10) : null;
  db.prepare("UPDATE billing_schedules SET status='paused', paused_until=? WHERE client_id=? AND status='active'").run(until, e.clientId);
}

function resumeSchedules(db, clientId, today) {
  for (const s of db.prepare("SELECT * FROM billing_schedules WHERE client_id=? AND status='paused'").all(clientId)) {
    const next = forwardTo(s, today);
    if (s.ends_on && next > s.ends_on) db.prepare("UPDATE billing_schedules SET status='ended', paused_until=NULL WHERE id=?").run(s.id);
    else db.prepare("UPDATE billing_schedules SET status='active', paused_until=NULL, next_on=? WHERE id=?").run(next, s.id);
  }
}

function onResumed(db, _config, e) {
  if (!e.clientId) return;
  const today = londonDay(new Date(e.at));
  resumeSchedules(db, e.clientId, today);
  const days = Number(e.payload?.pausedDays);
  if (!(Number.isInteger(days) && days > 0 && days <= 400)) return;
  for (const cp of db.prepare("SELECT * FROM client_packages WHERE client_id=? AND status='active'").all(e.clientId)) {
    db.prepare('UPDATE client_packages SET expires_on=? WHERE id=?').run(addDays(cp.expires_on, days), cp.id);
    db.prepare('INSERT INTO credit_moves (id, client_package_id, client_id, booking_id, delta, reason, at) VALUES (?,?,?,NULL,0,?,?)')
      .run(newId('cmv'), cp.id, e.clientId, `pause:+${days}d`, nowIso());
  }
}

/** Unused share of a package, at its unit price (from its invoice line, else the catalogue price). */
function unusedValue(db, cp) {
  const left = Math.max(0, cp.sessions_total - cp.sessions_used);
  if (!left) return 0;
  let price = null;
  if (cp.invoice_id) price = db.prepare("SELECT SUM(amount_pence) n FROM invoice_lines WHERE invoice_id=? AND kind='package'").get(cp.invoice_id)?.n ?? null;
  if (price === null && cp.package_id) price = db.prepare('SELECT price_pence FROM packages WHERE id=?').get(cp.package_id)?.price_pence ?? null;
  if (!price) return 0;
  return Math.round(price * left / cp.sessions_total);
}

function onOffboarded(db, config, e) {
  if (!e.clientId) return;
  const client = db.prepare("SELECT * FROM users WHERE id=? AND role='client'").get(e.clientId);
  if (!client?.coach_id) return;
  const p = e.payload ?? {};
  const today = londonDay(new Date(e.at));
  const keep = !!p.keepChasing;
  db.prepare(`INSERT INTO billing_client_state (client_id, coach_id, ended_at, keep_chasing) VALUES (?,?,?,?)
    ON CONFLICT(client_id) DO UPDATE SET coach_id=excluded.coach_id, ended_at=excluded.ended_at, keep_chasing=excluded.keep_chasing`).run(client.id, client.coach_id, e.at, keep ? 1 : 0);
  db.prepare("UPDATE billing_schedules SET status='ended', ends_on=?, paused_until=NULL WHERE client_id=? AND status IN ('active','paused')").run(today, client.id);
  for (const cp of db.prepare("SELECT * FROM client_packages WHERE client_id=? AND status='active'").all(client.id)) {
    if (p.packages === 'refund') {
      const value = unusedValue(db, cp);
      if (value > 0) addCreditNote(db, { coachId: client.coach_id, clientId: client.id, invoiceId: cp.invoice_id, amountPence: value, reason: `Unused sessions refunded: ${cp.name}` });
      db.prepare("UPDATE client_packages SET status='cancelled' WHERE id=?").run(cp.id);
    } else {
      db.prepare("UPDATE client_packages SET status='expired' WHERE id=?").run(cp.id);
    }
  }
  if (p.money === 'invoice') {
    for (const d of db.prepare("SELECT * FROM invoices WHERE client_id=? AND status='draft'").all(client.id)) {
      try { tx(db, () => issueInvoice(db, config, d, { today, actingCoachId: client.coach_id })); } catch (err) { console.warn(`Final invoice ${d.id} not issued: ${err.message}`); }
    }
  }
  if (p.money === 'writeOff') {
    const bal = balanceOf(db, client.id);
    if (bal > 0) addCreditNote(db, { coachId: client.coach_id, clientId: client.id, amountPence: bal, reason: 'Write-off at end of coaching' });
  }
  if (!keep) {
    for (const inv of db.prepare("SELECT id FROM invoices WHERE client_id=? AND status='issued'").all(client.id)) {
      db.prepare('INSERT OR IGNORE INTO dunning_log (invoice_id, coach_id, step, outcome, at) VALUES (?,?,?,?,?)').run(inv.id, client.coach_id, PAUSED_STEP, 'Paused: coaching ended', nowIso());
    }
  }
}

function onStageChanged(db, _config, e) {
  if (e.clientId && ['active', 'onboarding'].includes(e.payload?.to)) db.prepare('DELETE FROM billing_client_state WHERE client_id=?').run(e.clientId);
}

/** campaign.enrolled with a fee: the invoice (one campaign line, the discount code through the F12 rules; an invalid code is dropped and noted). */
function onCampaignEnrolled(db, config, e) {
  const p = e.payload ?? {};
  const fee = p.feePence;
  if (!e.clientId || !(Number.isInteger(fee) && fee > 0) || p.invoice === false || !p.enrolmentId) return;
  const client = db.prepare("SELECT * FROM users WHERE id=? AND role='client'").get(e.clientId);
  if (!client?.coach_id) return;
  if (db.prepare("SELECT 1 FROM invoices WHERE client_id=? AND source='campaign' AND source_ref=?").get(client.id, String(p.enrolmentId))) return;
  const today = londonDay(new Date(e.at));
  const lines = [{ description: `${String(p.campaignName ?? 'Campaign').slice(0, 150)} · campaign fee`, quantity: 1, unit_pence: fee, amount_pence: fee, kind: 'campaign', ref: String(p.enrolmentId) }];
  let note = '', discountId = null;
  if (p.discountCode) {
    const d = discountByCode(db, client.coach_id, p.discountCode);
    const check = checkDiscount(db, d, { clientId: client.id, lines, today });
    if (check.ok) discountId = d.id;
    else note = `Code ${String(p.discountCode).slice(0, 40)} not applied: ${check.reason}.`;
  }
  const { invoice } = createDraft(db, { coachId: client.coach_id, clientId: client.id, lines, source: 'campaign', sourceRef: String(p.enrolmentId), discountId, note, today });
  if (settingsRow(db, client.coach_id).auto_issue_recurring) {
    try { tx(db, () => issueInvoice(db, config, invoice, { today, send: true, via: 'dunning', actingCoachId: client.coach_id })); } catch (err) { console.warn(`Campaign invoice not issued: ${err.message}`); }
  } else {
    notifyCoach(db, config, client.coach_id, { clientId: client.id, kind: 'invoiceDraft', title: `Campaign fee ready to issue: ${client.name}`, body: `${lines[0].description} · ${money(fee)}`, path: `/billing/invoices/${invoice.id}`, icon: 'receipt_long', tone: 'data', dedupe: `campaignfee:${invoice.id}` });
  }
}

// MARK: - Schedules (F10)

function scheduleFields(ctx, cur = null) {
  const b = ctx.body;
  const g = (k, fn, fallback) => (b[k] === undefined ? (fallback === REQUIRED ? fail(400, `${k} is required`) : fallback) : fn(b[k]));
  const out = {
    label: g('label', v => str(v, 'label', { max: 120 }), cur?.label),
    amountPence: g('amountPence', v => int(v, 'amountPence', { min: 1, max: MAX_UNIT }), cur?.amount_pence),
    interval: g('interval', v => oneOf(v, 'interval', INTERVALS), cur?.interval),
    nextOn: g('nextOn', v => dayParam(v, 'nextOn'), cur?.next_on),
    endsOn: g('endsOn', v => (v === null || v === '' ? null : dayParam(v, 'endsOn')), cur?.ends_on ?? null),
  };
  for (const k of ['label', 'amountPence', 'interval', 'nextOn']) if (out[k] === undefined || out[k] === null) fail(400, `${k} is required`);
  if (out.endsOn && out.endsOn < out.nextOn) fail(400, 'endsOn must not be before nextOn');
  return out;
}

function listSchedules(_req, ctx) {
  requireCoach(ctx);
  const today = todayOf(ctx);
  let rows = ctx.db.prepare(`SELECT s.* FROM billing_schedules s JOIN users cu ON cu.id=s.client_id AND cu.role='client' AND cu.coach_id=? ORDER BY s.status='active' DESC, s.next_on`).all(ctx.user.id);
  if (ctx.query.endingWithin !== undefined) {
    const days = int(Number(ctx.query.endingWithin), 'endingWithin', { min: 0, max: 400 });
    rows = rows.filter(s => s.status !== 'ended' && s.ends_on && s.ends_on >= today && s.ends_on <= addDays(today, days));
  }
  return { schedules: rows.map(s => scheduleOut(ctx.db, s, today)) };
}

function createSchedule(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  const f = scheduleFields(ctx);
  let discountId = null, cycles = null;
  if (ctx.body.discountId) {
    const d = ctx.db.prepare('SELECT * FROM discounts WHERE id=? AND coach_id=?').get(String(ctx.body.discountId), ctx.user.id);
    if (!d) fail(404, 'Not found');
    discountId = d.id;
    cycles = ctx.body.discountCycles === undefined || ctx.body.discountCycles === null ? null : int(ctx.body.discountCycles, 'discountCycles', { min: 1, max: 120 });
  }
  const id = newId('bs');
  tx(ctx.db, () => {
    ctx.db.prepare(`INSERT INTO billing_schedules (id, coach_id, client_id, label, amount_pence, interval, next_on, ends_on, discount_id, discount_cycles, status, anchor_day, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?, 'active', ?, ?)`).run(id, ctx.user.id, client.id, f.label, f.amountPence, f.interval, f.nextOn, f.endsOn, discountId, cycles, Number(f.nextOn.slice(8, 10)), nowIso());
    emit(ctx.db, 'billing.scheduleCreated', { coachId: ctx.user.id, clientId: client.id, summary: `Recurring: ${f.label} · ${money(f.amountPence)}`, scheduleId: id });
  });
  return { schedule: scheduleOut(ctx.db, ctx.db.prepare('SELECT * FROM billing_schedules WHERE id=?').get(id), todayOf(ctx)) };
}

function patchSchedule(_req, ctx) {
  requireCoach(ctx);
  const s = ownClientRow(ctx, 'billing_schedules', ctx.params.id);
  const today = todayOf(ctx);
  const f = scheduleFields(ctx, s);
  let status = s.status, next = f.nextOn, pausedUntil = s.paused_until;
  if (ctx.body.status !== undefined) {
    const want = oneOf(ctx.body.status, 'status', ['active', 'paused', 'ended']);
    if (s.status === 'ended' && want !== 'ended') fail(409, 'An ended schedule can\'t restart: make a new one');
    if (want === 'paused') pausedUntil = ctx.body.pausedUntil ? dayParam(ctx.body.pausedUntil, 'pausedUntil') : null;
    if (want === 'active' && s.status === 'paused') { next = forwardTo({ ...s, next_on: next }, today); pausedUntil = null; }
    status = want;
  }
  const anchor = f.nextOn !== s.next_on ? Number(f.nextOn.slice(8, 10)) : s.anchor_day;
  ctx.db.prepare('UPDATE billing_schedules SET label=?, amount_pence=?, interval=?, next_on=?, ends_on=?, status=?, paused_until=?, anchor_day=? WHERE id=?')
    .run(f.label, f.amountPence, f.interval, next, status === 'ended' && !f.endsOn ? today : f.endsOn, status, pausedUntil, anchor, s.id);
  return { schedule: scheduleOut(ctx.db, ctx.db.prepare('SELECT * FROM billing_schedules WHERE id=?').get(s.id), today) };
}

function deleteSchedule(_req, ctx) {
  requireCoach(ctx);
  const s = ownClientRow(ctx, 'billing_schedules', ctx.params.id);
  ctx.db.prepare('DELETE FROM billing_schedules WHERE id=?').run(s.id);
  return { ok: true };
}

const endedClient = (db, clientId) => db.prepare('SELECT * FROM billing_client_state WHERE client_id=? AND ended_at IS NOT NULL').get(clientId);

/**
 * The recurring clock (every 15 min): for each active schedule whose next_on
 * has come, one invoice per (schedule, next_on) (source_ref makes it
 * idempotent), issued and sent when the coach chose auto-issue, else left as
 * a draft with a notification; then next_on moves on. Paused schedules whose
 * pause has passed resume without back-billing. Ended clients are skipped.
 */
export function runRecurring(db, config, now = new Date()) {
  const today = londonDay(now);
  let made = 0;
  for (const s of db.prepare("SELECT s.* FROM billing_schedules s JOIN users cu ON cu.id=s.client_id AND cu.role='client' WHERE s.status='paused' AND s.paused_until IS NOT NULL AND s.paused_until<=?").all(today)) {
    tx(db, () => resumeSchedules(db, s.client_id, today));
  }
  const due = db.prepare(`SELECT s.*, cu.coach_id current_coach FROM billing_schedules s JOIN users cu ON cu.id=s.client_id AND cu.role='client' AND cu.coach_id IS NOT NULL
    WHERE s.status='active' AND s.next_on<=? ORDER BY s.next_on LIMIT 500`).all(today);
  for (const s0 of due) {
    try {
      tx(db, () => {
        for (let guard = 0; guard < 24; guard++) {
          const s = db.prepare("SELECT * FROM billing_schedules WHERE id=? AND status='active'").get(s0.id);
          if (!s || s.next_on > today) return;
          if (endedClient(db, s.client_id)) return;
          if (s.ends_on && s.next_on > s.ends_on) { db.prepare("UPDATE billing_schedules SET status='ended' WHERE id=?").run(s.id); return; }
          const ref = `${s.id}:${s.next_on}`;
          const anchor = s.anchor_day ?? Number(s.next_on.slice(8, 10));
          const advance = () => {
            const nxt = nextBillingDay(s.next_on, s.interval, anchor);
            db.prepare('UPDATE billing_schedules SET next_on=?, status=? WHERE id=?').run(nxt, s.ends_on && nxt > s.ends_on ? 'ended' : 'active', s.id);
          };
          if (db.prepare("SELECT 1 FROM invoices WHERE source='recurring' AND source_ref=?").get(ref)) { advance(); continue; }
          const coachId = s0.current_coach;
          let discountId = null;
          if (s.discount_id && (s.discount_cycles === null || s.discount_used < s.discount_cycles)) {
            const d = db.prepare('SELECT * FROM discounts WHERE id=?').get(s.discount_id);
            if (d?.active) discountId = d.id;
          }
          const periodLabel = s.interval === 'month' ? new Date(`${s.next_on}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }) : `from ${fmtDay(s.next_on)}`;
          const { invoice } = createDraft(db, { coachId, clientId: s.client_id, today, source: 'recurring', sourceRef: ref, discountId,
            lines: [{ description: `${s.label} · ${periodLabel}`, quantity: 1, unit_pence: s.amount_pence, amount_pence: s.amount_pence, kind: 'plan', ref: s.id }] });
          const fresh = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoice.id);
          if (discountId && fresh.discount_id) db.prepare('UPDATE billing_schedules SET discount_used=discount_used+1 WHERE id=?').run(s.id);
          const client = db.prepare('SELECT * FROM users WHERE id=?').get(s.client_id);
          if (settingsRow(db, coachId).auto_issue_recurring) {
            issueInvoice(db, config, fresh, { today, send: true, via: 'dunning', now, actingCoachId: coachId });
          } else {
            notifyCoach(db, config, coachId, { clientId: s.client_id, kind: 'invoiceDraft', title: `Recurring invoice ready: ${client.name}`, body: `${s.label} · ${money(fresh.total_pence)}`,
              path: `/billing/invoices/${invoice.id}`, icon: 'receipt_long', tone: 'data', dedupe: `recurring:${ref}`, now });
          }
          emit(db, 'billing.scheduleInvoiced', { coachId, clientId: s.client_id, summary: `Recurring invoice · ${s.label}`, scheduleId: s.id, invoiceId: invoice.id });
          made++;
          advance();
        }
      });
    } catch (err) { console.error(`Recurring schedule ${s0.id} failed`, err); }
  }
  return made;
}

/** The daily package clock: packages past expires_on expire (package.expired). */
export function expirePackages(db, now = new Date()) {
  const today = londonDay(now);
  let n = 0;
  for (const cp of db.prepare("SELECT cp.*, cu.coach_id current_coach FROM client_packages cp JOIN users cu ON cu.id=cp.client_id WHERE cp.status='active' AND cp.expires_on<?").all(today)) {
    tx(db, () => {
      if (!db.prepare("UPDATE client_packages SET status='expired' WHERE id=? AND status='active'").run(cp.id).changes) return;
      emit(db, 'package.expired', { coachId: cp.current_coach ?? cp.coach_id, clientId: cp.client_id, summary: `${cp.name} expired`, clientPackageId: cp.id, left: cp.sessions_total - cp.sessions_used });
      n++;
    });
  }
  return n;
}

// MARK: - Dunning (F11)

function dunningSteps(db, coachId) {
  const steps = json(settingsRow(db, coachId).dunning, DEFAULT_DUNNING);
  return Array.isArray(steps) ? steps.filter(s => Number.isInteger(s?.day) && ['gentle', 'firm', 'coach'].includes(s?.template)) : DEFAULT_DUNNING;
}

function dunningExtra(inv, today) {
  return { invoiceNumber: inv.number, invoiceTotal: money(inv.total_pence), invoiceDue: fmtDay(inv.due_on), daysOverdue: String(Math.max(0, daysBetween(inv.due_on, today))), invoiceOutstanding: money(Math.max(0, inv.total_pence - inv.paid_pence)) };
}

function dunningText(db, coachId, template) {
  const s = settingsOut(settingsRow(db, coachId));
  return template === 'firm' ? s.texts.firm : s.texts.gentle;
}

/** A task for the coach through task.create when some feature registers it; else nothing. */
function maybeTask(db, config, { coachId, client, title, now }) {
  const action = allActions().find(a => a.id === 'task.create');
  if (!action) return false;
  const params = {};
  for (const p of action.params ?? []) {
    if (['title', 'text', 'name'].includes(p.key)) params[p.key] = title;
    else if (p.type === 'day' && p.required) params[p.key] = londonDay(now);
  }
  try { runAction(db, config, 'task.create', { coachId, client, params, now, via: 'dunning' }); return true; } catch (err) { console.warn(`task.create from dunning failed: ${err.message}`); return false; }
}

/**
 * The dunning clock (every 30 min, 08:00–20:00 London only). For each issued,
 * unpaid invoice past due, the due steps of the coach's dunning list are
 * walked once each: gentle and firm send a governed message (via dunning),
 * coach notifies JK (and makes a task when task.create exists) and sends the
 * client nothing. When several steps are due at once only the latest acts and
 * the earlier ones are logged as skipped. Each step is claimed by its
 * dunning_log row (primary key) before it acts, so repeated ticks never repeat it.
 */
export function runDunning(db, config, now = new Date()) {
  const clockNow = londonClock(now);
  if (clockNow < '08:00' || clockNow >= '20:00') return 0;
  const today = londonDay(now);
  const rows = db.prepare(`SELECT i.*, cu.coach_id current_coach FROM invoices i JOIN users cu ON cu.id=i.client_id AND cu.role='client' AND cu.coach_id IS NOT NULL
    WHERE i.status='issued' AND i.due_on<? AND NOT EXISTS (SELECT 1 FROM dunning_log d WHERE d.invoice_id=i.id AND d.step=?) LIMIT 1000`).all(today, PAUSED_STEP);
  let acted = 0;
  for (const inv of rows) {
    try {
      tx(db, () => {
        const credited = creditedOf(db, inv.id);
        if (outstandingOf(inv, credited) <= 0) return;
        const state = endedClient(db, inv.client_id);
        if (state && !state.keep_chasing) return;
        const coachId = inv.current_coach;
        const overdueDays = daysBetween(inv.due_on, today);
        const steps = dunningSteps(db, coachId);
        const done = new Set(db.prepare('SELECT step FROM dunning_log WHERE invoice_id=? AND step>=0 AND step<?').all(inv.id, MANUAL_STEP).map(r => r.step));
        const dueIdx = steps.map((s, i) => [s, i]).filter(([s, i]) => s.day <= overdueDays && !done.has(i));
        if (!dueIdx.length) return;
        const [step, idx] = dueIdx.at(-1);
        const first = done.size === 0;
        for (const [, i] of dueIdx.slice(0, -1)) db.prepare('INSERT OR IGNORE INTO dunning_log (invoice_id, coach_id, step, outcome, at) VALUES (?,?,?,?,?)').run(inv.id, coachId, i, 'skipped (a later step was due)', now.toISOString());
        const claim = db.prepare('INSERT OR IGNORE INTO dunning_log (invoice_id, coach_id, step, outcome, at) VALUES (?,?,?,?,?)').run(inv.id, coachId, idx, 'claimed', now.toISOString());
        if (!claim.changes) return;
        const client = db.prepare('SELECT * FROM users WHERE id=?').get(inv.client_id);
        let outcome, messageId = null;
        if (step.template === 'coach') {
          const n = notifyCoach(db, config, coachId, { clientId: client.id, kind: 'invoiceOverdue', title: `Time for a personal word: ${client.name}`,
            body: `${inv.number} · ${money(inv.total_pence - inv.paid_pence - credited)} is ${overdueDays} days overdue`, path: `/billing/invoices/${inv.id}`, icon: 'receipt_long', tone: 'attention', dedupe: `dunning:${inv.id}:${idx}`, now });
          const task = maybeTask(db, config, { coachId, client, title: `Chase ${first ? '' : 'up '}${inv.number} with ${client.name.split(' ')[0]}`, now });
          outcome = `coach${n ? ' notified' : ''}${task ? ' + task' : ''}`;
        } else {
          const { text: body } = render(db, coachId, client, dunningText(db, coachId, step.template), { now, extra: dunningExtra(inv, today) });
          const out = sendMessage(db, config, { coachId, clientId: client.id, text: body, via: 'dunning', now });
          messageId = out.message?.id ?? null;
          outcome = out.message ? `${step.template} sent` : out.deferredUntil ? `${step.template} held until ${out.deferredUntil}` : `skipped: ${out.skipped}`;
        }
        db.prepare('UPDATE dunning_log SET outcome=?, message_id=? WHERE invoice_id=? AND step=?').run(outcome, messageId, inv.id, idx);
        if (first) emit(db, 'invoice.overdue', { coachId, clientId: client.id, summary: `${inv.number} overdue ${overdueDays} days`, invoiceId: inv.id, daysOverdue: overdueDays });
        acted++;
      });
    } catch (err) { console.error(`Dunning for ${inv.id} failed`, err); }
  }
  return acted;
}

function manualRemind(db, config, inv, coachId, textBody, now) {
  const today = londonDay(now);
  const client = db.prepare('SELECT * FROM users WHERE id=?').get(inv.client_id);
  const body = textBody ?? render(db, coachId, client, dunningText(db, coachId, 'gentle'), { now, extra: dunningExtra(inv, today) }).text;
  const out = sendMessage(db, config, { coachId, clientId: client.id, text: body, via: 'coachAction', now });
  const n = db.prepare('SELECT COALESCE(MAX(step), ?) m FROM dunning_log WHERE invoice_id=? AND step>=?').get(MANUAL_STEP - 1, inv.id, MANUAL_STEP).m + 1;
  db.prepare('INSERT INTO dunning_log (invoice_id, coach_id, step, outcome, message_id, at) VALUES (?,?,?,?,?,?)').run(inv.id, coachId, n, 'manual reminder sent', out.message?.id ?? null, now.toISOString());
  return out.message?.id ?? null;
}

function remindRoute(_req, ctx) {
  requireCoach(ctx);
  const inv = ownInvoice(ctx, ctx.params.id);
  if (inv.status !== 'issued') fail(409, 'Only an unpaid issued invoice can be chased');
  const body = ctx.body.text === undefined ? null : str(ctx.body.text, 'text', { max: 4000 });
  const messageId = tx(ctx.db, () => manualRemind(ctx.db, ctx.config, inv, ctx.user.id, body, requestNow(ctx)));
  return { messageId };
}

function setReminders(_req, ctx) {
  requireCoach(ctx);
  const inv = ownInvoice(ctx, ctx.params.id);
  const paused = bool(ctx.body.paused, 'paused');
  if (paused) ctx.db.prepare('INSERT OR IGNORE INTO dunning_log (invoice_id, coach_id, step, outcome, at) VALUES (?,?,?,?,?)').run(inv.id, ctx.user.id, PAUSED_STEP, 'Paused by you', nowIso());
  else ctx.db.prepare('DELETE FROM dunning_log WHERE invoice_id=? AND step=?').run(inv.id, PAUSED_STEP);
  return { ok: true };
}

function getReminders(_req, ctx) {
  requireCoach(ctx);
  const inv = ownInvoice(ctx, ctx.params.id);
  const today = todayOf(ctx);
  const log = ctx.db.prepare('SELECT * FROM dunning_log WHERE invoice_id=? ORDER BY at').all(inv.id);
  const steps = dunningSteps(ctx.db, ctx.user.id);
  const done = new Set(log.map(l => l.step));
  const paused = done.has(PAUSED_STEP);
  let next = null;
  if (inv.status === 'issued' && !paused && inv.due_on) {
    const i = steps.findIndex((s, k) => !done.has(k));
    if (i >= 0) next = { step: i, template: steps[i].template, on: addDays(inv.due_on, steps[i].day) < today ? today : addDays(inv.due_on, steps[i].day) };
  }
  return { log: log.map(l => ({ step: l.step, outcome: l.outcome, messageId: l.message_id, at: l.at, kind: l.step === PAUSED_STEP ? 'paused' : l.step >= MANUAL_STEP ? 'manual' : steps[l.step]?.template ?? 'step' })), next, paused, steps };
}

// MARK: - Facts, variables and hooks

const ids = list => JSON.stringify(list);
const IN = 'IN (SELECT value FROM json_each(?))';

function factBalance(db, _coachId, clientIds) {
  const out = new Map();
  for (const id of clientIds) out.set(id, balanceOf(db, id));
  return out;
}

function factOverdueDays(db, _coachId, clientIds, today) {
  const out = new Map();
  for (const r of db.prepare(`SELECT client_id, MIN(due_on) due FROM invoices i WHERE client_id ${IN} AND status='issued' AND due_on<? AND total_pence > paid_pence + (SELECT COALESCE(SUM(amount_pence),0) FROM credit_notes c WHERE c.invoice_id=i.id) GROUP BY client_id`).all(ids(clientIds), today)) {
    out.set(r.client_id, daysBetween(r.due, today));
  }
  return out;
}

function factLtv(db, _coachId, clientIds) {
  const out = new Map(clientIds.map(id => [id, 0]));
  for (const r of db.prepare(`SELECT client_id, SUM(amount_pence) n FROM payments WHERE client_id ${IN} AND voided_at IS NULL GROUP BY client_id`).all(ids(clientIds))) out.set(r.client_id, r.n);
  return out;
}

function factLastPaid(db, _coachId, clientIds, today) {
  const out = new Map();
  for (const r of db.prepare(`SELECT client_id, MAX(received_on) d FROM payments WHERE client_id ${IN} AND voided_at IS NULL GROUP BY client_id`).all(ids(clientIds))) out.set(r.client_id, Math.max(0, daysBetween(r.d, today)));
  return out;
}

function factCredits(db, _coachId, clientIds, today) {
  const out = new Map();
  for (const r of db.prepare(`SELECT client_id, SUM(sessions_total - sessions_used) n FROM client_packages WHERE client_id ${IN} AND status='active' AND expires_on>=? GROUP BY client_id`).all(ids(clientIds), today)) out.set(r.client_id, r.n);
  return out;
}

function factPackageExpires(db, _coachId, clientIds, today) {
  const out = new Map();
  for (const r of db.prepare(`SELECT client_id, MIN(expires_on) d FROM client_packages WHERE client_id ${IN} AND status='active' AND expires_on>=? GROUP BY client_id`).all(ids(clientIds), today)) out.set(r.client_id, daysBetween(today, r.d));
  return out;
}

function factRecurring(db, _coachId, clientIds) {
  const out = new Map(clientIds.map(id => [id, 0]));
  for (const s of db.prepare(`SELECT client_id, amount_pence, interval FROM billing_schedules WHERE client_id ${IN} AND status='active'`).all(ids(clientIds))) {
    out.set(s.client_id, (out.get(s.client_id) ?? 0) + monthlyOf(s.amount_pence, s.interval));
  }
  return out;
}

/** Scheduled recurring invoices in a window (certain), for the overview and the forecast. */
export function scheduledLines(db, coachId, fromDay, toDay) {
  const out = [];
  for (const s of db.prepare(`SELECT s.*, cu.name client_name FROM billing_schedules s JOIN users cu ON cu.id=s.client_id AND cu.role='client' AND cu.coach_id=?
    WHERE s.status IN ('active','paused')`).all(coachId)) {
    if (endedClient(db, s.client_id)) continue;
    const anchor = s.anchor_day ?? Number(s.next_on.slice(8, 10));
    let d = s.status === 'paused' ? (s.paused_until ? forwardTo({ ...s }, s.paused_until) : null) : s.next_on;
    for (let i = 0; d && d <= toDay && i < 200; i++) {
      if (s.ends_on && d > s.ends_on) break;
      if (d >= fromDay) out.push({ day: d, pence: s.amount_pence, label: `${s.client_name.split(' ')[0]} · ${s.label}`, confidence: 'certain', source: 'billing.schedule', clientId: s.client_id });
      d = nextBillingDay(d, s.interval, anchor);
    }
  }
  return out;
}

function forecast(db, coach, fromDay, toDay) {
  const out = scheduledLines(db, coach.id, fromDay, toDay);
  // Packages likely renewing: clients at ≤1 credit, at their last package price × .5.
  for (const cp of db.prepare(`SELECT cp.*, cu.name client_name FROM client_packages cp JOIN users cu ON cu.id=cp.client_id AND cu.role='client' AND cu.coach_id=?
    WHERE cp.status IN ('active','used') AND (cp.sessions_total - cp.sessions_used) <= 1 AND cp.expires_on>=?`).all(coach.id, addDays(fromDay, -30))) {
    if (endedClient(db, cp.client_id)) continue;
    if (db.prepare("SELECT 1 FROM client_packages WHERE client_id=? AND status='active' AND created_at>? AND id<>?").get(cp.client_id, cp.created_at, cp.id)) continue;
    const price = cp.package_id ? db.prepare('SELECT price_pence FROM packages WHERE id=?').get(cp.package_id)?.price_pence : null;
    if (!price) continue;
    const dayGuess = cp.expires_on < fromDay ? addDays(fromDay, 7) : cp.expires_on > toDay ? addDays(fromDay, 14) : cp.expires_on;
    out.push({ day: dayGuess, pence: Math.round(price * 0.5), label: `${cp.client_name.split(' ')[0]} · ${cp.name} renewal`, confidence: 'likely', source: 'billing.package', clientId: cp.client_id });
  }
  return out;
}

function needs(db, coach, clients, today) {
  const out = [];
  const idsList = clients.map(c => c.id);
  if (!idsList.length) return out;
  for (const inv of db.prepare(`SELECT i.* FROM invoices i WHERE i.client_id ${IN} AND i.status='issued' AND i.due_on<=? ORDER BY i.due_on`).all(ids(idsList), addDays(today, -14))) {
    if (out.some(o => o.clientId === inv.client_id)) continue;
    const due = outstandingOf(inv, creditedOf(db, inv.id));
    if (due <= 0) continue;
    if (db.prepare('SELECT 1 FROM dunning_log WHERE invoice_id=? AND step=?').get(inv.id, PAUSED_STEP)) continue;
    const days = daysBetween(inv.due_on, today);
    out.push({ clientId: inv.client_id, kind: 'invoiceOverdue', text: `Invoice overdue ${days} days · ${money(due)}`, at: londonToUtc(inv.due_on, '09:00').toISOString(), rank: 7, iconKey: 'receipt_long',
      action: { label: 'Chase', path: `/billing/invoices/${inv.id}?chase=1` } });
  }
  return out;
}

function inbox(db, coach) {
  const today = londonDay();
  const out = [];
  const steps = dunningSteps(db, coach.id);
  const coachSteps = steps.map((s, i) => [s, i]).filter(([s]) => s.template === 'coach').map(([, i]) => i);
  if (!coachSteps.length) return out;
  for (const inv of db.prepare(`SELECT i.*, cu.name client_name, d.at step_at FROM invoices i JOIN users cu ON cu.id=i.client_id AND cu.role='client' AND cu.coach_id=?
    JOIN dunning_log d ON d.invoice_id=i.id AND d.step IN (SELECT value FROM json_each(?))
    WHERE i.status='issued' AND NOT EXISTS (SELECT 1 FROM dunning_log p WHERE p.invoice_id=i.id AND p.step=?) ORDER BY d.at DESC LIMIT 50`).all(coach.id, JSON.stringify(coachSteps), PAUSED_STEP)) {
    const due = outstandingOf(inv, creditedOf(db, inv.id));
    if (due <= 0) continue;
    out.push({
      key: `flag:invoice:${inv.id}`, kind: 'flag', clientId: inv.client_id, title: `${inv.number} is ${daysBetween(inv.due_on, today)} days overdue`,
      preview: `${inv.client_name} owes ${money(due)}. The polite reminders have gone; time for a personal word.`, at: inv.step_at, icon: 'receipt_long', tone: 'attention', path: `/billing/invoices/${inv.id}`,
      actions: [
        { id: 'remind', label: 'Remind', method: 'POST', url: `/api/billing/invoices/${inv.id}/remind`, body: {} },
        { id: 'pay', label: 'Record payment', method: 'POST', url: '/api/billing/payments', body: { clientId: inv.client_id, invoiceId: inv.id, amountPence: due, method: 'bank', receivedOn: today } },
        { id: 'pause', label: 'Pause reminders', method: 'POST', url: `/api/billing/invoices/${inv.id}/reminders`, body: { paused: true } },
      ],
    });
  }
  return out;
}

function search(db, coach, q, lim) {
  const like = likeAny(q);
  const today = londonDay();
  return db.prepare(`SELECT i.*, cu.name client_name FROM invoices i JOIN users cu ON cu.id=i.client_id AND cu.role='client' AND cu.coach_id=?
    WHERE (i.number LIKE ? ESCAPE '\\' OR cu.name LIKE ? ESCAPE '\\') AND i.status<>'void' ORDER BY COALESCE(i.issued_at, i.created_at) DESC LIMIT ?`).all(coach.id, like, like, lim)
    .map(i => {
      const out = invoiceOut(db, i, today, { id: i.client_id, name: i.client_name });
      const state = out.displayStatus === 'overdue' ? `overdue ${out.daysOverdue} days` : out.displayStatus;
      return { type: 'invoice', id: i.id, title: `${i.number ?? 'Draft'} · ${i.client_name}`, detail: `${money(i.total_pence)} · ${state}`, path: `/billing/invoices/${i.id}`, icon: 'receipt_long',
        score: Math.max(matchScore(i.number ?? '', q), matchScore(i.client_name, q) * 0.8), at: i.issued_at ?? i.created_at };
    });
}

function timeline(db, coach, client, before, lim) {
  const cut = before ? String(before) : '9999';
  const items = [];
  for (const i of db.prepare("SELECT * FROM invoices WHERE client_id=? AND issued_at IS NOT NULL AND issued_at<? ORDER BY issued_at DESC LIMIT ?").all(client.id, cut, lim)) {
    items.push({ at: i.issued_at, kind: 'invoice', icon: 'receipt_long', tone: 'data', title: `Invoice ${i.number} issued`, detail: money(i.total_pence), path: `/billing/invoices/${i.id}` });
    if (i.paid_at && i.paid_at < cut) items.push({ at: i.paid_at, kind: 'invoice', icon: 'task_alt', tone: 'ok', title: `Invoice ${i.number} paid`, detail: money(i.total_pence), path: `/billing/invoices/${i.id}` });
  }
  for (const p of db.prepare('SELECT * FROM payments WHERE client_id=? AND voided_at IS NULL AND created_at<? ORDER BY created_at DESC LIMIT ?').all(client.id, cut, lim)) {
    items.push({ at: p.created_at, kind: 'payment', icon: 'payments', tone: 'ok', title: `Payment recorded · ${money(p.amount_pence)}`, detail: `${p.method} · ${fmtDay(p.received_on)}`, path: p.invoice_id ? `/billing/invoices/${p.invoice_id}` : `/clients/${client.id}/billing` });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, lim);
}

function exportFor(db, user) {
  if (user.role !== 'client') {
    const s = db.prepare('SELECT * FROM billing_settings WHERE coach_id=?').get(user.id);
    return { settings: s ? settingsOut(s) : null };
  }
  const invoices = db.prepare("SELECT * FROM invoices WHERE client_id=? AND status<>'draft' ORDER BY created_at").all(user.id);
  return {
    balancePence: balanceOf(db, user.id),
    invoices: invoices.map(i => ({ number: i.number, status: i.status, issueOn: i.issue_on, dueOn: i.due_on, subtotalPence: i.subtotal_pence, discountPence: i.discount_pence,
      taxPence: i.tax_pence, totalPence: i.total_pence, paidPence: i.paid_pence, note: i.note, lines: linesOf(db, i.id).map(l => ({ description: l.description, quantity: l.quantity, unitPence: l.unit_pence, amountPence: l.amount_pence, kind: l.kind })) })),
    payments: db.prepare('SELECT * FROM payments WHERE client_id=? ORDER BY received_on').all(user.id).map(p => ({ amountPence: p.amount_pence, method: p.method, receivedOn: p.received_on, reference: p.reference, voided: !!p.voided_at })),
    creditNotes: db.prepare('SELECT * FROM credit_notes WHERE client_id=? ORDER BY created_at').all(user.id).map(c => ({ amountPence: c.amount_pence, reason: c.reason, at: c.created_at })),
    refunds: db.prepare('SELECT * FROM refunds WHERE client_id=? ORDER BY paid_on').all(user.id).map(r => ({ amountPence: r.amount_pence, method: r.method, paidOn: r.paid_on, voided: !!r.voided_at })),
    packages: db.prepare('SELECT * FROM client_packages WHERE client_id=? ORDER BY created_at').all(user.id).map(p => ({ name: p.name, sessionsTotal: p.sessions_total, sessionsUsed: p.sessions_used, startsOn: p.starts_on, expiresOn: p.expires_on, status: p.status })),
    schedules: db.prepare('SELECT * FROM billing_schedules WHERE client_id=? ORDER BY created_at').all(user.id).map(s => ({ label: s.label, amountPence: s.amount_pence, interval: s.interval, nextOn: s.next_on, endsOn: s.ends_on, status: s.status })),
  };
}

function badges(db, coach) {
  const today = londonDay();
  const n = db.prepare(`SELECT COUNT(*) n FROM invoices i JOIN users cu ON cu.id=i.client_id AND cu.role='client' AND cu.coach_id=?
    WHERE i.status='issued' AND i.due_on<? AND i.total_pence > i.paid_pence + (SELECT COALESCE(SUM(amount_pence),0) FROM credit_notes c WHERE c.invoice_id=i.id)`).get(coach.id, today).n;
  return n ? { billing: n } : {};
}

function renewals(db, coach, days) {
  const today = londonDay();
  const end = addDays(today, days);
  const out = [];
  for (const cp of db.prepare(`SELECT cp.*, cu.name client_name FROM client_packages cp JOIN users cu ON cu.id=cp.client_id AND cu.role='client' AND cu.coach_id=?
    WHERE cp.status='active' AND (cp.expires_on<=? OR cp.sessions_total - cp.sessions_used <= 1)`).all(coach.id, end)) {
    const left = cp.sessions_total - cp.sessions_used;
    out.push({ client: who({ id: cp.client_id, name: cp.client_name }), kind: 'package', label: cp.name, on: cp.expires_on < end ? cp.expires_on : today,
      detail: `${left} of ${cp.sessions_total} left · expires ${fmtDay(cp.expires_on)}` });
  }
  for (const s of db.prepare(`SELECT s.*, cu.name client_name FROM billing_schedules s JOIN users cu ON cu.id=s.client_id AND cu.role='client' AND cu.coach_id=?
    WHERE s.status IN ('active','paused') AND s.ends_on IS NOT NULL AND s.ends_on>=? AND s.ends_on<=?`).all(coach.id, today, end)) {
    out.push({ client: who({ id: s.client_id, name: s.client_name }), kind: 'schedule', label: s.label, on: s.ends_on, detail: `${money(s.amount_pence)} / ${s.interval === 'fourWeeks' ? '4 weeks' : s.interval} ends ${fmtDay(s.ends_on)}` });
  }
  return out.sort((a, b) => a.on.localeCompare(b.on));
}

function offboarding(db, coach, client) {
  if (client.coach_id !== coach.id) return {};
  const today = londonDay();
  return {
    balancePence: balanceOf(db, client.id),
    schedules: db.prepare("SELECT * FROM billing_schedules WHERE client_id=? AND status IN ('active','paused')").all(client.id).map(s => scheduleOut(db, s, today)),
    packages: db.prepare("SELECT * FROM client_packages WHERE client_id=? AND status='active' AND sessions_used<sessions_total").all(client.id)
      .map(p => ({ ...packageOut(db, p, today), refundPence: unusedValue(db, p) })),
    openInvoices: db.prepare("SELECT COUNT(*) n FROM invoices WHERE client_id=? AND status IN ('draft','issued')").get(client.id).n,
  };
}

const variableValue = fn => (db, coachId, client) => {
  const owner = db.prepare("SELECT 1 FROM users WHERE id=? AND coach_id=?").get(client.id, coachId);
  return owner ? fn(db, client) : null;
};

// MARK: - The invoice.create action

function createAction(db, config, ctx) {
  const today = londonDay(ctx.now);
  const p = ctx.params;
  let line;
  if (p.preset === 'planMonth') {
    const plan = planOf(db, ctx.client);
    if (!plan?.monthlyPence) return 'Skipped: no paid plan';
    const month = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
    line = { description: `${plan.name} coaching · ${month}`, quantity: 1, unit_pence: plan.monthlyPence, amount_pence: plan.monthlyPence, kind: 'plan', ref: plan.id };
  } else {
    if (!p.amountPence) return 'Skipped: no amount';
    line = { description: p.description || 'Coaching', quantity: 1, unit_pence: p.amountPence, amount_pence: p.amountPence, kind: 'custom', ref: null };
  }
  const { invoice } = createDraft(db, { coachId: ctx.coachId, clientId: ctx.client.id, lines: [line], source: 'manual', today });
  if (p.issue === 'yes') { issueInvoice(db, config, invoice, { today, send: true, via: ctx.via === 'coachAction' ? 'coachAction' : 'dunning', now: ctx.now, actingCoachId: ctx.coachId }); return 'Issued an invoice'; }
  return 'Drafted an invoice';
}

// MARK: - Demo

const DEMO_SETTINGS = {
  business_name: 'JK Performance (demo)', address: 'Studio 2, 14 Market Lane\nLondon N1 0AA (demo)', payment_details: 'Sample Bank · 00-00-00 · 00000000 (demo)',
  footer: 'Thank you for training with JK. Questions about this invoice? Reply in the app.',
};

const DEMO_COACH_TABLES = ['discount_redemptions', 'dunning_log', 'refunds', 'credit_notes', 'payments', 'client_packages', 'packages', 'billing_schedules', 'invoices', 'discounts', 'billing_client_state', 'billing_settings'];

/** Every billing row of the demo accounts, before a rebuild. */
function clearDemo(db, coach, clients) {
  const list = JSON.stringify([coach.id, ...clients.map(c => c.id)]);
  db.prepare(`DELETE FROM credit_moves WHERE client_id ${IN}`).run(list);
  for (const t of DEMO_COACH_TABLES) {
    db.prepare(`DELETE FROM ${t} WHERE coach_id ${IN}`).run(list);
    if (!['packages', 'billing_settings', 'dunning_log'].includes(t)) db.prepare(`DELETE FROM ${t} WHERE client_id ${IN}`).run(list);
  }
}

function buildDemo(db, { coach, byName, today, rng }) {
  const at = (d, t = '10:00') => londonToUtc(d, t).toISOString();
  db.prepare(`INSERT INTO billing_settings (coach_id, business_name, address, payment_details, invoice_prefix, next_number, due_days, footer, updated_at)
    VALUES (?,?,?,?, 'JK', 1, 14, ?, ?)`).run(coach.id, DEMO_SETTINGS.business_name, DEMO_SETTINGS.address, DEMO_SETTINGS.payment_details, DEMO_SETTINGS.footer, at(addDays(today, -190)));
  const clients = ['Sam', 'Priya', 'Alex', 'Leo', 'Rory', 'Tom'].map(n => byName[n]).filter(Boolean);
  if (!clients.length) return;
  const price = { elite: 14900, performance: 9900, foundation: 5900, none: 0 };
  // Discounts (offers.mjs draws them; the ledger applies them).
  const disc = {};
  const addDiscount = (key, row) => {
    const id = newId('dc');
    db.prepare(`INSERT INTO discounts (id, coach_id, code, name, kind, value, applies_to, starts_on, ends_on, max_redemptions, per_client_max, first_invoice_only, active, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, coach.id, row.code, row.name, row.kind, row.value, row.applies, row.starts ?? null, row.ends ?? null, row.max ?? null, row.per ?? 1, row.firstOnly ? 1 : 0, row.active === false ? 0 : 1, at(addDays(today, -150)));
    disc[key] = id;
  };
  const yearStart = `${today.slice(0, 4)}-01-01`;
  addDiscount('newyear', { code: 'NEWYEAR20', name: 'New Year 20% off', kind: 'percent', value: 2000, applies: 'plan', starts: addDays(today, -160), ends: addDays(today, 45), max: 20 });
  addDiscount('return', { code: 'RETURN15', name: 'Returning client 15%', kind: 'percent', value: 1500, applies: 'any', max: null, per: 1 });
  addDiscount('founding', { code: null, name: 'Founding member', kind: 'fixed', value: 1000, applies: 'plan', per: 12 });
  addDiscount('spring', { code: 'SPRING10', name: 'Spring pack offer', kind: 'percent', value: 1000, applies: 'package', starts: addDays(yearStart, 59), ends: addDays(yearStart, 120), max: 10, active: false });

  // Packages catalogue.
  const pk = {};
  for (const [key, name, desc, sessions, pricePence, valid, kind] of [
    ['single', 'Single 1:1', 'One in-person session', 1, 5500, 30, 'inperson'],
    ['ten', '10 × 1:1', '10 in-person sessions, valid 3 months', 10, 45000, 90, 'inperson'],
    ['video5', 'Video 5-pack', 'Five video check-ins', 5, 17500, 60, 'video'],
  ]) {
    const id = newId('pk');
    db.prepare('INSERT INTO packages (id, coach_id, name, description, sessions, price_pence, valid_days, booking_kind, active, created_at) VALUES (?,?,?,?,?,?,?,?,1,?)')
      .run(id, coach.id, name, desc, sessions, pricePence, valid, kind, at(addDays(today, -180)));
    pk[key] = { id, name, description: desc, sessions, price_pence: pricePence, valid_days: valid, booking_kind: kind };
  }

  // Invoices are gathered first and written in issue order, so their numbers run with the calendar.
  const queued = [];
  const invoice = spec => { const id = newId('iv'); queued.push({ id, ...spec }); return id; };
  const flush = () => {
    let number = 1;
    const lineIns = db.prepare('INSERT INTO invoice_lines (id, invoice_id, position, description, quantity, unit_pence, amount_pence, kind, ref) VALUES (?,?,?,?,?,?,?,?,?)');
    queued.sort((a, b) => a.issueOn.localeCompare(b.issueOn) || (a.status === 'draft') - (b.status === 'draft'));
    for (const q of queued) {
      const { id, client, issueOn, lines, status = 'paid', paid = null, method = 'bank', paidOn = null, source = 'manual', sourceRef = null, discountKey = null, note = '' } = q;
      const subtotal = lines.reduce((n, l) => n + l[2], 0);
      let discount = 0;
      if (discountKey) {
        const d = db.prepare('SELECT * FROM discounts WHERE id=?').get(disc[discountKey]);
        const base = lines.filter(l => d.applies_to === 'any' || l[3] === d.applies_to).reduce((n, l) => n + l[2], 0);
        discount = d.kind === 'percent' ? Math.floor(base * d.value / 10_000) : Math.min(d.value, base);
      }
      const total = subtotal - discount;
      const isDraft = status === 'draft';
      const num = isDraft ? null : `JK-${issueOn.slice(0, 4)}-${String(number++).padStart(4, '0')}`;
      const paidPence = status === 'paid' ? total : paid ?? 0;
      const due = isDraft ? null : addDays(issueOn, 14);
      db.prepare(`INSERT INTO invoices (id, coach_id, client_id, number, status, issue_on, due_on, subtotal_pence, discount_pence, tax_pence, total_pence, paid_pence, discount_id, note, source, source_ref, created_at, issued_at, paid_at)
        VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?)`).run(id, coach.id, client.id, num, status === 'partial' ? 'issued' : status, isDraft ? null : issueOn, due, subtotal, discount, total, paidPence,
        discountKey ? disc[discountKey] : null, note, source, sourceRef, at(addDays(issueOn, -1), '18:00'), isDraft ? null : at(issueOn, '09:00'), status === 'paid' ? at(paidOn ?? issueOn, '12:00') : null);
      lines.forEach((l, i) => lineIns.run(newId('il'), id, i, l[0], l[1], Math.round(l[2] / l[1]), l[2], l[3], l[4] ?? null));
      if (discountKey && !isDraft && discount) db.prepare('INSERT INTO discount_redemptions (id, discount_id, coach_id, client_id, invoice_id, amount_pence, at) VALUES (?,?,?,?,?,?,?)').run(newId('dr'), disc[discountKey], coach.id, client.id, id, discount, at(issueOn, '09:00'));
      if (paidPence > 0) {
        db.prepare('INSERT INTO payments (id, coach_id, client_id, invoice_id, amount_pence, method, received_on, reference, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(newId('py'), coach.id, client.id, id, paidPence, method, paidOn ?? issueOn, method === 'bank' ? num : '', at(paidOn ?? issueOn, '12:30'));
      }
    }
    db.prepare('UPDATE billing_settings SET next_number=? WHERE coach_id=?').run(number, coach.id);
  };
  const monthName = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const planLine = (plan, d) => [`${plan[0].toUpperCase()}${plan.slice(1)} coaching · ${monthName(d)}`, 1, price[plan], 'plan', plan];

  // Up to six months of plan invoices for each client, mostly paid. The story:
  // Leo is 20 days overdue (at the coach step), Tom 5 days, Alex part-paid this month.
  const methods = ['bank', 'bank', 'bank', 'card', 'cash', 'bank'];
  const monthStart = monthBounds(today).first;
  const plans = { Sam: 'elite', Priya: 'elite', Alex: 'performance', Leo: 'foundation', Rory: 'performance', Tom: 'foundation' };
  const months = { Sam: 6, Priya: 5, Alex: 4, Leo: 3, Rory: 2, Tom: 1 };
  for (const c of clients) {
    const firstName = c.name.split(' ')[0];
    const plan = plans[firstName];
    for (let k = months[firstName] - 1; k >= 0; k--) {
      const issueOn = addMonths(monthStart, -k, 1);
      if (firstName === 'Leo' && k === 0) { const d = addDays(today, -34); invoice({ client: c, issueOn: d, lines: [planLine(plan, d)], status: 'issued', source: 'recurring' }); continue; }
      if (firstName === 'Tom' && k === 0) { const d = addDays(today, -19); invoice({ client: c, issueOn: d, lines: [planLine(plan, d), ['Kit: resistance bands set', 1, 2400, 'kit']], status: 'issued', discountKey: 'founding' }); continue; }
      if (issueOn > today) continue;
      let status = 'paid', paid = null, paidOn = addDays(issueOn, rng.int(0, 6));
      if (paidOn > today) paidOn = today;
      if (firstName === 'Alex' && k === 0) { const d = addDays(today, -6); invoice({ client: c, issueOn: d, lines: [planLine(plan, d)], status: 'partial', paid: 5000, paidOn: addDays(today, -1), source: 'recurring' }); continue; }
      if (firstName === 'Rory' && k === 0) { const d = addDays(today, -4); invoice({ client: c, issueOn: d, lines: [planLine(plan, d)], status: 'issued', source: 'recurring' }); continue; }
      if (daysBetween(issueOn, today) < 3) status = 'issued';
      const discountKey = { Priya: k >= months.Priya - 2 ? 'newyear' : null, Rory: k === months.Rory - 1 ? 'return' : null, Alex: k === months.Alex - 1 ? 'return' : null,
        Sam: k === months.Sam - 1 ? 'founding' : null, Leo: k === months.Leo - 1 ? 'founding' : null }[firstName] ?? null;
      invoice({ client: c, issueOn, lines: [planLine(plan, issueOn)], status, paid, paidOn, method: methods[(k + firstName.length) % methods.length], source: k < 2 ? 'recurring' : 'manual', discountKey });
    }
  }
  const { Sam: sam, Priya: priya, Rory: rory, Alex: alex, Tom: tom, Leo: leo } = byName;
  // Session packs (sold with a paid invoice), one session sale, a campaign fee and kit.
  const packs = [];
  const sell = (client, key, startsOn, used) => {
    const p = pk[key];
    const invId = invoice({ client, issueOn: startsOn, lines: [[`${p.name} · ${p.description}`, 1, p.price_pence, 'package', p.id]], status: 'paid', paidOn: startsOn, method: 'card', source: 'package' });
    packs.push({ client, p, startsOn, used, invId });
  };
  if (sam) sell(sam, 'ten', addDays(today, -68), 9);
  if (priya) sell(priya, 'video5', addDays(today, -30), 2);
  if (rory) sell(rory, 'ten', addDays(today, -40), 4);
  if (alex) invoice({ client: alex, issueOn: addDays(today, -52), lines: [['1:1 technique session', 2, 11000, 'session']], status: 'paid', paidOn: addDays(today, -50), method: 'cash' });
  if (priya) invoice({ client: priya, issueOn: addDays(today, -24), lines: [['Marathon Build · campaign fee', 1, 9900, 'campaign'], ['Race-day gels (box of 12)', 1, 1800, 'kit']], status: 'paid', paidOn: addDays(today, -21), source: 'campaign' });
  if (sam) invoice({ client: sam, issueOn: addDays(today, -95), lines: [['Kit: lifting belt', 1, 6500, 'kit']], status: 'paid', paidOn: addDays(today, -93), method: 'card' });
  if (rory) invoice({ client: rory, issueOn: today, lines: [['Video analysis · 10k form review', 1, 4500, 'session']], status: 'draft', note: 'Send once the footage is reviewed.' });
  flush();

  for (const { client, p, startsOn, used, invId } of packs) {
    const id = newId('cp');
    db.prepare(`INSERT INTO client_packages (id, coach_id, client_id, package_id, name, booking_kind, sessions_total, sessions_used, starts_on, expires_on, invoice_id, status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, coach.id, client.id, p.id, p.name, p.booking_kind, p.sessions, used, startsOn, addDays(startsOn, p.valid_days), invId,
      used >= p.sessions ? 'used' : 'active', at(startsOn));
    for (let i = 0; i < used; i++) {
      db.prepare('INSERT INTO credit_moves (id, client_package_id, client_id, booking_id, delta, reason, at) VALUES (?,?,?,?,?,?,?)')
        .run(newId('cmv'), id, client.id, `demo-${id}-${i}`, -1, 'booking', at(addDays(startsOn, 3 + i * 6), '08:00'));
    }
  }
  // A payment on account, and one credit note (a session JK cancelled) refunded by bank.
  if (tom) {
    db.prepare('INSERT INTO payments (id, coach_id, client_id, invoice_id, amount_pence, method, received_on, reference, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(newId('py'), coach.id, tom.id, null, 2000, 'cash', addDays(today, -9), '', 'Cash at the studio, on account', at(addDays(today, -9), '19:40'));
  }
  if (alex) {
    const inv = db.prepare("SELECT id FROM invoices WHERE client_id=? AND status='paid' AND source<>'package' ORDER BY issue_on LIMIT 1").get(alex.id);
    const cn = newId('cr');
    db.prepare('INSERT INTO credit_notes (id, coach_id, client_id, invoice_id, amount_pence, reason, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(cn, coach.id, alex.id, inv?.id ?? null, 2500, 'Session cancelled by JK (studio closed)', at(addDays(today, -44), '15:00'));
    db.prepare('INSERT INTO refunds (id, coach_id, client_id, credit_note_id, amount_pence, method, paid_on, reference, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(newId('rd'), coach.id, alex.id, cn, 2500, 'bank', addDays(today, -43), 'REFUND-ALEX', at(addDays(today, -43), '10:00'));
  }
  // Dunning history: Leo has had the gentle and firm reminders and reached the coach step; Tom the gentle one.
  const logStep = (inv, step, outcome, day) => db.prepare('INSERT INTO dunning_log (invoice_id, coach_id, step, outcome, at) VALUES (?,?,?,?,?)').run(inv.id, coach.id, step, outcome, at(day, '09:30'));
  const leoInv = leo && db.prepare("SELECT * FROM invoices WHERE client_id=? AND status='issued' ORDER BY issue_on LIMIT 1").get(leo.id);
  if (leoInv) { logStep(leoInv, 0, 'gentle sent', addDays(leoInv.due_on, 1)); logStep(leoInv, 1, 'firm sent', addDays(leoInv.due_on, 7)); logStep(leoInv, 2, 'coach notified', addDays(leoInv.due_on, 14)); }
  const tomInv = tom && db.prepare("SELECT * FROM invoices WHERE client_id=? AND status='issued' ORDER BY issue_on LIMIT 1").get(tom.id);
  if (tomInv) logStep(tomInv, 0, 'gentle sent', addDays(tomInv.due_on, 1));

  // Four monthly schedules, one paused; Alex's ends in three weeks (a renewal to raise).
  const schedule = (client, label, amount, nextOn, { status = 'active', endsOn = null, discountKey = null, cycles = null, used = 0, pausedUntil = null } = {}) => {
    db.prepare(`INSERT INTO billing_schedules (id, coach_id, client_id, label, amount_pence, interval, next_on, ends_on, discount_id, discount_cycles, discount_used, status, paused_until, anchor_day, created_at)
      VALUES (?,?,?,?,?,'month',?,?,?,?,?,?,?,?,?)`).run(newId('bs'), coach.id, client.id, label, amount, nextOn, endsOn, discountKey ? disc[discountKey] : null, cycles, used, status, pausedUntil, Number(nextOn.slice(8, 10)), at(addDays(today, -70)));
  };
  const nextMonth = monthBounds(today).next;
  if (sam) schedule(sam, 'Elite coaching', price.elite, nextMonth);
  if (priya) schedule(priya, 'Elite coaching', price.elite, nextMonth, { discountKey: 'newyear', cycles: 3, used: 2 });
  if (alex) schedule(alex, 'Performance coaching', price.performance, nextMonth, { endsOn: addDays(today, 21) });
  if (rory) schedule(rory, 'Performance coaching', price.performance, nextMonth, { status: 'paused', pausedUntil: addDays(today, 18) });
}

// MARK: - The feature

export const feature = {
  name: 'billing',
  namespaces: ['invoice', 'payment', 'package', 'billing', 'refund'],
  schema,
  routes(r) {
    r.add('GET', '/api/billing/settings', getSettings);
    r.add('PUT', '/api/billing/settings', putSettings);
    r.add('GET', '/api/billing/overview', overview);
    r.add('GET', '/api/billing/export.csv', exportCsv);
    r.add('GET', '/api/billing/mine', mine);
    r.add('GET', '/api/billing/invoices', listInvoices);
    r.add('POST', '/api/billing/invoices', createInvoice);
    r.add('POST', '/api/billing/invoices/bulk', bulkInvoices);
    r.add('GET', '/api/billing/invoices/:id', getInvoice);
    r.add('PUT', '/api/billing/invoices/:id', updateInvoice);
    r.add('DELETE', '/api/billing/invoices/:id', deleteInvoice);
    r.add('POST', '/api/billing/invoices/:id/issue', issueRoute);
    r.add('POST', '/api/billing/invoices/:id/void', voidRoute);
    r.add('POST', '/api/billing/invoices/:id/duplicate', duplicateRoute);
    r.add('POST', '/api/billing/invoices/:id/remind', remindRoute);
    r.add('GET', '/api/billing/invoices/:id/reminders', getReminders);
    r.add('POST', '/api/billing/invoices/:id/reminders', setReminders);
    r.add('GET', '/api/billing/payments', listPayments);
    r.add('POST', '/api/billing/payments', recordPayment);
    r.add('DELETE', '/api/billing/payments/:id', deletePayment);
    r.add('POST', '/api/billing/credit-notes', createCreditNote);
    r.add('POST', '/api/billing/refunds', createRefund);
    r.add('DELETE', '/api/billing/refunds/:id', deleteRefund);
    r.add('GET', '/api/billing/packages', listPackages);
    r.add('POST', '/api/billing/packages', createPackage);
    r.add('PUT', '/api/billing/packages/:id', updatePackage);
    r.add('DELETE', '/api/billing/packages/:id', deletePackage);
    r.add('POST', '/api/billing/packages/:id/sell', sellRoute);
    r.add('POST', '/api/billing/client-packages/:id/adjust', adjustPackage);
    r.add('GET', '/api/billing/schedules', listSchedules);
    r.add('POST', '/api/billing/schedules', createSchedule);
    r.add('PATCH', '/api/billing/schedules/:id', patchSchedule);
    r.add('DELETE', '/api/billing/schedules/:id', deleteSchedule);
    r.add('GET', '/api/coach/clients/:id/billing', clientBilling);
  },
  clocks: [
    { id: 'billing.recurring', everyMs: 15 * 60_000, run: (db, config, now) => runRecurring(db, config, now) },
    { id: 'billing.dunning', everyMs: 30 * 60_000, run: (db, config, now) => runDunning(db, config, now) },
    { id: 'billing.packages', everyMs: 60 * 60_000, run: (db, _config, now) => expirePackages(db, now) },
  ],
  on: {
    'booking.created': onBookingCreated,
    'booking.cancelled': onBookingCancelled,
    'booking.noShow': onPolicyFee('noShow'),
    'booking.lateCancel': onPolicyFee('lateCancel'),
    'client.paused': onPaused,
    'client.resumed': onResumed,
    'client.offboarded': onOffboarded,
    'client.stageChanged': onStageChanged,
    'campaign.enrolled': onCampaignEnrolled,
  },
  emits: {
    'invoice.issued': { label: 'An invoice was issued', payload: ['invoiceId', 'totalPence', 'dueOn', 'source', 'discountId', 'discountPence'] },
    'invoice.paid': { label: 'An invoice was paid in full', payload: ['invoiceId', 'totalPence'] },
    'invoice.voided': { label: 'An invoice was voided', payload: ['invoiceId'] },
    'invoice.overdue': { label: 'An invoice became overdue (first reminder step)', payload: ['invoiceId', 'daysOverdue'] },
    'payment.recorded': { label: 'A payment was recorded', payload: ['paymentId', 'amountPence', 'method', 'invoiceId'] },
    'refund.recorded': { label: 'A refund was recorded', payload: ['refundId', 'amountPence'] },
    'package.sold': { label: 'A package was sold', payload: ['clientPackageId', 'packageId', 'invoiceId'] },
    'package.low': { label: 'A package is down to its last session', payload: ['clientPackageId', 'left'] },
    'package.expired': { label: 'A package expired', payload: ['clientPackageId', 'left'] },
    'billing.scheduleCreated': { label: 'A recurring billing schedule was set up', payload: ['scheduleId'] },
    'billing.scheduleInvoiced': { label: 'A recurring schedule raised its invoice', payload: ['scheduleId', 'invoiceId'] },
  },
  actions: {
    'invoice.create': {
      label: 'Create an invoice', clientFacing: true,
      params: [
        { key: 'preset', label: 'What for', type: 'enum', options: [{ value: 'planMonth', label: 'This month\'s plan' }, { value: 'custom', label: 'A custom amount' }], default: 'planMonth', required: true },
        { key: 'amountPence', label: 'Amount', type: 'money' },
        { key: 'description', label: 'Description', type: 'text' },
        { key: 'issue', label: 'Issue and send it', type: 'enum', options: [{ value: 'no', label: 'No, leave a draft' }, { value: 'yes', label: 'Yes' }], default: 'no' },
      ],
      run: createAction,
    },
  },
  facts: {
    'billing.balance': { label: 'Balance owed', type: 'money', compute: factBalance },
    'billing.overdueDays': { label: 'Days the oldest invoice is overdue', type: 'days', compute: factOverdueDays },
    'billing.ltv': { label: 'Lifetime value (paid)', type: 'money', compute: factLtv },
    'billing.lastPaidDays': { label: 'Days since last payment', type: 'days', compute: factLastPaid },
    'billing.credits': { label: 'Package sessions left', type: 'number', compute: factCredits },
    'billing.packageExpiresDays': { label: 'Days until a package expires', type: 'days', compute: factPackageExpires },
    'billing.recurringPence': { label: 'Recurring billing per month', type: 'money', compute: factRecurring },
  },
  variables: {
    balance: { label: 'Balance owed ("£120")', value: variableValue((db, client) => { const b = balanceOf(db, client.id); return b > 0 ? money(b) : '£0'; }) },
    oldestInvoice: {
      label: 'Oldest unpaid invoice ("JK-2026-0012 (£120)")',
      value: variableValue((db, client) => {
        const i = db.prepare("SELECT * FROM invoices WHERE client_id=? AND status='issued' ORDER BY due_on LIMIT 1").get(client.id);
        return i ? `${i.number} (${money(i.total_pence - i.paid_pence)})` : null;
      }),
    },
    packageLeft: {
      label: 'Package sessions left',
      value: variableValue((db, client) => String(db.prepare("SELECT COALESCE(SUM(sessions_total - sessions_used),0) n FROM client_packages WHERE client_id=? AND status='active'").get(client.id).n)),
    },
  },
  needs, inbox, search, forecast, timeline, exportFor, badges, renewals, offboarding,
  demo: {
    // No demo.tables: older tests build the demo before createApp has run feature schemas, so the foundation's wipe would hit
    // missing tables. The builder creates the tables if needed and clears the demo accounts' rows itself (children first).
    build(db, ctx) {
      schema(db);
      clearDemo(db, ctx.coach, ctx.clients);
      buildDemo(db, ctx);
    },
  },
};

