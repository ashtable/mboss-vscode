import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BUNDLE_PATH } from './bundle.js';
import { canvasWords, inspectorWords, paletteLabels } from './canvas/words.js';
import { FIXTURE_PATH, fixtureText } from './fixture.js';
import { galleryWords } from './gallery/words.js';
import { runsWords, seeWords } from './runs/words.js';
import { sidebarWords } from './sidebar/words.js';
import { REPO_ROOT } from './test-support/repo.js';

/**
 * The words the Playwright specs send in, held to
 * the words the views are handed.
 *
 * A page cannot load the host's bags — they resolve
 * through `vscode`, which a browser has no such
 * thing as — so the specs send the English as data.
 * It used to be retyped, and drifted: three copies
 * differed before anything checked them.
 *
 * Now `npm run strings` writes it. The generator
 * bundles the bags against the `vscode` double to
 * read them; this spec does not have to, because the
 * unit tier already resolves `vscode` that way — so
 * what is compared here is the same bytes by a
 * different road, which is the strongest form of
 * this check available.
 */
describe('the words the views are sent', () => {
  it('are the words the Playwright specs send in', () => {
    const held = readFileSync(join(REPO_ROOT, FIXTURE_PATH), 'utf8');

    expect(held).toBe(
      fixtureText({
        paletteLabels: paletteLabels(),
        canvasWords: canvasWords(),
        inspectorWords: inspectorWords(),
        sidebarWords: sidebarWords(),
        runsWords: runsWords(),
        seeWords: seeWords(),
        galleryWords: galleryWords(),
      }),
    );
  });
});

/**
 * A phrase drawn around a value the view supplies.
 *
 * The word and the value are two pieces a view puts
 * together, and which order they go in is the
 * language's answer rather than JSX's — so the
 * phrase carries the value's place in it.
 */
describe('a word said around something drawn', () => {
  it('leaves the run id a place of its own in the kind', () => {
    expect(inspectorWords().runKind).toContain('{0}');
  });
});

/**
 * A panel with nothing in it is a panel with
 * nothing in it.
 *
 * Every state this product draws where a list would
 * be says what is true and what would change it.
 * None of them says that a payment would, because
 * none of them would: an empty state that sells
 * something is the one place a person cannot tell
 * a missing feature from a missing file.
 *
 * Read over the bags and the bundle both, because a
 * sentence the host composes and a panel shows is
 * in neither of the other's reach.
 */
const SELLING = /upgrade|unlock/i;

describe('the words the product says about itself', () => {
  it('never sells an upgrade', () => {
    const said = [
      paletteLabels(),
      canvasWords(),
      inspectorWords(),
      sidebarWords(),
      runsWords(),
      seeWords(),
      galleryWords(),
    ].flatMap(everyWord);

    const bundled = Object.keys(
      JSON.parse(readFileSync(join(REPO_ROOT, BUNDLE_PATH), 'utf8')) as Record<
        string,
        string
      >,
    );

    expect(said.length).toBeGreaterThan(0);
    expect(bundled.length).toBeGreaterThan(0);
    expect(said.filter((one) => SELLING.test(one))).toEqual([]);
    expect(bundled.filter((one) => SELLING.test(one))).toEqual([]);
  });
});

/** Every string a bag carries, however deep its
 *  sections go. */
function everyWord(bag: unknown): string[] {
  if (typeof bag === 'string') return [bag];
  if (typeof bag !== 'object' || bag === null) return [];

  return Object.values(bag).flatMap(everyWord);
}
