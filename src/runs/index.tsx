import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { announceReady, onHostMessage, postToHost } from '../webview/client.js';
import type { RunRow, RunsInit, RunsStrings } from '../webview/protocol.js';
import { RUN_FILTERS, type RunFilter } from './queries.js';

import './runs.css';

/**
 * The run list.
 *
 * A ledger, drawn as one: a monospace id, a mark
 * that says how it went, and one line of when and
 * how long. A failure says what it was on the row
 * rather than behind a click, because the reason a
 * person opens this panel is to find out.
 *
 * It holds nothing. The filter, the rows and the
 * counts all arrive from the extension, which is
 * what remembers them while this view is disposed
 * and rebuilt.
 */

/** One glyph per outcome, in place of an icon set
 *  the extension would have to ship. */
const MARKS: Record<RunRow['severity'], string> = {
  ok: '✓',
  running: '◐',
  failed: '✕',
  exhausted: '⊘',
};

function Runs(state: RunsInit) {
  const { strings } = state;

  return (
    <div className="runs">
      <header className="runs-head">
        <p className="eyebrow">{strings.heading}</p>
        {state.project === undefined ? null : (
          <p className="runs-project mono">{state.project}</p>
        )}
      </header>

      <Filters state={state} />

      {state.state === 'ok' ? (
        <List state={state} />
      ) : (
        <p className="state">{blockedBy(state, strings)}</p>
      )}

      <footer className="runs-foot">
        {strings.source === undefined ? null : (
          <p className="mono">{strings.source}</p>
        )}
        <p>{strings.scope}</p>
      </footer>
    </div>
  );
}

/**
 * The three the design names, with what each one
 * would show beside it.
 *
 * A run can be in two of them at once — recovering
 * is something that happened during a run, not a
 * way one ended — so the counts do not add up to
 * the first, and are not meant to.
 */
function Filters({ state }: { state: RunsInit }) {
  return (
    <div className="filters" role="group">
      {RUN_FILTERS.map((filter: RunFilter) => (
        <button
          type="button"
          key={filter}
          data-filter={filter}
          aria-pressed={state.filter === filter}
          onClick={() => postToHost({ type: 'runFilter', filter })}
        >
          <span>{state.strings.filters[filter]}</span>
          <span className="count">{state.counts[filter]}</span>
        </button>
      ))}
    </div>
  );
}

function List({ state }: { state: RunsInit }) {
  if (state.rows.length === 0) {
    return <p className="state">{state.strings.empty}</p>;
  }

  return (
    <ol className="run-rows">
      {state.rows.map((row) => (
        <li key={row.workflowId}>
          <Row
            row={row}
            strings={state.strings}
            selected={row.workflowId === state.selected}
          />
        </li>
      ))}
    </ol>
  );
}

function Row({
  row,
  strings,
  selected,
}: {
  row: RunRow;
  strings: RunsStrings;
  selected: boolean;
}) {
  return (
    <button
      type="button"
      className="run-row"
      data-run={row.workflowId}
      data-severity={row.severity}
      data-recovered={String(row.recovered)}
      aria-current={selected}
      onClick={() =>
        postToHost({ type: 'runSelect', workflowId: row.workflowId })
      }
    >
      <span className="run-line">
        <span className="mono run-id">{row.workflowId}</span>
        <span className="run-mark" aria-hidden="true">
          {MARKS[row.severity]}
        </span>
      </span>

      <span className="run-line">
        <span className="mono run-name">{row.name}</span>
        {row.recovered ? (
          <span className="run-tag">{strings.recoveredTag}</span>
        ) : null}
      </span>

      <span className="run-when">
        {row.when}
        {row.recoveredNote === undefined ? null : ` · ${row.recoveredNote}`}
      </span>

      {row.error === undefined ? null : (
        <span className="run-error">{row.error}</span>
      )}
    </button>
  );
}

/** Why the list is empty, when it is not a list at
 *  all. */
function blockedBy(state: RunsInit, strings: RunsStrings): string {
  if (state.state === 'untrusted') return strings.untrusted;
  if (state.state === 'no-project') return strings.noProject;

  return state.detail ?? strings.empty;
}

const root = createRoot(window.document.getElementById('root') as HTMLElement);

onHostMessage('runs', (message) => {
  root.render(
    <StrictMode>
      <Runs {...message} />
    </StrictMode>,
  );
});

announceReady();
