import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateInputTokens, usageNotice } from '../public/usage.mjs';
import { buildMessages, readConfig } from '../model.mjs';
import { buildIntakeMessages } from '../intake.mjs';
import { catalog, createApp } from '../server.mjs';

test('input estimates include instructions, serialized task, framing, and coarse rounding', () => {
  assert.equal(estimateInputTokens(16000, ''), 4100);
  assert.equal(estimateInputTokens(16000, 'x'.repeat(1000)), 4300);
  const task = '\n"\\'.repeat(500);
  const characters = 16000 + JSON.stringify({ taskDescription: task.trim() }).length + 80;
  assert.equal(estimateInputTokens(16000, task), Math.ceil(characters / 400) * 100);
  assert.ok(estimateInputTokens(16000, task) > estimateInputTokens(16000, 'x'.repeat(task.length)));
  assert.equal(estimateInputTokens(16000, '  a task  '), estimateInputTokens(16000, 'a task'));
});

test('missing or invalid metadata never reports a deceptively small estimate', () => {
  for (const value of [undefined, null, 0, -1, NaN, Infinity, '16000', 1.5]) {
    assert.equal(estimateInputTokens(value, 'task'), null);
    assert.match(usageNotice({ instructionCharacters: value }).summary, /estimate unavailable/);
  }
  assert.equal(estimateInputTokens(16000, null), 4100);
  assert.equal(estimateInputTokens(16000, '模型'.repeat(100)) % 100, 0);
});

test('usage notice names model and calls out variable usage and no retries', () => {
  const notice = usageNotice({ intakeInstructionCharacters: 4000, instructionCharacters: 16000, task: 'a task', source: 'chatgpt', model: ' GPT-5.5 ' });
  assert.equal(notice.summary, 'GPT-5.5 · ~1,100 input tokens + reply/reasoning · call 1 of 2');
  assert.match(notice.detail, /intake instructions and task/);
  assert.match(notice.detail, /continue or the 7-second review countdown finishes/);
  assert.match(notice.detail, /editing an answer pauses automatically/);
  assert.match(notice.detail, /model and language/);
  assert.match(notice.detail, /No automatic retries/);
  assert.match(notice.detail, /no local output-token cap/);
  assert.match(usageNotice().summary, /^Choose a model/);
});

test('review estimates use scoring instructions and all answer text including provenance', () => {
  const answers = [{ id: 'expertise', answer: 'x'.repeat(800), status: 'inferred', evidence: 'No explicit statement.' }];
  const notice = usageNotice({ stage: 'recommend', intakeInstructionCharacters: 4000, instructionCharacters: 16000, task: 'a task', answers, model: 'local' });
  const characters = 16000 + JSON.stringify({ taskDescription: 'a task', intake: { answers } }).length + 80;
  assert.equal(estimateInputTokens(16000, 'a task', answers), Math.ceil(characters / 400) * 100);
  assert.match(notice.summary, /~4,300 input tokens.*call 2 of 2/);
  assert.match(notice.detail, /scoring instructions, task, and reviewed answers/);
  assert.match(notice.detail, /additional for each call/);
  assert.match(usageNotice({ instructionCharacters: 16000 }).summary, /estimate unavailable/);
});

test('output caps follow the selected source and configured token field', () => {
  const options = { instructionCharacters: 16000, source: 'endpoint', model: 'local', outputCap: 4096 };
  assert.match(usageNotice({ ...options, tokenField: 'max_tokens' }).detail, /4,096-token output cap; reasoning treatment depends on the provider/);
  assert.match(usageNotice({ ...options, tokenField: 'max_completion_tokens' }).detail, /4,096-token completion cap, including reasoning where supported/);
  assert.doesNotMatch(usageNotice({ ...options, source: 'chatgpt', tokenField: 'max_tokens' }).detail, /4,096/);
  for (const outputCap of [undefined, 0, -1, '4096']) assert.doesNotMatch(usageNotice({ ...options, outputCap, tokenField: 'max_tokens' }).detail, /Endpoint requests/);
  assert.doesNotMatch(usageNotice({ ...options, tokenField: 'unknown' }).detail, /Endpoint requests/);
});

test('public config supplies only safe estimate metadata from the actual prompt and serves helper', async t => {
  const config = readConfig({ LLM_BASE_URL: 'https://api.openai.com/v1', LLM_MODEL: 'test-model', OPENAI_API_KEY: 'secret-never-exposed', LLM_MAX_TOKENS: '2048', LLM_TOKEN_FIELD: 'max_completion_tokens' });
  const server = createApp(config, () => { throw new Error('An estimate must not make a provider request.'); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${url}/api/config`);
  const metadata = await response.json();
  assert.deepEqual(Object.keys(metadata).sort(), ['configured', 'endpoint', 'model', 'usage']);
  assert.deepEqual(metadata.usage, {
    instructionCharacters: buildMessages('A valid task to estimate.', catalog)[0].content.length,
    intakeInstructionCharacters: buildIntakeMessages('A valid task to estimate.')[0].content.length,
    outputCap: 2048,
    tokenField: 'max_completion_tokens'
  });
  assert.doesNotMatch(JSON.stringify(metadata), /secret-never-exposed|apiKey|accessToken/);
  const helper = await fetch(`${url}/usage.mjs`);
  assert.equal(helper.status, 200);
  assert.match(helper.headers.get('content-type'), /javascript/);
});
