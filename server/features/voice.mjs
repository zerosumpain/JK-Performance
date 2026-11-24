import { clientFor, initials, requireCoach } from '../access.mjs';
import { aiInfo, aiSettings, AiError, listen, withinBudget } from '../ai.mjs';
import { emit } from '../events.mjs';
import { runAction } from '../facts.mjs';
import { fail, instant, num, oneOf, str } from '../http.mjs';
import { mediaFilePath } from '../media.mjs';
import { fmtVoiceLength, messagesOut } from '../messages.mjs';
import { notifyCoach } from '../notifications.mjs';
import { allActions } from '../registry.mjs';
import { likeAny, matchScore } from '../search.mjs';
import { newId, nowIso, tx } from '../store.mjs';
import { addDays, londonToUtc } from '../time.mjs';

/**
 * F19: voice notes both ways, with transcription and analysis
 * (docs/design/desk-v2.md F19, 6.3). docs/api/wp6-ai-voice.md is the contract.
 *
 * - message.sent / message.received with kind voice queue a voice_analyses row:
 *   `pending`, or `off` with a reason (aiOff, noConsent, quota). A coach note
 *   already transcribed by an F18 voice review is written `done` at once.
 * - The 10 s clock processes one row at a time through ai.listen (the coach
 *   row is the AI user; demo means stub), then writes in one transaction that
 *   re-selects the row and the message (erased, deleted or reassigned in the
 *   meantime means stop quietly), bumps messages.updated_at and emits.
 * - A client's voice is never sent to a model without client_ai_consent.voice
 *   = 'on' (checked when queued AND again just before the call).
 * - Analysis (summary, mood, sentiment, topics, actions, flags) is coach-only:
 *   messageExtras adds it only with coachView, and only for client notes.
 * - Access always joins the CURRENT owner (users.coach_id), never the stored
 *   voice_analyses.coach_id.
 * - Retention: transcripts and analyses 12 months after End coaching
 *   (client.offboarded), analysis fields after 24 months regardless.
 * Everything derived from a model is aiDerived (6.3).
 */

const MOODS = ['upbeat', 'steady', 'flat', 'low', 'stressed', 'unknown'];
const FLAG_KINDS = ['pain', 'injury', 'illness', 'mentalHealth', 'safeguarding', 'cancelIntent', 'billing'];
const URGENT_FLAGS = new Set(['pain', 'injury', 'illness', 'mentalHealth', 'safeguarding']);
const FLAG_WORD = { pain: 'pain', injury: 'an injury', illness: 'feeling ill', mentalHealth: 'low mood', safeguarding: 'a safeguarding concern', cancelIntent: 'wanting to cancel', billing: 'billing' };
const SEVERITIES = ['low', 'medium', 'high'];
const RETRY_MS = 5 * 60_000;
const LEASE_MS = 3 * 60_000;
const MAX_SEC = 300;
const BODY_PARTS = ['knee', 'back', 'lower back', 'shoulder', 'hip', 'ankle', 'calf', 'hamstring', 'neck', 'wrist', 'elbow', 'foot', 'achilles', 'groin', 'quad', 'shin'];

const first = name => String(name ?? '').trim().split(/\s+/)[0] || 'your client';
const parse = (v, fallback) => { try { return JSON.parse(v ?? '') ?? fallback; } catch { return fallback; } };
const months = (now, n) => { const d = new Date(now); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString(); };

// MARK: - Consent and the queue decision

/** A client's voice consent: 'on' | 'off' | 'ask' (no row), with when it was set. */
export function consentOf(db, clientId) {
  const r = db.prepare('SELECT voice, at FROM client_ai_consent WHERE client_id=?').get(clientId);
  return { voice: r?.voice ?? 'ask', at: r?.at ?? null };
}

/**
 * Should this note be sent to a model now? Returns {status:'pending'} or
 * {status:'off', reason}. `coach` is the client's CURRENT coach.
 */
function decide(db, config, { client, coach, direction, seconds, now }) {
  const settings = aiSettings(db, coach.id);
  const info = aiInfo(db, config, coach);
  if (info.provider === 'off' || !settings.transcribe) return { status: 'off', reason: 'aiOff' };
  if (direction === 'fromClient' && consentOf(db, client.id).voice !== 'on') return { status: 'off', reason: 'noConsent' };
  if (info.provider === 'openrouter') {
    if (!info.audio) return { status: 'off', reason: 'aiOff' };
    if (!withinBudget(db, config, { coachId: coach.id, clientId: client.id, audioSeconds: seconds ?? 0, now })) return { status: 'off', reason: 'quota' };
  }
  return { status: 'pending', reason: null };
}

/** A coach note's transcript from an F18 voice review of the same upload (same package; guarded, the table may be absent). */
function reviewedTranscript(db, mediaId, coachId) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_reviews'").get()) return null;
  return db.prepare('SELECT transcript, provider, model FROM ai_reviews WHERE media_id=? AND coach_id=? AND transcript IS NOT NULL ORDER BY created_at DESC LIMIT 1').get(mediaId, coachId) ?? null;
}

const bump = (db, messageId) => db.prepare('UPDATE messages SET updated_at=? WHERE id=?').run(nowIso(), messageId);

/** The event handler for message.sent and message.received: queue a voice note. Synchronous. */
function queue(db, config, ev) {
  if (ev.payload?.kind !== 'voice' || !ev.payload.messageId) return;
  const m = db.prepare('SELECT * FROM messages WHERE id=?').get(ev.payload.messageId);
  if (!m || m.kind !== 'voice' || !m.media_id) return;
  if (db.prepare('SELECT 1 FROM voice_analyses WHERE message_id=?').get(m.id)) return;
  const media = db.prepare('SELECT * FROM media WHERE id=?').get(m.media_id);
  const client = db.prepare("SELECT * FROM users WHERE id=? AND role='client'").get(m.client_id);
  const coach = client?.coach_id ? db.prepare("SELECT * FROM users WHERE id=? AND role='coach'").get(client.coach_id) : null;
  if (!media || !client || !coach) return;
  if (db.prepare('SELECT 1 FROM voice_analyses WHERE media_id=?').get(media.id)) return;
  const direction = m.from_role === 'client' ? 'fromClient' : 'toClient';
  const now = new Date();
  const at = nowIso();
  const reviewed = direction === 'toClient' ? reviewedTranscript(db, media.id, coach.id) : null;
  if (reviewed) {
    db.prepare(`INSERT INTO voice_analyses (message_id, media_id, client_id, coach_id, direction, status, audio_seconds, transcript, provider, model, created_at, updated_at)
      VALUES (?,?,?,?,?, 'done', ?,?,?,?,?,?)`).run(m.id, media.id, client.id, coach.id, direction, media.duration_sec, reviewed.transcript, reviewed.provider, reviewed.model, at, at);
    bump(db, m.id);
    emit(db, 'voice.analysed', { coachId: coach.id, clientId: client.id, summary: 'Voice note transcribed', messageId: m.id, direction, flagged: 0 });
    return;
  }
  const d = decide(db, config, { client, coach, direction, seconds: media.duration_sec, now });
  db.prepare(`INSERT INTO voice_analyses (message_id, media_id, client_id, coach_id, direction, status, reason, next_try_at, audio_seconds, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(m.id, media.id, client.id, coach.id, direction, d.status, d.reason, d.status === 'pending' ? at : null, media.duration_sec, at, at);
  if (d.status !== 'pending') bump(db, m.id);
}

// MARK: - The model call

const ANALYSIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['transcript', 'language', 'summary', 'mood', 'sentiment', 'topics', 'actions', 'flags'],
  properties: {
    transcript: { type: 'string' }, language: { type: 'string' }, summary: { type: 'string' },
    mood: { type: 'string', enum: MOODS }, sentiment: { type: 'number' },
    topics: { type: 'array', items: { type: 'string' } },
    actions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'owner'], properties: { text: { type: 'string' }, owner: { type: 'string', enum: ['coach', 'client'] } } } },
    flags: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'quote', 'severity'], properties: { kind: { type: 'string', enum: FLAG_KINDS }, quote: { type: 'string' }, severity: { type: 'string', enum: SEVERITIES } } } },
  },
};
const TRANSCRIPT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['transcript', 'language', 'summary'],
  properties: { transcript: { type: 'string' }, language: { type: 'string' }, summary: { type: 'string' } },
};

function prompts({ coach, client, direction, analyse }) {
  const coachFirst = first(coach.name), clientFirst = first(client.name);
  const system = `You transcribe voice notes between a personal trainer called ${coachFirst} and a client called ${clientFirst}. `
    + 'Write exactly what was said, in the language it was said, with light punctuation. You never write to the client. Return JSON only.';
  const prompt = direction === 'fromClient' && analyse
    ? `This voice note is from ${clientFirst} to ${coachFirst}. Return: transcript; language (ISO code); summary (one or two sentences, at most 240 characters, for ${coachFirst}); `
      + 'mood (upbeat, steady, flat, low, stressed or unknown); sentiment (-1 to 1); topics (at most 5, one or two words each); actions (at most 5 things to do, '
      + 'each with owner coach or client); flags (only what was actually said: pain, injury, illness, mentalHealth, safeguarding, cancelIntent or billing, each with '
      + 'the short quote it came from and a severity low, medium or high). No advice, no diagnosis.'
    : `This voice note is from ${coachFirst} to ${clientFirst}. Return: transcript; language (ISO code); summary (one line, at most 120 characters).`;
  return { system, prompt, schema: direction === 'fromClient' && analyse ? ANALYSIS_SCHEMA : TRANSCRIPT_SCHEMA };
}

/** The deterministic stub (6.3: labelled, never the network). */
function stubFor({ client, direction, seconds, analyse }) {
  return () => ({
    json: {
      transcript: `[Stub transcript] Voice note from ${direction === 'fromClient' ? first(client.name) : 'you'}, ${fmtVoiceLength(seconds)} long. Transcription is off on this server.`,
      language: 'en',
      summary: direction === 'fromClient' && analyse ? '[Stub] No analysis without an AI provider.' : `[Stub] Voice note to ${first(client.name)}.`,
      mood: 'unknown', sentiment: 0, topics: [], actions: [], flags: [],
    },
  });
}

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

/** The model's answer, checked and trimmed to the schema's limits. */
function normalise(json, { analyse }) {
  const out = { transcript: clip(json?.transcript, 20_000), language: clip(json?.language, 12) || null, summary: clip(json?.summary, 240) || null };
  if (!analyse) return { ...out, mood: null, sentiment: null, topics: [], actions: [], flags: [] };
  const sentiment = Number(json?.sentiment);
  return {
    ...out,
    mood: MOODS.includes(json?.mood) ? json.mood : 'unknown',
    sentiment: Number.isFinite(sentiment) ? Math.max(-1, Math.min(1, Math.round(sentiment * 100) / 100)) : null,
    topics: (Array.isArray(json?.topics) ? json.topics : []).map(t => clip(t, 40)).filter(Boolean).slice(0, 5),
    actions: (Array.isArray(json?.actions) ? json.actions : []).map(a => ({ text: clip(a?.text, 200), owner: a?.owner === 'client' ? 'client' : 'coach' })).filter(a => a.text).slice(0, 5),
    flags: (Array.isArray(json?.flags) ? json.flags : []).filter(f => FLAG_KINDS.includes(f?.kind))
      .map(f => ({ kind: f.kind, quote: clip(f.quote, 200), severity: SEVERITIES.includes(f.severity) ? f.severity : 'medium' })).slice(0, 7),
  };
}

/** "knee pain", "an injury", "feeling ill": what was mentioned, from the quote or the topics. */
function mentioned(flag, topics = []) {
  const text = `${flag.quote} ${topics.join(' ')}`.toLowerCase();
  const part = BODY_PARTS.find(p => new RegExp(`\\b${p}`).test(text));
  if (flag.kind === 'pain') return part ? `${part} pain` : 'pain';
  if (flag.kind === 'injury') return part ? `a ${part} injury` : 'an injury';
  return FLAG_WORD[flag.kind] ?? flag.kind;
}
/** "Mentioned knee pain in a voice note". */
const flagLine = (flag, topics) => `Mentioned ${mentioned(flag, topics)} in a voice note`;

/**
 * The 10 s clock: claim the oldest due row (a 3-minute lease, so a crash means
 * a late retry, never two calls at once), call the model, write the result.
 */
export async function processNext(db, config, now = new Date()) {
  const nowIsoStr = now.toISOString();
  const row = db.prepare(`SELECT * FROM voice_analyses WHERE (status='pending' OR (status='failed' AND attempts<2 AND next_try_at IS NOT NULL))
    AND (next_try_at IS NULL OR next_try_at<=?) ORDER BY created_at LIMIT 1`).get(nowIsoStr);
  if (!row) return { processed: 0 };
  const claimed = db.prepare('UPDATE voice_analyses SET next_try_at=? WHERE message_id=? AND status=? AND COALESCE(next_try_at, \'\')=COALESCE(?, \'\')')
    .run(new Date(now.getTime() + LEASE_MS).toISOString(), row.message_id, row.status, row.next_try_at).changes;
  if (!claimed) return { processed: 0 };
  const m = db.prepare('SELECT * FROM messages WHERE id=?').get(row.message_id);
  const media = m?.media_id ? db.prepare('SELECT * FROM media WHERE id=?').get(m.media_id) : null;
  const client = db.prepare("SELECT * FROM users WHERE id=? AND role='client'").get(row.client_id);
  const coach = client?.coach_id ? db.prepare("SELECT * FROM users WHERE id=? AND role='coach'").get(client.coach_id) : null;
  if (!m || !media || !client) return { processed: 0 };
  if (!coach) {
    tx(db, () => { db.prepare("UPDATE voice_analyses SET status='off', reason='aiOff', next_try_at=NULL, updated_at=? WHERE message_id=?").run(nowIso(), row.message_id); bump(db, row.message_id); });
    return { processed: 1, status: 'off' };
  }
  // Consent and settings again, at the moment of the call: withdrawing stops a pending note.
  const d = decide(db, config, { client, coach, direction: row.direction, seconds: media.duration_sec, now });
  if (d.status === 'off') {
    tx(db, () => {
      db.prepare("UPDATE voice_analyses SET status='off', reason=?, next_try_at=NULL, updated_at=? WHERE message_id=?").run(d.reason, nowIso(), row.message_id);
      bump(db, row.message_id);
    });
    return { processed: 1, status: 'off', reason: d.reason };
  }
  const analyse = row.direction === 'fromClient' && aiSettings(db, coach.id).analyse;
  const seconds = media.duration_sec ?? 0;
  const p = prompts({ coach, client, direction: row.direction, analyse });
  const stub = stubFor({ client, direction: row.direction, seconds, analyse });
  let result;
  try {
    // A demo client of a real coach can only happen by hand; it still never reaches a model.
    if (client.is_demo && !coach.is_demo) result = { json: stub().json, provider: 'stub', model: null };
    else result = await listen(db, config, { user: coach, clientId: client.id, purpose: 'transcribe', audioPath: mediaFilePath(config, media), fmt: 'mov', durationSec: seconds, ...p, stub });
  } catch (e) {
    const quota = e instanceof AiError && e.kind === 'quota';
    tx(db, () => {
      const cur = db.prepare('SELECT * FROM voice_analyses WHERE message_id=?').get(row.message_id);
      if (!cur || !db.prepare('SELECT 1 FROM messages WHERE id=?').get(row.message_id)) return;
      if (quota) db.prepare("UPDATE voice_analyses SET status='off', reason='quota', next_try_at=NULL, updated_at=? WHERE message_id=?").run(nowIso(), row.message_id);
      else {
        const attempts = cur.attempts + 1;
        db.prepare("UPDATE voice_analyses SET status='failed', attempts=?, error=?, next_try_at=?, updated_at=? WHERE message_id=?")
          .run(attempts, String(e?.message ?? e).slice(0, 300), attempts < 2 ? new Date(now.getTime() + RETRY_MS).toISOString() : null, nowIso(), row.message_id);
      }
      bump(db, row.message_id);
    });
    return { processed: 1, status: quota ? 'off' : 'failed', error: e?.message };
  }
  const out = normalise(result.json, { analyse });
  return tx(db, () => {
    // Erased, deleted or reassigned while the model was working: stop quietly.
    const cur = db.prepare('SELECT * FROM voice_analyses WHERE message_id=?').get(row.message_id);
    const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(row.message_id);
    const owner = db.prepare("SELECT coach_id FROM users WHERE id=? AND role='client'").get(row.client_id);
    if (!cur || !msg || !owner) return { processed: 0, gone: true };
    db.prepare(`UPDATE voice_analyses SET status='done', reason=NULL, error=NULL, next_try_at=NULL, attempts=attempts+1, transcript=?, language=?, summary=?, mood=?, sentiment=?,
      topics=?, actions=?, flags=?, provider=?, model=?, updated_at=? WHERE message_id=?`)
      .run(out.transcript, out.language, out.summary, out.mood, out.sentiment, JSON.stringify(out.topics), JSON.stringify(out.actions), JSON.stringify(out.flags),
        result.provider, result.model ?? null, nowIso(), row.message_id);
    bump(db, row.message_id);
    if (owner.coach_id !== coach.id) return { processed: 1, status: 'done' };
    emit(db, 'voice.analysed', { coachId: coach.id, clientId: client.id, summary: 'Voice note transcribed', messageId: row.message_id, direction: row.direction, flagged: out.flags.length });
    if (out.flags.length) {
      emit(db, 'voice.flagged', { coachId: coach.id, clientId: client.id, summary: `Voice note flagged: ${out.flags.map(f => f.kind).join(', ')}`, messageId: row.message_id, kinds: out.flags.map(f => f.kind) });
      const urgent = out.flags.find(f => URGENT_FLAGS.has(f.kind));
      const top = urgent ?? out.flags[0];
      // The body stays generic: an urgent one is pushed to the coach's phone, and the quote is health data.
      notifyCoach(db, config, coach.id, {
        clientId: client.id, kind: 'voiceFlag', title: `${first(client.name)} mentioned ${mentioned(top, out.topics)} in a voice note`,
        body: 'Open the thread to listen.', path: `/messages/${client.id}`, icon: urgent ? 'warning' : 'mic', tone: urgent ? 'urgent' : 'attention',
        dedupe: `voice:${row.message_id}`, now,
      });
    }
    return { processed: 1, status: 'done' };
  });
}

// MARK: - Retention (daily)

/** Transcripts and analyses 12 months after End coaching; analysis fields after 24 months regardless. */
export function applyRetention(db, now = new Date()) {
  const t = nowIso();
  const ended = db.prepare(`UPDATE voice_analyses SET transcript=NULL, language=NULL, summary=NULL, mood=NULL, sentiment=NULL, topics='[]', actions='[]', flags='[]', updated_at=?
    WHERE client_id IN (SELECT client_id FROM voice_client_state WHERE ended_at IS NOT NULL AND ended_at<?)
      AND (transcript IS NOT NULL OR summary IS NOT NULL OR mood IS NOT NULL OR sentiment IS NOT NULL OR topics<>'[]' OR actions<>'[]' OR flags<>'[]')`).run(t, months(now, 12)).changes;
  const old = db.prepare(`UPDATE voice_analyses SET summary=NULL, mood=NULL, sentiment=NULL, topics='[]', actions='[]', flags='[]', updated_at=?
    WHERE created_at<? AND (summary IS NOT NULL OR mood IS NOT NULL OR sentiment IS NOT NULL OR topics<>'[]' OR actions<>'[]' OR flags<>'[]')`).run(t, months(now, 24)).changes;
  return { ended, old };
}

// MARK: - The voice block (messageExtras)

/** The `voice` block for a message row and its analysis row. Client view unless coachView. */
function voiceBlock(m, va, media, { coachView }) {
  const gone = !m.media_id || !media;
  const status = gone ? 'deleted' : va?.status ?? 'pending';
  const done = status === 'done';
  const block = {
    mediaId: gone ? null : m.media_id, url: gone ? null : `/api/media/${m.media_id}`,
    durationSec: media?.duration_sec ?? va?.audio_seconds ?? null,
    status, reason: status === 'off' ? va?.reason ?? null : null,
    transcript: done ? va.transcript ?? null : null,
    provider: done ? va.provider ?? null : null,
    model: done && va.provider === 'openrouter' ? va.model ?? null : null,
  };
  if (coachView && done) {
    if (va.direction === 'fromClient') {
      Object.assign(block, { summary: va.summary ?? null, mood: va.mood ?? null, sentiment: va.sentiment ?? null,
        topics: parse(va.topics, []), actions: parse(va.actions, []), flags: parse(va.flags, []) });
    } else block.summary = va.summary ?? null;
  }
  if (coachView) block.listenedAt = va?.listened_at ?? null;
  return block;
}

function extras(db, messages, { coachView }) {
  const voice = messages.filter(m => m.kind === 'voice');
  const out = new Map();
  if (!voice.length) return out;
  const ids = JSON.stringify(voice.map(m => m.id));
  const rows = new Map(db.prepare('SELECT * FROM voice_analyses WHERE message_id IN (SELECT value FROM json_each(?))').all(ids).map(r => [r.message_id, r]));
  const mids = JSON.stringify(voice.map(m => m.media_id).filter(Boolean));
  const media = new Map(db.prepare('SELECT id, duration_sec FROM media WHERE id IN (SELECT value FROM json_each(?))').all(mids).map(r => [r.id, r]));
  for (const m of voice) {
    const md = m.media_id ? media.get(m.media_id) : null;
    out.set(m.id, { voice: voiceBlock(m, rows.get(m.id), md, { coachView }), ...(!md ? { text: m.text || 'Voice note deleted' } : {}) });
  }
  return out;
}

// MARK: - Routes

/** A voice message the coach may act on: through the CURRENT owner (clientFor), or 404. */
function ownVoiceMessage(ctx, id) {
  requireCoach(ctx);
  const m = typeof id === 'string' ? ctx.db.prepare("SELECT * FROM messages WHERE id=? AND kind='voice'").get(id) : null;
  if (!m) fail(404, 'Not found');
  const client = clientFor(ctx, m.client_id);
  return { m, client };
}

function putConsent(_req, ctx) {
  if (ctx.user.role !== 'client') fail(403, 'Clients only');
  const voice = oneOf(ctx.body.voice, 'voice', ['on', 'off']);
  ctx.db.prepare('INSERT INTO client_ai_consent (client_id, voice, at) VALUES (?,?,?) ON CONFLICT(client_id) DO UPDATE SET voice=excluded.voice, at=excluded.at')
    .run(ctx.user.id, voice, nowIso());
  return { voice };
}

function getConsent(_req, ctx) {
  if (ctx.user.role !== 'client') fail(403, 'Clients only');
  return consentOf(ctx.db, ctx.user.id);
}

function coachConsent(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.params.id);
  return consentOf(ctx.db, client.id);
}

function listVoice(_req, ctx) {
  requireCoach(ctx);
  const { db } = ctx;
  const client = ctx.query.clientId ? clientFor(ctx, ctx.query.clientId) : null;
  const where = ['u.coach_id=?'], args = [ctx.user.id];
  if (client) { where.push('m.client_id=?'); args.push(client.id); }
  if (ctx.query.flagged === '1') where.push("va.flags<>'[]'");
  if (ctx.query.q) {
    const q = str(ctx.query.q, 'q', { min: 2, max: 100 });
    where.push("(va.transcript LIKE ? ESCAPE '\\' OR va.summary LIKE ? ESCAPE '\\')");
    args.push(likeAny(q), likeAny(q));
  }
  if (ctx.query.before) { where.push('m.at<?'); args.push(instant(ctx.query.before, 'before')); }
  const n = ctx.query.limit ? num(Number(ctx.query.limit), 'limit', { min: 1, max: 100, int: true }) : 50;
  // LEFT JOIN: a note that has no analysis row yet still lists (as pending).
  const rows = db.prepare(`SELECT m.* FROM messages m JOIN users u ON u.id=m.client_id AND u.role='client'
    LEFT JOIN voice_analyses va ON va.message_id=m.id WHERE m.kind='voice' AND ${where.join(' AND ')} ORDER BY m.at DESC LIMIT ${n}`).all(...args);
  const names = new Map(db.prepare("SELECT id, name FROM users WHERE coach_id=? AND role='client'").all(ctx.user.id).map(u => [u.id, u.name]));
  const outs = messagesOut(db, rows, { coachView: true });
  return {
    items: outs.map(message => ({ message, client: { id: message.clientId, name: names.get(message.clientId), initials: initials(names.get(message.clientId) ?? '?') }, voice: message.voice })),
  };
}

function retry(_req, ctx) {
  const { m, client } = ownVoiceMessage(ctx, ctx.params.messageId);
  const db = ctx.db;
  if (!m.media_id || !db.prepare('SELECT 1 FROM media WHERE id=?').get(m.media_id)) fail(409, 'That voice note was deleted');
  tx(db, () => {
    const va = db.prepare('SELECT * FROM voice_analyses WHERE message_id=?').get(m.id);
    if (va?.status === 'pending') return;
    if (va?.status === 'done') fail(409, 'That voice note is already transcribed');
    const at = nowIso();
    if (va) db.prepare("UPDATE voice_analyses SET status='pending', reason=NULL, error=NULL, attempts=0, next_try_at=?, updated_at=? WHERE message_id=?").run(at, at, m.id);
    else {
      const media = db.prepare('SELECT * FROM media WHERE id=?').get(m.media_id);
      db.prepare(`INSERT INTO voice_analyses (message_id, media_id, client_id, coach_id, direction, status, next_try_at, audio_seconds, created_at, updated_at)
        VALUES (?,?,?,?,?, 'pending', ?,?,?,?)`).run(m.id, m.media_id, client.id, ctx.user.id, m.from_role === 'client' ? 'fromClient' : 'toClient', at, media.duration_sec, at, at);
    }
    bump(db, m.id);
  });
  return { voice: messagesOut(db, [db.prepare('SELECT * FROM messages WHERE id=?').get(m.id)], { coachView: true })[0].voice };
}

function listened(_req, ctx) {
  const { m } = ownVoiceMessage(ctx, ctx.params.messageId);
  ctx.db.prepare('UPDATE voice_analyses SET listened_at=COALESCE(listened_at, ?) WHERE message_id=?').run(nowIso(), m.id);
  return { ok: true };
}

function toTasks(_req, ctx) {
  const { m, client } = ownVoiceMessage(ctx, ctx.params.messageId);
  if (!allActions().some(a => a.id === 'task.create')) fail(409, 'Tasks are not available');
  const va = ctx.db.prepare("SELECT * FROM voice_analyses WHERE message_id=? AND status='done'").get(m.id);
  const actions = parse(va?.actions, []);
  if (!actions.length) fail(400, 'This voice note has no action items');
  const pick = Array.isArray(ctx.body.indexes) ? ctx.body.indexes.map(i => num(i, 'indexes[]', { min: 0, max: actions.length - 1, int: true })) : actions.map((_, i) => i);
  const created = tx(ctx.db, () => {
    let n = 0;
    for (const i of new Set(pick)) {
      runAction(ctx.db, ctx.config, 'task.create', { coachId: ctx.user.id, client, via: 'coachAction',
        params: { title: actions[i].text.slice(0, 200), notes: `From ${first(client.name)}'s voice note` } });
      n++;
    }
    ctx.db.prepare('UPDATE voice_analyses SET listened_at=COALESCE(listened_at, ?) WHERE message_id=?').run(nowIso(), m.id);
    return n;
  });
  return { created };
}

// MARK: - Hooks

/** Mean sentiment of a client's analysed notes over 14 days (current owner only); null when there are none. */
function sentiment14(db, coachId, clientIds, today) {
  const from = londonToUtc(addDays(today, -13)).toISOString();
  const out = new Map();
  for (const r of db.prepare(`SELECT va.client_id, AVG(va.sentiment) s FROM voice_analyses va JOIN users u ON u.id=va.client_id AND u.coach_id=?
    WHERE va.client_id IN (SELECT value FROM json_each(?)) AND va.direction='fromClient' AND va.status='done' AND va.sentiment IS NOT NULL AND va.created_at>=?
    GROUP BY va.client_id`).all(coachId, JSON.stringify(clientIds), from)) out.set(r.client_id, Math.round(r.s * 100) / 100);
  return out;
}

/** A pain or injury flag in the client's voice notes over 14 days (current owner only). */
function pain14(db, coachId, clientIds, today) {
  const from = londonToUtc(addDays(today, -13)).toISOString();
  const out = new Map(clientIds.map(id => [id, false]));
  for (const r of db.prepare(`SELECT va.client_id, va.flags FROM voice_analyses va JOIN users u ON u.id=va.client_id AND u.coach_id=?
    WHERE va.client_id IN (SELECT value FROM json_each(?)) AND va.status='done' AND va.flags<>'[]' AND va.created_at>=?`).all(coachId, JSON.stringify(clientIds), from)) {
    if (parse(r.flags, []).some(f => f.kind === 'pain' || f.kind === 'injury')) out.set(r.client_id, true);
  }
  return out;
}

/** Recent flagged notes (current owner), newest first: [{va, m, name}]. */
function flagged(db, coachId, sinceIso, kinds) {
  return db.prepare(`SELECT va.*, m.at msg_at, u.name FROM voice_analyses va JOIN messages m ON m.id=va.message_id JOIN users u ON u.id=va.client_id AND u.coach_id=?
    WHERE va.direction='fromClient' AND va.status='done' AND va.flags<>'[]' AND m.at>=? ORDER BY m.at DESC`).all(coachId, sinceIso)
    .map(r => ({ r, flags: parse(r.flags, []).filter(f => kinds.includes(f.kind)) })).filter(x => x.flags.length);
}

function needs(db, coach, clients, today) {
  const since = londonToUtc(addDays(today, -6)).toISOString();
  const replied = db.prepare("SELECT 1 FROM messages WHERE client_id=? AND from_role='coach' AND at>? LIMIT 1");
  const seen = new Set();
  const out = [];
  for (const { r, flags } of flagged(db, coach.id, since, ['pain', 'injury', 'illness'])) {
    if (seen.has(r.client_id) || replied.get(r.client_id, r.msg_at)) continue;
    seen.add(r.client_id);
    const f = flags.find(x => x.kind === 'pain') ?? flags.find(x => x.kind === 'injury') ?? flags[0];
    out.push({ clientId: r.client_id, kind: 'voiceFlag', text: flagLine(f, parse(r.topics, [])), at: r.msg_at, rank: f.kind === 'illness' ? 2 : 1,
      iconKey: 'mic', action: { label: 'Listen', path: `/messages/${r.client_id}` } });
  }
  return out;
}

function inbox(db, coach) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const tasks = allActions().some(a => a.id === 'task.create');
  return db.prepare(`SELECT m.*, u.name, va.status va_status, va.summary, va.flags, va.actions va_actions, va.listened_at FROM messages m
    JOIN users u ON u.id=m.client_id AND u.coach_id=? AND u.role='client'
    LEFT JOIN voice_analyses va ON va.message_id=m.id
    WHERE m.kind='voice' AND m.from_role='client' AND m.at>=? AND va.listened_at IS NULL ORDER BY m.at DESC LIMIT 100`).all(coach.id, since).map(m => {
    const flags = m.va_status === 'done' ? parse(m.flags, []) : [];
    const actions = m.va_status === 'done' ? parse(m.va_actions, []) : [];
    return {
      key: `voice:${m.id}`, kind: 'voice', clientId: m.client_id, title: `Voice note from ${first(m.name)}`,
      preview: m.va_status === 'done' && m.summary ? m.summary : m.text, at: m.at, icon: 'mic',
      tone: flags.some(f => URGENT_FLAGS.has(f.kind)) ? 'urgent' : flags.length ? 'attention' : 'data', path: `/messages/${m.client_id}`,
      actions: [
        { id: 'done', label: 'Mark done', method: 'POST', url: `/api/voice/${m.id}/listened` },
        ...(tasks && actions.length ? [{ id: 'tasks', label: 'Add actions as tasks', method: 'POST', url: `/api/voice/${m.id}/tasks` }] : []),
      ],
    };
  });
}

function search(db, coach, q, lim) {
  return db.prepare(`SELECT va.message_id, va.client_id, va.transcript, m.at, u.name FROM voice_analyses va JOIN messages m ON m.id=va.message_id
    JOIN users u ON u.id=va.client_id AND u.coach_id=? WHERE va.status='done' AND va.transcript LIKE ? ESCAPE '\\' ORDER BY m.at DESC LIMIT ?`)
    .all(coach.id, likeAny(q), lim).map(r => {
      const t = r.transcript, i = t.toLowerCase().indexOf(q.toLowerCase()), from = Math.max(0, i - 30);
      return { type: 'voice', id: r.message_id, title: `${r.name} · voice note`, detail: `${from ? '…' : ''}${t.slice(from, from + 90)}${from + 90 < t.length ? '…' : ''}`,
        path: `/messages/${r.client_id}`, icon: 'mic', score: matchScore(t, q) * 0.8, at: r.at };
    });
}

function timeline(db, coach, client, before, lim) {
  return db.prepare(`SELECT va.*, m.at msg_at, m.text FROM voice_analyses va JOIN messages m ON m.id=va.message_id JOIN users u ON u.id=va.client_id AND u.coach_id=?
    WHERE va.client_id=? AND m.at<? ORDER BY m.at DESC LIMIT ?`).all(coach.id, client.id, before || '9999', lim || 50).map(r => {
    const flags = r.status === 'done' ? parse(r.flags, []) : [];
    return {
      at: r.msg_at, kind: 'voice', icon: 'mic', tone: flags.some(f => URGENT_FLAGS.has(f.kind)) ? 'urgent' : flags.length ? 'attention' : 'data',
      title: r.direction === 'fromClient' ? `Voice note from ${first(client.name)}` : 'You sent a voice note',
      detail: r.status === 'done' ? (r.summary ?? r.text) : r.text, path: `/messages/${client.id}`,
    };
  });
}

const VENDORS = { google: 'Google', openai: 'OpenAI', mistralai: 'Mistral AI', anthropic: 'Anthropic', 'meta-llama': 'Meta', qwen: 'Alibaba Qwen', deepseek: 'DeepSeek', 'x-ai': 'xAI', microsoft: 'Microsoft' };
/** The vendor of AI_AUDIO_MODEL ("google/gemini-2.5-flash" → "Google"), for the apps' consent sheet (D16); null when unset. */
export function voiceProvider(model = process.env.AI_AUDIO_MODEL) {
  const prefix = String(model ?? '').split('/')[0].trim().toLowerCase();
  if (!prefix || prefix === String(model).trim().toLowerCase()) return null;
  return VENDORS[prefix] ?? prefix.replace(/(^|[-_])([a-z])/g, (_, s, c) => `${s ? ' ' : ''}${c.toUpperCase()}`);
}

function meFeatures(db, user) {
  // The iPhone app reads voiceProvider, the Android app voiceAiProvider: both carry the audio model's vendor.
  const provider = voiceProvider();
  const vendor = provider ? { voiceProvider: provider, voiceAiProvider: provider } : {};
  if (user.role === 'coach') {
    const s = aiSettings(db, user.id);
    return { voiceMaxSec: MAX_SEC, voiceTranscription: s.enabled && s.transcribe ? 'on' : 'off', ...vendor };
  }
  return { voiceMaxSec: MAX_SEC, voiceTranscription: consentOf(db, user.id).voice, ...vendor };
}

function exportFor(db, user) {
  const row = r => ({
    messageId: r.message_id, at: r.created_at, direction: r.direction, status: r.status, reason: r.reason, transcript: r.transcript, language: r.language,
    summary: r.summary, mood: r.mood, sentiment: r.sentiment, topics: parse(r.topics, []), actions: parse(r.actions, []), flags: parse(r.flags, []),
    provider: r.provider, model: r.model,
  });
  if (user.role === 'coach') {
    // The coach's own words: transcripts of the notes they sent (no analysis is ever run on them).
    return { sent: db.prepare("SELECT * FROM voice_analyses WHERE coach_id=? AND direction='toClient' ORDER BY created_at").all(user.id)
      .map(r => ({ messageId: r.message_id, at: r.created_at, status: r.status, transcript: r.transcript })) };
  }
  return {
    consent: consentOf(db, user.id),
    // Data about the client, so it belongs in a subject access response (6.3): the one client-facing place analysis appears.
    analyses: db.prepare('SELECT * FROM voice_analyses WHERE client_id=? ORDER BY created_at').all(user.id).map(row),
    endedAt: db.prepare('SELECT ended_at FROM voice_client_state WHERE client_id=?').get(user.id)?.ended_at ?? null,
  };
}

// MARK: - Demo (3.10): six notes across three clients, pre-written, provider stub

const DEMO_NOTES = [
  { who: 'Tom', key: 'voice-demo-1', dir: 'toClient', ago: 6 * 24 + 3, secs: 27, consent: 'on',
    transcript: 'Tom, it\'s JK. Two sessions this week, Tuesday and Friday, and a twenty-minute walk on the days in between. Keep it simple and tell me how it goes.',
    summary: 'Plan for the week: two sessions and walks in between.' },
  { who: 'Tom', key: 'voice-demo-2', dir: 'fromClient', ago: 30, secs: 42, listened: false,
    transcript: 'Morning JK. Quick one: my left knee\'s been sore since Saturday\'s walk, mostly going down the stairs. I still did Tuesday\'s session but skipped the lunges. Should I swap anything this week?',
    summary: 'Left knee sore since Saturday, worse on stairs; skipped lunges and asks whether to swap anything this week.',
    mood: 'flat', sentiment: -0.35, topics: ['knee', 'stairs', 'lunges'],
    actions: [{ text: 'Swap lunges for a knee-friendly option this week', owner: 'coach' }, { text: 'Note how the knee feels on stairs', owner: 'client' }],
    flags: [{ kind: 'pain', quote: 'my left knee\'s been sore since Saturday', severity: 'medium' }] },
  { who: 'Priya', key: 'voice-demo-3', dir: 'fromClient', ago: 5 * 24 + 2, secs: 58, listened: true,
    transcript: 'Hi JK, bit nervous about the race if I\'m honest. The long run felt heavy on Sunday and work has been chaos. Is it normal to feel this flat five weeks out?',
    summary: 'Nervous about the race; long run felt heavy and work is busy. Asks if feeling flat five weeks out is normal.',
    mood: 'stressed', sentiment: -0.2, topics: ['race', 'long run', 'work stress'],
    actions: [{ text: 'Reassure about the taper and plan a lighter week', owner: 'coach' }], flags: [] },
  { who: 'Priya', key: 'voice-demo-4', dir: 'fromClient', ago: 22, secs: 35, listened: true,
    transcript: 'JK! Ten K this morning in forty-four twelve. That\'s a PB by almost a minute. The negative split thing actually works. Buzzing.',
    summary: 'New 10 km PB, 44:12, nearly a minute faster; the negative-split plan worked.',
    mood: 'upbeat', sentiment: 0.9, topics: ['10k PB', 'pacing'],
    actions: [{ text: 'Add the PB to her goal and plan the next block', owner: 'coach' }], flags: [] },
  { who: 'Priya', key: 'voice-demo-5', dir: 'toClient', ago: 20, secs: 31,
    transcript: 'Priya, forty-four twelve is massive. That\'s the engine work paying off. Easy day tomorrow, and we\'ll talk race pacing on Thursday.',
    summary: 'Congratulations on the PB; easy day tomorrow, race pacing on Thursday.' },
  { who: 'Sam', key: 'voice-demo-6', dir: 'fromClient', ago: 2, secs: 19, listened: false },
];

function buildDemo(db, ctx) {
  const { coach, clients, byName, today } = ctx;
  // Own tables, wiped here rather than through demo.tables (integration request: the foundation wipe runs before
  // feature schemas when a test builds the demo before createApp). Messages, and so voice_analyses, are already gone.
  voiceSchema(db);
  const ids = JSON.stringify(clients.map(c => c.id));
  for (const t of ['voice_analyses', 'client_ai_consent', 'voice_client_state']) db.prepare(`DELETE FROM ${t} WHERE client_id IN (SELECT value FROM json_each(?))`).run(ids);
  // Anchored at noon, or just before the build when it runs earlier on the same day (the nightly rebuild is after 03:00), so no note
  // is in the future: the client's /api/timeline leaves future rows out.
  const noon = londonToUtc(today, '12:00').getTime();
  const real = Date.now();
  const nowAt = real >= londonToUtc(today, '00:00').getTime() && real < noon ? real - 10 * 60_000 : noon;
  const consented = new Set();
  for (const n of DEMO_NOTES) {
    const client = byName[n.who];
    const media = ctx.media(n.key);
    if (!client || !media) continue;
    if (n.dir === 'fromClient' && n.transcript) consented.add(client.id);
    if (n.consent === 'on') consented.add(client.id);
    const at = new Date(nowAt - n.ago * 3_600_000).toISOString();
    const id = newId('m');
    const fromClient = n.dir === 'fromClient';
    db.prepare(`INSERT INTO messages (id, client_id, from_id, from_role, text, at, read_at, kind, media_id, via, updated_at) VALUES (?,?,?,?,?,?,?, 'voice', ?,?,?)`)
      .run(id, client.id, fromClient ? client.id : coach.id, fromClient ? 'client' : 'coach', `Voice note · ${fmtVoiceLength(n.secs)}`, at,
        fromClient ? (n.listened ? at : null) : at, media.id, fromClient ? 'app' : 'desk', at);
    const done = !!n.transcript;
    db.prepare(`INSERT INTO voice_analyses (message_id, media_id, client_id, coach_id, direction, status, reason, attempts, audio_seconds, transcript, language, summary, mood,
      sentiment, topics, actions, flags, provider, model, listened_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, media.id, client.id, coach.id, n.dir, done ? 'done' : 'off', done ? null : 'noConsent', done ? 1 : 0, n.secs, n.transcript ?? null, done ? 'en' : null,
        n.summary ?? null, n.mood ?? null, n.sentiment ?? null, JSON.stringify(n.topics ?? []), JSON.stringify(n.actions ?? []), JSON.stringify(n.flags ?? []),
        done ? 'stub' : null, null, fromClient && n.listened ? at : null, at, at);
  }
  // Tom and Priya allowed transcription; Sam has not been asked (the demo client app shows the consent sheet).
  for (const id of consented) {
    db.prepare('INSERT INTO client_ai_consent (client_id, voice, at) VALUES (?, \'on\', ?) ON CONFLICT(client_id) DO UPDATE SET voice=\'on\', at=excluded.at')
      .run(id, londonToUtc(addDays(today, -40), '09:00').toISOString());
  }
}

/** Idempotent DDL. The demo builder runs it too: a store can be built before createApp runs the feature schemas. */
function voiceSchema(db) {
  db.exec(`
      CREATE TABLE IF NOT EXISTS voice_analyses (
        message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- informational only; access joins the CURRENT owner
        direction TEXT NOT NULL CHECK (direction IN ('toClient','fromClient')),
        status TEXT NOT NULL CHECK (status IN ('pending','done','failed','off')),
        reason TEXT CHECK (reason IN ('aiOff','quota','noConsent')),
        attempts INTEGER NOT NULL DEFAULT 0, next_try_at TEXT, audio_seconds REAL,
        transcript TEXT, language TEXT, summary TEXT, mood TEXT, sentiment REAL,
        topics TEXT NOT NULL DEFAULT '[]', actions TEXT NOT NULL DEFAULT '[]', flags TEXT NOT NULL DEFAULT '[]',
        provider TEXT, model TEXT, error TEXT, listened_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS voice_analyses_status ON voice_analyses(status, next_try_at);
      CREATE UNIQUE INDEX IF NOT EXISTS voice_analyses_media ON voice_analyses(media_id);
      CREATE INDEX IF NOT EXISTS voice_analyses_client ON voice_analyses(client_id, created_at);
      CREATE TABLE IF NOT EXISTS client_ai_consent (
        client_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        voice TEXT NOT NULL CHECK (voice IN ('on','off')), at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS voice_client_state (
        client_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, ended_at TEXT);`);
}

export const feature = {
  name: 'voice',
  namespaces: ['voice'],
  exact: [],
  schema: voiceSchema,
  routes(r) {
    r.add('PUT', '/api/voice/consent', putConsent);
    r.add('GET', '/api/voice/consent', getConsent);
    r.add('GET', '/api/coach/clients/:id/ai-consent', coachConsent);
    r.add('GET', '/api/voice', listVoice);
    r.add('POST', '/api/voice/:messageId/retry', retry);
    r.add('POST', '/api/voice/:messageId/listened', listened);
    r.add('POST', '/api/voice/:messageId/tasks', toTasks);
  },
  clocks: [
    { id: 'voice.transcribe', everyMs: 10_000, run: (db, config, now) => processNext(db, config, now) },
    { id: 'voice.retention', everyMs: 24 * 3_600_000, run: (db, _config, now) => applyRetention(db, now) },
  ],
  on: {
    'message.sent': queue,
    'message.received': queue,
    // End coaching (WP2): the 12-month clock for transcripts starts.
    'client.offboarded': (db, _config, ev) => {
      if (!ev.clientId) return;
      db.prepare('INSERT INTO voice_client_state (client_id, ended_at) VALUES (?,?) ON CONFLICT(client_id) DO UPDATE SET ended_at=excluded.ended_at').run(ev.clientId, ev.at);
    },
  },
  emits: {
    'voice.analysed': { label: 'A voice note was transcribed', payload: ['messageId', 'direction', 'flagged'], aiDerived: true },
    'voice.flagged': { label: 'A voice note mentioned pain, illness or another flag', payload: ['messageId', 'kinds'], aiDerived: true },
  },
  facts: {
    'voice.sentiment14': { label: 'Voice note sentiment (14 days, −1 to 1)', type: 'number', aiDerived: true, compute: sentiment14 },
    'voice.pain14': { label: 'Pain or injury mentioned in a voice note (14 days)', type: 'bool', aiDerived: true, compute: pain14 },
  },
  needs, inbox, search, timeline, meFeatures, exportFor,
  messageExtras: extras,
  demo: {
    media: DEMO_NOTES.map(n => ({ key: n.key, file: 'fixtures/voice-demo.m4a', mime: 'audio/mp4', durationSec: n.secs })),
    build: buildDemo,
  },
};
