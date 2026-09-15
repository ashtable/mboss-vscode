import type { ReactNode } from 'react';

/**
 * The row at the top of the Inspector: what the
 * pane is about, what kind of thing that is, and
 * where it got to.
 *
 * One row for every subject, so a block, a whole
 * run and an empty pane each name themselves in the
 * same place. It stays put above whatever scrolls
 * under it, so somebody scrolled down a long card
 * still sees which thing the card is about.
 *
 * The title is a slot rather than a string because
 * what it holds differs by subject: a heading where
 * the name is only read, a field where a block is
 * renamed.
 *
 * Where the row runs out of room, what follows the
 * title wraps under it. The status wraps as one
 * piece and never inside itself, because a state
 * word that wrapped away from its duration reads as
 * two states. A file name is different: it is a
 * long machine name that gives way, cut short at
 * the row's far end, before the title does.
 */
export function InspectorHeader({
  title,
  kind,
  status,
  file,
}: {
  title: ReactNode;

  /** What kind of thing the title names, in the
   *  machine face: a block's kind, or "run" and its
   *  short id. */
  kind?: ReactNode;

  /** Where it got to, as a StatusLine. */
  status?: ReactNode;

  /** The canvas file an empty pane is waiting on. */
  file?: string;
}) {
  return (
    <header className="inspector-header" data-inspector-header>
      {title}

      {kind === undefined ? null : (
        <span className="inspector-kind" data-inspector-kind="" data-mono="">
          {kind}
        </span>
      )}

      {status === undefined ? null : (
        <>
          <span className="inspector-spacer" aria-hidden="true" />
          <span className="inspector-status">{status}</span>
        </>
      )}

      {file === undefined ? null : (
        <span
          className="inspector-file"
          data-inspector-file
          data-mono=""
          title={file}
        >
          {file}
        </span>
      )}
    </header>
  );
}
