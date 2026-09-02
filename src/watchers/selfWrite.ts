import { statSync } from 'node:fs';

/**
 * Telling this extension's own writes apart from
 * somebody else's.
 *
 * Nothing in the editor's watcher API says who
 * wrote a file, so a watcher whose own work lands
 * in a tree it is watching answers itself, and
 * keeps answering. Today the trees are disjoint by
 * construction — code is generated into `src/`
 * while the watchers are on the control directory
 * and the code-behind — but the moment anything
 * rewrites a proposal, or regenerates into a
 * watched path, an unsuppressed loop is a compile
 * storm with no obvious cause.
 *
 * What makes this sound rather than a guess is the
 * question it asks. Not "did we write this file",
 * which nothing on disk records, but "has this file
 * changed since we wrote it" — which the filesystem
 * does record, and which is the question worth
 * asking anyway: a write that changed nothing is
 * nothing to react to, whoever made it.
 */

/** A file as it stood at one moment: when it was
 *  last written, and how big it was. */
type Fingerprint = string;

export class SelfWrites {
  private readonly written = new Map<string, Fingerprint>();

  /**
   * Remembers a file as this extension just left
   * it. A path with nothing at it is recorded as
   * nothing, so a file that was deleted — or never
   * written after all — claims nothing later.
   */
  record(path: string): void {
    const now = fingerprint(path);

    if (now === undefined) {
      this.written.delete(path);

      return;
    }

    this.written.set(path, now);
  }

  /**
   * Whether this file still holds exactly what this
   * extension put there, and so has nothing new in
   * it to react to.
   */
  unchanged(path: string): boolean {
    const before = this.written.get(path);

    return before !== undefined && before === fingerprint(path);
  }
}

/**
 * Nanoseconds rather than the millisecond form:
 * generating a project writes several files inside
 * one millisecond, and a stamp that cannot tell
 * them apart cannot tell a rewrite apart either.
 */
function fingerprint(path: string): Fingerprint | undefined {
  try {
    const found = statSync(path, { bigint: true });

    return `${found.mtimeNs}:${found.size}`;
  } catch {
    return undefined;
  }
}
