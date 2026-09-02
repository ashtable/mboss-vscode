import type { HTMLAttributes } from 'react';

/**
 * A box with registration marks at its corners.
 *
 * The marks are the design system's one piece of
 * ornament, and they carry a meaning worth keeping
 * here: this is a drawing, and it was plotted
 * rather than arranged. Everything in this
 * extension that a user could mistake for a
 * hand-made picture — the graph, a proposal
 * preview, a run's timeline — is machine-laid, so
 * the frame belongs on all of them.
 *
 * The marks sit outside the border, so an ancestor
 * that clips will cut them off. They are optional
 * because the frame is also the plain square box
 * this system draws everything in, and marking
 * every one of them would leave the marks meaning
 * nothing.
 */
export function Registered({
  className,
  marks = true,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { marks?: boolean }) {
  return (
    <div
      {...rest}
      className={
        className === undefined ? 'blueprint' : `blueprint ${className}`
      }
    >
      {marks ? (
        <>
          <span className="corner tl" />
          <span className="corner tr" />
          <span className="corner bl" />
          <span className="corner br" />
        </>
      ) : null}
      {children}
    </div>
  );
}
