import { createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import { DEFAULT_HABITS, DEFAULT_TARGETS, WELCOME_MESSAGE } from './catalogue.mjs';
import { fail } from './http.mjs';
import { hash, newId, nowIso, secret, tx } from './store.mjs';

const SESSION_DAYS = 180;
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';

// MARK: - Sign in with Apple

let keyCache = { at: 0, keys: [] };

async function appleKeys(fetchImpl, force = false) {
  if (!force && Date.now() - keyCache.at < 60 * 60_000 && keyCache.keys.length) return keyCache.keys;
  const res = await fetchImpl(APPLE_KEYS_URL);
  if (!res.ok) fail(502, 'Could not reach Apple to check the sign-in');
  keyCache = { at: Date.now(), keys: (await res.json()).keys ?? [] };
  return keyCache.keys;
}

const b64json = part => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/**
 * Verify an Apple identity token (a JWT signed RS256 by one of Apple's keys)
 * and return its claims. Checks signature, issuer, audience and expiry.
 */
export async function verifyAppleToken(token, audience, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.split('.').length !== 3) fail(401, 'Sign-in token is malformed');
  const [h, p, s] = token.split('.');
  let header, claims;
  try { header = b64json(h); claims = b64json(p); } catch { fail(401, 'Sign-in token is malformed'); }
  if (header.alg !== 'RS256') fail(401, 'Sign-in token uses an unexpected algorithm');
  let jwk = (await appleKeys(fetchImpl)).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await appleKeys(fetchImpl, true)).find(k => k.kid === header.kid);
  if (!jwk) fail(401, 'Sign-in token was signed by an unknown key');
  const ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
  if (!ok) fail(401, 'Sign-in token signature is invalid');
  if (claims.iss !== APPLE_ISSUER) fail(401, 'Sign-in token has the wrong issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(audience)) fail(401, 'Sign-in token is for another app');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now - 60_000) fail(401, 'Sign-in token has expired');
  if (typeof claims.sub !== 'string' || !claims.sub) fail(401, 'Sign-in token has no subject');
  return claims;
}

// MARK: - Users

/** The coach new sign-ups belong to: PRIMARY_COACH_EMAIL's account, else the first real coach. */
export function primaryCoachId(db, config) {
  if (config.primaryCoachEmail) {
    const row = db.prepare("SELECT id FROM users WHERE role='coach' AND lower(email)=lower(?)").get(config.primaryCoachEmail);
    if (row) return row.id;
  }
  return db.prepare("SELECT id FROM users WHERE role='coach' AND is_demo=0 ORDER BY created_at LIMIT 1").get()?.id ?? null;
}

/** A new client's starting kit: default habits, nutrition targets, the welcome message. */
export function setUpClient(db, clientId, coachId) {
  const insert = db.prepare('INSERT INTO habits (id, client_id, name, kind, target, unit, icon, health_kind, position, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  DEFAULT_HABITS.forEach((h, i) => insert.run(newId('h'), clientId, h.name, h.kind, h.target, h.unit, h.icon, h.healthKind, i, nowIso()));
  db.prepare('INSERT OR IGNORE INTO nutrition_targets (client_id, kcal, protein, carbs, fat) VALUES (?,?,?,?,?)')
    .run(clientId, DEFAULT_TARGETS.kcal, DEFAULT_TARGETS.protein, DEFAULT_TARGETS.carbs, DEFAULT_TARGETS.fat);
  if (coachId) {
    db.prepare("INSERT INTO messages (id, client_id, from_id, from_role, text, at) VALUES (?,?,?,'coach',?,?)")
      .run(newId('m'), clientId, coachId, WELCOME_MESSAGE, nowIso());
  }
}

const isCoachEmail = (config, email) => !!email && config.coachEmails.includes(email.toLowerCase());

/** Find or create the account for an Apple identity. Coaches come from COACH_EMAILS. */
export function upsertAppleUser(db, config, claims, fullName) {
  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
  const existing = db.prepare('SELECT * FROM users WHERE apple_sub = ?').get(claims.sub);
  if (existing) {
    if (email && existing.email !== email) db.prepare('UPDATE users SET email=? WHERE id=?').run(email, existing.id);
    if (existing.role === 'client' && isCoachEmail(config, email)) db.prepare("UPDATE users SET role='coach', coach_id=NULL WHERE id=?").run(existing.id);
    return db.prepare('SELECT * FROM users WHERE id=?').get(existing.id);
  }
  const given = typeof fullName?.givenName === 'string' ? fullName.givenName.trim() : '';
  const family = typeof fullName?.familyName === 'string' ? fullName.familyName.trim() : '';
  const name = (`${given} ${family}`.trim() || (email ? email.split('@')[0] : 'New client')).slice(0, 80);
  const role = isCoachEmail(config, email) ? 'coach' : 'client';
  const id = newId('u');
  return tx(db, () => {
    const coachId = role === 'client' ? primaryCoachId(db, config) : null;
    db.prepare('INSERT INTO users (id, apple_sub, email, name, role, coach_id, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, claims.sub, email, name, role, coachId, nowIso());
    if (role === 'client') setUpClient(db, id, coachId);
    return db.prepare('SELECT * FROM users WHERE id=?').get(id);
  });
}

// MARK: - Sessions

export function issueSession(db, userId) {
  const token = secret();
  db.prepare('INSERT INTO sessions (hash, user_id, expires_at, created_at) VALUES (?,?,?,?)')
    .run(hash(token), userId, Date.now() + SESSION_DAYS * 86_400_000, nowIso());
  return token;
}

/** The signed-in user for a request, sliding the session's expiry; null when absent or expired. */
export function sessionUser(db, req) {
  const header = req.headers.authorization ?? '';
  const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(header);
  if (!m) return null;
  const row = db.prepare('SELECT s.hash, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ?').get(hash(m[1]));
  if (!row || row.expires_at < Date.now()) return null;
  if (row.expires_at - Date.now() < (SESSION_DAYS - 1) * 86_400_000) {
    db.prepare('UPDATE sessions SET expires_at=? WHERE hash=?').run(Date.now() + SESSION_DAYS * 86_400_000, row.hash);
  }
  return row;
}

export function endSession(db, req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (m) db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(m[1]));
}

/** Constant-time comparison for the demo codes. */
export function codeMatches(given, expected) {
  if (typeof given !== 'string' || !expected) return false;
  const a = Buffer.from(hash(given.trim())), b = Buffer.from(hash(expected));
  return timingSafeEqual(a, b);
}
