import test from 'node:test';
import assert from 'node:assert/strict';
import { revealScores } from '../public/reveal.mjs';

test('reveals each score once, in order, then completes', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const seen = [], reveal = revealScores(3, index => seen.push(index));
  assert.deepEqual(seen, []);
  context.mock.timers.tick(180);
  assert.deepEqual(seen, [0]);
  context.mock.timers.tick(280);
  assert.deepEqual(seen, [0, 1]);
  context.mock.timers.tick(280);
  assert.equal(await reveal.finished, true);
  assert.deepEqual(seen, [0, 1, 2]);
  reveal.showAll();
  context.mock.timers.tick(1000);
  assert.deepEqual(seen, [0, 1, 2]);
});

test('Show all reveals the remainder without waiting or duplicate callbacks', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const seen = [], reveal = revealScores(3, index => seen.push(index));
  context.mock.timers.tick(180);
  reveal.showAll();
  assert.equal(await reveal.finished, true);
  context.mock.timers.tick(1000);
  assert.deepEqual(seen, [0, 1, 2]);
});

test('reduced motion reveals the entire profile immediately', async () => {
  const seen = [], reveal = revealScores(3, index => seen.push(index), { reducedMotion: true });
  assert.deepEqual(seen, [0, 1, 2]);
  assert.equal(await reveal.finished, true);
});

test('an aborted run cannot reveal stale scores or complete', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController(), seen = [];
  const reveal = revealScores(3, index => seen.push(index), { signal: controller.signal });
  context.mock.timers.tick(180);
  controller.abort();
  reveal.showAll();
  context.mock.timers.tick(1000);
  assert.equal(await reveal.finished, false);
  assert.deepEqual(seen, [0]);
});

test('an already-aborted run reveals nothing, even with reduced motion', async () => {
  const controller = new AbortController(); controller.abort();
  const seen = [], reveal = revealScores(3, index => seen.push(index), { signal: controller.signal, reducedMotion: true });
  assert.equal(await reveal.finished, false);
  assert.deepEqual(seen, []);
});
