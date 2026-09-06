import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../test-support/repo.js';

import { fine } from './time.js';

/**
 * A moment, to the millisecond, on both sides of
 * the wire.
 *
 * The run page draws recorded times in a browser
 * frame and the host draws the same times into the
 * message it sends, so the formatting has to be one
 * function. Everything else that formats a time in
 * this extension lives in `runs/view.ts`, which
 * imports `messages.ts`, which imports `vscode` —
 * so a webview bundle could not carry it.
 */
describe('a recorded moment', () => {
  it('formats a moment to the millisecond', () => {
    const at = Date.UTC(2026, 1, 18, 14, 2, 19, 240);
    const drawn = fine(at);

    expect(drawn).toContain(
      new Date(at).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    );
    expect(drawn).toMatch(/\.\d{3}$/);
  });

  /**
   * The whole reason this is a file of its own, so
   * it is asserted rather than remembered: an import
   * here is a module in four browser bundles, and
   * the one it would most naturally reach for drags
   * in the editor API.
   */
  it('imports nothing', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'src', 'webview', 'time.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/^\s*import\b/m);
  });
});
