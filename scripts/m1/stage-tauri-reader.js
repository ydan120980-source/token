'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = fs.realpathSync(path.resolve(__dirname, '../..'));
const renderer = 'design/desktop-reference';
const artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
if (fs.realpathSync(artifacts) !== artifacts) throw Error('TAURI_STAGE_PATH_INVALID');
const stage = fs.mkdtempSync(path.join(artifacts, '.tauri-reader-ui-'));
const target = path.join(artifacts, 'tauri-reader-ui');
const ui = path.join(stage, renderer, 'ui');

function copy(file) {
  const dest = path.join(stage, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, file), dest);
}

try {
  const git = spawnSync('git', ['ls-files', '-z', '--', renderer], { cwd: root, encoding: 'utf8' });
  if (git.status !== 0) throw Error('TAURI_RENDERER_INVENTORY_FAILED');
  for (const file of git.stdout.split('\0')) {
    const name = file.slice(renderer.length + 1);
    if (/^[^/]+\.(?:js|css)$/.test(name) || /^(assets|fonts|tray)\//.test(name)) copy(file);
  }
  const html = fs.readFileSync(path.join(root, renderer, 'index.html'), 'utf8');
  for (const match of html.matchAll(/src="\.\.\/\.\.\/(src\/(?:m1|quota)\/[\w-]+\.js)"/g)) copy(match[1]);
  fs.writeFileSync(path.join(stage, renderer, 'index.html'),
    html.replace("connect-src 'none'", 'connect-src ipc: http://ipc.localhost')
      .replace('</head>', '  <link rel="stylesheet" href="desktop-window.css">\n</head>'));
  fs.copyFileSync(path.join(root, 'src-tauri/ui/desktop-window.css'), path.join(stage, renderer, 'desktop-window.css'));
  const trayPath = path.join(stage, renderer, 'tray', 'card.html');
  fs.writeFileSync(trayPath, fs.readFileSync(trayPath, 'utf8')
    .replace("connect-src 'none'", 'connect-src ipc: http://ipc.localhost')
    .replace('<script src="card.js"></script>', '<script src="tray-bridge.js"></script>\n  <script src="card.js"></script>'));
  fs.copyFileSync(path.join(root, 'src-tauri/ui/tray-bridge.js'), path.join(stage, renderer, 'tray', 'tray-bridge.js'));
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const build = spawnSync(process.execPath, [vite, 'build', '--config', 'ui/vite.config.ts'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, AGENT_UI_OUT: ui, VITE_QUOTADOCK_TAURI_READER: '1' }
  });
  if (build.status !== 0) throw Error('TAURI_RENDERER_BUILD_FAILED');
  if (fs.existsSync(target) && fs.realpathSync(target) !== target) throw Error('TAURI_STAGE_PATH_INVALID');
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(stage, target);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
