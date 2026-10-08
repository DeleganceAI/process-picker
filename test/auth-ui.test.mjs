import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace(/init\(\)\.catch\(showError\);\s*$/, '');

function ui() {
  const elements = new Map();
  const element = () => ({
    value: '', textContent: '', className: '', children: [],
    replaceChildren(...children) { this.children = children; this.value = ''; },
    append(...children) { this.children.push(...children); },
    get firstChild() { return this.children[0]; },
    showModal() { this.open = true; }
  });
  const $ = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const context = vm.createContext({ document: { getElementById: $, createElement: element } });
  vm.runInContext(source, context);
  context.renderConnection = () => {};
  context.showError = error => { $('status').className = 'error'; $('status').textContent = error.message; };
  const paths = [];
  return {
    $, paths,
    async refresh(session, models) {
      context.request = async path => {
        paths.push(path);
        const result = path === '/api/auth/session' ? session : models;
        if (result instanceof Error) throw result;
        return result;
      };
      await context.refreshAuth();
    },
    state: () => vm.runInContext('({ session, authBusy, authFailed })', context)
  };
}

const signedIn = { signedIn: true, planEnabled: true, accounts: [{ id: 'one', label: 'Account' }], account: { id: 'one' } };
const models = { models: [{ id: 'gpt-5.5', name: 'GPT-5.5' }] };

test('model-list failure explains successful sign-in and retry clears the stale error', async () => {
  const app = ui();
  await app.refresh(signedIn, new Error('The ChatGPT response was too large.'));
  assert.match(app.$('status').textContent, /signed in, but the available models could not be loaded/);
  assert.match(app.$('status').textContent, /response was too large.*Retry connection/);
  assert.equal(app.state().session, signedIn);
  assert.equal(app.state().authFailed, true);
  assert.equal(app.$('model').value, '');
  await app.refresh(signedIn, models);
  assert.equal(app.$('model').value, 'gpt-5.5');
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
  await app.refresh(signedIn, { models: [{ id: 'another-model', name: 'Another model' }] });
  assert.equal(app.$('model').value, '');
  assert.match(app.$('status').textContent, /GPT-5.5 is not available.*Choose an available model/);
  assert.equal(app.$('status').className, '');
  assert.equal(app.state().authFailed, false);
  assert.deepEqual(app.paths, ['/api/auth/session', '/api/auth/models']);
});
