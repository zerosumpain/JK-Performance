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

// D5 / 6.3 across packages: an AI judgement must never make the system message a client, even through a chain of
// coach-side steps (a tag, a task) that another automation listens to.
test('an AI judgement never messages a client through a tag or a task another automation reacts to', async () => {
  const { emit } = await import('../events.mjs');
  const { evaluateEnters } = await import('../features/automations.mjs');
  const c = w.user('Sam Signal', 'client', w.coach.id);
  const { tag } = await w.ok('POST', '/api/tags', { as: w.coach, body: { name: 'Voice flagged' } });
  const send = text => ({ type: 'action', action: 'message.send', params: { text } });
  const live = async (name, trigger, steps) => {
    const { automation } = await w.ok('POST', '/api/automations', { as: w.coach, body: { name, trigger, steps, settings: { quietHours: false, reentry: 'always' } } });
    await w.ok('POST', `/api/automations/${automation.id}/status`, { as: w.coach, body: { status: 'live' } });
    return automation;
  };
  await live('A', { type: 'event', event: 'voice.flagged' }, [{ type: 'action', action: 'tag.add', params: { tagId: tag.id } }]);
  const B = await live('B', { type: 'event', event: 'client.tagged' }, [send('Hi {first}, are you OK?')]);
  await live('C', { type: 'event', event: 'voice.flagged' }, [{ type: 'action', action: 'task.create', params: { title: 'Check {first}' } }]);
  const D = await live('D', { type: 'event', event: 'task.created' }, [send('Task message for {first}')]);
  const E = await live('E', { type: 'enters', rules: { match: 'all', rules: [{ fact: 'core.tags', op: 'has', value: tag.id }] } }, [send('Tag message for {first}')]);
  // A coach-side "enters" on the AI's tag makes a task: that task carries the taint too, so D can't message from it.
  const F = await live('F', { type: 'enters', rules: { match: 'all', rules: [{ fact: 'core.tags', op: 'has', value: tag.id }] } }, [{ type: 'action', action: 'task.create', params: { title: 'Look at {first}' } }]);
  evaluateEnters(w.db, w.config, new Date()); // the first look only records
  const sent = () => count("SELECT COUNT(*) n FROM messages WHERE client_id=? AND from_role='coach' AND via='automation'", c.id);

  emit(w.db, 'voice.flagged', { coachId: w.coach.id, clientId: c.id, summary: 'Mentioned knee pain', messageId: 'm_test', kinds: ['pain'] });
  for (let i = 0; i < 4; i++) {
    await w.settle();
    await w.tick('automations.advance', new Date(Date.now() + i * 60_000));
    evaluateEnters(w.db, w.config, new Date(Date.now() + i * 60_000));
  }
  await w.settle();
  assert.equal(one('SELECT added_by FROM client_tags WHERE client_id=? AND tag_id=?', c.id, tag.id)?.added_by, 'ai', 'the tag is marked as the AI\'s');
  assert.equal(JSON.parse(one("SELECT payload FROM events WHERE type='task.created' AND client_id=? ORDER BY seq DESC", c.id).payload).aiDerived, true);
  assert.equal(sent(), 0, 'no message reached the client');
  for (const a of [B, D]) {
    const run = one('SELECT * FROM automation_runs WHERE automation_id=? AND client_id=?', a.id, c.id);
    assert.ok(run, `${a.name} started`);
    assert.ok(JSON.parse(run.log).some(l => l.outcome === 'refused: aiDerived'), `${a.name} refused its message step`);
  }
  assert.equal(count('SELECT COUNT(*) n FROM automation_runs WHERE automation_id=? AND client_id=?', E.id, c.id), 0, 'an AI-added tag does not start a client-facing "enters" run');
  assert.equal(count('SELECT COUNT(*) n FROM automation_runs WHERE automation_id=? AND client_id=?', F.id, c.id), 1, 'the coach-side one still runs');
  const tasks = w.db.prepare("SELECT payload FROM events WHERE type='task.created' AND client_id=?").all(c.id).map(e => JSON.parse(e.payload));
  assert.ok(tasks.length >= 2 && tasks.every(p => p.aiDerived === true), 'every task the chain made is marked');

  // The same automations still work for the coach's own tag.
  const k = w.user('Kai Coachtag', 'client', w.coach.id);
  await w.ok('PUT', `/api/coach/clients/${k.id}/tags`, { as: w.coach, body: { tagIds: [tag.id] } });
  await w.settle();
  await w.tick('automations.advance', new Date(Date.now() + 10 * 60_000));
  await w.settle();
  assert.equal(count("SELECT COUNT(*) n FROM messages WHERE client_id=? AND from_role='coach' AND via='automation'", k.id), 1, 'a coach\'s tag still drives B');
});

test('a segment built on an AI judgement can\'t be smuggled into a sending audience through core.segments', async () => {
  const { resolveAudience } = await import('../facts.mjs');
  const { segment } = await w.ok('POST', '/api/segments', { as: w.coach, body: { name: 'Low mood', rules: { match: 'all', rules: [{ fact: 'voice.sentiment14', op: 'lt', value: -0.3 }] } } });
  const rules = { match: 'all', rules: [{ fact: 'core.segments', op: 'has', value: segment.id }] };
  assert.throws(() => resolveAudience(w.db, w.coach.id, { rules }, { purpose: 'broadcast' }), /can't use AI judgements/);
  assert.doesNotThrow(() => resolveAudience(w.db, w.coach.id, { rules }, { purpose: 'any' }));
  const r = await w.call('POST', '/api/automations', { as: w.coach, body: { name: 'Sneaky', trigger: { type: 'manual' }, conditions: rules, steps: [{ type: 'action', action: 'message.send', params: { text: 'Hi {first}' } }] } });
  assert.equal(r.status, 400);
});

test('billing edge cases across packages: draft refunds, zero invoices, schedule discounts, voids and campaign discounts', async () => {
  const { runRecurring } = await import('../features/billing.mjs');
  const balance = async id => (await w.ok('GET', `/api/coach/clients/${id}/billing`, { as: w.coach })).balancePence;

  // Ending coaching with a refund on a package whose invoice is still a draft: never billed, so nothing is owed back.
  const r = w.user('Rhea Draft', 'client', w.coach.id);
  const { package: pk } = await w.ok('POST', '/api/billing/packages', { as: w.coach, body: { name: '10 x 1:1', sessions: 10, pricePence: 50000 } });
  await w.ok('POST', `/api/billing/packages/${pk.id}/sell`, { as: w.coach, body: { clientId: r.id } });
  await w.ok('POST', `/api/coach/clients/${r.id}/end`, { as: w.coach, body: { exitReason: 'cost', money: 'leave', keepChasing: false, packages: 'refund' } });
  await w.settle();
  assert.equal(count('SELECT COUNT(*) n FROM credit_notes WHERE client_id=?', r.id), 0);
  assert.equal(one('SELECT status FROM invoices WHERE client_id=?', r.id).status, 'void', 'the unused draft is voided');
  assert.equal(await balance(r.id), 0);

  // An issued invoice with a credit note can't be voided (the credit would stay as phantom account credit).
  const v = w.user('Vic Void', 'client', w.coach.id);
  const { invoice: vd } = await w.ok('POST', '/api/billing/invoices', { as: w.coach, body: { clientId: v.id, lines: [{ description: 'Coaching', quantity: 1, unitPence: 10000 }] } });
  await w.ok('POST', `/api/billing/invoices/${vd.id}/issue`, { as: w.coach, body: {} });
  await w.ok('POST', '/api/billing/credit-notes', { as: w.coach, body: { clientId: v.id, invoiceId: vd.id, amountPence: 3000, reason: 'Goodwill' } });
  assert.equal((await w.call('POST', `/api/billing/invoices/${vd.id}/void`, { as: w.coach, body: {} })).status, 409);
  assert.equal(await balance(v.id), 7000);

  // A schedule's "20% off for 3 months" uses discount_cycles, not the discount's per-client limit (default 1).
  await w.ok('PUT', '/api/billing/settings', { as: w.coach, body: { autoIssueRecurring: true } });
  const { discount: twenty } = await w.ok('POST', '/api/offers/discounts', { as: w.coach, body: { code: 'THREEMONTHS', name: '20% for 3 months', kind: 'percent', value: 2000 } });
  const s = w.user('Sky Schedule', 'client', w.coach.id);
  const realToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  await w.ok('POST', '/api/billing/schedules', { as: w.coach, body: { clientId: s.id, label: 'Monthly', amountPence: 10000, interval: 'month', nextOn: realToday, discountId: twenty.id, discountCycles: 3 } });
  for (const m of [0, 1, 2, 3]) runRecurring(w.db, w.config, londonToUtc(addDays(realToday, m * 31), '12:00'));
  const recurring = w.db.prepare("SELECT discount_pence, status FROM invoices WHERE client_id=? AND source='recurring' ORDER BY source_ref").all(s.id);
  assert.deepEqual(recurring.map(i => i.discount_pence), [2000, 2000, 2000, 0]);
  assert.ok(recurring.every(i => i.status === 'issued'));

  // "First month free" (100%) with auto-issue: settled at £0, and the schedule still moves on.
  const { discount: free } = await w.ok('POST', '/api/offers/discounts', { as: w.coach, body: { code: 'FIRSTFREE', name: 'First month free', kind: 'percent', value: 10000 } });
  const f = w.user('Fay Free', 'client', w.coach.id);
  const { schedule: fs } = await w.ok('POST', '/api/billing/schedules', { as: w.coach, body: { clientId: f.id, label: 'Monthly', amountPence: 9900, interval: 'month', nextOn: realToday, discountId: free.id, discountCycles: 1 } });
  runRecurring(w.db, w.config, londonToUtc(realToday, '12:00'));
  const zero = one("SELECT * FROM invoices WHERE client_id=? AND source='recurring'", f.id);
  assert.deepEqual([zero.status, zero.total_pence], ['paid', 0]);
  assert.ok(one('SELECT next_on FROM billing_schedules WHERE id=?', fs.id).next_on > realToday, 'the schedule moved on');
  assert.equal(count("SELECT COUNT(*) n FROM messages WHERE client_id=? AND from_role='coach'", f.id), 0, 'nothing to pay, nothing sent');
  await w.ok('PUT', '/api/billing/settings', { as: w.coach, body: { autoIssueRecurring: false } });

  // A campaign's per-enrolment discount, promised in the invitation, is what the invoice bills.
  const { emit } = await import('../events.mjs');
  const e = w.user('Ezra Enrol', 'client', w.coach.id);
  emit(w.db, 'campaign.enrolled', { coachId: w.coach.id, clientId: e.id, summary: 'Joined', enrolmentId: 'ce_disc', feePence: 4900, discountPence: 900, invoice: true, campaignName: 'Spring' });
  await w.settle();
  const camp = one("SELECT * FROM invoices WHERE client_id=? AND source='campaign'", e.id);
  assert.equal(camp.total_pence, 4000);
  assert.match(one('SELECT description FROM invoice_lines WHERE invoice_id=?', camp.id).description, /less £9 discount/);
});

test('a moved session re-arms its reminders', async () => {
  const { sendReminders } = await import('../features/calsync.mjs');
  const c = w.user('Remi Move', 'client', w.coach.id);
  w.db.prepare('UPDATE users SET is_demo=0, notifications_on=1 WHERE id=?').run(c.id);
  const start = new Date(Date.now() + 20 * 3_600_000);
  start.setUTCMinutes(0, 0, 0);
  const id = `bk_remi${Date.now()}`;
  w.db.prepare("INSERT INTO bookings (id, coach_id, client_id, kind, title, start, end, created_at, uses_credit) VALUES (?,?,?,'inperson','1:1',?,?,?,0)")
    .run(id, w.coach.id, c.id, start.toISOString(), new Date(start.getTime() + 3_600_000).toISOString(), new Date(Date.now() - 3 * 86_400_000).toISOString());
  assert.equal(count('SELECT COUNT(*) n FROM booking_reminders WHERE booking_id=?', id), 0);
  sendReminders(w.db, w.config, new Date());
  assert.equal(count('SELECT COUNT(*) n FROM booking_reminders WHERE booking_id=? AND hours=24', id), 1);
  const later = new Date(start.getTime() + 3 * 86_400_000);
  const { emit } = await import('../events.mjs');
  w.db.prepare('UPDATE bookings SET start=?, end=? WHERE id=?').run(later.toISOString(), new Date(later.getTime() + 3_600_000).toISOString(), id);
  emit(w.db, 'booking.rescheduled', { coachId: w.coach.id, clientId: c.id, summary: 'Moved', bookingId: id, from: start.toISOString(), to: later.toISOString(), byRole: 'coach' });
  await w.settle();
  assert.equal(count('SELECT COUNT(*) n FROM booking_reminders WHERE booking_id=?', id), 0, 'the old reminders are forgotten');
  sendReminders(w.db, w.config, new Date(later.getTime() - 23 * 3_600_000));
  assert.equal(count('SELECT COUNT(*) n FROM booking_reminders WHERE booking_id=? AND hours=24', id), 1, 'the 24 h reminder fires for the new time');
});
