import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import type { DiffLine } from '../acp/diff.js';
import type {
  DiagnosticEntry,
  FileEditEntry,
  PermissionPrompt,
  PlanEntry,
  ToolEntry,
  TranscriptEntry,
} from '../acp/transcript.js';
import type { PermissionOptionKind, ToolKind } from '../acp/connection.js';
import { postToHost } from '../webview/client.js';
import { mountView } from '../webview/mount.js';
import type {
  SidebarInit,
  SidebarPreview,
  SidebarStrings,
} from '../webview/protocol.js';

import './sidebar.css';

/**
 * The agent panel.
 *
 * A conversation drawn as a work log rather than
 * as a chat: what the agent said is prose, and
 * what it did is a card with a status rail down
 * its left edge and one row per file it touched.
 * That is the difference this product is about —
 * an agent proposes, mBoss validates, a person
 * approves — and a stream of speech bubbles would
 * hide the half that matters.
 *
 * The panel holds nothing. It is handed the whole
 * picture every time anything moves, because the
 * view is disposed whenever it is hidden and the
 * extension is what remembers.
 */

/** One typographic mark per kind of work, in place
 *  of an icon set the extension would have to
 *  ship. */
const MARKS: Record<ToolKind, string> = {
  read: '▤',
  edit: '✎',
  delete: '⌫',
  move: '⇄',
  search: '⌕',
  execute: '❯',
  think: '◇',
  fetch: '↓',
  switch_mode: '⇅',
  other: '•',
};

const STEP_MARKS = { pending: '○', in_progress: '◐', completed: '●' };

/**
 * Fills a template's `{n}` placeholders with the
 * values given — the way the host's own l10n does,
 * one step later.
 *
 * A webview resolves no string of its own, but some
 * of what a count names here (how many files a turn
 * touched, how many lines a tool call printed) is
 * only known once the transcript is on screen — so
 * the words travel resolved from the host and the
 * number is filled in where it is counted.
 */
function withCount(template: string, ...values: number[]): string {
  return values.reduce<string>(
    (text, value, index) => text.replace(`{${index}}`, String(value)),
    template,
  );
}

/** One row of the transcript, or the summary that
 *  closes out a run of file edits. */
type Row =
  | { kind: 'entry'; entry: TranscriptEntry }
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
function transcriptRows(entries: readonly TranscriptEntry[]): Row[] {
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

  for (const entry of entries) {
    rows.push({ kind: 'entry', entry });

    if (entry.at === 'file') {
      group.push(entry);
    } else {
      closeGroup();
    }
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

  // The log follows what arrived last. An agent
  // writes for minutes at a time, and a panel that
  // held its position would put every one of those
  // minutes above the fold — the reader would be
  // scrolling to keep up with a stream they are
  // watching happen.
  useEffect(() => {
    const element = log.current;

    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [state.transcript]);

  return (
    <div className="agent">
      <header className="agent-head">
        <p className="eyebrow">{strings.heading}</p>
        <button
          type="button"
          className="agent-name"
          data-choose-agent
          onClick={() => postToHost({ type: 'chooseAgent' })}
        >
          {state.agent ?? strings.chooseAgent}
        </button>
      </header>

      {blocked === undefined ? null : <p className="state">{blocked}</p>}

      {state.failure === undefined ? null : (
        <div className="failure">
          <p className="eyebrow">{state.failure.headline}</p>
          <p className="failure-detail">{state.failure.detail}</p>
        </div>
      )}

      <ol className="transcript" ref={log}>
        {rows.map((row) =>
          row.kind === 'entry' ? (
            <li key={row.entry.id} data-entry={row.entry.id}>
              <Entry entry={row.entry} strings={strings} />
            </li>
          ) : (
            <li key={row.key} className="files-batch" data-files-batch>
              <span className="files-batch-count">
                {withCount(strings.filesChanged, row.total)}
              </span>
              <span className="files-batch-actions">
                <button
                  type="button"
                  data-keep-all
                  onClick={() => keepAll(row.ids)}
                >
                  {strings.keepAllEdits}
                </button>
                <button
                  type="button"
                  data-undo-all
                  onClick={() => undoAll(row.ids)}
                >
                  {strings.undoAllEdits}
                </button>
              </span>
            </li>
          ),
        )}
      </ol>

      {state.prompt === undefined ? null : (
        <Permission prompt={state.prompt} strings={strings} />
      )}

      {state.preview === undefined ? null : (
        <Proposal
          preview={state.preview}
          strings={strings}
          onRefine={() => composer.current?.focus()}
        />
      )}

      {blocked === undefined ? (
        <Composer
          strings={strings}
          busy={status === 'streaming'}
          field={composer}
        />
      ) : null}
    </div>
  );
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
 * A proposal the graph has moved past is a
 * different card rather than the same one with a
 * disabled button, because what a person can do
 * about it is different: not "that again", but ask
 * for it again.
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
    <div className="preview-card" data-preview-card data-at={preview.at}>
      <p className="eyebrow">{preview.workflow}</p>

      {preview.at === 'stale' ? (
        <p className="preview-warning">{preview.warning}</p>
      ) : (
        <p className="preview-summary mono">{preview.summary}</p>
      )}

      <div className="preview-actions">
        {preview.at === 'proposed' ? (
          <button
            type="button"
            className="primary"
            data-approve
            onClick={() =>
              postToHost({ type: 'approve', proposalId: preview.id })
            }
          >
            {strings.approve}
          </button>
        ) : null}

        {preview.at === 'applied' ? (
          <button
            type="button"
            data-undo
            disabled={!preview.undoable}
            onClick={() => postToHost({ type: 'undo' })}
          >
            {strings.undo}
          </button>
        ) : (
          <button type="button" data-refine onClick={onRefine}>
            {strings.refine}
          </button>
        )}
      </div>
    </div>
  );
}

function Entry({
  entry,
  strings,
}: {
  entry: TranscriptEntry;
  strings: SidebarStrings;
}) {
  if (entry.at === 'message') {
    return (
      <p className="said" data-from={entry.from}>
        {entry.text}
      </p>
    );
  }

  if (entry.at === 'tool') return <Tool entry={entry} strings={strings} />;

  if (entry.at === 'file') return <FileEdit entry={entry} strings={strings} />;

  if (entry.at === 'diagnostic') return <Diagnostic entry={entry} />;

  return <Plan entry={entry} strings={strings} />;
}

/**
 * One unit of work: what was done, and to what —
 * one line, with a rail down the left edge saying
 * who did it.
 *
 * A call's printed output stays folded: the
 * interesting part of a finished call is usually
 * whatever it printed, and the interesting part of
 * a running one is that it is running, so neither
 * needs the text on screen by default.
 */
function Tool({
  entry,
  strings,
}: {
  entry: ToolEntry;
  strings: SidebarStrings;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="tool"
      data-tool-call={entry.id}
      data-kind={entry.kind}
      data-status={entry.status}
      data-by={entry.by}
    >
      <p className="tool-row">
        <span className="tool-mark" aria-hidden="true">
          {MARKS[entry.kind]}
        </span>
        <span className="tool-verb">{entry.verb}</span>
        <span className="tool-target mono">{entry.target}</span>
        {entry.detail === undefined ? null : (
          <span className="tool-detail">{entry.detail}</span>
        )}

        {/* The status words are the protocol's four.
            A row the extension wrote itself did the
            thing rather than asked for it: its rail
            and verb already say what happened, so it
            gets none of these. */}
        {entry.status === 'applied' ? null : (
          <span className="tool-status">
            {strings.toolStatus[entry.status]}
          </span>
        )}
      </p>

      {entry.body.length === 0 ? null : (
        <button
          type="button"
          className="tool-body-toggle"
          data-expanded={expanded}
          onClick={() => setExpanded((was) => !was)}
        >
          {withCount(strings.showLines, entry.body.length)}
        </button>
      )}

      {expanded
        ? entry.body.map((line, index) => (
            <p className="tool-body mono" key={index}>
              {line}
            </p>
          ))
        : null}
    </div>
  );
}

/**
 * One file, as the agent left it — a header with the
 * counts, the diff itself, and Keep / Undo while
 * nothing has been decided about it yet.
 *
 * Its own row rather than a line inside the call
 * that wrote it: a file is what a person keeps or
 * undoes, so it is the thing that carries a
 * decision.
 */
function FileEdit({
  entry,
  strings,
}: {
  entry: FileEditEntry;
  strings: SidebarStrings;
}) {
  // Nothing was kept past the byte cap, so there is
  // nothing left to compare against or write back.
  const canUndo = entry.newText !== undefined;

  return (
    <div
      className="file"
      data-file={entry.path}
      data-by={entry.by}
      data-decision={entry.decision}
    >
      <p className="file-head">
        {/* Isolated, because the line it sits on is
            laid out right to left so that a long
            path loses its head rather than its
            filename. The leading slash has no
            direction of its own, and at the edge of
            a right-to-left run it is reordered to
            the far end — the file then reads as a
            directory. The isolate gives the path its
            own run to be ordered inside, and leaves
            the line's own direction, and so the end
            it truncates from, alone. */}
        <span className="mono path">{`\u2066${entry.path}\u2069`}</span>
        <span className="stat">
          {entry.isNew ? <span className="new">{strings.newFile}</span> : null}
          <span className="added">+{entry.added}</span>
          {entry.removed > 0 ? (
            <span className="removed">−{entry.removed}</span>
          ) : null}
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
        <div className="file-actions">
          <button
            type="button"
            data-keep
            onClick={() => postToHost({ type: 'keepFile', id: entry.id })}
          >
            {strings.keepEdit}
          </button>
          {canUndo ? (
            <button
              type="button"
              data-undo-file
              onClick={() => postToHost({ type: 'undoFile', id: entry.id })}
            >
              {strings.undoEdit}
            </button>
          ) : null}
        </div>
      ) : null}

      {entry.decision === 'changed-since' ? (
        <p className="file-note">{strings.changedSince}</p>
      ) : null}
    </div>
  );
}

/** One line of a diff, or the stand-in for a run of
 *  lines nobody touched. */
function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.kind === 'skip') {
    return (
      <p className="diff-line" data-kind="skip">
        ⋯ {line.text}
      </p>
    );
  }

  return (
    <p className="diff-line" data-kind={line.kind}>
      <span className="gutter">{line.oldNo ?? ''}</span>
      <span className="gutter">{line.newNo ?? ''}</span>
      <span className="sign" aria-hidden="true">
        {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}
      </span>
      <span className="mono text">{line.text}</span>
    </p>
  );
}

/**
 * Something that went wrong, in the words of
 * whatever found it.
 *
 * Every line here was written by the extension in
 * the host, where the strings are resolved — the
 * panel adds no wording of its own.
 */
function Diagnostic({ entry }: { entry: DiagnosticEntry }) {
  const fix = entry.fix;

  return (
    <div className="diagnostic" data-source={entry.source}>
      <p className="eyebrow">{entry.source}</p>

      {entry.rows.map((row, index) => (
        <p className="diagnostic-row" key={index}>
          {row.code === undefined ? null : (
            <span className="mono">{row.code}</span>
          )}
          {row.at === undefined ? null : <span className="mono">{row.at}</span>}
          <span>{row.message}</span>
        </p>
      ))}

      {/* The one thing to do about it, which is to
          hand it back: the prompt was written
          beside the rows by whoever noted them. */}
      {fix === undefined ? null : (
        <button
          type="button"
          className="diagnostic-fix"
          data-fix
          onClick={() => postToHost({ type: 'prompt', text: fix.prompt })}
        >
          {fix.label}
        </button>
      )}
    </div>
  );
}

/** A checklist, collapsed to one row until somebody
 *  asks to see it. */
function Plan({
  entry,
  strings,
}: {
  entry: PlanEntry;
  strings: SidebarStrings;
}) {
  const [open, setOpen] = useState(false);
  const done = entry.steps.filter((step) => step.status === 'completed').length;

  return (
    <div className="plan">
      <button
        type="button"
        className="plan-toggle"
        data-open={open}
        onClick={() => setOpen((was) => !was)}
      >
        {withCount(strings.planProgress, done, entry.steps.length)}
      </button>

      {open ? (
        <div className="plan-steps">
          {entry.steps.map((step, index) => (
            <p className="step" data-status={step.status} key={index}>
              <span className="step-mark" aria-hidden="true">
                {STEP_MARKS[step.status]}
              </span>
              {step.text}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The one moment the panel asks for something.
 *
 * Options that outlive the turn are marked, and
 * the mark is read off the protocol's own `kind` —
 * never off the option id, which is a string the
 * agent invented.
 */
function Permission({
  prompt,
  strings,
}: {
  prompt: PermissionPrompt;
  strings: SidebarStrings;
}) {
  return (
    <div className="permission">
      <p className="eyebrow">{strings.permission}</p>
      <p className="permission-title">{prompt.title}</p>
      <div className="permission-options">
        {prompt.options.map((option) => (
          <button
            type="button"
            key={option.optionId}
            data-option={option.optionId}
            data-kind={option.kind}
            data-always={String(isAlways(option.kind))}
            onClick={() =>
              postToHost({
                type: 'permission',
                optionId: option.optionId,
                kind: option.kind,
              })
            }
          >
            <span>{option.label}</span>
            {isAlways(option.kind) ? (
              <span className="always">{strings.always}</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({
  strings,
  busy,
  field,
}: {
  strings: SidebarStrings;
  busy: boolean;
  field: RefObject<HTMLTextAreaElement | null>;
}) {
  const [text, setText] = useState('');

  const send = (event: FormEvent): void => {
    event.preventDefault();

    if (busy || text.trim() === '') return;

    postToHost({ type: 'prompt', text });
    setText('');
  };

  // Enter sends and Shift+Enter breaks the line,
  // which is what every other composer on the
  // platform does.
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey) return;

    event.preventDefault();
    send(event);
  };

  return (
    <form className="composer" onSubmit={send}>
      <textarea
        ref={field}
        rows={2}
        value={text}
        placeholder={strings.placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKey}
      />
      {busy ? (
        <button
          type="button"
          data-stop
          onClick={() => postToHost({ type: 'cancel' })}
        >
          {strings.stop}
        </button>
      ) : (
        <button type="submit">{strings.send}</button>
      )}
    </form>
  );
}

/** Why there is nothing to talk to, when there is
 *  nothing to talk to. */
function blockedBy(state: SidebarInit): string | undefined {
  if (state.status === 'untrusted') return state.strings.notTrusted;
  if (state.status === 'no-project') return state.strings.noProject;
  if (state.status === 'no-agent') return state.strings.noAgent;

  return undefined;
}

function isAlways(kind: PermissionOptionKind): boolean {
  return kind === 'allow_always' || kind === 'reject_always';
}

mountView('sidebar', Panel);
