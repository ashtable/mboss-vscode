import { join } from 'node:path';

import { isProject, scanCodeBehind } from '../core/index.js';
import type { LibManifest } from '../core/rules.js';
import { messages } from '../messages.js';
import type { Problem } from '../problem.js';

/**
 * Reading a project's code-behind, and saying what
 * would not read.
 *
 * The manifest is what the palette's `/lib` section
 * is drawn from and what the two rules about types
 * crossing a wire are checked against, so a
 * `lib/` that does not currently compile quietly
 * makes the canvas less strict and the palette
 * shorter. Nothing else in the extension would say
 * so. That is the whole reason the type errors are
 * carried out to PROBLEMS rather than left inside
 * the manifest where only the compiler looks.
 */

export type ProjectScan = {
  /** What the handlers offer, or nothing when the
   *  scan could not run at all. */
  manifest: LibManifest | undefined;

  problems: Problem[];
};

/**
 * Scans, unconditionally.
 *
 * The library caches against a hash of the files it
 * read, so an unchanged `lib/` costs a read and a
 * digest rather than a type-check. A "should I
 * rescan" test written here would be a second
 * answer to a question something already answers
 * from the bytes.
 */
export function scanProject(project: string): ProjectScan {
  if (!isProject(project)) return { manifest: undefined, problems: [] };

  const scan = scanCodeBehind(project);

  if (!scan.ok) {
    return {
      manifest: undefined,
      problems: [
        {
          file: join(project, 'lib'),
          message: messages.codeBehindUnreadable(scan.detail),
          severity: 'error',
        },
      ],
    };
  }

  return {
    manifest: scan.manifest,
    problems: scan.manifest.errors.map((error) => ({
      // An error the scanner could not put in a
      // file is about the code-behind as a whole,
      // and there is nowhere better to hang it.
      file:
        error.file === '' ? join(project, 'lib') : join(project, error.file),
      message: error.message,
      severity: 'error',
    })),
  };
}
