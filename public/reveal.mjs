// Reveal an already-complete result; this never controls model requests.
export function revealScores(count, reveal, { signal, reducedMotion = false, delay = 280 } = {}) {
  let index = 0, timer, settled = false, resolve;
  const finished = new Promise(done => { resolve = done; });
  function finish(completed) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    resolve(completed);
  }
  function cancel() { finish(false); }
  function showAll() {
    if (settled) return;
    clearTimeout(timer);
    while (index < count) reveal(index++);
    finish(true);
  }
  function next() {
    if (settled) return;
    reveal(index++);
    if (index === count) finish(true);
    else timer = setTimeout(next, delay);
  }
  if (signal?.aborted) cancel();
  else {
    signal?.addEventListener('abort', cancel, { once: true });
    if (reducedMotion || count === 0) showAll();
    else timer = setTimeout(next, 180);
  }
  return { finished, showAll, cancel };
}
