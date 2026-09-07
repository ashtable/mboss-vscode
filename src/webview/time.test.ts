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
  const AT = Date.UTC(2026, 1, 18, 14, 2, 19, 240);

  it('formats a moment to the millisecond', () => {
    expect(fine(AT)).toMatch(/\d{2}:\d{2}:\d{2}\.240/);
  });

  /**
   * The fraction belongs to the seconds rather than
   * being stuck on the end of the string. Only a
   * 12-hour locale can show the difference — one
   * that writes the clock and nothing after it
   * draws both forms identically — so the case
   * names its locales instead of taking the
   * reader's, which would leave it unable to fail
   * on half the machines it runs on.
   */
  it('keeps the milliseconds on the seconds', () => {
    expect(fine(AT, 'en-US')).toMatch(/^\d{2}:\d{2}:\d{2}\.240\s(AM|PM)$/);
    expect(fine(AT, 'en-GB')).toMatch(/^\d{2}:\d{2}:\d{2}\.240$/);
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
