import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createAuth, registrationStore, verifyIdentity } from '../auth.mjs';
import { createApp } from '../server.mjs';
import { readConfig } from '../model.mjs';
import { sampleResult, sampleTask } from './fixtures.mjs';
import { httpRequest } from './http-request.mjs';

const issuer = 'https://auth.openai.com';
const planScope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const pair = await generateKeyPair('RS256');
const jwks = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256' }] });
const jwt = (claims = {}, key = pair.privateKey) => new SignJWT({
  sub: 'subject-one', nonce: 'nonce-one', email: 'reader@example.test',
  iss: issuer, aud: 'client-one', iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600, ...claims
}).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(key);
const responseStub = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; } });
const cookieFrom = res => res.headers['Set-Cookie'].split(';')[0];

function fixture() {
  const state = {
    time: Date.now(), nonce: 'nonce-one', subject: 'subject-one', tokenOverrides: {}, calls: [],
    store: { data: { hostId: 'urn:uuid:test-installation', accounts: [] }, async save() {} }
  };
  const fetchImpl = async (url, options = {}) => {
    state.calls.push({ url, options });
    if (url.endsWith('/.well-known/openid-configuration')) return Response.json({
      issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token',
      revocation_endpoint: issuer + '/revoke', jwks_uri: issuer + '/jwks'
    });
    if (url === issuer + '/token') {
      const params = new URLSearchParams(options.body);
      if (params.get('grant_type') === 'refresh_token') {
        if (state.refresh) return state.refresh(params);
        return Response.json({ access_token: 'refreshed-secret', refresh_token: 'rotated-refresh-secret', expires_in: 3600, token_type: 'Bearer' });
      }
      const response = Response.json({
        access_token: `access-secret-${params.get('client_id')}`, refresh_token: `refresh-secret-${params.get('client_id')}`,
        expires_in: 3600, token_type: 'Bearer', scope: planScope,
        id_token: await jwt({ aud: params.get('client_id'), nonce: state.nonce, sub: state.subject }),
        ...state.tokenOverrides
      });
      return state.exchange ? state.exchange(response, params) : response;
    }
    if (url === issuer + '/revoke') return state.revoke ? state.revoke(options) : new Response(null, { status: 200 });
    if (state.inference) return state.inference(url, options);
    throw new Error(`Unexpected test fetch: ${url}`);
  };
  const auth = createAuth({ store: state.store, fetchImpl, now: () => state.time,
    verifyToken: (token, expected) => verifyIdentity(token, expected, jwks) });
  const res = responseStub();
  const item = auth.session({ headers: {} }, res);
  async function login(input = {}, target = item) {
    const url = new URL(await auth.login(target, input, 'http://127.0.0.1:4317'));
    state.nonce = url.searchParams.get('nonce');
    return url;
  }
  async function finish(url, id = 'client-one', target = item) {
    const callback = new URL('http://127.0.0.1:4317/auth/callback');
    callback.search = new URLSearchParams({ state: url.searchParams.get('state'), code: 'test-code', client_id: id });
    await auth.callback(target, callback, res);
    return callback;
  }
  return { state, auth, item, res, fetchImpl, login, finish };
}

test('registration identity survives restarts and is stored owner-only without credentials', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'radar-auth-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'private', 'registrations.json');
  const store = await registrationStore(filename);
  assert.match(store.data.hostId, /^urn:uuid:/);
  store.data.accounts.push({ id: 'client-one', subject: 'subject-one', label: 'Reader', welcomed: false });
  await store.save();
  assert.deepEqual((await registrationStore(filename)).data, store.data);
  assert.equal((await stat(filename)).mode & 0o777, 0o600);
  assert.equal((await stat(path.dirname(filename))).mode & 0o777, 0o700);
  assert.doesNotMatch(await readFile(filename, 'utf8'), /access_token|refresh_token|accessToken|refreshToken/);
  await writeFile(filename, '{broken');
  await assert.rejects(registrationStore(filename), /Cannot read ChatGPT registration/);
});

test('ID tokens require a valid signature, issuer, audience, expiry, nonce, and subject', async () => {
  const expected = { clientId: 'client-one', nonce: 'nonce-one', subject: 'subject-one' };
  assert.equal((await verifyIdentity(await jwt(), expected, jwks)).sub, 'subject-one');
  for (const invalid of [
    { iss: 'https://evil.invalid' }, { aud: 'client-other' }, { exp: 1 },
    { nonce: 'another-nonce' }, { sub: 'another-subject' }, { sub: '' }, { sub: 123 },
    { nonce: undefined }, { exp: undefined }, { iat: undefined }, { sub: undefined }
  ]) await assert.rejects(verifyIdentity(await jwt(invalid), expected, jwks));
  const other = await generateKeyPair('RS256');
  await assert.rejects(verifyIdentity(await jwt({}, other.privateKey), expected, jwks));
});

test('ID tokens bind the authorized party and require it when audiences are multiple', async () => {
  const expected = { clientId: 'client-one', nonce: 'nonce-one', subject: 'subject-one' };
  for (const claims of [
    { azp: 'client-other' },
    { aud: ['client-one', 'client-other'] },
    { aud: ['client-one', 'client-other'], azp: 'client-other' }
  ]) await assert.rejects(verifyIdentity(await jwt(claims), expected, jwks));
  for (const claims of [
    { azp: 'client-one' },
    { aud: ['client-one', 'client-other'], azp: 'client-one' }
  ]) assert.equal((await verifyIdentity(await jwt(claims), expected, jwks)).sub, 'subject-one');
});

test('login uses PKCE and a stable installation, persists issued client ID, and rotates the cookie', async () => {
  const h = fixture();
  const oldCookie = cookieFrom(h.res);
  const url = await h.login();
  assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(url.searchParams.get('ext_agent_host_id'), h.state.store.data.hostId);
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:4317/auth/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(h.item.pending.verifier).digest('base64url'));
  assert.equal(url.searchParams.get('scope'), planScope);
  await h.finish(url);
  assert.notEqual(cookieFrom(h.res), oldCookie);
  assert.match(h.res.headers['Set-Cookie'], /HttpOnly; SameSite=Lax/);
  assert.equal(h.auth.session({ headers: { cookie: oldCookie } }, responseStub(), false), undefined);
  const snapshot = h.auth.snapshot(h.item);
  assert.equal(snapshot.signedIn, true);
  assert.equal(snapshot.planEnabled, true);
  assert.equal(snapshot.needsWelcome, true);
  assert.doesNotMatch(JSON.stringify(snapshot), /secret|subject-one|nonce|verifier/);
  assert.doesNotMatch(JSON.stringify(h.state.store.data), /secret|accessToken|refreshToken/);
  await h.auth.welcome(h.item);
  assert.equal(h.auth.snapshot(h.item).needsWelcome, false);
  const repeat = await h.login({ accountId: 'client-one' });
  assert.equal(repeat.searchParams.get('client_id'), 'client-one');
  assert.equal(repeat.searchParams.has('agent_name_hint'), false);
});

test('callback rejects missing, expired, repeated, ambiguous, and mismatched state before token exchange', async () => {
  for (const mode of ['missing', 'expired', 'mismatch', 'ambiguous']) {
    const h = fixture();
    const login = await h.login();
    const callback = new URL('http://127.0.0.1:4317/auth/callback');
    callback.search = new URLSearchParams({ code: 'test-code', client_id: 'client-one', state: login.searchParams.get('state') });
    if (mode === 'missing') callback.searchParams.delete('state');
    if (mode === 'expired') h.state.time += 10 * 60 * 1000;
    if (mode === 'mismatch') callback.searchParams.set('state', 'attacker-state');
    if (mode === 'ambiguous') callback.searchParams.append('state', login.searchParams.get('state'));
    await assert.rejects(h.auth.callback(h.item, callback, h.res), /expired|verified|Ambiguous/);
    assert.equal(h.state.calls.filter(call => call.url.endsWith('/token')).length, 0);
  }
  const h = fixture();
  const callback = await h.finish(await h.login());
  const exchanges = h.state.calls.length;
  await assert.rejects(h.auth.callback(h.item, callback, h.res), /expired|verified/);
  assert.equal(h.state.calls.length, exchanges);
  await assert.rejects(h.finish(await h.login({ accountId: 'client-one' }), 'client-other'), /registration did not match/);
});

test('a forged callback does not cancel the valid pending browser login', async () => {
  const h = fixture(), login = await h.login();
  await assert.rejects(h.auth.callback(h.item, new URL('http://127.0.0.1:4317/auth/callback?state=forged&code=x&client_id=client-one'), h.res), /verified/);
  await h.finish(login);
  assert.equal(h.auth.snapshot(h.item).signedIn, true);
});

test('logout while a callback exchanges credentials prevents a late sign-in', async () => {
  const h = fixture();
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  h.state.exchange = async response => { entered(); await gate; return response; };
  const callback = h.finish(await h.login());
  await started;
  await h.auth.logout(h.item);
  release();
  await assert.rejects(callback, /cancelled|superseded/);
  assert.equal(h.auth.snapshot(h.item).signedIn, false);
  assert.equal(h.item.credentials.size, 0);
});

test('browser sessions have isolated credentials and registered accounts cannot change subject', async () => {
  const h = fixture();
  await h.finish(await h.login());
  const second = h.auth.session({ headers: {} }, responseStub());
  assert.equal(h.auth.snapshot(second).signedIn, false);
  await assert.rejects(h.auth.access(second), /Continue with ChatGPT/);
  h.state.subject = 'subject-two';
  await h.finish(await h.login({}, second), 'client-two', second);
  assert.equal((await h.auth.access(second)).accessToken, 'access-secret-client-two');
  assert.equal((await h.auth.access(h.item)).accessToken, 'access-secret-client-one');
  await assert.rejects(h.finish(await h.login({ accountId: 'client-one' })), /identity could not be verified/);
});

test('identity-only consent is signed in but cannot list models or invoke plan inference', async () => {
  const h = fixture();
  h.state.tokenOverrides = { scope: 'openid profile email', access_token: undefined, refresh_token: undefined };
  await h.finish(await h.login());
  assert.equal(h.auth.snapshot(h.item).signedIn, true);
  assert.equal(h.auth.snapshot(h.item).planEnabled, false);
  await assert.rejects(h.auth.access(h.item), error => error.status === 403 && /permission/.test(error.message));
});

test('refresh is serialized, rotates tokens, and preserves scopes omitted from the response', async () => {
  const h = fixture();
  await h.finish(await h.login());
  h.state.time += 3600 * 1000;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const refreshRequests = [];
  h.state.refresh = async params => {
    refreshRequests.push(params);
    await gate;
    return Response.json({ access_token: 'new-access-secret', refresh_token: 'new-refresh-secret', expires_in: 3600, token_type: 'Bearer' });
  };
  const a = h.auth.access(h.item), b = h.auth.access(h.item);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refreshRequests.length, 1);
  release();
  assert.equal((await a).accessToken, 'new-access-secret');
  assert.equal(await a, await b);
  assert.equal(h.auth.snapshot(h.item).planEnabled, true);
  h.state.time += 3600 * 1000;
  await h.auth.access(h.item);
  assert.equal(refreshRequests[1].get('refresh_token'), 'new-refresh-secret');
});

test('terminal refresh failures clear credentials while temporary failures allow retry', async () => {
  for (const [code, status, signedIn] of [['invalid_grant', 400, false], ['temporarily_unavailable', 503, true]]) {
    const h = fixture();
    await h.finish(await h.login());
    h.state.time += 3600 * 1000;
    h.state.refresh = () => Response.json({ error: code, error_description: 'provider-secret' }, { status });
    await assert.rejects(h.auth.access(h.item), error => !error.message.includes('provider-secret'));
    assert.equal(h.auth.snapshot(h.item).signedIn, signedIn);
    if (signedIn) {
      h.state.refresh = null;
      assert.equal((await h.auth.access(h.item)).accessToken, 'refreshed-secret');
    }
  }
});

test('an old terminal refresh cannot erase credentials from a newer sign-in', async () => {
  const h = fixture();
  await h.finish(await h.login());
  h.state.time += 3600 * 1000;
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  h.state.refresh = async () => { entered(); await gate; return Response.json({ error: 'invalid_grant' }, { status: 400 }); };
  const oldRefresh = h.auth.access(h.item);
  await started;
  h.state.tokenOverrides = { access_token: 'new-signin-secret' };
  await h.finish(await h.login({ accountId: 'client-one' }));
  release();
  await assert.rejects(oldRefresh, /session ended/);
  assert.equal(h.auth.snapshot(h.item).signedIn, true);
  assert.equal((await h.auth.access(h.item)).accessToken, 'new-signin-secret');
});

test('logout drops local access even if remote revocation fails, and revokes the correct registration', async () => {
  const h = fixture();
  await h.finish(await h.login());
  h.state.revoke = options => {
    const params = new URLSearchParams(options.body);
    assert.equal(params.get('token'), 'refresh-secret-client-one');
    assert.equal(params.get('client_id'), 'client-one');
    return new Response(null, { status: 400 });
  };
  const result = await h.auth.logout(h.item);
  assert.match(result.message, /Signed out locally.*not confirmed/);
  assert.equal(h.auth.snapshot(h.item).signedIn, false);
  await assert.rejects(h.auth.access(h.item), /Continue with ChatGPT/);
});

test('logout racing a successful refresh revokes the newly rotated refresh token', async () => {
  const h = fixture();
  await h.finish(await h.login());
  h.state.time += 3600 * 1000;
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  h.state.refresh = async () => {
    entered(); await gate;
    return Response.json({ access_token: 'late-access-secret', refresh_token: 'late-rotated-secret', expires_in: 3600, token_type: 'Bearer' });
  };
  const revoked = [];
  h.state.revoke = options => { revoked.push(new URLSearchParams(options.body).get('token')); return new Response(null, { status: 200 }); };
  const refresh = h.auth.access(h.item);
  await started;
  const logout = h.auth.logout(h.item);
  assert.equal(h.auth.snapshot(h.item).signedIn, false);
  release();
  await assert.rejects(refresh, /account changed/);
  assert.equal((await logout).message, 'Signed out.');
  assert.deepEqual(revoked, ['late-rotated-secret']);
  assert.equal(h.item.credentials.size, 0);
});

async function start(t, h) {
  const config = readConfig({ OPENAI_API_KEY: 'owner-key-must-not-be-used', LLM_MODEL: 'owner-model', LLM_BASE_URL: 'https://api.openai.com/v1' });
  assert.equal(config.configured, true);
  const server = createApp(config, h.fetchImpl, h.auth);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (base, route, body, cookie = '', headers = {}) => fetch(base + route, {
  method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: JSON.stringify(body)
});
async function httpLogin(base, h) {
  const begun = await post(base, '/api/auth/login', {});
  assert.equal(begun.status, 200);
  const cookie = begun.headers.get('set-cookie').split(';')[0];
  const authorize = new URL((await begun.json()).url);
  h.state.nonce = authorize.searchParams.get('nonce');
  const callback = new URL(base + '/auth/callback');
  callback.search = new URLSearchParams({ state: authorize.searchParams.get('state'), client_id: 'client-one', code: 'test-code' });
  const navigation = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
  const signedIn = await httpRequest(callback, { headers: { Cookie: cookie, ...navigation } });
  assert.equal(signedIn.status, 303);
  assert.equal(signedIn.headers.location, '/?signin=success');
  const signedInCookie = signedIn.headers['set-cookie'][0].split(';')[0];
  // A browser keeps the cross-site classification across the callback's redirect.
  const landing = await httpRequest(new URL(signedIn.headers.location, base), {
    headers: { Cookie: signedInCookie, ...navigation }
  });
  assert.equal(landing.status, 200);
  assert.match(landing.headers['content-type'], /text\/html/);
  return signedInCookie;
}

test('HTTP auth requires same-origin JSON, permits the callback return navigation, and hides secrets', async t => {
  const h = fixture(), base = await start(t, h);
  for (const headers of [{ Origin: '' }, { Origin: 'https://evil.invalid' }, { 'Content-Type': 'text/plain' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await post(base, '/api/auth/login', {}, '', headers)).status, 403);
  }
  const denied = await fetch(base + '/auth/callback?state=forged&code=forged&client_id=client-one', { headers: { 'Sec-Fetch-Site': 'cross-site' }, redirect: 'manual' });
  assert.equal(denied.headers.get('location'), '/?signin=error');
  const errorPage = await httpRequest(new URL(denied.headers.get('location'), base), {
    headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' }
  });
  assert.equal(errorPage.status, 200);
  assert.match(errorPage.headers['content-type'], /text\/html/);
  assert.equal(h.state.calls.length, 0);
  const cookie = await httpLogin(base, h);
  const session = await fetch(base + '/api/auth/session', { headers: { Cookie: cookie } }).then(r => r.text());
  assert.equal(JSON.parse(session).signedIn, true);
  assert.doesNotMatch(session, /secret|owner-key|accessToken|refreshToken/);
});

test('HTTP subscription requests enforce the account model list and never fall back to owner credentials', async t => {
  const h = fixture(), base = await start(t, h);
  const inferenceCalls = [];
  h.state.inference = async (url, options) => {
    inferenceCalls.push({ url, options });
    assert.equal(options.headers.Authorization, 'Bearer access-secret-client-one');
    if (url.endsWith('/models')) return Response.json({ models: [{ slug: 'account-model', display_name: 'Account Model', visibility: 'list', metadata: 'x'.repeat(1024 * 1024) }] });
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(JSON.parse(options.body).model, 'account-model');
    return new Response(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: JSON.stringify(sampleResult) })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed' } })}\n\n`);
  };
  const unspecified = await post(base, '/api/recommend', { task: sampleTask, model: 'account-model' });
  assert.equal(unspecified.status, 400);
  assert.equal(inferenceCalls.length, 0);
  const unauthenticated = await post(base, '/api/recommend', { task: sampleTask, source: 'chatgpt', model: 'account-model' });
  assert.equal(unauthenticated.status, 401);
  assert.equal(inferenceCalls.length, 0);
  const cookie = await httpLogin(base, h);
  const discovery = await fetch(base + '/api/auth/models', { headers: { Cookie: cookie } });
  assert.equal(discovery.status, 200);
  assert.deepEqual(await discovery.json(), { models: [{ id: 'account-model', name: 'Account Model' }] });
  assert.deepEqual(inferenceCalls.map(call => call.url), ['https://api.openai.com/v1/models']);
  const invalid = await post(base, '/api/recommend', { task: sampleTask, source: 'chatgpt', model: 'owner-model' }, cookie);
  assert.equal(invalid.status, 400);
  assert.deepEqual(inferenceCalls.map(call => call.url), ['https://api.openai.com/v1/models']);
  const valid = await post(base, '/api/recommend', { task: sampleTask, source: 'chatgpt', model: 'account-model' }, cookie);
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), sampleResult);
  h.state.inference = async () => Response.json({ error: { code: 'subscription_sharing_usage_limit_exceeded' } }, { status: 429 });
  const limited = await post(base, '/api/recommend', { task: sampleTask, source: 'chatgpt', model: 'account-model' }, cookie);
  assert.equal(limited.status, 429);
  assert.equal(h.state.calls.filter(call => call.url.includes('chat/completions')).length, 0);
});
