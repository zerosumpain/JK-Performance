/*
 * F14 Guidebook (docs/design/desk-v2.md, WP4): /guidebook, a gallery of the
 * coach's guides, and /guidebook/:id, a block editor beside a live phone
 * preview. Guides are JSON blocks; text is plain, with **bold** and _italic_
 * only. Nothing here is ever set as HTML: every block is drawn with h().
 *
 * Exports renderGuide() and blockEditor() for the campaigns screens.
 */
import {
  api, apiBlob, apiUpload, busy, button, clients as loadClients, confirmBox, fill, fmtRelative, go, h, icon, link, mediaImage, registerCommand, registerNav,
  route, setCrumbs, toast,
} from './core.js';
import { emptyHero, menu, pageHead, popover, segmentedNav, skeleton, slideOver } from './ui.js';

const enc = encodeURIComponent;

// MARK: - Blocks: the types, inline runs and the renderer

export const BLOCKS = [
  { t: 'h', label: 'Heading', glyph: 'format_quote', hint: 'A section title' },
  { t: 'p', label: 'Paragraph', glyph: 'description', hint: 'Plain text with **bold** and _italic_' },
  { t: 'list', label: 'List', glyph: 'format_list_bulleted', hint: 'Bullets, numbers or ticks' },
  { t: 'callout', label: 'Callout', glyph: 'lightbulb', hint: 'A tip, a warning or a note' },
  { t: 'image', label: 'Image', glyph: 'image', hint: 'A JPEG or PNG' },
  { t: 'video', label: 'Video', glyph: 'videocam', hint: 'An MP4, up to 60 MB' },
  { t: 'audio', label: 'Audio', glyph: 'graphic_eq', hint: 'An M4A voice note' },
  { t: 'link', label: 'Link', glyph: 'link', hint: 'An https link' },
  { t: 'exercise', label: 'Exercise', glyph: 'fitness_center', hint: 'From the library' },
  { t: 'divider', label: 'Divider', glyph: 'more_horiz', hint: 'A quiet break' },
];
const blockMeta = t => BLOCKS.find(b => b.t === t) ?? BLOCKS[1];
const fresh = t => ({ h: { t, text: '' }, p: { t, text: '' }, list: { t, style: 'bullet', items: [''] }, callout: { t, tone: 'tip', text: '' },
  image: { t, mediaId: null, caption: '' }, video: { t, mediaId: null, caption: '' }, audio: { t, mediaId: null, caption: '' },
  link: { t, url: 'https://', label: '' }, exercise: { t, exerciseId: null }, divider: { t } }[t]);

/** `**bold**` and `_italic_`, the same tokeniser as the server's: text nodes and <strong>/<em> only. */
export function runs(text) {
  const out = [];
  const s = String(text ?? '');
  const re = /\*\*([^*\n]+?)\*\*|(?<![\p{L}\p{N}])_([^_\n]+?)_(?![\p{L}\p{N}])/gu;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(m[1] !== undefined ? h('strong', null, m[1]) : h('em', null, m[2]));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

let exerciseCache = null;
const exercises = () => (exerciseCache ??= api('GET', '/api/exercises').then(r => r.exercises).catch(() => []));
const TONE = { tip: ['Tip', 'lightbulb'], warn: ['Careful', 'warning'], info: ['Note', 'help'] };

/**
 * Blocks drawn as the apps draw them (the phone preview, campaign activity
 * guides). `mediaUrl(id)` gives the URL a file is fetched from with the session.
 */
export function renderGuide(blocks, { mediaUrl = id => `/api/media/${enc(id)}`, title = null } = {}) {
  const box = h('div', { class: 'gb-render' });
  if (title) box.append(h('h1', { class: 'gb-r-title' }, title));
  for (const b of blocks ?? []) {
    if (b.t === 'h') { if (b.text) box.append(h('h2', { class: 'gb-r-h' }, runs(b.text))); }
    else if (b.t === 'p') { if (b.text) box.append(h('p', { class: 'gb-r-p' }, runs(b.text))); }
    else if (b.t === 'list') {
      const items = (b.items ?? []).filter(Boolean);
      if (!items.length) continue;
      box.append(h(b.style === 'number' ? 'ol' : 'ul', { class: `gb-r-list ${b.style}` }, items.map(x => h('li', null,
        b.style === 'check' ? h('span', { class: 'gb-r-box', 'aria-hidden': 'true' }) : null, h('span', null, runs(x))))));
    } else if (b.t === 'callout') {
      if (!b.text) continue;
      const [word, glyph] = TONE[b.tone] ?? TONE.tip;
      box.append(h('aside', { class: `gb-r-callout ${b.tone}` }, icon(glyph, 18), h('div', null, h('b', null, word), ' ', runs(b.text))));
    } else if (b.t === 'image' || b.t === 'video' || b.t === 'audio') {
      if (!b.mediaId) { box.append(h('div', { class: 'gb-r-media empty' }, icon(blockMeta(b.t).glyph, 22), `No ${b.t} yet`)); continue; }
      let media;
      if (b.t === 'image') media = mediaImage(mediaUrl(b.mediaId), b.caption || 'Guide image', { class: 'gb-r-img' });
      else {
        media = h(b.t, { class: `gb-r-${b.t}`, controls: true, preload: 'metadata' });
        apiBlob(mediaUrl(b.mediaId)).then(blob => { media.src = URL.createObjectURL(blob); }, () => {});
      }
      box.append(h('figure', { class: 'gb-r-fig' }, media, b.caption ? h('figcaption', null, b.caption) : null));
    } else if (b.t === 'link') {
      if (!/^https:\/\//.test(b.url ?? '')) continue;
      box.append(h('a', { class: 'gb-r-link', href: b.url, target: '_blank', rel: 'noopener noreferrer' }, icon('open_in_new', 16), h('span', null, b.label || b.url)));
    } else if (b.t === 'exercise') {
      if (!b.exerciseId) continue;
      const row = h('div', { class: 'gb-r-ex' }, icon('fitness_center', 18), h('span', null, 'Exercise'));
      exercises().then(list => { const ex = list.find(x => x.id === b.exerciseId); if (ex) fill(row, icon('fitness_center', 18), h('div', null, h('b', null, ex.name), ex.equipment ? h('div', { class: 'small muted' }, ex.equipment) : null)); });
      box.append(row);
    } else if (b.t === 'divider') box.append(h('hr', { class: 'gb-r-hr' }));
  }
  if (!box.childNodes.length) box.append(h('p', { class: 'gb-r-empty' }, 'Start writing and it appears here.'));
  return box;
}

// MARK: - The block editor (also used for a campaign activity's inline guide)

const autoGrow = ta => { const fit = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; }; ta.addEventListener('input', fit); requestAnimationFrame(fit); return ta; };

/** A picker of block types under `anchor`; pick(t) gets the chosen type. */
function pickBlock(anchor, pick) {
  return popover(anchor, (box, close) => {
    const buttons = BLOCKS.map(b => h('button', { type: 'button', class: 'gb-pick', role: 'menuitem', onclick: () => { close(); pick(b.t); } },
      h('span', { class: 'gb-pick-icon' }, icon(b.glyph, 18)), h('span', null, h('b', null, b.label), h('span', { class: 'small muted' }, b.hint))));
    box.append(h('div', { class: 'gb-pick-head' }, 'Add a block'), ...buttons);
    box.addEventListener('keydown', e => {
      const i = buttons.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
    });
    requestAnimationFrame(() => buttons[0].focus());
  }, { className: 'gb-pop', role: 'menu', label: 'Block types' });
}

/**
 * blockEditor({blocks, onChange(blocks)}) → {el, value(), set(blocks)}: rows
 * with a drag handle (Alt+↑/↓ moves one), a type menu, and `/` in an empty
 * paragraph for the block picker.
 */
export function blockEditor({ blocks = [], onChange = null, compact = false } = {}) {
  let list = blocks.map(b => ({ ...b, items: b.items ? [...b.items] : undefined }));
  const el = h('div', { class: 'gb-blocks' + (compact ? ' compact' : '') });
  const changed = () => onChange?.(value());
  const value = () => list.map(b => Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)));
  let dragFrom = null;

  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    draw(j);
    changed();
  };
  const insertAt = (i, t) => { list.splice(i, 0, fresh(t)); draw(i, true); changed(); };

  function editorFor(b, i) {
    const set = (k, v) => { b[k] = v; changed(); };
    if (b.t === 'h') return h('input', { class: 'gb-in-h', value: b.text, placeholder: 'Heading', 'aria-label': 'Heading', oninput: e => set('text', e.target.value) });
    if (b.t === 'p') {
      const ta = autoGrow(h('textarea', { class: 'gb-in-p', rows: '1', value: b.text, placeholder: 'Write, or type / for a block', 'aria-label': 'Paragraph', oninput: e => set('text', e.target.value) }));
      ta.addEventListener('keydown', e => {
        if (e.key === '/' && !ta.value) { e.preventDefault(); pickBlock(ta, t => { list[i] = fresh(t); draw(i, true); changed(); }); }
      });
      return ta;
    }
    if (b.t === 'list') {
      const ta = autoGrow(h('textarea', { class: 'gb-in-list', rows: '2', value: (b.items ?? []).join('\n'), placeholder: 'One item per line', 'aria-label': 'List items, one per line',
        oninput: e => set('items', e.target.value.split('\n').slice(0, 30)) }));
      return h('div', { class: 'gb-in-stack' }, segmentedNav([['bullet', '• Bullets'], ['number', '1. Numbers'], ['check', '☐ Ticks']], b.style, v => set('style', v), { label: 'List style' }), ta);
    }
    if (b.t === 'callout') {
      return h('div', { class: 'gb-in-stack' }, segmentedNav([['tip', 'Tip'], ['warn', 'Careful'], ['info', 'Note']], b.tone, v => set('tone', v), { label: 'Callout tone' }),
        autoGrow(h('textarea', { rows: '2', value: b.text, placeholder: 'What should they know?', 'aria-label': 'Callout text', oninput: e => set('text', e.target.value) })));
    }
    if (b.t === 'image' || b.t === 'video' || b.t === 'audio') {
      const accept = { image: 'image/jpeg,image/png', video: 'video/mp4', audio: 'audio/mp4,audio/x-m4a,audio/m4a' }[b.t];
      const status = h('span', { class: 'small muted' }, b.mediaId ? 'File attached' : 'No file yet');
      const file = h('input', { type: 'file', accept, class: 'gb-file', 'aria-label': `Choose ${b.t}`, onchange: async e => {
        const f = e.target.files?.[0];
        if (!f) return;
        status.textContent = 'Uploading…';
        try {
          const type = f.type || (b.t === 'audio' ? 'audio/mp4' : b.t === 'video' ? 'video/mp4' : 'image/jpeg');
          const m = await apiUpload('/api/media?purpose=guide', f, type);
          set('mediaId', m.id);
          status.textContent = 'Uploaded';
        } catch (err) { status.textContent = err.message; }
      } });
      return h('div', { class: 'gb-in-stack' }, h('div', { class: 'row gap8' }, file, status),
        h('input', { value: b.caption ?? '', placeholder: 'Caption (optional)', 'aria-label': 'Caption', oninput: e => set('caption', e.target.value) }));
    }
    if (b.t === 'link') {
      const url = h('input', { value: b.url ?? '', placeholder: 'https://…', 'aria-label': 'Link address', inputmode: 'url', oninput: e => { set('url', e.target.value); url.setAttribute('aria-invalid', String(!/^https:\/\/\S+\.\S+/.test(e.target.value))); } });
      return h('div', { class: 'gb-in-two' }, url, h('input', { value: b.label ?? '', placeholder: 'Label', 'aria-label': 'Link label', oninput: e => set('label', e.target.value) }));
    }
    if (b.t === 'exercise') {
      const sel = h('select', { 'aria-label': 'Exercise', onchange: e => set('exerciseId', e.target.value || null) }, h('option', { value: '' }, 'Choose an exercise…'));
      exercises().then(xs => { for (const x of xs) sel.append(h('option', { value: x.id, selected: x.id === b.exerciseId }, x.name)); });
      return sel;
    }
    return h('hr', { class: 'gb-in-hr' });
  }

  function row(b, i) {
    const meta = blockMeta(b.t);
    const handle = h('button', { type: 'button', class: 'gb-handle', draggable: 'true', 'aria-label': `${meta.label} block ${i + 1}. Alt and the arrow keys move it.`,
      onkeydown: e => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(i, e.key === 'ArrowUp' ? -1 : 1); } } }, icon('drag_indicator', 18));
    const more = h('button', { type: 'button', class: 'ui-icon-btn small gb-more', 'aria-label': `${meta.label} block options`, onclick: () => menu(more, [
      ...BLOCKS.filter(x => x.t !== b.t).slice(0, 4).map(x => ({ label: `Turn into ${x.label.toLowerCase()}`, icon: x.glyph, onclick: () => {
        const text = b.text ?? (b.items ?? []).join('\n');
        list[i] = { ...fresh(x.t), ...(x.t === 'list' ? { items: text.split('\n') } : 'text' in fresh(x.t) ? { text } : {}) };
        draw(i); changed();
      } })),
      'sep',
      { label: 'Move up', icon: 'arrow_upward', kbd: '⌥↑', disabled: i === 0, onclick: () => move(i, -1) },
      { label: 'Move down', icon: 'arrow_downward', kbd: '⌥↓', disabled: i === list.length - 1, onclick: () => move(i, 1) },
      { label: 'Duplicate', icon: 'content_copy', onclick: () => { list.splice(i + 1, 0, structuredClone(b)); draw(i + 1); changed(); } },
      { label: 'Add a block below', icon: 'add', onclick: () => pickBlock(more, t => insertAt(i + 1, t)) },
      'sep',
      { label: 'Delete', icon: 'delete', danger: true, onclick: () => { list.splice(i, 1); draw(Math.max(0, i - 1)); changed(); } },
    ], { label: 'Block options' }) }, icon('more_horiz', 18));
    const r = h('div', { class: `gb-row t-${b.t}`, 'data-i': String(i) },
      handle, h('span', { class: 'gb-kind', title: meta.label, 'aria-hidden': 'true' }, icon(meta.glyph, 16)), h('div', { class: 'gb-edit' }, editorFor(b, i)), more);
    handle.addEventListener('dragstart', e => { dragFrom = i; r.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
    handle.addEventListener('dragend', () => { r.classList.remove('dragging'); el.querySelectorAll('.drop').forEach(x => x.classList.remove('drop')); });
    r.addEventListener('dragover', e => { if (dragFrom === null) return; e.preventDefault(); r.classList.add('drop'); });
    r.addEventListener('dragleave', () => r.classList.remove('drop'));
    r.addEventListener('drop', e => {
      e.preventDefault();
      if (dragFrom === null || dragFrom === i) return;
      const [moved] = list.splice(dragFrom, 1);
      list.splice(i, 0, moved);
      dragFrom = null;
      draw(i); changed();
    });
    return r;
  }

  const adder = h('button', { type: 'button', class: 'gb-add', onclick: () => pickBlock(adder, t => insertAt(list.length, t)) }, icon('add', 18), 'Add a block');
  function draw(focusIndex = null, focusInput = false) {
    el.replaceChildren(...list.map(row), adder);
    if (focusIndex !== null) {
      const rowEl = el.querySelector(`.gb-row[data-i="${focusIndex}"]`);
      const target = rowEl?.querySelector(focusInput ? '.gb-edit input:not([type=file]), .gb-edit textarea' : '.gb-handle');
      target?.focus({ preventScroll: false });
    }
  }
  draw();
  return { el, value, set(next) { list = next.map(b => ({ ...b })); draw(); } };
}

// MARK: - Gallery

const statusPill = s => h('span', { class: `gb-status ${s}` }, icon(s === 'published' ? 'check_circle' : 'edit_note', 14), s === 'published' ? 'Published' : 'Draft');

function guideCard(g) {
  const tone = 1 + [...g.id].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 997, 7) % 5;
  const cover = h('div', { class: `gb-card-cover tone-${tone}` + (g.cover ? ' has-img' : '') },
    g.cover ? mediaImage(`/api/media/${enc(g.cover)}`, '', { class: 'gb-card-img' }) : h('span', { class: 'gb-card-glyph', 'aria-hidden': 'true' }, icon('menu_book', 56)),
    h('span', { class: 'gb-card-title' }, g.title));
  return link(`/guidebook/${enc(g.id)}`, { class: 'gb-card' }, cover,
    h('div', { class: 'gb-card-body' },
      h('div', { class: 'spread' }, statusPill(g.status), h('span', { class: 'tiny faint' }, `Edited ${fmtRelative(g.updatedAt)}`)),
      g.summary ? h('p', { class: 'gb-card-sum clamp2' }, g.summary) : h('p', { class: 'gb-card-sum faint' }, 'No summary yet.'),
      g.tags.length ? h('div', { class: 'gb-tags' }, g.tags.map(t => h('span', { class: 'gb-tag' }, t))) : null,
      h('div', { class: 'gb-card-foot' },
        h('span', null, icon('description', 14), `${g.blockCount} blocks`), h('span', null, icon('timer', 14), `${g.readMinutes} min read`),
        h('span', null, icon('visibility', 14), `${g.opens} read${g.opens === 1 ? '' : 's'}`))));
}

async function newGuide() {
  const { guide } = await api('POST', '/api/guidebook', { title: 'Untitled guide', blocks: [{ t: 'h', text: '' }, { t: 'p', text: '' }] });
  go(`/guidebook/${enc(guide.id)}`);
}

route('/guidebook', async (el, _p, view) => {
  setCrumbs([{ label: 'Build' }, { label: 'Guidebook', path: '/guidebook' }]);
  const grid = h('div', { class: 'gb-grid' }, skeleton('card', { rows: 3 }), skeleton('card', { rows: 3 }), skeleton('card', { rows: 3 }));
  const search = h('input', { type: 'search', class: 'gb-search', placeholder: 'Search guides', 'aria-label': 'Search guides' });
  const tagBar = h('div', { class: 'gb-filter', role: 'group', 'aria-label': 'Filter by tag' });
  const newBtn = button('New guide', e => busy(e.currentTarget, null, newGuide), { kind: 'primary' });
  newBtn.prepend(icon('add', 18));
  el.append(pageHead({ eyebrow: 'Build', title: 'The', accent: 'guidebook', sub: 'Clear, good-looking guides, written once. Attach them to campaigns or send one to a client.', actions: [newBtn] }),
    h('div', { class: 'gb-tools' }, h('label', { class: 'gb-search-wrap' }, icon('search', 18), search), tagBar), grid);
  let guides = [];
  let tag = null;
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = guides.filter(g => (!tag || g.tags.includes(tag)) && (!q || `${g.title} ${g.summary} ${g.tags.join(' ')}`.toLowerCase().includes(q)));
    const tags = [...new Set(guides.flatMap(g => g.tags))].sort();
    fill(tagBar, tags.length ? [h('button', { type: 'button', class: 'gb-chip' + (tag ? '' : ' on'), 'aria-pressed': String(!tag), onclick: () => { tag = null; draw(); } }, 'All'),
      tags.map(t => h('button', { type: 'button', class: 'gb-chip' + (tag === t ? ' on' : ''), 'aria-pressed': String(tag === t), onclick: () => { tag = tag === t ? null : t; draw(); } }, t))] : null);
    if (!guides.length) fill(grid, h('div', { class: 'gb-empty' }, emptyHero({ icon: 'menu_book', title: 'Your first guide', line: 'How to fuel a long run, your first week, a warm-up: write it once and use it everywhere.', action: { label: 'Write a guide', onclick: newGuide } })));
    else fill(grid, shown.length ? shown.map(guideCard) : h('p', { class: 'muted' }, 'No guide matches that.'));
  };
  search.addEventListener('input', draw);
  const r = await api('GET', '/api/guidebook');
  if (!view.fresh()) return;
  guides = r.guides;
  draw();
});

// MARK: - Editor

/** Choose one of the coach's clients (a searchable list in a slide-over). Resolves the client or null. */
export function pickClient(title, { action = 'Choose', detail = null } = {}) {
  return new Promise(resolve => {
    let chosen = null;
    slideOver(title, (body, close) => {
      const search = h('input', { type: 'search', placeholder: 'Search clients', 'aria-label': 'Search clients', autofocus: true });
      const listEl = h('div', { class: 'gb-clients', role: 'listbox' }, skeleton('table', { rows: 4 }));
      body.append(detail ? h('p', { class: 'muted small' }, detail) : null, search, listEl);
      loadClients().then(cs => {
        const draw = () => {
          const q = search.value.trim().toLowerCase();
          fill(listEl, cs.filter(c => !q || c.name.toLowerCase().includes(q)).map(c => h('button', { type: 'button', role: 'option', class: 'gb-client', onclick: () => { chosen = c; close(); } },
            h('span', { class: 'avatar', 'aria-hidden': 'true' }, c.initials), h('span', { class: 'grow' }, c.name), h('span', { class: 'small muted' }, action), icon('chevron_right', 16))));
        };
        search.addEventListener('input', draw);
        draw();
      });
    }, { onClose: () => resolve(chosen) });
  });
}

route('/guidebook/:id', async (el, params, view) => {
  const id = params.id;
  el.append(h('div', { class: 'gb-layout' }, h('div', null, skeleton('card', { rows: 6 })), h('div', null, skeleton('card', { rows: 8 }))));
  let g;
  try { g = (await api('GET', `/api/guidebook/${enc(id)}`)).guide; } catch (err) {
    if (!view.fresh()) return;
    fill(el, emptyHero({ icon: 'menu_book', title: 'Guide not found', line: err.message, action: { label: 'All guides', path: '/guidebook' } }));
    return;
  }
  if (!view.fresh()) return;
  setCrumbs([{ label: 'Guidebook', path: '/guidebook' }, { label: g.title }]);
  const state = { title: g.title, summary: g.summary, tags: [...g.tags], status: g.status, blocks: g.blocks };
  const saved = h('span', { class: 'gb-saved', role: 'status', 'aria-live': 'polite' }, icon('check', 16), 'Saved');
  const phone = h('div', { class: 'gb-phone-screen' });
  const drawPreview = () => fill(phone, h('div', { class: 'gb-phone-bar' }, h('span', null, '9:41'), h('span', { class: 'gb-phone-notch' }), h('span', null, '●●●')),
    h('div', { class: 'gb-phone-eyebrow' }, 'A guide from your coach'), renderGuide(state.blocks.filter((b, i) => !(i === 0 && b.t === 'h' && (!b.text || b.text.trim() === state.title.trim()))), { title: state.title || 'Untitled guide' }));
  let timer = null, saving = Promise.resolve();
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      saved.classList.add('busy'); fill(saved, icon('sync', 16), 'Saving…');
      saving = saving.then(() => api('PUT', `/api/guidebook/${enc(id)}`, { title: state.title || 'Untitled guide', summary: state.summary, tags: state.tags, status: state.status, blocks: state.blocks }))
        .then(r => { g = r.guide; saved.classList.remove('busy', 'bad'); fill(saved, icon('check', 16), 'Saved'); },
          err => { saved.classList.remove('busy'); saved.classList.add('bad'); fill(saved, icon('error', 16), err.message); });
    }, 700);
  };
  const changed = () => { drawPreview(); save(); };
  view.onLeave(() => { if (timer) { clearTimeout(timer); api('PUT', `/api/guidebook/${enc(id)}`, { title: state.title || 'Untitled guide', summary: state.summary, tags: state.tags, status: state.status, blocks: state.blocks }).catch(() => {}); } });

  const title = h('input', { class: 'gb-title', value: state.title, placeholder: 'Guide title', 'aria-label': 'Title', oninput: e => { state.title = e.target.value; changed(); } });
  const summary = h('input', { class: 'gb-summary', value: state.summary, placeholder: 'One line on what it helps with', 'aria-label': 'Summary', maxlength: '300', oninput: e => { state.summary = e.target.value; changed(); } });
  const tagBox = h('div', { class: 'gb-tags edit' });
  const drawTags = () => fill(tagBox, state.tags.map(t => h('span', { class: 'gb-tag' }, t, h('button', { type: 'button', class: 'gb-tag-x', 'aria-label': `Remove tag ${t}`, onclick: () => { state.tags = state.tags.filter(x => x !== t); drawTags(); changed(); } }, icon('close', 12)))),
    state.tags.length < 8 ? h('input', { class: 'gb-tag-in', placeholder: '+ tag', 'aria-label': 'Add a tag', maxlength: '24', onkeydown: e => {
      if (e.key !== 'Enter' && e.key !== ',') return;
      e.preventDefault();
      const v = e.target.value.trim().toLowerCase();
      if (v && !state.tags.includes(v)) { state.tags.push(v); drawTags(); changed(); tagBox.querySelector('.gb-tag-in')?.focus(); }
    } }) : null);
  drawTags();
  const status = segmentedNav([['draft', 'Draft'], ['published', 'Published']], state.status, v => { state.status = v; changed(); if (v === 'published') toast('Published: clients can read it now.'); }, { label: 'Status' });
  const editor = blockEditor({ blocks: state.blocks, onChange: blocks => { state.blocks = blocks; changed(); } });

  const sendBtn = button('Send to client', async () => {
    if (state.status !== 'published') {
      if (!await confirmBox('Publish and send?', { ok: 'Publish', detail: 'Clients can only open published guides.' })) return;
      state.status = 'published';
      status.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b.textContent === 'Published')));
      await api('PUT', `/api/guidebook/${enc(id)}`, { ...state, title: state.title || 'Untitled guide' });
    }
    const c = await pickClient(`Send “${state.title}”`, { action: 'Send', detail: 'They get a message with a private link to read it in full.' });
    if (!c) return;
    try {
      await saving;
      await api('POST', `/api/guidebook/${enc(id)}/send`, { clientId: c.id });
      toast(`Sent to ${c.name.split(' ')[0]}.`, { action: { label: 'Open thread', run: () => go(`/messages/${enc(c.id)}`) } });
    } catch (err) { toast(err.message, { error: true }); }
  });
  sendBtn.prepend(icon('send', 16));
  const moreBtn = h('button', { type: 'button', class: 'ui-icon-btn', 'aria-label': 'More guide actions', onclick: () => menu(moreBtn, [
    { label: 'Delete guide', icon: 'delete', danger: true, onclick: async () => {
      if (!await confirmBox(`Delete “${state.title}”?`, { ok: 'Delete', danger: true, detail: 'Campaigns that use it stop showing it. This cannot be undone.' })) return;
      clearTimeout(timer); timer = null;
      await api('DELETE', `/api/guidebook/${enc(id)}`);
      toast('Guide deleted.');
      go('/guidebook');
    } },
  ]) }, icon('more_horiz', 20));

  fill(el,
    h('div', { class: 'gb-topline' }, link('/guidebook', { class: 'small muted gb-back' }, icon('chevron_left', 16), 'Guidebook'), h('span', { class: 'grow' }), saved, status, sendBtn, moreBtn),
    h('div', { class: 'gb-layout' },
      h('section', { class: 'gb-doc', 'aria-label': 'Guide editor' }, title, summary, tagBox, h('div', { class: 'gb-hint small faint' }, 'Type / in an empty paragraph to add a block. **bold** and _italic_ are the only formatting.'), editor.el),
      h('aside', { class: 'gb-preview', 'aria-label': 'Phone preview' }, h('div', { class: 'gb-preview-label' }, icon('visibility', 14), 'Live preview, as the apps show it'), h('div', { class: 'gb-phone' }, phone))));
  drawPreview();
});

// MARK: - Registrations

registerNav({ id: 'guidebook', label: 'Guidebook', icon: 'menu_book', group: 'build', order: 20, path: '/guidebook' });
registerCommand({ id: 'guidebook.new', label: 'New guide', icon: 'menu_book', group: 'Actions', run: () => newGuide().catch(err => toast(err.message, { error: true })) });
