import { chromium } from 'playwright-core';
// Usage: node render.mjs [workers=4]  -> seg0..seg<workers-1>.mp4 (1920x1080, 30fps). Delete old seg*.mp4 first if the worker count changed.
import { spawn } from 'child_process';
const FPS = 30, W = Number(process.argv[2] || 4);
const tl = JSON.parse((await import('fs')).readFileSync('timeline.json', 'utf8'));
const N = Math.ceil(tl.total * FPS), per = Math.ceil(N / W);
const t0 = Date.now();
async function worker(k) {
  const from = k * per, to = Math.min(N, from + per);
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', `seg${k}.mp4`], { stdio: ['pipe', 'inherit', 'inherit'] });
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('file://' + process.cwd() + '/index.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  for (let f = from; f < to; f++) {
    await p.evaluate(t => window.seek(t), f / FPS);
    const buf = await p.screenshot({ type: 'jpeg', quality: 93 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (k === 0 && f % 300 === 0) console.log(`w0 ${f - from}/${to - from} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await b.close();
}
await Promise.all([...Array(W).keys()].map(worker));
console.log('frames', N, 'secs', ((Date.now() - t0) / 1000).toFixed(0));
