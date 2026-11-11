// Geometry ported from the existing renderer. These functions never format business values.
export interface Point { x: number; y: number }
const n = (value: number) => Number(value.toFixed(3));
// cost-chart.js:5–13, monotone cubic Hermite, including its original rounding.
export function curve(points: Point[]) {
  if (!points.length) return "";
  const slope = points.slice(1).map((p, i) => (p.y - points[i].y) / (p.x - points[i].x));
  const tangent = points.map((_p, i) => i === 0 ? slope[0] || 0 : i === points.length - 1 ? slope[i - 1] || 0 : slope[i - 1] * slope[i] <= 0 ? 0 : 2 / (1 / slope[i - 1] + 1 / slope[i]));
  let path = "M" + n(points[0].x) + " " + n(points[0].y);
  for (let i = 1; i < points.length; i++) { const a = points[i - 1], b = points[i], dx = (b.x - a.x) / 3; path += " C" + n(a.x + dx) + " " + n(a.y + dx * tangent[i - 1]) + " " + n(b.x - dx) + " " + n(b.y - dx * tangent[i]) + " " + n(b.x) + " " + n(b.y); }
  return path;
}
// cost-stack.js:10 and cost-bars.js:13.
export function niceStep(raw: number) { if (!(raw > 0) || !Number.isFinite(raw)) return 1; const exp = Math.floor(Math.log10(raw)), base = raw / 10 ** exp; return (base <= 1 ? 1 : base <= 2 ? 2 : base <= 2.5 ? 2.5 : base <= 5 ? 5 : 10) * 10 ** exp; }
export function ticksFor(peak: number, rows = 4) { const step = niceStep(peak / rows); return Array.from({ length: rows + 1 }, (_, index) => step * index); }
// cost-bars.js:12. Keep one command structure for current-path interpolation.
export function barPath(x: number, y: number, w: number, h: number, r: number) { const rr = Math.max(0, Math.min(r, w / 2, h)), f = (v: number) => Number(v.toFixed(2)); return "M" + f(x) + " " + f(y + h) + "V" + f(y + rr) + "Q" + f(x) + " " + f(y) + " " + f(x + rr) + " " + f(y) + "H" + f(x + w - rr) + "Q" + f(x + w) + " " + f(y) + " " + f(x + w) + " " + f(y + rr) + "V" + f(y + h) + "Z"; }
// cost.css:791: daily columns have 4px top and 2px bottom corners. Other
// columns are native rounded rects (rhythm.css pills / cost-hero.js pair).
export function dailyBarPath(x: number, y: number, w: number, h: number) { const a = Math.max(0, Math.min(4, w / 2, h / 2)), b = Math.max(0, Math.min(2, w / 2, h / 2)), f = (v: number) => Number(v.toFixed(2)); return `M${f(x + b)} ${f(y + h)}H${f(x + w - b)}A${b} ${b} 0 0 0 ${f(x + w)} ${f(y + h - b)}V${f(y + a)}A${a} ${a} 0 0 0 ${f(x + w - a)} ${f(y)}H${f(x + a)}A${a} ${a} 0 0 0 ${f(x)} ${f(y + a)}V${f(y + h - b)}A${b} ${b} 0 0 0 ${f(x + b)} ${f(y + h)}Z`; }
// cost-donut.js:9–15. R = 240 / 2 - (16 + 6) / 2 - 1 = 108.
export function arcPath(cx: number, cy: number, a0: number, a1: number, radius = 108) { const end = Math.max(a1, a0 + 0.0004), point = (a: number) => [cx + radius * Math.sin(a), cy - radius * Math.cos(a)], [x0, y0] = point(a0), [x1, y1] = point(end); return "M" + x0.toFixed(2) + " " + y0.toFixed(2) + "A" + radius + " " + radius + " 0 " + (end - a0 > Math.PI ? 1 : 0) + " 1 " + x1.toFixed(2) + " " + y1.toFixed(2); }
export function lowestArc(cy: number, a0: number, a1: number, radius = 108) { const k = Math.ceil((a0 - Math.PI) / (Math.PI * 2)); return Math.PI + k * Math.PI * 2 <= a1 ? cy + radius : cy - radius * Math.min(Math.cos(a0), Math.cos(a1)); }
// quota-hero.js:19. Outer ring first.
export function ringRadii(count: number) { return count <= 0 ? [] : count === 1 ? [56] : count === 2 ? [58, 42] : [60, 47, 34]; }
// chart-ui.js:7–15, plot-local coordinates.
export function positionTooltip(bounds: { width: number; height: number }, panel: { width: number; height: number }, point: Point) { const margin = 8, gap = 14, clamp = (value: number, max: number) => Math.max(margin, Math.min(value, max - margin)), right = point.x + gap; return { x: clamp(right + panel.width <= bounds.width - margin ? right : point.x - panel.width - gap, bounds.width - panel.width), y: clamp(point.y - panel.height / 2, bounds.height - panel.height) }; }
export function runs<T>(items: T[], known: (value: T, index: number) => boolean) { const result: number[][] = []; let run: number[] = []; items.forEach((value, index) => { if (known(value, index)) run.push(index); else if (run.length) { result.push(run); run = []; } }); if (run.length) result.push(run); return result; }
// cost-stack.js: geometry and runs. A missing Agent adds no geometric height;
// only a bucket without any priced observation breaks a stacked area. Inputs
// remain untouched so readouts still distinguish null from an observed zero.
export function costStackGeometry(values: (number | null)[][], missing: boolean[], stacked: boolean, stackMix = stacked ? 1 : 0) {
  const known = missing.map((absent, index) => !absent && values.some(list => Number.isFinite(list[index])));
  const bases: number[][] = [], tops: (number | null)[][] = [];
  let below = missing.map(() => 0);
  for (const list of values) {
    bases.push(below.map(value => value * stackMix));
    tops.push(missing.map((absent, index) => absent || !known[index] ? null : stacked ?
      (Number.isFinite(list[index]) ? list[index]! : 0) + below[index] * stackMix :
      Number.isFinite(list[index]) ? list[index]! + below[index] * stackMix : null));
    below = below.map((base, index) => base + (Number.isFinite(list[index]) ? list[index]! : 0));
  }
  const parts = tops.map(list => runs(list, value => value !== null));
  return { bases, tops, parts };
}
export const clamp = (value: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
