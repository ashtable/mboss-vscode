import { describe, expect, it } from 'vitest';

import { shortRunId } from './ids.js';

/**
 * The few characters a run is known by on screen.
 *
 * A run id arrives in four shapes and only one of
 * them is random where a reader looks: a UUID. A
 * queue child is its parent's id and a number, a
 * scheduled firing is its workflow's name and an
 * ISO time, and the run route takes whatever id the
 * caller chose. So the cases here are mostly about
 * ids that any four characters of the id itself
 * would draw identically.
 */

const UUID = '7089cd29-4d8e-4a6b-9f2c-1b5e0a7d3c61';

/** Every id a case below shortens. */
const EVERY_SHAPE = [
  UUID,
  `${UUID}-3`,
  `${UUID}-4`,
  'run_1700000000000_a1b2c3d4',
  'sched-nightly-2026-09-11T18:24:00.000Z',
  'sched-nightly-2026-09-11T18:25:00.000Z',
  'orders:etl:ORD-19AB',
  'ORDERS-2026-Q3',
  'ab',
];

const SHORT = /^#[0-9a-z]{4}$/;

describe('a run id shortened for the screen', () => {
  it('takes the first four hex of a UUID', () => {
    expect(shortRunId(UUID)).toBe('#7089');
  });

  /**
   * Ids older builds minted opened with the clock,
   * so their random half is what follows it.
   */
  it('takes four of the random half of an older id', () => {
    expect(shortRunId('run_1700000000000_a1b2c3d4')).toBe('#a1b2');
  });

  /**
   * Both of these end `.000Z` and share everything
   * before the minute, which is why the whole id is
   * hashed rather than sliced.
   */
  it('tells two firings of one schedule apart', () => {
    expect(shortRunId('sched-nightly-2026-09-11T18:24:00.000Z')).not.toBe(
      shortRunId('sched-nightly-2026-09-11T18:25:00.000Z'),
    );
  });

  /** A queued child is its parent's id and its
   *  number, so its head is the parent's head. */
  it('tells a run apart from the children it queued', () => {
    const shown = [UUID, `${UUID}-3`, `${UUID}-4`].map(shortRunId);

    expect(new Set(shown).size).toBe(3);
  });

  /** The run route takes the caller's id verbatim,
   *  in whatever case the caller wrote it. */
  it('answers in lower case whatever case it was given', () => {
    expect(shortRunId('ORDERS-2026-Q3')).toMatch(SHORT);
    expect(shortRunId('orders:etl:ORD-19AB')).toMatch(SHORT);
  });

  it('answers four characters for an id shorter than four', () => {
    expect(shortRunId('ab')).toMatch(SHORT);
  });

  /**
   * The width is the point: these sit in a column
   * of list rows, and one id a character wider than
   * the rest moves the words after it.
   */
  it('always answers a hash and four characters', () => {
    expect(EVERY_SHAPE).not.toHaveLength(0);

    for (const id of EVERY_SHAPE) {
      expect(shortRunId(id)).toMatch(SHORT);
    }
  });
});
