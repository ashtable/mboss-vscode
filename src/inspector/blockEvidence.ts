import { runStateOf } from '../canvas/graph.js';
import {
  ownerOf,
  type QueuePolicy,
  type WorkflowIR,
  type WorkflowNode,
} from '../core/rules.js';
import type { QueueEvidence } from '../runs/queueEvidence.js';
import { INLINE_LIMIT, sizeOf, type SizeWords } from '../runs/rows.js';
import type { LiveStep } from '../runs/watch.js';
import { filled } from '../webview/fill.js';
import type {
  BlockEvidence,
  BlockState,
  EvidenceRow,
  InspectorStrings,
  QueueCardEvidence,
  QueueRow,
  QueueRowId,
  RecordedValue,
  ShownRun,
} from '../webview/protocol.js';

/**
 * What one run recorded about one block, finished
 * on the host for the pane to draw.
 *
 * "Evidence" is used two ways in this extension and
 * this is the narrow one: what a reader holds about
 * a block, as far as one run's rows say. The other
 * — `runs/evidence.ts` — is a whole document
 * assembled for an agent out of the ledger, the
 * saved workflow and the last code scan. Nothing is
 * shared between them but the word.
 *
 * Finished here rather than in the pane, the way
 * the card about a whole run is: every fact about
 * the block is read from one run, one document and
 * the arms the surface decided, so the head of the
 * pane, the face under it and the board beside it
 * cannot disagree about where the block got to. The
 * pane is handed the answer and draws it.
 *
 * The rows are the whole of it, for every block but
 * one. A block that ran three times wrote three of
 * them; a wait wrote the two halves of parking; a
 * branch the generated code decided without asking
 * anybody wrote none. A queue block wrote none
 * either and never will — the work is its
 * children's runs — so what its card says is
 * counted rather than recorded. What is not here is
 * as load-bearing as what is: DBOS records no
 * per-step input and no count of the tries a step
 * made, so neither is derivable and neither is
 * offered.
 *
 * Times stay numbers. Turning an epoch into a clock
 * is the reader's locale's business and belongs
 * where the card is drawn, which also keeps this
 * module free of anything a test would have to pin
 * a timezone for.
 */

/**
 * What a block's evidence is read from.
 *
 * The document is the one the block is drawn from —
 * a canvas's own read, or the buffer behind the run
 * tab — because which loop a row's round belongs
 * to, and whether a wait sleeps on the clock, are
 * the document's to say, and the drawn document is
 * the one a person is looking at.
 */
export type EvidenceInputs = {
  /** The run the surface follows, with the SDK's
   *  own rows put back under the blocks they ran
   *  in where the surface has them. */
  run: ShownRun;

  document: WorkflowIR;

  nodeId: string;

  /** Which way out each decided block took, as the
   *  surface read them: what says where a run past
   *  a branch may be. */
  decided: Record<string, string>;

  /** The row picked with the block, where the
   *  surface has rows to pick. */
  functionId: number | undefined;
};

/** What one run recorded about one block. */
export function blockEvidenceOf(
  inputs: EvidenceInputs,
  strings: InspectorStrings,
): BlockEvidence {
  const { run, document, nodeId, functionId } = inputs;
  const node = document.nodes.find((one) => one.id === nodeId);
  const rows = run.steps
    .filter((step) => step.nodeId === nodeId)
    .map((step) => rowOf(step, nodeId));
  const drawn =
    rows.find((row) => row.functionId === functionId) ?? headlineOf(rows);

  // A wait on the clock records its wake-up time as
  // what it returned, and the face already says that
  // time as when it wakes.
  const onClock =
    node?.kind === 'durableWait' && node.config.source.kind === 'timer';

  return {
    workflowId: run.workflowId,
    rows,
    drawn,
    picked: drawn !== undefined && drawn.functionId === functionId,
    state: stateOf(inputs, node, drawn),
    waitingSince: parkedSince(rows),
    rounds: roundsIn(
      run.steps,
      node?.kind === 'loop' ? node.config.body : undefined,
    ),
    output:
      drawn === undefined || onClock
        ? undefined
        : outputOf(drawn, strings.sizes),
    queue:
      node?.kind === 'queue'
        ? queueCardOf(run, nodeId, node.config.queue, strings)
        : undefined,
  };
}

/**
 * Where the block got to, for the head of the pane.
 *
 * The drawn row's state and number where there is a
 * row. A trigger writes none — the run existing is
 * the evidence it fired — and a block the run may
 * be at has written none yet; both are worked out
 * by the board's own rule, asked of the document
 * and the arms the board was drawn from, so the
 * head and the block on the graph cannot disagree.
 * A queue block's state is its children's, and they
 * are seldom all at one: its card says where each
 * got to, and one word here would be a summary
 * nothing recorded.
 */
function stateOf(
  { run, document, nodeId, decided }: EvidenceInputs,
  node: WorkflowNode | undefined,
  drawn: EvidenceRow | undefined,
): BlockState | undefined {
  if (node?.kind === 'queue') return undefined;

  const walked =
    node === undefined
      ? undefined
      : runStateOf(document, run, nodeId, new Map(Object.entries(decided)));

  if (node?.kind === 'trigger') {
    return walked === undefined
      ? undefined
      : { word: walked, read: 'derived', derived: 'trigger' };
  }

  if (drawn !== undefined) {
    return { word: drawn.state, read: 'row', functionId: drawn.functionId };
  }

  return walked === undefined
    ? undefined
    : { word: walked, read: 'derived', derived: 'running' };
}

/**
 * The row a block is headed by: its latest failure,
 * else its latest row.
 *
 * A block that failed on its third item is being
 * looked at because of that item, and burying it
 * under two that worked would answer a question
 * nobody asked. A row the SDK wrote under the block
 * is never it: that row is the machinery a block
 * runs on, drawn when somebody picks it in the
 * trace, and a block headed by it would lead with a
 * `DBOS.sleep` rather than with what the block did.
 */
function headlineOf(rows: readonly EvidenceRow[]): EvidenceRow | undefined {
  const own = rows.filter((row) => !row.sdk);

  return own.findLast((row) => row.state === 'failed') ?? own.at(-1);
}

/**
 * What a row returned, drawn the way its size
 * allows: whole where its printed form is short
 * enough to read on the face, and past that as its
 * size and the front of it, with the rest one press
 * away.
 *
 * Nothing where the row returned nothing — no output
 * recorded, or a step that returned `undefined` —
 * rather than a section with nothing in it.
 */
function outputOf(
  row: EvidenceRow,
  sizes: SizeWords,
): RecordedValue | undefined {
  if (row.shown === undefined || row.absent) return undefined;

  return row.shown.length <= INLINE_LIMIT
    ? { kind: 'inline', text: row.shown }
    : {
        kind: 'artifact',
        preview: row.shown,
        size: sizeOf(row.bytes, sizes),
      };
}

function rowOf(step: LiveStep, nodeId: string): EvidenceRow {
  // The region inside the block, which is what is
  // left of the name once the block's own id comes
  // off the front of it. A row the SDK named has no
  // such front — a wait on the clock is drawn from
  // one — and taking a slice of it anyway would
  // read the tail of `DBOS.sleep` as a region.
  const part = step.name.startsWith(nodeId)
    ? step.name.slice(nodeId.length)
    : '';

  return {
    functionId: step.functionId,
    name: step.name,
    part: part === '' ? undefined : part,
    state: step.state,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    durationMs: spanOf(step.startedAt, step.completedAt),
    output: step.output,
    shown: step.shown,
    bytes: step.bytes,
    absent: step.absent,
    error: step.error,
    restored: step.restored,
    reused: step.reused,
    sdk: step.sdk === true,
  };
}

/**
 * When the run stopped here, where it has not
 * started again.
 *
 * Asked of the rows' own state rather than of the
 * names a second time: the reading already worked
 * out which blocks a run is parked on, and asking
 * that question twice is how two panels come to
 * disagree about whether somebody is being waited
 * for.
 */
function parkedSince(rows: readonly EvidenceRow[]): number | undefined {
  if (!rows.some((row) => row.state === 'waiting')) return undefined;

  const registered = rows.findLast((row) => row.part?.endsWith('.register'));

  return registered?.completedAt ?? registered?.startedAt;
}

/**
 * How many distinct rounds the rows inside a block
 * were written under, or nothing where the block
 * encloses none or none of them went round.
 *
 * Scoped to the enclosed blocks rather than counted
 * across the run: a workflow may have two loops,
 * and a set built from every row would report each
 * of them the other's rounds as well as its own. A
 * recorded row carries the round it ran in and not
 * the loop that numbered it, so which rows are this
 * loop's is the document's answer.
 */
function roundsIn(
  steps: readonly LiveStep[],
  body: readonly string[] | undefined,
): number | undefined {
  if (body === undefined) return undefined;

  const inside = new Set(body);
  const rounds = new Set(
    steps.flatMap((step) => {
      const owner = ownerOf(step.name);
      if (owner.kind !== 'node' || !inside.has(owner.nodeId)) return [];

      return owner.segments.flatMap((segment) =>
        segment.kind === 'round' ? [segment.round] : [],
      );
    }),
  );

  return rounds.size === 0 ? undefined : rounds.size;
}

function spanOf(
  from: number | undefined,
  to: number | undefined,
): number | undefined {
  return from === undefined || to === undefined ? undefined : to - from;
}

/**
 * A queue block's card: what this run's share of
 * the queue is doing, the limits the document sets
 * beside it, and what the one read a pick costs
 * said about the whole queue, where it was made.
 *
 * Three provenances, which is why each row says its
 * own: the counts are this run's, read every tick;
 * the window and the registration are the whole
 * queue's, read once because somebody opened the
 * card; and the name and the limits are what the
 * document asks for. A card that mixed them would
 * be reporting a ceiling somebody typed as though a
 * run had reached it.
 *
 * What is deliberately absent is a rate. DBOS
 * records what ran and never what it was allowed to
 * run, so a meter drawn against a rate limit would
 * be a figure this panel invented — and the count
 * of starts inside the window is the honest form of
 * the same question.
 */
function queueCardOf(
  run: ShownRun,
  nodeId: string,
  queue: QueuePolicy,
  strings: InspectorStrings,
): QueueCardEvidence {
  const found = run.queueEvidence?.[nodeId];

  // The window's own failures go on the run's failed
  // row rather than on a row of their own: they are
  // one fact at two scales, and two rows would read
  // as two failures.
  const counted = queueRowsOf(run, nodeId, queue, strings).map((row) =>
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

  const read: QueueRow[] =
    found === undefined
      ? []
      : [
          {
            id: 'observedStarts',
            label: strings.queueRows.observedStarts,
            value: filled(
              strings.queueStarted,
              String(found.window.started),
              String(found.window.windowSec),
            ),
            provenance: 'derived',
          },
          {
            id: 'registered',
            label: strings.queueRows.registered,
            value: registeredText(strings, found.registered),
            provenance: 'derived',
          },
        ];

  return { rows: [...counted, ...read], recent: found?.recent ?? [] };
}

/**
 * The half of a queue block's card that costs no
 * read: the counts a tick already read, and the two
 * limits the document sets beside them.
 *
 * A run opened from a cold read carries no counts
 * at all: only a watch fills them. That is not
 * zero and is not drawn as zero — the rows simply
 * are not there.
 */
function queueRowsOf(
  run: ShownRun,
  nodeId: string,
  queue: QueuePolicy,
  strings: InspectorStrings,
): QueueRow[] {
  const counts = run.queues?.[nodeId];
  const ceiling = queue.globalConcurrency;
  const rate = rateText(strings, queue.rateLimit);

  const reading = (
    id: QueueRowId,
    value: string,
    provenance: QueueRow['provenance'],
  ): QueueRow => ({ id, label: strings.queueRows[id], value, provenance });

  return [
    reading('queue', queue.name, 'configured'),

    ...(counts === undefined
      ? []
      : [
          reading(
            'active',
            ceiling === undefined
              ? String(counts.active)
              : filled(
                  strings.queueOfGlobal,
                  String(counts.active),
                  String(ceiling),
                ),
            'derived',
          ),
          reading(
            'queued',
            counts.delayed === 0
              ? String(counts.queued)
              : filled(
                  strings.queueDelayed,
                  String(counts.queued),
                  String(counts.delayed),
                ),
            'derived',
          ),
          reading('failed', String(counts.failed), 'derived'),
        ]),

    ...(rate === undefined ? [] : [reading('rateLimit', rate, 'configured')]),

    ...(ceiling === undefined
      ? []
      : [reading('globalConcurrency', String(ceiling), 'configured')]),
  ];
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
