import type { ReactNode } from 'react';

import { DEFAULT_RETRY } from '../core/rules.js';
import type {
  LibFunction,
  NodeKind,
  QueuePolicy,
  Retry,
} from '../core/rules.js';
import type { StepError } from '../runs/rows.js';
import { postToHost } from '../webview/client.js';
import { filled } from '../webview/fill.js';
import type { InspectorStrings, ShownRun } from '../webview/protocol.js';
import { Button } from '../webview/signal/Button.js';
import { Callout } from '../webview/signal/Callout.js';
import { FieldHint } from '../webview/signal/FieldHint.js';
import { LibFunctionItem } from '../webview/signal/LibFunctionItem.js';
import { PropertyRow } from '../webview/signal/PropertyRow.js';
import { SectionLabel } from '../webview/signal/SectionLabel.js';
import { StatusLine } from '../webview/signal/StatusGlyph.js';
import { duration, fine } from '../webview/time.js';
import type { RunState } from '../canvas/graph.js';
import { signatureOf } from '../canvas/libFunction.js';

import { outputOf, type BlockEvidence, type EvidenceRow } from './evidence.js';
import { QueueCard } from './QueueCard.js';
import { Recorded } from './Value.js';

/**
 * The Inspector's Run evidence face: what one run
 * recorded about the block on screen.
 *
 * Nothing on it can be edited and nothing on it was
 * read off the document but the one policy a person
 * needs beside the rows, marked as configuration.
 * It reads top to bottom as one answer: the function
 * that ran, how it failed and what to do about it,
 * when it ran, how hard it was allowed to try, what
 * it returned, the ways on from it, and what that
 * returned value is for.
 *
 * One row is drawn in full. Where somebody picked a
 * row of the block on the run tab it is that row,
 * the SDK's own included; otherwise the block's
 * headline. The head of the pane says the same row,
 * so the head, the face and the trace agree on it.
 *
 * What is deliberately absent is the point of it.
 * DBOS records no per-step input and no count of the
 * tries behind a row, and what the run was started
 * with, its status column and who ran it are facts
 * about the whole run, drawn on the card about the
 * run and nowhere else.
 */

/** The block a face is about, as a face reads one:
 *  its identity and its policy rather than the node,
 *  so nothing here can drift into being a second
 *  form. */
export type EvidenceBlock = {
  id: string;

  /** Nothing for a block a run recorded and the
   *  document has lost since. */
  kind: NodeKind | undefined;

  /** The named export it runs, where it runs one. */
  handler: string | undefined;

  /** The policy the document gives it, where it
   *  gives one rather than leaving the defaults. */
  retry: Retry | undefined;

  /**
   * The blocks it encloses, where it is a loop: a
   * row records the round it ran in, not which loop
   * counted it, so only the document can say which
   * rows are this loop's.
   */
  body: readonly string[] | undefined;

  /** The queue it fills, where it is a queue block,
   *  which only the document names. */
  queue: QueuePolicy | undefined;

  /** Whether it is a wait on the clock, whose row's
   *  completion is when it wakes. */
  onClock: boolean;
};

/**
 * The kinds that run their code as a step, and so
 * run it under a policy.
 *
 * A transaction is not here and is told something
 * else: its writes and the record that they ran
 * commit together, so a second try is not a thing
 * the generated code can ask for. A wait is not
 * here either — what a wait retries is registering
 * itself, and a policy line about a run that is
 * parked would read as how hard it is trying to hear
 * back, which is not what it means.
 */
const RETRIES: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'step',
  'codeStep',
  'apiCall',
  'emailSend',
  'approval',
  'branch',
]);

/**
 * Where the block got to, for the head of the pane:
 * nothing where the run says nothing about it.
 *
 * The drawn row's state and number where there is a
 * row. A trigger writes none — the run existing is
 * the evidence it fired — and a block the run may
 * be at has written none yet; both states are worked
 * out rather than read, and the line says so where a
 * pointer and a screen reader find it. A queue
 * block's state is its children's, and they are
 * seldom all at one: its card says where each got
 * to, and one word here would be a summary nothing
 * recorded.
 */
export function evidenceStatus({
  strings,
  block,
  row,
  runState,
}: {
  strings: InspectorStrings;
  block: EvidenceBlock;
  row: EvidenceRow | undefined;
  runState: RunState | undefined;
}): ReactNode {
  if (block.kind === 'queue') return undefined;

  if (block.kind === 'trigger') {
    return runState === undefined ? undefined : (
      <StatusLine
        state={runState}
        word={strings.runStates[runState]}
        derived={strings.triggerDerived}
      />
    );
  }

  if (row !== undefined) {
    return (
      <StatusLine
        state={row.state}
        word={strings.runStates[row.state]}
        detail={
          <span data-function-id={row.functionId}>{`#${row.functionId}`}</span>
        }
      />
    );
  }

  return runState === undefined ? undefined : (
    <StatusLine
      state={runState}
      word={strings.runStates[runState]}
      derived={strings.runningDerived}
    />
  );
}

export function EvidenceFace({
  strings,
  run,
  block,
  found,
  picked,
  lib,
  onShowRun,
}: {
  strings: InspectorStrings;

  /** The run the block's surface is drawing itself
   *  against, which is the only run this face
   *  reads. */
  run: ShownRun;

  block: EvidenceBlock;

  /** What that run recorded about the block. */
  found: BlockEvidence;

  /** Whether the drawn row is one somebody picked,
   *  rather than the block's headline. */
  picked: boolean;

  /** What the project's code-behind offers, which is
   *  where the function's signature is read. */
  lib: LibFunction[] | undefined;

  /** Asks for the whole run in the block's place. */
  onShowRun: () => void;
}) {
  if (block.kind === 'trigger') {
    return (
      <section className="evidence-face" data-evidence="trigger">
        <FieldHint>{strings.triggerNoRow}</FieldHint>

        <div className="evidence-actions">
          <Button
            variant="quiet"
            ink="brand"
            onClick={onShowRun}
            hook={{ 'inspect-run': '' }}
          >
            {strings.showRun}
          </Button>
        </div>
      </section>
    );
  }

  const fn =
    block.handler === undefined
      ? undefined
      : lib?.find((one) => one.export === block.handler);

  // Assigned as the picker draws it, but not a thing
  // to press: this face opens no list. Name only
  // where the code has not been read or does not
  // have it.
  const handler =
    block.handler === undefined ? null : (
      <LibFunctionItem
        as="div"
        name={block.handler}
        signature={fn === undefined ? undefined : signatureOf(fn)}
        state={fn === undefined ? 'compatible' : 'assigned'}
        title={fn?.doc}
        hook={{ 'evidence-field': 'handler' }}
      />
    );

  // A queue block writes no row of its own, so the
  // face below would draw an empty one. Nothing in
  // the type makes this branch necessary, so the
  // browser spec that asks for the queue's card is
  // what holds it.
  if (block.kind === 'queue' && block.queue !== undefined) {
    return (
      <QueueCard
        strings={strings}
        run={run}
        nodeId={block.id}
        handler={handler}
        queue={block.queue}
      />
    );
  }

  const row = found.drawn;

  // A wait on the clock records its wake-up time as
  // what it returned, and the face already says that
  // time as when it wakes.
  const output =
    row === undefined || block.onClock
      ? undefined
      : outputOf(row, strings.sizes);

  return (
    <section className="evidence-face" data-evidence="block">
      {handler}

      {row?.error === undefined ? null : (
        <Failure strings={strings} error={row.error} />
      )}

      {found.waitingSince === undefined ? null : (
        <FieldHint hook={{ 'evidence-field': 'waiting' }}>
          {filled(strings.waitingSince, fine(found.waitingSince))}
        </FieldHint>
      )}

      {row === undefined ? (
        <Nothing strings={strings} block={block} rounds={found.rounds} />
      ) : (
        <Timing strings={strings} row={row} onClock={block.onClock} />
      )}

      {row?.restored === true ? (
        <Worked strings={strings} id="restored">
          {strings.restored}
        </Worked>
      ) : null}

      {/* A different claim from `restored`, and both
          can be true: that one is about a crash
          inside this run, this one is about the run
          it was replayed from. */}
      {row?.reused === true ? (
        <Worked strings={strings} id="reused">
          {strings.reused}
        </Worked>
      ) : null}

      {found.rows.length < 2 ? null : (
        <Parts strings={strings} rows={found.rows} />
      )}

      <Policy strings={strings} block={block} />

      {row === undefined || output === undefined ? null : (
        <section className="evidence-section" data-evidence-field="output">
          <SectionLabel>{strings.outputLabel}</SectionLabel>

          <Recorded
            value={output}
            words={{
              inline: strings.inline,
              artifact: strings.artifact,
              open: strings.openOutput,
            }}
            onOpen={() =>
              postToHost({
                type: 'openOutput',
                workflowId: run.workflowId,
                functionId: row.functionId,
              })
            }
            openHook={{ 'evidence-action': 'openOutput' }}
          />
        </section>
      )}

      {/* Offered against a row and not against a
          block: a block the run never reached has
          nothing to replay from and nothing to be
          asked about. */}
      {row === undefined ? null : (
        <Actions
          strings={strings}
          run={run}
          block={block}
          row={row}
          picked={picked}
        />
      )}

      {output === undefined ? null : (
        <FieldHint hook={{ 'evidence-field': 'recordedFooter' }}>
          {strings.recordedFooter}
        </FieldHint>
      )}
    </section>
  );
}

/**
 * How the drawn row failed, and the way out.
 *
 * The class first, at the weight of a title, then
 * its sentence — both as DBOS stored them. A step
 * that ran out of tries says how many DBOS made,
 * counted from the tries it stored with the error it
 * threw, and never lists them: one entry per try is
 * per-step history nothing here may claim.
 */
function Failure({
  strings,
  error,
}: {
  strings: InspectorStrings;
  error: StepError;
}) {
  const tries = error.retriesExhausted ? error.errors?.length : undefined;

  return (
    <>
      <Callout
        tone="fail"
        title={<span data-verbatim="">{error.name ?? error.message}</span>}
        hook={{ 'evidence-field': 'error' }}
      >
        {error.name === undefined ? undefined : (
          <span data-verbatim="">{error.message}</span>
        )}
      </Callout>

      <FieldHint hook={{ 'way-out': '' }}>
        {tries === undefined
          ? strings.wayOut
          : filled(strings.exhausted, String(tries))}
      </FieldHint>
    </>
  );
}

/**
 * When the drawn row ran, as far as the SDK timed
 * it.
 *
 * A wait on the clock writes its wake-up time
 * before it sleeps, so its completion is not a
 * moment anything finished: it is when it wakes, or
 * — once the run is past it — when it woke, and
 * there is no duration to take from it.
 */
function Timing({
  strings,
  row,
  onClock,
}: {
  strings: InspectorStrings;
  row: EvidenceRow;
  onClock: boolean;
}) {
  if (row.startedAt === undefined && row.completedAt === undefined) {
    return (
      <FieldHint hook={{ 'evidence-field': 'notTimed' }}>
        {strings.notTimed}
      </FieldHint>
    );
  }

  const ended = onClock
    ? row.state === 'done'
      ? 'woke'
      : 'wakes'
    : 'completed';

  return (
    <>
      {row.startedAt === undefined ? null : (
        <Moment id="started" label={strings.started} at={row.startedAt} />
      )}

      {row.completedAt === undefined ? null : (
        <Moment id={ended} label={strings[ended]} at={row.completedAt} />
      )}

      {onClock || row.durationMs === undefined ? null : (
        <PropertyRow
          label={strings.duration}
          mono
          value={duration(row.durationMs, strings.durations)}
          hook={{ 'evidence-field': 'duration' }}
        />
      )}
    </>
  );
}

/** One moment a row names, to the millisecond on a
 *  24-hour clock. */
function Moment({ id, label, at }: { id: string; label: string; at: number }) {
  return (
    <PropertyRow
      label={label}
      mono
      value={<span data-time="fine">{fine(at)}</span>}
      hook={{ 'evidence-field': id }}
    />
  );
}

/** A fact the face worked out rather than read,
 *  followed by the word that says so. */
function Worked({
  strings,
  id,
  children,
}: {
  strings: InspectorStrings;
  id: string;
  children: string;
}) {
  return (
    <FieldHint hook={{ 'evidence-field': id }}>
      {children}{' '}
      <span className="property-provenance" data-provenance="derived">
        · {strings.derived}
      </span>
    </FieldHint>
  );
}

/**
 * What the ledger holds where it holds nothing under
 * this block's name.
 *
 * Three different absences, and telling them apart
 * is the whole of it: a branch the generated code
 * decided writes no row and none is missing; a loop
 * is the control flow around its body and never had
 * one; anything else simply has not run yet.
 */
function Nothing({
  strings,
  block,
  rounds,
}: {
  strings: InspectorStrings;
  block: EvidenceBlock;
  rounds: number | undefined;
}) {
  if (block.kind === 'branch' && block.handler === undefined) {
    return (
      <FieldHint hook={{ 'evidence-field': 'decided' }}>
        {strings.decidedInCode}
      </FieldHint>
    );
  }

  if (block.kind !== 'loop') {
    return (
      <FieldHint hook={{ 'evidence-field': 'nothing' }}>
        {strings.nothingRecorded}
      </FieldHint>
    );
  }

  return (
    <>
      <FieldHint hook={{ 'evidence-field': 'nothing' }}>
        {strings.noOwnRow}
      </FieldHint>

      {rounds === undefined ? null : (
        <Worked strings={strings} id="rounds">
          {filled(strings.roundsObserved, String(rounds))}
        </Worked>
      )}
    </>
  );
}

/** Every row the block owns, where it owns more than
 *  one: the items of a fan-out, the rounds of a
 *  loop, the halves of a wait. */
function Parts({
  strings,
  rows,
}: {
  strings: InspectorStrings;
  rows: readonly EvidenceRow[];
}) {
  return (
    <section className="evidence-section" data-evidence-field="rows">
      <SectionLabel>{strings.rowsLabel}</SectionLabel>

      {rows.map((row) => (
        <PropertyRow
          key={row.functionId}
          label={<span data-mono="">{row.part ?? row.name}</span>}
          value={
            <StatusLine
              state={row.state}
              word={strings.runStates[row.state]}
              detail={`#${row.functionId}`}
            />
          }
          hook={{ 'evidence-part': row.name }}
        />
      ))}
    </section>
  );
}

/**
 * How hard the block was allowed to try, as one
 * line under a label marking it as configuration —
 * the one thing on this face the run did not write.
 * A transaction is told it runs once instead, which
 * is not a setting anybody chose.
 */
function Policy({
  strings,
  block,
}: {
  strings: InspectorStrings;
  block: EvidenceBlock;
}) {
  const line = policyOf(strings, block);
  if (line === undefined) return null;

  return (
    <section className="evidence-section" data-evidence-field="retry">
      <SectionLabel>
        {strings.retryPolicy}
        {block.kind === 'transaction' ? null : (
          <>
            {' '}
            <span className="property-provenance" data-provenance="configured">
              · {strings.configured}
            </span>
          </>
        )}
      </SectionLabel>

      <p className="evidence-policy" data-mono="" data-evidence-policy="">
        {line}
      </p>
    </section>
  );
}

/**
 * The ways on from the drawn row, in the order
 * somebody reaches for them: the code, a second run
 * from here, the line it broke on, and the agent.
 *
 * On a row that failed the code is where a person is
 * going, so it is the primary Button; on one that
 * worked it is a second choice, in outline. Every
 * way on carries the block, and the two that start
 * something carry the run: a face may be drawing a
 * run the extension has moved past. They carry the
 * row only where somebody picked it — a block
 * clicked on the graph is the block, and which of
 * its rows a replay starts from is decided where the
 * run's rows are.
 */
function Actions({
  strings,
  run,
  block,
  row,
  picked,
}: {
  strings: InspectorStrings;
  run: ShownRun;
  block: EvidenceBlock;
  row: EvidenceRow;
  picked: boolean;
}) {
  const frame = row.error?.frame;
  const at = picked ? { functionId: row.functionId } : {};
  const open =
    row.state === 'failed'
      ? ({ variant: 'primary' } as const)
      : ({ variant: 'secondary', ink: 'brand' } as const);

  return (
    <>
      <div className="evidence-actions" data-evidence-actions="">
        {/* Only where the block has code behind it:
            a door to a file that does not exist is
            worse than no door. */}
        {block.handler === undefined ? null : (
          <Button
            {...open}
            onClick={() =>
              postToHost({ type: 'openFunction', nodeId: block.id })
            }
            hook={{ 'evidence-action': 'openFunction' }}
          >
            {strings.openHandler}
          </Button>
        )}

        <Button
          variant="quiet"
          onClick={() =>
            postToHost({
              type: 'replayFrom',
              workflowId: run.workflowId,
              nodeId: block.id,
              ...at,
            })
          }
          hook={{ 'evidence-action': 'replayFrom' }}
        >
          {strings.replayFrom}
        </Button>

        {/* Only where the stack named a file in the
            project's own code. Most failures name the
            SDK and the generated workflow and nothing
            else, and there is no line to go to. */}
        {frame === undefined ? null : (
          <Button
            variant="quiet"
            onClick={() =>
              postToHost({
                type: 'openErrorLocation',
                nodeId: block.id,
                functionId: row.functionId,
              })
            }
            hook={{ 'evidence-action': 'openErrorLocation' }}
          >
            {strings.openErrorLocation}
          </Button>
        )}

        <Button
          variant="quiet"
          onClick={() =>
            postToHost({
              type: 'askAgent',
              workflowId: run.workflowId,
              nodeId: block.id,
              ...at,
            })
          }
          hook={{ 'evidence-action': 'askAgent' }}
        >
          {strings.askAgent}
        </Button>
      </div>

      {/* The line is a fact about the image, not
          about the folder on screen, and nothing else
          on the face says so. */}
      {frame === undefined ? null : (
        <div className="evidence-where" data-evidence-field="errorLocation">
          <FieldHint>{strings.errorLocationFrom}</FieldHint>
        </div>
      )}
    </>
  );
}

/**
 * What the block was allowed to try, where it was
 * allowed anything.
 *
 * The numbers are read through the defaults, so a
 * block nobody configured shows what it will
 * actually run under rather than nothing at all.
 */
function policyOf(
  strings: InspectorStrings,
  block: EvidenceBlock,
): string | undefined {
  if (block.kind === 'transaction') return strings.retry;

  if (block.kind === undefined || !RETRIES.has(block.kind)) return undefined;

  // A branch with no function behind it is compiled
  // into the workflow body, so there is no step and
  // no policy over one.
  if (block.kind === 'branch' && block.handler === undefined) return undefined;

  const policy = { ...DEFAULT_RETRY, ...block.retry };

  return policy.maxAttempts === 1
    ? strings.policyOff
    : filled(
        strings.policy,
        String(policy.maxAttempts),
        String(policy.intervalSeconds),
        String(policy.backoffRate),
      );
}
