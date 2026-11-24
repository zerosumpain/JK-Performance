/**
 * The public plan page (docs/design/desk-v2.md F13, F14 and 6.5): a valid
 * token shows today's activities and a full guide; a tampered, expired or
 * dropped-enrolment token is a 404; Accept by form works once; the headers
 * (CSP, no-referrer, noindex, no-store) are there; first names only.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { fakeToday, makeWorld } from './helpers.mjs';
import { planLink } from '../features/campaigns.mjs';
import { signPlan } from '../features/guidebook.mjs';
import { resetLimits } from '../ratelimit.mjs';
import { addDays } from '../time.mjs';

const { today, now } = fakeToday();
const atQ = (when = now) => `at=${encodeURIComponent(when.toISOString())}`;
let w, campaignId, guideId, mediaId, otherMedia;
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(48, 3)]);

/** A raw request: no redirect following, text body. */
async function page(method, path, { form = null } = {}) {
  const res = await fetch(w.base + path, {
    method, redirect: 'manual',
    headers: form ? { 'content-type': 'application/x-www-form-urlencoded' } : {},
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}
const pathOf = link => new URL(link).pathname;
const csrfOf = html => /name="csrf" value="([^"]+)"/.exec(html)?.[1];

before(async () => {
  w = await makeWorld();
  mediaId = (await w.ok('POST', '/api/media?purpose=other', { as: w.coach, raw: jpeg, headers: { 'content-type': 'image/jpeg' } })).id;
  otherMedia = (await w.ok('POST', '/api/media?purpose=other', { as: w.coach, raw: jpeg, headers: { 'content-type': 'image/jpeg' } })).id;
  const g = await w.ok('POST', '/api/guidebook', { as: w.coach, body: { title: 'Fuel the long run', status: 'published', blocks: [
    { t: 'h', text: 'Fuel the long run' }, { t: 'p', text: 'Eat **30–60 g** of carbs per hour. <script>alert(1)</script>' },
    { t: 'list', style: 'check', items: ['Gel at 45 min'] }, { t: 'image', mediaId, caption: 'Gels' }, { t: 'link', url: 'https://example.com/shop', label: 'Shop' }] } });
  guideId = g.guide.id;
  const { campaign } = await w.ok('POST', '/api/campaigns', { as: w.coach, body: { name: 'Marathon Build' } });
  campaignId = campaign.id;
  await w.ok('PUT', `/api/campaigns/${campaignId}`, { as: w.coach, body: {
    campaign: { startsOn: today, lengthDays: 14, feePence: 4900, tagline: 'Race ready' },
    phases: [{ key: 'b', name: 'Base', startDay: 0, endDay: 13, guideId }],
    activities: [{ phaseId: 'b', day: 0, title: 'Easy run 6 km', kind: 'workout', guideId }, { phaseId: 'b', day: 1, title: 'Intervals', kind: 'workout' }],
    kit: [{ name: 'Running shoes', estPence: 12000, required: true, url: 'https://example.com/shoes' }, { name: 'Belt', estPence: 1500 }],
  } });
  await w.ok('POST', `/api/campaigns/${campaignId}/status`, { as: w.coach, body: { status: 'live' } });
});
after(() => w.close());

const enrolment = clientId => w.db.prepare('SELECT * FROM campaign_enrolments WHERE campaign_id=? AND client_id=?').get(campaignId, clientId);

describe('the plan page', () => {
  test('an invitation shows the money, and Accept by form works once', async () => {
    resetLimits();
    await w.ok('POST', `/api/campaigns/${campaignId}/enrol?${atQ()}`, { as: w.coach, body: { clientIds: [w.client.id], mode: 'invite' } });
    const e = enrolment(w.client.id);
    const link = planLink(w.config, e.id, now);
    const r = await page('GET', `${pathOf(link)}?${atQ()}`);
    assert.equal(r.status, 200);
    assert.match(r.text, /Marathon Build/);
    assert.match(r.text, /£49/);
    assert.match(r.text, /Running shoes/);
    assert.match(r.text, /Not this time/);
    assert.match(r.text, /Hi Sam\./);
    assert.doesNotMatch(r.text, /Carter/, 'first names only');
    // The headers of a private page.
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+'; img-src 'self'; media-src 'self'; form-action 'self'/);
    assert.doesNotMatch(r.headers.get('content-security-policy'), /unsafe/);
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.match(r.headers.get('x-robots-tag'), /noindex/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    // A bad CSRF field changes nothing.
    assert.equal((await page('POST', `${pathOf(link)}?${atQ()}`, { form: { csrf: 'nope', action: 'accept' } })).status, 403);
    assert.equal(enrolment(w.client.id).status, 'invited');
    const ok = await page('POST', `${pathOf(link)}?${atQ()}`, { form: { csrf: csrfOf(r.text), action: 'accept' } });
    assert.equal(ok.status, 303);
    assert.match(ok.headers.get('location'), /\?done=accepted$/);
    const after = enrolment(w.client.id);
    assert.equal(after.status, 'active');
    assert.equal(after.accepted_via, 'plan');
    await w.settle();
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM events WHERE type='campaign.enrolled'").get().n, 1);
    const again = await page('POST', `${pathOf(link)}?${atQ()}`, { form: { csrf: csrfOf(r.text), action: 'accept' } });
    assert.equal(again.status, 409);
    assert.match(again.text, /already answered/);
    await w.settle();
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM events WHERE type='campaign.enrolled'").get().n, 1, 'accepted once');
  });

  test('a valid token shows today\'s activities and the full guide, escaped', async () => {
    const e = enrolment(w.client.id);
    const r = await page('GET', `${pathOf(planLink(w.config, e.id, now))}?${atQ()}`);
    assert.equal(r.status, 200);
    assert.match(r.text, /<h2>Today<\/h2>/);
    assert.match(r.text, /Easy run 6 km/);
    assert.match(r.text, /Next three days/);
    assert.match(r.text, /Intervals/);
    assert.match(r.text, /Eat <strong>30–60 g<\/strong> of carbs per hour\. &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(r.text, /<script>/);
    assert.match(r.text, /<a href="https:\/\/example\.com\/shop" rel="noopener noreferrer" target="_blank">/);
    assert.match(r.text, new RegExp(`<img src="/plan/[^"]+/media/${mediaId}"`));
  });

  test('media only through a guide the token opens', async () => {
    const token = pathOf(planLink(w.config, enrolment(w.client.id).id, now)).split('/')[2];
    const img = await fetch(`${w.base}/plan/${token}/media/${mediaId}?${atQ()}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.equal((await page('GET', `/plan/${token}/media/${otherMedia}?${atQ()}`)).status, 404);
  });

  test('a tampered, expired or dropped-enrolment token is a 404', async () => {
    const e = enrolment(w.client.id);
    const good = pathOf(planLink(w.config, e.id, now));
    const tampered = good.replace(/.$/, c => (c === 'A' ? 'B' : 'A'));
    assert.equal((await page('GET', `${tampered}?${atQ()}`)).status, 404);
    const forged = `/plan/${e.id}.${Math.floor(now.getTime() / 1000) + 9e6}.${good.split('.').at(-1)}`;
    assert.equal((await page('GET', `${forged}?${atQ()}`)).status, 404);
    const late = new Date(now.getTime() + 46 * 86_400_000);
    assert.equal((await page('GET', `${good}?${atQ(late)}`)).status, 404, 'expired after 45 days');
    assert.equal((await page('GET', '/plan/garbage')).status, 404);
    const r404 = await page('GET', `${tampered}?${atQ()}`);
    assert.match(r404.headers.get('x-robots-tag'), /noindex/);
    // Dropped: the same good link stops working.
    await w.ok('DELETE', `/api/campaigns/${campaignId}/enrolments/${e.id}?${atQ()}`, { as: w.coach });
    assert.equal((await page('GET', `${good}?${atQ()}`)).status, 404);
  });

  test('decline by form, and an erased client\'s link is gone', async () => {
    resetLimits();
    const dee = await w.signIn('plan-dee', 'dee@example.com', { givenName: 'Dee', familyName: 'Decline' });
    await w.ok('POST', `/api/campaigns/${campaignId}/enrol?${atQ()}`, { as: w.coach, body: { clientIds: [dee.id], mode: 'invite' } });
    const link = pathOf(planLink(w.config, enrolment(dee.id).id, now));
    const r = await page('GET', `${link}?${atQ()}`);
    const out = await page('POST', `${link}?${atQ()}`, { form: { csrf: csrfOf(r.text), action: 'decline' } });
    assert.equal(out.status, 303);
    assert.equal(enrolment(dee.id).status, 'declined');
    assert.match((await page('GET', `${link}?${atQ()}`)).text, /not this time/);
    await w.ok('DELETE', '/api/me', { as: dee });
    assert.equal((await page('GET', `${link}?${atQ()}`)).status, 404);
  });

  test('ten posts per token per hour', async () => {
    resetLimits();
    const tia = w.user('Tia Tries', 'client', w.coach.id);
    await w.ok('POST', `/api/campaigns/${campaignId}/enrol?${atQ()}`, { as: w.coach, body: { clientIds: [tia.id], mode: 'invite' } });
    const link = pathOf(planLink(w.config, enrolment(tia.id).id, now));
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await page('POST', `${link}?${atQ()}`, { form: { csrf: 'bad', action: 'accept' } })).status);
    assert.deepEqual(statuses, [...Array(10).fill(403), 429]);
  });
});

describe('a shared guide', () => {
  test('the guide link opens the guide in full; a token for another guide or client does not', async () => {
    const out = await w.ok('POST', `/api/guidebook/${guideId}/send`, { as: w.coach, body: { clientId: w.client.id } });
    const r = await page('GET', pathOf(out.link));
    assert.equal(r.status, 200);
    assert.match(r.text, /Fuel the long run/);
    assert.match(r.text, /For Sam\./);
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
    const other = await w.ok('POST', '/api/guidebook', { as: w.coach, body: { title: 'Other', status: 'published' } });
    const token = pathOf(out.link).split('/')[2];
    assert.equal((await page('GET', `/plan/${token}/guide/${other.guide.id}`)).status, 404);
    // Through the guide token, only that guide's media.
    assert.equal((await fetch(`${w.base}/plan/${token}/media/${mediaId}`)).status, 200);
    assert.equal((await page('GET', `/plan/${token}/media/${otherMedia}`)).status, 404);
    // A forged subject (another client) fails the signature.
    const forged = token.replace(/^u_[^~]+/, 'u_someoneelse');
    assert.equal((await page('GET', `/plan/${forged}/guide/${guideId}`)).status, 404);
    // Unpublished: the link stops working.
    await w.ok('PUT', `/api/guidebook/${guideId}`, { as: w.coach, body: { status: 'draft' } });
    assert.equal((await page('GET', pathOf(out.link))).status, 404);
    await w.ok('PUT', `/api/guidebook/${guideId}`, { as: w.coach, body: { status: 'published' } });
    assert.equal(signPlan(w.config, `${w.client.id}~${guideId}`, now).split('.').length, 3);
  });
});

test('a completed enrolment stays readable for 30 days, then 404', async () => {
  const cara = w.user('Cara Complete', 'client', w.coach.id);
  await w.ok('POST', `/api/campaigns/${campaignId}/enrol?${atQ()}`, { as: w.coach, body: { clientIds: [cara.id], mode: 'inPerson' } });
  const e = enrolment(cara.id);
  w.db.prepare("UPDATE campaign_enrolments SET status='completed', completed_at=? WHERE id=?").run(now.toISOString(), e.id);
  const link = pathOf(planLink(w.config, e.id, now));
  assert.equal((await page('GET', `${link}?${atQ(new Date(now.getTime() + 20 * 86_400_000))}`)).status, 200);
  assert.equal((await page('GET', `${link}?${atQ(new Date(now.getTime() + 31 * 86_400_000))}`)).status, 404);
  assert.ok(addDays(today, 1) > today);
});
