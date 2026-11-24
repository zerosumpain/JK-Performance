/**
 * F26 revenue insights and forecast (docs/design/desk-v2.md, WP3): months
 * bucket by payments.received_on (never created_at), the forecast merges
 * every feature's hook and survives a throwing one, and the demo coach's
 * numbers never include a real coach's money.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fakeToday, makeWorld } from './helpers.mjs';
import { issueSession } from '../auth.mjs';
import { buildDemo } from '../demo.mjs';
import { addMonths } from '../features/billing.mjs';
import { feature as revenue } from '../features/revenue.mjs';
import { addDays, monthBounds } from '../time.mjs';

const { today, now } = fakeToday();
const at = path => `${path}${path.includes('?') ? '&' : '?'}at=${encodeURIComponent(now.toISOString())}`;

let w, coach2;
before(async () => {
  w = await makeWorld();
  coach2 = await w.signIn('wp3r-coach2', 'coach2@example.com', { givenName: 'Other', familyName: 'Coach' });
});
after(() => w.close());

const pay = (clientId, amountPence, receivedOn, as = w.coach) => w.ok('POST', at('/api/billing/payments'), { as, body: { clientId, amountPence, method: 'bank', receivedOn } });

test('collected per month buckets by received_on, never created_at', async () => {
  const lastMonth = addMonths(monthBounds(today).first, -1, 1);
  await pay(w.client.id, 12000, addDays(lastMonth, 3)); // recorded today, received last month
  await pay(w.client.id, 3000, today);
  const s = await w.ok('GET', at('/api/revenue/summary?months=12'), { as: w.coach });
  assert.equal(s.collected.length, 12);
  assert.equal(s.collected.at(-1).month, today.slice(0, 7));
  assert.equal(s.collected.at(-1).pence, 3000);
  assert.equal(s.collected.at(-2).pence, 12000);
  assert.equal(s.mix.find(m => m.source === 'other').pence, 15000);
  assert.equal(s.avgLtvPence, 15000);
  await w.ok('PUT', '/api/revenue/target', { as: w.coach, body: { targetPence: 250000 } });
  assert.equal((await w.ok('GET', at('/api/revenue/summary'), { as: w.coach })).target, 250000);
  const c = await w.ok('GET', at('/api/revenue/clients'), { as: w.coach });
  const sam = c.clients.find(x => x.client.id === w.client.id);
  assert.deepEqual([sam.ltvPence, sam.monthsActive, sam.balancePence], [15000, 2, -15000]);
});

test('the forecast includes every hook and tolerates a throwing one', async () => {
  await w.ok('POST', '/api/billing/schedules', { as: w.coach, body: { clientId: w.client.id, label: 'Monthly', amountPence: 9900, interval: 'month', nextOn: addDays(today, 5) } });
  const fakeLine = { day: addDays(today, 10), pence: 4000, label: 'Lead · Hannah', confidence: 'possible', source: 'leads' };
  revenue.forecast = () => [fakeLine, { day: addDays(today, 400), pence: 1, label: 'outside', confidence: 'likely' }];
  try {
    let f = await w.ok('GET', at('/api/revenue/forecast?days=90'), { as: w.coach });
    assert.equal(f.days.length, 90);
    assert.ok(f.lines.some(l => l.source === 'billing.schedule' && l.confidence === 'certain' && l.pence === 9900));
    assert.ok(f.lines.some(l => l.label === 'Lead · Hannah'));
    assert.ok(!f.lines.some(l => l.label === 'outside'), 'lines outside the window are dropped');
    assert.equal(f.totals.possiblePence, 4000);
    assert.equal(f.days.find(d => d.day === fakeLine.day).possiblePence, 4000);
    revenue.forecast = () => { throw new Error('boom'); };
    f = await w.ok('GET', at('/api/revenue/forecast?days=90'), { as: w.coach });
    assert.ok(f.lines.some(l => l.source === 'billing.schedule'), 'the other hooks still answer');
  } finally {
    delete revenue.forecast;
  }
});

test('the demo coach\'s numbers never include a real coach\'s', async () => {
  const theirs = w.user('Real Client', 'client', coach2.id);
  await pay(theirs.id, 777_700, today, coach2);
  buildDemo(w.db, today, w.config);
  const demo = w.db.prepare("SELECT * FROM users WHERE apple_sub='demo-coach'").get();
  const token = issueSession(w.db, demo.id);
  const s = await w.ok('GET', at('/api/revenue/summary'), { token });
  const demoTotal = w.db.prepare(`SELECT COALESCE(SUM(p.amount_pence),0) n FROM payments p JOIN users u ON u.id=p.client_id WHERE u.coach_id=? AND p.voided_at IS NULL AND p.received_on>=?`)
    .get(demo.id, s.collected[0].month + '-01').n;
  assert.equal(s.totals.collectedPence, demoTotal);
  assert.ok(s.totals.collectedPence > 0, 'the demo looks alive');
  assert.equal(s.target, 250000);
  assert.ok(s.planMrr.at(-1).pence > 0);
  assert.ok(s.billedMrr.at(-1).pence > 0);
  const clients = await w.ok('GET', at('/api/revenue/clients'), { token });
  assert.ok(clients.clients.every(c => c.client.id !== theirs.id));
  // Every demo client (other packages' demo builders may add more than the core six), and nobody else.
  assert.equal(clients.clients.length, w.db.prepare("SELECT COUNT(*) n FROM users WHERE coach_id=? AND role='client'").get(demo.id).n);
  assert.ok(clients.clients.length >= 6);
  const f = await w.ok('GET', at('/api/revenue/forecast'), { token });
  assert.ok(f.totals.certainPence > 0);
  // And the real coach never sees demo money.
  const real = await w.ok('GET', at('/api/revenue/summary'), { as: coach2 });
  assert.equal(real.totals.collectedPence, 777_700);
  assert.equal((await w.call('GET', '/api/revenue/summary', { as: w.client })).status, 403);
});
