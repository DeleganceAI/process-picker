# Process Radar skill

The portable skill lives in [`skills/process-radar/`](../skills/process-radar/SKILL.md). Copy that whole folder, including its `references/` and `scripts/` directories, into a harness's skills directory. It uses the model already running in the harness; it does not call the demo's GPT-5.5 endpoint or require an API key.

## Install

From the root of this repository, choose the harness you use. These commands refuse to copy over an existing skill. No global installation is performed by building or testing this repo.

### Codex

```sh
mkdir -p "$HOME/.agents/skills"
test ! -e "$HOME/.agents/skills/process-radar" && test ! -L "$HOME/.agents/skills/process-radar" &&
  cp -R skills/process-radar "$HOME/.agents/skills/process-radar"
```

For a project-local installation, copy the folder to `<your-repo>/.agents/skills/process-radar` instead. Invoke it as `$process-radar`. The locations follow the [official Codex customization documentation](https://learn.chatgpt.com/docs/customization/overview#skills).

### Claude Code

```sh
mkdir -p "$HOME/.claude/skills"
test ! -e "$HOME/.claude/skills/process-radar" && test ! -L "$HOME/.claude/skills/process-radar" &&
  cp -R skills/process-radar "$HOME/.claude/skills/process-radar"
```

For a project-local installation, use `<your-repo>/.claude/skills/process-radar`. Invoke it as `/process-radar`. See [Claude Code's skill documentation](https://code.claude.com/docs/en/skills#where-skills-live).

Start a fresh session if the newly copied skill does not appear. For another Agent Skills-compatible harness, copy the same folder to its documented skill location. Discovery paths, history access, and image previews depend on the host; they have not all been tested here.

## Before starting a new task

```text
$process-radar Before I create a new task: I need to redesign our
cache invalidation logic. Tests cover behavior but the architecture
is still uncertain. I want to review decisions and use local models
where they fit. Recommend a process and show me a radar chart.
```

In Claude Code, replace `$process-radar` with `/process-radar`.

The response recommends a starting process, explains its tradeoff and an alternative, and provides a short handoff prompt. It does not create a task or begin implementation unless asked. You can also say “no chart.” Skills may be discovered automatically when a request matches their description, but this package does not install a hook to intercept every new task.

## Review previous work

```text
$process-radar Review these three exported conversations for places
where my process was a poor fit. Cite the evidence, include choices
that worked well, and suggest one habit to change. Do not modify anything.
```

Or request a bounded selection, such as “the last five conversations about this repo,” when your harness exposes a history-list/read tool. If the host cannot access those conversations, provide exports. The skill never assumes full access to every past session.

For an explicit local file selection, the helper can extract message text before review:

```sh
node skills/process-radar/scripts/extract-history.mjs \
  --input /approved/path/session.jsonl \
  --out /private/scratch/process-review.md
```

This is a text extractor, not an automated judge. The host LLM reads the evidence and makes the assessment. The helper omits tool results and reasoning, reports incomplete/truncated input, and preserves source locations for citations. It does no discovery or network access. Raw Markdown/text is treated as an unstructured export; roles cannot be independently verified there.

**Privacy:** historical excerpts become part of the active model's context when reviewed. Local preprocessing does not make a hosted-model review local inference. Obvious secrets are redacted on a best-effort basis, but redaction is not a privacy guarantee. Choose the input scope deliberately and keep extracted artifacts out of Git and shared directories. Existing current-conversation context needs no extra export.

## Optional charts

The helper supports the demo's recommendation JSON, or the minimal profile in [chart.md](../skills/process-radar/references/chart.md):

```sh
node skills/process-radar/scripts/render-radar.mjs \
  --input /private/scratch/recommendation.json \
  --out /private/scratch/process-radar.html
```

Use `.svg` for a slide-friendly image. HTML includes the chart with no external assets. The helpers need Node.js 22+ and refuse to overwrite existing files; text-only advice works without them. Missing historical evidence is not converted to zero merely to draw a complete shape.

## Maintain

Edit `data/catalog.json`, then run `npm run docs`. That updates the speaker cheat sheet and the self-contained skill's rubric snapshot. The web demo and skill use the same SVG renderer. Run `npm test` before distributing the folder.

The package has been checked with the skill validator, synthetic transcript tests, standalone chart rendering, and an independent model-based forward test. No real user history was read in creating it. Native invocation in each target harness still needs a local installation and smoke test.
