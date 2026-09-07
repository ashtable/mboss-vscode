import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Bags } from '../../src/fixture.js';

/**
 * The words the Playwright specs send in.
 *
 * A view draws whatever words arrive in its init
 * message and resolves none of its own, so these
 * specs send the words rather than reading them off
 * the host — the host imports `vscode`, which a page
 * has no such thing as.
 *
 * They used to be declared here, and drifted: the
 * commit that gathered them into one file says three
 * of the copies already disagreed with the real
 * words. `words.json` beside this file is written by
 * `npm run strings` from the host's own bags, so
 * there is no longer a copy to disagree — this
 * module only gives the data its types back, and
 * `src/words.test.ts` holds the file to what the
 * bags say.
 *
 * Read rather than imported, so that a stale
 * checkout fails on the content rather than on a
 * module the transform resolved differently.
 */
const sent = JSON.parse(
  readFileSync(join(import.meta.dirname, 'words.json'), 'utf8'),
) as Bags;

export const {
  paletteLabels,
  canvasWords,
  inspectorWords,
  sidebarWords,
  runsWords,
  seeWords,
} = sent;
