/**
 * How far a pointer has to travel before a press
 * becomes a drag.
 *
 * A press is also how a person points at something,
 * and a hand resting on a mouse moves a pixel or two
 * on its own. Without a threshold a chip would leave
 * the rail every time somebody put the pointer on it
 * to read the label.
 */
export const DRAG_THRESHOLD = 4;

/** Whether the pointer has moved far enough from
 *  where it went down to mean it. */
export function pastThreshold(
  from: { x: number; y: number },
  at: { x: number; y: number },
): boolean {
  return Math.hypot(at.x - from.x, at.y - from.y) >= DRAG_THRESHOLD;
}
