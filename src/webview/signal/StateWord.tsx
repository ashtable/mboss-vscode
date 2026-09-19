import { hooked } from './hook.js';

/**
 * What something is doing right now, in the one
 * treatment this system sets in capitals.
 *
 * Capitals are a signal rather than a style, so they
 * are spent here and nowhere else: a page where the
 * labels, the tabs and the headings all shout has
 * nothing left to say "this one is running". The
 * word itself arrives lowercase, as the data it is;
 * the shouting belongs to the rule.
 *
 * It is never clickable. A state is something that
 * happened, not somewhere to go.
 */
export function StateWord({
  children,
  tone,
  pulse,
  hook,
}: {
  children: string;

  tone: 'muted' | 'faint' | 'ok' | 'warn' | 'fail' | 'brand' | 'agent';

  /** Still true and not yet final. */
  pulse?: boolean;

  hook?: Record<string, string>;
}) {
  return (
    <span
      className="state-word"
      data-tone={tone}
      data-pulse={pulse === true ? '' : undefined}
      {...hooked(hook)}
    >
      {children}
    </span>
  );
}
