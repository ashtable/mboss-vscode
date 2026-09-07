import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type {
  CanvasStrings,
  GalleryStrings,
  InspectorStrings,
  RunsStrings,
  SeeStrings,
  SidebarStrings,
} from './webview/protocol.js';

/**
 * The words the Playwright specs send in, as the
 * host builds them.
 *
 * A page cannot load the host's bags — they resolve
 * through `vscode`, which a browser has no such
 * thing as — so the specs need the English as data.
 * That data used to be 307 lines somebody retyped,
 * and the copies drifted: the commit that gathered
 * them into one file says three of them already
 * disagreed with the real words.
 *
 * So they are not retyped. The three `words.ts`
 * modules are bundled against the same `vscode`
 * stand-in the unit tier uses, whose `l10n.t`
 * answers with the source string, and the bags are
 * called and written out. Every value in every bag
 * is a plain string, so JSON carries them exactly.
 *
 * Run rather than imported, this writes the fixture:
 * `node src/fixture.ts`. `fixtureText` is exported
 * so `src/words.test.ts` can build the same bytes
 * from the bags directly — the unit tier already
 * resolves `vscode`, so it needs none of the
 * bundling below.
 */

/** Where the fixture lives, relative to the repo. */
export const FIXTURE_PATH = join('tests', 'webview', 'words.json');

/** Every bag a spec sends, as the views' own
 *  builders type them. */
export type Bags = {
  paletteLabels: InspectorStrings['kinds'];
  canvasWords: CanvasStrings;
  inspectorWords: InspectorStrings;
  sidebarWords: SidebarStrings;
  runsWords: RunsStrings;
  seeWords: SeeStrings;
  galleryWords: GalleryStrings;
};

/**
 * The fixture, as bytes.
 *
 * The order is spelled here and nowhere else, so
 * that the generator and the spec that checks it
 * cannot disagree about it. Two spaces and a
 * trailing newline is what prettier makes of a JSON
 * file, and `tests/` is not prettier-ignored.
 */
export function fixtureText(bags: Bags): string {
  const ordered = {
    paletteLabels: bags.paletteLabels,
    canvasWords: bags.canvasWords,
    inspectorWords: bags.inspectorWords,
    sidebarWords: bags.sidebarWords,
    runsWords: bags.runsWords,
    seeWords: bags.seeWords,
    galleryWords: bags.galleryWords,
  };

  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * The bags, called.
 *
 * Bundled rather than imported, because plain `node`
 * running this file cannot resolve `vscode` and
 * would not follow a `.js` specifier to a `.ts`
 * sibling either. esbuild does both, and aliasing
 * `vscode` to the double means the English these
 * bags read as here is the same English every unit
 * spec pins.
 *
 * The bundle is imported as a data URL rather than
 * written somewhere and read back, so a generator
 * that fails leaves nothing behind.
 */
async function evaluated(root: string): Promise<Bags> {
  const { build } = await import('esbuild');

  const bundled = await build({
    stdin: {
      contents: [
        `export { paletteLabels, canvasWords, inspectorWords }`,
        `  from './src/canvas/words.ts';`,
        `export { runsWords, seeWords } from './src/runs/words.ts';`,
        `export { sidebarWords } from './src/sidebar/words.ts';`,
        `export { galleryWords } from './src/gallery/words.ts';`,
      ].join('\n'),
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    alias: {
      vscode: join(root, 'test', 'doubles', 'vscode.ts'),
      '@mboss/core': join(root, 'mboss-core', 'src', 'index.ts'),
    },
    write: false,
    logLevel: 'warning',
  });

  const [only] = bundled.outputFiles;
  if (only === undefined) throw new Error('the words bundled to nothing');

  const held = (await import(
    `data:text/javascript;base64,${Buffer.from(only.text).toString('base64')}`
  )) as {
    paletteLabels: () => Bags['paletteLabels'];
    canvasWords: () => CanvasStrings;
    inspectorWords: () => InspectorStrings;
    sidebarWords: () => SidebarStrings;
    runsWords: () => RunsStrings;
    seeWords: () => SeeStrings;
    galleryWords: () => GalleryStrings;
  };

  return {
    paletteLabels: held.paletteLabels(),
    canvasWords: held.canvasWords(),
    inspectorWords: held.inspectorWords(),
    sidebarWords: held.sidebarWords(),
    runsWords: held.runsWords(),
    seeWords: held.seeWords(),
    galleryWords: held.galleryWords(),
  };
}

/** Writing the fixture is what this file does when
 *  it is run rather than imported. */
if (process.argv[1] === import.meta.filename) {
  const root = resolve(dirname(import.meta.filename), '..');
  const text = fixtureText(await evaluated(root));

  writeFileSync(join(root, FIXTURE_PATH), text, 'utf8');
  process.stdout.write(`${FIXTURE_PATH} — 7 bags\n`);
}
