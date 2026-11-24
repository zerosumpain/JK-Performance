import { recordPlan } from './account.mjs';
import { setUpClient } from './auth.mjs';
import { WELCOME_MESSAGE } from './catalogue.mjs';
import { FORM_TEMPLATES } from './forms.mjs';
import { readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coachSettings, saveCoachSettings } from './settings.mjs';
import { insertMediaRow, mediaFilePath, storeMedia, writeMediaFile } from './media.mjs';
import { FEATURES, ensureFeatureSchemas } from './registry.mjs';
import { rng } from './rng.mjs';
import { afterCommit, newId, nowIso, tx } from './store.mjs';
import { buildPerson, programWorkouts, sampleProfile } from './testclients.mjs';
import { addDays, londonClock, londonDay, londonToUtc, mondayOf } from './time.mjs';

/**
 * A self-contained demo world for App Review, the coach's "preview as a
 * client", and local testing: a demo coach, "Sam Carter" (the client a
 * DEMO_CODE signs in as) and five other clients. Sam has four months of
 * history, so every screen has trends to show: lifts climbing, weight and
 * waist coming down, resting heart rate easing, a check-in and feedback for
 * every week, a message thread, food, habits and Apple Health.
 *
 * Every demo account is `is_demo=1` and belongs to the demo coach, so none of
 * it appears in a real coach's lists or numbers.
 *
 * Dates are relative to the day it's built, so the world is rebuilt each
 * night (`startDemoClock`): the accounts keep their ids, and so their
 * sign-ins, while everything they hold is made again around the new today.
 */

const H = 24; // hours in a day, for message times
const SAM_THREAD = [
  ['coach', 'Welcome aboard, Sam! Fill in the intake form when you get a minute and I\'ll build your first block around it.', 112 * H],
  ['client', 'Done! Really looking forward to this.', 112 * H - 5],
  ['coach', 'First block is on your calendar: three days, lower / upper / full body. Log every set, even the bad ones.', 110 * H],
  ['client', 'Squats felt heavy today but got them all.', 96 * H],
  ['coach', 'That\'s the point of week one. We find your numbers, then we build.', 96 * H - 2],
  ['client', 'Down 1.5 kg already!', 70 * H],
  ['coach', 'Brilliant. Keep protein at breakfast and it keeps coming.', 70 * H - 1],
  ['client', 'Missed Wednesday, work trip. Can I do it Saturday?', 45 * H],
  ['coach', 'Yes, move it. Just leave a day before Monday\'s squats.', 45 * H - 1],
  ['client', 'New squat PB. 102.5 for 5!', 9 * H],
  ['coach', 'Massive. That was 85 when you started.', 9 * H - 2],
  ['coach', 'Morning Sam. I bumped the split squats to 2×20 kg today. You moved well last week.', 20],
  ['client', 'Sounds good. Left knee was a bit tight on Tuesday though.', 19],
  ['coach', 'Noted. Do the 10 min mobility block first and we\'ll check it at our 1:1.', 18.5],
];

const DEMO_CLIENTS = [
  { sub: 'demo-client', name: 'Sam Carter', plan: 'elite', routine: 'strength', days: [0, 2, 4], time: '07:00', adherence: 0.9, weeks: 16,
    weight: [84.6, 79.8], bodyFat: [21.5, 17.2], waist: [91, 84], rhr: [62, 55], shares: true, oneToOne: [2, '11:00', 'inperson'], fortnightly: true,
    goal: 'Squat 120 kg and get under 80 kg', checkin: [4, 4, ['Knee'], 'Left knee tight after split squats, fine by Thursday.'], thread: SAM_THREAD,
    win: 'Squat 102.5 for 5, felt fast.', struggle: 'Late nights Tuesday and Wednesday.',
    // Today reads like the design: a weight goal 4.8 kg away, a letter with an Adjust line.
    goalSpec: { title: 'Down to 75 kg by March', metric: 'weight', unit: 'kg', baseline: 84.6, target: 75, why: 'To feel strong again after two years off.' },
    // Plan. Act. Review.: the board's three habits, season, priorities, sessions, reflections and commitments (testclients.mjs buildPar).
    habits: [['Protein at every meal', 'check', 1, '', 'protein'], ['A walk after lunch', 'check', 1, '', 'steps'], ['Lights out by eleven', 'check', 1, '', 'sleep']],
    par: true,
    restDays: [[2, 'Travelling for work']],
    letters: [
      { headline: 'Steady is exactly right, Sam.', keep: 'You spotted the link between the walk and your sleep yourself.', adjust: 'The run slipped again, so we\'ve made it smaller.',
        summary: 'Steady is exactly right, Sam. You spotted the link between the walk and your sleep yourself. The run slipped again, so we\'ve made it smaller.',
        question: 'What made the walk easier to keep?', answer: null },
      { headline: 'The work trip did not break the week.', keep: 'You moved Wednesday to Saturday instead of skipping it.', adjust: 'Ten minutes of mobility before every lower session.',
        question: 'What got in the way on Thursday?', answer: 'Late meeting. I will train first thing on Thursdays.' },
      { headline: 'Down 1.5 kg, and stronger with it.', keep: 'Protein at breakfast five days out of seven.', adjust: 'Same plan, small load increases where the last set felt easy.',
        question: 'Which session did you enjoy most?', answer: null },
    ] },
  { sub: 'demo-priya', name: 'Priya Shah', plan: 'elite', routine: 'hybrid', days: [0, 1, 3, 5], time: '06:00', adherence: 0.92, weeks: 12,
    weight: [63.0, 61.4], shares: true, runner: true, oneToOne: [1, '07:00', 'video'], checkin: [5, 4, [], 'Engine feels better every week.'],
    unread: 'Can we add a second run this week? Race is in five weeks.' },
  { sub: 'demo-alex', name: 'Alex Morgan', plan: 'performance', routine: 'hypertrophy', days: [0, 2, 4, 5], time: '18:30', adherence: 0.8, weeks: 12,
    weight: [78.0, 80.1], shares: true, checkin: [4, 3, [], 'Work was mad but got all four in.'], latestReviewed: true },
  { sub: 'demo-leo', name: 'Leo Grant', plan: 'foundation', routine: 'mobility', days: [0, 3], time: '20:00', adherence: 0.6, weeks: 8,
    weight: [92.0, 90.6], shares: false, checkin: [2, 2, ['Lower back'], 'Back flared up at my desk again.'] },
  { sub: 'demo-rory', name: 'Rory Kane', plan: 'performance', routine: 'running', days: [1, 3, 6], time: '06:30', adherence: 0.85, weeks: 6,
    weight: [72.4, 71.0], shares: true, runner: true, oneToOne: [3, '18:30', 'video'], fortnightly: true, checkin: [4, 4, ['Calf'], 'Calf tight after intervals.'] },
  { sub: 'demo-tom', name: 'Tom Burke', plan: 'foundation', routine: 'fatLoss', days: [1, 4], time: '19:00', adherence: 0.5, weeks: 3,
    weight: [101.2, 99.8], shares: false, quiet: true, checkin: null },
];

/** The demo coach and clients, made once; their ids then stay for good. */
function ensureAccounts(db, today) {
  const at = d => londonToUtc(d, '09:00').toISOString();
  let coach = db.prepare("SELECT * FROM users WHERE apple_sub='demo-coach'").get();
  if (!coach) {
    db.prepare("INSERT INTO users (id, apple_sub, email, name, role, is_demo, created_at) VALUES (?,?,NULL,'Coach JK','coach',1,?)")
      .run(newId('u'), 'demo-coach', at(addDays(today, -200)));
    coach = db.prepare("SELECT * FROM users WHERE apple_sub='demo-coach'").get();
  }
  const clients = DEMO_CLIENTS.map(p => {
    let u = db.prepare('SELECT * FROM users WHERE apple_sub=?').get(p.sub);
    if (!u) {
      db.prepare("INSERT INTO users (id, apple_sub, email, name, role, coach_id, is_demo, created_at) VALUES (?,?,NULL,?,'client',?,1,?)")
        .run(newId('u'), p.sub, p.name, coach.id, nowIso());
      u = db.prepare('SELECT * FROM users WHERE apple_sub=?').get(p.sub);
    }
    return { p, user: u };
  });
  return { coach, clients };
}

// Everything a demo account holds, by owner column. Photos stay (they're files too).
const CLIENT_TABLES = ['workouts', 'habits', 'nutrition_targets', 'nutrition_entries', 'checkins', 'messages', 'reports', 'form_requests', 'autoflow_runs', 'goals', 'rest_days', 'priorities', 'preps', 'commitments', 'reflection_drafts'];
const USER_TABLES = ['measurements', 'health_samples', 'health_activities', 'challenge_members', 'class_attendees', 'membership_events'];
const COACH_TABLES = ['bookings', 'programs', 'challenges', 'forms', 'autoflows', 'plan_settings', 'plan_price_events'];

// Media that survive a rebuild: the reusable demo fixtures (purpose demo:<key>),
// plus the portrait and signature the coach's settings point at (wipe adds those
// by id, so extra uploads through the public demo code do not pile up).
const KEPT_MEDIA = "purpose LIKE 'demo:%'";
// Desk preferences (desk.*) kept per demo account across a rebuild: the most recently written ones.
const KEPT_DESK_PREFS = 40;

/**
 * Empty the demo accounts for a rebuild: the foundation tables, every
 * feature's demo.tables (features later in name order first), the existing
 * lists, and media the demo accounts uploaded (their files go after commit).
 * Desk layout and theme preferences (desk.*) are kept, the 40 most recent per account.
 */
function wipe(db, config, coach, clients) {
  const ids = [coach.id, ...clients.map(c => c.user.id)];
  const json = JSON.stringify(ids);
  const IN = 'IN (SELECT value FROM json_each(?))';
  db.prepare(`DELETE FROM event_failures WHERE seq IN (SELECT seq FROM events WHERE coach_id ${IN} OR client_id ${IN})`).run(json, json);
  db.prepare(`DELETE FROM events WHERE coach_id ${IN} OR client_id ${IN}`).run(json, json);
  for (const t of ['coach_notifications', 'ai_calls', 'deferred_messages', 'client_outreach']) db.prepare(`DELETE FROM ${t} WHERE coach_id ${IN}`).run(json);
  for (const t of ['ai_calls', 'deferred_messages', 'client_outreach', 'client_tags']) db.prepare(`DELETE FROM ${t} WHERE client_id ${IN}`).run(json);
  for (const t of ['ai_settings', 'tags', 'segments']) db.prepare(`DELETE FROM ${t} WHERE coach_id ${IN}`).run(json);
  db.prepare(`DELETE FROM coach_prefs WHERE coach_id ${IN} AND key NOT LIKE 'desk.%'`).run(json);
  db.prepare(`DELETE FROM coach_prefs WHERE coach_id ${IN} AND rowid NOT IN (
    SELECT rowid FROM (SELECT rowid, ROW_NUMBER() OVER (PARTITION BY coach_id ORDER BY updated_at DESC, key) n FROM coach_prefs WHERE coach_id ${IN}) WHERE n<=?)`)
    .run(json, json, KEPT_DESK_PREFS);
  for (const f of [...FEATURES].reverse()) {
    const t = f.demo?.tables ?? {};
    for (const table of t.client ?? []) db.prepare(`DELETE FROM ${table} WHERE client_id ${IN}`).run(json);
    for (const table of t.user ?? []) db.prepare(`DELETE FROM ${table} WHERE user_id ${IN}`).run(json);
    for (const table of t.coach ?? []) db.prepare(`DELETE FROM ${table} WHERE coach_id ${IN}`).run(json);
  }
  for (const { user } of clients) {
    for (const t of CLIENT_TABLES) db.prepare(`DELETE FROM ${t} WHERE client_id=?`).run(user.id);
    for (const t of USER_TABLES) db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(user.id);
  }
  for (const t of COACH_TABLES) db.prepare(`DELETE FROM ${t} WHERE coach_id=?`).run(coach.id);
  const s = coachSettings(db, coach.id);
  const keep = JSON.stringify([s.avatarMediaId, s.signatureMediaId].filter(Boolean));
  const media = db.prepare(`SELECT id, ext FROM media WHERE (owner_id ${IN} OR client_id ${IN}) AND NOT (${KEPT_MEDIA}) AND id NOT IN (SELECT value FROM json_each(?))`).all(json, json, keep);
  for (const m of media) db.prepare('DELETE FROM media WHERE id=?').run(m.id);
  if (config?.dataDir && media.length) afterCommit(() => { for (const m of media) rmSync(mediaFilePath(config, m), { force: true }); });
}

const SERVER_DIR = fileURLToPath(new URL('./', import.meta.url));

/**
 * Write the files for demo fixtures that have no row yet (features' demo.media),
 * BEFORE the build's transaction. Returns Map<key, file>; rows are inserted by
 * ctx.media inside the transaction.
 */
function prepareFixtures(db, config) {
  const files = new Map();
  if (!config?.dataDir) return files;
  const coach = db.prepare("SELECT id FROM users WHERE apple_sub='demo-coach'").get();
  for (const f of FEATURES) {
    for (const m of f.demo?.media ?? []) {
      if (coach && db.prepare('SELECT 1 FROM media WHERE owner_id=? AND purpose=?').get(coach.id, `demo:${m.key}`)) continue;
      try {
        const bytes = readFileSync(isAbsolute(m.file) ? m.file : join(SERVER_DIR, m.file));
        files.set(m.key, { ...writeMediaFile(config, { bytes, mime: m.mime }), durationSec: m.durationSec ?? null });
      } catch (e) {
        console.warn(`Demo fixture ${f.name}/${m.key} skipped: ${e.message}`);
      }
    }
  }
  return files;
}

/**
 * JK's portrait for the demo coach, from DEMO_COACH_PORTRAIT_FILE (a JPEG or
 * PNG outside the repo). Stored once as media; no file means the apps fall
 * back to the monogram. Never throws.
 */
export function demoPortrait(db, config, file = process.env.DEMO_COACH_PORTRAIT_FILE) {
  if (!file || !config?.dataDir) return false;
  try {
    const coach = db.prepare("SELECT * FROM users WHERE apple_sub='demo-coach'").get();
    if (!coach) return false;
    const s = coachSettings(db, coach.id);
    if (s.avatarMediaId && db.prepare('SELECT 1 FROM media WHERE id=?').get(s.avatarMediaId)) return false;
    const bytes = readFileSync(file);
    const mime = bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';
    const m = storeMedia(db, config, { ownerId: coach.id, bytes, mime, purpose: 'avatar' });
    saveCoachSettings(db, coach.id, { ...s, avatarMediaId: m.id });
    return true;
  } catch (e) {
    console.warn(`Demo portrait not set: ${e.message}`);
    return false;
  }
}

/**
 * Build (or rebuild) the whole demo world around `today`. Each feature's
 * demo.build(db, ctx) runs inside the same transaction, after the library, in
 * feature-name order. Builders write rows directly and never emit, send or notify.
 */
export function buildDemo(db, today = londonDay(), config = null) {
  // Feature tables must exist before the wipe and the builders touch them, even when a test builds the demo before createApp.
  ensureFeatureSchemas(db);
  const fixtures = prepareFixtures(db, config);
  try {
    buildInTx(db, today, config, fixtures);
  } catch (e) {
    // The rows rolled back, so the fixture files written for them are orphans.
    for (const file of fixtures.values()) rmSync(mediaFilePath(config, file), { force: true });
    throw e;
  }
}

function buildInTx(db, today, config, fixtures) {
  tx(db, () => {
    const { coach, clients } = ensureAccounts(db, today);
    wipe(db, config, coach, clients);
    const at = (d, t = '09:00') => londonToUtc(d, t).toISOString();
    const monday = mondayOf(today);

    // Saturday conditioning class, the last four weeks and the next three.
    const classIds = [];
    for (let w = -4; w <= 3; w++) {
      const d = addDays(monday, 7 * w + 5);
      const id = newId('b');
      db.prepare("INSERT INTO bookings (id, coach_id, kind, start, end, location, title, capacity, created_at) VALUES (?,?,'group',?,?,?,?,12,?)")
        .run(id, coach.id, at(d, '08:00'), at(d, '09:00'), 'Park Run Loop', 'Conditioning · Group', nowIso());
      classIds.push(id);
    }

    clients.forEach(({ p, user }, idx) => {
      const joined = addDays(monday, -7 * p.weeks);
      // Onboarded the day they joined, with answers that fit their training.
      db.prepare('UPDATE users SET created_at=?, health_share=?, health_share_at=?, onboarded_at=?, profile=? WHERE id=?')
        .run(at(joined), p.shares ? 1 : 0, p.shares ? at(addDays(joined, 1)) : null, at(joined), JSON.stringify(sampleProfile(p, at(joined))), user.id);
      setUpClient(db, user.id, coach.id);
      db.prepare("UPDATE messages SET at=?, read_at=? WHERE client_id=? AND from_role='coach' AND text=?").run(at(joined), at(joined), user.id, WELCOME_MESSAGE);
      recordPlan(db, user.id, p.plan, at(joined));
      buildPerson(db, { id: user.id, coach, p: { ...p, bookingPrefix: 'b' }, idx: idx + 100, today, joined, classIds,
        weeksBack: p.weeks, rich: true });
    });
    const byName = Object.fromEntries(clients.map(c => [c.p.name, c.user]));
    library(db, coach, byName, today);
    buildFeatures(db, config, coach, clients.map(c => db.prepare('SELECT * FROM users WHERE id=?').get(c.user.id)), today, fixtures);

    // The month's distance challenge, with everyone in it.
    const monthStart = `${today.slice(0, 8)}01`;
    const ch = newId('ch');
    db.prepare("INSERT INTO challenges (id, coach_id, title, detail, metric, target, start, end, created_at) VALUES (?,?,?,?,'distance',100,?,?,?)")
      .run(ch, coach.id, 'Monthly 100 km', 'Run, walk or row: everything with a distance counts.', monthStart, addDays(monthStart, 29), nowIso());
    for (const { user } of clients) db.prepare('INSERT INTO challenge_members (challenge_id, user_id, joined_at) VALUES (?,?,?)').run(ch, user.id, at(monthStart));

    // The demo coach shows the coach toggles switched on, so every client surface has something in it.
    const settings = coachSettings(db, coach.id);
    saveCoachSettings(db, coach.id, { ...settings, formChecks: true, challenges: true });
    db.prepare("INSERT INTO meta (key, value) VALUES ('demo_built', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(today);
  });
}

/** Every feature's demo.build, in name order, with ctx = {coach, clients, byName, today, rng, config, media}. */
function buildFeatures(db, config, coach, clients, today, fixtures) {
  const byName = Object.fromEntries(clients.map(c => [c.name.split(' ')[0], c]));
  const media = key => {
    if (!config?.dataDir) return null;
    const purpose = `demo:${key}`;
    const existing = db.prepare('SELECT * FROM media WHERE owner_id=? AND purpose=?').get(coach.id, purpose);
    if (existing) return existing;
    const file = fixtures.get(key);
    if (!file) return null;
    return insertMediaRow(db, file, { ownerId: coach.id, purpose, durationSec: file.durationSec });
  };
  for (const f of FEATURES) {
    if (typeof f.demo?.build !== 'function') continue;
    f.demo.build(db, { coach, clients, byName, today, rng: rng(`${f.name}:${today}`), config, media });
  }
}

/** The demo coach's programs, forms (Sam has one waiting) and an onboarding autoflow. */
function library(db, coach, byName, today) {
  const ago = hours => new Date(Date.now() - hours * 3_600_000).toISOString();
  const sam = byName['Sam Carter'];
  const programs = [['12-Week Strength Block', 'Barbell focus · squat, bench, deadlift', 'strength', [0, 2, 4], 12, ['Sam Carter']],
    ['Hypertrophy · Push Pull Legs', 'Four days, volume first', 'hypertrophy', [0, 2, 4, 5], 8, ['Alex Morgan']],
    ['Hyrox Hybrid', 'Strength, engine and race practice', 'hybrid', [0, 1, 3, 5], 8, ['Priya Shah']],
    ['Half Marathon Base', 'Easy miles, intervals and runner strength', 'running', [1, 3, 6], 10, ['Rory Kane']],
    ['Move Well · Strong Back', 'Mobility and trunk strength', 'mobility', [0, 3], 4, ['Leo Grant']],
    ['Fat Loss Circuits', 'Full body circuits, short rests', 'fatLoss', [1, 4], 6, ['Tom Burke']]];
  for (const [name, detail, routine, days, weeks, people] of programs) {
    const id = newId('p');
    db.prepare('INSERT INTO programs (id, coach_id, name, detail, days_per_week, weeks, body, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, coach.id, name, detail, days.length, weeks, JSON.stringify({ workouts: programWorkouts(routine, days, weeks) }), ago(24 * 30));
    for (const n of people) db.prepare('UPDATE workouts SET program_id=? WHERE client_id=?').run(id, byName[n].id);
  }

  const form = {};
  for (const t of FORM_TEMPLATES) {
    const id = newId('f');
    db.prepare('INSERT INTO forms (id, coach_id, name, intro, questions, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, coach.id, t.name, t.intro, JSON.stringify(t.questions), ago(24 * 200), ago(24 * 200));
    form[t.name] = { id, ...t };
  }
  const request = (client, name, sentAt, answers, submittedAt = sentAt) => {
    const f = form[name];
    db.prepare('INSERT INTO form_requests (id, form_id, client_id, name, intro, questions, sent_at, answers, submitted_at, reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(newId('fr'), f.id, client.id, f.name, f.intro, JSON.stringify(f.questions), sentAt, answers ? JSON.stringify(answers) : null,
        answers ? submittedAt : null, answers ? submittedAt : null);
  };
  const joined = sam.created_at ? db.prepare('SELECT created_at FROM users WHERE id=?').get(sam.id).created_at : ago(24 * 112);
  request(sam, 'Intake', joined, { goal: 'Squat 120 kg and get under 80 kg', why: 'I want to feel strong again after two years off.', experience: '1–3 years',
    days: '3', injuries: 'Left knee: old football injury, tight sometimes.', sleep: 3, stress: 3 });
  request(sam, 'PAR-Q health check', joined, { heart: false, chest: false, dizzy: false, condition: false, medication: false, joint: false, supervised: false });
  request(sam, 'Monthly review', ago(26), null); // waiting on Sam's Home screen

  const onboarding = newId('af');
  const steps = [
    { id: 's1', day: 0, action: 'message', text: 'Welcome aboard, {first}! Fill in the intake form when you get a minute.' },
    { id: 's2', day: 0, action: 'form', formId: form.Intake.id },
    { id: 's3', day: 1, action: 'form', formId: form['PAR-Q health check'].id },
    { id: 's4', day: 7, action: 'message', text: 'First week done, {first}. How are you finding it?' },
    { id: 's5', day: 28, action: 'form', formId: form['Monthly review'].id },
  ];
  db.prepare("INSERT INTO autoflows (id, coach_id, name, trigger, active, steps, created_at, updated_at) VALUES (?,?,?,'join',1,?,?,?)")
    .run(onboarding, coach.id, 'New client onboarding', JSON.stringify(steps), ago(24 * 200), ago(24 * 200));
  const tom = byName['Tom Burke'];
  const start = db.prepare('SELECT created_at FROM users WHERE id=?').get(tom.id).created_at.slice(0, 10);
  const done = {};
  for (const s of steps) if (addDays(start, s.day) <= today) done[s.id] = { at: londonToUtc(addDays(start, s.day), '09:00').toISOString(), outcome: 'sent' };
  db.prepare('INSERT INTO autoflow_runs (id, autoflow_id, client_id, start_day, done, created_at) VALUES (?,?,?,?,?,?)')
    .run(newId('ar'), onboarding, tom.id, start, JSON.stringify(done), nowIso());
}

/** Build the demo world if it isn't there or wasn't built today. Returns whether it built. */
export function seedDemo(db, today = londonDay(), config = null) {
  const built = db.prepare("SELECT value FROM meta WHERE key='demo_built'").get()?.value;
  if (built === today && db.prepare("SELECT 1 FROM users WHERE apple_sub='demo-client'").get()) {
    demoPortrait(db, config);
    return false;
  }
  buildDemo(db, today, config);
  demoPortrait(db, config);
  return true;
}

/** Rebuild the demo world once a night, after 03:00 London, so its "today" stays today. */
export function startDemoClock(db, everyMs = 10 * 60_000, config = null) {
  const tick = () => {
    try {
      if (londonClock(new Date()) < '03:00') return;
      if (seedDemo(db, londonDay(), config)) console.log('Rebuilt the demo world for today');
    } catch (e) {
      console.warn(`Demo rebuild failed: ${e.message}`);
    }
  };
  return setInterval(tick, everyMs);
}
