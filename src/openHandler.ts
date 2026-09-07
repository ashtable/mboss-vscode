import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { LibManifest } from './core/rules.js';
import type { SourceFrame } from './runs/frames.js';

/**
 * Opening the code a block runs, and the line a
 * failure came from.
 *
 * Two surfaces ask for both — the canvas, where a
 * block is being configured, and the run page,
 * where one is being read about — and they reach
 * the editor through different bags. So the work
 * is written against the one verb both of them
 * have rather than against either bag: what a
 * block names, where the manifest says that name
 * is, and which line to land on.
 *
 * There is no symbol lookup here. The scan already
 * read `lib/` and wrote down where each exported
 * function is declared, and asking the editor the
 * same question a second time is a second answer
 * that can disagree with the first.
 */

/** The one thing this needs from whoever called:
 *  somewhere to put a file in front of somebody. */
export type OpensFiles = {
  /**
   * Opens the file, with the caret on that line
   * where one is given.
   *
   * The line is 1-based, the way the manifest and
   * every editor a person reads write one down.
   */
  openFile(path: string, at?: { line: number; column?: number }): Promise<void>;
};

/**
 * Opens the function this block runs, and answers
 * the export it could not find.
 *
 * A name back rather than a sentence: the canvas
 * tells somebody through `VsCodeApi` and the run
 * page through `RunsHost`, and the two name that
 * verb differently, so who says it is the caller's
 * business and this only says which name it was.
 *
 * A block with no function is not one of those
 * cases. Drawing a workflow before writing its
 * code is how every workflow starts, so there is
 * nothing here to complain about — there is simply
 * nothing to open.
 *
 * A file the manifest names but the disk no longer
 * has is left to the editor: opening it is what
 * finds out, and what to say about a missing file
 * is something VS Code already says better than a
 * check here would.
 */
export async function openHandler(
  opener: OpensFiles,
  project: string,
  manifest: LibManifest,
  node: { handler?: { export: string } },
): Promise<string | undefined> {
  const named = node.handler?.export;
  if (named === undefined) return undefined;

  const found = manifest.functions.find((one) => one.export === named);
  if (found === undefined) return named;

  // A manifest an older build cached carries no
  // line, and the file is still what somebody asked
  // for: the top of it is the honest answer, not a
  // reason to rescan the project.
  await opener.openFile(
    join(project, found.file),
    found.line === undefined ? undefined : { line: found.line },
  );

  return undefined;
}

/**
 * Opens the line a recorded failure came from, and
 * answers the file it named where this workspace
 * no longer has one.
 *
 * The existence check is the whole difference from
 * the function above. A manifest names a file the
 * scan just read; a frame names a file inside the
 * image that ran, which may have been renamed,
 * moved or never have been this project's at all —
 * so the ordinary case of "not there" deserves a
 * sentence about images and code, not the editor's
 * own complaint about a path nobody typed.
 *
 * A frame is answered with nothing rather than
 * refused: a failure that named no code anybody
 * wrote is most failures, and the surfaces draw no
 * door for one.
 */
export async function openSourceFrame(
  opener: OpensFiles,
  project: string,
  frame: SourceFrame | undefined,
): Promise<string | undefined> {
  if (frame === undefined) return undefined;

  const path = join(project, frame.file);

  if (!existsSync(path)) return frame.file;

  await opener.openFile(path, { line: frame.line, column: frame.column });

  return undefined;
}
