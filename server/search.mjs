import { requireCoach } from './access.mjs';
import { fail, num } from './http.mjs';
import { hooks } from './registry.mjs';

/**
 * GET /api/search?q=&types=&limit=20 (docs/design/desk-v2.md 3.15, F2): the
 * palette's Results. Built-ins (clients by name or email, message text,
 * programs, forms) plus every feature's `search` hook. Every query is scoped
 * to the coach; LIKE wildcards in q are escaped. Results are
 * `{type, id, title, detail, path, icon, score 0-1, at?}`, best first, then newest.
 */

/** `q` as a LIKE pattern that matches it literally anywhere. */
export const likeAny = q => `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`;

/** 1 for an exact match, .85 for a prefix, .7 for a word start, .5 anywhere. */
export function matchScore(text, q) {
  const t = String(text ?? '').toLowerCase(), s = q.toLowerCase();
  if (t === s) return 1;
  if (t.startsWith(s)) return 0.85;
  if (new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) return 0.7;
  return t.includes(s) ? 0.5 : 0;
}

const snippet = (text, q, n = 90) => {
  const t = String(text ?? '');
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  const from = Math.max(0, i - 30);
  const part = t.slice(from, from + n);
  return `${from > 0 ? '…' : ''}${part}${from + n < t.length ? '…' : ''}`;
};

function builtins(db, coach, q, limit, types) {
  const like = likeAny(q);
  const want = t => !types || types.has(t);
  const out = [];
  if (want('client')) {
    for (const c of db.prepare(`SELECT id, name, email, plan, created_at FROM users WHERE role='client' AND coach_id=? AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') LIMIT ?`)
      .all(coach.id, like, like, limit)) {
      out.push({ type: 'client', id: c.id, title: c.name, detail: c.plan === 'none' ? 'No plan' : c.plan[0].toUpperCase() + c.plan.slice(1), path: `/clients/${c.id}`, icon: 'group', score: Math.max(matchScore(c.name, q), matchScore(c.email, q) * 0.9), at: c.created_at });
    }
  }
  if (want('message')) {
    for (const m of db.prepare(`SELECT m.id, m.client_id, m.text, m.at, m.from_role, u.name FROM messages m JOIN users u ON u.id=m.client_id AND u.coach_id=?
      WHERE m.text LIKE ? ESCAPE '\\' ORDER BY m.at DESC LIMIT ?`).all(coach.id, like, limit)) {
      out.push({ type: 'message', id: m.id, title: `${m.from_role === 'client' ? m.name : `You → ${m.name}`}`, detail: snippet(m.text, q), path: `/messages/${m.client_id}`, icon: 'chat_bubble', score: matchScore(m.text, q) * 0.8, at: m.at });
    }
  }
  if (want('program')) {
    for (const p of db.prepare(`SELECT id, name, detail, updated_at FROM programs WHERE coach_id=? AND name LIKE ? ESCAPE '\\' LIMIT ?`).all(coach.id, like, limit)) {
      out.push({ type: 'program', id: p.id, title: p.name, detail: p.detail, path: `/programs/programs/${p.id}`, icon: 'format_list_bulleted', score: matchScore(p.name, q), at: p.updated_at });
    }
  }
  if (want('form')) {
    for (const f of db.prepare(`SELECT id, name, updated_at FROM forms WHERE coach_id=? AND name LIKE ? ESCAPE '\\' LIMIT ?`).all(coach.id, like, limit)) {
      out.push({ type: 'form', id: f.id, title: f.name, detail: 'Form', path: '/programs/forms', icon: 'description', score: matchScore(f.name, q), at: f.updated_at });
    }
  }
  return out;
}

/** The merged, sorted results (used by the route and by tests). */
export function searchAll(db, coach, q, { types = null, limit = 20 } = {}) {
  let results = builtins(db, coach, q, limit, types);
  for (const [f, fn] of hooks('search')) {
    try {
      const extra = (fn(db, coach, q, limit) ?? []).filter(r => r && (!types || types.has(r.type)));
      results = results.concat(extra.map(r => ({ ...r, score: Math.max(0, Math.min(1, Number(r.score) || 0)) })));
    } catch (e) {
      console.error(`search hook of ${f.name} failed`, e);
    }
  }
  results.sort((a, b) => b.score - a.score || String(b.at ?? '').localeCompare(String(a.at ?? '')));
  return results.slice(0, limit);
}

function route(_req, ctx) {
  requireCoach(ctx);
  const q = String(ctx.query.q ?? '').trim();
  if (q.length < 2) fail(400, 'q must be at least 2 characters');
  if (q.length > 100) fail(400, 'q must be at most 100 characters');
  const limit = ctx.query.limit === undefined ? 20 : num(Number(ctx.query.limit), 'limit', { min: 1, max: 50, int: true });
  const types = ctx.query.types ? new Set(String(ctx.query.types).split(',').map(s => s.trim()).filter(Boolean)) : null;
  return { results: searchAll(ctx.db, ctx.user, q, { types, limit }) };
}

export function searchRoutes(r) {
  r.add('GET', '/api/search', route);
}
