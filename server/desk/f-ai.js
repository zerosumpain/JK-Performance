/*
 * F18 on the desk: the AI second opinion and drafting assist (docs/design/desk-v2.md F18).
 *
 * - Composer tool "Check" (auto_awesome): a review in a popover. Send guard "ai-review" (order 10):
 *   review mode off = nothing; ask = the Check button only; always = every send is checked.
 * - The review panel: a worded verdict pill with a glyph, the summary, the issues (kind chip,
 *   the quote highlighted in the draft, a note), "What I checked against", the rewrite as a
 *   word-level LCS diff, and Send original · Use rewrite · Edit · Dismiss. A stop needs a second
 *   click ("Send anyway") and records `overridden`.
 * - Composer tool "Draft": an intent and a note, the draft lands in the composer marked "AI draft".
 * - Send guard "route-to-approval" (order 20, only with prefs review.routeToApproval on).
 * - Settings › AI, the review log (/account/ai?log=1), and the client action "AI brief".
 * Nothing here sends: the coach's own Send click does, through the composer.
 */
import {
  api, errorLine, fill, firstName, fmtRelative, foundationApi, h, hashQuery, icon, link, prefs, registerClientAction,
  registerComposerTool, registerSendGuard, registerSettingsSection, switchRow, toast,
} from './core.js';
import { composerPanel, setVoiceCheck } from './f-voice.js';
import { popover, progressBar, skeleton, slideOver } from './ui.js';

const enc = encodeURIComponent;
const VERDICT = {
  ok: { word: 'Looks good', glyph: 'verified', tone: 'ok' },
  caution: { word: 'Worth a look', glyph: 'gpp_maybe', tone: 'attention' },
  stop: { word: 'Stop and check', glyph: 'warning', tone: 'urgent' },
};
const KIND = { safety: 'Safety', consistency: 'Consistency', tone: 'Tone', clarity: 'Clarity', scope: 'Scope' };
const DECISION = {
  pending: 'No decision', sentOriginal: 'Sent as written', usedRewrite: 'Used the rewrite', edited: 'Edited', dismissed: 'Dismissed',
  overridden: 'Sent despite a stop', pendingApproval: 'Waiting for approval', approved: 'Approved', rejected: 'Discarded',
};
const INTENTS = [['reply', 'Reply'], ['nudge', 'Nudge'], ['celebrate', 'Celebrate'], ['reschedule', 'Reschedule'], ['free', 'Free text']];

// MARK: - Status (cached), and the composer tool visibility it drives

let statusP = null, statusAt = 0;
export function aiStatus(force = false) {
  if (!statusP || force || Date.now() - statusAt > 60_000) {
    statusAt = Date.now();
    statusP = foundationApi('GET', '/api/ai/status').then(s => {
      const root = document.documentElement;
      root.dataset.aiReview = s?.enabled === false ? 'off' : s?.reviewMode ?? 'off';
      root.dataset.aiDrafts = s?.enabled !== false && s?.drafts ? 'on' : 'off';
      return s;
    }).catch(() => null);
  }
  return statusP;
}

// MARK: - The word-level diff (LCS)

/** Words and the spaces between them, so the diff keeps the coach's spacing. */
const tokens = s => String(s ?? '').split(/(\s+)/).filter(t => t !== '');
/** [{op:'same'|'ins'|'del', text}] from a longest common subsequence of tokens. */
export function wordDiff(a, b) {
  const x = tokens(a), y = tokens(b);
  if (x.length * y.length > 400_000) return [{ op: 'del', text: a }, { op: 'ins', text: b }];
  const n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  const push = (op, text) => { const last = out.at(-1); if (last?.op === op) last.text += text; else out.push({ op, text }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { push('same', x[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) push('del', x[i++]);
    else push('ins', y[j++]);
  }
  while (i < n) push('del', x[i++]);
  while (j < m) push('ins', y[j++]);
  return out;
}

const diffView = (a, b) => h('p', { class: 'ai-diff' }, wordDiff(a, b).map(p => p.op === 'same' ? p.text
  : h(p.op === 'ins' ? 'ins' : 'del', { class: `ai-${p.op}` }, p.text)));

/** The draft with each issue's quote highlighted (first match, no overlaps). */
function marked(text, issues) {
  const lower = text.toLowerCase();
  const ranges = [];
  for (const it of issues) {
    const qt = String(it.quote || '').trim();
    if (qt.length < 2) continue;
    const at = lower.indexOf(qt.toLowerCase());
    if (at < 0 || ranges.some(r => at < r.end && at + qt.length > r.start)) continue;
    ranges.push({ start: at, end: at + qt.length, kind: it.kind });
  }
  ranges.sort((p, r) => p.start - r.start);
  const parts = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) parts.push(text.slice(pos, r.start));
    parts.push(h('mark', { class: `ai-mark ai-k-${r.kind}` }, text.slice(r.start, r.end)));
    pos = r.end;
  }
  parts.push(text.slice(pos));
  return h('p', { class: 'ai-draft-text' }, parts);
}

// MARK: - The review panel

export const verdictPill = v => {
  const x = VERDICT[v] || VERDICT.caution;
  return h('span', { class: `ai-verdict tone-${x.tone}` }, icon(x.glyph, 18, { filled: true }), x.word);
};
const providerTag = r => h('span', { class: 'ai-provider' }, r.provider === 'stub' ? 'AI · stub' : r.provider === 'openrouter' ? `AI · ${r.model || 'OpenRouter'}` : 'AI');

/**
 * reviewPanel(review, {draft, transcript, onSendOriginal, onUseRewrite, onEdit, onDismiss, sendLabel}) → element.
 * A `stop` makes Send original ask twice ("Send anyway").
 */
export function reviewPanel(r, { draft, transcript = null, onSendOriginal, onUseRewrite, onEdit, onDismiss, sendLabel = 'Send original' } = {}) {
  const el = h('div', { class: `ai-panel ai-${r.verdict}` });
  el.append(h('div', { class: 'ai-panel-head' }, verdictPill(r.verdict), h('span', { class: 'grow' }), providerTag(r)));
  el.append(h('p', { class: 'ai-summary' }, r.summary));
  if (transcript) el.append(h('details', { class: 'ai-transcript', open: true }, h('summary', null, icon('graphic_eq', 16), 'What you said'), h('p', null, transcript)));
  if (r.issues?.length) {
    el.append(h('div', { class: 'ai-section' }, h('div', { class: 'ai-label' }, 'In your draft'), marked(draft, r.issues)));
    el.append(h('ul', { class: 'ai-issues' }, r.issues.map(i => h('li', { class: `ai-issue sev-${i.severity}` },
      h('span', { class: `ai-kind ai-k-${i.kind}` }, KIND[i.kind] || i.kind),
      h('div', { class: 'grow' }, h('div', { class: 'ai-note' }, i.note), i.quote ? h('div', { class: 'ai-quote' }, `“${i.quote}”`) : null)))));
  }
  if (r.rewrite) el.append(h('div', { class: 'ai-section' }, h('div', { class: 'ai-label' }, icon('auto_awesome', 14), 'Suggested rewrite'), diffView(draft, r.rewrite)));
  if (r.factsUsed?.length) {
    el.append(h('details', { class: 'ai-facts' }, h('summary', null, icon('visibility', 15), `What I checked against (${r.factsUsed.length})`),
      h('ul', null, r.factsUsed.map(f => h('li', null, f)))));
  }
  let armed = false;
  const sendBtn = onSendOriginal ? h('button', { type: 'button', class: 'btn small' + (r.verdict === 'stop' ? ' danger' : ''), onclick: () => {
    if (r.verdict === 'stop' && !armed) { armed = true; sendBtn.textContent = 'Send anyway'; sendBtn.classList.add('armed'); return; }
    onSendOriginal(r.verdict === 'stop' ? 'overridden' : 'sentOriginal');
  } }, sendLabel) : null;
  el.append(h('div', { class: 'ai-buttons' },
    onDismiss ? h('button', { type: 'button', class: 'btn text small', onclick: () => onDismiss() }, 'Dismiss') : null,
    onEdit ? h('button', { type: 'button', class: 'btn small', onclick: () => onEdit() }, icon('edit', 16), 'Edit') : null,
    h('span', { class: 'grow' }),
    sendBtn,
    r.rewrite && onUseRewrite ? h('button', { type: 'button', class: 'btn primary small', onclick: () => onUseRewrite() }, icon('auto_awesome', 16), 'Use rewrite') : null));
  return el;
}

const decide = (id, decision, messageId) => api('POST', `/api/ai/review/${enc(id)}/decision`, { decision, ...(messageId ? { messageId } : {}) }).catch(() => {});

// MARK: - Per-composer state: the last review and what the coach did with it

const states = new WeakMap(); // composer api -> {reviewId, original, rewrite, verdict, override}

/** What the next send of this composer means for its review: {reviewId, decision} or null. */
function consume(composer, text) {
  const st = states.get(composer);
  if (!st) return null;
  const decision = text === st.original ? (st.verdict === 'stop' || st.override ? 'overridden' : 'sentOriginal') : text === st.rewrite ? 'usedRewrite' : 'edited';
  return { reviewId: st.reviewId, decision };
}

const surfaceOf = ctx => (ctx.audience ? 'broadcast' : 'message');
const runReview = (ctx, text) => api('POST', '/api/ai/review', { clientId: ctx.clientId || undefined, surface: surfaceOf(ctx), text, audience: ctx.audience || undefined });

// MARK: - Composer tool: Check

registerComposerTool({
  id: 'ai-check', icon: 'auto_awesome', label: 'Check', order: 40,
  run: (composer, ctx) => {
    const text = composer.getText().trim();
    if (!text) { toast('Write the message first, then check it.'); return; }
    composerPanel(composer, 'ai-check', (box, close) => {
      box.classList.add('ai-check-panel');
      box.append(h('div', { class: 'ai-pop-head' }, icon('auto_awesome', 16), h('strong', null, 'Second opinion'), h('span', { class: 'faint' }, ' · reading your draft…')), skeleton('lines', { rows: 3 }));
      runReview(ctx, text).then(r => {
        if (!box.isConnected) return;
        states.set(composer, { reviewId: r.id, original: text, rewrite: r.rewrite, verdict: r.verdict, override: false });
        fill(box, reviewPanel(r, {
          draft: text,
          onSendOriginal: decision => {
            states.set(composer, { ...states.get(composer), override: decision === 'overridden' });
            close();
            composer.el.querySelector('.cmp-send')?.click();
          },
          onUseRewrite: () => { composer.setText(r.rewrite); close(); composer.focus(); },
          onEdit: () => { close(); composer.focus(); },
          onDismiss: () => { decide(r.id, 'dismissed'); states.delete(composer); close(); composer.focus(); },
        }));
        box.querySelector('.ai-buttons .btn.primary, .ai-buttons .btn')?.focus({ preventScroll: true });
      }, err => fill(box, h('div', { class: 'ai-pop-head' }, icon('auto_awesome', 16), h('strong', null, 'Second opinion'), h('span', { class: 'grow' }),
        h('button', { type: 'button', class: 'btn text small', onclick: () => close() }, 'Close')), errorLine(err)));
    });
  },
});

// MARK: - Send guard: ai-review

/** A panel inside the composer for a review that needs the coach (always mode). */
function guardPanel(r, text, composer, ctx) {
  return reviewPanel(r, {
    draft: text,
    onSendOriginal: decision => ctx.proceed({ reviewId: r.id, decision }),
    onUseRewrite: () => { states.set(composer, { reviewId: r.id, original: text, rewrite: r.rewrite, verdict: r.verdict }); composer.setText(r.rewrite); ctx.dismiss(); },
    onEdit: () => { states.set(composer, { reviewId: r.id, original: text, rewrite: r.rewrite, verdict: r.verdict }); ctx.dismiss(); },
    onDismiss: () => { decide(r.id, 'dismissed'); states.delete(composer); ctx.dismiss(); },
  });
}

registerSendGuard({
  id: 'ai-review', label: 'AI check', order: 10,
  check: async (draft, ctx) => {
    const text = (draft.text || '').trim();
    if (!text) return { ok: true }; // a voice note on its own is checked with "Transcribe & check"
    const s = await aiStatus();
    const mode = s?.enabled === false ? 'off' : s?.reviewMode ?? 'off';
    const prior = consume(ctx.composer, text);
    if (prior && !(mode === 'always' && prior.decision === 'edited')) { states.delete(ctx.composer); return { ok: true, meta: prior }; }
    if (mode !== 'always') return { ok: true };
    let r;
    try { r = await runReview(ctx, text); } catch (err) {
      return { ok: false, panel: h('div', { class: 'ai-panel ai-error' },
        h('div', { class: 'ai-panel-head' }, icon('error', 18), h('strong', null, 'The AI check didn’t run')), h('p', { class: 'ai-summary' }, err.message),
        h('div', { class: 'ai-buttons' }, h('button', { type: 'button', class: 'btn text', onclick: () => ctx.dismiss() }, 'Keep editing'), h('span', { class: 'grow' }),
          h('button', { type: 'button', class: 'btn', onclick: () => ctx.proceed({}) }, 'Send without a check'))) };
    }
    states.delete(ctx.composer);
    if (r.verdict === 'ok') { toast('AI check: looks good', { ms: 1800 }); return { ok: true, meta: { reviewId: r.id, decision: 'sentOriginal' } }; }
    return { ok: false, panel: guardPanel(r, text, ctx.composer, ctx) };
  },
});

// MARK: - Send guard: route to JK for approval (D13, reserved; off by default)

registerSendGuard({
  id: 'route-to-approval', label: 'Approval routing', order: 20,
  check: async (draft, ctx) => {
    if (!ctx.clientId || !(draft.text || '').trim() || draft.kind === 'voice') return { ok: true };
    const on = await prefs.get('review.routeToApproval', false);
    if (!on) return { ok: true };
    return { ok: false, panel: h('div', { class: 'ai-panel ai-approval' },
      h('div', { class: 'ai-panel-head' }, h('span', { class: 'ai-verdict tone-attention' }, icon('approval', 18, { filled: true }), 'Route for approval')),
      h('p', { class: 'ai-summary' }, 'Approval routing is on: this draft waits in your Inbox until it is approved. Nothing is sent.'),
      h('div', { class: 'ai-buttons' },
        h('button', { type: 'button', class: 'btn text', onclick: () => ctx.dismiss() }, 'Keep editing'), h('span', { class: 'grow' }),
        h('button', { type: 'button', class: 'btn', onclick: () => ctx.proceed({}) }, 'Send now'),
        h('button', { type: 'button', class: 'btn primary', onclick: async e => {
          e.currentTarget.disabled = true;
          try {
            await api('POST', '/api/ai/approvals', { clientId: ctx.clientId, surface: 'message', text: draft.text });
            ctx.composer.setText('');
            toast('Parked in your Inbox for approval');
            ctx.dismiss();
          } catch (err) { toast(err.message, { error: true }); e.currentTarget.disabled = false; }
        } }, icon('approval', 16), 'Park for approval'))) };
  },
});

// MARK: - Composer tool: Draft

function markDraft(composer, text) {
  const boxEl = composer.el.querySelector('.cmp-box');
  boxEl?.querySelector('.ai-draft-chip')?.remove();
  const chip = h('span', { class: 'ai-draft-chip' }, icon('auto_awesome', 13), 'AI draft');
  boxEl?.prepend(chip);
  const input = composer.el.querySelector('.cmp-input');
  const off = () => { if (composer.getText() !== text) { chip.remove(); input?.removeEventListener('input', off); } };
  input?.addEventListener('input', off);
}

registerComposerTool({
  id: 'ai-draft', icon: 'edit_note', label: 'Draft', order: 45,
  run: (composer, ctx) => {
    if (!ctx.clientId) { toast('Drafts are written for one client.'); return; }
    popover(ctx.anchor || composer.el, (box, close) => {
      let intent = composer.getText().trim() ? 'free' : 'reply';
      const seg = h('div', { class: 'ui-seg ai-intents', role: 'radiogroup', 'aria-label': 'Kind of message' });
      const drawSeg = () => seg.replaceChildren(...INTENTS.map(([v, label]) => h('button', {
        type: 'button', role: 'radio', class: v === intent ? 'sel' : '', 'aria-checked': String(v === intent), onclick: () => { intent = v; drawSeg(); },
      }, label)));
      drawSeg();
      const note = h('textarea', { class: 'ai-note-input', rows: '2', maxlength: '500', placeholder: 'Anything it should say? (optional)', 'aria-label': 'Note for the draft' });
      note.value = composer.getText().trim().slice(0, 500);
      const out = h('div');
      const go = h('button', { type: 'button', class: 'btn primary', onclick: async () => {
        go.disabled = true;
        fill(out, skeleton('lines', { rows: 2 }));
        try {
          const d = await api('POST', '/api/ai/draft', { clientId: ctx.clientId, intent, note: note.value.trim() || undefined });
          composer.setText(d.text);
          markDraft(composer, d.text);
          close();
          composer.focus();
        } catch (err) { fill(out, errorLine(err)); go.disabled = false; }
      } }, icon('auto_awesome', 16), 'Write a draft');
      box.append(h('div', { class: 'ai-pop-head' }, icon('edit_note', 16), h('strong', null, 'Draft a message')), seg, note,
        h('p', { class: 'tiny faint ai-pop-line' }, 'It lands in the box for you to edit. Nothing is sent until you press Send.'), out, h('div', { class: 'ai-buttons' }, h('span', { class: 'grow' }), go));
    }, { className: 'ai-pop ai-pop-draft', label: 'AI draft' });
  },
});

// MARK: - Voice: Transcribe & check (the recorder in f-voice.js calls this)

setVoiceCheck(async ({ clientId, media, out, send }) => {
  const r = await api('POST', '/api/ai/review/voice', { clientId, mediaId: media.id });
  fill(out, reviewPanel(r, {
    draft: r.transcript, transcript: r.transcript, sendLabel: 'Send recording',
    onSendOriginal: decision => { decide(r.id, decision); send(); },
    onDismiss: () => { decide(r.id, 'dismissed'); fill(out); },
  }));
});

// MARK: - Client action: "Last 14 days in brief"

export function briefBody(box, client) {
  const list = h('div', { class: 'ai-brief' }, skeleton('lines', { rows: 3 }));
  const meta = h('div', { class: 'tiny faint' });
  const load = async () => {
    fill(list, skeleton('lines', { rows: 3 }));
    try {
      const s = await api('POST', `/api/coach/clients/${enc(client.id)}/ai-summary`, { days: 14 });
      fill(list, h('ul', { class: 'ai-bullets' }, s.bullets.map(b => h('li', null, b))));
      fill(meta, `${s.provider === 'stub' ? 'AI · stub' : `AI · ${s.model || 'OpenRouter'}`} · ${fmtRelative(s.at)}`);
    } catch (err) { fill(list, errorLine(err)); }
  };
  box.append(h('div', { class: 'ai-brief-head' }, h('div', { class: 'ui-eyebrow' }, 'Last 14 days in brief'), h('span', { class: 'grow' }),
    h('button', { type: 'button', class: 'ui-icon-btn', 'aria-label': 'Refresh the brief', title: 'Refresh', onclick: load }, icon('sync', 16))), list, meta);
  load();
}

registerClientAction({
  id: 'ai-brief', label: 'AI brief', icon: 'summarize', order: 60,
  run: client => slideOver(`${firstName(client.name)}: last 14 days`, body => {
    briefBody(body, client);
    body.append(h('p', { class: 'small faint ai-brief-note' }, 'Built from first names, counts and short redacted excerpts. Never health samples, photos or money.'));
  }),
});

// MARK: - Settings › AI

const SENT = [
  ['For advice checks', 'Your draft; the client’s first name, plan, goal; injuries and limitations from their intake; pain flags and notes from their last 4 check-ins; priorities and this week’s commitments; the next session; the last 8 messages; an active campaign.'],
  ['For voice notes', 'The recording as made (audio can’t be redacted) and the first name, only when the client has allowed it in the app. Your own notes are covered by the switch below.'],
  ['For briefs and drafts', 'First names, counts and short message excerpts.'],
  ['Always removed', 'E-mail addresses, phone numbers, links, postcodes and surnames.'],
  ['Never sent', 'Health samples (Apple Health, Health Connect), photos, invoices or money.'],
];

async function aiSection(box) {
  if (hashQuery().get('log') === '1') return reviewLog(box);
  let s;
  try { s = await api('GET', '/api/ai/status'); } catch (err) { box.append(errorLine(err)); return; }
  const save = async (patch, label) => {
    try { s = { ...s, ...(await api('PUT', '/api/ai/settings', patch)) }; aiStatus(true); toast(label); draw(); } catch (err) { toast(err.message, { error: true }); }
  };
  const routeOn = await prefs.get('review.routeToApproval', false);
  const draw = () => {
    const provider = s.provider === 'openrouter' ? ['OpenRouter', 'ok'] : s.provider === 'off' ? ['Off', 'data'] : ['Stub', 'attention'];
    const pct = (a, b) => (b ? Math.min(100, (a / b) * 100) : 0);
    fill(box,
      h('section', { class: 'ai-set-hero' },
        h('div', { class: 'ai-set-glyph' }, icon('auto_awesome', 26, { filled: true })),
        h('div', { class: 'grow' },
          h('div', { class: 'ui-eyebrow' }, 'Second opinion'),
          h('h3', { class: 'ai-set-title' }, s.provider === 'openrouter' ? 'Your AI is ' : 'AI is running ', h('em', null, s.provider === 'openrouter' ? 'live' : s.provider === 'off' ? 'off' : 'on the stub')),
          h('p', { class: 'small muted' }, s.reason || `Text: ${s.model}. ${s.audio ? 'Voice notes are transcribed.' : ''}`)),
        h('span', { class: 'pill' }, h('span', { class: `dot bg-${provider[1]}`, 'aria-hidden': 'true' }), provider[0])),
      h('section', { class: 'ai-set-grid' },
        h('div', { class: 'ai-set-card' }, h('div', { class: 'ai-label' }, 'Today’s use'),
          progressBar(pct(s.usedToday.calls, s.limits.dailyCalls), { label: `Checks, drafts and briefs · ${s.usedToday.calls} of ${s.limits.dailyCalls}` }),
          progressBar(pct(s.usedToday.audioSeconds, s.limits.dailyAudioSeconds), { tone: 'data', label: `Voice minutes · ${Math.round(s.usedToday.audioSeconds / 60)} of ${Math.round(s.limits.dailyAudioSeconds / 60)}` }),
          h('p', { class: 'tiny faint' }, `Per client: ${s.limits.clientDailyNotes} voice notes or ${Math.round(s.limits.clientDailyAudioSeconds / 60)} minutes a day. The stub is free and uncounted.`)),
        h('div', { class: 'ai-set-card' }, h('div', { class: 'ai-label' }, 'Advice check'),
          h('div', { class: 'ui-seg ai-mode', role: 'radiogroup', 'aria-label': 'Review mode' }, [['off', 'Off'], ['ask', 'When I ask'], ['always', 'Every send']].map(([v, label]) =>
            h('button', { type: 'button', role: 'radio', class: s.reviewMode === v ? 'sel' : '', 'aria-checked': String(s.reviewMode === v), disabled: !s.enabled,
              onclick: () => save({ reviewMode: v }, v === 'always' ? 'Every message is checked on Send' : v === 'ask' ? 'Check is in the composer' : 'Advice check off') }, label))),
          h('p', { class: 'tiny faint' }, s.reviewMode === 'always' ? 'Messages, letters and scheduled sends are checked when you press Send. A stop needs a second click.'
            : s.reviewMode === 'ask' ? 'Press Check in the composer when a message matters.' : 'No checks. Turn it back on any time.'))),
      h('section', { class: 'ai-set-card ai-switches' },
        switchRow('AI on', s.enabled, v => save({ enabled: v }, v ? 'AI on' : 'AI off'), { detail: 'Off means no checks, drafts, briefs or transcripts. Nothing is sent anywhere.' }),
        switchRow('Transcribe voice notes', s.transcribe, v => save({ transcribe: v }, 'Saved'), { detail: 'Yours, and clients’ who have allowed it in the app.' }),
        switchRow('Analyse clients’ voice notes', s.analyse, v => save({ analyse: v }, 'Saved'), { detail: 'Summary, mood, topics, action items and flags. Seen only by you.' }),
        switchRow('Drafts and briefs', s.drafts, v => save({ drafts: v }, 'Saved'), { detail: 'The Draft button, AI drafts in the Inbox, and client briefs.' }),
        switchRow('Route sends for approval', routeOn, async v => { await prefs.set('review.routeToApproval', v); toast(v ? 'Sends wait in the Inbox for approval' : 'Approval routing off'); },
          { detail: 'Reserved for an assistant coach: Send parks the draft in your Inbox instead.' })),
      h('section', { class: 'ai-set-card ai-sent' }, h('div', { class: 'ai-label' }, icon('shield', 14), 'What is sent to the AI'),
        h('dl', null, SENT.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
        h('p', { class: 'tiny faint' }, 'Requests go to OpenRouter with data collection denied and zero data retention. Reviews are kept 180 days; transcripts 12 months after coaching ends.')),
      h('div', { class: 'ai-set-foot' }, link('/account/ai?log=1', { class: 'btn' }, icon('timeline', 16), 'Review log')));
  };
  draw();
}

async function reviewLog(box) {
  box.append(h('div', { class: 'ai-log-head' }, link('/account/ai', { class: 'btn small' }, icon('chevron_left', 16), 'AI settings'), h('h3', { class: 't-title' }, 'Review log')));
  const list = h('div', { class: 'ai-log' }, skeleton('table', { rows: 6 }));
  box.append(list);
  try {
    const { reviews } = await api('GET', '/api/ai/reviews');
    if (!reviews.length) { fill(list, h('p', { class: 'muted' }, 'No reviews yet. Press Check in a conversation.')); return; }
    fill(list, reviews.map(r => h('details', { class: 'ai-log-row' },
      h('summary', null,
        r.kind === 'review' ? verdictPill(r.verdict) : h('span', { class: 'ai-verdict tone-data' }, icon(r.kind === 'approval' ? 'approval' : 'edit_note', 18), r.kind === 'approval' ? 'Approval' : 'AI draft'),
        h('span', { class: 'grow ai-log-text clamp1' }, r.client ? `${firstName(r.client.name)} · ` : '', r.kind === 'draft' ? r.rewrite || r.summary : r.draft),
        h('span', { class: 'ai-decision' }, DECISION[r.decision] || r.decision),
        h('span', { class: 'tiny faint nowrap' }, fmtRelative(r.createdAt))),
      h('div', { class: 'ai-log-body' },
        h('p', { class: 'ai-summary' }, r.summary),
        r.issues?.length ? h('ul', { class: 'ai-issues' }, r.issues.map(i => h('li', { class: 'ai-issue' }, h('span', { class: `ai-kind ai-k-${i.kind}` }, KIND[i.kind] || i.kind), h('span', null, i.note)))) : null,
        r.rewrite && r.kind === 'review' ? diffView(r.draft, r.rewrite) : null,
        h('div', { class: 'tiny faint' }, r.provider === 'stub' ? 'AI · stub' : r.provider === 'none' ? 'No AI' : `AI · ${r.model || r.provider}`)))));
  } catch (err) { fill(list, errorLine(err)); }
}

registerSettingsSection({ id: 'ai', label: 'AI', icon: 'auto_awesome', order: 60, render: aiSection });

