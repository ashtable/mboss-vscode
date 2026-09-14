import { glyphOf, type GlyphState } from '../states.js';

import { hooked } from './hook.js';

/**
 * What a state looks like, everywhere one is drawn.
 *
 * Seven glyph tables used to answer this question,
 * one per surface, and they disagreed: the same
 * parked run wore a turning mark on one panel and a
 * still dot on the next. There is one table now, in
 * `webview/states.ts`, and this is the only thing
 * that reads it — which is what keeps a state
 * looking like itself across six views.
 *
 * Three shapes, because there are three amounts of
 * room. A `mark` where a character fits, a `dot`
 * where nothing does, and a `rail` down the side of
 * a row whose whole width is the thing being toned.
 * The tone is the same in all three.
 *
 * Nothing here is in any language. A glyph that has
 * to be read out is handed its word; one standing
 * beside a word that already says the state is
 * hidden from a screen reader instead, so the state
 * is not said twice.
 */

/** The states drawn hollow unless somebody asks
 *  otherwise: nothing has happened at any of them
 *  yet, and a filled glyph is how this system says
 *  something has. */
const HOLLOW: readonly GlyphState[] = ['idle', 'queued', 'waiting'];

/** And the two that are still going, which are the
 *  only ones that move. */
const MOVING: readonly GlyphState[] = ['running', 'recovering'];

/** How wide a dot is where nobody asks for another
 *  size. */
const DOT = 8;

export function StatusGlyph({
  state,
  variant,
  size = DOT,
  pulse = MOVING.includes(state),
  breathe,
  hollow = HOLLOW.includes(state),
  label,
  hook,
}: {
  state: GlyphState;

  variant: 'dot' | 'mark' | 'rail';

  /** How wide a dot is drawn. Ignored by the other
   *  two: a mark is the size of its text and a rail
   *  is the width every rail is. */
  size?: number;

  /** Still true and not yet final. Defaults to the
   *  two states that are. */
  pulse?: boolean;

  /** The slower swell of something that is up and
   *  serving, which is a different claim from
   *  something that is part-way through. */
  breathe?: boolean;

  /** Forces the hollow shape on a state that would
   *  otherwise be filled — a watch somebody stopped
   *  reading, which is not the same as a run that
   *  stopped. */
  hollow?: boolean;

  /** What it is, for somebody who cannot see it.
   *  Passed only where no word stands beside the
   *  glyph, because two of them would say the state
   *  twice. */
  label?: string;

  hook?: Record<string, string>;
}) {
  const { tone, mark } = glyphOf(state);

  return (
    <span
      className="status-glyph"
      data-glyph={variant}
      data-state={state}
      data-hollow={variant === 'dot' && hollow ? '' : undefined}
      data-pulse={pulse ? '' : undefined}
      data-breathe={breathe === true ? '' : undefined}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      // The one table again: the shapes below paint
      // themselves in whatever this state's voice is,
      // and high contrast lifts all of them to its
      // own ink through the same fallback every other
      // toned rule reads.
      style={{
        color: `var(--state-ink, var(${tone}))`,
        ...(variant === 'dot' ? { width: size, height: size } : {}),
      }}
      {...hooked(hook)}
    >
      {variant === 'mark' ? mark : null}
    </span>
  );
}

/**
 * The same state with its word, and whatever the
 * surface has room to add after it.
 *
 * One line and never two: a state word that wrapped
 * away from its detail reads as two states.
 *
 * Where the state was worked out rather than read
 * off a row, the line says so in its title rather
 * than in a second word: the slot after the glyph is
 * already carrying the detail, and nothing else
 * names this line, so the title is what a pointer
 * and a screen reader both find there.
 */
export function StatusLine({
  state,
  word,
  detail,
  derived,
  hook,
}: {
  state: GlyphState;

  /** The state, in the reader's language. */
  word: string;

  /** What follows it: a step number, how long it
   *  took, when it woke. */
  detail?: string;

  /** The words admitting this state was worked out,
   *  where it was. Absent is the default and means
   *  recorded, which is the claim that needs no
   *  mark. */
  derived?: string;

  hook?: Record<string, string>;
}) {
  return (
    <span
      className="status-line"
      data-run-state={state}
      data-provenance={derived === undefined ? undefined : 'derived'}
      title={derived}
      {...hooked(hook)}
    >
      <StatusGlyph state={state} variant="mark" />

      <span>{word}</span>

      {detail === undefined ? null : <span>{` · ${detail}`}</span>}
    </span>
  );
}
