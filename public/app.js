import { radar } from './radar.js';

const $ = id => document.getElementById(id);
const make = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
const examples = [
  ['Architecture', 'We need to redesign a complex subsystem. Tests catch regressions but architectural fit and maintainability need human judgment. New questions will emerge. I want to review artifacts, redirect the work, use local models for focused jobs, enforce a budget, and reuse the method.'],
  ['Bounded coding', 'Implement a small parser against a complete, trusted conformance test suite. The scope and expected behavior are stable. I can leave it running unattended, and this is a one-off task in my existing coding harness.'],
  ['Literature review', 'I am doing a systematic literature review. We will define inclusion criteria, search sources, screen abstracts, and extract evidence. Two humans need assigned screening work. The protocol is reusable, the search may surface new questions, and there is no automatic test for a good synthesis.']
];
let catalog, recommendation = null;
let busy = false;

function scores(approach) {
  return Object.fromEntries(catalog.dimensions.map(d => [d.id, approach.ratings[d.id].score]));
}
function draw() {
  const approach = catalog.approaches.find(a => a.id === $('comparison').value);
  const series = recommendation ? [
    { label: approach.title + ' · reference', scores: scores(approach), color: '#315ce8', dashed: true },
    { label: 'Suggested process for your task', scores: Object.fromEntries(recommendation.profile.map(p => [p.id, p.score])), color: '#16834b' }
  ] : [{ label: approach.title, scores: scores(approach), color: '#315ce8' }];
  $('chart').replaceChildren(radar(catalog.dimensions, series, recommendation ? 'Suggested process and reference comparison' : approach.title));
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
function showResult(data) {
  recommendation = data;
  const approach = catalog.approaches.find(a => a.id === data.recommendedApproach);
  $('comparison').value = approach.id;
  $('chart-title').textContent = 'A process for your task';
  $('chart-description').textContent = data.summary;
  const result = $('result'); result.hidden = false; result.replaceChildren();
  result.append(make('p', 'LLM suggestion · review before using', 'label'), make('h2', `Start with ${approach.title}`));
  result.lastElementChild.id = 'result-title';
  result.append(make('p', data.reason), make('p', `Tradeoff: ${data.tradeoff}`));
  const grid = make('div', undefined, 'result-grid');
  grid.append(list('A first pass', data.steps, true), list('Assumptions to check', data.assumptions.length ? data.assumptions : ['No additional assumptions listed. Review the recommendation against your actual constraints.']));
  result.append(grid);
  if (data.questions.length) result.append(list('Before you commit', data.questions));
  const alt = catalog.approaches.find(a => a.id === data.alternative.id);
  result.append(make('h3', `Also consider ${alt.title}`), make('p', data.alternative.reason));
  result.append(make('h3', 'Why this shape?'));
  const scroll = make('div', undefined, 'table-scroll'), table = make('table', undefined, 'rating-table');
  const header = make('tr'); ['Dimension', 'Score', 'Reason'].forEach(s => header.append(make('th', s)));
  const thead = make('thead'); thead.append(header); table.append(thead);
  const body = make('tbody');
  for (const d of catalog.dimensions) {
    const rating = data.profile.find(p => p.id === d.id), row = make('tr');
    row.append(make('td', d.label), make('td', String(rating.score)), make('td', rating.reason)); body.append(row);
  }
  table.append(body); scroll.append(table); result.append(scroll);
  const actions = make('div', undefined, 'result-actions'), json = make('button', 'Download recommendation JSON ↓', 'text-button');
  json.type = 'button'; json.addEventListener('click', () => download('process-recommendation.json', JSON.stringify(data, null, 2), 'application/json'));
  actions.append(json); result.append(actions); draw();
}

async function analyze(task) {
  if (busy) throw new Error('A recommendation is already running.');
  if (typeof task !== 'string' || task.trim().length < 20 || task.length > 8000) throw new Error('Describe your task in 20–8,000 characters.');
  busy = true; $('analyze').disabled = true; $('task').value = task;
  $('status').className = ''; $('status').textContent = 'Thinking through the task and the seven dimensions…';
  try {
    const response = await fetch('/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The recommendation could not be generated.');
    showResult(data);
    $('status').textContent = 'Ready. Review the assumptions and the reasoning below.';
    return data;
  } catch (error) {
    $('status').className = 'error'; $('status').textContent = error.message;
    throw error;
  } finally { busy = false; $('analyze').disabled = false; }
}

async function init() {
  const response = await fetch('/api/catalog');
  if (!response.ok) throw new Error('The profile catalog could not be loaded.');
  catalog = await response.json();
  for (const [label, text] of examples) {
    const button = make('button', label); button.type = 'button';
    button.addEventListener('click', () => { $('task').value = text; $('task').focus(); }); $('examples').append(button);
  }
  for (const [index, approach] of catalog.approaches.entries()) {
    const option = make('option', approach.title); option.value = approach.id; $('comparison').append(option);
    const card = make('article', undefined, 'profile-card'), top = make('div', undefined, 'card-top');
    top.append(make('h3', approach.title), make('span', String(index + 1).padStart(2, '0'), 'card-index'));
    card.append(top, make('p', approach.signature, 'signature'), make('p', approach.short));
    const button = make('button', 'View profile ↗', 'text-button'); button.type = 'button';
    button.addEventListener('click', () => { $('comparison').value = approach.id; draw(); $('chart-title').scrollIntoView({ behavior: 'smooth', block: 'center' }); }); card.append(button);
    const details = make('details'); details.append(make('summary', 'Scores & rationale'));
    catalog.dimensions.forEach(d => {
      const row = make('div', undefined, 'score-row'); row.append(make('span', d.label), make('strong', String(approach.ratings[d.id].score)), make('p', approach.ratings[d.id].reason)); details.append(row);
    });
    details.append(make('p', `Tradeoff: ${approach.tradeoff}`), make('p', `Example: ${approach.example}`)); card.append(details); $('profiles').append(card);
  }
  catalog.dimensions.forEach(d => { const row = make('tr'); [d.label, d.zero, d.hundred].forEach(t => row.append(make('td', t))); $('dimensions').append(row); });
  $('pending').textContent = catalog.pendingRevision.note;
  $('comparison').addEventListener('change', draw); draw();
  $('download').addEventListener('click', () => download('process-radar.svg', new XMLSerializer().serializeToString($('chart').firstChild), 'image/svg+xml'));
  $('task-form').addEventListener('submit', event => { event.preventDefault(); analyze($('task').value).catch(() => {}); });
  const config = await fetch('/api/config').then(r => r.json());
  $('connection').textContent = config.configured ? 'Endpoint configured' : 'Model not connected';
  if (config.configured) {
    $('connection').title = config.model;
    $('privacy').textContent = `Task text goes to ${config.endpoint} using ${config.model}. This app does not save tasks or results. Your provider's own retention policy still applies.`;
  }
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
init().catch(error => { $('status').className = 'error'; $('status').textContent = error.message; });
