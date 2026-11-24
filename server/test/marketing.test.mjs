/**
 * F28 Marketing: sources, follow-ups, testimonials and offer pages
 * (docs/design/desk-v2.md F28, WP11).
 *
 * Runs with a FEATURES_DIR of its own: the real leads and marketing features
 * (re-exported), plus two small fixtures standing in for WP4's publicOffers
 * hook and WP3's billing.ltv fact, so the maths and the campaign rules are
 * tested whether or not those packages are merged.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const mod = p => pathToFileURL(new URL(`../${p}`, import.meta.url).pathname).href;
const DIR = mkdtempSync(join(tmpdir(), 'jk-wp11-features-'));
writeFileSync(join(DIR, 'leads.mjs'), `export { feature } from '${mod('features/leads.mjs')}';\n`);
writeFileSync(join(DIR, 'marketing.mjs'), `export { feature } from '${mod('features/marketing.mjs')}';\n`);
writeFileSync(join(DIR, 'campaigns.mjs'), `
export const feature = {
  name: 'campaigns', namespaces: ['campaign'],
  schema(db) { db.exec('CREATE TABLE IF NOT EXISTS fx_campaigns (id TEXT PRIMARY KEY, coach_id TEXT, name TEXT, status TEXT, public INTEGER, starts_on TEXT, ends_on TEXT, tagline TEXT, fee_pence INTEGER)'); },
  publicOffers(db, coachId) {
    return db.prepare("SELECT * FROM fx_campaigns WHERE coach_id=? AND status='live' AND public=1").all(coachId)
      .map(c => ({ id: c.id, name: c.name, tagline: c.tagline, startsOn: c.starts_on, endsOn: c.ends_on, lengthDays: 30, feePence: c.fee_pence, placesLeft: 4 }));
  },
};
`);
writeFileSync(join(DIR, 'billing.mjs'), `
export const feature = {
  name: 'billing', namespaces: ['billing'],
  schema(db) { db.exec('CREATE TABLE IF NOT EXISTS fx_ltv (client_id TEXT PRIMARY KEY, pence INTEGER)'); },
  facts: { 'billing.ltv': { label: 'LTV', type: 'money', compute(db, _coachId, ids) {
    const out = {}; for (const id of ids) { const r = db.prepare('SELECT pence FROM fx_ltv WHERE client_id=?').get(id); if (r) out[id] = r.pence; } return out; } } },
};
`);
process.env.NODE_ENV = 'test';
process.env.FEATURES_DIR = DIR;

const { makeWorld, assertNoRowsFor, fakeToday } = await import('./helpers.mjs');
const { FEATURES } = await import('../registry.mjs');
const { emit, eventsFor } = await import('../events.mjs');
const { buildDemo } = await import('../demo.mjs');
const { addDays, londonDay, londonToUtc } = await import('../time.mjs');
const { mailtoFor, renderFollowup, sourcesOf } = await import('../features/marketing.mjs');

let w, coach2;
const marketing = () => FEATURES.find(f => f.name === 'marketing');
const html = r => (Buffer.isBuffer(r.body) ? r.body.toString('utf8') : JSON.stringify(r.body));
const form = (fields, ip) => ({ raw: new URLSearchParams(fields).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': ip } });
let n = 0;
/** A lead straight into the table: created `daysAgo`, closed after `toWin` days when won. */
function lead(coachId, { name = `Lead ${++n}`, email = null, source = 'instagram', stage = 'enquiry', daysAgo = 10, toWin = null, clientId = null, referralCode = null, campaignId = null, detail = '', next = null } = {}) {
  const id = `ld_fx_${++n}`;
  const created = londonToUtc(addDays(londonDay(), -daysAgo), '10:00').toISOString();
  const closed = toWin === null ? null : londonToUtc(addDays(londonDay(), -daysAgo + toWin), '10:00').toISOString();
  w.db.prepare(`INSERT INTO leads (id, coach_id, name, email, source, source_detail, referral_code, campaign_id, stage, client_id, next_action_on, created_at, updated_at, closed_at, reached)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, coachId, name, email, source, detail, referralCode, campaignId, stage, clientId, next, created, created, closed, stage === 'lost' ? 'contacted' : stage);
  return id;
}

before(async () => {
  w = await makeWorld();
  coach2 = await w.signIn('helper-coach-2', 'coach2@example.com', { givenName: 'Kate', familyName: 'Jones' });
});
after(() => w.close());

describe('sources', () => {
  test('conversion, median days to win and LTV from billing.ltv', async () => {
    const c = w.user('Source Coach', 'coach');
    const a = w.user('Won A', 'client', c.id), b = w.user('Won B', 'client', c.id), d = w.user('Won C', 'client', c.id);
    w.db.prepare('INSERT INTO fx_ltv (client_id, pence) VALUES (?,?), (?,?)').run(a.id, 30000, b.id, 50000);
    lead(c.id, { source: 'instagram', stage: 'won', daysAgo: 40, toWin: 10, clientId: a.id });
    lead(c.id, { source: 'instagram', stage: 'won', daysAgo: 30, toWin: 20, clientId: b.id });
    lead(c.id, { source: 'instagram', stage: 'lost', daysAgo: 20 });
    lead(c.id, { source: 'instagram', stage: 'enquiry', daysAgo: 2 });
    lead(c.id, { source: 'word', stage: 'won', daysAgo: 50, toWin: 7, clientId: d.id, referralCode: 'SAM-K7QP' });
    lead(c.id, { source: 'word', stage: 'contacted', daysAgo: 400 });
    const s = await w.ok('GET', '/api/marketing/sources?days=365', { as: c });
    const ig = s.sources.find(r => r.source === 'instagram');
    assert.deepEqual({ leads: ig.leads, won: ig.won, conversionPct: ig.conversionPct, medianDaysToWin: ig.medianDaysToWin, avgLtvPence: ig.avgLtvPence, revenue12Pence: ig.revenue12Pence },
      { leads: 4, won: 2, conversionPct: 50, medianDaysToWin: 15, avgLtvPence: 40000, revenue12Pence: 80000 });
    const word = s.sources.find(r => r.source === 'word');
    assert.equal(word.leads, 1, 'the 400-day-old lead is outside the window');
    assert.equal(word.avgLtvPence, null, 'no billing.ltv value for that client');
    assert.equal(s.referralCodes[0].source, 'SAM-K7QP');
    assert.equal((await w.ok('GET', '/api/marketing/sources?days=all', { as: c })).sources.find(r => r.source === 'word').leads, 2);
    assert.equal(sourcesOf(w.db, c.id, { days: 90 }).sources.find(r => r.source === 'word').leads, 1);
  });
});

describe('follow-ups', () => {
  test('mailto is URL-encoded, and absent without an e-mail', () => {
    const m = mailtoFor('ann.lee+fit@example.com', 'Hi & welcome', 'Line one\nLine two: 100% sure?');
    assert.equal(m, 'mailto:ann.lee%2Bfit@example.com?subject=Hi%20%26%20welcome&body=Line%20one%0ALine%20two%3A%20100%25%20sure%3F');
    assert.equal(mailtoFor(null, 'x', 'y'), null);
    assert.equal(renderFollowup('Hi {leadFirst}, {nope} from {coachFirst}', { leadFirst: 'Ann', coachFirst: 'JK' }), 'Hi Ann, {nope} from JK');
  });

  test('due leads get a rendered template; following up logs it and moves the next action', async () => {
    const c = w.user('Coach JK', 'coach');
    await w.ok('PUT', '/api/leads/form', { as: c, body: { slug: 'jk-followups', title: 'Hello' } });
    const withMail = lead(c.id, { name: 'Ann Lee', email: 'ann@example.com', stage: 'enquiry', next: addDays(londonDay(), -1) });
    const noMail = lead(c.id, { name: 'Bob Day', stage: 'contacted', next: londonDay() });
    lead(c.id, { name: 'Later', stage: 'enquiry', next: addDays(londonDay(), 3) });
    const { templates } = await w.ok('GET', '/api/marketing/followups/templates', { as: c });
    assert.deepEqual(templates.map(t => t.stage), ['enquiry', 'contacted', 'consult', 'trial', 'lost']);
    const { due } = await w.ok('GET', '/api/marketing/followups', { as: c });
    assert.deepEqual(due.map(d => d.lead.name), ['Ann Lee', 'Bob Day']);
    const ann = due[0];
    assert.equal(ann.template.stage, 'enquiry');
    assert.match(ann.rendered.body, /^Hi Ann,/);
    assert.match(ann.rendered.body, /\nJK$/, 'coachFirst drops the “Coach” title');
    assert.ok(ann.mailto.startsWith('mailto:ann@example.com?subject='));
    assert.equal(due[1].mailto, null);
    assert.match(due[1].rendered.body, /https:\/\/jk\.example\.com\/enquire\/jk-followups/);
    const r = await w.ok('POST', `/api/leads/${withMail}/followed-up`, { as: c, body: { templateId: ann.template.id, channel: 'mailto' } });
    assert.equal(r.lead.nextActionOn, addDays(londonDay(), ann.template.nextInDays));
    assert.equal((await w.call('POST', `/api/leads/${noMail}/followed-up`, { as: c, body: { templateId: ann.template.id, channel: 'mailto' } })).status, 400);
    await w.ok('POST', `/api/leads/${noMail}/followed-up`, { as: c, body: { templateId: due[1].template.id, channel: 'copy' } });
    const acts = w.db.prepare("SELECT text FROM lead_activities WHERE lead_id=? AND kind='email'").all(withMail).map(a => a.text);
    assert.deepEqual(acts, ['Followed up by e-mail: First reply']);
    await w.settle();
    assert.equal(eventsFor(w.db, { coachId: c.id, types: ['marketing.followedUp'] }).length, 2);
    assert.deepEqual((await w.ok('GET', '/api/marketing/followups', { as: c })).due, []);
    const picker = await w.ok('GET', `/api/leads/${withMail}/followups`, { as: c });
    assert.equal(picker.options.length, 5);
  });

  test('templates: create, edit, delete; deleting every default does not bring them back', async () => {
    const c = w.user('Template Coach', 'coach');
    const { templates } = await w.ok('GET', '/api/marketing/followups/templates', { as: c });
    const t = (await w.ok('POST', '/api/marketing/followups/templates', { as: c, body: { stage: 'trial', name: 'Day 3 check', body: 'Hi {leadFirst}', nextInDays: 1 } })).template;
    assert.equal((await w.ok('PUT', `/api/marketing/followups/templates/${t.id}`, { as: c, body: { name: 'Day three' } })).template.name, 'Day three');
    assert.equal((await w.call('POST', '/api/marketing/followups/templates', { as: c, body: { stage: 'won', name: 'x', body: 'y' } })).status, 400);
    for (const x of [...templates, t]) await w.ok('DELETE', `/api/marketing/followups/templates/${x.id}`, { as: c });
    assert.deepEqual((await w.ok('GET', '/api/marketing/followups/templates', { as: c })).templates, []);
  });
});

describe('testimonials', () => {
  test('pulse.answered: 9 suggests one ask, 8 none, a repeat nothing more', async () => {
    const c = w.user('Pulse Coach', 'coach');
    const happy = w.user('Priya Shah', 'client', c.id), fine = w.user('Leo Grant', 'client', c.id);
    emit(w.db, 'pulse.answered', { coachId: c.id, clientId: happy.id, surveyId: 'ps_1', kind: 'nps', score: 9 });
    emit(w.db, 'pulse.answered', { coachId: c.id, clientId: fine.id, surveyId: 'ps_1', kind: 'nps', score: 8 });
    await w.settle();
    let items = marketing().inbox(w.db, c.row, {});
    assert.equal(items.length, 1);
    assert.equal(items[0].key, `testimonial:${happy.id}:ps_1`);
    assert.equal(items[0].title, 'Ask Priya for a testimonial');
    emit(w.db, 'pulse.answered', { coachId: c.id, clientId: happy.id, surveyId: 'ps_1', kind: 'nps', score: 10 });
    await w.settle();
    items = marketing().inbox(w.db, c.row, {});
    assert.equal(items.length, 1);
    // The coach sends the ask (one message, via coachAction); the row becomes requested and the item goes.
    const out = await w.ok('POST', '/api/marketing/testimonials/ask', { as: c, body: { clientId: happy.id, text: 'Would you write a line about training together?', surveyId: 'ps_1' } });
    assert.equal(out.testimonial.status, 'requested');
    assert.equal(out.testimonial.source, 'nps');
    assert.equal(w.db.prepare('SELECT via FROM messages WHERE id=?').get(out.messageId).via, 'coachAction');
    assert.equal(marketing().inbox(w.db, c.row, {}).length, 0);
    await w.settle();
    assert.ok(eventsFor(w.db, { coachId: c.id, types: ['testimonial.requested'] }).length >= 1);
  });

  test('consent to publish needs a message from that client', async () => {
    const c = w.user('Consent Coach', 'coach');
    const sam = w.user('Sam Carter', 'client', c.id), other = w.user('Other Client', 'client', c.id);
    const msg = (client, role, text) => {
      const id = `m_fx_${++n}`;
      w.db.prepare('INSERT INTO messages (id, client_id, from_id, from_role, text, at) VALUES (?,?,?,?,?,?)').run(id, client.id, role === 'client' ? client.id : c.id, role, text, new Date().toISOString());
      return id;
    };
    const samYes = msg(sam, 'client', 'Yes, use it!');
    const coachLine = msg(sam, 'coach', 'Can I use it?');
    const otherYes = msg(other, 'client', 'Sure');
    const t = (await w.ok('POST', '/api/marketing/testimonials', { as: c, body: { clientId: sam.id, quote: 'JK changed how I train.', attribution: 'Sam, lifter' } })).testimonial;
    assert.equal(t.status, 'received');
    const patch = body => w.call('PATCH', `/api/marketing/testimonials/${t.id}`, { as: c, body });
    assert.equal((await patch({ consentPublish: true })).status, 400, 'no evidence');
    assert.equal((await patch({ consentPublish: true, evidenceMessageId: otherYes })).status, 400, 'another client’s message');
    assert.equal((await patch({ consentPublish: true, evidenceMessageId: coachLine })).status, 400, 'the coach’s own message');
    assert.equal((await patch({ status: 'approved' })).status, 400, 'approved needs consent');
    const ok = await patch({ consentPublish: true, evidenceMessageId: samYes });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.testimonial.status, 'approved');
    assert.equal(ok.body.testimonial.evidence.text, 'Yes, use it!');
    await w.settle();
    assert.equal(eventsFor(w.db, { coachId: c.id, types: ['testimonial.approved'] }).length, 1);
    const msgs = await w.ok('GET', `/api/marketing/testimonials/${t.id}/messages`, { as: c });
    assert.deepEqual(msgs.messages.map(m => m.id), [samYes]);
    const withdrawn = await patch({ consentPublish: false });
    assert.equal(withdrawn.body.testimonial.status, 'received');
  });

  test('isolation, reassignment, export and erasure', async () => {
    const c = w.user('Iso Coach', 'coach'), c2 = w.user('Iso Coach Two', 'coach');
    const ana = await w.signIn('ana-sub', 'ana@example.com', { givenName: 'Ana', familyName: 'Ruiz' });
    w.db.prepare('UPDATE users SET coach_id=? WHERE id=?').run(c.id, ana.id);
    const t = (await w.ok('POST', '/api/marketing/testimonials', { as: c, body: { clientId: ana.id, quote: 'Brilliant coaching.' } })).testimonial;
    const routes = [['PATCH', `/api/marketing/testimonials/${t.id}`, { quote: 'x' }], ['GET', `/api/marketing/testimonials/${t.id}/messages`],
      ['POST', '/api/marketing/testimonials', { clientId: ana.id }], ['POST', '/api/marketing/testimonials/ask', { clientId: ana.id, text: 'hi' }]];
    for (const [method, path, body] of routes) assert.equal((await w.call(method, path, { as: c2, body })).status, 404, `${method} ${path}`);
    assert.equal((await w.ok('GET', '/api/marketing/testimonials', { as: c2 })).testimonials.length, 0);
    for (const [method, path, body] of [...routes, ['GET', '/api/marketing/testimonials'], ['GET', '/api/marketing/sources'], ['GET', '/api/marketing/followups'],
      ['GET', '/api/marketing/followups/templates'], ['GET', '/api/marketing/offers']]) {
      assert.equal((await w.call(method, path, { as: w.client, body })).status, 403, `${method} ${path} as a client`);
    }
    // Reassigned: the old coach loses it, the new coach sees it.
    w.db.prepare('UPDATE users SET coach_id=? WHERE id=?').run(c2.id, ana.id);
    assert.equal((await w.ok('GET', '/api/marketing/testimonials', { as: c })).testimonials.length, 0);
    assert.equal((await w.call('PATCH', `/api/marketing/testimonials/${t.id}`, { as: c, body: { quote: 'x' } })).status, 404);
    assert.equal((await w.ok('GET', '/api/marketing/testimonials', { as: c2 })).testimonials.length, 1);
    // A foreign template or lead is a 404 too.
    const tpl = (await w.ok('GET', '/api/marketing/followups/templates', { as: c })).templates[0];
    const l = lead(c.id, { email: 'x@example.com' });
    assert.equal((await w.call('PUT', `/api/marketing/followups/templates/${tpl.id}`, { as: c2, body: { name: 'x' } })).status, 404);
    assert.equal((await w.call('DELETE', `/api/marketing/followups/templates/${tpl.id}`, { as: c2 })).status, 404);
    assert.equal((await w.call('POST', `/api/leads/${l}/followed-up`, { as: c2, body: { templateId: tpl.id, channel: 'copy' } })).status, 404);
    assert.equal((await w.call('GET', `/api/leads/${l}/followups`, { as: c2 })).status, 404);
    const c2tpl = (await w.ok('GET', '/api/marketing/followups/templates', { as: c2 })).templates[0];
    assert.equal((await w.call('POST', `/api/leads/${l}/followed-up`, { as: c, body: { templateId: c2tpl.id, channel: 'copy' } })).status, 404, 'a foreign template');
    // Export, then erasure.
    const exp = await w.call('GET', '/api/me/export', { as: ana });
    const data = Buffer.isBuffer(exp.body) ? JSON.parse(exp.body.toString('utf8')) : exp.body;
    assert.equal(data.features.marketing.testimonials[0].quote, 'Brilliant coaching.');
    await w.ok('DELETE', '/api/me', { as: ana });
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM testimonials WHERE client_id=?').get(ana.id).n, 0);
    assertNoRowsFor(w.db, ana.id);
  });
});

describe('offers and the enquiry page', () => {
  test('a live public campaign shows; a private, ended or foreign one is ignored', async () => {
    const c = w.user('Offer Coach', 'coach'), other = w.user('Other Offer Coach', 'coach');
    await w.ok('PUT', '/api/leads/form', { as: c, body: { slug: 'offer-coach', title: 'Train with me' } });
    const today = londonDay();
    const camp = (id, coachId, status, pub, endsOn) => w.db.prepare('INSERT INTO fx_campaigns (id, coach_id, name, status, public, starts_on, ends_on, tagline, fee_pence) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, coachId, id === 'cg_live' ? 'January Reset' : `Campaign ${id}`, status, pub, addDays(today, 10), endsOn, 'Thirty days to a fresh start', 4900);
    camp('cg_live', c.id, 'live', 1, addDays(today, 40));
    camp('cg_private', c.id, 'live', 0, addDays(today, 40));
    camp('cg_ended', c.id, 'live', 1, addDays(today, -1));
    camp('cg_foreign', other.id, 'live', 1, addDays(today, 40));
    const live = html(await w.call('GET', '/enquire/offer-coach?campaign=cg_live'));
    assert.match(live, /January Reset/);
    assert.match(live, /£49/);
    assert.match(live, /name="campaign" value="cg_live"/);
    for (const id of ['cg_private', 'cg_ended', 'cg_foreign', '<script>']) {
      const page = html(await w.call('GET', `/enquire/offer-coach?campaign=${encodeURIComponent(id)}`));
      assert.doesNotMatch(page, /Register interest/, id);
      assert.doesNotMatch(page, /name="campaign"/, id);
    }
    // Posting with the campaign records it; a forged one is ignored.
    await w.call('POST', '/enquire/offer-coach', form({ name: 'Ruth Moss', email: 'ruth@example.com', consent: 'yes', campaign: 'cg_live' }, '192.0.2.50'));
    await w.call('POST', '/enquire/offer-coach', form({ name: 'Ian Fox', email: 'ian@example.com', consent: 'yes', campaign: 'cg_foreign' }, '192.0.2.51'));
    const rows = w.db.prepare('SELECT name, campaign_id, source_detail FROM leads WHERE coach_id=? ORDER BY name').all(c.id).map(r => ({ ...r }));
    assert.deepEqual(rows, [{ name: 'Ian Fox', campaign_id: null, source_detail: '' }, { name: 'Ruth Moss', campaign_id: 'cg_live', source_detail: 'campaign:January Reset' }]);
    await w.settle();
    assert.equal(eventsFor(w.db, { coachId: c.id, types: ['lead.created'] }).find(e => e.payload.campaignId)?.payload.campaignId, 'cg_live');
    const { offers } = await w.ok('GET', '/api/marketing/offers', { as: c });
    assert.equal(offers.length, 1);
    assert.equal(offers[0].campaign.id, 'cg_live');
    assert.equal(offers[0].link, 'https://jk.example.com/enquire/offer-coach?campaign=cg_live');
    assert.equal(offers[0].interest, 1);
    const s = await w.ok('GET', '/api/marketing/sources', { as: c });
    assert.equal(s.campaigns[0].label, 'January Reset');
  });
});

describe('the demo world', () => {
  test('five templates, three testimonials (one approved with evidence), an ask, and January Reset interest', async () => {
    const { today } = fakeToday();
    const demoCoach = () => w.db.prepare("SELECT * FROM users WHERE apple_sub='demo-coach'").get();
    buildDemo(w.db, today, w.config);
    // WP4 owns the real campaign: the fixture stands in for its public January Reset.
    w.db.prepare("INSERT INTO fx_campaigns (id, coach_id, name, status, public, starts_on, ends_on, tagline, fee_pence) VALUES ('cg_demo', ?, 'January Reset', 'live', 1, ?, ?, 'Thirty days', 2900)")
      .run(demoCoach().id, addDays(today, 30), addDays(today, 60));
    buildDemo(w.db, addDays(today, 1), w.config);
    const coach = demoCoach();
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM followup_templates WHERE coach_id=?').get(coach.id).n, 5);
    const ts = w.db.prepare('SELECT status, evidence_message_id, client_id FROM testimonials WHERE coach_id=? ORDER BY status').all(coach.id);
    assert.deepEqual(ts.map(t => t.status), ['approved', 'received', 'requested']);
    const ev = w.db.prepare('SELECT * FROM messages WHERE id=?').get(ts[0].evidence_message_id);
    assert.equal(ev.client_id, ts[0].client_id);
    assert.equal(ev.from_role, 'client');
    assert.equal(marketing().inbox(w.db, coach, {}).length, 1);
    assert.equal(w.db.prepare("SELECT COUNT(*) n FROM leads WHERE coach_id=? AND campaign_id='cg_demo'").get(coach.id).n, 3);
  });
});
