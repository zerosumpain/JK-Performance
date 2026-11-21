import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../app.mjs';
import { issueSession } from '../auth.mjs';
import { seedCatalogue } from '../catalogue.mjs';
import { newId, nowIso, openStore } from '../store.mjs';
import { addTestClients, removeTestClients } from '../testclients.mjs';

test('made-up clients fill a real coach\'s lists and leave without a trace', async () => {
  const db = openStore(':memory:');
  seedCatalogue(db);
  const coachId = newId('u');
  db.prepare("INSERT INTO users (id, apple_sub, email, name, role, created_at) VALUES (?,?,?,?,'coach',?)").run(coachId, 'real-coach', 'c@example.com', 'John Kelly', nowIso());
  const before = Object.fromEntries(['workouts', 'messages', 'bookings', 'reports', 'checkins', 'health_samples'].map(t => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));
  const added = addTestClients(db, coachId);
  assert.equal(added.length, 10);
  assert.throws(() => addTestClients(db, coachId), /already exist/);
  // Every exercise resolved to the catalogue.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM workout_items i LEFT JOIN exercises e ON e.id=i.exercise_id WHERE e.id IS NULL').get().n, 0);

  const config = { appleAudience: 'x', coachEmails: [], supportEmail: 's@example.com', publicUrl: 'https://x', gateServices: false, payments: false, fetchImpl: fetch, dataDir: '/tmp' };
  const server = createApp(db, config);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = issueSession(db, coachId);
  const get = async path => { const r = await fetch(base + path, { headers: { authorization: `Bearer ${token}` } }); assert.equal(r.status, 200, path); return r.json(); };
  const clients = await get('/api/coach/clients');
  assert.equal((clients.clients ?? clients).length, 10);
  const today = await get('/api/coach/today');
  assert.ok(today.feedbackDue.clients.length >= 8, 'last week\'s feedback is due');
  assert.ok(today.checkinsToReview >= 5 || today.checkinsToReview?.length >= 5, 'check-ins wait for review');
  const threads = await get('/api/threads');
  assert.ok(threads.threads.filter(t => t.unread > 0).length >= 3);
  server.close();

  const removed = removeTestClients(db);
  assert.equal(removed.users, 10);
  for (const [t, n] of Object.entries(before)) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, n, t);
});
