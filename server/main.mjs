import { join } from 'node:path';
import { createApp } from './app.mjs';
import { startAutoflowClock } from './autoflows.mjs';
import { seedCatalogue } from './catalogue.mjs';
import { loadConfig } from './config.mjs';
import { seedDemo, startDemoClock } from './demo.mjs';
import { openStore } from './store.mjs';
import { startLetterClock } from './reports.mjs';

process.umask(0o077);
const config = loadConfig();
const db = openStore(join(config.dataDir, 'jk.sqlite'));
seedCatalogue(db);
if (config.demoCode || config.demoCoachCode) {
  if (seedDemo(db, undefined, config)) console.log('Built the demo world for today');
}
const app = createApp(db, config);
app.listen(config.port, config.host, () => console.log(`JK Performance listening on ${config.host}:${config.port}`));
const clock = startAutoflowClock(db, config);
const letterClock = startLetterClock(db, config);
const demoClock = config.demoCode || config.demoCoachCode ? startDemoClock(db, undefined, config) : null;
process.on('SIGTERM', () => {
  clearInterval(clock);
  clearInterval(letterClock);
  if (demoClock) clearInterval(demoClock);
  app.close(() => { db.close(); process.exit(0); });
});
