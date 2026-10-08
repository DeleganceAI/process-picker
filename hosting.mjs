import { DemoError } from './model.mjs';

export function readHostingConfig(env = process.env) {
  if (env.HOSTED && !['true', 'false'].includes(env.HOSTED)) throw new Error('HOSTED must be true or false.');
  if (env.HOSTED !== 'true') return { enabled: false };
  let url;
  try { url = new URL(env.PUBLIC_ORIGIN); } catch { throw new Error('Hosted mode requires PUBLIC_ORIGIN.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_ORIGIN must be a plain HTTPS origin.');
  }
  const limit = (name, fallback, max) => {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${name} must be an integer from 1 to ${max}.`);
    return value;
  };
  return {
    enabled: true, origin: url.origin, host: url.host,
    hourlyCalls: limit('DEMO_HOURLY_CALLS', 60, 10000),
    dailyCalls: limit('DEMO_DAILY_CALLS', 200, 100000),
    concurrency: limit('DEMO_CONCURRENCY', 2, 10)
  };
}

export function createCallLimiter(config, now = Date.now) {
  let calls = [], active = 0;
  return () => {
    const time = now();
    // Per-process abuse brake; restarts reset it. Enforce the money cap at the API project.
    calls = calls.filter(timestamp => timestamp > time - 86400000);
    if (active >= config.concurrency) throw new DemoError('The demo is busy. Please try again shortly.', 429);
    if (calls.length >= config.dailyCalls || calls.filter(timestamp => timestamp > time - 3600000).length >= config.hourlyCalls) {
      throw new DemoError('The shared demo request limit has been reached. Please try again later.', 429);
    }
    calls.push(time); active++;
    let released = false;
    return () => { if (!released) { released = true; active--; } };
  };
}
