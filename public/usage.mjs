export function estimateInputTokens(instructionCharacters, task = '') {
  if (!Number.isSafeInteger(instructionCharacters) || instructionCharacters <= 0) return null;
  const taskCharacters = JSON.stringify({ taskDescription: typeof task === 'string' ? task.trim() : '' }).length;
  // A rough character estimate plus message framing; this is not a tokenizer or a usage bound.
  return Math.ceil((instructionCharacters + taskCharacters + 80) / 400) * 100;
}

export function usageNotice({ instructionCharacters, task, source, model, outputCap, tokenField } = {}) {
  const estimate = estimateInputTokens(instructionCharacters, task);
  const modelName = typeof model === 'string' && model.trim() ? model.trim() : 'Choose a model';
  const input = estimate === null ? 'Input estimate unavailable' : `~${estimate.toLocaleString('en-US')} input tokens`;
  let limit = 'Reply and reasoning usage are additional and vary by model.';
  if (source === 'chatgpt') {
    limit = 'ChatGPT mode has no local output-token cap; reply and reasoning usage can vary.';
  } else if (source === 'endpoint' && Number.isSafeInteger(outputCap) && outputCap > 0) {
    if (tokenField === 'max_completion_tokens') {
      limit = `Endpoint requests a ${outputCap.toLocaleString('en-US')}-token completion cap, including reasoning where supported.`;
    } else if (tokenField === 'max_tokens') {
      limit = `Endpoint requests a ${outputCap.toLocaleString('en-US')}-token output cap; reasoning treatment depends on the provider.`;
    }
  }
  return {
    summary: `${modelName} · ${input} + reply/reasoning · 1 AI request`,
    detail: `Rough input estimate includes the rubric and task, using about 4 characters per token. Actual usage varies by model and language. No automatic retries. ${limit}`
  };
}
