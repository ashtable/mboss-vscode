import { describe, expect, it } from 'vitest';

import { FAILED_STATUSES, QUEUED_STATUSES } from '../runs/queries.js';
import { FIRST_DISPATCH } from '../runs/rows.js';
import { runWords } from '../runs/words.js';

import {
  glyphOf,
  glyphStateOf,
  inFlight,
  runWord,
  settled,
  stepWord,
  type GlyphState,
  type RunEvidence,
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

/** What a reader holds about a run in flight, on
 *  the dispatch every run gets, parked on nobody. */
const RUNNING: RunEvidence = {
  status: 'PENDING',
  recoveryAttempts: FIRST_DISPATCH,
  parked: false,
};

/** The same, where the reader kept only the
 *  status. */
function held(status: string): RunEvidence {
  return { status, parked: false };
}

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
    expect(runWord(held('SUCCESS'))).toBe('done');
  });

  it('says running for a run in flight on its first dispatch', () => {
    expect(runWord(RUNNING)).toBe('running');
  });

  /** The column counts dispatches rather than
   *  crashes, so one more than the first is the
   *  first time anything picked the run back up. */
  it('says recovering for a run something picked back up', () => {
    const again = { ...RUNNING, recoveryAttempts: FIRST_DISPATCH + 1 };

    expect(runWord(again)).toBe('recovering');
  });

  /** Nothing is happening in a parked run, whatever
   *  it took to get it there. */
  it('says waiting for a parked run, however often it was dispatched', () => {
    expect(runWord({ ...RUNNING, parked: true })).toBe('waiting');
    expect(runWord({ ...RUNNING, recoveryAttempts: 4, parked: true })).toBe(
      'waiting',
    );
  });

  it('says queued for a run nothing has claimed yet', () => {
    expect(QUEUED_STATUSES).not.toHaveLength(0);

    for (const status of QUEUED_STATUSES) {
      expect(runWord(held(status))).toBe('queued');
    }
  });

  it('says failed for a run that threw', () => {
    expect(runWord(held('ERROR'))).toBe('failed');
  });

  it('says gave up for a run it stopped restarting', () => {
    expect(runWord(held('MAX_RECOVERY_ATTEMPTS_EXCEEDED'))).toBe('gaveUp');
  });

  it('says cancelled for a run somebody stopped', () => {
    expect(runWord(held('CANCELLED'))).toBe('cancelled');
  });

  /** A queue item's row carries no dispatch count,
   *  so an item still going reads running and
   *  nothing finer. */
  it('says running for a run whose dispatch count nobody kept', () => {
    expect(runWord(held('PENDING'))).toBe('running');
  });

  /** Whatever the filter calls failed is over, and
   *  none of it may read as still going. */
  it('says something is over for every status the failed filter names', () => {
    expect(FAILED_STATUSES).not.toHaveLength(0);

    for (const status of FAILED_STATUSES) {
      expect(settled(runWord(held(status)))).toBe(true);
    }
  });

  /** A word this build has never seen is a run that
   *  is still somewhere in flight. Saying so is
   *  what keeps a status out of a panel that has
   *  promised never to print one — and a tick off
   *  a run nobody understands. */
  it('says running for a status this build has not heard of', () => {
    expect(runWord(held('PAUSED'))).toBe('running');
  });

  /**
   * Whether the run is parked is the reader's to
   * say, and a reader that cannot say has to say
   * `false` out loud: the shape refuses a read that
   * left the question out.
   */
  it('takes whether the run is parked as evidence, never as a guess', () => {
    const asked: RunEvidence = { status: 'PENDING', parked: false };

    expect(runWord(asked)).toBe('running');
    expect(runWord({ ...asked, parked: true })).toBe('waiting');
  });
});

describe('the words a run is over at', () => {
  /**
   * What the session log asks before it stamps how
   * long a run took, and what the list asks before it
   * offers to stop one. A word missing from the set
   * is a row that never gets a duration and is
   * re-armed by every refresh for ever — which is
   * what a run that gave up used to be, on the two
   * surfaces that spelled the set by hand.
   */
  it('counts done, failed, gave up and cancelled as over', () => {
    for (const word of ['done', 'failed', 'gaveUp', 'cancelled'] as const) {
      expect(settled(word), word).toBe(true);
    }
  });

  it('counts nothing else as over, the watch letting go included', () => {
    for (const word of [
      'running',
      'recovering',
      'waiting',
      'queued',
      'quiet',
    ] as const) {
      expect(settled(word), word).toBe(false);
    }
  });

  /** What a watch keeps reading for and a board
   *  draws a frontier ahead of the ledger for: a run
   *  picked back up is still going, and so is one
   *  nothing has claimed yet. */
  it('counts running, recovering and queued as still moving', () => {
    for (const word of ['running', 'recovering', 'queued'] as const) {
      expect(inFlight(word), word).toBe(true);
    }
  });

  /** A parked run is at the block it parked on, and a
   *  run the watch let go of is nobody's to draw
   *  ahead. */
  it('counts a parked run, a quiet one and every ending as not moving', () => {
    for (const word of [
      'waiting',
      'quiet',
      'done',
      'failed',
      'gaveUp',
      'cancelled',
    ] as const) {
      expect(inFlight(word), word).toBe(false);
    }
  });

  /** Every word is exactly one of over, moving and
   *  parked, so no surface can find a run in two of
   *  them or in none. */
  it('puts every word in exactly one of over, moving and parked', () => {
    expect(EVERY_WORD).not.toHaveLength(0);

    for (const word of EVERY_WORD) {
      const places = [settled(word), inFlight(word), word === 'waiting'];

      expect(places.filter(Boolean), word).toHaveLength(1);
    }
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
   *  runs bag's, so a key with nothing behind it
   *  draws an empty span rather than failing. */
  it('is one localized word per key', () => {
    const words = runWords();

    expect(EVERY_WORD).not.toHaveLength(0);

    for (const word of EVERY_WORD) {
      expect(words[word]).toBeTruthy();
    }
  });

  it('is written in lower case, every one of them', () => {
    const said = Object.values(runWords());

    expect(said).not.toHaveLength(0);

    for (const word of said) {
      expect(word).toBe(word.toLowerCase());
    }
  });
});
