import type { ReactNode } from 'react';

import { hooked } from './hook.js';

/**
 * Something a person must know before going on,
 * set apart from what is around it.
 *
 * A flat block on the tint of its tone rather than a
 * card: it is a thing to read, not a thing to pick
 * up or act on, and the controls that act on it sit
 * outside it. The title is its own element and comes
 * first — what happened, at the weight of a title
 * and in the state's ink — and the body under it
 * says what that means, a step quieter.
 *
 * Three tones, because the three things a surface
 * stops to say are that something failed, that
 * something is waiting, and how something works.
 */
export function Callout({
  tone,
  title,
  children,
  hook,
}: {
  tone: 'fail' | 'info' | 'warn';

  title: string;

  children?: ReactNode;

  hook?: Record<string, string>;
}) {
  return (
    <div className="callout" data-tone={tone} {...hooked(hook)}>
      <p className="callout-title">{title}</p>

      {children === undefined ? null : (
        <div className="callout-body">{children}</div>
      )}
    </div>
  );
}
