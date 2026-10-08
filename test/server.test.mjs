import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.mjs';
import { readConfig } from '../model.mjs';
import { sampleResult, sampleTask } from './fixtures.mjs';

async function start(t, server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (url, task = sampleTask, headers = {}) => fetch(url + '/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ task }) });

test('real HTTP roundtrip through a fake OpenAI-compatible endpoint', async t => {
  let seen;
  const upstream = await start(t, http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    seen = { path: req.url, auth: req.headers.authorization, request: JSON.parse(text) };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(sampleResult) } }] }));
  }));
  const url = await start(t, createApp(readConfig({ LLM_BASE_URL: upstream + '/v1', LLM_MODEL: 'fake-integration-model', LLM_API_KEY: 'test-only-secret' })));
  const response = await post(url);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), sampleResult);
  assert.equal(seen.path, '/v1/chat/completions'); assert.equal(seen.auth, 'Bearer test-only-secret');
  assert.equal(JSON.parse(seen.request.messages[1].content).taskDescription, sampleTask);
  const publicConfig = await fetch(url + '/api/config').then(r => r.text());
  assert.doesNotMatch(publicConfig, /test-only-secret|apiKey/);
});
test('serves only public files, dimensions, and generated cheat sheet', async t => {
  const url = await start(t, createApp(readConfig({})));
  for (const path of ['/', '/style.css', '/app.js', '/radar.js', '/api/catalog', '/cheat-sheet.md']) assert.equal((await fetch(url + path)).status, 200, path);
  for (const path of ['/.env', '/.git/config', '/server.mjs', '/model.mjs', '/data/catalog.json']) assert.equal((await fetch(url + path)).status, 404, path);
  assert.equal((await post(url)).status, 503);
});
test('rejects cross-origin, rebinding, malformed, and oversized requests', async t => {
  const url = await start(t, createApp(readConfig({})));
  assert.equal((await post(url, sampleTask, { Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await post(url, sampleTask, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const rebinding = await new Promise(resolve => {
    http.get(url, { headers: { Host: 'evil.invalid' } }, res => { res.resume(); resolve(res.statusCode); });
  });
  assert.equal(rebinding, 403);
  assert.equal((await post(url, sampleTask, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post(url, 'x')).status, 400);
  assert.equal((await fetch(url + '/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'broken' })).status, 400);
  assert.equal((await post(url, 'x'.repeat(8001))).status, 400);
  assert.equal((await post(url, 'x'.repeat(66000))).status, 413);
});
test('one request at a time prevents accidental parallel provider calls', async t => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const config = readConfig({ LLM_BASE_URL: 'http://127.0.0.1:11434/v1', LLM_MODEL: 'fake' });
  const url = await start(t, createApp(config, async () => { entered(); await gate; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(sampleResult) } }] })); }));
  const first = post(url); await started;
  const second = await post(url); assert.equal(second.status, 429);
  release(); assert.equal((await first).status, 200);
});
