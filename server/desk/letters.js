/*
 * Letters: the LetterComposer (weekly and milestone) and the client's Letters
 * list. The composer pins the week's context (check-in answers, session
 * ratings, the habit week, the goal and the ScoreTrio) beside four one-line
 * fields, an optional voice or video note, and "Publish now" / "Schedule for
 * Monday 07:00". Publishing marks the week's check-in replied.
 * (docs/design/atelier-spec.md, "Coach screens" 4; docs/API.md, "Letters".)
 */
import {
  DAYS, api, apiBlob, apiUpload, busy, button, card, clearDraft, confirmBox, emptyCard, errorLine, field, fill, fmtShort,
  fmtTime, fmtWhen, h, icon, loading, londonParts, mondayOf, parseDay, q, readDraft, segmented, sheet, toast, todayLondon,
  weekDots, writeDraft,
} from './core.js';

const enc = encodeURIComponent;
const weekdayOf = s => DAYS[parseDay(s).getUTCDay()];
const FIELDS = ['headline', 'keep', 'adjust', 'question'];
const draftKey = (clientId, week, kind, id) => `jk.desk.letter.${clientId}.${kind === 'milestone' ? (id || 'new') : week}`;
const MAX_SECONDS = 90;

/** "Delivered · read", "Scheduled · Mon 23 Nov 07:00", "Draft". */
export function letterState(r) {
  if (!r.id) return 'Not started';
  if (r.letterStatus === 'scheduled') return `Scheduled · ${r.deliverAt ? `${weekdayOf(londonParts(r.deliverAt).day)} ${fmtWhen(r.deliverAt)}` : 'Monday 07:00'}`;
  if (r.letterStatus === 'published' || r.status === 'published') return `Delivered · ${r.answer ? 'answered' : r.readAt ? 'read' : 'not read yet'}`;
  return 'Draft';
}

/** The media types a note may be (the server keeps m4a and mp4). */
function mimeOf(file) {
  const t = (file.type || '').toLowerCase();
  if (t === 'video/mp4' || /\.mp4$/i.test(file.name)) return 'video/mp4';
  if (t.startsWith('audio/') || /\.m4a$/i.test(file.name)) return 'audio/mp4';
  return null;
}
/** The length of a local audio or video file in seconds, from its metadata. */
function durationOf(file, mime) {
  return new Promise(resolve => {
    const el = document.createElement(mime.startsWith('video') ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    const done = v => { URL.revokeObjectURL(url); resolve(v); };
    el.preload = 'metadata';
    el.addEventListener('loadedmetadata', () => done(Number.isFinite(el.duration) ? el.duration : null));
    el.addEventListener('error', () => done(null));
    el.src = url;
  });
}
const fmtSecs = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * Write or edit a letter. opts: { id } for a known letter, { week } for a
 * weekly letter of that Monday (default: the suggested week), { kind:
 * 'milestone' } for a new milestone letter. Resolves true when anything changed.
 */
export function letterComposer(ctx, opts = {}) {
  const first = ctx.first();
  const flag = { changed: false };
  return sheet(`Letter to ${first}`, (body, close) => {
    let kind = opts.kind || 'weekly';
    let report = null, base = null, saving = false;
    let mediaId = null, mediaKind = null, mediaDuration = null, mediaUrl = null, localUrl = null;
    let milestoneKey = null, rhythm = null, rhythmOverride = null;
    const urls = [];

    const kindBox = h('div');
    const context = h('div', { class: 'lc-context' }, loading());
    const status = h('div');
    const restored = h('p', { class: 'small lc-restored' });
    const milestoneBox = h('div');
    const mediaBox = h('div', { class: 'lc-media' });
    const rhythmBox = h('div');
    const stateLine = h('div', { class: 'small muted' });
    const input = (name, label, placeholder, hint, cls) => {
      const el = h('input', { class: cls || '', maxlength: name === 'headline' ? '120' : '300', placeholder, 'aria-label': label });
      el.addEventListener('input', () => { keep(); sync(); });
      return { el, wrap: field(label, el, hint) };
    };
    const f = {
      headline: input('headline', 'Headline', 'Strongest week yet.', 'One line. The quick path: a headline and a voice note.', 'serif-input'),
      keep: input('keep', 'Keep', 'Squat 102.5 kg for 5: up 17.5 kg since you started.', 'What went well, to keep doing.'),
      adjust: input('adjust', 'Adjust', 'This week: protein at breakfast, and lights out by 10:30.', `One line. It becomes ${first}’s line on Today.`),
      question: input('question', 'Question', 'How did the knee feel on Wednesday?', `${first} can answer it from the letter.`),
    };
    const values = () => Object.fromEntries(FIELDS.map(k => [k, f[k].el.value]));
    const empty = () => FIELDS.every(k => !f[k].el.value.trim()) && !mediaId;

    // Unsaved text in this browser wins over the server's, with a way back.
    let draftTimer = null;
    const key = () => draftKey(ctx.id, report?.week, kind, report?.id);
    const differs = v => !!v && !!base && FIELDS.some(k => (v[k] ?? '') !== (base[k] ?? ''));
    const showRestored = on => fill(restored, on ? ['Restored unsaved text from this browser · ', h('button', {
      class: 'link', type: 'button', onclick: () => { for (const k of FIELDS) f[k].el.value = base[k] ?? ''; clearDraft(key()); showRestored(false); sync(); },
    }, 'Discard')] : null);
    function keep() {
      clearTimeout(draftTimer);
      const k = key();
      draftTimer = setTimeout(() => { const v = values(); if (differs(v)) writeDraft(k, v); else clearDraft(k); }, 400);
    }

    const publishBtn = button('Publish now', () => save('published', 'now'), { kind: 'primary' });
    const scheduleBtn = button('Schedule for Monday 07:00', () => save('published'));
    const draftBtn = button('Save draft', () => save('draft'));
    const deleteBtn = h('button', { class: 'btn danger', type: 'button', onclick: () => remove() }, 'Delete');

    function sync() {
      const delivered = !!report?.deliveredAt;
      const scheduled = report?.letterStatus === 'scheduled';
      publishBtn.textContent = saving ? 'Saving…' : delivered ? 'Update letter' : 'Publish now';
      publishBtn.disabled = saving || !report || !f.headline.el.value.trim();
      scheduleBtn.hidden = delivered;
      scheduleBtn.textContent = scheduled ? 'Keep for Monday 07:00' : 'Schedule for Monday 07:00';
      scheduleBtn.disabled = saving || !report || !f.headline.el.value.trim();
      draftBtn.hidden = delivered;
      draftBtn.disabled = saving || !report || empty();
      deleteBtn.hidden = !report?.id || delivered;
      fill(stateLine, report ? letterState(report) : '');
      for (const k of FIELDS) f[k].el.disabled = !report;
    }

    function drawKind() {
      fill(kindBox, segmented([['weekly', 'Weekly'], ['milestone', 'Milestone']], kind, v => {
        if (v === kind || report?.deliveredAt) return;
        kind = v;
        load(v === 'milestone' ? { kind: 'milestone' } : {});
      }));
    }

    function drawMilestones() {
      const ms = report?.context?.milestones ?? [];
      if (kind !== 'milestone') { fill(milestoneBox); return; }
      fill(milestoneBox, ms.length ? field('Milestone', h('select', {
        onchange: e => {
          milestoneKey = e.target.value || null;
          const m = ms.find(x => x.key === milestoneKey);
          if (m?.suggestedHeadline && !f.headline.el.value.trim()) f.headline.el.value = m.suggestedHeadline;
          sync();
        },
      }, h('option', { value: '' }, 'None (a letter of your own)'), ms.map(m => h('option', { value: m.key, selected: m.key === milestoneKey }, m.reason)))) : h('p', { class: 'small muted' }, 'No milestone suggested right now. Write one of your own.'));
    }

    function drawMedia() {
      const prompt = rhythm?.media ? `${ctx.planName} letters carry a voice or video note.` : 'Optional.';
      if (mediaId) {
        const player = h(mediaKind === 'video' ? 'video' : 'audio', { controls: true, preload: 'metadata', class: 'lc-player' });
        if (localUrl) player.src = localUrl;
        else if (mediaUrl) apiBlob(mediaUrl).then(b => { const u = URL.createObjectURL(b); urls.push(u); player.src = u; }, () => { /* cannot play here */ });
        fill(mediaBox, h('div', { class: 'row' }, h('span', { class: 'muted' }, icon('voiceNote', 20)),
          h('span', { class: 'grow small' }, `${mediaKind === 'video' ? 'Video' : 'Voice'} note${mediaDuration ? ` · ${fmtSecs(mediaDuration)}` : ''}`),
          button('Remove', () => { mediaId = null; mediaKind = null; mediaUrl = null; localUrl = null; drawMedia(); sync(); }, { small: true })), player);
        return;
      }
      const file = h('input', { type: 'file', accept: 'audio/mp4,audio/x-m4a,audio/m4a,video/mp4,.m4a,.mp4', 'aria-label': 'Voice or video note file' });
      const upStatus = h('div');
      file.addEventListener('change', async () => {
        const chosen = file.files?.[0];
        if (!chosen) return;
        const mime = mimeOf(chosen);
        if (!mime) { fill(upStatus, errorLine('Choose an .m4a voice note or an .mp4 video.')); return; }
        await busy(file, upStatus, async () => {
          const secs = await durationOf(chosen, mime);
          if (secs !== null && secs > MAX_SECONDS + 0.5) throw new Error(`That note is ${fmtSecs(secs)}. Notes are 90 seconds at most.`);
          fill(upStatus, h('p', { class: 'small muted' }, 'Uploading…'));
          const m = await apiUpload(`/api/media?${q({ purpose: 'letter', clientId: ctx.id, durationSec: secs === null ? undefined : Math.min(MAX_SECONDS, Math.round(secs)) })}`, chosen, mime);
          mediaId = m.id; mediaKind = m.kind; mediaDuration = m.durationSec ?? secs; mediaUrl = m.url;
          localUrl = URL.createObjectURL(chosen); urls.push(localUrl);
          drawMedia(); sync();
        });
      });
      fill(mediaBox, field('Voice or video note', file, `${prompt} An .m4a or .mp4 file, up to 90 seconds.`), upStatus);
    }

    function drawRhythm() {
      if (!rhythm) { fill(rhythmBox); return; }
      const value = rhythmOverride ?? 'plan';
      const every = rhythm.overridden ? null : rhythm.every;
      fill(rhythmBox, h('div', { class: 'lc-rhythm' },
        h('span', { class: 'small muted' }, `Rhythm for ${first}`),
        segmented([['plan', `Plan${every ? ` (${every})` : ''}`], ['weekly', 'Weekly'], ['fortnightly', 'Fortnightly']], value, async v => {
          try {
            const s = await api('PATCH', `/api/coach/clients/${enc(ctx.id)}/settings`, { letterRhythm: v === 'plan' ? null : v });
            rhythm = s.letterRhythm; rhythmOverride = s.letterRhythmOverride; flag.changed = true;
            drawRhythm();
          } catch (err) { toast(err.message, { error: true }); }
        })));
    }

    function drawContext(r) {
      const c = r.context || {};
      const ci = c.checkin;
      const w = c.week || {};
      const g = c.goal;
      const score = (k, v) => h('div', { class: 'lc-score' }, h('div', { class: 'small muted' }, k), h('div', { class: 't-num' }, v ?? '–'));
      fill(context,
        h('details', { class: 'lc-pinned', open: true },
          h('summary', null, `Week of ${fmtShort(r.week)}`),
          r.scoreTrio?.length ? h('div', { class: 'lc-trio' }, r.scoreTrio.map(s => h('div', { class: 'lc-score', title: s.source },
            h('div', { class: 'small muted' }, s.label), h('div', { class: 't-num lc-trio-v' }, s.value)))) : null,
          r.weekDots?.length ? h('div', { class: 'row lc-dots' }, h('span', { class: 'small muted' }, 'Days done'), weekDots(r.weekDots, { big: true })) : null,
          g ? h('div', { class: 'lc-goal' }, h('div', { class: 'small muted' }, 'Goal'), h('div', { class: 't-quote-s' }, g.title),
            h('div', { class: 'small t-num' }, [g.current !== null && g.current !== undefined ? `Now ${g.current}${g.unit ? ` ${g.unit}` : ''}` : null, g.remainingLabel].filter(Boolean).join(' · '))) : null,
          ci ? h('div', { class: 'lc-checkin' },
            h('div', { class: 'small muted' }, `Check-in · ${weekdayOf(londonParts(ci.submittedAt).day)} ${fmtTime(ci.submittedAt)}`),
            h('div', { class: 'row lc-scores' }, score('Energy', ci.energy ? `${ci.energy} of 5` : null), score('Sleep', ci.sleep ? `${ci.sleep} of 5` : null), score('Stress', ci.stress ? `${ci.stress} of 5` : null)),
            ci.pain?.length ? h('div', { class: 'row gap4 tone-urgent small' }, icon('pain', 16), `Sore: ${ci.pain.join(', ')}`) : null,
            ci.win ? h('p', { class: 'small m0' }, h('span', { class: 'muted' }, 'Win: '), ci.win) : null,
            ci.struggle ? h('p', { class: 'small m0' }, h('span', { class: 'muted' }, 'Struggle: '), ci.struggle) : null,
            ci.note ? h('p', { class: 'small m0' }, h('span', { class: 'muted' }, 'Note: '), ci.note) : null)
            : h('p', { class: 'small muted' }, 'No check-in for this week.'),
          w.feel?.length ? h('div', { class: 'lc-feel' }, h('div', { class: 'small muted' }, 'Session ratings'),
            w.feel.map(x => h('div', { class: 'spread small' }, h('span', null, `${weekdayOf(x.date)} · ${x.title}`), h('span', { class: 'muted' }, x.word ?? '–')))) : null));
    }

    async function load(o) {
      report = null; base = null;
      fill(context, loading()); fill(status); showRestored(false);
      for (const k of FIELDS) f[k].el.value = '';
      sync();
      try {
        const list = opts.week || o.id ? null : await api('GET', `/api/reports?${q({ clientId: ctx.id })}`);
        let r;
        if (o.id) r = await api('GET', `/api/reports/${enc(o.id)}`);
        else {
          const week = o.kind === 'milestone' ? mondayOf(todayLondon()) : (opts.week || list.suggestedWeek);
          r = await api('GET', `/api/reports/week/${week}?${q({ clientId: ctx.id })}`);
          if (o.kind === 'milestone') {
            // A new milestone letter: this week's context, a blank letter.
            r = { ...r, id: null, kind: 'milestone', letterStatus: 'draft', status: 'draft', deliveredAt: null, deliverAt: null, readAt: null, answer: null, headline: null, keep: null, adjust: null, question: null, mediaId: null, mediaKind: null, mediaUrl: null, durationSec: null, milestoneKey: null };
          }
        }
        report = r;
        kind = r.kind || 'weekly';
        base = Object.fromEntries(FIELDS.map(k => [k, r[k] ?? (k === 'headline' ? '' : { keep: r.wins, adjust: r.focus }[k] ?? '')]));
        mediaId = r.mediaId; mediaKind = r.mediaKind; mediaDuration = r.durationSec; mediaUrl = r.mediaUrl; localUrl = null;
        milestoneKey = r.milestoneKey ?? (kind === 'milestone' ? r.context?.milestones?.[0]?.key ?? null : null);
        rhythm = r.context?.rhythm ?? null;
        rhythmOverride = rhythm?.overridden ? rhythm.every : null;
        const stored = readDraft(key());
        const start = differs(stored) ? stored : base;
        for (const k of FIELDS) f[k].el.value = start[k] ?? '';
        if (kind === 'milestone' && !f.headline.el.value && milestoneKey) {
          f.headline.el.value = r.context.milestones.find(m => m.key === milestoneKey)?.suggestedHeadline ?? '';
        }
        showRestored(start !== base);
        drawKind(); drawMilestones(); drawMedia(); drawRhythm(); drawContext(r);
      } catch (err) {
        fill(context, errorLine(err));
      }
      sync();
    }

    async function save(st, deliverAt) {
      saving = true; sync(); fill(status);
      try {
        const v = values();
        const b = {
          clientId: ctx.id, week: report.week, kind, status: st,
          headline: v.headline.trim() || null, keep: v.keep.trim() || null, adjust: v.adjust.trim() || null, question: v.question.trim() || null,
          mediaId: mediaId || null, milestoneKey: kind === 'milestone' ? milestoneKey : null,
          ...(report.id ? { id: report.id } : {}),
          ...(deliverAt ? { deliverAt } : {}),
        };
        const r = await api('PUT', '/api/reports', b);
        clearTimeout(draftTimer);
        clearDraft(key());
        flag.changed = true;
        if (st === 'published') {
          toast(deliverAt === 'now' ? `Published. ${first} can read it now.` : `Scheduled. ${first} gets it ${r.deliverAt ? `${weekdayOf(londonParts(r.deliverAt).day)} ${fmtWhen(r.deliverAt)}` : 'on Monday at 07:00'}.`);
          saving = false; close(true); return;
        }
        report = { ...report, ...r };
        base = Object.fromEntries(FIELDS.map(k => [k, r[k] ?? '']));
        showRestored(false);
        fill(status, h('p', { class: 'ok' }, 'Draft saved.'));
      } catch (err) {
        fill(status, errorLine(err));
      }
      saving = false; sync();
    }

    async function remove() {
      if (!report?.id) return;
      if (!await confirmBox('Delete this letter?', { ok: 'Delete', danger: true, detail: report.letterStatus === 'scheduled' ? `${first} will not receive it.` : null })) return;
      try {
        await api('DELETE', `/api/reports/${enc(report.id)}`);
        clearDraft(key());
        close(true);
      } catch (err) {
        fill(status, errorLine(err));
      }
    }

    body.append(h('div', { class: 'lc-grid' },
      context,
      h('div', { class: 'lc-form' },
        h('div', { class: 'spread' }, kindBox, stateLine),
        milestoneBox, restored,
        f.headline.wrap, f.keep.wrap, f.adjust.wrap, f.question.wrap,
        mediaBox, status, rhythmBox)));
    drawKind();
    load(opts.id ? { id: opts.id } : { kind });
    const cleanup = () => urls.forEach(u => URL.revokeObjectURL(u));
    body.closest('dialog')?.addEventListener('close', cleanup);
    return h('div', { class: 'spread lc-actions' }, deleteBtn, h('div', { class: 'row end' }, draftBtn, scheduleBtn, publishBtn));
  }, { wide: true }).then(v => v === true || flag.changed);
}

// MARK: - The Letters tab

/** The client's letters, newest first, plus Write buttons; opening one opens the composer. */
export async function lettersSection(box, ctx) {
  const list = h('div');
  fill(box, list);
  fill(list, loading());
  const again = () => lettersSection(box, ctx);
  const open = async opts => { await letterComposer(ctx, opts); if (ctx.view.fresh()) again(); };
  try {
    const d = await api('GET', `/api/reports?${q({ clientId: ctx.id })}`);
    if (!ctx.view.fresh()) return;
    const current = d.reports.find(r => r.week === d.suggestedWeek && r.kind !== 'milestone');
    fill(list,
      h('div', { class: 'row lc-write' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => open(current ? { id: current.id } : { week: d.suggestedWeek }) }, icon('letter', 20),
          `${current ? 'Open' : 'Write'} the letter · week of ${fmtShort(d.suggestedWeek)}`),
        button(h('span', { class: 'row gap4' }, icon('milestone', 18), 'Milestone letter'), () => open({ kind: 'milestone' }))),
      d.reports.length
        ? card({ class: 'flush' }, d.reports.map(r => h('button', { class: 'lc-item', type: 'button', onclick: () => open({ id: r.id }) },
          h('span', { class: r.kind === 'milestone' ? 'tone-accent' : 'muted' }, icon(r.kind === 'milestone' ? 'milestone' : 'letter', 20)),
          h('div', { class: 'grow' },
            h('div', { class: 'lc-item-head' }, r.headline || r.summary?.split('\n')[0] || 'Untitled'),
            h('div', { class: 'small muted' }, [r.kind === 'milestone' ? 'Milestone' : `Week of ${fmtShort(r.week)}`, letterState(r), r.mediaId ? 'with a note' : null].filter(Boolean).join(' · ')),
            r.answer ? h('div', { class: 'small lc-answer' }, h('span', { class: 'muted' }, 'Answer: '), r.answer) : null),
          h('span', { class: 'muted' }, icon('chevron', 18)))))
        : emptyCard('letter', 'No letters yet.', 'The first one explains the day rule: a day counts once the minimum is met.'));
  } catch (err) {
    if (ctx.view.fresh()) fill(list, errorLine(err), button('Try again', again, { small: true }));
  }
}
