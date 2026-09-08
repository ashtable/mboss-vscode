import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NodeKindSchema } from '../core/rules.js';
import { REPO_ROOT } from '../test-support/repo.js';

/**
 * Which kinds React Flow knows how to draw.
 *
 * The canvas and the run page each hand React Flow
 * a table from kind to component, and the library
 * types that table as a record keyed by any
 * string. So a kind missing from one is not a
 * compile error: the block comes out as React
 * Flow's own default node instead of a block face
 * — no glyph, no title, no run mark — and nothing
 * anywhere says so.
 *
 * Reading the literal back out of the source is
 * what makes the gap loud. Importing the modules
 * here is not an option: both pull in their
 * stylesheets, and these tests run in node.
 */

/** The two files holding a table, and what each
 *  one draws a block with. */
const TABLES: Record<string, string> = {
  [join('src', 'canvas', 'Canvas.tsx')]: 'Node',
  [join('src', 'see', 'index.tsx')]: 'RunNode',
};

const LITERAL = /const nodeTypes: NodeTypes = \{([^}]*)\}/;
const KEY = /^\s*(\w+):\s*(\w+),$/;

describe('every kind React Flow is given a component for', () => {
  for (const [file, component] of Object.entries(TABLES)) {
    describe(file, () => {
      const entries = tableIn(file);

      it('covers every kind there is', () => {
        expect(entries.map(([kind]) => kind).sort()).toEqual(
          [...NodeKindSchema.options].sort(),
        );
      });

      // A kind pointed at some other component would
      // pass the check above and still draw the
      // wrong thing.
      it('draws each of them the one way', () => {
        expect(entries.map(([, drawn]) => drawn)).toEqual(
          entries.map(() => component),
        );
      });
    });
  }
});

/** The `kind: Component` pairs of one file's
 *  table, in the order they are written. */
function tableIn(file: string): [string, string][] {
  const source = readFileSync(join(REPO_ROOT, file), 'utf8');
  const found = LITERAL.exec(source);

  expect(found).not.toBeNull();

  return found![1]!
    .split('\n')
    .map((line) => KEY.exec(line))
    .filter((pair) => pair !== null)
    .map((pair) => [pair[1]!, pair[2]!]);
}
