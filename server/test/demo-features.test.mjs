/**
 * The demo world with every real feature loaded (docs/design/desk-v2.md 3.10):
 * builds on consecutive days, emits nothing, keeps one file per media row, and
 * clears what demo accounts uploaded. WP-Z runs this with all features merged.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { makeWorld, fakeToday } from './helpers.mjs';
import { buildDemo } from '../demo.mjs';
import { FEATURES } from '../registry.mjs';
import { storeMedia } from '../media.mjs';
import { addDays } from '../time.mjs';

let w;
before(async () => { w = await makeWorld(); });
after(() => w.close());

const count = sql => w.db.prepare(sql).get().n;
const mediaFiles = () => (existsSync(join(w.config.dataDir, 'media')) ? readdirSync(join(w.config.dataDir, 'media')).length : 0);

test(`buildDemo twice on consecutive days, with features: ${FEATURES.map(f => f.name).join(', ') || 'none'}`, async () => {
  const { today } = fakeToday();
  await w.settle();
  buildDemo(w.db, today, w.config);
  const events = count('SELECT COUNT(*) n FROM events');
  const sam = w.db.prepare("SELECT * FROM users WHERE apple_sub='demo-client'").get();
  const upload = storeMedia(w.db, w.config, { ownerId: sam.id, clientId: sam.id, bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32)]), mime: 'image/jpeg', purpose: 'mealPhoto' });
  const mediaRows = count('SELECT COUNT(*) n FROM media');
  assert.equal(mediaFiles(), mediaRows);

  buildDemo(w.db, addDays(today, 1), w.config);
  await w.settle();
  assert.equal(count('SELECT COUNT(*) n FROM events'), events, 'a build emits nothing');
  assert.equal(w.db.prepare('SELECT 1 FROM media WHERE id=?').get(upload.id), undefined, 'a demo upload is gone after the next build');
  assert.equal(count('SELECT COUNT(*) n FROM media'), mediaRows - 1);
  assert.equal(mediaFiles(), count('SELECT COUNT(*) n FROM media'), 'one file per media row');
  assert.equal(count("SELECT COUNT(*) n FROM users WHERE is_demo=0 AND role='client' AND apple_sub LIKE 'demo-%'"), 0);
  // Real accounts are untouched by the demo build.
  assert.ok(w.db.prepare('SELECT 1 FROM users WHERE id=?').get(w.client.id));
});
