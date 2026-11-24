import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeWorld } from './helpers.mjs';
import { hasVideoTrack, rawLimitFor } from '../media.mjs';
import { resetLimits } from '../ratelimit.mjs';

// F19 uploads (docs/design/desk-v2.md F19 "media.mjs"): every voice and letter upload is sniffed and re-encoded
// with a fake ffmpeg that copies the fixture m4a and prints a Duration and an Audio line.

const FIXTURE = fileURLToPath(new URL('../fixtures/voice-demo.m4a', import.meta.url));
const M4A = readFileSync(FIXTURE);
const dir = mkdtempSync(join(tmpdir(), 'jk-fakeff-'));

/** A fake ffmpeg: `-version` works; the input's bytes pick the probe answer; an mp4 output gets the fixture. */
function fakeFfmpeg(name) {
  const path = join(dir, name);
  writeFileSync(path, `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
if (a[0] === '-version') { console.log('ffmpeg version fake'); process.exit(0); }
const inp = a[a.indexOf('-i') + 1];
const bytes = fs.readFileSync(inp);
const long = bytes.includes(Buffer.from('LONGLONG')), silent = bytes.includes(Buffer.from('NOAUDIO'));
const fmt = a[a.indexOf('-f') + 1];
fs.appendFileSync(${JSON.stringify(join(dir, 'calls.log'))}, fmt + '\\n');
console.error('Input #0, ' + fmt + ", from '" + inp + "':");
console.error('  Duration: ' + (long ? '00:06:00.00' : '00:00:42.40') + ', start: 0.000000, bitrate: 64 kb/s');
if (!silent) console.error('  Stream #0:0: Audio: aac (LC), 44100 Hz, mono, fltp, 64 kb/s');
const out = a[a.length - 1];
if (a.includes('mp4') && out !== '-' && out !== inp) fs.writeFileSync(out, fs.readFileSync(${JSON.stringify(FIXTURE)}));
process.exit(a.length > 8 ? 0 : 1);
`);
  chmodSync(path, 0o755);
  return path;
}

const pad = (head, n = 200) => Buffer.concat([Buffer.isBuffer(head) ? head : Buffer.from(head, 'latin1'), Buffer.alloc(n, 7)]);
const SAMPLES = {
  webm: pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
  ogg: pad('OggS'),
  mp3: pad('ID3\x04'),
  wav: pad('RIFF\x24\x00\x00\x00WAVEfmt '),
  m4a: M4A,
};
const ftyp = (brand, extra = '') => pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}\0\0\0\0isom`, 'latin1'), Buffer.from(extra, 'latin1')]));
const HEIC = ftyp('heic');
const VIDEO = ftyp('isom', 'moov....trak....mdia....hdlr\0\0\0\0\0\0\0\0vide\0\0\0\0');

describe('voice uploads (fake ffmpeg)', () => {
  let w, coach, a, b, upload;
  before(async () => {
    w = await makeWorld({ config: { ffmpegPath: fakeFfmpeg('ffmpeg-ok') } });
    coach = w.coach;
    a = w.client;
    b = await w.signIn('vm-b', 'bea@example.com', { givenName: 'Bea', familyName: 'Lowe' });
    upload = (as, bytes, query, type = 'audio/webm') => w.call('POST', `/api/media?${query}`, { as, raw: bytes, headers: { 'content-type': type } });
    resetLimits();
  });
  after(() => w.close());

  test('webm, ogg, mp3, wav and m4a are each sniffed, converted to m4a and stored with the probed length', async () => {
    for (const [name, bytes] of Object.entries(SAMPLES)) {
      const r = await upload(a, bytes, 'purpose=voice&durationSec=10', name === 'm4a' ? 'audio/mp4' : '');
      assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.mime, 'audio/mp4');
      assert.equal(r.body.kind, 'audio');
      assert.equal(r.body.durationSec, 42.4, `${name}: the probed duration, not the client's`);
      const row = w.db.prepare('SELECT * FROM media WHERE id=?').get(r.body.id);
      assert.equal(row.ext, 'm4a');
      assert.equal(row.client_id, a.id);
      assert.deepEqual(readFileSync(join(w.config.dataDir, 'media', `${row.id}.m4a`)), M4A, 'the stored file is the converted m4a');
    }
    const formats = readFileSync(join(dir, 'calls.log'), 'utf8');
    for (const f of ['matroska', 'ogg', 'mp3', 'wav', 'mov']) assert.ok(formats.includes(f), `ffmpeg ran with -f ${f}`);
  });

  test('HEIC, an MP4 video and a file with no audio stream are refused', async () => {
    assert.equal(hasVideoTrack(VIDEO), true);
    assert.equal(hasVideoTrack(M4A), false);
    const heic = await upload(a, HEIC, 'purpose=voice', 'audio/mp4');
    assert.equal(heic.status, 415);
    const video = await upload(a, VIDEO, 'purpose=voice', 'audio/mp4');
    assert.equal(video.status, 415);
    assert.equal(video.body.error, 'That is a video, not a voice note');
    const silent = await upload(a, pad(Buffer.concat([Buffer.from('OggS'), Buffer.from('NOAUDIO')])), 'purpose=voice');
    assert.equal(silent.status, 415);
    assert.equal(silent.body.error, 'No audio in that file');
    const text = await upload(a, Buffer.from('#EXTM3U\nhttp://example.com/x.mp3\n'), 'purpose=voice', 'audio/mpeg');
    assert.equal(text.status, 415, 'a playlist never reaches ffmpeg');
  });

  test('lengths: a probed duration over the cap + 2 s is refused; durationSec is checked per purpose', async () => {
    const long = await upload(a, pad(Buffer.concat([Buffer.from('OggS'), Buffer.from('LONGLONG')])), 'purpose=voice');
    assert.equal(long.status, 400);
    assert.equal(long.body.error, 'Voice notes can be up to 5 minutes');
    assert.equal((await upload(a, SAMPLES.ogg, 'purpose=voice&durationSec=301')).status, 400);
    assert.equal((await upload(a, SAMPLES.ogg, 'purpose=letter&durationSec=91', 'audio/mp4')).status, 400);
    assert.equal((await upload(a, SAMPLES.ogg, 'purpose=voice&durationSec=299')).status, 200);
    // A letter's audio is capped at 90 s, so a 6-minute file is too long there too.
    const letter = await upload(coach, pad(Buffer.concat([Buffer.from('OggS'), Buffer.from('LONGLONG')])), `purpose=letter&clientId=${a.id}`, 'audio/ogg');
    assert.equal(letter.status, 400);
    assert.equal(letter.body.error, 'Voice notes on letters can be up to 90 seconds');
  });

  test('a coach upload must name the client; 413 over 10 MB, decided before reading for voice', async () => {
    const r = await upload(coach, SAMPLES.webm, 'purpose=voice');
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'Say which client this is for');
    const big = await upload(a, Buffer.alloc(11 * 1024 * 1024, 1), 'purpose=voice');
    assert.equal(big.status, 413);
    assert.equal(big.body.error, 'Voice notes are limited to 10 MB');
    const url = p => new URL(`http://x/api/media?${p}`);
    assert.equal(rawLimitFor({ headers: {} }, url('purpose=voice')), 10 * 1024 * 1024);
    assert.equal(rawLimitFor({ headers: { 'content-type': 'video/mp4' } }, url('purpose=letter')), 60 * 1024 * 1024, 'a letter video keeps 60 MB');
    assert.equal(rawLimitFor({ headers: { 'content-type': 'audio/mp4' } }, url('purpose=letter')), 10 * 1024 * 1024);
  });

  test('sending: client A\'s note cannot go to B; another client cannot fetch it; one media backs one message', async () => {
    const up = (await upload(coach, SAMPLES.m4a, `purpose=voice&clientId=${a.id}`, 'audio/mp4')).body;
    const toB = await w.call('POST', '/api/messages', { as: coach, body: { clientId: b.id, kind: 'voice', mediaId: up.id } });
    assert.equal(toB.status, 400);
    assert.equal(toB.body.error, 'That voice note is for someone else');
    assert.equal((await w.call('GET', `/api/media/${up.id}`, { as: b })).status, 404, 'another client of the same coach');
    assert.equal((await w.call('GET', `/api/media/${up.id}`, { as: a })).status, 200);
    const sent = await w.ok('POST', '/api/messages', { as: coach, body: { clientId: a.id, kind: 'voice', mediaId: up.id } });
    assert.equal(sent.kind, 'voice');
    assert.equal(sent.text, 'Voice note · 0:42');
    assert.equal(sent.mediaId, null, 'no top-level mediaId on a voice message');
    assert.equal(sent.mediaUrl, null);
    assert.equal(sent.mediaKind, 'audio');
    assert.equal(sent.voice.mediaId, up.id);
    assert.equal(sent.voice.url, `/api/media/${up.id}`);
    assert.equal(sent.voice.durationSec, 42.4);
    const again = await w.call('POST', '/api/messages', { as: coach, body: { clientId: a.id, kind: 'voice', mediaId: up.id } });
    assert.equal(again.status, 400);
    assert.equal(again.body.error, 'That voice note has already been sent');
  });

  test('kind validation: audio is never a meal photo, and a voice note needs voice media', async () => {
    const up = (await upload(a, SAMPLES.webm, 'purpose=voice')).body;
    assert.equal((await w.call('POST', '/api/messages', { as: a, body: { kind: 'mealPhoto', mediaId: up.id } })).status, 400);
    const m = await w.ok('POST', '/api/messages', { as: a, body: { mediaId: up.id, text: 'About Thursday' } });
    assert.equal(m.kind, 'voice', 'audio without a kind is a voice note');
    assert.equal(m.text, 'About Thursday', 'the caption replaces the fallback');
    assert.equal((await w.call('POST', '/api/messages', { as: a, body: { kind: 'voice' } })).status, 400);
    assert.equal((await w.call('POST', '/api/messages', { as: a, body: { kind: 'shout' } })).status, 400);
    const other = (await upload(a, SAMPLES.ogg, 'purpose=other', 'audio/mp4')).status;
    assert.equal(other, 415, 'other purposes keep the m4a-only rule');
  });

  test('a client with voice notes switched off gets 403 not_enabled; me.features says so', async () => {
    await w.ok('PATCH', '/api/coach/settings', { as: coach, body: { voiceNotes: false } });
    const up = (await upload(a, SAMPLES.webm, 'purpose=voice')).body;
    const r = await w.call('POST', '/api/messages', { as: a, body: { kind: 'voice', mediaId: up.id } });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'not_enabled');
    const me = await w.ok('GET', '/api/me', { as: a });
    assert.equal(me.features.voiceNotes, false);
    assert.equal(me.features.voiceMaxSec, 300);
    assert.equal(me.features.voiceTranscription, 'ask');
    assert.equal((await w.ok('GET', '/api/me', { as: coach })).features.voiceNotes, true, 'coaches always may');
    await w.ok('PATCH', '/api/coach/settings', { as: coach, body: { voiceNotes: true } });
    assert.equal((await w.call('POST', '/api/messages', { as: a, body: { kind: 'voice', mediaId: up.id } })).status, 200);
  });

  test('deleting the file tombstones the message', async () => {
    const up = (await upload(a, SAMPLES.webm, 'purpose=voice')).body;
    const m = await w.ok('POST', '/api/messages', { as: a, body: { kind: 'voice', mediaId: up.id } });
    await w.settle();
    await w.ok('DELETE', `/api/media/${up.id}`, { as: a });
    assert.equal(existsSync(join(w.config.dataDir, 'media', `${up.id}.m4a`)), false);
    const list = await w.ok('GET', `/api/messages?clientId=${a.id}`, { as: coach });
    const t = list.messages.find(x => x.id === m.id);
    assert.equal(t.voice.status, 'deleted');
    assert.equal(t.voice.mediaId, null);
    assert.equal(t.voice.url, null);
    assert.equal(t.text, 'Voice note deleted');
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM voice_analyses WHERE message_id=?').get(m.id).n, 0, 'the analysis went by cascade');
  });

  test('a letter video keeps the old path; letter audio is converted', async () => {
    const vid = await upload(coach, ftyp('mp42'), `purpose=letter&clientId=${a.id}&durationSec=30`, 'video/mp4');
    assert.equal(vid.status, 200);
    assert.equal(vid.body.kind, 'video');
    const aud = await upload(coach, SAMPLES.webm, `purpose=letter&clientId=${a.id}`, '');
    assert.equal(aud.status, 200);
    assert.equal(aud.body.mime, 'audio/mp4');
  });

  test('demo accounts: 5 uploads a day', async () => {
    const demo = w.user('Demo Dee', 'client', w.coach.id, { isDemo: true });
    for (let i = 0; i < 5; i++) assert.equal((await upload(demo, SAMPLES.ogg, 'purpose=voice')).status, 200);
    const sixth = await upload(demo, SAMPLES.ogg, 'purpose=voice');
    assert.equal(sixth.status, 429);
    assert.equal(sixth.body.error, 'That\'s a lot of voice notes today');
  });
});

describe('voice uploads without ffmpeg', () => {
  let w;
  before(async () => { w = await makeWorld({ config: { ffmpegPath: join(dir, 'no-such-ffmpeg') } }); });
  after(() => w.close());

  test('only a plain m4a is accepted, with the caller\'s duration', async () => {
    const ok = await w.call('POST', '/api/media?purpose=voice&durationSec=12', { as: w.client, raw: M4A, headers: { 'content-type': 'audio/mp4' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.durationSec, 12);
    const webm = await w.call('POST', '/api/media?purpose=voice', { as: w.client, raw: SAMPLES.webm, headers: { 'content-type': 'audio/webm' } });
    assert.equal(webm.status, 415);
    assert.equal(webm.body.error, 'This server can\'t convert that recording; send m4a');
  });
});
