# Optional radar chart

Use the task requirement scores already recorded in Stage 1; do not rescore the recommended process. Read this file only after that assessment. The renderer does not call an LLM. Node.js 22+ is needed for the helpers, but text advice works without Node.

Write a small JSON file in a private scratch/output directory approved for this task. Set `profileKind` to `task-requirements`, copy all seven dimension IDs and scores unchanged from the assessment, and preserve its evidence in the answer. If any score is unknown, use the table instead. The example below illustrates the format, not scores to reuse:

```json
{
  "summary": "Task requirements for an exploratory architecture task",
  "profileKind": "task-requirements",
  "profile": [
    {"id":"humanWorker","score":0},
    {"id":"replan","score":100},
    {"id":"understandable","score":50},
    {"id":"reuse","score":0},
    {"id":"budgets","score":25},
    {"id":"freedom","score":50},
    {"id":"verifier","score":50}
  ]
}
```

After Stage 2, optionally add `recommendedApproach` with the selected catalog ID for a dashed blue reference overlay. Omit it for a custom/hybrid process or a requirements-only chart. Green always shows the original task assessment. On the first six axes, compare required support (green) with process support (blue). On the verifier axis, compare available automatic checks (green) with process dependence on those checks (blue): dependence above availability is a mismatch signal, not a reason to raise the task's score. The scores are ordinal, and bigger polygons are not better.

The renderer still accepts older web-demo JSON without `profileKind`; that legacy format plots a suggested process. Do not use that format for this skill's requirement assessment.

```sh
node /absolute/path/to/process-radar/scripts/render-radar.mjs \
  --input /private/scratch/recommendation.json \
  --out /private/scratch/process-radar.svg
```

Use an `.html` output path for a self-contained browser-viewable version. Neither format loads remote scripts, fonts, or images. The script refuses to overwrite an existing file. Pick another output name for a later revision.

Show the chart using the host's artifact/image/browser preview if available. Use an absolute path in links; provide an HTML/SVG file link if inline SVG rendering is unsupported. Never claim the image was displayed when the host only created a file. Do not install a graphics library merely to make a raster preview. The numeric profile should remain available in text for accessibility.
