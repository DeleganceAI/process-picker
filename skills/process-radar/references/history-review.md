# Reviewing past conversations

The purpose is to find concrete ways to improve the process. “Incorrect use” means an evidence-backed mismatch between the task, the person's stated intentions, and how the work was organized. A low score, a disappointing result, or the absence of a Playbook is not sufficient evidence.

## Establish the evidence boundary

Use the current conversation, explicitly selected conversations/exports, or a bounded history selection the user requests (for example: this repo, the last week, at most ten conversations). If no useful history boundary is available, limit the preliminary assessment to the context already present and disclose that coverage; do not import additional history to fill the nine answers. Do not crawl the entire home directory or unrelated projects. Do not open `.env`, authentication stores, raw reasoning, or system/developer messages to learn about process use.

History exposed by the host's conversation-list/read tools is usually preferable to guessing private storage formats. List lightweight titles/dates/project metadata, then read only the selected conversations. Do not assume every harness exposes past sessions. If access is unavailable, say what evidence is missing and proceed with the available context; do not require exports before dimension scoring. Missing transcripts cannot support a verdict about past behavior. A global prompt-history index may omit assistant actions and outcomes; it is insufficient on its own to judge the process.

For user-selected local exports, use the bundled helper:

```sh
node /absolute/path/to/process-radar/scripts/extract-history.mjs \
  --input /approved/path/conversation.jsonl \
  --out /private/scratch/process-review.md
```

Repeat `--input` for multiple explicitly selected files. It understands common Codex and Claude Code JSONL message records, generic JSON `messages` exports, and text/Markdown exports. It does not automatically find sessions or read a directory. Input formats vary: review its coverage and skipped/truncated counts before drawing conclusions. It intentionally omits tool output and reasoning; missing evidence remains unknown. Redaction is best effort, not anonymization. Keep review artifacts out of source control and shared directories unless requested.

The helper performs no network calls. Reading excerpts into this conversation does expose them to the active model/provider. Mention that boundary before importing private history. Do not send them to the web demo, a separate API, or another service as a shortcut. Never repeat credentials found in the source.

## Score the task, then examine process fit

First reconstruct the task context **as known at the decision being reviewed**. Follow Stage 0 in SKILL.md: estimate all nine answers from available evidence, label assumptions and confidence, and output them without asking the user for more information. Then follow Stage 1: read the dimension rubric, derive all seven scores from those answers, and output the requirement table before consulting the process catalog or recommending an alternative. Carry uncertainty into provisional scores or `unknown` without stopping for clarification. Do this separately for distinct tasks; do not average them into a personal profile. Do not use a later failure, the chosen approach, or a catalog profile to backfill the requirements.

Then follow Stage 2 and compare those scores with the intended process and the process actually followed. Users can intentionally change methods as they learn. Distinguish a poor process choice from assistant noncompliance, a tool/harness limitation, or insufficient evidence. Agent deviations are not evidence that the user selected the wrong process. Connect each proposed adaptation to the scored requirement it addresses, and distinguish a local mistake from a recurring pattern.

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

Start with coverage: which conversations, date range, how they were selected, and whether evidence was incomplete or truncated. Include the nine estimated answers and the resulting requirement assessment before the process-fit conclusions. For each substantial finding include:

1. The decision or moment, cited to a conversation/turn or export path and original line/message index. Quote only the minimum relevant excerpt, with secrets omitted.
2. The observed task constraint and actual behavior.
3. The plausible mismatch, its attribution (process choice, assistant execution, tool/harness, or unknown), and its observed consequence. Label inference, uncertainty, and confidence; do not claim a different process would certainly have succeeded.
4. A smaller or better-fitting intervention: a check, review boundary, context change, limit, or alternate process.

End with the one or two most useful habits to try next. If there is no convincing mismatch, say so. Do not manufacture findings to fill the report or call a partial sample “everything you ever did.” The rubric is advisory, not a leaderboard or personality assessment.

Only chart a task's recorded requirement assessment when evidence supports all seven scores. Use **unknown** for unsupported requirements; do not turn missing data into zero. The chart renderer requires all seven numeric values, so use a table for an incomplete assessment. Keep the task requirements distinct from the observed process and the selected reference profile. Do not replace the requirement scores with scores for a suggested process or average unrelated tasks into a personal score.

Report first. Changing settings, installing anything, rewriting a Playbook, or starting future monitoring requires a separate request.
