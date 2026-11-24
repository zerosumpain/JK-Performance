import { randomInt } from 'node:crypto';
import { clientFor, initials, ownRow, requestNow, requireCoach } from '../access.mjs';
import { emit } from '../events.mjs';
import { fail, num, oneOf, str } from '../http.mjs';
import { sendMessage } from '../messages.mjs';
import { newId, nowIso, tx } from '../store.mjs';
import { render } from '../templating.mjs';
import { addDays, londonDay, londonToUtc } from '../time.mjs';
// Same package (WP3): the ledger owns the discount maths, credit notes and packages that offers apply.
import { addCreditNote, checkDiscount, money, sellPackage } from './billing.mjs';

/**
 * F12 Discounts, promo codes and referrals (docs/design/desk-v2.md, WP3).
 * Discounts are stored by billing.mjs (the ledger applies them when an
 * invoice is issued); this feature owns their screens and codes, the
 * client-bound single-use copies (`offer.issue`), and the referral
 * programme: a code per client, referrals that move pending → joined →
 * qualified → rewarded from lead and invoice events, and the reward (a
 * credit note, free sessions or a single-use % off), applied once.
 *
 * Codes are upper-case A–Z, 0–9 and dashes, unique per coach; two coaches
 * may both have SAM-AB12. Referral codes are FIRSTNAME-XXXX without
 * ambiguous characters.
 */

const KINDS = ['percent', 'fixed'];
const APPLIES = ['any', 'plan', 'package', 'campaign', 'session'];
const REWARDS = ['credit', 'sessions', 'percentNext'];
const CODE = /^[A-Z0-9][A-Z0-9-]{2,23}$/;
const SAFE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const DEFAULT_OFFER_TEXT = 'Hi {first}, here\'s {offerName} just for you: use code {offerCode} on your next invoice.';
const DEFAULT_REWARD_TEXT = 'Thanks {first}! {refereeFirst} joined on your recommendation, so you\'ve earned {reward}.';

const REQUIRED = Symbol('required');
const who = u => (u ? { id: u.id, name: u.name, initials: initials(u.name) } : null);
const bool = (v, name) => { if (v === undefined || v === null) return false; if (typeof v !== 'boolean') fail(400, `${name} must be true or false`); return v; };
const int = (v, name, opts) => num(v, name, { int: true, ...opts });
const day = (v, name) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(v)) fail(400, `${name} must be YYYY-MM-DD`);
  return v;
};
const tableExists = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

/** A random code: PREFIX-XXXX from the unambiguous alphabet. */
export function makeCode(prefix, n = 4) {
  const p = String(prefix ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 10) || 'JK';
  let tail = '';
  for (let i = 0; i < n; i++) tail += SAFE[randomInt(SAFE.length)];
  return `${p}-${tail}`;
}

/** A code no discount or referral of this coach uses yet. */
function freshCode(db, coachId, prefix) {
  for (let i = 0; i < 40; i++) {
    const code = makeCode(prefix, i < 20 ? 4 : 6);
    if (!db.prepare('SELECT 1 FROM discounts WHERE coach_id=? AND code=?').get(coachId, code) && !db.prepare('SELECT 1 FROM referral_codes WHERE coach_id=? AND code=?').get(coachId, code)) return code;
  }
  fail(503, 'Could not make a code; try again');
}

function schema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS referral_settings (
      coach_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      active INTEGER NOT NULL DEFAULT 0,
      reward_kind TEXT NOT NULL DEFAULT 'credit' CHECK (reward_kind IN ('credit','sessions','percentNext')),
      reward_value INTEGER NOT NULL DEFAULT 2000,
      referee_discount_id TEXT, notify_referrer INTEGER NOT NULL DEFAULT 0, reward_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS referral_codes (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (coach_id, code));
    CREATE TABLE IF NOT EXISTS referrals (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referrer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lead_id TEXT, referee_id TEXT REFERENCES users(id) ON DELETE SET NULL, referee_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','joined','qualified','rewarded','void')),
      reward_ref TEXT, reward_text TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS referrals_coach ON referrals(coach_id, status);
    CREATE INDEX IF NOT EXISTS referrals_lead ON referrals(lead_id);`);
}

// MARK: - Discounts

/** Redemption numbers for one discount (and its single-use copies counted with it when asked). */
function statsOf(db, d) {
  const r = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount_pence),0) cost FROM discount_redemptions WHERE discount_id=?`).get(d.id);
  const revenue = db.prepare(`SELECT COALESCE(SUM(i.paid_pence),0) n FROM invoices i WHERE i.discount_id=? AND i.status IN ('issued','paid')`).get(d.id).n;
  return { redemptions: r.n, discountedPence: r.cost, revenuePence: revenue };
}

function discountOut(db, d, today = londonDay()) {
  const client = d.client_id ? db.prepare('SELECT id, name FROM users WHERE id=?').get(d.client_id) : null;
  const live = !!d.active && (!d.starts_on || d.starts_on <= today) && (!d.ends_on || d.ends_on >= today);
  return {
    id: d.id, code: d.code, name: d.name, kind: d.kind, value: d.value, appliesTo: d.applies_to, startsOn: d.starts_on, endsOn: d.ends_on,
    maxRedemptions: d.max_redemptions, perClientMax: d.per_client_max, firstInvoiceOnly: !!d.first_invoice_only, active: !!d.active,
    live, origin: d.origin, client: who(client), createdAt: d.created_at,
    label: d.kind === 'percent' ? `${(d.value / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}% off` : `${money(d.value)} off`,
    ...statsOf(db, d),
  };
}

function discountFields(ctx, cur = null) {
  const b = ctx.body;
  const g = (k, fn, fallback) => (b[k] === undefined ? (fallback === REQUIRED ? fail(400, `${k} is required`) : fallback) : fn(b[k]));
  let code = g('code', v => (v === null || v === '' ? null : String(v).trim().toUpperCase()), cur?.code ?? null);
  if (code !== null && !CODE.test(code)) fail(400, 'code must be 3–24 capital letters, digits or dashes');
  const kind = g('kind', v => oneOf(v, 'kind', KINDS), cur?.kind ?? REQUIRED);
  const value = g('value', v => int(v, 'value', { min: 1, max: kind === 'percent' ? 10_000 : 10_000_000 }), cur?.value ?? REQUIRED);
  if (kind === 'percent' && value > 10_000) fail(400, 'A percentage is at most 100% (10000)');
  const out = {
    code, kind, value,
    name: g('name', v => str(v, 'name', { max: 80 }), cur?.name ?? REQUIRED),
    appliesTo: g('appliesTo', v => oneOf(v, 'appliesTo', APPLIES), cur?.applies_to ?? 'any'),
    startsOn: g('startsOn', v => day(v, 'startsOn'), cur?.starts_on ?? null),
    endsOn: g('endsOn', v => day(v, 'endsOn'), cur?.ends_on ?? null),
    maxRedemptions: g('maxRedemptions', v => (v === null ? null : int(v, 'maxRedemptions', { min: 1, max: 100_000 })), cur?.max_redemptions ?? null),
    perClientMax: g('perClientMax', v => int(v, 'perClientMax', { min: 1, max: 1000 }), cur?.per_client_max ?? 1),
    firstInvoiceOnly: g('firstInvoiceOnly', v => bool(v, 'firstInvoiceOnly'), cur ? !!cur.first_invoice_only : false),
    active: g('active', v => bool(v, 'active'), cur ? !!cur.active : true),
  };
  if (out.startsOn && out.endsOn && out.endsOn < out.startsOn) fail(400, 'endsOn must not be before startsOn');
  return out;
}

const codeTaken = (db, coachId, code, exceptId = null) => code && (
  db.prepare('SELECT 1 FROM discounts WHERE coach_id=? AND code=? AND id IS NOT ?').get(coachId, code, exceptId)
  || db.prepare('SELECT 1 FROM referral_codes WHERE coach_id=? AND code=?').get(coachId, code));

function listDiscounts(_req, ctx) {
  requireCoach(ctx);
  const today = londonDay(requestNow(ctx));
  const rows = ctx.db.prepare(`SELECT d.* FROM discounts d LEFT JOIN users cu ON cu.id=d.client_id
    WHERE d.coach_id=? AND (d.client_id IS NULL OR cu.coach_id=?) ORDER BY d.client_id IS NOT NULL, d.active DESC, d.created_at DESC`).all(ctx.user.id, ctx.user.id);
  return { discounts: rows.map(d => discountOut(ctx.db, d, today)) };
}

function createDiscount(_req, ctx) {
  requireCoach(ctx);
  const f = discountFields(ctx);
  if (codeTaken(ctx.db, ctx.user.id, f.code)) fail(409, 'That code is already in use');
  const id = newId('dc');
  ctx.db.prepare(`INSERT INTO discounts (id, coach_id, code, name, kind, value, applies_to, starts_on, ends_on, max_redemptions, per_client_max, first_invoice_only, active, origin, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'manual', ?)`).run(id, ctx.user.id, f.code, f.name, f.kind, f.value, f.appliesTo, f.startsOn, f.endsOn, f.maxRedemptions, f.perClientMax,
    f.firstInvoiceOnly ? 1 : 0, f.active ? 1 : 0, nowIso());
  return { discount: discountOut(ctx.db, ctx.db.prepare('SELECT * FROM discounts WHERE id=?').get(id)) };
}

function updateDiscount(_req, ctx) {
  requireCoach(ctx);
  const d = ownRow(ctx, 'discounts', ctx.params.id);
  const f = discountFields(ctx, d);
  if (codeTaken(ctx.db, ctx.user.id, f.code, d.id)) fail(409, 'That code is already in use');
  ctx.db.prepare(`UPDATE discounts SET code=?, name=?, kind=?, value=?, applies_to=?, starts_on=?, ends_on=?, max_redemptions=?, per_client_max=?, first_invoice_only=?, active=? WHERE id=?`)
    .run(f.code, f.name, f.kind, f.value, f.appliesTo, f.startsOn, f.endsOn, f.maxRedemptions, f.perClientMax, f.firstInvoiceOnly ? 1 : 0, f.active ? 1 : 0, d.id);
  return { discount: discountOut(ctx.db, ctx.db.prepare('SELECT * FROM discounts WHERE id=?').get(d.id)) };
}

/** Delete an unused discount; one that has been redeemed or is on an invoice or schedule is switched off instead. */
function deleteDiscount(_req, ctx) {
  requireCoach(ctx);
  const d = ownRow(ctx, 'discounts', ctx.params.id);
  const used = ctx.db.prepare('SELECT 1 FROM discount_redemptions WHERE discount_id=?').get(d.id)
    || ctx.db.prepare('SELECT 1 FROM invoices WHERE discount_id=?').get(d.id) || ctx.db.prepare('SELECT 1 FROM billing_schedules WHERE discount_id=?').get(d.id);
  if (used) ctx.db.prepare('UPDATE discounts SET active=0 WHERE id=?').run(d.id);
  else ctx.db.prepare('DELETE FROM discounts WHERE id=?').run(d.id);
  return { ok: true, deactivated: !!used };
}

function generateCode(_req, ctx) {
  requireCoach(ctx);
  const prefix = ctx.body.prefix === undefined ? 'JK' : str(ctx.body.prefix, 'prefix', { max: 12 });
  return { code: freshCode(ctx.db, ctx.user.id, prefix) };
}

/** POST /api/offers/discounts/check {code, clientId, lines?}: {ok, amountPence?, reason?}. */
function checkCode(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  const code = str(ctx.body.code, 'code', { max: 40 }).toUpperCase();
  const lines = Array.isArray(ctx.body.lines) && ctx.body.lines.length
    ? ctx.body.lines.slice(0, 50).map((l, i) => ({ kind: oneOf(l?.kind ?? 'custom', `lines[${i}].kind`, ['plan', 'session', 'package', 'campaign', 'kit', 'custom']), amount_pence: int(l?.amountPence ?? 0, `lines[${i}].amountPence`, { min: 0, max: 10_000_000 }) }))
    : APPLIES.filter(a => a !== 'any').map(kind => ({ kind, amount_pence: 0 }));
  const d = ctx.db.prepare('SELECT * FROM discounts WHERE coach_id=? AND code=?').get(ctx.user.id, code);
  const out = checkDiscount(ctx.db, d, { clientId: client.id, lines, today: londonDay(requestNow(ctx)) });
  return out.ok ? { ok: true, amountPence: out.amountPence, discount: discountOut(ctx.db, d) } : { ok: false, reason: out.reason };
}

/**
 * A client-bound, single-use copy of a discount, with a fresh FIRSTNAME-XXXX
 * code, optionally sent in a templated message (`via`). Inside the caller's tx.
 */
export function issueOffer(db, config, { coachId, client, discount, send = true, via = 'coachAction', now = new Date() }) {
  const code = freshCode(db, coachId, client.name.split(' ')[0]);
  const id = newId('dc');
  db.prepare(`INSERT INTO discounts (id, coach_id, code, name, kind, value, applies_to, starts_on, ends_on, max_redemptions, per_client_max, first_invoice_only, active, client_id, origin, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,1,1,0,1,?, 'offer', ?)`).run(id, coachId, code, discount.name, discount.kind, discount.value, discount.applies_to, null, discount.ends_on, client.id, now.toISOString());
  let sent = null;
  if (send) {
    const label = discount.kind === 'percent' ? `${(discount.value / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}% off` : `${money(discount.value)} off`;
    const { text } = render(db, coachId, client, DEFAULT_OFFER_TEXT, { now, extra: { offerName: `${label} (${discount.name})`, offerCode: code } });
    sent = sendMessage(db, config, { coachId, clientId: client.id, text, via, now });
  }
  return { discount: db.prepare('SELECT * FROM discounts WHERE id=?').get(id), code, sent };
}

function issueRoute(_req, ctx) {
  requireCoach(ctx);
  const d = ownRow(ctx, 'discounts', ctx.params.id);
  if (d.client_id) fail(409, 'That is already a single-use code');
  const client = clientFor(ctx, ctx.body.clientId);
  const send = ctx.body.send === undefined ? true : bool(ctx.body.send, 'send');
  const out = tx(ctx.db, () => issueOffer(ctx.db, ctx.config, { coachId: ctx.user.id, client, discount: d, send, now: requestNow(ctx) }));
  return { discount: discountOut(ctx.db, out.discount), code: out.code, messageId: out.sent?.message?.id ?? null };
}

// MARK: - Referrals

const SETTINGS_DEFAULT = { active: 0, reward_kind: 'credit', reward_value: 2000, referee_discount_id: null, notify_referrer: 0, reward_text: '' };
const settingsRow = (db, coachId) => db.prepare('SELECT * FROM referral_settings WHERE coach_id=?').get(coachId) ?? { coach_id: coachId, ...SETTINGS_DEFAULT, updated_at: null };

function rewardText(s) {
  if (s.reward_kind === 'credit') return `${money(s.reward_value)} account credit`;
  if (s.reward_kind === 'sessions') return `${s.reward_value} free session${s.reward_value === 1 ? '' : 's'}`;
  return `${(s.reward_value / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}% off your next invoice`;
}

const referralSettingsOut = s => ({
  active: !!s.active, rewardKind: s.reward_kind, rewardValue: s.reward_value, refereeDiscountId: s.referee_discount_id, notifyReferrer: !!s.notify_referrer,
  rewardText: rewardText(s), message: s.reward_text || DEFAULT_REWARD_TEXT, defaultMessage: DEFAULT_REWARD_TEXT, rule: 'first invoice paid', updatedAt: s.updated_at,
});

function getReferralSettings(_req, ctx) {
  requireCoach(ctx);
  return { settings: referralSettingsOut(settingsRow(ctx.db, ctx.user.id)) };
}

function putReferralSettings(_req, ctx) {
  requireCoach(ctx);
  const cur = settingsRow(ctx.db, ctx.user.id);
  const b = ctx.body;
  const kind = b.rewardKind === undefined ? cur.reward_kind : oneOf(b.rewardKind, 'rewardKind', REWARDS);
  const value = b.rewardValue === undefined ? cur.reward_value : int(b.rewardValue, 'rewardValue', { min: 1, max: kind === 'sessions' ? 20 : kind === 'percentNext' ? 10_000 : 100_000 });
  let refereeDiscountId = cur.referee_discount_id;
  if (b.refereeDiscountId !== undefined) {
    refereeDiscountId = b.refereeDiscountId === null || b.refereeDiscountId === '' ? null : ownRow(ctx, 'discounts', String(b.refereeDiscountId)).id;
  }
  const message = b.message === undefined ? cur.reward_text : str(b.message, 'message', { max: 1000 });
  ctx.db.prepare(`INSERT INTO referral_settings (coach_id, active, reward_kind, reward_value, referee_discount_id, notify_referrer, reward_text, updated_at) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(coach_id) DO UPDATE SET active=excluded.active, reward_kind=excluded.reward_kind, reward_value=excluded.reward_value, referee_discount_id=excluded.referee_discount_id,
      notify_referrer=excluded.notify_referrer, reward_text=excluded.reward_text, updated_at=excluded.updated_at`)
    .run(ctx.user.id, (b.active === undefined ? !!cur.active : bool(b.active, 'active')) ? 1 : 0, kind, value, refereeDiscountId,
      (b.notifyReferrer === undefined ? !!cur.notify_referrer : bool(b.notifyReferrer, 'notifyReferrer')) ? 1 : 0, message === DEFAULT_REWARD_TEXT ? '' : message, nowIso());
  return { settings: referralSettingsOut(settingsRow(ctx.db, ctx.user.id)) };
}

/** The public enquiry link for a referral code (WP11's form slug when it exists, else 'jk'). */
function referralLink(db, config, coachId, code) {
  let slug = 'jk';
  if (tableExists(db, 'lead_forms')) slug = db.prepare('SELECT slug FROM lead_forms WHERE coach_id=?').get(coachId)?.slug ?? slug;
  return `${String(config?.publicUrl ?? '').replace(/\/+$/, '')}/enquire/${encodeURIComponent(slug)}?ref=${encodeURIComponent(code)}`;
}

/** A client's referral code, made once (idempotent). Inside the caller's tx. */
export function codeFor(db, coachId, client) {
  const have = db.prepare('SELECT * FROM referral_codes WHERE client_id=?').get(client.id);
  if (have && have.coach_id === coachId) return have.code;
  if (have) db.prepare('DELETE FROM referral_codes WHERE client_id=?').run(client.id); // the client moved coach
  const code = freshCode(db, coachId, client.name.split(' ')[0]);
  db.prepare('INSERT INTO referral_codes (id, coach_id, client_id, code, created_at) VALUES (?,?,?,?,?)').run(newId('rc'), coachId, client.id, code, nowIso());
  return code;
}

function makeCodeRoute(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  const code = tx(ctx.db, () => codeFor(ctx.db, ctx.user.id, client));
  return { code, link: referralLink(ctx.db, ctx.config, ctx.user.id, code) };
}

function referralOut(db, r) {
  const referrer = db.prepare('SELECT id, name FROM users WHERE id=?').get(r.referrer_id);
  const referee = r.referee_id ? db.prepare('SELECT id, name FROM users WHERE id=?').get(r.referee_id) : null;
  return { id: r.id, referrer: who(referrer), referee: who(referee), refereeName: referee?.name ?? r.referee_name ?? 'A new enquiry', leadId: r.lead_id,
    status: r.status, rewardRef: r.reward_ref, rewardText: r.reward_text, createdAt: r.created_at, updatedAt: r.updated_at };
}

function listReferrals(_req, ctx) {
  requireCoach(ctx);
  const db = ctx.db;
  const rows = db.prepare(`SELECT r.* FROM referrals r JOIN users cu ON cu.id=r.referrer_id AND cu.role='client' AND cu.coach_id=? ORDER BY r.updated_at DESC`).all(ctx.user.id);
  const board = new Map();
  for (const r of rows) {
    const b = board.get(r.referrer_id) ?? { referrerId: r.referrer_id, referred: 0, qualified: 0, rewarded: 0 };
    if (r.status !== 'void') b.referred++;
    if (['qualified', 'rewarded'].includes(r.status)) b.qualified++;
    if (r.status === 'rewarded') b.rewarded++;
    board.set(r.referrer_id, b);
  }
  const codes = db.prepare(`SELECT rc.*, cu.name FROM referral_codes rc JOIN users cu ON cu.id=rc.client_id AND cu.role='client' AND cu.coach_id=? WHERE rc.coach_id=? ORDER BY cu.name`).all(ctx.user.id, ctx.user.id);
  return {
    referrals: rows.map(r => referralOut(db, r)),
    leaderboard: [...board.values()].sort((a, b) => b.qualified - a.qualified || b.referred - a.referred)
      .map(b => ({ client: who(db.prepare('SELECT id, name FROM users WHERE id=?').get(b.referrerId)), referred: b.referred, qualified: b.qualified, rewarded: b.rewarded })),
    codes: codes.map(c => ({ client: who({ id: c.client_id, name: c.name }), code: c.code, link: referralLink(db, ctx.config, ctx.user.id, c.code) })),
    settings: referralSettingsOut(settingsRow(db, ctx.user.id)),
  };
}

function voidReferral(_req, ctx) {
  requireCoach(ctx);
  const r = ctx.db.prepare(`SELECT r.* FROM referrals r JOIN users cu ON cu.id=r.referrer_id AND cu.coach_id=? WHERE r.id=?`).get(ctx.user.id, ctx.params.id);
  if (!r) fail(404, 'Not found');
  if (r.status === 'rewarded') fail(409, 'A rewarded referral can\'t be voided; raise a credit note or adjust instead');
  ctx.db.prepare("UPDATE referrals SET status='void', updated_at=? WHERE id=?").run(nowIso(), r.id);
  return { referral: referralOut(ctx.db, ctx.db.prepare('SELECT * FROM referrals WHERE id=?').get(r.id)) };
}

/** GET /api/referral/mine (client): {active, code, link, rewardText}. The code is made on first ask. */
function mine(_req, ctx) {
  if (ctx.user.role !== 'client' || !ctx.user.coach_id) return { active: false, code: null, link: null, rewardText: null };
  const s = settingsRow(ctx.db, ctx.user.coach_id);
  if (!s.active) return { active: false, code: null, link: null, rewardText: null };
  const code = tx(ctx.db, () => codeFor(ctx.db, ctx.user.coach_id, ctx.user));
  return { active: true, code, link: referralLink(ctx.db, ctx.config, ctx.user.coach_id, code), rewardText: rewardText(s) };
}

function performance(_req, ctx) {
  requireCoach(ctx);
  const db = ctx.db, coachId = ctx.user.id;
  const offers = db.prepare("SELECT * FROM discounts WHERE coach_id=? AND client_id IS NULL ORDER BY created_at").all(coachId).map(d => {
    // Single-use copies issued from an offer count with it (same name and kind, origin 'offer').
    const copies = db.prepare("SELECT id FROM discounts WHERE coach_id=? AND origin='offer' AND name=? AND kind=? AND value=?").all(coachId, d.name, d.kind, d.value).map(x => x.id);
    let { redemptions, discountedPence, revenuePence } = statsOf(db, d);
    for (const id of copies) { const s = statsOf(db, { id }); redemptions += s.redemptions; discountedPence += s.discountedPence; revenuePence += s.revenuePence; }
    return { id: d.id, name: d.name, code: d.code, redemptions, discountedPence, revenuePence, active: !!d.active };
  });
  const referred = db.prepare(`SELECT DISTINCT r.referee_id FROM referrals r JOIN users cu ON cu.id=r.referrer_id AND cu.coach_id=? WHERE r.referee_id IS NOT NULL AND r.status<>'void'`).all(coachId).map(r => r.referee_id);
  const referredRevenue = referred.length ? db.prepare(`SELECT COALESCE(SUM(amount_pence),0) n FROM payments WHERE voided_at IS NULL AND client_id IN (SELECT value FROM json_each(?))`).get(JSON.stringify(referred)).n : 0;
  const referralCost = db.prepare(`SELECT COALESCE(SUM(c.amount_pence),0) n FROM credit_notes c JOIN users cu ON cu.id=c.client_id AND cu.coach_id=? WHERE c.reason LIKE 'Referral reward:%'`).get(coachId).n;
  return {
    offers, referredClients: referred.length, referredRevenuePence: referredRevenue, referralCostPence: referralCost,
    discountCostPence: offers.reduce((n, o) => n + o.discountedPence, 0),
    discountRevenuePence: offers.reduce((n, o) => n + o.revenuePence, 0),
  };
}

// MARK: - Event handlers (the referral chain)

function onLeadCreated(db, _config, e) {
  const code = typeof e.payload?.referralCode === 'string' ? e.payload.referralCode.trim().toUpperCase() : '';
  if (!code || !e.coachId || !e.payload.leadId) return;
  const rc = db.prepare(`SELECT rc.* FROM referral_codes rc JOIN users cu ON cu.id=rc.client_id AND cu.coach_id=rc.coach_id WHERE rc.coach_id=? AND rc.code=?`).get(e.coachId, code);
  if (!rc) return;
  if (db.prepare('SELECT 1 FROM referrals WHERE coach_id=? AND lead_id=?').get(e.coachId, String(e.payload.leadId))) return;
  const name = tableExists(db, 'leads') ? db.prepare('SELECT name FROM leads WHERE id=? AND coach_id=?').get(String(e.payload.leadId), e.coachId)?.name ?? null : null;
  const id = newId('rf');
  db.prepare("INSERT INTO referrals (id, coach_id, referrer_id, lead_id, referee_name, status, created_at, updated_at) VALUES (?,?,?,?,?, 'pending', ?, ?)")
    .run(id, e.coachId, rc.client_id, String(e.payload.leadId), name, nowIso(), nowIso());
  emit(db, 'referral.created', { coachId: e.coachId, clientId: rc.client_id, summary: `Referred ${name ?? 'a new enquiry'}`, referralId: id, leadId: String(e.payload.leadId) });
}

function joinReferral(db, coachId, leadId, clientId) {
  const r = db.prepare("SELECT * FROM referrals WHERE coach_id=? AND lead_id=? AND status='pending'").get(coachId, String(leadId));
  if (!r || r.referrer_id === clientId) return;
  const client = db.prepare("SELECT * FROM users WHERE id=? AND role='client' AND coach_id=?").get(clientId, coachId);
  if (!client) return;
  db.prepare("UPDATE referrals SET status='joined', referee_id=?, referee_name=?, updated_at=? WHERE id=?").run(client.id, client.name, nowIso(), r.id);
}

function onLeadWon(db, _config, e) {
  // emit() lifts clientId out of the payload into the event's own column.
  const clientId = e.payload?.clientId ?? e.clientId;
  if (e.coachId && e.payload?.leadId && clientId) joinReferral(db, e.coachId, e.payload.leadId, clientId);
}

/** client.joined: the coach's open referred lead with the same e-mail (through WP11's table, when it exists). */
function onClientJoined(db, _config, e) {
  const email = String(e.payload?.email ?? '').toLowerCase();
  if (!email || !e.clientId || !e.coachId || !tableExists(db, 'leads')) return;
  for (const l of db.prepare('SELECT id FROM leads WHERE coach_id=? AND lower(email)=?').all(e.coachId, email)) joinReferral(db, e.coachId, l.id, e.clientId);
}

/** invoice.paid for the referee's FIRST paid invoice qualifies the referral, and the reward follows at once. */
function onInvoicePaid(db, config, e) {
  if (!e.clientId) return;
  const r = db.prepare("SELECT * FROM referrals WHERE referee_id=? AND status='joined'").get(e.clientId);
  if (!r) return;
  const paid = db.prepare("SELECT COUNT(*) n FROM invoices WHERE client_id=? AND status='paid'").get(e.clientId).n;
  if (paid !== 1) return;
  db.prepare("UPDATE referrals SET status='qualified', updated_at=? WHERE id=? AND status='joined'").run(nowIso(), r.id);
  emit(db, 'referral.qualified', { coachId: r.coach_id, clientId: r.referrer_id, summary: 'Referral qualified', referralId: r.id });
  reward(db, config, r.id, new Date(e.at));
}

/** Apply the programme's reward to the referrer, once (qualified → rewarded). */
export function reward(db, config, referralId, now = new Date()) {
  const r = db.prepare('SELECT * FROM referrals WHERE id=?').get(referralId);
  if (!r || r.status !== 'qualified') return null;
  const referrer = db.prepare("SELECT * FROM users WHERE id=? AND role='client'").get(r.referrer_id);
  if (!referrer?.coach_id) return null;
  const coachId = referrer.coach_id;
  const s = settingsRow(db, coachId);
  const refereeFirst = String(r.referee_name ?? 'your friend').split(' ')[0];
  let ref;
  const today = londonDay(now);
  if (s.reward_kind === 'credit') {
    ref = addCreditNote(db, { coachId, clientId: referrer.id, amountPence: s.reward_value, reason: `Referral reward: ${refereeFirst}` }).id;
  } else if (s.reward_kind === 'sessions') {
    ref = sellPackage(db, config, { coachId, client: referrer, pkg: null, startsOn: today, invoice: false, today, now, name: 'Referral reward', sessions: s.reward_value, validDays: 180 }).clientPackage.id;
  } else {
    ref = issueOffer(db, config, { coachId, client: referrer, discount: { name: 'Referral reward', kind: 'percent', value: s.reward_value, applies_to: 'any', ends_on: addDays(today, 365) }, send: false, now }).discount.id;
    db.prepare("UPDATE discounts SET origin='referral' WHERE id=?").run(ref);
  }
  const text = rewardText(s);
  db.prepare("UPDATE referrals SET status='rewarded', reward_ref=?, reward_text=?, updated_at=? WHERE id=? AND status='qualified'").run(ref, text, now.toISOString(), r.id);
  emit(db, 'referral.rewarded', { coachId, clientId: referrer.id, summary: `Referral reward: ${text}`, referralId: r.id, rewardKind: s.reward_kind });
  if (s.notify_referrer) {
    const { text: body } = render(db, coachId, referrer, s.reward_text || DEFAULT_REWARD_TEXT, { now, extra: { refereeFirst, reward: text } });
    sendMessage(db, config, { coachId, clientId: referrer.id, text: body, via: 'automation', now });
  }
  return ref;
}

function onInvoiceIssued(db, _config, e) {
  const p = e.payload ?? {};
  if (!p.discountId || !(p.discountPence > 0)) return;
  emit(db, 'offer.redeemed', { coachId: e.coachId, clientId: e.clientId, summary: `Offer used · ${money(p.discountPence)} off`, discountId: p.discountId, invoiceId: p.invoiceId, amountPence: p.discountPence });
}

// MARK: - Hooks

function exportFor(db, user) {
  if (user.role !== 'client') return {};
  const code = db.prepare('SELECT code FROM referral_codes WHERE client_id=?').get(user.id)?.code ?? null;
  return {
    referralCode: code,
    referralsMade: db.prepare('SELECT status, referee_name, created_at FROM referrals WHERE referrer_id=?').all(user.id).map(r => ({ status: r.status, referee: r.referee_name, at: r.created_at })),
    referredBy: db.prepare('SELECT status, created_at FROM referrals WHERE referee_id=?').all(user.id).map(r => ({ status: r.status, at: r.created_at })),
    offers: db.prepare('SELECT code, name, kind, value, ends_on FROM discounts WHERE client_id=?').all(user.id).map(d => ({ code: d.code, name: d.name, kind: d.kind, value: d.value, endsOn: d.ends_on })),
    redemptions: db.prepare('SELECT amount_pence, at FROM discount_redemptions WHERE client_id=?').all(user.id).map(x => ({ amountPence: x.amount_pence, at: x.at })),
  };
}

function search(db, coach, q, lim) {
  const s = q.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (s.length < 2) return [];
  return db.prepare(`SELECT * FROM discounts WHERE coach_id=? AND client_id IS NULL AND code LIKE ? ESCAPE '\\' ORDER BY active DESC LIMIT ?`).all(coach.id, `%${s}%`, lim)
    .map(d => ({ type: 'offer', id: d.id, title: `${d.code} · ${d.name}`, detail: d.kind === 'percent' ? `${d.value / 100}% off` : `${money(d.value)} off`, path: `/offers/discounts?open=${d.id}`, icon: 'sell', score: d.code === s ? 1 : 0.6, at: d.created_at }));
}

function timeline(db, coach, client, before, lim) {
  const cut = before ? String(before) : '9999';
  const out = [];
  for (const r of db.prepare("SELECT * FROM referrals WHERE referrer_id=? AND created_at<? ORDER BY created_at DESC LIMIT ?").all(client.id, cut, lim)) {
    out.push({ at: r.created_at, kind: 'referral', icon: 'handshake', tone: 'ok', title: `Referred ${r.referee_name ?? 'a new enquiry'}`, detail: r.status, path: '/offers/referrals' });
  }
  return out;
}

// MARK: - Demo

function buildDemo(db, { coach, byName, today }) {
  const at = (d, t = '10:00') => londonToUtc(d, t).toISOString();
  db.prepare(`INSERT INTO referral_settings (coach_id, active, reward_kind, reward_value, notify_referrer, updated_at) VALUES (?, 1, 'credit', 2000, 0, ?)`).run(coach.id, at(addDays(today, -120)));
  const { Sam: sam, Priya: priya, Tom: tom } = byName;
  if (!sam) return;
  const codes = {};
  for (const [c, code] of [[sam, 'SAM-K7QP'], [priya, 'PRIYA-3MWX']]) {
    if (!c) continue;
    db.prepare('INSERT INTO referral_codes (id, coach_id, client_id, code, created_at) VALUES (?,?,?,?,?)').run(newId('rc'), coach.id, c.id, code, at(addDays(today, -110)));
    codes[c.id] = code;
  }
  const ref = (referrer, status, { referee = null, name = null, leadId = null, days, rewardRef = null, rewardText = null }) => {
    db.prepare(`INSERT INTO referrals (id, coach_id, referrer_id, lead_id, referee_id, referee_name, status, reward_ref, reward_text, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(newId('rf'), coach.id, referrer.id, leadId, referee?.id ?? null, referee?.name ?? name, status, rewardRef, rewardText, at(addDays(today, -days)), at(addDays(today, -Math.max(0, days - 8))));
  };
  // Tom joined on Sam's recommendation and paid his first invoice: Sam got £20 credit.
  if (tom) {
    const cn = addCreditNote(db, { coachId: coach.id, clientId: sam.id, amountPence: 2000, reason: 'Referral reward: Tom' });
    db.prepare('UPDATE credit_notes SET created_at=? WHERE id=?').run(at(addDays(today, -12)), cn.id);
    ref(sam, 'rewarded', { referee: tom, days: 26, rewardRef: cn.id, rewardText: '£20 account credit' });
  }
  // A pending enquiry from Sam's link (WP11's demo lead when it exists), and one from Priya's.
  let lead = null;
  if (tableExists(db, 'leads')) lead = db.prepare("SELECT id, name FROM leads WHERE coach_id=? AND (referral_code IS NOT NULL OR source='referral') ORDER BY created_at DESC LIMIT 1").get(coach.id) ?? null;
  ref(sam, 'pending', { name: lead?.name ?? 'Hannah Lee', leadId: lead?.id ?? null, days: 4 });
  if (priya) ref(priya, 'pending', { name: 'Chris Doyle', days: 9 });
}

// MARK: - The feature

export const feature = {
  name: 'offers',
  namespaces: ['offer', 'referral'],
  schema,
  routes(r) {
    r.add('GET', '/api/offers/discounts', listDiscounts);
    r.add('POST', '/api/offers/discounts', createDiscount);
    r.add('POST', '/api/offers/discounts/check', checkCode);
    r.add('POST', '/api/offers/discounts/generate', generateCode);
    r.add('PUT', '/api/offers/discounts/:id', updateDiscount);
    r.add('DELETE', '/api/offers/discounts/:id', deleteDiscount);
    r.add('POST', '/api/offers/discounts/:id/issue', issueRoute);
    r.add('GET', '/api/offers/referrals/settings', getReferralSettings);
    r.add('PUT', '/api/offers/referrals/settings', putReferralSettings);
    r.add('GET', '/api/offers/referrals', listReferrals);
    r.add('POST', '/api/offers/referrals/codes', makeCodeRoute);
    r.add('POST', '/api/offers/referrals/:id/void', voidReferral);
    r.add('GET', '/api/offers/performance', performance);
    r.add('GET', '/api/referral/mine', mine);
  },
  on: {
    'lead.created': onLeadCreated,
    'lead.won': onLeadWon,
    'client.joined': onClientJoined,
    'invoice.paid': onInvoicePaid,
    'invoice.issued': onInvoiceIssued,
  },
  emits: {
    'offer.redeemed': { label: 'An offer was redeemed on an invoice', payload: ['discountId', 'invoiceId', 'amountPence'] },
    'referral.created': { label: 'A client referred someone', payload: ['referralId', 'leadId'] },
    'referral.qualified': { label: 'A referral qualified (first invoice paid)', payload: ['referralId'] },
    'referral.rewarded': { label: 'A referrer was rewarded', payload: ['referralId', 'rewardKind'] },
  },
  actions: {
    'offer.issue': {
      label: 'Send a personal offer code', clientFacing: true,
      params: [{ key: 'discountId', label: 'Offer', type: 'discount', required: true }],
      options: (db, coachId) => db.prepare("SELECT id, name, code FROM discounts WHERE coach_id=? AND client_id IS NULL AND active=1 ORDER BY name").all(coachId).map(d => ({ value: d.id, label: d.code ? `${d.name} (${d.code})` : d.name })),
      run(db, config, ctx) {
        const d = db.prepare('SELECT * FROM discounts WHERE id=? AND coach_id=? AND client_id IS NULL').get(ctx.params.discountId, ctx.coachId);
        if (!d) return 'Skipped: no such offer';
        if (!d.active) return 'Skipped: offer switched off';
        const out = issueOffer(db, config, { coachId: ctx.coachId, client: ctx.client, discount: d, send: true, via: ctx.via ?? 'automation', now: ctx.now });
        return out.sent?.message ? `Sent code ${out.code}` : out.sent?.deferredUntil ? `Code ${out.code} held until later` : `Made code ${out.code}${out.sent?.skipped ? ` (not sent: ${out.sent.skipped})` : ''}`;
      },
    },
  },
  search, timeline, exportFor,
  demo: {
    // No demo.tables (see billing.mjs): the builder makes its tables if needed and clears the demo accounts' rows itself.
    build(db, ctx) {
      schema(db);
      const list = JSON.stringify([ctx.coach.id, ...ctx.clients.map(c => c.id)]);
      for (const t of ['referrals', 'referral_codes', 'referral_settings']) db.prepare(`DELETE FROM ${t} WHERE coach_id IN (SELECT value FROM json_each(?))`).run(list);
      buildDemo(db, ctx);
    },
  },
};

