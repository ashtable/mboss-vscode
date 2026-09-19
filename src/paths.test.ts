import { describe, expect, it } from 'vitest';

import { displayPath } from './paths.js';

/**
 * A file named the way the editor's own tabs name
 * it.
 *
 * Everything that hands the extension a file hands
 * it an absolute one, and a sentence somebody reads
 * wants the short form. The cases that matter are
 * the ones where the short form would be worse: a
 * file outside the project, which would come back a
 * row of `..`, and the project directory itself,
 * which would come back empty.
 */

const PROJECT = '/work/booking';

describe('a path named the way the editor names it', () => {
  it('names a file inside the project by where it sits', () => {
    expect(displayPath(`${PROJECT}/lib/findSlot.ts`, PROJECT)).toBe(
      'lib/findSlot.ts',
    );
  });

  it('separates a nested file with slashes', () => {
    expect(
      displayPath(`${PROJECT}/.mboss/workflows/book.workflow.json`, PROJECT),
    ).toBe('.mboss/workflows/book.workflow.json');
  });

  it('keeps a file outside the project whole', () => {
    const outside = '/work/invoicing/lib/findSlot.ts';

    expect(displayPath(outside, PROJECT)).toBe(outside);
  });

  /** A sibling the project's own name is a prefix
   *  of: inside the string, outside the tree. */
  it('keeps a file beside the project whole', () => {
    const beside = '/work/booking-archive/lib/findSlot.ts';

    expect(displayPath(beside, PROJECT)).toBe(beside);
  });

  /** Relative to itself, a directory is the empty
   *  string, which names nothing. */
  it('keeps the project directory itself whole', () => {
    expect(displayPath(PROJECT, PROJECT)).toBe(PROJECT);
  });

  it('keeps every path whole when no project is open', () => {
    const path = `${PROJECT}/lib/findSlot.ts`;

    expect(displayPath(path, undefined)).toBe(path);
  });
});
