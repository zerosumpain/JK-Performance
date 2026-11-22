import { createReadStream, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canSee, clientFor } from './access.mjs';
import { fail, num, oneOf, raw } from './http.mjs';
import { coachSettings, saveCoachSettings } from './settings.mjs';
import { newId, nowIso } from './store.mjs';

/**
 * Media: voice and video notes on letters, form-check videos, meal photos,
 * check-in photos, and the coach's portrait and signature. Files live beside
 * the progress photos (<DATA_DIR>/media/<id>.<ext>), so the same backups cover
 * them. Who may fetch one: the uploader; the client it belongs to and that
 * client's coach; and, for a coach's own images with no client (portrait,
 * signature), that coach's clients.
 */

const MB = 1024 * 1024;
export const MEDIA_LIMITS = { image: 10 * MB, audio: 10 * MB, video: 60 * MB };
const TYPES = {
  'image/jpeg': ['image', 'jpg'], 'image/png': ['image', 'png'], 'image/heic': ['image', 'heic'],
  'audio/mp4': ['audio', 'm4a'], 'audio/m4a': ['audio', 'm4a'], 'audio/x-m4a': ['audio', 'm4a'],
  'video/mp4': ['video', 'mp4'],
};
const MIME_OF = { jpg: 'image/jpeg', png: 'image/png', heic: 'image/heic', m4a: 'audio/mp4', mp4: 'video/mp4' };
export const PURPOSES = ['letter', 'formCheck', 'mealPhoto', 'checkin', 'avatar', 'signature', 'other'];
const MAX_SECONDS = 90;

const dirOf = config => join(config.dataDir, 'media');
const fileOf = (config, m) => join(dirOf(config), `${m.id}.${m.ext}`);

/** Does the file start the way its type says? JPEG, PNG, or an ISO media file (HEIC, MP4, M4A). */
function looksRight(bytes, ext) {
  if (ext === 'jpg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (ext === 'png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return bytes.length > 12 && bytes.subarray(4, 8).toString('latin1') === 'ftyp';
}

export const mediaOut = m => m && ({
  id: m.id, kind: m.kind, mime: m.mime, bytes: m.bytes, durationSec: m.duration_sec, purpose: m.purpose,
  clientId: m.client_id, createdAt: m.created_at, url: `/api/media/${m.id}`,
});

/** Store bytes as media. Used by the upload route, the admin portrait command and the demo build. */
export function storeMedia(db, config, { ownerId, clientId = null, bytes, mime, purpose = 'other', durationSec = null }) {
  const type = TYPES[mime];
  if (!type) fail(415, `Send one of ${Object.keys(TYPES).join(', ')}`);
  const [kind, ext] = type;
  if (!bytes?.length) fail(400, 'The body is empty');
  if (bytes.length > MEDIA_LIMITS[kind]) fail(413, `${kind === 'video' ? 'Videos' : kind === 'audio' ? 'Voice notes' : 'Images'} are limited to ${MEDIA_LIMITS[kind] / MB} MB`);
  if (!looksRight(bytes, ext)) fail(415, `That is not a ${ext.toUpperCase()} file`);
  const id = newId('md');
  mkdirSync(dirOf(config), { recursive: true, mode: 0o700 });
  writeFileSync(join(dirOf(config), `${id}.${ext}`), bytes, { mode: 0o600 });
  db.prepare('INSERT INTO media (id, owner_id, client_id, kind, mime, ext, bytes, duration_sec, purpose, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, ownerId, clientId, kind, MIME_OF[ext], ext, bytes.length, kind === 'image' ? null : durationSec, purpose, nowIso());
  return db.prepare('SELECT * FROM media WHERE id=?').get(id);
}

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

function upload(req, ctx) {
  const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const client = ctx.user.role === 'client' ? ctx.user : ctx.query.clientId ? clientFor(ctx, ctx.query.clientId) : null;
  const durationSec = ctx.query.durationSec === undefined ? null : num(Number(ctx.query.durationSec), 'durationSec', { min: 0, max: MAX_SECONDS });
  const purpose = ctx.query.purpose ? oneOf(ctx.query.purpose, 'purpose', PURPOSES) : 'other';
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
  ctx.db.prepare('DELETE FROM media WHERE id=?').run(m.id);
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
  r.add('POST', '/api/media', upload, { rawBody: MEDIA_LIMITS.video });
  r.add('GET', '/api/media/:id', get);
  r.add('DELETE', '/api/media/:id', remove);
}
