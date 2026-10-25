// Range-capable static server for previewing a video on a phone (iPhone Safari needs 206 responses).
// Usage: node serve_preview.mjs <dir> [port=30177] [prefix=/video]
// Expose on the tailnet: tailscale serve --bg --set-path <prefix> http://localhost:<port>
// (macOS Tailscale cannot serve folders directly). Add ?dl=1 to a file URL to force a download.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.argv[2]), PORT = +process.argv[3] || 30177, PREFIX = process.argv[4] || '/video';
const types = { '.mp4': 'video/mp4', '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const dl = u.searchParams.has('dl');
  let p = decodeURIComponent(u.pathname); if (p.startsWith(PREFIX)) p = p.slice(PREFIX.length);
  if (p === '/' || p === '') p = '/index.html';
  const f = path.join(ROOT, path.normalize(p));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  const size = fs.statSync(f).size, type = types[path.extname(f)] || 'application/octet-stream';
  const disp = dl ? { 'Content-Disposition': `attachment; filename="${path.basename(f)}"` } : {};
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const start = m[1] ? +m[1] : size - +m[2], end = m[1] && m[2] ? +m[2] : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Cache-Control': 'no-store', ...disp });
    return fs.createReadStream(f, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size, 'Cache-Control': 'no-store', ...disp });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log('serving', ROOT, 'on', PORT, 'prefix', PREFIX));
