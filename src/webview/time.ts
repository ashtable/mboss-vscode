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
 */
export function fine(epoch: number): string {
  const at = new Date(epoch);

  const clock = at.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return `${clock}.${String(at.getMilliseconds()).padStart(3, '0')}`;
}
