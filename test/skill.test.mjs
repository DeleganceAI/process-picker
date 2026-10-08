import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { catalog } from '../server.mjs';
import { sampleResult } from './fixtures.mjs';
import { chartSeries, main } from '../skills/process-radar/scripts/render-radar.mjs';
import { renderRadarSvg } from '../skills/process-radar/scripts/radar-svg.mjs';

test('portable skill carries the exact canonical rubric', async () => {
  const snapshot = JSON.parse(await readFile(new URL('../skills/process-radar/references/catalog.json',import.meta.url),'utf8'));
  assert.deepEqual(snapshot,catalog);
});
test('chart uses baseline and suggested scores, preserving zero and axis order', () => {
  const series = chartSeries(sampleResult,catalog);
  assert.equal(series.length,2);
  assert.equal(series[0].scores.reuse,100);
  assert.equal(series[1].scores.reuse,75);
  assert.equal(series[1].scores.verifier,0);
  const svg = renderRadarSvg(catalog.dimensions,series);
  assert.equal((svg.match(/<circle /g)||[]).length,14);
  assert.match(svg,/stroke-dasharray/);
  assert.doesNotMatch(svg,/NaN|undefined|Infinity/);
});
test('renderer escapes text and rejects incomplete or invalid profiles', () => {
  const series = chartSeries(sampleResult,catalog);
  series[1].label = '<script>bad()</script>';
  const svg = renderRadarSvg(catalog.dimensions,series,'<img onerror="bad()">');
  assert.doesNotMatch(svg,/<script|<img/);
  assert.match(svg,/&lt;script&gt;/);
  const input = structuredClone(sampleResult); input.profile.pop();
  assert.throws(()=>chartSeries(input,catalog));
  input.profile = structuredClone(sampleResult.profile); input.profile[0].score = null;
  assert.throws(()=>chartSeries(input,catalog));
  input.profile[0].score = 50; input.profile[0].id = 'verifier';
  assert.throws(()=>chartSeries(input,catalog));
  assert.throws(()=>chartSeries({...sampleResult,recommendedApproach:'invented'},catalog));
  series[1].color = 'url(https://bad.invalid)';
  assert.throws(()=>renderRadarSvg(catalog.dimensions,series));
});
test('CLI renders self-contained SVG/HTML and refuses overwrite', async () => {
  const dir = await mkdtemp(path.join(tmpdir(),'process-radar-chart-test-'));
  const input = path.join(dir,'input.json'), svg = path.join(dir,'chart.svg'), html = path.join(dir,'chart.html');
  await writeFile(input,JSON.stringify(sampleResult));
  await main(['--input',input,'--out',svg]);
  await main(['--input',input,'--out',html]);
  assert.match(await readFile(svg,'utf8'),/^<svg /);
  const page = await readFile(html,'utf8');
  assert.match(page,/Content-Security-Policy/);
  assert.doesNotMatch(page,/<script|<link|<iframe/);
  await assert.rejects(main(['--input',input,'--out',svg]),{code:'EEXIST'});
  assert.match(await readFile(svg,'utf8'),/^<svg /);
  await assert.rejects(main(['--input',input,'--out',path.join(dir,'chart.exe')]));
});
