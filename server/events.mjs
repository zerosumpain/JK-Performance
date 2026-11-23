import { FEATURES } from './registry.mjs';
import { afterCommit, newId, nowIso, tx } from './store.mjs';
import { sendToCoach } from './stream.mjs';
import { addDays, londonClock, londonDay, londonToUtc } from './time.mjs';

/**
 * The event bus (docs/design/desk-v2.md 3.2). `emit` writes one row,
 * synchronously and inside the caller's transaction when there is one, so a
 * rolled-back write emits nothing. Handlers (`feature.on`) run later, in
 * `drainEvents`, each in its own transaction with its cursor; a handler that
 * throws is logged to event_failures and skipped, never retried forever.
 * Only committed rows are drained, so only committed rows reach the live stream.
 *
 * Payloads carry ids and small values only: never message bodies or transcripts.
 */

const attached = new WeakMap(); // db -> { config, fanSeq, draining, scheduled }

const handlerKeys = () => FEATURES.flatMap(f => Object.keys(f.on ?? {}).map(type => ({ key: `${f.name}:${type}`, type, fn: f.on[type], feature: f })));

/**
 * Called by createApp before any request or clock: remembers the config for
 * draining, and creates every handler's cursor at the current end of the log,
 * so a newly deployed handler starts at the deploy point.
 */
export function attachEvents(db, config) {
  const max = db.prepare('SELECT COALESCE(MAX(seq), 0) seq FROM events').get().seq;
  const insert = db.prepare('INSERT OR IGNORE INTO event_cursors (handler, seq) VALUES (?, ?)');
  for (const h of handlerKeys()) insert.run(h.key, max);
  const prior = attached.get(db);
  attached.set(db, { config, fanSeq: prior?.fanSeq ?? max, draining: false, scheduled: false });
}

/**
 * Record an event. `payload` holds ids and small values; `summary` is one human
 * line for timelines ("Booked Tue 4 Nov 07:00"). `is_demo` follows the coach.
 * Returns the event id.
 */
export function emit(db, type, { coachId = null, clientId = null, summary = '', ...payload } = {}) {
  const isDemo = coachId ? db.prepare('SELECT is_demo FROM users WHERE id=?').get(coachId)?.is_demo ?? 0 : 0;
  const id = newId('ev');
  db.prepare('INSERT INTO events (id, coach_id, client_id, type, summary, payload, is_demo, at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, coachId, clientId, type, String(summary ?? '').slice(0, 200), JSON.stringify(payload), isDemo ? 1 : 0, nowIso());
  scheduleDrain(db);
  return id;
}

function scheduleDrain(db) {
  const state = attached.get(db);
  if (!state || state.scheduled) return;
  state.scheduled = true;
  afterCommit(() => setImmediate(() => {
    state.scheduled = false;
    try { drainEvents(db, state.config); } catch (e) { console.error('Event drain failed', e); }
  }));
}

const eventOut = e => ({ seq: e.seq, id: e.id, type: e.type, coachId: e.coach_id, clientId: e.client_id, summary: e.summary, payload: JSON.parse(e.payload), isDemo: !!e.is_demo, at: e.at });

/**
 * Run every handler over the events after its cursor (in seq order, 500 at a
 * time), then fan new committed rows out to the coaches' live streams.
 * Synchronous. Never creates a cursor (attachEvents does). Returns how many
 * handler calls ran.
 */
export function drainEvents(db, config = attached.get(db)?.config) {
  const state = attached.get(db);
  if (!state || state.draining) return 0;
  state.draining = true;
  let calls = 0;
  try {
    for (const h of handlerKeys()) {
      for (let rounds = 0; rounds < 20; rounds++) {
        const cursor = db.prepare('SELECT seq FROM event_cursors WHERE handler=?').get(h.key);
        if (!cursor) break;
        const rows = h.type === '*'
          ? db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT 500').all(cursor.seq)
          : db.prepare('SELECT * FROM events WHERE seq>? AND type=? ORDER BY seq LIMIT 500').all(cursor.seq, h.type);
        if (!rows.length) {
          // Move typed cursors past unrelated events so the next scan is short.
          const max = db.prepare('SELECT COALESCE(MAX(seq), 0) seq FROM events').get().seq;
          if (max > cursor.seq) db.prepare('UPDATE event_cursors SET seq=? WHERE handler=? AND seq<?').run(max, h.key, max);
          break;
        }
        for (const row of rows) {
          calls++;
          try {
            tx(db, () => {
              h.fn(db, config, eventOut(row));
              db.prepare('UPDATE event_cursors SET seq=? WHERE handler=?').run(row.seq, h.key);
            });
          } catch (e) {
            console.error(`Event handler ${h.key} failed on #${row.seq}`, e);
            db.prepare('INSERT OR REPLACE INTO event_failures (seq, handler, error, at) VALUES (?,?,?,?)').run(row.seq, h.key, String(e?.message ?? e).slice(0, 500), nowIso());
            db.prepare('UPDATE event_cursors SET seq=? WHERE handler=?').run(row.seq, h.key);
          }
        }
        if (rows.length < 500) break;
      }
    }
    fanOut(db, state);
  } finally {
    state.draining = false;
  }
  return calls;
}

/** Committed events after the fan-out cursor go to their coach's open streams. */
function fanOut(db, state) {
  const rows = db.prepare('SELECT seq, type, coach_id, client_id, summary FROM events WHERE seq>? ORDER BY seq LIMIT 1000').all(state.fanSeq);
  for (const e of rows) {
    if (e.coach_id) sendToCoach(e.coach_id, e.type, { seq: e.seq, type: e.type, clientId: e.client_id, summary: e.summary });
    state.fanSeq = e.seq;
  }
}

/**
 * Events for a timeline or activity feed, newest first. `before` is a seq
 * (number or numeric string) or an ISO instant; `types` a list of event types.
 */
export function eventsFor(db, { coachId = null, clientId = null, before = null, limit = 50, types = null } = {}) {
  if (!coachId && !clientId) throw new Error('eventsFor needs coachId or clientId');
  const where = [], args = [];
  if (coachId) { where.push('coach_id=?'); args.push(coachId); }
  if (clientId) { where.push('client_id=?'); args.push(clientId); }
  if (before !== null && before !== undefined && before !== '') {
    if (/^\d+$/.test(String(before))) { where.push('seq<?'); args.push(Number(before)); } else { where.push('at<?'); args.push(String(before)); }
  }
  if (types?.length) { where.push(`type IN (${types.map(() => '?').join(',')})`); args.push(...types); }
  const n = Math.max(1, Math.min(500, Number(limit) || 50));
  return db.prepare(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY seq DESC LIMIT ${n}`).all(...args).map(eventOut);
}

/** `day.started`, once per coach per London day, after 05:00 (meta key day_started:<coachId>). Returns how many it emitted. */
export function emitDayStarted(db, now = new Date()) {
  if (londonClock(now) < '05:00') return 0;
  const day = londonDay(now);
  let n = 0;
  for (const c of db.prepare("SELECT id FROM users WHERE role='coach'").all()) {
    tx(db, () => {
      const key = `day_started:${c.id}`;
      if (db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value === day) return;
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, day);
      emit(db, 'day.started', { coachId: c.id, day });
      n++;
    });
  }
  return n;
}

/** Events are plumbing: rows older than 400 days go (domain tables keep the history). */
export function pruneEvents(db, now = new Date()) {
  const cutoff = londonToUtc(addDays(londonDay(now), -400)).toISOString();
  return tx(db, () => {
    const gone = db.prepare('DELETE FROM events WHERE at<?').run(cutoff).changes;
    db.prepare('DELETE FROM event_failures WHERE seq < (SELECT COALESCE(MIN(seq), 9e18) FROM events)').run();
    return gone;
  });
}
