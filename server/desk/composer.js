/*
 * The one composer (docs/design/desk-v2.md 2.4) for threads, inbox replies,
 * broadcasts and scheduled sends:
 *
 *   const c = composer({ clientId, draftKey, onSend: async ({text, mediaId, kind, meta}) => {…} });
 *   box.append(c.el);
 *
 * Enter sends, Shift+Enter is a new line; drafts stay in this browser per
 * draftKey. Tool buttons come from registerComposerTool, the `/` menu from
 * registerSlash. Before onSend every registerSendGuard runs in order: a guard
 * answers {ok:true}, or {ok:false, panel} to show its panel above the
 * composer. A panel continues only through the coach's own click, calling
 * ctx.proceed(meta) (send) or ctx.dismiss() (keep editing); proceed() is
 * ignored without a user gesture, so no guard can send by itself.
 */
import { clearDraft, errorLine, h, icon, readDraft, registered, writeDraft } from './core.js';
import { popover } from './ui.js';

let seq = 0;

/**
 * composer({clientId, audience = null, placeholder, draftKey, initial = '', onSend, compact = false, label})
 * → {el, setText(t), insert(t), getText(), focus(), attach({mediaId, kind, durationSec, label}), clearAttachment(), busy(on)}
 */
export function composer({ clientId = null, audience = null, placeholder = 'Message', draftKey = null, initial = '', onSend, compact = false, label = 'Message', maxLength = 4000 } = {}) {
  const id = `cmp${++seq}`;
  const saved = draftKey ? readDraft(draftKey) : null;
  const input = h('textarea', {
    id, class: 'cmp-input', rows: '1', maxlength: String(maxLength), placeholder, 'aria-label': label,
    'aria-autocomplete': 'list', 'aria-haspopup': 'listbox', spellcheck: 'true',
  });
  input.value = typeof saved === 'string' ? saved : initial;
  const panelBox = h('div', { class: 'cmp-panels', 'aria-live': 'polite' });
  const attachBox = h('div', { class: 'cmp-attach', hidden: true });
  const errorBox = h('div', { class: 'cmp-error' });
  const toolsBox = h('div', { class: 'cmp-tools', role: 'toolbar', 'aria-label': 'Composer tools' });
  const count = h('span', { class: 'cmp-count', 'aria-hidden': 'true' });
  const sendBtn = h('button', { type: 'button', class: 'cmp-send', 'aria-label': 'Send', title: 'Send (Enter)', onclick: () => send() }, icon('send', 18));
  const el = h('div', { class: 'cmp' + (compact ? ' compact' : '') },
    panelBox, errorBox,
    h('div', { class: 'cmp-box' }, attachBox, input,
      h('div', { class: 'cmp-bar' }, toolsBox, h('span', { class: 'grow' }), count, sendBtn)));

  let attachment = null;
  let isBusy = false;
  let slash = null; // the open `/` menu: {close, move(d), pick()}

  const api = {
    el,
    getText: () => input.value,
    setText(t) { input.value = t ?? ''; changed(); },
    insert(t) {
      const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start;
      input.setRangeText(String(t ?? ''), start, end, 'end');
      changed();
      input.focus();
    },
    focus: () => input.focus({ preventScroll: true }),
    attach(a) { attachment = { kind: 'text', ...a }; drawAttachment(); changed(); },
    clearAttachment() { attachment = null; drawAttachment(); changed(); },
    busy(on) { isBusy = !!on; el.classList.toggle('busy', isBusy); input.readOnly = isBusy; sync(); },
    get clientId() { return clientId; },
    get audience() { return audience; },
  };

  function drawAttachment() {
    attachBox.hidden = !attachment;
    attachBox.replaceChildren(...(attachment ? [h('span', { class: 'cmp-chip' },
      icon(attachment.kind === 'voice' ? 'graphic_eq' : attachment.kind === 'image' || attachment.kind === 'mealPhoto' ? 'image' : 'link', 16),
      attachment.label || 'Attachment',
      attachment.durationSec ? h('span', { class: 'faint t-num' }, ` · ${Math.floor(attachment.durationSec / 60)}:${String(Math.round(attachment.durationSec % 60)).padStart(2, '0')}`) : null,
      h('button', { type: 'button', class: 'cmp-chip-x', 'aria-label': 'Remove attachment', onclick: () => api.clearAttachment() }, icon('close', 14)))] : []));
  }

  const size = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, compact ? 120 : 220)}px`; };
  const sync = () => {
    const empty = !input.value.trim() && !attachment;
    sendBtn.disabled = empty || isBusy;
    const left = maxLength - input.value.length;
    count.textContent = left < 400 ? String(left) : '';
  };
  function changed() {
    size();
    sync();
    if (draftKey) { if (input.value) writeDraft(draftKey, input.value); else clearDraft(draftKey); }
  }

  // MARK: Tools

  function drawTools() {
    const tools = registered.composerTools();
    toolsBox.replaceChildren(...tools.map(t => h('button', {
      type: 'button', class: 'cmp-tool', title: t.label, 'aria-label': t.label, 'data-tool': t.id,
      onclick: e => {
        try { t.run(api, { clientId, audience, anchor: e.currentTarget }); } catch (err) { errorBox.replaceChildren(errorLine(err)); }
      },
    }, icon(t.icon || 'bolt', 18), compact ? null : h('span', { class: 'cmp-tool-label' }, t.label))));
    toolsBox.hidden = !tools.length;
  }

  // MARK: Slash menu: `/` at the start of a word

  const slashToken = () => {
    const at = input.selectionStart ?? 0;
    const m = /(^|\s)\/([\w-]*)$/.exec(input.value.slice(0, at));
    return m ? { start: at - m[2].length - 1, end: at, q: m[2].toLowerCase() } : null;
  };
  function updateSlash() {
    const tok = slashToken();
    const items = tok ? registered.slash().filter(s => !tok.q || s.label.toLowerCase().includes(tok.q) || s.id.toLowerCase().includes(tok.q)).slice(0, 8) : [];
    if (!tok || !items.length) { slash?.close(); slash = null; return; }
    slash?.close();
    let at = 0;
    const listId = `${id}-slash`;
    const pop = popover(input, box => {
      const draw = () => box.replaceChildren(h('div', { id: listId, role: 'listbox', 'aria-label': 'Shortcuts' }, items.map((s, i) => h('div', {
        role: 'option', id: `${listId}-${i}`, class: 'cmp-slash-item' + (i === at ? ' sel' : ''), 'aria-selected': String(i === at),
        onpointerdown: e => { e.preventDefault(); at = i; pick(); },
      }, h('span', { class: 'cmp-slash-label' }, `/${s.id}`), h('span', { class: 'grow' }, s.label), s.detail ? h('span', { class: 'faint small clamp1' }, s.detail) : null))));
      draw();
      slash = {
        close: () => { pop.close(); input.removeAttribute('aria-activedescendant'); },
        move: d => { at = (at + d + items.length) % items.length; draw(); input.setAttribute('aria-activedescendant', `${listId}-${at}`); },
        pick,
      };
      function pick() {
        const tk = slashToken();
        if (tk) input.setRangeText('', tk.start, tk.end, 'end');
        slash?.close(); slash = null;
        changed();
        try { items[at].run(api); } catch (err) { errorBox.replaceChildren(errorLine(err)); }
        input.focus();
      }
    }, { className: 'cmp-slash' });
    input.setAttribute('aria-activedescendant', `${listId}-0`);
  }

  // MARK: Sending, through the guards

  async function runGuards(draft) {
    const meta = {};
    for (const g of registered.sendGuards()) {
      let out;
      const ctx = { clientId, audience, composer: api };
      try { out = await g.check({ ...draft, meta: { ...draft.meta, ...meta } }, ctx); } catch (err) {
        // A broken guard never sends by default: the coach sees why and can try again.
        errorBox.replaceChildren(errorLine(`${g.label || g.id}: ${err.message || err}`));
        return null;
      }
      if (!out || out.ok) { Object.assign(meta, out?.meta); continue; }
      if (!(out.panel instanceof Node)) return null;
      const verdict = await new Promise(resolve => {
        const wrap = h('div', { class: 'cmp-panel', 'data-guard': g.id }, out.panel);
        ctx.proceed = extra => {
          // Only a real click or key press may continue to Send.
          if (navigator.userActivation && !navigator.userActivation.isActive) return;
          wrap.remove(); resolve({ go: true, extra });
        };
        ctx.dismiss = () => { wrap.remove(); resolve({ go: false }); };
        panelBox.append(wrap);
        wrap.querySelector('button')?.focus();
      });
      if (!verdict.go) { input.focus(); return null; }
      Object.assign(meta, verdict.extra);
    }
    return meta;
  }

  async function send() {
    slash?.close(); slash = null;
    const text = input.value.trim();
    if ((!text && !attachment) || isBusy) return;
    errorBox.replaceChildren();
    panelBox.replaceChildren();
    const draft = { text, mediaId: attachment?.mediaId ?? null, kind: attachment?.kind ?? 'text', meta: { ...(attachment?.meta || {}) } };
    api.busy(true);
    try {
      const meta = await runGuards(draft);
      if (!meta) return;
      await onSend({ ...draft, meta: { ...draft.meta, ...meta } });
      input.value = '';
      attachment = null;
      drawAttachment();
      if (draftKey) clearDraft(draftKey);
      changed();
    } catch (err) {
      errorBox.replaceChildren(errorLine(err));
    } finally {
      api.busy(false);
    }
  }

  input.addEventListener('input', () => { changed(); updateSlash(); });
  input.addEventListener('keydown', e => {
    if (slash) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); slash.move(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); slash.pick(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); slash.close(); slash = null; return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (slash && document.activeElement !== input) { slash.close(); slash = null; } }, 120));
  drawTools();
  drawAttachment();
  queueMicrotask(changed);
  return api;
}
