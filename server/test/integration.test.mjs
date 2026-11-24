/**
 * WP-Z cross-package tests (docs/design/desk-v2.md section 7, item 8): with
 * every feature loaded, ending coaching through WP2's real endpoint stops
 * WP3's recurring billing and dunning, WP4's campaign nudges and WP5's
 * automation runs. Each package proves its own handler with a hand-emitted
 * event; this proves the whole chain.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fakeToday, makeWorld } from './helpers.mjs';
import { runDunning, runRecurring } from '../features/billing.mjs';
import { featureNames } from '../registry.mjs';
import { setCoachPref } from '../store.mjs';
import { addDays, londonToUtc } from '../time.mjs';

const { today, now } = fakeToday();
const at = (path, when = now) => `${path}${path.includes('?') ? '&' : '?'}at=${encodeURIComponent(when.toISOString())}`;

let w;
before(async () => {
  w = await makeWorld();
  setCoachPref(w.db, w.coach.id, 'outreach.quietHours', 'off');
});
after(() => w.close());

const one = (sql, ...a) => w.db.prepare(sql).get(...a);
const count = (sql, ...a) => one(sql, ...a).n;

test('every desk-v2 feature is loaded', () => {
  const names = featureNames();
  for (const f of ['aireview', 'voice', 'crm', 'onboarding', 'leads', 'marketing', 'billing', 'offers', 'revenue', 'calsync', 'diary', 'tasks',
    'accountability', 'insights', 'campaigns', 'guidebook', 'automations', 'outreach', 'templates', 'command']) assert.ok(names.includes(f), f);
});

test('End coaching stops recurring invoices, dunning, campaign nudges and automation runs', async () => {
  const c = w.user('Olly Over', 'client', w.coach.id);
  w.db.prepare("UPDATE users SET plan='performance' WHERE id=?").run(c.id);

  // WP3: a monthly schedule due tomorrow and an issued invoice due today (overdue from tomorrow).
  const { schedule } = await w.ok('POST', at('/api/billing/schedules'), { as: w.coach, body: { clientId: c.id, label: 'Monthly', amountPence: 5000, interval: 'month', nextOn: addDays(today, 1) } });
  const { invoice: d } = await w.ok('POST', at('/api/billing/invoices'), { as: w.coach, body: { clientId: c.id, lines: [{ description: 'Coaching', quantity: 1, unitPence: 12000 }] } });
  const { invoice } = await w.ok('POST', at(`/api/billing/invoices/${d.id}/issue`), { as: w.coach, body: { dueOn: today } });

  // WP4: a live campaign with a 09:00 nudge, Olly in it.
  const { campaign: draft } = await w.ok('POST', '/api/campaigns', { as: w.coach, body: { name: 'Integration Block' } });
  await w.ok('PUT', `/api/campaigns/${draft.id}`, { as: w.coach, body: {
    campaign: { startMode: 'fixed', startsOn: today, lengthDays: 14, feePence: 0, settings: { nudgeAt: '09:00' } },
    phases: [{ key: 'p1', name: 'One', startDay: 0, endDay: 13 }],
    activities: Array.from({ length: 14 }, (_, day) => ({ phaseId: 'p1', day, title: `Day ${day + 1}`, kind: 'task', points: 10 })),
    kit: [],
  } });
  await w.ok('POST', `/api/campaigns/${draft.id}/status`, { as: w.coach, body: { status: 'live' } });
  await w.ok('POST', at(`/api/campaigns/${draft.id}/enrol`), { as: w.coach, body: { clientIds: [c.id], mode: 'inPerson' } });

  // WP5: a hand-started automation waiting a day before it messages.
  const { automation } = await w.ok('POST', '/api/automations', { as: w.coach, body: { name: 'Check back', trigger: { type: 'manual' },
    steps: [{ type: 'wait', days: 1, hours: 0, at: null }, { type: 'action', action: 'message.send', params: { text: 'How are you getting on, {first}?' } }] } });
  await w.ok('POST', `/api/automations/${automation.id}/status`, { as: w.coach, body: { status: 'live' } });
  await w.ok('POST', `/api/automations/${automation.id}/enrol`, { as: w.coach, body: { clientIds: [c.id] } });
  assert.equal(one("SELECT status FROM automation_runs WHERE automation_id=? AND client_id=?", automation.id, c.id).status, 'active');
  await w.settle();

  // WP2: End coaching, through the real endpoint.
  const out = await w.ok('POST', `/api/coach/clients/${c.id}/end`, { as: w.coach, body: { exitReason: 'moved', money: 'leave', keepChasing: false, packages: 'expire' } });
  assert.equal(out.lifecycle.stage, 'churned');
  await w.settle();
  assert.equal(count("SELECT COUNT(*) n FROM events WHERE type='client.offboarded' AND client_id=?", c.id), 1);

  const messages = via => count("SELECT COUNT(*) n FROM messages WHERE client_id=? AND from_role='coach' AND via=?", c.id, via);
  const invoicesBefore = count('SELECT COUNT(*) n FROM invoices WHERE client_id=?', c.id);

  // No recurring invoice.
  assert.equal(one('SELECT status FROM billing_schedules WHERE id=?', schedule.id).status, 'ended');
  for (const day of [1, 2, 32]) runRecurring(w.db, w.config, londonToUtc(addDays(today, day), '12:00'));
  assert.equal(count('SELECT COUNT(*) n FROM invoices WHERE client_id=?', c.id), invoicesBefore, 'no recurring invoice');

  // No dunning.
  for (const day of [1, 2, 7, 14, 15]) runDunning(w.db, w.config, londonToUtc(addDays(invoice.dueOn, day), '12:00'));
  await w.settle();
  assert.equal(messages('dunning'), 0, 'no dunning message');
  assert.equal(count("SELECT COUNT(*) n FROM coach_notifications WHERE client_id=? AND kind='invoiceOverdue'", c.id), 0, 'no dunning coach step');

  // No campaign nudge.
  assert.equal(one('SELECT status FROM campaign_enrolments WHERE campaign_id=? AND client_id=?', draft.id, c.id).status, 'dropped');
  for (const day of [0, 1, 2]) await w.tick('campaigns.tick', londonToUtc(addDays(today, day), '09:05'));
  assert.equal(messages('campaign'), 0, 'no campaign nudge');

  // No automation run.
  assert.equal(one('SELECT status FROM automation_runs WHERE automation_id=? AND client_id=?', automation.id, c.id).status, 'stopped');
  await w.tick('automations.advance', new Date(Date.now() + 2 * 86_400_000));
  assert.equal(messages('automation'), 0, 'no automation message');
  assert.equal((await w.call('POST', `/api/automations/${automation.id}/enrol`, { as: w.coach, body: { clientIds: [c.id] } })).status, 200);
  assert.equal(count("SELECT COUNT(*) n FROM automation_runs WHERE automation_id=? AND client_id=? AND status NOT IN ('stopped','done')", automation.id, c.id), 0,
    'an ended client is not started again');
});
