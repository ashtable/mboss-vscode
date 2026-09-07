import { DEFAULT_RETRY } from '../../core/rules.js';
import type { NodeKind, Retry } from '../../core/rules.js';
import { OUTPUT_KEPT } from '../../runs/rows.js';
import type { LiveRun } from '../../runs/watch.js';
import { postToHost } from '../../webview/client.js';
import { filled } from '../../webview/fill.js';
import type { InspectorStrings } from '../../webview/protocol.js';
import { fine } from '../../webview/time.js';
import type { RunState } from '../graph.js';

import { evidenceOf, runCardOf, type EvidenceRow } from './evidence.js';

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
};

export type EvidenceProps = {
  strings: InspectorStrings;

  /** The run the canvas is drawing itself against,
   *  which is the only run this face reads. */
  run: LiveRun;

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
  return block === undefined || block.kind === 'trigger' ? (
    <RunCard strings={strings} run={run} onRunPage={onRunPage} />
  ) : (
    <BlockCard strings={strings} run={run} block={block} runState={runState} />
  );
}

function BlockCard({
  strings,
  run,
  block,
  runState,
}: {
  strings: InspectorStrings;
  run: LiveRun;
  block: EvidenceBlock;
  runState: RunState | undefined;
}) {
  const found = evidenceOf(run, block.id);
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
        <Recorded strings={strings} run={run} nodeId={block.id} row={row} />
      )}

      {policy === undefined ? null : (
        <>
          <p data-evidence-field="retry">
            <span className="value mono">{policy.text}</span>
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
    </section>
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
  nodeId,
  row,
}: {
  strings: InspectorStrings;
  run: LiveRun;
  nodeId: string;
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

      {/* Only where the stack named a file in the
          project's own code. Most failures name the
          SDK and the generated workflow and nothing
          else, and there is no line to go to for
          one of those. */}
      {row.error?.frame === undefined ? null : (
        <div data-evidence-field="errorLocation">
          <div className="evidence-actions">
            <button
              type="button"
              className="btn quiet"
              data-evidence-action="openErrorLocation"
              onClick={() =>
                postToHost({
                  type: 'openErrorLocation',
                  nodeId,
                  functionId: row.functionId,
                })
              }
            >
              {strings.openErrorLocation}
            </button>
          </div>

          {/* The line is a fact about the image, not
              about the folder on screen, and saying
              so is what keeps it from being read as
              a promise about the file it opens. */}
          <p className="hint">{strings.errorLocationFrom}</p>
        </div>
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
  run: LiveRun;
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
