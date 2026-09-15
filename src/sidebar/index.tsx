import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import type { DiffLine } from '../acp/diff.js';
import { evidenceRunOf } from '../acp/evidenceRow.js';
import type {
  DiagnosticEntry,
  FileEditEntry,
  PermissionPrompt,
  PlanEntry,
  Provenance,
  ToolEntry,
  ToolLine,
} from '../acp/transcript.js';
import type { PermissionOptionKind } from '../acp/connection.js';
import { postToHost } from '../webview/client.js';
import { filled } from '../webview/fill.js';
import { shortRunId } from '../webview/ids.js';
import { mountView } from '../webview/mount.js';
import type {
  SidebarEntry,
  SidebarInit,
  SidebarPreview,
  SidebarStrings,
} from '../webview/protocol.js';
import { Button, type ButtonProps } from '../webview/signal/Button.js';
import { Callout } from '../webview/signal/Callout.js';
import { EmptyState } from '../webview/signal/EmptyState.js';
import { FieldHint } from '../webview/signal/FieldHint.js';
import { hooked } from '../webview/signal/hook.js';
import { SectionLabel } from '../webview/signal/SectionLabel.js';
import { StateWord } from '../webview/signal/StateWord.js';

import { Composer } from './Composer.js';
import { namedByFile } from './naming.js';
import { Prose } from './Prose.js';

import './sidebar.css';

/**
 * The agent panel.
 *
 * A conversation drawn as a work log rather than
 * as a chat: what the agent said is prose, and
 * what it did is a one-line card with a rail down
 * its left edge saying who did it, and a card per
 * file it touched. That is the difference this
 * product is about — an agent proposes, mBoss
 * validates, a person approves — and a stream of
 * speech bubbles would hide the half that matters.
 *
 * The panel holds nothing. It is handed the whole
 * picture every time anything moves, because the
 * view is disposed whenever it is hidden and the
 * extension is what remembers.
 */

/** One row of the transcript, or the summary that
 *  closes out a run of file edits. */
type Row =
  | { kind: 'entry'; entry: SidebarEntry }
  | { kind: 'files'; key: string; ids: string[]; total: number };

/**
 * Groups consecutive file edits so a run of them can
 * close with one "n files changed" row instead of
 * repeating a Keep/Undo pair down the column.
 *
 * Folded into rows here rather than carried on the
 * entries themselves: it is purely how the list is
 * drawn, and the transcript the host sends says
 * nothing about where one turn's edits end.
 */
function transcriptRows(entries: readonly SidebarEntry[]): Row[] {
  const rows: Row[] = [];
  let group: FileEditEntry[] = [];

  const closeGroup = (): void => {
    const pending = group.filter((entry) => entry.decision === 'pending');

    // Shown only once there is more than one to act
    // on together — with a single file, its own Keep
    // and Undo already say everything this row would.
    if (pending.length > 1) {
      rows.push({
        kind: 'files',
        key: `files-${group[0]?.id}`,
        ids: pending.map((entry) => entry.id),
        total: pending.length,
      });
    }

    group = [];
  };

  // A run of files closes before whatever follows
  // it, so its row sits under the files it is about.
  for (const entry of entries) {
    if (entry.at !== 'file') closeGroup();

    rows.push({ kind: 'entry', entry });

    if (entry.at === 'file') group.push(entry);
  }

  closeGroup();

  return rows;
}

function keepAll(ids: string[]): void {
  for (const id of ids) postToHost({ type: 'keepFile', id });
}

function undoAll(ids: string[]): void {
  for (const id of ids) postToHost({ type: 'undoFile', id });
}

function Panel(state: SidebarInit) {
  const { strings, status } = state;
  const blocked = blockedBy(state);
  const composer = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLOListElement>(null);
  const rows = transcriptRows(state.transcript);
  const scrolled = useFollow(log, state.transcript);

  return (
    <div className="agent">
      {/* One row: the product and the panel, then the
          agent a prompt goes to, by the name it goes
          by. The caret is drawn rather than named, so
          the control is called what it picks. */}
      <header className="agent-head" data-agent-head>
        <h1 className="agent-title">{strings.heading}</h1>
        <Button
          variant="quiet"
          mono
          hook={{ 'choose-agent': '' }}
          onClick={() => postToHost({ type: 'chooseAgent' })}
        >
          {state.agent ?? strings.chooseAgent}
          <span aria-hidden="true"> ▾</span>
        </Button>
      </header>

      {/* The state of the whole panel, not its first
          row: what is in the way, and what to do
          about it. The way out of it is the editor's
          or the picker's, so it offers none. */}
      {blocked === undefined ? null : (
        <EmptyState
          kind="empty"
          title={blocked.title}
          detail={blocked.detail}
          hook={{ 'agent-state': status }}
        />
      )}

      <ol className="transcript" ref={log} onScroll={scrolled}>
        {rows.map((row) =>
          row.kind === 'entry' ? (
            <li key={row.entry.id} data-entry={row.entry.id}>
              <Entry entry={row.entry} strings={strings} />
            </li>
          ) : (
            <li
              key={row.key}
              className="files-batch"
              data-block="diff"
              data-files-batch
            >
              <FieldHint tone="muted">
                {filled(strings.filesChanged, String(row.total))}
              </FieldHint>
              <Button
                variant="quiet"
                ink="brand"
                hook={{ 'keep-all': '' }}
                onClick={() => keepAll(row.ids)}
              >
                {strings.keepAllEdits}
              </Button>
              <Button
                variant="quiet"
                hook={{ 'undo-all': '' }}
                onClick={() => undoAll(row.ids)}
              >
                {strings.undoAllEdits}
              </Button>
            </li>
          ),
        )}
      </ol>

      {/* Everything under the log shares one region
          with a ceiling of its own: a long draft or
          a tall question scrolls in there, and the
          log always keeps the rest of the panel. */}
      <div className="agent-foot">
        {state.prompt === undefined ? null : (
          <PermissionRow prompt={state.prompt} strings={strings} />
        )}

        {state.preview === undefined ? null : (
          <Proposal
            preview={state.preview}
            strings={strings}
            onRefine={() => composer.current?.focus()}
          />
        )}

        {state.failure === undefined ? null : (
          <Callout
            tone="fail"
            title={state.failure.headline}
            hook={{ failure: '' }}
          >
            {state.failure.detail}
          </Callout>
        )}

        {blocked === undefined ? (
          <Composer
            strings={strings}
            agent={state.agent}
            status={status}
            attached={state.attached}
            field={composer}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Keeps the log on its newest line while somebody is
 * reading its newest line, and leaves it alone once
 * they have scrolled back.
 *
 * An agent writes for minutes at a time, and a log
 * that held its position would put every one of
 * those minutes below the fold. One that always
 * jumped would pull an earlier line out from under
 * somebody reading it. So the log follows what
 * arrives only for a reader already at its end, and
 * does the same when its own box changes size,
 * which is what a growing draft does to it.
 *
 * Returns what the log calls when it is scrolled.
 */
function useFollow(
  log: RefObject<HTMLOListElement | null>,
  transcript: readonly SidebarEntry[],
): () => void {
  const atEnd = useRef(true);

  const follow = (): void => {
    const element = log.current;

    if (element !== null && atEnd.current) {
      element.scrollTop = element.scrollHeight;
    }
  };

  // Before paint, so a chunk that arrives is never
  // drawn once above the fold and then scrolled to.
  useLayoutEffect(follow, [transcript]);

  useEffect(() => {
    const element = log.current;

    if (element === null) return;

    const observer = new ResizeObserver(follow);

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  // Within a line of the end counts as the end: a
  // scroll rarely stops on a whole pixel, and
  // nobody reading the last line means to be told
  // they have left it.
  return () => {
    const element = log.current;

    if (element === null) return;

    const line = Number.parseFloat(getComputedStyle(element).lineHeight);
    const below =
      element.scrollHeight - element.scrollTop - element.clientHeight;

    atEnd.current = below <= line;
  };
}

/**
 * The one decision this product is about.
 *
 * An agent has written down what it wants the
 * workflow to be; the canvas is drawing it; this is
 * where a person answers. Approving writes it and
 * sends the agent on to the handlers. Refining
 * writes nothing at all — it puts the cursor back
 * in the composer, and the proposal stays
 * outstanding until the agent replaces it.
 *
 * A section of the region over the composer rather
 * than a card of its own: the canvas is where the
 * proposal is drawn in pencil, and this is only
 * where it is answered, so it needs a label and the
 * two ways on, not a second drawing of the same
 * pencil.
 *
 * A proposal the graph has moved past offers a
 * different way on rather than the same one
 * switched off, because what a person can do about
 * it is different: not "that again", but ask for it
 * again. Undo is switched off outright once there is
 * nothing to go back to: there is no sentence to
 * give about why, so nothing is left for a keyboard
 * to land on.
 */
function Proposal({
  preview,
  strings,
  onRefine,
}: {
  preview: SidebarPreview;
  strings: SidebarStrings;
  onRefine: () => void;
}) {
  return (
    <section className="proposal" data-preview-card data-at={preview.at}>
      <div className="proposal-head">
        <SectionLabel>{strings.proposal}</SectionLabel>
        <span className="proposal-workflow mono">{preview.workflow}</span>
      </div>

      {preview.at === 'stale' ? (
        <p className="proposal-warning">{preview.warning}</p>
      ) : (
        <p className="proposal-summary mono">{preview.summary}</p>
      )}

      <div className="proposal-actions">
        {preview.at === 'proposed' ? (
          <Button
            variant="primary"
            hook={{ approve: '' }}
            onClick={() =>
              postToHost({ type: 'approve', proposalId: preview.id })
            }
          >
            {strings.approve}
          </Button>
        ) : null}

        {preview.at === 'applied' ? (
          <Button
            variant="quiet"
            disabled={!preview.undoable}
            hook={{ undo: '' }}
            onClick={() => postToHost({ type: 'undo' })}
          >
            {strings.undo}
          </Button>
        ) : (
          <Button variant="quiet" hook={{ refine: '' }} onClick={onRefine}>
            {strings.refine}
          </Button>
        )}
      </div>
    </section>
  );
}

function Entry({
  entry,
  strings,
}: {
  entry: SidebarEntry;
  strings: SidebarStrings;
}) {
  if (entry.at === 'message') {
    if (entry.reasoning !== undefined) {
      return (
        <ToolEventRow
          by="agent"
          verb={entry.reasoning.verb}
          target={entry.reasoning.target}
          theirs
          status="in_progress"
          hook={{ reasoning: '' }}
          strings={strings}
        />
      );
    }

    return entry.from === 'user' ? (
      <UserMessage text={entry.text} echo={entry.about !== undefined} />
    ) : (
      <div className="said" data-from={entry.from} data-block="prose">
        <Prose text={entry.text} verbatim />
      </div>
    );
  }

  if (entry.at === 'tool') return <Tool entry={entry} strings={strings} />;

  if (entry.at === 'file') return <FileDiff entry={entry} strings={strings} />;

  if (entry.at === 'diagnostic') {
    return <Diagnostic entry={entry} strings={strings} />;
  }

  // What to do after a turn that asked about a
  // block: a sentence mBoss wrote, so prose, and
  // none of it verbatim, then the two ways on.
  if (entry.at === 'next') {
    return (
      <div className="said" data-from="agent" data-block="prose" data-next>
        <p className="next-sentence">{entry.sentence}</p>
        <div className="next-actions">
          <Button
            variant="secondary"
            ink="brand"
            hook={{ 'replay-from': '' }}
            onClick={() =>
              postToHost({
                type: 'replayFrom',
                workflowId: entry.about.workflowId,
                nodeId: entry.about.nodeId,
              })
            }
          >
            {strings.replayFromHere}
          </Button>
          <Button
            variant="quiet"
            hook={{ 'undo-turn': '' }}
            onClick={() => undoAll(entry.edits)}
          >
            {strings.undoTurnEdits}
          </Button>
        </div>
      </div>
    );
  }

  return <Plan entry={entry} strings={strings} />;
}

/**
 * What a person asked for, set apart from what came
 * back.
 *
 * A prompt somebody typed is shown exactly as it was
 * sent: it is theirs, asterisks and all. A question
 * mBoss put for somebody arrives as the column's own
 * copy of it, which names things from the code, so
 * that copy is read as prose and none of it is
 * anybody's verbatim words.
 */
function UserMessage({ text, echo }: { text: string; echo: boolean }) {
  return (
    <div className="said" data-from="user" data-block="user">
      {echo ? (
        <Prose text={text} verbatim={false} />
      ) : (
        <p className="said-typed" data-verbatim>
          {text}
        </p>
      )}
    </div>
  );
}

/**
 * The tone each state is said in. Still going is
 * the only one that moves, and the one mBoss wrote
 * itself reads as a finished call does: it did the
 * thing rather than ask for it.
 */
const TONE_OF = {
  pending: 'faint',
  in_progress: 'ok',
  completed: 'muted',
  applied: 'muted',
  failed: 'fail',
} as const satisfies Record<ToolEntry['status'], string>;

/**
 * One unit of work: what was done, and to what, on
 * one line, with a rail down the left edge saying
 * who did it and a word at the end saying how it
 * went.
 *
 * One line whatever it names, because a column of
 * these is read down its left edge: a long target
 * gives up its end rather than the row growing a
 * second line. What a call printed stays folded:
 * the interesting part of a finished call is usually
 * whatever it printed, and the interesting part of a
 * running one is that it is running, so neither
 * needs the text on screen until somebody asks.
 *
 * `theirs` says the target is the agent's own words
 * rather than a name mBoss worked out.
 */
function ToolEventRow({
  by,
  verb,
  target,
  theirs,
  status,
  fold,
  action,
  hook,
  strings,
}: {
  by: Provenance;
  verb: string;
  target: ReactNode;
  theirs: boolean;
  status: ToolEntry['status'];

  /** The lines folded under the row, and what the
   *  control that shows them says. */
  fold?: { label: string; lines: ReactNode[] };

  action?: ToolEntry['action'];
  hook: Record<string, string>;
  strings: SidebarStrings;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="tool" data-block="tool" data-by={by} {...hooked(hook)}>
      <p className="tool-line">
        <span className="tool-verb">{verb}</span>
        {/* A title that names no one thing is all
            verb, and has no target to set in mono. */}
        {target === '' ? null : (
          <span
            className="tool-target mono"
            data-verbatim={theirs ? '' : undefined}
          >
            {target}
          </span>
        )}
        <StateWord tone={TONE_OF[status]} pulse={status === 'in_progress'}>
          {strings.toolStatus[status]}
        </StateWord>
      </p>

      {fold === undefined && action === undefined ? null : (
        <div className="tool-controls">
          {fold === undefined ? null : (
            <Button
              variant="quiet"
              expanded={open}
              hook={{ 'tool-body-toggle': '' }}
              onClick={() => setOpen((was) => !was)}
            >
              {fold.label}
            </Button>
          )}

          {/* The one place this row leads, where it
              leads anywhere. The label and the id are
              both the entry's: the panel resolves no
              words and works out no run. */}
          {action === undefined ? null : (
            <Button
              variant="quiet"
              ink="brand"
              hook={{ 'tool-action': action.posts }}
              onClick={() =>
                postToHost({ type: 'openRun', workflowId: action.workflowId })
              }
            >
              {action.label}
            </Button>
          )}
        </div>
      )}

      {open && fold !== undefined ? (
        <div className="tool-lines">{fold.lines}</div>
      ) : null}
    </div>
  );
}

/** A call, from the entry the host sent for it. */
function Tool({
  entry,
  strings,
}: {
  entry: ToolEntry;
  strings: SidebarStrings;
}) {
  // A summary mBoss wrote is lines of its own words
  // with the run's values set apart; anything else a
  // call printed is the agent's, line by line.
  const lines: ToolLine[] = entry.lines ?? entry.body.map((text) => ({ text }));
  const byAgent = entry.by === 'agent';

  return (
    <ToolEventRow
      by={entry.by}
      verb={entry.verb}
      target={targetOf(entry)}
      theirs={byAgent && !namedByFile(entry)}
      status={entry.status}
      fold={
        lines.length === 0
          ? undefined
          : {
              label: filled(strings.showLines, String(lines.length)),
              lines: lines.map((line, index) => (
                <p className="tool-body mono" key={index}>
                  {byAgent ? <span data-verbatim>{line.text}</span> : line.text}
                  {line.recorded === undefined ? null : (
                    <span data-verbatim>{line.recorded}</span>
                  )}
                </p>
              )),
            }
      }
      action={entry.action}
      hook={{ 'tool-call': entry.id, kind: entry.kind, status: entry.status }}
      strings={strings}
    />
  );
}

/**
 * What a row is about. The row mBoss wrote about a
 * run names it by its short id, and the whole id
 * stays on the name for whoever needs to tell two
 * short ones apart.
 */
function targetOf(entry: ToolEntry): ReactNode {
  const run = evidenceRunOf(entry);

  if (run === undefined) return entry.target;

  const short = shortRunId(run);
  const at = entry.target.indexOf(short);

  if (at === -1) return entry.target;

  return (
    <>
      {entry.target.slice(0, at)}
      <span data-short-run={run} title={run}>
        {short}
      </span>
      {entry.target.slice(at + short.length)}
    </>
  );
}

/**
 * One file, as the agent left it: one card, with a
 * header saying what was done to the file and where
 * that stands, the lines that changed, and a footer
 * holding what can still be done about it.
 *
 * Its own card rather than a line inside the call
 * that wrote it: a file is what a person keeps or
 * undoes, so it is the thing that carries a
 * decision. The call keeps its own row above it.
 */
function FileDiff({
  entry,
  strings,
}: {
  entry: Extract<SidebarEntry, { at: 'file' }>;
  strings: SidebarStrings;
}) {
  const { directory, name } = splitPath(entry.shownPath);

  // Nothing was kept past the byte cap, so there is
  // nothing left to compare against or write back.
  const canUndo = entry.newText !== undefined;

  return (
    <div
      className="file"
      data-block="diff"
      data-file={entry.path}
      data-by={entry.by}
      data-decision={entry.decision}
    >
      <p className="file-head">
        <span className="file-verb">{strings.toolVerbs.edit}</span>
        {/* Where the file sits gives up its end in a
            narrow panel before the file's own name
            gives up anything. The whole path stays on
            the name for whoever needs it. */}
        <span className="file-path mono" title={entry.path}>
          {directory === '' ? null : (
            <span className="file-dir">{directory}</span>
          )}
          <span className="file-name">{name}</span>
        </span>
        <span className="file-stat">
          {/* Three lines added reads the same as three
              lines appended, so a file that was not
              there before says so. */}
          {entry.isNew ? (
            <StateWord tone="muted" hook={{ 'new-file': '' }}>
              {strings.newFile}
            </StateWord>
          ) : null}
          <span className="file-counts">
            <span className="added">+{entry.added}</span>
            <span className="removed">−{entry.removed}</span>
          </span>
          <StateWord
            tone={entry.state === 'failed' ? 'fail' : 'muted'}
            hook={{ 'file-state': entry.state }}
          >
            {strings.fileStates[entry.state]}
          </StateWord>
        </span>
      </p>

      {entry.lines.length === 0 ? null : (
        <div className="diff">
          {entry.lines.map((line, index) => (
            <DiffLineRow line={line} key={index} />
          ))}
        </div>
      )}

      {entry.decision === 'pending' ? (
        <div className="file-foot">
          <Button
            variant="quiet"
            ink="brand"
            hook={{ keep: '' }}
            onClick={() => postToHost({ type: 'keepFile', id: entry.id })}
          >
            {strings.keepEdit}
          </Button>
          {canUndo ? (
            <Button
              variant="quiet"
              hook={{ 'undo-file': '' }}
              onClick={() => postToHost({ type: 'undoFile', id: entry.id })}
            >
              {strings.undoEdit}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* The word in the header says what happened;
          this says why nothing is offered. */}
      {entry.decision === 'changed-since' ? (
        <div className="file-foot">
          <FieldHint tone="warn" hook={{ 'file-note': '' }}>
            {strings.changedSince}
          </FieldHint>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A shown path as the directory it sits in, with
 * its separator, and the file's own name. Split on
 * either separator, because a path is shown the way
 * the platform the host runs on spells it.
 */
function splitPath(shown: string): { directory: string; name: string } {
  const cut = Math.max(shown.lastIndexOf('/'), shown.lastIndexOf('\\')) + 1;

  return { directory: shown.slice(0, cut), name: shown.slice(cut) };
}

/**
 * One line of a diff, with one number: where the
 * line was in the old file when it was taken out,
 * and where it is in the new one otherwise. Where
 * two hunks meet, the numbers jump.
 *
 * The sign is read out with the line: without it a
 * line taken out and the line put in its place
 * sound the same, and only the tint tells them
 * apart.
 */
function DiffLineRow({ line }: { line: DiffLine }) {
  return (
    <p className="diff-line" data-kind={line.kind}>
      <span className="gutter">
        {(line.kind === 'del' ? line.oldNo : line.newNo) ?? ''}
      </span>
      <span className="sign">
        {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}
      </span>
      <span className="text" data-verbatim>
        {line.text}
      </span>
    </p>
  );
}

/**
 * Something that went wrong, in the words of
 * whatever found it.
 *
 * Laid out the way a call's row is — where it came
 * from, and a word saying where that leaves the
 * work — with a rail in the failure's colour where
 * a call has one in its author's: what matters
 * about this block is that it failed, not who
 * wrote it. Each thing found is a line of machine
 * evidence, its code set in the failure's ink so a
 * column of them is read down its codes.
 *
 * Every line here was written by the extension in
 * the host, where the strings are resolved — the
 * panel adds only the count and the arrow.
 */
function Diagnostic({
  entry,
  strings,
}: {
  entry: DiagnosticEntry;
  strings: SidebarStrings;
}) {
  const fix = entry.fix;

  return (
    <div
      className="diagnostic"
      data-block="diagnostic"
      data-source={entry.source}
    >
      <p className="diagnostic-head">
        <span className="diagnostic-source mono">{entry.source}</span>
        <StateWord tone="fail">
          {filled(strings.failedCount, String(entry.rows.length))}
        </StateWord>
      </p>

      {entry.rows.length === 0 ? null : (
        <div className="diagnostic-rows">
          {entry.rows.map((row, index) => (
            <p className="diagnostic-row mono" key={index}>
              {row.code === undefined ? null : (
                <span className="diagnostic-code">{row.code}</span>
              )}
              {row.at === undefined ? null : (
                <span className="diagnostic-at">{row.at}</span>
              )}
              <span className="diagnostic-message">{row.message}</span>
            </p>
          ))}
        </div>
      )}

      {/* The one thing to do about it, which is to
          hand it back: the prompt was written
          beside the rows by whoever noted them. The
          arrow is drawn, not read out. */}
      {fix === undefined ? null : (
        <div className="diagnostic-foot">
          <Button
            variant="quiet"
            ink="brand"
            hook={{ fix: '' }}
            onClick={() => postToHost({ type: 'prompt', text: fix.prompt })}
          >
            {fix.label}
            <span aria-hidden="true"> →</span>
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The agent's checklist, drawn as a row of work: the
 * step it is on, and whether it is still going. The
 * steps fold under it, each with its own word.
 */
function Plan({
  entry,
  strings,
}: {
  entry: PlanEntry;
  strings: SidebarStrings;
}) {
  const now =
    entry.steps.find((step) => step.status === 'in_progress') ??
    entry.steps.find((step) => step.status === 'pending');

  return (
    <ToolEventRow
      by="agent"
      verb={strings.plan}
      target={now?.text ?? ''}
      theirs
      status={now === undefined ? 'completed' : 'in_progress'}
      fold={
        entry.steps.length === 0
          ? undefined
          : {
              label: filled(strings.planSteps, String(entry.steps.length)),
              lines: entry.steps.map((step, index) => (
                <p className="tool-body" data-status={step.status} key={index}>
                  <StateWord tone={TONE_OF[step.status]}>
                    {strings.toolStatus[step.status]}
                  </StateWord>{' '}
                  <span data-verbatim>{step.text}</span>
                </p>
              )),
            }
      }
      hook={{ plan: '' }}
      strings={strings}
    />
  );
}

/**
 * The look each answer takes, read off the
 * protocol's own `kind` — never off the option id,
 * which is a string the agent invented.
 *
 * Allowing once is the answer the question expects,
 * so it takes the ink. Both answers that outlive
 * the turn take the outline, whether they allow or
 * refuse: a promise that lasts has to look
 * different from one that does not, and the agent's
 * own labels tell the two lasting ones apart.
 * Refusing once asks for nothing, so it is quiet.
 */
const LOOK_OF = {
  allow_once: { variant: 'primary' },
  allow_always: { variant: 'secondary', ink: 'brand' },
  reject_once: { variant: 'quiet' },
  reject_always: { variant: 'secondary', ink: 'brand' },
} as const satisfies Record<
  PermissionOptionKind,
  Pick<ButtonProps, 'variant' | 'ink'>
>;

/**
 * The one moment the panel asks for something.
 *
 * Pinned under the log rather than written into
 * it, because the agent is waiting on the answer:
 * the question stays by the composer however far
 * the log has scrolled. It says what it is in a
 * label and names the call in the machine face, and
 * the agent's own wording is kept on every option —
 * it wrote the label from what it is about to do,
 * and a rewrite here would describe something else.
 */
function PermissionRow({
  prompt,
  strings,
}: {
  prompt: PermissionPrompt;
  strings: SidebarStrings;
}) {
  return (
    <div className="permission" data-block="permission">
      <div className="permission-head">
        <SectionLabel>{strings.permission}</SectionLabel>
        <span className="permission-tool mono">{prompt.title}</span>
      </div>

      <div className="permission-options">
        {prompt.options.map((option) => (
          <Button
            key={option.optionId}
            {...LOOK_OF[option.kind]}
            hook={{
              option: option.optionId,
              kind: option.kind,
              always: String(isAlways(option.kind)),
            }}
            onClick={() =>
              postToHost({
                type: 'permission',
                optionId: option.optionId,
                kind: option.kind,
              })
            }
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Why there is nothing to talk to, when there is
 *  nothing to talk to: the state, and what to do
 *  about it where the panel has something to say. */
function blockedBy(
  state: SidebarInit,
): { title: string; detail?: string } | undefined {
  const { strings } = state;

  if (state.status === 'untrusted') {
    return { title: strings.notTrustedTitle, detail: strings.notTrusted };
  }

  if (state.status === 'no-project') {
    return { title: strings.noFolderTitle, detail: strings.noProject };
  }

  if (state.status === 'no-agent') return { title: strings.noAgent };

  return undefined;
}

function isAlways(kind: PermissionOptionKind): boolean {
  return kind === 'allow_always' || kind === 'reject_always';
}

mountView('sidebar', Panel);
