# Process Radar

A local demo for choosing a way to organize agentic work. Describe a task, get an LLM's suggested process, and compare its seven-dimension radar with the talk's six reference profiles. The speaker cheat sheet explains every reference score.

The numbers are Dustin's intended-use characterizations. They are a discussion aid, not benchmarks or a current product capability audit. A larger radar is not a better process.

## Use it as a skill

The [portable Process Radar skill](skills/process-radar/SKILL.md) estimates nine task-context answers from available context, derives dimension scores from those answers, then uses the scores to recommend a process. It does not require extra user input before scoring. It optionally charts the assessment and can review explicitly selected past conversations for process mismatches. It runs inside Claude Code, Codex, or another compatible harness using that harness's own model. No separate API key or web server is needed.

See [installation and examples](docs/skill.md). Conversation review is opt-in, scoped, and read-only; installing the skill does not start scanning history.

## Run

Requires Node.js 22 or later. There are no package dependencies or build step.

```sh
npm start
```

Open <http://127.0.0.1:4317>. Start with the blank “I want to…” prompt. Recommendations need a connected model; the cheat sheet remains available under Setup without one.

The default configuration uses **GPT-5.5 through OpenAI**. For recommendations, copy `.env.example` to `.env` if needed, fill in `OPENAI_API_KEY`, and restart. The prepared local checkout already contains a key-free `.env`:

```sh
cp .env.example .env
# Edit .env with your preferred editor.
npm start
```

| Setting | Meaning |
| --- | --- |
| `LLM_BASE_URL` | OpenAI-compatible base URL ending in `/v1`, such as `http://127.0.0.1:11434/v1` or `https://api.openai.com/v1`. Use your server's actual address. |
| `LLM_MODEL` | Exact model ID offered by that endpoint. The example uses `gpt-5.5`, as requested. |
| `OPENAI_API_KEY` | Your OpenAI key. Only used for `api.openai.com`; never forwarded to another endpoint. |
| `LLM_API_KEY` | Override key for any configured provider. Empty is fine for an unauthenticated local server. |
| `LLM_JSON_MODE` | `true` sends `response_format: {type: "json_object"}`. Set `false` if your endpoint rejects it. |
| `LLM_TOKEN_FIELD` | `max_tokens` for many compatible local servers; `max_completion_tokens` for OpenAI reasoning models. |
| `LLM_MAX_TOKENS` | Output cap, default 4096. Reasoning models may need a larger cap because it includes reasoning. |
| `LLM_REASONING_EFFORT` | Optional. The GPT-5.5 example uses `low` and an 8192-token cap. Clear it for local servers without support. |
| `LLM_TIMEOUT_MS` | Request timeout, default 120000. |
| `PORT` | Local app port, default 4317. |

The server uses `POST /chat/completions`. It expects a non-streaming `choices[0].message.content` JSON string. Local server compatibility varies. JSON mode ensures JSON syntax where supported; the app separately validates all seven IDs, score increments, explanations, and recommendation IDs. It reports malformed, incomplete, refused, or timed-out responses without manufacturing a fallback recommendation or automatically retrying a paid request.

The API format follows the [OpenAI Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) and [structured-output guidance](https://developers.openai.com/api/docs/guides/structured-outputs). Chat Completions is used here for broad endpoint compatibility.

The [GPT-5.5 model documentation](https://developers.openai.com/api/docs/models/gpt-5.5) lists Chat Completions support. To switch to a local server, change the base URL and model, clear reasoning effort if unsupported, and use the token-limit field your server accepts. No code change is needed.

## Use it in the talk

1. Connect a local or hosted model before the session.
2. Describe your task in the free-form box. Include any checks you trust, human involvement, uncertainty, or constraints that matter.
3. Click “Find my approach” to reveal the recommendation, practical first steps, and radar. The green shape is the suggested way of working; dashed blue is that approach's reference profile.
4. Expand “Reasoning & alternatives” for assumptions, questions, the tradeoff, and score explanations. Revise your description and rerun as needed.
5. Use “Save chart” for an SVG, or save the recommendation as JSON from the expanded reasoning.

The LLM chooses a contextual starting point. There is no total-score, polygon-area, or distance-based winner. “Needs Strong Verifier” measures dependence on automatic success checks; a task with weak automatic checks should usually get low dependence, even when it is high-stakes.

## Edit the rubric

- `data/catalog.json`: one source for labels, definitions, baseline scores, and rationales.
- `docs/cheat-sheet.md`: generated speaker notes with all 42 score rationales.
- `model.mjs`: LLM prompt, endpoint adapter, and response validation.
- `skills/process-radar/scripts/radar-svg.mjs`: SVG renderer shared by the web demo and portable skill.
- `skills/process-radar/`: self-contained installable skill, chart helper, and history extractor.

```sh
npm run docs
npm test
```

The baseline retains Plain Harness. The proposed Skill-guided Coding rename and revised scores are recorded separately in `pendingRevision`; they do not participate in live recommendations. The source chart had acquired that new title while still carrying the earlier scores. Workflows' verifier score of 25 and Plain Harness' human-worker score of 50 remain explicitly flagged for review.

## Privacy and limits

- The app binds only to `127.0.0.1`. It is a single-user local demo, not a hardened public service.
- API keys stay in the server environment. `.env` is ignored by Git and never served. Do not paste keys into task descriptions.
- Task text is sent to your configured endpoint when you submit it. A local app can still use a remote model: check the endpoint before entering sensitive information.
- The app does not persist task descriptions, responses, or usage logs. Your model provider may have its own logging and retention policy.
- One recommendation runs at a time. Requests have input/output size caps, a timeout, and an output-token cap. These do not guarantee a financial spending limit.
- No external scripts, fonts, analytics, automatic model downloads, or account setup.
- The model can misread a task or rationalize a poor choice. The reference scores do not establish shipped product capabilities, improved model performance, or safe deployment for consequential work.

Tests use a deliberately fake OpenAI-compatible endpoint. Passing them verifies the integration and validation; it does not evaluate recommendation quality from any real model.
