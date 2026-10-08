export function estimateInputTokens(instructionCharacters, task = '', answers) {
  if (!Number.isSafeInteger(instructionCharacters) || instructionCharacters <= 0) return null;
  const taskCharacters = JSON.stringify({
    taskDescription: typeof task === 'string' ? task.trim() : '',
    ...(Array.isArray(answers) ? { intake: { answers } } : {})
  }).length;
  // A rough character estimate plus message framing; this is not a tokenizer or a usage bound.
  return Math.ceil((instructionCharacters + taskCharacters + 80) / 400) * 100;
}

export function usageNotice({ instructionCharacters, intakeInstructionCharacters, task, answers, stage = 'intake', source, model, outputCap, tokenField } = {}) {
  const reviewing = stage === 'recommend';
  const estimate = estimateInputTokens(reviewing ? instructionCharacters : intakeInstructionCharacters, task, reviewing ? answers : undefined);
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
    summary: `${modelName} · ${input} + reply/reasoning · call ${reviewing ? 2 : 1} of 2`,
    detail: `Two AI calls: first draft answers, then score only after you continue. This estimate covers ${reviewing ? 'the scoring instructions, task, and reviewed answers' : 'the intake instructions and task'} for this call, using about 4 characters per token. Actual usage varies by model and language. Reply and reasoning tokens are additional for each call. No automatic retries. ${limit}`
  };
}
