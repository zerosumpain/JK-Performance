import { initials, requireCoach } from './access.mjs';
import { fail, instant, num } from './http.mjs';
import { notify } from './push.mjs';
import { afterCommit, coachPref, newId, nowIso, tx } from './store.mjs';
import { sendToCoach } from './stream.mjs';
import { addDays, londonClock, londonDay, londonToUtc } from './time.mjs';

/**
 * Coach notifications (docs/design/desk-v2.md 3.3): the desk's bell. Urgent
 * ones (pain, a health flag, a high-severity conflict, a detractor, a risky
 * voice note) also push to the coach's own phone through notify(), outside the
 * coach's quiet hours; inside them the push waits for the end of quiet hours
 * (a 60 s clock) and is dropped if the coach has read it by then.
 */

export const TONES = ['urgent', 'attention', 'ok', 'data'];
const DEDUPE_MS = 24 * 3_600_000;

// MARK: - Quiet hours (shared with the outreach governor in messages.mjs)

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A quiet-hours preference as `{start, end}` ("HH:MM" London), or null for
 * none. Accepts `{start, end}`, "21:00-07:30" (or with an en dash), or
 * null / false / "off". Anything unreadable falls back to `fallback`.
 */
export function quietWindow(value, fallback) {
  if (value === undefined) return fallback;
  if (value === null || value === false || value === 'off') return null;
  let start, end;
  if (typeof value === 'string') [start, end] = value.split(/\s*[-–]\s*/);
  else if (typeof value === 'object') ({ start, end } = value);
  if (!CLOCK.test(start ?? '') || !CLOCK.test(end ?? '') || start === end) return fallback;
  return { start, end };
}

/** Is London wall-clock time at `now` inside the window? The end is exclusive. */
export function inWindow(now, w) {
  if (!w) return false;
  const t = londonClock(now);
  return w.start < w.end ? t >= w.start && t < w.end : t >= w.start || t < w.end;
}

/** The next instant at or after `now` when London wall-clock reads `clock`. */
export function nextClock(now, clock) {
  const today = londonDay(now);
  const candidate = londonToUtc(today, clock);
  return candidate.getTime() >= now.getTime() ? candidate : londonToUtc(addDays(today, 1), clock);
}

/** When the window that `now` is in ends (now itself when outside it). */
export const windowEnd = (now, w) => (inWindow(now, w) ? nextClock(now, w.end) : now);

export const COACH_QUIET_DEFAULT = { start: '22:00', end: '06:30' };

// MARK: - Notifying

export const notificationOut = (n, client) => ({
  id: n.id, kind: n.kind, title: n.title, body: n.body, path: n.path, icon: n.icon, tone: n.tone,
  client: client ? { id: client.id, name: client.name, initials: initials(client.name) } : null,
  readAt: n.read_at, at: n.created_at,
});

/**
 * Tell the coach something in the desk. Same `(coach, dedupe)` within 24 hours
 * is dropped (returns null), and so is a kind the coach switched off. Stream and push work happens after commit.
 * Returns the new row.
 */
export function notifyCoach(db, config, coachId, { clientId = null, kind, title, body = '', path = null, icon = null, tone = 'data', dedupe = null, now = new Date() }) {
  if (!coachId || !kind || !title) throw new Error('notifyCoach needs coachId, kind and title');
  if (!TONES.includes(tone)) throw new Error(`notifyCoach: unknown tone ${tone}`);
  // Settings › Notifications can switch any kind off (notify.prefs[kind] === false); default on.
  const prefs = coachPref(db, coachId, 'notify.prefs', {});
  if (prefs && typeof prefs === 'object' && prefs[kind] === false) return null;
  return tx(db, () => {
    if (dedupe && db.prepare('SELECT 1 FROM coach_notifications WHERE coach_id=? AND dedupe=? AND created_at>?')
      .get(coachId, dedupe, new Date(now.getTime() - DEDUPE_MS).toISOString())) return null;
    const id = newId('nt');
    let pushAfter = null;
    let pushNow = false;
    if (tone === 'urgent' && coachPref(db, coachId, 'notify.push.urgent', true) !== false) {
      const quiet = quietWindow(coachPref(db, coachId, 'notify.quietHours'), COACH_QUIET_DEFAULT);
      if (inWindow(now, quiet)) pushAfter = windowEnd(now, quiet).toISOString();
      else pushNow = true;
    }
    db.prepare(`INSERT INTO coach_notifications (id, coach_id, client_id, kind, title, body, path, icon, tone, dedupe, push_after, pushed_at, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, coachId, clientId, String(kind).slice(0, 60), String(title).slice(0, 200), String(body ?? '').slice(0, 1000),
      path, icon, tone, dedupe, pushAfter, pushNow ? now.toISOString() : null, now.toISOString());
    const row = db.prepare('SELECT * FROM coach_notifications WHERE id=?').get(id);
    const client = clientId ? db.prepare('SELECT id, name FROM users WHERE id=?').get(clientId) : null;
    afterCommit(() => sendToCoach(coachId, 'notification', notificationOut(row, client)));
    if (pushNow) afterCommit(() => notify(db, config, coachId, { title: row.title, body: row.body || row.title, kind: 'coachNotification', id: row.id, clientId }));
    return row;
  });
}

/** The 60 s clock: push urgent notifications whose quiet hours have ended, unless read. Returns how many it pushed. */
export function pushDueNotifications(db, config, now = new Date()) {
  const due = db.prepare('SELECT * FROM coach_notifications WHERE pushed_at IS NULL AND push_after IS NOT NULL AND push_after<=? ORDER BY push_after LIMIT 100').all(now.toISOString());
  let pushed = 0;
  for (const n of due) {
    const send = tx(db, () => {
      // Claim first, so a crash means late (or never), never twice.
      const claimed = db.prepare('UPDATE coach_notifications SET pushed_at=?, push_after=CASE WHEN read_at IS NULL THEN push_after ELSE NULL END WHERE id=? AND pushed_at IS NULL').run(now.toISOString(), n.id).changes;
      return claimed && !n.read_at;
    });
    if (!send) continue;
    notify(db, config, n.coach_id, { title: n.title, body: n.body || n.title, kind: 'coachNotification', id: n.id, clientId: n.client_id });
    pushed++;
  }
  return pushed;
}

/** Notifications older than 90 days go. */
export function pruneNotifications(db, now = new Date()) {
  return db.prepare('DELETE FROM coach_notifications WHERE created_at<?').run(new Date(now.getTime() - 90 * 86_400_000).toISOString()).changes;
}

const unreadOf = (db, coachId) => db.prepare('SELECT COUNT(*) n FROM coach_notifications WHERE coach_id=? AND read_at IS NULL').get(coachId).n;

// MARK: - Routes

function list(_req, ctx) {
  requireCoach(ctx);
  const before = ctx.query.before ? instant(ctx.query.before, 'before') : '9999';
  const limit = ctx.query.limit === undefined ? 30 : num(Number(ctx.query.limit), 'limit', { min: 1, max: 100, int: true });
  const unreadOnly = ctx.query.unread === '1';
  const rows = ctx.db.prepare(`SELECT n.*, u.name client_name FROM coach_notifications n LEFT JOIN users u ON u.id=n.client_id AND u.coach_id=n.coach_id
    WHERE n.coach_id=? AND n.created_at<? ${unreadOnly ? 'AND n.read_at IS NULL' : ''} ORDER BY n.created_at DESC LIMIT ?`).all(ctx.user.id, before, limit);
  return {
    items: rows.map(n => notificationOut(n, n.client_name ? { id: n.client_id, name: n.client_name } : null)),
    unread: unreadOf(ctx.db, ctx.user.id),
  };
}

function count(_req, ctx) {
  requireCoach(ctx);
  return { unread: unreadOf(ctx.db, ctx.user.id) };
}

function markRead(_req, ctx) {
  requireCoach(ctx);
  const at = nowIso();
  if (ctx.body.all === true) {
    ctx.db.prepare('UPDATE coach_notifications SET read_at=? WHERE coach_id=? AND read_at IS NULL').run(at, ctx.user.id);
  } else {
    const ids = ctx.body.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some(id => typeof id !== 'string')) fail(400, 'ids must be a list of notification ids, or all: true');
    tx(ctx.db, () => {
      for (const id of ids) {
        const n = ctx.db.prepare('SELECT 1 FROM coach_notifications WHERE id=? AND coach_id=?').get(id, ctx.user.id);
        if (!n) fail(404, 'Not found');
        ctx.db.prepare('UPDATE coach_notifications SET read_at=COALESCE(read_at, ?) WHERE id=?').run(at, id);
      }
    });
  }
  return { unread: unreadOf(ctx.db, ctx.user.id) };
}

export function notificationRoutes(r) {
  r.add('GET', '/api/notifications', list);
  r.add('GET', '/api/notifications/count', count);
  r.add('POST', '/api/notifications/read', markRead);
}
