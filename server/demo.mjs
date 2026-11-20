import { recordPlan } from './account.mjs';
import { setUpClient } from './auth.mjs';
import { exerciseId } from './catalogue.mjs';
import { newId, nowIso, tx } from './store.mjs';
import { addDays, londonDay, londonToUtc } from './time.mjs';

/**
 * A self-contained demo world for App Review and local testing: a demo coach,
 * "Sam Carter" (the client a DEMO_CODE signs in as) and five other clients,
 * with a few weeks of history. Every demo account is `is_demo=1` and belongs to
 * the demo coach, so none of it appears in a real coach's lists or numbers.
 * Idempotent: does nothing once the demo coach exists.
 */
export function seedDemo(db, today = londonDay()) {
  if (db.prepare("SELECT 1 FROM users WHERE apple_sub='demo-coach'").get()) return false;
  tx(db, () => {
    const at = d => londonToUtc(d, '09:00').toISOString();
    const user = (sub, name, role, coachId, createdDay) => {
      const id = newId('u');
      db.prepare('INSERT INTO users (id, apple_sub, email, name, role, coach_id, is_demo, created_at) VALUES (?,?,?,?,?,?,1,?)')
        .run(id, sub, null, name, role, coachId, at(createdDay));
      return id;
    };
    const coach = user('demo-coach', 'Coach JK', 'coach', null, addDays(today, -200));
    const start = addDays(today, -90);
    const sam = user('demo-client', 'Sam Carter', 'client', coach, start);
    setUpClient(db, sam, coach);
    recordPlan(db, sam, 'elite', at(start));
    const others = [['Priya Shah', 'elite', -120], ['Alex Morgan', 'performance', -100], ['Leo Grant', 'foundation', -60], ['Rory Kane', 'performance', -40], ['Tom Burke', 'foundation', -20]]
      .map(([name, plan, ago]) => {
        const id = user(`demo-${name.split(' ')[0].toLowerCase()}`, name, 'client', coach, addDays(today, ago));
        setUpClient(db, id, coach);
        recordPlan(db, id, plan, at(addDays(today, ago)));
        return id;
      });

    // Sam's training: lower/upper days for the last four weeks, and this week's plan.
    const lower = [['Back Squat', 5, '5', '100 kg'], ['Romanian Deadlift', 4, '8', '80 kg'], ['Bulgarian Split Squat', 3, '10 / leg', '2×20 kg'], ['Hip Thrust', 3, '12', '90 kg'], ['Copenhagen Plank', 3, '30 s', 'BW']];
    const upper = [['Bench Press', 4, '6', '80 kg'], ['Pull-up', 4, '8', 'BW'], ['Seated Dumbbell Press', 3, '10', '2×18 kg'], ['Seated Cable Row', 3, '12', '60 kg']];
    const workout = (date, title, items, { done = false, published = true, startsAt = null } = {}) => {
      const id = newId('w');
      db.prepare('INSERT INTO workouts (id, client_id, date, title, starts_at, location, notes, published, published_at, edited_at, edited_by, completed_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, sam, date, title, startsAt, 'Studio 2', '', published ? 1 : 0, published ? at(date) : null, at(date), 'coach', done ? at(date) : null, coach);
      items.forEach(([name, sets, reps, load], position) => {
        const itemId = newId('i');
        db.prepare('INSERT INTO workout_items (id, workout_id, position, exercise_id, sets, reps, load) VALUES (?,?,?,?,?,?,?)')
          .run(itemId, id, position, exerciseId(name), sets, reps, load);
        if (done) {
          for (let n = 1; n <= sets; n++) {
            db.prepare('INSERT INTO set_logs (item_id, number, load, reps, at) VALUES (?,?,?,?,?)').run(itemId, n, load, Number.parseInt(reps, 10) || 10, at(date));
          }
        }
      });
      return id;
    };
    for (let week = 4; week >= 1; week--) {
      const bump = (4 - week) * 2.5;
      // Only plain "100 kg" loads progress; "2×20 kg" and "BW" stay as written.
      const progressed = lower.map(([n, s, r, l]) => [n, s, r, /^\d+ kg$/.test(l) ? `${Number.parseInt(l, 10) - 10 + bump} kg` : l]);
      workout(addDays(today, -7 * week - 2), 'Lower Body Strength', progressed, { done: true });
      workout(addDays(today, -7 * week), 'Upper Body Hypertrophy', upper, { done: week !== 2 });
    }
    workout(today, 'Lower Body Strength', lower, { startsAt: '11:00' });
    workout(addDays(today, 4), 'Upper Body Hypertrophy', upper, { startsAt: '07:00' });

    // Body weight trending down, the other measurements, and Apple Health.
    for (let i = 0; i <= 90; i += 7) {
      const d = addDays(start, i);
      db.prepare("INSERT INTO measurements (user_id, date, kind, value) VALUES (?,?,'weight',?)").run(sam, d, Math.round((82.5 - (4.1 * i) / 90 + (i % 14 ? 0.2 : -0.2)) * 10) / 10);
    }
    for (const [kind, first, last] of [['bodyFat', 18.6, 16.2], ['waist', 87, 82], ['restingHr', 60, 54]]) {
      db.prepare('INSERT INTO measurements (user_id, date, kind, value) VALUES (?,?,?,?)').run(sam, start, kind, first);
      db.prepare('INSERT INTO measurements (user_id, date, kind, value) VALUES (?,?,?,?)').run(sam, today, kind, last);
    }
    const sample = (who, kind, date, value) => {
      const end = londonToUtc(date, '23:00').toISOString();
      db.prepare('INSERT INTO health_samples (user_id, id, kind, date, start, end, value, received_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(who, `${kind}-${date}`, kind, date, londonToUtc(date).toISOString(), end, value, nowIso());
    };
    for (let i = 0; i < 20; i++) {
      const d = addDays(today, -i);
      sample(sam, 'steps', d, i === 0 ? 8420 : 9000 + ((i * 731) % 3000));
      sample(sam, 'sleep', d, i === 0 ? 460 : 400 + ((i * 37) % 90));
      sample(sam, 'distance', d, i < 19 ? 3.4 : 0);
    }

    // Habits ticked for the last six days.
    for (const h of db.prepare('SELECT id, health_kind FROM habits WHERE client_id=?').all(sam)) {
      for (let i = 1; i <= 6; i++) if (!h.health_kind) db.prepare('INSERT INTO habit_days (habit_id, date, value, done) VALUES (?,?,?,1)').run(h.id, addDays(today, -i), 3);
    }
    db.prepare("INSERT INTO nutrition_entries (id, client_id, date, name, kcal, protein, carbs, fat, at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(newId('n'), sam, today, 'Breakfast · oats and whey', 620, 48, 80, 14, nowIso());

    // Messages, a check-in, bookings, a class and a challenge.
    const msg = (from, role, text, minutesAgo) => db.prepare('INSERT INTO messages (id, client_id, from_id, from_role, text, at, read_at) VALUES (?,?,?,?,?,?,?)')
      .run(newId('m'), sam, from, role, text, new Date(Date.now() - minutesAgo * 60_000).toISOString(), nowIso());
    msg(coach, 'coach', 'Morning Sam. I bumped the split squats to 2×20 kg today. You moved well last week.', 140);
    msg(sam, 'client', 'Sounds good. Left knee was a bit tight on Tuesday though.', 132);
    msg(coach, 'coach', "Noted. Do the 10 min mobility block first and we'll check it at 11.", 128);
    db.prepare("INSERT INTO checkins (id, client_id, week, energy, sleep, pain, note, submitted_at) VALUES (?,?,?,4,3,'[\"Knee\"]',?,?)")
      .run(newId('c'), sam, addDays(today, -11), 'Left knee tight after split squats, fine by Thursday.', nowIso());
    const book = (client, d, time, kind, title) => db.prepare('INSERT INTO bookings (id, coach_id, client_id, kind, start, end, location, title, uses_credit, created_at) VALUES (?,?,?,?,?,?,?,?,1,?)')
      .run(newId('b'), coach, client, kind, londonToUtc(d, time).toISOString(), new Date(londonToUtc(d, time).getTime() + 3_600_000).toISOString(), kind === 'video' ? 'Video call' : 'Studio 2', title, nowIso());
    book(sam, today, '11:00', 'inperson', '1:1 with Coach JK');
    book(others[0], today, '09:00', 'video', 'Assessment · video');
    book(others[2], addDays(today, 3), '18:30', 'video', 'Check-in call');
    const cls = newId('b');
    db.prepare("INSERT INTO bookings (id, coach_id, kind, start, end, location, title, capacity, created_at) VALUES (?,?,'group',?,?,?,?,12,?)")
      .run(cls, coach, londonToUtc(addDays(today, 1), '08:00').toISOString(), londonToUtc(addDays(today, 1), '09:00').toISOString(), 'Park Run Loop', 'Conditioning · Group', nowIso());
    db.prepare('INSERT INTO class_attendees (booking_id, user_id) VALUES (?,?)').run(cls, sam);
    const ch = newId('ch');
    const monthStart = today.slice(0, 8) + '01';
    db.prepare("INSERT INTO challenges (id, coach_id, title, detail, metric, target, start, end, created_at) VALUES (?,?,?,?,'distance',100,?,?,?)")
      .run(ch, coach, 'Monthly 100 km', 'Run, walk or row.', monthStart, addDays(monthStart, 29), nowIso());
    [sam, ...others].forEach((id, i) => {
      db.prepare('INSERT INTO challenge_members (challenge_id, user_id, joined_at) VALUES (?,?,?)').run(ch, id, nowIso());
      if (id !== sam) for (let k = 0; k < 18; k++) sample(id, 'distance', addDays(today, -k), [5.1, 4.5, 3.9, 2.0, 1.2][i - 1]);
    });
  });
  return true;
}
