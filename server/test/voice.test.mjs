import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertNoRowsFor, makeWorld } from './helpers.mjs';
import { ffmpegAvailable } from '../audio.mjs';
import { allEvents, allFacts, FEATURES } from '../registry.mjs';
import { resetLimits } from '../ratelimit.mjs';

// F19 (docs/design/desk-v2.md): consent, the transcription queue, the coach-only analysis, refresh cursors,
// flags, reassignment, erasure mid-call, retention and the OpenRouter audio request.

const M4A = readFileSync(fileURLToPath(new URL('../fixtures/voice-demo.m4a', import.meta.url)));
const HAS_FFMPEG = ffmpegAvailable({ ffmpegPath: 'ffmpeg' });
const OPENROUTER = { key: 'test-key', model: 'test/text-model', audioModel: 'test/audio-model', dailyCalls: 300, dailyAudioSeconds: 7200,
  clientDailyNotes: 20, clientDailyAudioSeconds: 1800, disabled: false, baseUrl: 'https://openrouter.ai/api/v1' };
const ANALYSIS = {
  transcript: 'My left knee has been sore since Saturday. Can we swap the lunges?', language: 'en',
  summary: 'SENTINEL-SUMMARY knee sore since Saturday', mood: 'low', sentiment: -0.4, topics: ['sentinel-topic'],
  actions: [{ text: 'Swap the lunges', owner: 'coach' }], flags: [{ kind: 'pain', quote: 'my left knee has been sore', severity: 'medium' }],
};
const reply = json => ({ ok: true, status: 200, json: async () => ({ model: 'test/audio-model', choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(json)}\n\`\`\`` } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }) });
const ANALYSIS_KEYS = ['summary', 'mood', 'sentiment', 'topics', 'actions', 'flags'];

async function sendVoice(w, as, { clientId, text } = {}) {
  const q = clientId ? `&clientId=${clientId}` : '';
  const up = await w.ok('POST', `/api/media?purpose=voice&durationSec=3${q}`, { as, raw: M4A, headers: { 'content-type': 'audio/mp4' } });
  const m = await w.ok('POST', '/api/messages', { as, body: { kind: 'voice', mediaId: up.id, ...(clientId ? { clientId } : {}), ...(text ? { text } : {}) } });
  await w.settle();
  return { media: up, message: m };
}
/** Run the queue until it is empty (other tests may have left notes pending). */
async function drain(w, now = new Date()) {
  for (let i = 0; i < 20; i++) if (!(await w.tick('voice.transcribe', now))?.processed) return;
}
const row = (w, id) => w.db.prepare('SELECT * FROM voice_analyses WHERE message_id=?').get(id);
/** Every `voice` object in a JSON value. */
function voiceBlocks(v, out = []) {
  if (Array.isArray(v)) v.forEach(x => voiceBlocks(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'voice' && x && typeof x === 'object') out.push(x); voiceBlocks(x, out); }
  return out;
}

test('voice.* events and facts are AI-derived', () => {
  assert.ok(FEATURES.some(f => f.name === 'voice'));
  const ev = allEvents().filter(e => e.type.startsWith('voice.'));
  assert.ok(ev.length >= 2);
  for (const e of ev) assert.equal(e.aiDerived, true, e.type);
  assert.equal(allFacts().find(f => f.id === 'voice.sentiment14').aiDerived, true);
  for (const e of allEvents().filter(x => x.type.startsWith('ai.'))) assert.equal(e.aiDerived, true, e.type);
});

describe('voice with the stub', () => {
  let w;
  before(async () => {
    w = await makeWorld();
    resetLimits();
    // An Elite client, so the JK tab (/api/timeline) carries messages.
    w.db.prepare("UPDATE users SET plan='elite' WHERE id=?").run(w.client.id);
  });
  after(() => w.close());

  test('without consent nothing is transcribed (off/noConsent); with it the stub transcribes, bumps updated_at and both cursors see it', async () => {
    assert.equal((await w.ok('GET', '/api/me', { as: w.client })).features.voiceTranscription, 'ask');
    const first = await sendVoice(w, w.client);
    assert.equal(row(w, first.message.id).status, 'off');
    assert.equal(row(w, first.message.id).reason, 'noConsent');
    assert.deepEqual(await w.ok('PUT', '/api/voice/consent', { as: w.client, body: { voice: 'on' } }), { voice: 'on' });
    assert.equal((await w.ok('GET', `/api/coach/clients/${w.client.id}/ai-consent`, { as: w.coach })).voice, 'on');
    assert.equal((await w.ok('GET', '/api/me', { as: w.client })).features.voiceTranscription, 'on');
    const before = await w.ok('GET', `/api/messages?clientId=${w.client.id}`, { as: w.coach });
    const tl0 = await w.ok('GET', '/api/timeline?since=2000-01-01T00:00:00.000Z', { as: w.client });
    const { message } = await sendVoice(w, w.client);
    assert.equal(row(w, message.id).status, 'pending');
    await new Promise(r => setTimeout(r, 5));
    const out = await w.tick('voice.transcribe', new Date());
    assert.equal(out.status, 'done');
    const r = row(w, message.id);
    assert.equal(r.provider, 'stub');
    assert.match(r.transcript, /^\[Stub transcript\] Voice note from Sam, 0:03 long/);
    const m = w.db.prepare('SELECT * FROM messages WHERE id=?').get(message.id);
    assert.ok(m.updated_at > m.at, 'updated_at bumped');
    const since = await w.ok('GET', `/api/messages?clientId=${w.client.id}&since=${encodeURIComponent(before.cursor)}`, { as: w.coach });
    const u = since.updated.find(x => x.id === message.id);
    assert.equal(u.voice.status, 'done');
    assert.equal(u.voice.provider, 'stub');
    assert.equal(u.voice.summary, '[Stub] No analysis without an AI provider.', 'the coach sees the analysis');
    const tl = await w.ok('GET', `/api/timeline?since=${encodeURIComponent(tl0.cursor ?? before.cursor)}`, { as: w.client });
    const ti = tl.updated.find(x => x.id === message.id);
    assert.equal(ti.message.voice.status, 'done');
    assert.equal(ti.message.voice.summary, undefined, 'the client never does');
    assert.ok(tl.cursor >= since.cursor);
    // Withdrawing stops the next note at once.
    await w.ok('PUT', '/api/voice/consent', { as: w.client, body: { voice: 'off' } });
    const third = await sendVoice(w, w.client);
    assert.equal(row(w, third.message.id).reason, 'noConsent');
  });

  test('a coach note is transcribed only; coach AI transcription off means off/aiOff', async () => {
    const { message } = await sendVoice(w, w.coach, { clientId: w.client.id });
    assert.equal(row(w, message.id).direction, 'toClient');
    await w.tick('voice.transcribe', new Date());
    const r = row(w, message.id);
    assert.equal(r.status, 'done');
    assert.equal(r.mood, null);
    assert.equal(r.flags, '[]');
    await w.ok('PUT', '/api/ai/settings', { as: w.coach, body: { transcribe: false } });
    const off = await sendVoice(w, w.coach, { clientId: w.client.id });
    assert.equal(row(w, off.message.id).reason, 'aiOff');
    assert.equal((await w.ok('GET', '/api/me', { as: w.coach })).features.voiceTranscription, 'off');
    await w.ok('PUT', '/api/ai/settings', { as: w.coach, body: { transcribe: true } });
  });

  test('retry puts a failed or off note back in the queue', async () => {
    const { message } = await sendVoice(w, w.coach, { clientId: w.client.id });
    w.db.prepare("UPDATE voice_analyses SET status='failed', attempts=2, next_try_at=NULL, error='boom' WHERE message_id=?").run(message.id);
    assert.equal((await w.tick('voice.transcribe', new Date())).processed, 0, 'two failures are left alone');
    const out = await w.ok('POST', `/api/voice/${message.id}/retry`, { as: w.coach });
    assert.equal(out.voice.status, 'pending');
    await w.tick('voice.transcribe', new Date());
    assert.equal(row(w, message.id).status, 'done');
    assert.equal((await w.call('POST', `/api/voice/${message.id}/retry`, { as: w.coach })).status, 409);
  });

  test('retention: 13 months after End coaching the transcript goes; 11 months it stays; analysis fields go after 24 months', async () => {
    const c13 = await w.signIn('ret-13', 'r13@example.com', { givenName: 'Rita', familyName: 'Old' });
    const c11 = await w.signIn('ret-11', 'r11@example.com', { givenName: 'Rob', familyName: 'Newer' });
    const now = new Date();
    const mk = async c => { await w.ok('PUT', '/api/voice/consent', { as: c, body: { voice: 'on' } }); const s = await sendVoice(w, c); await drain(w); return s.message.id; };
    const m13 = await mk(c13), m11 = await mk(c11);
    const ago = mo => { const d = new Date(now); d.setUTCMonth(d.getUTCMonth() - mo); return d.toISOString(); };
    // client.offboarded (WP2) is what fills voice_client_state; emitted here as WP2 would.
    const { emit } = await import('../events.mjs');
    emit(w.db, 'client.offboarded', { coachId: w.coach.id, clientId: c13.id, summary: 'Coaching ended' });
    emit(w.db, 'client.offboarded', { coachId: w.coach.id, clientId: c11.id, summary: 'Coaching ended' });
    await w.settle();
    assert.ok(w.db.prepare('SELECT ended_at FROM voice_client_state WHERE client_id=?').get(c13.id).ended_at);
    w.db.prepare('UPDATE voice_client_state SET ended_at=? WHERE client_id=?').run(ago(13), c13.id);
    w.db.prepare('UPDATE voice_client_state SET ended_at=? WHERE client_id=?').run(ago(11), c11.id);
    await w.tick('voice.retention', now);
    assert.equal(row(w, m13).transcript, null);
    assert.equal(row(w, m13).summary, null);
    assert.ok(row(w, m11).transcript, `eleven months: kept ${JSON.stringify(row(w, m11))}`);
    w.db.prepare('UPDATE voice_analyses SET created_at=? WHERE message_id=?').run(ago(25), m11);
    await w.tick('voice.retention', now);
    assert.equal(row(w, m11).summary, null, 'analysis fields after 24 months regardless');
    assert.ok(row(w, m11).transcript, 'the transcript of an active client stays');
  });

  test('the demo coach is always stub', async () => {
    const { aiInfo } = await import('../ai.mjs');
    const demoCoach = w.user('Demo Coach', 'coach', null, { isDemo: true }).row;
    assert.equal(aiInfo(w.db, { ...w.config, ai: OPENROUTER }, demoCoach).provider, 'stub');
  });

  test('isolation: every voice route is 404 across coaches; a client gets 403 on coach routes', async () => {
    const other = await w.signIn('vo-coach2', 'coach2@example.com', { givenName: 'Other', familyName: 'Coach' });
    const { message } = await sendVoice(w, w.coach, { clientId: w.client.id });
    const routes = [
      ['GET', `/api/coach/clients/${w.client.id}/ai-consent`], ['GET', `/api/voice?clientId=${w.client.id}`],
      ['POST', `/api/voice/${message.id}/retry`], ['POST', `/api/voice/${message.id}/listened`], ['POST', `/api/voice/${message.id}/tasks`],
    ];
    for (const [method, path] of routes) {
      assert.equal((await w.call(method, path, { as: other, body: method === 'POST' ? {} : undefined })).status, 404, `${method} ${path}`);
      assert.equal((await w.call(method, path, { as: w.client, body: method === 'POST' ? {} : undefined })).status, 403, `client ${method} ${path}`);
    }
    assert.deepEqual((await w.ok('GET', '/api/voice', { as: other })).items, []);
    assert.equal((await w.call('PUT', '/api/voice/consent', { as: w.coach, body: { voice: 'on' } })).status, 403);
  });
});

describe('voice through OpenRouter (fake fetch, real ffmpeg)', { skip: !HAS_FFMPEG && 'ffmpeg is not installed' }, () => {
  let w, calls, gate;
  before(async () => {
    w = await makeWorld({ config: { ai: { ...OPENROUTER } } });
    resetLimits();
    w.db.prepare("UPDATE users SET plan='elite' WHERE id=?").run(w.client.id);
    calls = [];
    gate = null;
    w.onFetch(async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      if (gate) await gate;
      if (body.response_format?.type === 'json_schema' && w.reject400) return { ok: false, status: 400, json: async () => ({ error: { message: 'json_schema is not supported by this model' } }) };
      return reply(body.model === OPENROUTER.audioModel ? ANALYSIS : { verdict: 'ok', summary: 'Fine.', issues: [], rewrite: null });
    });
    await w.ok('PUT', '/api/coach/prefs/notify.quietHours', { as: w.coach, body: { value: null } });
    await w.ok('PUT', '/api/push/token', { as: w.coach, body: { token: 'ab'.repeat(32) } });
  });
  after(() => w.close());

  test('consent gate: no listen() call without on; then one input_audio request with the privacy block', async () => {
    const off = await sendVoice(w, w.client);
    await w.tick('voice.transcribe', new Date());
    assert.equal(calls.length, 0, 'nothing left the server');
    assert.equal(row(w, off.message.id).reason, 'noConsent');
    await w.ok('PUT', '/api/voice/consent', { as: w.client, body: { voice: 'on' } });
    const { message } = await sendVoice(w, w.client);
    const out = await w.tick('voice.transcribe', new Date());
    assert.equal(out.status, 'done', JSON.stringify(out));
    assert.equal(calls.length, 1);
    const req = calls[0].body;
    assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(req.model, OPENROUTER.audioModel);
    assert.equal(req.provider.data_collection, 'deny');
    assert.equal(req.provider.zdr, true);
    assert.equal(req.messages[0].role, 'system');
    const audio = req.messages[1].content.find(c => c.type === 'input_audio');
    assert.equal(audio.input_audio.format, 'mp3');
    assert.ok(Buffer.from(audio.input_audio.data, 'base64').length > 100);
    assert.ok(!JSON.stringify(req).includes('Carter'), 'only the first name');
    const r = row(w, message.id);
    assert.equal(r.provider, 'openrouter');
    assert.equal(r.mood, 'low');
    assert.equal(JSON.parse(r.flags)[0].kind, 'pain');
  });

  test('a flag makes a needs reason, an urgent notification and a push to the coach', async () => {
    const needs = await w.ok('GET', '/api/coach/needs-you', { as: w.coach });
    const flat = JSON.stringify(needs);
    assert.match(flat, /Mentioned knee pain in a voice note/);
    const notes = await w.ok('GET', '/api/notifications', { as: w.coach });
    const n = notes.items.find(x => x.kind === 'voiceFlag');
    assert.ok(n);
    assert.equal(n.tone, 'urgent');
    assert.equal(n.title, 'Sam mentioned knee pain in a voice note');
    await w.settle();
    assert.ok(w.pushes.some(p => p.title === n.title || JSON.stringify(p).includes('knee pain')), JSON.stringify(w.pushes));
    // Inbox, search and the transcripts list (current owner).
    const { hooks } = await import('../registry.mjs');
    const items = hooks('inbox').flatMap(([, fn]) => fn(w.db, w.coach.row, {}));
    assert.ok(items.some(i => i.kind === 'voice' && i.tone === 'urgent'));
    assert.ok((await w.ok('GET', '/api/search?q=lunges', { as: w.coach })).results.some(r => r.type === 'voice'));
    assert.ok((await w.ok('GET', `/api/voice?flagged=1&clientId=${w.client.id}`, { as: w.coach })).items.length >= 1);
    assert.ok((await w.ok('GET', '/api/voice?q=lunges', { as: w.coach })).items.length >= 1);
  });

  test('client view everywhere: no analysis key in any client route; the export has it', async () => {
    const paths = ['/api/me', '/api/today', `/api/messages?clientId=${w.client.id}`, '/api/messages', '/api/timeline', '/api/timeline?since=2000-01-01T00:00:00.000Z',
      '/api/week', '/api/review', '/api/direction', '/api/reports', '/api/checkins', '/api/goals', '/api/habits', '/api/voice/consent', '/api/me/preferences',
      '/api/form-requests', '/api/bookings', '/api/progress', '/api/workouts'];
    let voiceSeen = 0;
    for (const p of paths) {
      const r = await w.call('GET', p, { as: w.client });
      const s = JSON.stringify(r.body);
      assert.ok(!s.includes('SENTINEL-SUMMARY') && !s.includes('sentinel-topic'), `${p} leaks the analysis`);
      for (const v of voiceBlocks(r.body)) { voiceSeen++; for (const k of ANALYSIS_KEYS) assert.ok(!(k in v), `${p}: voice.${k}`); }
    }
    assert.ok(voiceSeen > 0, 'voice blocks were checked');
    const up = await w.ok('POST', '/api/media?purpose=voice', { as: w.client, raw: M4A, headers: { 'content-type': 'audio/mp4' } });
    const posted = await w.ok('POST', '/api/messages', { as: w.client, body: { kind: 'voice', mediaId: up.id } });
    for (const k of ANALYSIS_KEYS) assert.ok(!(k in posted.voice), `POST /api/messages voice.${k}`);
    const exp = await w.ok('GET', '/api/me/export', { as: w.client });
    const a = exp.features.voice.analyses.find(x => x.summary === ANALYSIS.summary);
    assert.ok(a, 'the export carries the analysis');
    assert.equal(a.mood, 'low');
    assert.deepEqual(a.flags, ANALYSIS.flags);
  });

  test('quota: past the per-client budget the note is off/quota, and the AI check still works', async () => {
    w.config.ai.clientDailyNotes = 1;
    try {
      const { message } = await sendVoice(w, w.client);
      assert.equal(row(w, message.id).status, 'off');
      assert.equal(row(w, message.id).reason, 'quota');
      const rv = await w.ok('POST', '/api/ai/review', { as: w.coach, body: { clientId: w.client.id, surface: 'message', text: 'How did the knee feel today?' } });
      assert.equal(rv.provider, 'openrouter');
    } finally { w.config.ai.clientDailyNotes = 20; }
  });

  test('a 400 on json_schema retries once with json_object', async () => {
    w.reject400 = true;
    try {
      await drain(w);
      const { message } = await sendVoice(w, w.coach, { clientId: w.client.id });
      const n = calls.length;
      await w.tick('voice.transcribe', new Date());
      assert.equal(calls.length, n + 2);
      assert.equal(calls.at(-2).body.response_format.type, 'json_schema');
      assert.equal(calls.at(-1).body.response_format.type, 'json_object');
      assert.equal(row(w, message.id).status, 'done');
      assert.ok(w.db.prepare("SELECT 1 FROM ai_calls WHERE error LIKE 'downgraded:json_object%'").get());
    } finally { w.reject400 = false; }
  });

  test('reassignment: the old coach gets 404 or empty lists; the new coach sees the rows', async () => {
    const c2 = await w.signIn('vr-coach2', 'coach2@example.com', { givenName: 'Nia', familyName: 'Two' });
    const mover = await w.signIn('vr-mover', 'mover@example.com', { givenName: 'Max', familyName: 'Mover' });
    await w.ok('PUT', '/api/voice/consent', { as: mover, body: { voice: 'on' } });
    const { message } = await sendVoice(w, mover);
    await drain(w);
    assert.equal(row(w, message.id).status, 'done');
    w.db.prepare('UPDATE users SET coach_id=? WHERE id=?').run(c2.id, mover.id);   // admin.mjs assign
    const { hooks } = await import('../registry.mjs');
    const inboxOf = c => hooks('inbox').flatMap(([, fn]) => fn(w.db, c, {})).filter(i => i.clientId === mover.id);
    assert.ok(!(await w.ok('GET', '/api/voice', { as: w.coach })).items.some(i => i.message.id === message.id));
    assert.equal((await w.call('POST', `/api/voice/${message.id}/retry`, { as: w.coach })).status, 404);
    assert.equal((await w.call('GET', `/api/coach/clients/${mover.id}/ai-consent`, { as: w.coach })).status, 404);
    assert.deepEqual(inboxOf(w.coach.row), []);
    assert.ok(!(await w.ok('GET', '/api/search?q=lunges', { as: w.coach })).results.some(r => r.id === message.id));
    assert.ok((await w.ok('GET', '/api/voice', { as: c2 })).items.some(i => i.message.id === message.id));
    assert.ok(inboxOf(c2.row).length >= 1);
    assert.ok((await w.ok('GET', '/api/search?q=lunges', { as: c2 })).results.some(r => r.id === message.id));
  });

  test('erasing the client while the model is working: no error, no rows, no notification', async () => {
    const gone = await w.signIn('ve-gone', 'gone@example.com', { givenName: 'Gil', familyName: 'Gone' });
    await w.ok('PUT', '/api/voice/consent', { as: gone, body: { voice: 'on' } });
    await drain(w);
    const { message, media } = await sendVoice(w, gone);
    let open;
    gate = new Promise(r => { open = r; });
    // Erasure cascades the notifications already about this client (WP1's "new client" one), so count only the others.
    const notesBefore = w.db.prepare('SELECT COUNT(*) n FROM coach_notifications WHERE client_id IS NULL OR client_id<>?').get(gone.id).n;
    const running = w.tick('voice.transcribe', new Date());
    await new Promise(r => setTimeout(r, 300));
    await w.ok('DELETE', '/api/me', { as: gone });
    gate = null;
    open();
    const out = await running;
    assert.ok(!out?.error || /FOREIGN KEY|gone/i.test(out.error), JSON.stringify(out));
    await w.settle();
    assertNoRowsFor(w.db, gone.id);
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM voice_analyses WHERE message_id=?').get(message.id).n, 0);
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM coach_notifications').get().n, notesBefore);
    assert.equal(existsSync(join(w.config.dataDir, 'media', `${media.id}.m4a`)), false, 'erasure removed the file');
  });
});
