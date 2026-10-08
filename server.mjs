import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildMessages, DemoError, readConfig, recommend, validateTask } from './model.mjs';
import { createAuth, registrationStore } from './auth.mjs';
import { listChatGPTModels, recommendWithChatGPT } from './chatgpt-model.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
export const catalog = JSON.parse(await readFile(path.join(root, 'data/catalog.json'), 'utf8'));
const routes = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/usage.mjs', ['public/usage.mjs', 'text/javascript; charset=utf-8']],
  ['/reveal.mjs', ['public/reveal.mjs', 'text/javascript; charset=utf-8']],
  ['/radar.js', ['public/radar.js', 'text/javascript; charset=utf-8']],
  ['/radar-svg.mjs', ['skills/process-radar/scripts/radar-svg.mjs', 'text/javascript; charset=utf-8']],
  ['/cheat-sheet.md', ['docs/cheat-sheet.md', 'text/markdown; charset=utf-8']]
]);

async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new DemoError('Request body is too large.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new DemoError('Expected a JSON request body.', 400); }
}

export function createApp(config = readConfig(), fetchImpl = fetch, auth = null) {
  let running = false;
  const instructionCharacters = buildMessages('Estimate a task before running it.', catalog)[0].content.length;
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (status, data) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data));
    };
    try {
      const allowedHosts = [`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`];
      if (!allowedHosts.includes(req.headers.host)) throw new DemoError('This demo accepts local requests only.', 403);
      const origin = `http://${req.headers.host}`;
      const url = new URL(req.url, origin);
      const callback = req.method === 'GET' && url.pathname === '/auth/callback';
      // OAuth redirects retain cross-site metadata when they land on the static home page.
      const pageNavigation = req.method === 'GET' && url.pathname === '/' &&
        req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
      if (!callback && !pageNavigation && ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site')) throw new DemoError('Cross-origin requests are not allowed.', 403);
      if (req.method === 'GET' && url.pathname === '/' && url.hostname === 'localhost') {
        res.writeHead(302, { Location: `http://127.0.0.1:${req.socket.localPort}/${url.search}` }); return res.end();
      }
      if (callback || url.pathname.startsWith('/api/auth/')) {
        if (!auth) throw new DemoError('ChatGPT sign-in is unavailable. Restart the demo with npm start.', 503);
        if (url.hostname !== '127.0.0.1') throw new DemoError('Open the demo at 127.0.0.1 to sign in.', 400);
        if (req.method === 'POST') {
          if (req.headers.origin !== origin || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new DemoError('Sign-in actions require a same-origin JSON request.', 403);
          if (running) throw new DemoError('Wait for the recommendation to finish before changing accounts.', 409);
        }
        const session = auth.session(req, res, !callback);
        if (callback) {
          let result = 'success';
          try { await auth.callback(session, url, res); }
          catch (error) {
            result = 'error';
            if (session) session.authError = error instanceof DemoError ? error.message : 'ChatGPT sign-in could not complete. Please try again.';
          }
          res.writeHead(303, { Location: `/?signin=${result}` }); return res.end();
        }
        if (req.method === 'GET' && url.pathname === '/api/auth/session') return json(200, auth.snapshot(session));
        if (req.method === 'GET' && url.pathname === '/api/auth/models') {
          const tokens = await auth.access(session);
          tokens.models = await listChatGPTModels(tokens.accessToken, fetchImpl);
          return json(200, { models: tokens.models });
        }
        if (req.method === 'POST' && url.pathname === '/api/auth/login') return json(200, { url: await auth.login(session, await body(req), origin) });
        if (req.method === 'POST' && url.pathname === '/api/auth/logout') { await body(req); return json(200, await auth.logout(session)); }
        if (req.method === 'POST' && url.pathname === '/api/auth/welcome') { await body(req); await auth.welcome(session); return json(200, {}); }
        return json(404, { error: 'Not found.' });
      }
      if (req.method === 'GET' && url.pathname === '/api/catalog') return json(200, catalog);
      if (req.method === 'GET' && url.pathname === '/api/config') return json(200, {
        configured: config.configured, model: config.model,
        endpoint: config.endpoint ? new URL(config.endpoint).origin : null,
        usage: { instructionCharacters, outputCap: config.maxTokens, tokenField: config.tokenField }
      });
      if (req.method === 'POST' && url.pathname === '/api/recommend') {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new DemoError('Use Content-Type: application/json.', 415);
        if (running) throw new DemoError('A recommendation is already running. Please wait.', 429);
        const input = await body(req);
        const task = validateTask(input?.task);
        const source = input.source;
        if (!['chatgpt', 'endpoint'].includes(source)) throw new DemoError('Choose ChatGPT or your configured endpoint.', 400);
        // Two requests may arrive while their bodies are being read.
        if (running) throw new DemoError('A recommendation is already running. Please wait.', 429);
        running = true;
        try {
          if (source === 'chatgpt') {
            if (!auth) throw new DemoError('ChatGPT sign-in is unavailable. Restart the demo.', 503);
            const session = auth.session(req, res, false);
            const tokens = await auth.access(session);
            if (!tokens.models) tokens.models = await listChatGPTModels(tokens.accessToken, fetchImpl);
            if (!tokens.models.some(model => model.id === input.model)) throw new DemoError('Choose a model available to your ChatGPT account.', 400);
            const result = await recommendWithChatGPT(task, catalog, { accessToken: tokens.accessToken, model: input.model, timeout: config.timeout }, fetchImpl);
            // A sign-out or account switch in another tab must not publish stale account work.
            if (session.credentials.get(session.activeId) !== tokens) throw new DemoError('Your ChatGPT account changed. Submit again.', 409);
            return json(200, result);
          }
          return json(200, await recommend(task, catalog, config, fetchImpl));
        }
        finally { running = false; }
      }
      const route = routes.get(url.pathname);
      if (!route || req.method !== 'GET') return json(404, { error: 'Not found.' });
      const content = await readFile(path.join(root, route[0]));
      res.writeHead(200, { 'Content-Type': route[1] }); res.end(content);
    } catch (error) {
      json(error instanceof DemoError ? error.status : 500, {
        error: error instanceof DemoError ? error.message : 'Unable to serve this request.',
        ...(error instanceof DemoError && error.code ? { code: error.code } : {})
      });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 to 65535.');
  const store = await registrationStore(path.join(root, '.local-auth', 'registrations.json'));
  const server = createApp(readConfig(), fetch, createAuth({ store }));
  server.requestTimeout = 30000;
  server.on('error', error => { console.error(`Cannot start Process Radar: ${error.code || 'server error'}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Process Radar: http://127.0.0.1:${port}`));
}
