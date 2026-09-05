import { statSync } from 'node:fs';

/**
 * The files whose current bytes this extension has
 * already answered for.
 *
 * Nothing in the editor's watcher API says who wrote
 * a file or why, so a watcher whose own work lands
 * in a tree it is watching answers itself, and keeps
 * answering. Code is generated into `src/` while the
 * watchers are on the control directory and the
 * code-behind, so that loop does not close today —
 * but an approval, an undo and the canvas itself all
 * write a workflow document, and the event that
 * write produces is one the watchers would answer
 * with a second generation of code that already
 * reflects it.
 *
 * What makes this sound rather than a guess is the
 * question it asks. Not "did we write this file",
 * which nothing on disk records, but "has this file
 * changed since we last accounted for it" — which
 * the filesystem does record, and which is the
 * question worth asking anyway: an event about bytes
 * a generation has already read, or already wrote,
 * is nothing to react to, whoever made them.
 */

/** A file as it stood at one moment: when it was
 *  last written, and how big it was. */
type Fingerprint = string;

export class Accounted {
  private readonly seen = new Map<string, Fingerprint>();

  /**
   * Remembers a file as this extension last
   * accounted for it: written by it, or read by a
   * generation about to reflect it. A path with
   * nothing at it is recorded as nothing, so a file
   * that was deleted — or never written after all —
   * claims nothing later.
   */
  record(path: string): void {
    const now = fingerprint(path);

    if (now === undefined) {
      this.seen.delete(path);

      return;
    }

    this.seen.set(path, now);
  }

  /**
   * Whether the file still holds exactly what it
   * held when it was accounted for. Anything never
   * accounted for, or since deleted, has changed.
   */
  unchanged(path: string): boolean {
    const before = this.seen.get(path);

    return before !== undefined && before === fingerprint(path);
  }
}

function fingerprint(path: string): Fingerprint | undefined {
  try {
    const found = statSync(path, { bigint: true });

    return `${found.mtimeNs}:${found.size}`;
  } catch {
    return undefined;
  }
}
