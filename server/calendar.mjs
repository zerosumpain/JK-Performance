import { fail, raw } from './http.mjs';
import { hash, nowIso, secret } from './store.mjs';
import { addDays, londonDay, londonToUtc } from './time.mjs';

/**
 * A private calendar feed (iCalendar) of a person's sessions, for Apple
 * Calendar's "subscribe": bookings, classes they're in, and planned workouts
 * that have a start time. The URL carries a random token (only its hash is
 * stored); making a new one or turning it off kills the old URL.
 */

const WORKOUT_MINUTES = 60;

function feedUrl(config, token) {
  const base = new URL(config.publicUrl);
  return { url: `${base.origin}/cal/${token}.ics`, webcal: `webcal://${base.host}/cal/${token}.ics` };
}

function status(_req, ctx) {
  return { active: !!ctx.user.cal_feed_hash };
}

function create(_req, ctx) {
  if (ctx.user.is_demo) fail(403, 'The demo account has no calendar feed');
  const token = secret();
  ctx.db.prepare('UPDATE users SET cal_feed_hash=? WHERE id=?').run(hash(token), ctx.user.id);
  return { active: true, ...feedUrl(ctx.config, token) };
}

function revoke(_req, ctx) {
  ctx.db.prepare('UPDATE users SET cal_feed_hash=NULL WHERE id=?').run(ctx.user.id);
  return { active: false };
}

// MARK: - iCalendar

const esc = text => String(text ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = iso => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** RFC 5545 folds lines over 75 octets with CRLF + space. */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let chunk = '';
  for (const ch of line) {
    if (Buffer.byteLength(chunk + ch) > (out.length ? 74 : 75)) { out.push(chunk); chunk = ''; }
    chunk += ch;
  }
  out.push(chunk);
  return out.join('\r\n ');
}

function event({ uid, start, end, title, location, description }) {
  return [
    'BEGIN:VEVENT', `UID:${uid}@jkperformance`, `DTSTAMP:${stamp(nowIso())}`,
    `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${esc(title)}`,
    ...(location ? [`LOCATION:${esc(location)}`] : []), ...(description ? [`DESCRIPTION:${esc(description)}`] : []),
    'END:VEVENT',
  ];
}

export function calendarFor(db, user) {
  const from = londonToUtc(addDays(londonDay(), -30)).toISOString();
  const events = [];
  const kindLabel = { inperson: 'In person', video: 'Video call', group: 'Group class' };
  if (user.role === 'coach') {
    const rows = db.prepare(`SELECT b.*, u.name client_name FROM bookings b LEFT JOIN users u ON u.id=b.client_id
      WHERE b.coach_id=? AND b.cancelled_at IS NULL AND b.start>=? ORDER BY b.start`).all(user.id, from);
    for (const b of rows) {
      events.push(event({ uid: b.id, start: b.start, end: b.end, location: b.location,
        title: b.kind === 'group' ? b.title : `${b.client_name ?? 'Client'} · ${b.title}`, description: kindLabel[b.kind] }));
    }
  } else {
    const coach = user.coach_id ? db.prepare('SELECT name FROM users WHERE id=?').get(user.coach_id)?.name : null;
    const rows = db.prepare(`SELECT * FROM bookings WHERE cancelled_at IS NULL AND start>=? AND
      (client_id=? OR id IN (SELECT booking_id FROM class_attendees WHERE user_id=?)) ORDER BY start`).all(from, user.id, user.id);
    for (const b of rows) {
      events.push(event({ uid: b.id, start: b.start, end: b.end, location: b.location, title: b.title,
        description: [kindLabel[b.kind], coach && `with ${coach}`].filter(Boolean).join(' · ') }));
    }
    const workouts = db.prepare('SELECT * FROM workouts WHERE client_id=? AND published=1 AND starts_at IS NOT NULL AND date>=? ORDER BY date')
      .all(user.id, addDays(londonDay(), -30));
    for (const w of workouts) {
      const start = londonToUtc(w.date, w.starts_at);
      events.push(event({ uid: w.id, start: start.toISOString(), end: new Date(start.getTime() + WORKOUT_MINUTES * 60_000).toISOString(),
        title: w.title, location: w.location, description: 'Training session in JK Performance' }));
    }
  }
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JK Performance//Sessions//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:JK Performance', 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', ...events.flat(), 'END:VCALENDAR'];
  return lines.map(fold).join('\r\n') + '\r\n';
}

function feed(_req, ctx) {
  const m = /^([A-Za-z0-9_-]{20,})\.ics$/.exec(ctx.params.file);
  if (!m) fail(404, 'Not found');
  const user = ctx.db.prepare('SELECT * FROM users WHERE cal_feed_hash=?').get(hash(m[1]));
  if (!user) fail(404, 'Not found');
  return raw(200, {
    'content-type': 'text/calendar; charset=utf-8',
    'cache-control': 'private, max-age=900',
    'x-content-type-options': 'nosniff',
  }, calendarFor(ctx.db, user));
}

export function calendarRoutes(r) {
  r.add('GET', '/api/calendar/feed', status);
  r.add('POST', '/api/calendar/feed', create);
  r.add('DELETE', '/api/calendar/feed', revoke);
  r.add('GET', '/cal/:file', feed, { public: true });
}
