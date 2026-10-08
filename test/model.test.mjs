import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildMessages, readConfig, recommend, validateRecommendation, validateTask } from '../model.mjs';
import { catalog } from '../server.mjs';
import { renderCheatSheet } from '../scripts/cheat-sheet.mjs';
import { sampleResult, sampleTask } from './fixtures.mjs';

const config = readConfig({ LLM_BASE_URL: 'http://127.0.0.1:11434/v1/', LLM_MODEL: 'test-only', LLM_API_KEY: 'test-secret' });
const envelope = content => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));

test('catalog has seven dimensions and the six confirmed numeric baselines', () => {
  assert.equal(catalog.dimensions.length, 7);
  assert.deepEqual(catalog.approaches.map(a => catalog.dimensions.map(d => a.ratings[d.id].score)), [
    [50,100,25,0,25,75,0], [0,0,0,0,0,50,100], [25,25,25,25,0,25,0],
    [50,75,75,100,25,75,25], [100,25,100,100,100,100,0], [50,100,100,100,100,100,0]
  ]);
  for (const a of catalog.approaches) for (const d of catalog.dimensions) assert.ok(a.ratings[d.id].reason.length > 20);
});
test('cheat sheet stays synchronized with the catalog', async () => {
  assert.equal(await readFile(new URL('../docs/cheat-sheet.md', import.meta.url), 'utf8'), renderCheatSheet(catalog));
});
test('config supports local and hosted endpoints without exposing credentials in URLs', () => {
  assert.equal(config.endpoint, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(readConfig({}).configured, false);
  assert.equal(readConfig({ LLM_BASE_URL: 'https://api.openai.com/v1', LLM_MODEL: 'gpt-5.5' }).configured, false);
  const openai = readConfig({ LLM_BASE_URL: 'https://api.openai.com/v1', LLM_MODEL: 'gpt-5.5', OPENAI_API_KEY: 'test-key', LLM_REASONING_EFFORT: 'low' });
  assert.equal(openai.configured, true);
  assert.equal(openai.apiKey, 'test-key');
  assert.equal(openai.reasoningEffort, 'low');
  assert.equal(readConfig({ LLM_BASE_URL: 'http://127.0.0.1:11434/v1', LLM_MODEL: 'local', OPENAI_API_KEY: 'never-forward' }).apiKey, '');
  for (const value of ['http://example.com/v1', 'file:///tmp/model', 'https://secret@example.com/v1', 'https://example.com/v1?key=secret']) assert.throws(() => readConfig({ LLM_BASE_URL: value }));
  assert.throws(() => readConfig({ LLM_MAX_TOKENS: '-1' }));
  assert.throws(() => readConfig({ LLM_TOKEN_FIELD: 'unexpected' }));
});
test('task validation rejects absent, tiny, and oversized input', () => {
  for (const v of [null, 5, {}, '', 'hi', 'x'.repeat(8001)]) assert.throws(() => validateTask(v));
  assert.equal(validateTask(`  ${sampleTask}  `), sampleTask);
});
test('validation preserves zero and sorts the seven known dimensions', () => {
  const input = structuredClone(sampleResult); input.profile.reverse();
  assert.deepEqual(validateRecommendation(input, catalog), sampleResult);
  assert.equal(validateRecommendation(input, catalog).profile.at(-1).score, 0);
});
test('validation rejects invalid IDs, duplicate/missing dimensions, scores, and explanations', () => {
  const changes = [
    x => x.profile.pop(), x => x.profile[0].id = 'invented', x => x.profile[0].id = 'replan',
    x => x.profile[0].score = 101, x => x.profile[0].score = '50', x => x.profile[0].score = 26,
    x => x.profile[0].reason = '', x => x.recommendedApproach = 'invented',
    x => x.alternative.id = x.recommendedApproach, x => x.steps = [], x => x.questions = ['x'.repeat(701)]
  ];
  for (const change of changes) { const input = structuredClone(sampleResult); change(input); assert.throws(() => validateRecommendation(input, catalog)); }
});
test('prompt includes intended-use semantics and excludes pending revision', () => {
  const messages = buildMessages(sampleTask, catalog);
  assert.equal(messages[1].role, 'user');
  assert.equal(JSON.parse(messages[1].content).taskDescription, sampleTask);
  assert.match(messages[0].content, /DEPENDENCE/);
  assert.match(messages[0].content, /Do not favor Playbooks/);
  assert.doesNotMatch(messages[0].content, /Skill-guided Coding/);
});
test('adapter sends compatible request and validates returned JSON', async () => {
  const result = await recommend(sampleTask, catalog, config, async (url, options) => {
    assert.equal(url, config.endpoint);
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.equal(options.redirect, 'error');
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'test-only');
    assert.equal(request.max_tokens, 4096);
    assert.deepEqual(request.response_format, { type: 'json_object' });
    return envelope(JSON.stringify(sampleResult));
  });
  assert.deepEqual(result, sampleResult);
});
test('adapter supports JSON mode off, reasoning token field, and one JSON fence', async () => {
  const settings = { ...config, apiKey: '', jsonMode: false, tokenField: 'max_completion_tokens', reasoningEffort: 'low' };
  await recommend(sampleTask, catalog, settings, async (_, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.response_format, undefined);
    assert.equal(request.max_tokens, undefined);
    assert.equal(request.max_completion_tokens, 4096);
    assert.equal(request.reasoning_effort, 'low');
    assert.equal(options.headers.Authorization, undefined);
    return envelope('```json\n' + JSON.stringify(sampleResult) + '\n```');
  });
});
test('provider failures, truncation, invalid output, and timeout are clear errors', async () => {
  const cases = [
    [async () => new Response('provider-secret', { status: 401 }), /HTTP 401/],
    [async () => new Response('not json'), /endpoint did not return/],
    [async () => envelope('not JSON'), /text instead of valid JSON/],
    [async () => envelope('{}'), /invalid recommendation/],
    [async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] })), /did not complete/],
    [async () => new Response(JSON.stringify({ choices: [{ message: { refusal: 'no' } }] })), /declined/],
    [async () => { throw new DOMException('secret', 'TimeoutError'); }, /timed out/],
    [async () => { throw new Error('secret'); }, /Could not reach/],
    [async () => new Response('x'.repeat(512 * 1024 + 1)), /too large/]
  ];
  for (const [provider, pattern] of cases) await assert.rejects(recommend(sampleTask, catalog, config, provider), error => pattern.test(error.message) && !error.message.includes('secret'));
});
test('unconfigured provider cannot silently simulate an LLM result', async () => {
  await assert.rejects(recommend(sampleTask, catalog, readConfig({}), () => { throw new Error('Must not fetch'); }), /Connect a model first/);
});
