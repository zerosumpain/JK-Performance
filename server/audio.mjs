import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Audio tools (docs/design/desk-v2.md 3.14). ffmpeg runs on bytes uploaded by
 * clients, including through the public demo codes, so it is treated as
 * hostile-input processing:
 * - the container is sniffed from magic bytes, never from a label, and passed
 *   to ffmpeg explicitly with -f, so crafted input cannot pick a demuxer that
 *   opens other files or URLs (hls, concat, image2);
 * - -protocol_whitelist file blocks every network protocol;
 * - the output format is fixed; arguments are an array (never a shell);
 * - every run is killed after 60 s; one runs at a time, at most 4 wait.
 * Temp files live in <DATA_DIR>/tmp/audio (0700) under random names and are
 * deleted in `finally`; anything older than an hour is swept at start-up.
 */

const RUN_TIMEOUT_MS = 60_000;
const MAX_WAITING = 4;
const BLOCKED_BRANDS = new Set(['heic', 'heix', 'mif1', 'msf1']);
const FFMPEG_FORMAT = { mov: 'mov', matroska: 'matroska', ogg: 'ogg', mp3: 'mp3', wav: 'wav' };

/** An audio failure the HTTP layer can show: status 400, 415 or 503. */
export class AudioError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// MARK: - Sniffing

/** The ISO-BMFF major brand ("M4A ", "mp42", "isom", "heic"…), or null when the bytes are not an ftyp box. */
export function ftypBrand(bytes) {
  if (!bytes || bytes.length < 12 || bytes.subarray(4, 8).toString('latin1') !== 'ftyp') return null;
  return bytes.subarray(8, 12).toString('latin1');
}

/**
 * The container from magic bytes only: 'mov' | 'matroska' | 'ogg' | 'mp3' |
 * 'wav' | null. HEIF images in an ftyp box are not audio (null).
 */
export function sniffAudio(bytes) {
  if (!bytes || bytes.length < 4) return null;
  const brand = ftypBrand(bytes);
  if (brand) return BLOCKED_BRANDS.has(brand.trim().toLowerCase()) ? null : 'mov';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'matroska';
  const head = bytes.subarray(0, 4).toString('latin1');
  if (head === 'OggS') return 'ogg';
  if (head === 'RIFF' && bytes.length >= 12 && bytes.subarray(8, 12).toString('latin1') === 'WAVE') return 'wav';
  if (head.startsWith('ID3')) return 'mp3';
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3';
  return null;
}

// MARK: - Running ffmpeg

const available = new Map(); // ffmpeg path -> bool

/** Is ffmpeg runnable? Runs `ffmpeg -version` once per path and remembers. */
export function ffmpegAvailable(config) {
  const path = config.ffmpegPath || 'ffmpeg';
  if (!available.has(path)) {
    let ok = false;
    try { ok = spawnSync(path, ['-version'], { stdio: 'ignore', timeout: 5_000 }).status === 0; } catch { ok = false; }
    available.set(path, ok);
  }
  return available.get(path);
}

/** Run ffmpeg with an argument array; resolves {code, stderr}. Killed (SIGKILL) after 60 s. */
function run(config, args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(config.ffmpegPath || 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) { reject(e); return; }
    let stderr = '';
    child.stderr.on('data', d => { if (stderr.length < 64_000) stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), RUN_TIMEOUT_MS);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stderr }); });
  });
}

const inputArgs = (fmt, inPath) => {
  const f = FFMPEG_FORMAT[fmt];
  if (!f) throw new AudioError(415, 'That is not an audio file we can read');
  return ['-nostdin', '-hide_banner', '-protocol_whitelist', 'file', '-f', f, '-i', inPath];
};

const seconds = (h, m, s) => Number(h) * 3600 + Number(m) * 60 + Number(s);

/**
 * Duration and whether there is an audio stream, from ffmpeg's stderr. When the
 * container does not say (browser webm often does not), the audio is decoded
 * once to a null output and the last `time=` is the duration.
 */
export async function probe(config, path, fmt) {
  const first = await run(config, inputArgs(fmt, path));
  const hasAudio = /Stream #\d+:\d+[^\n]*: Audio:/.test(first.stderr);
  let m = /Duration: (\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(first.stderr);
  let secs = m ? seconds(m[1], m[2], m[3]) : null;
  if (hasAudio && secs === null) {
    const full = await run(config, [...inputArgs(fmt, path), '-map', '0:a:0', '-vn', '-f', 'null', '-']);
    const times = [...full.stderr.matchAll(/time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/g)];
    m = times.at(-1);
    secs = m ? seconds(m[1], m[2], m[3]) : null;
  }
  return { seconds: secs, hasAudio };
}

/** Re-encode to AAC in an m4a (mono 64 kbps, metadata stripped, at most capSec + 2 s). */
export async function toM4a(config, inPath, outPath, { fmt, capSec = 300 }) {
  const out = await run(config, [...inputArgs(fmt, inPath), '-t', String(capSec + 2), '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1',
    '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart', '-f', 'mp4', '-y', outPath]);
  if (out.code !== 0) throw new AudioError(415, 'That recording could not be converted');
  return outPath;
}

/** A 16 kHz mono 32 kbps mp3 for the model, in a temp file the caller deletes. */
export async function toModelMp3(config, inPath, { fmt = 'mov' } = {}) {
  const outPath = tempPath(config, 'mp3');
  const out = await run(config, [...inputArgs(fmt, inPath), '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', '-f', 'mp3', '-y', outPath]);
  if (out.code !== 0) {
    rmSync(outPath, { force: true });
    throw new AudioError(415, 'That recording could not be converted');
  }
  return outPath;
}

// MARK: - Temp files

export const audioTempDir = config => join(config.dataDir, 'tmp', 'audio');

export function tempPath(config, ext) {
  const dir = audioTempDir(config);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, `${randomBytes(12).toString('hex')}.${ext}`);
}

/** Remove temp audio files older than an hour (start-up). Returns how many went. */
export function sweepAudioTemp(config, now = Date.now()) {
  let n = 0;
  try {
    const dir = audioTempDir(config);
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      try { if (now - statSync(p).mtimeMs > 3_600_000) { rmSync(p, { force: true }); n++; } } catch { /* gone */ }
    }
  } catch { /* no folder yet */ }
  return n;
}

// MARK: - The queue

let busy = false;
const waiting = [];

/** Run an audio job when nothing else is converting. More than 4 waiting: 503 "Busy, try again in a minute". */
export function audioJob(fn) {
  if (busy && waiting.length >= MAX_WAITING) return Promise.reject(new AudioError(503, 'Busy, try again in a minute'));
  return new Promise((resolve, reject) => {
    waiting.push({ fn, resolve, reject });
    pump();
  });
}

function pump() {
  if (busy || !waiting.length) return;
  busy = true;
  const { fn, resolve, reject } = waiting.shift();
  Promise.resolve().then(fn).then(resolve, reject).finally(() => { busy = false; pump(); });
}

/** Jobs waiting (tests). */
export const audioQueueLength = () => waiting.length + (busy ? 1 : 0);

// MARK: - One call for uploads

/**
 * An uploaded recording to a stored m4a: sniff, probe, refuse what is not
 * audio or is too long, re-encode. Resolves {bytes, seconds}. Throws
 * AudioError: 415 not audio / no audio / cannot convert, 400 too long, 503 busy.
 * Without ffmpeg, an m4a (brand M4A, mp42 or isom) passes as-is with no
 * duration check (the caller then trusts its own figure); anything else is 415.
 */
export async function convertUpload(config, bytes, { capSec = 300, tooLong = 'Voice notes can be up to 5 minutes' } = {}) {
  const fmt = sniffAudio(bytes);
  if (!fmt) throw new AudioError(415, 'No audio in that file');
  if (!ffmpegAvailable(config)) {
    const brand = ftypBrand(bytes)?.trim();
    if (fmt === 'mov' && ['M4A', 'mp42', 'isom'].includes(brand)) return { bytes, seconds: null, converted: false };
    throw new AudioError(415, 'This server can\'t convert that recording; send m4a');
  }
  return audioJob(async () => {
    const inPath = tempPath(config, 'in');
    const outPath = tempPath(config, 'm4a');
    try {
      writeFileSync(inPath, bytes, { mode: 0o600 });
      const p = await probe(config, inPath, fmt);
      if (!p.hasAudio) throw new AudioError(415, 'No audio in that file');
      if (p.seconds !== null && p.seconds > capSec + 2) throw new AudioError(400, tooLong);
      await toM4a(config, inPath, outPath, { fmt, capSec });
      const out = readFileSync(outPath);
      const after = await probe(config, outPath, 'mov');
      return { bytes: out, seconds: after.seconds ?? p.seconds, converted: true };
    } finally {
      rmSync(inPath, { force: true });
      rmSync(outPath, { force: true });
    }
  });
}
