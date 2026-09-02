import {
  StrictMode,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { createRoot } from 'react-dom/client';

import type {
  PermissionPrompt,
  PlanEntry,
  ToolEntry,
  TranscriptEntry,
} from '../acp/transcript.js';
import type { PermissionOptionKind, ToolKind } from '../acp/connection.js';
import { announceReady, onHostMessage, postToHost } from '../webview/client.js';
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

function Panel(state: SidebarInit) {
  const { strings, status } = state;
  const blocked = blockedBy(state);
  const composer = useRef<HTMLTextAreaElement>(null);

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

      <ol className="transcript">
        {state.transcript.map((entry) => (
          <li key={entry.id} data-entry={entry.id}>
            <Entry entry={entry} strings={strings} />
          </li>
        ))}
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

  return <Plan entry={entry} strings={strings} />;
}

/**
 * One unit of work.
 *
 * Open by default and foldable, because the
 * interesting part of a finished call is usually
 * the one line saying which files it touched, and
 * the interesting part of a running one is that it
 * is running.
 */
function Tool({
  entry,
  strings,
}: {
  entry: ToolEntry;
  strings: SidebarStrings;
}) {
  return (
    <details
      className="tool"
      data-tool-call={entry.id}
      data-kind={entry.kind}
      data-status={entry.status}
      open
    >
      <summary>
        <span className="tool-mark" aria-hidden="true">
          {MARKS[entry.kind]}
        </span>
        <span className="tool-title">{entry.title}</span>
        <span className="tool-status">{strings.toolStatus[entry.status]}</span>
      </summary>

      {entry.files.map((file) => (
        <p className="file-row" key={file.path}>
          <span className="mono path">{file.path}</span>
          <span className="stat">
            {file.isNew ? <span className="new">{strings.newFile}</span> : null}
            <span className="added">+{file.added}</span>
            {file.removed > 0 ? (
              <span className="removed">−{file.removed}</span>
            ) : null}
          </span>
        </p>
      ))}

      {entry.body.map((line, index) => (
        <p className="tool-body mono" key={index}>
          {line}
        </p>
      ))}
    </details>
  );
}

function Plan({
  entry,
  strings,
}: {
  entry: PlanEntry;
  strings: SidebarStrings;
}) {
  return (
    <div className="plan">
      <p className="eyebrow">{strings.plan}</p>
      {entry.steps.map((step, index) => (
        <p className="step" data-status={step.status} key={index}>
          <span className="step-mark" aria-hidden="true">
            {STEP_MARKS[step.status]}
          </span>
          {step.text}
        </p>
      ))}
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

const root = createRoot(document.getElementById('root') as HTMLElement);

onHostMessage('sidebar', (message) => {
  root.render(
    <StrictMode>
      <Panel {...message} />
    </StrictMode>,
  );
});

announceReady();
