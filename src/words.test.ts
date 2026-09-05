import { describe, expect, it } from 'vitest';

import * as sent from '../tests/webview/words.js';
import { canvasWords, inspectorWords, paletteLabels } from './canvas/words.js';
import { runsWords, seeWords } from './runs/words.js';
import { sidebarWords } from './sidebar/words.js';

/**
 * The words the views are handed, held equal to the
 * words the Playwright specs send in.
 *
 * A page cannot load the host's bags — they resolve
 * through `vscode`, which a browser has no such
 * thing as — so the specs declare their own copy.
 * Two copies drift, and had: three of them differed
 * before this spec existed. The unit double's
 * `l10n.t` answers with the source string, so the
 * host's bags read here as English, which is what
 * the specs send.
 */
describe('the words the views are sent', () => {
  it('are the words the Playwright specs send in', () => {
    expect(sent.paletteLabels).toEqual(paletteLabels());
    expect(sent.canvasWords).toEqual(canvasWords());
    expect(sent.inspectorWords).toEqual(inspectorWords());
    expect(sent.sidebarWords).toEqual(sidebarWords());
    expect(sent.runsWords).toEqual(runsWords());
    expect(sent.seeWords).toEqual(seeWords());
  });
});
