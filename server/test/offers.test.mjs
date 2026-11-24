/**
 * F12 discounts, promo codes and referrals (docs/design/desk-v2.md, WP3):
 * the discount maths, windows and limits, redemption on issue only, the
 * referral chain from injected events through to one reward, single-use
 * offers, isolation, export and erasure.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { assertNoRowsFor, fakeToday, makeWorld } from './helpers.mjs';
import { emit } from '../events.mjs';
import { runAction } from '../facts.mjs';
import { makeCode } from '../features/offers.mjs';
import { setCoachPref } from '../store.mjs';
import { addDays } from '../time.mjs';

const { today, now } = fakeToday();
const at = path => `${path}${path.includes('?') ? '&' : '?'}at=${encodeURIComponent(now.toISOString())}`;

let w, coach2, olive;
before(async () => {
  w = await makeWorld();
  coach2 = await w.signIn('wp3o-coach2', 'coach2@example.com', { givenName: 'Other', familyName: 'Coach' });
  olive = w.user('Olive Other', 'client', coach2.id);
  setCoachPref(w.db, w.coach.id, 'outreach.quietHours', 'off');
});
after(() => w.close());

const one = (sql, ...a) => w.db.prepare(sql).get(...a);
const rows = (sql, ...a) => w.db.prepare(sql).all(...a);
const discount = (body, as = w.coach) => w.ok('POST', '/api/offers/discounts', { as, body: { kind: 'percent', value: 1000, ...body } }).then(r => r.discount);
const check = (code, clientId, lines) => w.ok('POST', at('/api/offers/discounts/check'), { as: w.coach, body: { code, clientId, lines } });
const newClient = name => w.user(name, 'client', w.coach.id);
const invoice = (clientId, unitPence, extra = {}, kind = 'plan') => w.ok('POST', at('/api/billing/invoices'), { as: w.coach, body: { clientId, lines: [{ description: 'Coaching', quantity: 1, unitPence, kind }], ...extra } }).then(r => r.invoice);
const issue = id => w.ok('POST', at(`/api/billing/invoices/${id}/issue`), { as: w.coach, body: {} }).then(r => r.invoice);

describe('discounts', () => {
  test('percent rounds down and both kinds are capped at the eligible lines', async () => {
    await discount({ code: 'THIRD', name: 'A third off plans', value: 3333, appliesTo: 'plan' });
    await discount({ code: 'BIGFIX', name: '£50 off', kind: 'fixed', value: 5000 });
    const c = newClient('Max Maths');
    const r = await check('third', c.id, [{ kind: 'plan', amountPence: 1000 }, { kind: 'kit', amountPence: 5000 }]);
    assert.deepEqual([r.ok, r.amountPence], [true, 333], 'floor(1000 × 33.33%) on the plan line only');
    const f = await check('BIGFIX', c.id, [{ kind: 'plan', amountPence: 2000 }]);
    assert.equal(f.amountPence, 2000, 'a fixed discount never exceeds the bill');
    const wrong = await check('THIRD', c.id, [{ kind: 'kit', amountPence: 2000 }]);
    assert.equal(wrong.ok, false);
    assert.match(wrong.reason, /plan lines only/);
    const inv = await invoice(c.id, 2000, { discountCode: 'BIGFIX' });
    assert.equal(inv.discountPence, 2000);
    assert.equal(inv.totalPence, 0);
    const none = await w.call('POST', at(`/api/billing/invoices/${inv.id}/issue`), { as: w.coach, body: {} });
    assert.equal(none.status, 400, 'nothing to bill');
  });

  test('window and limit rejections, and per_client_max', async () => {
    await discount({ code: 'SOON', name: 'Soon', startsOn: addDays(today, 3) });
    await discount({ code: 'GONE', name: 'Gone', startsOn: addDays(today, -30), endsOn: addDays(today, -1) });
    await discount({ code: 'ONCE', name: 'Once', maxRedemptions: 1, perClientMax: 1 });
    await discount({ code: 'TWICE', name: 'Twice each', perClientMax: 2 });
    await discount({ code: 'FIRST', name: 'First only', firstInvoiceOnly: true });
    const a = newClient('Ann Limits'), b = newClient('Ben Limits');
    assert.match((await check('SOON', a.id)).reason, /starts on/);
    assert.match((await check('GONE', a.id)).reason, /has ended/);
    await issue((await invoice(a.id, 5000, { discountCode: 'ONCE' })).id);
    assert.match((await check('ONCE', b.id)).reason, /used up/);
    await issue((await invoice(a.id, 5000, { discountCode: 'TWICE' })).id);
    await issue((await invoice(a.id, 5000, { discountCode: 'TWICE' })).id);
    assert.match((await check('TWICE', a.id)).reason, /Already used/);
    assert.equal((await check('TWICE', b.id)).ok, true);
    assert.match((await check('FIRST', a.id)).reason, /first invoice/);
    assert.equal((await check('FIRST', b.id)).ok, true);
    const bad = await w.call('POST', at('/api/billing/invoices'), { as: w.coach, body: { clientId: b.id, lines: [{ description: 'x', unitPence: 100 }], discountCode: 'GONE' } });
    assert.equal(bad.status, 400);
  });

  test('the redemption is written on issue, never on draft', async () => {
    const d = await discount({ code: 'ONISSUE', name: 'On issue', value: 2000, perClientMax: 5 });
    const c = newClient('Isla Issue');
    const inv = await invoice(c.id, 10000, { discountCode: 'ONISSUE' });
    assert.equal(inv.discountPence, 2000);
    assert.equal(rows('SELECT * FROM discount_redemptions WHERE discount_id=?', d.id).length, 0);
    await issue(inv.id);
    assert.equal(rows('SELECT * FROM discount_redemptions WHERE discount_id=?', d.id).length, 1);
    await w.settle();
    const ev = rows("SELECT * FROM events WHERE type='offer.redeemed' AND client_id=?", c.id);
    assert.equal(ev.length, 1);
    assert.deepEqual(JSON.parse(ev[0].payload), { discountId: d.id, invoiceId: inv.id, amountPence: 2000 });
    const list = await w.ok('GET', '/api/offers/discounts', { as: w.coach });
    const mine = list.discounts.find(x => x.id === d.id);
    assert.equal(mine.redemptions, 1);
    assert.equal(mine.discountedPence, 2000);
  });

  test('codes are unique per coach, and two coaches may share one', async () => {
    await discount({ code: 'SAM-AB12', name: 'Sam' });
    const dup = await w.call('POST', '/api/offers/discounts', { as: w.coach, body: { code: 'SAM-AB12', name: 'Again', kind: 'percent', value: 100 } });
    assert.equal(dup.status, 409);
    const theirs = await discount({ code: 'SAM-AB12', name: 'Their Sam' }, coach2);
    assert.equal(theirs.code, 'SAM-AB12');
    const lower = await w.call('POST', '/api/offers/discounts', { as: w.coach, body: { code: 'bad code!', name: 'x', kind: 'fixed', value: 1 } });
    assert.equal(lower.status, 400);
    assert.match(makeCode('Sam'), /^SAM-[A-HJ-KM-NP-Z2-9]{4}$/);
    assert.doesNotMatch(makeCode('Sam').slice(4), /[01OIL]/);
  });

  test('offer.issue makes a single-use code bound to the client and sends it', async () => {
    const d = await discount({ code: 'WINBACK', name: 'Welcome back', value: 1500, perClientMax: 3 });
    const c = newClient('Wendy Winback');
    const other = newClient('Oscar Other');
    const row = one('SELECT * FROM users WHERE id=?', c.id);
    const out = runAction(w.db, w.config, 'offer.issue', { coachId: w.coach.id, client: row, params: { discountId: d.id }, now });
    assert.match(out, /^Sent code WENDY-/);
    const code = out.split(' ').at(-1);
    const msg = one("SELECT * FROM messages WHERE client_id=? AND via='automation' ORDER BY at DESC", c.id);
    assert.ok(msg.text.includes(code));
    assert.equal((await check(code, c.id)).ok, true);
    assert.match((await check(code, other.id)).reason, /another client/);
    await issue((await invoice(c.id, 4000, { discountCode: code })).id);
    assert.match((await check(code, c.id)).reason, /used up|Already used/);
    const viaRoute = await w.ok('POST', at(`/api/offers/discounts/${d.id}/issue`), { as: w.coach, body: { clientId: other.id, send: false } });
    assert.match(viaRoute.code, /^OSCAR-/);
  });

  test('isolation: every route is a 404 across coaches, and a client is refused', async () => {
    const d = await discount({ code: 'ISO', name: 'Iso' });
    const c = newClient('Ivy Iso');
    const { code } = await w.ok('POST', '/api/offers/referrals/codes', { as: w.coach, body: { clientId: c.id } });
    assert.ok(code);
    emit(w.db, 'lead.created', { coachId: w.coach.id, leadId: 'ld_iso', source: 'referral', referralCode: code });
    await w.settle();
    const ref = one('SELECT * FROM referrals WHERE lead_id=?', 'ld_iso');
    for (const [method, path, body] of [
      ['PUT', `/api/offers/discounts/${d.id}`, { name: 'x' }], ['DELETE', `/api/offers/discounts/${d.id}`], ['POST', `/api/offers/discounts/${d.id}/issue`, { clientId: olive.id }],
      ['POST', '/api/offers/discounts/check', { code: 'ISO', clientId: c.id }], ['POST', '/api/offers/referrals/codes', { clientId: c.id }],
      ['POST', `/api/offers/referrals/${ref.id}/void`],
    ]) {
      assert.equal((await w.call(method, path, { as: coach2, body })).status, 404, `${method} ${path}`);
    }
    const theirs = await w.ok('GET', '/api/offers/discounts', { as: coach2 });
    assert.ok(!theirs.discounts.some(x => x.id === d.id));
    assert.ok(!(await w.ok('GET', '/api/offers/referrals', { as: coach2 })).referrals.some(r => r.id === ref.id));
    assert.equal((await w.call('GET', '/api/offers/discounts', { as: w.client })).status, 403);
  });
});

describe('referrals', () => {
  const chain = async ({ rewardKind, rewardValue, name }) => {
    await w.ok('PUT', '/api/offers/referrals/settings', { as: w.coach, body: { active: true, rewardKind, rewardValue, notifyReferrer: true } });
    const referrer = newClient(`${name} Referrer`);
    const { code, link } = await w.ok('POST', '/api/offers/referrals/codes', { as: w.coach, body: { clientId: referrer.id } });
    const again = await w.ok('POST', '/api/offers/referrals/codes', { as: w.coach, body: { clientId: referrer.id } });
    assert.equal(again.code, code, 'idempotent');
    assert.ok(link.endsWith(`?ref=${code}`));
    const leadId = `ld_${name}`;
    emit(w.db, 'lead.created', { coachId: w.coach.id, leadId, source: 'referral', referralCode: code.toLowerCase() });
    emit(w.db, 'lead.created', { coachId: w.coach.id, leadId, source: 'referral', referralCode: code });
    await w.settle();
    let r = rows('SELECT * FROM referrals WHERE lead_id=?', leadId);
    assert.equal(r.length, 1);
    assert.equal(r[0].status, 'pending');
    const referee = newClient(`${name} Referee`);
    emit(w.db, 'lead.won', { coachId: w.coach.id, leadId, clientId: referee.id });
    await w.settle();
    assert.equal(one('SELECT status, referee_id FROM referrals WHERE lead_id=?', leadId).referee_id, referee.id);
    const inv = await issue((await invoice(referee.id, 9900)).id);
    await w.ok('POST', at('/api/billing/payments'), { as: w.coach, body: { clientId: referee.id, invoiceId: inv.id, amountPence: 9900, method: 'bank', receivedOn: today } });
    await w.settle();
    r = one('SELECT * FROM referrals WHERE lead_id=?', leadId);
    assert.equal(r.status, 'rewarded');
    // Duplicate events never reward twice.
    emit(w.db, 'invoice.paid', { coachId: w.coach.id, clientId: referee.id, invoiceId: inv.id, totalPence: 9900 });
    emit(w.db, 'lead.won', { coachId: w.coach.id, leadId, clientId: referee.id });
    await w.settle();
    const inv2 = await issue((await invoice(referee.id, 9900)).id);
    await w.ok('POST', at('/api/billing/payments'), { as: w.coach, body: { clientId: referee.id, invoiceId: inv2.id, amountPence: 9900, method: 'bank', receivedOn: today } });
    await w.settle();
    for (const type of ['referral.created', 'referral.qualified', 'referral.rewarded']) {
      assert.equal(rows('SELECT * FROM events WHERE type=? AND client_id=?', type, referrer.id).length, 1, type);
    }
    const told = rows("SELECT * FROM messages WHERE client_id=? AND via='automation'", referrer.id);
    assert.equal(told.length, 1, 'the referrer is told once (the coach ticked it)');
    return { referrer, referee, r };
  };

  test('the full chain to a credit reward, once', async () => {
    const { referrer, r } = await chain({ rewardKind: 'credit', rewardValue: 2500, name: 'Cred' });
    const notes = rows('SELECT * FROM credit_notes WHERE client_id=?', referrer.id);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].amount_pence, 2500);
    assert.equal(notes[0].reason, 'Referral reward: Cred');
    assert.equal(r.reward_ref, notes[0].id);
    const board = await w.ok('GET', '/api/offers/referrals', { as: w.coach });
    assert.ok(board.leaderboard.some(l => l.client.id === referrer.id && l.rewarded === 1));
  });

  test('sessions and percent-off rewards', async () => {
    const s = await chain({ rewardKind: 'sessions', rewardValue: 2, name: 'Sess' });
    const pack = one('SELECT * FROM client_packages WHERE client_id=?', s.referrer.id);
    assert.deepEqual([pack.name, pack.sessions_total, pack.status], ['Referral reward', 2, 'active']);
    const p = await chain({ rewardKind: 'percentNext', rewardValue: 1500, name: 'Pct' });
    const d = one('SELECT * FROM discounts WHERE client_id=?', p.referrer.id);
    assert.deepEqual([d.kind, d.value, d.max_redemptions, d.origin], ['percent', 1500, 1, 'referral']);
  });

  test('the client sees their code; a voided referral never rewards', async () => {
    await w.ok('PUT', '/api/offers/referrals/settings', { as: w.coach, body: { active: true, rewardKind: 'credit', rewardValue: 2000 } });
    const mine = await w.ok('GET', '/api/referral/mine', { as: w.client });
    assert.equal(mine.active, true);
    assert.match(mine.code, /^SAM-/);
    assert.equal(mine.rewardText, '£20 account credit');
    assert.deepEqual(await w.ok('GET', '/api/referral/mine', { as: olive }), { active: false, code: null, link: null, rewardText: null });
    emit(w.db, 'lead.created', { coachId: w.coach.id, leadId: 'ld_void', referralCode: mine.code });
    await w.settle();
    const r = one('SELECT * FROM referrals WHERE lead_id=?', 'ld_void');
    await w.ok('POST', `/api/offers/referrals/${r.id}/void`, { as: w.coach });
    const referee = newClient('Vee Void');
    emit(w.db, 'lead.won', { coachId: w.coach.id, leadId: 'ld_void', clientId: referee.id });
    await w.settle();
    assert.equal(one('SELECT status FROM referrals WHERE id=?', r.id).status, 'void');
  });

  test('export and erasure', async () => {
    const c = await w.signIn('wp3o-erase', 'erase-offers@example.com', { givenName: 'Ezra', familyName: 'Erase' });
    await w.ok('POST', '/api/offers/referrals/codes', { as: w.coach, body: { clientId: c.id } });
    const d = await discount({ code: 'ERASE', name: 'Erase' });
    const out = runAction(w.db, w.config, 'offer.issue', { coachId: w.coach.id, client: one('SELECT * FROM users WHERE id=?', c.id), params: { discountId: d.id }, now });
    assert.match(out, /EZRA-/);
    emit(w.db, 'lead.created', { coachId: w.coach.id, leadId: 'ld_erase', referralCode: one('SELECT code FROM referral_codes WHERE client_id=?', c.id).code });
    await w.settle();
    const exp = await w.call('GET', '/api/me/export', { as: c });
    const data = Buffer.isBuffer(exp.body) ? JSON.parse(exp.body.toString('utf8')) : exp.body;
    assert.match(data.features.offers.referralCode, /^EZRA-/);
    assert.equal(data.features.offers.offers.length, 1);
    assert.equal(data.features.offers.referralsMade.length, 1);
    await w.ok('DELETE', '/api/me', { as: c });
    assertNoRowsFor(w.db, c.id);
    assert.equal(rows('SELECT * FROM referrals WHERE lead_id=?', 'ld_erase').length, 0);
  });
});
