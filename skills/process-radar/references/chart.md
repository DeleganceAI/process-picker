# Optional radar chart

Use the host model's recommendation; the renderer does not call an LLM. Node.js 22+ is needed for the helpers, but the skill's text advice works without Node.

Write a small JSON file in a private scratch/output directory approved for this task. Use all seven dimension IDs exactly once and a score from `0, 25, 50, 75, 100`. Explain the scores in the answer; a chart is not a substitute for the rationale. An existing web-demo recommendation JSON can be used unchanged.

```json
{
  "summary": "Suggested process for an exploratory architecture task",
  "recommendedApproach": "playbooks",
  "profile": [
    {"id":"humanWorker","score":50},
    {"id":"replan","score":100},
    {"id":"understandable","score":100},
    {"id":"reuse","score":75},
    {"id":"budgets","score":75},
    {"id":"freedom","score":75},
    {"id":"verifier","score":0}
  ]
}
```

Those example scores are illustrative. Choose the values for the user's task. The `recommendedApproach` can be omitted for a custom/hybrid process with no reference overlay; otherwise it must be an ID from the catalog.

```sh
node /absolute/path/to/process-radar/scripts/render-radar.mjs \
  --input /private/scratch/recommendation.json \
  --out /private/scratch/process-radar.svg
```

Use an `.html` output path for a self-contained browser-viewable version. Neither format loads remote scripts, fonts, or images. The script refuses to overwrite an existing file. Pick another output name for a later revision.

Show the chart using the host's artifact/image/browser preview if available. Use an absolute path in links; provide an HTML/SVG file link if inline SVG rendering is unsupported. Never claim the image was displayed when the host only created a file. Do not install a graphics library merely to make a raster preview. The numeric profile should remain available in text for accessibility.
