import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { listChatGPTModels, recommendWithChatGPT } from '../chatgpt-model.mjs';
import { sampleResult, sampleTask } from './fixtures.mjs';

const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const config = { accessToken: 'test-secret', model: 'allowed-model', timeout: 120000 };
const event = value => `data: ${JSON.stringify(value)}\n\n`;
const delta = text => event({ type: 'response.output_text.delta', delta: text });
const complete = output => event({ type: 'response.completed', response: { status: 'completed', ...(output ? { output } : {}) } });
const failure = code => event({ type: 'response.failed', response: { error: { code, message: 'provider-secret' } } });
const stream = (text, width = 13) => {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset += width));
    }
  }), { headers: { 'Content-Type': 'text/event-stream' } });
};
const recommend = fetchImpl => recommendWithChatGPT(sampleTask, catalog, config, fetchImpl);
const safeError = pattern => error => pattern.test(error.message) && !JSON.stringify({ message: error.message, ...error }).includes('secret');

test('ChatGPT discovery retains only visible models in server order', async () => {
  assert.deepEqual(await listChatGPTModels(config.accessToken, async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/models');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.equal(options.redirect, 'error');
    return Response.json({ models: [
      { slug: 'second', display_name: 'Second', visibility: 'list' },
      { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' },
      { slug: 'first', display_name: 'First', visibility: 'list' }
    ] });
  }), [{ id: 'second', name: 'Second' }, { id: 'first', name: 'First' }]);
});

test('ChatGPT discovery rejects invalid lists and does not leak provider errors', async () => {
  for (const response of [Response.json({ data: [] }), Response.json({ models: [{ visibility: 'list', slug: 5 }] }), new Response('provider-secret')]) {
    await assert.rejects(listChatGPTModels('test-secret', async () => response), safeError(/invalid model list/));
  }
  await assert.rejects(listChatGPTModels('', () => { throw new Error('Must not fetch'); }), /Sign in/);
  await assert.rejects(listChatGPTModels('test-secret', async () => new Response('x'.repeat(512 * 1024 + 1))), /too large/);
});

test('ChatGPT sends only supported Responses fields with instructions and user input', async () => {
  const result = await recommend(async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.deepEqual(Object.keys(body).sort(), ['input', 'instructions', 'model', 'store', 'stream']);
    assert.equal(body.model, config.model);
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    assert.match(body.instructions, /DEPENDENCE/);
    assert.equal(body.input.length, 1);
    assert.equal(body.input[0].role, 'user');
    assert.equal(JSON.parse(body.input[0].content).taskDescription, sampleTask);
    return stream(delta(JSON.stringify(sampleResult)) + complete());
  });
  assert.deepEqual(result, sampleResult);
});

test('SSE handles byte-fragmented UTF8, CRLF, comments, and multiline data', async () => {
  const expected = { ...sampleResult, summary: 'A careful résumé review 🔎' };
  const wire = ': ping\r\n\r\nevent: response.output_text.delta\r\ndata: {"delta":\r\ndata: ' + JSON.stringify(JSON.stringify(expected)) + '}\r\n\r\n' + complete().replaceAll('\n', '\r\n');
  assert.deepEqual(await recommend(async () => stream(wire, 1)), expected);
});

test('completed event final output is accepted and replaces streamed text', async () => {
  const output = [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(sampleResult) }] }];
  assert.deepEqual(await recommend(async () => stream(delta('incomplete prefix') + complete(output))), sampleResult);
});

test('text or DONE alone is not completion, including valid JSON before an interrupted stream', async () => {
  for (const wire of [delta(JSON.stringify(sampleResult)), delta(JSON.stringify(sampleResult)) + 'data: [DONE]\n\n', 'data: {"type":"response.completed"}']) {
    await assert.rejects(recommend(async () => stream(wire)), /ended before/);
  }
});

test('late plan-limit failure discards a valid-looking partial recommendation', async () => {
  await assert.rejects(recommend(async () => stream(delta(JSON.stringify(sampleResult)) + failure('subscription_sharing_usage_limit_exceeded'))), error => {
    assert.equal(error.status, 429);
    assert.equal(error.code, 'subscription_sharing_usage_limit_exceeded');
    assert.match(error.message, /settings → Usage/);
    assert.ok(safeError(/usage limit/)(error));
    return true;
  });
});

test('all structured plan errors use safe actionable status and messages', async () => {
  const codes = {
    subscription_sharing_user_not_eligible: 403,
    subscription_sharing_usage_limit_exceeded: 429,
    subscription_sharing_usage_unavailable: 503,
    subscription_sharing_unsupported_capability: 400,
    subscription_sharing_route_not_supported: 403,
    subscription_sharing_invalid_user: 401,
    chatpass_v2_scope_not_authorized: 403,
    chatpass_v2_invalid_authorization_context: 403,
    subscription_sharing_user_unavailable: 503
  };
  for (const [code, status] of Object.entries(codes)) {
    await assert.rejects(recommend(async () => stream(failure(code))), error => error.status === status && error.code === code && safeError(/./)(error));
  }
});

test('HTTP admission errors preserve status and safe request ID without disclosing provider text', async () => {
  for (const status of [400, 401, 403, 429, 500, 503]) {
    await assert.rejects(recommend(async () => Response.json({ detail: 'provider-secret' }, { status, headers: { 'x-request-id': 'req_123' } })), error => error.status === status && error.requestId === 'req_123' && safeError(/./)(error));
  }
  await assert.rejects(recommend(async () => Response.json({ error: { code: 'subscription_sharing_usage_unavailable', message: 'provider-secret' } }, { status: 503 })), error => error.code === 'subscription_sharing_usage_unavailable' && error.status === 503);
  await assert.rejects(recommend(async () => new Response(null, { status: 401 })), error => error.status === 401);
});

test('completion cancels the response reader instead of waiting for an idle connection to close', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(delta(JSON.stringify(sampleResult)) + complete())); },
    cancel() { cancelled = true; }
  });
  assert.deepEqual(await recommend(async () => new Response(body)), sampleResult);
  assert.equal(cancelled, true);
});

test('invalid, incomplete, failed, refused, oversized, and interrupted streams fail safely', async () => {
  const cases = [
    [stream('data: provider-secret\n\n'), /invalid event/],
    [stream(event({ type: 'response.output_text.delta', delta: 42 })), /invalid text/],
    [stream(event({ type: 'response.incomplete', response: { incomplete_details: 'provider-secret' } })), /did not complete/],
    [stream(complete([{ type: 'message', content: [{ type: 'refusal', refusal: 'provider-secret' }] }])), /declined/],
    [stream(event({ type: 'response.refusal.delta', delta: 'provider-secret' })), /declined/],
    [stream(failure('provider-secret')), /request failed/],
    [stream(event({ type: 'error', code: 'provider-secret', message: 'provider-secret' })), /request failed/],
    [stream(': ' + 'x'.repeat(512 * 1024)), /too large/],
    [stream(delta('{}') + complete()), /invalid recommendation/],
    [stream(delta('provider-secret') + complete()), /valid JSON/],
    [new Response(new ReadableStream({ start(controller) { controller.error(new Error('provider-secret')); } })), /connection to ChatGPT/]
  ];
  for (const [response, pattern] of cases) await assert.rejects(recommend(async () => response), safeError(pattern));
});

test('timeouts, transport errors, and missing configuration never echo sensitive details', async () => {
  await assert.rejects(recommend(async () => { throw new DOMException('provider-secret', 'TimeoutError'); }), safeError(/timed out/));
  await assert.rejects(recommend(async () => { throw new Error('provider-secret'); }), safeError(/connection to ChatGPT/));
  await assert.rejects(recommendWithChatGPT(sampleTask, catalog, { ...config, model: '' }), /Choose a model/);
  await assert.rejects(recommendWithChatGPT(sampleTask, catalog, { ...config, accessToken: '' }), /Sign in/);
});
