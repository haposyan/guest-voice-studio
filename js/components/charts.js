// ============================================================================
// charts.js — small dependency-free SVG chart helpers (bar / distribution).
// ============================================================================

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

// data: [{label, value, cls}]
export function barChart(data, opts = {}) {
  const w = opts.width || 420, h = opts.height || 180;
  const padL = 34, padB = 26, padT = 10, padR = 10;
  const max = Math.max(1, ...data.map((d) => d.value));
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const bw = innerW / data.length;
  const bars = data.map((d, i) => {
    const bh = max ? (d.value / max) * innerH : 0;
    const x = padL + i * bw + bw * 0.15;
    const y = padT + innerH - bh;
    return `<rect class="bar ${d.cls || ""}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${bh.toFixed(1)}" rx="4"></rect>
      <text x="${(x + bw * 0.35).toFixed(1)}" y="${(padT + innerH + 16)}" text-anchor="middle">${esc(d.label)}</text>
      <text x="${(x + bw * 0.35).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-weight="700">${d.value}</text>`;
  }).join("");
  const gridlines = [0, 0.5, 1].map((f) => {
    const y = padT + innerH * (1 - f);
    return `<line class="gridline" x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}"></line>`;
  }).join("");
  return `<svg class="svg-chart" viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${gridlines}${bars}</svg>`;
}

export function ratingDistributionChart(distribution, bands) {
  const bandOf = (r) => bands.low.includes(r) ? "low" : bands.high.includes(r) ? "high" : "mid";
  const data = [1, 2, 3, 4, 5].map((r) => ({ label: String(r), value: distribution[r] || 0, cls: bandOf(r) }));
  return barChart(data, { width: 320, height: 150 });
}

export function miniSparkline(values, opts = {}) {
  const w = opts.width || 120, h = opts.height || 32;
  if (!values.length) return `<svg width="${w}" height="${h}"></svg>`;
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const step = w / Math.max(1, values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`).join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${points}" fill="none" stroke="var(--gold)" stroke-width="2"/></svg>`;
}

export function donut(parts, opts = {}) {
  // parts: [{value, color, label}]
  const size = opts.size || 120, stroke = opts.stroke || 16;
  const r = (size - stroke) / 2, c = size / 2;
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  let acc = 0;
  const circumference = 2 * Math.PI * r;
  const segs = parts.map((p) => {
    const frac = p.value / total;
    const dash = frac * circumference;
    const seg = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${p.color}" stroke-width="${stroke}"
      stroke-dasharray="${dash.toFixed(1)} ${(circumference - dash).toFixed(1)}"
      stroke-dashoffset="${(-acc).toFixed(1)}" transform="rotate(-90 ${c} ${c})"></circle>`;
    acc += dash;
    return seg;
  }).join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${segs}</svg>`;
}
