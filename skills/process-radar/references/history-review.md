# Reviewing past conversations

The purpose is to find concrete ways to improve the process. “Incorrect use” means an evidence-backed mismatch between the task, the person's stated intentions, and how the work was organized. A low score, a disappointing result, or the absence of a Playbook is not sufficient evidence.

## Establish the evidence boundary

Use the current conversation, explicitly selected conversations/exports, or a bounded history selection the user requests (for example: this repo, the last week, at most ten conversations). If the user says “scan my history” without a useful boundary, ask for the project/time range or files first. Do not crawl the entire home directory or unrelated projects. Do not open `.env`, authentication stores, raw reasoning, or system/developer messages to learn about process use.

History exposed by the host's conversation-list/read tools is usually preferable to guessing private storage formats. List lightweight titles/dates/project metadata, then read only the selected conversations. Do not assume every harness exposes past sessions. If access is unavailable, request exports and say what is missing. A global prompt-history index may omit assistant actions and outcomes; it is insufficient on its own to judge the process.

For user-selected local exports, use the bundled helper:

```sh
node /absolute/path/to/process-radar/scripts/extract-history.mjs \
  --input /approved/path/conversation.jsonl \
  --out /private/scratch/process-review.md
```

Repeat `--input` for multiple explicitly selected files. It understands common Codex and Claude Code JSONL message records, generic JSON `messages` exports, and text/Markdown exports. It does not automatically find sessions or read a directory. Input formats vary: review its coverage and skipped/truncated counts before drawing conclusions. It intentionally omits tool output and reasoning; missing evidence remains unknown. Redaction is best effort, not anonymization. Keep review artifacts out of source control and shared directories unless requested.

The helper performs no network calls. Reading excerpts into this conversation does expose them to the active model/provider. Mention that boundary before importing private history. Do not send them to the web demo, a separate API, or another service as a shortcut. Never repeat credentials found in the source.

## Look for process fit

Reconstruct what was known **at the time**: intent, constraints, chosen process, opportunities for human input, checks available, and observed outcomes. Users can intentionally change methods as they learn. Distinguish the initial plan from the process actually followed, and a local mistake from a recurring pattern.

Useful signals include:

- Unattended goal chasing where success depended on unstated taste, evolving requirements, or weak checks.
- Repeated “done” claims followed by evidence that the agent misunderstood the intended result.
- A person repeatedly needing to replan while the process only offered fixed approval gates.
- Reconstructing the same complex method across tasks when a maintained procedure might reduce work.
- Elaborate orchestration for a small one-off task, where its overhead outweighed its value.
- Manager/subagent agreement being treated as independent evidence without checking shared assumptions.
- Long runs without useful budget or stop boundaries, but only when duration, cost, or repeated attempts are actually visible.
- Choosing a model/harness that visibly struggled with its assigned job. Do not infer incapability from model size or brand alone.

These are hypotheses to test against the transcript, not automatic findings. Also record cases where the process fit well. A test-driven goal run with stable scope and strong checks can be a sensible choice. Human-guided exploration can be sensible without a precise automatic completion condition.

## Report

Start with coverage: which conversations, date range, how they were selected, and whether evidence was incomplete or truncated. For each substantial finding include:

1. The decision or moment, cited to a conversation/turn or export path and original line/message index. Quote only the minimum relevant excerpt, with secrets omitted.
2. The observed task constraint and actual behavior.
3. The plausible process mismatch and its observed consequence. Label inference, uncertainty, and confidence; do not claim a different process would certainly have succeeded.
4. A smaller or better-fitting intervention: a check, review boundary, context change, limit, or alternate process.

End with the one or two most useful habits to try next. If there is no convincing mismatch, say so. Do not manufacture findings to fill the report or call a partial sample “everything you ever did.” The rubric is advisory, not a leaderboard or personality assessment.

Only draw a retrospective radar if evidence supports its dimensions. Use **unknown** for unsupported observations; do not turn missing data into zero. The chart renderer requires all seven numeric values, so use a table for an incomplete observed profile. You may instead chart an explicitly labeled **suggested future process**, with its assumptions. Do not average unrelated tasks into a single personal score.

Report first. Changing settings, installing anything, rewriting a Playbook, or starting future monitoring requires a separate request.
