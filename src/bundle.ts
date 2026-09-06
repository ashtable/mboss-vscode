import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

/**
 * The translator's bundle, made from the source that
 * shows the strings.
 *
 * `l10n/bundle.l10n.json` is key === value for all
 * 333 of its entries: it carries nothing the
 * literals in `messages.ts` and the three `words.ts`
 * do not already say. It was still edited by hand,
 * which cost two edits per string and let the two
 * copies disagree — for a while the file held the
 * same key twice, which `JSON.parse` resolves
 * silently and prettier preserves, so nothing could
 * see it.
 *
 * So the rule that every `l10n.t` wraps a literal is
 * no longer policed from the side by a spec. It is
 * what makes this file possible, and a call that
 * breaks it stops the generator by name.
 *
 * Read with TypeScript's own parser rather than a
 * regex. A regex has to be told about escapes, about
 * template literals, and about the difference
 * between a call and the same words inside a comment
 * — `src/test-support/repo.ts` has exactly that
 * comment, and a scanner that matched text would
 * trip on it.
 *
 * Run rather than imported, this writes the bundle:
 * `node src/bundle.ts`. Nothing is imported from a
 * sibling at run time, for the reason `src/build.ts`
 * gives — plain `node` reads the TypeScript here but
 * will not follow a `.js` specifier to a `.ts` file.
 */

/** Where the bundle lives, relative to the repo. */
export const BUNDLE_PATH = join('l10n', 'bundle.l10n.json');

/** What the source says, and which files said it. */
export type Extraction = {
  /** Every distinct string, sorted. Sorted rather
   *  than kept in the order the files happen to be
   *  walked in, so that adding a sentence moves one
   *  line and moving a function moves none. */
  strings: string[];

  /** The files that resolved at least one, repo
   *  relative and sorted. */
  files: string[];
};

/**
 * A `l10n.t` whose first argument is not a literal.
 *
 * Thrown rather than skipped. A generator that
 * quietly passed over one would ship a sentence no
 * translator ever sees, and the skipping is exactly
 * what a regex used to do.
 */
export class NotALiteral extends Error {
  constructor(where: string) {
    super(`l10n.t needs a literal, at ${where}`);
    this.name = 'NotALiteral';
  }
}

export function extract(root: string): Extraction {
  const found = new Set<string>();
  const files = new Set<string>();

  for (const path of scanned(root)) {
    const strings = stringsIn(readFileSync(path, 'utf8'), path);
    if (strings.length === 0) continue;

    files.add(relative(root, path).split(sep).join('/'));
    for (const one of strings) found.add(one);
  }

  return {
    strings: [...found].sort(),
    files: [...files].sort(),
  };
}

/** The bundle, as bytes — `JSON.stringify(…, 2)`
 *  and a trailing newline, which is what prettier
 *  makes of this file and what it held already. */
export function bundleText(root: string): string {
  const strings = extract(root).strings;
  const bundle = Object.fromEntries(strings.map((one) => [one, one]));

  return `${JSON.stringify(bundle, null, 2)}\n`;
}

/**
 * Every string one file resolves.
 *
 * The parser is handed the file with its comments
 * kept but is walked over expressions only, so the
 * words `l10n.t(` inside a doc comment are not a
 * call and are not read as one.
 */
export function stringsIn(source: string, path: string): string[] {
  const parsed = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.ESNext,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && resolves(node.expression)) {
      const [first] = node.arguments;

      // `.text` and not `.getText()`: the parser has
      // already read the escapes, so a sentence
      // written with a quote in it arrives as the
      // sentence rather than as its source.
      if (first === undefined || !ts.isStringLiteral(first)) {
        throw new NotALiteral(at(parsed, node));
      }

      found.push(first.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(parsed);

  return found;
}

/** Whether this is the `l10n.t` the editor
 *  resolves, however `l10n` was reached. */
function resolves(expression: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(expression)) return false;
  if (expression.name.text !== 't') return false;

  const held = expression.expression;

  return ts.isIdentifier(held)
    ? held.text === 'l10n'
    : ts.isPropertyAccessExpression(held) && held.name.text === 'l10n';
}

function at(file: ts.SourceFile, node: ts.Node): string {
  const { line, character } = file.getLineAndCharacterOfPosition(
    node.getStart(file),
  );

  return `${file.fileName}:${line + 1}:${character + 1}`;
}

/**
 * The files a shipped string can be in.
 *
 * Specs are walked past. A sentence a spec writes is
 * not one anybody reads, and putting it in the
 * bundle would ask somebody to translate a fixture.
 */
function scanned(root: string): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);

      if (statSync(path).isDirectory()) return walk(path);

      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });

  return walk(join(root, 'src')).sort();
}

/** Writing the bundle is what this file does when it
 *  is run rather than imported. */
if (process.argv[1] === import.meta.filename) {
  const root = resolve(dirname(import.meta.filename), '..');
  const text = bundleText(root);

  writeFileSync(join(root, BUNDLE_PATH), text, 'utf8');
  process.stdout.write(
    `${BUNDLE_PATH} — ${Object.keys(JSON.parse(text) as object).length} strings\n`,
  );
}
