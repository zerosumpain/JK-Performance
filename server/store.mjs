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
      published_at TEXT, read_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
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
  atelierSchema(db);
  if (path !== ':memory:') backupBeforeMigration(db, path);
  migrateAtelier(db);
  return db;
}

/**
 * The Atelier redesign (docs/design/atelier-spec.md, "Server and data
 * changes"): goals, rest days, media, letters on reports, and the habit,
 * check-in, message, workout and booking columns. Everything is additive.
 */
function atelierSchema(db) {
  // Weekly reports used to be one per client and week; milestone letters can share a week, so
  // the table loses that constraint and a partial index keeps it for weekly letters only.
  const reportsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reports'").get()?.sql ?? '';
  if (/UNIQUE\s*\(client_id,\s*week\)/.test(reportsSql)) {
    tx(db, () => {
      db.exec(`CREATE TABLE reports_new (
        id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        coach_id TEXT REFERENCES users(id) ON DELETE SET NULL, week TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '', wins TEXT NOT NULL DEFAULT '', focus TEXT NOT NULL DEFAULT '',
        published_at TEXT, read_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        INSERT INTO reports_new (id, client_id, coach_id, week, summary, wins, focus, published_at, read_at, created_at, updated_at)
          SELECT id, client_id, coach_id, week, summary, wins, focus, published_at, read_at, created_at, updated_at FROM reports;
        DROP TABLE reports;
        ALTER TABLE reports_new RENAME TO reports;`);
    });
  }
  db.exec(`CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, metric TEXT NOT NULL CHECK (metric IN ('weight','waist','measurement','record','habit','custom')),
      exercise_id TEXT, measure_key TEXT, habit_id TEXT, unit TEXT NOT NULL DEFAULT '',
      baseline REAL, target REAL, current_value REAL, start_date TEXT, target_date TEXT, why TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','reached','paused')),
      chapter_name TEXT, suggestion TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS goals_client ON goals(client_id, status);
    CREATE TABLE IF NOT EXISTS rest_days (
      client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL,
      reason TEXT, granted_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (client_id, date));
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('audio','video','image')), mime TEXT NOT NULL, ext TEXT NOT NULL,
      bytes INTEGER NOT NULL, duration_sec REAL, purpose TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS media_owner ON media(owner_id);
    CREATE INDEX IF NOT EXISTS media_client ON media(client_id);`);
  // Per-client coaching settings, the client's own preferences, and (for a coach) their settings as JSON.
  addColumn(db, 'users', 'day_minimum', 'INTEGER');
  addColumn(db, 'users', 'letter_rhythm', 'TEXT');
  addColumn(db, 'users', 'coach_line', 'TEXT');
  addColumn(db, 'users', 'coach_line_at', 'TEXT');
  addColumn(db, 'users', 'notifications_on', 'INTEGER NOT NULL DEFAULT 1');
  addColumn(db, 'users', 'evening_reminder', 'TEXT');
  addColumn(db, 'users', 'coach_settings', 'TEXT');
  addColumn(db, 'habits', 'icon_key', 'TEXT');
  addColumn(db, 'habits', 'step', 'REAL');
  addColumn(db, 'habits', 'introduced_at', 'TEXT');
  for (const [col, ddl] of [['kind', "TEXT NOT NULL DEFAULT 'weekly'"], ['headline', 'TEXT'], ['keep', 'TEXT'], ['adjust', 'TEXT'], ['question', 'TEXT'],
    ['answer', 'TEXT'], ['answered_at', 'TEXT'], ['media_id', 'TEXT'], ['media_kind', 'TEXT'], ['duration_sec', 'REAL'], ['goal_id', 'TEXT'],
    ['deliver_at', 'TEXT'], ['delivered_at', 'TEXT'], ['focus_override', 'TEXT'], ['milestone_key', 'TEXT']]) addColumn(db, 'reports', col, ddl);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS reports_weekly ON reports(client_id, week) WHERE kind='weekly'");
  addColumn(db, 'checkins', 'stress', 'INTEGER');
  addColumn(db, 'checkins', 'win', 'TEXT');
  addColumn(db, 'checkins', 'struggle', 'TEXT');
  addColumn(db, 'checkins', 'photo_ids', 'TEXT');
  addColumn(db, 'messages', 'kind', "TEXT NOT NULL DEFAULT 'text'");
  addColumn(db, 'messages', 'report_id', 'TEXT');
  addColumn(db, 'messages', 'exercise_id', 'TEXT');
  addColumn(db, 'messages', 'media_id', 'TEXT');
  addColumn(db, 'workouts', 'feel', 'INTEGER');
  addColumn(db, 'bookings', 'meeting_url', 'TEXT');
}

const MIGRATION = 'atelier_v1';

/** A copy of the database file before the one-time Atelier migration touches existing rows. */
function backupBeforeMigration(db, path) {
  if (db.prepare('SELECT 1 FROM meta WHERE key=?').get(MIGRATION)) return;
  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) return;
  const file = `${path}.pre-${MIGRATION}-${Date.now()}.bak`;
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
}

/** SF Symbol names the apps stored for habits before IconKey, mapped to the closed catalogue. */
export const SF_TO_ICON_KEY = {
  drop: 'water', 'drop.fill': 'water', 'waterbottle': 'water', 'waterbottle.fill': 'water',
  moon: 'sleep', 'moon.fill': 'sleep', 'bed.double': 'sleep', 'bed.double.fill': 'sleep', 'moon.zzz': 'sleep', 'moon.zzz.fill': 'sleep',
  'shoeprints.fill': 'steps', 'figure.walk': 'steps', 'figure.walk.circle': 'steps',
  'fork.knife': 'protein', 'fork.knife.circle': 'protein', 'takeoutbag.and.cup.and.straw': 'protein', 'carrot': 'protein', 'carrot.fill': 'protein',
  pills: 'supplement', 'pills.fill': 'supplement', 'pill': 'supplement', 'pill.fill': 'supplement', 'cross.vial': 'supplement',
  bolt: 'energy', 'bolt.fill': 'energy', 'bolt.heart': 'energy', 'flame': 'energy', 'flame.fill': 'energy',
  'figure.flexibility': 'mobility', 'figure.yoga': 'mobility', 'figure.cooldown': 'mobility',
  leaf: 'mindfulness', 'leaf.fill': 'mindfulness', 'brain.head.profile': 'mindfulness', 'wind': 'mindfulness',
  book: 'reading', 'book.fill': 'reading', 'book.closed': 'reading', 'text.book.closed': 'reading',
  sunrise: 'sunlight', 'sunrise.fill': 'sunlight', 'sun.max': 'sunlight', 'sun.max.fill': 'sunlight',
};
export const iconKeyFor = sf => SF_TO_ICON_KEY[sf] ?? 'custom';

const FIRST_SENTENCE = /^(.+?[.!?])(\s|$)/s;
export const firstSentence = text => {
  const t = (text ?? '').trim();
  if (!t) return '';
  const m = FIRST_SENTENCE.exec(t);
  return (m ? m[1] : t.split('\n')[0]).slice(0, 140);
};

/** Words for onboarding goal tags, used to title a draft goal. */
const GOAL_WORDS = { strength: 'Get stronger', muscle: 'Build muscle', fatloss: 'Fat loss', fitness: 'Get fitter', performance: 'Perform at your sport', mobility: 'Move better', health: 'Better health' };
const GOAL_METRIC = { fatloss: ['weight', 'kg'], muscle: ['weight', 'kg'] };

/**
 * One-time data changes for the redesign (runs when meta key atelier_v1 is
 * absent, after a backup of the file): habit IconKeys from the old SF names,
 * letter fields from old reports (headline = first sentence of summary,
 * keep = wins, adjust = focus; the old fields stay), and a draft goal for
 * every client without one, from their onboarding goals and intake answer.
 * The day rule needs no stored recompute: it is worked out on every read.
 */
export function migrateAtelier(db) {
  if (db.prepare('SELECT 1 FROM meta WHERE key=?').get(MIGRATION)) return false;
  tx(db, () => {
    for (const h of db.prepare('SELECT id, icon FROM habits WHERE icon_key IS NULL').all()) {
      db.prepare('UPDATE habits SET icon_key=? WHERE id=?').run(iconKeyFor(h.icon), h.id);
    }
    db.prepare('UPDATE habits SET introduced_at=created_at WHERE introduced_at IS NULL').run();
    for (const r of db.prepare('SELECT * FROM reports WHERE headline IS NULL').all()) {
      db.prepare('UPDATE reports SET headline=?, keep=?, adjust=?, deliver_at=COALESCE(deliver_at, published_at), delivered_at=COALESCE(delivered_at, published_at) WHERE id=?')
        .run(firstSentence(r.summary), r.wins, r.focus, r.id);
    }
    for (const c of db.prepare("SELECT * FROM users WHERE role='client' AND id NOT IN (SELECT client_id FROM goals)").all()) {
      createDraftGoal(db, c);
    }
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(MIGRATION, nowIso());
  });
  return true;
}

/**
 * A draft goal for JK to set, from the onboarding goal tags and the intake
 * form's free-text goal. Returns the new goal's id, or null when there is
 * nothing to suggest from.
 */
export function createDraftGoal(db, client) {
  let tags = [];
  try { tags = JSON.parse(client.profile ?? 'null')?.goals ?? []; } catch { /* no profile */ }
  let intake = null;
  for (const r of db.prepare("SELECT answers FROM form_requests WHERE client_id=? AND name='Intake' AND answers IS NOT NULL ORDER BY submitted_at DESC").all(client.id)) {
    try { intake = JSON.parse(r.answers).goal ?? null; } catch { /* ignore */ }
    if (intake) break;
  }
  if (!tags.length && !intake) return null;
  const suggestion = tags.length ? tags.map(t => GOAL_WORDS[t] ?? t).join(', ') : null;
  const title = (typeof intake === 'string' && intake.trim() ? intake.trim() : GOAL_WORDS[tags[0]] ?? 'Your goal').slice(0, 120);
  const [metric, unit] = GOAL_METRIC[tags[0]] ?? ['custom', ''];
  const latestWeight = metric === 'weight' ? db.prepare("SELECT value FROM measurements WHERE user_id=? AND kind='weight' ORDER BY date DESC LIMIT 1").get(client.id)?.value ?? null : null;
  const id = newId('g');
  const now = nowIso();
  db.prepare(`INSERT INTO goals (id, client_id, title, metric, unit, baseline, status, suggestion, why, created_at, updated_at)
    VALUES (?,?,?,?,?,?,'draft',?,?,?,?)`).run(id, client.id, title, metric, unit, latestWeight, suggestion ?? title, null, now, now);
  return id;
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
