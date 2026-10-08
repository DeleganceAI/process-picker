# Local ChatGPT sign-in

Run Process Radar with your own ChatGPT plan using OpenAI's local Sign in with ChatGPT flow. No API key or database is needed for this option. Account/plan eligibility and available models are determined by OpenAI.

## Try it

Requires Node.js 22 or later:

```sh
cd /Users/dustin/Projects/Public/process-radar
npm ci
npm start
```

Open <http://127.0.0.1:4317/>. Use **Continue with ChatGPT**, review OpenAI's permissions, and authorize Process Radar. After returning, acknowledge the plan-usage message and choose a model. GPT-6 Luna (`gpt-6-luna`) is selected only when the account's live model list offers it. If it is unavailable, choose another model explicitly. You can describe your task before signing in; its text is restored when you return to the same tab. Submit to draft its context, review the editable answers, then continue to scoring.

The first stage is a context-review dialog covering expertise, audience and deployment stage, consequences of failure, quality checks, uncertainty, time and spending limits, human oversight, model/tool/privacy constraints, and expected reuse. Answers are labeled **Stated**, **Inferred**, or **Unknown**. A visible seven-second countdown automatically continues to scoring. **Pause** stops it, **Resume** continues it, and **See my scores** advances immediately. Focusing or editing an answer, scrolling the fields, closing the dialog, or hiding the tab pauses automatic progress. You can edit any answer or continue with all defaults. Untouched guesses and unknowns remain uncertain in the recommendation prompt; automatic or manual continuation does not confirm them as facts. Edits take precedence over the original description. Changing the task invalidates its old intake and recommendation.

Use **Setup** to sign out, sign in to a saved registration, add another account, or explicitly choose the existing **Configured API / local model** connection. There is no automatic fallback to the endpoint's API key when ChatGPT is unavailable. Do not put API keys or tokens into task descriptions.

The page shows **Using ChatGPT plan** and **Manage usage** beside the model picker. Recommendation requests consume the selected account's allowance or permitted credits. Review applicable limits in [ChatGPT usage settings](https://chatgpt.com/settings/usage). Request timeouts and response-size caps do not guarantee a spending limit; the subscription route does not use the API adapter's `LLM_MAX_TOKENS` setting.

Before each call, a short usage notice names the selected model and estimates input tokens from that stage's actual instructions, task, and (for scoring) the reviewed answers. It is a coarse character-based estimate, not a model tokenizer or a bill: model, language and formatting affect the count. Reply and reasoning tokens are additional for each call and cannot be predicted from task length. The flow uses two AI requests: draft answers first, then score after manual continuation or the review countdown. The dialog's bottom bar explicitly notes that advancing uses model allowance. Editing answers makes no AI requests. There are no automatic inference retries. The ChatGPT plan route has no local output-token cap; the optional endpoint route displays its configured cap separately.

Once the scoring response has completed and passed validation, the second stage reveals the seven dimension scores. **Show all** skips the reveal; a reduced-motion preference shows all scores immediately. Unrevealed scores use a dash, so a real zero remains distinct. After the reveal, another pausable seven-second countdown advances to the final stage: suggested approach, first steps, custom radar, and three closest reference charts. The closest shapes are ranked by equal-weight mean absolute score gap across the seven dimensions; this is a descriptive shape comparison, not a success probability. These stages reuse the same result and make no extra AI calls. The final stage stays open. **Back to scores** returns with the countdown paused; **Review answers** reopens the dialog paused. The browser's `prepare_process` tool also opens a paused review; it never begins scoring automatically.

## Local storage and security

- Access and refresh tokens remain in server memory, isolated by browser session. They never enter JavaScript, browser storage, URLs, logs, or Git.
- Restarting the server clears sessions and requires another sign-in. Task descriptions and results are not persisted on the server. Just before sign-in, the composer text is saved in this tab's `sessionStorage`, then restored and removed from storage on return (including cancellation or browser Back). It is never added to the sign-in request or URL. Results and reviewed context answers are not saved. If browser storage is unavailable, a nonempty draft blocks the redirect and prompts you to copy it first. This is sign-in recovery, not general draft autosave.
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
