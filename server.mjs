import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DemoError, readConfig, recommend, validateTask } from './model.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
export const catalog = JSON.parse(await readFile(path.join(root, 'data/catalog.json'), 'utf8'));
const routes = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/radar.js', ['public/radar.js', 'text/javascript; charset=utf-8']],
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

export function createApp(config = readConfig(), fetchImpl = fetch) {
  let running = false;
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
      if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') throw new DemoError('Cross-origin requests are not allowed.', 403);
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname === '/api/catalog') return json(200, catalog);
      if (req.method === 'GET' && url.pathname === '/api/config') return json(200, {
        configured: config.configured, model: config.model,
        endpoint: config.endpoint ? new URL(config.endpoint).origin : null
      });
      if (req.method === 'POST' && url.pathname === '/api/recommend') {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new DemoError('Use Content-Type: application/json.', 415);
        if (running) throw new DemoError('A recommendation is already running. Please wait.', 429);
        const input = await body(req);
        const task = validateTask(input?.task);
        // Two requests may arrive while their bodies are being read.
        if (running) throw new DemoError('A recommendation is already running. Please wait.', 429);
        running = true;
        try { return json(200, await recommend(task, catalog, config, fetchImpl)); }
        finally { running = false; }
      }
      const route = routes.get(url.pathname);
      if (!route || req.method !== 'GET') return json(404, { error: 'Not found.' });
      const content = await readFile(path.join(root, route[0]));
      res.writeHead(200, { 'Content-Type': route[1] }); res.end(content);
    } catch (error) {
      json(error instanceof DemoError ? error.status : 500, { error: error instanceof DemoError ? error.message : 'Unable to serve this request.' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 to 65535.');
  const server = createApp();
  server.requestTimeout = 30000;
  server.on('error', error => { console.error(`Cannot start Process Radar: ${error.code || 'server error'}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Process Radar: http://127.0.0.1:${port}`));
}
