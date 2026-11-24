import { clientFor, initials, ownRow, requestNow, requireCoach } from '../access.mjs';
import { emit } from '../events.mjs';
import { factsIn, resolveAudience, validateRules } from '../facts.mjs';
import { fail, instant, str } from '../http.mjs';
import { attachableMedia } from '../media.mjs';
import { cappedSentToday, outreachSettings, sendMessage } from '../messages.mjs';
import { limit } from '../ratelimit.mjs';
import { allFacts, allVariables } from '../registry.mjs';
import { coachPref, newId, nowIso, tx } from '../store.mjs';
import { render } from '../templating.mjs';
import { addDays, londonToUtc } from '../time.mjs';

/**
 * F17 Scheduled messages and segment broadcasts (docs/design/desk-v2.md, WP5).
 *
 * A scheduled message is a row with a send time; a broadcast freezes its
 * audience into one scheduled row per recipient when it is sent or scheduled,
 * so every recipient has a real client_id (erasure cascades) and the same
 * sending clock delivers both. Text is rendered at send time, so a name change
 * between scheduling and sending shows. Broadcasts go through the outreach
 * governor (via 'broadcast': quiet hours, daily cap, paused, no broadcasts);
 * a one-off scheduled message (via 'scheduled') is the coach's own choice of
 * time and goes exactly then.
 */

const MAX_RECIPIENTS = 300;
const MAX_AHEAD_DAYS = 180;
const DAY_MS = 86_400_000;
const VAR = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;
const IDS = 'SELECT value FROM json_each(?)';

const fmtWhen = iso => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '');
const person = u => (u ? { id: u.id, name: u.name, initials: initials(u.name) } : null);

// MARK: - Audiences

/**
 * A broadcast audience: {everyone?, clientIds?, segmentId?, tagIds?, rules?}.
 * Checks it belongs to the coach (a foreign segment or tag is a 404) and drops
 * client ids that are no longer this coach's (6.2: bare ids are stripped when
 * a broadcast is saved).
 */
export function cleanAudience(db, coachId, a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) fail(400, 'audience must be an object');
  const out = {};
  if (a.everyone !== undefined) {
    if (typeof a.everyone !== 'boolean') fail(400, 'audience.everyone must be true or false');
    if (a.everyone) out.everyone = true;
  }
  if (a.clientIds !== undefined && a.clientIds !== null) {
    if (!Array.isArray(a.clientIds) || a.clientIds.length > 1000 || a.clientIds.some(id => typeof id !== 'string')) fail(400, 'audience.clientIds must be a list of client ids');
    const coach = db.prepare('SELECT is_demo FROM users WHERE id=?').get(coachId);
    const mine = new Set(db.prepare(`SELECT id FROM users WHERE role='client' AND coach_id=? AND is_demo=? AND id IN (${IDS})`)
      .all(coachId, coach?.is_demo ?? 0, JSON.stringify(a.clientIds)).map(r => r.id));
    const ids = [...new Set(a.clientIds)].filter(id => mine.has(id));
    if (ids.length) out.clientIds = ids;
  }
  if (a.segmentId !== undefined && a.segmentId !== null && a.segmentId !== '') {
    if (!db.prepare('SELECT 1 FROM segments WHERE id=? AND coach_id=?').get(a.segmentId, coachId)) fail(404, 'Not found');
    out.segmentId = a.segmentId;
  }
  if (a.tagIds !== undefined && a.tagIds !== null) {
    if (!Array.isArray(a.tagIds) || a.tagIds.length > 50 || a.tagIds.some(id => typeof id !== 'string')) fail(400, 'audience.tagIds must be a list of tag ids');
    for (const id of a.tagIds) if (!db.prepare('SELECT 1 FROM tags WHERE id=? AND coach_id=?').get(id, coachId)) fail(404, 'Not found');
    if (a.tagIds.length) out.tagIds = [...new Set(a.tagIds)];
  }
  if (a.rules !== undefined && a.rules !== null) {
    validateRules(a.rules, { name: 'audience.rules' });
    if (a.rules.rules.length) out.rules = a.rules;
  }
  return out;
}

const isEmptyAudience = a => !a.everyone && !a.clientIds?.length && !a.segmentId && !a.tagIds?.length && !a.rules;

/**
 * The clients an audience means, for `purpose` ('broadcast' drops "no
 * broadcasts" and paused clients and refuses AI-derived rules, 400). Returns
 * client rows with `.skipped = {outreachPaused, noBroadcasts}`.
 */
export function audienceRows(db, coachId, a, { purpose = 'broadcast', now = new Date() } = {}) {
  if (purpose !== 'any') {
    const ai = new Set(allFacts().filter(f => f.aiDerived).map(f => f.id));
    const sets = [a.rules];
    if (a.segmentId) sets.push(JSON.parse(db.prepare('SELECT rules FROM segments WHERE id=? AND coach_id=?').get(a.segmentId, coachId)?.rules ?? 'null'));
    if (sets.some(r => factsIn(r).some(id => ai.has(id)))) fail(400, 'Audiences that message clients can\'t use AI judgements');
  }
  const ids = new Set(a.clientIds ?? []);
  const ruleSets = [];
  if (a.everyone) ruleSets.push({ match: 'all', rules: [] });
  if (a.rules) ruleSets.push(a.rules);
  if (a.tagIds?.length) ruleSets.push({ match: 'any', rules: a.tagIds.map(t => ({ fact: 'core.tags', op: 'has', value: t })) });
  for (const rules of ruleSets) for (const c of resolveAudience(db, coachId, { rules }, { now })) ids.add(c.id);
  if (a.segmentId) for (const c of resolveAudience(db, coachId, { segmentId: a.segmentId }, { now })) ids.add(c.id);
  return resolveAudience(db, coachId, { clientIds: [...ids] }, { purpose, now });
}

/** "Everyone", "Tag: Marathon 2027", "Segment: Quiet 5+ days", "3 people", joined with " + ". */
export function audienceLabel(db, coachId, a) {
  if (a.everyone) return 'Everyone';
  const parts = [];
  if (a.segmentId) parts.push(`Segment: ${db.prepare('SELECT name FROM segments WHERE id=? AND coach_id=?').get(a.segmentId, coachId)?.name ?? 'removed'}`);
  for (const id of a.tagIds ?? []) parts.push(`Tag: ${db.prepare('SELECT name FROM tags WHERE id=? AND coach_id=?').get(id, coachId)?.name ?? 'removed'}`);
  if (a.rules) parts.push(`${a.rules.rules.length} rule${a.rules.rules.length === 1 ? '' : 's'}`);
  if (a.clientIds?.length) parts.push(`${a.clientIds.length} ${a.clientIds.length === 1 ? 'person' : 'people'}`);
  return parts.join(' + ') || 'Nobody yet';
}

/** Variable names a body uses that no feature knows (typos), so a client never gets "{frist}". */
function unknownVariables(text) {
  const known = new Set(allVariables().map(v => v.name));
  return [...new Set([...String(text).matchAll(VAR)].map(m => m[1]))].filter(n => !known.has(n));
}

// MARK: - Sending (the 20 s clock, and "send now")

/**
 * Claim one due row and send it, all in one transaction: a crash rolls the
 * claim back (late, never twice) and a second tick finds it already claimed.
 */
function sendOne(db, config, id, now) {
  return tx(db, () => {
    if (!db.prepare("UPDATE scheduled_messages SET status='sending' WHERE id=? AND status='scheduled'").run(id).changes) return null;
    const s = db.prepare('SELECT * FROM scheduled_messages WHERE id=?').get(id);
    const done = (status, extra = {}) => {
      db.prepare('UPDATE scheduled_messages SET status=?, message_id=?, deferred_id=?, error=?, outcome=?, sent_at=? WHERE id=?')
        .run(status, extra.messageId ?? null, extra.deferredId ?? null, extra.error ?? null, extra.outcome ?? null, now.toISOString(), id);
      return status;
    };
    // The client may have moved to another coach since it was scheduled.
    const client = db.prepare("SELECT * FROM users WHERE id=? AND role='client' AND coach_id=?").get(s.client_id, s.coach_id);
    if (!client) return done('failed', { error: 'no longer your client', outcome: 'Failed: no longer your client' });
    const text = render(db, s.coach_id, client, s.body, { now }).text.trim();
    if (!text) return done('failed', { error: 'empty message', outcome: 'Failed: the message was empty' });
    let out;
    try {
      out = sendMessage(db, config, { coachId: s.coach_id, clientId: client.id, text, mediaId: s.media_id, via: s.broadcast_id ? 'broadcast' : 'scheduled', now });
    } catch (e) {
      return done('failed', { error: String(e.message ?? e).slice(0, 200), outcome: `Failed: ${e.message}` });
    }
    if (out.message) {
      done('sent', { messageId: out.message.id, outcome: 'Sent' });
      if (!s.broadcast_id) emit(db, 'scheduled.sent', { coachId: s.coach_id, clientId: client.id, summary: 'Scheduled message sent', scheduledId: s.id, messageId: out.message.id });
      return 'sent';
    }
    if (out.deferredUntil) {
      const held = db.prepare('SELECT id FROM deferred_messages WHERE client_id=? AND coach_id=? AND send_at=? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(client.id, s.coach_id, out.deferredUntil);
      return done('sent', { deferredId: held?.id ?? null, outcome: `Held until ${fmtWhen(out.deferredUntil)}` });
    }
    return done('cancelled', { error: out.skipped, outcome: `Skipped: ${out.skipped}` });
  });
}

/** Broadcasts whose every row is settled become 'sent' (once) and emit broadcast.sent. */
function finishBroadcasts(db, now) {
  let n = 0;
  for (const b of db.prepare("SELECT * FROM broadcasts WHERE status IN ('scheduled','sending') AND send_at<=?").all(now.toISOString())) {
    const pending = db.prepare("SELECT COUNT(*) n FROM scheduled_messages WHERE broadcast_id=? AND status IN ('scheduled','sending')").get(b.id).n;
    if (pending) continue;
    tx(db, () => {
      if (!db.prepare("UPDATE broadcasts SET status='sent', sent_at=? WHERE id=? AND status IN ('scheduled','sending')").run(now.toISOString(), b.id).changes) return;
      emit(db, 'broadcast.sent', { coachId: b.coach_id, summary: `Broadcast sent · ${b.name}`, broadcastId: b.id, recipients: b.recipients });
      n++;
    });
  }
  return n;
}

/** The sending clock: every due scheduled row (one-offs and broadcast recipients), then broadcasts that finished. */
export function sendDue(db, config, now = new Date(), { broadcastId = null, max = 400 } = {}) {
  const rows = broadcastId
    ? db.prepare("SELECT id FROM scheduled_messages WHERE status='scheduled' AND send_at<=? AND broadcast_id=? ORDER BY send_at LIMIT ?").all(now.toISOString(), broadcastId, max)
    : db.prepare("SELECT id FROM scheduled_messages WHERE status='scheduled' AND send_at<=? ORDER BY send_at LIMIT ?").all(now.toISOString(), max);
  let sent = 0;
  for (const r of rows) {
    try { if (sendOne(db, config, r.id, now) === 'sent') sent++; } catch (e) { console.error(`Scheduled message ${r.id} failed`, e); }
  }
  return { sent, broadcasts: finishBroadcasts(db, now) };
}

// MARK: - Scheduled messages

const scheduledOut = (s, client) => ({
  id: s.id, clientId: s.client_id, client: person(client), text: s.body, mediaId: s.media_id, sendAt: s.send_at, status: s.status,
  broadcastId: s.broadcast_id, messageId: s.message_id, error: s.error, outcome: s.outcome, createdAt: s.created_at, sentAt: s.sent_at,
});

/** A scheduled row of this coach whose client is still this coach's (current owner, 6.1), or 404. */
function ownScheduled(ctx) {
  requireCoach(ctx);
  const s = ctx.db.prepare(`SELECT s.*, u.name client_name FROM scheduled_messages s JOIN users u ON u.id=s.client_id AND u.coach_id=?
    WHERE s.id=? AND s.coach_id=?`).get(ctx.user.id, ctx.params.id, ctx.user.id);
  if (!s) fail(404, 'Not found');
  return s;
}

function sendAtOf(value, now) {
  const at = instant(value, 'sendAt');
  if (Date.parse(at) <= now.getTime()) fail(400, 'sendAt must be in the future');
  if (Date.parse(at) > now.getTime() + MAX_AHEAD_DAYS * DAY_MS) fail(400, `sendAt can be at most ${MAX_AHEAD_DAYS} days ahead`);
  return at;
}

function listScheduled(_req, ctx) {
  requireCoach(ctx);
  const where = ['s.coach_id=?'], args = [ctx.user.id, ctx.user.id];
  if (ctx.query.clientId) { where.push('s.client_id=?'); args.push(clientFor(ctx, ctx.query.clientId).id); }
  if (ctx.query.status) {
    const st = String(ctx.query.status).split(',');
    if (st.some(x => !['scheduled', 'sending', 'sent', 'cancelled', 'failed'].includes(x))) fail(400, 'status is not known');
    where.push(`s.status IN (${st.map(() => '?').join(',')})`);
    args.push(...st);
  }
  if (ctx.query.oneOff === '1') where.push('s.broadcast_id IS NULL');
  const rows = ctx.db.prepare(`SELECT s.*, u.name client_name FROM scheduled_messages s JOIN users u ON u.id=s.client_id AND u.coach_id=?
    WHERE ${where.join(' AND ')} ORDER BY s.send_at LIMIT 300`).all(...args);
  return { items: rows.map(s => scheduledOut(s, { id: s.client_id, name: s.client_name })) };
}

function createScheduled(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  const now = requestNow(ctx);
  const text = str(ctx.body.text, 'text', { max: 4000 });
  const sendAt = sendAtOf(ctx.body.sendAt, now);
  const media = attachableMedia(ctx, ctx.body.mediaId, 'mediaId', client);
  if (ctx.db.prepare("SELECT COUNT(*) n FROM scheduled_messages WHERE coach_id=? AND client_id=? AND status='scheduled' AND broadcast_id IS NULL").get(ctx.user.id, client.id).n >= 50) {
    fail(429, 'That client already has 50 scheduled messages');
  }
  const id = newId('sm');
  ctx.db.prepare('INSERT INTO scheduled_messages (id, coach_id, client_id, body, media_id, send_at, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, ctx.user.id, client.id, text, media?.id ?? null, sendAt, now.toISOString());
  return { item: scheduledOut(ctx.db.prepare('SELECT * FROM scheduled_messages WHERE id=?').get(id), client) };
}

function patchScheduled(_req, ctx) {
  const s = ownScheduled(ctx);
  if (s.status !== 'scheduled') fail(409, 'That message has already gone (or was cancelled)');
  const now = requestNow(ctx);
  const text = ctx.body.text === undefined ? s.body : str(ctx.body.text, 'text', { max: 4000 });
  const sendAt = ctx.body.sendAt === undefined ? s.send_at : sendAtOf(ctx.body.sendAt, now);
  ctx.db.prepare("UPDATE scheduled_messages SET body=?, send_at=? WHERE id=? AND status='scheduled'").run(text, sendAt, s.id);
  return { item: scheduledOut(ctx.db.prepare('SELECT * FROM scheduled_messages WHERE id=?').get(s.id), { id: s.client_id, name: s.client_name }) };
}

function cancelScheduled(_req, ctx) {
  const s = ownScheduled(ctx);
  if (s.status !== 'scheduled') fail(409, 'That message has already gone (or was cancelled)');
  ctx.db.prepare("UPDATE scheduled_messages SET status='cancelled', error='cancelled', outcome='Cancelled' WHERE id=? AND status='scheduled'").run(s.id);
  return { ok: true };
}

// MARK: - Broadcasts

/** Delivered, held, read and replied (a client message within 72 h) for a broadcast's recipients. */
function recipientsOf(db, coachId, broadcastId) {
  return db.prepare(`SELECT s.id, s.client_id, s.status, s.outcome, s.send_at, u.name,
      m.id mid, m.at m_at, m.read_at,
      (SELECT MIN(r.at) FROM messages r WHERE r.client_id=s.client_id AND r.from_role='client' AND m.at IS NOT NULL AND r.at>m.at
        AND r.at<=strftime('%Y-%m-%dT%H:%M:%fZ', m.at, '+72 hours')) replied_at
    FROM scheduled_messages s
    JOIN users u ON u.id=s.client_id AND u.coach_id=?
    LEFT JOIN deferred_messages d ON d.id=s.deferred_id
    LEFT JOIN messages m ON m.id=COALESCE(s.message_id, d.message_id)
    WHERE s.broadcast_id=? ORDER BY u.name`).all(coachId, broadcastId).map(r => ({
    client: person({ id: r.client_id, name: r.name }), status: r.status, outcome: r.outcome, sendAt: r.send_at,
    delivered: !!r.mid, deliveredAt: r.m_at, readAt: r.read_at, repliedAt: r.replied_at,
  }));
}

function statsOf(people) {
  const delivered = people.filter(p => p.delivered).length;
  const read = people.filter(p => p.readAt).length;
  const replied = people.filter(p => p.repliedAt).length;
  const held = people.filter(p => !p.delivered && p.status === 'sent').length;
  const pct = n => (delivered ? Math.round((n / delivered) * 100) : 0);
  return { recipients: people.length, delivered, held, skipped: people.filter(p => ['cancelled', 'failed'].includes(p.status)).length, read, replied, readPct: pct(read), replyPct: pct(replied) };
}

function broadcastOut(db, b, { people = false } = {}) {
  const audience = JSON.parse(b.audience);
  const list = b.status === 'draft' ? [] : recipientsOf(db, b.coach_id, b.id);
  return {
    id: b.id, name: b.name, audience, audienceLabel: audienceLabel(db, b.coach_id, audience), body: b.body, status: b.status,
    sendAt: b.send_at, recipients: b.recipients, createdAt: b.created_at, sentAt: b.sent_at, updatedAt: b.updated_at,
    stats: b.status === 'draft' ? null : statsOf(list),
    ...(people ? { people: list } : { faces: list.slice(0, 6).map(p => p.client) }),
  };
}

function broadcastFields(ctx, current = null) {
  const b = ctx.body;
  return {
    name: b.name === undefined && current ? current.name : str(b.name, 'name', { max: 80 }),
    body: b.body === undefined && current ? current.body : str(b.body, 'body', { max: 4000 }),
    audience: cleanAudience(ctx.db, ctx.user.id, b.audience === undefined && current ? JSON.parse(current.audience) : b.audience ?? {}),
  };
}

function listBroadcasts(_req, ctx) {
  requireCoach(ctx);
  const rows = ctx.db.prepare(`SELECT * FROM broadcasts WHERE coach_id=?
    ORDER BY CASE status WHEN 'draft' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'sending' THEN 1 ELSE 2 END, COALESCE(sent_at, send_at, updated_at) DESC LIMIT 200`).all(ctx.user.id);
  return { broadcasts: rows.map(b => broadcastOut(ctx.db, b)) };
}

function createBroadcast(_req, ctx) {
  requireCoach(ctx);
  const f = broadcastFields(ctx);
  const id = newId('bc');
  const at = nowIso();
  ctx.db.prepare('INSERT INTO broadcasts (id, coach_id, name, audience, body, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, ctx.user.id, f.name, JSON.stringify(f.audience), f.body, at, at);
  return { broadcast: broadcastOut(ctx.db, ctx.db.prepare('SELECT * FROM broadcasts WHERE id=?').get(id)) };
}

function getBroadcast(_req, ctx) {
  requireCoach(ctx);
  const b = ownRow(ctx, 'broadcasts', ctx.params.id);
  const out = broadcastOut(ctx.db, b, { people: true });
  return { broadcast: out, stats: out.stats };
}

function updateBroadcast(_req, ctx) {
  requireCoach(ctx);
  const b = ownRow(ctx, 'broadcasts', ctx.params.id);
  if (b.status !== 'draft') fail(409, 'Only a draft can be edited');
  const f = broadcastFields(ctx, b);
  ctx.db.prepare('UPDATE broadcasts SET name=?, audience=?, body=?, updated_at=? WHERE id=?').run(f.name, JSON.stringify(f.audience), f.body, nowIso(), b.id);
  return { broadcast: broadcastOut(ctx.db, ctx.db.prepare('SELECT * FROM broadcasts WHERE id=?').get(b.id)) };
}

/** A draft (or cancelled one) goes; a scheduled one is cancelled with its rows; a sent one stays for its stats. */
function deleteBroadcast(_req, ctx) {
  requireCoach(ctx);
  const b = ownRow(ctx, 'broadcasts', ctx.params.id);
  if (b.status === 'scheduled') {
    tx(ctx.db, () => {
      ctx.db.prepare("UPDATE scheduled_messages SET status='cancelled', error='cancelled', outcome='Cancelled' WHERE broadcast_id=? AND status='scheduled'").run(b.id);
      ctx.db.prepare("UPDATE broadcasts SET status='cancelled', updated_at=? WHERE id=?").run(nowIso(), b.id);
    });
    return { ok: true, broadcast: broadcastOut(ctx.db, ctx.db.prepare('SELECT * FROM broadcasts WHERE id=?').get(b.id)) };
  }
  if (!['draft', 'cancelled'].includes(b.status)) fail(409, 'A sent broadcast is kept for its stats');
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE scheduled_messages SET broadcast_id=NULL WHERE broadcast_id=?').run(b.id);
    ctx.db.prepare('DELETE FROM broadcasts WHERE id=?').run(b.id);
  });
  return { ok: true };
}

/** {audience, body} → the count, who is skipped and why, and the message for 5 sample recipients. No side effects. */
function previewBroadcast(_req, ctx) {
  requireCoach(ctx);
  const audience = cleanAudience(ctx.db, ctx.user.id, ctx.body.audience ?? {});
  const body = ctx.body.body === undefined || ctx.body.body === '' ? '' : str(ctx.body.body, 'body', { max: 4000 });
  const now = requestNow(ctx);
  const rows = isEmptyAudience(audience) ? Object.assign([], { skipped: { outreachPaused: 0, noBroadcasts: 0 } }) : audienceRows(ctx.db, ctx.user.id, audience, { now });
  const step = Math.max(1, Math.floor(rows.length / 5));
  const sample = rows.filter((_, i) => i % step === 0).slice(0, 5);
  return {
    count: rows.length, skipped: rows.skipped, max: MAX_RECIPIENTS, unknown: body ? unknownVariables(body) : [],
    people: rows.slice(0, 40).map(person),
    samples: body ? sample.map(c => { const r = render(ctx.db, ctx.user.id, c, body, { now }); return { client: person(c), text: r.text, missing: r.missing, empty: r.empty }; }) : [],
  };
}

function sendBroadcast(_req, ctx) {
  requireCoach(ctx);
  const b = ownRow(ctx, 'broadcasts', ctx.params.id);
  if (b.status !== 'draft') fail(409, 'This broadcast has already been sent or scheduled');
  const now = requestNow(ctx);
  const sendAt = ctx.body.sendAt ? sendAtOf(ctx.body.sendAt, now) : null;
  const unknown = unknownVariables(b.body);
  if (unknown.length) fail(400, `Unknown variable ${unknown.map(n => `{${n}}`).join(', ')}`);
  const audience = cleanAudience(ctx.db, ctx.user.id, JSON.parse(b.audience));
  if (isEmptyAudience(audience)) fail(400, 'Choose who it goes to');
  const rows = audienceRows(ctx.db, ctx.user.id, audience, { now });
  if (!rows.length) fail(400, 'Nobody in this audience can get broadcasts');
  if (rows.length > MAX_RECIPIENTS) fail(400, `A broadcast goes to at most ${MAX_RECIPIENTS} people (this one has ${rows.length})`);
  if (!limit(`broadcast:${ctx.user.id}`, { max: 1, perMs: 60_000, now: now.getTime() })) fail(429, 'One broadcast a minute: try again shortly');
  const at = sendAt ?? now.toISOString();
  tx(ctx.db, () => {
    const insert = ctx.db.prepare('INSERT INTO scheduled_messages (id, coach_id, client_id, body, send_at, broadcast_id, created_at) VALUES (?,?,?,?,?,?,?)');
    for (const c of rows) insert.run(newId('sm'), ctx.user.id, c.id, b.body, at, b.id, now.toISOString());
    ctx.db.prepare('UPDATE broadcasts SET status=?, send_at=?, recipients=?, audience=?, queued_at=?, updated_at=? WHERE id=?')
      .run(sendAt ? 'scheduled' : 'sending', at, rows.length, JSON.stringify(audience), now.toISOString(), now.toISOString(), b.id);
  });
  if (!sendAt) sendDue(ctx.db, ctx.config, now, { broadcastId: b.id, max: MAX_RECIPIENTS });
  return { broadcast: broadcastOut(ctx.db, ctx.db.prepare('SELECT * FROM broadcasts WHERE id=?').get(b.id)), skipped: rows.skipped };
}

// MARK: - Outreach summary (settings section and the Today widget)

function summary(_req, ctx) {
  requireCoach(ctx);
  const s = outreachSettings(ctx.db, ctx.user.id);
  const now = requestNow(ctx);
  const upcoming = ctx.db.prepare(`SELECT s.*, u.name client_name FROM scheduled_messages s JOIN users u ON u.id=s.client_id AND u.coach_id=?
    WHERE s.coach_id=? AND s.status='scheduled' AND s.broadcast_id IS NULL ORDER BY s.send_at LIMIT 6`).all(ctx.user.id, ctx.user.id);
  const broadcasts = ctx.db.prepare("SELECT * FROM broadcasts WHERE coach_id=? AND status='scheduled' ORDER BY send_at LIMIT 3").all(ctx.user.id);
  const held = ctx.db.prepare(`SELECT COUNT(*) n FROM deferred_messages d JOIN users u ON u.id=d.client_id AND u.coach_id=? WHERE d.coach_id=? AND d.status='waiting'`).get(ctx.user.id, ctx.user.id).n;
  const scheduled = ctx.db.prepare(`SELECT COUNT(*) n FROM scheduled_messages s JOIN users u ON u.id=s.client_id AND u.coach_id=? WHERE s.coach_id=? AND s.status='scheduled' AND s.broadcast_id IS NULL`).get(ctx.user.id, ctx.user.id).n;
  const clients = ctx.db.prepare("SELECT id FROM users WHERE role='client' AND coach_id=?").all(ctx.user.id);
  const atCap = clients.filter(c => cappedSentToday(ctx.db, c.id, now) >= s.dailyCap).length;
  return {
    settings: { dailyCap: s.dailyCap, quietHours: s.quietHours, customised: coachPref(ctx.db, ctx.user.id, 'outreach.dailyCap') !== undefined || coachPref(ctx.db, ctx.user.id, 'outreach.quietHours') !== undefined },
    scheduled, held, atCap,
    upcoming: upcoming.map(x => scheduledOut(x, { id: x.client_id, name: x.client_name })),
    broadcasts: broadcasts.map(b => ({ id: b.id, name: b.name, sendAt: b.send_at, recipients: b.recipients })),
  };
}

// MARK: - Schema

function schema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS scheduled_messages (
    id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    media_id TEXT, send_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sending','sent','cancelled','failed')),
    broadcast_id TEXT, message_id TEXT, error TEXT,
    deferred_id TEXT, outcome TEXT,
    created_at TEXT NOT NULL, sent_at TEXT);
  CREATE INDEX IF NOT EXISTS scheduled_messages_due ON scheduled_messages(status, send_at);
  CREATE INDEX IF NOT EXISTS scheduled_messages_client ON scheduled_messages(client_id, status);
  CREATE INDEX IF NOT EXISTS scheduled_messages_broadcast ON scheduled_messages(broadcast_id);
  CREATE TABLE IF NOT EXISTS broadcasts (
    id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, audience TEXT NOT NULL, body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','cancelled')),
    send_at TEXT, recipients INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, sent_at TEXT,
    queued_at TEXT, updated_at TEXT);
  CREATE INDEX IF NOT EXISTS broadcasts_coach ON broadcasts(coach_id, status);`);
}

// MARK: - Demo

/**
 * The demo builder creates its tables if needed and clears the demo accounts'
 * rows itself: older tests build the demo before createApp has run feature
 * schemas, so demo.tables would make the foundation's wipe fail.
 */
function buildDemo(db, { coach, clients, byName, today }) {
  schema(db);
  const ids = JSON.stringify([coach.id, ...clients.map(c => c.id)]);
  db.prepare('DELETE FROM scheduled_messages WHERE coach_id=? OR client_id IN (SELECT value FROM json_each(?))').run(coach.id, ids);
  db.prepare('DELETE FROM broadcasts WHERE coach_id=?').run(coach.id);
  const at = (offset, clock) => londonToUtc(addDays(today, offset), clock).toISOString();
  const plus = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();
  const tagId = (name, color) => {
    db.prepare('INSERT OR IGNORE INTO tags (id, coach_id, name, color, created_at) VALUES (?,?,?,?,?)').run(newId('tg'), coach.id, name, color, nowIso());
    return db.prepare('SELECT id FROM tags WHERE coach_id=? AND name=?').get(coach.id, name).id;
  };
  const marathon = tagId('Marathon 2027', 'chart-2');
  const runners = ['Sam', 'Priya', 'Rory'].map(n => byName[n]).filter(Boolean);
  for (const c of runners) db.prepare("INSERT OR IGNORE INTO client_tags (client_id, tag_id, added_at, added_by) VALUES (?,?,?,'coach')").run(c.id, marathon, at(-30, '10:00'));

  // Past broadcasts: messages in the threads, some read, some answered within 72 h.
  const past = [
    { name: 'Race-week plan is up', audience: { tagIds: [marathon] }, people: runners, days: -9, clock: '07:00',
      body: 'Morning {first}! Race-week plan is up in the app: two short sharpeners, lots of sleep, and carbs from Thursday. You have done the work.',
      read: ['Sam', 'Priya', 'Rory'], replies: { Sam: 'Buzzing. Thursday pasta it is!', Priya: 'Saw it, love the taper. Can we chat pacing?' } },
    { name: 'New Saturday conditioning class', audience: { everyone: true }, people: clients, days: -23, clock: '08:30',
      body: 'Hi {first}, from this weekend there is a Saturday 08:00 conditioning class on the Park Run Loop. Small group, big engine. Book in the app.',
      read: ['Sam', 'Priya', 'Alex', 'Rory', 'Leo'], replies: { Alex: 'In! Can I bring my brother?', Rory: 'Perfect timing for the half.', Sam: 'Booked.' } },
    { name: 'Mobility week', audience: { everyone: true }, people: clients, days: -41, clock: '07:30',
      body: '{first}, this week is mobility week: ten minutes a day from the Move Well routine. Tick it off in your habits and tell me what loosened up.',
      read: ['Sam', 'Priya', 'Alex', 'Leo'], replies: { Leo: 'Back feels so much better after day 3.', Priya: 'Hips say thank you.' } },
  ];
  for (const p of past) {
    const id = newId('bc');
    const sentAt = at(p.days, p.clock);
    db.prepare("INSERT INTO broadcasts (id, coach_id, name, audience, body, status, send_at, recipients, created_at, sent_at, queued_at, updated_at) VALUES (?,?,?,?,?,'sent',?,?,?,?,?,?)")
      .run(id, coach.id, p.name, JSON.stringify(p.audience), p.body, sentAt, p.people.length, plus(sentAt, -90), sentAt, plus(sentAt, -2), sentAt);
    p.people.forEach((c, i) => {
      const first = c.name.split(' ')[0];
      const mAt = plus(sentAt, i);
      const mid = newId('m');
      const text = p.body.replaceAll('{first}', first);
      const readAt = p.read.includes(first) ? plus(mAt, 40 + i * 37) : null;
      db.prepare("INSERT INTO messages (id, client_id, from_id, from_role, text, at, read_at, kind, via) VALUES (?,?,?,'coach',?,?,?,'text','broadcast')")
        .run(mid, c.id, coach.id, text, mAt, readAt);
      db.prepare("INSERT INTO scheduled_messages (id, coach_id, client_id, body, send_at, status, broadcast_id, message_id, outcome, created_at, sent_at) VALUES (?,?,?,?,?,'sent',?,?,'Sent',?,?)")
        .run(newId('sm'), coach.id, c.id, p.body, sentAt, id, mid, plus(sentAt, -2), mAt);
      if (p.replies[first]) {
        db.prepare("INSERT INTO messages (id, client_id, from_id, from_role, text, at, read_at, kind, via) VALUES (?,?,?,'client',?,?,?,'text','app')")
          .run(newId('m'), c.id, c.id, p.replies[first], plus(mAt, 95 + i * 53), plus(mAt, 200 + i * 53));
      }
    });
  }

  // A draft, and one broadcast booked for next Monday morning.
  db.prepare("INSERT INTO broadcasts (id, coach_id, name, audience, body, status, created_at, updated_at) VALUES (?,?,?,?,?,'draft',?,?)")
    .run(newId('bc'), coach.id, 'Spring 10K block: early places', JSON.stringify({ tagIds: [marathon] }),
      'Hi {first}, I am opening a spring 10K block for a few of you. Early places get a free gait analysis. Want in?', at(-2, '16:00'), at(-1, '09:15'));
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = addDays(today, ((8 - weekday) % 7) || 7);
  const bid = newId('bc');
  const sendAt = at(monday === today ? 7 : daysFrom(today, monday), '07:00');
  db.prepare("INSERT INTO broadcasts (id, coach_id, name, audience, body, status, send_at, recipients, created_at, queued_at, updated_at) VALUES (?,?,?,?,?,'scheduled',?,?,?,?,?)")
    .run(bid, coach.id, 'Monday reset', JSON.stringify({ everyone: true }), 'New week, {first}. One thing that would make this week a win? Reply with it and I will hold you to it.',
      sendAt, clients.length, at(-1, '18:00'), at(-1, '18:05'), at(-1, '18:05'));
  for (const c of clients) {
    db.prepare("INSERT INTO scheduled_messages (id, coach_id, client_id, body, send_at, status, broadcast_id, created_at) VALUES (?,?,?,?,?,'scheduled',?,?)")
      .run(newId('sm'), coach.id, c.id, 'New week, {first}. One thing that would make this week a win? Reply with it and I will hold you to it.', sendAt, bid, at(-1, '18:05'));
  }

  // Two one-off messages queued for tomorrow at 07:00.
  const tomorrow = at(1, '07:00');
  const oneOffs = [['Priya', 'Morning {first}! Easy 40 today, keep it conversational. Strides at the end if the legs feel good.'],
    ['Tom', 'Hey {first}, how did the first week of circuits feel? Even one session this week is a win. I have kept Thursday 19:00 free for you.']];
  for (const [n, body] of oneOffs) {
    const c = byName[n];
    if (!c) continue;
    db.prepare('INSERT INTO scheduled_messages (id, coach_id, client_id, body, send_at, created_at) VALUES (?,?,?,?,?,?)').run(newId('sm'), coach.id, c.id, body, tomorrow, at(0, '08:10'));
  }
}

const daysFrom = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);

// MARK: - The feature

export const feature = {
  name: 'outreach',
  namespaces: ['broadcast', 'scheduled', 'outreach'],
  exact: [],

  schema,

  routes(r) {
    r.add('GET', '/api/scheduled-messages', listScheduled);
    r.add('POST', '/api/scheduled-messages', createScheduled);
    r.add('PATCH', '/api/scheduled-messages/:id', patchScheduled);
    r.add('DELETE', '/api/scheduled-messages/:id', cancelScheduled);
    r.add('POST', '/api/broadcasts/preview', previewBroadcast);
    r.add('GET', '/api/broadcasts', listBroadcasts);
    r.add('POST', '/api/broadcasts', createBroadcast);
    r.add('GET', '/api/broadcasts/:id', getBroadcast);
    r.add('PUT', '/api/broadcasts/:id', updateBroadcast);
    r.add('DELETE', '/api/broadcasts/:id', deleteBroadcast);
    r.add('POST', '/api/broadcasts/:id/send', sendBroadcast);
    r.add('GET', '/api/outreach/summary', summary);
  },

  clocks: [{ id: 'outreach.send', everyMs: 20_000, run: (db, config, now) => sendDue(db, config, now) }],

  on: {
    // End of coaching cancels everything still queued for the client (F8).
    'client.offboarded': (db, _config, e) => {
      if (!e.clientId) return;
      db.prepare("UPDATE scheduled_messages SET status='cancelled', error='coaching ended', outcome='Cancelled: coaching ended' WHERE client_id=? AND coach_id=? AND status='scheduled'")
        .run(e.clientId, e.coachId);
    },
  },

  emits: {
    'scheduled.sent': { label: 'A scheduled message was sent', payload: ['scheduledId', 'messageId'] },
    'broadcast.sent': { label: 'A broadcast went out', payload: ['broadcastId', 'recipients'] },
  },

  /** Client 360 timeline: queued messages ("Scheduled · Tue 07:00") and sent ones. */
  timeline(db, coach, client, before, n) {
    const rows = db.prepare(`SELECT s.* FROM scheduled_messages s JOIN users u ON u.id=s.client_id AND u.coach_id=?
      WHERE s.client_id=? AND s.coach_id=? AND s.status IN ('scheduled','sent') AND s.broadcast_id IS NULL ORDER BY s.created_at DESC LIMIT ?`).all(coach.id, client.id, coach.id, n);
    return rows.map(s => ({
      at: s.status === 'sent' ? s.sent_at ?? s.send_at : s.created_at, kind: 'message', icon: 'schedule_send', tone: s.status === 'scheduled' ? 'data' : null,
      title: s.status === 'scheduled' ? `Scheduled · ${fmtWhen(s.send_at)}` : 'Scheduled message sent', detail: s.body.slice(0, 140), path: `/messages/${client.id}`,
    })).filter(it => !before || it.at < before);
  },

  /** F8 End coaching: what is still queued for the client. */
  offboarding(db, coach, client) {
    const rows = db.prepare("SELECT id, send_at, body FROM scheduled_messages WHERE client_id=? AND coach_id=? AND status='scheduled' ORDER BY send_at").all(client.id, coach.id);
    return rows.length ? { scheduled: rows.map(r => ({ id: r.id, sendAt: r.send_at, text: r.body.slice(0, 120) })) } : {};
  },

  /** The subject access export: what was queued for the client; a coach gets their broadcasts. */
  exportFor(db, user) {
    if (user.role === 'coach') {
      return { broadcasts: db.prepare('SELECT id, name, body, status, send_at, sent_at, recipients FROM broadcasts WHERE coach_id=? ORDER BY created_at').all(user.id) };
    }
    return {
      scheduledMessages: db.prepare('SELECT id, body text, send_at sendAt, status, sent_at sentAt FROM scheduled_messages WHERE client_id=? ORDER BY send_at').all(user.id),
    };
  },

  demo: { build: buildDemo },
};
