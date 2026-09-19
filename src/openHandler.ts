import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { LibManifest } from './core/rules.js';
import { messages } from './messages.js';
import type { SourceFrame } from './runs/frames.js';

/**
 * Opening the code a block runs, and the line a
 * failure came from.
 *
 * Two surfaces ask for both — the canvas, where a
 * block is being configured, and the run tab,
 * where one is being read about — and they reach
 * the editor through different bags. So the work
 * is written against the two verbs both of them
 * have rather than against either bag: somewhere to
 * put a file in front of somebody, and a way to
 * tell them what could not be opened.
 *
 * There is no symbol lookup here. The scan already
 * read `lib/` and wrote down where each exported
 * function is declared, and asking the editor the
 * same question a second time is a second answer
 * that can disagree with the first.
 */

/** What this needs from whoever called: somewhere
 *  to put a file in front of somebody, and a way
 *  to say what could not be opened. */
export type Opener = {
  /**
   * Opens the file, with the caret on that line
   * where one is given.
   *
   * The line is 1-based, the way the manifest and
   * every editor a person reads write one down.
   */
  openFile(path: string, at?: { line: number; column?: number }): Promise<void>;

  /** Tells the person something they can act on. */
  say(message: string): void;
};

/**
 * Opens the function this block runs, and says
 * which export it could not find.
 *
 * Said here rather than answered back: every caller
 * used to carry the same tail, turning the name
 * into the same sentence, because the two bags once
 * named the telling verb differently.
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
  opener: Opener,
  project: string,
  manifest: LibManifest,
  node: { handler?: { export: string } },
): Promise<void> {
  const named = node.handler?.export;
  if (named === undefined) return;

  const found = manifest.functions.find((one) => one.export === named);

  if (found === undefined) {
    opener.say(messages.openFunctionUnknown(named));

    return;
  }

  // A manifest an older build cached carries no
  // line, and the file is still what somebody asked
  // for: the top of it is the honest answer, not a
  // reason to rescan the project.
  await opener.openFile(
    join(project, found.file),
    found.line === undefined ? undefined : { line: found.line },
  );
}

/**
 * Opens the line a recorded failure came from, and
 * says which file it named where this workspace no
 * longer has one.
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
  opener: Opener,
  project: string,
  frame: SourceFrame | undefined,
): Promise<void> {
  if (frame === undefined) return;

  const path = join(project, frame.file);

  if (!existsSync(path)) {
    opener.say(messages.errorLocationGone(frame.file));

    return;
  }

  await opener.openFile(path, { line: frame.line, column: frame.column });
}
