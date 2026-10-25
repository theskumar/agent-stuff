// vp.mjs: size the Chrome window so the page viewport is exactly W x H. usage: node vp.mjs <url-substring> W H
const [,, target, W, H] = process.argv;
const tabs = await (await fetch('http://localhost:9222/json')).json();
const t = tabs.find(x => x.type === 'page' && x.url.includes(target));
const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result.result.value;
await send('Emulation.clearDeviceMetricsOverride');
const { windowId } = (await send('Browser.getWindowForTarget')).result;
await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Start from a known size, then correct by the measured chrome (tabs, toolbar) once or twice.
await send('Browser.setWindowBounds', { windowId, bounds: { left: 200, top: 60, width: +W, height: +H } }); await sleep(1200);
for (let i = 0; i < 3; i++) {
  const b = (await send('Browser.getWindowBounds', { windowId })).result.bounds;
  const v = await ev('[innerWidth, innerHeight]');
  console.error('pass', i, JSON.stringify(b), v);
  if (v[0] === +W && v[1] === +H) break;
  await send('Browser.setWindowBounds', { windowId, bounds: { width: b.width + (+W - v[0]), height: b.height + (+H - v[1]) } }); await sleep(1200);
}
await send('Page.bringToFront');
console.log(JSON.stringify({ viewport: await ev('[innerWidth, innerHeight]'), screen: await ev('[screen.width, screen.height, devicePixelRatio]'), window: (await send('Browser.getWindowBounds', { windowId })).result.bounds }));
process.exit(0);
