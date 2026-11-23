/**
 * A seeded pseudo-random generator (mulberry32) for demo builders
 * (docs/design/desk-v2.md 3.10): the same seed gives the same world.
 * `rng(seed)` returns a function giving numbers in [0, 1); `seed` may be a
 * number or a string (hashed).
 */
export function rng(seed = 1) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** A whole number from lo to hi inclusive. */
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  /** One element of a list. */
  next.pick = list => list[Math.floor(next() * list.length)];
  /** true with probability p. */
  next.chance = p => next() < p;
  return next;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
