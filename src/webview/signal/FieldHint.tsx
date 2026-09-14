import type { ReactNode } from 'react';

import { hooked } from './hook.js';

/**
 * The line under a control saying something about
 * it.
 *
 * Always in the machine face, because what these say
 * is evidence rather than prose: what a field was
 * given, why a rule refused it, how a gesture works.
 * The tones are the voice's, and only the three that
 * name something gone wrong take one — a hint with
 * no tone is the quietest step this system has, and
 * that is what nearly all of them are.
 *
 * A span rather than a paragraph because a hint sits
 * inside a control as often as under one — the
 * reason a row cannot take a function is drawn
 * inside that row — and only an inline element is
 * valid in both places.
 */
export function FieldHint({
  children,
  tone,
  id,
  hook,
  hookClass,
}: {
  children: ReactNode;

  tone?: 'faint' | 'muted' | 'warn' | 'fail' | 'agent';

  /** What a control names to have this read out
   *  with it. */
  id?: string;

  hook?: Record<string, string>;

  /** A class an existing journey finds it by. Kept
   *  narrow on purpose: a view positions a hint, it
   *  does not restyle one. */
  hookClass?: string;
}) {
  return (
    <span
      className={
        hookClass === undefined ? 'field-hint' : `field-hint ${hookClass}`
      }
      id={id}
      data-tone={tone}
      data-mono=""
      {...hooked(hook)}
    >
      {children}
    </span>
  );
}
