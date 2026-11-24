/*
 * F19 voice notes on the desk (docs/design/desk-v2.md F19; contract docs/api/wp6-ai-voice.md).
 *
 *   voiceBubble(message, {coachView, onChanged}) → the VoiceBubble: play/pause, a 48-bar waveform
 *     decoded once per media id, elapsed time, 1×/1.5×/2×, the transcript disclosure and, for the
 *     coach, mood, topics, worded flag pills and an action checklist with "→ Task".
 *   recorder({capSec, purpose, onReady}) → the recorder card (MediaRecorder + a live level meter),
 *     with an upload fallback when recording is not possible (no HTTPS, no MediaRecorder).
 *   Registers: composer tools "Voice" and "Attach", the client tab "Voice", the widget "voice-review".
 *
 * Everything from the server (transcripts, quotes, summaries) is set with textContent through h().
 */
import {
  api, apiBlob, apiUpload, avatar, errorLine, fill, firstName, fmtRelative, h, icon, link, live, q, registerClientTab, registerComposerTool,
  registerNav, registerWidget, toast,
} from './core.js';
import { emptyHero, skeleton } from './ui.js';

const enc = encodeURIComponent;
export const fmtSecs = s => { const t = Math.max(0, Math.round(Number(s) || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const BARS = 48;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// The thread badge also moves when a voice note is flagged.
registerNav({ id: 'messages', badge: true, badgeOn: ['message.received', 'voice.flagged'] });

// MARK: - Copy per state (the contract's table)

const MOOD = {
  upbeat: ['Upbeat', 'sentiment_satisfied', 'ok'], steady: ['Steady', 'sentiment_neutral', 'data'], flat: ['Flat', 'sentiment_neutral', 'attention'],
  low: ['Low', 'sentiment_dissatisfied', 'attention'], stressed: ['Stressed', 'sentiment_dissatisfied', 'attention'], unknown: ['Mood unknown', 'sentiment_neutral', 'data'],
};
const FLAG = {
  pain: ['Pain', 'healing'], injury: ['Injury', 'healing'], illness: ['Illness', 'monitor_heart'], mentalHealth: ['Low mood', 'psychology'],
  safeguarding: ['Safeguarding', 'shield'], cancelIntent: ['Wants to cancel', 'heart_broken'], billing: ['Billing', 'payments'],
};
const URGENT = new Set(['pain', 'injury', 'illness', 'mentalHealth', 'safeguarding']);

/** The one line under the player: what state the transcript is in. */
export function stateLine(v, { coachView = true } = {}) {
  switch (v?.status) {
    case 'pending': return 'Transcribing…';
    case 'done': return v.transcript === null || v.transcript === undefined ? 'Transcript removed'
      : v.provider === 'stub' ? 'Sample transcript (AI is off)' : 'Automatic transcript, may contain mistakes';
    case 'off': return v.reason === 'aiOff' ? 'Transcripts are off' : v.reason === 'quota' ? 'Transcript not available today'
      : coachView ? 'Not transcribed' : 'You chose no transcription';
    case 'deleted': return 'Voice note deleted';
    default: return 'Couldn’t transcribe this one';
  }
}

// MARK: - Audio: one shared player, blobs and peaks cached by media id

const cache = new Map(); // mediaId -> Promise<{url, peaks|null}>
function loadAudio(v) {
  if (!v?.url || !v.mediaId) return Promise.reject(new Error('No audio'));
  if (!cache.has(v.mediaId)) {
    const p = apiBlob(v.url).then(async blob => {
      const url = URL.createObjectURL(blob);
      let peaks = null;
      try { peaks = await decodePeaks(await blob.arrayBuffer()); } catch { peaks = null; }
      return { url, peaks };
    });
    p.catch(() => cache.delete(v.mediaId));
    cache.set(v.mediaId, p);
    if (cache.size > 60) cache.delete(cache.keys().next().value);
  }
  return cache.get(v.mediaId);
}

/** 48 peaks (0–1) from the decoded audio, once. Browsers without the codec answer null (placeholder bars stay). */
async function decodePeaks(buf) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) return null;
  const audio = await new Promise((resolve, reject) => {
    const ctx = new Ctx(1, 1, 22050);
    const p = ctx.decodeAudioData(buf, resolve, reject);
    p?.catch?.(reject);
  });
  const data = audio.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / BARS));
  const peaks = [];
  for (let i = 0; i < BARS; i++) {
    let max = 0;
    for (let j = i * step, end = Math.min(data.length, (i + 1) * step); j < end; j += 4) max = Math.max(max, Math.abs(data[j]));
    peaks.push(max);
  }
  const top = Math.max(...peaks, 0.0001);
  return peaks.map(p => Math.max(0.08, p / top));
}

/** Placeholder bars, stable per id, so the shape does not jump before the audio decodes. */
function seededPeaks(seed) {
  let x = 0;
  for (const c of String(seed)) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: BARS }, (_, i) => {
    x = (x * 1664525 + 1013904223) >>> 0;
    const env = Math.sin(Math.PI * (i + 0.5) / BARS) ** 0.6;
    return Math.max(0.12, env * (0.35 + (x / 2 ** 32) * 0.65));
  });
}

let current = null; // {audio, stop}
function takePlayer(entry) {
  if (current && current !== entry) current.stop();
  current = entry;
}

// MARK: - The VoiceBubble

/**
 * voiceBubble(message, {coachView = true, onChanged}): the audio and everything about it.
 * `onChanged(voice)` is called after a retry, so the host can refresh.
 */
export function voiceBubble(m, { coachView = true, onChanged = null } = {}) {
  const v = m.voice || { status: 'deleted' };
  const el = h('div', { class: `vc-bubble vc-${v.status}`, 'data-media': v.mediaId || '' });
  if (v.status === 'deleted') {
    el.append(h('div', { class: 'vc-gone' }, icon('graphic_eq', 18), h('span', null, 'Voice note deleted')));
    return el;
  }
  const total = Number(v.durationSec) || 0;
  let peaks = seededPeaks(v.mediaId || m.id);
  const bars = h('div', { class: 'vc-wave', role: 'slider', tabindex: '0', 'aria-label': 'Position in the voice note', 'aria-valuemin': '0', 'aria-valuemax': String(Math.round(total)), 'aria-valuenow': '0' });
  const drawBars = () => bars.replaceChildren(...peaks.map(p => h('span', { class: 'vc-bar', style: { '--h': `${Math.round(p * 100)}%` } })));
  drawBars();
  const time = h('span', { class: 'vc-time t-num' }, fmtSecs(total));
  const playBtn = h('button', { type: 'button', class: 'vc-play', 'aria-label': 'Play voice note' }, icon('play_arrow', 22, { filled: true }));
  const speeds = [1, 1.5, 2];
  let speed = 0;
  const speedBtn = h('button', { type: 'button', class: 'vc-speed t-num', 'aria-label': 'Playback speed 1×' }, '1×');
  let audio = null, loading = null, raf = 0;

  const entry = { stop: () => { audio?.pause(); } };
  const setPlaying = on => {
    el.classList.toggle('playing', on);
    playBtn.replaceChildren(icon(on ? 'pause' : 'play_arrow', 22, { filled: true }));
    playBtn.setAttribute('aria-label', on ? 'Pause voice note' : 'Play voice note');
  };
  const progress = () => {
    const dur = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : total;
    const pos = audio?.currentTime ?? 0;
    const frac = dur ? Math.min(1, pos / dur) : 0;
    const lit = Math.round(frac * BARS);
    [...bars.children].forEach((b, i) => b.classList.toggle('on', i < lit));
    time.textContent = audio && (pos > 0 || !audio.paused) ? `${fmtSecs(pos)} / ${fmtSecs(dur)}` : fmtSecs(dur);
    bars.setAttribute('aria-valuenow', String(Math.round(pos)));
    bars.setAttribute('aria-valuetext', `${fmtSecs(pos)} of ${fmtSecs(dur)}`);
  };
  const tick = () => { progress(); if (audio && !audio.paused) raf = requestAnimationFrame(tick); };

  function ensure() {
    if (audio) return Promise.resolve(audio);
    if (!loading) {
      el.classList.add('loading');
      loading = loadAudio(v).then(({ url, peaks: real }) => {
        if (real) { peaks = real; drawBars(); }
        audio = new Audio();
        audio.preload = 'auto';
        audio.src = url;
        audio.playbackRate = speeds[speed];
        audio.addEventListener('play', () => { takePlayer(entry); setPlaying(true); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); });
        audio.addEventListener('pause', () => { setPlaying(false); progress(); });
        audio.addEventListener('ended', () => { setPlaying(false); audio.currentTime = 0; progress(); });
        audio.addEventListener('loadedmetadata', progress);
        return audio;
      }).finally(() => el.classList.remove('loading'));
    }
    return loading;
  }
  // Decode the waveform when the bubble scrolls into view (cheap: one request per note, cached).
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => {
      if (!es.some(e => e.isIntersecting)) return;
      io.disconnect();
      loadAudio(v).then(({ peaks: real }) => { if (real && !audio) { peaks = real; drawBars(); } }, () => {});
    });
    requestAnimationFrame(() => io.observe(el));
  }
  let markedListened = !!v.listenedAt;
  playBtn.addEventListener('click', async () => {
    try {
      const a = await ensure();
      if (a.paused) {
        await a.play();
        if (coachView && m.fromRole === 'client' && !markedListened) {
          markedListened = true;
          api('POST', `/api/voice/${enc(m.id)}/listened`).catch(() => { markedListened = false; });
        }
      } else a.pause();
    } catch {
      toast('This browser can’t play that voice note.', { error: true });
    }
  });
  speedBtn.addEventListener('click', () => {
    speed = (speed + 1) % speeds.length;
    speedBtn.textContent = `${speeds[speed]}×`;
    speedBtn.setAttribute('aria-label', `Playback speed ${speeds[speed]}×`);
    if (audio) audio.playbackRate = speeds[speed];
  });
  const seek = async frac => {
    try {
      const a = await ensure();
      const dur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : total;
      a.currentTime = Math.max(0, Math.min(dur, frac * dur));
      progress();
    } catch { /* cannot play here */ }
  };
  bars.addEventListener('click', e => { const r = bars.getBoundingClientRect(); seek((e.clientX - r.left) / r.width); });
  bars.addEventListener('keydown', e => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); playBtn.click(); return; }
    if (!step) return;
    e.preventDefault();
    const dur = audio && Number.isFinite(audio.duration) ? audio.duration : total;
    seek(((audio?.currentTime ?? 0) + step * 5) / (dur || 1));
  });

  el.append(h('div', { class: 'vc-player' }, playBtn, bars, h('div', { class: 'vc-meta' }, time, speedBtn)));
  el.append(details(m, v, { coachView, onChanged }));
  return el;
}

/** The transcript disclosure, then the coach's reading of the note. */
function details(m, v, { coachView, onChanged }) {
  const box = h('div', { class: 'vc-detail' });
  const line = stateLine(v, { coachView });
  if (v.status === 'pending') {
    box.append(h('div', { class: 'vc-pending', role: 'status' }, h('span', { class: 'vc-shimmer', 'aria-hidden': 'true' }), h('span', null, line)));
    return box;
  }
  if (v.status === 'done' && v.transcript) {
    const d = h('details', { class: 'vc-transcript' },
      h('summary', null, icon('description', 16), h('span', null, 'Transcript'), h('span', { class: 'vc-caveat' }, line)),
      h('p', { class: 'vc-text' }, v.transcript));
    box.append(d);
  } else {
    const retry = coachView && (v.status === 'failed' || (v.status === 'off' && v.reason !== 'noConsent'))
      ? h('button', { type: 'button', class: 'vc-link', onclick: async e => {
        e.currentTarget.disabled = true;
        try { const out = await api('POST', `/api/voice/${enc(m.id)}/retry`); toast('Transcription queued'); onChanged?.(out.voice); } catch (err) { toast(err.message, { error: true }); }
      } }, 'Retry transcription') : null;
    box.append(h('div', { class: 'vc-state' }, icon(v.status === 'failed' ? 'error' : 'visibility_off', 15), h('span', null, line), retry));
  }
  if (!coachView || v.status !== 'done') return box;
  if (v.summary) box.append(h('p', { class: 'vc-summary' }, v.summary));
  const chips = [];
  if (v.mood) { const [word, glyph, tone] = MOOD[v.mood] || MOOD.unknown; chips.push(h('span', { class: `vc-chip vc-mood tone-${tone}` }, icon(glyph, 15), word)); }
  for (const f of v.flags || []) {
    const [word, glyph] = FLAG[f.kind] || [f.kind, 'flag'];
    chips.push(h('span', { class: `vc-chip vc-flag ${URGENT.has(f.kind) ? 'urgent' : 'attention'}`, title: f.quote ? `“${f.quote}”` : null },
      icon(glyph, 15), word, f.severity ? h('span', { class: 'vc-sev' }, f.severity) : null));
  }
  for (const t of v.topics || []) chips.push(h('span', { class: 'vc-chip vc-topic' }, t));
  if (chips.length) box.append(h('div', { class: 'vc-chips' }, chips));
  for (const f of (v.flags || []).filter(x => x.quote)) box.append(h('blockquote', { class: 'vc-quote' }, `“${f.quote}”`));
  if (v.actions?.length) {
    box.append(h('div', { class: 'vc-actions' }, h('div', { class: 'vc-actions-head' }, icon('checklist', 15), 'Action items'),
      v.actions.map((a, i) => h('div', { class: 'vc-action' },
        h('span', { class: `vc-owner ${a.owner}` }, a.owner === 'client' ? firstName(m.clientName) || 'Client' : 'You'),
        h('span', { class: 'grow' }, a.text),
        h('button', { type: 'button', class: 'vc-task', title: 'Add as a task', 'aria-label': `Add “${a.text}” as a task`, onclick: async e => {
          const b = e.currentTarget;
          b.disabled = true;
          try { await api('POST', `/api/voice/${enc(m.id)}/tasks`, { indexes: [i] }); b.replaceChildren(icon('check', 14), 'Task'); b.classList.add('done'); }
          catch (err) { b.disabled = false; toast(err.status === 409 ? 'Tasks aren’t on this desk yet.' : err.message, { error: err.status !== 409 }); }
        } }, '→ Task')))));
  }
  return box;
}

// MARK: - The recorder

const MIMES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
export const canRecord = () => !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

/** Read an audio file's length in seconds (null when the browser cannot). */
export function durationOfFile(file) {
  return new Promise(resolve => {
    const a = document.createElement('audio');
    const url = URL.createObjectURL(file);
    const done = v => { URL.revokeObjectURL(url); resolve(v); };
    a.preload = 'metadata';
    a.addEventListener('loadedmetadata', () => done(Number.isFinite(a.duration) ? a.duration : null));
    a.addEventListener('error', () => done(null));
    a.src = url;
  });
}

/**
 * recorder({capSec = 300, warnSec, onReady(blob, secs, {type}), actions}) → element.
 * Record → live level meter and timer → Stop → a preview with play and Re-record, plus `actions(blob, secs)`
 * (buttons the host adds: Send, Transcribe & check, Use this note). Without HTTPS or MediaRecorder it shows the
 * upload fallback, which hands the chosen file to the same actions.
 */
export function recorder({ capSec = 300, warnSec = capSec - 30, actions = () => [], fileAccept = 'audio/*', onClose = null } = {}) {
  const el = h('div', { class: 'vc-rec' });
  let stream = null, rec = null, chunks = [], started = 0, timer = 0, raf = 0, actx = null, previewUrl = null;
  const cleanup = () => {
    clearInterval(timer); cancelAnimationFrame(raf);
    stream?.getTracks().forEach(t => t.stop()); stream = null;
    actx?.close?.().catch?.(() => {}); actx = null;
  };
  el.cleanup = () => { cleanup(); if (previewUrl) URL.revokeObjectURL(previewUrl); };

  function fallback(reason) {
    const input = h('input', { type: 'file', accept: fileAccept, class: 'vc-file', 'aria-label': 'Choose an audio file' });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      const secs = await durationOfFile(f);
      if (secs !== null && secs > capSec + 0.5) { fill(status, errorLine(`That recording is ${fmtSecs(secs)}. The limit is ${fmtSecs(capSec)}.`)); return; }
      preview(f, secs, f.type);
    });
    const status = h('div');
    fill(el, h('div', { class: 'vc-rec-head' }, icon('mic', 18), h('strong', null, 'Voice note')),
      h('p', { class: 'vc-rec-note' }, reason),
      h('label', { class: 'btn vc-upload' }, icon('upload', 18), 'Choose an audio file', input), status);
  }

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      fallback('The microphone isn’t available here. Allow it in the browser, or upload an audio file instead.');
      return;
    }
    const mimeType = MIMES.find(t => MediaRecorder.isTypeSupported?.(t));
    rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks = [];
    rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
    rec.onstop = () => {
      const secs = (performance.now() - started) / 1000;
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || '' });
      cleanup();
      if (!cancelled) preview(blob, Math.min(secs, capSec), blob.type);
    };
    // The level meter.
    const level = h('div', { class: 'vc-level', 'aria-hidden': 'true' }, Array.from({ length: 24 }, () => h('span')));
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      const an = actx.createAnalyser();
      an.fftSize = 256;
      actx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const spans = [...level.children];
      const loop = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const b of buf) peak = Math.max(peak, Math.abs(b - 128) / 128);
        spans.push(spans.shift());
        spans.at(-1).style.setProperty('--h', `${Math.max(8, Math.round(peak * 100))}%`);
        level.append(spans.at(-1));
        raf = requestAnimationFrame(loop);
      };
      if (!reduced()) loop();
    } catch { /* the meter is optional */ }
    const clock = h('span', { class: 'vc-clock t-num' }, '0:00');
    const warn = h('span', { class: 'vc-warn', hidden: true }, `Stops at ${fmtSecs(capSec)}`);
    let cancelled = false;
    fill(el, h('div', { class: 'vc-rec-live' }, h('span', { class: 'vc-dot', 'aria-hidden': 'true' }), h('span', { class: 'vc-rec-label' }, 'Recording'), clock, warn),
      level,
      h('div', { class: 'vc-rec-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => { cancelled = true; rec.state !== 'inactive' && rec.stop(); cleanup(); idle(); } }, 'Cancel'),
        h('button', { type: 'button', class: 'btn primary vc-stop', onclick: () => rec.state !== 'inactive' && rec.stop() }, icon('stop', 18, { filled: true }), 'Stop')));
    started = performance.now();
    rec.start(250);
    timer = setInterval(() => {
      const s = (performance.now() - started) / 1000;
      clock.textContent = fmtSecs(s);
      warn.hidden = s < warnSec;
      if (s >= capSec && rec.state !== 'inactive') rec.stop();
    }, 200);
    el.querySelector('.vc-stop')?.focus();
  }

  function preview(blob, secs, type) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob);
    const player = h('audio', { controls: true, src: previewUrl, class: 'vc-preview', preload: 'metadata' });
    const out = h('div', { class: 'vc-rec-out' });
    fill(el, h('div', { class: 'vc-rec-head' }, icon('graphic_eq', 18), h('strong', null, 'Voice note'), secs ? h('span', { class: 'faint t-num' }, ` · ${fmtSecs(secs)}`) : null),
      player,
      h('div', { class: 'vc-rec-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => (canRecord() ? start() : fallback('Choose another file.')) }, icon('mic', 18), canRecord() ? 'Re-record' : 'Choose again'),
        h('span', { class: 'grow' }),
        actions(blob, secs, { type, out })),
      out);
  }

  function idle() {
    if (!canRecord()) {
      fallback(window.isSecureContext ? 'This browser can’t record audio. Upload an audio file instead.' : 'Recording needs HTTPS. Upload an audio file instead.');
      return;
    }
    fill(el, h('div', { class: 'vc-rec-head' }, icon('mic', 18), h('strong', null, 'Voice note'), h('span', { class: 'faint' }, ` · up to ${fmtSecs(capSec)}`)),
      h('div', { class: 'vc-rec-row' },
        onClose ? h('button', { type: 'button', class: 'btn', onclick: () => onClose() }, 'Close') : null,
        h('span', { class: 'grow' }),
        h('button', { type: 'button', class: 'btn primary', onclick: start }, icon('mic', 18), 'Record')));
  }
  idle();
  return el;
}

/** Upload a recording as a voice note for one client: POST /api/media?purpose=voice. */
export async function uploadVoice(blob, { clientId, secs, purpose = 'voice' }) {
  const type = blob.type ? blob.type.split(';')[0] : 'application/octet-stream';
  return apiUpload(`/api/media?${q({ purpose, clientId, durationSec: secs ? Math.min(purpose === 'letter' ? 90 : 300, Math.round(secs)) : undefined })}`, blob, type);
}

// MARK: - Composer tools: Voice and Attach

/** The AI check of a recording (F18) is supplied by f-ai.js, which registers it here. */
let voiceCheck = null;
export const setVoiceCheck = fn => { voiceCheck = fn; };

/**
 * composerPanel(composer, key, build(box, close)) → {el, close}: a panel in the composer's own panel area,
 * above the text box (where send guards show theirs), so it grows with its content and never clips like a
 * popover. One panel per key; Esc inside it closes it; `box.cleanup` runs however it goes (a send clears it).
 */
export function composerPanel(composer, key, build) {
  const host = composer.el.querySelector('.cmp-panels');
  if (!host) return null;
  host.querySelector(`[data-panel="${key}"]`)?.closePanel?.();
  const box = h('div', { class: 'cmp-panel vc-panel', 'data-panel': key });
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    obs.disconnect();
    box.cleanup?.();
    box.remove();
  };
  box.closePanel = close;
  box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); composer.focus(); } });
  const obs = new MutationObserver(() => { if (!box.isConnected) close(); });
  build(box, close);
  host.append(box);
  obs.observe(host, { childList: true });
  requestAnimationFrame(() => box.querySelector('button:not([disabled]), input')?.focus({ preventScroll: true }));
  return { el: box, close };
}

function openRecorder(composer, ctx) {
  if (!ctx.clientId) { toast('Voice notes go to one client at a time.', { error: true }); return; }
  let uploaded = null; // {blob, media}
  composerPanel(composer, 'voice', (box, close) => {
    const upload = async blob => {
      if (uploaded?.blob === blob) return uploaded.media;
      const media = await uploadVoice(blob, { clientId: ctx.clientId, secs: null });
      uploaded = { blob, media };
      return media;
    };
    const rec = recorder({
      capSec: 300, onClose: close,
      actions: (blob, secs, { out }) => {
        const attach = async (andSend, btn) => {
          btn.disabled = true;
          try {
            const media = await upload(blob);
            composer.attach({ mediaId: media.id, kind: 'voice', durationSec: media.durationSec ?? secs, label: 'Voice note' });
            close();
            if (andSend) composer.el.querySelector('.cmp-send')?.click();
            else composer.focus();
          } catch (err) { btn.disabled = false; fill(out, errorLine(err)); }
        };
        const checkBtn = voiceCheck ? h('button', { type: 'button', class: 'btn', onclick: async e => {
          const b = e.currentTarget;
          b.disabled = true;
          fill(out, skeleton('lines', { rows: 3 }));
          try {
            const media = await upload(blob);
            await voiceCheck({ clientId: ctx.clientId, media, out, composer, send: () => attach(true, b), close });
          } catch (err) { fill(out, errorLine(err)); }
          b.disabled = false;
        } }, icon('auto_awesome', 18), 'Transcribe & check') : null;
        return [checkBtn, h('button', { type: 'button', class: 'btn primary', onclick: e => attach(true, e.currentTarget) }, icon('send', 18), 'Send')];
      },
    });
    box.cleanup = () => rec.cleanup();
    box.append(rec);
  });
}

registerComposerTool({ id: 'voice', icon: 'mic', label: 'Voice', order: 20, run: (composer, ctx) => openRecorder(composer, ctx) });
registerComposerTool({
  id: 'attach', icon: 'upload', label: 'Attach', order: 25,
  run: (composer, ctx) => {
    if (!ctx.clientId) { toast('Audio goes to one client at a time.', { error: true }); return; }
    const input = h('input', { type: 'file', accept: 'audio/*', hidden: true });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return;
      try {
        const secs = await durationOfFile(f);
        if (secs !== null && secs > 300.5) throw new Error(`That recording is ${fmtSecs(secs)}. Voice notes can be up to 5 minutes.`);
        toast('Uploading…', { ms: 1500 });
        const media = await uploadVoice(f, { clientId: ctx.clientId, secs });
        composer.attach({ mediaId: media.id, kind: 'voice', durationSec: media.durationSec ?? secs, label: f.name.length > 28 ? 'Voice note' : f.name });
        composer.focus();
      } catch (err) { toast(err.message, { error: true }); }
    });
    document.body.append(input);
    input.click();
  },
});

// MARK: - Client tab "Voice": the transcripts list, with search and flags

function voiceRow(item, { onChanged } = {}) {
  const m = { ...item.message, clientName: item.client?.name };
  const fromClient = m.fromRole === 'client';
  const flags = item.voice?.flags || [];
  return h('article', { class: 'vc-row' + (flags.some(f => URGENT.has(f.kind)) ? ' flagged' : '') },
    h('header', { class: 'vc-row-head' },
      fromClient ? avatar(item.client?.name || '?', 28) : h('span', { class: 'vc-me' }, icon('mic', 16)),
      h('div', { class: 'grow' },
        h('div', { class: 'strong small' }, fromClient ? `From ${firstName(item.client?.name)}` : 'You sent'),
        h('div', { class: 'tiny faint' }, `${fmtRelative(m.at)} · ${fmtSecs(item.voice?.durationSec)}`)),
      link(`/messages/${enc(m.clientId)}`, { class: 'btn small' }, 'Open thread')),
    voiceBubble(m, { coachView: true, onChanged }));
}

registerClientTab({
  key: 'voice', label: 'Voice', order: 70,
  render: async (box, { client, view }) => {
    const state = { q: '', flagged: false };
    const list = h('div', { class: 'vc-list' }, skeleton('card', { rows: 3 }));
    const consent = h('span', { class: 'vc-consent' });
    const search = h('input', { type: 'search', class: 'vc-search', placeholder: 'Search what they said', 'aria-label': 'Search transcripts' });
    const flagBtn = h('button', { type: 'button', class: 'vc-filter', 'aria-pressed': 'false' }, icon('flag', 16), 'Flagged');
    box.append(h('div', { class: 'vc-tab-head' }, h('div', { class: 'vc-tab-title' }, h('h3', { class: 't-title' }, 'Voice notes'), consent),
      h('div', { class: 'vc-tab-tools' }, search, flagBtn)), list);
    api('GET', `/api/coach/clients/${enc(client.id)}/ai-consent`).then(c => fill(consent, consentChip(c.voice)), () => {});
    let t = 0;
    const load = async () => {
      try {
        const out = await api('GET', `/api/voice?${q({ clientId: client.id, q: state.q.length >= 2 ? state.q : '', flagged: state.flagged ? '1' : '' })}`);
        if (view && !view.fresh()) return;
        fill(list, out.items.length ? out.items.map(i => voiceRow(i, { onChanged: load }))
          : emptyHero({ icon: 'mic', title: state.q || state.flagged ? 'Nothing matches.' : 'No voice notes yet.', line: state.q || state.flagged ? 'Try another word, or clear the filter.' : `Voice notes between you and ${firstName(client.name)} show here, with their transcripts.` }));
      } catch (err) { fill(list, errorLine(err)); }
    };
    search.addEventListener('input', () => { clearTimeout(t); state.q = search.value.trim(); t = setTimeout(load, 250); });
    flagBtn.addEventListener('click', () => { state.flagged = !state.flagged; flagBtn.setAttribute('aria-pressed', String(state.flagged)); flagBtn.classList.toggle('on', state.flagged); load(); });
    await load();
  },
});

/** "Voice AI: allowed / not asked / declined" (F5 header chip; also the thread's context pane). */
export function consentChip(voice) {
  const [word, tone] = voice === 'on' ? ['allowed', 'ok'] : voice === 'off' ? ['declined', 'attention'] : ['not asked', 'data'];
  return h('span', { class: 'pill vc-consent-pill' }, h('span', { class: `dot bg-${tone}`, 'aria-hidden': 'true' }), `Voice AI: ${word}`);
}

// MARK: - Today widget "Voice notes to review"

registerWidget({
  id: 'voice-review', title: 'Voice notes', size: 'm', tall: false, order: 45,
  render: async (body, view) => {
    fill(body, skeleton('lines', { rows: 4 }));
    const draw = async () => {
      let out;
      try { out = await api('GET', '/api/voice?limit=30'); } catch (err) { fill(body, errorLine(err)); return; }
      if (view && !view.fresh?.()) return;
      const fromClients = out.items.filter(i => i.message.fromRole === 'client');
      const toHear = fromClients.filter(i => !i.voice?.listenedAt);
      const rank = i => (i.voice?.flags || []).some(f => URGENT.has(f.kind)) ? 0 : (i.voice?.flags || []).length ? 1 : 2;
      const rows = [...toHear].sort((a, b) => rank(a) - rank(b) || b.message.at.localeCompare(a.message.at)).slice(0, 4);
      const flagged = toHear.filter(i => rank(i) === 0).length;
      fill(body,
        h('div', { class: 'vc-w-stats' },
          h('div', null, h('div', { class: 't-number' }, String(toHear.length)), h('div', { class: 'tiny faint' }, 'to hear')),
          h('div', null, h('div', { class: 't-number tone-urgent' }, String(flagged)), h('div', { class: 'tiny faint' }, 'flagged'))),
        rows.length ? h('div', { class: 'vc-w-list' }, rows.map(i => {
          const f = (i.voice?.flags || [])[0];
          const [word, glyph, tone] = MOOD[i.voice?.mood] || [];
          return link(`/messages/${enc(i.message.clientId)}`, { class: 'vc-w-row' },
            avatar(i.client.name, 30),
            h('div', { class: 'grow' },
              h('div', { class: 'spread' }, h('span', { class: 'strong small' }, i.client.name), h('span', { class: 'tiny faint t-num' }, fmtSecs(i.voice?.durationSec))),
              h('div', { class: 'tiny faint clamp1' }, i.voice?.summary || stateLine(i.voice))),
            f ? h('span', { class: `vc-chip vc-flag ${URGENT.has(f.kind) ? 'urgent' : 'attention'}` }, icon((FLAG[f.kind] || [])[1] || 'flag', 14), (FLAG[f.kind] || [f.kind])[0])
              : word ? h('span', { class: `vc-chip vc-mood tone-${tone}` }, icon(glyph, 14), word) : null);
        })) : h('p', { class: 'small faint vc-w-empty' }, 'All voice notes heard.'));
    };
    await draw();
    view?.onLeave?.(live.on('voice.analysed', () => draw()));
  },
});
