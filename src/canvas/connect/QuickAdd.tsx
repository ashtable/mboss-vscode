import { useEffect, useRef } from 'react';

import type { NodeKind } from '../../core/rules.js';

/**
 * The kinds a wire let go of on nothing could reach.
 *
 * Letting go over open canvas is not a mistake to
 * undo — it is somebody saying "and then something
 * here", without a name for the something yet. So
 * the answer is the same rail they would have
 * dragged from, cut down to the kinds that could
 * actually take the wire.
 *
 * Drawn where the pointer was rather than on the
 * graph, because it is a question about the gesture
 * and not a thing on the workflow: it must not pan
 * away or grow with the zoom while it is being read.
 */
export function QuickAdd({
  kinds,
  labels,
  at,
  heading,
  onPick,
  onClose,
}: {
  kinds: readonly NodeKind[];

  labels: Record<NodeKind, string>;

  /** Where the wire was let go of, in the page's own
   *  coordinates. */
  at: { x: number; y: number };

  heading: string;

  onPick: (kind: NodeKind) => void;

  onClose: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);

  // The gesture ended on this list, so this is where
  // the person is. Taking the focus is also what puts
  // Escape and the arrow keys where they expect them.
  useEffect(() => first.current?.focus(), []);

  return (
    <div
      className="quick-add card"
      data-quick-add
      style={{ left: at.x, top: at.y }}
      onKeyDown={(key) => {
        if (key.key === 'Escape') onClose();
      }}
    >
      <p className="eyebrow">{heading}</p>

      {kinds.map((kind, index) => (
        <button
          key={kind}
          ref={index === 0 ? first : undefined}
          type="button"
          className="quick-add-kind"
          data-quick-add-kind={kind}
          onClick={() => onPick(kind)}
        >
          {labels[kind]}
        </button>
      ))}
    </div>
  );
}
