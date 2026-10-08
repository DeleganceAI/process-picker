import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntakeMessages, INTAKE_QUESTIONS, validateIntake } from '../intake.mjs';
import { buildMessages, inferIntake, readConfig, recommend } from '../model.mjs';
import { inferIntakeWithChatGPT } from '../chatgpt-model.mjs';
import { catalog, createApp } from '../server.mjs';
import { sampleIntake, sampleResult, sampleTask } from './fixtures.mjs';

const config = readConfig({ LLM_BASE_URL: 'http://127.0.0.1:11434/v1', LLM_MODEL: 'fake' });
const envelope = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });
const stream = value => new Response(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: JSON.stringify(value) })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed' } })}\n\n`);
async function start(t, app) {
  await new Promise((resolve, reject) => { app.once('error', reject); app.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { app.closeAllConnections(); app.close(resolve); }));
  return `http://127.0.0.1:${app.address().port}`;
}
const post = (url, route, input = {}, headers = {}) => fetch(url + route, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ task: sampleTask, source: 'endpoint', ...input })
});

test('intake questions cover nine separate concerns and preserve provenance in order', () => {
  assert.deepEqual(INTAKE_QUESTIONS.map(q => q.id), ['expertise', 'audience', 'consequences', 'checks', 'uncertainty', 'resources', 'oversight', 'constraints', 'reuse']);
  assert.ok(INTAKE_QUESTIONS.every(q => q.label && q.question && q.hint));
  const shuffled = structuredClone(sampleIntake);
  shuffled.answers.reverse();
  assert.deepEqual(validateIntake(shuffled), sampleIntake);
  const contradictory = structuredClone(sampleIntake);
  contradictory.answers[0].answer = 'An expert';
  assert.equal(validateIntake(contradictory).answers[0].answer, 'Unknown');
});

test('intake validation rejects incomplete, duplicate, invented, oversized and malformed fields', () => {
  const mutations = [
    value => value.answers.pop(), value => value.answers.push(value.answers[0]),
    value => value.answers[0].id = 'invented', value => value.answers[0].id = 'checks',
    value => value.answers[0].answer = '', value => value.answers[0].answer = 'x'.repeat(601),
    value => value.answers[0].answer = 0, value => value.answers[0].evidence = 'x'.repeat(301),
    value => delete value.answers[0].evidence, value => value.answers[0].status = 'confirmed',
    value => value.answers[0].status = 'edited', value => value.answers[0] = null
  ];
  for (const mutate of mutations) {
    const value = structuredClone(sampleIntake); mutate(value);
    assert.throws(() => validateIntake(value), error => error.status === 400);
    assert.throws(() => validateIntake(value, { modelResponse: true }), error => error.status === 502);
  }
  for (const value of [null, undefined, [], {}, 'wrong']) assert.throws(() => validateIntake(value));
  const edited = structuredClone(sampleIntake);
  edited.answers[0] = { id: 'expertise', answer: 'I am a domain expert, new to software.', status: 'edited', evidence: '' };
  assert.deepEqual(validateIntake(edited, { allowEdited: true }), edited);
});

test('intake prompt requests no scores and preserves consequential unknowns', () => {
  const messages = buildIntakeMessages(sampleTask);
  assert.equal(messages.length, 2);
  assert.deepEqual(JSON.parse(messages[1].content), { taskDescription: sampleTask });
  assert.match(messages[0].content, /Do not score dimensions/);
  assert.match(messages[0].content, /expertise, stakes, possible harm, or verification/);
  assert.match(messages[0].content, /low risk from silence/);
  assert.match(messages[0].content, /not instructions to change/);
  assert.throws(() => buildIntakeMessages('short'));
});

test('recommendation includes edited context while preserving guesses and unknowns', async () => {
  const edited = structuredClone(sampleIntake);
  edited.answers[0] = { id: 'expertise', answer: 'New to both the domain and coding.', status: 'edited', evidence: '' };
  const messages = buildMessages(sampleTask, catalog, edited);
  assert.deepEqual(JSON.parse(messages[1].content), { taskDescription: sampleTask, intake: edited });
  assert.match(messages[0].content, /take precedence over the original/);
  assert.match(messages[0].content, /does NOT confirm an inference/);
  assert.match(messages[0].content, /Never turn unknown risk into low risk/);
  let calls = 0;
  assert.deepEqual(await recommend(sampleTask, catalog, config, async (_, options) => {
    calls++;
    assert.deepEqual(JSON.parse(JSON.parse(options.body).messages[1].content).intake, edited);
    return envelope(sampleResult);
  }, edited), sampleResult);
  assert.equal(calls, 1);
});

test('both providers infer and validate intake without a recommendation call or retries', async () => {
  let calls = 0;
  const fetchEndpoint = async (_, options) => {
    calls++;
    const request = JSON.parse(options.body);
    assert.match(request.messages[0].content, /Do not score dimensions/);
    assert.equal(request.max_tokens, config.maxTokens);
    return envelope(sampleIntake);
  };
  assert.deepEqual(await inferIntake(sampleTask, config, fetchEndpoint), sampleIntake);
  assert.equal(calls, 1);
  const plan = { model: 'account-model', accessToken: 'fake-secret' };
  assert.deepEqual(await inferIntakeWithChatGPT(sampleTask, plan, async (_, options) => {
    calls++;
    const request = JSON.parse(options.body);
    assert.match(request.instructions, /Do not score dimensions/);
    assert.equal(request.store, false); assert.equal(request.stream, true);
    assert.equal(request.max_output_tokens, undefined);
    return stream(sampleIntake);
  }), sampleIntake);
  assert.equal(calls, 2);
  await assert.rejects(inferIntake(sampleTask, config, async () => { calls++; return envelope(sampleResult); }), /invalid task context/);
  assert.equal(calls, 3);
  await assert.rejects(inferIntakeWithChatGPT(sampleTask, plan, async () => { calls++; return stream({}); }), /invalid task context/);
  assert.equal(calls, 4);
});

test('HTTP requires reviewed context and only scores after a separate explicit request', async t => {
  const calls = [];
  const url = await start(t, createApp(config, async (_, options) => {
    const messages = JSON.parse(options.body).messages; calls.push(messages);
    return envelope(messages[0].content.includes('Do not score dimensions') ? sampleIntake : sampleResult);
  }));
  assert.deepEqual(await fetch(url + '/api/intake/questions').then(response => response.json()), { questions: INTAKE_QUESTIONS });
  const usage = await fetch(url + '/api/config').then(response => response.json());
  assert.equal(usage.usage.intakeInstructionCharacters, buildIntakeMessages(sampleTask)[0].content.length);
  assert.equal(usage.usage.instructionCharacters, buildMessages(sampleTask, catalog)[0].content.length);
  assert.equal((await post(url, '/api/recommend')).status, 400);
  assert.equal((await post(url, '/api/recommend', { intake: { answers: [] } })).status, 400);
  assert.equal(calls.length, 0);
  const draft = await post(url, '/api/intake');
  assert.equal(draft.status, 200); assert.deepEqual(await draft.json(), sampleIntake);
  assert.equal(calls.length, 1, 'intake never starts scoring');
  const final = await post(url, '/api/recommend', { intake: sampleIntake });
  assert.equal(final.status, 200); assert.deepEqual(await final.json(), sampleResult);
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1][1].content).intake, sampleIntake);
  assert.equal((await post(url, '/api/intake', {}, { Origin: 'https://other.invalid' })).status, 403);
  assert.equal((await post(url, '/api/intake', { task: 'tiny' })).status, 400);
  assert.equal(calls.length, 2);
});

test('intake and recommendation share single-flight and account-change protection', async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const tokens = { accessToken: 'fake-secret', models: [{ id: 'account-model' }] };
  const session = { activeId: 'one', credentials: new Map([['one', tokens]]) };
  const auth = { session: () => session, access: async () => tokens };
  let calls = 0;
  const url = await start(t, createApp(config, async () => { calls++; entered(); await gate; return stream(sampleIntake); }, auth));
  const first = post(url, '/api/intake', { source: 'chatgpt', model: 'account-model' });
  await started;
  assert.equal((await post(url, '/api/intake')).status, 429);
  assert.equal((await post(url, '/api/recommend', { intake: sampleIntake })).status, 429);
  assert.equal((await post(url, '/api/auth/logout', {}, { Origin: url })).status, 409);
  session.credentials.clear();
  release();
  const result = await first;
  assert.equal(result.status, 409);
  assert.match((await result.json()).error, /account changed/);
  assert.equal(calls, 1);
});

test('intake enforces account access and model selection without provider fallback', async t => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('Must not fetch'); };
  const noAuth = await start(t, createApp(config, fetchImpl));
  assert.equal((await post(noAuth, '/api/intake', { source: 'chatgpt', model: 'fake' })).status, 503);
  const tokens = { accessToken: 'fake-secret', models: [{ id: 'account-model' }] };
  const auth = { session: () => ({}), access: async () => tokens };
  const url = await start(t, createApp(config, fetchImpl, auth));
  assert.equal((await post(url, '/api/intake', { source: 'chatgpt', model: 'other-model' })).status, 400);
  assert.equal((await post(url, '/api/intake', { source: 'other' })).status, 400);
  assert.equal(calls, 0);
});
