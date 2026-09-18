import { Fragment, type ReactNode } from 'react';

/**
 * A template's `{n}` placeholders, filled with
 * things to draw rather than text, so a Button or a
 * marked phrase sits wherever the language puts it.
 *
 * Shared because two views draw a run's lineage as
 * one sentence with its ids as Buttons in it — the
 * Inspector's card and the Runs list — and a
 * translator words that sentence once for both.
 */
export function placed(template: string, ...parts: ReactNode[]): ReactNode[] {
  return template.split(/(\{\d+\})/).map((piece, at) => {
    const slot = /^\{(\d+)\}$/.exec(piece);

    return slot === null ? (
      piece
    ) : (
      <Fragment key={at}>{parts[Number(slot[1])]}</Fragment>
    );
  });
}
