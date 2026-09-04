/**
 * The pointer's own arrow, worn by whatever is
 * following it.
 *
 * A block is 230 pixels wide and half see-through
 * while it is being carried, which leaves nothing
 * saying where the pointer actually is on it —
 * and where the pointer is decides where the block
 * lands. So the arrow is drawn onto the thing being
 * carried rather than left to the cursor underneath,
 * which the shape is over the top of anyway.
 *
 * Ink on the surface colour, so it reads against a
 * block of any tone.
 */
export function CursorBadge() {
  return (
    <svg
      className="cursor-badge"
      width="14"
      height="16"
      viewBox="0 0 14 16"
      aria-hidden="true"
    >
      <path
        d="M1 1l4.5 13 2.2-5.3L13 6.5z"
        fill="var(--ink)"
        stroke="var(--surface)"
        strokeWidth="1.2"
      />
    </svg>
  );
}
