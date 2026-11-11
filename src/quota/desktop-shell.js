'use strict';
// The app beside the window: its tray icon with a small quota card, staying in the tray when the window closes, starting at
// login, and the first-run guide's flag (docs/m2/DESKTOP-SHELL-20261105.md). The card window exists only while it is open.
const fs = require('node:fs');
const path = require('node:path');

// The tray icon: a ring whose arc is what is left of the tightest window, in the colour the taskbar reads against; a plain
// full ring when nothing is known, never an empty one. BGRA, as nativeImage.createFromBitmap takes it on Windows.
function ringBitmap(fraction, [red, green, blue], size = 32) {
  const pixels = Buffer.alloc(size * size * 4), middle = (size - 1) / 2, outer = size / 2 - 1, inner = outer - size * 0.17, known = Number.isFinite(fraction);
  const part = known ? Math.max(0, Math.min(1, fraction)) : 1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x - middle, dy = y - middle, distance = Math.hypot(dx, dy);
    const edge = Math.max(0, Math.min(1, Math.min(outer - distance + 0.5, distance - inner + 0.5)));
    if (!edge) continue;
    const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1, lit = turn <= part;
    const at = (y * size + x) * 4;
    pixels[at] = blue; pixels[at + 1] = green; pixels[at + 2] = red; pixels[at + 3] = Math.round(edge * (lit ? 255 : 70));
  }
  return pixels;
}
function trayText(rows) {
  if (!rows.length) return 'Agent Usage';
  const top = rows[0];
  // The tooltip has room for about 127 characters on Windows.
  return ('Agent Usage · ' + top.agentName + ' ' + top.window + ' 剩余 ' + top.remaining + '%').slice(0, 120);
}
const CARD_WIDTH = 340, CARD_ROWS = 6;
// An account's own name only where one Agent has several connections to tell apart.
function cardRows(rows) {
  const accounts = new Map(); for (const row of rows) (accounts.get(row.agent) ?? accounts.set(row.agent, new Set()).get(row.agent)).add(row.account);
  return { rows: rows.slice(0, CARD_ROWS).map(({ agent, agentName, alias, window, remaining, resetsAt, fresh }) => ({ agent, agentName, alias: accounts.get(agent).size > 1 ? alias : null, window, remaining, resetsAt, fresh })), more: Math.max(0, rows.length - CARD_ROWS) };
}
// Where the card goes: against the tray icon, inside the screen's work area.
function cardPlace(icon, area, width, height) {
  const x = Math.round(Math.min(area.x + area.width - width - 8, Math.max(area.x + 8, icon.x + icon.width / 2 - width / 2)));
  const above = icon.y - height - 8, y = above >= area.y ? above : icon.y + icon.height + 8;
  return { x, y: Math.round(Math.max(area.y + 8, Math.min(y, area.y + area.height - height - 8))), width, height };
}

class DesktopShell {
  constructor(root, { electron, window, valid, preload, cardFile, iconFile, packaged, hasAccounts, fixture = false, exitPath, watch, enabled = true, quit }) {
    Object.assign(this, { root, electron, window, valid, preload, cardFile, iconFile, packaged, fixture, exitPath, watch, enabled, quit });
    this.file = path.join(root, 'desktop-shell.json'); this.tray = null; this.card = null; this.toldTray = false; this.last = null;
    let saved = null; try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* First run, or a damaged file. */ }
    // Someone already using the app has nothing to be introduced to.
    this.settings = { closeToTray: saved?.closeToTray !== false, guided: saved?.guided === true || !saved && hasAccounts(), toldTray: saved?.toldTray === true };
    if (!saved) this.save();
  }
  save() { try { fs.mkdirSync(this.root, { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.settings)); } catch { /* The defaults come back next time. */ } }
  login() {
    if (!this.packaged) return { available: false, open: false };
    return { available: true, open: this.electron.app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin === true };
  }
  state() { return { tray: Boolean(this.tray), closeToTray: this.settings.closeToTray, guided: this.settings.guided, login: this.login(), watch: this.watch.settings, lows: require('./quota-watch').LOWS, notices: this.electron.Notification.isSupported() }; }
  set(patch) {
    if (typeof patch?.closeToTray === 'boolean') this.settings.closeToTray = patch.closeToTray;
    if (typeof patch?.guided === 'boolean') this.settings.guided = patch.guided;
    this.save();
    // Only the person's own switch registers the app with Windows, and only the installed app can be.
    if (typeof patch?.login === 'boolean' && this.packaged) this.electron.app.setLoginItemSettings({ openAtLogin: patch.login, args: ['--hidden'] });
    if (patch?.watch) this.watch.set(patch.watch);
    return this.state();
  }
  // The window comes back to where the person left it, or to one page when a notice asks for it.
  showWindow(command) {
    const { window } = this;
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
    if (command) window.webContents.send('window:command', command);
  }
  // A system notice; a Windows that does not show it (no Start menu entry yet, as in an unpacked copy) gets the tray's balloon.
  notify(notice) {
    const { Notification } = this.electron, fallback = () => { if (this.tray && !this.tray.isDestroyed()) this.tray.displayBalloon({ title: notice.title, content: notice.body, iconType: 'info' }); };
    if (!Notification.isSupported()) { fallback(); return; }
    const toast = new Notification({ title: notice.title, body: notice.body, icon: this.iconFile, silent: false });
    (this.notices ??= new Set()).add(toast);
    const done = () => this.notices.delete(toast);
    toast.on('click', () => { done(); this.showWindow('show-quota'); });
    toast.on('close', done);
    toast.on('failed', () => { done(); fallback(); });
    toast.show();
  }
  icon(rows) {
    const { nativeImage, nativeTheme } = this.electron, dark = nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ?? nativeTheme.shouldUseDarkColors;
    const color = dark ? [245, 245, 247] : [36, 36, 38], image = nativeImage.createFromBitmap(ringBitmap(rows.length ? rows[0].remaining / 100 : NaN, color), { width: 32, height: 32, scaleFactor: 2 });
    return image;
  }
  update(rows) {
    this.last = rows;
    if (this.tray && !this.tray.isDestroyed()) {
      const text = trayText(rows), mark = text + (rows[0]?.remaining ?? '');
      if (mark !== this.drawn) { this.drawn = mark; this.tray.setToolTip(text); this.tray.setImage(this.icon(rows)); }
    }
    if (this.card && !this.card.isDestroyed()) this.card.webContents.send('tray:update');
  }
  install() {
    const { ipcMain, Tray, Menu, nativeTheme } = this.electron;
    const guard = event => { if (!this.valid(event)) throw new Error('IPC_SENDER_REJECTED'); };
    ipcMain.handle('shell:get', event => { guard(event); return this.state(); });
    ipcMain.handle('shell:set', (event, patch) => { guard(event); return this.set(patch); });
    const fromCard = event => { if (!this.card || event.sender !== this.card.webContents) throw new Error('IPC_SENDER_REJECTED'); };
    ipcMain.handle('tray:rows', event => { fromCard(event); return cardRows(this.last ?? []); });
    ipcMain.handle('tray:size', (event, height) => { fromCard(event); if (Number.isFinite(height)) this.place(Math.min(640, Math.max(120, Math.ceil(height)))); return true; });
    ipcMain.handle('tray:open', (event, command) => { fromCard(event); if (command !== null && !['show-quota', 'show-connect'].includes(command)) throw new Error('IPC_SENDER_REJECTED'); this.closeCard(); this.showWindow(command); return true; });
    this.window.on('close', event => {
      if (this.quitting() || !this.tray || !this.settings.closeToTray) return;
      event.preventDefault(); this.window.hide();
      // Said once: where the window went, and where to quit.
      if (!this.settings.toldTray) { this.settings.toldTray = true; this.save(); this.notify({ title: 'Agent Usage 还在托盘里', body: '额度提醒照常。要退出，右键托盘图标。' }); }
    });
    if (!this.enabled) return;
    this.tray = new Tray(this.icon(this.last ?? []));
    this.tray.setToolTip('Agent Usage');
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 Agent Usage', click: () => this.showWindow(null) },
      { type: 'separator' },
      { label: '退出', click: () => this.quit() },
    ]));
    this.tray.on('click', () => this.toggleCard());
    this.tray.on('double-click', () => { this.closeCard(); this.showWindow(null); });
    nativeTheme.on('updated', () => { this.drawn = null; this.update(this.last ?? []); });
  }
  quitting() { return this.exitPath(); }
  place(height) {
    const { screen } = this.electron, icon = this.tray.getBounds(), area = screen.getDisplayMatching(icon).workArea;
    if (this.card && !this.card.isDestroyed()) this.card.setBounds(cardPlace(icon, area, CARD_WIDTH, height));
  }
  toggleCard() {
    if (this.card && !this.card.isDestroyed()) { this.closeCard(); return; }
    // Windows gives the blur to the click that closes the card first, so that click must not open it again.
    if (Date.now() - (this.cardClosed ?? 0) < 250) return;
    const { BrowserWindow, nativeTheme } = this.electron, dark = nativeTheme.shouldUseDarkColors;
    this.card = new BrowserWindow({ show: false, width: CARD_WIDTH, height: 240, frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: dark ? '#1c1c1e' : '#ffffff', webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    this.card.setMenu(null);
    this.card.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); this.card.webContents.on('will-navigate', event => event.preventDefault());
    this.place(240);
    this.card.on('blur', () => this.closeCard());
    this.card.once('closed', () => { this.card = null; });
    this.card.once('ready-to-show', () => { if (this.card && !this.card.isDestroyed()) { this.card.show(); this.card.focus(); } });
    void this.card.loadFile(this.cardFile, { query: { theme: dark ? 'dark' : 'light' } });
  }
  closeCard() { if (this.card && !this.card.isDestroyed()) { this.cardClosed = Date.now(); this.card.destroy(); this.card = null; } }
  close() { this.closeCard(); if (this.tray && !this.tray.isDestroyed()) this.tray.destroy(); this.tray = null; }
}
module.exports = { DesktopShell, ringBitmap, trayText, cardRows, cardPlace, CARD_ROWS };
