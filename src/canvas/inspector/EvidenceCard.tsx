import { useEffect } from 'react';

import { DEFAULT_RETRY } from '../../core/rules.js';
import type { NodeKind, QueuePolicy, Retry } from '../../core/rules.js';
import type { QueueEvidence, QueueItem } from '../../runs/queueEvidence.js';
import { OUTPUT_KEPT } from '../../runs/rows.js';
import { postToHost } from '../../webview/client.js';
import { filled } from '../../webview/fill.js';
import type { InspectorStrings, ShownRun } from '../../webview/protocol.js';
import { fine } from '../../webview/time.js';
import type { RunState } from '../graph.js';

import {
  evidenceOf,
  queueRowsOf,
  runCardOf,
  type EvidenceRow,
  type QueueRow,
} from './evidence.js';

/**
 * What a run recorded about the block on screen.
 *
 * Named for the card rather than for the question,
 * because the pure half beside it is `evidence.ts`
 * and two files whose names differ only in a capital
 * are one file on a case-insensitive disk.
 *
 * The Inspector's second face. Nothing here can be
 * edited and nothing here was worked out from the
 * document — it is one run's rows, drawn, plus the
 * one piece of configuration a person needs beside
 * them: how hard the block was allowed to try.
 * That line is chipped `configured` so it cannot be
 * read as something the run wrote down.
 *
 * What is deliberately absent is the point of the
 * card. DBOS records one row per durable operation
 * and no count of the tries behind it, and it
 * records no per-step input at all — so a card that
 * showed either would be inventing evidence in a
 * panel whose whole job is not to. What the run was
 * started with is a fact about the run, and is
 * drawn on the run-level card and nowhere else.
 *
 * The block arrives as its identity and its policy
 * rather than as the node: the other face is where
 * configuration is read and set, and a card that
 * could reach `config` would drift into being a
 * second one.
 *
 * Three cards, not one. The run itself and the
 * trigger that started it are the same question and
 * share one; every ordinary block gets the one
 * built from its rows; and a queue block gets a
 * third, because it has no rows at all and what
 * there is to say about it is counted.
 */

/** The block a card is about, as a card reads one. */
export type EvidenceBlock = {
  id: string;

  kind: NodeKind;

  title: string;

  /** The named export it runs, where it runs one. */
  handler: string | undefined;

  /** The policy the document gives it, where it
   *  gives one rather than leaving the defaults. */
  retry: Retry | undefined;

  /**
   * The blocks it encloses, where it is a loop.
   *
   * The one thing about the rest of the document
   * this card is told, and it is told because the
   * ledger cannot say it: a row records the round
   * it ran in, not which loop counted it, so a run
   * with two loops in it has two answers and only
   * the document knows which rows carry which.
   */
  body: readonly string[] | undefined;

  /**
   * The queue it fills, where it is a queue block.
   *
   * The second thing about the document this card
   * is told, and told for the same reason the body
   * is: the ledger has no row for a queue block at
   * all — the work is its children's runs — so the
   * name to read the queue under, and the ceiling
   * to read this run's share against, exist
   * nowhere but the document.
   */
  queue: QueuePolicy | undefined;
};

export type EvidenceProps = {
  strings: InspectorStrings;

  /** The run the canvas is drawing itself against,
   *  which is the only run this face reads. */
  run: ShownRun;

  /** The block somebody selected, or nothing, which
   *  is the run itself. */
  block: EvidenceBlock | undefined;

  /** What the run says about that block, as the
   *  graph says it — so the card and the block agree
   *  about a run that has got as far as here and
   *  written nothing yet. */
  runState: RunState | undefined;

  /** Whether this card is drawn on the run page.
   *  `Open run` is the way there, and a way to where
   *  somebody is standing is not an offer. */
  onRunPage: boolean;
};

/** One mark per state, the same four the run list
 *  and the run page draw. */
const MARKS: Record<RunState, string> = {
  done: '✓',
  failed: '✕',
  waiting: '◐',
  running: '●',
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
 * itself, and a policy line on a card about a run
 * that is parked would read as how hard it is
 * trying to hear back, which is not what it means.
 */
const RETRIES: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'step',
  'codeStep',
  'apiCall',
  'emailSend',
  'approval',
  'branch',
]);

export function Evidence({
  strings,
  run,
  block,
  runState,
  onRunPage,
}: EvidenceProps) {
  // A trigger is the run starting, and nothing
  // selected is the run itself. Both are the same
  // question, so both get the same card.
  if (block === undefined || block.kind === 'trigger') {
    return <RunCard strings={strings} run={run} onRunPage={onRunPage} />;
  }

  // A queue block writes no row of its own: the
  // work is its children's runs, in rows of theirs.
  // The card below reads a block's rows and would
  // draw an empty one here, so a queue gets a card
  // that reads counts instead. Nothing in the type
  // makes this branch necessary — the card is
  // chosen with an `===` and a missing case is not
  // a compile error — so the browser spec that asks
  // for `data-evidence="queue"` is what holds it.
  if (block.kind === 'queue' && block.queue !== undefined) {
    return (
      <QueueCard
        strings={strings}
        run={run}
        block={block}
        queue={block.queue}
        onRunPage={onRunPage}
      />
    );
  }

  return (
    <BlockCard strings={strings} run={run} block={block} runState={runState} />
  );
}

/**
 * What a queue block's children are doing.
 *
 * Three provenances on one card, which is the whole
 * reason each row wears its own: the counts are
 * this run's share, read every tick; the window and
 * the registration are the whole queue's, read once
 * because somebody opened this; and the name and
 * the limits are what the document asks for. A card
 * that mixed them would be reporting a ceiling
 * somebody typed as though a run had reached it.
 *
 * What is deliberately absent is a rate. DBOS
 * records what ran and never what it was allowed to
 * run, so a meter drawn against a rate limit would
 * be a figure this panel invented — and the count
 * of starts inside the window is the honest form of
 * the same question.
 */
function QueueCard({
  strings,
  run,
  block,
  queue,
  onRunPage,
}: {
  strings: InspectorStrings;
  run: ShownRun;
  block: EvidenceBlock;
  queue: QueuePolicy;
  onRunPage: boolean;
}) {
  const found = run.queueEvidence?.[block.id];

  // Asked when the card is shown and never on a
  // tick. The watch's budget for a queue block is
  // one query per tick and it is already spent on
  // the counts above; what this asks for changes
  // far too slowly to be worth another.
  useEffect(() => {
    postToHost({
      type: 'inspectQueue',
      workflowId: run.workflowId,
      nodeId: block.id,
    });
  }, [run.workflowId, block.id]);

  // The window's own failures go on the run's failed
  // row rather than on a row of their own: they are
  // one fact at two scales, and two rows would read
  // as two failures.
  const rows = queueRowsOf(run, block.id, queue, strings).map((row) =>
    row.id === 'failed' && found !== undefined
      ? {
          ...row,
          value: `${row.value} · ${filled(
            strings.queueErrored,
            String(found.window.failedRecently),
          )}`,
        }
      : row,
  );

  return (
    <section className="evidence" data-evidence="queue">
      <header className="evidence-head">
        <p className="evidence-title mono">{block.title}</p>
        <span className="evidence-kind">{strings.kinds[block.kind]}</span>
      </header>

      {block.handler === undefined ? null : (
        <p className="mono" data-evidence-field="handler">
          {`ƒ ${block.handler}`}
        </p>
      )}

      <div className="evidence-lines">
        {rows.map((row) => (
          <Reading key={row.id} strings={strings} row={row} />
        ))}

        {found === undefined ? null : (
          <>
            <Reading
              strings={strings}
              row={{
                id: 'observedStarts',
                label: strings.queueRows.observedStarts,
                value: filled(
                  strings.queueStarted,
                  String(found.window.started),
                  String(found.window.windowSec),
                ),
                chip: 'derived',
              }}
            />

            <Reading
              strings={strings}
              row={{
                id: 'registered',
                label: strings.queueRows.registered,
                value: registeredText(strings, found.registered),
                chip: 'derived',
              }}
            />
          </>
        )}
      </div>

      {found === undefined || found.recent.length === 0 ? null : (
        <Recent strings={strings} items={found.recent} onRunPage={onRunPage} />
      )}

      {/* Under everything, because everything above
          it is one application's, read out of the
          one development database this window can
          reach. */}
      <p className="hint" data-evidence-field="local">
        {strings.queueLocal}
      </p>
    </section>
  );
}

/** One reading on a queue card: what it is, what it
 *  says, and whether the panel worked it out or
 *  found it in the document. */
function Reading({
  strings,
  row,
}: {
  strings: InspectorStrings;
  row: QueueRow;
}) {
  return (
    <p className="evidence-line" data-evidence-field={row.id}>
      <span className="evidence-line-name">{row.label}</span>
      <span className="value mono">{row.value}</span>
      {row.chip === undefined ? null : (
        <Chip
          word={
            row.chip === 'configured' ? strings.configured : strings.derived
          }
          kind={row.chip}
        />
      )}
    </p>
  );
}

/**
 * The items the block started, newest first.
 *
 * Each is a run of its own, so each is a way to one
 * — and which way depends on where this card is
 * mounted. The run page already shows a run and
 * selects another in place; the canvas has no run
 * page and opens one.
 */
function Recent({
  strings,
  items,
  onRunPage,
}: {
  strings: InspectorStrings;
  items: readonly QueueItem[];
  onRunPage: boolean;
}) {
  return (
    <div data-evidence-field="recentWork">
      <p className="value-label">{strings.queueRows.recentWork}</p>
      <ul className="evidence-recent">
        {items.map((item) => (
          <li key={item.workflowId}>
            <button
              type="button"
              className="evidence-recent-run mono"
              data-queue-item={item.workflowId}
              onClick={() =>
                postToHost(
                  onRunPage
                    ? { type: 'runSelect', workflowId: item.workflowId }
                    : { type: 'openRun', workflowId: item.workflowId },
                )
              }
            >
              {item.label}
            </button>
            <span className="evidence-recent-state">{item.status}</span>
            {item.completedAt === undefined ? null : (
              <span className="hint">{fine(item.completedAt)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Whether the running app registered this queue
 *  the way the document asks for it, and what it
 *  registered where it did not. */
function registeredText(
  strings: InspectorStrings,
  registered: QueueEvidence['registered'],
): string {
  if (registered === 'matches') return strings.queueMatches;
  if (registered === 'absent') return strings.queueUnregistered;

  return filled(
    strings.queueDiffers,
    limitsText(strings, registered.registered),
  );
}

/**
 * What the app registered, in the document's own
 * words.
 *
 * Every limit the row holds rather than only the
 * one that differs: the card already draws what the
 * document asks for beside this, so the reading
 * worth offering is the whole of what is actually
 * in force.
 */
function limitsText(strings: InspectorStrings, policy: QueuePolicy): string {
  const words = strings.queueLimits;

  return [
    ...limitSaid(words.globalConcurrency, policy.globalConcurrency),
    ...limitSaid(words.workerConcurrency, policy.workerConcurrency),
    ...limitSaid(words.rateLimit, rateText(strings, policy.rateLimit)),
    ...limitSaid(words.partitionConcurrency, policy.partitionConcurrency),
    ...limitSaid(
      words.partitionWorkerConcurrency,
      policy.partitionWorkerConcurrency,
    ),
    ...limitSaid(
      words.partitionRateLimit,
      rateText(strings, policy.partitionRateLimit),
    ),
    ...limitSaid(
      words.minPollingIntervalMs,
      policy.minPollingIntervalMs === undefined
        ? undefined
        : filled(strings.milliseconds, String(policy.minPollingIntervalMs)),
    ),
  ].join(' · ');
}

function limitSaid(word: string, value: number | string | undefined): string[] {
  return value === undefined ? [] : [`${word} ${value}`];
}

function rateText(
  strings: InspectorStrings,
  limit: QueuePolicy['rateLimit'],
): string | undefined {
  return limit === undefined
    ? undefined
    : filled(
        strings.queueRate,
        String(limit.limitPerPeriod),
        String(limit.periodSec),
      );
}

function BlockCard({
  strings,
  run,
  block,
  runState,
}: {
  strings: InspectorStrings;
  run: ShownRun;
  block: EvidenceBlock;
  runState: RunState | undefined;
}) {
  const found = evidenceOf(run, block.id, block.body);
  const row = found.headline;

  // The row's own state where there is a row, and
  // what the graph worked out where there is not:
  // the ledger records a step when it completes, so
  // a block the run may be at has written nothing.
  const state = row?.state ?? runState;
  const policy = policyOf(strings, block);

  return (
    <section className="evidence" data-evidence="block">
      <header className="evidence-head">
        <p className="evidence-title mono">{block.title}</p>
        <span className="evidence-kind">{strings.kinds[block.kind]}</span>
      </header>

      {state === undefined ? null : (
        <p className="run-status" data-run-state={state}>
          <span className="glyph" aria-hidden="true">
            {MARKS[state]}
          </span>
          {strings.runStates[state]}
          {row === undefined ? '' : ` · #${row.functionId}`}
          {state === 'running' ? <Chip word={strings.derived} /> : null}
        </p>
      )}

      {block.handler === undefined ? null : (
        <p className="mono" data-evidence-field="handler">
          {`ƒ ${block.handler}`}
        </p>
      )}

      {found.waitingSince === undefined ? null : (
        <p className="hint" data-evidence-field="waiting">
          {filled(strings.waitingSince, fine(found.waitingSince))}
        </p>
      )}

      {found.rows.length < 2 ? null : (
        <Parts strings={strings} rows={found.rows} />
      )}

      {row === undefined ? (
        <Nothing strings={strings} block={block} rounds={found.rounds} />
      ) : (
        <Recorded strings={strings} run={run} row={row} />
      )}

      {policy === undefined ? null : (
        <>
          <p data-evidence-field="retry">
            <span className="value mono" data-size="small">
              {policy.text}
            </span>
            <span className="value-label">
              {strings.retryPolicy}
              <Chip word={strings.configured} kind="configured" />
            </span>
          </p>

          {/* Only where more than one try was
              allowed. Said because one row can cover
              several of them, and a duration read as
              one run of the code is the wrong number
              to take to a timeout. */}
          {policy.retries ? (
            <p className="hint">{strings.durationCoversTries}</p>
          ) : null}
        </>
      )}

      {/* Under everything the run recorded, because
          what is on the card is what a person
          decides with. Offered against a row and
          not against a block: a block the run never
          reached has nothing to replay from and
          nothing to be asked about. */}
      {row === undefined ? null : (
        <Actions strings={strings} run={run} block={block} row={row} />
      )}
    </section>
  );
}

/**
 * The ways on from a step, in the order somebody
 * reaches for them.
 *
 * The code first — this is an editor, and the fix
 * is where a person is going — then the line it
 * broke on, then a second run from here, then the
 * agent. Each carries the block, and the two that
 * start something carry the run as well: a card may
 * be drawing a run the extension has moved past,
 * and which run is meant is not a question this
 * column gets to answer.
 *
 * The same four wherever the card is mounted. A
 * door that appeared on the canvas and not on the
 * run page would make one of them the real one.
 */
function Actions({
  strings,
  run,
  block,
  row,
}: {
  strings: InspectorStrings;
  run: ShownRun;
  block: EvidenceBlock;
  row: EvidenceRow;
}) {
  const frame = row.error?.frame;

  return (
    <>
      <div className="evidence-actions">
        {/* Only where the block has code behind it.
            A wait, a loop and an undecided branch
            run nothing anybody wrote, and a door to
            a file that does not exist is worse than
            no door. */}
        {block.handler === undefined ? null : (
          <button
            type="button"
            className={row.state === 'failed' ? 'btn primary' : 'btn brand'}
            data-evidence-action="openFunction"
            onClick={() =>
              postToHost({ type: 'openFunction', nodeId: block.id })
            }
          >
            {strings.openHandler}
          </button>
        )}

        {/* Only where the stack named a file in the
            project's own code. Most failures name
            the SDK and the generated workflow and
            nothing else, and there is no line to go
            to for one of those. */}
        {frame === undefined ? null : (
          <button
            type="button"
            className="btn quiet"
            data-evidence-action="openErrorLocation"
            onClick={() =>
              postToHost({
                type: 'openErrorLocation',
                nodeId: block.id,
                functionId: row.functionId,
              })
            }
          >
            {strings.openErrorLocation}
          </button>
        )}

        {/* The block and not the row: a block that
            ran more than once has several of them,
            and which one a replay would start from
            is decided where the run's rows are. */}
        <button
          type="button"
          className="btn secondary"
          data-evidence-action="replayFrom"
          onClick={() =>
            postToHost({
              type: 'replayFrom',
              workflowId: run.workflowId,
              nodeId: block.id,
            })
          }
        >
          {strings.replayFrom}
        </button>

        <button
          type="button"
          className="btn quiet"
          data-evidence-action="askAgent"
          onClick={() =>
            postToHost({
              type: 'askAgent',
              workflowId: run.workflowId,
              nodeId: block.id,
            })
          }
        >
          {strings.askAgent}
        </button>
      </div>

      {/* The line is a fact about the image, not
          about the folder on screen, and saying so
          is what keeps it from being read as a
          promise about the file it opens. */}
      {frame === undefined ? null : (
        <div data-evidence-field="errorLocation">
          <p className="hint">{strings.errorLocationFrom}</p>
        </div>
      )}
    </>
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
      <p className="hint" data-evidence-field="decided">
        {strings.decidedInCode}
      </p>
    );
  }

  if (block.kind !== 'loop') {
    return (
      <p className="hint" data-evidence-field="nothing">
        {strings.nothingRecorded}
      </p>
    );
  }

  return (
    <>
      <p className="hint" data-evidence-field="nothing">
        {strings.noOwnRow}
      </p>

      {rounds === undefined ? null : (
        <p className="hint" data-evidence-field="rounds">
          {filled(strings.roundsObserved, String(rounds))}
          <Chip word={strings.derived} />
        </p>
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
    <div data-evidence-field="rows">
      <p className="value-label">{strings.rowsLabel}</p>
      <ul className="evidence-parts">
        {rows.map((row) => (
          <li
            key={row.functionId}
            className="mono"
            data-evidence-part={row.name}
          >
            <span className="glyph" aria-hidden="true">
              {MARKS[row.state]}
            </span>
            {row.part ?? row.name}
            {row.completedAt === undefined ? '' : ` · ${fine(row.completedAt)}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The one row the card draws in full: when it ran,
 *  what it returned or how it failed. */
function Recorded({
  strings,
  run,
  row,
}: {
  strings: InspectorStrings;
  run: ShownRun;
  row: EvidenceRow;
}) {
  const timed = row.startedAt !== undefined || row.completedAt !== undefined;

  return (
    <>
      {row.error === undefined ? null : (
        <p className="evidence-error" data-evidence-field="error">
          {row.error.name === undefined ? null : (
            <>
              <strong>{row.error.name}</strong>
              <br />
            </>
          )}
          {row.error.message}
          {row.error.retriesExhausted ? (
            <>
              <br />
              {strings.exhausted}
            </>
          ) : null}
        </p>
      )}

      {row.restored ? (
        <p className="hint" data-evidence-field="restored">
          <span className="glyph" aria-hidden="true">
            ✓
          </span>
          {strings.restored}
          <Chip word={strings.derived} />
        </p>
      ) : null}

      {/* A different claim from `restored`, and both
          can be true: that one is about a crash
          inside this run, this one is about the run
          it was replayed from. */}
      {row.reused ? (
        <p className="hint" data-evidence-field="reused">
          {strings.recorded}
          <Chip word={strings.derived} />
        </p>
      ) : null}

      {timed ? null : (
        <p className="hint" data-evidence-field="notTimed">
          {strings.notTimed}
        </p>
      )}

      {/* Three readings of one row, scanned rather
          than read one at a time, so they are set as
          a group of lines instead of three figures
          each asking to be looked at on its own. */}
      <div className="evidence-lines">
        {row.startedAt === undefined ? null : (
          <Line
            id="started"
            label={strings.started}
            value={fine(row.startedAt)}
          />
        )}

        {row.completedAt === undefined ? null : (
          <Line
            id="completed"
            label={strings.completed}
            value={fine(row.completedAt)}
          />
        )}

        {row.durationMs === undefined ? null : (
          <Line
            id="duration"
            label={strings.duration}
            value={spanText(strings, row.durationMs)}
          />
        )}
      </div>

      {row.output === undefined ? null : (
        <div data-evidence-field="output">
          <p className="evidence-label-row">
            <span className="value-label">{strings.outputLabel}</span>

            {/* A column this narrow holds a line of
                JSON and not a page of one, so the
                whole of it goes to a tab instead. */}
            <button
              type="button"
              className="btn quiet"
              data-evidence-action="openOutput"
              onClick={() =>
                postToHost({
                  type: 'openOutput',
                  workflowId: run.workflowId,
                  functionId: row.functionId,
                })
              }
            >
              {strings.openOutput}
            </button>
          </p>

          {/* At the size a value is read at rather
              than the size a headline number is:
              this is a page of JSON in a column, and
              the figures above it are the numbers
              worth landing on. */}
          <pre className="value mono">{row.output}</pre>

          {/* Said out loud, because a value that
              stops mid-object read as the value is
              the one way a flight recorder lies. */}
          {row.outputCut ? (
            <p className="hint">
              {filled(strings.outputCut, String(OUTPUT_KEPT))}
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}

/**
 * The run itself.
 *
 * What it was started with is drawn here and in no
 * other place: the ledger has one input column and
 * it belongs to the run, so a step card carrying one
 * would be a panel making something up.
 */
function RunCard({
  strings,
  run,
  onRunPage,
}: {
  strings: InspectorStrings;
  run: ShownRun;
  onRunPage: boolean;
}) {
  const card = runCardOf(run);

  return (
    <section className="evidence" data-evidence="run">
      <header className="evidence-head">
        <p className="evidence-title mono">{`${card.workflow} · #${card.workflowId}`}</p>
        <span className="evidence-kind">{strings.run}</span>
      </header>

      {/* The word is the application's, so it is
          passed through and coloured by where the
          run actually got to. The span goes under it
          rather than beside it: a clock set in the
          small caps a status wears is a clock nobody
          can read. */}
      <p className="run-status" data-run-outcome={card.outcome}>
        {card.status}
      </p>

      {card.startedAt === undefined ? null : (
        <p className="hint mono" data-evidence-field="span">
          {spanOf(strings, card)}
        </p>
      )}

      {card.input === undefined ? null : (
        <Figure
          id="workflowInput"
          label={strings.workflowInput}
          value={card.input}
        />
      )}

      <Figure
        id="recovery"
        label={strings.recovery}
        value={
          card.recoveries === 0
            ? strings.neverRecovered
            : filled(strings.recoveredTimes, String(card.recoveries))
        }
        note={card.recoveries === 0 ? undefined : strings.pickedBackUp}
      />

      {card.applicationVersion === undefined ? null : (
        <Figure
          id="version"
          label={strings.applicationVersion}
          value={card.applicationVersion}
        />
      )}

      {onRunPage ? null : (
        <div className="evidence-actions">
          <button
            type="button"
            className="btn brand"
            data-evidence-action="openRun"
            onClick={() =>
              postToHost({ type: 'openRun', workflowId: card.workflowId })
            }
          >
            {strings.openRun}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * One measured thing and what it is, the way every
 * figure in this extension is drawn — the label
 * under the value, so a column of them lines up on
 * the numbers.
 *
 * The note is for the sentence a figure sometimes
 * needs beside it. It goes under the label rather
 * than into the value, because a value read at this
 * weight has to stay something a person can take in
 * at a glance.
 */
function Figure({
  id,
  label,
  value,
  note,
}: {
  id: string;
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="evidence-figure" data-evidence-field={id}>
      <span className="value mono">{value}</span>
      <span className="value-label">{label}</span>
      {note === undefined ? null : <span className="hint">{note}</span>}
    </div>
  );
}

/** One of a group of readings, scanned down a
 *  column: what it is, then what it says. */
function Line({
  id,
  label,
  value,
}: {
  id: string;
  label: string;
  value: string;
}) {
  return (
    <p className="evidence-line" data-evidence-field={id}>
      <span className="evidence-line-name">{label}</span>
      <span className="value mono">{value}</span>
    </p>
  );
}

/** Whether the panel read this, worked it out, or
 *  found it in the document. */
function Chip({
  word,
  kind = 'derived',
}: {
  word: string;
  kind?: 'derived' | 'configured';
}) {
  return (
    <span className="provenance" data-provenance={kind}>
      {word}
    </span>
  );
}

/**
 * What the block was allowed to try, where it was
 * allowed anything.
 *
 * The numbers are read through the defaults, so a
 * block nobody configured shows what it will
 * actually run under rather than nothing at all —
 * and `retries` says whether more than one try was
 * on offer, which is what decides whether the
 * duration needs explaining.
 */
function policyOf(
  strings: InspectorStrings,
  block: EvidenceBlock,
): { text: string; retries: boolean } | undefined {
  if (block.kind === 'transaction') {
    return { text: strings.retry, retries: false };
  }

  if (!RETRIES.has(block.kind)) return undefined;

  // A branch with no function behind it is compiled
  // into the workflow body, so there is no step and
  // no policy over one.
  if (block.kind === 'branch' && block.handler === undefined) return undefined;

  const policy = { ...DEFAULT_RETRY, ...block.retry };

  return policy.maxAttempts === 1
    ? { text: strings.policyOff, retries: false }
    : {
        text: filled(
          strings.policy,
          String(policy.maxAttempts),
          String(policy.intervalSeconds),
          String(policy.backoffRate),
        ),
        retries: true,
      };
}

/** When the run ran, as far as the ledger timed
 *  it. */
function spanOf(
  strings: InspectorStrings,
  card: { startedAt?: number; completedAt?: number; durationMs?: number },
): string {
  const started = fine(card.startedAt ?? 0);

  if (card.completedAt === undefined) {
    return filled(strings.spanRunning, started);
  }

  const finished = filled(strings.span, started, fine(card.completedAt));

  return card.durationMs === undefined
    ? finished
    : `${finished} · ${spanText(strings, card.durationMs)}`;
}

/**
 * A length of time, in the two forms the run page
 * draws.
 *
 * Spelled again here rather than borrowed, because
 * the run page's copy resolves through `messages.ts`
 * and a browser frame cannot load that. The rule is
 * the one that matters and it is the same one:
 * milliseconds under a second, and seconds with one
 * decimal over it.
 */
function spanText(strings: InspectorStrings, ms: number): string {
  return ms < 1000
    ? filled(strings.milliseconds, String(Math.round(ms)))
    : filled(strings.seconds, (ms / 1000).toFixed(1));
}
