import { clientFor, initials, requireCoach } from '../access.mjs';
import { cancellationPolicy, hasTable, shortWhen } from '../bookings.mjs';
import { emit } from '../events.mjs';
import { day as dayArg, fail, oneOf, str } from '../http.mjs';
import { sendMessage } from '../messages.mjs';
import { hooks } from '../registry.mjs';
import { newId, nowIso, tx } from '../store.mjs';
import { addDays, daysBetween, londonClock, londonDay, londonToUtc } from '../time.mjs';

/**
 * The coach's diary and session notes (F22, docs/design/desk-v2.md WP7).
 *
 * /diary/:day shows one agenda for the day: the sessions (with attendance),
 * plus whatever other features put on it through the `diary` hook (holds,
 * busy time, time off, tasks, campaign milestones, birthdays), plus letters
 * due. Beside it, a journal: the coach's own words, a mood and tags.
 *
 * Session notes are personal data about the client (private note included):
 * they cascade with the client and go in the client's export. Diary entries
 * are the coach's own and go in the coach's export.
 */

const ATTENDANCE = ['attended', 'late', 'noShow', 'lateCancel'];
const ATTENDANCE_EVENT = { attended: 'booking.attended', late: 'booking.attended', noShow: 'booking.noShow', lateCancel: 'booking.lateCancel' };
const ATTENDANCE_WORD = { attended: 'Attended', late: 'Late', noShow: 'No-show', lateCancel: 'Late cancel' };
const NOTE_FIELDS = [['focus', 'focus', 600], ['did', 'did', 4000], ['wins', 'wins', 1000], ['next', 'next', 1000], ['privateNote', 'private_note', 4000]];
const KIND_WORD = { inperson: '1:1', video: 'Video call', group: 'Class' };
const firstName = n => String(n ?? '').split(' ')[0];
const words = text => (String(text ?? '').trim().match(/\S+/g) ?? []).length;

// MARK: - Shapes

const entryOut = e => (e ? { day: e.day, body: e.body, mood: e.mood ?? null, tags: JSON.parse(e.tags || '[]'), updatedAt: e.updated_at, words: words(e.body) } : null);
const noteOut = (n, client) => ({
  id: n?.id ?? null, bookingId: n?.booking_id ?? null, clientId: client.id, client: { id: client.id, name: client.name, initials: initials(client.name) },
  attendance: n?.attendance ?? null, focus: n?.focus ?? '', did: n?.did ?? '', wins: n?.wins ?? '', next: n?.next ?? '', privateNote: n?.private_note ?? '',
  sharedMessageId: n?.shared_message_id ?? null, updatedAt: n?.updated_at ?? null,
});

// MARK: - Session notes

/** A booking of this coach's, or a 404. */
function ownBooking(ctx) {
  const b = ctx.db.prepare('SELECT * FROM bookings WHERE id=? AND coach_id=?').get(ctx.params.bookingId, ctx.user.id);
  if (!b) fail(404, 'Not found');
  return b;
}

/** Who was on a booking: the client of a 1:1, or a class's attendees, who are still this coach's clients. */
function participants(db, b, coachId) {
  if (b.kind === 'group') {
    return db.prepare(`SELECT u.* FROM class_attendees a JOIN users u ON u.id=a.user_id WHERE a.booking_id=? AND u.coach_id=? ORDER BY u.name`).all(b.id, coachId);
  }
  return db.prepare("SELECT * FROM users WHERE id=? AND role='client' AND coach_id=?").all(b.client_id ?? '', coachId);
}

function getNotes(_req, ctx) {
  requireCoach(ctx);
  const b = ownBooking(ctx);
  const people = participants(ctx.db, b, ctx.user.id);
  const notes = new Map(ctx.db.prepare('SELECT * FROM session_notes WHERE booking_id=?').all(b.id).map(n => [n.client_id, n]));
  return {
    booking: { id: b.id, kind: b.kind, start: b.start, end: b.end, title: b.title, location: b.location, cancelledAt: b.cancelled_at ?? null },
    notes: people.map(p => noteOut(notes.get(p.id), p)),
  };
}

/** Upsert the note for one person on one booking; attendance changes emit booking.attended / noShow / lateCancel. */
export function saveNote(db, coachId, b, client, body, now = new Date()) {
  const attendance = body.attendance === undefined ? undefined : body.attendance === null ? null : oneOf(body.attendance, 'attendance', ATTENDANCE);
  if (attendance && attendance !== 'lateCancel' && Date.parse(b.start) > now.getTime()) fail(400, 'That session hasn\'t started yet');
  const vals = {};
  for (const [key, col, max] of NOTE_FIELDS) if (body[key] !== undefined) vals[col] = body[key] === null ? '' : str(body[key], key, { max, min: 0 });
  return tx(db, () => {
    const prior = db.prepare('SELECT * FROM session_notes WHERE booking_id=? AND client_id=?').get(b.id, client.id);
    const at = now.toISOString();
    if (!prior) {
      db.prepare(`INSERT INTO session_notes (id, coach_id, booking_id, client_id, attendance, focus, did, wins, next, private_note, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(newId('sn'), coachId, b.id, client.id, attendance ?? null, vals.focus ?? '', vals.did ?? '', vals.wins ?? '', vals.next ?? '', vals.private_note ?? '', at, at);
    } else {
      const sets = Object.keys(vals).map(c => `${c}=?`);
      if (attendance !== undefined) sets.push('attendance=?');
      db.prepare(`UPDATE session_notes SET ${[...sets, 'coach_id=?', 'updated_at=?'].join(', ')} WHERE id=?`)
        .run(...Object.values(vals), ...(attendance !== undefined ? [attendance] : []), coachId, at, prior.id);
    }
    if (attendance && attendance !== prior?.attendance) {
      const policy = cancellationPolicy(db, coachId);
      const feePence = attendance === 'noShow' ? policy.noShowFeePence : attendance === 'lateCancel' ? policy.cancelFeePence : 0;
      emit(db, ATTENDANCE_EVENT[attendance], {
        coachId, clientId: client.id, summary: `${ATTENDANCE_WORD[attendance]} · ${shortWhen(b.start)}`,
        bookingId: b.id, attendance, late: attendance === 'late', policy: { forfeitCredit: policy.forfeitCredit, feePence },
      });
    }
    return db.prepare('SELECT * FROM session_notes WHERE booking_id=? AND client_id=?').get(b.id, client.id);
  });
}

function putNote(_req, ctx) {
  requireCoach(ctx);
  const b = ownBooking(ctx);
  const clientId = str(ctx.body.clientId, 'clientId', { max: 64 });
  const client = participants(ctx.db, b, ctx.user.id).find(p => p.id === clientId);
  if (!client) fail(404, 'Not found');
  return { note: noteOut(saveNote(ctx.db, ctx.user.id, b, client, ctx.body), client) };
}

/** "Share recap with client": Focus, Wins and Next time as one message (never the private note or what we did). */
function shareRecap(_req, ctx) {
  requireCoach(ctx);
  const b = ownBooking(ctx);
  const clientId = str(ctx.body.clientId, 'clientId', { max: 64 });
  const client = participants(ctx.db, b, ctx.user.id).find(p => p.id === clientId);
  if (!client) fail(404, 'Not found');
  const n = ctx.db.prepare('SELECT * FROM session_notes WHERE booking_id=? AND client_id=?').get(b.id, client.id);
  if (!n || ![n.focus, n.wins, n.next].some(x => x.trim())) fail(400, 'Write the focus, wins or next time first');
  const dayWord = shortWhen(b.start).replace(/ \d\d:\d\d$/, '');
  const text = [`Session recap · ${dayWord}`, n.focus.trim() && `Focus: ${n.focus.trim()}`, n.wins.trim() && `Wins: ${n.wins.trim()}`, n.next.trim() && `Next time: ${n.next.trim()}`]
    .filter(Boolean).join('\n\n');
  const id = tx(ctx.db, () => {
    const out = sendMessage(ctx.db, ctx.config, { coachId: ctx.user.id, clientId: client.id, text, via: 'coachAction' });
    ctx.db.prepare('UPDATE session_notes SET shared_message_id=?, updated_at=? WHERE id=?').run(out.message.id, nowIso(), n.id);
    emit(ctx.db, 'session.recapShared', { coachId: ctx.user.id, clientId: client.id, summary: 'Session recap shared', bookingId: b.id, messageId: out.message.id });
    return out.message.id;
  });
  return { messageId: id };
}

// MARK: - Attendance

/**
 * Past sessions for one client (1:1s and classes they joined) with their
 * notes, from `sinceIso` to now. Attended = not marked no-show or late cancel.
 */
export function attendanceOf(db, coachId, clientId, sinceIso, now = new Date()) {
  const rows = db.prepare(`SELECT b.* FROM bookings b WHERE b.coach_id=? AND b.cancelled_at IS NULL AND b.start>=? AND b.start<?
      AND (b.client_id=? OR b.id IN (SELECT booking_id FROM class_attendees WHERE user_id=?)) ORDER BY b.start DESC LIMIT 200`)
    .all(coachId, sinceIso, now.toISOString(), clientId, clientId);
  const notes = new Map(db.prepare('SELECT * FROM session_notes WHERE client_id=? AND booking_id IN (SELECT value FROM json_each(?))')
    .all(clientId, JSON.stringify(rows.map(r => r.id))).map(n => [n.booking_id, n]));
  let attended = 0, noShow = 0, lateCancel = 0, late = 0;
  const sessions = rows.map(b => {
    const n = notes.get(b.id);
    const a = n?.attendance ?? null;
    if (a === 'noShow') noShow++; else if (a === 'lateCancel') lateCancel++; else { attended++; if (a === 'late') late++; }
    return {
      bookingId: b.id, kind: b.kind, start: b.start, end: b.end, title: b.title, attendance: a, marked: !!a,
      note: n ? { focus: n.focus, did: n.did, wins: n.wins, next: n.next, hasPrivate: !!n.private_note } : null, shared: !!n?.shared_message_id,
    };
  });
  const total = rows.length;
  return { rate: total ? Math.round(attended / total * 100) : null, attended, late, noShow, lateCancel, total, sessions };
}

function getAttendance(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.params.id);
  return attendanceOf(ctx.db, ctx.user.id, client.id, londonToUtc(addDays(londonDay(), -180)).toISOString());
}

// MARK: - The diary

const DAY_RE = /^\d{4}-\d\d-\d\d$/;

/** Sessions on a day, with attendance, as diary agenda items. */
function sessionItems(db, coach, dy) {
  const lo = londonToUtc(dy).toISOString(), hi = londonToUtc(addDays(dy, 1)).toISOString();
  const rows = db.prepare(`SELECT b.*, u.name client_name FROM bookings b LEFT JOIN users u ON u.id=b.client_id AND u.coach_id=b.coach_id
    WHERE b.coach_id=? AND b.cancelled_at IS NULL AND b.start>=? AND b.start<? ORDER BY b.start`).all(coach.id, lo, hi);
  return rows.map(b => {
    const people = participants(db, b, coach.id);
    const notes = new Map(db.prepare('SELECT client_id, attendance, focus FROM session_notes WHERE booking_id=?').all(b.id).map(n => [n.client_id, n]));
    const who = b.kind === 'group' ? b.title : b.client_name ?? 'Client';
    const marked = people.filter(p => notes.get(p.id)?.attendance).length;
    const single = b.kind !== 'group' && people[0] ? notes.get(people[0].id) : null;
    return {
      at: b.start, end: b.end, day: dy, kind: 'session', icon: b.kind === 'group' ? 'group' : b.kind === 'video' ? 'videocam' : 'person',
      title: who, detail: [KIND_WORD[b.kind], `${londonClock(new Date(b.start))}–${londonClock(new Date(b.end))}`, b.location && b.location !== KIND_WORD[b.kind] ? b.location : null, b.kind === 'group' ? `${people.length} booked` : null].filter(Boolean).join(' · '),
      path: b.kind === 'group' ? `/schedule/class/${b.id}/${dy}` : b.client_id ? `/clients/${b.client_id}/sessions` : null,
      tone: single?.attendance === 'noShow' || single?.attendance === 'lateCancel' ? 'attention' : 'data',
      bookingId: b.id, bookingKind: b.kind, attendance: single?.attendance ?? null, marked, people: people.map(p => ({ id: p.id, name: p.name, attendance: notes.get(p.id)?.attendance ?? null })),
      noteFocus: single?.focus || null,
    };
  });
}

/** Letters scheduled to land on a day. */
function letterItems(db, coach, dy) {
  const lo = londonToUtc(dy).toISOString(), hi = londonToUtc(addDays(dy, 1)).toISOString();
  return db.prepare(`SELECT r.id, r.deliver_at, r.delivered_at, r.client_id, u.name FROM reports r JOIN users u ON u.id=r.client_id AND u.coach_id=?
    WHERE r.published_at IS NOT NULL AND r.deliver_at>=? AND r.deliver_at<? ORDER BY r.deliver_at`).all(coach.id, lo, hi)
    .map(r => ({ at: r.deliver_at, day: dy, kind: 'letter', icon: 'mail', title: `Letter to ${firstName(r.name)}`, detail: r.delivered_at ? 'Delivered' : 'Scheduled to land', path: `/clients/${r.client_id}/letters`, tone: 'data' }));
}

/** Every feature's diary items for a day, merged and time-ordered (all-day items first). A throwing provider is logged and skipped. */
export function agendaFor(db, coach, dy) {
  const out = [];
  for (const [f, fn] of hooks('diary')) {
    try {
      for (const it of fn(db, coach, dy) ?? []) out.push({ ...it, day: it.day ?? dy, source: f.name });
    } catch (e) { console.error(`diary hook of ${f.name} failed`, e); }
  }
  return out.sort((a, b) => (a.at ? 1 : 0) - (b.at ? 1 : 0) || String(a.at ?? '').localeCompare(String(b.at ?? '')) || String(a.title).localeCompare(String(b.title)));
}

function getDay(_req, ctx) {
  requireCoach(ctx);
  const dy = dayArg(ctx.params.day, 'day');
  const e = ctx.db.prepare('SELECT * FROM diary_entries WHERE coach_id=? AND day=?').get(ctx.user.id, dy);
  return { day: dy, agenda: agendaFor(ctx.db, ctx.user, dy), entry: entryOut(e) };
}

function putDay(_req, ctx) {
  requireCoach(ctx);
  const dy = dayArg(ctx.params.day, 'day');
  const b = ctx.body;
  const body = b.body === undefined || b.body === null ? '' : typeof b.body === 'string' && b.body.length <= 20_000 ? b.body : fail(400, 'body must be text up to 20000 characters');
  const mood = b.mood === undefined ? undefined : b.mood === null ? null : Number.isInteger(b.mood) && b.mood >= 1 && b.mood <= 5 ? b.mood : fail(400, 'mood must be 1 to 5');
  let tags;
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || b.tags.length > 10 || b.tags.some(t => typeof t !== 'string' || !t.trim() || t.trim().length > 24)) fail(400, 'tags must be up to 10 words of 24 characters');
    tags = [...new Set(b.tags.map(t => t.trim().toLowerCase()))];
  }
  const at = nowIso();
  const e = tx(ctx.db, () => {
    const prior = ctx.db.prepare('SELECT * FROM diary_entries WHERE coach_id=? AND day=?').get(ctx.user.id, dy);
    if (prior) {
      ctx.db.prepare('UPDATE diary_entries SET body=?, mood=?, tags=?, updated_at=? WHERE id=?')
        .run(body, mood === undefined ? prior.mood : mood, tags === undefined ? prior.tags : JSON.stringify(tags), at, prior.id);
    } else {
      ctx.db.prepare('INSERT INTO diary_entries (id, coach_id, day, body, mood, tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(newId('de'), ctx.user.id, dy, body, mood ?? null, JSON.stringify(tags ?? []), at, at);
    }
    // Once a day, when the page first has words: no text in the event.
    if (body.trim() && !prior?.body?.trim()) emit(ctx.db, 'diary.written', { coachId: ctx.user.id, summary: 'Diary written', day: dy, words: words(body) });
    return ctx.db.prepare('SELECT * FROM diary_entries WHERE coach_id=? AND day=?').get(ctx.user.id, dy);
  });
  return { entry: entryOut(e) };
}

function listDays(_req, ctx) {
  requireCoach(ctx);
  const today = londonDay();
  const from = dayArg(ctx.query.from, 'from', { optional: true }) ?? addDays(today, -89);
  const to = dayArg(ctx.query.to, 'to', { optional: true }) ?? today;
  if (to < from) fail(400, 'to is before from');
  if (daysBetween(from, to) > 366) fail(400, 'At most a year at a time');
  const rows = ctx.db.prepare('SELECT day, body, mood FROM diary_entries WHERE coach_id=? AND day>=? AND day<=? ORDER BY day').all(ctx.user.id, from, to);
  return { days: rows.filter(r => r.body.trim() || r.mood).map(r => ({ day: r.day, words: words(r.body), mood: r.mood ?? null })) };
}

// MARK: - Hooks

/** Booking ids that do not count as attended (3.4): marked no-show or late cancel. */
function quiet(db, coachId, clientIds, sinceIso) {
  if (!clientIds?.length) return new Set();
  return new Set(db.prepare(`SELECT n.booking_id FROM session_notes n JOIN users u ON u.id=n.client_id AND u.coach_id=?
    JOIN bookings b ON b.id=n.booking_id WHERE n.client_id IN (SELECT value FROM json_each(?)) AND n.attendance IN ('noShow','lateCancel') AND b.start>=?`)
    .all(coachId, JSON.stringify(clientIds), sinceIso ?? '').map(r => r.booking_id));
}

/** diary.noShows90 and diary.attendance90 for a batch of clients. */
function facts90(db, coachId, clientIds, today) {
  const since = londonToUtc(addDays(today ?? londonDay(), -90)).toISOString();
  const out = new Map();
  for (const id of clientIds) {
    const a = attendanceOf(db, coachId, id, since);
    out.set(id, a);
  }
  return out;
}

function search(db, coach, q, limit) {
  const like = `%${String(q).replace(/[\\%_]/g, c => `\\${c}`)}%`;
  return db.prepare("SELECT day, body, updated_at FROM diary_entries WHERE coach_id=? AND body LIKE ? ESCAPE '\\' ORDER BY day DESC LIMIT ?").all(coach.id, like, limit)
    .map(r => {
      const i = r.body.toLowerCase().indexOf(String(q).toLowerCase());
      const snippet = r.body.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, ' ').trim();
      return { type: 'diary', id: r.day, title: `Diary · ${shortWhen(londonToUtc(r.day, '12:00').toISOString()).replace(/ \d\d:\d\d$/, '')}`, detail: snippet, path: `/diary/${r.day}`, icon: 'edit_note', score: 0.5, at: r.updated_at };
    });
}

function timeline(db, coach, client, before, limit) {
  const rows = db.prepare(`SELECT n.*, b.start, b.kind FROM session_notes n JOIN bookings b ON b.id=n.booking_id JOIN users u ON u.id=n.client_id AND u.coach_id=?
    WHERE n.client_id=? AND b.start<? ORDER BY b.start DESC LIMIT ?`).all(coach.id, client.id, before ?? '9999', limit ?? 20);
  return rows.map(n => ({
    at: n.start, icon: n.attendance === 'noShow' || n.attendance === 'lateCancel' ? 'event_busy' : 'edit_note', tone: n.attendance === 'noShow' ? 'attention' : 'data',
    title: `Session notes${n.attendance ? ` · ${ATTENDANCE_WORD[n.attendance]}` : ''}`, detail: n.focus || n.wins || '', path: `/clients/${client.id}/sessions`, kind: 'session',
  }));
}

function exportFor(db, user) {
  if (user.role === 'coach') {
    return { diary: db.prepare('SELECT day, body, mood, tags, created_at, updated_at FROM diary_entries WHERE coach_id=? ORDER BY day').all(user.id).map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') })) };
  }
  return {
    sessionNotes: db.prepare(`SELECT b.start, b.kind, n.attendance, n.focus, n.did, n.wins, n.next, n.private_note, n.created_at, n.updated_at
      FROM session_notes n JOIN bookings b ON b.id=n.booking_id WHERE n.client_id=? ORDER BY b.start`).all(user.id),
  };
}

// MARK: - Demo

const JOURNAL = [
  ['Good energy in the studio today. Sam moved the bar fast on the second set, the first time it has looked easy. Need to write the next block before Friday.', 4, ['training', 'programming']],
  ['Quiet morning. Used it to tidy the onboarding forms and answer the backlog of messages. Felt better for clearing it.', 3, ['admin']],
  ['Priya asked about race week. Worth sketching a taper now rather than in a rush. Her engine is miles ahead of where it was in September.', 4, ['clients', 'racing']],
  ['Tired. Too many early starts this week. Block out Friday afternoon for programming and protect it.', 2, ['energy']],
  ['Leo’s back again. He needs fewer exercises and more walking, not another stretch. Simplify, simplify.', 3, ['clients']],
  ['Conditioning class was full and loud. Best one in weeks. The partner relay works, keep it.', 5, ['classes']],
  ['Reflected on what makes clients stick: the ones who reply to their letters stay. Make the question at the end of each letter better.', 4, ['business', 'letters']],
  ['Short day. Took the afternoon off and walked the river. Ideas come when I stop.', 4, ['rest']],
  ['Rory’s calf is the thing to watch. Fewer intervals, more hills. Message him tonight.', 3, ['clients', 'injury']],
  ['Admin day: invoices, the accountant, the website copy. Not my favourite, but done.', 2, ['admin']],
  ['Tom missed again. Don’t chase with guilt; ask what would make it easier. One small thing.', 3, ['clients', 'retention']],
  ['New squat PB for Sam. Remember to put it in his letter, he will not mention it himself.', 5, ['wins']],
  ['Read about periodisation for hybrid athletes. Two ideas worth trying with Priya’s next block.', 4, ['learning']],
  ['Back-to-back day. The ten-minute buffers made it feel calm for once. Keep them.', 4, ['schedule']],
  ['Alex cancelled late. Fine, but the policy exists for a reason. Talk to him kindly about it.', 3, ['clients']],
  ['Planned next month: two trials, one consult, the new class time. Calendar looks full but human.', 4, ['planning']],
  ['Slept badly; coached well anyway. Note to self: caffeine after two is a no.', 2, ['energy']],
  ['Good conversation with Sam about what comes after the 120 kg squat. He wants to compete. Exciting.', 5, ['clients', 'goals']],
  ['Spent the evening on the guidebook for the spring reset. Half done.', 3, ['programming']],
  ['Steady week. Nothing dramatic, which is what good coaching looks like most of the time.', 4, ['reflection']],
];

const NOTE_TEXT = {
  strength: { focus: 'Squat depth and bracing', did: 'Back squat 5×5, RDL 3×8, split squats 3×10 each side, carries.', wins: 'Top set moved fast; knee felt fine all session.', next: 'Add 2.5 kg to the top set; film the last rep.' },
  hybrid: { focus: 'Engine under fatigue', did: 'Row 4×500 m, sled push intervals, wall balls, a short run-off.', wins: 'Held pace on every row rep.', next: 'Race-pace practice: two transitions back to back.' },
  running: { focus: 'Calf load and running economy', did: 'Calf raises, hill strides, single-leg work, easy 20 min.', wins: 'No calf tightness through the strides.', next: 'Keep intervals out one more week; hills only.' },
  group: { focus: 'Partner conditioning', did: 'Partner relay, kettlebell complexes, a finisher.', wins: 'Full effort on the last round.', next: 'Same format, heavier bells.' },
};

function buildDemo(db, { coach, clients, today }) {
  // Some tests build the demo before createApp has run feature schemas: then there is nothing to build.
  if (!hasTable(db, 'diary_entries') || !hasTable(db, 'session_notes')) return;
  // The wipe is ours (not demo.tables): demo.mjs's wipe would fail on a database without these tables yet.
  db.prepare('DELETE FROM diary_entries WHERE coach_id=?').run(coach.id);
  db.prepare('DELETE FROM session_notes WHERE coach_id=? OR client_id IN (SELECT value FROM json_each(?))').run(coach.id, JSON.stringify(clients.map(c => c.id)));
  const at = (d, t) => londonToUtc(d, t).toISOString();
  // Journal: 20 of the last 30 days.
  const dayOffsets = Array.from({ length: 30 }, (_, i) => i).sort((a, b) => ((a * 7919) % 31) - ((b * 7919) % 31)).slice(0, 20).sort((a, b) => b - a);
  dayOffsets.forEach((off, i) => {
    const dy = addDays(today, -off);
    const [body, mood, tags] = JOURNAL[i % JOURNAL.length];
    db.prepare('INSERT INTO diary_entries (id, coach_id, day, body, mood, tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(newId('de'), coach.id, dy, body, mood, JSON.stringify(tags), at(dy, '21:10'), at(dy, '21:25'));
  });

  // Session notes for the last three weeks of sessions; one no-show, one late arrival, the rest attended.
  const now = new Date();
  const since = new Date(now.getTime() - 21 * 86_400_000).toISOString();
  const routineOf = new Map(clients.map(c => [c.id, c.name.startsWith('Priya') ? 'hybrid' : c.name.startsWith('Rory') ? 'running' : 'strength']));
  const ins = db.prepare(`INSERT OR IGNORE INTO session_notes (id, coach_id, booking_id, client_id, attendance, focus, did, wins, next, private_note, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const ones = db.prepare("SELECT * FROM bookings WHERE coach_id=? AND kind!='group' AND cancelled_at IS NULL AND start>=? AND start<? ORDER BY start").all(coach.id, since, now.toISOString());
  ones.forEach((b, i) => {
    const t = NOTE_TEXT[routineOf.get(b.client_id) ?? 'strength'];
    const late = i === 1;
    const written = new Date(Date.parse(b.end) + 40 * 60_000).toISOString();
    ins.run(newId('sn'), coach.id, b.id, b.client_id, late ? 'late' : 'attended', t.focus, t.did, t.wins, t.next,
      i % 3 === 0 ? 'Mentioned work stress again; keep the load honest this week.' : '', written, written);
  });
  const classes = db.prepare("SELECT * FROM bookings WHERE coach_id=? AND kind='group' AND cancelled_at IS NULL AND start>=? AND start<? ORDER BY start").all(coach.id, since, now.toISOString());
  classes.forEach((b, ci) => {
    const people = db.prepare('SELECT user_id FROM class_attendees WHERE booking_id=?').all(b.id).map(r => r.user_id);
    people.forEach(uid => {
      const noShow = ci === classes.length - 1 && clients.find(c => c.id === uid)?.name.startsWith('Rory');
      const t = NOTE_TEXT.group;
      const written = new Date(Date.parse(b.end) + 30 * 60_000).toISOString();
      ins.run(newId('sn'), coach.id, b.id, uid, noShow ? 'noShow' : 'attended', noShow ? '' : t.focus, noShow ? '' : t.did, noShow ? '' : t.wins, noShow ? '' : t.next,
        noShow ? 'No message beforehand. Check in gently, no guilt.' : '', written, written);
    });
  });
}

// MARK: - The feature

export const feature = {
  name: 'diary',
  namespaces: ['diary', 'session'],
  exact: ['booking.attended', 'booking.noShow', 'booking.lateCancel'],

  schema(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS diary_entries (
        id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', mood INTEGER CHECK (mood BETWEEN 1 AND 5),
        tags TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (coach_id, day));
      CREATE TABLE IF NOT EXISTS session_notes (
        id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        attendance TEXT CHECK (attendance IN ('attended','late','noShow','lateCancel')),
        focus TEXT NOT NULL DEFAULT '', did TEXT NOT NULL DEFAULT '', wins TEXT NOT NULL DEFAULT '', next TEXT NOT NULL DEFAULT '',
        private_note TEXT NOT NULL DEFAULT '', shared_message_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (booking_id, client_id));
      CREATE INDEX IF NOT EXISTS session_notes_client ON session_notes(client_id);`);
  },

  routes(r) {
    r.add('GET', '/api/diary', listDays);
    r.add('GET', '/api/diary/:day', getDay);
    r.add('PUT', '/api/diary/:day', putDay);
    r.add('GET', '/api/sessions/:bookingId/notes', getNotes);
    r.add('PUT', '/api/sessions/:bookingId/notes', putNote);
    r.add('POST', '/api/sessions/:bookingId/notes/share', shareRecap);
    r.add('GET', '/api/coach/clients/:id/attendance', getAttendance);
  },

  emits: {
    'booking.attended': { label: 'A client attended a session', payload: ['bookingId', 'attendance', 'late', 'policy'] },
    'booking.noShow': { label: 'A client did not show up', payload: ['bookingId', 'attendance', 'policy'] },
    'booking.lateCancel': { label: 'A session was marked as a late cancel', payload: ['bookingId', 'attendance', 'policy'] },
    'diary.written': { label: 'The coach wrote in their diary', payload: ['day', 'words'] },
    'session.recapShared': { label: 'A session recap was shared with the client', payload: ['bookingId', 'messageId'] },
  },

  facts: {
    'diary.noShows90': {
      label: 'No-shows (90 days)', type: 'number',
      compute: (db, coachId, clientIds, today) => new Map([...facts90(db, coachId, clientIds, today)].map(([id, a]) => [id, a.noShow])),
    },
    'diary.attendance90': {
      label: 'Attendance (90 days, %)', type: 'number',
      compute: (db, coachId, clientIds, today) => new Map([...facts90(db, coachId, clientIds, today)].map(([id, a]) => [id, a.rate])),
    },
  },

  diary: (db, coach, dy) => (DAY_RE.test(dy) ? [...sessionItems(db, coach, dy), ...letterItems(db, coach, dy)] : []),
  quiet,
  search,
  timeline,
  exportFor,

  demo: { build: buildDemo },
};
