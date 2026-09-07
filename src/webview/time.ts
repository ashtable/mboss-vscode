/**
 * A recorded moment, to the millisecond.
 *
 * The run page draws recorded times in a browser
 * frame, and the host draws the same times into the
 * message it sends, so this has to be one function
 * or two panels would disagree about when a step
 * ran.
 *
 * Its own file, importing nothing, because the
 * module it would most naturally live beside —
 * `runs/view.ts` — imports `messages.ts`, which
 * imports the editor API. A webview bundle cannot
 * carry that, and a test asserts this file stays
 * free of imports.
 *
 * The millisecond matters here where it matters
 * nowhere else: steps in a generated workflow land
 * within a few milliseconds of each other, and a
 * trace timed to the second is a column of
 * identical strings.
 *
 * It is asked for as part of the clock rather than
 * appended to it, because where the rest of the
 * clock goes is the locale's business: a 12-hour
 * one writes the meridiem last, and a fraction
 * stuck on the end of that reads `02:02:19 PM.240`.
 *
 * The locale is the reader's unless a caller names
 * one.
 */
export function fine(epoch: number, locale?: string): string {
  return new Date(epoch).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}
