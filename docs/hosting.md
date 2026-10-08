# Hosted demo on DigitalOcean

The hosted demo uses the owner's OpenAI API project. Visitors do not sign in or supply credentials. Local `npm start` continues to support ChatGPT plan sign-in; `HOSTED=true` completely disables that local authentication surface and does not create or read `.local-auth`.

## Deploy

The checked-in `.do/app.yaml` creates one $5/month, 512 MB App Platform service in San Francisco, with Node.js 22, HTTPS, and automatic deployments from `DeleganceAI/process-picker` on `main`. API usage is billed separately. No database is required; tasks and results are not saved by the app.

```sh
doctl apps propose --spec .do/app.yaml
doctl apps create --spec .do/app.yaml
```

The initial deployment is deliberately disabled for inference until its key is added. In DigitalOcean: **Apps → process-picker → Settings → web → Environment Variables**, add `OPENAI_API_KEY`, select **Encrypt**, and choose **Run time**. Save and let the new deployment become active. Never put the key in this repository, the app spec, browser JavaScript, or chat. The app does not need an organization admin key.

Use a dedicated OpenAI project and set a monthly spending limit with **Enforce a hard limit** enabled. A spend alert alone does not stop requests. Hard-limit enforcement can slightly overshoot as usage updates propagate. Restrict the key's permissions to the inference endpoint needed here (Chat Completions) and enable `gpt-6-luna` for the project.

Official guidance: [OpenAI spend limits](https://developers.openai.com/api/docs/guides/spend-limits), [DigitalOcean encrypted environment variables](https://docs.digitalocean.com/products/app-platform/how-to/use-environment-variables/).

## Runtime controls

- `HOSTED=true`: bind on `0.0.0.0`; disable local ChatGPT authentication.
- `PUBLIC_ORIGIN`: exact public HTTPS origin. The spec binds this to `${APP_URL}`. Untrusted Host/Origin headers are rejected; forwarded headers cannot redefine it.
- `LLM_MODEL=gpt-6-luna`: fixed server-side model, not selected by visitors.
- `LLM_MAX_TOKENS=8192`: maximum completion tokens per API request, including reasoning. Inputs are separately bounded by task length and context validation. There are two AI calls per complete recommendation and no automatic inference retries.
- `DEMO_HOURLY_CALLS=60`, `DEMO_DAILY_CALLS=200`: rolling, **shared across every visitor**, counted before provider calls, including failed attempts. These allow at most 30 complete recommendations/hour and 100/day, fewer if calls fail or visitors restart.
- `DEMO_CONCURRENCY=2`: at most two simultaneous provider calls. Excess requests get a friendly busy response.

The request counters live in one server process and reset on restart/deployment. They are an abuse brake, **not a durable money cap**. Keep exactly one instance and enforce the monetary cap in the OpenAI project. A public visitor can exhaust the shared allowance; do not use this small demo as a multi-tenant production service. Logs do not include task text or credentials. Provider retention may apply.

## Verify

Confirm the deployment is `ACTIVE` and its source commit matches GitHub `main`. `/healthz` checks the web process only; it does not make an AI request or establish key/model validity. `/api/config` should show `hosted:true`, `configured:true`, and the intended model, never credentials. ChatGPT auth routes should return 404.

Then submit one harmless task through the public UI and check context review, dimension reveal, and both radar overlays. This consumes two real API requests. Native hosted inference remains unverified until a valid project key has been configured and that test succeeds.

When changing the app spec on an existing app, preserve runtime secrets from the live configuration; the repository template intentionally contains no key. Normal source-triggered deployments retain environment settings.
