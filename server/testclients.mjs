import { recordPlan } from './account.mjs';
import { setUpClient } from './auth.mjs';
import { WELCOME_MESSAGE, exerciseId } from './catalogue.mjs';
import { FORM_TEMPLATES } from './forms.mjs';
import { newId, nowIso, tx } from './store.mjs';
import { addDays, londonDay, londonToUtc, mondayOf } from './time.mjs';

/**
 * Made-up clients for a real coach to rehearse the whole process with:
 * four weeks of history, this week, the next three weeks planned (the
 * last of them still drafts) and sessions booked across them.
 *
 * Unlike the demo world these are NOT `is_demo`, so they show in the coach's
 * own lists and numbers. Each is marked by `apple_sub = 'test-…'` (nobody can
 * sign in as one) and coach-owned rows they need (group classes) have ids
 * starting `bt_`, so `removeTestClients` takes every trace away.
 * Pushes to them go nowhere: they have no phones.
 */

const L = (name, sets, reps, load) => [name, sets, reps, load];
const ROUTINES = {
  strength: [
    ['Lower Strength', [L('Back Squat', 5, '5', 100), L('Romanian Deadlift', 4, '8', 80), L('Bulgarian Split Squat', 3, '10', 20), L('Copenhagen Plank', 3, '30 s', 0)]],
    ['Upper Strength', [L('Bench Press', 5, '5', 80), L('Barbell Row', 4, '8', 70), L('Overhead Press', 3, '8', 45), L('Chin-up', 3, '8', 0)]],
    ['Full Body Power', [L('Trap Bar Deadlift', 4, '5', 140), L('Box Jump', 4, '5', 0), L('Landmine Press', 3, '8', 30), L('Farmer Carry', 3, '40 m', 32)]],
  ],
  hypertrophy: [
    ['Push', [L('Incline Dumbbell Press', 4, '10', 26), L('Seated Dumbbell Press', 3, '10', 18), L('Cable Fly', 3, '12', 15), L('Lateral Raise', 3, '15', 8), L('Triceps Pushdown', 3, '12', 25)]],
    ['Pull', [L('Lat Pulldown', 4, '10', 60), L('Seated Cable Row', 4, '10', 55), L('Face Pull', 3, '15', 20), L('Hammer Curl', 3, '12', 14)]],
    ['Legs', [L('Leg Press', 4, '12', 160), L('Romanian Deadlift', 3, '10', 70), L('Walking Lunge', 3, '12', 16), L('Leg Curl', 3, '12', 40), L('Calf Raise', 3, '15', 60)]],
  ],
  fatLoss: [
    ['Circuit A', [L('Goblet Squat', 3, '12', 20), L('Push-up', 3, '10', 0), L('Single-arm Dumbbell Row', 3, '12', 16), L('Kettlebell Swing', 3, '15', 16), L('Rower', 3, '250 m', 0)]],
    ['Circuit B', [L('Reverse Lunge', 3, '10', 0), L('Landmine Press', 3, '10', 20), L('Inverted Row', 3, '10', 0), L('Dead Bug', 3, '10', 0), L('Assault Bike', 4, '30 s', 0)]],
  ],
  running: [
    ['Easy Run', [L('Run', 1, '35 min', 0)]],
    ['Strength for Runners', [L('Single-leg RDL', 3, '8', 14), L('Step-up', 3, '10', 12), L('Calf Raise', 3, '15', 40), L('Copenhagen Plank', 3, '20 s', 0), L('Side Plank', 3, '30 s', 0)]],
    ['Intervals', [L('Run', 6, '3 min', 0)]],
  ],
  rehab: [
    ['Knee Rehab A', [L('Glute Bridge', 3, '15', 0), L('Goblet Squat', 3, '10', 12), L('Step-up', 3, '8', 6), L('Ankle Rocks', 2, '10', 0)]],
    ['Knee Rehab B', [L('Leg Press', 3, '12', 60), L('Single-leg RDL', 3, '8', 8), L('Side Plank', 3, '20 s', 0), L('Couch Stretch', 2, '60 s', 0)]],
  ],
  hybrid: [
    ['Strength + Engine', [L('Front Squat', 4, '6', 70), L('Pull-up', 4, '6', 0), L('Sled Push', 4, '20 m', 80), L('Assault Bike', 5, '45 s', 0)]],
    ['Hyrox Prep', [L('Rower', 4, '500 m', 0), L('Walking Lunge', 4, '20 m', 20), L('Burpee', 4, '10', 0), L('Farmer Carry', 4, '40 m', 24)]],
    ['Tempo Run', [L('Run', 1, '25 min', 0)]],
  ],
  mobility: [
    ['Move Well', [L('Cat-Cow', 2, '10', 0), L('90/90 Hip Switch', 3, '8', 0), L('Thoracic Rotation', 3, '8', 0), L('Goblet Squat', 3, '8', 12), L('Turkish Get-up', 3, '2', 8)]],
    ['Strong Back', [L('Bird Dog', 3, '10', 0), L('Deadlift', 4, '5', 60), L('Pallof Press', 3, '10', 10), L('Suitcase Carry', 3, '30 m', 16)]],
  ],
};

// days: training weekdays (0 = Monday); adherence: share of past sessions done.
const PEOPLE = [
  { name: 'Ella Hughes', plan: 'elite', routine: 'strength', days: [0, 2, 4], time: '07:00', adherence: 0.95, weight: [64.2, 64.6], shares: true, oneToOne: [1, '07:30', 'inperson'],
    goal: 'First powerlifting meet in March', checkin: [5, 4, [], 'Felt strong all week. Bench is flying.'], unread: 'Can we talk peaking for the meet at our next session?' },
  { name: 'Marcus Reid', plan: 'performance', routine: 'hypertrophy', days: [0, 2, 4, 5], time: '18:30', adherence: 0.8, weight: [82.0, 83.4], shares: true, oneToOne: [3, '19:30', 'inperson'], fortnightly: true,
    checkin: [4, 3, [], 'Work was mad Thursday so I skipped legs. Back on it.'] },
  { name: 'Hannah Okafor', plan: 'elite', routine: 'fatLoss', days: [1, 3, 5], time: '12:15', adherence: 0.75, weight: [78.5, 75.9], shares: true, oneToOne: [5, '09:00', 'inperson'],
    checkin: [3, 2, [], 'Down again on the scales! Sleep is rubbish with the baby teething.'], unread: 'Is it OK to swap Thursday for Friday this week?' },
  { name: 'Daniel Price', plan: 'performance', routine: 'running', days: [1, 3, 6], time: '06:30', adherence: 0.9, weight: [71.3, 70.4], shares: true, oneToOne: [2, '17:00', 'video'], fortnightly: true, runner: true,
    checkin: [4, 4, ['Calf'], 'Right calf tight after the intervals, eased off by Sunday.'] },
  { name: 'Sophie Turner', plan: 'foundation', routine: 'mobility', days: [0, 3], time: '20:00', adherence: 0.6, weight: [59.8, 59.5], shares: false,
    checkin: [2, 3, ['Lower back'], 'Back flared up sitting at my desk. Did the mobility but missed Thursday.'] },
  { name: 'James Whitfield', plan: 'elite', routine: 'rehab', days: [0, 2, 4], time: '10:00', adherence: 0.85, weight: [88.1, 87.0], shares: true, oneToOne: [0, '11:00', 'inperson'],
    checkin: [3, 4, ['Knee'], 'Knee about 3/10 on stairs now, was 6/10 a month ago.'], unread: 'Physio says I can start light jogging. What do you think?' },
  { name: 'Aisha Khan', plan: 'performance', routine: 'hybrid', days: [0, 1, 3, 5], time: '06:00', adherence: 0.88, weight: [61.0, 60.6], shares: true, oneToOne: [4, '07:00', 'video'], fortnightly: true, runner: true,
    checkin: [5, 4, [], 'Hyrox in 6 weeks. Engine feels better every week.'] },
  { name: 'Ben Carter', plan: 'foundation', routine: 'fatLoss', days: [1, 4], time: '19:00', adherence: 0.4, weight: [96.4, 95.8], shares: false, quiet: true,
    checkin: null },
  { name: 'Grace Lin', plan: 'elite', routine: 'hypertrophy', days: [0, 2, 4], time: '17:30', adherence: 0.92, weight: [57.2, 58.1], shares: true, oneToOne: [2, '18:30', 'inperson'],
    checkin: [4, 5, [], 'Loving the new split. Glutes are sore in the best way.'] },
  { name: 'Tom Ashworth', plan: 'performance', routine: 'strength', days: [1, 3, 5], time: '07:30', adherence: 0.7, weight: [79.9, 79.6], shares: false, oneToOne: [5, '11:00', 'inperson'], fortnightly: true, isNew: true,
    checkin: [3, 3, ['Shoulder'], 'Left shoulder pinches on overhead press. Not painful, just there.'] },
];

/** Deterministic noise so a re-run gives the same people the same week. */
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

// Dumbbell pairs read "2×16 kg"; barbells, machines, kettlebells "60 kg"; no load is bodyweight.
const PAIRS = /Bulgarian|Walking Lunge|Step-up|Incline Dumbbell|Seated Dumbbell|Lateral|Hammer|Single-leg RDL/;
const loadText = (kg, name) => (!kg ? 'BW' : PAIRS.test(name) ? `2×${kg} kg` : `${kg} kg`);

export function addTestClients(db, coachId, today = londonDay()) {
  if (db.prepare("SELECT 1 FROM users WHERE apple_sub LIKE 'test-%'").get()) throw new Error('Test clients already exist; remove them first');
  const coach = db.prepare("SELECT * FROM users WHERE id=? AND role='coach'").get(coachId);
  if (!coach) throw new Error('No such coach');
  const at = (d, t = '09:00') => londonToUtc(d, t).toISOString();
  const monday = mondayOf(today);
  const out = [];

  tx(db, () => {
    const classIds = [];
    // A weekly group class on Saturday mornings, this week's onwards.
    for (let w = 0; w < 4; w++) {
      const d = addDays(monday, 7 * w + 5);
      if (d < today) continue;
      const id = newId('bt');
      db.prepare("INSERT INTO bookings (id, coach_id, kind, start, end, location, title, capacity, created_at) VALUES (?,?,'group',?,?,?,?,10,?)")
        .run(id, coachId, at(d, '08:00'), at(d, '09:00'), 'Park Run Loop', 'Conditioning · Group', nowIso());
      classIds.push(id);
    }

    PEOPLE.forEach((p, idx) => {
      const r = rng(idx * 7919 + 17);
      const joined = addDays(today, p.isNew ? -16 : -60 - idx * 9);
      const id = newId('u');
      db.prepare('INSERT INTO users (id, apple_sub, email, name, role, coach_id, is_demo, created_at, health_share, health_share_at) VALUES (?,?,?,?,?,?,0,?,?,?)')
        .run(id, `test-${p.name.toLowerCase().replace(/[^a-z]+/g, '-')}`, null, p.name, 'client', coachId, at(joined),
          p.shares ? 1 : 0, p.shares ? at(addDays(joined, 2)) : null);
      setUpClient(db, id, coachId);
      recordPlan(db, id, p.plan, at(joined));
      out.push({ id, name: p.name });

      // Training: from 4 weeks back (or joining) to 3 weeks ahead.
      const routine = ROUTINES[p.routine];
      let k = 0;
      for (let w = -4; w <= 3; w++) {
        for (const wd of p.days) {
          const date = addDays(monday, 7 * w + wd);
          const [title, items] = routine[k++ % routine.length];
          if (date < joined) continue;
          const past = date < today;
          const done = past && r() < p.adherence;
          const draft = w === 3; // three weeks out: still to be checked and published
          const progress = Math.max(0, w + 4) * (r() < 0.6 ? 2.5 : 0);
          const wid = newId('w');
          db.prepare('INSERT INTO workouts (id, client_id, date, title, starts_at, location, notes, published, published_at, edited_at, edited_by, completed_at, completion_note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(wid, id, date, title, p.time, p.routine === 'running' && /Run|Intervals/.test(title) ? 'Outdoors' : 'Studio 2',
              /Intervals/.test(title) ? '90 s easy jog between reps.' : '', draft ? 0 : 1, draft ? null : at(addDays(date, -6)),
              at(addDays(date, -6)), 'coach', done ? at(date, p.time) : null,
              done && r() < 0.25 ? ['Felt strong today.', 'Bit tired, kept it honest.', 'Last set was a grind.', 'Great session!'][Math.floor(r() * 4)] : null, coachId);
          items.forEach(([name, sets, reps, kg], position) => {
            const load = kg ? loadText(Math.round((kg + (/(Squat|Deadlift|Bench|Press|Row|Thrust)/.test(name) ? progress : 0)) * 2) / 2, name) : 'BW';
            const itemId = newId('i');
            db.prepare('INSERT INTO workout_items (id, workout_id, position, exercise_id, sets, reps, load) VALUES (?,?,?,?,?,?,?)')
              .run(itemId, wid, position, exerciseId(name), sets, reps, load);
            if (!done) return;
            const target = Number.parseInt(reps, 10) || 1;
            for (let n = 1; n <= sets; n++) {
              const repsDone = Math.max(1, target - (n === sets && r() < 0.35 ? 1 + Math.floor(r() * 2) : 0));
              db.prepare('INSERT INTO set_logs (item_id, number, load, reps, rpe, at) VALUES (?,?,?,?,?,?)')
                .run(itemId, n, load, repsDone, Math.round((6.5 + n * 0.5 + r()) * 2) / 2, at(date, p.time));
            }
          });
        }
      }

      // Body weight twice a week, drifting from start to now.
      const span = Math.max(1, Math.round((Date.parse(today) - Date.parse(joined)) / 86_400_000));
      for (let d = 0; d <= span; d += 3 + (d % 2)) {
        const w = p.weight[0] + ((p.weight[1] - p.weight[0]) * d) / span + (r() - 0.5) * 0.6;
        db.prepare("INSERT OR REPLACE INTO measurements (user_id, date, kind, value) VALUES (?,?,'weight',?)").run(id, addDays(joined, d), Math.round(w * 10) / 10);
      }
      db.prepare("INSERT OR REPLACE INTO measurements (user_id, date, kind, value) VALUES (?,?,'weight',?)").run(id, today, p.weight[1]);

      // Habits: ticked in line with how they train.
      for (const h of db.prepare('SELECT id, kind, target, health_kind FROM habits WHERE client_id=?').all(id)) {
        if (h.health_kind) continue;
        for (let i = 1; i <= 21; i++) {
          const day = addDays(today, -i);
          if (day < joined || r() > p.adherence) continue;
          db.prepare('INSERT INTO habit_days (habit_id, date, value, done) VALUES (?,?,?,1)').run(h.id, day, h.kind === 'count' ? h.target : 1);
        }
      }

      // Apple Health for those who share: steps, sleep, resting HR, workouts.
      if (p.shares) {
        const sample = (kind, date, value) => db.prepare('INSERT OR REPLACE INTO health_samples (user_id, id, kind, date, start, end, value, received_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(id, `${kind}-${date}`, kind, date, at(date, '00:00'), at(date, '23:00'), value, nowIso());
        for (let i = 0; i < 28; i++) {
          const d = addDays(today, -i);
          if (d < joined) break;
          sample('steps', d, Math.round(5500 + r() * 7000 + (p.runner ? 3000 : 0)));
          sample('sleep', d, Math.round(p.name.startsWith('Hannah') ? 300 + r() * 80 : 380 + r() * 110));
          sample('restingHr', d, Math.round((p.runner ? 49 : 58) + r() * 5));
          sample('activeKcal', d, Math.round(300 + r() * 500));
          sample('distance', d, Math.round((2 + r() * 5 + (p.runner ? 4 : 0)) * 10) / 10);
        }
        for (let i = 1; i < 28; i++) {
          const d = addDays(today, -i);
          if (d < joined || r() > (p.runner ? 0.45 : 0.15)) continue;
          const type = p.runner ? (r() < 0.8 ? 'Running' : 'Cycling') : ['Walking', 'Yoga', 'Cycling', 'Swimming'][Math.floor(r() * 4)];
          const minutes = Math.round(25 + r() * 45);
          const start = londonToUtc(d, p.runner ? '06:30' : '18:00');
          const km = type === 'Yoga' ? null : Math.round(minutes * (type === 'Running' ? 0.18 : type === 'Cycling' ? 0.42 : type === 'Swimming' ? 0.04 : 0.09) * 10) / 10;
          db.prepare('INSERT OR REPLACE INTO health_activities (user_id, id, type, date, start, end, minutes, kcal, distance_km, avg_hr, source, received_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(id, `test-${type}-${d}`, type, d, start.toISOString(), new Date(start.getTime() + minutes * 60_000).toISOString(),
              minutes, Math.round(minutes * (7 + r() * 4)), km, Math.round(120 + r() * 40), p.runner ? 'Garmin' : 'Apple Watch', nowIso());
        }
      }

      // Weekly check-ins: three past weeks reviewed; the latest one waits for the coach.
      if (p.checkin) {
        const [energy, sleep, pain, note] = p.checkin;
        for (let w = 3; w >= 1; w--) {
          const week = addDays(monday, -7 * w);
          if (week < joined) continue;
          const latest = w === 1;
          db.prepare('INSERT INTO checkins (id, client_id, week, energy, sleep, pain, note, submitted_at, reviewed_at, reply) VALUES (?,?,?,?,?,?,?,?,?,?)')
            .run(newId('c'), id, week, latest ? energy : Math.min(5, Math.max(1, energy + (r() < 0.5 ? -1 : 0))),
              latest ? sleep : Math.min(5, Math.max(1, sleep + (r() < 0.5 ? 1 : 0))), JSON.stringify(latest ? pain : []),
              latest ? note : 'Solid week overall.', at(addDays(week, 4), '18:20'),
              latest ? null : at(addDays(week, 6), '10:00'), latest ? null : 'Thanks, all noted. Keep going.');
        }
      }

      // Weekly feedback published for two and three weeks ago; last week's is yours to write.
      for (const w of [3, 2]) {
        const week = addDays(monday, -7 * w);
        if (week < joined || p.quiet) continue;
        db.prepare('INSERT INTO reports (id, client_id, coach_id, week, summary, wins, focus, published_at, read_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
          newId('r'), id, coachId, week,
          `Good week, ${p.name.split(' ')[0]}. ${p.adherence > 0.8 ? 'Every session done and the numbers are moving.' : 'Most sessions done; let\'s protect the midweek one.'}`,
          p.goal ? `On track for: ${p.goal.toLowerCase()}.` : 'Consistent habits and honest logging.',
          'Same plan, small load increases where the last set felt easy.',
          at(addDays(week, 7), '08:00'), w === 3 ? at(addDays(week, 7), '12:00') : null, at(addDays(week, 7), '07:30'), at(addDays(week, 7), '08:00'));
      }

      // Messages: a short thread; some end with a question you haven't read.
      const msg = (role, text, hoursAgo, read = true) => db.prepare('INSERT INTO messages (id, client_id, from_id, from_role, text, at, read_at) VALUES (?,?,?,?,?,?,?)')
        .run(newId('m'), id, role === 'coach' ? coachId : id, role, text, new Date(Date.now() - hoursAgo * 3_600_000).toISOString(), read ? nowIso() : null);
      if (!p.quiet) {
        msg('coach', `How did ${routine[0][0]} feel this week?`, 70 + idx * 3);
        msg('client', p.adherence > 0.8 ? 'Really good, felt in control the whole way.' : 'Hard but got through it.', 66 + idx * 3);
        if (p.unread) msg('client', p.unread, 3 + idx, false);
      }

      // Food today for those on Elite (nutrition is part of it).
      if (p.plan === 'elite') {
        for (const [name, kcal, pr, c, f] of [['Breakfast · eggs on toast', 480, 28, 40, 22], ['Lunch · chicken rice bowl', 650, 45, 70, 18]]) {
          db.prepare('INSERT INTO nutrition_entries (id, client_id, date, name, kcal, protein, carbs, fat, at) VALUES (?,?,?,?,?,?,?,?,?)')
            .run(newId('n'), id, today, name, kcal, pr, c, f, nowIso());
        }
      }

      // 1:1s: weekly or fortnightly through the next three weeks, plus last week's.
      if (p.oneToOne) {
        const [wd, time, kind] = p.oneToOne;
        for (let w = -1; w <= 3; w++) {
          if (p.fortnightly && w % 2 !== 0) continue;
          const d = addDays(monday, 7 * w + wd);
          if (d < joined) continue;
          const start = londonToUtc(d, time);
          db.prepare('INSERT INTO bookings (id, coach_id, client_id, kind, start, end, location, title, uses_credit, created_at) VALUES (?,?,?,?,?,?,?,?,1,?)')
            .run(newId('bt'), coachId, id, kind, start.toISOString(), new Date(start.getTime() + 3_600_000).toISOString(),
              kind === 'video' ? 'Video call' : 'Studio 2', `${kind === 'video' ? 'Video call' : '1:1'} with ${coach.name}`, nowIso());
        }
      }
      if (['hybrid', 'fatLoss', 'running'].includes(p.routine) && !p.quiet) {
        for (const c of classIds) db.prepare('INSERT INTO class_attendees (booking_id, user_id) VALUES (?,?)').run(c, id);
      }
    });
  });
  addTestExtras(db, coachId, today);
  return out;
}

// Program templates the coach's library starts with, built from the routines above.
const PROGRAMS = [
  { name: '12-Week Strength Block', detail: 'Barbell focus · squat, bench, deadlift', routine: 'strength', days: [0, 2, 4], weeks: 12, people: ['Ella Hughes', 'Tom Ashworth'] },
  { name: 'Hypertrophy · Push Pull Legs', detail: 'Four days, volume first', routine: 'hypertrophy', days: [0, 2, 4, 5], weeks: 8, people: ['Marcus Reid', 'Grace Lin'] },
  { name: 'Fat Loss Circuits', detail: 'Full body circuits, short rests', routine: 'fatLoss', days: [1, 3, 5], weeks: 6, people: ['Hannah Okafor', 'Ben Carter'] },
  { name: 'Half Marathon Base', detail: 'Easy miles, intervals and runner strength', routine: 'running', days: [1, 3, 6], weeks: 10, people: ['Daniel Price'] },
  { name: 'Knee Rehab Return', detail: 'Graded loading back to running', routine: 'rehab', days: [0, 2, 4], weeks: 6, people: ['James Whitfield'] },
  { name: 'Hyrox Hybrid', detail: 'Strength, engine and race practice', routine: 'hybrid', days: [0, 1, 3, 5], weeks: 8, people: ['Aisha Khan'] },
  { name: 'Move Well · Strong Back', detail: 'Mobility and trunk strength, two days', routine: 'mobility', days: [0, 3], weeks: 4, people: ['Sophie Turner'] },
];

const slug = name => `test-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`;

/**
 * The coach's side of the made-up world: program templates (linked to the
 * clients already following them), forms with answers, autoflows part-way
 * through, a challenge, and messages timed so the clients list has someone
 * in each state: urgent, just messaged, a form to read, a check-in to reply
 * to, and not spoken to in a while. Rows the coach owns have ids starting
 * `tp_`, `tf_`, `ta_`, `tc_`, so removal finds them. Runs once per coach.
 */
export function addTestExtras(db, coachId, today = londonDay()) {
  if (db.prepare("SELECT 1 FROM programs WHERE coach_id=? AND id LIKE 'tp\\_%' ESCAPE '\\'").get(coachId)) throw new Error('The extra test data is already there');
  const person = {};
  for (const p of PEOPLE) {
    const u = db.prepare("SELECT * FROM users WHERE apple_sub=? AND coach_id=?").get(slug(p.name), coachId);
    if (!u) throw new Error(`Test client ${p.name} is missing; add the test clients first`);
    person[p.name] = u;
  }
  const at = (d, t = '09:00') => londonToUtc(d, t).toISOString();
  const ago = hours => new Date(Date.now() - hours * 3_600_000).toISOString();
  const joinedDay = name => person[name].created_at.slice(0, 10);

  return tx(db, () => {
    // Programs, and the clients' existing workouts tagged with the one they follow.
    const program = {};
    for (const p of PROGRAMS) {
      const routine = ROUTINES[p.routine];
      const workouts = [];
      let k = 0;
      for (let w = 0; w < p.weeks; w++) {
        for (const d of p.days) {
          const [title, items] = routine[k++ % routine.length];
          workouts.push({ dayOffset: w * 7 + d, title, items: items.map(([name, sets, reps, kg]) => ({ exerciseId: exerciseId(name), sets, reps, load: kg ? loadText(kg + w * (kg >= 40 ? 2.5 : 0), name) : 'BW', rpe: w % 4 === 3 ? '6' : '8', note: null })) });
        }
      }
      const id = newId('tp');
      db.prepare('INSERT INTO programs (id, coach_id, name, detail, days_per_week, weeks, body, updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, coachId, p.name, p.detail, p.days.length, p.weeks, JSON.stringify({ workouts }), ago(24 * (10 + p.weeks)));
      program[p.name] = id;
      for (const name of p.people) db.prepare('UPDATE workouts SET program_id=? WHERE client_id=? AND program_id IS NULL').run(id, person[name].id);
    }

    // Forms: the ready-made four, and what each client has sent back.
    const form = {};
    for (const t of FORM_TEMPLATES) {
      const id = newId('tf');
      db.prepare('INSERT INTO forms (id, coach_id, name, intro, questions, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, coachId, t.name, t.intro, JSON.stringify(t.questions), ago(24 * 90), ago(24 * 90));
      form[t.name] = { id, ...t };
    }
    const request = (name, formName, sentAt, answers, { submittedAt = null, reviewed = true, flow = null } = {}) => {
      const f = form[formName];
      db.prepare('INSERT INTO form_requests (id, form_id, client_id, name, intro, questions, sent_at, answers, submitted_at, reviewed_at, autoflow_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(newId('fr'), f.id, person[name].id, f.name, f.intro, JSON.stringify(f.questions), sentAt, answers ? JSON.stringify(answers) : null,
          answers ? submittedAt ?? sentAt : null, answers && reviewed ? submittedAt ?? sentAt : null, flow);
    };
    const NO = { heart: false, chest: false, dizzy: false, condition: false, medication: false, joint: false, supervised: false };
    const EXPERIENCE = { 'Ella Hughes': '3+ years', 'Marcus Reid': '1–3 years', 'Hannah Okafor': 'Under a year', 'Daniel Price': '1–3 years', 'Sophie Turner': 'New to it',
      'James Whitfield': '3+ years', 'Aisha Khan': '3+ years', 'Ben Carter': 'New to it', 'Grace Lin': '1–3 years', 'Tom Ashworth': 'Under a year' };
    for (const p of PEOPLE) {
      const joined = joinedDay(p.name);
      request(p.name, 'Intake', at(joined, '10:00'), {
        goal: p.goal ?? { strength: 'Get properly strong', hypertrophy: 'Build muscle and keep it', fatLoss: 'Lose 6 kg and keep it off', running: 'Sub-1:40 half marathon',
          rehab: 'Run pain-free again', hybrid: 'Finish Hyrox under 1:20', mobility: 'Stop my back hurting at work' }[p.routine],
        why: 'I want to feel fit and confident again.', experience: EXPERIENCE[p.name], days: String(Math.min(p.days.length, 5)).replace('5', '5+'),
        ...(p.checkin?.[2]?.length ? { injuries: `${p.checkin[2][0]} niggles now and then.` } : {}), sleep: p.name === 'Hannah Okafor' ? 2 : 4, stress: p.quiet ? 4 : 3,
      }, { submittedAt: at(joined, '20:15') });
      if (p.name === 'Tom Ashworth') continue;
      request(p.name, 'PAR-Q health check', at(addDays(joined, 1), '10:00'),
        p.routine === 'rehab' ? { ...NO, joint: true, details: 'Left knee: meniscus repair last year, physio signed off.' } : NO,
        { submittedAt: at(addDays(joined, 1), '19:40') });
    }
    // Tom joined recently: his PAR-Q came back with a yes you haven't read yet.
    const tomJoined = joinedDay('Tom Ashworth');
    request('Tom Ashworth', 'PAR-Q health check', at(addDays(tomJoined, 1), '10:00'),
      { ...NO, joint: true, details: 'Left shoulder pinches pressing overhead. Never seen anyone about it.' }, { submittedAt: ago(20), reviewed: false });
    request('Grace Lin', 'Monthly review', ago(72), { proud: 'Hit a 100 kg hip thrust for 8!', hard: 'Two late nights at work threw my Thursday.', enjoy: 5, next: 'Pull-ups: get my first strict one.' }, { submittedAt: ago(30), reviewed: false });
    request('Marcus Reid', 'Monthly review', ago(80), null);
    request('Ben Carter', 'Monthly review', ago(24 * 9), null);
    request('James Whitfield', 'Injury report', at(addDays(today, -40), '09:00'), { where: 'Left knee', how: 'Twisted it on the last rep of lunges.', level: 2, sharp: false }, { submittedAt: at(addDays(today, -40), '12:30') });

    // Autoflows: onboarding for everyone who joins, two the coach starts by hand.
    const flow = (name, trigger, steps) => {
      const id = newId('ta');
      const withIds = steps.map((s, i) => ({ id: `s${i + 1}`, ...s }));
      db.prepare('INSERT INTO autoflows (id, coach_id, name, trigger, active, steps, created_at, updated_at) VALUES (?,?,?,?,1,?,?,?)')
        .run(id, coachId, name, trigger, JSON.stringify(withIds), ago(24 * 60), ago(24 * 60));
      return { id, steps: withIds };
    };
    const onboarding = flow('New client onboarding', 'join', [
      { day: 0, action: 'message', text: 'Welcome aboard, {first}! Fill in the intake form when you get a minute and I\'ll build your first block around it.' },
      { day: 0, action: 'form', formId: form.Intake.id },
      { day: 1, action: 'form', formId: form['PAR-Q health check'].id },
      { day: 7, action: 'message', text: 'First week done, {first}. How are you finding it? Anything feel too easy or too hard?' },
      { day: 28, action: 'form', formId: form['Monthly review'].id },
    ]);
    const injury = flow('Return from injury', 'manual', [
      { day: 0, action: 'program', programId: program['Knee Rehab Return'] },
      { day: 0, action: 'message', text: 'Sorry you\'re hurt, {first}. I\'ve put a rehab block on your calendar; nothing should go above 3/10 pain.' },
      { day: 14, action: 'form', formId: form['Injury report'].id },
      { day: 42, action: 'message', text: 'Six weeks in. Let\'s book a session and test it properly.' },
    ]);
    const hyrox = flow('Race countdown · 8 weeks', 'manual', [
      { day: 0, action: 'program', programId: program['Hyrox Hybrid'] },
      { day: 0, action: 'message', text: 'Eight weeks to race day, {first}. The plan builds to a full simulation in week 6.' },
      { day: 21, action: 'message', text: 'Five weeks out. How are the wall balls feeling?' },
      { day: 42, action: 'message', text: 'Simulation week! Treat Saturday like race day: same breakfast, same kit.' },
      { day: 53, action: 'message', text: 'Race week. Sleep, carbs, and trust the work. You\'re ready.' },
    ]);
    // A run with every step up to today already done, so nothing fires twice.
    const run = (f, name, start, outcomes = {}) => {
      const done = {};
      for (const s of f.steps) if (addDays(start, s.day) <= today) done[s.id] = { at: at(addDays(start, s.day), '09:00'), outcome: outcomes[s.id] ?? 'sent' };
      db.prepare('INSERT INTO autoflow_runs (id, autoflow_id, client_id, start_day, done, created_at) VALUES (?,?,?,?,?,?)')
        .run(newId('ar'), f.id, person[name].id, start, JSON.stringify(done), at(start, '09:00'));
    };
    run(onboarding, 'Tom Ashworth', tomJoined);
    run(injury, 'James Whitfield', addDays(today, -40), { s1: 'assigned at the start of rehab' });
    run(hyrox, 'Aisha Khan', addDays(today, -19), { s1: 'assigned for race prep' });

    // A distance challenge the runners are in.
    const challenge = newId('tc');
    db.prepare("INSERT INTO challenges (id, coach_id, title, detail, metric, target, start, end, created_at) VALUES (?,?,?,?,'distance',?,?,?,?)")
      .run(challenge, coachId, '100 km in November', 'Run, walk or cycle: everything with a distance counts.', 100, `${today.slice(0, 7)}-01`, addDays(`${today.slice(0, 7)}-01`, 29), ago(24 * 20));
    for (const name of ['Daniel Price', 'Aisha Khan', 'Ella Hughes', 'Hannah Okafor', 'Grace Lin']) {
      db.prepare('INSERT INTO challenge_members (challenge_id, user_id, joined_at) VALUES (?,?,?)').run(challenge, person[name].id, ago(24 * 18));
    }

    // Messages, timed so the clients list shows every kind of need. The app's
    // welcome message goes back to the day each client joined.
    for (const p of PEOPLE) {
      db.prepare("UPDATE messages SET at=?, read_at=? WHERE client_id=? AND from_role='coach' AND text=?")
        .run(person[p.name].created_at, person[p.name].created_at, person[p.name].id, WELCOME_MESSAGE);
    }
    const msg = (name, role, text, at, read = true) => db.prepare('INSERT INTO messages (id, client_id, from_id, from_role, text, at, read_at) VALUES (?,?,?,?,?,?,?)')
      .run(newId('m'), person[name].id, role === 'coach' ? coachId : person[name].id, role, text, at, read ? at : null);
    msg('Sophie Turner', 'client', 'Did something to my back lifting the kids this morning. Sharp pain down my left leg when I bend. Should I still come tonight?', ago(0.7), false);
    msg('Tom Ashworth', 'coach', 'First week done, Tom. How are you finding it? Anything feel too easy or too hard?', at(addDays(tomJoined, 7), '09:00'));
    msg('Tom Ashworth', 'client', 'Good! Overhead press feels a bit off on the left side but everything else is great.', at(addDays(tomJoined, 7), '12:40'));
    msg('Daniel Price', 'client', 'Parkrun PB this morning! 21:48 🎉 Calf held up fine.', ago(0.4), false);
    // Marcus and Aisha: last spoken to over a week ago (their check-ins were answered then too).
    for (const [name, days] of [['Marcus Reid', 12], ['Aisha Khan', 10]]) {
      const id = person[name].id;
      const thread = db.prepare('SELECT id FROM messages WHERE client_id=? ORDER BY at').all(id);
      thread.forEach((m, i) => db.prepare('UPDATE messages SET at=?, read_at=? WHERE id=?').run(ago(24 * days - i * 3), ago(24 * days - i * 3), m.id));
      const c = db.prepare('SELECT id, submitted_at FROM checkins WHERE client_id=? AND reviewed_at IS NULL').get(id);
      if (c) db.prepare('UPDATE checkins SET reviewed_at=?, reply=? WHERE id=?').run(new Date(Date.parse(c.submitted_at) + 2 * 3_600_000).toISOString(), 'Great week, noted. Same again.', c.id);
    }
    return { programs: PROGRAMS.length, forms: FORM_TEMPLATES.length, autoflows: 3 };
  });
}

/** Every made-up client and everything about them (cascades), plus the coach-side rows made for them. */
export function removeTestClients(db) {
  return tx(db, () => {
    const users = db.prepare("DELETE FROM users WHERE apple_sub LIKE 'test-%' AND is_demo=0").run().changes;
    const classes = db.prepare("DELETE FROM bookings WHERE id LIKE 'bt\\_%' ESCAPE '\\'").run().changes;
    let library = 0;
    for (const [table, prefix] of [['autoflows', 'ta'], ['forms', 'tf'], ['programs', 'tp'], ['challenges', 'tc']]) {
      library += db.prepare(`DELETE FROM ${table} WHERE id LIKE '${prefix}\\_%' ESCAPE '\\'`).run().changes;
    }
    return { users, classes, library };
  });
}
