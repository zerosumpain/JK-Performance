/*
 * F16 Message templates and snippets (WP5): /templates (a list grouped by
 * category with search and usage, and an editor with a live preview for a
 * chosen client), the composer's "Templates" tool, and a `/shortcut` slash
 * item for every template. Rendering always happens on the server, so the
 * preview is exactly what the client would get.
 */
import {
  api, busy, clients as loadClients, confirmBox, fill, getToken, go, h, icon, registerCommand, registerComposerTool, registerNav, registerSlash, route, setCrumbs, toast,
} from './core.js';
import { emptyHero, pageHead, popover, skeleton, slideOver } from './ui.js';

registerNav({ id: 'templates', label: 'Templates', icon: 'description', group: 'engage', order: 50, path: '/templates' });
registerCommand({ id: 'new-template', label: 'New template', icon: 'description', run: () => go('/templates?open=new') });

export const CATEGORY_LABEL = {
  checkin: 'Check-ins', welcome: 'Welcome', onboarding: 'Onboarding', nudge: 'Nudges', celebrate: 'Celebrate', session: 'Sessions',
  billing: 'Billing', renewal: 'Renewals', campaign: 'Campaigns', winback: 'Win-back', general: 'General',
};
const ORDER = Object.keys(CATEGORY_LABEL);
const enc = encodeURIComponent;

// MARK: - Shared loading (the composer tool and the slash items)

let cache = null;
export function templates(force = false) {
  if (!cache || force) cache = api('GET', '/api/templates').then(r => r.templates).catch(err => { cache = null; throw err; });
  return cache;
}

/** Put a template into a composer, rendered for its client when it has one, and count the use. */
export async function insertTemplate(composer, t) {
  let text = t.body;
  if (composer.clientId) {
    try {
      const r = await api('POST', '/api/templates/render', { templateId: t.id, clientId: composer.clientId });
      text = r.text;
      if (r.missing.length) toast(`Check ${r.missing.map(m => `{${m}}`).join(', ')}: not a known variable`, { error: true });
    } catch { /* fall back to the raw text */ }
  }
  composer.insert(text);
  api('POST', `/api/templates/${enc(t.id)}/used`).catch(() => {});
}

let slashLoaded = false;
/** Register a `/shortcut` slash item for every template (once, after sign-in). */
export async function ensureSlash(force = false) {
  if ((slashLoaded && !force) || !getToken()) return;
  slashLoaded = true;
  try {
    for (const t of await templates(force)) {
      if (!t.shortcut) continue;
      registerSlash({ id: t.shortcut, label: t.name, detail: t.body.slice(0, 60), run: c => insertTemplate(c, t) });
    }
  } catch { slashLoaded = false; }
}
// The first time any composer gets focus, the shortcuts load; the `/` menu reads the registry as the coach types.
document.addEventListener('focusin', e => { if (e.target?.classList?.contains('cmp-input')) ensureSlash(); });

registerComposerTool({
  id: 'templates', icon: 'description', label: 'Templates', order: 10,
  run: (composer, ctx) => {
    popover(ctx.anchor, (box, close) => {
      const search = h('input', { type: 'search', placeholder: 'Find a template', 'aria-label': 'Find a template' });
      const list = h('div', { class: 'mt-pop-list', role: 'listbox', 'aria-label': 'Templates' }, skeleton('lines', { rows: 3 }));
      let all = [];
      let at = 0;
      const shown = () => {
        const q = search.value.trim().toLowerCase();
        return all.filter(t => !q || t.name.toLowerCase().includes(q) || (t.shortcut ?? '').includes(q) || t.body.toLowerCase().includes(q)).slice(0, 10);
      };
      const pick = t => { close(); insertTemplate(composer, t); };
      const draw = () => {
        const rows = shown();
        at = Math.min(at, Math.max(0, rows.length - 1));
        fill(list, rows.length ? rows.map((t, i) => h('button', { type: 'button', role: 'option', 'aria-selected': String(i === at), class: 'mt-pop-opt' + (i === at ? ' sel' : ''), onclick: () => pick(t) },
          h('span', { class: 'mt-pop-name' }, t.name), t.shortcut ? h('span', { class: 'mt-sc' }, `/${t.shortcut}`) : null,
          h('span', { class: 'mt-pop-body' }, t.body))) : h('p', { class: 'small faint pad-s' }, all.length ? 'No templates match.' : 'No templates yet.'),
        h('a', { href: '#/templates', class: 'mt-pop-manage', onclick: () => close() }, icon('settings', 14), 'Manage templates'));
      };
      search.addEventListener('input', () => { at = 0; draw(); });
      search.addEventListener('keydown', e => {
        const rows = shown();
        if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(rows.length - 1, at + 1); draw(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(0, at - 1); draw(); }
        else if (e.key === 'Enter' && rows[at]) { e.preventDefault(); pick(rows[at]); }
      });
      box.append(search, list);
      templates().then(t => { all = [...t].sort((x, y) => y.uses - x.uses); draw(); }).catch(err => fill(list, h('p', { class: 'error' }, err.message)));
      requestAnimationFrame(() => search.focus());
    }, { className: 'mt-pop', label: 'Templates' });
  },
});

// MARK: - The editor (inline on wide screens, a slide-over on phones)

/** Draw `{first}` tokens as chips; ones in `missing` are flagged. */
function bodyWithVars(text, missing = []) {
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h('span', { class: 'mt-v' + (missing.includes(m[1]) ? ' missing' : ''), title: missing.includes(m[1]) ? 'Not a known variable' : null }, m[1]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function editor(box, t, { vars, people, onSaved, onDeleted, close = null }) {
  const draft = { name: t?.name ?? '', body: t?.body ?? '', category: t?.category ?? 'general', shortcut: t?.shortcut ?? '' };
  const status = h('div');
  const name = h('input', { id: 'mt-name', maxlength: '80', value: draft.name, placeholder: 'Weekly check-in', oninput: e => { draft.name = e.target.value; } });
  const cat = h('select', { id: 'mt-cat', onchange: e => { draft.category = e.target.value; } }, ORDER.map(c => h('option', { value: c, selected: c === draft.category }, CATEGORY_LABEL[c])));
  const sc = h('input', { id: 'mt-sc', maxlength: '25', value: draft.shortcut, placeholder: 'checkin', autocapitalize: 'off', spellcheck: 'false', oninput: e => { draft.shortcut = e.target.value.replace(/^\//, ''); } });
  const body = h('textarea', { id: 'mt-body', rows: '7', maxlength: '4000', value: draft.body, placeholder: 'Morning {first}! Quick check-in: how did the week feel?' });
  const chips = h('div', { class: 'mt-vars', role: 'group', 'aria-label': 'Insert a variable' }, vars.map(v => h('button', {
    type: 'button', class: 'mt-var', title: `${v.label}${v.example ? ` · e.g. ${v.example}` : ''}`,
    onclick: () => { body.setRangeText(`{${v.name}}`, body.selectionStart ?? body.value.length, body.selectionEnd ?? body.value.length, 'end'); body.focus(); body.dispatchEvent(new Event('input')); },
  }, `{${v.name}}`)));
  const who = h('select', { 'aria-label': 'Preview for', onchange: () => preview() }, people.map(p => h('option', { value: p.id }, p.name)));
  const bubble = h('div', { class: 'mt-bubble', 'aria-live': 'polite' });
  const warn = h('div', { class: 'mt-warn' });
  let timer = null;
  async function preview() {
    if (!draft.body.trim()) { fill(bubble, h('span', { class: 'faint' }, 'Your message, as they will read it.')); fill(warn); return; }
    if (!who.value) { fill(bubble, bodyWithVars(draft.body)); return; }
    try {
      const r = await api('POST', '/api/templates/render', { text: draft.body, clientId: who.value });
      fill(bubble, bodyWithVars(r.text, r.missing));
      fill(warn, r.missing.length ? [icon('warning', 14), `Not known: ${r.missing.map(m => `{${m}}`).join(', ')}. It would go out as written.`]
        : r.empty.length ? [icon('lightbulb', 14), `Empty for this client: ${r.empty.map(m => `{${m}}`).join(', ')}.`] : null);
    } catch (err) { fill(warn, err.message); }
  }
  body.addEventListener('input', () => { draft.body = body.value; clearTimeout(timer); timer = setTimeout(preview, 250); });
  const save = h('button', { type: 'button', class: 'btn primary', onclick: e => busy(e.currentTarget, status, async () => {
    const payload = { name: draft.name.trim(), body: draft.body, category: draft.category, shortcut: draft.shortcut.trim() || null };
    const r = t?.id ? await api('PUT', `/api/templates/${enc(t.id)}`, payload) : await api('POST', '/api/templates', payload);
    toast(t?.id ? 'Template saved' : 'Template added');
    templates(true).catch(() => {});
    ensureSlash(true);
    onSaved(r.template);
  }) }, t?.id ? 'Save' : 'Add template');
  const del = t?.id ? h('button', { type: 'button', class: 'btn text danger', onclick: async () => {
    if (!(await confirmBox(`Delete “${t.name}”?`, { ok: 'Delete', danger: true }))) return;
    await api('DELETE', `/api/templates/${enc(t.id)}`);
    templates(true).catch(() => {});
    toast('Template deleted');
    onDeleted();
  } }, icon('delete', 16), 'Delete') : null;
  fill(box,
    h('div', { class: 'mt-ed-grid' },
      h('div', { class: 'field mt-ed-name' }, h('label', { for: 'mt-name' }, 'Name'), name),
      h('div', { class: 'field' }, h('label', { for: 'mt-cat' }, 'Category'), cat),
      h('div', { class: 'field' }, h('label', { for: 'mt-sc' }, 'Shortcut'), h('span', { class: 'mt-sc-input' }, h('span', { 'aria-hidden': 'true' }, '/'), sc))),
    h('div', { class: 'field' }, h('label', { for: 'mt-body' }, 'Message'), body, chips),
    h('section', { class: 'mt-preview' },
      h('div', { class: 'mt-preview-head' }, h('span', { class: 'ui-eyebrow' }, 'Preview for'), who),
      h('div', { class: 'mt-thread' }, bubble), warn),
    status,
    h('div', { class: 'mt-ed-foot' }, t?.id ? h('span', { class: 'small faint grow' }, `Used ${t.uses} time${t.uses === 1 ? '' : 's'}`) : h('span', { class: 'grow' }),
      del, close ? h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Cancel') : null, save));
  preview();
}

// MARK: - The screen

route('/templates', async (el, _p, view) => {
  setCrumbs([{ label: 'Engage' }, { label: 'Templates', path: '/templates' }]);
  const newBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => open(null) }, icon('add', 18), 'New template');
  const search = h('input', { type: 'search', placeholder: 'Search templates', 'aria-label': 'Search templates' });
  const listBox = h('div', { class: 'mt-list' }, skeleton('lines', { rows: 6 }));
  const edBox = h('div', { class: 'mt-editor' }, skeleton('card', { rows: 5 }));
  fill(el, pageHead({ eyebrow: 'Engage', title: 'Templates', accent: 'one keystroke away', sub: 'Type / in any composer and a personalised message drops in.', actions: [newBtn] }),
    h('div', { class: 'mt-layout' }, h('aside', { class: 'mt-side' }, h('span', { class: 'mt-search' }, icon('search', 16), search), listBox), edBox));

  const [list, vars, people] = await Promise.all([templates(true), api('GET', '/api/templates/variables').then(r => r.variables), loadClients().catch(() => [])]);
  if (!view.fresh()) return;
  let all = list;
  let current = view.query.get('open');
  if (!current || (current !== 'new' && !all.some(t => t.id === current))) current = [...all].sort((x, y) => y.uses - x.uses)[0]?.id ?? null;
  const narrow = () => matchMedia('(max-width: 900px)').matches;

  function drawList() {
    const q = search.value.trim().toLowerCase();
    const rows = all.filter(t => !q || t.name.toLowerCase().includes(q) || (t.shortcut ?? '').includes(q) || t.body.toLowerCase().includes(q));
    if (!all.length) { fill(listBox, h('p', { class: 'small muted pad' }, 'No templates yet.')); return; }
    const max = Math.max(1, ...all.map(t => t.uses));
    fill(listBox, ORDER.map(c => {
      const items = rows.filter(t => t.category === c).sort((a, b) => b.uses - a.uses);
      if (!items.length) return null;
      return h('section', { class: 'mt-group' }, h('h2', { class: 'mt-group-title' }, CATEGORY_LABEL[c], h('span', { class: 'mt-group-n' }, String(items.length))),
        items.map(t => h('button', { type: 'button', class: 'mt-row' + (t.id === current ? ' sel' : ''), 'aria-current': t.id === current ? 'true' : null, onclick: () => open(t.id) },
          h('span', { class: 'mt-row-top' }, h('span', { class: 'mt-row-name' }, t.name), t.shortcut ? h('span', { class: 'mt-sc' }, `/${t.shortcut}`) : null),
          h('span', { class: 'mt-row-body' }, t.body),
          h('span', { class: 'mt-row-uses' }, h('span', { class: 'mt-uses-bar', 'aria-hidden': 'true' }, h('span', { style: { '--w': `${Math.round((t.uses / max) * 100)}%` } })),
            h('span', { class: 't-num' }, `${t.uses} use${t.uses === 1 ? '' : 's'}`)))));
    }), rows.length ? null : h('p', { class: 'small muted pad' }, 'Nothing matches.'));
  }
  const handlers = {
    vars, people,
    onSaved: saved => { all = [...all.filter(t => t.id !== saved.id), saved]; current = saved.id; drawList(); if (!narrow()) drawEditor(); },
    onDeleted: () => { all = all.filter(t => t.id !== current); current = all[0]?.id ?? null; drawList(); drawEditor(); },
  };
  function drawEditor() {
    const t = current === 'new' ? null : all.find(x => x.id === current);
    if (!t && current !== 'new') { fill(edBox, emptyHero({ icon: 'description', title: 'Write your best message once', line: 'Then use it everywhere, filled in for each client.', action: { label: 'New template', onclick: () => open(null) } })); return; }
    fill(edBox, h('div', { class: 'mt-ed-head' }, h('h2', { class: 'mt-ed-title' }, t ? t.name : 'New template')), h('div', { class: 'mt-ed-body' }));
    editor(edBox.lastChild, t, handlers);
  }
  function open(id) {
    current = id ?? 'new';
    drawList();
    if (narrow()) {
      const t = id ? all.find(x => x.id === id) : null;
      slideOver(t ? t.name : 'New template', (body, close) => { editor(body, t, { ...handlers, onSaved: s => { handlers.onSaved(s); close(); }, onDeleted: () => { handlers.onDeleted(); close(); }, close }); }, { wide: true, className: 'mt-slide' });
    } else drawEditor();
  }
  search.addEventListener('input', drawList);
  drawList();
  if (narrow()) { fill(edBox); if (view.query.get('open') === 'new') open(null); } else drawEditor();
});
