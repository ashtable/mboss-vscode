import { describe, expect, it } from 'vitest';

import { parseInline } from './markdown.js';

/**
 * What an agent writes, as the panel reads it.
 *
 * Agents write in a little markdown whether or not
 * anybody asked them to. The panel sets apart the
 * three things that change how a sentence reads —
 * a word leaned on, a name from the code, a list of
 * steps — and leaves everything else as the
 * characters that arrived. Nothing here is ever
 * HTML, so whatever the agent quotes stays text.
 */

describe('prose an agent wrote', () => {
  it('keeps paragraphs apart', () => {
    expect(parseInline('First thing.\n\nSecond thing.')).toEqual([
      { at: 'paragraph', runs: [{ at: 'text', text: 'First thing.' }] },
      { at: 'paragraph', runs: [{ at: 'text', text: 'Second thing.' }] },
    ]);

    // A line break inside a paragraph is the
    // agent's, and stays where it put it.
    expect(parseInline('one\ntwo\n\n\n\nthree')).toEqual([
      { at: 'paragraph', runs: [{ at: 'text', text: 'one\ntwo' }] },
      { at: 'paragraph', runs: [{ at: 'text', text: 'three' }] },
    ]);

    expect(parseInline('')).toEqual([]);
    expect(parseInline('\n\n')).toEqual([]);
  });

  it('sets **bold** and `code` apart from the words around them', () => {
    expect(
      parseInline('Fixing **customer-ID** first in `lib/airtableEtl.ts`.'),
    ).toEqual([
      {
        at: 'paragraph',
        runs: [
          { at: 'text', text: 'Fixing ' },
          { at: 'strong', text: 'customer-ID' },
          { at: 'text', text: ' first in ' },
          { at: 'code', text: 'lib/airtableEtl.ts' },
          { at: 'text', text: '.' },
        ],
      },
    ]);

    // What sits between backticks is the code's own,
    // markers and all.
    expect(parseInline('`a **b** c`')).toEqual([
      { at: 'paragraph', runs: [{ at: 'code', text: 'a **b** c' }] },
    ]);
  });

  it('reads `- `, `* ` and `1. ` lines as lists', () => {
    expect(
      parseInline('Plan:\n- read it\n* fix **it**\n\n1. one\n2. two'),
    ).toEqual([
      { at: 'paragraph', runs: [{ at: 'text', text: 'Plan:' }] },
      {
        at: 'list',
        ordered: false,
        items: [
          [{ at: 'text', text: 'read it' }],
          [
            { at: 'text', text: 'fix ' },
            { at: 'strong', text: 'it' },
          ],
        ],
      },
      {
        at: 'list',
        ordered: true,
        start: 1,
        items: [[{ at: 'text', text: 'one' }], [{ at: 'text', text: 'two' }]],
      },
    ]);

    // A numbered list picked up again after a
    // paragraph goes on counting from the agent's
    // number; a blank line between steps keeps them
    // one list.
    expect(parseInline('1. one\nwhy it matters\n\n2. two\n\n3. three')).toEqual(
      [
        {
          at: 'list',
          ordered: true,
          start: 1,
          items: [[{ at: 'text', text: 'one' }]],
        },
        { at: 'paragraph', runs: [{ at: 'text', text: 'why it matters' }] },
        {
          at: 'list',
          ordered: true,
          start: 2,
          items: [
            [{ at: 'text', text: 'two' }],
            [{ at: 'text', text: 'three' }],
          ],
        },
      ],
    );
  });

  /**
   * An agent streams, so half a sentence is on
   * screen long before the rest arrives. A marker
   * that has not closed yet is two asterisks
   * somebody can see, not the start of a bold run
   * that swallows everything after it.
   */
  it('leaves a marker that never closes as it was written', () => {
    expect(parseInline('Fixing **customer-ID fir')).toEqual([
      {
        at: 'paragraph',
        runs: [{ at: 'text', text: 'Fixing **customer-ID fir' }],
      },
    ]);

    expect(parseInline('see `lib/air and **this**')).toEqual([
      {
        at: 'paragraph',
        runs: [
          { at: 'text', text: 'see `lib/air and ' },
          { at: 'strong', text: 'this' },
        ],
      },
    ]);

    expect(parseInline('**** and ``')).toEqual([
      { at: 'paragraph', runs: [{ at: 'text', text: '**** and ``' }] },
    ]);
  });

  /**
   * A coding agent fences the code it is talking
   * about, and inside a fence nothing is a marker:
   * an exponent is not a word leaned on, a line
   * opening with a dash is not a step, and the
   * fence's own backticks pair with nothing in the
   * prose that follows it.
   */
  it('keeps a fenced block exactly as it was written', () => {
    const fenced =
      '```ts\nconst total = base ** 2;\nconst next = base ** 3;\n\n' +
      '- items.push(x)\n```';

    expect(
      parseInline(`Change it like this:\n${fenced}\nThen run \`npm test\`.`),
    ).toEqual([
      { at: 'paragraph', runs: [{ at: 'text', text: 'Change it like this:' }] },
      { at: 'paragraph', runs: [{ at: 'text', text: fenced }] },
      {
        at: 'paragraph',
        runs: [
          { at: 'text', text: 'Then run ' },
          { at: 'code', text: 'npm test' },
          { at: 'text', text: '.' },
        ],
      },
    ]);
  });

  it('keeps a fence that has not closed yet as text to the end', () => {
    expect(
      parseInline('Change it like this:\n~~~ts\nconst total = base ** 2;'),
    ).toEqual([
      { at: 'paragraph', runs: [{ at: 'text', text: 'Change it like this:' }] },
      {
        at: 'paragraph',
        runs: [{ at: 'text', text: '~~~ts\nconst total = base ** 2;' }],
      },
    ]);
  });

  /**
   * Backticks in a row are characters the agent
   * typed, whether or not they open a fence. One of
   * them pairing with the next real span would set
   * the words between them as code and leave the
   * code after them as words.
   */
  it('does not pair a run of backticks with a code span', () => {
    expect(parseInline('see ``` and `x`')).toEqual([
      {
        at: 'paragraph',
        runs: [
          { at: 'text', text: 'see ``` and ' },
          { at: 'code', text: 'x' },
        ],
      },
    ]);
  });

  it('keeps angle brackets as text', () => {
    expect(parseInline('<script>alert(1)</script>')).toEqual([
      {
        at: 'paragraph',
        runs: [{ at: 'text', text: '<script>alert(1)</script>' }],
      },
    ]);

    expect(parseInline('**<b>x</b>**')).toEqual([
      { at: 'paragraph', runs: [{ at: 'strong', text: '<b>x</b>' }] },
    ]);
  });

  /**
   * There is no italic face in what this panel
   * ships, and an agent's `*` or `_` is as often a
   * glob or a snake-cased name as it is emphasis.
   */
  it('does not read one `*` or `_` as emphasis', () => {
    expect(parseInline('match *.ts in raw_input_row and _this_')).toEqual([
      {
        at: 'paragraph',
        runs: [{ at: 'text', text: 'match *.ts in raw_input_row and _this_' }],
      },
    ]);
  });
});
