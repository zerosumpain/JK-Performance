import { recordPlan } from './account.mjs';
import { setUpClient } from './auth.mjs';
import { WELCOME_MESSAGE } from './catalogue.mjs';
import { FORM_TEMPLATES } from './forms.mjs';
import { newId, nowIso, tx } from './store.mjs';
import { buildPerson, programWorkouts } from './testclients.mjs';
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
    goal: 'Squat 120 kg and get under 80 kg', checkin: [4, 4, ['Knee'], 'Left knee tight after split squats, fine by Thursday.'], thread: SAM_THREAD },
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
const CLIENT_TABLES = ['workouts', 'habits', 'nutrition_targets', 'nutrition_entries', 'checkins', 'messages', 'reports', 'form_requests', 'autoflow_runs'];
const USER_TABLES = ['measurements', 'health_samples', 'health_activities', 'challenge_members', 'class_attendees', 'membership_events'];
const COACH_TABLES = ['bookings', 'programs', 'challenges', 'forms', 'autoflows'];

function wipe(db, coach, clients) {
  for (const { user } of clients) {
    for (const t of CLIENT_TABLES) db.prepare(`DELETE FROM ${t} WHERE client_id=?`).run(user.id);
    for (const t of USER_TABLES) db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(user.id);
  }
  for (const t of COACH_TABLES) db.prepare(`DELETE FROM ${t} WHERE coach_id=?`).run(coach.id);
}

/** Build (or rebuild) the whole demo world around `today`. */
export function buildDemo(db, today = londonDay()) {
  tx(db, () => {
    const { coach, clients } = ensureAccounts(db, today);
    wipe(db, coach, clients);
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
      db.prepare('UPDATE users SET created_at=?, health_share=?, health_share_at=? WHERE id=?')
        .run(at(joined), p.shares ? 1 : 0, p.shares ? at(addDays(joined, 1)) : null, user.id);
      setUpClient(db, user.id, coach.id);
      db.prepare("UPDATE messages SET at=?, read_at=? WHERE client_id=? AND from_role='coach' AND text=?").run(at(joined), at(joined), user.id, WELCOME_MESSAGE);
      recordPlan(db, user.id, p.plan, at(joined));
      buildPerson(db, { id: user.id, coach, p: { ...p, bookingPrefix: 'b' }, idx: idx + 100, today, joined, classIds,
        weeksBack: p.weeks, rich: true });
    });
    const byName = Object.fromEntries(clients.map(c => [c.p.name, c.user]));
    library(db, coach, byName, today);

    // The month's distance challenge, with everyone in it.
    const monthStart = `${today.slice(0, 8)}01`;
    const ch = newId('ch');
    db.prepare("INSERT INTO challenges (id, coach_id, title, detail, metric, target, start, end, created_at) VALUES (?,?,?,?,'distance',100,?,?,?)")
      .run(ch, coach.id, 'Monthly 100 km', 'Run, walk or row: everything with a distance counts.', monthStart, addDays(monthStart, 29), nowIso());
    for (const { user } of clients) db.prepare('INSERT INTO challenge_members (challenge_id, user_id, joined_at) VALUES (?,?,?)').run(ch, user.id, at(monthStart));

    db.prepare("INSERT INTO meta (key, value) VALUES ('demo_built', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(today);
  });
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
export function seedDemo(db, today = londonDay()) {
  const built = db.prepare("SELECT value FROM meta WHERE key='demo_built'").get()?.value;
  if (built === today && db.prepare("SELECT 1 FROM users WHERE apple_sub='demo-client'").get()) return false;
  buildDemo(db, today);
  return true;
}

/** Rebuild the demo world once a night, after 03:00 London, so its "today" stays today. */
export function startDemoClock(db, everyMs = 10 * 60_000) {
  const tick = () => {
    try {
      if (londonClock(new Date()) < '03:00') return;
      if (seedDemo(db)) console.log('Rebuilt the demo world for today');
    } catch (e) {
      console.warn(`Demo rebuild failed: ${e.message}`);
    }
  };
  return setInterval(tick, everyMs);
}
