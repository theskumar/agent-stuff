// Usage: node shot.mjs <t1> <t2> ...   -> shots/<t>.jpg stills at those seconds; prints missing cue warnings + font check.
import { chromium } from 'playwright-core';
import fs from 'fs';
fs.mkdirSync('shots', { recursive: true });
const times = process.argv.slice(2).map(Number);
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on('pageerror', e => console.log('PAGEERR', e.message));
await p.goto('file://' + process.cwd() + '/index.html', { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
console.log('warn', JSON.stringify(await p.evaluate(() => window.WARN)));
for (const t of times) { await p.evaluate(t => window.seek(t), t); await p.screenshot({ path: `shots/${String(t).padStart(6, '0')}.jpg`, type: 'jpeg', quality: 80 }); }
await b.close();
