import { copyFile } from 'node:fs/promises';

// The installable folder carries a snapshot; data/catalog.json remains canonical.
await copyFile(new URL('../data/catalog.json',import.meta.url),new URL('../skills/process-radar/references/catalog.json',import.meta.url));
console.log('Synced the portable skill rubric.');
