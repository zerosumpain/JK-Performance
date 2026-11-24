import { PassThrough } from 'node:stream';
import { requireCoach } from './access.mjs';
import { raw } from './http.mjs';

/**
 * The desk's live updates (docs/design/desk-v2.md 3.8): GET /api/coach/stream
 * answers text/event-stream and stays open. Events reach it from drainEvents
 * (committed rows only); notifications through afterCommit. The desk reads it
 * with fetch() and a stream reader, since EventSource cannot send the Bearer
 * header. At most 4 streams per coach: a fifth closes the oldest.
 */

const MAX_PER_COACH = 4;
const PING_MS = 25_000;
const streams = new Map(); // coachId -> [{ out, opened }]
let pinger = null;

function frame(type, data) {
  return `event: ${String(type).replace(/[\r\n]/g, '')}\ndata: ${JSON.stringify(data)}\n\n`;
}

function remove(coachId, entry) {
  const list = streams.get(coachId);
  if (!list) return;
  const i = list.indexOf(entry);
  if (i >= 0) list.splice(i, 1);
  if (!list.length) streams.delete(coachId);
  if (!streams.size && pinger) { clearInterval(pinger); pinger = null; }
}

function open(req, ctx) {
  requireCoach(ctx);
  const coachId = ctx.user.id;
  const out = new PassThrough();
  const entry = { out, opened: Date.now() };
  const list = streams.get(coachId) ?? [];
  streams.set(coachId, list);
  list.push(entry);
  while (list.length > MAX_PER_COACH) {
    const oldest = list[0];
    remove(coachId, oldest);
    oldest.out.end();
  }
  const done = () => remove(coachId, entry);
  req.on('close', done);
  out.on('close', done);
  out.write(': connected\n\n');
  if (!pinger) {
    pinger = setInterval(() => { for (const l of streams.values()) for (const s of l) s.out.write(': ping\n\n'); }, PING_MS);
    pinger.unref?.();
  }
  return raw(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    'x-accel-buffering': 'no',
    'x-content-type-options': 'nosniff',
  }, out);
}

/** Write one message to every open stream of a coach. Returns how many streams got it. */
export function sendToCoach(coachId, type, data) {
  const list = streams.get(coachId);
  if (!list) return 0;
  const text = frame(type, data);
  for (const s of list) s.out.write(text);
  return list.length;
}

/** How many streams a coach has open (tests and diagnostics). */
export const openStreams = coachId => (coachId ? streams.get(coachId)?.length ?? 0 : [...streams.values()].reduce((n, l) => n + l.length, 0));

/** End every open stream (SIGTERM, test teardown): an event stream never goes idle by itself. */
export function closeAllStreams() {
  for (const [coachId, list] of [...streams]) for (const s of [...list]) { remove(coachId, s); s.out.end(); }
}

export function streamRoutes(r) {
  r.add('GET', '/api/coach/stream', open);
}
