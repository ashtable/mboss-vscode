/**
 * One scheduler for every watcher in the extension.
 *
 * Nothing in the editor's file-watching API
 * coalesces anything. A `git checkout`, a formatter
 * touching a directory, or an agent applying
 * several edits in a row each arrive as their own
 * event, and the work hanging off them —
 * regenerating a project's code — takes seconds and
 * takes the project's write lock. One run per event
 * would spend a minute doing the same thing twenty
 * times, and would leave the timing on the status
 * bar meaning nothing.
 *
 * There is one of these rather than one per watcher
 * because the watchers are three views of the same
 * question. A workflow document changing, a handler
 * changing and a save all mean "this project needs
 * generating again", and three separate schedulers
 * would answer that question three times over.
 */

/** Long enough to swallow a burst, short enough
 *  that a save still feels immediate. */
export const DEBOUNCE_MS = 300;

/** What is known about a key between events. */
type Pending = {
  timer?: ReturnType<typeof setTimeout>;
  /** The newest job, kept rather than run, until
   *  the events stop. */
  next?: () => Promise<void>;
  running: boolean;
};

export class Debouncer {
  private readonly keys = new Map<string, Pending>();

  private disposed = false;

  constructor(private readonly waitMs: number = DEBOUNCE_MS) {}

  /**
   * Asks for `run` to happen once the events for
   * `key` have stopped.
   *
   * Two guarantees, and the second is the one that
   * is easy to miss. A burst costs one run. And an
   * event that arrives while a run is going still
   * gets a run — a save during a code generation is
   * ordinary, and dropping it would leave the
   * generated code a version behind with nothing on
   * screen to say so.
   */
  schedule(key: string, run: () => Promise<void>): void {
    if (this.disposed) return;

    const pending = this.keys.get(key) ?? { running: false };
    this.keys.set(key, pending);

    pending.next = run;

    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => void this.start(key), this.waitMs);
  }

  /** Drops everything not yet started. Whatever is
   *  already running finishes. */
  dispose(): void {
    this.disposed = true;

    for (const pending of this.keys.values()) {
      clearTimeout(pending.timer);
      pending.next = undefined;
    }

    this.keys.clear();
  }

  /**
   * Runs the newest job for a key, unless one is
   * already going — in which case finishing it is
   * what starts the next.
   */
  private async start(key: string): Promise<void> {
    const pending = this.keys.get(key);
    if (pending === undefined || pending.running) return;

    const run = pending.next;
    if (run === undefined) return;

    pending.next = undefined;
    pending.running = true;

    try {
      await run();
    } catch {
      // Swallowed on purpose. The job here ends up
      // being a compile over a document somebody is
      // still typing into, and a rejection that took
      // the scheduler down with it would stop every
      // later save from regenerating anything, with
      // nothing said anywhere. What went wrong is
      // reported by the job itself, in PROBLEMS.
    } finally {
      pending.running = false;
    }

    if (pending.next !== undefined) await this.start(key);
  }
}
