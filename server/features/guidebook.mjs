import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientFor, ownRow, requireCoach } from '../access.mjs';
import { emit } from '../events.mjs';
import { fail, oneOf, raw, str } from '../http.mjs';
import { mediaFilePath, parseRange } from '../media.mjs';
import { sendMessage } from '../messages.mjs';
import { likeAny, matchScore } from '../search.mjs';
import { newId, nowIso, tx } from '../store.mjs';

/**
 * F14 Guidebook (docs/design/desk-v2.md, WP4): coach-written guides as a JSON
 * list of blocks. No HTML is ever stored or rendered from a guide: text is
 * plain, with only `**bold**` and `_italic_` tokenised by the renderers.
 *
 * This file also holds the pieces the campaigns feature (F13, same package)
 * shares, exported on purpose (the spec: "validateBlocks() is exported from
 * the feature file; WP4 also uses it"): block validation, the server-side
 * HTML renderer for the public plan page, and the plan-link signing key.
 */

export const BLOCK_TYPES = ['h', 'p', 'list', 'callout', 'image', 'video', 'audio', 'link', 'exercise', 'divider'];
const MAX_BLOCKS = 200;
const MAX_BYTES = 60 * 1024;
const GUIDE_MEDIA_PURPOSES = ['guide', 'other'];
const MEDIA_KIND = { image: 'image', video: 'video', audio: 'audio' };

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const text = (v, name, max) => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') fail(400, `${name} must be text`);
  if (v.length > max) fail(400, `${name} must be at most ${max} characters`);
  return v.replace(/\r\n?/g, '\n');
};
const httpsUrl = (v, name) => {
  if (typeof v !== 'string' || v.length > 500) fail(400, `${name} must be an https link`);
  let u;
  try { u = new URL(v.trim()); } catch { fail(400, `${name} must be an https link`); }
  if (u.protocol !== 'https:' || !u.hostname) fail(400, `${name} must be an https link`);
  return u.toString();
};

/**
 * Check and normalise a block list (F14 format). Unknown types, oversize lists
 * and bad fields are a 400 naming the block; unknown keys are dropped. Text is
 * kept exactly as written (HTML-looking text stays text). With `db` and
 * `coachId`, media must be the coach's own guide files (client_id NULL,
 * purpose guide/other, or a demo fixture) of the right kind, and exercises
 * must be in the library.
 */
export function validateBlocks(blocks, { db = null, coachId = null, name = 'blocks' } = {}) {
  if (blocks === undefined || blocks === null) return [];
  if (!Array.isArray(blocks)) fail(400, `${name} must be a list`);
  if (blocks.length > MAX_BLOCKS) fail(400, `${name} can have at most ${MAX_BLOCKS} blocks`);
  const out = blocks.map((b, i) => {
    const at = `${name}[${i}]`;
    if (!isObj(b)) fail(400, `${at} must be an object`);
    if (!BLOCK_TYPES.includes(b.t)) fail(400, `${at}.t is not a known block type`);
    switch (b.t) {
      case 'h': return { t: 'h', text: text(b.text, `${at}.text`, 160) };
      case 'p': return { t: 'p', text: text(b.text, `${at}.text`, 2000) };
      case 'list': {
        if (b.items !== undefined && !Array.isArray(b.items)) fail(400, `${at}.items must be a list`);
        const items = (b.items ?? []).map((x, j) => text(x, `${at}.items[${j}]`, 300));
        if (items.length > 30) fail(400, `${at}.items can have at most 30 entries`);
        return { t: 'list', style: b.style === undefined ? 'bullet' : oneOf(b.style, `${at}.style`, ['bullet', 'number', 'check']), items };
      }
      case 'callout': return { t: 'callout', tone: b.tone === undefined ? 'tip' : oneOf(b.tone, `${at}.tone`, ['tip', 'warn', 'info']), text: text(b.text, `${at}.text`, 600) };
      case 'image': case 'video': case 'audio': {
        if (typeof b.mediaId !== 'string' || !/^md_[A-Za-z0-9_-]{1,40}$/.test(b.mediaId)) fail(400, `${at}.mediaId is required`);
        if (db && coachId) {
          const m = db.prepare('SELECT * FROM media WHERE id=? AND owner_id=? AND client_id IS NULL').get(b.mediaId, coachId);
          if (!m || !(GUIDE_MEDIA_PURPOSES.includes(m.purpose) || String(m.purpose).startsWith('demo:'))) fail(400, `${at}.mediaId is not one of your guide files`);
          if (m.kind !== MEDIA_KIND[b.t]) fail(400, `${at}.mediaId is not ${b.t === 'image' ? 'an image' : `a ${b.t} file`}`);
        }
        return { t: b.t, mediaId: b.mediaId, caption: text(b.caption, `${at}.caption`, 200) };
      }
      case 'link': return { t: 'link', url: httpsUrl(b.url, `${at}.url`), label: text(b.label, `${at}.label`, 120) };
      case 'exercise': {
        if (typeof b.exerciseId !== 'string' || b.exerciseId.length > 80) fail(400, `${at}.exerciseId is required`);
        if (db && !db.prepare('SELECT 1 FROM exercises WHERE id=? AND (created_by IS NULL OR created_by=?)').get(b.exerciseId, coachId)) fail(400, `${at}.exerciseId is not in the library`);
        return { t: 'exercise', exerciseId: b.exerciseId };
      }
      default: return { t: 'divider' };
    }
  });
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_BYTES) fail(413, `${name} must be at most 60 KB`);
  return out;
}

/** The media ids a block list refers to. */
export const blockMediaIds = blocks => new Set((blocks ?? []).filter(b => MEDIA_KIND[b.t] && b.mediaId).map(b => b.mediaId));

/** `**bold**` and `_italic_` runs: [{text, bold, italic}]. The only inline formatting there is. */
export function inlineRuns(s) {
  const out = [];
  const re = /\*\*([^*\n]+?)\*\*|(?<![\p{L}\p{N}])_([^_\n]+?)_(?![\p{L}\p{N}])/gu;
  let last = 0;
  for (const m of String(s ?? '').matchAll(re)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), bold: false, italic: false });
    out.push(m[1] !== undefined ? { text: m[1], bold: true, italic: false } : { text: m[2], bold: false, italic: true });
    last = m.index + m[0].length;
  }
  if (last < String(s ?? '').length) out.push({ text: String(s).slice(last), bold: false, italic: false });
  return out;
}

/** Plain text of a block list (search, reading time, previews). */
export const blocksText = blocks => (blocks ?? []).map(b => [b.text, b.caption, b.label, ...(b.items ?? [])].filter(Boolean).join(' ')).join(' ').replace(/\*\*|(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, '');

// MARK: - Server-side HTML (the public plan page; text only, everything escaped)

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const runsHtml = s => inlineRuns(s).map(r => (r.bold ? `<strong>${esc(r.text)}</strong>` : r.italic ? `<em>${esc(r.text)}</em>` : esc(r.text))).join('').replace(/\n/g, '<br>');

/**
 * Blocks as escaped HTML for the plan page. `mediaUrl(mediaId)` gives the
 * checked URL of a file (or null to leave it out); `exerciseOf(id)` the
 * library row. Links are https only and open with noopener noreferrer.
 */
export function blocksHtml(blocks, { mediaUrl = () => null, exerciseOf = () => null } = {}) {
  const out = [];
  for (const b of blocks ?? []) {
    if (b.t === 'h' && b.text) out.push(`<h3>${runsHtml(b.text)}</h3>`);
    else if (b.t === 'p' && b.text) out.push(`<p>${runsHtml(b.text)}</p>`);
    else if (b.t === 'list' && b.items?.length) {
      const tag = b.style === 'number' ? 'ol' : 'ul';
      out.push(`<${tag} class="l-${esc(b.style)}">${b.items.filter(Boolean).map(x => `<li>${runsHtml(x)}</li>`).join('')}</${tag}>`);
    } else if (b.t === 'callout' && b.text) out.push(`<aside class="callout ${esc(b.tone)}"><b>${{ tip: 'Tip', warn: 'Careful', info: 'Note' }[b.tone] ?? 'Note'}</b> ${runsHtml(b.text)}</aside>`);
    else if (MEDIA_KIND[b.t]) {
      const url = mediaUrl(b.mediaId);
      if (!url) continue;
      const media = b.t === 'image' ? `<img src="${esc(url)}" alt="${esc(b.caption || 'Guide image')}" loading="lazy">`
        : b.t === 'video' ? `<video src="${esc(url)}" controls preload="metadata" playsinline></video>`
          : `<audio src="${esc(url)}" controls preload="none"></audio>`;
      out.push(`<figure>${media}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`);
    } else if (b.t === 'link' && /^https:\/\//.test(b.url)) out.push(`<p class="link"><a href="${esc(b.url)}" rel="noopener noreferrer" target="_blank">${esc(b.label || b.url)} ↗</a></p>`);
    else if (b.t === 'exercise') {
      const ex = exerciseOf(b.exerciseId);
      if (ex) out.push(`<p class="exercise"><b>${esc(ex.name)}</b>${ex.equipment ? ` · ${esc(ex.equipment)}` : ''}${ex.video_url && /^https:\/\//.test(ex.video_url) ? ` · <a href="${esc(ex.video_url)}" rel="noopener noreferrer" target="_blank">Watch ↗</a>` : ''}</p>`);
    } else if (b.t === 'divider') out.push('<hr>');
  }
  return out.join('\n');
}

// MARK: - Plan links (HMAC-signed, expiring; F13 plan page and F14 guide shares)

const keys = new Map(); // dataDir -> Buffer
const PLAN_TTL_DAYS = 45;

/** The 32-byte plan-link key at <DATA_DIR>/secrets/plan-link.key, made on first use (mode 0600). */
export function planKey(config) {
  const dir = join(config.dataDir, 'secrets');
  if (keys.has(dir)) return keys.get(dir);
  const file = join(dir, 'plan-link.key');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { writeFileSync(file, randomBytes(32), { flag: 'wx', mode: 0o600 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const key = readFileSync(file);
  if (key.length < 32) throw new Error('plan-link.key is too short');
  keys.set(dir, key);
  return key;
}

const SUBJECT = /^(ce_[A-Za-z0-9_-]{1,40}|u_[A-Za-z0-9_-]{1,40}~gb_[A-Za-z0-9_-]{1,40})$/;
const sig = (config, subject, expiry) => createHmac('sha256', planKey(config)).update(`plan:${subject}.${expiry}`).digest('base64url');

/** `<subject>.<expiry>.<HMAC-SHA256>`: subject is an enrolment id, or `<clientId>~<guideId>` for a guide share. */
export function signPlan(config, subject, now = new Date(), ttlDays = PLAN_TTL_DAYS) {
  if (!SUBJECT.test(subject)) throw new Error('signPlan: bad subject');
  const expiry = Math.floor(now.getTime() / 1000) + ttlDays * 86_400;
  return `${subject}.${expiry}.${sig(config, subject, expiry)}`;
}

/** {subject, expiry} for a good, unexpired token; null for anything else (tampered, expired, malformed). */
export function verifyPlan(config, token, now = new Date()) {
  if (typeof token !== 'string' || token.length > 300) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [subject, exp, mac] = parts;
  if (!SUBJECT.test(subject) || !/^\d{9,11}$/.test(exp) || !/^[A-Za-z0-9_-]{43}$/.test(mac)) return null;
  const want = Buffer.from(sig(config, subject, Number(exp)));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (Number(exp) * 1000 <= now.getTime()) return null;
  return { subject, expiry: Number(exp) };
}

/** A per-token form field for the plan page's Accept / Decline. */
export const planCsrf = (config, token) => createHmac('sha256', planKey(config)).update(`csrf:${token}`).digest('base64url');

const base = config => String(config.publicUrl || '').replace(/\/+$/, '');
/** The public link to a guide shared with one client. */
export const guideLink = (config, clientId, guideId, now = new Date()) => `${base(config)}/plan/${signPlan(config, `${clientId}~${guideId}`, now)}/guide/${guideId}`;

// MARK: - Media through a guide (no widening of canSeeMedia)

/** Stream a media row's file, with Range support. */
export function streamMedia(req, config, m, { cache = 'private, max-age=3600', extra = {} } = {}) {
  const path = mediaFilePath(config, m);
  let size;
  try { size = statSync(path).size; } catch { fail(404, 'Not found'); }
  const headers = { 'content-type': m.mime, 'accept-ranges': 'bytes', 'cache-control': cache, 'x-content-type-options': 'nosniff', ...extra };
  const range = parseRange(req.headers.range, size);
  if (range === 'bad') return raw(416, { ...headers, 'content-range': `bytes */${size}` }, '');
  if (!range) return raw(200, { ...headers, 'content-length': String(size) }, createReadStream(path));
  const [start, end] = range;
  return raw(206, { ...headers, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}` }, createReadStream(path, { start, end }));
}

/** A media row that sits in this guide's blocks and belongs to the guide's coach, or null. */
export function guideMedia(db, guide, mediaId) {
  if (typeof mediaId !== 'string' || !blockMediaIds(JSON.parse(guide.blocks)).has(mediaId)) return null;
  return db.prepare('SELECT * FROM media WHERE id=? AND owner_id=? AND client_id IS NULL').get(mediaId, guide.coach_id) ?? null;
}

// MARK: - Guides

const parseList = s => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };

/** A published guide of this coach, or null. */
export const publishedGuide = (db, coachId, guideId) => (typeof guideId === 'string'
  ? db.prepare("SELECT * FROM coach_guides WHERE id=? AND coach_id=? AND status='published'").get(guideId, coachId) ?? null : null);

const readMinutes = blocks => Math.max(1, Math.round(blocksText(blocks).split(/\s+/).filter(Boolean).length / 200));

export function guideOut(g, { full = true } = {}) {
  const blocks = parseList(g.blocks);
  return {
    id: g.id, title: g.title, summary: g.summary, tags: parseList(g.tags), status: g.status,
    blockCount: blocks.length, readMinutes: readMinutes(blocks),
    cover: blocks.find(b => b.t === 'image')?.mediaId ?? null,
    createdAt: g.created_at, updatedAt: g.updated_at,
    ...(full ? { blocks } : {}),
  };
}

/** Blocks for a client: media blocks carry the URL that checks them against this guide. */
const clientBlocks = g => parseList(g.blocks).map(b => (MEDIA_KIND[b.t] ? { ...b, url: `/api/guides/coach/${g.id}/media/${b.mediaId}` } : b));

function cleanTags(v) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 8) fail(400, 'tags must be a list of up to 8 words');
  return [...new Set(v.map((t, i) => str(t, `tags[${i}]`, { max: 24 }).toLowerCase()))];
}

function list(_req, ctx) {
  requireCoach(ctx);
  const q = String(ctx.query.q ?? '').trim().toLowerCase();
  let rows = ctx.db.prepare('SELECT * FROM coach_guides WHERE coach_id=? ORDER BY updated_at DESC').all(ctx.user.id);
  if (q) rows = rows.filter(g => `${g.title} ${g.summary} ${g.tags} ${blocksText(parseList(g.blocks))}`.toLowerCase().includes(q));
  const opens = new Map(ctx.db.prepare(`SELECT o.guide_id id, COUNT(*) n FROM coach_guide_opens o JOIN users u ON u.id=o.client_id AND u.coach_id=?
    GROUP BY o.guide_id`).all(ctx.user.id).map(r => [r.id, r.n]));
  return { guides: rows.map(g => ({ ...guideOut(g, { full: false }), opens: opens.get(g.id) ?? 0 })) };
}

function create(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const id = newId('gb');
  const blocks = validateBlocks(b.blocks ?? [{ t: 'h', text: '' }], { db: ctx.db, coachId: ctx.user.id });
  const status = b.status === undefined ? 'draft' : oneOf(b.status, 'status', ['draft', 'published']);
  const now = nowIso();
  tx(ctx.db, () => {
    ctx.db.prepare('INSERT INTO coach_guides (id, coach_id, title, summary, blocks, tags, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, ctx.user.id, str(b.title ?? 'Untitled guide', 'title', { max: 120 }), str(b.summary ?? '', 'summary', { max: 300, min: 0 }),
        JSON.stringify(blocks), JSON.stringify(cleanTags(b.tags) ?? []), status, now, now);
    if (status === 'published') emit(ctx.db, 'guide.published', { coachId: ctx.user.id, summary: `Published ${String(b.title ?? 'a guide').slice(0, 80)}`, guideId: id });
  });
  return { guide: guideOut(ownRow(ctx, 'coach_guides', id)) };
}

const get = (_req, ctx) => { requireCoach(ctx); return { guide: guideOut(ownRow(ctx, 'coach_guides', ctx.params.id)) }; };

function update(_req, ctx) {
  requireCoach(ctx);
  const g = ownRow(ctx, 'coach_guides', ctx.params.id);
  const b = ctx.body;
  const next = {
    title: b.title === undefined ? g.title : str(b.title, 'title', { max: 120 }),
    summary: b.summary === undefined ? g.summary : str(b.summary, 'summary', { max: 300, min: 0 }),
    blocks: b.blocks === undefined ? g.blocks : JSON.stringify(validateBlocks(b.blocks, { db: ctx.db, coachId: ctx.user.id })),
    tags: b.tags === undefined ? g.tags : JSON.stringify(cleanTags(b.tags)),
    status: b.status === undefined ? g.status : oneOf(b.status, 'status', ['draft', 'published']),
  };
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE coach_guides SET title=?, summary=?, blocks=?, tags=?, status=?, updated_at=? WHERE id=? AND coach_id=?')
      .run(next.title, next.summary, next.blocks, next.tags, next.status, nowIso(), g.id, ctx.user.id);
    if (next.status === 'published' && g.status !== 'published') emit(ctx.db, 'guide.published', { coachId: ctx.user.id, summary: `Published ${next.title.slice(0, 80)}`, guideId: g.id });
  });
  return { guide: guideOut(ownRow(ctx, 'coach_guides', g.id)) };
}

function remove(_req, ctx) {
  requireCoach(ctx);
  const g = ownRow(ctx, 'coach_guides', ctx.params.id);
  ctx.db.prepare('DELETE FROM coach_guides WHERE id=? AND coach_id=?').run(g.id, ctx.user.id);
  return { ok: true };
}

/** "JK shared a guide": one coachAction message with the guide's public link. */
function send(_req, ctx) {
  requireCoach(ctx);
  const g = ownRow(ctx, 'coach_guides', ctx.params.id);
  const client = clientFor(ctx, ctx.body.clientId);
  if (g.status !== 'published') fail(409, 'Publish the guide before you send it');
  const link = guideLink(ctx.config, client.id, g.id);
  const coachFirst = String(ctx.user.name ?? 'Your coach').split(' ')[0];
  const text = `${coachFirst} shared a guide: ${g.title}. Read it here: ${link}`;
  const out = tx(ctx.db, () => {
    const r = sendMessage(ctx.db, ctx.config, { coachId: ctx.user.id, clientId: client.id, text, via: 'coachAction' });
    emit(ctx.db, 'guide.sent', { coachId: ctx.user.id, clientId: client.id, summary: `Shared ${g.title.slice(0, 80)}`, guideId: g.id });
    return r;
  });
  return { ok: true, link, messageId: out.message?.id ?? null };
}

/** Remember a client's first read of a guide; emits guide.opened once per client per guide. */
export function markOpened(db, guide, clientId) {
  tx(db, () => {
    const added = db.prepare('INSERT OR IGNORE INTO coach_guide_opens (guide_id, client_id, opened_at) VALUES (?,?,?)').run(guide.id, clientId, nowIso()).changes;
    if (added) emit(db, 'guide.opened', { coachId: guide.coach_id, clientId, summary: `Read ${guide.title.slice(0, 80)}`, guideId: guide.id });
  });
}

/** The guide a client (or its own coach) may read: a published guide of their coach. */
function readable(ctx) {
  const id = ctx.params.id;
  if (ctx.user.role === 'coach') {
    const g = ctx.db.prepare('SELECT * FROM coach_guides WHERE id=? AND coach_id=?').get(id, ctx.user.id);
    if (!g) fail(404, 'Not found');
    return g;
  }
  const g = ctx.user.coach_id ? publishedGuide(ctx.db, ctx.user.coach_id, id) : null;
  if (!g) fail(404, 'Not found');
  return g;
}

function clientGuide(_req, ctx) {
  const g = readable(ctx);
  if (ctx.user.role === 'client') markOpened(ctx.db, g, ctx.user.id);
  return { guide: { id: g.id, title: g.title, summary: g.summary, tags: parseList(g.tags), readMinutes: readMinutes(parseList(g.blocks)), blocks: clientBlocks(g), updatedAt: g.updated_at } };
}

function clientGuideMedia(req, ctx) {
  const g = readable(ctx);
  const m = guideMedia(ctx.db, g, ctx.params.mediaId);
  if (!m) fail(404, 'Not found');
  return streamMedia(req, ctx.config, m);
}

// MARK: - The feature

export const feature = {
  name: 'guidebook',
  namespaces: ['guide'],
  exact: [],
  schema(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS coach_guides (
        id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', blocks TEXT NOT NULL DEFAULT '[]',
        tags TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS coach_guides_coach ON coach_guides(coach_id, updated_at);
      CREATE TABLE IF NOT EXISTS coach_guide_opens (
        guide_id TEXT NOT NULL REFERENCES coach_guides(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        opened_at TEXT NOT NULL, PRIMARY KEY (guide_id, client_id));
      CREATE INDEX IF NOT EXISTS coach_guide_opens_client ON coach_guide_opens(client_id);`);
  },
  routes(r) {
    r.add('GET', '/api/guidebook', list);
    r.add('POST', '/api/guidebook', create);
    r.add('GET', '/api/guidebook/:id', get);
    r.add('PUT', '/api/guidebook/:id', update);
    r.add('DELETE', '/api/guidebook/:id', remove);
    r.add('POST', '/api/guidebook/:id/send', send);
    r.add('GET', '/api/guides/coach/:id', clientGuide);
    r.add('GET', '/api/guides/coach/:id/media/:mediaId', clientGuideMedia);
  },
  emits: {
    'guide.published': { label: 'A guide was published', payload: ['guideId'] },
    'guide.sent': { label: 'A guide was shared with a client', payload: ['guideId'] },
    'guide.opened': { label: 'A client opened a guide (first time)', payload: ['guideId'] },
  },
  search(db, coach, q, limit) {
    const like = likeAny(q);
    return db.prepare("SELECT * FROM coach_guides WHERE coach_id=? AND (title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT ?")
      .all(coach.id, like, like, limit)
      .map(g => ({ type: 'guide', id: g.id, title: g.title, detail: `Guide · ${g.status === 'published' ? 'Published' : 'Draft'}`, path: `/guidebook/${g.id}`, icon: 'menu_book', score: matchScore(g.title, q), at: g.updated_at }));
  },
  exportFor(db, user) {
    const opened = db.prepare('SELECT g.title, o.opened_at openedAt FROM coach_guide_opens o JOIN coach_guides g ON g.id=o.guide_id WHERE o.client_id=? ORDER BY o.opened_at').all(user.id);
    if (user.role !== 'coach') return { opened };
    return { opened, guides: db.prepare('SELECT * FROM coach_guides WHERE coach_id=? ORDER BY created_at').all(user.id).map(g => guideOut(g)) };
  },
  demo: {
    // No demo.tables: older tests build the demo before createApp has run feature schemas, and the foundation's
    // wipe would then hit a missing table. buildDemoGuides creates the tables if needed and clears its own rows.
    // campaigns.mjs (built first, in name order) calls it; this build only runs it when campaigns did not.
    build(db, ctx) { buildDemoGuides(db, ctx); },
  },
};

// MARK: - Demo: six guides the demo campaigns use

export const DEMO_GUIDES = [
  { title: 'Fuel the long run', summary: 'What to eat before, during and after your longest run of the week.', tags: ['running', 'nutrition'], blocks: [
    { t: 'h', text: 'Fuel the long run' },
    { t: 'p', text: 'Anything over **75 minutes** needs a plan. Practise it in training so race day holds no surprises.' },
    { t: 'h', text: 'The night before' },
    { t: 'list', style: 'bullet', items: ['A normal dinner with an extra portion of rice or pasta', 'Water with dinner, then sip until bed', 'Lay out gels, belt and kit'] },
    { t: 'h', text: 'On the run' },
    { t: 'p', text: 'Eat **30–60 g** of carbs per hour after the first hour. That is one gel every _40–45 minutes_.' },
    { t: 'list', style: 'check', items: ['Gel at 45 min', 'Water every 20 min', 'Second gel at 1 h 30'] },
    { t: 'callout', tone: 'tip', text: 'Practise race-day fuel in training. The gut trains like a muscle.' },
    { t: 'callout', tone: 'warn', text: 'Never try a new gel on race day.' },
    { t: 'h', text: 'After' },
    { t: 'p', text: 'Within an hour: protein and carbs. A milkshake and a bagel works.' },
    { t: 'link', url: 'https://www.nhs.uk/live-well/exercise/running-and-aerobic-exercises/', label: 'NHS: running tips' },
  ] },
  { title: 'Taper week', summary: 'Less running, more sleep, and why you will feel sluggish (it is working).', tags: ['running', 'race'], blocks: [
    { t: 'h', text: 'Trust the taper' },
    { t: 'p', text: 'Volume drops by about **40%**. Intensity stays. You will feel restless: that is fitness arriving.' },
    { t: 'list', style: 'number', items: ['Keep two short sessions at race pace', 'Sleep 8 hours, every night', 'No new shoes, no new food'] },
    { t: 'callout', tone: 'info', text: 'Heavy legs in taper week are normal. They clear by race morning.' },
  ] },
  { title: 'Your first week', summary: 'How the campaign works, what to tick, and how to tell me how it went.', tags: ['start'], blocks: [
    { t: 'h', text: 'Welcome in' },
    { t: 'p', text: 'Each day shows what to do. Tick it when it is done; _partly done_ counts if you did the important bit.' },
    { t: 'list', style: 'check', items: ['Read today\'s plan each morning', 'Tick as you go', 'Log what you spend on kit'] },
    { t: 'callout', tone: 'tip', text: 'Miss a day? Do not double up. Carry on with today.' },
    { t: 'divider' },
    { t: 'p', text: 'Questions go to me in Messages, any time.' },
  ] },
  { title: 'Mobility 10', summary: 'Ten minutes, four moves, before every run or lower session.', tags: ['mobility'], blocks: [
    { t: 'h', text: 'Ten minutes, every time' },
    { t: 'list', style: 'number', items: ['Couch stretch, 60 s a side', 'Hip airplanes, 5 a side', 'Calf rocks, 10 a side', 'World\'s greatest stretch, 5 a side'] },
    { t: 'callout', tone: 'tip', text: 'Move slowly. Breathe out into the stretch.' },
  ] },
  { title: 'Sleep basics', summary: 'Five habits that buy you an extra hour of real recovery.', tags: ['recovery'], blocks: [
    { t: 'h', text: 'Sleep is training' },
    { t: 'list', style: 'bullet', items: ['Same wake time, seven days a week', 'Screens off 30 minutes before bed', 'Cool, dark room', 'Caffeine before noon', 'A short walk in daylight each morning'] },
    { t: 'callout', tone: 'info', text: 'Aim for **7–9 hours**. Track it for a week before changing anything.' },
  ] },
  { title: 'Ski-fit warm-up', summary: 'A 12-minute warm-up for the slopes and for every session in the block.', tags: ['ski', 'mobility'], blocks: [
    { t: 'h', text: 'Warm-up for the hill' },
    { t: 'list', style: 'number', items: ['Jumping jacks, 60 s', 'Lateral lunges, 8 a side', 'Squat holds, 3 × 20 s', 'Single-leg balance, 30 s a side'] },
    { t: 'callout', tone: 'warn', text: 'Knees track over toes on every landing.' },
  ] },
];

const builtFor = new WeakSet(); // ctx.clients arrays: one per demo build, shared by every feature's build

/** The demo coach's guides, made once per build (cleared first); returns {title: id}. Writes rows only (no events). */
export function buildDemoGuides(db, { coach, clients, today }) {
  if (builtFor.has(clients)) return Object.fromEntries(db.prepare('SELECT id, title FROM coach_guides WHERE coach_id=?').all(coach.id).map(g => [g.title, g.id]));
  builtFor.add(clients);
  feature.schema(db);
  const ids_ = JSON.stringify([coach.id, ...clients.map(c => c.id)]);
  db.prepare('DELETE FROM coach_guide_opens WHERE client_id IN (SELECT value FROM json_each(?))').run(ids_);
  db.prepare('DELETE FROM coach_guides WHERE coach_id=?').run(coach.id);
  const at = (daysAgo, h = 9) => new Date(Date.parse(`${today}T${String(h).padStart(2, '0')}:00:00Z`) - daysAgo * 86_400_000).toISOString();
  const ids = {};
  DEMO_GUIDES.forEach((g, i) => {
    const id = newId('gb');
    ids[g.title] = id;
    db.prepare("INSERT INTO coach_guides (id, coach_id, title, summary, blocks, tags, status, created_at, updated_at) VALUES (?,?,?,?,?,?,'published',?,?)")
      .run(id, coach.id, g.title, g.summary, JSON.stringify(g.blocks), JSON.stringify(g.tags), at(60 - i * 7), at(20 - i * 3));
  });
  // A few clients have read a few guides, so the gallery shows reads.
  const opens = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 2], [3, 3], [4, 0], [4, 2]];
  for (const [g, c] of opens) {
    const client = clients[c];
    if (client) db.prepare('INSERT OR IGNORE INTO coach_guide_opens (guide_id, client_id, opened_at) VALUES (?,?,?)').run(ids[DEMO_GUIDES[g].title], client.id, at(10 - g, 7));
  }
  return ids;
}

