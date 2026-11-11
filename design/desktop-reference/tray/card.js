'use strict';
/* global document, location, ResizeObserver */
// The tray's small card: the tightest quota windows, tightest first. Plain DOM and tokens.css, so opening it costs a small
// window rather than the app's interface; it is destroyed when it closes.
(function () {
  const bridge = window.trayBridge, list = document.getElementById('rows'), empty = document.getElementById('empty'), connect = document.getElementById('connect'), more = document.getElementById('more'), open = document.getElementById('open');
  document.body.classList.toggle('dark', new URLSearchParams(location.search).get('theme') === 'dark');
  function until(at) {
    const ms = Date.parse(at) - Date.now();
    if (!Number.isFinite(ms)) return '';
    if (ms <= 0) return '应该已重置';
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return Math.max(1, minutes) + ' 分钟后重置';
    const hours = Math.round(minutes / 60);
    return hours < 24 ? hours + ' 小时后重置' : Math.round(hours / 24) + ' 天后重置';
  }
  function row(item) {
    const line = document.createElement('li');
    line.dataset.trayRow = item.agent; line.classList.toggle('is-old', !item.fresh);
    const mark = document.createElement('img'); mark.src = '../assets/agents/' + item.agent + '.svg'; mark.alt = ''; mark.className = 'mark'; mark.dataset.agent = item.agent;
    const body = document.createElement('div'); body.className = 'body';
    const head = document.createElement('div'); head.className = 'head';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = item.agentName + ' · ' + item.window;
    const figure = document.createElement('span'); figure.className = 'figure'; figure.textContent = item.remaining + '%';
    head.append(name, figure);
    const bar = document.createElement('div'); bar.className = 'bar'; const fill = document.createElement('i'); fill.style.width = item.remaining + '%'; fill.style.background = 'var(--agent-' + item.agent + ', var(--blue))'; bar.append(fill);
    const note = document.createElement('div'); note.className = 'note'; note.textContent = [item.alias ?? '', item.resetsAt ? until(item.resetsAt) : '', item.fresh ? '' : '读数较旧'].filter(Boolean).join(' · ');
    body.append(head, bar); if (note.textContent) body.append(note);
    line.append(mark, body);
    return line;
  }
  async function draw() {
    const { rows, more: left } = await bridge.rows();
    list.replaceChildren(...rows.map(row));
    empty.hidden = connect.hidden = rows.length > 0;
    more.hidden = !left; more.textContent = left ? '还有 ' + left + ' 项' : '';
  }
  // The window follows the card, including when its fonts arrive after the first measure.
  new ResizeObserver(() => { void bridge.size(document.getElementById('card').offsetHeight); }).observe(document.getElementById('card'));
  open.addEventListener('click', () => { void bridge.open('show-quota'); });
  connect.addEventListener('click', () => { void bridge.open('show-connect'); });
  list.addEventListener('click', () => { void bridge.open('show-quota'); });
  window.addEventListener('keydown', event => { if (event.key === 'Escape') window.close(); });
  bridge.onUpdate(() => { void draw(); });
  void draw();
})();
