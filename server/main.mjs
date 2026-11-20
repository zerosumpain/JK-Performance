import { join } from 'node:path';
import { createApp } from './app.mjs';
import { seedCatalogue } from './catalogue.mjs';
import { loadConfig } from './config.mjs';
import { seedDemo } from './demo.mjs';
import { openStore } from './store.mjs';

process.umask(0o077);
const config = loadConfig();
const db = openStore(join(config.dataDir, 'jk.sqlite'));
seedCatalogue(db);
if (config.demoCode || config.demoCoachCode) {
  if (seedDemo(db)) console.log('Seeded the demo accounts');
}
const app = createApp(db, config);
app.listen(config.port, config.host, () => console.log(`JK Performance listening on ${config.host}:${config.port}`));
process.on('SIGTERM', () => app.close(() => { db.close(); process.exit(0); }));
