import { createRequire } from 'node:module'; import { readdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const root = process.env.PW_BROWSERS || `${process.env.HOME}/.cache/ms-playwright`;
const d = readdirSync(root).filter(x => x.startsWith('chromium_headless_shell-')).sort().reverse()[0];
const b = await pw.chromium.launch({ executablePath: `${root}/${d}/chrome-headless-shell-linux64/chrome-headless-shell` });
const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
// usage: node render.mjs <abs path to mark.html> <out.png|out.jpg> [png|jpeg]  (needs playwright-core)
const [,, html, out, type] = process.argv;
await p.goto(`file://${html}`); await p.waitForSelector('body[data-ready]'); await p.waitForTimeout(200);
await p.screenshot({ path: out, type: type || 'png', ...(type==='jpeg'?{quality:95}:{}) });
await b.close();
