/**
 * F6 Leads pipeline and the public enquiry form (docs/design/desk-v2.md F6, WP11).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { makeWorld, assertNoRowsFor, fakeToday } from './helpers.mjs';
import { buildDemo } from '../demo.mjs';
import { eventsFor } from '../events.mjs';
import { FEATURES, allFacts } from '../registry.mjs';
import { addDays, londonDay } from '../time.mjs';

let w, coach2;
const leads = () => FEATURES.find(f => f.name === 'leads');
const form = (fields, ip = '203.0.113.1') => ({
  raw: new URLSearchParams(fields).toString(),
  headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': ip },
});
const html = r => Buffer.isBuffer(r.body) ? r.body.toString('utf8') : JSON.stringify(r.body);
const leadCount = (coachId = w.coach.id) => w.db.prepare('SELECT COUNT(*) n FROM leads WHERE coach_id=?').get(coachId).n;
let ipSeq = 10;
const nextIp = () => `198.51.100.${ipSeq++}`;

before(async () => {
  w = await makeWorld();
  coach2 = await w.signIn('helper-coach-2', 'coach2@example.com', { givenName: 'Kate', familyName: 'Jones' });
  await w.ok('PUT', '/api/leads/form', { as: w.coach, body: { slug: 'train-with-jk', title: 'Train with JK', intro: 'Say hello.', fields: ['goal', 'experience', 'times', 'budget'], active: true } });
});
after(() => w.close());

describe('the public enquiry page', () => {
  test('GET answers HTML with its own CSP, and the stylesheet is served', async () => {
    const r = await w.call('GET', '/enquire/train-with-jk?ref=sam-k7qp');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-security-policy'), "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    const page = html(r);
    assert.match(page, /<form[^>]+action="\/enquire\/train-with-jk"/);
    assert.match(page, /name="website"/, 'the honeypot is there');
    assert.match(page, /name="ref" value="SAM-K7QP"/);
    assert.match(page, /My details are kept for up to 12 months/);
    assert.doesNotMatch(page, /<script/i);
    const css = await w.call('GET', '/enquire.css');
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    assert.equal((await w.call('GET', '/enquire/no-such-page')).status, 404);
  });

  test('a POST creates a lead (and escapes what it echoes)', async () => {
    const before = leadCount();
    const r = await w.call('POST', '/enquire/train-with-jk', form({ name: 'Hannah <b>Lee</b>', email: 'Hannah@Example.com', phone: '07700 900412', goal: 'Deadlift my bodyweight', experience: 'some', times: 'early', budget: '80to150', consent: 'yes', website: '' }, nextIp()));
    assert.equal(r.status, 200, html(r));
    assert.match(html(r), /Thanks, JK will be in touch within a day/);
    assert.equal(leadCount(), before + 1);
    const l = w.db.prepare('SELECT * FROM leads WHERE coach_id=? ORDER BY created_at DESC LIMIT 1').get(w.coach.id);
    assert.equal(l.name, 'Hannah <b>Lee</b>');
    assert.equal(l.email, 'hannah@example.com');
    assert.equal(l.source, 'enquiryForm');
    assert.equal(l.value_pence, 12000, 'the budget answer estimates the value');
    assert.ok(l.consent_at);
    assert.deepEqual(JSON.parse(l.answers), { goal: 'Deadlift my bodyweight', experience: 'some', times: ['early'], budget: '80to150' });
    await w.settle();
    const ev = eventsFor(w.db, { coachId: w.coach.id, types: ['lead.created'] })[0];
    assert.equal(ev.payload.leadId, l.id);
    assert.doesNotMatch(ev.summary, /Hannah/, 'event summaries never carry a lead’s name');
    const n = w.db.prepare("SELECT * FROM coach_notifications WHERE coach_id=? AND kind='lead'").all(w.coach.id);
    assert.equal(n.length, 1);
    assert.equal(n[0].path, `/pipeline/${l.id}`);
    // The marketing cadence: the first reply is due the next day.
    assert.equal(w.db.prepare('SELECT next_action_on FROM leads WHERE id=?').get(l.id).next_action_on, addDays(londonDay(new Date(l.created_at)), 1));
  });

  test('the honeypot keeps nothing; a missing consent is refused with the form', async () => {
    const before = leadCount();
    const bot = await w.call('POST', '/enquire/train-with-jk', form({ name: 'Bot', email: 'bot@example.com', consent: 'yes', website: 'http://spam.example' }, nextIp()));
    assert.equal(bot.status, 200);
    assert.equal(leadCount(), before, 'a filled honeypot creates no lead');
    const r = await w.call('POST', '/enquire/train-with-jk', form({ name: 'Ann', email: 'ann@example.com' }, nextIp()));
    assert.equal(r.status, 400);
    assert.match(html(r), /Tick the box/);
    assert.match(html(r), /value="Ann"/, 'the form keeps what was typed');
    assert.equal(leadCount(), before);
    const bad = await w.call('POST', '/enquire/train-with-jk', form({ name: 'Ann', email: 'not-an-email', consent: 'yes' }, nextIp()));
    assert.equal(bad.status, 400);
    const json = await w.call('POST', '/enquire/train-with-jk', { body: { name: 'Ann', email: 'ann@example.com', consent: 'yes' }, headers: { 'cf-connecting-ip': nextIp() } });
    assert.equal(json.status, 415);
    assert.equal(leadCount(), before);
  });

  test('the sixth post from one address in an hour gets a 429 page', async () => {
    const ip = nextIp();
    for (let i = 0; i < 5; i++) {
      const r = await w.call('POST', '/enquire/train-with-jk', form({ name: `Person ${i}`, email: `p${i}@example.com`, consent: 'yes' }, ip));
      assert.equal(r.status, 200);
    }
    const sixth = await w.call('POST', '/enquire/train-with-jk', form({ name: 'Person 6', email: 'p6@example.com', consent: 'yes' }, ip));
    assert.equal(sixth.status, 429);
    assert.match(html(sixth), /Too many enquiries/);
    assert.equal(sixth.headers.get('content-security-policy')?.startsWith("default-src 'none'"), true);
  });

  test('a demo coach’s slug is refused with a 403 page', async () => {
    const demo = w.user('Demo Coach', 'coach', null, { isDemo: true });
    await w.ok('PUT', '/api/leads/form', { as: demo, body: { slug: 'demo-studio', title: 'Demo', fields: ['goal'] } });
    const page = await w.call('GET', '/enquire/demo-studio');
    assert.equal(page.status, 200);
    assert.match(html(page), /does not accept enquiries/);
    const r = await w.call('POST', '/enquire/demo-studio', form({ name: 'Real person', email: 'real@example.com', consent: 'yes' }, nextIp()));
    assert.equal(r.status, 403);
    assert.equal(leadCount(demo.id), 0);
  });

  test('an inactive form is not available', async () => {
    const c3 = w.user('Other Coach', 'coach');
    await w.ok('PUT', '/api/leads/form', { as: c3, body: { slug: 'closed-for-now', title: 'Closed', active: false } });
    assert.equal((await w.call('GET', '/enquire/closed-for-now')).status, 404);
    assert.equal((await w.call('POST', '/enquire/closed-for-now', form({ name: 'X', email: 'x@example.com', consent: 'yes' }, nextIp()))).status, 404);
  });
});

describe('the enquiry form settings', () => {
  test('slug rules and uniqueness', async () => {
    const f = await w.ok('GET', '/api/leads/form', { as: w.coach });
    assert.equal(f.form.slug, 'train-with-jk');
    assert.equal(f.url, 'https://jk.example.com/enquire/train-with-jk');
    assert.equal((await w.call('PUT', '/api/leads/form', { as: coach2, body: { slug: 'train-with-jk', title: 'Mine' } })).status, 409);
    assert.equal((await w.call('PUT', '/api/leads/form', { as: coach2, body: { slug: 'No Spaces!', title: 'Mine' } })).status, 400);
    assert.equal((await w.call('PUT', '/api/leads/form', { as: coach2, body: { slug: 'ok-slug', title: 'Mine', fields: ['shoe size'] } })).status, 400);
    const fresh = await w.ok('GET', '/api/leads/form', { as: coach2 });
    assert.equal(fresh.form.exists, false);
    assert.equal(fresh.url, null);
  });
});

describe('the pipeline', () => {
  test('add, move (lost needs a reason), activity, totals and funnel', async () => {
    const { lead } = await w.ok('POST', '/api/leads', { as: w.coach, body: { name: 'Marcus Webb', email: 'marcus@example.com', source: 'instagram', valuePence: 15000, note: 'Met at the squat clinic' } });
    assert.equal(lead.stage, 'enquiry');
    assert.equal(lead.weightedPence, 1500);
    const noReason = await w.call('POST', `/api/leads/${lead.id}/move`, { as: w.coach, body: { stage: 'lost', position: 0 } });
    assert.equal(noReason.status, 400);
    assert.match(noReason.body.error, /why/);
    const badReason = await w.call('POST', `/api/leads/${lead.id}/move`, { as: w.coach, body: { stage: 'lost', position: 0, lostReason: 'weather' } });
    assert.equal(badReason.status, 400);
    const c = await w.ok('POST', `/api/leads/${lead.id}/move`, { as: w.coach, body: { stage: 'consult', position: 0 } });
    assert.equal(c.lead.stage, 'consult');
    assert.equal(c.lead.reached, 'consult');
    const lost = await w.ok('POST', `/api/leads/${lead.id}/move`, { as: w.coach, body: { stage: 'lost', position: 0, lostReason: 'price', lostNote: 'Next year' } });
    assert.equal(lost.lead.stage, 'lost');
    assert.equal(lost.lead.lostReason, 'price');
    assert.equal(lost.lead.reached, 'consult', 'lost keeps the furthest stage');
    assert.ok(lost.lead.closedAt);
    await w.settle();
    const types = eventsFor(w.db, { coachId: w.coach.id, types: ['lead.stageChanged', 'lead.lost'] }).map(e => e.type);
    assert.ok(types.includes('lead.lost'));
    await w.ok('POST', `/api/leads/${lead.id}/activities`, { as: w.coach, body: { kind: 'call', text: 'Rang back: maybe in January.' } });
    assert.equal((await w.call('POST', `/api/leads/${lead.id}/activities`, { as: w.coach, body: { kind: 'stage', text: 'x' } })).status, 400);
    const detail = await w.ok('GET', `/api/leads/${lead.id}`, { as: w.coach });
    assert.deepEqual(detail.activities.map(a => a.kind).slice(0, 2), ['call', 'stage']);
    assert.ok(detail.activities.some(a => a.kind === 'note' && a.text === 'Met at the squat clinic'));
    const reopened = await w.ok('POST', `/api/leads/${lead.id}/move`, { as: w.coach, body: { stage: 'contacted', position: 0 } });
    assert.equal(reopened.lead.closedAt, null);
    assert.equal(reopened.lead.lostReason, null);
    const list = await w.ok('GET', '/api/leads', { as: w.coach });
    assert.ok(list.totals.contacted.count >= 1);
    assert.equal(list.totals.contacted.weightedPence, list.leads.filter(l => l.stage === 'contacted').reduce((n, l) => n + Math.round(l.valuePence * 0.2), 0));
    assert.equal((await w.ok('GET', '/api/leads?q=marcus', { as: w.coach })).leads.length, 1);
    const f = await w.ok('GET', '/api/leads/funnel?days=90', { as: w.coach });
    assert.deepEqual(f.stages.map(s => s.stage), ['enquiry', 'contacted', 'consult', 'trial', 'won']);
    const consult = f.stages.find(s => s.stage === 'consult');
    assert.ok(consult.entered >= 1);
    assert.ok(f.stages[0].entered >= f.stages[1].entered);
  });

  test('positions: a card dropped at an index lands there', async () => {
    const a = (await w.ok('POST', '/api/leads', { as: coach2, body: { name: 'A' } })).lead;
    const b = (await w.ok('POST', '/api/leads', { as: coach2, body: { name: 'B' } })).lead;
    const c = (await w.ok('POST', '/api/leads', { as: coach2, body: { name: 'C' } })).lead;
    for (const x of [a, b, c]) await w.ok('POST', `/api/leads/${x.id}/move`, { as: coach2, body: { stage: 'trial', position: 99 } });
    await w.ok('POST', `/api/leads/${c.id}/move`, { as: coach2, body: { stage: 'trial', position: 0 } });
    const order = (await w.ok('GET', '/api/leads?stage=trial', { as: coach2 })).leads.map(l => l.name);
    assert.deepEqual(order, ['C', 'A', 'B']);
  });

  test('convert manually links an own client only; PATCH edits; DELETE emits lead.deleted', async () => {
    const { lead } = await w.ok('POST', '/api/leads', { as: w.coach, body: { name: 'Sam Carter' } });
    const foreign = w.user('Zed', 'client', coach2.id);
    assert.equal((await w.call('POST', `/api/leads/${lead.id}/convert`, { as: w.coach, body: { clientId: foreign.id } })).status, 404);
    const won = await w.ok('POST', `/api/leads/${lead.id}/convert`, { as: w.coach, body: { clientId: w.client.id } });
    assert.equal(won.lead.stage, 'won');
    assert.equal(won.lead.client.id, w.client.id);
    const p = await w.ok('PATCH', `/api/leads/${lead.id}`, { as: w.coach, body: { phone: '07700 900111', valuePence: 9000, nextActionOn: null } });
    assert.equal(p.lead.valuePence, 9000);
    assert.equal((await w.call('PATCH', `/api/leads/${lead.id}`, { as: w.coach, body: { stage: 'trial' } })).status, 400);
    assert.equal((await w.call('PATCH', `/api/leads/${lead.id}`, { as: w.coach, body: { email: 'nope' } })).status, 400);
    await w.settle();
    const wonEv = eventsFor(w.db, { coachId: w.coach.id, types: ['lead.won'] }).find(e => e.payload.leadId === lead.id);
    assert.equal(wonEv.clientId, w.client.id);
    await w.ok('DELETE', `/api/leads/${lead.id}`, { as: w.coach });
    await w.settle();
    assert.ok(eventsFor(w.db, { coachId: w.coach.id, types: ['lead.deleted'] }).some(e => e.payload.leadId === lead.id));
    assert.equal((await w.call('GET', `/api/leads/${lead.id}`, { as: w.coach })).status, 404);
  });
});

describe('client.joined', () => {
  test('converts an unconverted lead with the same e-mail, for the same coach only', async () => {
    const mine = (await w.ok('POST', '/api/leads', { as: w.coach, body: { name: 'Nina Park', email: 'Nina.Park@example.com', source: 'word' } })).lead;
    const theirs = (await w.ok('POST', '/api/leads', { as: coach2, body: { name: 'Nina Park', email: 'nina.park@example.com' } })).lead;
    // A sign-up joins the primary coach (coach@example.com).
    const nina = await w.signIn('nina-sub', 'nina.park@example.com', { givenName: 'Nina', familyName: 'Park' });
    await w.settle();
    const d = await w.ok('GET', `/api/leads/${mine.id}`, { as: w.coach });
    assert.equal(d.lead.stage, 'won');
    assert.equal(d.lead.client.id, nina.id);
    assert.ok(d.activities.some(a => a.kind === 'converted'));
    const other = await w.ok('GET', `/api/leads/${theirs.id}`, { as: coach2 });
    assert.equal(other.lead.stage, 'enquiry');
    assert.equal(other.lead.client, null);
    assert.ok(eventsFor(w.db, { coachId: w.coach.id, types: ['lead.won'] }).some(e => e.payload.leadId === mine.id && e.clientId === nina.id));
  });
});

describe('isolation', () => {
  test('every route: a foreign lead is a 404, a client gets a 403', async () => {
    const { lead } = await w.ok('POST', '/api/leads', { as: w.coach, body: { name: 'Private Person' } });
    const routes = [
      ['GET', `/api/leads/${lead.id}`], ['PATCH', `/api/leads/${lead.id}`, { name: 'X' }], ['DELETE', `/api/leads/${lead.id}`],
      ['POST', `/api/leads/${lead.id}/move`, { stage: 'contacted', position: 0 }], ['POST', `/api/leads/${lead.id}/activities`, { kind: 'note', text: 'x' }],
      ['POST', `/api/leads/${lead.id}/convert`, { clientId: w.client.id }],
    ];
    for (const [method, path, body] of routes) {
      assert.equal((await w.call(method, path, { as: coach2, body })).status, 404, `${method} ${path}`);
      assert.equal((await w.call(method, path, { as: w.client, body })).status, 403, `${method} ${path} as a client`);
    }
    for (const [method, path, body] of [['GET', '/api/leads'], ['POST', '/api/leads', { name: 'X' }], ['GET', '/api/leads/form'], ['PUT', '/api/leads/form', { slug: 'abc', title: 'x' }], ['GET', '/api/leads/funnel']]) {
      assert.equal((await w.call(method, path, { as: w.client, body })).status, 403, `${method} ${path} as a client`);
    }
    assert.ok(!(await w.ok('GET', '/api/leads', { as: coach2 })).leads.some(l => l.id === lead.id));
    const results = (await w.ok('GET', '/api/search?q=Private', { as: coach2 })).results;
    assert.ok(!results.some(r => r.id === lead.id));
    assert.ok((await w.ok('GET', '/api/search?q=Private', { as: w.coach })).results.some(r => r.type === 'lead' && r.id === lead.id));
  });

  test('a converted lead shows its client only while the client is still this coach’s', async () => {
    const zoe = w.user('Zoe Ball', 'client', w.coach.id);
    const { lead } = await w.ok('POST', '/api/leads', { as: w.coach, body: { name: 'Zoe Ball' } });
    await w.ok('POST', `/api/leads/${lead.id}/convert`, { as: w.coach, body: { clientId: zoe.id } });
    w.db.prepare('UPDATE users SET coach_id=? WHERE id=?').run(coach2.id, zoe.id);
    assert.equal((await w.ok('GET', `/api/leads/${lead.id}`, { as: w.coach })).lead.client, null);
  });
});

describe('hooks', () => {
  test('inbox, badges and forecast', async () => {
    const f = leads();
    const items = f.inbox(w.db, w.coach.row, {});
    assert.ok(items.length >= 1);
    assert.ok(items.every(i => i.key.startsWith('lead:') && i.kind === 'lead' && i.clientId === null));
    assert.ok(f.badges(w.db, w.coach.row).pipeline >= 1);
    const today = londonDay();
    const lines = f.forecast(w.db, w.coach.row, today, addDays(today, 90));
    const open = w.db.prepare("SELECT stage, value_pence FROM leads WHERE coach_id=? AND stage IN ('enquiry','contacted','consult','trial')").all(w.coach.id);
    const weighted = open.reduce((n, l) => n + l.value_pence * { enquiry: 0.1, contacted: 0.2, consult: 0.4, trial: 0.6 }[l.stage], 0);
    assert.ok(Math.abs(lines.reduce((n, l) => n + l.pence, 0) - weighted) <= lines.length, 'the weighted value, spread over 60 days');
    assert.ok(lines.every(l => l.confidence === 'possible' && l.source === 'leads' && l.day <= addDays(today, 60)));
    assert.equal(f.forecast(w.db, w.coach.row, addDays(today, 70), addDays(today, 90)).length, 0);
  });

  test('sources: LTV only from billing.ltv when that fact exists', async () => {
    const s = await w.ok('GET', '/api/marketing/sources?days=all', { as: w.coach });
    const has = allFacts().some(f => f.id === 'billing.ltv');
    for (const row of s.sources) {
      if (!has) { assert.equal(row.avgLtvPence, null); assert.equal(row.revenue12Pence, null); }
    }
    assert.ok(s.sources.some(r => r.source === 'enquiryForm'));
  });
});

describe('the purge clock and erasure', () => {
  test('lost or unconverted leads go 12 months after their last touch; converted ones stay', async () => {
    const c = w.user('Purge Coach', 'coach');
    const now = new Date();
    const old = new Date(now.getTime() - 400 * 86_400_000).toISOString();
    const recent = new Date(now.getTime() - 300 * 86_400_000).toISOString();
    const client = w.user('Kept Client', 'client', c.id);
    const ins = (name, stage, updated, clientId = null) => {
      const id = `ld_test_${name}`;
      w.db.prepare(`INSERT INTO leads (id, coach_id, name, stage, client_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`).run(id, c.id, name, stage, clientId, updated, updated);
      return id;
    };
    const gone1 = ins('oldlost', 'lost', old), gone2 = ins('oldopen', 'contacted', old), kept1 = ins('recentlost', 'lost', recent), kept2 = ins('oldwon', 'won', old, client.id);
    const n = await w.tick('lead.purge', now);
    assert.equal(n, 2);
    const left = w.db.prepare('SELECT id FROM leads WHERE coach_id=?').all(c.id).map(r => r.id).sort();
    assert.deepEqual(left, [kept1, kept2].sort());
    await w.settle();
    const deleted = eventsFor(w.db, { coachId: c.id, types: ['lead.deleted'] }).map(e => e.payload.leadId).sort();
    assert.deepEqual(deleted, [gone1, gone2].sort());
    // Thirteen months on, the recent lost one goes too; the converted one stays.
    await w.tick('lead.purge', new Date(now.getTime() + 70 * 86_400_000));
    assert.deepEqual(w.db.prepare('SELECT id FROM leads WHERE coach_id=?').all(c.id).map(r => r.id), [kept2]);
  });

  test('a client’s export holds their enquiry, and deleting the account erases it', async () => {
    const pat = await w.signIn('pat-sub', 'pat@example.com', { givenName: 'Pat', familyName: 'Lowe' });
    const { lead } = await w.ok('POST', '/api/leads', { as: w.coach, body: { name: 'Pat Lowe', email: 'pat.lowe@example.com', note: 'Wants to row' } });
    await w.ok('POST', `/api/leads/${lead.id}/convert`, { as: w.coach, body: { clientId: pat.id } });
    const exp = await w.call('GET', '/api/me/export', { as: pat });
    const data = Buffer.isBuffer(exp.body) ? JSON.parse(exp.body.toString('utf8')) : exp.body;
    assert.equal(data.features.leads.enquiries.length, 1);
    assert.equal(data.features.leads.enquiries[0].name, 'Pat Lowe');
    assert.ok(data.features.leads.enquiries[0].activities.some(a => a.text === 'Wants to row'));
    await w.ok('DELETE', '/api/me', { as: pat });
    assert.equal(w.db.prepare('SELECT 1 FROM leads WHERE id=?').get(lead.id), undefined, 'the enquiry went with the account');
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM lead_activities WHERE lead_id=?').get(lead.id).n, 0);
    assertNoRowsFor(w.db, pat.id);
  });
});

describe('the demo world', () => {
  test('nine leads over four sources, four won and linked, the demo form, built twice', async () => {
    const { today } = fakeToday();
    buildDemo(w.db, today, w.config);
    buildDemo(w.db, addDays(today, 1), w.config);
    const demo = w.db.prepare("SELECT * FROM users WHERE apple_sub='demo-coach'").get();
    const rows = w.db.prepare('SELECT * FROM leads WHERE coach_id=?').all(demo.id);
    assert.equal(rows.length, 9);
    assert.equal(new Set(rows.map(r => r.source)).size, 4);
    assert.deepEqual(new Set(rows.map(r => r.stage)), new Set(['enquiry', 'contacted', 'consult', 'trial', 'won', 'lost']));
    const won = rows.filter(r => r.stage === 'won');
    assert.equal(won.length, 4);
    assert.ok(won.every(r => r.client_id));
    assert.ok(rows.every(r => r.value_pence >= 8000 && r.value_pence <= 20000));
    assert.ok(w.db.prepare('SELECT COUNT(*) n FROM lead_activities WHERE coach_id=?').get(demo.id).n > 20);
    assert.equal(w.db.prepare('SELECT slug FROM lead_forms WHERE coach_id=?').get(demo.id).slug, 'demo-jk');
    const page = await w.call('GET', '/enquire/demo-jk');
    assert.equal(page.status, 200);
  });
});
