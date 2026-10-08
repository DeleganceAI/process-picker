import { buildMessages, DemoError, validateRecommendation } from './model.mjs';

const MAX_BYTES = 512 * 1024;
// Model catalogs include metadata beyond the two fields used by the picker.
const MAX_MODEL_LIST_BYTES = 16 * 1024 * 1024;
const API = 'https://api.openai.com/v1';
const PLAN_ERRORS = {
  subscription_sharing_user_not_eligible: [403, 'ChatGPT plan usage is unavailable for this account or workspace.'],
  subscription_sharing_usage_limit_exceeded: [429, 'Your ChatGPT plan usage limit for this app has been reached. Check ChatGPT settings → Usage before trying again.'],
  subscription_sharing_usage_unavailable: [503, 'ChatGPT usage availability could not be checked. Try again later.'],
  subscription_sharing_unsupported_capability: [400, 'This model or request is not supported by ChatGPT plan usage. Choose another available model.'],
  subscription_sharing_route_not_supported: [403, 'ChatGPT plan usage is not enabled for this request route.'],
  subscription_sharing_invalid_user: [401, 'ChatGPT could not validate this connection. Check your account and sign in again if it has been disconnected.'],
  chatpass_v2_scope_not_authorized: [403, 'This ChatGPT connection does not authorize plan usage. Check the granted permissions.'],
  chatpass_v2_invalid_authorization_context: [403, 'This ChatGPT connection does not authorize plan usage. Check the granted permissions.'],
  subscription_sharing_user_unavailable: [503, 'Your ChatGPT account or workspace is temporarily unavailable. Try again later.']
};

function providerError(status, value, requestId) {
  const code = value?.error?.code ?? value?.code;
  const known = Object.hasOwn(PLAN_ERRORS, code) ? PLAN_ERRORS[code] : null;
  const messages = {
    401: 'ChatGPT did not accept this connection or its plan-usage permission. Check your account and sign-in permissions.',
    403: 'ChatGPT prevented this request because of an account, permission, region, or policy restriction.',
    429: 'ChatGPT is limiting requests. Check ChatGPT settings → Usage and try again later.',
    503: 'ChatGPT plan usage is temporarily unavailable. Try again later.'
  };
  const error = new DemoError(known?.[1] || messages[status] || 'The ChatGPT request failed. Try again later or choose another available model.', status || known?.[0] || 502);
  if (known) error.code = code;
  if (typeof requestId === 'string' && /^[\w.-]{1,200}$/.test(requestId)) error.requestId = requestId;
  return error;
}

function credential(accessToken) {
  if (typeof accessToken !== 'string' || !accessToken.trim()) throw new DemoError('Sign in with ChatGPT and enable plan usage first.', 401);
  return { Authorization: `Bearer ${accessToken}` };
}

function transportError(error) {
  if (error instanceof DemoError) return error;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return new DemoError('The ChatGPT request timed out. Try again with a smaller task.', 504);
  return new DemoError('Could not complete the connection to ChatGPT. Check your connection and try again.', 502);
}

async function readLimited(response, maxBytes = MAX_BYTES, description = 'response') {
  if (!response.body) throw new DemoError(`ChatGPT returned an empty ${description}.`);
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new DemoError(`The ChatGPT ${description} was too large.`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function checkResponse(response) {
  if (response.ok) return;
  const raw = response.body ? await readLimited(response) : '';
  let value;
  try { value = JSON.parse(raw); } catch { /* Admission errors need not be JSON. */ }
  throw providerError(response.status, value, response.headers.get('x-request-id'));
}

export async function listChatGPTModels(accessToken, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${API}/models`, {
      headers: credential(accessToken), signal: AbortSignal.timeout(15000), redirect: 'error'
    });
    await checkResponse(response);
    let value;
    try { value = JSON.parse(await readLimited(response, MAX_MODEL_LIST_BYTES, 'model list')); } catch (error) {
      if (error instanceof SyntaxError) throw new DemoError('ChatGPT returned an invalid model list.');
      throw error;
    }
    if (!Array.isArray(value?.models)) throw new DemoError('ChatGPT returned an invalid model list.');
    const visible = value.models.filter(m => m?.visibility === 'list');
    if (visible.some(m => typeof m.slug !== 'string' || !m.slug.trim() || m.slug.length > 200 || typeof m.display_name !== 'string' || !m.display_name.trim() || m.display_name.length > 200)) throw new DemoError('ChatGPT returned an invalid model list.');
    return visible.map(m => ({ id: m.slug, name: m.display_name }));
  } catch (error) { throw transportError(error); }
}

async function readResponseStream(response) {
  if (!response.body) throw new DemoError('ChatGPT returned an empty response.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let size = 0, pending = '', data = [], eventName = '', text = '', completed = false;
  const consumeEvent = () => {
    if (!data.length) { eventName = ''; return; }
    const raw = data.join('\n'), name = eventName;
    data = []; eventName = '';
    if (raw === '[DONE]') return;
    let event;
    try { event = JSON.parse(raw); } catch { throw new DemoError('ChatGPT returned an invalid event stream.'); }
    const type = event?.type || name;
    if (type === 'response.failed' || type === 'error' || type === 'response.error') throw providerError(null, event.response || event, response.headers.get('x-request-id'));
    if (type === 'response.incomplete') throw new DemoError('ChatGPT did not complete the recommendation. Try again with a smaller task.');
    if (type === 'response.refusal.delta' || type === 'response.refusal.done') throw new DemoError('The model declined this request. Try a different task description.');
    if (type === 'response.output_text.delta') {
      if (typeof event.delta !== 'string') throw new DemoError('ChatGPT returned an invalid text event.');
      text += event.delta;
    }
    if (type === 'response.completed') {
      if (event.response?.status && event.response.status !== 'completed') throw new DemoError('ChatGPT did not complete the recommendation.');
      const output = event.response?.output;
      if (Array.isArray(output)) {
        const parts = output.flatMap(item => item?.type === 'message' && Array.isArray(item.content) ? item.content : []);
        if (parts.some(part => part?.type === 'refusal')) throw new DemoError('The model declined this request. Try a different task description.');
        const texts = parts.filter(part => part?.type === 'output_text');
        if (texts.some(part => typeof part.text !== 'string')) throw new DemoError('ChatGPT returned invalid output text.');
        if (texts.length) text = texts.map(part => part.text).join('');
      }
      completed = true;
    }
  };
  const consumeLines = final => {
    while (!completed) {
      const match = /[\r\n]/.exec(pending);
      if (!match || (!final && match.index === pending.length - 1 && match[0] === '\r')) break;
      const line = pending.slice(0, match.index);
      const length = pending.slice(match.index, match.index + 2) === '\r\n' ? 2 : 1;
      pending = pending.slice(match.index + length);
      if (!line) consumeEvent();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      else if (line.startsWith('event:')) eventName = line.slice(6).replace(/^ /, '');
    }
  };
  try {
    while (!completed) {
      const { value, done } = await reader.read();
      if (done) {
        pending += decoder.decode();
        consumeLines(true);
        break;
      }
      size += value.length;
      if (size > MAX_BYTES) throw new DemoError('The ChatGPT response was too large.');
      pending += decoder.decode(value, { stream: true });
      consumeLines(false);
    }
    if (!completed) throw new DemoError('The ChatGPT stream ended before the recommendation was complete. Try again.');
    return text;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function recommendWithChatGPT(task, catalog, { accessToken, model, timeout = 120000 }, fetchImpl = fetch) {
  const messages = buildMessages(task, catalog);
  if (typeof model !== 'string' || !model.trim() || model.length > 200) throw new DemoError('Choose a model available to your ChatGPT account.', 400);
  let text;
  try {
    const response = await fetchImpl(`${API}/responses`, {
      method: 'POST', headers: { ...credential(accessToken), 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ model, instructions: messages[0].content, input: [messages[1]], store: false, stream: true }),
      signal: AbortSignal.timeout(timeout), redirect: 'error'
    });
    await checkResponse(response);
    text = await readResponseStream(response);
  } catch (error) { throw transportError(error); }
  const clean = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
  let value;
  try { value = JSON.parse(clean); } catch { throw new DemoError('ChatGPT returned text instead of a valid JSON recommendation. Try again.'); }
  return validateRecommendation(value, catalog);
}
