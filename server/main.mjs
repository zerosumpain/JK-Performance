import { join } from 'node:path';
import { createApp } from './app.mjs';
import { sweepAudioTemp } from './audio.mjs';
import { seedCatalogue } from './catalogue.mjs';
import { loadConfig } from './config.mjs';
import { seedDemo } from './demo.mjs';
import { runFeatureSchemas, startClocks } from './features.mjs';
import { openStore } from './store.mjs';
import { closeAllStreams } from './stream.mjs';

process.umask(0o077);
const config = loadConfig();
const db = openStore(join(config.dataDir, 'jk.sqlite'));
seedCatalogue(db);
// Feature tables before the demo build: demo builders write them.
runFeatureSchemas(db);
sweepAudioTemp(config);
if (config.demoCode || config.demoCoachCode) {
  if (seedDemo(db, undefined, config)) console.log('Built the demo world for today');
}
const app = createApp(db, config);
app.listen(config.port, config.host, () => console.log(`JK Performance listening on ${config.host}:${config.port}`));
// Every clock: autoflows, letters, the demo rebuild, the event backstop, day.started, held messages, urgent pushes, pruning, features'.
const stop = startClocks(db, config);
process.on('SIGTERM', () => {
  stop();
  closeAllStreams();
  app.close(() => { db.close(); process.exit(0); });
});
