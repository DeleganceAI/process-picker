import { radar } from './radar.js';
import { revealScores } from './reveal.mjs';
import { usageNotice } from './usage.mjs';

const $ = id => document.getElementById(id);
const make = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
let catalog, config, session, activeReveal, activeRequest, busy = false, authBusy = true, authFailed = false;

async function request(path, body, signal) {
  const response = await fetch(path, body === undefined ? { signal } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('The local server could not be reached. Try again.'); }
  if (!response.ok) {
    const error = new Error(data.error || 'The request could not be completed.');
    error.code = data.code; error.status = response.status;
    throw error;
  }
  return data;
}

function ready() {
  if (!catalog || busy || authBusy) return false;
  return $('source').value === 'endpoint' ? config?.configured :
    session?.signedIn && session.planEnabled && !session.needsWelcome && Boolean($('model').value);
}

function renderUsage() {
  const source = $('source').value;
  const model = source === 'endpoint' ? config?.model : $('model').selectedOptions[0]?.value ? $('model').selectedOptions[0].textContent : null;
  $('usage-notice').hidden = !model;
  if (!model) return;
  const notice = usageNotice({ ...config?.usage, task: $('task').value, source, model });
  $('usage-summary').textContent = notice.summary;
  $('usage-detail').textContent = notice.detail;
}

function renderConnection() {
  const chatgpt = $('source').value === 'chatgpt';
  const hasPlan = session?.signedIn && session.planEnabled;
  const locked = busy || authBusy;
  $('chatgpt-settings').hidden = !chatgpt;
  $('endpoint-settings').hidden = chatgpt;
  $('login').hidden = !chatgpt || hasPlan;
  $('plan-controls').hidden = !chatgpt || !hasPlan;
  $('retry-auth').hidden = !chatgpt || !authFailed;
  $('logout').hidden = !session?.signedIn;
  for (const id of ['source', 'account', 'account-login', 'login', 'logout', 'retry-auth']) $(id).disabled = locked || !catalog;
  $('model').disabled = locked || !hasPlan || $('model').options.length < 2;
  $('analyze').disabled = !ready();
  $('analyze').textContent = busy ? activeReveal ? 'Revealing scores…' : 'Thinking…' : 'Find my approach';
  $('account-status').textContent = authBusy ? 'Checking sign-in…' : session?.signedIn ?
    `${session.account?.label || 'Signed in'}${hasPlan ? '' : ' · ChatGPT plan access was not enabled.'}` : 'Sign in to use your ChatGPT plan.';
  $('connection').textContent = config?.configured ? `Connected to ${config.model}` : 'No API / local model connected yet';
  $('privacy').textContent = chatgpt ? hasPlan ?
    'Sent to OpenAI using your ChatGPT plan when you submit. Not saved by this app; provider retention may apply.' :
    'Sign in to use your ChatGPT plan, or choose an API / local model in Setup. Tasks are not saved by this app.' :
    config?.configured ? `Sent to ${config.endpoint} when you submit. Uses the configured endpoint’s credentials, not your ChatGPT plan. Not saved by this app; provider retention may apply.` :
    'Configure an API / local model in Setup before submitting. Tasks are not saved by this app.';
  renderUsage();
}

async function refreshAuth() {
  authBusy = true; authFailed = false; renderConnection();
  $('model').replaceChildren(make('option', 'Choose a model'));
  $('model').firstChild.value = '';
  try {
    session = await request('/api/auth/session');
    const accounts = session.accounts || [];
    $('account').replaceChildren(...accounts.map(account => {
      const option = make('option', account.label); option.value = account.id; return option;
    }));
    const add = make('option', 'Add another account'); add.value = ''; $('account').append(add);
    $('account').value = session.account?.id || accounts[0]?.id || '';
    $('account-options').hidden = accounts.length === 0;
    if (session.signedIn && session.planEnabled) {
      const { models } = await request('/api/auth/models');
      for (const model of models) {
        const option = make('option', model.name); option.value = model.id; $('model').append(option);
      }
      if (models.some(model => model.id === 'gpt-5.5')) $('model').value = 'gpt-5.5';
      if (!models.length) throw new Error('No models are available for this ChatGPT account. Check your plan access or try again.');
      if (!$('model').value) {
        $('status').className = '';
        $('status').textContent = 'GPT-5.5 is not available for this account. Choose an available model to continue.';
      }
    }
    if (session.authError) showError(new Error(session.authError));
  } catch (error) {
    authFailed = true; showError(error);
  } finally {
    authBusy = false; renderConnection();
    if (session?.signedIn && session.planEnabled && session.needsWelcome && !$('welcome').open) $('welcome').showModal();
  }
}

async function login(accountId = $('account').value) {
  if (busy || authBusy) return;
  authBusy = true; renderConnection();
  try {
    const { url } = await request('/api/auth/login', {
      ...(accountId ? { accountId } : {}),
      ...(session?.signedIn && !session.planEnabled && accountId === session.account?.id ? { enablePlan: true } : {})
    });
    const target = new URL(url);
    if (target.origin !== 'https://auth.openai.com' || target.username || target.password) throw new Error('The sign-in URL was not recognized.');
    window.location.assign(target.href);
  } catch (error) {
    authBusy = false; renderConnection(); showError(error);
  }
}

async function dismissWelcome() {
  $('welcome-dismiss').disabled = true; $('welcome-error').textContent = '';
  try {
    await request('/api/auth/welcome', {});
    session.needsWelcome = false; $('welcome').close(); renderConnection();
  } catch (error) {
    $('welcome-error').textContent = error.message;
  } finally { $('welcome-dismiss').disabled = false; }
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = make('a'); link.href = url; link.download = name; link.hidden = true;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function list(title, items, ordered = false) {
  const wrap = make('div'); wrap.append(make('h3', title));
  const ul = make(ordered ? 'ol' : 'ul'); items.forEach(item => ul.append(make('li', item))); wrap.append(ul); return wrap;
}
function renderRecommendation(data) {
  const approach = catalog.approaches.find(a => a.id === data.recommendedApproach);
  $('result-title').textContent = approach.title;
  $('reason').textContent = data.reason;
  $('steps').replaceChildren(list('How to get started', data.steps, true));
  $('chart').replaceChildren(radar(catalog.dimensions, [
    { label: 'Your suggested process', scores: Object.fromEntries(data.profile.map(p => [p.id, p.score])), color: '#16834b' },
    { label: approach.title + ' · reference', scores: Object.fromEntries(catalog.dimensions.map(d => [d.id, approach.ratings[d.id].score])), color: '#315ce8', dashed: true }
  ], 'Your suggested process compared with ' + approach.title));

  const details = $('reasoning-content'); details.replaceChildren(); $('reasoning').open = false;
  details.append(make('h3', 'The task'), make('p', data.summary), make('h3', 'The tradeoff'), make('p', data.tradeoff));
  if (data.assumptions.length) details.append(list('Assumptions to check', data.assumptions));
  if (data.questions.length) details.append(list('Questions to resolve', data.questions));
  const alt = catalog.approaches.find(a => a.id === data.alternative.id);
  details.append(make('h3', `Also consider ${alt.title}`), make('p', data.alternative.reason), make('h3', 'Why this shape?'));
  details.append(make('p', 'These scores describe intended use. “Needs Strong Verifier” means dependence on reliable automatic checks, not how carefully the work should be reviewed.'));
  const scroll = make('div', undefined, 'table-scroll'), table = make('table', undefined, 'rating-table');
  const header = make('tr'); ['Dimension', 'Score', 'Reason'].forEach(s => { const th = make('th', s); th.scope = 'col'; header.append(th); });
  const thead = make('thead'); thead.append(header); table.append(thead);
  const body = make('tbody');
  for (const d of catalog.dimensions) {
    const rating = data.profile.find(p => p.id === d.id), row = make('tr');
    row.append(make('td', d.label), make('td', String(rating.score)), make('td', rating.reason)); body.append(row);
  }
  table.append(body); scroll.append(table); details.append(scroll);
  const actions = make('div', undefined, 'result-actions'), json = make('button', 'Save recommendation JSON', 'text-button');
  json.type = 'button'; json.addEventListener('click', () => download('process-recommendation.json', JSON.stringify(data, null, 2), 'application/json'));
  actions.append(json); details.append(actions);
  $('chart-wait').hidden = true;
  for (const id of ['chart', 'download', 'recommendation', 'reasoning']) $(id).hidden = false;
}

async function showResult(data, signal) {
  if (signal.aborted) return false;
  const rows = catalog.dimensions.map(dimension => {
    const rating = data.profile.find(item => item.id === dimension.id);
    const row = make('div', undefined, 'score-row');
    const name = make('dt', dimension.label);
    const value = make('dd', undefined, 'score-value');
    const number = make('span', '—');
    value.append(number, make('span', ' / 100', 'score-max'));
    const track = make('div', undefined, 'score-track'); track.setAttribute('aria-hidden', 'true');
    const bar = make('div', undefined, 'score-bar'); track.append(bar);
    row.append(name, value, track);
    return { row, number, bar, rating };
  });
  $('scores').replaceChildren(...rows.map(item => item.row));
  $('result').classList.remove('is-complete');
  $('result').hidden = false;
  $('chart-wait').hidden = false;
  $('reveal-count').textContent = `0 of ${rows.length} dimensions`;
  for (const id of ['chart', 'download', 'recommendation', 'reasoning']) $(id).hidden = true;
  $('chart').replaceChildren();
  $('result-title').textContent = '';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('show-all').hidden = reducedMotion;
  document.querySelector('main').classList.add('has-result');
  $('status').textContent = 'Your scores are ready. Revealing each dimension, then your recommendation.';
  $('profile-title').focus({ preventScroll: true });
  $('result').scrollIntoView({ block: 'start' });
  const reveal = revealScores(rows.length, index => {
    const { row, number, bar, rating } = rows[index];
    number.textContent = String(rating.score);
    bar.style.width = `${rating.score}%`;
    row.classList.add('is-revealed');
    $('reveal-count').textContent = `${index + 1} of ${rows.length} dimensions`;
  }, { signal, reducedMotion });
  activeReveal = reveal; renderConnection();
  const completed = await reveal.finished;
  if (activeReveal === reveal) activeReveal = null;
  if (!completed || signal.aborted) return false;
  const skipped = document.activeElement === $('show-all');
  $('show-all').hidden = true;
  renderRecommendation(data);
  $('result').classList.add('is-complete');
  if (skipped) $('result-title').focus({ preventScroll: true });
  return true;
}

function showError(error) {
  $('status').className = 'error'; $('status').textContent = error.message;
  $('usage-error').hidden = $('source').value !== 'chatgpt' || error.code !== 'subscription_sharing_usage_limit_exceeded';
}
async function analyze(task) {
  if (busy) throw new Error('A recommendation is already running.');
  if (!ready()) throw new Error('Connect your model and choose it before asking for a recommendation.');
  if (typeof task !== 'string' || task.trim().length < 20 || task.length > 8000) throw new Error('Describe your task in 20–8,000 characters.');
  const source = $('source').value, model = $('model').value;
  const controller = new AbortController(); activeRequest = controller;
  activeReveal?.cancel(); activeReveal = null;
  busy = true; renderConnection(); $('usage-error').hidden = true;
  $('task').value = task; renderUsage(); $('task').readOnly = true; $('input-box').setAttribute('aria-busy', 'true');
  $('result').hidden = true;
  $('status').className = ''; $('status').textContent = 'Finding an approach that fits your task…';
  try {
    const data = await request('/api/recommend', { task, source, ...(source === 'chatgpt' ? { model } : {}) }, controller.signal);
    if (!await showResult(data, controller.signal)) return;
    $('status').textContent = `All seven scores are revealed. Recommended approach: ${$('result-title').textContent}.`;
    return data;
  } catch (error) {
    if (controller.signal.aborted) return;
    if (error.status === 401 && source === 'chatgpt') {
      session = null; $('model').value = ''; authFailed = true;
    }
    showError(error);
    throw error;
  } finally {
    if (activeRequest === controller) activeRequest = null;
    busy = false; renderConnection();
    $('task').readOnly = false; $('input-box').setAttribute('aria-busy', 'false');
  }
}

async function init() {
  $('task').addEventListener('input', renderUsage);
  $('show-all').addEventListener('click', () => activeReveal?.showAll());
  window.addEventListener('pagehide', () => {
    activeRequest?.abort(); activeReveal?.cancel();
  });
  $('source').addEventListener('change', () => { $('status').textContent = ''; $('usage-error').hidden = true; renderConnection(); });
  $('model').addEventListener('change', () => { $('status').textContent = ''; renderConnection(); });
  $('login').addEventListener('click', () => login());
  $('account-login').addEventListener('click', () => login());
  $('retry-auth').addEventListener('click', refreshAuth);
  $('logout').addEventListener('click', async () => {
    if (busy || authBusy) return;
    authBusy = true; renderConnection();
    try {
      const { message } = await request('/api/auth/logout', {});
      session = null;
      await refreshAuth();
      $('status').className = ''; $('status').textContent = message || 'Signed out.';
    } catch (error) { authBusy = false; renderConnection(); showError(error); }
  });
  $('welcome-dismiss').addEventListener('click', dismissWelcome);
  $('welcome').addEventListener('cancel', event => { event.preventDefault(); if (!$('welcome-dismiss').disabled) dismissWelcome(); });
  $('download').addEventListener('click', () => download('process-radar.svg', new XMLSerializer().serializeToString($('chart').firstChild), 'image/svg+xml'));
  $('task-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!busy) analyze($('task').value).catch(showError);
  });
  [catalog, config] = await Promise.all([request('/api/catalog'), request('/api/config')]);
  await refreshAuth();
  const page = new URL(window.location.href);
  if (page.searchParams.has('signin')) {
    if (page.searchParams.get('signin') === 'error' && !session?.authError) showError(new Error('Sign-in was not completed. You can try again.'));
    page.searchParams.delete('signin'); window.history.replaceState(null, '', page.pathname + page.search + page.hash);
  }
  const context = document.modelContext;
  if (context?.registerTool) {
    const lifecycle = new AbortController();
    Promise.resolve(context.registerTool({
      name: 'recommend_process', title: 'Recommend a process',
      description: 'Send a task description to the model and funding source explicitly selected in the page, then display a suggested process, radar chart, and rationale. Uses ChatGPT plan allowance or the configured endpoint credentials. Requires sign-in/model setup first.',
      inputSchema: { type: 'object', properties: { task: { type: 'string', minLength: 20, maxLength: 8000 } }, required: ['task'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async input => analyze(input?.task)
    }, { signal: lifecycle.signal })).catch(() => {});
    window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  }
}
init().catch(showError);
