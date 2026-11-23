import { clientFor, requireCoach, requireMember } from './access.mjs';
import { emit } from './events.mjs';
import { fail, instant, oneOf, str } from './http.mjs';
import { attachableMedia } from './media.mjs';
import { inWindow, nextClock, quietWindow, windowEnd } from './notifications.mjs';
import { notify } from './push.mjs';
import { featuresOf } from './settings.mjs';
import { afterCommit, coachPref, newId, nowIso, tx } from './store.mjs';
import { addDays, londonDay, londonToUtc } from './time.mjs';

/**
 * kind: text (a normal message), letter (the note a delivered letter drops in the thread), answer (a client's answer
 * to a letter's question), formCheck (a video of a lift, with exerciseId), mealPhoto (a photo of a meal).
 */
export const messageOut = m => ({
  id: m.id, clientId: m.client_id, fromId: m.from_id, fromRole: m.from_role, text: m.text, workoutId: m.workout_id, at: m.at, readAt: m.read_at,
  kind: m.kind ?? 'text', reportId: m.report_id ?? null, exerciseId: m.exercise_id ?? null, mediaId: m.media_id ?? null,
  mediaUrl: m.media_id ? `/api/media/${m.media_id}` : null,
});

function threads(_req, ctx) {
  requireCoach(ctx);
  const clients = ctx.db.prepare("SELECT id, name FROM users WHERE role='client' AND coach_id=?").all(ctx.user.id);
  const last = ctx.db.prepare('SELECT * FROM messages WHERE client_id=? ORDER BY at DESC LIMIT 1');
  const unread = ctx.db.prepare("SELECT COUNT(*) n FROM messages WHERE client_id=? AND from_role='client' AND read_at IS NULL");
  const out = clients.map(c => ({ client: { id: c.id, name: c.name }, last: last.get(c.id) ? messageOut(last.get(c.id)) : null, unread: unread.get(c.id).n }));
  out.sort((a, b) => (b.last?.at ?? '').localeCompare(a.last?.at ?? ''));
  return { threads: out };
}

/**
 * The thread, oldest first; reading it marks the other side's messages read.
 * `since=<iso>` also returns `updated`: messages changed (or new) at or after
 * it, by COALESCE(updated_at, at). `cursor` is the greatest such time in the
 * thread, read before the list, so nothing committed in between is skipped.
 */
function list(_req, ctx) {
  requireMember(ctx);
  const client = clientFor(ctx, ctx.query.clientId);
  const after = ctx.query.after ? instant(ctx.query.after, 'after') : '';
  const since = ctx.query.since ? instant(ctx.query.since, 'since') : null;
  const cursor = ctx.db.prepare('SELECT MAX(COALESCE(updated_at, at)) c FROM messages WHERE client_id=?').get(client.id).c;
  const rows = ctx.db.prepare('SELECT * FROM messages WHERE client_id=? AND at>? ORDER BY at LIMIT 500').all(client.id, after);
  const updated = since
    ? ctx.db.prepare('SELECT * FROM messages WHERE client_id=? AND COALESCE(updated_at, at)>=? AND COALESCE(updated_at, at)<=? ORDER BY at LIMIT 500').all(client.id, since, cursor ?? since)
    : null;
  const otherSide = ctx.user.role === 'coach' ? 'client' : 'coach';
  ctx.db.prepare('UPDATE messages SET read_at=? WHERE client_id=? AND from_role=? AND read_at IS NULL').run(nowIso(), client.id, otherSide);
  return { messages: rows.map(messageOut), ...(updated ? { updated: updated.map(messageOut) } : {}), cursor };
}

const voiceLength = sec => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

function send(_req, ctx) {
  requireMember(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  if (ctx.user.role === 'client' && !client.coach_id) fail(409, 'You do not have a coach yet');
  const b = ctx.body;
  const workoutId = b.workoutId ? str(b.workoutId, 'workoutId', { max: 40 }) : null;
  if (workoutId && !ctx.db.prepare('SELECT 1 FROM workouts WHERE id=? AND client_id=?').get(workoutId, client.id)) fail(400, 'workoutId is not in this client\'s plan');
  // "Reply to JK" from a letter: the message quotes it by id.
  const reportId = b.reportId ? str(b.reportId, 'reportId', { max: 40 }) : null;
  if (reportId && !ctx.db.prepare('SELECT 1 FROM reports WHERE id=? AND client_id=? AND published_at IS NOT NULL').get(reportId, client.id)) fail(400, 'reportId is not one of this client\'s letters');
  const exerciseId = b.exerciseId ? str(b.exerciseId, 'exerciseId', { max: 80 }) : null;
  if (exerciseId && !ctx.db.prepare('SELECT 1 FROM exercises WHERE id=?').get(exerciseId)) fail(400, 'exerciseId is not in the library');
  const media = attachableMedia(ctx, b.mediaId, 'mediaId', client);
  const kind = b.kind ? oneOf(b.kind, 'kind', ['text', 'formCheck', 'mealPhoto']) : media ? (exerciseId ? 'formCheck' : 'mealPhoto') : 'text';
  if (ctx.user.role === 'client' && kind !== 'text') {
    // Form checks and meal photos are coach toggles, not plan features.
    const f = featuresOf(ctx.db, ctx.user);
    if (!f[kind === 'formCheck' ? 'formChecks' : 'mealPhotos']) fail(403, 'not_enabled');
    if (!media) fail(400, 'mediaId is required');
  }
  const fallback = kind === 'formCheck' ? 'Form check' : kind === 'mealPhoto' ? 'Meal photo' : workoutId ? 'Plan updated' : null;
  const text = str(b.text || fallback, 'text', { max: 4000 });
  const id = newId('m');
  const fromCoach = ctx.user.role === 'coach';
  const m = tx(ctx.db, () => {
    ctx.db.prepare('INSERT INTO messages (id, client_id, from_id, from_role, text, workout_id, at, kind, report_id, exercise_id, media_id, via) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, client.id, ctx.user.id, ctx.user.role, text, workoutId, nowIso(), kind, reportId, exerciseId, media?.id ?? null, fromCoach ? 'desk' : 'app');
    const row = ctx.db.prepare('SELECT * FROM messages WHERE id=?').get(id);
    const payload = { messageId: id, kind, mediaId: media?.id ?? null };
    if (fromCoach) emit(ctx.db, 'message.sent', { coachId: ctx.user.id, clientId: client.id, summary: 'Message sent', ...payload, via: 'desk' });
    else {
      const summary = media?.kind === 'audio' ? `Voice note · ${voiceLength(media.duration_sec ?? 0)}` : 'Message';
      emit(ctx.db, 'message.received', { coachId: client.coach_id, clientId: client.id, summary, ...payload });
    }
    afterCommit(() => notify(ctx.db, ctx.config, fromCoach ? client.id : client.coach_id, { title: ctx.user.name, body: row.text, kind: 'message', id, clientId: client.id }));
    return row;
  });
  return messageOut(m);
}

// MARK: - Sending from code, and the outreach governor (docs/design/desk-v2.md 3.5)

/**
 * Every `via` has a fixed class. coach: a person pressed a button, never held.
 * automated and marketing: capped per client per day, held in quiet hours and
 * skipped for paused clients (marketing also skips "no broadcasts"). billing:
 * never capped, but held in quiet hours and outside 08:00-20:00.
 */
export const VIA_CLASS = {
  desk: 'coach', app: 'coach', scheduled: 'coach', coachAction: 'coach',
  automation: 'automated', autoflow: 'automated', campaign: 'automated', nudge: 'automated',
  broadcast: 'marketing',
  dunning: 'billing',
};
const CAPPED_VIAS = Object.keys(VIA_CLASS).filter(v => ['automated', 'marketing'].includes(VIA_CLASS[v]));
export const OUTREACH_DEFAULTS = { dailyCap: 3, quietHours: { start: '21:00', end: '07:30' } };
const BILLING_HOURS = { start: '20:00', end: '08:00' }; // dunning is held outside 08:00-20:00

/** The coach's outreach settings, defaults filled in. */
export function outreachSettings(db, coachId) {
  const cap = Number(coachPref(db, coachId, 'outreach.dailyCap', OUTREACH_DEFAULTS.dailyCap));
  return {
    dailyCap: Number.isInteger(cap) && cap >= 0 && cap <= 50 ? cap : OUTREACH_DEFAULTS.dailyCap,
    quietHours: quietWindow(coachPref(db, coachId, 'outreach.quietHours'), OUTREACH_DEFAULTS.quietHours),
  };
}

/** Capped (automated and broadcast) messages a client has had on the London day of `now`. */
export function cappedSentToday(db, clientId, now = new Date()) {
  const day = londonDay(now);
  return db.prepare(`SELECT COUNT(*) n FROM messages WHERE client_id=? AND via IN (${CAPPED_VIAS.map(() => '?').join(',')}) AND at>=? AND at<?`)
    .get(clientId, ...CAPPED_VIAS, londonToUtc(day).toISOString(), londonToUtc(addDays(day, 1)).toISOString()).n;
}

/** The per-client outreach flags; an absent row means the defaults. */
export function outreachOf(db, clientId) {
  const r = db.prepare('SELECT * FROM client_outreach WHERE client_id=?').get(clientId);
  return { paused: !!r?.paused, noBroadcasts: !!r?.no_broadcasts, note: r?.note ?? '' };
}

/** When a held send may go: past quiet hours, and for billing inside 08:00-20:00. */
function releaseTime(now, cls, quiet) {
  let t = now;
  for (let i = 0; i < 4; i++) {
    let next = windowEnd(t, quiet);
    if (cls === 'billing') next = windowEnd(next, BILLING_HOURS);
    if (next.getTime() === t.getTime()) break;
    t = next;
  }
  return t;
}

/**
 * Send a message as the coach from code: automations, autoflows, broadcasts,
 * campaigns, scheduled sends, dunning. Governed by `via` (VIA_CLASS). Returns
 * `{message, deferredUntil, skipped}`: exactly one is set. Push and stream
 * work happen after commit. Refuses (404) a client who is not this coach's.
 * `deferredId` is internal: the deferred sender's second attempt.
 */
export function sendMessage(db, config, { coachId, clientId, text, kind = 'text', mediaId = null, via, now = new Date(), deferredId = null }) {
  const cls = VIA_CLASS[via];
  if (!cls) throw new Error(`sendMessage: unknown via ${via}`);
  const body = String(text ?? '').trim().slice(0, 4000);
  if (!body) fail(400, 'text is required');
  return tx(db, () => {
    const client = db.prepare("SELECT * FROM users WHERE id=? AND role='client' AND coach_id=?").get(clientId, coachId);
    if (!client) fail(404, 'Not found');
    if (cls !== 'coach') {
      const flags = outreachOf(db, client.id);
      if ((cls === 'automated' || cls === 'marketing') && flags.paused) return { message: null, deferredUntil: null, skipped: 'outreach paused' };
      if (cls === 'marketing' && flags.noBroadcasts) return { message: null, deferredUntil: null, skipped: 'no broadcasts' };
      const settings = outreachSettings(db, coachId);
      let hold = null;
      const release = releaseTime(now, cls, settings.quietHours);
      if (release.getTime() > now.getTime()) hold = { until: release, reason: 'quietHours' };
      else if (cls !== 'billing' && cappedSentToday(db, client.id, now) >= settings.dailyCap) {
        const morning = settings.quietHours ? nextClock(londonToUtc(addDays(londonDay(now), 1)), settings.quietHours.end) : londonToUtc(addDays(londonDay(now), 1), '07:30');
        hold = { until: morning, reason: 'cap' };
      }
      if (hold) {
        if (deferredId) return { message: null, deferredUntil: null, skipped: `deferred twice (${hold.reason})` };
        const until = hold.until.toISOString();
        db.prepare(`INSERT INTO deferred_messages (id, coach_id, client_id, text, kind, media_id, via, send_at, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(newId('dm'), coachId, client.id, body, kind, mediaId, via, until, hold.reason, now.toISOString());
        return { message: null, deferredUntil: until, skipped: null };
      }
    }
    const id = newId('m');
    db.prepare("INSERT INTO messages (id, client_id, from_id, from_role, text, at, kind, media_id, via) VALUES (?,?,?,'coach',?,?,?,?,?)")
      .run(id, client.id, coachId, body, now.toISOString(), kind, mediaId, via);
    emit(db, 'message.sent', { coachId, clientId: client.id, summary: 'Message sent', messageId: id, kind, mediaId, via });
    const coach = db.prepare('SELECT name FROM users WHERE id=?').get(coachId);
    afterCommit(() => notify(db, config, client.id, { title: coach?.name ?? 'Your coach', body, kind: 'message', id, clientId: client.id }));
    return { message: db.prepare('SELECT * FROM messages WHERE id=?').get(id), deferredUntil: null, skipped: null };
  });
}

/**
 * The 60 s clock: send held messages that are due, through sendMessage again
 * (still governed). A send held twice is dropped and logged. Claim, send and
 * mark happen in one transaction, so a crash never sends twice.
 */
export function sendDeferred(db, config, now = new Date()) {
  const due = db.prepare("SELECT * FROM deferred_messages WHERE status='waiting' AND send_at<=? ORDER BY send_at LIMIT 200").all(now.toISOString());
  let sent = 0;
  for (const d of due) {
    try {
      tx(db, () => {
        if (!db.prepare("UPDATE deferred_messages SET status='sending' WHERE id=? AND status='waiting'").run(d.id).changes) return;
        let out;
        try {
          out = sendMessage(db, config, { coachId: d.coach_id, clientId: d.client_id, text: d.text, kind: d.kind, mediaId: d.media_id, via: d.via, now, deferredId: d.id });
        } catch (e) {
          out = { skipped: e.status === 404 ? 'client moved' : e.message };
        }
        if (out.message) {
          db.prepare("UPDATE deferred_messages SET status='sent', message_id=? WHERE id=?").run(out.message.id, d.id);
          sent++;
        } else {
          db.prepare("UPDATE deferred_messages SET status='dropped' WHERE id=?").run(d.id);
          console.warn(`Held message ${d.id} dropped: ${out.skipped}`);
        }
      });
    } catch (e) {
      console.error(`Held message ${d.id} failed`, e);
    }
  }
  return sent;
}

export function messageRoutes(r) {
  r.add('GET', '/api/threads', threads);
  r.add('GET', '/api/messages', list);
  r.add('POST', '/api/messages', send);
}
