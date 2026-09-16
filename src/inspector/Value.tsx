import type { RecordedValue } from '../runs/rows.js';
import { Button } from '../webview/signal/Button.js';
import { StateWord } from '../webview/signal/StateWord.js';

/**
 * A value a run recorded, drawn the way its size
 * allows.
 *
 * Whole where it is short enough to read on the
 * card, and past that a one-line preview with its
 * size and a way to open all of it: a long payload
 * printed in full pushes everything under it out of
 * a docked pane. Which of the two a value is was
 * decided where the value was read, against the
 * one inline limit, so every card that shows a
 * recorded value draws the same value the same way.
 *
 * Every word arrives as a prop, and the value itself
 * is marked verbatim: it is what the run or the app
 * wrote, not something this extension says.
 */

/** The words a recorded value is drawn with. */
export type ValueWords = {
  inline: string;
  artifact: string;
  open: string;
};

/** One recorded value, in the section every card
 *  that shows one gives it. */
export function Recorded({
  value,
  words,
  onOpen,
  openHook,
}: {
  value: RecordedValue;
  words: ValueWords;

  /** Asks for the whole value, by whatever route
   *  the card's subject has to it. */
  onOpen: () => void;

  /** What the journeys find the Open Button by. */
  openHook: Record<string, string>;
}) {
  return (
    <div className="recorded" data-recorded="">
      {value.kind === 'inline' ? (
        <InlineValue text={value.text} word={words.inline} />
      ) : (
        <ArtifactRef
          preview={value.preview}
          size={value.size}
          word={words.artifact}
          open={words.open}
          onOpen={onOpen}
          hook={openHook}
        />
      )}
    </div>
  );
}

/**
 * A short value, whole, in a chip of its own.
 *
 * A value that fits the line stays on it; a longer
 * one wraps inside the chip under its own first
 * character, and an id with nowhere to break is
 * broken anyway rather than pushing the pane
 * sideways. Its spaces are kept, because they are
 * part of what was written.
 */
export function InlineValue({ text, word }: { text: string; word: string }) {
  return (
    <div className="inline-value">
      <StateWord tone="faint">{word}</StateWord>
      <span className="inline-chip" data-mono="" data-verbatim="">
        {text}
      </span>
    </div>
  );
}

/**
 * A value too long to show whole: its size, the
 * front of it on one line, and the way to open the
 * rest.
 */
export function ArtifactRef({
  preview,
  size,
  word,
  open,
  onOpen,
  hook,
}: {
  preview: string;
  size: string;
  word: string;
  open: string;
  onOpen: () => void;
  hook: Record<string, string>;
}) {
  return (
    <div className="artifact-ref">
      <StateWord tone="faint">{word}</StateWord>
      <span className="artifact-size" data-mono="">
        {size}
      </span>
      <span className="artifact-preview" data-mono="" data-verbatim="">
        {preview}
      </span>
      <Button variant="quiet" ink="brand" onClick={onOpen} hook={hook}>
        {open}
      </Button>
    </div>
  );
}
