import { useEffect, type ReactNode } from 'react';

import type { QueuePolicy } from '../core/rules.js';
import type { QueueEvidence, QueueItem } from '../runs/queueEvidence.js';
import { postToHost } from '../webview/client.js';
import { filled } from '../webview/fill.js';
import { shortRunId } from '../webview/ids.js';
import type { InspectorStrings, ShownRun } from '../webview/protocol.js';
import { Button } from '../webview/signal/Button.js';
import { FieldHint } from '../webview/signal/FieldHint.js';
import { PropertyRow } from '../webview/signal/PropertyRow.js';
import { SectionLabel } from '../webview/signal/SectionLabel.js';
import { StatusLine } from '../webview/signal/StatusGlyph.js';
import { glyphStateOf, runWord } from '../webview/states.js';
import { fine } from '../webview/time.js';

import { queueRowsOf, type QueueRow } from './evidence.js';

/**
 * A queue block's Run evidence.
 *
 * A card of its own, because a queue block writes
 * no row: the work is its children's runs, so what
 * there is to say about it is counted rather than
 * recorded, and the face that reads a block's rows
 * would draw an empty one here.
 */

/**
 * What a queue block's children are doing.
 *
 * Three provenances on one card, which is the whole
 * reason each row says its own: the counts are
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
export function QueueCard({
  strings,
  run,
  nodeId,
  handler,
  queue,
}: {
  strings: InspectorStrings;
  run: ShownRun;
  nodeId: string;

  /** The function each item runs, drawn the way the
   *  face for every other block draws its own. */
  handler: ReactNode;

  queue: QueuePolicy;
}) {
  const found = run.queueEvidence?.[nodeId];

  // Asked when the card is shown and never on a
  // tick. The watch's budget for a queue block is
  // one query per tick and it is already spent on
  // the counts above; what this asks for changes
  // far too slowly to be worth another.
  useEffect(() => {
    postToHost({
      type: 'inspectQueue',
      workflowId: run.workflowId,
      nodeId,
    });
  }, [run.workflowId, nodeId]);

  // The window's own failures go on the run's failed
  // row rather than on a row of their own: they are
  // one fact at two scales, and two rows would read
  // as two failures.
  const rows = queueRowsOf(run, nodeId, queue, strings).map((row) =>
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

  return (
    <section className="evidence-face" data-evidence="queue">
      {handler}

      {[...rows, ...read].map((row) => (
        <PropertyRow
          key={row.id}
          label={row.label}
          labels="wide"
          mono
          value={row.value}
          provenance={{
            kind: row.provenance,
            word: strings[row.provenance],
          }}
          hook={{ 'evidence-field': row.id }}
        />
      ))}

      {found === undefined || found.recent.length === 0 ? null : (
        <Recent strings={strings} items={found.recent} />
      )}

      {/* Under everything, because everything above
          it is one application's, read out of the
          one development database this window can
          reach. */}
      <FieldHint hook={{ 'evidence-field': 'local' }}>
        {strings.queueLocal}
      </FieldHint>
    </section>
  );
}

/**
 * The items the block started, newest first.
 *
 * Each is a run of its own, so each is a way to
 * one — the Inspector is no run page, and opens it
 * on the run tab — and each says where it got to
 * in the words every other run is said in. DBOS's
 * own word is the ledger's, and a card that printed
 * it would call one run two things on two panels.
 */
function Recent({
  strings,
  items,
}: {
  strings: InspectorStrings;
  items: readonly QueueItem[];
}) {
  return (
    <section className="evidence-section" data-evidence-field="recentWork">
      <SectionLabel>{strings.queueRows.recentWork}</SectionLabel>

      <ul className="queue-items">
        {items.map((item) => {
          // An item's row carries no dispatch count,
          // so one still going reads running and
          // nothing finer.
          const word = runWord({ status: item.status, parked: false });

          return (
            <li key={item.workflowId} className="queue-item">
              <Button
                variant="quiet"
                mono
                hook={{ 'queue-item': item.workflowId }}
                onClick={() =>
                  postToHost({ type: 'openRun', workflowId: item.workflowId })
                }
              >
                {item.label === undefined ? (
                  <ShortRun id={item.workflowId} />
                ) : (
                  <span className="queue-item-name">{item.label}</span>
                )}
              </Button>

              <StatusLine
                state={glyphStateOf(word)}
                word={strings.runOutcomes[word]}
                detail={
                  item.completedAt === undefined ? undefined : (
                    <span data-time="fine">{fine(item.completedAt)}</span>
                  )
                }
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** An item nothing names, by the id every run is
 *  known by, carrying the whole of it: four
 *  characters collide about once in fifty runs. */
function ShortRun({ id }: { id: string }) {
  return (
    <span data-short-run={id} title={id}>
      {shortRunId(id)}
    </span>
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
