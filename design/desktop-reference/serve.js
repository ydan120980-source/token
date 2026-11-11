'use strict';
// Local UI review. Only an explicitly selected statistics snapshot; no source scan or writes.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { selectSnapshot } = require('../../src/m1/local-snapshot');
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
    // The agent catalogue, pricing labels and cost table live with the statistics library; the page loads them from there.
    const library = { '/src/m1/snapshot-codec.js':'snapshot-codec.js', '/src/quota/connection-state.js': '../quota/connection-state.js', '/src/m1/insights-math.js': 'insights-math.js', '/src/m1/usage-math.js': 'usage-math.js', '/src/m1/agent-catalog.js': 'agent-catalog.js', '/src/m1/pricing-labels.js': 'pricing-labels.js', '/src/m1/cost-table.js': 'cost-table.js', '/src/m1/cost-insights.js': 'cost-insights.js' }[requestPath];
    if (library) { res.writeHead(200, { 'Content-Type': types['.js'], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); return req.method === 'HEAD' ? res.end() : fs.createReadStream(path.resolve(root, '../../src/m1', library)).pipe(res); }
    const relative = requestPath === '/' ? 'index.html' : requestPath.slice(1);
    if (!["index.html","fonts.css","tokens.css","ui/agent-ui.js","ui/agent-ui.css","chart-ui.js","codex-maintenance-model.js","cost-chart.js","cost-model.js","cost-page.js","display-values.js","insights-ui.js","preview.js","pricing-data.js","pricing-editor-model.js","pricing-view.js","profile-model.js","quota-card-dom.js","quota-card-grid.js","quota-host.js","quota-model.js","quota-progress.js","sessions-host.js","sessions-model.js","sources-host.js","sources-model.js","usage-model.js","widget-layout-model.js"].includes(relative) && !relative.startsWith('assets/')) { res.writeHead(404); return res.end(); }
    const resolved = path.resolve(root, relative);
    if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(resolved)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(resolved).pipe(res);
  } catch { res.writeHead(400); res.end(); }
});
server.listen(4178, '127.0.0.1', () => process.stdout.write('Desktop design preview ready: http://127.0.0.1:4178\n'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
