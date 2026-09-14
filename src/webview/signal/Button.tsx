import { useId, type ReactNode, type Ref } from 'react';

import { FieldHint } from './FieldHint.js';
import { hooked } from './hook.js';

/**
 * The one thing anybody presses.
 *
 * Four looks and no fifth. `primary` is the one
 * thing a surface is asking for, the outline
 * (`secondary` with the product's ink) is a second
 * choice that still has an edge, `quiet` is
 * everything that has to be there and should not be
 * read first, and `stop` is the one action that
 * halts a run. A neutral bordered button is a fifth
 * look, which is why the types refuse it: once there
 * are five, nobody can say what any of them means.
 *
 * Every word it draws arrives as a prop. Nothing
 * here is in any language, because this is drawn on
 * six surfaces in whatever language the editor is
 * running in.
 */

export type ButtonIcon = 'refresh' | 'send' | 'attach' | 'copy';

/**
 * The look, and the ink that goes with it.
 *
 * `primary` and `stop` carry their own ink — the one
 * on the brand ground, the other the failure tone —
 * so neither takes the prop at all.
 */
type Look =
  | { variant: 'primary' | 'stop'; ink?: never }
  | { variant: 'secondary'; ink: 'brand' }
  | { variant: 'quiet'; ink?: 'brand' };

/**
 * What it shows: a label, or a glyph with the label
 * said to a screen reader and shown on hover. A
 * glyph with no name is a control nobody can
 * describe.
 */
type Face =
  | { icon: ButtonIcon; label: string; children?: never }
  | { icon?: never; label?: never; children: ReactNode };

type Fitting = {
  /** `sm` is the size nearly everything is; `md` is
   *  the composer's own row of controls. */
  size?: 'sm' | 'md';

  /** The send with nothing to send yet: the same
   *  element and the same type, drawn as a hole. */
  empty?: boolean;

  /** Its label is machine evidence — an id, a state,
   *  the name of the agent that answered. */
  mono?: boolean;

  type?: 'button' | 'submit';

  disabled?: boolean;

  /** Why it will not answer, said beside it. A
   *  Button given one refuses rather than switching
   *  off: it stays somewhere a keyboard can land, so
   *  the reason can be read there. */
  reason?: string;

  /** Working. The label stays: a control that
   *  swapped its words for a spinner leaves nobody
   *  able to say what they pressed. */
  busy?: boolean;

  onClick?: () => void;

  ref?: Ref<HTMLButtonElement>;

  hook?: Record<string, string>;

  /** A class an existing journey finds it by. Kept
   *  narrow on purpose: a view positions a Button,
   *  it does not restyle one. */
  hookClass?: string;
};

export type ButtonProps = Look & Face & Fitting;

export function Button({
  variant,
  ink,
  size = 'sm',
  icon,
  label,
  empty,
  mono,
  type = 'button',
  disabled,
  reason,
  busy,
  onClick,
  ref,
  hook,
  hookClass,
  children,
}: ButtonProps) {
  const named = useId();

  // The native attribute takes a control out of the
  // tab order, so somebody on a keyboard cannot
  // reach the one thing that says why it will not
  // answer. Where there is a reason to give, the
  // Button stays a stop, says it is unavailable and
  // points at the reason; a tooltip would hide the
  // same sentence behind a pointer.
  const refusing = disabled === true && reason !== undefined;

  const control = (
    <button
      ref={ref}
      type={type}
      className={hookClass === undefined ? 'btn' : `btn ${hookClass}`}
      data-variant={variant}
      data-ink={ink}
      data-size={size}
      data-icon={icon}
      data-empty={empty === true ? '' : undefined}
      data-mono={mono === true ? '' : undefined}
      disabled={refusing ? undefined : disabled}
      aria-disabled={refusing ? true : undefined}
      aria-describedby={refusing ? named : undefined}
      aria-busy={busy === true ? true : undefined}
      aria-label={label}
      title={label}
      onClick={refusing ? undefined : onClick}
      {...hooked(hook)}
    >
      {icon === undefined ? <span>{children}</span> : <Glyph icon={icon} />}
    </button>
  );

  return refusing ? (
    <>
      {control}
      <FieldHint id={named}>{reason}</FieldHint>
    </>
  ) : (
    control
  );
}

/**
 * Lucide's paths, written out.
 *
 * A webview bundle that pulled the icon package
 * would carry a thousand glyphs to draw four, and
 * the four change only when somebody decides they
 * should. The licence is in THIRD_PARTY_NOTICES.md.
 *
 * They are drawn rather than typed because the
 * faces this extension ships have no arrows, no
 * check and no reload mark in them: a text glyph
 * here comes from whatever the platform falls back
 * to and is a different weight on every machine.
 */
const PATHS: Record<ButtonIcon, readonly string[]> = {
  // rotate-cw
  refresh: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],

  // arrow-up
  send: ['m5 12 7-7 7 7', 'M12 19V5'],

  // plus
  attach: ['M5 12h14', 'M12 5v14'],

  // copy, whose upper sheet is a rounded rectangle
  // in the original, written here as the path it
  // draws so the whole set is one list of paths.
  copy: [
    'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z',
    'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
  ],
};

function Glyph({ icon }: { icon: ButtonIcon }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[icon].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
