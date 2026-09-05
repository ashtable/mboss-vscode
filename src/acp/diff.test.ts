import { describe, expect, it } from 'vitest';

import { lineDiff, lineDiffStat } from './diff.js';

/**
 * Two texts in, a badge's numbers and a card's lines
 * out. What the agent sends is the file before and
 * the file after, so this is what turns that into
 * something a person can read at a glance.
 */

describe('counting a diff', () => {
  /**
   * A badge is arithmetic on the two texts the
   * protocol sends — `oldText` and `newText`, not
   * a unified-diff string — so getting the shape
   * wrong is what gets the number wrong.
   */
  it('counts every line of a file that did not exist', () => {
    expect(lineDiffStat(null, 'a\nb\nc\n')).toEqual({
      added: 3,
      removed: 0,
      isNew: true,
    });

    expect(lineDiffStat(undefined, '')).toEqual({
      added: 0,
      removed: 0,
      isNew: true,
    });
  });

  it('counts nothing when nothing changed', () => {
    expect(lineDiffStat('a\nb\n', 'a\nb\n')).toEqual({
      added: 0,
      removed: 0,
      isNew: false,
    });
  });

  it('counts an insertion and a deletion separately', () => {
    expect(lineDiffStat('a\nb\nc\n', 'a\nb\nc\nd\n')).toMatchObject({
      added: 1,
      removed: 0,
    });

    expect(lineDiffStat('a\nb\nc\n', 'a\nc\n')).toMatchObject({
      added: 0,
      removed: 1,
    });
  });

  it('counts a replaced line as one of each', () => {
    expect(lineDiffStat('a\nb\nc\n', 'a\nB\nc\n')).toMatchObject({
      added: 1,
      removed: 1,
    });
  });

  /**
   * Two edits far apart in a long file are two
   * small hunks, not one enormous one. Trimming
   * the matching ends and calling it a day would
   * report the whole middle as rewritten.
   */
  it('does not report untouched lines between two edits', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n');
    const after = ['a', 'B', 'c', 'd', 'e', 'F', 'g'].join('\n');

    expect(lineDiffStat(before, after)).toMatchObject({
      added: 2,
      removed: 2,
    });
  });

  it('handles a file emptied and a file filled', () => {
    expect(lineDiffStat('a\nb\n', '')).toMatchObject({ added: 0, removed: 2 });
    expect(lineDiffStat('', 'a\nb\n')).toMatchObject({ added: 2, removed: 0 });
  });
});

describe('a diff, line by line', () => {
  const numbered = (from: number, to: number): string =>
    Array.from({ length: to - from + 1 }, (_, at) => `${from + at}`).join('\n');

  it('reads every line of a new file as an addition', () => {
    expect(lineDiff(null, 'a\nb\n')).toEqual([
      { kind: 'add', text: 'a', newNo: 1 },
      { kind: 'add', text: 'b', newNo: 2 },
    ]);
  });

  it('reads a replaced line as a removal and an addition', () => {
    expect(lineDiff('a\nb\n', 'a\nB\n')).toEqual([
      { kind: 'ctx', text: 'a', oldNo: 1, newNo: 1 },
      { kind: 'del', text: 'b', oldNo: 2 },
      { kind: 'add', text: 'B', newNo: 2 },
    ]);
  });

  /**
   * Two lines either side of what moved, and a row
   * standing for the rest. A panel two hundred
   * pixels wide cannot show a thousand-line file,
   * and the lines nobody touched are not what a
   * person is being asked about.
   */
  it('keeps two lines around a change and stands in for the rest', () => {
    const lines = lineDiff(
      numbered(1, 10),
      `${numbered(1, 5)}\nsix\n${numbered(7, 10)}`,
    );

    expect(lines).toEqual([
      { kind: 'skip', text: '3' },
      { kind: 'ctx', text: '4', oldNo: 4, newNo: 4 },
      { kind: 'ctx', text: '5', oldNo: 5, newNo: 5 },
      { kind: 'del', text: '6', oldNo: 6 },
      { kind: 'add', text: 'six', newNo: 6 },
      { kind: 'ctx', text: '7', oldNo: 7, newNo: 7 },
      { kind: 'ctx', text: '8', oldNo: 8, newNo: 8 },
      { kind: 'skip', text: '2' },
    ]);
  });

  /**
   * The alignment table is quadratic. Past the
   * budget the entry keeps its counts and draws no
   * lines, which is the same answer a file too big
   * to hold gets — better than a guess at which
   * thousand lines are the interesting ones.
   */
  it('draws nothing for a file too large to align', () => {
    const before = numbered(1, 2001);
    const after = numbered(2, 2002);

    expect(lineDiff(before, after)).toEqual([]);
    expect(lineDiffStat(before, after)).toMatchObject({
      added: 2001,
      removed: 2001,
    });
  });
});
