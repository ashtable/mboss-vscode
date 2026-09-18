import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { BUNDLE_PATH, stringsIn } from './bundle.js';
import { canvasWords, inspectorWords, paletteLabels } from './canvas/words.js';
import { FIXTURE_PATH, fixtureText } from './fixture.js';
import { galleryWords } from './gallery/words.js';
import { runsWords, seeWords } from './runs/words.js';
import { sidebarWords } from './sidebar/words.js';
import { l10nBundle, REPO_ROOT } from './test-support/repo.js';

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

/**
 * Capitals, as a view spends them.
 *
 * A word in capitals is how a view says what state
 * something is in, and the state word draws its
 * own; a label, a heading or a sentence that
 * shouts spends that signal on furniture. What
 * stays in capitals is written that way wherever
 * it is written: an acronym, and a status the
 * ledger printed, shown as evidence the way it was
 * recorded.
 */
const CAPS = /\b[A-Z]{3,}\b/g;

const ACRONYMS = ['API', 'JSON', 'DBOS', 'SDK', 'PATH', 'POST', 'URL', 'UUID'];

/** A status with underscores in it is one word to
 *  the rule, and table and column names are lower
 *  case, so neither needs a place here. */
const LEDGER_WORDS = [
  'SUCCESS',
  'ERROR',
  'PENDING',
  'ENQUEUED',
  'DELAYED',
  'CANCELLED',
];

/**
 * Two capitalised words running together: a label
 * set in title case, which is the other way a
 * panel shouts. Sentence case is the one voice
 * every view speaks in.
 */
const TITLE = /(^|[\s·—(])[A-Z][a-z]+ [A-Z][a-z]+/g;

/** Names whose capitals are their own. */
const PROPER_NOUNS = ['Agent Client Protocol', 'DBOS Conductor', 'VS Code'];

/** Names a sentence may start right in front of,
 *  as in "Start Docker, then refresh." */
const NOUNS = ['Docker'];

/**
 * The host sentences a view draws.
 *
 * A view's own words are in the bags. These are
 * the sentences the host composes and hands a view
 * whole — a proposal's banner, a run's evidence, a
 * row the transcript draws — and the notifications
 * that name a control a view draws, which have to
 * name it the way the view does. A sentence only
 * the editor's own dialogs show is not read: no
 * view draws it.
 *
 * Every sentence these modules take from
 * `messages` goes into what a view is sent. The
 * two watchers are here because a generation's
 * findings are quoted word for word in the card
 * the transcript draws after an approval.
 */
const DRAWING = [
  'src/inspector/subject.ts',
  'src/inspector/view.ts',
  'src/preview/view.ts',
  'src/runs/ledger.ts',
  'src/runs/runner.ts',
  'src/runs/stack.ts',
  'src/runs/testRun.ts',
  'src/runs/view.ts',
  'src/sidebar/view.ts',
  'src/watchers/codegen.ts',
  'src/watchers/manifest.ts',
];

/** Named one by one, because the modules that say
 *  them also speak in the editor's own dialogs. */
const DRAWN = [
  // Rows the transcript draws: an edit made on the
  // canvas, a proposal applied, a code generation
  // that failed and the fix it offers.
  'canvasAssignVerb',
  'canvasAssignTarget',
  'previewApplyVerb',
  'diagnosticFix',
  'previewCodegenFix',
  // Why a row is no point to replay from, and what
  // the run tab says once a replay has gone.
  'replayRowSdkOwned',
  'replayRowInsideWait',
  'replayRowParkedHere',
  'replayRowLinkScoped',
  'replayRefused',
  'replayStarted',
  'replayStartedNewer',
  'replayOnBuild',
];

/** Notifications naming the Replay from here
 *  button a view draws. */
const QUOTING = ['replayTitle', 'runResumeStartedOlder'];

describe('the copy a view draws', () => {
  it('shouts no word it has not been allowed', () => {
    expect(capsIn('Open PRODUCTION through the DBOS API')).toEqual([
      'PRODUCTION',
    ]);

    const bundled = Object.keys(l10nBundle());
    const drawn = sentWords();

    expect(bundled.length).toBeGreaterThan(0);
    expect(drawn.length).toBeGreaterThan(0);
    expect(
      [...bundled, ...drawn].filter((one) => capsIn(one).length > 0),
    ).toEqual([]);
  });

  it('writes no label in title case', () => {
    expect(titleIn('Replay From Here')).toEqual(['Replay From']);
    expect(titleIn('Start Docker, then refresh.')).toEqual([]);
    expect(titleIn('It speaks the Agent Client Protocol.')).toEqual([]);

    const literals = messageLiterals();
    const entries = new Set(literals.keys());
    const read = DRAWING.map((path) => ({
      path,
      keys: messagesReadBy(path, entries),
    }));
    const crossing = new Set([
      ...read.flatMap(({ keys }) => keys),
      ...DRAWN,
      ...QUOTING,
    ]);

    expect(
      read.filter(({ keys }) => keys.length === 0).map(({ path }) => path),
    ).toEqual([]);
    expect(
      [...crossing].filter((key) => (literals.get(key) ?? []).length === 0),
    ).toEqual([]);

    const said = [
      ...sentWords(),
      ...[...crossing].flatMap((key) => literals.get(key) ?? []),
    ];

    expect(said.filter((one) => titleIn(one).length > 0)).toEqual([]);
  });
});

/** The capitalised words in one string that are
 *  neither an acronym nor a ledger status. */
function capsIn(text: string): string[] {
  return [...text.matchAll(CAPS)]
    .map((found) => found[0])
    .filter((word) => !ACRONYMS.includes(word) && !LEDGER_WORDS.includes(word));
}

/**
 * The title-case pairs in one string.
 *
 * A proper noun is taken out before the rule reads
 * the string, so its capitals are not counted
 * against it and whatever runs on past it still
 * is.
 */
function titleIn(text: string): string[] {
  const unnamed = PROPER_NOUNS.reduce(
    (rest, noun) => rest.replaceAll(noun, '_'),
    text,
  );

  return [...unnamed.matchAll(TITLE)]
    .map((found) => found[0].slice((found[1] ?? '').length))
    .filter((pair) => !NOUNS.includes(pair.split(' ')[1] ?? ''));
}

/** Every word the Playwright specs send a view,
 *  which is every word the bags hold. */
function sentWords(): string[] {
  return everyWord(
    JSON.parse(readFileSync(join(REPO_ROOT, FIXTURE_PATH), 'utf8')),
  );
}

/**
 * Every `messages` entry one module reaches for,
 * called or handed on. Kept to real entries, which
 * is what leaves out the `.js` of the import that
 * brings `messages` in.
 */
function messagesReadBy(path: string, entries: Set<string>): string[] {
  const text = readFileSync(join(REPO_ROOT, path), 'utf8');

  return [...text.matchAll(/\bmessages\.(\w+)/g)]
    .flatMap((found) => found[1] ?? [])
    .filter((key) => entries.has(key));
}

/**
 * Every `messages` entry, as the literals it
 * wraps, read the way the bundle is written: by
 * the parser, one entry at a time, so a sentence
 * is known by the key that says it.
 */
function messageLiterals(): Map<string, string[]> {
  const path = join(REPO_ROOT, 'src', 'messages.ts');
  const file = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
  );
  const entries = new Map<string, string[]>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(file) === 'messages' &&
      node.initializer !== undefined &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const entry of node.initializer.properties) {
        if (!ts.isPropertyAssignment(entry)) continue;

        entries.set(
          entry.name.getText(file),
          stringsIn(entry.initializer.getText(file), 'src/messages.ts'),
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return entries;
}

/** Every string a bag carries, however deep its
 *  sections go. */
function everyWord(bag: unknown): string[] {
  if (typeof bag === 'string') return [bag];
  if (typeof bag !== 'object' || bag === null) return [];

  return Object.values(bag).flatMap(everyWord);
}
