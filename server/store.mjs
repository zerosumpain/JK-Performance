import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export const newId = prefix => `${prefix}_${randomBytes(9).toString('base64url')}`;
export const nowIso = () => new Date().toISOString();

/**
 * One SQLite file holds everything. Every row that belongs to a person carries
 * `user_id` (or `client_id`), so DELETE /api/me and the export can find all of
 * it by one key. `ON DELETE CASCADE` does the erasing; photos on disk are
 * removed by the caller.
 */
export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, apple_sub TEXT UNIQUE, email TEXT, name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('client','coach')),
      coach_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      plan TEXT NOT NULL DEFAULT 'none', plan_since TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS membership_events (
      id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS exercises (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, equipment TEXT NOT NULL, pattern TEXT NOT NULL,
      category TEXT NOT NULL, video_url TEXT, created_by TEXT REFERENCES users(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS workouts (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL, title TEXT NOT NULL, starts_at TEXT, location TEXT, notes TEXT NOT NULL DEFAULT '',
      published INTEGER NOT NULL DEFAULT 0, published_at TEXT, edited_at TEXT NOT NULL, edited_by TEXT NOT NULL,
      completed_at TEXT, completion_note TEXT, created_by TEXT NOT NULL, program_id TEXT);
    CREATE INDEX IF NOT EXISTS workouts_client_date ON workouts(client_id, date);
    CREATE TABLE IF NOT EXISTS workout_items (
      id TEXT PRIMARY KEY, workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, exercise_id TEXT NOT NULL REFERENCES exercises(id),
      sets INTEGER NOT NULL, reps TEXT NOT NULL, load TEXT NOT NULL, rpe TEXT, note TEXT);
    CREATE TABLE IF NOT EXISTS set_logs (
      item_id TEXT NOT NULL REFERENCES workout_items(id) ON DELETE CASCADE,
      number INTEGER NOT NULL, load TEXT NOT NULL, reps INTEGER NOT NULL, rpe REAL, at TEXT NOT NULL,
      PRIMARY KEY (item_id, number));
    CREATE TABLE IF NOT EXISTS programs (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', days_per_week INTEGER NOT NULL DEFAULT 3,
      weeks INTEGER NOT NULL DEFAULT 4, body TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('check','count')), target REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT 'checkmark', health_kind TEXT,
      position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS habit_days (
      habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE, date TEXT NOT NULL,
      value REAL, done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (habit_id, date));
    CREATE TABLE IF NOT EXISTS nutrition_targets (
      client_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      kcal REAL NOT NULL, protein REAL NOT NULL, carbs REAL NOT NULL, fat REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS nutrition_entries (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL, name TEXT NOT NULL, kcal REAL NOT NULL, protein REAL NOT NULL,
      carbs REAL NOT NULL, fat REAL NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS checkins (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week TEXT NOT NULL, energy INTEGER NOT NULL, sleep INTEGER NOT NULL, pain TEXT NOT NULL,
      note TEXT NOT NULL, submitted_at TEXT NOT NULL, reviewed_at TEXT, reply TEXT,
      UNIQUE (client_id, week));
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      from_id TEXT REFERENCES users(id) ON DELETE SET NULL, from_role TEXT NOT NULL,
      text TEXT NOT NULL, workout_id TEXT, at TEXT NOT NULL, read_at TEXT);
    CREATE INDEX IF NOT EXISTS messages_client_at ON messages(client_id, at);
    CREATE TABLE IF NOT EXISTS availability (
      coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL,
      PRIMARY KEY (coach_id));
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('inperson','video','group')),
      start TEXT NOT NULL, end TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', title TEXT NOT NULL,
      capacity INTEGER, uses_credit INTEGER NOT NULL DEFAULT 0, cancelled_at TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS bookings_start ON bookings(start);
    CREATE TABLE IF NOT EXISTS class_attendees (
      booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (booking_id, user_id));
    CREATE TABLE IF NOT EXISTS measurements (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL,
      kind TEXT NOT NULL, value REAL NOT NULL, PRIMARY KEY (user_id, date, kind));
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS health_samples (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
      kind TEXT NOT NULL, date TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, value REAL NOT NULL,
      received_at TEXT NOT NULL, PRIMARY KEY (user_id, id));
    CREATE INDEX IF NOT EXISTS health_user_kind_date ON health_samples(user_id, kind, date);
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', metric TEXT NOT NULL DEFAULT 'distance',
      target REAL NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS challenge_members (
      challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, joined_at TEXT NOT NULL,
      PRIMARY KEY (challenge_id, user_id));
    CREATE TABLE IF NOT EXISTS health_activities (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
      type TEXT NOT NULL, date TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, minutes REAL NOT NULL,
      kcal REAL, distance_km REAL, avg_hr REAL, source TEXT, received_at TEXT NOT NULL,
      PRIMARY KEY (user_id, id));
    CREATE INDEX IF NOT EXISTS activities_user_start ON health_activities(user_id, start);
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      coach_id TEXT REFERENCES users(id) ON DELETE SET NULL, week TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '', wins TEXT NOT NULL DEFAULT '', focus TEXT NOT NULL DEFAULT '',
      published_at TEXT, read_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (client_id, week));
    CREATE TABLE IF NOT EXISTS link_codes (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS push_tokens (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      env TEXT NOT NULL CHECK (env IN ('production','sandbox')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS push_tokens_user ON push_tokens(user_id);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS forms (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, intro TEXT NOT NULL DEFAULT '', questions TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS form_requests (
      id TEXT PRIMARY KEY, form_id TEXT REFERENCES forms(id) ON DELETE SET NULL,
      client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, intro TEXT NOT NULL DEFAULT '', questions TEXT NOT NULL,
      sent_at TEXT NOT NULL, answers TEXT, submitted_at TEXT, reviewed_at TEXT, autoflow_id TEXT);
    CREATE INDEX IF NOT EXISTS form_requests_client ON form_requests(client_id, sent_at);
    CREATE TABLE IF NOT EXISTS autoflows (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, trigger TEXT NOT NULL CHECK (trigger IN ('join','manual')),
      active INTEGER NOT NULL DEFAULT 1, steps TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS autoflow_runs (
      id TEXT PRIMARY KEY, autoflow_id TEXT NOT NULL REFERENCES autoflows(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_day TEXT NOT NULL, done TEXT NOT NULL DEFAULT '{}', stopped_at TEXT, created_at TEXT NOT NULL,
      UNIQUE (autoflow_id, client_id));
  `);
  // Columns added after the first release. SQLite has no ADD COLUMN IF NOT EXISTS.
  addColumn(db, 'users', 'health_share', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'users', 'health_share_at', 'TEXT');
  addColumn(db, 'users', 'cal_feed_hash', 'TEXT');
  addColumn(db, 'sessions', 'kind', "TEXT NOT NULL DEFAULT 'app'");
  // Sign in with Apple refresh token, kept only so deleting the account can revoke it (Apple requires that).
  addColumn(db, 'users', 'apple_refresh', 'TEXT');
  // Android signs in with Google (or Apple on the web); see auth.mjs.
  addColumn(db, 'users', 'google_sub', 'TEXT');
  addColumn(db, 'users', 'apple_refresh_client', 'TEXT'); // the Services ID when Apple sign-in came from the web flow
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub ON users(google_sub)');
  // Which push service a device token belongs to.
  addColumn(db, 'push_tokens', 'platform', "TEXT NOT NULL DEFAULT 'ios'");
  db.exec(`CREATE TABLE IF NOT EXISTS auth_handoffs (
    hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL, created_at TEXT NOT NULL)`);
  // Plans a coach has repriced or changed, and every price change (business numbers use the price of the day).
  db.exec(`CREATE TABLE IF NOT EXISTS plan_settings (
      coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, plan TEXT NOT NULL,
      name TEXT NOT NULL, detail TEXT NOT NULL, pitch TEXT NOT NULL, monthly_pence INTEGER NOT NULL,
      annual_pence INTEGER NOT NULL, credits INTEGER NOT NULL, featured INTEGER NOT NULL DEFAULT 0,
      features TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (coach_id, plan));
    CREATE TABLE IF NOT EXISTS plan_price_events (
      id INTEGER PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, plan TEXT NOT NULL,
      monthly_pence INTEGER NOT NULL, annual_pence INTEGER NOT NULL, at TEXT NOT NULL)`);
  // A new client's answers from the app's first-run questions. Everyone who
  // was already here counts as onboarded, so only new sign-ups see the flow.
  if (addColumn(db, 'users', 'onboarded_at', 'TEXT')) db.exec('UPDATE users SET onboarded_at = created_at');
  addColumn(db, 'users', 'profile', 'TEXT');
  return db;
}

function addColumn(db, table, column, ddl) {
  if (db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  return true;
}

/**
 * Run `fn` inside one transaction. node:sqlite has no helper for it. Nested
 * calls become savepoints, so a helper that needs atomicity can be used both
 * alone and inside a bigger write.
 */
let depth = 0;
export function tx(db, fn) {
  const name = `sp${depth}`;
  db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
  depth++;
  try {
    const out = fn();
    depth--;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
    return out;
  } catch (error) {
    depth--;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
    throw error;
  }
}
