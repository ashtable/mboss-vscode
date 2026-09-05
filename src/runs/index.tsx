import { useState } from 'react';

import { postToHost } from '../webview/client.js';
import { mountView } from '../webview/mount.js';
import type {
  RunRow,
  RunsInit,
  RunsStrings,
  SessionRow,
  StackZone,
  TestRunZone,
} from '../webview/protocol.js';
import { RUN_FILTERS, type RunFilter } from './queries.js';
import type { LiveRun, StepState } from './watch.js';

import './runs.css';

/**
 * The Runs panel: bring a project's own stack up,
 * fire a workflow at it by hand, watch the run that
 * is going, and see what this window has set going —
 * all above the ledger it has always drawn.
 *
 * Four zones and a list, in the order a person needs
 * them: the stack has to be up before anything can
 * run, a run has to be started before one is live,
 * and both are worth more than the history the moment
 * either is true. It holds nothing beyond one
 * unsent input box — everything else is the extension's,
 * pushed in on every change the way the list always
 * was.
 */

/** One glyph per outcome, in place of an icon set
 *  the extension would have to ship. */
const MARKS: Record<RunRow['severity'], string> = {
  ok: '✓',
  running: '◐',
  failed: '✕',
  exhausted: '⊘',
};

/** One glyph per step, read off the ledger. There is
 *  no `running` mark: a step lands in
 *  `dbos.operation_outputs` only once it is done. */
const STEP_MARKS: Record<StepState, string> = {
  done: '✓',
  failed: '✕',
  waiting: '◐',
};

/** One glyph per session outcome, apart from the
 *  step marks above: this is a whole run, and
 *  `quiet` is a state no step ever carries. */
const SESSION_MARKS: Record<SessionRow['outcome'], string> = {
  running: '◐',
  done: '✓',
  failed: '✕',
  waiting: '◑',
  quiet: '○',
};

/** The compose service the app runs in, as the
 *  scaffold's own compose file names it. Rebuild
 *  belongs beside this row and no other. */
const APP_SERVICE = 'app';

function Runs(state: RunsInit) {
  const { strings } = state;
  const showControls =
    state.state !== 'untrusted' && state.state !== 'no-project';

  return (
    <div className="runs">
      <header className="runs-head">
        <p className="eyebrow">{strings.heading}</p>
        {state.project === undefined ? null : (
          <p className="runs-project mono">{state.project}</p>
        )}
      </header>

      {showControls ? (
        <>
          <Stack stack={state.stack} strings={strings} />
          <TestRun testRun={state.testRun} strings={strings} />
          {state.live === undefined ? null : (
            <RunningNow live={state.live} strings={strings} />
          )}
          {state.session.length === 0 ? null : (
            <Session session={state.session} strings={strings} />
          )}
        </>
      ) : null}

      <Filters state={state} />

      {state.state === 'ok' ? (
        <List state={state} />
      ) : (
        <p className="state">{blockedBy(state, strings)}</p>
      )}

      <footer className="runs-foot">
        {state.source === undefined ? null : (
          <p className="mono">{state.source}</p>
        )}
        <p>{strings.scope}</p>
        <p>{strings.sessionScope}</p>
      </footer>
    </div>
  );
}

/**
 * The project's own containers: one row per
 * service, Start or Stop for the whole stack, and
 * Rebuild beside the `app` row alone — it is the one
 * service a workflow addition or rename can leave
 * stale.
 */
function Stack({ stack, strings }: { stack: StackZone; strings: RunsStrings }) {
  const up = stack.services.some((service) => service.state === 'running');

  return (
    <section className="zone" data-zone="stack">
      <div className="zone-head">
        <p className="eyebrow">{strings.localStack}</p>

        {stack.available ? (
          <button
            type="button"
            data-stack-toggle
            data-busy={stack.busy !== undefined}
            disabled={stack.busy !== undefined}
            onClick={() => postToHost({ type: up ? 'stackDown' : 'stackUp' })}
          >
            {up ? strings.stackDown : strings.stackUp}
          </button>
        ) : null}
      </div>

      {!stack.available ? (
        <p className="zone-note">{stack.detail}</p>
      ) : (
        <ul className="services">
          {stack.services.map((service) => (
            <li
              className="service"
              data-service={service.service}
              data-state={service.state}
              key={service.service}
            >
              <span
                className="service-dot"
                data-state={service.state}
                aria-hidden="true"
              />
              <span className="mono service-name">{service.service}</span>
              <span className="service-state">
                {strings.serviceState[service.state]}
              </span>
              <span className="service-detail">{service.detail}</span>
              {service.service === APP_SERVICE ? (
                <button
                  type="button"
                  data-rebuild
                  disabled={stack.busy !== undefined}
                  onClick={() => postToHost({ type: 'stackRebuild' })}
                >
                  {strings.rebuildApp}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Starting one run by hand: which saved workflow,
 * whatever it takes as input, then the request that
 * goes nowhere but the machine it runs on.
 *
 * The workflow picker round-trips through the
 * extension on every change — `selectWorkflow` — so
 * the hint beside the box and any problem left over
 * from the last attempt are always about the one now
 * showing, rather than being worked out twice. The
 * input box is the one thing this view holds itself:
 * the extension only learns what is in it when a run
 * is actually sent.
 */
function TestRun({
  testRun,
  strings,
}: {
  testRun: TestRunZone;
  strings: RunsStrings;
}) {
  const [text, setText] = useState(testRun.input);

  const picked = testRun.workflows.find(
    (flow) => flow.name === testRun.selected,
  );
  const scheduled = picked?.mode === 'schedule';

  const run = (): void => {
    if (testRun.selected === undefined) return;

    postToHost({
      type: 'runWorkflow',
      workflow: testRun.selected,
      input: text,
    });
  };

  return (
    <section className="zone" data-zone="test-run">
      <p className="eyebrow">{strings.testRun}</p>

      <label className="field">
        <span className="field-label">{strings.workflow}</span>
        <select
          data-workflow-picker
          value={testRun.selected ?? ''}
          onChange={(event) =>
            postToHost({
              type: 'selectWorkflow',
              workflow: event.target.value,
            })
          }
        >
          {testRun.workflows.map((flow) => (
            <option key={flow.name} value={flow.name}>
              {flow.title}
            </option>
          ))}
        </select>
      </label>

      {scheduled ? (
        <p className="zone-note">{strings.scheduledNotRunnable}</p>
      ) : (
        <>
          <label className="field">
            <span className="field-label">{strings.input}</span>
            <textarea
              className="mono"
              data-input
              rows={3}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>

          {testRun.hint === undefined ? null : (
            <p className="zone-note">{testRun.hint}</p>
          )}

          {testRun.problem === undefined ? null : (
            <p className="zone-problem" data-problem>
              <span>{testRun.problem.detail}</span>
              {testRun.problem.rebuildToRun ? (
                <button
                  type="button"
                  data-rebuild
                  onClick={() => postToHost({ type: 'stackRebuild' })}
                >
                  {strings.rebuildApp}
                </button>
              ) : null}
            </p>
          )}

          <div className="zone-actions">
            <button type="button" data-run-workflow onClick={run}>
              {strings.runWorkflow}
            </button>
          </div>

          <p className="zone-caption mono">{strings.runCaption}</p>
        </>
      )}
    </section>
  );
}

/**
 * The run being followed: its steps, marked with
 * what the ledger says about each, and the two
 * sentences a stopped watch leaves behind kept
 * apart — a parked run is waiting on a person, a
 * quiet one is waiting on nobody.
 */
function RunningNow({
  live,
  strings,
}: {
  live: LiveRun;
  strings: RunsStrings;
}) {
  return (
    <section className="zone" data-zone="running-now">
      <p className="eyebrow">{strings.runningNow}</p>

      <p className="run-line" data-outcome={live.outcome}>
        <span className="mono run-id">{live.workflowId}</span>
        <span className="mono run-name">{live.workflow}</span>
      </p>

      {live.outcome === 'waiting' || live.outcome === 'quiet' ? (
        <p className="zone-note">
          {live.outcome === 'waiting'
            ? strings.waitingRefresh
            : strings.quietRefresh}
        </p>
      ) : null}

      {live.error === undefined ? null : (
        <p className="run-error mono">{live.error}</p>
      )}

      <ol className="live-steps">
        {live.steps.map((step) => (
          <li className="live-step" data-state={step.state} key={step.name}>
            <span className="step-mark" aria-hidden="true">
              {STEP_MARKS[step.state]}
            </span>
            <span className="mono">{step.name}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * What this window has set going, newest first: a
 * rail saying how each one went, and the action that
 * fits it — sending an event again reads differently
 * from rerunning a manual workflow, because only one
 * of them is honestly the same run.
 */
function Session({
  session,
  strings,
}: {
  session: SessionRow[];
  strings: RunsStrings;
}) {
  return (
    <section className="zone" data-zone="session">
      <p className="eyebrow">{strings.thisSession}</p>

      <ol className="session-rows">
        {session.map((row) => (
          <li
            className="session-row"
            data-session-row={row.workflowId}
            data-outcome={row.outcome}
            key={row.workflowId}
          >
            <span className="session-mark" aria-hidden="true">
              {SESSION_MARKS[row.outcome]}
            </span>
            <span className="mono session-name">{row.workflow}</span>
            <span className="session-when">{row.when}</span>
            {row.error === undefined ? null : (
              <span className="session-error mono">{row.error}</span>
            )}

            <span className="session-actions">
              <button
                type="button"
                data-open-run
                onClick={() =>
                  postToHost({ type: 'openRun', workflowId: row.workflowId })
                }
              >
                {strings.openFlightRecorder}
              </button>
              <button
                type="button"
                data-rerun
                onClick={() =>
                  postToHost({ type: 'rerun', workflowId: row.workflowId })
                }
              >
                {row.keyed ? strings.resendEvent : strings.rerunSameInput}
              </button>
              {row.error === undefined ? null : (
                <button
                  type="button"
                  data-ask-agent
                  onClick={() =>
                    postToHost({ type: 'askAgent', workflowId: row.workflowId })
                  }
                >
                  {strings.askAgentWhy}
                </button>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
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

/**
 * The ledger, minus whatever the session section
 * already drew: a run started this window and
 * already written to the database is a session row
 * and nothing else, or it would be on screen twice.
 */
function List({ state }: { state: RunsInit }) {
  const inSession = new Set(state.session.map((row) => row.workflowId));
  const rows = state.rows.filter((row) => !inSession.has(row.workflowId));

  if (rows.length === 0) {
    return <p className="state">{state.strings.empty}</p>;
  }

  return (
    <ol className="run-rows">
      {rows.map((row) => (
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

mountView('runs', Runs);
