import { clientFor, requireCoach, requireMember } from './access.mjs';
import { fail, instant, str } from './http.mjs';
import { notify } from './push.mjs';
import { newId, nowIso } from './store.mjs';

const messageOut = m => ({ id: m.id, clientId: m.client_id, fromId: m.from_id, fromRole: m.from_role, text: m.text, workoutId: m.workout_id, at: m.at, readAt: m.read_at });

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
  const workoutId = ctx.body.workoutId ? str(ctx.body.workoutId, 'workoutId', { max: 40 }) : null;
  if (workoutId && !ctx.db.prepare('SELECT 1 FROM workouts WHERE id=? AND client_id=?').get(workoutId, client.id)) fail(400, 'workoutId is not in this client\'s plan');
  const id = newId('m');
  ctx.db.prepare('INSERT INTO messages (id, client_id, from_id, from_role, text, workout_id, at) VALUES (?,?,?,?,?,?,?)')
    .run(id, client.id, ctx.user.id, ctx.user.role, str(ctx.body.text ?? (workoutId ? 'Plan updated' : null), 'text', { max: 4000 }), workoutId, nowIso());
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
