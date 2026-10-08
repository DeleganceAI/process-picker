import { radar } from './radar.js';
import { revealScores } from './reveal.mjs';
import { usageNotice } from './usage.mjs';
import { countdown } from './countdown.mjs';
import { closestProfiles } from './similarity.mjs';

const $ = id => document.getElementById(id);
const make = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
let catalog, config, session, activeReveal, activeRequest, busy = false, authBusy = true, authFailed = false;
let intakeQuestions = [], intakeAnswers = null, intakeGuesses = new Map(), intakeTask = '', busyStage = '';
let activeAdvance = null, advanceStage = '', advancePaused = false, resultData = null;
const AUTH_DRAFT_KEY = 'process-radar:auth-draft';

function saveAuthDraft() {
  const draft = $('task').value;
  try {
    if (draft.length > 8000) throw new Error('Draft too long');
    if (draft) window.sessionStorage.setItem(AUTH_DRAFT_KEY, draft);
    else window.sessionStorage.removeItem(AUTH_DRAFT_KEY);
  } catch {
    if (draft) throw new Error('Your browser could not keep this draft during sign-in. Copy your task somewhere safe, clear the box, then try signing in again.');
  }
}

function restoreAuthDraft() {
  try {
    const draft = window.sessionStorage.getItem(AUTH_DRAFT_KEY);
    if (draft && draft.length <= 8000 && !$('task').value) $('task').value = draft;
    window.sessionStorage.removeItem(AUTH_DRAFT_KEY);
  } catch { /* Storage may be disabled; the composer still works. */ }
}

function stopAdvance() {
  activeAdvance?.cancel(); activeAdvance = null; advanceStage = '';
}
function pauseAdvance() { activeAdvance?.pause(); }
function startAdvance(stage, paused = false) {
  stopAdvance(); advanceStage = stage;
  const button = $(stage === 'review' ? 'recommend' : 'show-process');
  const pause = $(stage === 'review' ? 'pause-review' : 'pause-scores');
  const label = stage === 'review' ? 'See my scores' : 'See my approach';
  activeAdvance = countdown(7, state => {
    advancePaused = state.paused;
    button.textContent = state.paused ? `${label} · paused` : `${label} in ${state.remaining}s`;
    pause.textContent = state.paused ? 'Resume' : 'Pause';
  }, () => {
    activeAdvance = null; advanceStage = '';
    if (document.hidden) { startAdvance(stage, true); return; }
    if (stage === 'review') {
      if (ready() && $('intake-review').open) recommendTask().catch(showError);
    } else showApproach();
  });
  if (paused || document.hidden) activeAdvance.pause();
}
function toggleAdvance() { if (advancePaused) activeAdvance?.resume(); else pauseAdvance(); }
function closeReview() { pauseAdvance(); $('intake-review').close(); }
function openReview() {
  $('intake-review').showModal();
  $('intake-title').focus({ preventScroll: true });
  startAdvance('review', true);
}
function showApproach() {
  if (!resultData) return;
  stopAdvance();
  $('score-stage').hidden = true; $('approach-stage').hidden = false;
  $('result').setAttribute('aria-labelledby', 'result-title');
  $('result-title').focus({ preventScroll: true });
  $('result').scrollIntoView({ block: 'start' });
}
function showScores() {
  stopAdvance();
  $('score-stage').hidden = false; $('approach-stage').hidden = true;
  $('result').setAttribute('aria-labelledby', 'profile-title');
  $('profile-title').focus({ preventScroll: true });
  startAdvance('scores', true);
}

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
  if (!catalog || !intakeQuestions.length || busy || authBusy) return false;
  return $('source').value === 'endpoint' ? config?.configured :
    session?.signedIn && session.planEnabled && !session.needsWelcome && Boolean($('model').value);
}

function renderUsage() {
  const source = $('source').value;
  const model = source === 'endpoint' ? config?.model : $('model').selectedOptions[0]?.value ? $('model').selectedOptions[0].textContent : null;
  $('usage-notice').hidden = !model;
  $('review-usage').hidden = !model;
  if (!model) return;
  const notice = usageNotice({
    ...config?.usage, task: $('task').value, source, model,
    stage: intakeAnswers ? 'recommend' : 'intake', answers: intakeAnswers || []
  });
  $('usage-summary').textContent = notice.summary;
  $('review-usage').textContent = notice.summary;
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
  $('analyze').textContent = busy ? 'Reading your task…' : intakeAnswers ? 'Review my task' : 'Check my task';
  $('recommend').disabled = !ready() || !intakeAnswers;
  if (advanceStage !== 'review') $('recommend').textContent = busyStage === 'recommend' ? 'Finding your approach…' : 'See my scores';
  $('pause-review').disabled = busy;
  $('close-review').disabled = busy;
  for (const id of ['edit-task', 'review-answers']) $(id).disabled = busy;
  for (const input of $('intake-fields').querySelectorAll('textarea')) input.readOnly = busy;
  $('account-status').textContent = authBusy ? 'Checking sign-in…' : session?.signedIn ?
    `${session.account?.label || 'Signed in'}${hasPlan ? '' : ' · ChatGPT plan access was not enabled.'}` : 'Sign in to use your ChatGPT plan.';
  $('connection').textContent = config?.configured ? `Connected to ${config.model}` : 'No API / local model connected yet';
  $('privacy').textContent = chatgpt ? hasPlan ?
    'Sent to OpenAI using your ChatGPT plan when you submit. Not saved on this server; provider retention may apply.' :
    'Sign in to use your ChatGPT plan, or choose an API / local model in Setup. Your draft stays in this tab during sign-in.' :
    config?.configured ? `Sent to ${config.endpoint} when you submit. Uses the configured endpoint’s credentials, not your ChatGPT plan. Not saved on this server; provider retention may apply.` :
    'Configure an API / local model in Setup before submitting. Tasks are not saved on this server.';
  renderUsage();
}

async function refreshAuth() {
  authBusy = true; authFailed = false; session = null;
  $('status').className = ''; $('status').textContent = ''; $('usage-error').hidden = true;
  $('review-error').textContent = '';
  $('account-options').hidden = true;
  $('model').replaceChildren(make('option', 'Choose a model'));
  $('model').firstChild.value = '';
  renderConnection();
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
      if (models.some(model => model.id === 'gpt-6-luna')) $('model').value = 'gpt-6-luna';
      if (!models.length) throw new Error('No models are available for this ChatGPT account. Check your plan access or try again.');
      if (!$('model').value) {
        $('status').className = '';
        $('status').textContent = 'GPT-6 Luna is not available for this account. Choose an available model to continue.';
      }
    }
    if (session.authError) showError(new Error(session.authError));
  } catch (error) {
    error.message = session?.signedIn && session.planEnabled ?
      `You’re signed in, but the available models could not be loaded. ${error.message} Use Retry connection to try again.` :
      `Could not check your sign-in. ${error.message} Use Retry connection to try again.`;
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
    saveAuthDraft();
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
  const custom = { label: 'Your task’s suggested process', scores: Object.fromEntries(data.profile.map(p => [p.id, p.score])), color: '#16834b' };
  $('chart').replaceChildren(radar(catalog.dimensions, [custom], 'Your task’s custom process profile'));
  $('similar-charts').replaceChildren(...closestProfiles(catalog.dimensions, catalog.approaches, data.profile).map(({ approach: reference, gap }) => {
    const card = make('article', undefined, 'similar-card');
    card.append(make('h4', reference.title), make('p', `Average score gap: ${Math.round(gap)} / 100`, 'profile-gap'));
    card.append(radar(catalog.dimensions, [custom, {
      label: reference.title + ' · reference', scores: Object.fromEntries(catalog.dimensions.map(d => [d.id, reference.ratings[d.id].score])), color: '#315ce8', dashed: true
    }], 'Your suggested process compared with ' + reference.title));
    return card;
  }));

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
    row.append(name, value, track, make('dd', rating.reason, 'score-explanation'));
    return { row, number, bar, rating };
  });
  $('scores').replaceChildren(...rows.map(item => item.row));
  $('result').classList.remove('is-complete');
  $('result').hidden = false;
  $('composer').hidden = true;
  $('intake-review').close();
  $('score-stage').hidden = false; $('approach-stage').hidden = true;
  $('score-actions').hidden = true;
  $('result').setAttribute('aria-labelledby', 'profile-title');
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
  $('show-all').hidden = true;
  resultData = data;
  renderRecommendation(data);
  $('result').classList.add('is-complete');
  $('score-actions').hidden = false;
  startAdvance('scores');
  return true;
}

function showError(error) {
  pauseAdvance();
  $('status').className = 'error'; $('status').textContent = error.message;
  $('review-error').textContent = intakeAnswers ? error.message : '';
  $('usage-error').hidden = $('source').value !== 'chatgpt' || error.code !== 'subscription_sharing_usage_limit_exceeded';
}
function invalidateIntake() {
  if (intakeTask && $('task').value !== intakeTask) {
    intakeTask = ''; intakeAnswers = null; intakeGuesses.clear();
    stopAdvance(); resultData = null;
    $('intake-review').close();
    $('review-error').textContent = '';
    $('result').hidden = true;
    document.querySelector('main').classList.remove('has-result');
    $('status').className = '';
    $('status').textContent = 'Your task changed. Check it again before scoring.';
  }
  renderConnection();
}

function restoreEmptyAnswer(id) {
  const answer = intakeAnswers?.find(item => item.id === id);
  if (!answer || answer.answer.trim()) return;
  const question = intakeQuestions.find(item => item.id === id);
  answer.answer = intakeGuesses.get(id)?.trim() || question.defaultAnswer;
  answer.status = 'inferred'; answer.evidence = 'Default assumption; please edit if it does not fit.';
  $(`intake-${id}`).value = answer.answer;
  $(`intake-status-${id}`).textContent = 'Best guess';
  $(`intake-help-${id}`).textContent = answer.evidence;
  renderUsage();
}

function renderIntake(autoAdvance) {
  const fields = intakeQuestions.map(question => {
    const answer = intakeAnswers.find(item => item.id === question.id);
    const field = make('div', undefined, 'intake-field');
    const label = make('label', question.label); label.htmlFor = `intake-${question.id}`;
    label.title = question.question;
    const badge = make('span', undefined, 'answer-status');
    badge.id = `intake-status-${question.id}`;
    const statuses = { stated: 'Stated', inferred: 'Best guess', edited: 'Your edit' };
    badge.textContent = statuses[answer.status];
    const prompt = make('p', question.question, 'sr-only');
    prompt.id = `intake-question-${question.id}`;
    const input = make('textarea'); input.id = `intake-${question.id}`;
    input.rows = 1; input.maxLength = 600; input.value = answer.answer;
    input.setAttribute('aria-describedby', `${prompt.id} intake-help-${question.id}`);
    const help = make('p', answer.evidence || question.hint, 'sr-only');
    help.id = `intake-help-${question.id}`;
    input.addEventListener('input', () => {
      pauseAdvance(); resultData = null;
      answer.answer = input.value;
      answer.status = 'edited'; answer.evidence = '';
      badge.textContent = statuses.edited; help.textContent = question.hint;
      $('result').hidden = true;
      $('composer').hidden = false;
      $('status').className = ''; $('status').textContent = '';
      $('review-error').textContent = '';
      renderUsage();
    });
    input.addEventListener('blur', () => restoreEmptyAnswer(question.id));
    field.append(label, input, badge, prompt, help);
    return field;
  });
  $('intake-fields').replaceChildren(...fields);
  $('intake-review').showModal();
  document.querySelector('main').classList.add('has-result');
  $('intake-title').focus({ preventScroll: true });
  startAdvance('review', !autoAdvance);
}

async function runStage(stage, task, autoAdvance = true) {
  if (busy) throw new Error('A request is already running.');
  if (!ready()) throw new Error('Connect your model and choose it before asking for a recommendation.');
  if (typeof task !== 'string' || task.trim().length < 20 || task.length > 8000) throw new Error('Describe your task in 20–8,000 characters.');
  if (stage === 'recommend' && (!intakeAnswers || task !== intakeTask)) throw new Error('Check your task before asking for a recommendation.');
  stopAdvance(); resultData = null;
  $('task').value = task;
  if (stage === 'intake') invalidateIntake();
  else intakeAnswers.forEach(answer => restoreEmptyAnswer(answer.id));
  const source = $('source').value, model = $('model').value;
  const body = {
    task, source, ...(source === 'chatgpt' ? { model } : {}),
    ...(stage === 'recommend' ? { intake: { answers: intakeAnswers.map(answer => ({ ...answer })) } } : {})
  };
  const controller = new AbortController(); activeRequest = controller;
  activeReveal?.cancel(); activeReveal = null;
  busy = true; busyStage = stage; renderConnection(); $('usage-error').hidden = true;
  renderUsage(); $('task').readOnly = true; $('input-box').setAttribute('aria-busy', 'true');
  $('intake-form').setAttribute('aria-busy', String(stage === 'recommend'));
  $('result').hidden = true;
  $('composer').hidden = false;
  $('review-error').textContent = '';
  $('status').className = ''; $('status').textContent = stage === 'intake' ? 'Making best guesses from your task. You can edit them before scoring.' : 'Finding an approach using your answers…';
  try {
    const data = await request(`/api/${stage}`, body, controller.signal);
    if (controller.signal.aborted) return;
    if (stage === 'intake') {
      intakeTask = task; intakeAnswers = data.answers;
      intakeGuesses = new Map(data.answers.map(answer => [answer.id, answer.answer]));
      renderIntake(autoAdvance);
      $('status').textContent = 'Best guesses from your task. Edit anything that is wrong.';
      return { reviewRequired: true, answers: intakeAnswers };
    }
    if (!await showResult(data, controller.signal)) return;
    $('status').textContent = 'All seven scores are ready. Your recommendation is next.';
    return data;
  } catch (error) {
    if (controller.signal.aborted) return;
    if (error.status === 401 && source === 'chatgpt') {
      session = null; $('model').value = ''; authFailed = true;
    }
    showError(error);
    if (stage === 'recommend') startAdvance('review', true);
    throw error;
  } finally {
    if (activeRequest === controller) activeRequest = null;
    busy = false; busyStage = ''; renderConnection();
    $('task').readOnly = false; $('input-box').setAttribute('aria-busy', 'false');
    $('intake-form').setAttribute('aria-busy', 'false');
  }
}
function prepareTask(task, { autoAdvance = true } = {}) { return runStage('intake', task, autoAdvance); }
function recommendTask() { return runStage('recommend', $('task').value); }

async function init() {
  restoreAuthDraft();
  $('task').addEventListener('input', invalidateIntake);
  $('show-all').addEventListener('click', () => activeReveal?.showAll());
  window.addEventListener('pagehide', () => {
    stopAdvance();
    activeRequest?.abort(); activeReveal?.cancel();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) { restoreAuthDraft(); refreshAuth(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseAdvance(); });
  $('intake-fields').addEventListener('focusin', pauseAdvance);
  $('intake-fields').addEventListener('wheel', pauseAdvance, { passive: true });
  $('intake-fields').addEventListener('touchstart', pauseAdvance, { passive: true });
  $('source').addEventListener('change', () => { pauseAdvance(); $('status').textContent = ''; $('review-error').textContent = ''; $('usage-error').hidden = true; renderConnection(); });
  $('model').addEventListener('change', () => { pauseAdvance(); $('status').textContent = ''; $('review-error').textContent = ''; renderConnection(); });
  $('pause-review').addEventListener('click', toggleAdvance);
  $('pause-scores').addEventListener('click', toggleAdvance);
  $('close-review').addEventListener('click', closeReview);
  $('intake-review').addEventListener('cancel', event => { event.preventDefault(); if (!busy) closeReview(); });
  $('show-process').addEventListener('click', showApproach);
  $('back-scores').addEventListener('click', showScores);
  $('review-answers').addEventListener('click', openReview);
  $('edit-task').addEventListener('click', () => {
    stopAdvance(); $('result').hidden = true; $('composer').hidden = false; $('task').focus();
  });
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
    if (!busy) { if (intakeAnswers) openReview(); else prepareTask($('task').value).catch(showError); }
  });
  $('intake-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!busy) recommendTask().catch(showError);
  });
  const [loadedCatalog, loadedConfig, intake] = await Promise.all([request('/api/catalog'), request('/api/config'), request('/api/intake/questions')]);
  catalog = loadedCatalog; config = loadedConfig; intakeQuestions = intake.questions;
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
      name: 'prepare_process', title: 'Prepare a process recommendation',
      description: 'Draft editable answers about a task using the selected model and funding source. Opens a paused review; the user must continue or resume the countdown to score. This tool never starts scoring automatically. Uses ChatGPT plan allowance or configured endpoint credentials. Requires sign-in/model setup first.',
      inputSchema: { type: 'object', properties: { task: { type: 'string', minLength: 20, maxLength: 8000 } }, required: ['task'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async input => prepareTask(input?.task, { autoAdvance: false })
    }, { signal: lifecycle.signal })).catch(() => {});
    window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  }
}
init().catch(showError);
