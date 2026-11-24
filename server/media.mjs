import { createReadStream, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canSee, clientFor } from './access.mjs';
import { AudioError, convertUpload, sniffAudio } from './audio.mjs';
import { fail, num, oneOf, raw } from './http.mjs';
import { limit } from './ratelimit.mjs';
import { coachSettings, saveCoachSettings } from './settings.mjs';
import { newId, nowIso, tx } from './store.mjs';
import { addDays, londonDay, londonToUtc } from './time.mjs';

/**
 * Media: voice and video notes on letters, form-check videos, meal photos,
 * check-in photos, and the coach's portrait and signature. Files live beside
 * the progress photos (<DATA_DIR>/media/<id>.<ext>), so the same backups cover
 * them. Who may fetch one: the uploader; the client it belongs to and that
 * client's coach; and, for a coach's own images with no client (portrait,
 * signature), that coach's clients.
 *
 * Voice notes (purpose `voice`, F19) and letter voice notes (purpose `letter`)
 * are always re-encoded: the container is sniffed from the bytes (never the
 * label, which browsers often leave empty), ffmpeg converts it to an AAC m4a
 * outside any transaction, and the probed duration is what is stored and
 * charged. Per-user daily caps (30 uploads or 50 MB; demo accounts 5 uploads
 * of a minute each) and the shared conversion queue (503) apply.
 */

const MB = 1024 * 1024;
export const MEDIA_LIMITS = { image: 10 * MB, audio: 10 * MB, video: 60 * MB };
const TYPES = {
  'image/jpeg': ['image', 'jpg'], 'image/png': ['image', 'png'], 'image/heic': ['image', 'heic'],
  'audio/mp4': ['audio', 'm4a'], 'audio/m4a': ['audio', 'm4a'], 'audio/x-m4a': ['audio', 'm4a'],
  'video/mp4': ['video', 'mp4'],
};
const MIME_OF = { jpg: 'image/jpeg', png: 'image/png', heic: 'image/heic', m4a: 'audio/mp4', mp4: 'video/mp4' };
export const PURPOSES = ['letter', 'formCheck', 'mealPhoto', 'checkin', 'avatar', 'signature', 'other', 'voice', 'guide'];
const MAX_SECONDS = 90;

/** Purposes whose audio is sniffed and re-encoded, with their caps (seconds) and too-long copy. */
export const AUDIO_PURPOSES = {
  voice: { capSec: 300, tooLong: 'Voice notes can be up to 5 minutes' },
  letter: { capSec: 90, tooLong: 'Voice notes on letters can be up to 90 seconds' },
};
/**
 * Labels accepted for those purposes. The label only says "this is audio";
 * the bytes decide the container (audio.sniffAudio). An empty label,
 * application/octet-stream and any other audio/* are accepted too.
 */
export const AUDIO_LABELS = ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/aac', 'audio/x-aac'];
const VOICE_DAILY = { uploads: 30, bytes: 50 * MB };
const DEMO_DAILY = { uploads: 5, capSec: 60 };

const dirOf = config => join(config.dataDir, 'media');
const fileOf = (config, m) => join(dirOf(config), `${m.id}.${m.ext}`);

/**
 * Does the file start the way its type says? JPEG, PNG, or an ISO media file:
 * HEIC needs an ftyp box; M4A and MP4 must be an ftyp box that is not an image
 * (the same sniffer as voice uploads, so a HEIC renamed .m4a is refused).
 */
function looksRight(bytes, ext) {
  if (ext === 'jpg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (ext === 'png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (ext === 'm4a' || ext === 'mp4') return sniffAudio(bytes) === 'mov';
  return bytes.length > 12 && bytes.subarray(4, 8).toString('latin1') === 'ftyp';
}

/**
 * Does an ISO media file carry a video track? Each track's `hdlr` box names its
 * handler ('soun' for audio, 'vide' for video) 8 bytes after the box type.
 */
export function hasVideoTrack(bytes) {
  const tag = Buffer.from('hdlr', 'latin1');
  for (let i = bytes.indexOf(tag); i >= 0 && i + 16 <= bytes.length; i = bytes.indexOf(tag, i + 4)) {
    if (bytes.subarray(i + 12, i + 16).toString('latin1') === 'vide') return true;
  }
  return false;
}

export const mediaOut = m => m && ({
  id: m.id, kind: m.kind, mime: m.mime, bytes: m.bytes, durationSec: m.duration_sec, purpose: m.purpose,
  clientId: m.client_id, createdAt: m.created_at, url: `/api/media/${m.id}`,
});

/** Check bytes against a type and write the file; returns {id, kind, ext, mime, bytes}. No database work (3.10: files go before the tx). */
export function writeMediaFile(config, { bytes, mime }) {
  const type = TYPES[mime];
  if (!type) fail(415, `Send one of ${Object.keys(TYPES).join(', ')}`);
  const [kind, ext] = type;
  if (!bytes?.length) fail(400, 'The body is empty');
  if (bytes.length > MEDIA_LIMITS[kind]) fail(413, `${kind === 'video' ? 'Videos' : kind === 'audio' ? 'Voice notes' : 'Images'} are limited to ${MEDIA_LIMITS[kind] / MB} MB`);
  if (!looksRight(bytes, ext)) fail(415, `That is not a ${ext.toUpperCase()} file`);
  const id = newId('md');
  mkdirSync(dirOf(config), { recursive: true, mode: 0o700 });
  writeFileSync(join(dirOf(config), `${id}.${ext}`), bytes, { mode: 0o600 });
  return { id, kind, ext, mime: MIME_OF[ext], bytes: bytes.length };
}

/** The row for a file writeMediaFile wrote. Returns the media row. */
export function insertMediaRow(db, file, { ownerId, clientId = null, purpose = 'other', durationSec = null }) {
  db.prepare('INSERT INTO media (id, owner_id, client_id, kind, mime, ext, bytes, duration_sec, purpose, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(file.id, ownerId, clientId, file.kind, file.mime, file.ext, file.bytes, file.kind === 'image' ? null : durationSec, purpose, nowIso());
  return db.prepare('SELECT * FROM media WHERE id=?').get(file.id);
}

/** Store bytes as media. Used by the upload route, the admin portrait command and the demo build. */
export function storeMedia(db, config, { ownerId, clientId = null, bytes, mime, purpose = 'other', durationSec = null }) {
  return insertMediaRow(db, writeMediaFile(config, { bytes, mime }), { ownerId, clientId, purpose, durationSec });
}

/** Where a media row's file lives. */
export const mediaFilePath = (config, m) => fileOf(config, m);

/** May `user` fetch this media row? */
export function canSeeMedia(db, user, m) {
  if (!m) return false;
  if (m.owner_id === user.id) return true;
  if (m.client_id) return canSee(user, db.prepare('SELECT * FROM users WHERE id=?').get(m.client_id));
  return user.role === 'client' && user.coach_id === m.owner_id;
}

/** A media row the caller may see, or a 404. */
export function visibleMedia(ctx, id) {
  if (typeof id !== 'string' || !/^md_[A-Za-z0-9_-]+$/.test(id)) fail(404, 'Not found');
  const m = ctx.db.prepare('SELECT * FROM media WHERE id=?').get(id);
  if (!canSeeMedia(ctx.db, ctx.user, m)) fail(404, 'Not found');
  return m;
}

/** A media id a caller attaches to something (a letter, a message): theirs, or their client's. */
export function attachableMedia(ctx, id, name, client) {
  if (id === undefined || id === null) return null;
  const m = visibleMedia(ctx, id);
  if (m.owner_id !== ctx.user.id && m.client_id !== client?.id) fail(400, `${name} is not yours to attach`);
  return m;
}

/** Is this upload one the audio pipeline handles? Voice always; a letter unless it is a video note. */
const isAudioUpload = (purpose, mime) => purpose === 'voice' || (purpose === 'letter' && mime !== 'video/mp4');

/** The body limit for a request, decided from its query and label before the body is read (early 413). */
export function rawLimitFor(req, url) {
  const purpose = url?.searchParams?.get('purpose');
  const mime = String(req?.headers?.['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  return AUDIO_PURPOSES[purpose] && isAudioUpload(purpose, mime) ? MEDIA_LIMITS.audio : MEDIA_LIMITS.video;
}

/** Voice and letter audio this user uploaded today (London day): {uploads, bytes}. */
export function audioUploadsToday(db, userId, now = new Date()) {
  const day = londonDay(now);
  return db.prepare(`SELECT COUNT(*) uploads, COALESCE(SUM(bytes), 0) bytes FROM media WHERE owner_id=? AND kind='audio' AND purpose IN ('voice','letter')
    AND created_at>=? AND created_at<?`).get(userId, londonToUtc(day).toISOString(), londonToUtc(addDays(day, 1)).toISOString());
}

async function uploadAudio(req, ctx, { purpose, mime, client }) {
  const { capSec: purposeCap, tooLong: purposeTooLong } = AUDIO_PURPOSES[purpose];
  if (mime && !AUDIO_LABELS.includes(mime) && !mime.startsWith('audio/') && mime !== 'application/octet-stream') fail(415, 'No audio in that file');
  const declared = Number(req.headers['content-length']);
  if ((Number.isFinite(declared) && declared > MEDIA_LIMITS.audio) || ctx.rawBody?.length > MEDIA_LIMITS.audio) fail(413, 'Voice notes are limited to 10 MB');
  if (ctx.user.role === 'coach' && !client) fail(400, 'Say which client this is for');
  const bytes = ctx.rawBody;
  if (!bytes?.length) fail(400, 'The body is empty');
  const demo = !!ctx.user.is_demo;
  const capSec = demo ? Math.min(purposeCap, DEMO_DAILY.capSec) : purposeCap;
  const tooLong = demo ? 'Demo voice notes can be up to a minute' : purposeTooLong;
  const durationSec = ctx.query.durationSec === undefined || ctx.query.durationSec === '' ? null : num(Number(ctx.query.durationSec), 'durationSec', { min: 0, max: purposeCap });
  // Daily caps: counted from the rows (what was kept) and, in memory, every attempt (deleting does not reset it).
  const used = audioUploadsToday(ctx.db, ctx.user.id);
  const caps = demo ? { uploads: DEMO_DAILY.uploads, bytes: VOICE_DAILY.bytes } : VOICE_DAILY;
  if (used.uploads >= caps.uploads || used.bytes + bytes.length > caps.bytes) fail(429, 'That\'s a lot of voice notes today');
  if (!limit(`voiceup:${ctx.user.id}`, { max: caps.uploads, perMs: 24 * 3_600_000 })) fail(429, 'That\'s a lot of voice notes today');
  if (sniffAudio(bytes) === 'mov' && hasVideoTrack(bytes)) fail(415, 'That is a video, not a voice note');
  let out;
  try {
    out = await convertUpload(ctx.config, bytes, { capSec, tooLong });
  } catch (e) {
    if (e instanceof AudioError) fail(e.status, e.message);
    throw e;
  }
  // Without ffmpeg an m4a passes as-is, so the caller's own figure is all there is (still within the cap).
  let seconds = out.seconds ?? durationSec;
  if (seconds !== null && seconds > capSec + 2) fail(400, tooLong);
  if (seconds !== null) seconds = Math.round(seconds * 10) / 10;
  const file = writeMediaFile(ctx.config, { bytes: out.bytes, mime: 'audio/mp4' });
  try {
    return mediaOut(tx(ctx.db, () => insertMediaRow(ctx.db, file, { ownerId: ctx.user.id, clientId: client?.id ?? null, purpose, durationSec: seconds })));
  } catch (e) {
    rmSync(fileOf(ctx.config, file), { force: true });
    throw e;
  }
}

function upload(req, ctx) {
  const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const client = ctx.user.role === 'client' ? ctx.user : ctx.query.clientId ? clientFor(ctx, ctx.query.clientId) : null;
  const purpose = ctx.query.purpose ? oneOf(ctx.query.purpose, 'purpose', PURPOSES) : 'other';
  if (isAudioUpload(purpose, mime)) return uploadAudio(req, ctx, { purpose, mime, client });
  const durationSec = ctx.query.durationSec === undefined ? null : num(Number(ctx.query.durationSec), 'durationSec', { min: 0, max: MAX_SECONDS });
  if (['avatar', 'signature'].includes(purpose) && ctx.user.role !== 'coach') fail(403, 'Coaches only');
  const m = storeMedia(ctx.db, ctx.config, { ownerId: ctx.user.id, clientId: client?.id ?? null, bytes: ctx.rawBody, mime, purpose, durationSec });
  if (ctx.user.role === 'coach' && ['avatar', 'signature'].includes(purpose)) {
    const s = coachSettings(ctx.db, ctx.user.id);
    saveCoachSettings(ctx.db, ctx.user.id, { ...s, [purpose === 'avatar' ? 'avatarMediaId' : 'signatureMediaId']: m.id });
  }
  return mediaOut(m);
}

/** "bytes=0-1023", "bytes=1024-", "bytes=-500" → [start, end] inclusive; null when absent; 'bad' when unsatisfiable. */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'bad';
  let start, end;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start > end || start >= size) return 'bad';
  return [start, end];
}

function get(req, ctx) {
  const m = visibleMedia(ctx, ctx.params.id);
  const path = fileOf(ctx.config, m);
  let size;
  try { size = statSync(path).size; } catch { fail(404, 'Not found'); }
  const headers = { 'content-type': m.mime, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' };
  const range = parseRange(req.headers.range, size);
  if (range === 'bad') return raw(416, { ...headers, 'content-range': `bytes */${size}` }, '');
  if (!range) return raw(200, { ...headers, 'content-length': String(size) }, createReadStream(path));
  const [start, end] = range;
  return raw(206, { ...headers, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}` }, createReadStream(path, { start, end }));
}

function remove(_req, ctx) {
  const m = visibleMedia(ctx, ctx.params.id);
  if (m.owner_id !== ctx.user.id) fail(403, 'Only who uploaded it can delete it');
  tx(ctx.db, () => {
    // A sent voice note stays in the thread as a tombstone (F19); its analysis goes by cascade.
    ctx.db.prepare("UPDATE messages SET text='Voice note deleted', updated_at=? WHERE media_id=? AND kind='voice'").run(nowIso(), m.id);
    ctx.db.prepare('DELETE FROM media WHERE id=?').run(m.id);
  });
  rmSync(fileOf(ctx.config, m), { force: true });
  if (ctx.user.role === 'coach') {
    const s = coachSettings(ctx.db, ctx.user.id);
    if (s.avatarMediaId === m.id || s.signatureMediaId === m.id) {
      saveCoachSettings(ctx.db, ctx.user.id, { ...s, avatarMediaId: s.avatarMediaId === m.id ? null : s.avatarMediaId, signatureMediaId: s.signatureMediaId === m.id ? null : s.signatureMediaId });
    }
  }
  return { ok: true };
}

/** Remove a person's media files from disk: what they uploaded and what belongs to them (rows go by cascade). */
export function eraseMedia(db, config, userId) {
  for (const m of db.prepare('SELECT id, ext FROM media WHERE owner_id=? OR client_id=?').all(userId, userId)) rmSync(fileOf(config, m), { force: true });
}

/** The caller's media for the export: what they uploaded and what was made for them. */
export const mediaForExport = (db, userId) => db.prepare('SELECT * FROM media WHERE owner_id=? OR client_id=? ORDER BY created_at').all(userId, userId)
  .map(m => ({ ...mediaOut(m), note: 'Download from the url while signed in' }));

export function mediaRoutes(r) {
  // rawLimit: the per-purpose body limit (10 MB for voice and letter audio); app.mjs refuses a larger declared body before reading it.
  r.add('POST', '/api/media', upload, { rawBody: MEDIA_LIMITS.video, rawLimit: rawLimitFor,
    tooLarge: limit => (limit === MEDIA_LIMITS.audio ? 'Voice notes are limited to 10 MB' : null) });
  r.add('GET', '/api/media/:id', get);
  r.add('DELETE', '/api/media/:id', remove);
}
