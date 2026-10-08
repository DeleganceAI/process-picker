import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace(/init\(\)\.catch\(showError\);\s*$/, '');

const draftKey = 'process-radar:auth-draft';

function ui({ storage = new Map(), storageError = false, href = 'http://localhost:4321/' } = {}) {
  const elements = new Map();
  const element = () => ({
    value: '', textContent: '', className: '', children: [],
    replaceChildren(...children) { this.children = children; this.value = ''; },
    append(...children) { this.children.push(...children); },
    get firstChild() { return this.children[0]; },
    showModal() { this.open = true; },
    addEventListener() {}
  });
  const $ = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const pages = new Map(), redirects = [], history = [], storageCalls = [], requests = [], paths = [];
  const responses = new Map([
    ['/api/catalog', {}], ['/api/config', {}], ['/api/intake/questions', { questions: [] }],
    ['/api/auth/session', { signedIn: false }], ['/api/auth/models', models],
    ['/api/auth/login', { url: 'https://auth.openai.com/authorize?state=test' }]
  ]);
  const context = vm.createContext({
    URL,
    document: { getElementById: $, createElement: element, addEventListener() {} },
    window: {
      location: { href, assign(url) { redirects.push(url); } },
      history: { replaceState(_state, _title, url) { history.push(url); } },
      addEventListener(type, listener) {
        if (!pages.has(type)) pages.set(type, []);
        pages.get(type).push(listener);
      }
    },
    sessionStorage: Object.fromEntries(['getItem', 'setItem', 'removeItem'].map(method => [method, (key, value) => {
      storageCalls.push({ method, key, value });
      if (storageError) throw new Error('Storage unavailable.');
      if (method === 'getItem') return storage.get(key) ?? null;
      if (method === 'setItem') storage.set(key, value);
      else storage.delete(key);
    }]))
  });
  context.window.sessionStorage = context.sessionStorage;
  vm.runInContext(source, context);
  context.renderConnection = () => {};
  context.showError = error => { $('status').className = 'error'; $('status').textContent = error.message; };
  context.request = async (path, body) => {
    paths.push(path);
    requests.push({ path, body, task: $('task').value });
    const result = responses.get(path);
    if (result instanceof Error) throw result;
    assert.notEqual(result, undefined, `Unexpected request: ${path}`);
    return typeof result === 'function' ? result(body) : result;
  };
  return {
    $, paths, requests, redirects, history, storage, storageCalls,
    respond: (path, result) => responses.set(path, result),
    async refresh(session, availableModels = models) {
      responses.set('/api/auth/session', session);
      responses.set('/api/auth/models', availableModels);
      await context.refreshAuth();
    },
    init: () => context.init(),
    login: accountId => context.login(accountId),
    saveDraft: () => context.saveAuthDraft(),
    restoreDraft: () => context.restoreAuthDraft(),
    async pageshow(persisted) {
      for (const listener of pages.get('pageshow') || []) listener({ persisted });
      await new Promise(setImmediate);
    },
    state: () => vm.runInContext('({ session, authBusy, authFailed })', context)
  };
}

const signedIn = { signedIn: true, planEnabled: true, accounts: [{ id: 'one', label: 'Account' }], account: { id: 'one' } };
const models = { models: [{ id: 'gpt-6-luna', name: 'GPT-6 Luna' }] };

test('model-list failure explains successful sign-in and retry clears the stale error', async () => {
  const app = ui();
  await app.refresh(signedIn, new Error('The ChatGPT response was too large.'));
  assert.match(app.$('status').textContent, /signed in, but the available models could not be loaded/);
  assert.match(app.$('status').textContent, /response was too large.*Retry connection/);
  assert.equal(app.state().session, signedIn);
  assert.equal(app.state().authFailed, true);
  assert.equal(app.$('model').value, '');
  await app.refresh(signedIn, models);
  assert.equal(app.$('model').value, 'gpt-6-luna');
  assert.equal(app.$('status').textContent, '');
  assert.equal(app.$('status').className, '');
  assert.equal(app.state().authFailed, false);
  assert.equal(app.state().authBusy, false);
  assert.deepEqual(app.paths, ['/api/auth/session', '/api/auth/models', '/api/auth/session', '/api/auth/models']);
});

test('failed session refresh discards previously successful sign-in and model selection', async () => {
  const app = ui();
  await app.refresh(signedIn, models);
  await app.refresh(new Error('Server unavailable.'));
  assert.equal(app.state().session, null);
  assert.equal(app.$('model').value, '');
  assert.equal(app.$('account-options').hidden, true);
  assert.equal(app.state().authFailed, true);
  assert.match(app.$('status').textContent, /Could not check your sign-in.*Server unavailable.*Retry connection/);
});

test('an unavailable preferred model requires an explicit choice without inference', async () => {
  const app = ui();
  await app.refresh(signedIn, { models: [{ id: 'gpt-5.5', name: 'GPT-5.5' }, { id: 'another-model', name: 'Another model' }] });
  assert.equal(app.$('model').value, '');
  assert.match(app.$('status').textContent, /GPT-6 Luna is not available.*Choose an available model/);
  assert.equal(app.$('status').className, '');
  assert.equal(app.state().authFailed, false);
  assert.deepEqual(app.paths, ['/api/auth/session', '/api/auth/models']);
});

test('GPT-6 Luna is preferred even when another model appears first', async () => {
  const app = ui();
  await app.refresh(signedIn, { models: [{ id: 'gpt-5.5', name: 'GPT-5.5' }, ...models.models] });
  assert.equal(app.$('model').value, 'gpt-6-luna');
  assert.equal(app.$('status').textContent, '');
  assert.deepEqual(app.paths, ['/api/auth/session', '/api/auth/models']);
});

test('login saves the raw draft immediately before redirect without sending it to auth', async () => {
  const app = ui();
  await app.refresh({ signedIn: false });
  app.$('task').value = '  A task with\n  deliberate whitespace.  ';
  app.respond('/api/auth/login', body => {
    assert.equal(body.accountId, 'one');
    assert.deepEqual(Object.keys(body), ['accountId']);
    assert.equal(app.storageCalls.length, 0);
    app.$('task').value += '\nTyped while sign-in loaded.';
    return { url: 'https://auth.openai.com/authorize?state=test' };
  });
  await app.login('one');
  assert.equal(app.storage.get(draftKey), app.$('task').value);
  assert.deepEqual(app.storageCalls, [{ method: 'setItem', key: draftKey, value: app.$('task').value }]);
  assert.deepEqual(app.redirects, ['https://auth.openai.com/authorize?state=test']);
  assert.equal(app.state().authBusy, true);
});

for (const outcome of ['success', 'error']) {
  test(`fresh init restores the draft before requests after sign-in ${outcome}, without inference`, async () => {
    const draft = '  Restore my task exactly.\nIncluding this line.  ';
    const app = ui({ storage: new Map([[draftKey, draft]]), href: `http://localhost:4321/?signin=${outcome}#task` });
    app.respond('/api/auth/session', outcome === 'success' ? signedIn : { signedIn: false });
    await app.init();
    assert.equal(app.$('task').value, draft);
    assert.equal(app.storage.has(draftKey), false);
    assert.ok(app.requests.every(request => request.task === draft));
    assert.deepEqual(app.paths, ['/api/catalog', '/api/config', '/api/intake/questions', '/api/auth/session',
      ...(outcome === 'success' ? ['/api/auth/models'] : [])]);
    assert.deepEqual(app.history, ['/#task']);
    if (outcome === 'error') assert.match(app.$('status').textContent, /Sign-in was not completed/);
  });
}

test('draft restoration is single-use and does not overwrite an existing task', () => {
  const app = ui({ storage: new Map([[draftKey, 'Saved draft']]) });
  app.$('task').value = 'Browser-restored or newly edited task';
  app.restoreDraft();
  assert.equal(app.$('task').value, 'Browser-restored or newly edited task');
  assert.equal(app.storage.has(draftKey), false);
  app.$('task').value = '';
  app.restoreDraft();
  assert.equal(app.$('task').value, '');
});

test('saving an empty task clears a stale auth draft', () => {
  const app = ui({ storage: new Map([[draftKey, 'Stale draft']]) });
  app.saveDraft();
  assert.equal(app.storage.has(draftKey), false);
});

test('restoration discards oversized drafts and tolerates unavailable storage', () => {
  const app = ui({ storage: new Map([[draftKey, 'x'.repeat(8001)]]) });
  app.restoreDraft();
  assert.equal(app.$('task').value, '');
  assert.equal(app.storage.has(draftKey), false);
  assert.doesNotThrow(() => ui({ storageError: true }).restoreDraft());
});

test('storage failure blocks redirect with a nonempty task, but an empty task can sign in', async () => {
  for (const draft of ['Keep this task safe.', '']) {
    const app = ui({ storageError: true });
    await app.refresh({ signedIn: false });
    app.$('task').value = draft;
    await app.login('one');
    assert.equal(app.$('task').value, draft);
    if (draft) {
      assert.deepEqual(app.redirects, []);
      assert.equal(app.state().authBusy, false);
      assert.match(app.$('status').textContent, /task|draft/i);
      assert.equal(app.$('status').className, 'error');
    } else assert.deepEqual(app.redirects, ['https://auth.openai.com/authorize?state=test']);
  }
});

test('invalid sign-in URLs and failed login requests never save or redirect', async () => {
  for (const result of [
    { url: 'https://example.com/authorize' },
    { url: 'https://user:password@auth.openai.com/authorize' },
    { url: 'not a URL' },
    new Error('Login unavailable.')
  ]) {
    const app = ui();
    await app.refresh({ signedIn: false });
    app.$('task').value = 'Keep my draft.';
    app.respond('/api/auth/login', result);
    await app.login();
    assert.deepEqual(app.storageCalls, []);
    assert.deepEqual(app.redirects, []);
    assert.equal(app.state().authBusy, false);
    assert.equal(app.$('status').className, 'error');
  }
});

test('back navigation from sign-in restores the draft and refreshes auth to unlock the page', async () => {
  const app = ui();
  await app.init();
  app.$('task').value = 'Return to my unfinished task.';
  await app.login();
  assert.equal(app.state().authBusy, true);
  const requestsBeforeReturn = app.paths.length;
  await app.pageshow(false);
  assert.equal(app.paths.length, requestsBeforeReturn);
  app.$('task').value = '';
  await app.pageshow(true);
  assert.equal(app.$('task').value, 'Return to my unfinished task.');
  assert.equal(app.storage.has(draftKey), false);
  assert.equal(app.state().authBusy, false);
  assert.deepEqual(app.paths.slice(requestsBeforeReturn), ['/api/auth/session']);
});
