// rec.mjs — record a real browser interaction as an mp4 via CDP screencast.
// usage: node rec.mjs <url-substring|new:URL> <out.mp4> <script.json> [W H]
// script steps: {nav:url} {wait:ms} {type:{sel,text,cps}} {click:sel} {clickText:text} {scroll:{y,ms}} {key:"Enter"} {hover:sel}
import fs from 'node:fs'; import { execFileSync } from 'node:child_process';
const [,, target, out, scriptPath, W = '1600', H = '1000'] = process.argv;
const steps = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
let tabs = await (await fetch('http://localhost:9222/json')).json();
let t = target.startsWith('new:') ? await (await fetch('http://localhost:9222/json/new?' + target.slice(4), { method: 'PUT' })).json()
  : tabs.find(x => x.type === 'page' && x.url.includes(target));
if (!t) { console.error('no tab ' + target); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const pend = new Map(); const frames = [];
const dir = fs.mkdtempSync('/tmp/rec-');
ws.onmessage = e => { const m = JSON.parse(e.data);
  if (m.method === 'Page.screencastFrame') { const f = dir + '/f' + String(frames.length).padStart(6, '0') + '.jpg';
    fs.writeFileSync(f, Buffer.from(m.params.data, 'base64')); frames.push({ f, ts: m.params.metadata.timestamp });
    ws.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId: m.params.sessionId } })); return; }
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));
await send('Page.enable'); await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 1, mobile: +W < 500 });
await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
const CURSOR = `(()=>{ if (document.getElementById('__cur')) return; const c=document.createElement('div'); c.id='__cur';
  c.style.cssText='position:fixed;z-index:2147483647;left:0;top:0;width:22px;height:22px;pointer-events:none;transition:transform .45s cubic-bezier(.2,.8,.2,1);transform:translate(-40px,-40px)';
  c.innerHTML='<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.documentElement.appendChild(c); })()`;
let cur = { x: +W / 2, y: +H / 2 };
async function center(sel, text) { return ev(`(()=>{ let el = ${text ? `[...document.querySelectorAll('button,a,[role=button],span,div,li')].filter(e=>e.innerText&&e.innerText.trim()===${JSON.stringify(text)}).pop()` : `document.querySelector(${JSON.stringify(sel)})`}; if(!el) return null; el.scrollIntoView({block:'nearest'}); const r=el.getBoundingClientRect(); return {x:r.left+Math.min(r.width/2,60), y:r.top+r.height/2}; })()`); }
async function moveTo(p) { await ev(CURSOR); await ev(`document.getElementById('__cur').style.transform='translate(${p.x - 3}px,${p.y - 2}px)'`); cur = p; await sleep(550); }
async function click(p) { await moveTo(p); for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 }); await sleep(250); }
await send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 });
await sleep(300);
for (const s of steps) {
  if (s.nav) { await send('Page.navigate', { url: s.nav }); await sleep(s.ms || 2500); await ev(CURSOR); }
  else if (s.wait) await sleep(s.wait);
  else if (s.click || s.clickText) { const p = await center(s.click, s.clickText); if (!p) { console.error('missing', s); continue; } await click(p); }
  else if (s.hover) { const p = await center(s.hover); if (p) await moveTo(p); }
  else if (s.moveTo) { await moveTo(s.moveTo); }
  else if (s.type) { const p = await center(s.type.sel); if (p) await click(p); if (s.type.clear) await ev(`(()=>{const e=document.querySelector(${JSON.stringify(s.type.sel)}); e.value=''; e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    for (const ch of s.type.text) { await send('Input.insertText', { text: ch }); await sleep(1000 / (s.type.cps || 12)); } }
  else if (s.key) { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: s.key, code: s.key, windowsVirtualKeyCode: s.key === 'Enter' ? 13 : 0 }); await sleep(300); }
  else if (s.scroll) { const n = Math.max(1, Math.round((s.scroll.ms || 1500) / 40)); for (let i = 0; i < n; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cur.x, y: cur.y, deltaX: (s.scroll.x || 0) / n, deltaY: (s.scroll.y || 0) / n, modifiers: s.scroll.mods || 0 }); await sleep(40); } }
  else if (s.scrollToText) { // smooth-scroll the window so the element whose text starts with s.scrollToText.text sits near the top
    const dy = await ev(`(()=>{ const el=[...document.querySelectorAll('h1,h2,h3,h4,summary,div,span')].find(e=>e.children.length<3 && e.innerText && e.innerText.trim().startsWith(${JSON.stringify(s.scrollToText.text)})); return el ? el.getBoundingClientRect().top - (${s.scrollToText.offset || 90}) : 0 })()`);
    const n = Math.max(1, Math.round((s.scrollToText.ms || 2000) / 40)); for (let i = 0; i < n; i++) { const e = 0.5 - Math.cos(Math.PI * (i + 1) / n) / 2, p = 0.5 - Math.cos(Math.PI * i / n) / 2; await ev(`scrollBy(0, ${(e - p) * dy})`); await sleep(40); } }
  else if (s.clickIf) { const p = await center(null, s.clickIf); if (p) await click(p); }
}
await sleep(400); await send('Page.stopScreencast'); await send('Emulation.clearDeviceMetricsOverride'); ws.close();
// constant-fps encode from timestamped frames
const lines = []; for (let i = 0; i < frames.length; i++) { const d = i + 1 < frames.length ? frames[i + 1].ts - frames[i].ts : 0.5; lines.push(`file '${frames[i].f}'`, `duration ${Math.max(d, 0.001).toFixed(4)}`); }
lines.push(`file '${frames.at(-1).f}'`); fs.writeFileSync(dir + '/list.txt', lines.join('\n'));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', dir + '/list.txt', '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-crf', '18', out]);
console.log(out, frames.length + ' frames', (frames.at(-1).ts - frames[0].ts).toFixed(1) + 's');
process.exit(0);
