import { inlineJson, payloadIn, recordedValue } from '../runs/rows.js';
import type { WorkflowTrigger } from '../runs/workflows.js';
import { filled } from '../webview/fill.js';
import type {
  InspectorStrings,
  RunInputView,
  TestRunProblem,
} from '../webview/protocol.js';

/**
 * The Runs view, as a trigger's card shows it.
 *
 * What the Runs view holds about a document is read
 * on the host — its input box, the saved workflows,
 * whether the buffer is saved, whether the window is
 * trusted. What the card says of that used to be
 * worked out in the pane: the sample as a recorded
 * value, the sentence about a Runs view set to
 * another workflow, why the last start was refused,
 * and whether Run would start what the canvas
 * shows. Those are rules about what a person sees
 * rather than about the box, and they are answered
 * here once, so the pane draws them and every one
 * of them is pinned without a browser.
 */

/** What was read of the Runs view about one
 *  document. */
export type RunInputRead = {
  /** What the Runs view's input box holds right
   *  now. */
  text: string;

  /** The workflow the Runs view is set to. */
  selectedWorkflow: string | undefined;

  /** This document's entry in the Runs view's
   *  saved workflows, matched by file path. */
  saved: { name: string; mode: WorkflowTrigger['mode'] } | undefined;

  /** Why the saved file is not runnable although it
   *  is on disk: its event trigger has no topic. */
  needsTopic: boolean;

  /** The document buffer has unsaved changes, so a
   *  run would start the saved workflow, not the
   *  one shown. */
  unsaved: boolean;

  /** This window may run the project's code. A run
   *  executes what the folder holds, which is the
   *  decision trust exists to make. */
  trusted: boolean;

  problem: TestRunProblem | undefined;
};

/** The card, from what was read. */
export function runCardOf(
  read: RunInputRead,
  strings: InspectorStrings,
): RunInputView {
  const { saved, selectedWorkflow, problem } = read;

  return {
    saved: saved?.name,
    sample: sampleOf(read.text, strings),

    // Set to no workflow, the Runs view has none for
    // a run to switch it from.
    switches:
      saved === undefined ||
      selectedWorkflow === undefined ||
      selectedWorkflow === saved.name
        ? undefined
        : filled(strings.localRunsSetTo, selectedWorkflow, saved.name),

    // A refusal is about the workflow the Runs view
    // is set to, which is this card's only when it
    // is this workflow.
    refused:
      saved !== undefined && selectedWorkflow === saved.name
        ? problem?.detail
        : undefined,

    start: startFrom(read, strings),
  };
}

/**
 * The Runs view's input as a card draws it, or
 * nothing for an empty box.
 *
 * JSON is printed the way a recorded payload is, and
 * anything else as it was typed; either is whole
 * where it is short and named by its size where it
 * is not, by the one rule every recorded value is
 * drawn under.
 */
function sampleOf(
  typed: string,
  strings: InspectorStrings,
): RunInputView['sample'] {
  const read = payloadIn(typed);

  // JSON has no `undefined`, so only an empty box
  // reads as one.
  if (read.ok && read.value === undefined) return undefined;

  const shown = read.ok ? inlineJson(read.value) : typed;

  return {
    json: read.ok,
    value: recordedValue(
      shown,
      new TextEncoder().encode(typed).length,
      strings.sizes,
    ),
  };
}

/**
 * Whether Run with this input would start what the
 * canvas shows, and why not where it would not.
 *
 * A run starts the workflow as it was saved and
 * built, by its saved name. So any unsaved change —
 * to this trigger or to any other block — means a
 * run would start something that is not on screen,
 * and that is said first, since saving is also how
 * a file gets a topic it lacks. A file the Runs view
 * has no entry for was never saved, or was saved as
 * an event trigger with no topic, and only the
 * second has more to say.
 */
function startFrom(
  read: RunInputRead,
  strings: InspectorStrings,
): RunInputView['start'] {
  const { saved, unsaved, needsTopic, trusted } = read;

  // Said before anything about the file, because
  // nothing a person does to the document changes
  // it: a window nobody has trusted runs nothing
  // the folder holds.
  if (!trusted) return { ok: false, reason: strings.untrusted };

  if (!unsaved && saved !== undefined && saved.mode !== 'schedule') {
    return { ok: true, workflow: saved.name };
  }

  return {
    ok: false,
    reason: !unsaved && needsTopic ? strings.needsTopic : strings.saveToRun,
  };
}
