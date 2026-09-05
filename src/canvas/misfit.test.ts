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

  /**
   * A transaction whose handler dials out is the one
   * reason whose repair is a different block rather
   * than a different declaration, so the note says
   * what to do about it. The line is there because
   * the call is somewhere in a file the row does not
   * show, and one number is what turns "somewhere"
   * into a place to look.
   */
  it('names the call a transaction handler makes, and where', () => {
    expect(
      note({
        kind: 'external-call',
        callee: 'fetch',
        via: 'globalThis',
        file: 'lib/chargeCard.ts',
        line: 12,
      }),
    ).toBe('calls fetch at line 12, needs a step');
  });

  /**
   * Where the call came from is worth the room only
   * when the name does not already carry it: a
   * function re-exported by the project's own module
   * is written `post`, which says nothing, while
   * `fetch` from `globalThis` says the same thing
   * twice.
   */
  it('names where a call that is not a global came from', () => {
    expect(
      note({
        kind: 'external-call',
        callee: 'post',
        via: 'node:https',
        file: 'lib/billing.ts',
        line: 4,
      }),
    ).toBe('calls post (node:https) at line 4, needs a step');
  });

  it('says a block runs no code without naming anything', () => {
    expect(note({ kind: 'no-handler-kind' })).toBe(
      'this block runs no code of its own',
    );
  });

  it('leaves no placeholder unfilled', () => {
    // Keyed by the kind, and each entry held to the
    // member that kind names. A list would not hold:
    // an array of five stays a perfectly good
    // `HandlerMisfit[]` when a sixth reason is
    // added, so this would go on claiming to cover
    // every kind while covering the ones somebody
    // remembered. As a table, a new reason is a
    // missing property and nothing builds until it
    // is here.
    const every: {
      [K in HandlerMisfit['kind']]: Extract<HandlerMisfit, { kind: K }>;
    } = {
      'no-handler-kind': { kind: 'no-handler-kind' },
      'external-call': {
        kind: 'external-call',
        callee: 'fetch',
        via: 'globalThis',
        file: 'lib/chargeCard.ts',
        line: 12,
      },
      'too-many-params': { kind: 'too-many-params', count: 2 },
      'input-mismatch': { kind: 'input-mismatch', declared: 'A', takes: 'B' },
      'output-mismatch': {
        kind: 'output-mismatch',
        declared: 'A',
        returns: 'B',
      },
      'not-a-decision': { kind: 'not-a-decision', returns: 'A' },
    };

    for (const reason of Object.values(every)) {
      expect(note(reason)).not.toMatch(/\{\d\}/);
    }
  });
});
