import { radar } from './radar.js';

const $ = id => document.getElementById(id);
const make = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
let catalog, busy = false, configured = false;

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
function showResult(data) {
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
  $('result').hidden = false;
  document.querySelector('main').classList.add('has-result');
  $('result-title').focus({ preventScroll: true });
  $('result').scrollIntoView({ block: 'start' });
}

function showError(error) {
  $('status').className = 'error'; $('status').textContent = error.message;
}
async function analyze(task) {
  if (busy) throw new Error('A recommendation is already running.');
  if (typeof task !== 'string' || task.trim().length < 20 || task.length > 8000) throw new Error('Describe your task in 20–8,000 characters.');
  busy = true; $('analyze').disabled = true; $('analyze').textContent = 'Thinking…';
  $('task').value = task; $('task').readOnly = true; $('input-box').setAttribute('aria-busy', 'true');
  $('result').hidden = true;
  $('status').className = ''; $('status').textContent = 'Finding an approach that fits your task…';
  try {
    const response = await fetch('/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The recommendation could not be generated.');
    showResult(data);
    $('status').textContent = 'Your recommendation is ready below.';
    return data;
  } catch (error) {
    if (!configured) $('setup').open = true;
    showError(error);
    throw error;
  } finally {
    busy = false; $('analyze').disabled = false; $('analyze').textContent = 'Find my approach';
    $('task').readOnly = false; $('input-box').setAttribute('aria-busy', 'false');
  }
}

async function init() {
  const [catalogResponse, configResponse] = await Promise.all([fetch('/api/catalog'), fetch('/api/config')]);
  if (!catalogResponse.ok || !configResponse.ok) throw new Error('Unable to load the app. Refresh to try again.');
  catalog = await catalogResponse.json();
  const config = await configResponse.json(); configured = config.configured;
  $('connection').textContent = configured ? `Connected to ${config.model}` : 'No model connected yet';
  if (configured) $('privacy').textContent = `Sent to ${config.endpoint} when you submit. Not saved by this app; provider retention may apply.`;
  $('download').addEventListener('click', () => download('process-radar.svg', new XMLSerializer().serializeToString($('chart').firstChild), 'image/svg+xml'));
  $('task-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!busy) analyze($('task').value).catch(showError);
  });
  $('analyze').disabled = false;
  const context = document.modelContext;
  if (context?.registerTool) {
    const lifecycle = new AbortController();
    Promise.resolve(context.registerTool({
      name: 'recommend_process', title: 'Recommend a process',
      description: 'Send a task description to the configured LLM endpoint and display a suggested process, radar chart, and rationale. May incur provider charges.',
      inputSchema: { type: 'object', properties: { task: { type: 'string', minLength: 20, maxLength: 8000 } }, required: ['task'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async input => analyze(input?.task)
    }, { signal: lifecycle.signal })).catch(() => {});
    window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  }
}
init().catch(showError);
