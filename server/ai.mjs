import { readFileSync, rmSync } from 'node:fs';
import { requireCoach } from './access.mjs';
import { ffmpegAvailable, toModelMp3 } from './audio.mjs';
import { fail, oneOf } from './http.mjs';
import { newId, nowIso } from './store.mjs';
import { addDays, londonDay, londonToUtc } from './time.mjs';

/**
 * The AI module (docs/design/desk-v2.md 3.13 and 6.3). OpenRouter over HTTPS
 * when a key and model are set; otherwise a deterministic stub that every
 * feature writes for itself and that never touches the network. The AI never
 * sends anything: it reviews, drafts, transcribes and summarises.
 *
 * - ai_calls keeps metadata only (no prompts, no outputs).
 * - Every request asks for providers that do not collect data
 *   (provider.data_collection 'deny') and zero data retention (provider.zdr),
 *   and require_parameters whenever a JSON schema is set. If no provider
 *   meets that, the call fails visibly (AiError 'provider'): the settings are
 *   never relaxed and there is no silent fallback to the stub.
 * - Text and audio have separate daily budgets per coach; voice also per client.
 * - At most 2 text calls and 1 audio call at once, process-wide.
 */

export const AI_DEFAULTS = {
  key: null, model: null, audioModel: null, dailyCalls: 300, dailyAudioSeconds: 7200,
  clientDailyNotes: 20, clientDailyAudioSeconds: 1800, disabled: false, baseUrl: 'https://openrouter.ai/api/v1',
};
const TEXT_TIMEOUT_MS = 45_000;
const AUDIO_TIMEOUT_MS = 120_000;
export const AUDIO_PURPOSES = ['transcribe', 'analyse'];

const aiConfig = config => ({ ...AI_DEFAULTS, ...(config.ai ?? {}) });

const MESSAGES = {
  quota: [429, 'AI limit reached for today'],
  timeout: [504, 'AI unavailable: it took too long to answer'],
  provider: [503, 'AI unavailable: no provider meets the privacy settings'],
  invalid: [502, 'AI unavailable: the answer was not in the expected shape'],
  upstream: [502, 'AI unavailable: the AI service returned an error'],
  off: [409, 'AI is turned off'],
};

/** A typed AI failure: quota, timeout, provider, invalid, upstream or off. `status` suits an HTTP answer. */
export class AiError extends Error {
  constructor(kind, detail = null) {
    const [status, message] = MESSAGES[kind] ?? MESSAGES.upstream;
    super(message);
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

// MARK: - Settings and status

export function aiSettings(db, coachId) {
  const r = db.prepare('SELECT * FROM ai_settings WHERE coach_id=?').get(coachId);
  return {
    enabled: r ? !!r.enabled : true, reviewMode: r?.review_mode ?? 'ask',
    transcribe: r ? !!r.transcribe : true, analyse: r ? !!r.analyse : true, drafts: r ? !!r.drafts : true,
  };
}

/**
 * Which provider answers for this coach. `user` is ALWAYS the coach row (a
 * clock loads the client's coach and passes that); a demo coach always gets the
 * stub. Returns {provider: 'stub'|'openrouter'|'off', model, audio, reason}.
 */
export function aiInfo(db, config, user) {
  if (!user || user.role !== 'coach') throw new Error('aiInfo needs the coach row');
  const ai = aiConfig(config);
  const settings = aiSettings(db, user.id);
  if (!settings.enabled) return { provider: 'off', model: null, audio: false, reason: 'Turned off in Settings › AI' };
  let reason = null;
  if (!ai.key) reason = 'No AI key on this server';
  else if (!ai.model) reason = 'No AI model chosen on this server';
  else if (ai.disabled) reason = 'AI is disabled on this server';
  else if (user.is_demo) reason = 'Demo accounts always use the stub';
  if (reason) return { provider: 'stub', model: null, audio: false, reason };
  const audio = !!ai.audioModel && ffmpegAvailable(config);
  return { provider: 'openrouter', model: ai.model, audio, reason: audio ? null : 'No audio model or ffmpeg: voice notes are not transcribed' };
}

const dayBounds = now => {
  const d = londonDay(now);
  return [londonToUtc(d).toISOString(), londonToUtc(addDays(d, 1)).toISOString()];
};

/** What a coach has used today (OpenRouter calls only; the stub is free). */
export function usedToday(db, coachId, now = new Date()) {
  const [from, to] = dayBounds(now);
  const r = db.prepare(`SELECT SUM(audio_seconds IS NULL) calls, COALESCE(SUM(audio_seconds), 0) secs FROM ai_calls
    WHERE coach_id=? AND provider='openrouter' AND at>=? AND at<?`).get(coachId, from, to);
  return { calls: r.calls ?? 0, audioSeconds: Math.round(r.secs ?? 0) };
}

/** A client's voice notes and seconds sent to the model today. */
export function clientAudioToday(db, clientId, now = new Date()) {
  const [from, to] = dayBounds(now);
  const r = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(audio_seconds), 0) secs FROM ai_calls
    WHERE client_id=? AND provider='openrouter' AND audio_seconds IS NOT NULL AND at>=? AND at<?`).get(clientId, from, to);
  return { notes: r.n, seconds: r.secs };
}

/**
 * Would a call fit today's budgets? `audioSeconds` null means a text call.
 * Voice uses this before queueing a note, so an over-budget note becomes
 * status off / quota instead of failing (F19).
 */
export function withinBudget(db, config, { coachId, clientId = null, audioSeconds = null, now = new Date() }) {
  const ai = aiConfig(config);
  const used = usedToday(db, coachId, now);
  if (audioSeconds === null) return used.calls < ai.dailyCalls;
  if (used.audioSeconds + audioSeconds > ai.dailyAudioSeconds) return false;
  if (clientId) {
    const c = clientAudioToday(db, clientId, now);
    if (c.notes + 1 > ai.clientDailyNotes || c.seconds + audioSeconds > ai.clientDailyAudioSeconds) return false;
  }
  return true;
}

function record(db, { coachId, clientId, purpose, provider, model, ok, error = null, usage = null, audioSeconds = null, ms }) {
  db.prepare(`INSERT INTO ai_calls (id, coach_id, client_id, purpose, provider, model, ok, error, input_tokens, output_tokens, audio_seconds, ms, at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(newId('ai'), coachId, clientId, String(purpose).slice(0, 40), provider, model, ok ? 1 : 0,
    error ? String(error).slice(0, 300) : null, usage?.prompt_tokens ?? null, usage?.completion_tokens ?? null, audioSeconds, ms, nowIso());
}

// MARK: - Redaction

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:(?:\+|\b00)\d{1,3}[\s.-]?(?:\(0\))?[\s.-]?\d[\d\s().-]{6,}\d|\b0\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b)/g;
const POSTCODE_RE = /\b(?:GIR ?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]? ?\d[ABD-HJLNP-UW-Z]{2})\b/gi;

/**
 * Applied to ALL text built from client data before complete() or listen():
 * e-mail addresses, phone numbers, URLs, UK postcodes and the client's surname
 * (case-insensitive, whole words) become placeholders.
 */
export function redactForAi(text, { surname = null } = {}) {
  let out = String(text ?? '')
    .replace(URL_RE, '[link]')
    .replace(EMAIL_RE, '[email]')
    .replace(PHONE_RE, '[phone]')
    .replace(POSTCODE_RE, '[postcode]');
  const s = String(surname ?? '').trim();
  if (s.length >= 2) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu'), '[surname]');
  return out;
}

/** "Sam Carter" → "Carter" (the part redactForAi removes); null for one-word names. */
export const surnameOf = name => { const parts = String(name ?? '').trim().split(/\s+/); return parts.length > 1 ? parts.slice(1).join(' ') : null; };

// MARK: - Concurrency

function semaphore(max) {
  let active = 0;
  const queue = [];
  const release = () => { active--; queue.shift()?.(); };
  return async () => {
    if (active >= max) await new Promise(r => queue.push(r));
    active++;
    return release;
  };
}
const textSlot = semaphore(2);
const audioSlot = semaphore(1);

// MARK: - Calling

/** Strip code fences, take the first {...}, parse; null when there is none. */
export function parseJsonLoose(text) {
  const t = String(text ?? '').replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

const missingKeys = (json, schema) => (schema?.required ?? []).filter(k => !json || !(k in json));
const PRIVACY = /data policy|privacy|zero data retention|\bzdr\b|data.collection|allowed providers|no allowed/i;
const PARAMS = /response_format|json_schema|structured|parameter/i;

async function openRouter(config, { model, system, content, schema, purpose, maxTokens, temperature, timeoutMs, downgraded = false }) {
  const ai = aiConfig(config);
  const body = {
    model, max_tokens: maxTokens, temperature,
    messages: [{ role: 'system', content: system }, { role: 'user', content }],
    provider: { data_collection: 'deny', zdr: true, ...(schema ? { require_parameters: true } : {}) },
  };
  if (schema && !downgraded) body.response_format = { type: 'json_schema', json_schema: { name: String(purpose).replace(/[^a-zA-Z0-9_-]/g, '_'), strict: true, schema } };
  if (schema && downgraded) body.response_format = { type: 'json_object' };
  let res;
  try {
    res = await config.fetchImpl(`${ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ai.key}`, 'content-type': 'application/json',
        'http-referer': config.publicUrl ?? 'https://jk.strangeramblings.com', 'x-title': 'JK Performance',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new AiError('timeout');
    throw new AiError('upstream', e?.message);
  }
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j?.error?.message ?? JSON.stringify(j); } catch { /* no body */ }
    return { error: { status: res.status, detail: String(detail).slice(0, 300) } };
  }
  let j;
  try { j = await res.json(); } catch { throw new AiError('invalid', 'not JSON'); }
  const msg = j?.choices?.[0]?.message?.content;
  const text = Array.isArray(msg) ? msg.map(p => p?.text ?? '').join('') : String(msg ?? '');
  return { text, usage: j?.usage ?? null, model: j?.model ?? model };
}

async function call(db, config, { user, clientId, purpose, system, prompt, schema, maxTokens, temperature, stub, audioPath = null, audioFormat = null, durationSec = null }) {
  if (typeof stub !== 'function') throw new Error('complete() and listen() need a stub function');
  const info = aiInfo(db, config, user);
  const isAudio = audioPath !== null || durationSec !== null;
  const started = Date.now();
  const base = { coachId: user.id, clientId: clientId ?? null, purpose };
  if (info.provider === 'off') throw new AiError('off');
  if (info.provider === 'stub') {
    const r = (await stub({ purpose, system, prompt, schema, durationSec })) ?? {};
    const json = r.json ?? (schema && r.text ? parseJsonLoose(r.text) : null);
    const ms = Date.now() - started;
    record(db, { ...base, provider: 'stub', model: null, ok: true, audioSeconds: isAudio ? durationSec ?? 0 : null, ms });
    return { text: r.text ?? (json ? JSON.stringify(json) : ''), json, provider: 'stub', model: null, usage: null, ms };
  }
  const ai = aiConfig(config);
  const model = isAudio ? ai.audioModel : ai.model;
  if (isAudio && !info.audio) throw new AiError('upstream', 'no audio model or ffmpeg');
  if (!withinBudget(db, config, { coachId: user.id, clientId: isAudio ? clientId : null, audioSeconds: isAudio ? durationSec ?? 0 : null })) {
    record(db, { ...base, provider: 'openrouter', model, ok: false, error: 'quota', audioSeconds: null, ms: 0 });
    throw new AiError('quota');
  }
  const release = await (isAudio ? audioSlot() : textSlot());
  let note = null;
  try {
    const content = [{ type: 'text', text: schema ? `${prompt}\n\nReply with JSON only.` : prompt }];
    if (isAudio) content.push({ type: 'input_audio', input_audio: { data: readFileSync(audioPath).toString('base64'), format: audioFormat ?? 'mp3' } });
    const opts = { model, system, content, schema, purpose, maxTokens, temperature, timeoutMs: isAudio ? AUDIO_TIMEOUT_MS : TEXT_TIMEOUT_MS };
    let out = await openRouter(config, opts);
    if (out.error && schema && [400, 404].includes(out.error.status) && !PRIVACY.test(out.error.detail) && (out.error.status === 400 || PARAMS.test(out.error.detail))) {
      note = 'downgraded:json_object';
      const withSchema = [{ type: 'text', text: `${prompt}\n\nReply with JSON only, matching this JSON Schema:\n${JSON.stringify(schema)}` }, ...content.slice(1)];
      out = await openRouter(config, { ...opts, content: withSchema, downgraded: true });
    }
    if (out.error) {
      if ([400, 404].includes(out.error.status) && (PRIVACY.test(out.error.detail) || /no endpoints/i.test(out.error.detail))) throw new AiError('provider', out.error.detail);
      throw new AiError('upstream', `${out.error.status} ${out.error.detail}`);
    }
    let json = null;
    if (schema) {
      json = parseJsonLoose(out.text);
      if (!json || missingKeys(json, schema).length) throw new AiError('invalid', json ? `missing ${missingKeys(json, schema).join(', ')}` : 'no JSON');
    }
    const ms = Date.now() - started;
    record(db, { ...base, provider: 'openrouter', model: out.model, ok: true, error: note, usage: out.usage, audioSeconds: isAudio ? durationSec ?? 0 : null, ms });
    return { text: out.text, json, provider: 'openrouter', model: out.model, usage: out.usage, ms };
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError('upstream', e?.message);
    record(db, { ...base, provider: 'openrouter', model, ok: false, error: [note, `${err.kind}${err.detail ? `: ${err.detail}` : ''}`].filter(Boolean).join('; '),
      audioSeconds: isAudio ? durationSec ?? 0 : null, ms: Date.now() - started });
    throw err;
  } finally {
    release();
  }
}

/**
 * A text call. `stub(input)` is required and answers whenever the provider is
 * the stub. With `schema`, the reply is JSON validated against its required
 * keys (`json`). Resolves {text, json, provider, model, usage, ms}; throws AiError.
 */
export function complete(db, config, { user, clientId = null, purpose, system, prompt, schema = null, maxTokens = 900, temperature = 0.2, stub }) {
  return call(db, config, { user, clientId, purpose, system, prompt, schema, maxTokens, temperature, stub });
}

/**
 * An audio call: converts `audioPath` (any container ffmpeg reads; `fmt` as
 * sniffed, default 'mov' for stored m4a) to a 16 kHz mono mp3, sends it as
 * input_audio, deletes the temp file. `durationSec` must be the PROBED
 * duration; it is what the budgets charge.
 */
export async function listen(db, config, { user, clientId = null, purpose, audioPath, fmt = 'mov', durationSec, system, prompt, schema = null, maxTokens = 1200, temperature = 0.2, stub }) {
  if (typeof durationSec !== 'number' || !(durationSec >= 0)) throw new Error('listen() needs the probed durationSec');
  const info = aiInfo(db, config, user);
  if (info.provider !== 'openrouter') return call(db, config, { user, clientId, purpose, system, prompt, schema, maxTokens, temperature, stub, durationSec });
  let mp3 = null;
  try {
    mp3 = await toModelMp3(config, audioPath, { fmt });
    return await call(db, config, { user, clientId, purpose, system, prompt, schema, maxTokens, temperature, stub, audioPath: mp3, audioFormat: 'mp3', durationSec });
  } finally {
    if (mp3) rmSync(mp3, { force: true });
  }
}

// MARK: - Routes

function status(_req, ctx) {
  requireCoach(ctx);
  const info = aiInfo(ctx.db, ctx.config, ctx.user);
  const s = aiSettings(ctx.db, ctx.user.id);
  const ai = aiConfig(ctx.config);
  return {
    provider: info.provider, model: info.model, audio: info.audio, reason: info.reason,
    reviewMode: s.reviewMode, enabled: s.enabled, transcribe: s.transcribe, analyse: s.analyse, drafts: s.drafts,
    usedToday: usedToday(ctx.db, ctx.user.id),
    limits: { dailyCalls: ai.dailyCalls, dailyAudioSeconds: ai.dailyAudioSeconds, clientDailyNotes: ai.clientDailyNotes, clientDailyAudioSeconds: ai.clientDailyAudioSeconds },
  };
}

function putSettings(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const cur = aiSettings(ctx.db, ctx.user.id);
  for (const k of ['enabled', 'transcribe', 'analyse', 'drafts']) if (b[k] !== undefined && typeof b[k] !== 'boolean') fail(400, `${k} must be true or false`);
  const next = {
    enabled: b.enabled ?? cur.enabled, transcribe: b.transcribe ?? cur.transcribe, analyse: b.analyse ?? cur.analyse, drafts: b.drafts ?? cur.drafts,
    reviewMode: b.reviewMode === undefined ? cur.reviewMode : oneOf(b.reviewMode, 'reviewMode', ['off', 'ask', 'always']),
  };
  ctx.db.prepare(`INSERT INTO ai_settings (coach_id, enabled, review_mode, transcribe, analyse, drafts, updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(coach_id) DO UPDATE SET enabled=excluded.enabled, review_mode=excluded.review_mode, transcribe=excluded.transcribe,
      analyse=excluded.analyse, drafts=excluded.drafts, updated_at=excluded.updated_at`)
    .run(ctx.user.id, next.enabled ? 1 : 0, next.reviewMode, next.transcribe ? 1 : 0, next.analyse ? 1 : 0, next.drafts ? 1 : 0, nowIso());
  return next;
}

export function aiRoutes(r) {
  r.add('GET', '/api/ai/status', status);
  r.add('PUT', '/api/ai/settings', putSettings);
}
