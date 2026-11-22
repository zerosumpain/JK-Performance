import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../app.mjs';
import { seedCatalogue } from '../catalogue.mjs';
import { buildDemo } from '../demo.mjs';
import { issueSession } from '../auth.mjs';
import { newId, nowIso, openStore } from '../store.mjs';

// Plans a coach prices for their own clients, and a new client's first-run
// questions (onboarding).
let server, base, db, coach, client, otherCoach, newClient;
async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const plan = (out, id) => out.body.plans.find(p => p.id === id);

before(async () => {
  db = openStore(':memory:');
  seedCatalogue(db);
  buildDemo(db);
  server = createApp(db, {
    dataDir: '/tmp', appleAudience: 'com.jkperformance.app', coachEmails: [], primaryCoachEmail: null,
    supportEmail: 's@example.com', publicUrl: 'https://jk.example.com', gateServices: false, payments: false,
    demoCode: 'demo-client-code', demoCoachCode: 'demo-coach-code', fetchImpl: fetch, pushTransport: () => ({ status: 200 }),
    googleClientIds: [], appleServicesId: null,
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  coach = (await call('POST', '/api/auth/code', { body: { code: 'demo-coach-code' } })).body.token;
  client = (await call('POST', '/api/auth/code', { body: { code: 'demo-client-code' } })).body.token;
  const mk = (role, coachId) => {
    const id = newId('u');
    db.prepare('INSERT INTO users (id, apple_sub, name, role, coach_id, created_at) VALUES (?,?,?,?,?,?)').run(id, `t-${id}`, `${role} ${id}`, role, coachId, nowIso());
    return { id, token: issueSession(db, id) };
  };
  otherCoach = mk('coach', null);
  newClient = mk('client', otherCoach.id);
});
after(() => server.close());

test('plans come with the feature catalogue; signed out sees the defaults', async () => {
  const out = await call('GET', '/api/plans');
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.plans.map(p => p.id), ['none', 'foundation', 'performance', 'elite']);
  assert.ok(out.body.features.find(f => f.id === 'sessions').points.length);
  assert.equal(plan(out, 'performance').featured, true);
});

test('a coach reprices a plan; their clients see it, other coaches and clients do not', async () => {
  const put = await call('PUT', '/api/coach/plans/elite', { token: coach, body: { name: 'Elite+', monthlyPence: 17900, annualPence: 180000, credits: 5, featured: true } });
  assert.equal(put.status, 200);
  assert.equal(plan(put, 'elite').monthlyPence, 17900);
  assert.equal(plan(put, 'performance').featured, false, 'one plan is most popular at a time');

  const seen = await call('GET', '/api/plans', { token: client });
  assert.equal(plan(seen, 'elite').name, 'Elite+');
  const me = (await call('GET', '/api/me', { token: client })).body;
  assert.equal(me.membership.planName, 'Elite+');
  assert.equal(me.membership.creditsTotal, 5, 'credits follow the plan');

  assert.equal(plan(await call('GET', '/api/plans', { token: otherCoach.token }), 'elite').monthlyPence, 14900);
  assert.equal(plan(await call('GET', '/api/plans', { token: newClient.token }), 'elite').name, 'Elite');
});

test('plan edits are checked and coach-only', async () => {
  assert.equal((await call('PUT', '/api/coach/plans/elite', { token: client, body: { monthlyPence: 1 } })).status, 403);
  assert.equal((await call('PUT', '/api/coach/plans/gold', { token: coach, body: {} })).status, 404);
  assert.equal((await call('PUT', '/api/coach/plans/elite', { token: coach, body: { monthlyPence: 12.5 } })).status, 400);
  assert.equal((await call('PUT', '/api/coach/plans/elite', { token: coach, body: { features: ['teleport'] } })).status, 400);
  assert.equal((await call('PUT', '/api/coach/plans/none', { token: coach, body: { monthlyPence: 500 } })).status, 400, 'free stays free');
  assert.equal((await call('PUT', '/api/coach/plans/foundation', { token: coach, body: { features: ['programme', 'sessions'] } })).status, 400, 'sessions need credits');
  const ok = await call('PUT', '/api/coach/plans/foundation', { token: coach, body: { features: ['guides', 'programme', 'programme'], detail: 'Just the plan' } });
  assert.deepEqual(plan(ok, 'foundation').features, ['programme', 'guides'], 'catalogue order, no repeats');
});

test('business numbers price each day at the price of that day', async () => {
  const before = (await call('GET', '/api/coach/business', { token: coach })).body;
  // Reset puts the defaults back and records the price change.
  const reset = await call('POST', '/api/coach/plans/reset', { token: coach });
  assert.equal(plan(reset, 'elite').monthlyPence, 14900);
  const after = (await call('GET', '/api/coach/business', { token: coach })).body;
  const elite = db.prepare("SELECT COUNT(*) n FROM users WHERE is_demo=1 AND role='client' AND plan='elite'").get().n;
  assert.equal(before.mrrPence - after.mrrPence, elite * (17900 - 14900));
  assert.equal(after.plans.find(p => p.id === 'elite').monthlyPence, 14900);
  // Yesterday's figure is unchanged: those days were priced before any edit.
  assert.equal(after.series[after.series.length - 2].pence, before.series[before.series.length - 2].pence);
});

test('a new client answers the first-run questions once', async () => {
  let me = (await call('GET', '/api/me', { token: newClient.token })).body;
  assert.equal(me.onboarded, false);
  assert.equal(me.profile, null);
  assert.equal((await call('GET', '/api/me', { token: client })).body.onboarded, true, 'demo accounts skip it');
  assert.equal((await call('GET', '/api/me', { token: coach })).body.onboarded, true);

  assert.equal((await call('PUT', '/api/me/onboarding', { token: newClient.token, body: { goals: ['flying'] } })).status, 400);
  assert.equal((await call('PUT', '/api/me/onboarding', { token: coach, body: {} })).status, 403);
  me = (await call('PUT', '/api/me/onboarding', { token: newClient.token, body: { goals: ['muscle', 'strength'], experience: 'some', daysPerWeek: 4, preferredTime: 'evening', injuries: ' Left knee ' } })).body;
  assert.equal(me.onboarded, true);
  assert.deepEqual(me.profile.goals, ['strength', 'muscle']);
  assert.equal(me.profile.injuries, 'Left knee');

  const detail = (await call('GET', `/api/coach/clients/${newClient.id}`, { token: otherCoach.token })).body;
  assert.equal(detail.profile.daysPerWeek, 4, 'the coach sees the answers');
});

test('existing accounts count as onboarded when the column arrives', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jk-onb-'));
  const path = join(dir, 'jk.sqlite');
  const first = openStore(path);
  first.exec('ALTER TABLE users DROP COLUMN onboarded_at');
  first.prepare("INSERT INTO users (id, name, role, created_at) VALUES ('u1','Old','client','2026-01-01T00:00:00Z')").run();
  first.close();
  const next = openStore(path); // the next start runs the migration
  assert.equal(next.prepare("SELECT onboarded_at FROM users WHERE id='u1'").get().onboarded_at, '2026-01-01T00:00:00Z');
  next.close();
  rmSync(dir, { recursive: true });
});
