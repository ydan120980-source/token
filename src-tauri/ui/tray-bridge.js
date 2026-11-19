'use strict';

const trayApi = window.__TAURI__;
const trayInvoke = (command, args) => trayApi.core.invoke(command, args);
Object.defineProperty(window, 'trayBridge', { value: Object.freeze({
  rows: () => trayInvoke('tray_rows'),
  size: height => trayInvoke('tray_size', { height }),
  open: command => trayInvoke('tray_open', { command }),
  onUpdate(callback) {
    const subscribed = trayApi.event.listen('tray:update', () => callback());
    return () => { void subscribed.then(stop => stop(), () => {}); };
  },
}) });
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') void trayInvoke('tray_dismiss');
});
