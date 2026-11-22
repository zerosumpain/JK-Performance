import { clientFor } from './access.mjs';
import { checkinOut } from './daily.mjs';
import { instant, num } from './http.mjs';
import { messageOut } from './messages.mjs';
import { deliverDue, reportOut } from './reports.mjs';
import { featuresOf } from './settings.mjs';
import { nowIso } from './store.mjs';
import { addDays, londonDay, mondayOf } from './time.mjs';

/**
 * The JK tab: one timeline of everything between a client and JK, newest
 * first. Item kinds: message (incl. answers to letters, form checks and meal
 * photos), letter, checkin (the stored confirmation of a check-in), form (a
 * form JK sent), planUpdate (JK published workouts). Messages need
 * 'messaging'; letters and check-ins need 'checkin'. A Free client gets an
 * empty list, never a 403. Opening the first page marks the other side's
 * messages read, as GET /api/messages does.
 */
function timeline(_req, ctx) {
  const { db } = ctx;
  const client = clientFor(ctx, ctx.query.clientId);
  const f = featuresOf(db, client);
  // Nothing dated in the future (a workout published ahead of time stays out until then).
  const now = nowIso();
  const before = ctx.query.before && instant(ctx.query.before, 'before') < now ? instant(ctx.query.before, 'before') : now;
  const limit = ctx.query.limit === undefined ? 50 : num(Number(ctx.query.limit), 'limit', { min: 1, max: 200, int: true });
  if (ctx.user.role === 'client') deliverDue(db, ctx.config, { clientId: client.id });
  const items = [];

  if (f.messaging) {
    for (const m of db.prepare("SELECT * FROM messages WHERE client_id=? AND kind<>'letter' AND at<? ORDER BY at DESC LIMIT ?").all(client.id, before, limit)) {
      items.push({ kind: 'message', id: m.id, at: m.at, message: messageOut(m) });
    }
  }
  if (f.checkin) {
    const letters = db.prepare(`SELECT * FROM reports WHERE client_id=? AND published_at IS NOT NULL AND COALESCE(deliver_at, published_at)<=? AND COALESCE(deliver_at, published_at)<?
      ORDER BY COALESCE(deliver_at, published_at) DESC LIMIT ?`).all(client.id, now, before, limit);
    for (const r of letters) items.push({ kind: 'letter', id: r.id, at: r.deliver_at ?? r.published_at, letter: reportOut(db, ctx.user, r, client) });
    for (const c of db.prepare('SELECT * FROM checkins WHERE client_id=? AND submitted_at<? ORDER BY submitted_at DESC LIMIT ?').all(client.id, before, limit)) {
      items.push({ kind: 'checkin', id: c.id, at: c.submitted_at, checkin: checkinOut(c) });
    }
  }
  for (const r of db.prepare('SELECT * FROM form_requests WHERE client_id=? AND sent_at<? ORDER BY sent_at DESC LIMIT ?').all(client.id, before, limit)) {
    items.push({ kind: 'form', id: r.id, at: r.sent_at, form: { id: r.id, name: r.name, questionCount: JSON.parse(r.questions).length, submittedAt: r.submitted_at } });
  }
  if (f.programme) {
    // Workouts the coach published, one item per day of publishing.
    const rows = db.prepare(`SELECT substr(published_at, 1, 10) d, MAX(published_at) at, MIN(date) first, MAX(date) last, COUNT(*) n FROM workouts
      WHERE client_id=? AND published=1 AND published_at IS NOT NULL AND created_by<>? AND published_at<? GROUP BY d ORDER BY at DESC LIMIT ?`).all(client.id, client.id, before, limit);
    const nextMonday = addDays(mondayOf(londonDay()), 7);
    for (const p of rows) {
      items.push({ kind: 'planUpdate', id: `pu_${p.d}`, at: p.at,
        planUpdate: { from: p.first, to: p.last, count: p.n, text: p.first >= nextMonday ? 'JK updated next week' : 'JK updated your plan' } });
    }
  }
  items.sort((a, b) => b.at.localeCompare(a.at));
  const page = items.slice(0, limit);
  if (!ctx.query.before && f.messaging) {
    const otherSide = ctx.user.role === 'coach' ? 'client' : 'coach';
    db.prepare('UPDATE messages SET read_at=? WHERE client_id=? AND from_role=? AND read_at IS NULL').run(now, client.id, otherSide);
  }
  return { items: page, nextBefore: page.length === limit ? page.at(-1).at : null };
}

export function timelineRoutes(r) {
  r.add('GET', '/api/timeline', timeline);
}
