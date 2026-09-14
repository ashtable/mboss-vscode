/**
 * The times and lengths of time every panel writes.
 *
 * The run page draws recorded times in a browser
 * frame, and the host draws the same times into the
 * message it sends, so these have to be one set of
 * functions or two panels would disagree about when
 * a step ran and how long it took.
 *
 * Its own file, importing nothing, because the
 * module they would most naturally live beside —
 * `runs/view.ts` — imports `messages.ts`, which
 * imports the editor API. A webview bundle cannot
 * carry that, and a test asserts this file stays
 * free of imports.
 *
 * Every clock here is written out rather than asked
 * of a locale. A 12-hour one reads the same moment
 * as `06` where the panel beside it reads `18`; it
 * puts the meridiem after a fraction, so a recorded
 * time reads `06:24:19 PM.240`; and some locales
 * write midnight as the `24` of the day before.
 * A ledger is read by scanning a column of times
 * for the one that is out of line, and that only
 * works if every row is the same shape.
 *
 * The calendar is the reader's, though — a month
 * name is a word, not a reading of a number — so
 * `when` asks for it in the language the editor is
 * displayed in.
 *
 * The millisecond matters here where it matters
 * nowhere else: steps in a generated workflow land
 * within a few milliseconds of each other, and a
 * trace timed to the second is a column of
 * identical strings.
 */

/** The words a length of time is said in, each a
 *  template with the number in `{0}`. A webview
 *  localizes nothing of its own, so they are
 *  resolved on the host and passed in. */
export type DurationWords = {
  milliseconds: string;
  seconds: string;
  minutes: string;
  hours: string;
  days: string;
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A recorded moment, to the millisecond. */
export function fine(epoch: number): string {
  const at = new Date(epoch);
  const seconds = padded(at.getSeconds(), 2);

  return `${clock(epoch)}:${seconds}.${padded(at.getMilliseconds(), 3)}`;
}

/** The same moment where the minute is as fine as
 *  it needs to be. */
export function clock(epoch: number): string {
  const at = new Date(epoch);

  return `${padded(at.getHours(), 2)}:${padded(at.getMinutes(), 2)}`;
}

/**
 * A moment read against the moment somebody is
 * reading it: the clock alone for today, the date
 * in front of it for anything older.
 *
 * Older means a calendar day apart rather than 24
 * hours back, so a minute past midnight puts last
 * night's runs under yesterday's date, which is
 * where somebody looking for them would say they
 * happened.
 *
 * Neither `now` nor `locale` has a default: a
 * function that reads the clock itself cannot be
 * tested for what it does at a day boundary, and
 * the display language is the editor's rather than
 * the machine's.
 */
export function when(epoch: number, now: number, locale: string): string {
  return sameDay(epoch, now)
    ? clock(epoch)
    : `${date(epoch, locale)} ${clock(epoch)}`;
}

/**
 * How long something took, in two units at most.
 *
 * The second unit says how precise the first one
 * is; a third says nothing anybody reads off a run
 * page. A trailing zero is dropped rather than
 * printed, because `7 d 0 h` reads like a number
 * somebody is still waiting on.
 *
 * Only for a length of time that is settled. An
 * unfinished wait shows the moment it started, so
 * that nothing on the page has to be read as of
 * when it was drawn.
 */
export function duration(ms: number, words: DurationWords): string {
  const { milliseconds, seconds, minutes, hours, days } = words;

  if (ms < SECOND) return said(milliseconds, Math.round(ms));
  if (ms < MINUTE) return said(seconds, (ms / SECOND).toFixed(1));
  if (ms < HOUR) return paired(ms, minutes, MINUTE, seconds, SECOND);
  if (ms < DAY) return paired(ms, hours, HOUR, minutes, MINUTE);

  return paired(ms, days, DAY, hours, HOUR);
}

function paired(
  ms: number,
  bigWord: string,
  bigMs: number,
  smallWord: string,
  smallMs: number,
): string {
  const whole = said(bigWord, Math.floor(ms / bigMs));
  const rest = Math.floor((ms % bigMs) / smallMs);

  return rest === 0 ? whole : `${whole} ${said(smallWord, rest)}`;
}

/** The template with its number in. `webview/
 *  fill.ts` says the same thing for every other
 *  word bag; this file imports nothing, for the
 *  reason above. */
function said(template: string, value: number | string): string {
  return template.replace('{0}', String(value));
}

function sameDay(one: number, other: number): boolean {
  const at = new Date(one);
  const against = new Date(other);

  return (
    at.getFullYear() === against.getFullYear() &&
    at.getMonth() === against.getMonth() &&
    at.getDate() === against.getDate()
  );
}

/** The month and the day, named. Latin digits are
 *  asked for: Node answers ar-EG in Arabic-Indic
 *  ones otherwise, and the clock beside this is
 *  written in 0-9. */
function date(epoch: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    numberingSystem: 'latn',
  }).format(new Date(epoch));
}

function padded(value: number, width: number): string {
  return String(value).padStart(width, '0');
}
