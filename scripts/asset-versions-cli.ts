/** `npm run assets:versions` (check) and `npm run assets:versions -- write` (record): see assetVersions.ts. */

import { problems, writeVersions } from './assetVersions.js';

if (process.argv.includes('write')) {
  const p = problems().filter((m) => m.includes('still'));
  if (p.length > 0) {
    console.error(`Not recorded — bump these versions first:\n- ${p.join('\n- ')}`);
    process.exit(1);
  }
  writeVersions();
  console.log('asset-versions.json updated.');
} else {
  const p = problems();
  console.log(p.length === 0 ? 'Asset versions are up to date.' : `- ${p.join('\n- ')}`);
  process.exit(p.length === 0 ? 0 : 1);
}
