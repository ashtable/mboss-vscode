import { useState } from 'react';

import { postToHost } from '../webview/client.js';
import { shortRunId } from '../webview/ids.js';
import type {
  SeeRun,
  SeeStrings,
  TraceDetail,
  TraceRowView,
} from '../webview/protocol.js';
import { Button } from '../webview/signal/Button.js';
import { EmptyState } from '../webview/signal/EmptyState.js';
import { FieldHint } from '../webview/signal/FieldHint.js';
import { SectionLabel } from '../webview/signal/SectionLabel.js';
import { StatusGlyph } from '../webview/signal/StatusGlyph.js';
import { settled } from '../webview/states.js';

/**
 * What a run did, in the order it did it.
 *
 * One list, one recorded operation to a row: a dot
 * for how it went, the name the ledger recorded,
 * how long it took and one line about it. The graph
 * answers where the run went; this answers what
 * happened, in order, and says it once.
 *
 * The dots are joined by a spine, and the spine is
 * where the colour between two rows goes: what
 * happened between them. Below a row that threw it
 * is the failure's; into a row still waiting, and
 * below the last row of a run that is not over, it
 * is a pending line, because nothing has arrived
 * there yet; everywhere else it is the finished
 * edge the graph draws its wires in. A run that is
 * over has nothing below its last row.
 *
 * The rows the SDK wrote beside a block's own row —
 * the sleeps, messages and results a durable run is
 * made of — are for somebody reading the ledger
 * itself, so each block row folds its own under a
 * quiet control beside it. Beside and never inside:
 * the row is already a button that picks the
 * operation, and a button inside a button is one
 * click meaning two things. The way to a run a row
 * started sits beside it for the same reason.
 *
 * A row naming a block the saved document does not
 * have is drawn apart under its own label, as text.
 * Picking it would pick nothing the Inspector could
 * draw, so it is not a control.
 */
export function ExecutionTrace({
  run,
  strings,
  expanded,
  onToggle,
}: {
  run: SeeRun;
  strings: SeeStrings;

  /** The rows whose SDK rows are showing, by the
   *  number DBOS gave the row. */
  expanded: ReadonlySet<number>;

  onToggle: (functionId: number) => void;
}) {
  const { trace, unattributed, selected } = run;

  if (trace.length === 0 && unattributed.length === 0) {
    return (
      <div className="execution-trace">
        <SectionLabel>{strings.trace}</SectionLabel>
        <EmptyState kind="empty" title={strings.noOperations} />
      </div>
    );
  }

  // Not over, so whatever the last row is, more is
  // still to come after it. A run somebody is
  // waiting on counts: it is going somewhere, and
  // only its last row knows where.
  const going = run.live !== undefined && !settled(run.live.outcome);

  return (
    <div className="execution-trace">
      <SectionLabel>{strings.trace}</SectionLabel>

      {trace.length === 0 ? null : (
        <ol className="trace" data-trace>
          {trace.map((row, at) => (
            <li
              key={row.functionId}
              className="trace-row"
              data-trace-group={row.nodeId ?? ''}
            >
              <Spine row={row} below={jointBelow(trace, at, going)} />

              <Operation row={row} marked={selected.functionId} />

              {row.childWorkflowId === undefined ? null : (
                <ChildRun id={row.childWorkflowId} />
              )}

              {row.sdk.length === 0 ? null : (
                <SdkRows
                  row={row}
                  open={expanded.has(row.functionId)}
                  onToggle={() => onToggle(row.functionId)}
                  marked={selected.functionId}
                />
              )}
            </li>
          ))}
        </ol>
      )}

      {unattributed.length === 0 ? null : (
        <section className="trace-apart" data-unattributed>
          <SectionLabel>{strings.unattributed}</SectionLabel>

          <ol className="trace">
            {unattributed.map((row) => (
              <li
                key={row.functionId}
                className="trace-row"
                data-trace-group=""
              >
                <Spine row={row} below={undefined} />

                <div
                  className="trace-entry"
                  data-trace-op={row.functionId}
                  data-owner={row.owner}
                  data-state={row.state}
                >
                  <Said row={row} />
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <FieldHint>{strings.traceHint}</FieldHint>
    </div>
  );
}

/**
 * Which rows have their SDK rows showing, held by
 * whoever draws the trace.
 *
 * The page's own business, so opening one asks the
 * extension for nothing — which also means a panel
 * VS Code throws away while it is hidden comes back
 * with all of them folded. A row picked under one
 * opens it, wherever the pick came from, since the
 * row picked is the one somebody has to be able to
 * see; folding it again afterwards is theirs to do.
 * Another run starts with every one folded: the
 * numbers are that run's.
 */
export function useDisclosures(run: SeeRun): {
  expanded: ReadonlySet<number>;
  toggle: (functionId: number) => void;
} {
  const picked = run.selected.functionId;

  const [held, setHeld] = useState(() => ({
    run: run.workflowId,
    picked,
    open: opening(new Set(), run.trace, picked),
  }));

  let current = held;

  // Worked out while drawing rather than after, so
  // the page never paints the picked row folded away
  // for a frame first.
  if (held.run !== run.workflowId || held.picked !== picked) {
    const kept = held.run === run.workflowId ? held.open : new Set<number>();

    current = {
      run: run.workflowId,
      picked,
      open: opening(kept, run.trace, picked),
    };
    setHeld(current);
  }

  const toggle = (functionId: number): void =>
    setHeld((before) => {
      const open = new Set(before.open);

      if (!open.delete(functionId)) open.add(functionId);

      return { ...before, open };
    });

  return { expanded: current.open, toggle };
}

/** The open rows, with the one holding the picked
 *  SDK row among them. */
function opening(
  open: ReadonlySet<number>,
  trace: readonly TraceRowView[],
  picked: number | undefined,
): ReadonlySet<number> {
  const holder = trace.find((row) =>
    row.sdk.some((one) => one.functionId === picked),
  );

  return holder === undefined || open.has(holder.functionId)
    ? open
    : new Set([...open, holder.functionId]);
}

/** What the spine says between a row and the next. */
type Joint = 'fail' | 'live' | 'done';

function jointBelow(
  rows: readonly TraceRowView[],
  at: number,
  going: boolean,
): Joint | undefined {
  const row = rows[at];
  const next = rows[at + 1];

  if (row === undefined || (next === undefined && !going)) return undefined;
  if (row.state === 'failed') return 'fail';
  if (next === undefined || next.state === 'waiting') return 'live';

  return 'done';
}

/**
 * A row's dot, and the line down to the next one.
 *
 * Nothing here is read out: what a row did is in
 * the words on it, and a mark announced beside
 * those would say it twice.
 */
function Spine({
  row,
  below,
}: {
  row: TraceRowView;
  below: Joint | undefined;
}) {
  return (
    <span className="trace-spine" aria-hidden="true">
      <StatusGlyph state={row.state} variant="dot" size={9} />
      {below === undefined ? null : (
        <span className="trace-connector" data-tone={below} />
      )}
    </span>
  );
}

/** One recorded operation, as the control that
 *  picks it. */
function Operation({
  row,
  marked,
  branch,
}: {
  row: TraceRowView;
  marked: number | undefined;

  /** Where it hangs, for a row folded under
   *  another. */
  branch?: string;
}) {
  return (
    <button
      type="button"
      className="trace-entry trace-op"
      data-trace-op={row.functionId}
      data-owner={row.owner}
      data-replayable={String(row.replayable)}
      data-reuse={row.reused ? 'recorded' : 'own'}
      data-state={row.state}
      aria-current={row.functionId === marked ? 'true' : undefined}
      title={row.because}
      onClick={() =>
        postToHost({ type: 'stepSelect', functionId: row.functionId })
      }
    >
      <Said row={row} branch={branch} />
    </button>
  );
}

/** The name, the length of time and the line, which
 *  every row says whether or not it is a control. */
function Said({ row, branch }: { row: TraceRowView; branch?: string }) {
  return (
    <>
      <span className="mono trace-name">
        {branch === undefined ? null : (
          <span className="trace-branch" aria-hidden="true">
            {branch}
          </span>
        )}
        {row.name}
      </span>

      {row.duration === undefined ? null : (
        <span className="mono trace-duration">{row.duration}</span>
      )}

      <Detail detail={row.detail} tone={row.detailTone} />
    </>
  );
}

/**
 * The line under a row, each part the kind of claim
 * it is: what the page worked out, then what it
 * names, then exactly what the run recorded — kept
 * in its own element, so nothing the page says is
 * ever read as part of the value.
 */
function Detail({
  detail,
  tone,
}: {
  detail: TraceDetail;
  tone: TraceRowView['detailTone'];
}) {
  const { derived, plain, verbatim } = detail;

  return (
    <span className="mono trace-detail" data-tone={tone}>
      {derived === undefined ? null : (
        <span data-provenance="derived">{derived}</span>
      )}
      {plain === undefined ? null : <span>{plain}</span>}
      {plain === undefined || verbatim === undefined ? null : ' · '}
      {verbatim === undefined ? null : <span data-verbatim>{verbatim}</span>}
    </span>
  );
}

/**
 * The SDK's rows beside a block row, folded under a
 * control that says whose code wrote them and how
 * many there are. Each hangs off the one before it,
 * so the last one reads as the end of the list.
 */
function SdkRows({
  row,
  open,
  onToggle,
  marked,
}: {
  row: TraceRowView;
  open: boolean;
  onToggle: () => void;
  marked: number | undefined;
}) {
  return (
    <>
      <Button
        variant="quiet"
        mono
        expanded={open}
        hook={{ 'sdk-rows': '' }}
        onClick={onToggle}
      >
        {row.sdkLabel}
      </Button>

      {open ? (
        <ol className="trace-sdk">
          {row.sdk.map((one, at) => (
            <li key={one.functionId}>
              <Operation
                row={one}
                marked={marked}
                branch={at === row.sdk.length - 1 ? '└─' : '├─'}
              />
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}

/**
 * The way to the run one item of a block started.
 *
 * A queue block hands each item to a workflow of its
 * own, and this ledger holds only that it did: what
 * the work itself did is on the other run's page.
 * The id is the whole of what there is, so the id
 * is the way there — short, and whole where a
 * pointer asks, because four characters collide.
 */
function ChildRun({ id }: { id: string }) {
  return (
    <Button
      variant="quiet"
      mono
      hook={{ 'run-select': id }}
      onClick={() => postToHost({ type: 'runSelect', workflowId: id })}
    >
      <span data-short-run={id} title={id}>
        {shortRunId(id)}
      </span>
    </Button>
  );
}
