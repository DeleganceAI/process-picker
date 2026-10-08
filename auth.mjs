import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { DemoError } from './model.mjs';

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
const SESSION_MS = 8 * 60 * 60 * 1000;
const random = () => randomBytes(32).toString('base64url');
const terminalRefreshErrors = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);

// Tokens deliberately live only in memory. This file keeps registration identity across restarts.
export async function registrationStore(filename) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  let data;
  try { data = JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Cannot read ChatGPT registration metadata. Check the local auth file.');
    data = { hostId: `urn:uuid:${randomUUID()}`, accounts: [] };
  }
  if (typeof data.hostId !== 'string' || !Array.isArray(data.accounts)) throw new Error('Invalid ChatGPT registration metadata.');
  let writes = Promise.resolve();
  const save = () => {
    const contents = JSON.stringify(data, null, 2);
    writes = writes.catch(() => {}).then(async () => {
      const temporary = `${filename}.${randomUUID()}.tmp`;
      await writeFile(temporary, contents, { mode: 0o600, flag: 'wx' });
      await rename(temporary, filename);
    });
    return writes;
  };
  await save();
  return { data, save };
}

export async function verifyIdentity(idToken, expected, jwks) {
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: ISSUER, audience: expected.clientId, algorithms: ['RS256'],
    requiredClaims: ['sub', 'exp', 'iat', 'nonce'], clockTolerance: 5
  });
  if (!payload.sub || typeof payload.sub !== 'string' || payload.nonce !== expected.nonce ||
      (payload.azp !== undefined && payload.azp !== expected.clientId) ||
      (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== expected.clientId) ||
      (expected.subject && payload.sub !== expected.subject)) throw new Error('Identity did not match the sign-in attempt.');
  return payload;
}

async function readJSON(response) {
  if (!response.body) throw new DemoError('OpenAI returned an empty response.');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 128 * 1024) throw new DemoError('OpenAI returned an oversized sign-in response.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof DemoError) throw error;
    throw new DemoError('OpenAI returned an unreadable sign-in response.');
  } finally { reader.releaseLock(); }
}

export function createAuth({ store, fetchImpl = fetch, verifyToken, now = Date.now }) {
  const sessions = new Map();
  let discoveryPromise, jwks;
  async function discovery() {
    if (!discoveryPromise) discoveryPromise = (async () => {
      const response = await fetchImpl(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) { await response.body?.cancel(); throw new DemoError('ChatGPT sign-in is temporarily unavailable. Try again.'); }
      const doc = await readJSON(response);
      if (doc.issuer !== ISSUER) throw new DemoError('Unexpected OpenAI sign-in issuer.');
      for (const key of ['authorization_endpoint', 'token_endpoint', 'revocation_endpoint', 'jwks_uri']) {
        const url = new URL(doc[key]);
        if (url.origin !== ISSUER || url.username || url.password || url.search || url.hash) throw new DemoError('Unexpected OpenAI sign-in endpoint.');
      }
      jwks = createRemoteJWKSet(new URL(doc.jwks_uri), { timeoutDuration: 15000 });
      return doc;
    })().catch(error => { discoveryPromise = undefined; throw error; });
    return discoveryPromise;
  }
  function cookie(res, id) {
    // HTTP loopback needs a non-Secure cookie; the server never binds a public interface.
    res.setHeader('Set-Cookie', `radar_session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}`);
  }
  function session(req, res, create = true) {
    for (const [id, item] of sessions) if (item.expiresAt <= now()) sessions.delete(id);
    const id = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('radar_session='))?.slice(14);
    let item = sessions.get(id);
    if (!item && create) {
      if (sessions.size >= 32) throw new DemoError('Too many local sessions. Restart the demo to clear them.', 429);
      item = { id: random(), expiresAt: now() + SESSION_MS, credentials: new Map(), activeId: null, pending: null, generation: 0 };
      sessions.set(item.id, item); cookie(res, item.id);
    }
    return item;
  }
  const registration = id => store.data.accounts.find(account => account.id === id);
  const publicAccount = account => account ? { id: account.id, label: account.label } : null;
  function snapshot(item) {
    const active = item && registration(item.activeId);
    const tokens = item?.credentials.get(item.activeId);
    return {
      signedIn: Boolean(tokens), planEnabled: Boolean(tokens?.scopes.includes(PLAN_SCOPE)),
      account: publicAccount(active), accounts: store.data.accounts.map(publicAccount),
      needsWelcome: Boolean(tokens?.scopes.includes(PLAN_SCOPE) && !active?.welcomed),
      authError: item?.authError || null
    };
  }
  async function login(item, input, origin) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DemoError('Expected sign-in options.', 400);
    const account = input.accountId ? registration(input.accountId) : null;
    if (input.accountId && !account) throw new DemoError('Choose a saved account or add a new one.', 400);
    const generation = ++item.generation;
    const doc = await discovery();
    if (item.generation !== generation) throw new DemoError('This sign-in was superseded. Try again.', 409);
    const clientId = account?.id || item.retryClientId || 'dynamic_agent_client';
    const pending = {
      state: random(), nonce: random(), verifier: random(), clientId,
      subject: account?.subject, redirectUri: `${origin}/auth/callback`, expiresAt: now() + 10 * 60 * 1000, generation
    };
    item.pending = pending; item.authError = null;
    const url = new URL(doc.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: clientId, ext_agent_host_id: store.data.hostId, response_type: 'code',
      redirect_uri: pending.redirectUri, scope: SCOPES, resource: RESOURCE,
      state: pending.state, nonce: pending.nonce, code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(pending.verifier).digest('base64url'),
      ...(clientId === 'dynamic_agent_client' ? { agent_name_hint: 'Process Radar' } : {}),
      ...(account?.email ? { login_hint: account.email } : {}),
      ...(input.enablePlan === true ? { prompt: 'consent' } : {})
    }).toString();
    return url.href;
  }
  async function tokenRequest(doc, params) {
    const response = await fetchImpl(doc.token_endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ ...params, resource: RESOURCE }), signal: AbortSignal.timeout(20000), redirect: 'error'
    });
    const data = await readJSON(response);
    if (!response.ok) {
      const temporary = response.status === 429 || response.status >= 500;
      const error = new DemoError(temporary ? 'ChatGPT authorization is temporarily unavailable. Try again later.' :
        `ChatGPT authorization could not be completed (HTTP ${response.status}). Try signing in again.`, temporary ? response.status : 401);
      error.oauthCode = typeof data.error === 'string' ? data.error : '';
      throw error;
    }
    return data;
  }
  function tokensFrom(data, previous) {
    const scopes = data.scope === undefined ? previous?.scopes : typeof data.scope === 'string' ? data.scope.split(/\s+/) : null;
    if (!scopes) throw new DemoError('ChatGPT did not return granted permissions. Sign in again.', 401);
    if (!scopes.includes(PLAN_SCOPE)) return {
      accessToken: null, refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
      expiresAt: now(), scopes, models: null, refresh: null
    };
    if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
        typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer' ||
        (data.scope === undefined && !previous) || (data.scope !== undefined && typeof data.scope !== 'string')) {
      throw new DemoError('ChatGPT returned incomplete credentials. Sign in again.', 401);
    }
    const refreshToken = data.refresh_token ?? previous?.refreshToken;
    if (typeof refreshToken !== 'string' || !refreshToken) throw new DemoError('ChatGPT did not return a renewable session. Sign in again.', 401);
    return {
      accessToken: data.access_token, refreshToken, expiresAt: now() + data.expires_in * 1000,
      scopes,
      models: previous?.models || null, refresh: null
    };
  }
  async function callback(item, url, res) {
    const pending = item?.pending;
    if (['state', 'code', 'client_id', 'error'].some(key => url.searchParams.getAll(key).length > 1)) throw new DemoError('Ambiguous sign-in response. Start again.', 400);
    if (!pending || pending.expiresAt <= now() || url.searchParams.get('state') !== pending.state) throw new DemoError('This sign-in expired or could not be verified. Start again.', 400);
    item.pending = null;
    const checkCurrent = () => {
      if (item.generation !== pending.generation || item.expiresAt <= now()) throw new DemoError('This sign-in was cancelled or superseded. Start again.', 409);
    };
    if (url.searchParams.has('error')) throw new DemoError('ChatGPT sign-in was cancelled or permission was declined. You can try again.', 400);
    let clientId = url.searchParams.get('client_id');
    if (pending.clientId !== 'dynamic_agent_client') {
      if (clientId && clientId !== pending.clientId) throw new DemoError('The returned ChatGPT registration did not match. Start again.', 400);
      clientId = pending.clientId;
    }
    if (!clientId || clientId === 'dynamic_agent_client' || !/^[\w-]{1,200}$/.test(clientId)) throw new DemoError('ChatGPT registration was incomplete. Start again.', 400);
    const code = url.searchParams.get('code');
    if (!code || code.length > 8192) throw new DemoError('ChatGPT did not return an authorization code. Start again.', 400);
    item.retryClientId = clientId;
    const doc = await discovery();
    const data = await tokenRequest(doc, { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: pending.verifier, redirect_uri: pending.redirectUri });
    if (typeof data.id_token !== 'string') throw new DemoError('ChatGPT did not return a verifiable identity.', 401);
    let identity;
    try { identity = await (verifyToken || verifyIdentity)(data.id_token, { clientId, nonce: pending.nonce, subject: pending.subject }, jwks); }
    catch { throw new DemoError('ChatGPT identity could not be verified. Start sign-in again.', 401); }
    checkCurrent();
    const existing = registration(clientId);
    if (existing && existing.subject !== identity.sub) throw new DemoError('The ChatGPT account did not match this registration.', 401);
    const tokens = tokensFrom(data);
    const email = typeof identity.email === 'string' ? identity.email.slice(0,254) : '';
    const account = existing || { id: clientId, subject: identity.sub, email, label: `${email || 'ChatGPT account'} · ${clientId.slice(-8)}`, welcomed: false };
    if (!existing) store.data.accounts.push(account);
    await store.save();
    checkCurrent();
    item.credentials.set(clientId, tokens); item.activeId = clientId; item.authError = null; item.retryClientId = null;
    sessions.delete(item.id); item.id = random(); item.expiresAt = now() + SESSION_MS; sessions.set(item.id, item); cookie(res, item.id);
  }
  async function access(item) {
    const id = item?.activeId, tokens = item?.credentials.get(id);
    if (!tokens) throw new DemoError('Continue with ChatGPT to use your plan.', 401);
    if (!tokens.scopes.includes(PLAN_SCOPE)) throw new DemoError('ChatGPT plan permission is not enabled. Enable it in Setup or choose your configured endpoint.', 403);
    if (tokens.expiresAt - now() > 60000) return tokens;
    if (!tokens.refresh) tokens.refresh = (async () => {
      try {
        const doc = await discovery();
        const data = await tokenRequest(doc, { grant_type: 'refresh_token', client_id: id, refresh_token: tokens.refreshToken });
        const next = tokensFrom(data, tokens);
        tokens.refreshed = next;
        if (item.credentials.get(id) !== tokens) throw new DemoError('The account changed. Sign in again.', 401);
        item.credentials.set(id, next);
        if (!next.scopes.includes(PLAN_SCOPE)) throw new DemoError('ChatGPT plan permission is no longer enabled. Enable it in Setup.', 403);
        return next;
      } catch (error) {
        if (terminalRefreshErrors.has(error.oauthCode)) {
          if (item.credentials.get(id) === tokens) item.credentials.delete(id);
          throw new DemoError('Your ChatGPT session ended. Sign in again.', 401);
        }
        if (error instanceof DemoError) throw error;
        throw new DemoError('Could not renew the ChatGPT session. Try again later.', 503);
      } finally { tokens.refresh = null; }
    })();
    return tokens.refresh;
  }
  async function logout(item) {
    if (!item) return { message: 'Signed out.' };
    item.pending = null; item.generation++;
    const id = item.activeId, tokens = item.credentials.get(id);
    item.credentials.delete(id); item.activeId = null; item.authError = null;
    let confirmed = !tokens?.refreshToken;
    if (tokens?.refreshToken) {
      // If refresh was already in flight, revoke its newest token as well.
      let latest = tokens;
      if (tokens.refresh) { try { latest = await tokens.refresh; } catch {} }
      latest = tokens.refreshed || latest;
      try {
        const doc = await discovery();
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await fetchImpl(doc.revocation_endpoint, {
              method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ token: latest.refreshToken, token_type_hint: 'refresh_token', client_id: id }),
              signal: AbortSignal.timeout(10000), redirect: 'error'
            });
            await response.body?.cancel();
            if (response.status === 200) { confirmed = true; break; }
            if (response.status < 500) break;
          } catch { /* A second attempt also covers a temporary network failure. */ }
          if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch {}
    }
    return { message: confirmed ? 'Signed out.' : 'Signed out locally. Remote revocation was not confirmed; disconnect Process Radar in ChatGPT settings if needed.' };
  }
  async function welcome(item) {
    const account = registration(item?.activeId);
    if (!account || !item.credentials.get(account.id)?.scopes.includes(PLAN_SCOPE)) throw new DemoError('Sign in with ChatGPT plan permission first.', 401);
    account.welcomed = true; await store.save();
  }
  return { session, snapshot, login, callback, access, logout, welcome };
}
