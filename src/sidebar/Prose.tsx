import type { ReactNode } from 'react';

import { parseInline, type ProseRun } from './markdown.js';

/**
 * A stretch of prose, drawn from the blocks the
 * reader found in it.
 *
 * Elements, never markup from a string: whatever
 * the text quotes is shown as text. Whether it is
 * somebody's own words — the agent's, or a person's
 * — is the caller's to say, because the same reader
 * draws a sentence mBoss wrote for the column, and
 * only words nobody at mBoss chose are set apart as
 * verbatim.
 */
export function Prose({
  text,
  verbatim,
}: {
  text: string;

  /** The words are the agent's or a person's own,
   *  as they arrived. */
  verbatim: boolean;
}) {
  return (
    <div className="prose" data-verbatim={verbatim ? '' : undefined}>
      {parseInline(text).map((block, index) =>
        block.at === 'paragraph' ? (
          <p key={index}>{runs(block.runs)}</p>
        ) : block.ordered ? (
          <ol key={index} start={block.start}>
            {items(block.items)}
          </ol>
        ) : (
          <ul key={index}>{items(block.items)}</ul>
        ),
      )}
    </div>
  );
}

function items(list: readonly ProseRun[][]): ReactNode {
  return list.map((item, index) => <li key={index}>{runs(item)}</li>);
}

function runs(list: readonly ProseRun[]): ReactNode {
  return list.map((run, index) =>
    run.at === 'strong' ? (
      <strong key={index}>{run.text}</strong>
    ) : run.at === 'code' ? (
      <code key={index} data-mono="">
        {run.text}
      </code>
    ) : (
      run.text
    ),
  );
}
