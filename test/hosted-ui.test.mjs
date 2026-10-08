import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { usageNotice } from '../public/usage.mjs';

const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace(/init\(\)\.catch\(showError\);\s*$/, '');
const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const ids = ['expertise', 'audience', 'consequences', 'checks', 'uncertainty', 'resources', 'oversight', 'constraints', 'reuse'];
const answers = ids.map(id => ({ id, answer: `Best guess about ${id}.`, status: 'inferred', evidence: 'Please check.' }));

async function ui({ hosted = true, configured = true } = {}) {
  const elements = new Map(), events = {}, calls = [], tools = [];
  const element = tag => ({
    tag, value: '', textContent: '', children: [], hidden: false, listeners: {},
    classList: { add() {}, remove() {} },
    set id(value) { this.elementId = value; elements.set(value, this); },
    get id() { return this.elementId; },
    get options() { return this.children; },
    get selectedOptions() { return this.children.filter(child => child.value === this.value); },
    get firstChild() { return this.children[0]; },
    setAttribute(name, value) { this[name] = value; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    showModal() { this.open = true; }, close() { this.open = false; }, focus() {},
    querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
  });
  const $ = id => {
    if (!elements.has(id)) elements.set(id, element('div'));
    return elements.get(id);
  };
  $('source').value = 'chatgpt';
  const context = vm.createContext({
    AbortController, URL, usageNotice,
    document: {
      getElementById: $, createElement: element, querySelector: () => $('main'), addEventListener() {},
      modelContext: { registerTool(tool) { tools.push(tool); } }
    },
    window: { location: { href: 'https://demo.example/' }, addEventListener(name, handler) { events[name] = handler; } },
    countdown: (_seconds, tick) => {
      tick({ paused: false, remaining: 7 });
      return { cancel() {}, pause() { tick({ paused: true, remaining: 7 }); } };
    }
  });
  vm.runInContext(source, context);
  context.request = async (path, body) => {
    calls.push({ path, body });
    if (path === '/api/config') return { hosted, configured, model: 'gpt-5.5', endpoint: 'https://api.openai.com/v1', usage: { intakeInstructionCharacters: 6000, instructionCharacters: 12000, outputCap: 2000, tokenField: 'max_completion_tokens' } };
    if (path === '/api/catalog') return catalog;
    if (path === '/api/intake/questions') return { questions: ids.map(id => ({ id, label: id, question: id })) };
    if (path === '/api/intake') return { answers: structuredClone(answers) };
    if (path === '/api/recommend') return {};
    if (!hosted && path === '/api/auth/session') return { signedIn: false };
    throw new Error(`Unexpected request: ${path}`);
  };
  context.showResult = async () => true;
  await context.init();
  return { $, context, calls, events, tools };
}

test('hosted startup and restored pages never request auth or expose connection controls', async () => {
  const app = await ui();
  assert.deepEqual(app.calls.map(call => call.path), ['/api/catalog', '/api/config', '/api/intake/questions']);
  assert.equal(app.$('source').value, 'endpoint');
  for (const id of ['setup', 'login', 'plan-controls', 'retry-auth', 'logout', 'chatgpt-settings', 'endpoint-settings']) assert.equal(app.$(id).hidden, true, id);
  assert.equal(app.$('analyze').disabled, false);
  assert.equal(app.$('hosted-funding').hidden, false);
  assert.match(app.$('hosted-funding').textContent, /funded by Alinery/);
  assert.match(app.$('usage-summary').textContent, /gpt-5.5.*input tokens.*call 1 of 2/);
  assert.match(app.$('privacy').textContent, /your ChatGPT allowance is not used/);
  assert.match(app.$('review-allowance').textContent, /demo’s allowance/);
  assert.match(app.tools[0].description, /Alinery-funded/);

  app.events.pageshow({ persisted: true });
  await app.context.login();
  await app.context.dismissWelcome();
  await app.$('logout').listeners.click();
  await app.context.refreshAuth();
  assert.equal(app.calls.length, 3);
});

test('hosted intake and scoring force the server-funded source without credentials or a client model', async () => {
  const app = await ui();
  const task = 'I want to build a mobile game based on Go.';
  app.$('source').value = 'chatgpt';
  app.$('model').value = 'a-client-supplied-model';
  await app.context.prepareTask(task, { autoAdvance: false });
  app.$('source').value = 'chatgpt';
  await app.context.recommendTask();
  const requests = app.calls.filter(call => call.body);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(call => call.path), ['/api/intake', '/api/recommend']);
  for (const { body } of requests) {
    assert.equal(body.source, 'endpoint');
    assert.equal(body.task, task);
    assert.ok(Object.keys(body).every(key => ['task', 'source', 'intake'].includes(key)));
  }
  assert.match(app.$('review-usage').textContent, /gpt-5.5.*call 2 of 2/);
});

test('unconfigured hosted demo stays disabled with operator guidance rather than local setup advice', async () => {
  const app = await ui({ configured: false });
  assert.equal(app.$('analyze').disabled, true);
  assert.match(app.$('privacy').textContent, /site operator.*finish setup/);
  assert.doesNotMatch(app.$('privacy').textContent, /\.env|npm|sign in|ChatGPT plan/i);
  await assert.rejects(app.context.prepareTask('I want to build a mobile game based on Go.'), /demo is not ready/);
  assert.equal(app.calls.length, 3);
});

test('local mode retains sign-in and endpoint setup options', async () => {
  const app = await ui({ hosted: false });
  assert.equal(app.$('setup').hidden, false);
  assert.equal(app.$('login').hidden, false);
  assert.equal(app.$('hosted-funding').hidden, true);
  assert.ok(app.calls.some(call => call.path === '/api/auth/session'));
  assert.match(app.$('review-allowance').textContent, /your model allowance/);
});
