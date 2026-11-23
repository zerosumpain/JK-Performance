import { fail } from './http.mjs';

/**
 * Who a request acts on. A client always acts on themselves (a clientId they
 * pass is ignored unless it is their own). A coach must name a client, and
 * only one of their own. A missing or foreign id is a 404, never a 403, so
 * ids cannot be probed.
 */
export function clientFor(ctx, clientId, { coachMayOmit = false } = {}) {
  const { db, user } = ctx;
  if (user.role === 'client') {
    if (clientId && clientId !== user.id) fail(404, 'Not found');
    return user;
  }
  if (!clientId) {
    if (coachMayOmit) return null;
    fail(400, 'clientId is required');
  }
  const client = db.prepare("SELECT * FROM users WHERE id=? AND role='client' AND coach_id=?").get(clientId, user.id);
  if (!client) fail(404, 'Not found');
  return client;
}

/** The coach a client belongs to; for a coach, themselves. */
export const coachIdOf = user => (user.role === 'coach' ? user.id : user.coach_id);

/** May this user see things belonging to `clientId`? */
export function canSee(user, client) {
  if (!client) return false;
  return user.role === 'coach' ? client.coach_id === user.id : client.id === user.id;
}

export function requireCoach(ctx) {
  if (ctx.user.role !== 'coach') fail(403, 'Coaches only');
}

/**
 * Services a paying member gets. Off while testing (GATE_SERVICES unset);
 * when on, a client on the free plan is refused with a code the app knows.
 */
export function requireMember(ctx) {
  if (!ctx.config.gateServices || ctx.user.role === 'coach') return;
  if (ctx.user.plan === 'none') fail(403, 'membership_required');
}

export const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

const TABLE_NAME = /^[a-z_]+$/;

/**
 * A row this coach owns: `SELECT * FROM <table> WHERE id=? AND coach_id=?`,
 * or a 404 (never a 403, so ids cannot be probed). `table` is checked against
 * a whitelist pattern, since it is spliced into the SQL.
 */
export function ownRow(ctx, table, id) {
  if (!TABLE_NAME.test(table)) throw new Error(`ownRow: bad table name ${table}`);
  if (typeof id !== 'string' || !id) fail(404, 'Not found');
  const row = ctx.db.prepare(`SELECT * FROM ${table} WHERE id=? AND coach_id=?`).get(id, ctx.user.id);
  if (!row) fail(404, 'Not found');
  return row;
}

/** Is the caller a demo account (the demo coach or a demo client)? */
export const isDemo = ctx => !!ctx.user?.is_demo;

/**
 * "Now" for a request. Tests may pass `?at=<iso>` to move time, but only when
 * the config allows it (`config.testNow`, set by server/test/helpers.mjs);
 * everywhere else it is the wall clock.
 */
export function requestNow(ctx) {
  const at = ctx.query?.at;
  if (ctx.config?.testNow && typeof at === 'string' && !Number.isNaN(Date.parse(at))) return new Date(at);
  return new Date();
}
