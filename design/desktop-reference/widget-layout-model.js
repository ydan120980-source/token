'use strict';
/**
 * The widget sidebar's saved layouts (owner decision 2026-10-27,
 * docs/m2/UI-PALETTE-QUOTA-SUMMARY-PROPOSAL-20261027.md section 4). Pure data only: the React
 * sidebar stores the result under KEY in this window's local storage. Every operation returns a
 * new state and leaves its input untouched; anything unknown in saved data falls back to defaults.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.widgetLayoutModel = factory();
})(typeof window === 'undefined' ? this : window, function () {
  const KEY = 'agentusage.widgets.v1';
  const SIZES = ['s', 'm', 'l'], COLORS = ['agent', 'mono', 'ink'], BACKGROUNDS = ['plain', 'soft', 'tint', 'inv'];
  const MAX_LAYOUTS = 6, MAX_WIDGETS = 16, NAME_MAX = 12;
  // One entry per widget type: its gallery group and name, and the time ranges its scope offers
  // (the first is the default). A type without periods has no time scope.
  const CATEGORIES = Object.freeze([['quota', '额度'], ['cost', '费用'], ['usage', '用量'], ['sessions', '会话'], ['agents', 'Agent']]);
  const TYPES = Object.freeze({
    'quota.windows': { category: 'quota', name: '额度窗口', periods: [], readout: true },
    'quota.next': { category: 'quota', name: '下一次恢复', periods: [] },
    'quota.upcoming': { category: 'quota', name: '接下来', periods: ['24h', '7d'] },
    'quota.status': { category: 'quota', name: '连接状态', periods: [] },
    'cost.month': { category: 'cost', name: '本月至今', periods: [] },
    'cost.daily': { category: 'cost', name: '每天花费', periods: ['14', '30', '7'] },
    'cost.where': { category: 'cost', name: '花在哪', periods: ['month', '30', '7'] },
    'usage.today': { category: 'usage', name: '今天', periods: [] },
    'usage.heatmap': { category: 'usage', name: '用量日历', periods: [] },
    'usage.week': { category: 'usage', name: '近 7 天', periods: ['tokens', 'cost'] },
    // The snapshot keeps hours, not minutes, so the live widget reads the last 24 hours.
    'usage.live': { category: 'usage', name: '最近 24 小时', periods: [] },
    'sessions.recent': { category: 'sessions', name: '最近会话', periods: [] },
    // Sessions inside each Agent's current quota window (SESSIONS-NEXT-20261101.md items 2 and 3).
    'sessions.window': { category: 'sessions', name: '当前窗口里的会话', periods: [] },
    'agents.graph': { category: 'agents', name: 'Agent 图', periods: [] },
  });
  const DEFAULT_WIDGETS = Object.freeze([['quota.windows', 'm'], ['usage.today', 'm'], ['cost.daily', 'm'], ['usage.week', 'm']]);

  function widget(type, key, size) {
    return { key, type, size: SIZES.includes(size) ? size : 'm', color: 'agent', background: 'plain', agent: 'all', period: TYPES[type].periods[0] || null, readout: false };
  }
  function defaultLayout(id = 'daily', name = '日常') {
    return { id, name, widgets: DEFAULT_WIDGETS.map(([type, size], index) => widget(type, 'w' + (index + 1), size)) };
  }
  function defaults() { return { active: 'daily', layouts: [defaultLayout()] }; }
  const text = value => typeof value === 'string' ? value.trim().slice(0, NAME_MAX) : '';
  const word = value => typeof value === 'string' && /^[a-z0-9-]{1,24}$/.test(value);

  function cleanWidget(saved, used) {
    if (!saved || typeof saved !== 'object' || !Object.hasOwn(TYPES, saved.type) || !word(saved.key) || used.has(saved.key)) return null;
    used.add(saved.key);
    const type = TYPES[saved.type], base = widget(saved.type, saved.key, saved.size);
    return { ...base,
      color: COLORS.includes(saved.color) ? saved.color : base.color,
      background: BACKGROUNDS.includes(saved.background) ? saved.background : base.background,
      agent: typeof saved.agent === 'string' && /^(all|[a-z0-9-]{1,32})$/.test(saved.agent) ? saved.agent : 'all',
      period: type.periods.includes(saved.period) ? saved.period : base.period,
      readout: Boolean(type.readout && saved.readout) };
  }
  /** Saved layouts, or the default when they are missing or invalid. At most one widget shows its readout in the title bar. */
  function parse(raw) {
    try {
      const saved = JSON.parse(raw), ids = new Set(), layouts = [];
      for (const item of Array.isArray(saved?.layouts) ? saved.layouts.slice(0, MAX_LAYOUTS) : []) {
        if (!item || !word(item.id) || ids.has(item.id) || !text(item.name)) continue;
        ids.add(item.id);
        const used = new Set();
        layouts.push({ id: item.id, name: text(item.name), widgets: (Array.isArray(item.widgets) ? item.widgets.slice(0, MAX_WIDGETS) : []).map(entry => cleanWidget(entry, used)).filter(Boolean) });
      }
      if (layouts.length) {
        for (const layout of layouts) { let shown = false; for (const entry of layout.widgets) { if (entry.readout && shown) entry.readout = false; shown ||= entry.readout; } }
        return { active: ids.has(saved.active) ? saved.active : layouts[0].id, layouts };
      }
    } catch { /* Missing or unreadable layouts use the default. */ }
    return defaults();
  }
  function serialize(state) { return JSON.stringify(state); }

  const activeLayout = state => state.layouts.find(layout => layout.id === state.active) || state.layouts[0];
  function withActive(state, change) {
    return { ...state, layouts: state.layouts.map(layout => layout.id === activeLayout(state).id ? { ...layout, widgets: change(layout.widgets) } : layout) };
  }
  function nextKey(widgets) {
    let n = widgets.length + 1;
    while (widgets.some(entry => entry.key === 'w' + n)) n++;
    return 'w' + n;
  }
  /** Adds a widget of a type to the end of the active layout; unchanged when the type is unknown or the layout is full. */
  function add(state, type) {
    if (!Object.hasOwn(TYPES, type) || activeLayout(state).widgets.length >= MAX_WIDGETS) return state;
    return withActive(state, widgets => [...widgets, widget(type, nextKey(widgets), 'm')]);
  }
  function remove(state, key) { return withActive(state, widgets => widgets.filter(entry => entry.key !== key)); }
  /** The active layout in the given order of keys; keys it does not hold are ignored, and any it holds but are not listed keep their place at the end. */
  function reorder(state, keys) {
    return withActive(state, widgets => {
      const byKey = new Map(widgets.map(entry => [entry.key, entry])), listed = keys.filter(key => byKey.has(key));
      return [...new Set(listed)].map(key => byKey.get(key)).concat(widgets.filter(entry => !listed.includes(entry.key)));
    });
  }
  /** Moves one widget by a step (Alt+arrow). */
  function move(state, key, step) {
    const keys = activeLayout(state).widgets.map(entry => entry.key), index = keys.indexOf(key);
    if (index < 0) return state;
    const to = Math.max(0, Math.min(keys.length - 1, index + step));
    keys.splice(index, 1); keys.splice(to, 0, key);
    return reorder(state, keys);
  }
  /** Changes one widget's size, colour, background, scope or readout; invalid values are ignored. Turning a readout on turns any other off. */
  function update(state, key, patch) {
    const current = activeLayout(state).widgets.find(entry => entry.key === key);
    if (!current) return state;
    const type = TYPES[current.type], next = { ...current };
    if (SIZES.includes(patch.size)) next.size = patch.size;
    if (COLORS.includes(patch.color)) next.color = patch.color;
    if (BACKGROUNDS.includes(patch.background)) next.background = patch.background;
    if (typeof patch.agent === 'string' && /^(all|[a-z0-9-]{1,32})$/.test(patch.agent)) next.agent = patch.agent;
    if (type.periods.includes(patch.period)) next.period = patch.period;
    if (typeof patch.readout === 'boolean' && type.readout) next.readout = patch.readout;
    return withActive(state, widgets => widgets.map(entry => entry.key === key ? next : next.readout && patch.readout ? { ...entry, readout: false } : entry));
  }
  /** The widget whose reading the title bar shows, or null. */
  function readout(state) { return activeLayout(state).widgets.find(entry => entry.readout) || null; }

  function layoutId(state) {
    let n = state.layouts.length + 1;
    while (state.layouts.some(layout => layout.id === 'layout-' + n)) n++;
    return 'layout-' + n;
  }
  /** A new layout, a copy of the active one, made active. Unchanged when the name is empty or six layouts exist. */
  function addLayout(state, name) {
    const clean = text(name);
    if (!clean || state.layouts.length >= MAX_LAYOUTS) return state;
    const id = layoutId(state);
    return { active: id, layouts: [...state.layouts, { id, name: clean, widgets: activeLayout(state).widgets.map(entry => ({ ...entry })) }] };
  }
  function renameLayout(state, id, name) {
    const clean = text(name);
    if (!clean) return state;
    return { ...state, layouts: state.layouts.map(layout => layout.id === id ? { ...layout, name: clean } : layout) };
  }
  /** Removes a layout; the last one stays. */
  function removeLayout(state, id) {
    if (state.layouts.length < 2 || !state.layouts.some(layout => layout.id === id)) return state;
    const layouts = state.layouts.filter(layout => layout.id !== id);
    return { active: state.active === id ? layouts[0].id : state.active, layouts };
  }
  function activate(state, id) { return state.layouts.some(layout => layout.id === id) ? { ...state, active: id } : state; }
  /** Puts the default widgets back into the active layout; its name stays. */
  function reset(state) { return withActive(state, () => defaultLayout().widgets); }

  return { KEY, SIZES, COLORS, BACKGROUNDS, CATEGORIES, TYPES, MAX_LAYOUTS, MAX_WIDGETS, NAME_MAX, defaults, parse, serialize, activeLayout, add, remove, reorder, move, update, readout, addLayout, renameLayout, removeLayout, activate, reset };
});
