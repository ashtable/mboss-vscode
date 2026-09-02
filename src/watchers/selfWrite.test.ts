import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { SelfWrites } from './selfWrite.js';

/**
 * Telling this extension's own writes apart from
 * somebody else's.
 *
 * Nothing in the editor's watcher API carries who
 * wrote a file, so a watcher whose own work lands
 * in the tree it is watching answers itself, and
 * keeps answering. The two places that will bite
 * are a proposal file rewritten as applied while a
 * watcher is on the proposals directory, and any
 * later feature that regenerates into a watched
 * path.
 *
 * What makes this sound rather than a guess is that
 * the question asked is not "did we write this" but
 * "has this file changed since we wrote it". A
 * write nobody made is nothing to react to, whoever
 * did not make it.
 */

let dir: string;
let writes: SelfWrites;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mboss-self-write-'));
  writes = new SelfWrites();
});

/** Writes a file and answers with its path. */
function write(name: string, contents: string): string {
  const path = join(dir, name);

  writeFileSync(path, contents, 'utf8');

  return path;
}

describe('a file this extension wrote', () => {
  it('is recognised while it still holds what was written', () => {
    const path = write('generated.ts', 'one');
    writes.record(path);

    expect(writes.unchanged(path)).toBe(true);
  });

  it('stops being recognised the moment somebody edits it', () => {
    const path = write('generated.ts', 'one');
    writes.record(path);

    write('generated.ts', 'two');

    expect(writes.unchanged(path)).toBe(false);
  });

  it('stops being recognised when it is deleted', () => {
    const path = write('generated.ts', 'one');
    writes.record(path);

    expect(writes.unchanged(join(dir, 'gone.ts'))).toBe(false);
  });
});

describe('a file this extension never wrote', () => {
  it('is nobody it recognises', () => {
    write('handwritten.ts', 'one');

    expect(writes.unchanged(join(dir, 'handwritten.ts'))).toBe(false);
  });
});

describe('recording a file that is not there', () => {
  /**
   * Codegen reports what it removed as well as what
   * it wrote, and a removal is worth recording for
   * the same reason a write is. There is nothing to
   * measure, so nothing is claimed.
   */
  it('claims nothing about it', () => {
    writes.record(join(dir, 'never-existed.ts'));

    expect(writes.unchanged(join(dir, 'never-existed.ts'))).toBe(false);
  });
});

describe('a file written twice', () => {
  it('is recognised against the newer write', () => {
    const path = write('generated.ts', 'one');
    writes.record(path);

    write('generated.ts', 'two');
    writes.record(path);

    expect(writes.unchanged(path)).toBe(true);
  });
});
