import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BUNDLE_PATH, bundleText, extract, stringsIn } from './bundle.js';
import { REPO_ROOT, packageManifest } from './test-support/repo.js';

/**
 * The bundle against the source that makes it.
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
 *
 * Two checks used to live here, holding the bundle
 * and the source equal in both directions. They are
 * gone because a generated file cannot fail them:
 * it has an entry for every string by construction
 * and no entry for anything else. What is left is
 * the one thing that can still be wrong — a bundle
 * nobody regenerated — and the fence that says
 * where copy may live, which is now the only rule
 * about strings a spec still has to keep.
 */

describe('the runtime strings', () => {
  it('declares where the bundle lives', () => {
    expect(packageManifest().l10n).toBe('./l10n');
  });

  it('finds the strings the extension shows', () => {
    expect(extract(REPO_ROOT).strings.length).toBeGreaterThan(0);
  });

  /**
   * The bundle is written by `node src/bundle.ts`
   * and checked in, because it is what a translator
   * forks and what the VSIX ships — a reviewer
   * should see a new sentence land in it.
   */
  it('is what the source says it is', () => {
    const held = readFileSync(join(REPO_ROOT, BUNDLE_PATH), 'utf8');

    expect(held).toBe(bundleText(REPO_ROOT));
  });

  /**
   * Four tables and nothing else. A sentence
   * resolved in a module of its own would still
   * reach the bundle, and would be one nobody knows
   * where to look for.
   */
  it('is resolved only in the string tables', () => {
    expect(extract(REPO_ROOT).files).toEqual([
      'src/canvas/words.ts',
      'src/messages.ts',
      'src/runs/words.ts',
      'src/sidebar/words.ts',
    ]);
  });

  /**
   * The rule the generator now rests on. It used to
   * be a convention a regex enforced by accident:
   * anything but a plain literal simply went unseen,
   * and the sentence went untranslated with nothing
   * said about it.
   */
  it('refuses a string it cannot read at build time', () => {
    expect(() => stringsIn('l10n.t(`a ${b}`);', 'x.ts')).toThrow(
      /needs a literal, at x\.ts:1:1/,
    );
    expect(() => stringsIn('l10n.t(name);', 'x.ts')).toThrow(/needs a literal/);
  });

  /**
   * A quote inside a sentence is ordinary English,
   * and the formatter writes it as an escape. The
   * parser reads the sentence rather than its
   * source, so what reaches a translator is what a
   * person sees.
   */
  it('reads a sentence with a quote in it', () => {
    expect(stringsIn(`l10n.t('say "no"');`, 'x.ts')).toEqual(['say "no"']);
    expect(stringsIn(`l10n.t("it's here");`, 'x.ts')).toEqual(["it's here"]);
    expect(stringsIn(`l10n.t('both " and \\'');`, 'x.ts')).toEqual([
      'both " and \'',
    ]);
  });

  /** The words in a comment are not a call, which a
   *  scanner reading text rather than syntax could
   *  not tell — and `src/test-support/repo.ts` has
   *  exactly that comment. */
  it('reads no string out of a comment', () => {
    expect(stringsIn('/** `vscode.l10n.t()` resolves. */\n', 'x.ts')).toEqual(
      [],
    );
  });
});
