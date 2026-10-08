const NS = 'http://www.w3.org/2000/svg';

function node(name, attrs = {}, text) {
  const result = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) result.setAttribute(key, value);
  if (text !== undefined) result.textContent = text;
  return result;
}

export function radar(dimensions, series, title = 'Process radar') {
  const svg = node('svg', { xmlns: NS, viewBox: '0 0 680 540', role: 'img', 'aria-label': title });
  svg.append(node('title', {}, title));
  svg.append(node('desc', {}, series.map(s => `${s.label}: ${dimensions.map(d => `${d.label} ${s.scores[d.id]}`).join(', ')}`).join('. ')));
  svg.append(node('rect', { width: 680, height: 540, fill: '#ffffff' }));
  const cx = 340, cy = 260, radius = 177;
  const point = (i, value) => {
    const angle = -Math.PI / 2 + i * 2 * Math.PI / dimensions.length;
    return [cx + Math.cos(angle) * radius * value / 100, cy + Math.sin(angle) * radius * value / 100];
  };
  const polygon = scores => dimensions.map((d, i) => point(i, scores[d.id]).join(',')).join(' ');
  for (const level of [25, 50, 75, 100]) {
    svg.append(node('polygon', { points: polygon(Object.fromEntries(dimensions.map(d => [d.id, level]))), fill: 'none', stroke: '#d7dde4', 'stroke-width': 1 }));
    svg.append(node('text', { x: cx + 5, y: cy - radius * level / 100 - 3, fill: '#758193', 'font-size': 10, 'font-family': 'system-ui, sans-serif' }, level));
  }
  dimensions.forEach((d, i) => {
    const [x, y] = point(i, 100);
    svg.append(node('line', { x1: cx, y1: cy, x2: x, y2: y, stroke: '#e0e5ec' }));
    const [lx, ly] = point(i, 123);
    const anchor = Math.abs(lx - cx) < 10 ? 'middle' : lx > cx ? 'start' : 'end';
    const label = node('text', { x: lx, y: ly - (d.lines.length - 1) * 8, fill: '#283346', 'text-anchor': anchor, 'font-size': 14, 'font-family': 'system-ui, sans-serif' });
    d.lines.forEach((line, j) => label.append(node('tspan', { x: lx, dy: j ? 17 : 0 }, line)));
    svg.append(label);
  });
  for (const s of series) {
    svg.append(node('polygon', { points: polygon(s.scores), fill: s.color, 'fill-opacity': s.dashed ? 0.035 : 0.13, stroke: s.color, 'stroke-width': 2.6, ...(s.dashed ? { 'stroke-dasharray': '6 5' } : {}) }));
    dimensions.forEach((d, i) => {
      const [x, y] = point(i, s.scores[d.id]);
      const dot = node('circle', { cx: x, cy: y, r: 3, fill: s.color });
      dot.append(node('title', {}, `${s.label} · ${d.label}: ${s.scores[d.id]}`));
      svg.append(dot);
    });
  }
  series.forEach((s, i) => {
    const x = 28, y = 495 + i * 23;
    svg.append(node('line', { x1: x, x2: x + 22, y1: y - 4, y2: y - 4, stroke: s.color, 'stroke-width': 3, ...(s.dashed ? { 'stroke-dasharray': '5 3' } : {}) }));
    svg.append(node('text', { x: x + 32, y, fill: '#283346', 'font-size': 13, 'font-family': 'system-ui, sans-serif' }, s.label));
  });
  return svg;
}
