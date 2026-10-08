# Local ChatGPT sign-in

Run Process Radar with your own ChatGPT plan using OpenAI's local Sign in with ChatGPT flow. No API key or database is needed for this option. Account/plan eligibility and available models are determined by OpenAI.

## Try it

Requires Node.js 22 or later:

```sh
cd /Users/dustin/Projects/Public/process-radar
npm ci
npm start
```

Open <http://127.0.0.1:4317/>. Use **Continue with ChatGPT**, review OpenAI's permissions, and authorize Process Radar. After returning, acknowledge the plan-usage message and choose a model. GPT-5.5 is selected only when the account's live model list offers it. If it is unavailable, choose another model explicitly. Describe your task to draft its context, review the editable answers, then continue to scoring.

The intake covers expertise, audience and deployment stage, consequences of failure, quality checks, uncertainty, time and spending limits, human oversight, model/tool/privacy constraints, and expected reuse. Answers are labeled **Stated**, **Inferred**, or **Unknown**. You can edit any answer or continue with all defaults. Untouched guesses and unknowns remain uncertain in the recommendation prompt; clicking through does not confirm them as facts. Edits take precedence over the original description. Changing the task invalidates its old intake and recommendation.

Use **Setup** to sign out, sign in to a saved registration, add another account, or explicitly choose the existing **Configured API / local model** connection. There is no automatic fallback to the endpoint's API key when ChatGPT is unavailable. Do not put API keys or tokens into task descriptions.

The page shows **Using ChatGPT plan** and **Manage usage** beside the model picker. Recommendation requests consume the selected account's allowance or permitted credits. Review applicable limits in [ChatGPT usage settings](https://chatgpt.com/settings/usage). Request timeouts and response-size caps do not guarantee a spending limit; the subscription route does not use the API adapter's `LLM_MAX_TOKENS` setting.

Before each call, a short usage notice names the selected model and estimates input tokens from that stage's actual instructions, task, and (for scoring) the reviewed answers. It is a coarse character-based estimate, not a model tokenizer or a bill: model, language and formatting affect the count. Reply and reasoning tokens are additional for each call and cannot be predicted from task length. The flow uses two AI requests: draft answers first, then score only after the user continues. Editing answers makes no AI requests. There are no automatic inference retries. The ChatGPT plan route has no local output-token cap; the optional endpoint route displays its configured cap separately.

Once the scoring response has completed and passed validation, the page reveals each of the seven dimension scores, followed by the suggested approach and first steps. This animation uses the same returned result and makes no extra AI calls. **Show all** skips the reveal; a reduced-motion preference shows everything immediately. Unrevealed scores use a dash, so a real zero remains distinct. The browser's `prepare_process` tool also stops at the editable review; it does not bypass that screen to score automatically.

## Local storage and security

- Access and refresh tokens remain in server memory, isolated by browser session. They never enter JavaScript, browser storage, URLs, logs, or Git.
- Restarting the server clears sessions and requires another sign-in. Unsaved task descriptions and results are not persisted; signing in navigates away from the page, so sign in before composing a long task.
- `.local-auth/registrations.json` keeps the stable host ID, issued client IDs, validated subject IDs, account labels/email, and whether the first-use message was acknowledged. It contains no bearer tokens. The directory is owner-only and files are atomically written with `0600` permissions; Git ignores it.
- The HTTP server listens only on `127.0.0.1`. The session cookie is HttpOnly and SameSite=Lax. It intentionally lacks Secure on HTTP loopback. This is not a public hosted deployment.
- Each login uses state, nonce and PKCE. Callbacks are browser-bound, short-lived and one-use; signed ID tokens are checked for issuer, audience, expiry and nonce. Sign-out cancels pending authentication, clears the active local token set and attempts to revoke its renewable session. A warning reports unconfirmed revocation and points you to ChatGPT settings.
- Saved accounts remain separate even when they share an email. Each issued client ID stays bound to the validated subject. Login cancellation or a temporary provider error does not silently switch accounts or billing sources.

## Connection and troubleshooting

OpenAI's authorization and token endpoints are discovered from `https://auth.openai.com/.well-known/openid-configuration`. Models come from `GET https://api.openai.com/v1/models`. Inference uses `POST https://api.openai.com/v1/responses` with `store:false` and `stream:true`. The app waits for `response.completed` before displaying a recommendation, then validates the same rubric used by the API/local adapter.

If permission was declined, use Continue with ChatGPT again. If signed in without plan permission, that action requests consent to enable it. A usage-limit error offers Manage usage. Transient errors leave credentials in place; terminal refresh failures require sign-in again. Provider messages and credential material are not echoed into the page.

The optional `.env` API/local-model settings continue to apply only to the explicitly chosen endpoint path. `PORT` (default 4317) and `LLM_TIMEOUT_MS` also apply to the local server and recommendation timeout.

Automated tests use synthetic identities, a fake OAuth service and fake inference responses. They exercise validation, isolation, refresh, failure handling and the full local HTTP route. They do not establish that your real ChatGPT account is eligible. Complete an actual sign-in and submit a task to verify that final step.

## Future hosting

This implementation is deliberately loopback-only. OpenAI requires access approval for remotely hosted apps; do not deploy the local dynamic registration flow publicly. App Platform setup, hosted client provisioning, HTTPS cookies and deployment are outside this change.

Official references: [local registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [hosted usage requirements](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt#usage-policy-and-terms).
