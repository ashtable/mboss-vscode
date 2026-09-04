import { describe, expect, it } from 'vitest';

import type { HandlerMisfit } from '../core/rules.js';
import { messages } from '../messages.js';

import { misfitNote } from './misfit.js';

/**
 * The sentence a misfit reads as.
 *
 * Core answers with a code and the facts behind it,
 * and every reason but the first names two of them
 * — which is the whole risk here: a note that says
 * "takes SlotGrid, needs ExpenseClaim" when the
 * function is the one taking ExpenseClaim is
 * grammatical, plausible and backwards, and no
 * type would catch it.
 */
describe('why a function cannot sit behind a block', () => {
  const words = messages.misfitWords();

  const note = (reason: HandlerMisfit): string => misfitNote(words, reason);

  it('names what the function takes before what the block wants', () => {
    expect(
      note({
        kind: 'input-mismatch',
        declared: 'SlotGrid',
        takes: 'ExpenseClaim',
      }),
    ).toBe('takes ExpenseClaim, needs SlotGrid');
  });

  it('names what the function returns before what the block wants', () => {
    expect(
      note({
        kind: 'output-mismatch',
        declared: 'Booking',
        returns: 'Payment',
      }),
    ).toBe('returns Payment, needs Booking');
  });

  it('says a branch’s function decides nothing, and what it returns', () => {
    expect(note({ kind: 'not-a-decision', returns: 'BookingReq' })).toBe(
      'returns BookingReq, decides nothing',
    );
  });

  it('counts the arguments a handler cannot be given', () => {
    expect(note({ kind: 'too-many-params', count: 3 })).toBe(
      'takes 3 arguments, needs one',
    );
  });

  it('says a block runs no code without naming anything', () => {
    expect(note({ kind: 'no-handler-kind' })).toBe(
      'this block runs no code of its own',
    );
  });

  it('leaves no placeholder unfilled', () => {
    const every: HandlerMisfit[] = [
      { kind: 'no-handler-kind' },
      { kind: 'too-many-params', count: 2 },
      { kind: 'input-mismatch', declared: 'A', takes: 'B' },
      { kind: 'output-mismatch', declared: 'A', returns: 'B' },
      { kind: 'not-a-decision', returns: 'A' },
    ];

    for (const reason of every) expect(note(reason)).not.toMatch(/\{\d\}/);
  });
});
