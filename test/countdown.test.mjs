import test from 'node:test';
import assert from 'node:assert/strict';
import { countdown } from '../public/countdown.mjs';

function setup(context) {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let time = 0, completed = 0;
  const ticks = [];
  const timer = countdown(7, value => ticks.push(value), () => completed++, { now: () => time });
  return {
    timer, ticks, completed: () => completed,
    advance(milliseconds) { time += milliseconds; context.mock.timers.tick(milliseconds); }
  };
}

test('starts at seven and completes exactly once after seven active seconds', context => {
  const clock = setup(context);
  assert.deepEqual(clock.ticks, [{ remaining: 7, paused: false }]);
  for (let i = 0; i < 6; i++) clock.advance(1000);
  assert.equal(clock.completed(), 0);
  assert.equal(clock.ticks.at(-1).remaining, 1);
  clock.advance(1000);
  assert.deepEqual(clock.ticks.map(tick => tick.remaining), [7, 6, 5, 4, 3, 2, 1, 0]);
  assert.equal(clock.completed(), 1);
  clock.timer.pause(); clock.timer.resume(); clock.timer.cancel();
  clock.advance(10000);
  assert.equal(clock.completed(), 1);
  assert.equal(clock.ticks.length, 8);
});

test('pause freezes fractional active time and resume continues from it', context => {
  const clock = setup(context);
  clock.advance(1250);
  clock.timer.pause(); clock.timer.pause();
  assert.deepEqual(clock.ticks.at(-1), { remaining: 6, paused: true });
  const pausedTicks = clock.ticks.length;
  clock.advance(30000);
  assert.equal(clock.ticks.length, pausedTicks);
  assert.equal(clock.completed(), 0);
  clock.timer.resume(); clock.timer.resume();
  assert.deepEqual(clock.ticks.at(-1), { remaining: 6, paused: false });
  clock.advance(749);
  assert.equal(clock.ticks.at(-1).remaining, 6);
  clock.advance(1);
  assert.equal(clock.ticks.at(-1).remaining, 5);
  clock.advance(4999);
  assert.equal(clock.completed(), 0);
  clock.advance(1);
  assert.equal(clock.completed(), 1);
});

test('a delayed timer uses elapsed time and never completes twice', context => {
  const clock = setup(context);
  clock.advance(4000);
  assert.deepEqual(clock.ticks.at(-1), { remaining: 3, paused: false });
  assert.equal(clock.completed(), 0);
  clock.advance(60000);
  assert.deepEqual(clock.ticks.at(-1), { remaining: 0, paused: false });
  assert.equal(clock.completed(), 1);
  clock.advance(60000);
  assert.equal(clock.completed(), 1);
});

test('cancel prevents ticks and completion, including after a pause', context => {
  const clock = setup(context);
  clock.advance(1000);
  clock.timer.pause();
  clock.timer.cancel(); clock.timer.cancel(); clock.timer.resume();
  const ticks = clock.ticks.length;
  clock.advance(60000);
  assert.equal(clock.ticks.length, ticks);
  assert.equal(clock.completed(), 0);
});

test('cancel prevents an active countdown from completing', context => {
  const clock = setup(context);
  clock.timer.cancel();
  clock.advance(7000);
  assert.deepEqual(clock.ticks, [{ remaining: 7, paused: false }]);
  assert.equal(clock.completed(), 0);
});

test('zero completes immediately and invalid durations are rejected', () => {
  const ticks = [];
  let completed = 0;
  countdown(0, value => ticks.push(value), () => completed++);
  assert.deepEqual(ticks, [{ remaining: 0, paused: false }]);
  assert.equal(completed, 1);
  for (const seconds of [-1, NaN, Infinity]) {
    assert.throws(() => countdown(seconds, () => {}, () => {}), RangeError);
  }
});
