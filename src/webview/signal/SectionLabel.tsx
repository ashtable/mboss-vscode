import type { ReactNode } from 'react';

import { hooked } from './hook.js';

/**
 * The label over a group of things.
 *
 * Small, a little opened up, and in the case it was
 * written in. Capitals are how this system says what
 * state something is in, so a label wearing them
 * spends that signal on furniture and leaves a
 * person scanning a page of shouting for the one
 * word that matters.
 *
 * A heading level is asked for rather than assumed:
 * most of these title a group inside a panel and are
 * not landmarks, and a page of `h2`s that lead
 * nowhere is worse for somebody moving by heading
 * than a page of none.
 */
export function SectionLabel({
  children,
  tone,
  level,
  id,
  hook,
}: {
  children: ReactNode;

  tone?: 'muted' | 'faint';

  level?: 2 | 3;

  /** What a group of controls names to be read out
   *  by this label. */
  id?: string;

  hook?: Record<string, string>;
}) {
  const Heading = level === undefined ? 'p' : level === 2 ? 'h2' : 'h3';

  return (
    <Heading
      className="section-label"
      id={id}
      data-tone={tone}
      {...hooked(hook)}
    >
      {children}
    </Heading>
  );
}
