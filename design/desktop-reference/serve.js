'use strict';
// Local UI review. Only an explicitly selected statistics snapshot; no source scan or writes.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { selectSnapshot } = require('./local-snapshot');
const root = __dirname;
const option = process.argv.indexOf('--snapshot-file');
const selectedFile = option >= 0 ? path.resolve(process.argv[option + 1]) : null;
const savedM1 = process.argv.includes('--saved-m1');
if (savedM1 && selectedFile) throw new Error('SELECT_ONE_DATA_SOURCE');
const readSavedSnapshot = savedM1 ? require('../../src/m1/read-snapshot').readSavedSnapshot : null;
let lastValid;
function bootstrap() {
  let snapshot;
  try { snapshot = readSavedSnapshot ? readSavedSnapshot() : selectedFile ? selectSnapshot(JSON.parse(fs.readFileSync(selectedFile, 'utf8'))) : null; lastValid = snapshot; }
  catch (error) { if (!lastValid) throw error; snapshot = { ...lastValid, previewReadError: true }; }
  return 'window.previewUsage=' + JSON.stringify(snapshot).replace(/</g, '\\u003c') + ';';
}
bootstrap(); // Refuse an invalid selected snapshot before listening.
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
const server = http.createServer((req, res) => {
  try {
    if (!['127.0.0.1:4178', 'localhost:4178'].includes(req.headers.host)) { res.writeHead(403); return res.end(); }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const requestPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (requestPath === '/usage-data.js') {
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) { res.writeHead(403); return res.end(); }
      const body = bootstrap();
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' });
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    const relative = requestPath === '/' ? 'index.html' : requestPath.slice(1);
    if (!['index.html', 'style.css', 'nowdex.css', 'refined.css', 'quota-widgets.css', 'activity.css', 'motion.css', 'motion.js', 'detail-ui.css', 'functional-ui.css', 'refinement.css', 'detail-interactions.js', 'select-ui.js', 'window-shell.js', 'window-shell.css', 'display-values.js', 'preview.js', 'usage-math.js', 'chart-ui.js', 'quota-ui.js', 'quota-progress.js', 'agent-picker.js', 'agent-catalog.js', 'quota.css', 'maintenance.css', 'maintenance-ui.js', 'pricing-data.js', 'pricing-view.js', 'pricing-controller.js', 'codex-maintenance.js', 'segmented.js', 'date-range.js', 'polish.css', 'insights.css', 'insights-math.js', 'insights.js'].includes(relative) && !relative.startsWith('assets/')) { res.writeHead(404); return res.end(); }
    const resolved = path.resolve(root, relative);
    if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(resolved)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(resolved).pipe(res);
  } catch { res.writeHead(400); res.end(); }
});
server.listen(4178, '127.0.0.1', () => process.stdout.write('Desktop design preview ready: http://127.0.0.1:4178\n'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
