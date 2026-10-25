#!/usr/bin/env node
// usage: tab.mjs <url-substring> eval '<js>' | shot <out.png> [fullpage] | nav <url>
const [,, match, cmd, arg, extra] = process.argv;
const tabs = await (await fetch('http://localhost:9222/json')).json();
const t = tabs.find(x => x.type === 'page' && x.url.includes(match));
if (!t) { console.error('no tab matching ' + match); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
if (cmd === 'eval') {
  const m = await send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
  const v = m.result?.result?.value; console.log(typeof v === 'string' ? v : JSON.stringify(v ?? m.result?.exceptionDetails?.exception?.description ?? m, null, 1));
} else if (cmd === 'shot') {
  const W = +(process.env.W||1600), H = +(process.env.H||1000);
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: W < 500 });
  await new Promise(r => setTimeout(r, +(process.env.WAIT||1200)));
  const full = extra === 'fullpage';
  let clip;
  if (full) { const lm = await send('Page.getLayoutMetrics'); const c = lm.result.cssContentSize; clip = { x: 0, y: 0, width: c.width, height: Math.min(c.height, 6000), scale: 1 }; }
  const m = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, ...(clip ? { clip } : {}) });
  (await import('node:fs')).writeFileSync(arg, Buffer.from(m.result.data, 'base64')); console.log(arg);
} else if (cmd === 'nav') {
  await send('Page.navigate', { url: arg }); await new Promise(r => setTimeout(r, 3500)); console.log('ok');
}
ws.close(); process.exit(0);
