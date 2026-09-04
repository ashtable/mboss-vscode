import type { CanvasStrings } from '../../webview/protocol.js';

import { GAP_HEIGHT, GAP_WIDTH, type SpliceGap } from './gaps.js';

/**
 * Where the block could go, drawn on the graph while
 * it is being carried.
 *
 * Every wire opens one, so a person can see the
 * whole offer at once rather than hunting for it a
 * wire at a time. Only the one under the pointer
 * says what would happen — filling all of them in
 * would say the block was about to go into all of
 * them.
 */
export function SpliceGaps({
  gaps,
  under,
  strings,
}: {
  gaps: readonly SpliceGap[];

  /** The wire the drop would split, if the pointer
   *  is over one. */
  under: string | undefined;

  strings: CanvasStrings;
}) {
  return (
    <>
      {gaps.map((gap) => (
        <div
          key={gap.edgeId}
          className="splice-gap"
          data-splice-gap={gap.edgeId}
          data-under={gap.edgeId === under ? '' : undefined}
          style={{
            transform: `translate(${gap.at.x - GAP_WIDTH / 2}px, ${
              gap.at.y - GAP_HEIGHT / 2
            }px)`,
            width: GAP_WIDTH,
            height: GAP_HEIGHT,
          }}
        >
          {gap.edgeId === under ? (
            <>
              <p className="splice-title">{strings.spliceHere}</p>
              <p className="splice-note mono">{strings.spliceNote}</p>
            </>
          ) : null}
        </div>
      ))}
    </>
  );
}
