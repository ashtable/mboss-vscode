import { describe, expect, it } from 'vitest';

import { canvasWords } from '../canvas/words.js';
import { FAILED_STATUSES, QUEUED_STATUSES } from '../runs/queries.js';
import { FIRST_DISPATCH } from '../runs/rows.js';

import {
  glyphOf,
  glyphStateOf,
  runWord,
  stepWord,
  type GlyphState,
  type RunWord,
  type StepWord,
} from './states.js';

/**
 * The two vocabularies this extension keeps apart.
 *
 * The ledger's is `SUCCESS`, `PENDING` and
 * `MAX_RECOVERY_ATTEMPTS_EXCEEDED`, and it belongs
 * on a row of the ledger and nowhere else. The
 * panel's is a lowercase word somebody can read.
 * Every case here is about the crossing between
 * them, because a panel that half-translates is how
 * one screen came to say `ERROR` where the next said
 * "failed" about the same run.
 */

/** In flight, on the dispatch every run gets. */
const RUNNING = { status: 'PENDING', recoveryAttempts: FIRST_DISPATCH };

const EVERY_STATE: readonly GlyphState[] = [
  'idle',
  'queued',
  'running',
  'recovering',
  'waiting',
  'done',
  'failed',
  'healthy',
];

const EVERY_WORD: readonly RunWord[] = [
  'done',
  'running',
  'recovering',
  'waiting',
  'queued',
  'failed',
  'gaveUp',
  'cancelled',
];

const EVERY_STEP: readonly StepWord[] = [
  'done',
  'failed',
  'waiting',
  'running',
];

describe('the word a run is said in', () => {
  it('says done for a run that finished', () => {
    expect(runWord({ status: 'SUCCESS' }, false)).toBe('done');
  });

  it('says running for a run in flight on its first dispatch', () => {
    expect(runWord(RUNNING, false)).toBe('running');
  });

  /** The column counts dispatches rather than
   *  crashes, so one more than the first is the
   *  first time anything picked the run back up. */
  it('says recovering for a run something picked back up', () => {
    const again = { status: 'PENDING', recoveryAttempts: FIRST_DISPATCH + 1 };

    expect(runWord(again, false)).toBe('recovering');
  });

  /** Nothing is happening in a parked run, whatever
   *  it took to get it there. */
  it('says waiting for a parked run, however often it was dispatched', () => {
    expect(runWord(RUNNING, true)).toBe('waiting');
    expect(runWord({ status: 'PENDING', recoveryAttempts: 4 }, true)).toBe(
      'waiting',
    );
  });

  it('says queued for a run nothing has claimed yet', () => {
    expect(QUEUED_STATUSES).not.toHaveLength(0);

    for (const status of QUEUED_STATUSES) {
      expect(runWord({ status }, false)).toBe('queued');
    }
  });

  it('says failed for a run that threw', () => {
    expect(runWord({ status: 'ERROR' }, false)).toBe('failed');
  });

  it('says gave up for a run it stopped restarting', () => {
    const dead = { status: 'MAX_RECOVERY_ATTEMPTS_EXCEEDED' };

    expect(runWord(dead, false)).toBe('gaveUp');
  });

  it('says cancelled for a run somebody stopped', () => {
    expect(runWord({ status: 'CANCELLED' }, false)).toBe('cancelled');
  });

  /** A queue item is read by five columns and the
   *  dispatch count is not one of them, so an item
   *  still going reads running and nothing finer. */
  it('says running for a run whose dispatch count nobody read', () => {
    expect(runWord({ status: 'PENDING' }, false)).toBe('running');
  });

  /** Whatever the filter calls failed is over, and
   *  none of it may read as still going. */
  it('says something is over for every status the failed filter names', () => {
    expect(FAILED_STATUSES).not.toHaveLength(0);

    for (const status of FAILED_STATUSES) {
      expect(['failed', 'gaveUp', 'cancelled']).toContain(
        runWord({ status }, false),
      );
    }
  });

  /** A word this build has never seen is a run that
   *  is still somewhere in flight. Saying so is
   *  what keeps a status out of a panel that has
   *  promised never to print one. */
  it('says running for a status this build has not heard of', () => {
    expect(runWord({ status: 'PAUSED' }, false)).toBe('running');
  });
});

describe('the glyph a state wears', () => {
  it('ticks a run that finished and crosses one that failed', () => {
    expect(glyphOf('done')).toEqual({ tone: '--ok', mark: '✓' });
    expect(glyphOf('failed')).toEqual({ tone: '--fail', mark: '✕' });
  });

  it('turns a mark for a run something picked back up', () => {
    expect(glyphOf('recovering')).toEqual({ tone: '--warn', mark: '↻' });
  });

  /** A tick on a run that has not finished is the
   *  one thing this set must never say, and a
   *  turning mark on a parked run would deny that
   *  nothing is happening in it. */
  it('leaves a dot on everything that has not finished', () => {
    const unfinished: readonly GlyphState[] = [
      'running',
      'waiting',
      'queued',
      'idle',
    ];

    for (const state of unfinished) {
      expect(glyphOf(state).mark).toBe('·');
    }
  });

  it('warns for a parked run and fades one nothing has claimed', () => {
    expect(glyphOf('waiting').tone).toBe('--warn');
    expect(glyphOf('queued').tone).toBe('--ink-faint');
  });

  /** Somebody asked for it, so it is not the news a
   *  run that threw is. */
  it('draws a cancelled run idle rather than as a failure', () => {
    expect(glyphStateOf('cancelled')).toBe('idle');
    expect(glyphOf('idle')).toEqual({ tone: '--ink-faint', mark: '·' });
  });

  /** The failure is the same one; the word beside
   *  the mark is what says which failure it was. */
  it('draws a run that gave up with the failed glyph', () => {
    expect(glyphStateOf('gaveUp')).toBe('failed');
    expect(glyphStateOf('failed')).toBe('failed');
  });

  it('draws a service that is up in the tone of a run that worked', () => {
    expect(glyphOf('healthy').tone).toBe('--ok');
  });

  it('gives every state a tone and a mark', () => {
    expect(EVERY_STATE).not.toHaveLength(0);

    for (const state of EVERY_STATE) {
      expect(glyphOf(state).tone).toMatch(/^--/);
      expect(glyphOf(state).mark).not.toBe('');
    }
  });
});

describe('the word a step is said in', () => {
  it('says what the row it was read from says', () => {
    expect(EVERY_STEP).not.toHaveLength(0);

    for (const state of EVERY_STEP) {
      expect(stepWord({ state })).toBe(state);
    }
  });

  /** "gave up" is a word about a whole run: a step
   *  that ran out of retries failed, and a run
   *  nothing restarts any more writes no error row
   *  of its own for a step to carry. */
  it('never says a word that is only about a whole run', () => {
    const said = EVERY_STEP.map((state) => stepWord({ state }));

    expect(said).not.toContain('gaveUp');
    expect(said).not.toContain('queued');
    expect(said).not.toContain('cancelled');
  });

  it('wears the glyph the run around it would wear', () => {
    for (const state of EVERY_STEP) {
      expect(glyphStateOf(stepWord({ state }))).toBe(state);
    }
  });
});

describe('the words the keys stand for', () => {
  /** The keys are this file's and the copy is the
   *  canvas bag's, so a key with nothing behind it
   *  draws an empty span rather than failing. */
  it('is one localized word per key', () => {
    const words = canvasWords().runOutcomes;

    expect(EVERY_WORD).not.toHaveLength(0);

    for (const word of EVERY_WORD) {
      expect(words[word]).toBeTruthy();
    }
  });

  it('is written in lower case, every one of them', () => {
    const said = Object.values(canvasWords().runOutcomes);

    expect(said).not.toHaveLength(0);

    for (const word of said) {
      expect(word).toBe(word.toLowerCase());
    }
  });
});
