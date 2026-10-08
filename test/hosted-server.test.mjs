import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.mjs';
import { readConfig } from '../model.mjs';
import { readHostingConfig } from '../hosting.mjs';
import { sampleIntake, sampleResult, sampleTask } from './fixtures.mjs';

const origin = 'https://demo.example';
const config = () => readConfig({ LLM_BASE_URL: 'https://api.openai.com/v1', LLM_MODEL: 'fixed-test-model', OPENAI_API_KEY: 'test-only-hosted-secret' });
const hosting = overrides => readHostingConfig({ HOSTED: 'true', PUBLIC_ORIGIN: origin, ...overrides });
const envelope = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));

async function start(t, server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

function request(url, path, { method = 'GET', headers = {}, input } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url + path, { method, headers: { Host: 'demo.example', ...headers } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.once('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      res.once('error', reject);
    });
    req.once('error', reject);
    req.end(input === undefined ? undefined : JSON.stringify(input));
  });
}
const post = (url, path = '/api/intake', input = {}, headers = {}) => request(url, path, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
  input: { task: sampleTask, source: 'endpoint', ...(path === '/api/recommend' ? { intake: sampleIntake } : {}), ...input }
});

test('hosted requests use the exact public Host and Origin; forwarding headers confer no trust', async t => {
  let calls = 0;
  const url = await start(t, createApp(config(), async () => { calls++; return envelope(sampleIntake); }, null, hosting()));
  for (const Host of ['evil.invalid', 'localhost', '127.0.0.1', 'demo.example:443', 'demo.example.evil.invalid']) {
    const response = await post(url, '/api/intake', {}, { Host, 'X-Forwarded-Host': 'demo.example', 'X-Forwarded-Proto': 'https', Forwarded: 'host=demo.example;proto=https' });
    assert.equal(response.status, 403, Host);
  }
  for (const Origin of ['', 'null', 'https://evil.invalid', 'http://demo.example', 'https://demo.example.evil.invalid']) {
    assert.equal((await post(url, '/api/intake', {}, { Origin })).status, 403, Origin);
  }
  assert.equal((await request(url, '/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, input: { task: sampleTask, source: 'endpoint' } })).status, 403);
  assert.equal((await post(url, '/api/intake', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal(calls, 0);
  assert.equal((await post(url, '/api/intake', {}, { 'X-Forwarded-Host': 'evil.invalid', 'X-Forwarded-Proto': 'http' })).status, 200);
  assert.equal(calls, 1);
});

test('hosted health probes expose no secrets and only the exact health route bypasses Host checks', async t => {
  const url = await start(t, createApp(config(), async () => { throw new Error('No provider call expected'); }, null, hosting()));
  const health = await request(url, '/healthz', { headers: { Host: 'platform-internal.invalid', Origin: 'https://probe.invalid' } });
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.text), { ok: true });
  assert.doesNotMatch(health.text, /secret|model|key|endpoint/i);
  for (const path of ['/healthz?config=1', '/api/config', '/']) {
    assert.equal((await request(url, path, { headers: { Host: 'platform-internal.invalid' } })).status, 403, path);
  }
  assert.equal((await request(url, '/healthz', { method: 'POST', headers: { Host: 'platform-internal.invalid' } })).status, 403);
  const publicConfig = await request(url, '/api/config');
  assert.equal(publicConfig.status, 200);
  assert.equal(JSON.parse(publicConfig.text).hosted, true);
  assert.doesNotMatch(publicConfig.text, /test-only-hosted-secret|apiKey|OPENAI_API_KEY/);
  assert.equal(publicConfig.headers['set-cookie'], undefined);
  assert.match(publicConfig.headers['content-security-policy'], /frame-ancestors 'none'/);
});

test('hosted mode disables all ChatGPT auth routes even if an auth adapter is supplied', async t => {
  const auth = new Proxy({}, { get() { throw new Error('Hosted mode must never call auth'); } });
  let calls = 0;
  const url = await start(t, createApp(config(), async () => { calls++; return envelope(sampleIntake); }, auth, hosting()));
  for (const path of ['/auth/callback?code=test-only', '/api/auth/session', '/api/auth/models', '/api/auth/login', '/api/auth/logout', '/api/auth/welcome']) {
    const method = path.endsWith('login') || path.endsWith('logout') || path.endsWith('welcome') ? 'POST' : 'GET';
    const response = await request(url, path, { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { input: {} } : {}) });
    assert.equal(response.status, 404, path);
    assert.equal(response.headers['set-cookie'], undefined);
  }
  assert.equal((await post(url, '/api/intake', { source: 'chatgpt', model: 'unapproved-model' })).status, 400);
  assert.equal(calls, 0);
});

test('hosted inference uses only server-owned endpoint, model, credentials and output cap', async t => {
  const seen = [];
  const url = await start(t, createApp(config(), async (endpoint, options) => {
    seen.push({ endpoint, options, body: JSON.parse(options.body) });
    return envelope(seen.length === 1 ? sampleIntake : sampleResult);
  }, null, hosting()));
  const override = { model: 'expensive-client-model', endpoint: 'https://evil.invalid', apiKey: 'client-test-only-key', max_tokens: 999999 };
  assert.equal((await post(url, '/api/intake', override)).status, 200);
  assert.equal((await post(url, '/api/recommend', override)).status, 200);
  assert.equal(seen.length, 2);
  for (const call of seen) {
    assert.equal(call.endpoint, 'https://api.openai.com/v1/chat/completions');
    assert.equal(call.body.model, 'fixed-test-model');
    assert.equal(call.body.max_tokens, 4096);
    assert.equal(call.options.headers.Authorization, 'Bearer test-only-hosted-secret');
    assert.equal(call.options.redirect, 'error');
    assert.doesNotMatch(JSON.stringify(call.body), /expensive-client-model|client-test-only-key|evil\.invalid/);
  }
});

test('hosted mode without an OpenAI API key fails closed before calling a provider', async t => {
  let calls = 0;
  const missingKey = readConfig({ LLM_BASE_URL: 'https://api.openai.com/v1', LLM_MODEL: 'fixed-test-model' });
  assert.equal(missingKey.configured, false);
  const url = await start(t, createApp(missingKey, async () => { calls++; return envelope(sampleIntake); }, null, hosting()));
  for (const path of ['/api/intake', '/api/recommend']) assert.equal((await post(url, path)).status, 503);
  assert.equal(calls, 0);
  assert.equal(JSON.parse((await request(url, '/api/config')).text).configured, false);
  assert.equal((await request(url, '/')).status, 200);
});

test('hosted quota counts failed provider attempts and both intake/recommend calls, excluding invalid requests', async t => {
  let calls = 0;
  const url = await start(t, createApp(config(), async () => {
    calls++;
    return calls === 1 ? new Response('provider details must stay private', { status: 500 }) : envelope(sampleResult);
  }, null, hosting({ DEMO_HOURLY_CALLS: '2', DEMO_CONCURRENCY: '1' })));
  assert.equal((await post(url, '/api/intake', { task: 'x' })).status, 400);
  assert.equal((await post(url, '/api/intake', { source: 'chatgpt' })).status, 400);
  const failed = await post(url);
  assert.equal(failed.status, 502);
  assert.doesNotMatch(failed.text, /provider details must stay private/);
  assert.equal((await post(url, '/api/recommend')).status, 200);
  assert.equal((await post(url)).status, 429);
  assert.equal(calls, 2);
});

test('hosted concurrency allows two calls, rejects the third and releases capacity after completion', { timeout: 5000 }, async t => {
  const pending = [];
  let notify, notifyThird;
  const started = new Promise(resolve => { notify = resolve; });
  const thirdStarted = new Promise(resolve => { notifyThird = resolve; });
  const url = await start(t, createApp(config(), async () => {
    await new Promise(resolve => { pending.push(resolve); if (pending.length === 2) notify(); if (pending.length === 3) notifyThird(); });
    return envelope(sampleIntake);
  }, null, hosting()));
  const first = post(url), second = post(url);
  await started;
  assert.equal((await post(url)).status, 429);
  assert.equal(pending.length, 2);
  pending[0](); pending[1]();
  assert.deepEqual(await Promise.all([first, second]).then(responses => responses.map(response => response.status)), [200, 200]);
  const third = post(url);
  await thirdStarted;
  pending[2]();
  assert.equal((await third).status, 200);
});
