import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../test-support/repo.js';

import { clock, duration, fine, when } from './time.js';

/**
 * The times and lengths of time every panel writes,
 * written the same way.
 *
 * The run page draws recorded times in a browser
 * frame and the host draws the same times into the
 * message it sends, so the formatting has to be one
 * function. Everything else that formats a time in
 * this extension lives in `runs/view.ts`, which
 * imports `messages.ts`, which imports `vscode` —
 * so a webview bundle could not carry it.
 *
 * Every moment is built from local components
 * rather than written as an epoch: the clock reads
 * the machine's own zone, and a literal epoch would
 * name a different hour on every machine that runs
 * this.
 */

/** The words a length of time is said in, as the
 *  host resolves them. */
const WORDS = {
  milliseconds: '{0} ms',
  seconds: '{0} s',
  minutes: '{0} m',
  hours: '{0} h',
  days: '{0} d',
};

function local(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
  ms = 0,
): number {
  return new Date(year, month - 1, day, hour, minute, second, ms).getTime();
}

describe('a recorded moment', () => {
  it('formats a moment to the millisecond', () => {
    expect(fine(local(2026, 9, 11, 18, 24, 19, 240))).toBe('18:24:19.240');
  });

  /**
   * Written here rather than asked of a locale.
   * A 12-hour one reads the same moment as `06`
   * where the panel beside it reads `18`, and it
   * puts the meridiem after the fraction, so a
   * recorded time reads `06:24:19 PM.240`. One
   * form, whatever language the editor is in.
   */
  it('writes the afternoon in 24 hours, with no meridiem', () => {
    const said = fine(local(2026, 9, 11, 18, 24, 19, 240));

    expect(said).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(said).not.toMatch(/\b(AM|PM)\b/);
  });

  /** The hour a 12-hour clock has no `0` for, and
   *  the one locales disagree about most: some
   *  write midnight as the `24` of the day before. */
  it('writes midnight as the start of the day', () => {
    expect(fine(local(2026, 9, 11, 0, 0, 0, 0))).toBe('00:00:00.000');
    expect(clock(local(2026, 9, 11, 0, 0))).toBe('00:00');
  });

  it('writes the clock to the minute', () => {
    expect(clock(local(2026, 9, 11, 18, 24))).toBe('18:24');
  });

  /**
   * The whole reason this is a file of its own, so
   * it is asserted rather than remembered: an import
   * here is a module in four browser bundles, and
   * the one it would most naturally reach for drags
   * in the editor API.
   */
  it('imports nothing', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'src', 'webview', 'time.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/^\s*import\b/m);
  });
});

describe('when something happened', () => {
  const TODAY = local(2026, 9, 11, 18, 24);

  it('says only the clock for something that happened today', () => {
    expect(when(TODAY, local(2026, 9, 11, 22, 5), 'en-US')).toBe('18:24');
  });

  /** The month and the day come from the editor's
   *  display language; the clock never does. */
  it('names the date for something older, in the reader’s language', () => {
    const next = local(2026, 9, 12, 9, 0);

    expect(when(TODAY, next, 'en-US')).toBe('Sep 11 18:24');
    expect(when(TODAY, next, 'fi-FI')).toBe('11.9. 18:24');
    expect(when(TODAY, next, 'ar-EG')).toBe('11 سبتمبر 18:24');
  });

  /** Older is a calendar day apart, not a count of
   *  hours: a minute after midnight, last night is
   *  yesterday. */
  it('turns the date over at midnight rather than every 24 hours', () => {
    const lateLastNight = local(2026, 9, 11, 23, 59);
    const midnight = local(2026, 9, 12, 0, 0);

    expect(when(lateLastNight, midnight, 'en-US')).toBe('Sep 11 23:59');
    expect(when(midnight, midnight, 'en-US')).toBe('00:00');
  });
});

describe('how long something took', () => {
  it('counts whole milliseconds under a second', () => {
    expect(duration(48, WORDS)).toBe('48 ms');
    expect(duration(999.4, WORDS)).toBe('999 ms');
  });

  it('counts seconds to one decimal under a minute', () => {
    expect(duration(1100, WORDS)).toBe('1.1 s');
    expect(duration(8200, WORDS)).toBe('8.2 s');
  });

  it('counts minutes and seconds under an hour', () => {
    expect(duration(134_000, WORDS)).toBe('2 m 14 s');
  });

  it('counts hours and minutes under a day', () => {
    expect(duration(11_100_000, WORDS)).toBe('3 h 5 m');
  });

  /**
   * A durable wait is declared in days, so the
   * seconds a run page used to print for one ran to
   * six figures. Two units are as far as it goes:
   * the second says how precise the first is, and a
   * third says nothing anybody reads.
   */
  it('counts days and hours over a day', () => {
    expect(duration(612_000_000, WORDS)).toBe('7 d 2 h');
  });

  it('drops a trailing unit that is zero', () => {
    expect(duration(604_800_000, WORDS)).toBe('7 d');
    expect(duration(10_800_000, WORDS)).toBe('3 h');
    expect(duration(120_000, WORDS)).toBe('2 m');
  });
});
