import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import { countdown } from '../public/countdown.mjs';
import { revealScores } from '../public/reveal.mjs';
import { closestProfiles } from '../public/similarity.mjs';
import { sampleResult } from './fixtures.mjs';

const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace(/init\(\)\.catch\(showError\);\s*$/, '');
const ids = ['expertise', 'audience', 'consequences', 'checks', 'uncertainty', 'resources', 'oversight', 'constraints', 'reuse'];
const questions = ids.map(id => ({ id, label: id, question: `Question about ${id}?`, hint: `Hint about ${id}.`, defaultAnswer: `Default assumption about ${id}.` }));
const draft = () => ({ answers: ids.map((id, i) => ({ id, answer: i ? `Best guess about ${id}.` : 'A domain expert', status: i ? 'inferred' : 'stated', evidence: i ? 'Default assumption; please edit if it does not fit.' : 'The user said so.' })) });
const task = 'I want to build a mobile game based on Go.';
const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));

async function ui({ realResult = false } = {}) {
  const elements = new Map(), timers = new Map(), tools = [];
  let time = 0, nextTimer = 0;
  const clock = {
    now: () => time,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { at: time + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  const element = tag => ({
    tag, value: '', textContent: '', children: [], hidden: false, open: false, disabled: false, listeners: {}, style: {},
    set id(value) { this.elementId = value; elements.set(value, this); },
    get id() { return this.elementId; },
    classList: { add() {}, remove() {} },
    setAttribute(name, value) { this[name] = value; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    focus() { this.focused = true; }, scrollIntoView() {},
    showModal() { this.open = true; }, close() { this.open = false; },
    querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
  });
  const $ = id => {
    if (!elements.has(id)) elements.set(id, element('div'));
    return elements.get(id);
  };
  const document = {
    hidden: false, listeners: {}, getElementById: $, createElement: element, querySelector: () => $('main'),
    addEventListener(name, listener) { this.listeners[name] = listener; },
    modelContext: { registerTool(tool) { tools.push(tool); } }
  };
  const context = vm.createContext({
    document, window: { location: { href: 'http://localhost/' }, addEventListener() {}, matchMedia: () => ({ matches: true }) },
    AbortController, structuredClone, URL, revealScores, closestProfiles,
    radar(dimensions, series, title) {
      const chart = element('svg');
      chart.radar = structuredClone({ dimensions, series, title });
      return chart;
    },
    countdown: (seconds, tick, complete) => countdown(seconds, tick, complete, clock)
  });
  vm.runInContext(source, context);
  context.ready = () => true;
  context.renderConnection = () => {};
  context.renderUsage = () => {};
  context.refreshAuth = async () => {};
  if (realResult) context.renderRecommendation = () => {};
  else context.showResult = async () => {
    $('result').hidden = false; $('composer').hidden = true; $('intake-review').close(); return true;
  };
  $('source').value = 'chatgpt'; $('model').value = 'gpt-5.5';
  const calls = [];
  context.request = async (path, body) => {
    if (path === '/api/intake/questions') return { questions };
    if (path === '/api/catalog') return catalog;
    if (path === '/api/config') return {};
    calls.push({ path, body }); return path === '/api/intake' ? draft() : structuredClone(sampleResult);
  };
  $('result').hidden = true;
  await context.init();
  return {
    $, context, calls, document, tools,
    prepare: (input, options) => context.prepareTask(input, options),
    recommend: () => context.recommendTask(),
    fields: () => $('intake-fields').querySelectorAll('textarea'),
    state: () => vm.runInContext('({ intakeAnswers, intakeTask, busy, busyStage, advanceStage, advancePaused })', context),
    editTask(input) { $('task').value = input; $('task').listeners.input(); },
    event(id, name = 'click') { $(id).listeners[name]({ preventDefault() {} }); },
    async advance(milliseconds) {
      const end = time + milliseconds;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        time = next[1].at; timers.delete(next[0]); next[1].callback();
      }
      time = end;
      await setImmediate();
    }
  };
}

test('the recommendation overlays the task with its recommended reference, including exact matches', async context => {
  const recommended = catalog.approaches.find(approach => approach.id === 'playbooks');
  for (const profileId of ['goal', 'playbooks']) await context.test(profileId, async () => {
    const app = await ui();
    const profileSource = catalog.approaches.find(approach => approach.id === profileId);
    const data = structuredClone(sampleResult);
    data.profile = catalog.dimensions.map(({ id }) => ({ id, ...profileSource.ratings[id] }));
    const nearest = closestProfiles(catalog.dimensions, catalog.approaches, data.profile);
    assert.equal(nearest[0].approach.id, profileId);

    app.context.renderRecommendation(data);

    const custom = {
      label: 'Your task’s suggested process',
      scores: Object.fromEntries(data.profile.map(({ id, score }) => [id, score])),
      color: '#16834b'
    };
    const reference = approach => ({
      label: approach.title + ' · reference',
      scores: Object.fromEntries(catalog.dimensions.map(({ id }) => [id, approach.ratings[id].score])),
      color: '#315ce8', dashed: true
    });
    const top = app.$('chart').children[0].radar;
    assert.deepEqual(top.dimensions, catalog.dimensions);
    assert.deepEqual(top.series, [custom, reference(recommended)]);
    assert.equal(app.$('result-title').textContent, recommended.title);

    const comparisons = app.$('similar-charts').children;
    assert.equal(comparisons.length, 3);
    comparisons.forEach((card, index) => {
      const chart = card.querySelectorAll('svg')[0].radar;
      assert.deepEqual(chart.series, [custom, reference(nearest[index].approach)]);
    });
  });
});

test('the UI opens editable answers and starts scoring exactly once after seven seconds', async () => {
  const app = await ui();
  const response = await app.prepare(task);
  assert.equal(response.reviewRequired, true);
  assert.deepEqual(app.calls.map(call => call.path), ['/api/intake']);
  assert.equal(app.$('intake-review').open, true);
  assert.equal(app.$('intake-title').focused, true);
  assert.equal(app.fields().length, 9);
  assert.ok(app.fields().every(input => input.maxLength === 600));
  assert.equal(app.$('result').hidden, true);
  assert.equal(app.state().busy, false);
  assert.equal(app.$('recommend').textContent, 'See my scores in 7s');
  await app.advance(6999);
  assert.equal(app.calls.length, 1);
  await app.advance(1);
  assert.deepEqual(app.calls.map(call => call.path), ['/api/intake', '/api/recommend']);
  assert.ok(app.calls[1].body.intake.answers.every((answer, index) => answer.status === draft().answers[index].status));
  assert.equal(app.$('intake-review').open, false);
  assert.equal(app.$('result').hidden, false);
  await app.advance(60000);
  assert.equal(app.calls.length, 2);
});

test('continuing preserves guesses as inferred and snapshots the selected source and model', async () => {
  const app = await ui();
  await app.prepare(task);
  app.$('model').value = 'another-model';
  await app.recommend();
  assert.equal(app.calls.length, 2);
  assert.equal(app.calls[1].path, '/api/recommend');
  assert.equal(app.calls[1].body.model, 'another-model');
  assert.equal(app.calls[1].body.intake.answers[1].status, 'inferred');
  assert.equal(app.calls[1].body.intake.answers[1].answer, draft().answers[1].answer);
  assert.equal(app.calls[1].body.intake.answers[1].evidence, draft().answers[1].evidence);
  assert.equal(app.calls[1].body.intake.answers[0].status, 'stated');
  assert.equal(app.calls[1].body.intake.answers[0].evidence, 'The user said so.');
  assert.equal(app.$('result').hidden, false);
  app.$('source').value = 'endpoint';
  await app.recommend();
  assert.equal(app.calls[2].body.source, 'endpoint');
  assert.equal('model' in app.calls[2].body, false);
  assert.equal(app.calls.filter(call => call.path === '/api/intake').length, 1);
});

test('all nine compact answers retain their labels, values, and accessible descriptions', async () => {
  const app = await ui();
  await app.prepare(task);
  const fields = app.$('intake-fields').children;
  assert.equal(fields.length, questions.length);
  fields.forEach((field, index) => {
    const [input] = field.querySelectorAll('textarea');
    const [label] = field.querySelectorAll('label');
    const descriptions = input['aria-describedby'].split(' ').map(id => field.children.find(child => child.id === id));
    assert.equal(input.rows, 1);
    assert.equal(input.value, draft().answers[index].answer);
    assert.equal(label.htmlFor, input.id);
    assert.equal(label.textContent, questions[index].label);
    assert.equal(descriptions[0].textContent, questions[index].question);
    assert.equal(descriptions[1].textContent, draft().answers[index].evidence || questions[index].hint);
    assert.equal(field.querySelectorAll('span')[0].textContent, index ? 'Best guess' : 'Stated');
  });
});

test('editing answers clears inference evidence and hides stale scores without another intake call', async () => {
  const app = await ui();
  await app.prepare(task);
  await app.recommend();
  app.event('review-answers');
  const input = app.fields()[0]; input.value = 'I am new to this domain.'; input.listeners.input();
  const answer = app.state().intakeAnswers[0];
  assert.equal(answer.answer, input.value);
  assert.equal(answer.status, 'edited');
  assert.equal(answer.evidence, '');
  assert.equal(app.$('result').hidden, true);
  const field = app.$('intake-fields').children[0];
  assert.equal(field.querySelectorAll('span')[0].textContent, 'Your edit');
  assert.equal(field.children.find(child => child.id === 'intake-help-expertise').textContent, questions[0].hint);
  assert.equal(app.$('recommend').textContent, 'See my scores · paused');
  await app.advance(60000);
  assert.equal(app.calls.length, 2);
  await app.recommend();
  assert.equal(app.calls.length, 3);
  assert.equal(app.calls[2].body.intake.answers[0].answer, input.value);
  assert.equal(app.calls[2].body.intake.answers[0].status, 'edited');
  assert.equal(app.calls[2].body.intake.answers[0].evidence, '');
});

test('editing the task invalidates the review and requires new intake before scoring', async () => {
  const app = await ui();
  await app.prepare(task);
  app.editTask(`${task} It will handle private customer data.`);
  assert.equal(app.state().intakeAnswers, null);
  assert.equal(app.$('intake-review').open, false);
  assert.equal(app.$('result').hidden, true);
  await assert.rejects(app.recommend(), /Check your task/);
  assert.equal(app.calls.length, 1);
  await app.advance(60000);
  assert.equal(app.calls.length, 1);
  await app.prepare(app.$('task').value);
  assert.equal(app.calls.length, 2);
});

test('a stale field blur after task invalidation leaves the discarded review alone', async () => {
  const app = await ui();
  await app.prepare(task);
  const input = app.fields()[0];
  input.value = ''; input.listeners.input();
  app.editTask(`${task} It will handle private customer data.`);
  assert.doesNotThrow(() => input.listeners.blur());
  assert.equal(app.state().intakeAnswers, null);
  assert.equal(app.$('intake-review').open, false);
  assert.equal(input.value, '');
  await app.advance(60000);
  assert.equal(app.calls.length, 1);
});

test('manual scoring restores a cleared answer visibly as an inferred guess and clears stale completion status', async () => {
  const app = await ui();
  await app.prepare(task);
  await app.recommend();
  assert.match(app.$('status').textContent, /All seven scores/);
  const input = app.fields()[0]; input.value = '   '; input.listeners.input();
  assert.equal(app.$('status').textContent, '');
  await app.recommend();
  const answer = app.calls.at(-1).body.intake.answers[0];
  assert.equal(answer.answer, draft().answers[0].answer);
  assert.equal(answer.status, 'inferred');
  assert.equal(answer.evidence, 'Default assumption; please edit if it does not fit.');
  assert.equal(input.value, answer.answer);
  assert.equal(app.$('intake-status-expertise').textContent, 'Best guess');
  assert.equal(app.calls.filter(call => call.path === '/api/intake').length, 1);
});

test('blurring a cleared field restores its original model guess without altering other edits or resuming scoring', async () => {
  const app = await ui();
  await app.prepare(task);
  const [expertise, audience] = app.fields();
  audience.value = 'I am building for experienced Go players.'; audience.listeners.input();
  expertise.value = 'My temporary edit'; expertise.listeners.input();
  expertise.value = ''; expertise.listeners.input();
  assert.equal(expertise.value, '');
  assert.equal(app.fields()[0], expertise);
  expertise.listeners.blur();
  assert.equal(expertise.value, draft().answers[0].answer);
  assert.equal(app.state().intakeAnswers[0].status, 'inferred');
  assert.equal(app.$('intake-status-expertise').textContent, 'Best guess');
  assert.equal(audience.value, 'I am building for experienced Go players.');
  assert.equal(app.state().intakeAnswers[1].status, 'edited');
  assert.equal(app.fields()[1], audience);
  assert.equal(app.$('recommend').textContent, 'See my scores · paused');
  await app.advance(60000);
  assert.equal(app.calls.length, 1);
  await app.recommend();
  assert.equal(app.calls[1].body.intake.answers[0].answer, expertise.value);
  assert.equal(app.calls[1].body.intake.answers[1].answer, audience.value);
  assert.equal(app.calls[1].body.intake.answers[1].status, 'edited');
});

test('blurring a nonempty edit keeps its text and provenance', async () => {
  const app = await ui();
  await app.prepare(task);
  const input = app.fields()[1];
  input.value = '  My answer  '; input.listeners.input(); input.listeners.blur();
  assert.equal(input.value, '  My answer  ');
  assert.equal(app.state().intakeAnswers[1].answer, input.value);
  assert.equal(app.state().intakeAnswers[1].status, 'edited');
  assert.equal(app.state().intakeAnswers[1].evidence, '');
});

test('a cleared answer uses its question default when the original guess is unavailable', async () => {
  const app = await ui();
  await app.prepare(task);
  vm.runInContext('intakeGuesses.delete("expertise")', app.context);
  const input = app.fields()[0];
  input.value = ''; input.listeners.input(); input.listeners.blur();
  assert.equal(input.value, questions[0].defaultAnswer);
  assert.equal(app.state().intakeAnswers[0].answer, questions[0].defaultAnswer);
  assert.equal(app.state().intakeAnswers[0].status, 'inferred');
  assert.equal(app.calls.length, 1);
});

test('a scoring failure preserves edited answers and retries only scoring', async () => {
  const app = await ui();
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
  assert.equal(app.$('intake-review').open, true);
  assert.equal(app.fields()[0].value, 'Domain beginner');
  assert.equal(app.$('recommend').textContent, 'See my scores · paused');
  await app.advance(60000);
  assert.equal(app.calls.length, 2);
  await app.recommend();
  assert.equal(app.$('review-error').textContent, '');
  assert.deepEqual(app.calls.map(call => call.path), ['/api/intake', '/api/recommend', '/api/recommend']);
  assert.equal(app.calls[2].body.intake.answers[0].status, 'edited');
});

test('double-clicks never send a second request and intake failures can be retried', async () => {
  const app = await ui();
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

test('a new task from the browser tool clears the previous result and restores the composer even when intake fails', async () => {
  const app = await ui({ realResult: true });
  await app.tools[0].execute({ task });
  await app.recommend();
  assert.equal(app.$('composer').hidden, true);
  app.context.request = async () => { throw new Error('Unavailable'); };
  await assert.rejects(app.tools[0].execute({ task: 'A different software project for a hospital.' }), /Unavailable/);
  assert.equal(app.state().intakeAnswers, null);
  assert.equal(app.$('intake-review').open, false);
  assert.equal(app.$('composer').hidden, false);
  assert.equal(app.$('result').hidden, true);
  await app.advance(60000);
  assert.equal(app.$('result').hidden, true);
});

test('the browser tool opens a paused review and exposes no recommendation tool', async () => {
  const app = await ui();
  assert.deepEqual(app.tools.map(tool => tool.name), ['prepare_process']);
  const response = await app.tools[0].execute({ task });
  assert.equal(response.reviewRequired, true);
  assert.equal(app.$('intake-review').open, true);
  assert.equal(app.$('recommend').textContent, 'See my scores · paused');
  await app.advance(60000);
  assert.deepEqual(app.calls.map(call => call.path), ['/api/intake']);
  app.event('intake-form', 'submit');
  await app.advance(0);
  assert.deepEqual(app.calls.map(call => call.path), ['/api/intake', '/api/recommend']);
});

test('Pause freezes the countdown and Resume continues its remaining time', async () => {
  const app = await ui();
  await app.prepare(task);
  await app.advance(2000);
  app.event('pause-review');
  assert.equal(app.$('pause-review').textContent, 'Resume');
  await app.advance(60000);
  assert.equal(app.calls.length, 1);
  app.event('pause-review');
  assert.equal(app.$('recommend').textContent, 'See my scores in 5s');
  await app.advance(4999);
  assert.equal(app.calls.length, 1);
  await app.advance(1);
  assert.equal(app.calls.length, 2);
});

test('reading or editing an answer pauses automatic scoring', async context => {
  for (const event of ['focusin', 'wheel', 'touchstart', 'input']) await context.test(event, async () => {
    const app = await ui();
    await app.prepare(task);
    await app.advance(1000);
    if (event === 'input') {
      const input = app.fields()[0]; input.value = 'I am a beginner.'; input.listeners.input();
      assert.equal(app.state().intakeAnswers[0].status, 'edited');
      assert.equal(app.state().intakeAnswers[0].evidence, '');
    } else app.event('intake-fields', event);
    assert.equal(app.$('recommend').textContent, 'See my scores · paused');
    await app.advance(60000);
    assert.deepEqual(app.calls.map(call => call.path), ['/api/intake']);
  });
});

test('closing or escaping the review pauses it, and reopening requires continuation', async context => {
  for (const viaEscape of [false, true]) await context.test(viaEscape ? 'Escape' : 'Close', async () => {
    const app = await ui();
    await app.prepare(task);
    if (viaEscape) app.event('intake-review', 'cancel');
    else app.event('close-review');
    assert.equal(app.$('intake-review').open, false);
    await app.advance(60000);
    assert.equal(app.calls.length, 1);
    app.event('task-form', 'submit');
    assert.equal(app.$('intake-review').open, true);
    assert.equal(app.$('recommend').textContent, 'See my scores · paused');
    await app.advance(60000);
    assert.equal(app.calls.length, 1);
  });
});

test('hiding the page pauses it and returning never silently resumes scoring', async () => {
  const app = await ui();
  await app.prepare(task);
  app.document.hidden = true;
  app.document.listeners.visibilitychange();
  await app.advance(60000);
  assert.equal(app.calls.length, 1);
  app.document.hidden = false;
  app.document.listeners.visibilitychange();
  assert.equal(app.$('recommend').textContent, 'See my scores · paused');
  await app.advance(60000);
  assert.equal(app.calls.length, 1);
});

test('a countdown completing before the hidden event is handled still cannot score', async () => {
  const app = await ui();
  await app.prepare(task);
  await app.advance(6999);
  app.document.hidden = true;
  await app.advance(1);
  assert.equal(app.calls.length, 1);
  assert.equal(app.$('recommend').textContent, 'See my scores · paused');
  app.document.hidden = false;
  await app.advance(60000);
  assert.equal(app.calls.length, 1);
});

test('manual Continue cancels the timer and repeated submits send only one scoring request', async () => {
  const app = await ui();
  await app.prepare(task);
  await app.advance(6999);
  let resolve;
  app.context.request = async (path, body) => {
    app.calls.push({ path, body });
    return new Promise(done => { resolve = done; });
  };
  app.event('intake-form', 'submit');
  app.event('intake-form', 'submit');
  await app.advance(60000);
  assert.equal(app.calls.length, 2);
  assert.equal(app.state().busy, true);
  resolve({});
  await app.advance(0);
  assert.equal(app.state().busy, false);
  await app.advance(60000);
  assert.equal(app.calls.length, 2);
});

test('an automatic scoring failure leaves the review paused for an explicit retry', async () => {
  const app = await ui();
  await app.prepare(task);
  app.context.request = async (path, body) => {
    app.calls.push({ path, body });
    throw new Error('Temporary failure');
  };
  await app.advance(7000);
  assert.equal(app.$('review-error').textContent, 'Temporary failure');
  assert.equal(app.$('intake-review').open, true);
  assert.equal(app.$('recommend').textContent, 'See my scores · paused');
  assert.equal(app.state().busy, false);
  await app.advance(60000);
  assert.deepEqual(app.calls.map(call => call.path), ['/api/intake', '/api/recommend']);
});

test('a failed rerun after reviewing completed results restores the composer when the dialog closes', async () => {
  const app = await ui({ realResult: true });
  await app.prepare(task);
  await app.recommend();
  assert.equal(app.$('composer').hidden, true);
  assert.equal(app.$('result').hidden, false);
  app.event('review-answers');
  app.context.request = async (path, body) => { app.calls.push({ path, body }); throw new Error('Try again'); };
  await assert.rejects(app.recommend(), /Try again/);
  assert.equal(app.$('composer').hidden, false);
  assert.equal(app.$('result').hidden, true);
  app.event('close-review');
  assert.equal(app.$('intake-review').open, false);
  assert.equal(app.$('composer').hidden, false);
  await app.advance(60000);
  assert.equal(app.calls.length, 3);
});

test('completed scores get their own seven-second approach transition, with paused Back navigation', async () => {
  const app = await ui({ realResult: true });
  await app.prepare(task);
  await app.recommend();
  assert.equal(app.$('intake-review').open, false);
  assert.equal(app.$('composer').hidden, true);
  assert.equal(app.$('scores').children.length, 7);
  assert.equal(app.$('reveal-count').textContent, '7 of 7 dimensions');
  assert.equal(app.$('show-all').hidden, true);
  assert.equal(app.$('score-stage').hidden, false);
  assert.equal(app.$('approach-stage').hidden, true);
  assert.equal(app.$('profile-title').focused, true);
  assert.equal(app.$('result')['aria-labelledby'], 'profile-title');
  assert.equal(app.$('show-process').textContent, 'See my approach in 7s');
  await app.advance(6999);
  assert.equal(app.$('approach-stage').hidden, true);
  await app.advance(1);
  assert.equal(app.$('score-stage').hidden, true);
  assert.equal(app.$('approach-stage').hidden, false);
  assert.equal(app.$('result-title').focused, true);
  assert.equal(app.$('result')['aria-labelledby'], 'result-title');
  app.event('back-scores');
  assert.equal(app.$('score-stage').hidden, false);
  assert.equal(app.$('approach-stage').hidden, true);
  assert.equal(app.$('show-process').textContent, 'See my approach · paused');
  await app.advance(60000);
  assert.equal(app.$('approach-stage').hidden, true);
  app.event('show-process');
  assert.equal(app.$('approach-stage').hidden, false);
  assert.deepEqual(app.calls.map(call => call.path), ['/api/intake', '/api/recommend']);
});
