import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  l10nBundle,
  packageManifest,
  sourceFiles,
} from './test-support/repo.js';

/**
 * The source strings against `l10n/bundle.l10n.json`,
 * both directions.
 *
 * This is the *other* localization mechanism, and
 * it shares nothing with the `%key%` one:
 * `package.json` contributions resolve through
 * `package.nls.json`, and everything a running
 * extension shows resolves through `vscode.l10n`
 * and this bundle. Neither falls back to the
 * other, so a string filed under the wrong one is
 * simply not translated.
 *
 * A webview has no `vscode.l10n` at all. Every
 * string a webview renders is resolved here, in
 * the host, and passed in through the view's init
 * message — which is why scanning the host source
 * finds all of them.
 */

/**
 * Every string literal passed to `l10n.t`.
 *
 * Both quote styles, because the formatter picks
 * the one that needs no escaping — a sentence with
 * an apostrophe in it comes out double-quoted. A
 * scanner that only knew about single quotes would
 * quietly stop checking exactly those sentences.
 */
function translatedStrings(): string[] {
  const call = /\bl10n\.t\(\s*(?:'([^'\\]*)'|"([^"\\]*)")/g;

  return sourceFiles().flatMap((path) => {
    const source = readFileSync(path, 'utf8');

    return [...source.matchAll(call)].map(
      (match) => match[1] ?? match[2] ?? '',
    );
  });
}

describe('the runtime strings', () => {
  it('declares where the bundle lives', () => {
    expect(packageManifest().l10n).toBe('./l10n');
  });

  const used = new Set(translatedStrings());
  const declared = new Set(Object.keys(l10nBundle()));

  it('finds the strings the extension shows', () => {
    expect(used.size).toBeGreaterThan(0);
  });

  it('has a bundle entry for every string shown', () => {
    expect([...used].filter((key) => !declared.has(key))).toEqual([]);
  });

  it('carries no entry the extension stopped showing', () => {
    expect([...declared].filter((key) => !used.has(key))).toEqual([]);
  });
});
