import { postToHost } from '../webview/client.js';
import { filled } from '../webview/fill.js';
import { shortRunId } from '../webview/ids.js';
import type { RunLineage, RunRow, RunsStrings } from '../webview/protocol.js';
import { Button } from '../webview/signal/Button.js';
import { FieldHint } from '../webview/signal/FieldHint.js';
import { placed } from '../webview/signal/placed.js';
import { StatusGlyph } from '../webview/signal/StatusGlyph.js';

/**
 * One run in one line, and the selected one opened
 * under it: where it came from, what it threw, and
 * what can be done to it.
 *
 * The line is for scanning twenty runs without
 * scrolling, so it holds only what tells one run
 * from the next — a rail in the run's tone, its
 * short id, the workflow, its mark and the one line
 * the host summed it up in. Everything a person does
 * to a run waits until they pick it, so the list is
 * not a column of buttons.
 *
 * The head and the actions are siblings rather than
 * one inside the other: the head is a button, and a
 * button holds no button. The mark is an element of
 * its own and hidden from a screen reader, because
 * the line beside it starts with the same word and
 * a glyph that shared its colour with that word
 * would be two marks for one state.
 *
 * Which actions a run offers is the host's answer,
 * because the glyph cannot say it: a run that threw
 * and one DBOS gave up on are both failed, and only
 * the second can be resumed.
 */
export function RunHistoryItem({
  row,
  strings,
  selected,
  onPage,
}: {
  row: RunRow;
  strings: RunsStrings;
  selected: boolean;

  /** The runs the list draws, so a lineage id is a
   *  way to its row only where there is one to go
   *  to. */
  onPage: ReadonlySet<string>;
}) {
  const failed = row.state === 'failed';

  return (
    <li className="run-item" data-run={row.workflowId} data-outcome={row.state}>
      <button
        type="button"
        className="run-head"
        aria-expanded={selected}
        aria-current={selected}
        onClick={() =>
          postToHost({ type: 'runSelect', workflowId: row.workflowId })
        }
      >
        <StatusGlyph state={row.state} variant="rail" />
        <ShortRun
          id={row.workflowId}
          short={shortRunId(row.workflowId)}
          className="mono run-id"
        />
        <span className="mono run-name">{row.name}</span>
        <StatusGlyph state={row.state} variant="mark" />
        {/* The block in it is worked out from the last
            operation the run recorded, never read off
            a column, so the line says so. A failure
            is said in its tone: it is the line
            somebody opened this panel to find. */}
        <span
          className="mono run-summary"
          data-provenance="derived"
          data-tone={failed ? 'fail' : undefined}
          title={strings.derivedTitle}
        >
          {row.line}
        </span>
      </button>

      {selected ? (
        <div className="run-body">
          {row.lineage.map((line) => (
            <LineageLine
              key={`${line.direction}:${line.workflowId}`}
              line={line}
              strings={strings}
              onPage={onPage}
            />
          ))}

          {row.error === undefined ? null : (
            <FieldHint tone="fail">
              <span data-verbatim="">{row.error}</span>
            </FieldHint>
          )}

          {row.recoveredNote === undefined ? null : (
            <FieldHint hook={{ 'recovered-note': '' }}>
              {row.recoveredNote}
            </FieldHint>
          )}

          <Actions row={row} strings={strings} />
        </div>
      ) : null}
    </li>
  );
}

/**
 * What can be done to the run, in the order a
 * person reaches for them: look at it, stop it or
 * pick it back up, run it again, ask about it, and
 * take its id somewhere else.
 *
 * Replay and Ask agent only once the run is over:
 * neither means anything about a run still going.
 * A replay starts from the first row of its own that
 * threw where there is one, which is what the label
 * says, and from the top otherwise.
 */
function Actions({ row, strings }: { row: RunRow; strings: RunsStrings }) {
  const { workflowId, failedStep, controls } = row;
  const over = !controls.cancel;

  return (
    <div className="run-actions">
      <Button
        variant="secondary"
        ink="brand"
        hook={{ 'open-run': '' }}
        onClick={() => postToHost({ type: 'openRun', workflowId })}
      >
        {strings.openOnCanvas}
      </Button>

      {controls.cancel ? (
        <Button
          variant="stop"
          hook={{ 'cancel-run': '' }}
          onClick={() => postToHost({ type: 'cancelRun', workflowId })}
        >
          {strings.cancelRun}
        </Button>
      ) : null}

      {controls.resume ? (
        <Button
          variant="primary"
          hook={{ 'resume-run': '' }}
          onClick={() => postToHost({ type: 'resumeRun', workflowId })}
        >
          {strings.resumeRun}
        </Button>
      ) : null}

      {over ? (
        <Button
          variant="secondary"
          ink="brand"
          hook={{ 'replay-run': workflowId }}
          onClick={() =>
            postToHost(
              failedStep === undefined
                ? { type: 'replayRun', workflowId, from: 'start' }
                : { type: 'replayRun', workflowId, functionId: failedStep },
            )
          }
        >
          {failedStep === undefined
            ? strings.replayFromStart
            : strings.replayFromHere}
        </Button>
      ) : null}

      {over ? (
        <Button
          variant="quiet"
          hook={{ 'ask-agent': '' }}
          onClick={() => postToHost({ type: 'askAgent', workflowId })}
        >
          {strings.askAgent}
        </Button>
      ) : null}

      <Button
        variant="quiet"
        icon="copy"
        label={strings.copyRunId}
        hook={{ 'copy-run-id': workflowId }}
        onClick={() => postToHost({ type: 'copyRunId', workflowId })}
      />
    </div>
  );
}

/**
 * One end of a replay, in the Inspector's words
 * for it.
 *
 * The ids are read off the ledger and the step is
 * worked out from the rows the replay copied, so the
 * step is the phrase marked as derived. An id is a
 * way to its row only where the list draws that row:
 * picking a run the list does not hold would mark a
 * different one, so an id further down the history
 * stays a name.
 */
function LineageLine({
  line,
  strings,
  onPage,
}: {
  line: RunLineage;
  strings: RunsStrings;
  onPage: ReadonlySet<string>;
}) {
  const name = <ShortRun id={line.workflowId} short={line.short} />;

  const id = onPage.has(line.workflowId) ? (
    <Button
      variant="quiet"
      mono
      hook={{ 'lineage-run': line.workflowId }}
      onClick={() =>
        postToHost({ type: 'runSelect', workflowId: line.workflowId })
      }
    >
      {name}
    </Button>
  ) : (
    name
  );

  const step = (
    <span data-provenance="derived" title={strings.derived}>
      {filled(strings.fromStep, String(line.startStep))}
    </span>
  );

  return (
    <p
      className="run-lineage"
      data-mono=""
      data-replay-of={line.direction === 'of' ? '' : undefined}
      data-run-fork={line.direction === 'to' ? '' : undefined}
    >
      {line.direction === 'of'
        ? placed(strings.replayOf, id, step)
        : placed(strings.replayTo, step, id, line.word)}
    </p>
  );
}

/** A run's short id, carrying the whole of it: four
 *  characters collide about once in fifty runs. */
function ShortRun({
  id,
  short,
  className,
}: {
  id: string;
  short: string;
  className?: string;
}) {
  return (
    <span className={className} data-short-run={id} title={id}>
      {short}
    </span>
  );
}
