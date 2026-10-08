import test from 'node:test';
import assert from 'node:assert/strict';
import { createCallLimiter, readHostingConfig } from '../hosting.mjs';

const hosted = overrides => readHostingConfig({ HOSTED: 'true', PUBLIC_ORIGIN: 'https://demo.example', ...overrides });
const limited = action => assert.throws(action, error => error.status === 429);

test('hosted configuration is explicit, HTTPS-only and bounded', () => {
  assert.deepEqual(readHostingConfig({}), { enabled: false });
  assert.deepEqual(readHostingConfig({ HOSTED: 'false', PUBLIC_ORIGIN: 'invalid' }), { enabled: false });
  assert.deepEqual(hosted(), {
    enabled: true, origin: 'https://demo.example', host: 'demo.example',
    hourlyCalls: 60, dailyCalls: 200, concurrency: 2
  });
  assert.equal(hosted({ PUBLIC_ORIGIN: 'https://demo.example:8443/' }).host, 'demo.example:8443');
  for (const HOSTED of ['yes', 'TRUE', '1']) assert.throws(() => readHostingConfig({ HOSTED }));
  for (const PUBLIC_ORIGIN of [undefined, '', 'invalid', 'http://demo.example', 'https://user:pass@demo.example', 'https://demo.example/path', 'https://demo.example/?key=x', 'https://demo.example/#fragment']) {
    assert.throws(() => hosted({ PUBLIC_ORIGIN }), String(PUBLIC_ORIGIN));
  }
  for (const [name, max] of [['DEMO_HOURLY_CALLS', 10000], ['DEMO_DAILY_CALLS', 100000], ['DEMO_CONCURRENCY', 10]]) {
    for (const value of ['0', '-1', '1.5', 'NaN', String(max + 1)]) assert.throws(() => hosted({ [name]: value }), `${name}=${value}`);
  }
  assert.deepEqual(hosted({ DEMO_HOURLY_CALLS: '4', DEMO_DAILY_CALLS: '12', DEMO_CONCURRENCY: '1' }), {
    enabled: true, origin: 'https://demo.example', host: 'demo.example', hourlyCalls: 4, dailyCalls: 12, concurrency: 1
  });
});

test('limiter counts 60 attempts per rolling hour, including released calls', () => {
  let now = 1000;
  const claim = createCallLimiter(hosted(), () => now);
  for (let i = 0; i < 60; i++) claim()();
  limited(claim);
  now += 3600000 - 1;
  limited(claim);
  now++;
  claim()();
});

test('limiter counts 200 attempts per rolling day with an exact expiry boundary', () => {
  let now = 1000;
  const claim = createCallLimiter(hosted(), () => now);
  for (let hour = 0; hour < 4; hour++) {
    now = 1000 + hour * 3600000;
    for (let i = 0; i < 50; i++) claim()();
  }
  limited(claim);
  now = 1000 + 86400000 - 1;
  limited(claim);
  now++;
  for (let i = 0; i < 50; i++) claim()();
  limited(claim);
});

test('concurrent claims are bounded and release is idempotent', () => {
  const claim = createCallLimiter(hosted(), () => 1000);
  const first = claim(), second = claim();
  limited(claim);
  first(); first();
  const third = claim();
  limited(claim);
  second(); third();
  const fourth = claim(), fifth = claim();
  limited(claim);
  fourth(); fifth();
});

test('rejected concurrent attempts do not consume quota; completed attempts do', () => {
  const claim = createCallLimiter(hosted({ DEMO_HOURLY_CALLS: '2', DEMO_CONCURRENCY: '1' }), () => 1000);
  const release = claim();
  for (let i = 0; i < 10; i++) limited(claim);
  release();
  claim()();
  limited(claim);
});
