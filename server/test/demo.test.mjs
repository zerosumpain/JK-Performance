import assert from 'node:assert/strict';
import { test } from 'node:test';
import { issueSession, sessionUser } from '../auth.mjs';
import { seedCatalogue } from '../catalogue.mjs';
import { buildDemo, seedDemo } from '../demo.mjs';
import { openStore } from '../store.mjs';
import { addDays, londonDay } from '../time.mjs';

test('the demo world has months of history and a nightly rebuild keeps everyone signed in', () => {
  const db = openStore(':memory:');
  seedCatalogue(db);
  assert.equal(seedDemo(db), true);
  assert.equal(seedDemo(db), false, 'once a day');
  const sam = db.prepare("SELECT * FROM users WHERE apple_sub='demo-client'").get();
  const token = issueSession(db, sam.id);
  const count = sql => db.prepare(sql).get(sam.id).n;
  const before = {
    done: count('SELECT COUNT(*) n FROM workouts WHERE client_id=? AND completed_at IS NOT NULL'),
    weights: count("SELECT COUNT(*) n FROM measurements WHERE user_id=? AND kind='weight'"),
    reports: count('SELECT COUNT(*) n FROM reports WHERE client_id=? AND published_at IS NOT NULL'),
  };
  assert.ok(before.done >= 30, `${before.done} workouts done`);
  assert.ok(before.weights >= 20 && before.reports >= 12, JSON.stringify(before));
  assert.ok(db.prepare('SELECT MIN(date) d FROM workouts WHERE client_id=?').get(sam.id).d <= addDays(londonDay(), -100), 'about four months back');
  // Loads climb: the last back squat is heavier than the first.
  const squats = db.prepare(`SELECT l.load FROM set_logs l JOIN workout_items i ON i.id=l.item_id JOIN workouts w ON w.id=i.workout_id
    WHERE w.client_id=? AND i.exercise_id='ex_back-squat' ORDER BY w.date`).all(sam.id).map(r => Number.parseFloat(r.load));
  assert.ok(squats.at(-1) > squats[0], `${squats[0]} → ${squats.at(-1)}`);

  buildDemo(db, addDays(londonDay(), 1));
  assert.equal(db.prepare("SELECT id FROM users WHERE apple_sub='demo-client'").get().id, sam.id);
  assert.equal(sessionUser(db, { headers: { authorization: `Bearer ${token}` } })?.id, sam.id, 'still signed in');
  assert.equal(count('SELECT COUNT(*) n FROM workouts WHERE client_id=? AND completed_at IS NOT NULL') > 0, true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE is_demo=0").get().n, 0, 'nothing real touched');
});
