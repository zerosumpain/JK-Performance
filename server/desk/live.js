/*
 * Live updates for the desk (docs/design/desk-v2.md 3.8, D12): the coach's
 * event stream, read with fetch() and a stream reader (EventSource cannot send
 * the Bearer header). Each `event: <type>\ndata: <json>` block reaches the
 * listeners for that type and for '*':
 *
 *   const off = live.on('message.received', ev => …);   // ev = {type, seq, clientId, summary, …}
 *   view.onLeave(off);
 *
 * On an error the stream backs off 2 s, 5 s, 15 s, then 30 s between tries.
 * While it is down (or the server has no stream at all) a synthetic 'poll'
 * event fires every 30 s, so screens that listen for '*' or 'poll' still
 * refresh. Only main.js calls start() and stop().
 */
import { capabilities, getToken } from './core.js';

const BACKOFF = [2_000, 5_000, 15_000, 30_000];
const POLL_MS = 30_000;
const listeners = new Map(); // type → Set(fn)
let running = false;
let mode = 'off'; // off | stream | poll
let controller = null;
let retryTimer = null;
let pollTimer = null;
let failures = 0;
const statusListeners = new Set();

function dispatch(type, data) {
  const ev = { ...(data && typeof data === 'object' ? data : { data }), type };
  for (const key of [type, '*']) {
    for (const fn of listeners.get(key) ?? []) {
      try { fn(ev); } catch (err) { console.warn('live listener', err); }
    }
  }
}

function setMode(next) {
  if (mode === next) return;
  mode = next;
  for (const fn of statusListeners) { try { fn(mode); } catch { /* ignore */ } }
  clearInterval(pollTimer);
  pollTimer = null;
  if (mode === 'poll') pollTimer = setInterval(() => { if (!document.hidden) dispatch('poll', {}); }, POLL_MS);
}

/** Parse one SSE block ("event: x\ndata: {…}"); comments (": ping") are skipped. */
function parseBlock(block) {
  let type = 'message';
  const data = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
    if (field === 'event') type = value;
    else if (field === 'data') data.push(value);
  }
  if (!data.length) return null;
  let parsed;
  try { parsed = JSON.parse(data.join('\n')); } catch { parsed = { data: data.join('\n') }; }
  return [type, parsed];
}

async function connect() {
  clearTimeout(retryTimer);
  if (!running) return;
  const token = getToken();
  if (!token) { stop(); return; }
  controller = new AbortController();
  let res;
  try {
    res = await fetch('/api/coach/stream', { headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' }, signal: controller.signal });
  } catch {
    if (running) retry();
    return;
  }
  if (res.status === 404) { setMode('poll'); return; } // no stream on this server: poll only, never ask again
  if (res.status === 401 || res.status === 403) { stop(); return; }
  if (!res.ok || !res.body) { retry(); return; }
  failures = 0;
  setMode('stream');
  dispatch('live.connected', {});
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value.replace(/\r\n?/g, '\n');
      let cut;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const out = parseBlock(block);
        if (out) dispatch(out[0], out[1]);
      }
    }
  } catch { /* aborted or dropped */ }
  if (running) retry();
}

function retry() {
  setMode('poll');
  const wait = BACKOFF[Math.min(failures, BACKOFF.length - 1)];
  failures++;
  retryTimer = setTimeout(connect, wait);
}

async function start() {
  if (running) return;
  running = true;
  failures = 0;
  const caps = await capabilities();
  if (!running) return;
  if (caps.absent) { setMode('poll'); return; } // an older server: no stream endpoint to try
  connect();
}

function stop() {
  running = false;
  clearTimeout(retryTimer);
  controller?.abort();
  controller = null;
  setMode('off');
}

export const live = {
  /** live.on(type | '*', fn) → off(). */
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  },
  /** 'stream' (connected), 'poll' (fallback) or 'off'. */
  get mode() { return mode; },
  /** fn(mode) when the connection state changes. Returns off(). */
  onStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); },
  /** Deliver an event locally, as if streamed (optimistic updates, the kit page). */
  emit: dispatch,
  start,
  stop,
};
