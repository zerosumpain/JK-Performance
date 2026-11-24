/**
 * F13 Bespoke campaigns (docs/design/desk-v2.md, WP4): design saving, the
 * invite → accept flow and its billing event, capacity and the waitlist, pace,
 * pause and end of coaching, the daily nudge through the outreach governor,
 * completion, isolation, export and erasure. Dates come from fakeToday(), so
 * the suite runs on any day (FAKE_TODAY=monday|sunday|YYYY-MM-DD).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { assertNoRowsFor, fakeToday, makeWorld } from './helpers.mjs';
import { emit } from '../events.mjs';
import { setCoachPref } from '../store.mjs';
import { addDays, londonDay, londonToUtc } from '../time.mjs';
import { buildDemo } from '../demo.mjs';
import { runAction } from '../facts.mjs';
import { clientFacts } from '../facts.mjs';
import { render } from '../templating.mjs';

const { today, now } = fakeToday();
const daysFromFake = d => Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
const at = (path, when = now) => `${path}${path.includes('?') ? '&' : '?'}at=${encodeURIComponent(when.toISOString())}`;

let w, coach2, other, priya, rory;
before(async () => {
  w = await makeWorld();
  coach2 = await w.signIn('wp4-coach2', 'coach2@example.com', { givenName: 'Other', familyName: 'Coach' });
  other = w.user('Olive Other', 'client', coach2.id);
  priya = w.user('Priya Shah', 'client', w.coach.id);
  rory = w.user('Rory Kane', 'client', w.coach.id);
  setCoachPref(w.db, w.coach.id, 'outreach.quietHours', 'off');
});
after(() => w.close());

const rows = (sql, ...a) => w.db.prepare(sql).all(...a);
const one = (sql, ...a) => w.db.prepare(sql).get(...a);
const events = type => rows('SELECT * FROM events WHERE type=? ORDER BY seq', type).map(e => ({ ...e, payload: JSON.parse(e.payload) }));

/** A campaign from a hand-written design, made live. */
async function campaign({ name = 'Test campaign', startMode = 'fixed', startOffset = 0, lengthDays = 14, feePence = 0, capacity = null, waitlist = true,
  activities = null, kit = [], settings = {}, live = true, as = w.coach, completionText = '' } = {}) {
  const { campaign: c } = await w.ok('POST', '/api/campaigns', { as, body: { name } });
  const acts = activities ?? Array.from({ length: lengthDays }, (_, d) => ({ day: d, title: `Day ${d + 1} task`, kind: 'task', points: 10 }));
  await w.ok('PUT', `/api/campaigns/${c.id}`, { as, body: {
    campaign: { startMode, startsOn: startMode === 'fixed' ? addDays(today, startOffset) : null, lengthDays, feePence, capacity, waitlist, settings, completionText },
    phases: [{ key: 'p1', name: 'One', startDay: 0, endDay: Math.floor(lengthDays / 2) - 1 }, { key: 'p2', name: 'Two', startDay: Math.floor(lengthDays / 2), endDay: lengthDays - 1, color: 'chart-3' }],
    activities: acts.map(a => ({ phaseId: a.day < lengthDays / 2 ? 'p1' : 'p2', ...a })),
    kit,
  } });
  if (live) await w.ok('POST', `/api/campaigns/${c.id}/status`, { as, body: { status: 'live' } });
  return (await w.ok('GET', `/api/campaigns/${c.id}`, { as })).campaign;
}
const enrolmentOf = (cid, clientId) => one('SELECT * FROM campaign_enrolments WHERE campaign_id=? AND client_id=?', cid, clientId);
const inPerson = (c, ids, extra = {}, when = now) => w.ok('POST', at(`/api/campaigns/${c.id}/enrol`, when), { as: w.coach, body: { clientIds: ids, mode: 'inPerson', ...extra } });
/** Noon London on a day relative to today (enrolling on a fixed campaign's first day). */
const noon = offset => londonToUtc(addDays(today, offset), '12:00');
const invite = (c, ids, extra = {}) => w.ok('POST', at(`/api/campaigns/${c.id}/enrol`), { as: w.coach, body: { clientIds: ids, mode: 'invite', ...extra } });

describe('design', () => {
  test('templates pre-fill phases and activities', async () => {
    const { campaign: c } = await w.ok('POST', '/api/campaigns', { as: w.coach, body: { name: 'Marathon', template: 'event12' } });
    const d = await w.ok('GET', `/api/campaigns/${c.id}`, { as: w.coach });
    assert.equal(d.campaign.lengthDays, 84);
    assert.equal(d.phases.length, 4);
    assert.ok(d.activities.length >= 40);
    assert.equal(d.kit.length, 3);
    assert.equal(d.campaign.status, 'draft');
  });

  test('saving the design document is idempotent and preserves ids', async () => {
    const c = await campaign({ live: false, kit: [{ name: 'Shoes', estPence: 12000, required: true, url: 'https://example.com/shoes' }] });
    const first = await w.ok('GET', `/api/campaigns/${c.id}`, { as: w.coach });
    const again = await w.ok('PUT', `/api/campaigns/${c.id}`, { as: w.coach, body: first });
    const third = await w.ok('PUT', `/api/campaigns/${c.id}`, { as: w.coach, body: again });
    const strip = d => ({ ...d, campaign: { ...d.campaign, updatedAt: null } });
    assert.deepEqual(strip(third), strip(first));
    assert.deepEqual(third.activities.map(a => a.id), first.activities.map(a => a.id));
    assert.deepEqual(third.phases.map(p => p.id), first.phases.map(p => p.id));
    assert.equal(third.kit[0].id, first.kit[0].id);
    // A new phase and an activity that refers to it by key.
    const next = await w.ok('PUT', `/api/campaigns/${c.id}`, { as: w.coach, body: { phases: [...third.phases, { key: 'k9', name: 'Bonus', startDay: 0, endDay: 3 }],
      activities: [...third.activities, { phaseId: 'k9', day: 1, title: 'Bonus task', kind: 'custom' }] } });
    const bonus = next.phases.find(p => p.name === 'Bonus');
    assert.equal(next.activities.find(a => a.title === 'Bonus task').phaseId, bonus.id);
  });

  test('bad documents are refused, naming the field', async () => {
    const c = await campaign({ live: false });
    const d = await w.ok('GET', `/api/campaigns/${c.id}`, { as: w.coach });
    let r = await w.call('PUT', `/api/campaigns/${c.id}`, { as: w.coach, body: { activities: [{ day: 99, title: 'x', kind: 'task' }] } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /activities\[0\]\.day/);
    r = await w.call('PUT', `/api/campaigns/${c.id}`, { as: w.coach, body: { kit: [{ name: 'Link', url: 'http://example.com' }] } });
    assert.match(r.body.error, /https/);
    r = await w.call('PUT', `/api/campaigns/${c.id}`, { as: w.coach, body: { activities: [{ ...d.activities[0], id: 'ca_notmine' }] } });
    assert.equal(r.status, 400);
    r = await w.call('PUT', `/api/campaigns/${c.id}`, { as: w.coach, body: { activities: [{ day: 0, title: 'x', kind: 'nope' }] } });
    assert.equal(r.status, 400);
  });

  test('deleting an activity with progress archives it; one without is deleted', async () => {
    const c = await campaign({ startOffset: -2 });
    await inPerson(c, [priya.id]);
    const e = enrolmentOf(c.id, priya.id);
    const d = await w.ok('GET', `/api/campaigns/${c.id}`, { as: w.coach });
    const ticked = d.activities.find(a => a.day === 0), untouched = d.activities.find(a => a.day === 5);
    await w.ok('POST', at(`/api/campaigns/mine/${e.id}/items/${ticked.id}`), { as: priya, body: { done: true } });
    const saved = await w.ok('PUT', `/api/campaigns/${c.id}`, { as: w.coach, body: { activities: d.activities.filter(a => a.id !== ticked.id && a.id !== untouched.id) } });
    assert.ok(!saved.activities.some(a => a.id === ticked.id));
    assert.equal(one('SELECT archived FROM campaign_activities WHERE id=?', ticked.id).archived, 1);
    assert.equal(one('SELECT 1 x FROM campaign_activities WHERE id=?', untouched.id), undefined);
    // Past progress stays, and its points still count.
    assert.equal(enrolmentOf(c.id, priya.id).points, 10);
  });

  test('going live needs an activity; delete only drafts or campaigns nobody joined', async () => {
    const { campaign: empty } = await w.ok('POST', '/api/campaigns', { as: w.coach, body: { name: 'Empty' } });
    await w.ok('PUT', `/api/campaigns/${empty.id}`, { as: w.coach, body: { campaign: { startsOn: today }, activities: [] } });
    assert.equal((await w.call('POST', `/api/campaigns/${empty.id}/status`, { as: w.coach, body: { status: 'live' } })).status, 409);
    const c = await campaign();
    await invite(c, [rory.id]);
    assert.equal((await w.call('DELETE', `/api/campaigns/${c.id}`, { as: w.coach })).status, 409);
    const copy = await w.ok('POST', `/api/campaigns/${c.id}/duplicate`, { as: w.coach });
    assert.equal(copy.campaign.status, 'draft');
    assert.equal((await w.ok('GET', `/api/campaigns/${copy.campaign.id}`, { as: w.coach })).activities.length, 14);
    await w.ok('DELETE', `/api/campaigns/${copy.campaign.id}`, { as: w.coach });
    await w.ok('DELETE', `/api/campaigns/${empty.id}`, { as: w.coach });
  });
});

describe('invite, accept, decline', () => {
  test('invite creates no invoice event and no nudge; accept emits campaign.enrolled with the fee and code; decline nothing billable', async () => {
    const c = await campaign({ name: 'Paid', feePence: 4900, settings: { nudgeAt: '09:00' } });
    const before = events('campaign.enrolled').length;
    const out = await invite(c, [w.client.id, rory.id], { discountCode: 'spring10', discountPence: 490 });
    assert.deepEqual(out, { invited: 2, enrolled: 0, waitlisted: 0, skipped: [] });
    await w.settle();
    assert.equal(events('campaign.enrolled').length, before);
    assert.equal(events('campaign.invited').filter(e => e.payload.campaignId === c.id).length, 2);
    await w.tick('campaigns.tick', londonToUtc(today, '09:30'));
    assert.equal(rows('SELECT * FROM campaign_nudges n JOIN campaign_enrolments e ON e.id=n.enrolment_id WHERE e.campaign_id=?', c.id).length, 0);
    // The client sees the invitation with its money in it.
    const mine = await w.ok('GET', '/api/campaigns/mine', { as: w.client });
    const inv = mine.invitations.find(i => i.campaign.id === c.id);
    assert.equal(inv.feePence, 4900);
    assert.equal(inv.discountPence, 490);
    await w.ok('POST', at(`/api/campaigns/mine/${inv.enrolmentId}/accept`), { as: w.client, body: {} });
    const enrolled = events('campaign.enrolled').at(-1);
    assert.equal(enrolled.payload.enrolmentId, inv.enrolmentId);
    assert.equal(enrolled.payload.feePence, 4900);
    assert.equal(enrolled.payload.invoice, true);
    assert.equal(enrolled.payload.discountCode, 'SPRING10');
    assert.equal(enrolled.payload.campaignName, 'Paid');
    assert.equal(enrolmentOf(c.id, w.client.id).accepted_via, 'app');
    // A second answer is refused.
    assert.equal((await w.call('POST', at(`/api/campaigns/mine/${inv.enrolmentId}/accept`), { as: w.client, body: {} })).status, 409);
    // Decline: no enrolled event.
    const roryInv = (await w.ok('GET', '/api/campaigns/mine', { as: rory })).invitations.find(i => i.campaign.id === c.id);
    const n = events('campaign.enrolled').length;
    await w.ok('POST', `/api/campaigns/mine/${roryInv.enrolmentId}/decline`, { as: rory, body: {} });
    assert.equal(events('campaign.enrolled').length, n);
    assert.equal(enrolmentOf(c.id, rory.id).status, 'declined');
    assert.equal(events('campaign.declined').at(-1).payload.enrolmentId, roryInv.enrolmentId);
  });

  test('"Agreed in person" enrols at once and records accepted_via=inPerson', async () => {
    const c = await campaign({ feePence: 2500 });
    const out = await inPerson(c, [priya.id]);
    assert.equal(out.enrolled, 1);
    const e = enrolmentOf(c.id, priya.id);
    assert.equal(e.status, 'active');
    assert.equal(e.accepted_via, 'inPerson');
    assert.ok(events('campaign.enrolled').some(x => x.payload.enrolmentId === e.id));
  });

  test('the invitation text states dates, fee, required kit spend and the optional kit total', async () => {
    const c = await campaign({ feePence: 4900, kit: [{ name: 'Shoes', estPence: 12000, required: true }, { name: 'Gels', estPence: 2500, required: true }, { name: 'Belt', estPence: 1500 }, { name: 'Roller', estPence: 2000 }] });
    await invite(c, [priya.id], { discountCode: 'TEN', discountPence: 490 });
    const msg = one("SELECT * FROM messages WHERE client_id=? AND via='coachAction' ORDER BY at DESC LIMIT 1", priya.id);
    assert.match(msg.text, /Dates: \w{3} \d+ \w{3} to \w{3} \d+ \w{3} \(2 weeks\)/);
    assert.match(msg.text, /Fee: £44\.10 \(£49 less TEN\)/);
    assert.match(msg.text, /Required kit: Shoes £120, Gels £25 \(£145\)/);
    assert.match(msg.text, /Optional kit: £35 in total/);
    assert.match(msg.text, /\/plan\/ce_/);
    const preview = await w.ok('POST', `/api/campaigns/${c.id}/invitation-preview`, { as: w.coach, body: { clientId: priya.id } });
    assert.match(preview.text, /Fee: £49\./);
  });

  test('enrolment start dates in both modes', async () => {
    const fixed = await campaign({ startOffset: 3 });
    await inPerson(fixed, [rory.id]);
    assert.equal(enrolmentOf(fixed.id, rory.id).start_on, addDays(today, 3));
    const rolling = await campaign({ startMode: 'rolling' });
    await invite(rolling, [rory.id, priya.id]);
    const e1 = enrolmentOf(rolling.id, rory.id), e2 = enrolmentOf(rolling.id, priya.id);
    await w.ok('POST', at(`/api/campaigns/mine/${e1.id}/accept`), { as: rory, body: {} });
    assert.equal(enrolmentOf(rolling.id, rory.id).start_on, today);
    await w.ok('POST', at(`/api/campaigns/mine/${e2.id}/accept`), { as: priya, body: { startOn: addDays(today, 7) } });
    assert.equal(enrolmentOf(rolling.id, priya.id).start_on, addDays(today, 7));
    const late = w.user('Past Pat', 'client', w.coach.id);
    await invite(rolling, [late.id]);
    assert.equal((await w.call('POST', at(`/api/campaigns/mine/${enrolmentOf(rolling.id, late.id).id}/accept`), { as: late, body: { startOn: addDays(today, -1) } })).status, 400);
  });
});

describe('capacity', () => {
  test('the accept after the last place gives 409 without a waitlist', async () => {
    const c = await campaign({ capacity: 1, waitlist: false });
    await invite(c, [priya.id, rory.id]);
    await w.ok('POST', at(`/api/campaigns/mine/${enrolmentOf(c.id, priya.id).id}/accept`), { as: priya, body: {} });
    const r = await w.call('POST', at(`/api/campaigns/mine/${enrolmentOf(c.id, rory.id).id}/accept`), { as: rory, body: {} });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'This campaign is full');
    assert.equal(enrolmentOf(c.id, rory.id).status, 'invited');
    // "Agreed in person" into a full campaign without a waitlist is a 409 and writes nothing.
    const third = w.user('Third Person', 'client', w.coach.id);
    assert.equal((await w.call('POST', at(`/api/campaigns/${c.id}/enrol`), { as: w.coach, body: { clientIds: [third.id], mode: 'inPerson' } })).status, 409);
    assert.equal(enrolmentOf(c.id, third.id), undefined);
  });

  test('with a waitlist the late accept is waitlisted, and a freed place invites the oldest waitlisted client', async () => {
    const c = await campaign({ capacity: 1, waitlist: true });
    const late = w.user('Late Larry', 'client', w.coach.id);
    await invite(c, [priya.id, rory.id, late.id]);
    await w.ok('POST', at(`/api/campaigns/mine/${enrolmentOf(c.id, priya.id).id}/accept`), { as: priya, body: {} });
    const r = await w.ok('POST', at(`/api/campaigns/mine/${enrolmentOf(c.id, rory.id).id}/accept`), { as: rory, body: {} });
    assert.equal(r.enrolment.status, 'waitlisted');
    await w.ok('POST', at(`/api/campaigns/mine/${enrolmentOf(c.id, late.id).id}/accept`, new Date(now.getTime() + 60_000)), { as: late, body: {} });
    assert.equal(enrolmentOf(c.id, late.id).status, 'waitlisted');
    const msgs = one('SELECT COUNT(*) n FROM messages WHERE client_id=?', rory.id).n;
    // Priya leaves: Rory (waitlisted first) is invited again, Larry stays waitlisted.
    await w.ok('DELETE', at(`/api/campaigns/${c.id}/enrolments/${enrolmentOf(c.id, priya.id).id}`), { as: w.coach });
    assert.equal(enrolmentOf(c.id, priya.id).status, 'dropped');
    assert.equal(enrolmentOf(c.id, rory.id).status, 'invited');
    assert.equal(enrolmentOf(c.id, late.id).status, 'waitlisted');
    assert.equal(one('SELECT COUNT(*) n FROM messages WHERE client_id=?', rory.id).n, msgs + 1);
    await w.ok('POST', at(`/api/campaigns/mine/${enrolmentOf(c.id, rory.id).id}/accept`), { as: rory, body: {} });
    assert.equal(enrolmentOf(c.id, rory.id).status, 'active');
  });
});

describe('progress', () => {
  test('ticking updates points; spentPence is stored and summed on the board', async () => {
    const c = await campaign({ startOffset: -3, kit: [{ name: 'Shoes', estPence: 12000, required: true }, { name: 'Belt', estPence: 1500 }],
      activities: [{ day: 0, title: 'Buy shoes', kind: 'purchase', spendPence: 0, points: 5 }, { day: 1, title: 'Run', kind: 'workout', points: 20 }, { day: 9, title: 'Later', kind: 'task' }] });
    await inPerson(c, [priya.id]);
    const e = enrolmentOf(c.id, priya.id);
    const d = await w.ok('GET', `/api/campaigns/mine/${e.id}`, { as: priya });
    const buy = d.activities.find(a => a.title === 'Buy shoes'), run = d.activities.find(a => a.title === 'Run'), later = d.activities.find(a => a.title === 'Later');
    let r = await w.ok('POST', at(`/api/campaigns/mine/${e.id}/items/${run.id}`), { as: priya, body: { done: true, note: 'Felt good' } });
    assert.equal(r.points, 20);
    r = await w.ok('POST', at(`/api/campaigns/mine/${e.id}/items/${buy.id}`), { as: priya, body: { done: true, spentPence: 11999 } });
    assert.equal(r.points, 25);
    await w.ok('POST', at(`/api/campaigns/mine/${e.id}/items/${d.kit[1].id}`), { as: priya, body: { done: true, spentPence: 1700 } });
    r = await w.ok('POST', at(`/api/campaigns/mine/${e.id}/items/${run.id}`), { as: priya, body: { done: false } });
    assert.equal(r.points, 5);
    assert.equal((await w.call('POST', at(`/api/campaigns/mine/${e.id}/items/${later.id}`), { as: priya, body: { done: true } })).status, 409);
    const board = await w.ok('GET', at(`/api/campaigns/${c.id}/board`), { as: w.coach });
    const row = board.clients.find(x => x.client.id === priya.id);
    assert.equal(row.spentPence, 11999 + 1700);
    assert.equal(row.expectedSpendPence, 12000);
    assert.equal(board.totals.spentPence, 13699);
    assert.equal(row.points, 5);
    await w.settle();
    assert.ok(events('campaign.activityDone').some(x => x.payload.itemId === buy.id));
  });

  test('pace and behind', async () => {
    const c = await campaign({ startOffset: -9 });
    await inPerson(c, [rory.id], {}, noon(-9));
    const e = enrolmentOf(c.id, rory.id);
    const acts = (await w.ok('GET', `/api/campaigns/${c.id}`, { as: w.coach })).activities;
    for (const a of acts.filter(x => x.day < 5)) await w.ok('POST', at(`/api/campaigns/mine/${e.id}/items/${a.id}`), { as: rory, body: { done: true } });
    let row = (await w.ok('GET', at(`/api/campaigns/${c.id}/board`), { as: w.coach })).clients.find(x => x.client.id === rory.id);
    assert.equal(row.pace, 50); // 5 of the 10 due by day 10
    assert.equal(row.behind, true);
    for (const a of acts.filter(x => x.day >= 5 && x.day < 8)) await w.ok('POST', at(`/api/campaigns/mine/${e.id}/items/${a.id}`), { as: rory, body: { done: true } });
    row = (await w.ok('GET', at(`/api/campaigns/${c.id}/board`), { as: w.coach })).clients.find(x => x.client.id === rory.id);
    assert.equal(row.pace, 80);
    assert.equal(row.behind, false);
    // The behind clock flags a crossing once, and the needs hook waits three days.
    await w.ok('POST', at(`/api/campaigns/mine/${e.id}/items/${acts[7].id}`), { as: rory, body: { done: false } });
    await w.ok('POST', at(`/api/campaigns/mine/${e.id}/items/${acts[6].id}`), { as: rory, body: { done: false } });
    await w.tick('campaigns.tick', londonToUtc(today, '06:00'));
    await w.tick('campaigns.tick', londonToUtc(today, '06:05'));
    assert.equal(events('campaign.behind').filter(x => x.payload.enrolmentId === e.id).length, 1);
    // GET /api/coach/needs-you reads the wall clock, so this part is dated from the real day.
    w.db.prepare('UPDATE campaign_enrolments SET behind_since=? WHERE id=?').run(addDays(londonDay(), -4), e.id);
    w.db.prepare('UPDATE campaign_enrolments SET start_on=?, enrolled_at=? WHERE id=?').run(addDays(londonDay(), -9), londonToUtc(addDays(londonDay(), -9), '12:00').toISOString(), e.id);
    const needs = await w.ok('GET', '/api/coach/needs-you', { as: w.coach });
    const item = needs.items.find(i => i.client.id === rory.id);
    assert.ok(item.reasons.some(r => /Behind on Test campaign \(pace \d+%\)/.test(r.text) && r.action.path === `/campaigns/${c.id}/board`));
    const facts = clientFacts(w.db, w.coach.id, [rory.id], { only: ['campaign.pace', 'campaign.active'], today });
    assert.ok(facts.get(rory.id)['campaign.pace'] < 70);
    assert.ok(facts.get(rory.id)['campaign.active'].includes(c.id));
  });

  test('pause freezes pace and nudges; resume shifts the dates by the paused days', async () => {
    const c = await campaign({ startOffset: -2, settings: { nudgeAt: '06:00' } });
    const paul = w.user('Paul Pause', 'client', w.coach.id);
    await inPerson(c, [paul.id]);
    const e = enrolmentOf(c.id, paul.id);
    const endBefore = (await w.ok('GET', `/api/coach/clients/${paul.id}/campaigns`, { as: w.coach })).enrolments[0].endsOn;
    emit(w.db, 'client.paused', { coachId: w.coach.id, clientId: paul.id, summary: 'Paused', days: 14 });
    await w.settle();
    assert.equal(enrolmentOf(c.id, paul.id).status, 'paused');
    await w.tick('campaigns.tick', londonToUtc(addDays(today, 1), '08:00'));
    assert.equal(rows('SELECT * FROM campaign_nudges WHERE enrolment_id=?', e.id).length, 0, 'no nudge while paused');
    const frozen = (await w.ok('GET', at(`/api/campaigns/${c.id}/board`, londonToUtc(addDays(today, 5), '12:00')), { as: w.coach })).clients.find(x => x.client.id === paul.id);
    assert.equal(frozen.behind, false, 'a paused client is never behind');
    emit(w.db, 'client.resumed', { coachId: w.coach.id, clientId: paul.id, summary: 'Resumed', pausedDays: 5 });
    await w.settle();
    const after = enrolmentOf(c.id, paul.id);
    assert.equal(after.status, 'active');
    assert.equal(after.paused_days, 5);
    const endAfter = (await w.ok('GET', `/api/coach/clients/${paul.id}/campaigns`, { as: w.coach })).enrolments[0].endsOn;
    assert.equal(endAfter, addDays(endBefore, 5));
  });

  test('client.offboarded drops every open enrolment and invitation, with no fee', async () => {
    const a = await campaign({ feePence: 1000 }), b = await campaign({ feePence: 1000 });
    const olga = w.user('Olga Off', 'client', w.coach.id);
    await inPerson(a, [olga.id], { invoice: false });
    await invite(b, [olga.id]);
    const enrolled = events('campaign.enrolled').length;
    const off = await w.ok('GET', `/api/coach/clients/${olga.id}/campaigns`, { as: w.coach });
    assert.equal(off.enrolments.length, 2);
    emit(w.db, 'client.offboarded', { coachId: w.coach.id, clientId: olga.id, summary: 'Ended', exitReason: 'moved' });
    await w.settle();
    assert.equal(enrolmentOf(a.id, olga.id).status, 'dropped');
    assert.equal(enrolmentOf(b.id, olga.id).status, 'dropped');
    assert.equal(events('campaign.enrolled').length, enrolled);
  });
});

describe('the daily nudge', () => {
  test('fires once per day after nudgeAt', async () => {
    const c = await campaign({ settings: { nudgeAt: '09:00' } });
    const nina = w.user('Nina Nudge', 'client', w.coach.id);
    await inPerson(c, [nina.id]);
    const count = () => one("SELECT COUNT(*) n FROM messages WHERE client_id=? AND via='campaign'", nina.id).n;
    await w.tick('campaigns.tick', londonToUtc(today, '08:55'));
    assert.equal(count(), 0);
    await w.tick('campaigns.tick', londonToUtc(today, '09:05'));
    assert.equal(count(), 1);
    await w.tick('campaigns.tick', londonToUtc(today, '09:10'));
    await w.tick('campaigns.tick', londonToUtc(today, '17:00'));
    assert.equal(count(), 1);
    const msg = one("SELECT text FROM messages WHERE client_id=? AND via='campaign'", nina.id).text;
    assert.match(msg, /^Day 1 of Test campaign: Day 1 task\. Today's plan: https:\/\/jk\.example\.com\/plan\/ce_/);
    await w.tick('campaigns.tick', londonToUtc(addDays(today, 1), '09:05'));
    assert.equal(count(), 2);
    await w.settle();
    assert.ok(events('campaign.activityDue').length >= 2);
    // An ended campaign stops nudging.
    await w.ok('POST', `/api/campaigns/${c.id}/status`, { as: w.coach, body: { status: 'ended' } });
    await w.tick('campaigns.tick', londonToUtc(addDays(today, 2), '09:05'));
    assert.equal(count(), 2);
  });

  test('is deferred by the outreach governor in quiet hours and over the cap, and still recorded once', async () => {
    const quiet = await w.signIn('wp4-quiet-coach', 'coach2@example.com'); // coach2 again: its own prefs
    setCoachPref(w.db, quiet.id, 'outreach.quietHours', { start: '08:00', end: '10:00' });
    const qc = w.user('Quinn Quiet', 'client', quiet.id);
    const c = await campaign({ as: quiet, settings: { nudgeAt: '08:30' } });
    await w.ok('POST', at(`/api/campaigns/${c.id}/enrol`), { as: quiet, body: { clientIds: [qc.id], mode: 'inPerson' } });
    await w.tick('campaigns.tick', londonToUtc(today, '09:00'));
    await w.tick('campaigns.tick', londonToUtc(today, '09:30'));
    assert.equal(one("SELECT COUNT(*) n FROM messages WHERE client_id=? AND via='campaign'", qc.id).n, 0);
    const held = rows("SELECT * FROM deferred_messages WHERE client_id=? AND via='campaign'", qc.id);
    assert.equal(held.length, 1);
    assert.equal(held[0].reason, 'quietHours');
    assert.equal(rows('SELECT * FROM campaign_nudges WHERE enrolment_id=?', enrolmentOf(c.id, qc.id).id).length, 1);
    // Over the daily cap the next day.
    setCoachPref(w.db, quiet.id, 'outreach.quietHours', 'off');
    setCoachPref(w.db, quiet.id, 'outreach.dailyCap', 0);
    await w.tick('campaigns.tick', londonToUtc(addDays(today, 1), '09:00'));
    const capped = rows("SELECT * FROM deferred_messages WHERE client_id=? AND via='campaign' ORDER BY created_at", qc.id);
    assert.equal(capped.length, 2);
    assert.equal(capped[1].reason, 'cap');
    // A paused-outreach client is skipped, and the day is still recorded.
    w.db.prepare("INSERT INTO client_outreach (client_id, coach_id, paused, updated_at) VALUES (?,?,1,?)").run(qc.id, quiet.id, now.toISOString());
    setCoachPref(w.db, quiet.id, 'outreach.dailyCap', 3);
    await w.tick('campaigns.tick', londonToUtc(addDays(today, 2), '09:00'));
    assert.equal(rows('SELECT * FROM campaign_nudges WHERE enrolment_id=?', enrolmentOf(c.id, qc.id).id).length, 3);
    assert.equal(one("SELECT COUNT(*) n FROM messages WHERE client_id=? AND via='campaign'", qc.id).n, 0);
  });
});

describe('the end', () => {
  test('completion, and drop after the grace period', async () => {
    const c = await campaign({ lengthDays: 4, startOffset: -4, completionText: 'Well done!', activities: [{ day: 0, title: 'A', kind: 'task' }, { day: 2, title: 'B', kind: 'task' }, { day: 3, title: 'Optional', kind: 'task', required: false }] });
    const done = w.user('Della Done', 'client', w.coach.id), slack = w.user('Sid Slack', 'client', w.coach.id);
    await inPerson(c, [done.id, slack.id], {}, noon(-4));
    const ed = enrolmentOf(c.id, done.id), es = enrolmentOf(c.id, slack.id);
    const acts = (await w.ok('GET', `/api/campaigns/${c.id}`, { as: w.coach })).activities;
    for (const a of acts.filter(x => x.required)) await w.ok('POST', at(`/api/campaigns/mine/${ed.id}/items/${a.id}`), { as: done, body: { done: true } });
    await w.ok('POST', at(`/api/campaigns/mine/${es.id}/items/${acts[0].id}`), { as: slack, body: { done: true } });
    await w.tick('campaigns.tick', londonToUtc(today, '05:00'));
    assert.equal(enrolmentOf(c.id, done.id).status, 'completed');
    assert.equal(one("SELECT text FROM messages WHERE client_id=? AND via='campaign' ORDER BY at DESC", done.id)?.text, 'Well done!');
    assert.equal(enrolmentOf(c.id, slack.id).status, 'active', 'seven days of grace');
    await w.tick('campaigns.tick', londonToUtc(addDays(today, 7), '05:00'));
    assert.equal(enrolmentOf(c.id, slack.id).status, 'dropped');
    await w.settle();
    assert.ok(events('campaign.completed').some(x => x.payload.enrolmentId === ed.id));
    assert.ok(events('campaign.dropped').some(x => x.payload.enrolmentId === es.id));
  });

  test('an unanswered invitation expires to declined', async () => {
    const c = await campaign({ startMode: 'rolling' });
    const ivy = w.user('Ivy Idle', 'client', w.coach.id);
    await invite(c, [ivy.id]);
    await w.tick('campaigns.tick', londonToUtc(addDays(today, 14), '05:00'));
    assert.equal(enrolmentOf(c.id, ivy.id).status, 'invited');
    await w.tick('campaigns.tick', londonToUtc(addDays(today, 15), '05:00'));
    const e = enrolmentOf(c.id, ivy.id);
    assert.equal(e.status, 'declined');
    assert.equal(e.note, 'Invitation expired');
  });
});

describe('isolation', () => {
  test('client endpoints show only their own enrolments (404 otherwise); a coach gets 403', async () => {
    const c = await campaign();
    await invite(c, [priya.id]);
    const eid = enrolmentOf(c.id, priya.id).id;
    for (const [method, path] of [['GET', `/api/campaigns/mine/${eid}`], ['POST', `/api/campaigns/mine/${eid}/accept`], ['POST', `/api/campaigns/mine/${eid}/decline`], ['POST', `/api/campaigns/mine/${eid}/items/ca_x`]]) {
      const body = method === 'GET' ? undefined : { done: true };
      assert.equal((await w.call(method, path, { as: rory, body })).status, 404, `${method} ${path} as another client`);
      assert.equal((await w.call(method, path, { as: other, body })).status, 404, `${method} ${path} as another coach's client`);
    }
    assert.equal((await w.call('GET', '/api/campaigns/mine', { as: w.coach })).status, 403);
    assert.equal((await w.ok('GET', '/api/campaigns/mine', { as: rory })).invitations.filter(i => i.campaign.id === c.id).length, 0);
  });

  test('every coach route is a 404 across coaches, and a 403 for a client', async () => {
    const c = await campaign();
    await invite(c, [priya.id]);
    const eid = enrolmentOf(c.id, priya.id).id;
    const routes = [
      ['GET', `/api/campaigns/${c.id}`], ['PUT', `/api/campaigns/${c.id}`], ['DELETE', `/api/campaigns/${c.id}`], ['POST', `/api/campaigns/${c.id}/status`],
      ['POST', `/api/campaigns/${c.id}/duplicate`], ['POST', `/api/campaigns/${c.id}/enrol`], ['POST', `/api/campaigns/${c.id}/invitation-preview`],
      ['POST', `/api/campaigns/${c.id}/enrolments/${eid}/resend`], ['DELETE', `/api/campaigns/${c.id}/enrolments/${eid}`], ['GET', `/api/campaigns/${c.id}/board`],
      ['POST', `/api/campaigns/${c.id}/announce`], ['POST', `/api/campaigns/${c.id}/nudge`], ['GET', `/api/coach/clients/${priya.id}/campaigns`],
    ];
    for (const [method, path] of routes) {
      const body = ['GET', 'DELETE'].includes(method) ? undefined : { status: 'live', text: 'hi', clientIds: [priya.id] };
      const r = await w.call(method, path, { as: coach2, body });
      assert.equal(r.status, 404, `${method} ${path} as the other coach → ${r.status}`);
      assert.equal((await w.call(method, path, { as: priya, body })).status, 403, `${method} ${path} as a client`);
    }
    for (const [method, path] of [['GET', '/api/campaigns'], ['POST', '/api/campaigns'], ['GET', '/api/campaigns/ending']]) assert.equal((await w.call(method, path, { as: priya, body: method === 'GET' ? undefined : { name: 'x' } })).status, 403);
    // The other coach's list is empty, and one foreign client in a bulk enrol fails the whole request.
    assert.equal((await w.ok('GET', '/api/campaigns', { as: coach2 })).campaigns.filter(x => x.id === c.id).length, 0);
    const r = await w.call('POST', at(`/api/campaigns/${c.id}/enrol`), { as: w.coach, body: { clientIds: [rory.id, other.id], mode: 'invite' } });
    assert.equal(r.status, 404);
    assert.equal(enrolmentOf(c.id, rory.id), undefined);
  });

  test('a reassigned client leaves the old coach\'s board, lists and nudges', async () => {
    const c = await campaign({ settings: { nudgeAt: '06:00' } });
    const mover = w.user('Max Mover', 'client', w.coach.id);
    await inPerson(c, [mover.id]);
    w.db.prepare('UPDATE users SET coach_id=? WHERE id=?').run(coach2.id, mover.id);
    const board = await w.ok('GET', at(`/api/campaigns/${c.id}/board`), { as: w.coach });
    assert.equal(board.clients.filter(r => r.client?.id === mover.id).length, 0);
    assert.equal((await w.call('GET', `/api/coach/clients/${mover.id}/campaigns`, { as: w.coach })).status, 404);
    assert.deepEqual((await w.ok('GET', `/api/coach/clients/${mover.id}/campaigns`, { as: coach2 })).enrolments, [], 'the new coach does not see the old coach\'s campaign');
    assert.deepEqual((await w.ok('GET', '/api/campaigns/mine', { as: mover })).enrolments, []);
    await w.tick('campaigns.tick', londonToUtc(today, '08:00'));
    assert.equal(one("SELECT COUNT(*) n FROM messages WHERE client_id=? AND via='campaign'", mover.id).n, 0);
  });
});

describe('automations, facts, hooks, export and erasure', () => {
  test('campaign.enrol is always an invitation', async () => {
    const c = await campaign({ feePence: 900 });
    const ari = w.user('Ari Auto', 'client', w.coach.id);
    const enrolled = events('campaign.enrolled').length;
    const outcome = runAction(w.db, w.config, 'campaign.enrol', { coachId: w.coach.id, client: { id: ari.id }, params: { campaignId: c.id }, now, via: 'automation' });
    assert.equal(outcome, 'Invited');
    assert.equal(enrolmentOf(c.id, ari.id).status, 'invited');
    await w.settle();
    assert.equal(events('campaign.enrolled').length, enrolled);
    assert.match(runAction(w.db, w.config, 'campaign.enrol', { coachId: w.coach.id, client: { id: ari.id }, params: { campaignId: c.id }, now }), /Skipped: already invited/);
  });

  test('variables, search, renewals, offboarding and public offers', async () => {
    // Template variables have no `now` (value(db, coachId, client)), so this campaign is dated from the real day.
    const c = await campaign({ name: 'Variable Run', startOffset: daysFromFake(londonDay()) - 1, lengthDays: 10, settings: { nudgeAt: '23:59' } });
    await w.ok('PUT', `/api/campaigns/${c.id}`, { as: w.coach, body: { campaign: { public: true, tagline: 'Ten days' } } });
    const vic = w.user('Vic Vars', 'client', w.coach.id);
    await inPerson(c, [vic.id]);
    const row = w.db.prepare('SELECT * FROM users WHERE id=?').get(vic.id);
    const out = render(w.db, w.coach.id, row, '{campaign} day {campaignDay}: {campaignToday}');
    assert.match(out.text, /^Variable Run day \d+: Day \d+ task$/);
    const search = await w.ok('GET', '/api/search?q=Variable', { as: w.coach });
    assert.ok(search.results.some(r => r.type === 'campaign' && r.id === c.id));
    const ending = await w.ok('GET', at('/api/campaigns/ending?days=30'), { as: w.coach });
    assert.ok(ending.enrolments.some(e => e.client.id === vic.id && e.campaign.id === c.id));
    const { hooks } = await import('../registry.mjs');
    const [[, offboarding]] = hooks('offboarding').filter(([f]) => f.name === 'campaigns');
    assert.equal(offboarding(w.db, w.coach.row ?? { id: w.coach.id }, { id: vic.id }).enrolments.length, 1);
    const [[, offers]] = hooks('publicOffers').filter(([f]) => f.name === 'campaigns');
    assert.ok(offers(w.db, w.coach.id).some(o => o.id === c.id && o.tagline === 'Ten days'));
    assert.equal(offers(w.db, coach2.id).length, 0);
  });

  test('the export carries enrolments, progress and spend; DELETE /api/me leaves no rows', async () => {
    const c = await campaign({ startOffset: -1, kit: [{ name: 'Bottle', estPence: 1000 }] });
    const ella = await w.signIn('wp4-ella', 'ella@example.com', { givenName: 'Ella', familyName: 'Erase' });
    await inPerson(c, [ella.id]);
    const e = enrolmentOf(c.id, ella.id);
    const d = await w.ok('GET', `/api/campaigns/mine/${e.id}`, { as: ella });
    await w.ok('POST', at(`/api/campaigns/mine/${e.id}/items/${d.kit[0].id}`), { as: ella, body: { done: true, spentPence: 999 } });
    const exp = await w.call('GET', '/api/me/export', { as: ella });
    const body = exp.body;
    const mine = body.features.campaigns.enrolments.find(x => x.campaign === 'Test campaign');
    assert.equal(mine.spentPence, 999);
    assert.equal(mine.progress[0].item, 'Bottle');
    await w.ok('DELETE', '/api/me', { as: ella });
    assertNoRowsFor(w.db, ella.id);
    assert.equal(one('SELECT COUNT(*) n FROM campaign_progress WHERE enrolment_id=?', e.id).n, 0);
  });
});

describe('demo', () => {
  test('the demo builds the three campaigns without emitting, and rebuilds cleanly', async () => {
    const before = one('SELECT COUNT(*) n FROM events').n;
    buildDemo(w.db, today, w.config);
    buildDemo(w.db, today, w.config);
    assert.equal(one('SELECT COUNT(*) n FROM events').n, before);
    const demoCoach = one("SELECT id FROM users WHERE apple_sub='demo-coach'");
    const cs = rows('SELECT * FROM campaigns WHERE coach_id=? ORDER BY name', demoCoach.id);
    assert.deepEqual(cs.map(c => [c.name, c.status]), [['12-Week Marathon Build', 'live'], ['January Reset', 'live'], ['Ski-fit 6 weeks', 'ended']]);
    const m = cs[0];
    assert.equal(m.starts_on, addDays(today, -23));
    assert.equal(m.capacity, 6);
    assert.equal(m.fee_pence, 4900);
    assert.ok(one('SELECT COUNT(*) n FROM campaign_activities WHERE campaign_id=?', m.id).n >= 60);
    assert.equal(one('SELECT COUNT(*) n FROM campaign_kit WHERE campaign_id=?', m.id).n, 6);
    const st = Object.fromEntries(rows('SELECT status, COUNT(*) n FROM campaign_enrolments WHERE campaign_id=? GROUP BY status', m.id).map(r => [r.status, r.n]));
    assert.deepEqual(st, { active: 4, declined: 1, invited: 1 });
    assert.equal(one("SELECT COUNT(*) n FROM campaign_enrolments WHERE campaign_id=? AND status='completed'", cs[2].id).n, 2);
    assert.equal(cs[1].public, 1);
    assert.equal(one('SELECT COUNT(*) n FROM coach_guides WHERE coach_id=?', demoCoach.id).n, 6);
    // Spend reported against the kit shows on the board.
    const spent = one('SELECT SUM(p.spent_pence) n FROM campaign_progress p JOIN campaign_enrolments e ON e.id=p.enrolment_id WHERE e.campaign_id=?', m.id).n;
    assert.ok(spent > 30000);
  });
});
