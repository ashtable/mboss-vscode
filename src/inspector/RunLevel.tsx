import {
  Fragment,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';

import { postToHost } from '../webview/client.js';
import { filled } from '../webview/fill.js';
import type {
  InspectorStrings,
  RunLevel,
  RunLineage,
} from '../webview/protocol.js';
import { Button } from '../webview/signal/Button.js';
import { FieldHint } from '../webview/signal/FieldHint.js';
import { PropertyRow } from '../webview/signal/PropertyRow.js';
import { SectionLabel } from '../webview/signal/SectionLabel.js';
import { StatusLine } from '../webview/signal/StatusGlyph.js';

import { InspectorHeader } from './Header.js';
import { Recorded } from './Value.js';

/**
 * A whole run, when one is in front and nothing of
 * it is picked.
 *
 * Read top to bottom as one argument: which run and
 * where it got to, what it was started with, the row
 * DBOS keeps about it, what a recovery cost, where
 * it was replayed from and to, and only then the
 * ways on from it. The controls and the replay come
 * last because each of them writes somewhere, and
 * the evidence for pressing one is above it.
 *
 * The raw status column is shown here as DBOS wrote
 * it, in the row it is a column of, and nowhere
 * else: every other word about the run is the one a
 * person reads a run's state in.
 *
 * What only the run tab has read — a recovery's
 * cost, the lineage, a replay's note — arrives
 * absent for a run a canvas is following, and draws
 * nothing rather than a section with nothing in it.
 */
export function RunLevelCard({
  strings,
  run,
  takesFocus,
}: {
  strings: InspectorStrings;
  run: RunLevel;

  /** Whether the card is the answer to somebody
   *  asking for the whole run from a block, whose
   *  Button went with the block. */
  takesFocus: RefObject<boolean>;
}) {
  const title = useRef<HTMLHeadingElement>(null);

  // Asked for from a block's face: the Button that
  // was pressed is gone, so focus goes to the name of
  // what the pane is about now.
  useEffect(() => {
    if (takesFocus.current) title.current?.focus();
  }, []);

  // Following an id changes what the pane is about,
  // and the Button that was pressed may not be drawn
  // once it has. The header is drawn for every run,
  // and names whichever one the pane is about next.
  const follow = (workflowId: string) => {
    postToHost({ type: 'openRun', workflowId });
    title.current?.focus();
  };

  return (
    <>
      <InspectorHeader
        title={
          <h1 ref={title} className="inspector-title" tabIndex={-1}>
            {run.workflow}
          </h1>
        }
        kind={placed(
          strings.runKind,
          <ShortRun id={run.workflowId} short={run.short} />,
        )}
        status={<StatusLine state={run.state} word={run.line} />}
      />

      <div className="run-level" data-evidence="run">
        <section className="run-section" data-workflow-input="">
          <SectionLabel level={2}>{strings.workflowInput}</SectionLabel>

          {run.input === undefined ? (
            <FieldHint>{strings.noInput}</FieldHint>
          ) : (
            <Recorded
              value={run.input}
              words={{
                inline: strings.inline,
                artifact: strings.artifact,
                open: strings.openInput,
              }}
              onOpen={() =>
                postToHost({ type: 'openInput', workflowId: run.workflowId })
              }
              openHook={{ 'evidence-action': 'openInput' }}
            />
          )}
        </section>

        <section className="run-section">
          <SectionLabel level={2}>{strings.ledgerHeading}</SectionLabel>

          <div data-ledger="">
            {run.ledger.map((row) => (
              <PropertyRow
                key={row.label}
                label={row.label}
                labels="ledger"
                mono
                value={row.value}
                hook={{ rail: row.label }}
              />
            ))}
          </div>

          <FieldHint hook={{ 'ledger-note': '' }}>{strings.ledger}</FieldHint>
        </section>

        {run.recovery === undefined ? null : (
          <section className="run-section" data-recovery="">
            <SectionLabel level={2}>{strings.recovery}</SectionLabel>

            {run.recovery.map((sentence) => (
              <FieldHint key={sentence}>{sentence}</FieldHint>
            ))}
          </section>
        )}

        {run.lineage.length === 0 ? null : (
          <section className="run-section" data-lineage="">
            <SectionLabel level={2}>{strings.lineage}</SectionLabel>

            {run.lineage.map((line) => (
              <LineageLine
                key={`${line.direction}:${line.workflowId}`}
                line={line}
                strings={strings}
                onFollow={follow}
              />
            ))}
          </section>
        )}

        <Controls run={run} strings={strings} />

        {run.note === undefined ? null : (
          <FieldHint hook={{ 'replay-note': '' }}>{run.note}</FieldHint>
        )}

        <div className="run-actions">
          <Button
            variant="secondary"
            ink="brand"
            disabled={!run.replayStart}
            reason={run.replayRefused}
            hook={{ 'evidence-action': 'replayFrom' }}
            onClick={() =>
              postToHost({
                type: 'replayFrom',
                workflowId: run.workflowId,
                from: 'start',
              })
            }
          >
            {strings.replayStart}
          </Button>

          <Button
            variant="quiet"
            hook={{ 'evidence-action': 'askAgent' }}
            onClick={() =>
              postToHost({ type: 'askAgent', workflowId: run.workflowId })
            }
          >
            {strings.askAgent}
          </Button>
        </div>
      </div>
    </>
  );
}

/**
 * The one control left over the run, and when it
 * was cancelled.
 *
 * Cancel run and Resume are one Button that changes
 * what it says, its look and its hook, rather than
 * one Button taken away and another put in its
 * place: somebody who pressed Cancel run from the
 * keyboard is still on the control once the run has
 * stopped, and it now offers Resume. Never both,
 * because cancel means nothing once a run has
 * stopped and resume nothing while it is going.
 */
function Controls({
  run,
  strings,
}: {
  run: RunLevel;
  strings: InspectorStrings;
}) {
  const { cancel, resume, cancelledAt, gaveUp } = run.controls;

  if (!cancel && !resume && cancelledAt === undefined) return null;

  return (
    <section className="run-section run-controls">
      {cancelledAt === undefined ? null : (
        <PropertyRow
          label={strings.cancelledAt}
          labels="ledger"
          mono
          value={cancelledAt}
          hook={{ cancelled: '' }}
        />
      )}

      {cancel || resume ? (
        <Button
          key="control"
          variant={cancel ? 'stop' : 'primary'}
          hook={cancel ? { cancel: '' } : { resume: '' }}
          onClick={() =>
            postToHost({
              type: cancel ? 'cancelRun' : 'resumeRun',
              workflowId: run.workflowId,
            })
          }
        >
          {cancel ? strings.cancel : strings.resume}
        </Button>
      ) : null}

      {/* Beside the Button rather than above the
          section: it says what Resume does, and a
          sentence about a control that is not on
          offer says nothing. */}
      {resume ? (
        <FieldHint hook={{ 'resume-hint': '' }}>{strings.resumeHint}</FieldHint>
      ) : null}

      {/* Only over a run DBOS gave up on, the one
          run whose give-up count starts again. */}
      {resume && gaveUp ? (
        <FieldHint hook={{ 'attempts-reset': '' }}>
          {strings.resumeResetsAttempts}
        </FieldHint>
      ) : null}
    </section>
  );
}

/**
 * One end of a fork: the run this one was replayed
 * from, or a replay started from it.
 *
 * The ids and the replay's word are read off the
 * ledger; the step a fork started from is worked out
 * from the rows it copied, so that phrase says so in
 * its title. Each id is the way to that run.
 */
function LineageLine({
  line,
  strings,
  onFollow,
}: {
  line: RunLineage;
  strings: InspectorStrings;
  onFollow: (workflowId: string) => void;
}) {
  const id = (
    <Button
      variant="quiet"
      mono
      hook={{ 'lineage-run': line.workflowId }}
      onClick={() => onFollow(line.workflowId)}
    >
      <ShortRun id={line.workflowId} short={line.short} />
    </Button>
  );

  const step = (
    <span data-provenance="derived" title={strings.derived}>
      {filled(strings.fromStep, String(line.startStep))}
    </span>
  );

  return (
    <p className="lineage-line" data-lineage-line="" data-mono="">
      {line.direction === 'of'
        ? placed(strings.replayOf, id, step)
        : placed(strings.replayTo, step, id, line.word)}
    </p>
  );
}

/** A run's short id, carrying the whole of it: four
 *  characters collide about once in fifty runs. */
function ShortRun({ id, short }: { id: string; short: string }) {
  return (
    <span data-short-run={id} title={id}>
      {short}
    </span>
  );
}

/**
 * A template's `{n}` placeholders, filled with
 * things to draw rather than text, so a Button or a
 * marked phrase sits wherever the language puts it.
 */
function placed(template: string, ...parts: ReactNode[]): ReactNode[] {
  return template.split(/(\{\d+\})/).map((piece, at) => {
    const slot = /^\{(\d+)\}$/.exec(piece);

    return slot === null ? (
      piece
    ) : (
      <Fragment key={at}>{parts[Number(slot[1])]}</Fragment>
    );
  });
}
