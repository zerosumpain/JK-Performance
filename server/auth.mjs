import { createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import { startJoinFlows } from './autoflows.mjs';
import { DEFAULT_HABITS, DEFAULT_TARGETS, WELCOME_MESSAGE } from './catalogue.mjs';
import { fail } from './http.mjs';
import { hash, newId, nowIso, secret, tx } from './store.mjs';

const SESSION_DAYS = 180;
const WEB_SESSION_DAYS = 30;
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';

// MARK: - Identity tokens (Sign in with Apple, Sign in with Google)

const PROVIDERS = {
  apple: { name: 'Apple', keysUrl: 'https://appleid.apple.com/auth/keys', issuers: ['https://appleid.apple.com'] },
  google: { name: 'Google', keysUrl: 'https://www.googleapis.com/oauth2/v3/certs', issuers: ['https://accounts.google.com', 'accounts.google.com'] },
};
const keyCache = new Map(); // provider -> { at, keys }

async function signingKeys(provider, fetchImpl, force = false) {
  const cached = keyCache.get(provider.keysUrl);
  if (!force && cached && Date.now() - cached.at < 60 * 60_000 && cached.keys.length) return cached.keys;
  const res = await fetchImpl(provider.keysUrl);
  if (!res.ok) fail(502, `Could not reach ${provider.name} to check the sign-in`);
  const keys = (await res.json()).keys ?? [];
  keyCache.set(provider.keysUrl, { at: Date.now(), keys });
  return keys;
}

const b64json = part => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/**
 * Verify an identity token (a JWT signed RS256 by one of the provider's
 * published keys) and return its claims. Checks signature, issuer, audience
 * (any of `audiences`) and expiry.
 */
async function verifyIdentityToken(provider, token, audiences, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.split('.').length !== 3) fail(401, 'Sign-in token is malformed');
  const [h, p, s] = token.split('.');
  let header, claims;
  try { header = b64json(h); claims = b64json(p); } catch { fail(401, 'Sign-in token is malformed'); }
  if (header.alg !== 'RS256') fail(401, 'Sign-in token uses an unexpected algorithm');
  let jwk = (await signingKeys(provider, fetchImpl)).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await signingKeys(provider, fetchImpl, true)).find(k => k.kid === header.kid);
  if (!jwk) fail(401, 'Sign-in token was signed by an unknown key');
  const ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
  if (!ok) fail(401, 'Sign-in token signature is invalid');
  if (!provider.issuers.includes(claims.iss)) fail(401, 'Sign-in token has the wrong issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const wanted = (Array.isArray(audiences) ? audiences : [audiences]).filter(Boolean);
  if (!aud.some(a => wanted.includes(a))) fail(401, 'Sign-in token is for another app');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now - 60_000) fail(401, 'Sign-in token has expired');
  if (typeof claims.sub !== 'string' || !claims.sub) fail(401, 'Sign-in token has no subject');
  return claims;
}

/** An Apple identity token, from the iPhone app (bundle id) or the web flow Android uses (Services ID). */
export const verifyAppleToken = (token, audiences, opts) => verifyIdentityToken(PROVIDERS.apple, token, audiences, opts);

/** A Google ID token from Android's Credential Manager; its audience is the server's web client id. */
export async function verifyGoogleToken(token, audiences, opts) {
  const claims = await verifyIdentityToken(PROVIDERS.google, token, audiences, opts);
  if (claims.email && claims.email_verified !== true && claims.email_verified !== 'true') delete claims.email;
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
  const insert = db.prepare('INSERT INTO habits (id, client_id, name, kind, target, unit, icon, health_kind, position, created_at, icon_key, introduced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  DEFAULT_HABITS.forEach((h, i) => insert.run(newId('h'), clientId, h.name, h.kind, h.target, h.unit, h.icon, h.healthKind, i, nowIso(), h.iconKey, nowIso()));
  db.prepare('INSERT OR IGNORE INTO nutrition_targets (client_id, kcal, protein, carbs, fat) VALUES (?,?,?,?,?)')
    .run(clientId, DEFAULT_TARGETS.kcal, DEFAULT_TARGETS.protein, DEFAULT_TARGETS.carbs, DEFAULT_TARGETS.fat);
  if (coachId) {
    db.prepare("INSERT INTO messages (id, client_id, from_id, from_role, text, at) VALUES (?,?,?,'coach',?,?)")
      .run(newId('m'), clientId, coachId, WELCOME_MESSAGE, nowIso());
  }
}

const isCoachEmail = (config, email) => !!email && config.coachEmails.includes(email.toLowerCase());

/**
 * Find or create the account for an Apple or Google identity. Coaches come
 * from COACH_EMAILS. A Google sign-in whose verified email matches an existing
 * account joins that account, so a person (or the coach) who signed in with
 * Apple on an iPhone gets the same account on Android. With `createClients:
 * false` (the web) an unknown non-coach identity gets null instead of an account.
 */
export function upsertIdentityUser(db, config, provider, claims, fullName, { createClients = true } = {}) {
  const column = provider === 'google' ? 'google_sub' : 'apple_sub';
  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
  let existing = db.prepare(`SELECT * FROM users WHERE ${column} = ?`).get(claims.sub);
  if (!existing && provider === 'google' && email) {
    existing = db.prepare(`SELECT * FROM users WHERE lower(email)=? AND google_sub IS NULL AND is_demo=0 ORDER BY created_at LIMIT 1`).get(email);
    if (existing) db.prepare('UPDATE users SET google_sub=? WHERE id=?').run(claims.sub, existing.id);
  }
  if (existing) {
    if (email && existing.email !== email && provider === 'apple') db.prepare('UPDATE users SET email=? WHERE id=?').run(email, existing.id);
    if (!existing.email && email) db.prepare('UPDATE users SET email=? WHERE id=?').run(email, existing.id);
    if (existing.role === 'client' && isCoachEmail(config, email)) db.prepare("UPDATE users SET role='coach', coach_id=NULL WHERE id=?").run(existing.id);
    return db.prepare('SELECT * FROM users WHERE id=?').get(existing.id);
  }
  const given = typeof fullName?.givenName === 'string' ? fullName.givenName.trim() : '';
  const family = typeof fullName?.familyName === 'string' ? fullName.familyName.trim() : '';
  const name = (`${given} ${family}`.trim() || (email ? email.split('@')[0] : 'New client')).slice(0, 80);
  const role = isCoachEmail(config, email) ? 'coach' : 'client';
  // The coach web app signs people in but never signs clients up: that happens in the app.
  if (role === 'client' && !createClients) return null;
  const id = newId('u');
  const user = tx(db, () => {
    const coachId = role === 'client' ? primaryCoachId(db, config) : null;
    db.prepare(`INSERT INTO users (id, ${column}, email, name, role, coach_id, created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(id, claims.sub, email, name, role, coachId, nowIso());
    if (role === 'client') setUpClient(db, id, coachId);
    return db.prepare('SELECT * FROM users WHERE id=?').get(id);
  });
  // The coach's onboarding autoflows start the moment a client joins.
  if (role === 'client') startJoinFlows(db, config, user);
  return user;
}

export const upsertAppleUser = (db, config, claims, fullName) => upsertIdentityUser(db, config, 'apple', claims, fullName);

// MARK: - Sessions

/** A session token. `web` sessions (the coach desk in a browser) last 30 days, the app's 180. */
export function issueSession(db, userId, kind = 'app') {
  const token = secret();
  db.prepare('INSERT INTO sessions (hash, user_id, expires_at, created_at, kind) VALUES (?,?,?,?,?)')
    .run(hash(token), userId, Date.now() + sessionDays(kind) * 86_400_000, nowIso(), kind);
  return token;
}

const sessionDays = kind => (kind === 'web' ? WEB_SESSION_DAYS : SESSION_DAYS);

/** The signed-in user for a request, sliding the session's expiry; null when absent or expired. */
export function sessionUser(db, req) {
  const header = req.headers.authorization ?? '';
  const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(header);
  if (!m) return null;
  const row = db.prepare('SELECT s.hash, s.expires_at, s.kind session_kind, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ?').get(hash(m[1]));
  if (!row || row.expires_at < Date.now()) return null;
  const days = sessionDays(row.session_kind);
  if (row.expires_at - Date.now() < (days - 1) * 86_400_000) {
    db.prepare('UPDATE sessions SET expires_at=? WHERE hash=?').run(Date.now() + days * 86_400_000, row.hash);
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
