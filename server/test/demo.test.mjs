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

test('Sam\'s Today reads like the design; the demo coach gets a portrait from a file when one is given', async () => {
  const { todayFor } = await import('../today.mjs');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const db = openStore(':memory:');
  seedCatalogue(db);
  const dataDir = mkdtempSync(join(tmpdir(), 'jk-demo-'));
  const file = join(dataDir, 'portrait.jpg');
  writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]));
  process.env.DEMO_COACH_PORTRAIT_FILE = file;
  try {
    seedDemo(db, londonDay(), { dataDir });
  } finally {
    delete process.env.DEMO_COACH_PORTRAIT_FILE;
  }
  const sam = db.prepare("SELECT * FROM users WHERE apple_sub='demo-client'").get();
  const t = todayFor(db, { dataDir }, sam);
  assert.equal(t.goal.title, 'Down to 75 kg by March');
  assert.equal(t.goal.remainingLabel, '4.8 kg to go');
  // Plan. Act. Review.: the board's three habits and the letter from Sunday's session.
  assert.deepEqual(t.habits.map(h => h.name), ['Protein at every meal', 'A walk after lunch', 'Lights out by eleven']);
  assert.deepEqual(t.habits.map(h => h.iconKey), ['protein', 'steps', 'sleep']);
  assert.equal(t.coachLine.source, 'letter');
  assert.ok(['The run slipped again, so we\'ve made it smaller.', 'Steady is exactly right, Sam.'].includes(t.coachLine.text), t.coachLine.text);
  assert.equal(t.week.length, 7);
  assert.ok(t.consistency.done > 15, JSON.stringify(t.consistency));
  const letters = db.prepare("SELECT * FROM reports WHERE client_id=? AND headline IS NOT NULL AND question IS NOT NULL AND media_id IS NULL").all(sam.id);
  assert.ok(letters.length >= 3);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM checkins WHERE client_id=? AND win IS NOT NULL AND stress IS NOT NULL").get(sam.id).n >= 10);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM workouts WHERE client_id=? AND feel IS NOT NULL").get(sam.id).n >= 20);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE client_id=? AND kind='letter' AND read_at IS NULL").get(sam.id).n, 0, 'no flood of letter notes');
  const coach = db.prepare("SELECT * FROM users WHERE apple_sub='demo-coach'").get();
  const avatar = JSON.parse(coach.coach_settings).avatarMediaId;
  assert.match(avatar, /^md_/);
  // Without a file nothing breaks and nothing changes.
  seedDemo(db, addDays(londonDay(), 1), { dataDir });
  assert.equal(JSON.parse(db.prepare("SELECT coach_settings FROM users WHERE apple_sub='demo-coach'").get().coach_settings).avatarMediaId, avatar);
});
