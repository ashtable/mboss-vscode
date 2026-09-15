import { useRef, useState, type CSSProperties } from 'react';

import { hooked } from './hook.js';

/**
 * The three things a value is typed or picked in.
 *
 * Each is the native control, because the browser's
 * own is the one a keyboard, a screen reader and a
 * forced-colours theme already know. What this adds
 * is the look — no box at rest, one ring while in
 * use — and when a typed value counts as given.
 *
 * A value is given when the person is finished with
 * it, never per keystroke: Enter, or leaving the
 * field. Escape puts back what was there. And a
 * value is given once: whoever is told has already
 * answered by the time focus moves on, and a second
 * copy arriving after that answer is an edit made
 * against a document that has moved.
 *
 * A field inside a row takes its name from the
 * row's label. The few no label points at — one
 * half of a pair, a name typed for something not
 * written yet — carry theirs in `label`.
 *
 * A value somebody may read and not set is still
 * drawn in its field: read-only where the browser
 * has such a state, so it can be read out and
 * copied from, and switched off where it does not.
 */

/** What every field is told about where it sits. */
type Placed = {
  /** What the row's label points at. */
  id?: string;

  /** The name, for a field no label points at. */
  label?: string;

  /** The ids of whatever says more about the value:
   *  its unit, a note about it. */
  describedBy?: string;

  /** Its value is machine evidence — a path, a
   *  count, a name out of the code. */
  mono?: boolean;

  hook?: Record<string, string>;
};

/**
 * One line of text.
 *
 * `commitOnBlur` is off where giving a value writes
 * something that cannot quietly be taken back — a
 * function's name, which becomes a stub on disk —
 * so only Enter gives it, and leaving the field
 * puts it back.
 */
export function Input({
  id,
  label,
  describedBy,
  mono,
  hook,
  value,
  placeholder,
  readOnly,
  commitOnBlur = true,
  autoFocus,
  onCommit,
  onAbandon,
}: Placed & {
  value: string;

  /** The word standing in for a value nobody has
   *  given. */
  placeholder?: string;

  readOnly?: boolean;

  commitOnBlur?: boolean;

  autoFocus?: boolean;

  onCommit: (value: string) => void;

  /** The person put the value back: Escape, or
   *  leaving a field that gives nothing on blur. */
  onAbandon?: () => void;
}) {
  const [typed, setTyped] = useState(value);
  const { changed, commit } = useCommit(value, onCommit);

  const abandon = (): void => {
    setTyped(value);
    onAbandon?.();
  };

  return (
    <input
      type="text"
      className="field-input"
      id={id}
      aria-label={label}
      aria-describedby={describedBy}
      data-mono={mono === true ? '' : undefined}
      value={typed}
      placeholder={placeholder}
      readOnly={readOnly}
      spellCheck={false}
      autoFocus={autoFocus}
      onChange={(event) => setTyped(event.target.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;

        if (event.key === 'Escape') {
          abandon();

          return;
        }

        if (event.key !== 'Enter') return;

        event.preventDefault();
        if (changed(typed)) commit(typed);
      }}
      onBlur={() => {
        if (!commitOnBlur) abandon();
        else if (changed(typed)) commit(typed);
      }}
      {...hooked(hook)}
    />
  );
}

/**
 * Several lines of text.
 *
 * Enter is a new line here, so leaving the field is
 * what gives the value. `grow` sizes the box by what
 * is in it, between two heights counted in lines of
 * its own type, so a short body is not a box of
 * blank lines and a long one does not push the rest
 * of the form out of the pane.
 */
export function TextArea({
  id,
  label,
  describedBy,
  mono,
  hook,
  value,
  placeholder,
  readOnly,
  grow,
  onChange,
  onCommit,
}: Placed & {
  value: string;

  placeholder?: string;

  readOnly?: boolean;

  grow?: { minLines: number; maxLines: number };

  /** Every keystroke, for a field whose owner keeps
   *  what is typed as it is typed. */
  onChange?: (value: string) => void;

  onCommit?: (value: string) => void;
}) {
  const [typed, setTyped] = useState(value);
  const { changed, commit } = useCommit(value, onCommit);

  // The sheet counts the heights; the numbers of
  // lines are the one thing a caller decides.
  const lines =
    grow === undefined
      ? undefined
      : ({
          '--min-lines': grow.minLines,
          '--max-lines': grow.maxLines,
        } as CSSProperties);

  return (
    <textarea
      className="field-input"
      id={id}
      aria-label={label}
      aria-describedby={describedBy}
      data-mono={mono === true ? '' : undefined}
      data-grow={grow === undefined ? undefined : ''}
      style={lines}
      value={typed}
      placeholder={placeholder}
      readOnly={readOnly}
      spellCheck={false}
      onChange={(event) => {
        setTyped(event.target.value);
        onChange?.(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setTyped(value);
      }}
      onBlur={() => {
        if (changed(typed)) commit(typed);
      }}
      {...hooked(hook)}
    />
  );
}

/**
 * One of a few.
 *
 * The native menu, with the browser's own arrow
 * taken off and a drawn one put beside it. The
 * drawn one shows only while the menu is pointed at
 * or in use: at rest a column of menus would be a
 * column of arrows, and in a theme that draws every
 * field's edge, that edge already says it is a
 * field.
 */
export function Select({
  id,
  label,
  describedBy,
  mono,
  hook,
  value,
  options,
  disabled,
  onChange,
}: Placed & {
  value: string;

  options: readonly { value: string; label: string }[];

  disabled?: boolean;

  onChange: (value: string) => void;
}) {
  return (
    <span className="field-select">
      <select
        className="field-input"
        id={id}
        aria-label={label}
        aria-describedby={describedBy}
        data-mono={mono === true ? '' : undefined}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        {...hooked(hook)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {/* Lucide's chevron-down, drawn rather than
          typed or loaded: the shipped faces have no
          arrow in them, and the page's policy loads
          no image. */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
}

/**
 * Whether typed text is a value nobody has been
 * given yet, and the way to give it.
 *
 * Text is new when it differs from what the field
 * was drawn with and from what it last gave. The
 * second matters because the owner may write the
 * value back differently — `5.0` comes back as `5`
 * — and the field would otherwise take its own text
 * for a change nobody has sent. What was given is
 * forgotten when the field is drawn afresh, which
 * is when the owner's answer has arrived.
 */
function useCommit(
  value: string,
  onCommit: ((value: string) => void) | undefined,
): { changed: (typed: string) => boolean; commit: (typed: string) => void } {
  const last = useRef<string | undefined>(undefined);

  return {
    changed: (typed) =>
      onCommit !== undefined && typed !== value && typed !== last.current,
    commit: (typed) => {
      last.current = typed;
      onCommit?.(typed);
    },
  };
}
