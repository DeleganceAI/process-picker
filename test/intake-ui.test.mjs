import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace(/init\(\)\.catch\(showError\);\s*$/, '');
const ids = ['expertise', 'audience', 'consequences', 'checks', 'uncertainty', 'resources', 'oversight', 'constraints', 'reuse'];
const questions = ids.map(id => ({ id, label: id, question: `Question about ${id}?`, hint: `Hint about ${id}.` }));
const draft = () => ({ answers: ids.map((id, i) => ({ id, answer: i ? 'Not specified' : 'A domain expert', status: i ? 'unknown' : 'stated', evidence: i ? '' : 'The user said so.' })) });
const task = 'I want to build a mobile game based on Go.';

function ui() {
  const elements = new Map();
  const element = tag => ({
    tag, value: '', textContent: '', children: [], hidden: false, disabled: false, listeners: {}, style: {},
    classList: { add() {}, remove() {} },
    setAttribute(name, value) { this[name] = value; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    focus() { this.focused = true; }, scrollIntoView() {},
    querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
  });
  const $ = id => {
    if (!elements.has(id)) elements.set(id, element('div'));
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: $, createElement: element, querySelector: () => $('main') },
    AbortController, structuredClone
  });
  vm.runInContext(source, context);
  context.ready = () => true;
  context.renderConnection = () => {};
  context.renderUsage = () => {};
  context.showResult = async () => { $('result').hidden = false; return true; };
  context.questions = questions;
  vm.runInContext('intakeQuestions = questions;', context);
  $('source').value = 'chatgpt'; $('model').value = 'gpt-5.5';
  const calls = [];
  context.request = async (path, body) => { calls.push({ path, body }); return draft(); };
  return {
    $, context, calls,
    prepare: input => context.prepareTask(input),
    recommend: () => context.recommendTask(),
    fields: () => $('intake-fields').querySelectorAll('textarea'),
    state: () => vm.runInContext('({ intakeAnswers, intakeTask, busy, busyStage })', context),
    editTask(input) { $('task').value = input; context.invalidateIntake(); }
  };
}

test('preparing the task reveals editable answers and never starts scoring automatically', async () => {
  const app = ui();
  const response = await app.prepare(task);
  assert.equal(response.reviewRequired, true);
  assert.deepEqual(app.calls.map(call => call.path), ['/api/intake']);
  assert.equal(app.$('intake-review').hidden, false);
  assert.equal(app.$('intake-title').focused, true);
  assert.equal(app.fields().length, 9);
  assert.ok(app.fields().every(input => input.maxLength === 600));
  assert.equal(app.$('result').hidden, true);
  assert.equal(app.state().busy, false);
});

test('continuing accepts unknown defaults and snapshots the selected source and model', async () => {
  const app = ui();
  await app.prepare(task);
  app.$('model').value = 'another-model';
  await app.recommend();
  assert.equal(app.calls.length, 2);
  assert.equal(app.calls[1].path, '/api/recommend');
  assert.equal(app.calls[1].body.model, 'another-model');
  assert.equal(app.calls[1].body.intake.answers[1].status, 'unknown');
  assert.equal(app.calls[1].body.intake.answers[0].status, 'stated');
  assert.equal(app.$('result').hidden, false);
  app.$('source').value = 'endpoint';
  await app.recommend();
  assert.equal(app.calls[2].body.source, 'endpoint');
  assert.equal('model' in app.calls[2].body, false);
  assert.equal(app.calls.filter(call => call.path === '/api/intake').length, 1);
});

test('editing answers clears inference evidence and hides stale scores without another intake call', async () => {
  const app = ui();
  await app.prepare(task);
  await app.recommend();
  const input = app.fields()[0]; input.value = 'I am new to this domain.'; input.listeners.input();
  const answer = app.state().intakeAnswers[0];
  assert.equal(answer.answer, input.value);
  assert.equal(answer.status, 'edited');
  assert.equal(answer.evidence, '');
  assert.equal(app.$('result').hidden, true);
  assert.equal(app.$('intake-fields').children[0].children[0].children[1].textContent, 'Your edit');
  await app.recommend();
  assert.equal(app.calls.length, 3);
  assert.equal(app.calls[2].body.intake.answers[0].answer, input.value);
});

test('editing the task invalidates the review and requires new intake before scoring', async () => {
  const app = ui();
  await app.prepare(task);
  app.editTask(`${task} It will handle private customer data.`);
  assert.equal(app.state().intakeAnswers, null);
  assert.equal(app.$('intake-review').hidden, true);
  assert.equal(app.$('result').hidden, true);
  await assert.rejects(app.recommend(), /Check your task/);
  assert.equal(app.calls.length, 1);
  await app.prepare(app.$('task').value);
  assert.equal(app.calls.length, 2);
});

test('a cleared answer can continue as Unknown and editing removes stale completion status', async () => {
  const app = ui();
  await app.prepare(task);
  await app.recommend();
  assert.match(app.$('status').textContent, /All seven scores/);
  const input = app.fields()[0]; input.value = '   '; input.listeners.input();
  assert.equal(app.$('status').textContent, '');
  await app.recommend();
  const answer = app.calls.at(-1).body.intake.answers[0];
  assert.equal(answer.answer, 'Unknown');
  assert.equal(answer.status, 'unknown');
  assert.equal(answer.evidence, '');
});

test('a scoring failure preserves edited answers and retries only scoring', async () => {
  const app = ui();
  await app.prepare(task);
  const input = app.fields()[0]; input.value = 'Domain beginner'; input.listeners.input();
  let attempts = 0;
  app.context.request = async (path, body) => {
    app.calls.push({ path, body });
    if (++attempts === 1) throw new Error('Temporary failure');
    return {};
  };
  await assert.rejects(app.recommend(), /Temporary failure/);
  assert.equal(app.$('review-error').textContent, 'Temporary failure');
  assert.equal(app.state().busy, false);
  assert.equal(app.$('intake-review').hidden, false);
  assert.equal(app.fields()[0].value, 'Domain beginner');
  await app.recommend();
  assert.equal(app.$('review-error').textContent, '');
  assert.deepEqual(app.calls.map(call => call.path), ['/api/intake', '/api/recommend', '/api/recommend']);
  assert.equal(app.calls[2].body.intake.answers[0].status, 'edited');
});

test('double-clicks never send a second request and intake failures can be retried', async () => {
  const app = ui();
  let reject;
  app.context.request = async (path, body) => {
    app.calls.push({ path, body });
    return new Promise((_resolve, fail) => { reject = fail; });
  };
  const pending = app.prepare(task);
  await assert.rejects(app.prepare(task), /already running/);
  assert.equal(app.calls.length, 1);
  reject(new Error('Try again'));
  await assert.rejects(pending, /Try again/);
  assert.equal(app.state().busy, false);
  app.context.request = async (path, body) => { app.calls.push({ path, body }); return draft(); };
  await app.prepare(task);
  assert.equal(app.calls.length, 2);
});

test('a new task from the browser tool clears the previous review even when intake fails', async () => {
  const app = ui();
  await app.prepare(task);
  app.context.request = async () => { throw new Error('Unavailable'); };
  await assert.rejects(app.prepare('A different software project for a hospital.'), /Unavailable/);
  assert.equal(app.state().intakeAnswers, null);
  assert.equal(app.$('intake-review').hidden, true);
});

test('the browser tool can only prepare a review, with no recommendation tool exposed', () => {
  assert.match(source, /name: 'prepare_process'/);
  assert.match(source, /execute: async input => prepareTask\(input\?\.task\)/);
  assert.doesNotMatch(source, /name: 'recommend_process'/);
});
