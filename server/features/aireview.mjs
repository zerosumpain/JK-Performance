import { clientFor, initials, ownRow, requireCoach } from '../access.mjs';
import { aiInfo, aiSettings, AiError, complete, listen, redactForAi, surnameOf } from '../ai.mjs';
import { emit } from '../events.mjs';
import { clientFacts } from '../facts.mjs';
import { fail, instant, oneOf, str } from '../http.mjs';
import { mediaFilePath } from '../media.mjs';
import { fmtVoiceLength, messagesOut } from '../messages.mjs';
import { planOf } from '../plans.mjs';
import { limit } from '../ratelimit.mjs';
import { newId, nowIso, tx } from '../store.mjs';
import { render } from '../templating.mjs';
import { addDays, londonDay, londonToUtc, mondayOf } from '../time.mjs';

/**
 * F18: the AI second opinion before sending, and drafting assist
 * (docs/design/desk-v2.md F18, 6.3). docs/api/wp6-ai-voice.md is the contract.
 *
 * The AI never sends anything (D5). Nothing here inserts into messages,
 * scheduled_messages, deferred_messages or broadcasts: a review returns a
 * verdict, issues and a rewrite; a draft returns text for the composer; the
 * `ai.draft` action and "Route to JK for approval" file Inbox items. The coach
 * presses Send, through the ordinary message endpoints.
 *
 * What reaches the model is minimised server-side (reviewContext: an exact key
 * set) and every client-derived string goes through redactForAi. ai_reviews
 * keeps the coach's draft (their own words) for the audit, pruned at 180 days.
 */

const SURFACES = ['message', 'letter', 'broadcast', 'scheduled'];
const DECISIONS = ['sentOriginal', 'usedRewrite', 'edited', 'dismissed', 'overridden', 'approved', 'rejected'];
const KINDS = ['safety', 'consistency', 'tone', 'clarity', 'scope'];
const INTENTS = { reply: 'Reply to the last message', nudge: 'A friendly nudge', celebrate: 'Celebrate a win', reschedule: 'Reschedule a session', free: 'Free text' };
const RETENTION_DAYS = 180;
const first = name => String(name ?? '').trim().split(/\s+/)[0] || 'there';
const parse = (v, fallback) => { try { return JSON.parse(v ?? '') ?? fallback; } catch { return fallback; } };
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

/** 30 AI requests a minute per coach, on top of the daily caps (ai.mjs). */
function rateLimit(ctx) {
  if (!limit(`ai:${ctx.user.id}`, { max: 30, perMs: 60_000 })) fail(429, 'Too many AI requests; try again in a minute');
}

/** An AiError as an HTTP failure ("AI unavailable: …", 429 for the daily cap). */
function aiFail(e) {
  if (e instanceof AiError) fail(e.status, e.message);
  throw e;
}

function requireAi(ctx, what = null) {
  const s = aiSettings(ctx.db, ctx.user.id);
  if (!s.enabled) fail(409, 'AI is turned off in Settings › AI');
  if (what === 'drafts' && !s.drafts) fail(409, 'AI drafts are off in Settings › AI');
  if (what === 'transcribe' && !s.transcribe) fail(409, 'Transcription is off in Settings › AI');
  return s;
}

// MARK: - Context minimisation (F18: only these fields, all redacted)

export const CONTEXT_KEYS = ['first', 'plan', 'goal', 'aim', 'injuries', 'limitations', 'experience', 'checkins', 'priorities', 'commitments', 'nextSession', 'thread', 'campaign'];
const PAIN_WORDS = /\b(pain\w*|injur\w*|sore\w*|hurt\w*|ache\w*|aching|tweak\w*|strain\w*|sprain\w*|swollen|swelling|niggle\w*|tight\w*|physio\w*|knee|back|shoulder|hip|ankle|calf|hamstring|neck|wrist|elbow|foot|achilles)\b/i;

/**
 * What the model may know about a client, and nothing else (F18): first name,
 * plan name, goal and aim, profile injuries/limitations/experience, pain flags
 * and notes from the last 4 check-ins, priorities and this week's commitments,
 * the next session's day and kind, the last 8 thread messages (≤500 chars,
 * voice notes as their transcript) and the active campaign. Every string from
 * client data goes through redactForAi. Returns {facts, factsUsed:[label]}.
 */
export function reviewContext(db, coach, client, now = new Date()) {
  const surname = surnameOf(client.name);
  const red = t => (t === null || t === undefined || t === '' ? null : redactForAi(String(t), { surname }));
  const today = londonDay(now);
  const profile = parse(client.profile, {}) ?? {};
  const goal = db.prepare("SELECT * FROM goals WHERE client_id=? AND status='active' ORDER BY updated_at DESC LIMIT 1").get(client.id);
  const checkins = db.prepare('SELECT week, pain, note FROM checkins WHERE client_id=? ORDER BY week DESC LIMIT 4').all(client.id)
    .map(c => ({ week: c.week, pain: parse(c.pain, []).map(p => red(p)).filter(Boolean), note: red(c.note) }));
  const priorities = db.prepare('SELECT title FROM priorities WHERE client_id=? ORDER BY position').all(client.id).map(p => red(p.title));
  const commitments = db.prepare('SELECT text FROM commitments WHERE client_id=? AND week=? ORDER BY position').all(client.id, mondayOf(today)).map(c => red(c.text));
  const next = db.prepare(`SELECT start, kind FROM bookings WHERE cancelled_at IS NULL AND start>? AND (client_id=? OR id IN (SELECT booking_id FROM class_attendees WHERE user_id=?))
    ORDER BY start LIMIT 1`).get(now.toISOString(), client.id, client.id);
  const rows = db.prepare("SELECT * FROM messages WHERE client_id=? AND kind<>'letter' ORDER BY at DESC LIMIT 8").all(client.id).reverse();
  const thread = messagesOut(db, rows).map(m => ({
    from: m.fromRole === 'client' ? 'client' : 'coach',
    text: red(clip(m.kind === 'voice' ? (m.voice?.transcript ? `(voice note) ${m.voice.transcript}` : '(voice note, not transcribed)') : m.text, 500)),
  }));
  let campaign = null;
  try {
    const r = render(db, coach.id, client, '{campaign}\u0001{campaignDay}', { now });
    if (!r.missing.includes('campaign') && !r.empty.includes('campaign')) {
      const [name, day] = r.text.split('\u0001');
      campaign = { name: red(name), day: r.missing.includes('campaignDay') ? null : day || null };
    }
  } catch { campaign = null; }
  const facts = {
    first: first(client.name),
    plan: planOf(db, client)?.name ?? null,
    goal: goal ? red(goal.title) : null,
    aim: goal && goal.target !== null ? `${goal.target}${goal.unit ? ` ${goal.unit}` : ''}${goal.target_date ? ` by ${goal.target_date}` : ''}` : null,
    injuries: red(profile.injuries),
    limitations: red(profile.limitations),
    experience: profile.experience ?? null,
    checkins, priorities, commitments,
    nextSession: next ? { day: londonDay(new Date(next.start)), kind: next.kind } : null,
    thread, campaign,
  };
  const factsUsed = [
    `First name (${facts.first})`, facts.plan ? `Plan: ${facts.plan}` : null, facts.goal ? `Goal: ${facts.goal}` : null,
    facts.injuries || facts.limitations ? 'Injuries and limitations from the intake' : null, facts.experience ? `Experience: ${facts.experience}` : null,
    checkins.length ? `Pain flags and notes from the last ${checkins.length} check-in${checkins.length === 1 ? '' : 's'}` : null,
    priorities.length ? 'Current priorities' : null, commitments.length ? 'This week\'s commitments' : null,
    facts.nextSession ? 'Next session date and kind' : null, thread.length ? `Last ${thread.length} message${thread.length === 1 ? '' : 's'} in the thread` : null,
    campaign ? `Campaign: ${campaign.name}` : null,
  ].filter(Boolean);
  return { facts, factsUsed };
}

// MARK: - The reviewer

const SYSTEM = coachFirst => `You are a careful second reader for a personal trainer called ${coachFirst}. You never write to the client. You check a draft
message from the trainer to a client for: (1) safety: medical diagnosis or treatment advice beyond a trainer's scope, ignoring reported
pain, injury, illness or mental-health red flags, unsafe loads or nutrition; (2) consistency with the client facts given; (3) tone: warm, direct,
British English, no shaming; (4) clarity: one clear ask. Return JSON only.`;

export const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdict', 'summary', 'issues', 'rewrite'],
  properties: {
    verdict: { type: 'string', enum: ['ok', 'caution', 'stop'] },
    summary: { type: 'string' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'severity', 'quote', 'note'],
      properties: { kind: { type: 'string', enum: KINDS }, severity: { type: 'string', enum: ['low', 'medium', 'high'] }, quote: { type: 'string' }, note: { type: 'string' } } } },
    rewrite: { type: ['string', 'null'] },
  },
};

const MEDICAL = /\b(diagnos\w*|prescri\w*|ibuprofen|paracetamol|naproxen|steroid\w*|you (have|'ve got) (a )?(tear|fracture|sprain))\b/i;
const ASK = /\?|\b(let me know|tell me|can you|could you|please|reply|send me|book|try|aim|make sure|shall we|are you|do you)\b/i;

/**
 * The deterministic stub reviewer (F18): stop for medical advice or for
 * ignoring a pain flag of the last 14 days; caution for shouting, more than 3
 * exclamation marks, more than 1200 characters, or no question or clear ask;
 * ok otherwise. Visible text starts with "[Stub] ".
 */
export function stubReview(text, { pain14 = false, painParts = [] } = {}) {
  const issues = [];
  let rewrite = text;
  const med = MEDICAL.exec(text);
  if (med) {
    issues.push({ kind: 'safety', severity: 'high', quote: med[0], note: 'This reads as medical advice. Point them to a GP or physio instead.' });
    rewrite = `${rewrite.replace(MEDICAL, 'something to check with your GP or physio')}`;
  }
  const mentionsPain = PAIN_WORDS.test(text) || painParts.some(p => p && new RegExp(`\\b${String(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(text));
  if (pain14 && !mentionsPain) {
    issues.push({ kind: 'safety', severity: 'high', quote: text.split(/[.!?\n]/)[0].slice(0, 120), note: `They flagged ${painParts[0] ? `${String(painParts[0]).toLowerCase()} ` : ''}pain in the last two weeks and this doesn't mention it.` });
    rewrite = `How is the ${painParts[0] ? String(painParts[0]).toLowerCase() : 'pain'} feeling? ${rewrite}`;
  }
  const caps = text.match(/\b[A-Z]{4,}\b/g);
  if (caps) {
    issues.push({ kind: 'tone', severity: 'low', quote: caps[0], note: 'Capitals can read as shouting.' });
    rewrite = rewrite.replace(/\b[A-Z]{4,}\b/g, w => w.toLowerCase());
  }
  if ((text.match(/!/g) ?? []).length > 3) {
    issues.push({ kind: 'tone', severity: 'low', quote: text.match(/[^.!?]*!/)?.[0]?.trim().slice(0, 120) ?? '!', note: 'Lots of exclamation marks. One is plenty.' });
    rewrite = rewrite.replace(/!+/g, '.').replace(/\.(?=[^.]*$)/, '!');
  }
  if (text.length > 1200) {
    issues.push({ kind: 'clarity', severity: 'medium', quote: text.slice(1150, 1200), note: 'This is long. Keep it to the one thing that matters.' });
    rewrite = `${rewrite.slice(0, 1100).replace(/\s+\S*$/, '')}…`;
  }
  if (!ASK.test(text)) {
    issues.push({ kind: 'clarity', severity: 'low', quote: text.slice(0, 80), note: 'There is no question or clear ask.' });
    rewrite = `${rewrite.replace(/\s+$/, '')} Let me know how that sounds?`;
  }
  const stop = issues.some(i => i.kind === 'safety');
  const verdict = stop ? 'stop' : issues.length ? 'caution' : 'ok';
  const summary = verdict === 'ok' ? '[Stub] Clear, kind and safe to send.'
    : verdict === 'stop' ? `[Stub] Stop and check: ${issues.find(i => i.kind === 'safety').note}` : `[Stub] Worth a look: ${issues.map(i => i.note.replace(/\.$/, '').toLowerCase()).join('; ')}.`;
  return { verdict, summary: summary.slice(0, 200), issues: issues.slice(0, 6), rewrite: verdict === 'ok' ? null : `[Stub] ${rewrite}`.slice(0, 4000) };
}

/** The model's answer, trimmed to the schema's limits; a rewrite is null when the verdict is ok. */
function normaliseReview(json) {
  const verdict = ['ok', 'caution', 'stop'].includes(json?.verdict) ? json.verdict : 'caution';
  const issues = (Array.isArray(json?.issues) ? json.issues : []).filter(i => KINDS.includes(i?.kind)).slice(0, 6)
    .map(i => ({ kind: i.kind, severity: ['low', 'medium', 'high'].includes(i.severity) ? i.severity : 'medium', quote: clip(i.quote, 200), note: clip(i.note, 300) }));
  const rewrite = verdict === 'ok' || !json?.rewrite ? null : clip(json.rewrite, 4000);
  return { verdict, summary: clip(json?.summary, 200) || 'No summary given.', issues, rewrite };
}

/** Pain in the last 14 days (core.pain14) and the body parts named in recent check-ins. */
function painOf(db, coachId, client, now) {
  let pain14 = false;
  try { pain14 = !!clientFacts(db, coachId, [client.id], { only: ['core.pain14'], now }).get(client.id)?.['core.pain14']; } catch { pain14 = false; }
  const from = londonToUtc(addDays(londonDay(now), -13)).toISOString();
  const parts = db.prepare('SELECT pain FROM checkins WHERE client_id=? AND submitted_at>=? ORDER BY submitted_at DESC').all(client.id, from).flatMap(c => parse(c.pain, []));
  return { pain14: pain14 || parts.length > 0, painParts: parts };
}

/** Run a review (the model or the stub). Resolves {verdict, summary, issues, rewrite, factsUsed, provider, model}. */
async function runReview(ctx, { client, surface, text, audience }) {
  const { db, config, user: coach } = ctx;
  const now = new Date();
  const ctxFacts = client ? reviewContext(db, coach, client, now) : { facts: { audience: audience ? 'a group of clients (no individual facts)' : 'no client named' }, factsUsed: ['No client facts (a group message)'] };
  const surname = client ? surnameOf(client.name) : null;
  const draft = redactForAi(text, { surname });
  const pain = client ? painOf(db, coach.id, client, now) : { pain14: false, painParts: [] };
  const prompt = `Client facts (JSON):\n${JSON.stringify(ctxFacts.facts)}\n\nThe trainer's draft ${surface} to ${client ? first(client.name) : 'a group of clients'}:\n<<<\n${draft}\n>>>\n\n`
    + 'Return {verdict: ok|caution|stop, summary (one line, ≤200 chars), issues (≤6, each {kind: safety|consistency|tone|clarity|scope, severity: low|medium|high, '
    + 'quote: the exact fragment of the draft, note}), rewrite (keep the trainer\'s voice, length within ±30%; null when the verdict is ok)}.';
  let out;
  try {
    out = await complete(db, config, { user: coach, clientId: client?.id ?? null, purpose: 'review', system: SYSTEM(first(coach.name)), prompt, schema: REVIEW_SCHEMA,
      stub: () => ({ json: stubReview(text, pain) }) });
  } catch (e) { aiFail(e); }
  return { ...normaliseReview(out.json), factsUsed: ctxFacts.factsUsed, provider: out.provider, model: out.model ?? null };
}

function saveReview(db, coach, { client, surface, text, r, mediaId = null, transcript = null }) {
  const id = newId('rv');
  db.prepare(`INSERT INTO ai_reviews (id, coach_id, client_id, surface, draft, verdict, summary, issues, rewrite, facts_used, provider, model, media_id, transcript, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, coach.id, client?.id ?? null, surface, text, r.verdict, r.summary, JSON.stringify(r.issues), r.rewrite,
    JSON.stringify(r.factsUsed), r.provider, r.model, mediaId, transcript, nowIso());
  return id;
}

const reviewOut = r => ({
  id: r.id, kind: r.kind, clientId: r.client_id, surface: r.surface, draft: r.draft, verdict: r.verdict, summary: r.summary, issues: parse(r.issues, []),
  rewrite: r.rewrite, factsUsed: parse(r.facts_used, []), provider: r.provider, model: r.model, decision: r.decision, messageId: r.message_id,
  mediaId: r.media_id, transcript: r.transcript, intent: r.intent, job: r.job, createdAt: r.created_at, decidedAt: r.decided_at,
});

/** A review this coach owns, whose client (if any) is still theirs. */
function ownReview(ctx, id) {
  requireCoach(ctx);
  const r = ownRow(ctx, 'ai_reviews', id);
  if (r.client_id) clientFor(ctx, r.client_id);
  return r;
}

// MARK: - Routes

async function review(_req, ctx) {
  requireCoach(ctx);
  const surface = oneOf(ctx.body.surface ?? 'message', 'surface', SURFACES);
  const text = str(ctx.body.text, 'text', { max: 4000 });
  const client = ctx.body.clientId ? clientFor(ctx, ctx.body.clientId) : null;
  if (!client && surface !== 'broadcast' && surface !== 'scheduled') fail(400, 'clientId is required');
  requireAi(ctx);
  rateLimit(ctx);
  const r = await runReview(ctx, { client, surface, text, audience: ctx.body.audience ?? null });
  const id = tx(ctx.db, () => saveReview(ctx.db, ctx.user, { client, surface, text, r }));
  return { id, verdict: r.verdict, summary: r.summary, issues: r.issues, rewrite: r.rewrite, factsUsed: r.factsUsed, provider: r.provider, model: r.model };
}

async function voiceReview(_req, ctx) {
  requireCoach(ctx);
  const { db, config, user: coach } = ctx;
  const client = clientFor(ctx, ctx.body.clientId);
  const mediaId = str(ctx.body.mediaId, 'mediaId', { max: 60 });
  const media = db.prepare("SELECT * FROM media WHERE id=? AND owner_id=? AND client_id=? AND kind='audio' AND purpose='voice'").get(mediaId, coach.id, client.id);
  if (!media) fail(404, 'Not found');
  if (db.prepare('SELECT 1 FROM messages WHERE media_id=?').get(media.id)) fail(400, 'That voice note has already been sent');
  requireAi(ctx, 'transcribe');
  rateLimit(ctx);
  const secs = media.duration_sec ?? 0;
  let heard;
  try {
    heard = await listen(db, config, {
      user: coach, clientId: client.id, purpose: 'review', audioPath: mediaFilePath(config, media), fmt: 'mov', durationSec: secs,
      system: `You transcribe a voice note from a personal trainer called ${first(coach.name)} to a client called ${first(client.name)}. Write exactly what was said. Return JSON only.`,
      prompt: 'Return {transcript}.', schema: { type: 'object', additionalProperties: false, required: ['transcript'], properties: { transcript: { type: 'string' } } },
      stub: () => ({ json: { transcript: `[Stub transcript] Your voice note to ${first(client.name)}, ${fmtVoiceLength(secs)} long. Transcription is off on this server.` } }),
    });
  } catch (e) { aiFail(e); }
  const transcript = clip(heard.json?.transcript, 20_000) || '(nothing heard)';
  const r = await runReview(ctx, { client, surface: 'message', text: transcript.slice(0, 4000) });
  // The transcript's own provider is what the voice queue copies (F19).
  const id = tx(db, () => saveReview(db, coach, { client, surface: 'message', text: transcript.slice(0, 4000), r: { ...r, provider: heard.provider, model: heard.model ?? r.model }, mediaId: media.id, transcript }));
  return { id, verdict: r.verdict, summary: r.summary, issues: r.issues, rewrite: r.rewrite, factsUsed: r.factsUsed, provider: r.provider, model: r.model, transcript };
}

/** A message the decision points at: in the same client's thread, or for a group review a coach-owned broadcast or scheduled send. */
function decisionMessage(ctx, r, messageId) {
  const id = str(messageId, 'messageId', { max: 60 });
  if (r.client_id) {
    const client = clientFor(ctx, r.client_id);
    if (!ctx.db.prepare('SELECT 1 FROM messages WHERE id=? AND client_id=?').get(id, client.id)) fail(404, 'Not found');
    return id;
  }
  for (const t of ['broadcasts', 'scheduled_messages']) {
    if (!ctx.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)) continue;
    if (ctx.db.prepare(`SELECT 1 FROM ${t} WHERE id=? AND coach_id=?`).get(id, ctx.user.id)) return id;
  }
  fail(404, 'Not found');
}

function decide(_req, ctx) {
  const r = ownReview(ctx, ctx.params.id);
  const decision = oneOf(ctx.body.decision, 'decision', DECISIONS);
  if ((decision === 'approved' || decision === 'rejected') && r.decision !== 'pendingApproval' && r.kind === 'review') fail(400, 'Only a draft awaiting approval can be approved');
  const messageId = ctx.body.messageId ? decisionMessage(ctx, r, ctx.body.messageId) : null;
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE ai_reviews SET decision=?, message_id=COALESCE(?, message_id), decided_at=? WHERE id=?').run(decision, messageId, nowIso(), r.id);
    emit(ctx.db, 'ai.reviewed', { coachId: ctx.user.id, clientId: r.client_id, summary: `AI check: ${r.verdict}, ${decision}`, reviewId: r.id, verdict: r.verdict, decision });
    if (decision === 'overridden') emit(ctx.db, 'ai.overridden', { coachId: ctx.user.id, clientId: r.client_id, summary: 'Sent despite an AI stop', reviewId: r.id, verdict: r.verdict });
  });
  return { ok: true };
}

function approvals(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  const surface = oneOf(ctx.body.surface ?? 'message', 'surface', SURFACES);
  const text = str(ctx.body.text, 'text', { max: 4000 });
  const id = newId('rv');
  ctx.db.prepare(`INSERT INTO ai_reviews (id, coach_id, client_id, surface, kind, draft, verdict, summary, issues, facts_used, provider, decision, created_at)
    VALUES (?,?,?,?, 'approval', ?, 'ok', 'Waiting for approval', '[]', '[]', 'none', 'pendingApproval', ?)`).run(id, ctx.user.id, client.id, surface, text, nowIso());
  return { id };
}

function listReviews(_req, ctx) {
  requireCoach(ctx);
  const where = ['r.coach_id=?', '(r.client_id IS NULL OR u.coach_id=?)'], args = [ctx.user.id, ctx.user.id];
  if (ctx.query.clientId) { where.push('r.client_id=?'); args.push(clientFor(ctx, ctx.query.clientId).id); }
  if (ctx.query.before) { where.push('r.created_at<?'); args.push(instant(ctx.query.before, 'before')); }
  if (ctx.query.decision) { where.push('r.decision=?'); args.push(oneOf(ctx.query.decision, 'decision', ['pending', 'pendingApproval', ...DECISIONS])); }
  if (ctx.query.kind) { where.push('r.kind=?'); args.push(oneOf(ctx.query.kind, 'kind', ['review', 'draft', 'approval'])); }
  const rows = ctx.db.prepare(`SELECT r.*, u.name client_name FROM ai_reviews r LEFT JOIN users u ON u.id=r.client_id WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT 50`).all(...args);
  return { reviews: rows.map(r => ({ ...reviewOut(r), client: r.client_id ? { id: r.client_id, name: r.client_name, initials: initials(r.client_name ?? '?') } : null })) };
}

function getReview(_req, ctx) {
  return { review: reviewOut(ownReview(ctx, ctx.params.id)) };
}

// MARK: - Drafting assist

function stubDraft(intent, client, facts, note) {
  const name = first(client.name);
  const lastClient = [...(facts.thread ?? [])].reverse().find(m => m.from === 'client');
  const next = facts.nextSession ? `your ${facts.nextSession.kind === 'video' ? 'video call' : 'session'} on ${facts.nextSession.day}` : 'our next session';
  const lines = {
    reply: lastClient ? `[Stub] Thanks ${name}, good to hear from you. On "${clip(lastClient.text, 60)}": let's talk it through properly. What would help most this week?`
      : `[Stub] Hi ${name}, checking in. How has the week gone so far?`,
    nudge: `[Stub] Hi ${name}, haven't heard from you for a few days. No pressure: what's one session you can get done before the weekend?`,
    celebrate: `[Stub] ${name}, that's a real win${facts.goal ? ` on the way to "${facts.goal}"` : ''}. Proud of the work. What made it click?`,
    reschedule: `[Stub] Hi ${name}, can we move ${next}? Send me two times that suit and I'll lock one in.`,
    free: `[Stub] Hi ${name}, ${note ? note.replace(/\s+$/, '') : 'a quick note from me'}. Let me know what you think?`,
  };
  return lines[intent];
}

async function draftText(db, config, coach, client, intent, note) {
  const { facts } = reviewContext(db, coach, client);
  const safeNote = note ? redactForAi(note, { surname: surnameOf(client.name) }) : null;
  const out = await complete(db, config, {
    user: coach, clientId: client.id, purpose: 'draft', maxTokens: 500, temperature: 0.5,
    system: `You draft short messages for a personal trainer called ${first(coach.name)} to a client. Warm, direct, British English, no shaming, `
      + 'no medical advice, one clear ask, at most 80 words, no emoji. The trainer reviews and sends it; you never send anything. Return JSON only.',
    prompt: `Client facts (JSON):\n${JSON.stringify(facts)}\n\nWrite: ${INTENTS[intent]}.${safeNote ? `\nThe trainer's note: ${safeNote}` : ''}\nReturn {text}.`,
    schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } },
    stub: () => ({ json: { text: stubDraft(intent, client, facts, safeNote) } }),
  });
  return { text: clip(out.json?.text, 4000), provider: out.provider, model: out.model ?? null };
}

async function draft(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  const intent = oneOf(ctx.body.intent ?? 'reply', 'intent', Object.keys(INTENTS));
  const note = ctx.body.note ? str(ctx.body.note, 'note', { max: 500 }) : null;
  requireAi(ctx, 'drafts');
  rateLimit(ctx);
  try { return await draftText(ctx.db, ctx.config, ctx.user, client, intent, note); } catch (e) { return aiFail(e); }
}

/** The `ai.draft` action's queue: one draft at a time, never sent (an Inbox item "Draft ready for Sam"). */
export async function draftNext(db, config) {
  const row = db.prepare("SELECT * FROM ai_reviews WHERE kind='draft' AND job='queued' ORDER BY created_at LIMIT 1").get();
  if (!row) return { drafted: 0 };
  if (!db.prepare("UPDATE ai_reviews SET job='working' WHERE id=? AND job='queued'").run(row.id).changes) return { drafted: 0 };
  const coach = db.prepare("SELECT * FROM users WHERE id=? AND role='coach'").get(row.coach_id);
  const client = coach && db.prepare("SELECT * FROM users WHERE id=? AND role='client' AND coach_id=?").get(row.client_id, coach.id);
  if (!client) { db.prepare('DELETE FROM ai_reviews WHERE id=?').run(row.id); return { drafted: 0 }; }
  let out = null, error = null;
  try {
    if (!aiSettings(db, coach.id).drafts || aiInfo(db, config, coach).provider === 'off') throw new Error('AI drafts are off');
    out = await draftText(db, config, coach, client, row.intent ?? 'nudge', row.draft || null);
  } catch (e) { error = e; }
  return tx(db, () => {
    if (!db.prepare('SELECT 1 FROM ai_reviews WHERE id=?').get(row.id)) return { drafted: 0 };
    if (error) {
      db.prepare("UPDATE ai_reviews SET job='failed', summary=? WHERE id=?").run(clip(`Could not draft: ${error.message}`, 200), row.id);
      return { drafted: 0, error: error.message };
    }
    db.prepare("UPDATE ai_reviews SET job='done', rewrite=?, provider=?, model=?, summary=? WHERE id=?").run(out.text, out.provider, out.model, `Draft ready for ${first(client.name)}`, row.id);
    emit(db, 'ai.drafted', { coachId: coach.id, clientId: client.id, summary: `AI draft ready for ${first(client.name)}`, reviewId: row.id });
    return { drafted: 1 };
  });
}

// MARK: - Client summary (Client 360 "Last 14 days in brief")

function stubSummary(db, client, days, now) {
  const from = londonToUtc(addDays(londonDay(now), -(days - 1))).toISOString();
  const fromDay = addDays(londonDay(now), -(days - 1));
  const workouts = db.prepare('SELECT COUNT(*) n FROM workouts WHERE client_id=? AND completed_at IS NOT NULL AND date>=?').get(client.id, fromDay).n;
  const sent = db.prepare("SELECT COUNT(*) n FROM messages WHERE client_id=? AND from_role='client' AND at>=?").get(client.id, from).n;
  const ci = db.prepare('SELECT * FROM checkins WHERE client_id=? AND submitted_at>=? ORDER BY submitted_at DESC LIMIT 1').get(client.id, from);
  const pain = ci ? parse(ci.pain, []) : [];
  return [
    `[Stub] ${workouts} workout${workouts === 1 ? '' : 's'} logged in the last ${days} days.`,
    `[Stub] ${sent} message${sent === 1 ? '' : 's'} from ${first(client.name)}.`,
    ci ? `[Stub] Last check-in: energy ${ci.energy}/5, sleep ${ci.sleep}/5${pain.length ? `, pain: ${pain.join(', ').toLowerCase()}` : ', no pain'}.` : '[Stub] No check-in in this window.',
  ];
}

async function summary(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.params.id);
  const days = ctx.body.days === undefined ? 14 : Math.max(1, Math.min(28, Math.round(Number(ctx.body.days) || 14)));
  requireAi(ctx);
  rateLimit(ctx);
  const now = new Date();
  const { facts } = reviewContext(ctx.db, ctx.user, client, now);
  let out;
  try {
    out = await complete(ctx.db, ctx.config, {
      user: ctx.user, clientId: client.id, purpose: 'summary', maxTokens: 400,
      system: `You brief a personal trainer called ${first(ctx.user.name)} on one client in at most 5 short bullets: training, wins, struggles, pain, what to do next. No medical advice. Return JSON only.`,
      prompt: `Client facts (JSON):\n${JSON.stringify(facts)}\n\nThe last ${days} days. Return {bullets: [string]}.`,
      schema: { type: 'object', additionalProperties: false, required: ['bullets'], properties: { bullets: { type: 'array', items: { type: 'string' } } } },
      stub: () => ({ json: { bullets: stubSummary(ctx.db, client, days, now) } }),
    });
  } catch (e) { aiFail(e); }
  const bullets = (Array.isArray(out.json?.bullets) ? out.json.bullets : []).map(b => clip(b, 240)).filter(Boolean).slice(0, 5);
  return { bullets, provider: out.provider, model: out.model ?? null, at: nowIso() };
}

// MARK: - The ai.draft action, hooks, retention

function draftAction(db, _config, actx) {
  const intent = Object.hasOwn(INTENTS, actx.params?.intent) ? actx.params.intent : 'nudge';
  const note = clip(actx.params?.note, 500);
  db.prepare(`INSERT INTO ai_reviews (id, coach_id, client_id, surface, kind, intent, job, draft, verdict, summary, issues, facts_used, provider, decision, created_at)
    VALUES (?,?,?, 'message', 'draft', ?, 'queued', ?, 'ok', 'Drafting…', '[]', '[]', 'none', 'pending', ?)`)
    .run(newId('rv'), actx.coachId, actx.client.id, intent, note, (actx.now ?? new Date()).toISOString());
  return 'Draft queued';
}

function inbox(db, coach) {
  return db.prepare(`SELECT r.*, u.name FROM ai_reviews r JOIN users u ON u.id=r.client_id AND u.coach_id=?
    WHERE r.coach_id=? AND ((r.decision='pendingApproval') OR (r.kind='draft' AND r.job='done' AND r.decision='pending')) ORDER BY r.created_at DESC LIMIT 50`)
    .all(coach.id, coach.id).map(r => ({
      key: `draft:${r.id}`, kind: 'draft', clientId: r.client_id,
      title: r.decision === 'pendingApproval' ? `Draft awaiting approval: ${first(r.name)}` : `Draft ready for ${first(r.name)}`,
      preview: clip(r.decision === 'pendingApproval' ? r.draft : r.rewrite, 200), at: r.created_at, icon: r.decision === 'pendingApproval' ? 'approval' : 'auto_awesome',
      tone: 'attention', path: `/messages/${r.client_id}?draft=${r.id}`,
      actions: [{ id: 'discard', label: 'Discard', method: 'POST', url: `/api/ai/review/${r.id}/decision`, body: { decision: 'rejected' } }],
    }));
}

function exportFor(db, user) {
  if (user.role === 'coach') return { reviews: db.prepare('SELECT COUNT(*) n FROM ai_reviews WHERE coach_id=?').get(user.id).n };
  return {
    reviews: db.prepare('SELECT * FROM ai_reviews WHERE client_id=? ORDER BY created_at').all(user.id).map(r => ({
      id: r.id, at: r.created_at, surface: r.surface, kind: r.kind, draft: r.draft, verdict: r.verdict, summary: r.summary, issues: parse(r.issues, []),
      rewrite: r.rewrite, transcript: r.transcript, decision: r.decision, provider: r.provider,
    })),
  };
}

export function pruneReviews(db, now = new Date()) {
  return db.prepare('DELETE FROM ai_reviews WHERE created_at<?').run(new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString()).changes;
}

// MARK: - Demo: review mode "ask", 8 past reviews, 2 drafts waiting in the Inbox

const DEMO_REVIEWS = [
  { who: 'Tom', ago: 26, verdict: 'stop', decision: 'usedRewrite', text: 'Sounds like you have a sprain. Take ibuprofen twice a day and push through the session.',
    summary: '[Stub] Stop and check: this reads as medical advice. Point them to a GP or physio instead.',
    issues: [{ kind: 'safety', severity: 'high', quote: 'ibuprofen', note: 'This reads as medical advice. Point them to a GP or physio instead.' }],
    rewrite: '[Stub] That sounds sore. Get it looked at by your GP or a physio before Friday, and we\'ll keep the session upper-body only until then. Can you book in this week?' },
  { who: 'Priya', ago: 22, verdict: 'ok', decision: 'sentOriginal', text: 'Forty-four twelve is massive. Easy day tomorrow, and shall we talk race pacing on Thursday?', summary: '[Stub] Clear, kind and safe to send.', issues: [], rewrite: null },
  { who: 'Leo', ago: 50, verdict: 'stop', decision: 'edited', text: 'Back to the full deadlift plan this week, same weights as before.',
    summary: '[Stub] Stop and check: they flagged lower back pain in the last two weeks and this doesn\'t mention it.',
    issues: [{ kind: 'safety', severity: 'high', quote: 'Back to the full deadlift plan this week', note: 'They flagged lower back pain in the last two weeks and this doesn\'t mention it.' }],
    rewrite: '[Stub] How is the lower back feeling? If it\'s still grumbling, we\'ll swap deadlifts for hip hinges with a dowel this week. Let me know?' },
  { who: 'Alex', ago: 70, verdict: 'caution', decision: 'usedRewrite', text: 'GREAT week!!!! Keep it up!!!!',
    summary: '[Stub] Worth a look: capitals can read as shouting; lots of exclamation marks; there is no question or clear ask.',
    issues: [{ kind: 'tone', severity: 'low', quote: 'GREAT', note: 'Capitals can read as shouting.' }, { kind: 'clarity', severity: 'low', quote: 'GREAT week!!!! Keep it up!!!!', note: 'There is no question or clear ask.' }],
    rewrite: '[Stub] Great week, Alex. Keep it up! Which session felt best?' },
  { who: 'Rory', ago: 96, verdict: 'ok', decision: 'sentOriginal', text: 'Calf feeling better after the intervals? If so we\'ll add the hill reps back on Saturday.', summary: '[Stub] Clear, kind and safe to send.', issues: [], rewrite: null },
  { who: 'Sam', ago: 120, verdict: 'caution', decision: 'dismissed', text: 'Squats up to 105 this week.',
    summary: '[Stub] Worth a look: there is no question or clear ask.', issues: [{ kind: 'clarity', severity: 'low', quote: 'Squats up to 105 this week.', note: 'There is no question or clear ask.' }],
    rewrite: '[Stub] Squats up to 105 this week. Let me know how the knee feels after the first set?' },
  { who: 'Tom', ago: 150, verdict: 'stop', decision: 'overridden', text: 'Push through it, a bit of pain is normal when you start.',
    summary: '[Stub] Stop and check: telling someone to train through pain can make an injury worse.',
    issues: [{ kind: 'safety', severity: 'high', quote: 'Push through it', note: 'Telling someone to train through pain can make an injury worse.' }],
    rewrite: '[Stub] Some soreness is normal when you start, but sharp pain isn\'t. Where do you feel it, and how bad is it out of 10?' },
  { who: 'Priya', ago: 200, verdict: 'ok', decision: 'sentOriginal', text: 'Two runs this week is fine. Keep the second one easy and short. Does Wednesday work?', summary: '[Stub] Clear, kind and safe to send.', issues: [], rewrite: null },
];
const DEMO_DRAFTS = [
  { who: 'Leo', ago: 3, intent: 'nudge', text: '[Stub] Hi Leo, haven\'t heard from you for a few days. No pressure: what\'s one session you can get done before the weekend?' },
  { who: 'Alex', ago: 1, intent: 'celebrate', text: '[Stub] Alex, four sessions in a mad work week is a real win. Proud of the work. What made it click?' },
];

function buildDemo(db, ctx) {
  const { coach, byName, today } = ctx;
  const nowMs = londonToUtc(today, '12:00').getTime();
  const at = h => new Date(nowMs - h * 3_600_000).toISOString();
  // Own table, wiped here (see voice.mjs: the foundation wipe can run before feature schemas).
  reviewSchema(db);
  db.prepare('DELETE FROM ai_reviews WHERE coach_id=?').run(coach.id);
  db.prepare(`INSERT INTO ai_settings (coach_id, enabled, review_mode, transcribe, analyse, drafts, updated_at) VALUES (?, 1, 'ask', 1, 1, 1, ?)
    ON CONFLICT(coach_id) DO UPDATE SET review_mode='ask', updated_at=excluded.updated_at`).run(coach.id, at(24 * 30));
  for (const r of DEMO_REVIEWS) {
    const client = byName[r.who];
    if (!client) continue;
    db.prepare(`INSERT INTO ai_reviews (id, coach_id, client_id, surface, draft, verdict, summary, issues, rewrite, facts_used, provider, decision, created_at, decided_at)
      VALUES (?,?,?, 'message', ?,?,?,?,?,?, 'stub', ?,?,?)`).run(newId('rv'), coach.id, client.id, r.text, r.verdict, r.summary, JSON.stringify(r.issues), r.rewrite,
      JSON.stringify([`First name (${r.who})`, 'Pain flags and notes from the last 4 check-ins', 'Last 8 messages in the thread']), r.decision, at(r.ago), at(r.ago - 0.05));
  }
  for (const d of DEMO_DRAFTS) {
    const client = byName[d.who];
    if (!client) continue;
    db.prepare(`INSERT INTO ai_reviews (id, coach_id, client_id, surface, kind, intent, job, draft, verdict, summary, issues, rewrite, facts_used, provider, decision, created_at)
      VALUES (?,?,?, 'message', 'draft', ?, 'done', '', 'ok', ?, '[]', ?, '[]', 'stub', 'pending', ?)`).run(newId('rv'), coach.id, client.id, d.intent, `Draft ready for ${d.who}`, d.text, at(d.ago));
  }
}

/** Idempotent DDL. The demo builder runs it too: a store can be built before createApp runs the feature schemas. */
function reviewSchema(db) {
  db.exec(`
      CREATE TABLE IF NOT EXISTS ai_reviews (
        id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        surface TEXT NOT NULL,                  -- message|letter|broadcast|scheduled
        kind TEXT NOT NULL DEFAULT 'review' CHECK (kind IN ('review','draft','approval')),
        intent TEXT, job TEXT CHECK (job IS NULL OR job IN ('queued','working','done','failed')),
        draft TEXT NOT NULL, verdict TEXT NOT NULL CHECK (verdict IN ('ok','caution','stop')),
        summary TEXT NOT NULL, issues TEXT NOT NULL, rewrite TEXT, facts_used TEXT NOT NULL,
        provider TEXT NOT NULL, model TEXT,
        decision TEXT NOT NULL DEFAULT 'pending'
          CHECK (decision IN ('pending','sentOriginal','usedRewrite','edited','dismissed','overridden','pendingApproval','approved','rejected')),
        message_id TEXT, media_id TEXT, transcript TEXT,
        created_at TEXT NOT NULL, decided_at TEXT);
      CREATE INDEX IF NOT EXISTS ai_reviews_coach ON ai_reviews(coach_id, created_at);
      CREATE INDEX IF NOT EXISTS ai_reviews_client ON ai_reviews(client_id);
      CREATE INDEX IF NOT EXISTS ai_reviews_media ON ai_reviews(media_id) WHERE media_id IS NOT NULL;`);
}

export const feature = {
  name: 'aireview',
  namespaces: ['ai'],
  exact: [],
  schema: reviewSchema,
  routes(r) {
    r.add('POST', '/api/ai/review', review);
    r.add('POST', '/api/ai/review/voice', voiceReview);
    r.add('POST', '/api/ai/review/:id/decision', decide);
    r.add('POST', '/api/ai/approvals', approvals);
    r.add('GET', '/api/ai/reviews', listReviews);
    r.add('GET', '/api/ai/reviews/:id', getReview);
    r.add('POST', '/api/ai/draft', draft);
    r.add('POST', '/api/coach/clients/:id/ai-summary', summary);
  },
  clocks: [
    { id: 'ai.drafts', everyMs: 30_000, run: (db, config) => draftNext(db, config) },
    { id: 'ai.prune', everyMs: 24 * 3_600_000, run: (db, _config, now) => pruneReviews(db, now) },
  ],
  emits: {
    'ai.reviewed': { label: 'The coach decided on an AI check', payload: ['reviewId', 'verdict', 'decision'], aiDerived: true },
    'ai.overridden': { label: 'The coach sent a message despite an AI stop', payload: ['reviewId', 'verdict'], aiDerived: true },
    'ai.drafted': { label: 'An AI draft is ready in the Inbox', payload: ['reviewId'], aiDerived: true },
  },
  actions: {
    'ai.draft': {
      label: 'Draft a message for me to check (AI)', clientFacing: false,
      params: [
        { key: 'intent', label: 'Kind of message', type: 'enum', options: Object.entries(INTENTS).map(([value, label]) => ({ value, label })), default: 'nudge' },
        { key: 'note', label: 'Note for the draft', type: 'text' },
      ],
      run: draftAction,
    },
  },
  inbox, exportFor,
  demo: { build: buildDemo },
};
