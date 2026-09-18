import { useState } from 'react';

import { postToHost } from '../webview/client.js';
import { filled } from '../webview/fill.js';
import { mountView } from '../webview/mount.js';
import { settled } from '../webview/states.js';
import type {
  RunsInit,
  RunsStrings,
  SessionRow,
  StackZone,
  RunByHand,
} from '../webview/protocol.js';
import { EmptyState } from '../webview/signal/EmptyState.js';
import { FieldHint } from '../webview/signal/FieldHint.js';
import { TabPanel, Tabs } from '../webview/signal/Tabs.js';

import { RUN_FILTERS, type RunFilter } from './queries.js';
import type { StepState } from './reading.js';
import { RunHistoryItem } from './RunHistoryItem.js';
import { APP_SERVICE, runsState, type StateRow } from './state.js';
import type { LiveRun } from './watch.js';

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
 * either is true. It holds nothing but what the
 * input box is showing, and even that is the
 * extension's too: everything is pushed in on every
 * change the way the list always was.
 */

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
  running: '●',
  recovering: '↻',
  done: '✓',
  failed: '✕',
  gaveUp: '⊘',
  waiting: '◐',
  queued: '○',
  quiet: '○',
  // The same mark the ledger's own rows carry, so a
  // run somebody stopped reads the same in both
  // lists.
  cancelled: '■',
};

function Runs(state: RunsInit) {
  const { strings } = state;
  const showControls =
    state.state !== 'untrusted' && state.state !== 'no-project';

  const header = (
    <header className="runs-head">
      <p className="eyebrow">{strings.heading}</p>
      {state.project === undefined ? null : (
        <p className="runs-project mono">{state.project}</p>
      )}
    </header>
  );

  // Nothing has been read yet, and anything drawn
  // below the header would be replaced a moment
  // later.
  if (state.state === 'loading') {
    return <div className="runs">{header}</div>;
  }

  return (
    <div className="runs">
      {header}

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

      <RunList state={state} />

      <footer className="runs-foot">
        <p>{strings.projection}</p>
        {state.source === undefined ? null : (
          <p className="mono">{state.source}</p>
        )}
        <p>{strings.scope}</p>
        <p>{strings.sessionScope}</p>
        {state.production.configured ? (
          <div className="state-block" data-production="configured">
            <span>{strings.conductorConfigured}</span>
            <button
              type="button"
              data-open-production
              onClick={() => postToHost({ type: 'openProduction' })}
            >
              {strings.openProduction}
            </button>
          </div>
        ) : null}
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
 * showing, rather than being worked out twice.
 *
 * The input box says every change too — `runInput`
 * — because it is the one place a run's input is
 * typed, and a trigger's card and the palette start
 * runs with it as well. So Run names only the
 * workflow. The box keeps its own copy of the text
 * while somebody types, since the extension does not
 * draw the view again for a keystroke, and starts
 * from the extension's copy whenever the view is
 * drawn anew.
 */
function TestRun({
  testRun,
  strings,
}: {
  testRun: RunByHand;
  strings: RunsStrings;
}) {
  const [text, setText] = useState(testRun.input);

  const picked = testRun.workflows.find(
    (flow) => flow.name === testRun.selected,
  );
  const scheduled = picked?.mode === 'schedule';

  const run = (): void => {
    if (testRun.selected === undefined) return;

    postToHost({ type: 'runWorkflow', workflow: testRun.selected });
  };

  const typed = (next: string): void => {
    setText(next);
    postToHost({ type: 'runInput', workflow: testRun.selected, text: next });
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
              onChange={(event) => typed(event.target.value)}
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

      <div className="zone-actions">
        {/* Anything not over can still be stopped —
            a quiet run included, which the watch let
            go of while DBOS still has it going. */}
        {!settled(live.outcome) ? (
          <button
            type="button"
            data-cancel-run
            onClick={() =>
              postToHost({ type: 'cancelRun', workflowId: live.workflowId })
            }
          >
            {strings.cancelRun}
          </button>
        ) : null}

        {live.outcome === 'cancelled' ? (
          <button
            type="button"
            data-resume-run
            onClick={() =>
              postToHost({ type: 'resumeRun', workflowId: live.workflowId })
            }
          >
            {strings.resumeRun}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * What this window has set going, newest first: a
 * rail saying how each one went, and the action that
 * fits it — sending an event again reads differently
 * from rerunning a manual workflow, because only one
 * of them is honestly the same run.
 *
 * A row this window forked or picked back up gets
 * neither. Both actions send the input the row was
 * started with, and that run's input belongs to the
 * run it came from.
 *
 * A cancelled row gets a third thing instead: its
 * whole recorded history is sitting in the ledger,
 * so carrying on from there is what somebody means
 * rather than a second run from the top. And no Ask
 * agent — nobody has to look into a run somebody
 * stopped on purpose.
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
                {strings.openRun}
              </button>
              {row.outcome === 'cancelled' ? (
                <button
                  type="button"
                  data-resume-run
                  onClick={() =>
                    postToHost({
                      type: 'resumeRun',
                      workflowId: row.workflowId,
                    })
                  }
                >
                  {strings.resumeRun}
                </button>
              ) : null}
              {row.outcome === 'cancelled' || row.via !== 'start' ? null : (
                <button
                  type="button"
                  data-rerun
                  onClick={() =>
                    postToHost({ type: 'rerun', workflowId: row.workflowId })
                  }
                >
                  {row.keyed ? strings.resendEvent : strings.rerunSameInput}
                </button>
              )}
              {row.outcome === 'cancelled' || row.error === undefined ? null : (
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

/** The id the tabs and the list they filter name
 *  each other by. */
const LIST = 'runs-list';

/**
 * The list, and the tabs that filter it: drawn
 * where the state table gives the view a list, and
 * a sentence where it does not.
 *
 * Active and Failed share no status, so the two
 * never add up to more than All. Every tab drives
 * the one list, which is always there under them
 * whichever is picked.
 *
 * Under the panel's own card — the app is down and
 * the card says so — an empty filter is a line
 * rather than a second card.
 */
function RunList({ state }: { state: RunsInit }) {
  const { strings, filter } = state;
  const view = runsState(state);

  if (!view.regions.includes('tabs')) {
    const said = blockedBy(state, view.row);

    return said === undefined ? null : <p className="state">{said}</p>;
  }

  const empty = filter === 'active' ? strings.noActive : strings.noFailed;

  return (
    <>
      <Tabs
        items={RUN_FILTERS.map((one: RunFilter) => ({
          id: one,
          label: strings.filters[one],
          count: state.counts[one],
          hook: { filter: one },
        }))}
        active={filter}
        onPick={(picked) => postToHost({ type: 'runFilter', filter: picked })}
        label={strings.heading}
        panel={LIST}
        controlsAll
      />

      <TabPanel panel={LIST} active={filter}>
        {view.regions.includes('rows') ? (
          <Rows state={state} />
        ) : view.regions.includes('filter-hint') ? (
          <FieldHint>{empty}</FieldHint>
        ) : (
          <EmptyState kind="empty" title={empty} />
        )}
      </TabPanel>
    </>
  );
}

/**
 * The page of the ledger, minus whatever the
 * session section already drew: a run started this
 * window and already written to the database is a
 * session row and nothing else, or it would be on
 * screen twice.
 *
 * The read stops at a page and the count behind a
 * tab does not, so a page shorter than its tab says
 * how much of it is drawn.
 */
function Rows({ state }: { state: RunsInit }) {
  const { strings } = state;
  const inSession = new Set(state.session.map((row) => row.workflowId));
  const rows = state.rows.filter((row) => !inSession.has(row.workflowId));
  const onPage = new Set(rows.map((row) => row.workflowId));
  const behind = state.counts[state.filter];

  return (
    <>
      <ol className="run-list">
        {rows.map((row) => (
          <RunHistoryItem
            key={row.workflowId}
            row={row}
            strings={strings}
            selected={row.workflowId === state.selected}
            onPage={onPage}
          />
        ))}
      </ol>

      {state.rows.length < behind ? (
        <FieldHint>
          {filled(strings.capped, String(state.rows.length), String(behind))}
        </FieldHint>
      ) : null}
    </>
  );
}

/**
 * Why there is no list, where the state table gives
 * the view none. A missing database and one that
 * would not answer each say which in the detail, and
 * a missing Docker in the stack's. A daemon that did
 * not answer has nothing true to add to the stack
 * above it.
 */
function blockedBy(state: RunsInit, row: StateRow): string | undefined {
  const { strings } = state;

  switch (row) {
    case 'untrusted':
      return strings.untrusted;
    case 'no-project':
      return strings.noProject;
    case 'no-docker':
      return state.stack.detail;
    case 'docker-silent':
    case 'loading':
      return undefined;
    case 'no-database':
    case 'database-refused':
    case 'app-down':
    case 'no-runs':
    case 'empty-filter':
    case 'populated':
      return state.detail ?? strings.empty;
  }
}

mountView('runs', Runs);
