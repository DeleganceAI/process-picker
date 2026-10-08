export const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const tag = (name, attrs, content = '') => `<${name} ${Object.entries(attrs).map(([k,v]) => `${k}="${escapeXml(v)}"`).join(' ')}>${content}</${name}>`;
const text = (attrs, content) => tag('text', { ...attrs, 'font-family': 'system-ui, sans-serif' }, escapeXml(content));

export function renderRadarSvg(dimensions, series, title = 'Process radar') {
  if (dimensions.length !== 7 || series.length < 1 || series.length > 2) throw new Error('Expected seven dimensions and one or two profiles.');
  for (const s of series) {
    if (!/^#[0-9a-f]{6}$/i.test(s.color)) throw new Error('Expected a hex color.');
    for (const d of dimensions) if (![0,25,50,75,100].includes(s.scores[d.id])) throw new Error(`Invalid score for ${d.id}.`);
  }
  const cx = 340, cy = 260, radius = 177;
  const point = (i, value) => {
    const angle = -Math.PI / 2 + i * 2 * Math.PI / dimensions.length;
    return [cx + Math.cos(angle) * radius * value / 100, cy + Math.sin(angle) * radius * value / 100];
  };
  const polygon = scores => dimensions.map((d, i) => point(i, scores[d.id]).join(',')).join(' ');
  const out = [tag('title', {}, escapeXml(title)), tag('desc', {}, escapeXml(series.map(s => `${s.label}: ${dimensions.map(d => `${d.label} ${s.scores[d.id]}`).join(', ')}`).join('. '))), tag('rect', { width:680, height:540, fill:'#ffffff' })];
  for (const level of [25,50,75,100]) {
    out.push(tag('polygon', { points:polygon(Object.fromEntries(dimensions.map(d => [d.id,level]))), fill:'none', stroke:'#d7dde4', 'stroke-width':1 }));
    out.push(text({ x:cx+5, y:cy-radius*level/100-3, fill:'#758193', 'font-size':10 }, level));
  }
  dimensions.forEach((d, i) => {
    const [x,y] = point(i,100), [lx,ly] = point(i,123);
    out.push(tag('line', { x1:cx, y1:cy, x2:x, y2:y, stroke:'#e0e5ec' }));
    out.push(tag('text', { x:lx, y:ly-(d.lines.length-1)*8, fill:'#283346', 'text-anchor':Math.abs(lx-cx)<10?'middle':lx>cx?'start':'end', 'font-size':14, 'font-family':'system-ui, sans-serif' }, d.lines.map((line,j) => tag('tspan', { x:lx, dy:j?17:0 }, escapeXml(line))).join('')));
  });
  for (const s of series) {
    out.push(tag('polygon', { points:polygon(s.scores), fill:s.color, 'fill-opacity':s.dashed?0.035:0.13, stroke:s.color, 'stroke-width':2.6, ...(s.dashed?{'stroke-dasharray':'6 5'}:{}) }));
    dimensions.forEach((d,i) => {
      const [x,y] = point(i,s.scores[d.id]);
      out.push(tag('circle', { cx:x, cy:y, r:3, fill:s.color }, tag('title', {}, escapeXml(`${s.label} · ${d.label}: ${s.scores[d.id]}`))));
    });
  }
  series.forEach((s,i) => {
    const y = 495+i*23;
    out.push(tag('line', { x1:28, x2:50, y1:y-4, y2:y-4, stroke:s.color, 'stroke-width':3, ...(s.dashed?{'stroke-dasharray':'5 3'}:{}) }));
    out.push(text({ x:60, y, fill:'#283346', 'font-size':13 }, s.label));
  });
  return tag('svg', { xmlns:'http://www.w3.org/2000/svg', viewBox:'0 0 680 540', role:'img', 'aria-label':title }, out.join(''));
}
