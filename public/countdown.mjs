export function countdown(seconds, onTick, onComplete, {
  now = () => performance.now(),
  setTimeout: schedule = globalThis.setTimeout,
  clearTimeout: unschedule = globalThis.clearTimeout
} = {}) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Countdown seconds must be finite and nonnegative.');
  let milliseconds = seconds * 1000, deadline = now() + milliseconds;
  let timer, paused = false, settled = false;
  const render = () => onTick({ remaining: Math.ceil(milliseconds / 1000), paused });

  function tick() {
    if (paused || settled) return;
    milliseconds = Math.max(0, deadline - now());
    if (milliseconds === 0) {
      settled = true;
      render();
      onComplete();
      return;
    }
    render();
    if (!paused && !settled) {
      unschedule(timer);
      timer = schedule(tick, milliseconds % 1000 || 1000);
    }
  }

  function pause() {
    if (paused || settled) return;
    milliseconds = Math.max(0, deadline - now());
    unschedule(timer);
    paused = true;
    render();
  }

  function resume() {
    if (!paused || settled) return;
    paused = false;
    deadline = now() + milliseconds;
    tick();
  }

  function cancel() {
    settled = true;
    unschedule(timer);
  }

  tick();
  return { pause, resume, cancel };
}
