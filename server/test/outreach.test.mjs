/**
 * F17 Scheduled messages and segment broadcasts (docs/design/desk-v2.md, WP5).
 * Loads the WP5 features (and a stand-in crm for client.offboarded) through
 * FEATURES_DIR, so these tests do not depend on other packages.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

const SERVER = new URL('../', import.meta.url);
const FIXTURES = mkdtempSync(join(tmpdir(), 'jk-wp5-out-'));
for (const n of ['automations', 'outreach', 'templates']) {
  writeFileSync(join(FIXTURES, `${n}.mjs`), `export { feature } from ${JSON.stringify(new URL(`features/${n}.mjs`, SERVER).href)};\n`);
}
writeFileSync(join(FIXTURES, 'crm.mjs'), `export const feature = {
  name: 'crm', namespaces: ['crm'], exact: ['client.offboarded'],
  emits: { 'client.offboarded': { label: 'Coaching ended', payload: ['exitReason'] } },
};\n`);
process.env.NODE_ENV = 'test';
process.env.FEATURES_DIR = FIXTURES;

const { makeWorld, assertNoRowsFor } = await import('./helpers.mjs');
const { emit } = await import('../events.mjs');
const { openStore, newId, nowIso } = await import('../store.mjs');
const { runFeatureSchemas } = await import('../features.mjs');
const { sendDue } = await import('../features/outreach.mjs');
const { resetLimits } = await import('../ratelimit.mjs');

let w, coach2, client2;
before(async () => {
  w = await makeWorld();
  coach2 = await w.signIn('helper-coach2', 'coach2@example.com', { givenName: 'Other', familyName: 'Coach' });
  client2 = w.user('Ola Other', 'client', coach2.id);
});
after(() => { w.close(); rmSync(FIXTURES, { recursive: true, force: true }); });
beforeEach(async () => {
  resetLimits();
  await w.settle();
  for (const t of ['scheduled_messages', 'broadcasts', 'messages', 'deferred_messages', 'client_outreach', 'client_tags']) w.db.prepare(`DELETE FROM ${t}`).run();
  w.db.prepare("DELETE FROM coach_prefs WHERE key LIKE 'outreach.%'").run();
  for (const c of [w.coach, coach2]) w.db.prepare("INSERT INTO coach_prefs (coach_id, key, value, updated_at) VALUES (?, 'outreach.quietHours', 'null', ?)").run(c.id, nowIso());
});

const NOW = new Date('2026-06-10T10:00:00Z');
const later = mins => new Date(NOW.getTime() + mins * 60_000);
const at = d => `?at=${encodeURIComponent(d.toISOString())}`;
const count = (t, where = '1=1', ...args) => w.db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${where}`).get(...args).n;
const schedule = (body, as = w.coach) => w.ok('POST', `/api/scheduled-messages${at(NOW)}`, { as, body: { clientId: w.client.id, text: 'Hi {first}', sendAt: later(60).toISOString(), ...body } }).then(r => r.item);
async function tagged(name, people) {
  const tag = (await w.ok('POST', '/api/tags', { as: w.coach, body: { name: `${name} ${newId('t')}` } })).tag;
  for (const p of people) await w.ok('PUT', `/api/coach/clients/${p.id}/tags`, { as: w.coach, body: { tagIds: [tag.id] } });
  return tag;
}
const draft = (body, as = w.coach) => w.ok('POST', '/api/broadcasts', { as, body: { name: 'News', body: 'Hi {first}, news!', ...body } }).then(r => r.broadcast);

test('a scheduled message is claimed once, even by two ticks at the same moment', async () => {
  const item = await schedule({});
  assert.equal(item.status, 'scheduled');
  await Promise.all([w.tick('outreach.send', later(61)), w.tick('outreach.send', later(61))]);
  assert.equal(count('messages', "via='scheduled'"), 1);
  await w.tick('outreach.send', later(62));
  assert.equal(count('messages', "via='scheduled'"), 1);
  const row = w.db.prepare('SELECT * FROM scheduled_messages WHERE id=?').get(item.id);
  assert.equal(row.status, 'sent');
  assert.ok(row.message_id);
});

test('two connections to one store never double-send', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jk-wp5-claim-'));
  try {
    const file = join(dir, 'db.sqlite');
    const a = openStore(file); runFeatureSchemas(a);
    const coachId = newId('u'), clientId = newId('u');
    a.prepare("INSERT INTO users (id, apple_sub, name, role, created_at) VALUES (?,?,'Coach C','coach',?)").run(coachId, `s-${coachId}`, nowIso());
    a.prepare("INSERT INTO users (id, apple_sub, name, role, coach_id, created_at) VALUES (?,?,'Cara Client','client',?,?)").run(clientId, `s-${clientId}`, coachId, nowIso());
    a.prepare("INSERT INTO scheduled_messages (id, coach_id, client_id, body, send_at, created_at) VALUES ('sm_x',?,?,'Hello {first}',?,?)").run(coachId, clientId, NOW.toISOString(), nowIso());
    const b = openStore(file); runFeatureSchemas(b);
    const config = { pushTransport: () => ({ status: 200 }) };
    assert.equal(sendDue(a, config, later(1)).sent, 1);
    assert.equal(sendDue(b, config, later(1)).sent, 0);
    assert.equal(b.prepare('SELECT text FROM messages').all().map(m => m.text).join('|'), 'Hello Cara');
    a.close(); b.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the text is rendered when it is sent: a name change in between shows', async () => {
  const renamed = w.user('Rob Before', 'client', w.coach.id);
  await schedule({ clientId: renamed.id, text: 'Morning {first}!' });
  w.db.prepare("UPDATE users SET name='Robyn After' WHERE id=?").run(renamed.id);
  await w.tick('outreach.send', later(61));
  assert.equal(w.db.prepare('SELECT text FROM messages WHERE client_id=?').get(renamed.id).text, 'Morning Robyn!');
});

test('sendAt must be in the future and at most 180 days ahead; edit and cancel only while scheduled', async () => {
  for (const sendAt of [later(-5).toISOString(), later(181 * 24 * 60).toISOString(), 'tomorrow']) {
    assert.equal((await w.call('POST', `/api/scheduled-messages${at(NOW)}`, { as: w.coach, body: { clientId: w.client.id, text: 'x', sendAt } })).status, 400, sendAt);
  }
  const item = await schedule({});
  const moved = (await w.ok('PATCH', `/api/scheduled-messages/${item.id}${at(NOW)}`, { as: w.coach, body: { text: 'Changed {first}', sendAt: later(120).toISOString() } })).item;
  assert.equal(moved.text, 'Changed {first}');
  await w.ok('DELETE', `/api/scheduled-messages/${item.id}`, { as: w.coach });
  assert.equal(w.db.prepare('SELECT status FROM scheduled_messages WHERE id=?').get(item.id).status, 'cancelled');
  assert.equal((await w.call('PATCH', `/api/scheduled-messages/${item.id}`, { as: w.coach, body: { text: 'again' } })).status, 409);
  assert.equal((await w.call('DELETE', `/api/scheduled-messages/${item.id}`, { as: w.coach })).status, 409);
  await w.tick('outreach.send', later(200));
  assert.equal(count('messages'), 0, 'a cancelled message never goes');
});

test('a broadcast freezes its recipients when it is scheduled', async () => {
  const late = w.user('Lou Later', 'client', w.coach.id);
  const tag = await tagged('Race', [w.client]);
  const b = await draft({ audience: { tagIds: [tag.id] } });
  const sent = (await w.ok('POST', `/api/broadcasts/${b.id}/send${at(NOW)}`, { as: w.coach, body: { sendAt: later(30).toISOString() } })).broadcast;
  assert.equal(sent.status, 'scheduled');
  assert.equal(sent.recipients, 1);
  // Someone tagged afterwards is not added.
  await w.ok('PUT', `/api/coach/clients/${late.id}/tags`, { as: w.coach, body: { tagIds: [tag.id] } });
  assert.equal((await w.call('PUT', `/api/broadcasts/${b.id}`, { as: w.coach, body: { name: 'Edit' } })).status, 409);
  await w.tick('outreach.send', later(31));
  assert.equal(count('messages', "via='broadcast'"), 1);
  assert.equal(count('messages', 'client_id=?', late.id), 0);
  const out = await w.ok('GET', `/api/broadcasts/${b.id}`, { as: w.coach });
  assert.equal(out.broadcast.status, 'sent');
  assert.equal(out.stats.delivered, 1);
  assert.equal(count('events', "type='broadcast.sent'"), 1);
});

test('a broadcast goes to at most 300 people, and a coach sends at most one a minute', async () => {
  const many = [];
  const insert = w.db.prepare("INSERT INTO users (id, apple_sub, name, role, coach_id, created_at) VALUES (?,?,?,'client',?,?)");
  for (let i = 0; i < 301; i++) { const id = newId('u'); insert.run(id, `bulk-${id}`, `Bulk ${i}`, w.coach.id, nowIso()); many.push(id); }
  try {
    const big = await draft({ audience: { clientIds: many } });
    const r = await w.call('POST', `/api/broadcasts/${big.id}/send${at(NOW)}`, { as: w.coach, body: {} });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /at most 300/);
    const a = await draft({ audience: { clientIds: [w.client.id] } });
    const b = await draft({ audience: { clientIds: [w.client.id] } });
    await w.ok('POST', `/api/broadcasts/${a.id}/send${at(NOW)}`, { as: w.coach, body: {} });
    assert.equal((await w.call('POST', `/api/broadcasts/${b.id}/send${at(later(0.5))}`, { as: w.coach, body: {} })).status, 429);
    await w.ok('POST', `/api/broadcasts/${b.id}/send${at(later(2))}`, { as: w.coach, body: {} });
  } finally {
    w.db.prepare(`DELETE FROM users WHERE id IN (SELECT value FROM json_each(?))`).run(JSON.stringify(many));
  }
});

test('quiet hours hold a broadcast and "no broadcasts" leaves a client out; a scheduled one-off goes exactly then', async () => {
  w.db.prepare("UPDATE coach_prefs SET value=? WHERE coach_id=? AND key='outreach.quietHours'").run(JSON.stringify({ start: '21:00', end: '07:30' }), w.coach.id);
  const quiet = w.user('Quinn Quiet', 'client', w.coach.id);
  await w.ok('PUT', `/api/coach/clients/${quiet.id}/outreach`, { as: w.coach, body: { noBroadcasts: true } });
  const night = new Date('2026-06-10T21:30:00Z'); // 22:30 BST
  const preview = await w.ok('POST', `/api/broadcasts/preview${at(night)}`, { as: w.coach, body: { audience: { clientIds: [w.client.id, quiet.id] }, body: 'Hi {first} {nope}' } });
  assert.equal(preview.count, 1);
  assert.equal(preview.skipped.noBroadcasts, 1);
  assert.deepEqual(preview.unknown, ['nope']);
  assert.equal(preview.samples[0].text, 'Hi Sam {nope}');
  // Unknown variables are refused at send time.
  const typo = await draft({ body: 'Hi {frist}', audience: { clientIds: [w.client.id] } });
  assert.equal((await w.call('POST', `/api/broadcasts/${typo.id}/send${at(night)}`, { as: w.coach, body: {} })).status, 400);
  const b = await draft({ audience: { clientIds: [w.client.id, quiet.id] } });
  const out = await w.ok('POST', `/api/broadcasts/${b.id}/send${at(night)}`, { as: w.coach, body: {} });
  assert.equal(out.broadcast.recipients, 1);
  assert.equal(count('messages', "via='broadcast'"), 0);
  assert.equal(count('deferred_messages', "via='broadcast' AND reason='quietHours'"), 1);
  assert.match(w.db.prepare('SELECT outcome FROM scheduled_messages WHERE broadcast_id=?').get(b.id).outcome, /^Held until/);
  // A one-off scheduled for 23:00 goes at 23:00, quiet hours or not.
  await w.ok('POST', `/api/scheduled-messages${at(night)}`, { as: w.coach, body: { clientId: w.client.id, text: 'Late one', sendAt: '2026-06-10T22:00:00Z' } });
  await w.tick('outreach.send', new Date('2026-06-10T22:00:30Z'));
  assert.equal(w.db.prepare("SELECT text FROM messages WHERE via='scheduled'").get().text, 'Late one');
  // The held broadcast goes out in the morning through the deferred sender, and the stats follow it.
  await w.tick('core.deferred', new Date('2026-06-11T06:31:00Z'));
  const stats = (await w.ok('GET', `/api/broadcasts/${b.id}`, { as: w.coach })).stats;
  assert.equal(stats.delivered, 1);
});

test('client.offboarded cancels everything still queued for the client', async () => {
  const item = await schedule({});
  emit(w.db, 'client.offboarded', { coachId: w.coach.id, clientId: w.client.id, exitReason: 'moved' });
  await w.settle();
  const row = w.db.prepare('SELECT * FROM scheduled_messages WHERE id=?').get(item.id);
  assert.equal(row.status, 'cancelled');
  assert.equal(row.error, 'coaching ended');
  await w.tick('outreach.send', later(120));
  assert.equal(count('messages'), 0);
});

test('stats: delivered, read and replied within 72 hours', async () => {
  const pat = w.user('Pat Two', 'client', w.coach.id);
  const b = await draft({ audience: { clientIds: [w.client.id, pat.id] } });
  await w.ok('POST', `/api/broadcasts/${b.id}/send${at(NOW)}`, { as: w.coach, body: {} });
  const sentAt = w.db.prepare("SELECT at FROM messages WHERE client_id=? AND via='broadcast'").get(w.client.id).at;
  w.db.prepare("UPDATE messages SET read_at=? WHERE via='broadcast'").run(later(10).toISOString());
  const reply = (clientId, mins) => w.db.prepare("INSERT INTO messages (id, client_id, from_id, from_role, text, at) VALUES (?,?,?,'client','Thanks!',?)")
    .run(newId('m'), clientId, clientId, new Date(Date.parse(sentAt) + mins * 60_000).toISOString());
  reply(w.client.id, 60);
  reply(pat.id, 80 * 60); // after 72 hours: not a reply
  const { broadcast, stats } = await w.ok('GET', `/api/broadcasts/${b.id}`, { as: w.coach });
  assert.deepEqual({ d: stats.delivered, r: stats.read, re: stats.replied, rp: stats.readPct, rr: stats.replyPct }, { d: 2, r: 2, re: 1, rp: 100, rr: 50 });
  assert.equal(broadcast.people.find(p => p.client.id === w.client.id).repliedAt !== null, true);
  const list = (await w.ok('GET', '/api/broadcasts', { as: w.coach })).broadcasts;
  assert.equal(list.find(x => x.id === b.id).stats.replied, 1);
});

test('isolation: foreign clients, segments and tags are 404; every route is 404 across coaches and 403 for clients', async () => {
  assert.equal((await w.call('POST', `/api/scheduled-messages${at(NOW)}`, { as: w.coach, body: { clientId: client2.id, text: 'x', sendAt: later(60).toISOString() } })).status, 404);
  const theirTag = (await w.ok('POST', '/api/tags', { as: { token: coach2.token }, body: { name: 'Theirs' } })).tag;
  assert.equal((await w.call('POST', '/api/broadcasts', { as: w.coach, body: { name: 'x', body: 'y', audience: { tagIds: [theirTag.id] } } })).status, 404);
  assert.equal((await w.call('POST', '/api/broadcasts/preview', { as: w.coach, body: { audience: { tagIds: [theirTag.id] }, body: 'y' } })).status, 404);
  // A foreign client id in a hand-picked audience is dropped, never sent to.
  const mixed = await draft({ audience: { clientIds: [w.client.id, client2.id] } });
  assert.deepEqual(mixed.audience.clientIds, [w.client.id]);
  const item = await schedule({});
  const b = await draft({ audience: { everyone: true } });
  const them = { token: coach2.token };
  const routes = [['PATCH', `/api/scheduled-messages/${item.id}`, { text: 'x' }], ['DELETE', `/api/scheduled-messages/${item.id}`],
    ['GET', `/api/broadcasts/${b.id}`], ['PUT', `/api/broadcasts/${b.id}`, { name: 'x' }], ['DELETE', `/api/broadcasts/${b.id}`], ['POST', `/api/broadcasts/${b.id}/send`, {}],
    ['GET', `/api/scheduled-messages?clientId=${w.client.id}`]];
  for (const [m, p, body] of routes) assert.equal((await w.call(m, p, { as: them, body })).status, 404, `${m} ${p}`);
  assert.equal((await w.ok('GET', '/api/scheduled-messages', { as: them })).items.length, 0);
  assert.equal((await w.ok('GET', '/api/broadcasts', { as: them })).broadcasts.length, 0);
  for (const [m, p, body] of [['GET', '/api/scheduled-messages'], ['POST', '/api/scheduled-messages', { clientId: w.client.id, text: 'x', sendAt: later(60).toISOString() }],
    ['GET', '/api/broadcasts'], ['POST', '/api/broadcasts', { name: 'x', body: 'y', audience: {} }], ['POST', '/api/broadcasts/preview', { audience: {} }], ['GET', '/api/outreach/summary'], ...routes]) {
    assert.equal((await w.call(m, p, { as: w.client, body })).status, 403, `client ${m} ${p}`);
  }
});

test('reassignment: the old coach no longer sees the row, and it fails "no longer your client" at send time', async () => {
  const mover = w.user('Mo Mover', 'client', w.coach.id);
  const item = await schedule({ clientId: mover.id });
  w.db.prepare('UPDATE users SET coach_id=? WHERE id=?').run(coach2.id, mover.id);
  assert.equal((await w.ok('GET', '/api/scheduled-messages', { as: w.coach })).items.some(i => i.id === item.id), false);
  assert.equal((await w.call('DELETE', `/api/scheduled-messages/${item.id}`, { as: w.coach })).status, 404);
  await w.tick('outreach.send', later(61));
  const row = w.db.prepare('SELECT * FROM scheduled_messages WHERE id=?').get(item.id);
  assert.equal(row.status, 'failed');
  assert.equal(row.error, 'no longer your client');
  assert.equal(count('messages', 'client_id=?', mover.id), 0);
});

test('drafts can be deleted, scheduled broadcasts cancelled, sent ones are kept', async () => {
  const d = await draft({ audience: { everyone: true } });
  await w.ok('DELETE', `/api/broadcasts/${d.id}`, { as: w.coach });
  assert.equal(count('broadcasts', 'id=?', d.id), 0);
  const s = await draft({ audience: { everyone: true } });
  await w.ok('POST', `/api/broadcasts/${s.id}/send${at(NOW)}`, { as: w.coach, body: { sendAt: later(90).toISOString() } });
  const cancelled = await w.ok('DELETE', `/api/broadcasts/${s.id}`, { as: w.coach });
  assert.equal(cancelled.broadcast.status, 'cancelled');
  await w.tick('outreach.send', later(100));
  assert.equal(count('messages', "via='broadcast'"), 0);
  const n = await draft({ audience: { clientIds: [w.client.id] } });
  await w.ok('POST', `/api/broadcasts/${n.id}/send${at(later(5))}`, { as: w.coach, body: {} });
  assert.equal((await w.call('DELETE', `/api/broadcasts/${n.id}`, { as: w.coach })).status, 409);
});

test('export and erasure: queued messages are in the client\'s export, and DELETE /api/me leaves nothing', async () => {
  const leaver = await w.signIn('helper-leaver', 'leaver@example.com', { givenName: 'Lee', familyName: 'Leaver' });
  await schedule({ clientId: leaver.id, text: 'Bye {first}' });
  const exp = await w.ok('GET', '/api/me/export', { as: leaver });
  assert.equal(exp.features.outreach.scheduledMessages[0].text, 'Bye {first}');
  await w.ok('DELETE', '/api/me', { as: leaver });
  assertNoRowsFor(w.db, leaver.id);
});
