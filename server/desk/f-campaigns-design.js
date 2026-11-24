/*
 * F13 Campaigns (WP4): the Design, Kit & spend and Settings tabs. They edit
 * one design document in memory (ctx.doc); the screen's save bar sends it
 * whole (PUT /api/campaigns/:id). Every control is a button or input with a
 * keyboard path: phase edges move with ←/→ (⇧ for a week), activities change
 * day with ↑/↓ on their handle, as well as by dragging.
 */
import { api, confirmBox, field, fill, h, icon, switchRow, toast } from './core.js';
import { donut } from './charts.js';
import { blockEditor } from './f-guidebook.js';
import { COLORS, KIND, dayDate, kindBadge, money, plural, todayIndex, weeksWord } from './f-campaigns-common.js';
import { menu, moneyInput, popover, segmentedNav, slideOver } from './ui.js';

let seq = 0;
const tempKey = () => `k${Date.now().toString(36)}${++seq}`;
const pid = p => p.id ?? p.key;
const aid = a => a.id ?? a._k;

// MARK: - Design: the phase strip

function phaseStrip(ctx) {
  const { doc } = ctx;
  const L = doc.campaign.lengthDays;
  const weeks = Math.ceil(L / 7);
  const live = h('div', { class: 'ui-sr', 'aria-live': 'polite' });
  const track = h('div', { class: 'cg-track' });
  const ticks = h('div', { class: 'cg-ticks', 'aria-hidden': 'true' }, Array.from({ length: weeks }, (_, w) => h('span', { class: 'cg-tick', style: { '--s': `${(w * 7 / L) * 100}%` } }, `W${w + 1}`)));
  // Lanes: a phase goes in the first lane whose last phase ended before it starts.
  const sorted = [...doc.phases].sort((a, b) => a.startDay - b.startDay);
  const lanes = [];
  const laneOf = new Map();
  for (const p of sorted) {
    let i = lanes.findIndex(end => end < p.startDay);
    if (i < 0) { i = lanes.length; lanes.push(-1); }
    lanes[i] = p.endDay;
    laneOf.set(p, i);
  }
  track.style.setProperty('--lanes', String(Math.max(1, lanes.length)));
  const place = (el, p) => { el.style.setProperty('--s', `${(p.startDay / L) * 100}%`); el.style.setProperty('--w', `${((p.endDay - p.startDay + 1) / L) * 100}%`); };
  const label = p => `days ${p.startDay + 1}–${p.endDay + 1}`;

  for (const p of sorted) {
    const days = h('span', { class: 'cg-phase-days' }, label(p));
    const edge = side => {
      const btn = h('button', { type: 'button', class: `cg-edge ${side}`, 'aria-label': `${side === 'l' ? 'Start' : 'End'} of ${p.name}, ${side === 'l' ? `day ${p.startDay + 1}` : `day ${p.endDay + 1}`}. Left and right arrows move it.` });
      const set = day => {
        if (side === 'l') p.startDay = Math.max(0, Math.min(p.endDay, day));
        else p.endDay = Math.min(L - 1, Math.max(p.startDay, day));
        place(el, p);
        days.textContent = label(p);
      };
      btn.addEventListener('keydown', e => {
        const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
        if (!d) return;
        e.preventDefault();
        set((side === 'l' ? p.startDay : p.endDay) + d * (e.shiftKey ? 7 : 1));
        live.textContent = `${p.name}: ${label(p)}`;
        ctx.markDirty();
      });
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        const r = track.getBoundingClientRect();
        el.classList.add('resizing');
        const onMove = ev => set(Math.round(((ev.clientX - r.left) / r.width) * L - (side === 'r' ? 1 : 0)));
        const onUp = () => {
          btn.removeEventListener('pointermove', onMove); btn.removeEventListener('pointerup', onUp);
          el.classList.remove('resizing');
          ctx.markDirty();
          ctx.redraw();
        };
        btn.addEventListener('pointermove', onMove);
        btn.addEventListener('pointerup', onUp);
      });
      return btn;
    };
    const body = h('button', { type: 'button', class: 'cg-phase-body', 'aria-label': `Edit phase ${p.name}, ${label(p)}`, onclick: () => editPhase(ctx, body, p) },
      h('span', { class: 'cg-phase-name' }, p.name), days);
    const el = h('div', { class: `cg-phase c-${p.color}`, style: { '--lane': String(laneOf.get(p)) } }, edge('l'), body, edge('r'));
    place(el, p);
    track.append(el);
  }
  const ti = ctx.doc.campaign.status === 'live' ? todayIndex(doc.campaign) : null;
  if (ti !== null) track.append(h('span', { class: 'cg-now', style: { '--s': `${((ti + 0.5) / L) * 100}%` }, title: 'Today' }, h('span', null, 'Today')));
  if (!doc.phases.length) track.append(h('p', { class: 'cg-track-empty' }, 'No phases yet. A phase is a stretch of the campaign with its own guide.'));

  const add = h('button', { type: 'button', class: 'btn small', onclick: () => {
    const last = Math.max(-1, ...doc.phases.map(p => p.endDay));
    const start = Math.min(L - 1, last + 1);
    const p = { key: tempKey(), name: `Phase ${doc.phases.length + 1}`, startDay: start, endDay: Math.min(L - 1, start + 13), color: COLORS[doc.phases.length % COLORS.length], guideId: null, summary: '' };
    doc.phases.push(p);
    ctx.markDirty();
    ctx.redraw();
  } }, icon('add', 16), 'Add phase');
  return h('section', { class: 'cg-card' },
    h('div', { class: 'cg-card-head' }, h('div', null, h('h2', null, 'Phases'), h('p', { class: 'small muted m0' }, `${weeksWord(L)}. Drag an edge to resize a phase; click one to edit it.`)), add),
    h('div', { class: 'cg-gantt' }, ticks, track), live);
}

function editPhase(ctx, anchor, p) {
  popover(anchor, (box, close) => {
    const guides = h('select', { 'aria-label': 'Phase guide', onchange: e => { p.guideId = e.target.value || null; ctx.markDirty(); } }, h('option', { value: '' }, 'No guide'));
    ctx.guides().then(gs => { for (const g of gs) guides.append(h('option', { value: g.id, selected: g.id === p.guideId }, `${g.title}${g.status === 'draft' ? ' (draft)' : ''}`)); });
    const swatches = h('div', { class: 'cg-swatches', role: 'radiogroup', 'aria-label': 'Colour' }, COLORS.map(c => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(p.color === c), 'aria-label': `Colour ${c.slice(-1)}`, class: `cg-swatch c-${c}${p.color === c ? ' on' : ''}`,
      onclick: e => { p.color = c; swatches.querySelectorAll('.cg-swatch').forEach(s => { s.classList.toggle('on', s === e.currentTarget); s.setAttribute('aria-checked', String(s === e.currentTarget)); }); ctx.markDirty(); },
    })));
    box.append(
      h('div', { class: 'cg-pop-title' }, 'Phase'),
      field('Name', h('input', { value: p.name, maxlength: '60', oninput: e => { p.name = e.target.value; ctx.markDirty(); } })),
      field('What it is for', h('textarea', { rows: '2', maxlength: '300', value: p.summary, oninput: e => { p.summary = e.target.value; ctx.markDirty(); } })),
      field('Guide', guides), h('div', { class: 'field' }, h('label', null, 'Colour'), swatches),
      h('div', { class: 'row spread cg-pop-foot' },
        h('button', { type: 'button', class: 'btn small text danger', onclick: () => {
          ctx.doc.phases = ctx.doc.phases.filter(x => x !== p);
          for (const a of ctx.doc.activities) if (a.phaseId === pid(p)) a.phaseId = null;
          close(); ctx.markDirty(); ctx.redraw();
        } }, icon('delete', 16), 'Remove phase'),
        h('button', { type: 'button', class: 'btn small primary', onclick: () => { close(); ctx.redraw(); } }, 'Done')));
    requestAnimationFrame(() => box.querySelector('input')?.focus());
  }, { className: 'cg-pop', label: `Edit ${p.name}` });
}

// MARK: - Design: activities by phase

function phaseFor(doc, day) { return doc.phases.find(p => day >= p.startDay && day <= p.endDay) ?? null; }

function activityList(ctx) {
  const { doc } = ctx;
  const c = doc.campaign;
  const live = h('div', { class: 'ui-sr', 'aria-live': 'polite' });
  let dragging = null;
  const sortActs = () => doc.activities.sort((a, b) => a.day - b.day);
  const moveTo = (a, day, announce = true) => {
    a.day = Math.max(0, Math.min(c.lengthDays - 1, day));
    const ph = phaseFor(doc, a.day);
    if (ph) a.phaseId = pid(ph);
    sortActs();
    ctx.markDirty();
    if (announce) live.textContent = `${a.title} moved to day ${a.day + 1}`;
  };
  const row = a => {
    const ph = doc.phases.find(p => pid(p) === a.phaseId);
    const date = dayDate(c, a.day);
    const handle = h('button', { type: 'button', class: 'cg-handle', draggable: 'true', 'aria-label': `${a.title}, day ${a.day + 1}. Up and down arrows change the day; with Shift, a week.`,
      onkeydown: e => {
        const d = { ArrowUp: -1, ArrowDown: 1 }[e.key];
        if (!d) return;
        e.preventDefault();
        moveTo(a, a.day + d * (e.shiftKey ? 7 : 1));
        ctx.redraw();
        requestAnimationFrame(() => document.querySelector(`.cg-act[data-k="${CSS.escape(aid(a))}"] .cg-handle`)?.focus());
      } }, icon('drag_indicator', 18));
    const guideName = a.guideId ? ctx.guideTitle(a.guideId) : a.blocks?.length ? 'Inline guide' : null;
    const more = h('button', { type: 'button', class: 'ui-icon-btn small', 'aria-label': `Options for ${a.title}`, onclick: () => menu(more, [
      { label: 'Edit', icon: 'edit', onclick: () => editActivity(ctx, a) },
      { label: 'Duplicate weekly', icon: 'event_repeat', detail: 'The same day every week to the end', onclick: () => duplicateWeekly(ctx, a) },
      { label: 'Duplicate', icon: 'content_copy', onclick: () => { doc.activities.push({ ...structuredClone(a), id: undefined, _k: tempKey() }); sortActs(); ctx.markDirty(); ctx.redraw(); } },
      'sep',
      { label: 'Delete', icon: 'delete', danger: true, onclick: () => { doc.activities = doc.activities.filter(x => x !== a); ctx.markDirty(); ctx.redraw(); } },
    ]) }, icon('more_horiz', 18));
    const r = h('li', { class: `cg-act${a.required ? '' : ' optional'}`, 'data-k': aid(a) },
      handle, kindBadge(a.kind),
      h('button', { type: 'button', class: 'cg-act-main', onclick: () => editActivity(ctx, a) },
        h('span', { class: 'cg-act-title' }, a.title),
        h('span', { class: 'cg-act-meta' }, [KIND[a.kind]?.[0], a.detail ? a.detail : null, guideName ? `Guide: ${guideName}` : null].filter(Boolean).join(' · '))),
      h('span', { class: 'cg-day' }, h('b', null, `Day ${a.day + 1}`), date ? h('span', null, date) : null),
      h('span', { class: 'cg-pts', title: 'Points' }, `${a.points}`, h('small', null, 'pts')),
      a.required ? h('span', { class: 'cg-req' }, icon('check', 14), 'Required') : h('span', { class: 'cg-req opt' }, 'Optional'),
      h('span', { class: 'cg-spend' }, a.spendPence ? money(a.spendPence) : ''),
      more);
    if (ph) r.classList.add(`ph-${ph.color}`);
    handle.addEventListener('dragstart', e => { dragging = a; r.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', aid(a)); });
    handle.addEventListener('dragend', () => { dragging = null; r.classList.remove('dragging'); });
    r.addEventListener('dragover', e => { if (!dragging || dragging === a) return; e.preventDefault(); r.classList.add('drop'); });
    r.addEventListener('dragleave', () => r.classList.remove('drop'));
    r.addEventListener('drop', e => { e.preventDefault(); r.classList.remove('drop'); if (!dragging || dragging === a) return; moveTo(dragging, a.day); ctx.redraw(); });
    return r;
  };
  const groups = [...[...doc.phases].sort((a, b) => a.startDay - b.startDay).map(p => ({ p, acts: doc.activities.filter(a => a.phaseId === pid(p)) })),
    { p: null, acts: doc.activities.filter(a => !a.phaseId || !doc.phases.some(p => pid(p) === a.phaseId)) }].filter(g => g.p || g.acts.length);
  const add = h('button', { type: 'button', class: 'btn small primary', onclick: () => editActivity(ctx, null) }, icon('add', 16), 'Add activity');
  const total = doc.activities.length, req = doc.activities.filter(a => a.required).length;
  const points = doc.activities.reduce((s, a) => s + (a.points || 0), 0);
  return h('section', { class: 'cg-card' },
    h('div', { class: 'cg-card-head' }, h('div', null, h('h2', null, 'Activities'),
      h('p', { class: 'small muted m0' }, `${plural(total, 'activity', 'activities')} · ${req} required · ${points} points to win. Drag a row onto another day, or use ↑/↓ on its handle.`)), add),
    total ? groups.map(g => h('div', { class: 'cg-group' },
      h('div', { class: 'cg-group-head' }, g.p ? h('span', { class: `cg-dot c-${g.p.color}`, 'aria-hidden': 'true' }) : null,
        h('b', null, g.p ? g.p.name : 'No phase'), g.p ? h('span', { class: 'small muted' }, `Days ${g.p.startDay + 1}–${g.p.endDay + 1}`) : null,
        h('span', { class: 'small faint' }, plural(g.acts.length, 'activity', 'activities'))),
      g.acts.length ? h('ul', { class: 'cg-acts' }, g.acts.map(row)) : h('p', { class: 'cg-group-empty small faint' }, 'Nothing in this phase yet.')))
      : h('div', { class: 'cg-blank' }, h('p', { class: 't-quote-s m0' }, 'Every day of the campaign starts here.'), h('p', { class: 'small muted' }, 'Add runs, habits, purchases and check-ins. Each can carry its own guide.')),
    live);
}

function duplicateWeekly(ctx, a) {
  const L = ctx.doc.campaign.lengthDays;
  let n = 0;
  for (let d = a.day + 7; d < L; d += 7) {
    if (ctx.doc.activities.some(x => x.day === d && x.title === a.title)) continue;
    const ph = phaseFor(ctx.doc, d);
    ctx.doc.activities.push({ ...structuredClone(a), id: undefined, _k: tempKey(), day: d, phaseId: ph ? pid(ph) : a.phaseId });
    n++;
  }
  ctx.doc.activities.sort((x, y) => x.day - y.day);
  ctx.markDirty();
  ctx.redraw();
  toast(n ? `Repeated “${a.title}” on ${plural(n, 'more week')}.` : 'It already repeats every week.');
}

/** The activity editor: a wide slide-over. `a` null makes a new one. */
function editActivity(ctx, a) {
  const doc = ctx.doc;
  const c = doc.campaign;
  const isNew = !a;
  const ti = todayIndex(c) ?? 0;
  const draft = a ? structuredClone(a) : { _k: tempKey(), day: ti, title: '', kind: 'task', detail: '', points: 10, required: true, spendPence: 0, guideId: null, blocks: null, linkRef: null, phaseId: phaseFor(doc, ti) ? pid(phaseFor(doc, ti)) : null };
  slideOver(isNew ? 'New activity' : 'Edit activity', (body, close) => {
    const dateHint = h('span', { class: 'small muted' });
    const showDate = () => { dateHint.textContent = dayDate(c, draft.day) ?? `Day ${draft.day + 1} from each person's start`; };
    const linkBox = h('div');
    const guideBox = h('div');
    const kinds = h('div', { class: 'cg-kinds', role: 'radiogroup', 'aria-label': 'Kind' });
    const drawKinds = () => fill(kinds, Object.entries(KIND).map(([k, [label, glyph]]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(draft.kind === k), class: `cg-kind-opt k-${k}${draft.kind === k ? ' on' : ''}`,
      onclick: () => { draft.kind = k; drawKinds(); drawLink(); },
    }, icon(glyph, 18), label)));
    const drawLink = () => {
      if (draft.kind === 'workout') {
        const sel = h('select', { onchange: e => { draft.linkRef = e.target.value || null; } }, h('option', { value: '' }, 'No program'));
        ctx.programs().then(ps => { for (const p of ps) sel.append(h('option', { value: p.id, selected: p.id === draft.linkRef }, p.name)); });
        fill(linkBox, field('Program', sel, 'Offered to lay on the client\'s calendar when they join (as drafts you check).'));
      } else if (draft.kind === 'purchase') {
        const sel = h('select', { onchange: e => { draft.linkRef = e.target.value || null; } }, h('option', { value: '' }, 'Not a kit item'),
          doc.kit.map(k => h('option', { value: k.id ?? k.key, selected: (k.id ?? k.key) === draft.linkRef }, `${k.name} · ${money(k.estPence)}`)));
        fill(linkBox, field('Buys this kit item', sel, 'A purchase of a kit item counts once in the expected spend.'));
      } else if (draft.kind === 'session') {
        fill(linkBox, field('Where', h('select', { onchange: e => { draft.linkRef = e.target.value || null; } }, [['', 'Any'], ['inperson', 'In person'], ['video', 'Video call']].map(([v, l]) => h('option', { value: v, selected: (draft.linkRef ?? '') === v }, l)))));
      } else fill(linkBox);
    };
    const mode = () => (draft.guideId ? 'linked' : draft.blocks ? 'inline' : 'none');
    const drawGuide = () => {
      const m = mode();
      const seg = segmentedNav([['none', 'No guide'], ['linked', 'From the guidebook'], ['inline', 'Write one here']], m, v => {
        if (v === 'none') { draft.guideId = null; draft.blocks = null; }
        if (v === 'linked') { draft.blocks = null; draft.guideId = draft.guideId ?? ''; }
        if (v === 'inline') { draft.guideId = null; draft.blocks = draft.blocks ?? [{ t: 'p', text: '' }]; }
        drawGuide();
      }, { label: 'Guide' });
      let extra = null;
      if (m === 'linked' || draft.guideId === '') {
        const sel = h('select', { 'aria-label': 'Guide', onchange: e => { draft.guideId = e.target.value || ''; } }, h('option', { value: '' }, 'Choose a guide…'));
        ctx.guides().then(gs => { for (const g of gs) sel.append(h('option', { value: g.id, selected: g.id === draft.guideId }, `${g.title}${g.status === 'draft' ? ' (draft: clients won\'t see it)' : ''}`)); });
        extra = sel;
      } else if (m === 'inline') extra = blockEditor({ blocks: draft.blocks, compact: true, onChange: b => { draft.blocks = b; } }).el;
      fill(guideBox, h('div', { class: 'field' }, h('label', null, 'Guide'), seg), extra);
    };
    const title = h('input', { value: draft.title, maxlength: '120', placeholder: 'Long run 16 km', autofocus: true, oninput: e => { draft.title = e.target.value; } });
    const day = h('input', { type: 'number', min: '1', max: String(c.lengthDays), value: String(draft.day + 1), oninput: e => { const v = Number(e.target.value); if (v >= 1 && v <= c.lengthDays) { draft.day = v - 1; showDate(); } } });
    const phase = h('select', { onchange: e => { draft.phaseId = e.target.value || null; } }, h('option', { value: '' }, 'No phase'),
      doc.phases.map(p => h('option', { value: pid(p), selected: pid(p) === draft.phaseId }, `${p.name} (days ${p.startDay + 1}–${p.endDay + 1})`)));
    const spend = moneyInput({ value: draft.spendPence, label: 'Expected spend', onChange: p => { draft.spendPence = p ?? 0; } });
    body.append(
      field('Title', title),
      h('div', { class: 'field' }, h('label', null, 'Kind'), kinds),
      h('div', { class: 'cg-form-grid' },
        h('div', { class: 'field' }, h('label', null, 'Day'), day, dateHint),
        field('Phase', phase),
        field('Points', h('input', { type: 'number', min: '0', max: '1000', value: String(draft.points), oninput: e => { draft.points = Math.max(0, Math.round(Number(e.target.value) || 0)); } })),
        h('div', { class: 'field' }, h('label', null, 'Expected spend'), spend)),
      switchRow('Required', draft.required, v => { draft.required = v; }, { detail: 'Counts towards pace. Optional ones still earn points.' }),
      field('What to do', h('textarea', { rows: '3', maxlength: '1000', value: draft.detail, placeholder: 'Conversational pace. You should be able to talk.', oninput: e => { draft.detail = e.target.value; } })),
      linkBox, guideBox);
    drawKinds(); drawLink(); drawGuide(); showDate();
    const status = h('div', { class: 'small error', role: 'alert' });
    return h('div', { class: 'cg-slide-foot' },
      isNew ? null : h('button', { type: 'button', class: 'btn text danger', onclick: () => { doc.activities = doc.activities.filter(x => x !== a); ctx.markDirty(); close(); ctx.redraw(); } }, icon('delete', 16), 'Delete'),
      h('span', { class: 'grow' }), status,
      h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Cancel'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => {
        if (!draft.title.trim()) { status.textContent = 'Give it a title.'; title.focus(); return; }
        if (draft.guideId === '') draft.guideId = null;
        if (draft.blocks && !draft.blocks.some(b => b.t === 'divider' || b.text || b.items?.some(Boolean) || b.mediaId || b.url || b.exerciseId)) draft.blocks = null;
        if (isNew) doc.activities.push(draft); else Object.assign(a, draft);
        doc.activities.sort((x, y) => x.day - y.day);
        ctx.markDirty(); close(); ctx.redraw();
      } }, isNew ? 'Add activity' : 'Done'));
  }, { wide: true });
}

export function renderDesign(box, ctx) {
  box.append(phaseStrip(ctx), activityList(ctx));
}

// MARK: - Kit & spend

export function renderKit(box, ctx) {
  const { doc } = ctx;
  const totals = () => {
    const req = doc.kit.filter(k => k.required).reduce((s, k) => s + (k.estPence || 0), 0);
    const opt = doc.kit.filter(k => !k.required).reduce((s, k) => s + (k.estPence || 0), 0);
    const kitIds = new Set(doc.kit.map(k => k.id ?? k.key));
    const buys = doc.activities.filter(a => a.kind === 'purchase' && !(a.linkRef && kitIds.has(a.linkRef))).reduce((s, a) => s + (a.spendPence || 0), 0);
    return { req, opt, buys, expected: req + buys };
  };
  const hero = h('section', { class: 'cg-card cg-spend-hero' });
  const drawHero = () => {
    const t = totals();
    fill(hero,
      h('div', { class: 'cg-spend-text' },
        h('div', { class: 'ui-eyebrow' }, 'What it costs a client'),
        h('div', { class: 'cg-big' }, money(t.expected), h('span', null, ' expected spend')),
        h('p', { class: 'muted m0' }, `Required kit ${money(t.req)}${t.buys ? ` · planned purchases ${money(t.buys)}` : ''} · optional kit ${money(t.opt)}${doc.campaign.feePence ? ` · plus the ${money(doc.campaign.feePence)} fee` : ''}`),
        h('p', { class: 'small faint' }, 'Invitations state the dates, the fee, the required kit with prices and the optional total, before anyone commits.')),
      doc.kit.length ? donut({ parts: [{ label: 'Required', value: t.req / 100, tone: 1 }, { label: 'Optional', value: t.opt / 100, tone: 2 }, ...(t.buys ? [{ label: 'Purchases', value: t.buys / 100, tone: 5 }] : [])].filter(p => p.value > 0),
        centre: { value: `£${Math.round((t.req + t.opt + t.buys) / 100)}`, label: 'all in' }, size: 150, ariaLabel: 'Kit spend split', format: v => `£${Math.round(v)}` }) : null);
  };
  const list = h('div', { class: 'cg-kit' });
  const drawList = () => fill(list, doc.kit.length ? doc.kit.map((k, i) => {
    const url = h('input', { value: k.url ?? '', placeholder: 'https:// (optional)', 'aria-label': `${k.name} link`, inputmode: 'url', oninput: e => {
      const v = e.target.value.trim(); k.url = v || null; e.target.setAttribute('aria-invalid', String(!!v && !/^https:\/\/\S+\.\S+/.test(v))); ctx.markDirty();
    } });
    return h('div', { class: 'cg-kit-row' + (k.required ? ' req' : '') },
      h('span', { class: 'cg-kit-n', 'aria-hidden': 'true' }, String(i + 1)),
      h('input', { class: 'cg-kit-name', value: k.name, maxlength: '80', 'aria-label': 'Item name', oninput: e => { k.name = e.target.value; ctx.markDirty(); } }),
      moneyInput({ value: k.estPence, label: `${k.name} expected price`, onChange: p => { k.estPence = p ?? 0; ctx.markDirty(); drawHero(); } }),
      h('label', { class: 'cg-req-toggle' }, h('input', { type: 'checkbox', checked: k.required, onchange: e => { k.required = e.target.checked; ctx.markDirty(); drawHero(); e.target.closest('.cg-kit-row').classList.toggle('req', k.required); } }), 'Required'),
      url,
      h('input', { class: 'cg-kit-note', value: k.note ?? '', maxlength: '300', placeholder: 'Note', 'aria-label': `${k.name} note`, oninput: e => { k.note = e.target.value; ctx.markDirty(); } }),
      h('button', { type: 'button', class: 'ui-icon-btn small', 'aria-label': `Remove ${k.name}`, onclick: () => { doc.kit.splice(i, 1); ctx.markDirty(); drawList(); drawHero(); } }, icon('close', 16)));
  }) : h('p', { class: 'cg-blank-line' }, 'No kit yet. Shoes, gels, a foam roller: list what people need and what it costs.'));
  const add = h('button', { type: 'button', class: 'btn small', onclick: () => { doc.kit.push({ key: tempKey(), name: 'New item', estPence: 0, required: false, url: null, note: '' }); ctx.markDirty(); drawList(); drawHero(); list.querySelector('.cg-kit-row:last-child .cg-kit-name')?.select(); } }, icon('add', 16), 'Add item');
  drawHero(); drawList();
  const reported = h('div');
  box.append(hero, h('section', { class: 'cg-card' },
    h('div', { class: 'cg-card-head' }, h('div', null, h('h2', null, 'Kit list'), h('p', { class: 'small muted m0' }, 'Links must be https and open in a new tab. Nothing is ever fetched from them.')), add),
    h('div', { class: 'cg-kit-head', 'aria-hidden': 'true' }, h('span'), h('span', null, 'Item'), h('span', null, 'Expected'), h('span', null, ''), h('span', null, 'Link'), h('span', null, 'Note'), h('span')),
    list), reported);
  if (doc.campaign.status !== 'draft') {
    api('GET', `/api/campaigns/${encodeURIComponent(ctx.id)}/board`).then(b => {
      if (!b.clients.length) return;
      fill(reported, h('section', { class: 'cg-card' }, h('div', { class: 'cg-card-head' }, h('div', null, h('h2', null, 'What people say they spent'),
        h('p', { class: 'small muted m0' }, `${money(b.totals.spentPence)} reported against ${money(b.totals.expectedSpendPence)} expected, across ${plural(b.clients.length, 'person', 'people')}.`))),
      h('div', { class: 'cg-spendbars' }, b.clients.map(r => spendBar(r)))));
    }).catch(() => {});
  }
}

/** Expected vs actual for one client: two bars on one scale. */
export function spendBar(r) {
  const max = Math.max(r.expectedSpendPence, r.spentPence, 1);
  return h('div', { class: 'cg-sb' },
    h('span', { class: 'cg-sb-name' }, r.client.name.split(' ')[0]),
    h('div', { class: 'cg-sb-bars' },
      h('span', { class: 'cg-sb-exp', style: { '--w': `${(r.expectedSpendPence / max) * 100}%` }, title: `Expected ${money(r.expectedSpendPence)}` }),
      h('span', { class: 'cg-sb-act' + (r.spentPence > r.expectedSpendPence ? ' over' : ''), style: { '--w': `${(r.spentPence / max) * 100}%` }, title: `Spent ${money(r.spentPence)}` })),
    h('span', { class: 'cg-sb-num' }, money(r.spentPence), h('small', null, ` of ${money(r.expectedSpendPence)}`)));
}

// MARK: - Settings

export function renderSettings(box, ctx) {
  const c = ctx.doc.campaign;
  const set = (k, v) => { c[k] = v; ctx.markDirty(); };
  const setS = (k, v) => { c.settings = { ...c.settings, [k]: v }; ctx.markDirty(); };
  const startsOn = h('input', { type: 'date', value: c.startsOn ?? '', onchange: e => set('startsOn', e.target.value || null) });
  const startBox = h('div', { class: 'field', hidden: c.startMode !== 'fixed' }, h('label', null, 'Starts on'), startsOn);
  const challenges = h('select', { onchange: e => set('challengeId', e.target.value || null) }, h('option', { value: '' }, 'None'));
  api('GET', '/api/challenges').then(r => { for (const ch of r.challenges) challenges.append(h('option', { value: ch.id, selected: ch.id === c.challengeId }, `${ch.title} (${ch.start} – ${ch.end})`)); }).catch(() => {});
  const cap = h('input', { type: 'number', min: '1', max: '1000', value: c.capacity ?? '', placeholder: 'No limit', oninput: e => set('capacity', e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : null) });
  const section = (title, sub, ...kids) => h('section', { class: 'cg-card cg-settings' }, h('div', { class: 'cg-set-head' }, h('h2', null, title), sub ? h('p', { class: 'small muted m0' }, sub) : null), h('div', { class: 'cg-set-body' }, kids));
  box.append(
    section('The basics', 'What clients see first.',
      field('Name', h('input', { value: c.name, maxlength: '80', oninput: e => set('name', e.target.value) })),
      field('Tagline', h('input', { value: c.tagline, maxlength: '140', placeholder: 'From 10 km to race day', oninput: e => set('tagline', e.target.value) })),
      field('Description', h('textarea', { rows: '3', maxlength: '2000', value: c.description, oninput: e => set('description', e.target.value) })),
      field('Welcome note', h('textarea', { rows: '2', maxlength: '1000', value: c.welcomeText, placeholder: 'Shown on the invitation and the plan page', oninput: e => set('welcomeText', e.target.value) })),
      field('Completion message', h('textarea', { rows: '2', maxlength: '1000', value: c.completionText, placeholder: 'Sent when someone finishes', oninput: e => set('completionText', e.target.value) }))),
    section('Dates and money', 'Live campaigns may be edited: changes apply from today on, and past progress stays.',
      h('div', { class: 'field' }, h('label', null, 'Start'), segmentedNav([['fixed', 'Fixed dates'], ['rolling', 'Rolling: from the day they accept']], c.startMode, v => { set('startMode', v); startBox.hidden = v !== 'fixed'; }, { label: 'Start mode' })),
      h('div', { class: 'cg-form-grid' }, startBox,
        field('Length (days)', h('input', { type: 'number', min: '1', max: '366', value: String(c.lengthDays), oninput: e => { const v = Math.round(Number(e.target.value)); if (v >= 1 && v <= 366) set('lengthDays', v); } })),
        h('div', { class: 'field' }, h('label', null, 'Fee'), moneyInput({ value: c.feePence, label: 'Fee', onChange: p => set('feePence', p ?? 0) }), h('span', { class: 'small faint' }, 'Invoiced only when someone accepts.')),
        field('Places', cap)),
      switchRow('Waitlist when full', c.waitlist, v => set('waitlist', v), { detail: 'Accepting a full campaign joins the waitlist; a freed place goes to the longest waiting.' })),
    section('Engagement', null,
      switchRow('Daily nudge', c.settings.dailyNudge, v => setS('dailyNudge', v), { detail: 'One message a day with today\'s activities and the plan link. Quiet hours and the daily cap apply.' }),
      h('div', { class: 'cg-form-grid' }, field('Nudge time', h('input', { type: 'time', value: c.settings.nudgeAt, step: '300', onchange: e => setS('nudgeAt', e.target.value || '07:00') })), field('Linked challenge', challenges)),
      switchRow('Show clients their rank', c.settings.showRank, v => setS('showRank', v), { detail: 'They see their position, never the other names.' }),
      switchRow('Public offer', c.public, v => set('public', v), { detail: 'Listed on your enquiry page (?campaign=) while it is live.' })),
    section('Archive or delete', null,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', onclick: () => ctx.setStatus('archived') }, icon('archive', 16), 'Archive'),
        h('button', { type: 'button', class: 'btn danger', onclick: async () => {
          if (!await confirmBox(`Delete “${c.name}”?`, { ok: 'Delete', danger: true, detail: 'Only drafts, or campaigns nobody joined, can be deleted.' })) return;
          try { await api('DELETE', `/api/campaigns/${encodeURIComponent(ctx.id)}`); ctx.discard(); toast('Campaign deleted.'); location.hash = '/campaigns'; } catch (err) { toast(err.message, { error: true }); }
        } }, icon('delete', 16), 'Delete'))));
}

