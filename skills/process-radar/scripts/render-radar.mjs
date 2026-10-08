import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderRadarSvg, escapeXml } from './radar-svg.mjs';

export function chartSeries(input, catalog) {
  if (!input || !Array.isArray(input.profile) || input.profile.length !== 7) throw new Error('Provide all seven profile dimensions. Unknown observations cannot be plotted as zero.');
  const ids = catalog.dimensions.map(d => d.id), seen = new Set(), scores = {};
  for (const p of input.profile) {
    if (!p || !ids.includes(p.id) || seen.has(p.id) || ![0,25,50,75,100].includes(p.score)) throw new Error('Expected seven unique dimension IDs and scores in increments of 25.');
    seen.add(p.id); scores[p.id] = p.score;
  }
  const series = [];
  if (input.recommendedApproach !== undefined) {
    const reference = catalog.approaches.find(a => a.id === input.recommendedApproach);
    if (!reference) throw new Error('Unknown reference approach.');
    series.push({ label:reference.title+' · reference', color:'#315ce8', dashed:true, scores:Object.fromEntries(ids.map(id => [id,reference.ratings[id].score])) });
  }
  series.push({ label:'Suggested process for your task', color:'#16834b', scores });
  return series;
}

export async function main(args) {
  const options = {};
  for (let i=0; i<args.length; i+=2) {
    if (!['--input','--out'].includes(args[i]) || !args[i+1] || options[args[i]]) throw new Error('Usage: node render-radar.mjs --input recommendation.json --out chart.svg (or chart.html)');
    options[args[i]] = args[i+1];
  }
  if (!options['--input'] || !options['--out']) throw new Error('Both --input and --out are required.');
  if (!/\.(svg|html)$/i.test(options['--out'])) throw new Error('Output must end in .svg or .html.');
  const info = await stat(options['--input']);
  if (!info.isFile() || info.size > 1024*1024) throw new Error('Input must be a JSON file smaller than 1 MiB.');
  let input;
  try { input = JSON.parse(await readFile(options['--input'],'utf8')); }
  catch { throw new Error('Could not read a valid recommendation JSON file.'); }
  const catalog = JSON.parse(await readFile(new URL('../references/catalog.json',import.meta.url),'utf8'));
  const title = input.summary ?? 'Suggested process';
  if (typeof title !== 'string' || title.length > 500) throw new Error('Summary must be text under 500 characters.');
  const svg = renderRadarSvg(catalog.dimensions,chartSeries(input,catalog),title);
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeXml(title)}</title><style>body{font:16px system-ui;background:#f5f6f2;color:#283346;max-width:760px;margin:32px auto;padding:16px}h1{font-size:24px}svg{width:100%;height:auto}p{line-height:1.5}</style><h1>${escapeXml(title)}</h1>${svg}<p>Intended-use profile. Bigger is not better. Needs Strong Verifier measures dependence on automatic checks.</p></html>`;
  await writeFile(options['--out'],/\.html$/i.test(options['--out'])?html:svg,{flag:'wx',mode:0o600});
  console.log(path.resolve(options['--out']));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode=1; });
