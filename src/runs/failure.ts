/**
 * What a caught thing says, for a panel to show.
 *
 * A `throw` can carry anything, so the check is not
 * ceremony. And `String(error)` on a real `Error`
 * prefixes it with the class name — `Error:
 * connection refused` — which is a word about
 * JavaScript in the middle of a sentence about
 * somebody's database.
 */
export function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
