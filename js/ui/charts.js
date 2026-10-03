// Lightweight, dependency-free SVG charts with drill-down (data-key click targets).
import { esc, inr } from '../core/utils.js';
export const PALETTE = ['#4F46E5', '#06B6D4', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#84CC16', '#64748B', '#0EA5E9'];
const short = v => { const a = Math.abs(v); return a >= 1e7 ? (v / 1e7).toFixed(1) + 'Cr' : a >= 1e5 ? (v / 1e5).toFixed(1) + 'L' : a >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : Math.round(v); };

export function donut(data, { size = 200, drill = '' } = {}) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!total) return empty();
  const r = size / 2 - 14, c = size / 2, C = 2 * Math.PI * r; let off = 0;
  const arcs = data.slice(0, 10).map((d, i) => {
    const len = d.value / total * C;
    const s = `<circle r="${r}" cx="${c}" cy="${c}" fill="none" stroke="${PALETTE[i % 12]}" stroke-width="24" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" data-drill="${esc(drill)}" data-key="${esc(d.key)}" class="seg"><title>${esc(d.key)}: ${inr(d.value)}</title></circle>`;
    off += len; return s;
  }).join('');
  const legend = data.slice(0, 10).map((d, i) => `<li data-drill="${esc(drill)}" data-key="${esc(d.key)}"><i style="background:${PALETTE[i % 12]}"></i><span>${esc(d.key)}</span><b>${inr(d.value)}</b><em>${(d.value / total * 100).toFixed(1)}%</em></li>`).join('');
  return `<div class="donut"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Donut chart"><g transform="rotate(-90 ${c} ${c})">${arcs}</g><text x="50%" y="47%" text-anchor="middle" class="dn-l">Total</text><text x="50%" y="58%" text-anchor="middle" class="dn-v">${inr(total)}</text></svg><ul class="legend">${legend}</ul></div>`;
}

export function bars(data, { height = 220, horizontal = false, drill = '', color } = {}) {
  if (!data.length || !data.some(d => d.value)) return empty();
  const max = Math.max(...data.map(d => d.value));
  if (horizontal) return `<div class="hbars">${data.map((d, i) => `<div class="hb" data-drill="${esc(drill)}" data-key="${esc(d.key)}"><span class="hb-l">${esc(d.key)}</span><span class="hb-t"><span style="width:${d.value / max * 100}%;background:${color || PALETTE[i % 12]}"></span></span><b>${inr(d.value)}</b></div>`).join('')}</div>`;
  const w = Math.max(320, data.length * 46), bw = Math.min(34, (w - 40) / data.length - 10), H = height - 30;
  const g = data.map((d, i) => { const h = d.value / max * (H - 20); const x = 40 + i * ((w - 40) / data.length) + 5;
    return `<g data-drill="${esc(drill)}" data-key="${esc(d.key)}" class="seg"><rect x="${x}" y="${H - h}" width="${bw}" height="${h}" rx="5" fill="${d.color || color || PALETTE[0]}"><title>${esc(d.label || d.key)}: ${inr(d.value)}</title></rect><text x="${x + bw / 2}" y="${H + 16}" text-anchor="middle" class="ax">${esc(d.label || d.key)}</text></g>`; }).join('');
  const grid = [0, .5, 1].map(f => `<line x1="36" x2="${w}" y1="${H - f * (H - 20)}" y2="${H - f * (H - 20)}" class="grid"/><text x="32" y="${H - f * (H - 20) + 4}" text-anchor="end" class="ax">${short(max * f)}</text>`).join('');
  return `<div class="scroll-x"><svg viewBox="0 0 ${w} ${height}" width="100%" height="${height}" preserveAspectRatio="none" style="min-width:${Math.min(w, 600)}px">${grid}${g}</svg></div>`;
}

export function lines(series, labels, { height = 240 } = {}) {
  const all = series.flatMap(s => s.values); if (!all.length || !all.some(Boolean)) return empty();
  const max = Math.max(...all, 1), min = Math.min(0, ...all), w = 640, H = height - 34, L = 46;
  const x = i => L + (labels.length === 1 ? (w - L) / 2 : i * (w - L - 10) / (labels.length - 1));
  const y = v => 10 + (H - 10) * (1 - (v - min) / (max - min || 1));
  const grid = [0, .25, .5, .75, 1].map(f => { const v = min + (max - min) * f; return `<line x1="${L}" x2="${w}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${short(v)}</text>`; }).join('');
  const paths = series.map(s => `<path d="${s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"/>` + s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${s.color}"><title>${esc(s.name)} ${esc(labels[i])}: ${inr(v)}</title></circle>`).join('')).join('');
  const xl = labels.map((l, i) => (labels.length <= 12 || i % 2 === 0) ? `<text x="${x(i)}" y="${H + 20}" text-anchor="middle" class="ax">${esc(l)}</text>` : '').join('');
  const lg = `<div class="lgd">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  return `${lg}<svg viewBox="0 0 ${w} ${height}" width="100%" height="${height}" preserveAspectRatio="none">${grid}${paths}${xl}</svg>`;
}

/** Calendar heatmap of daily spend for one month. */
export function heatmap(dayMap, monthStr) {
  const [y, m] = monthStr.split('-').map(Number); const first = new Date(Date.UTC(y, m - 1, 1)); const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const vals = [...Array(days)].map((_, i) => dayMap.get(`${monthStr}-${String(i + 1).padStart(2, '0')}`) || 0); const max = Math.max(...vals, 1);
  const lead = (first.getUTCDay() + 6) % 7;
  const cells = [...Array(lead)].map(() => '<div class="hm e"></div>').concat(vals.map((v, i) => `<div class="hm" style="--a:${v ? 0.15 + 0.85 * v / max : 0}" title="${monthStr}-${i + 1}: ${inr(v)}"><span>${i + 1}</span></div>`)).join('');
  return `<div class="hmw">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<div class="hmh">${d}</div>`).join('')}${cells}</div>`;
}
const empty = () => '<div class="empty-chart">No data for this selection</div>';
