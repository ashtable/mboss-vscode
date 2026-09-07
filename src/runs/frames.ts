import { CONTAINER_APP_DIR, LIB_DIR } from '../core/rules.js';

/**
 * Where in the code somebody wrote a failure came
 * from, read off the stack the container recorded.
 *
 * Only the code-behind counts. A stack captured
 * inside the image names the SDK's own frames, the
 * generated workflow, and Node's internals as
 * readily as it names a handler, and none of those
 * is a file anybody would want opened. So the
 * match is anchored at the project's `lib/` inside
 * the container and nothing else is a frame: a
 * path that is not one is answered as no frame at
 * all rather than as a guess.
 *
 * The path comes back relative to the project,
 * because the directory the image ran from is not
 * a directory on the machine reading this. Joining
 * it to a project on disk is the caller's job.
 */

/** Where in the code-behind a failure came from,
 *  as a path relative to the project. */
export type SourceFrame = { file: string; line: number; column: number };

/**
 * A frame inside the project's code-behind, as a
 * container writes one.
 *
 * The two path forms are the same file: Node
 * writes a URL for a module it loaded as one and a
 * plain path otherwise, and which of them a given
 * frame carries is not something a reader should
 * have to know. The path itself stops at the first
 * colon, which is where the line number starts.
 *
 * Both directories go into the pattern as they are
 * written. They are path segments the image and
 * the compiler are both built from, so there is
 * nothing in either for a regex to read as syntax.
 */
const LIB_FRAME = new RegExp(
  `(?:file://)?${CONTAINER_APP_DIR}/${LIB_DIR}/([^\\s():]+):(\\d+):(\\d+)`,
);

/**
 * The first code-behind frame in a stack, or
 * nothing where the stack has none.
 *
 * First rather than last: a stack is written
 * innermost frame first, so the earliest `lib/`
 * frame is the line that threw and the ones under
 * it are whatever called into it.
 */
export function libFrameOf(stack: string | undefined): SourceFrame | undefined {
  const found = stack === undefined ? null : LIB_FRAME.exec(stack);
  if (found === null) return undefined;

  const path = found[1] ?? '';

  // A stack is text somebody's run database handed
  // over, and what a reader does with a frame is
  // join it to a project and open the file. A path
  // climbing back out of the code-behind names no
  // handler, so it names no frame either.
  if (path.split('/').includes('..')) return undefined;

  return {
    file: `${LIB_DIR}/${path}`,
    line: Number(found[2]),
    column: Number(found[3]),
  };
}
