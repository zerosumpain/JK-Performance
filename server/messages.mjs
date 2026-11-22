import { clientFor, requireCoach, requireMember } from './access.mjs';
import { fail, instant, oneOf, str } from './http.mjs';
import { attachableMedia } from './media.mjs';
import { notify } from './push.mjs';
import { featuresOf } from './settings.mjs';
import { newId, nowIso } from './store.mjs';

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

/** The thread, oldest first; reading it marks the other side's messages read. */
function list(_req, ctx) {
  requireMember(ctx);
  const client = clientFor(ctx, ctx.query.clientId);
  const after = ctx.query.after ? instant(ctx.query.after, 'after') : '';
  const rows = ctx.db.prepare('SELECT * FROM messages WHERE client_id=? AND at>? ORDER BY at LIMIT 500').all(client.id, after);
  const otherSide = ctx.user.role === 'coach' ? 'client' : 'coach';
  ctx.db.prepare('UPDATE messages SET read_at=? WHERE client_id=? AND from_role=? AND read_at IS NULL').run(nowIso(), client.id, otherSide);
  return { messages: rows.map(messageOut) };
}

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
  const id = newId('m');
  ctx.db.prepare('INSERT INTO messages (id, client_id, from_id, from_role, text, workout_id, at, kind, report_id, exercise_id, media_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, client.id, ctx.user.id, ctx.user.role, str(b.text || fallback, 'text', { max: 4000 }), workoutId, nowIso(), kind, reportId, exerciseId, media?.id ?? null);
  const m = ctx.db.prepare('SELECT * FROM messages WHERE id=?').get(id);
  notify(ctx.db, ctx.config, ctx.user.role === 'coach' ? client.id : client.coach_id,
    { title: ctx.user.name, body: m.text, kind: 'message', id, clientId: client.id });
  return messageOut(m);
}

export function messageRoutes(r) {
  r.add('GET', '/api/threads', threads);
  r.add('GET', '/api/messages', list);
  r.add('POST', '/api/messages', send);
}
