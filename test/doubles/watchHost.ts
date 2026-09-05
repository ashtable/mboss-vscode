import type { Problem } from '../../src/problem.js';
import type { ProblemSink, WatchHost } from '../../src/watchers/host.js';

/**
 * The editor, as the watchers reach for it.
 *
 * Everything the real one does is something only a
 * running VS Code can do — mint a file watcher,
 * own the PROBLEMS panel — so a spec that wants to
 * say "a workflow file changed" has to say it to
 * one of these.
 *
 * It records rather than pretends: what was
 * watched, what was published, whether it was ever
 * disposed. A double that quietly succeeds at
 * everything turns a test into a statement about
 * the double.
 */

export type FakeHost = WatchHost & {
  /** Every glob this host was asked to watch. */
  watching: { folder: string; glob: string }[];

  /** Delivers a file event to whatever is watching
   *  that glob. */
  fire(glob: string, path: string): void;

  /** Delivers a save from the editor. */
  save(path: string): void;

  /** Every set of problems published, newest last. */
  published: Problem[][];

  /** Whether the PROBLEMS collection was let go
   *  of. */
  disposed: boolean;
};

export function fakeHost(opts: { folders: string[] }): FakeHost {
  const saves: ((path: string) => void)[] = [];
  const watchers = new Map<string, ((path: string) => void)[]>();
  const host: FakeHost = {
    watching: [],
    published: [],
    disposed: false,

    folders: () => opts.folders,

    watch: (folder, glob, listener) => {
      host.watching.push({ folder, glob });
      watchers.set(glob, [...(watchers.get(glob) ?? []), listener]);

      return { dispose: () => {} };
    },

    onSaved: (listener) => {
      saves.push(listener);

      return { dispose: () => {} };
    },

    problems: (): ProblemSink => ({
      publish: (problems) => void host.published.push([...problems]),
      dispose: () => void (host.disposed = true),
    }),

    fire: (glob, path) => {
      for (const listener of watchers.get(glob) ?? []) listener(path);
    },

    save: (path) => {
      for (const listener of saves) listener(path);
    },
  };

  return host;
}
