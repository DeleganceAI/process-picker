import { readFile, writeFile } from 'node:fs/promises';

export function renderCheatSheet(catalog) {
  const lines = [
    '# Process Radar — speaker cheat sheet', '', catalog.note, '',
    '## How to read the numbers', '',
    'Use 0, 25, 50, 75, and 100 as broad positions on a dimension. They are not percentages or measured performance. A 100 is not inherently desirable. Needs Strong Verifier points toward greater dependence on automatic checks. Human Worker and Human Can Replan describe different kinds of involvement.', '',
    'The scores preserve the last confirmed talk baseline. Rationale has been reconstructed from the discussion. These are archetypes and intended experiences, not a current audit of any product. Scores for Alinery do not establish what a particular released version supports.', '',
    '## Dimensions', '', '| Dimension | 0 means | 100 means |', '| --- | --- | --- |',
    ...catalog.dimensions.map(d => `| ${d.label} | ${d.zero} | ${d.hundred} |`), '',
    '## Scores at a glance', '',
    `| Approach | ${catalog.dimensions.map(d => d.label).join(' | ')} |`,
    `| --- | ${catalog.dimensions.map(() => '---:').join(' | ')} |`,
    ...catalog.approaches.map(a => `| ${a.title} | ${catalog.dimensions.map(d => a.ratings[d.id].score).join(' | ')} |`), ''
  ];
  for (const approach of catalog.approaches) {
    lines.push(`## ${approach.title}`, '', approach.short, '', `Signature: ${approach.signature}.`, '', `Example: ${approach.example}`, '', `Tradeoff: ${approach.tradeoff}`, '');
    for (const d of catalog.dimensions) lines.push(`- **${d.label} — ${approach.ratings[d.id].score}.** ${approach.ratings[d.id].reason}`);
    lines.push('');
  }
  lines.push('## Pending decisions', '', catalog.pendingRevision.note, '',
    `Proposed profile (not active): ${catalog.dimensions.map(d => `${d.label} ${catalog.pendingRevision.scores[d.id]}`).join('; ')}.`, '',
    'Workflows at 25 on Needs Strong Verifier is the most tentative existing score. Tests being useful is not the same as depending on a strong verifier; a score of 0 can be defended. Plain Harness at 50 on Human Worker is also worth revisiting under the more precise worker-versus-supervisor distinction.', '',
    '## Remember when presenting', '',
    '- Programmed loops and graphs score higher for explicit human jobs; Playbooks + Alinery score higher for ongoing human replanning. These are different claims.',
    '- The task radar is a proposed process, not an importance chart. The app uses contextual LLM judgment, not total score or polygon area, to recommend a starting approach.',
    '- A maintained process can be inspected and followed without proving its outputs correct.',
    '- High stakes call for appropriate validation and responsibility. They do not magically make a strong automatic verifier available.', '',
    'Generated from `data/catalog.json`. Edit that source and run `npm run docs` to keep the demo and cheat sheet aligned.', ''
  );
  return lines.join('\n');
}

if (process.argv[1]?.endsWith('scripts/cheat-sheet.mjs')) {
  const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
  await writeFile(new URL('../docs/cheat-sheet.md', import.meta.url), renderCheatSheet(catalog));
  console.log('Updated docs/cheat-sheet.md from data/catalog.json');
}
