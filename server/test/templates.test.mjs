/**
 * F16 Message templates and snippets (docs/design/desk-v2.md, WP5). A stand-in
 * feature adds a `{balance}` variable through the registry, as billing will.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const SERVER = new URL('../', import.meta.url);
const FIXTURES = mkdtempSync(join(tmpdir(), 'jk-wp5-tpl-'));
for (const n of ['automations', 'outreach', 'templates']) {
  writeFileSync(join(FIXTURES, `${n}.mjs`), `export { feature } from ${JSON.stringify(new URL(`features/${n}.mjs`, SERVER).href)};\n`);
}
writeFileSync(join(FIXTURES, 'money.mjs'), `export const feature = {
  name: 'money', namespaces: ['money'],
  variables: { balance: { label: 'Balance owed', example: '£40', value: (db, coachId, client) => client.name.startsWith('Sam') ? '£40' : null } },
};\n`);
process.env.NODE_ENV = 'test';
process.env.FEATURES_DIR = FIXTURES;

const { makeWorld, assertNoRowsFor } = await import('./helpers.mjs');
const { allVariables } = await import('../registry.mjs');

let w, coach2, client2;
before(async () => {
  w = await makeWorld();
  coach2 = await w.signIn('helper-coach2', 'coach2@example.com', { givenName: 'Other', familyName: 'Coach' });
  client2 = w.user('Ola Other', 'client', coach2.id);
});
after(() => { w.close(); rmSync(FIXTURES, { recursive: true, force: true }); });

const make = (body, as = w.coach) => w.ok('POST', '/api/templates', { as, body }).then(r => r.template);

test('a feature variable reaches templates through the registry', () => {
  assert.ok(allVariables().some(v => v.name === 'balance' && v.feature === 'money'));
});

test('rendering fills built-in and feature variables and reports what is missing', async () => {
  const t = await make({ name: 'Balance chase', body: 'Hi {first}, {coachFirst} here. You owe {balance}. {frist}?', category: 'billing', shortcut: '/Balance' });
  assert.equal(t.shortcut, 'balance');
  assert.deepEqual(t.variables, ['first', 'coachFirst', 'balance', 'frist']);
  const r = await w.ok('POST', '/api/templates/render', { as: w.coach, body: { templateId: t.id, clientId: w.client.id } });
  assert.equal(r.text, 'Hi Sam, John here. You owe £40. {frist}?');
  assert.deepEqual(r.missing, ['frist']);
  // A feature variable with no value is empty, not invented.
  const other = w.user('Pat Plain', 'client', w.coach.id);
  const r2 = await w.ok('POST', '/api/templates/render', { as: w.coach, body: { text: 'You owe {balance}. Next: {nextSession}', clientId: other.id } });
  assert.equal(r2.text, 'You owe . Next: ');
  assert.deepEqual(r2.empty.sort(), ['balance', 'nextSession']);
  const vars = await w.ok('GET', '/api/templates/variables', { as: w.coach });
  assert.deepEqual(vars.variables.find(v => v.name === 'balance'), { name: 'balance', label: 'Balance owed', example: '£40', feature: 'money' });
  assert.equal(vars.variables.find(v => v.name === 'first').example, 'Sam');
});

test('a shortcut is unique per coach, and may repeat across coaches', async () => {
  await make({ name: 'Check-in', body: 'How was the week, {first}?', shortcut: 'checkin', category: 'checkin' });
  const dup = await w.call('POST', '/api/templates', { as: w.coach, body: { name: 'Another', body: 'x', shortcut: '/CHECKIN' } });
  assert.equal(dup.status, 409);
  const theirs = await make({ name: 'Their check-in', body: 'Yo {first}', shortcut: 'checkin' }, { token: coach2.token });
  assert.equal(theirs.shortcut, 'checkin');
  // Renaming onto a taken shortcut is refused; keeping your own is fine.
  const mine = await make({ name: 'Great', body: 'Great work {first}', shortcut: 'great', category: 'celebrate' });
  assert.equal((await w.call('PUT', `/api/templates/${mine.id}`, { as: w.coach, body: { shortcut: 'checkin' } })).status, 409);
  assert.equal((await w.ok('PUT', `/api/templates/${mine.id}`, { as: w.coach, body: { shortcut: 'great', name: 'Great session' } })).template.name, 'Great session');
  assert.equal((await w.call('POST', '/api/templates', { as: w.coach, body: { name: 'Bad', body: 'x', shortcut: 'no spaces' } })).status, 400);
  assert.equal((await w.call('POST', '/api/templates', { as: w.coach, body: { name: 'Bad', body: 'x', category: 'spam' } })).status, 400);
});

test('using a template counts it', async () => {
  const t = await make({ name: 'Used', body: 'x' });
  await w.ok('POST', `/api/templates/${t.id}/used`, { as: w.coach });
  const after = (await w.ok('POST', `/api/templates/${t.id}/used`, { as: w.coach })).template;
  assert.equal(after.uses, 2);
  assert.ok(after.lastUsedAt);
});

test('isolation: every template route is 404 across coaches, and 403 for a client', async () => {
  const t = await make({ name: 'Private', body: 'Hello {first}' });
  const them = { token: coach2.token };
  const routes = [['GET', `/api/templates/${t.id}`], ['PUT', `/api/templates/${t.id}`, { name: 'x' }], ['DELETE', `/api/templates/${t.id}`],
    ['POST', `/api/templates/${t.id}/used`], ['POST', '/api/templates/render', { templateId: t.id, clientId: client2.id }]];
  for (const [m, p, body] of routes) assert.equal((await w.call(m, p, { as: them, body })).status, 404, `${m} ${p}`);
  // Rendering for someone else's client is a 404 too.
  assert.equal((await w.call('POST', '/api/templates/render', { as: w.coach, body: { text: 'Hi {first}', clientId: client2.id } })).status, 404);
  assert.ok(!(await w.ok('GET', '/api/templates', { as: them })).templates.some(x => x.id === t.id));
  for (const [m, p, body] of [['GET', '/api/templates'], ['POST', '/api/templates', { name: 'x', body: 'y' }], ['GET', '/api/templates/variables'], ...routes]) {
    assert.equal((await w.call(m, p, { as: w.client, body })).status, 403, `client ${m} ${p}`);
  }
  assert.equal((await w.ok('GET', `/api/templates/${t.id}`, { as: w.coach })).template.name, 'Private');
});

test('a coach\'s templates are in their export and go with them', async () => {
  const exp = await w.ok('GET', '/api/me/export', { as: { token: coach2.token } });
  assert.ok(exp.features.templates.templates.some(t => t.shortcut === 'checkin'));
  w.db.prepare('DELETE FROM users WHERE id=?').run(client2.id);
  w.db.prepare('DELETE FROM users WHERE id=?').run(coach2.id);
  assertNoRowsFor(w.db, coach2.id);
});
