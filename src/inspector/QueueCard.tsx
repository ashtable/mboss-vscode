import { useEffect, type ReactNode } from 'react';

import type { QueueItem } from '../runs/queueEvidence.js';
import { postToHost } from '../webview/client.js';
import { shortRunId } from '../webview/ids.js';
import type {
  InspectorStrings,
  QueueCardEvidence,
} from '../webview/protocol.js';
import { Button } from '../webview/signal/Button.js';
import { FieldHint } from '../webview/signal/FieldHint.js';
import { PropertyRow } from '../webview/signal/PropertyRow.js';
import { SectionLabel } from '../webview/signal/SectionLabel.js';
import { StatusLine } from '../webview/signal/StatusGlyph.js';
import { glyphStateOf, runWord } from '../webview/states.js';
import { fine } from '../webview/time.js';

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
 * What a queue block's children are doing, as the
 * host counted it.
 *
 * Every reading on the card says where it came
 * from — this run's counts, the whole queue's
 * window, or what the document asks for — because
 * a card that mixed them would be reporting a
 * ceiling somebody typed as though a run had
 * reached it. Which readings there are, and their
 * words, are the host's answer; the card draws
 * them and asks for the read that fills the rest.
 */
export function QueueCard({
  strings,
  evidence,
  workflowId,
  nodeId,
  handler,
}: {
  strings: InspectorStrings;

  /** The card's readings, and the items the block
   *  started where the whole queue was read. */
  evidence: QueueCardEvidence;

  /** The run the card is about, which the read it
   *  asks for names. */
  workflowId: string;

  nodeId: string;

  /** The function each item runs, drawn the way the
   *  face for every other block draws its own. */
  handler: ReactNode;
}) {
  // Asked when the card is shown and never on a
  // tick. The watch's budget for a queue block is
  // one query per tick and it is already spent on
  // the counts; what this asks for changes far too
  // slowly to be worth another.
  useEffect(() => {
    postToHost({ type: 'inspectQueue', workflowId, nodeId });
  }, [workflowId, nodeId]);

  return (
    <section className="evidence-face" data-evidence="queue">
      {handler}

      {evidence.rows.map((row) => (
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

      {evidence.recent.length === 0 ? null : (
        <Recent strings={strings} items={evidence.recent} />
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
