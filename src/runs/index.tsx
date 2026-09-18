import { Fragment, type ReactNode } from 'react';

import { postToHost } from '../webview/client.js';
import { filled } from '../webview/fill.js';
import { mountView } from '../webview/mount.js';
import type { RunsInit, RunsStrings, StackZone } from '../webview/protocol.js';
import { Button } from '../webview/signal/Button.js';
import { EmptyState } from '../webview/signal/EmptyState.js';
import { Select } from '../webview/signal/Field.js';
import { FieldHint } from '../webview/signal/FieldHint.js';
import { TabPanel, Tabs } from '../webview/signal/Tabs.js';

import { InputRow } from './InputRow.js';
import { ProductionState } from './ProductionState.js';
import { RUN_FILTERS, type RunFilter } from './queries.js';
import { RunHistoryItem } from './RunHistoryItem.js';
import { ServiceHealthItem } from './ServiceHealthItem.js';
import { runsState, type RunsView, type StateRow } from './state.js';

import './runs.css';

/**
 * The Runs panel: a frame round one list.
 *
 * Three regions down one column that is never
 * taller than the pane. The header says whose runs
 * these are. Under it, where there is anything to
 * start, the controls — Run with its ports line,
 * the input, and the tabs — stay where they are.
 * Everything else scrolls: the rows, whatever the
 * state table draws in their place, and the one
 * line saying where the list came from, which
 * follows the end of the list rather than sitting
 * at the bottom of the pane.
 *
 * What this window set going has no card of its
 * own. A run it started is the top row of the
 * ledger, marked and opened out, which is the same
 * row somebody would have picked themselves.
 *
 * It holds nothing but what the input box is
 * showing while somebody is typing in it, and even
 * that is the extension's: everything is pushed in
 * on every change the way the list always was.
 */
function Runs(state: RunsInit) {
  const { strings } = state;
  const view = runsState(state);

  // The Run row is what there is to pin. Where the
  // table gives the view one, the way to start a
  // run stays put and the history moves under it;
  // where it does not, whatever the table does give
  // scrolls with the list.
  const pinned = view.regions.includes('run-row');
  const filters = view.regions.includes('tabs') ? (
    <Filters state={state} />
  ) : null;

  // The one card the table names, and where it
  // goes: a card about a filter somebody picked
  // belongs under the tabs that picked it, and
  // every other one is about the whole panel and
  // sits above them.
  const card = view.regions.includes('state') ? (
    <BoundaryState state={state} view={view} />
  ) : null;
  const filtered = view.row === 'empty-filter';

  return (
    <div className="runs">
      <header className="runs-head">
        <p className="runs-title">{strings.heading}</p>
        {state.project === undefined ? null : (
          <p className="runs-project mono">
            {filled(strings.workspace, state.project)}
          </p>
        )}
      </header>

      {pinned ? (
        <div className="runs-controls">
          <RunRow state={state} />
          <InputRow testRun={state.testRun} strings={strings} />
          {filters}
        </div>
      ) : null}

      {/* Nothing has been read yet, and anything
          drawn below the header would be replaced a
          moment later. */}
      {view.row === 'loading' ? null : (
        <div className="runs-body">
          {view.regions.includes('services') ? (
            <ul className="services">
              {state.stack.services.map((service) => (
                <ServiceHealthItem
                  key={service.service}
                  service={service}
                  strings={strings}
                />
              ))}
            </ul>
          ) : null}

          {filtered ? null : card}

          {pinned ? null : filters}

          {view.regions.includes('tabs') ? (
            <Listing state={state} view={view} card={filtered ? card : null} />
          ) : null}

          {view.regions.includes('footer') ? (
            <footer className="runs-foot">
              <FieldHint title={state.source}>{strings.projection}</FieldHint>
            </footer>
          ) : null}

          {view.regions.includes('production') ? (
            <ProductionState
              configured={state.production.configured}
              strings={strings}
            />
          ) : null}

          {view.regions.includes('production-button') ? (
            <div className="runs-production">
              <Button
                variant="secondary"
                ink="brand"
                hook={{ production: 'configured' }}
                onClick={() => postToHost({ type: 'openProduction' })}
              >
                {strings.openProduction}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * The one line everything about starting a run
 * sits on: Run, which saved workflow it would be,
 * and where the project's own services are
 * listening.
 *
 * Run is drawn only where there is something to
 * start — a primary button that does nothing is a
 * lie about what the panel can do — and the picker
 * only where there is a choice to make. The ports
 * line is always there, because what is listening
 * is the first thing to check when a start goes
 * nowhere.
 */
function RunRow({ state }: { state: RunsInit }) {
  const { strings, testRun } = state;

  const picked = testRun.workflows.find(
    (flow) => flow.name === testRun.selected,
  );
  const runnable = picked !== undefined && picked.mode !== 'schedule';

  return (
    <div className="runs-run" data-zone="stack">
      {runnable ? (
        <Button
          variant="primary"
          hook={{ 'run-workflow': '' }}
          onClick={() =>
            postToHost({ type: 'runWorkflow', workflow: picked.name })
          }
        >
          {strings.run}
        </Button>
      ) : null}

      {testRun.workflows.length > 1 ? (
        <Select
          label={strings.workflow}
          hook={{ 'workflow-picker': '' }}
          value={testRun.selected ?? ''}
          options={testRun.workflows.map((flow) => ({
            value: flow.name,
            label: flow.title,
          }))}
          onChange={(workflow) =>
            postToHost({ type: 'selectWorkflow', workflow })
          }
        />
      ) : null}

      <p className="mono runs-ports">
        {state.stack.services.map((service, at) => (
          <Fragment key={service.service}>
            {at === 0 ? null : <span aria-hidden="true"> · </span>}
            <span data-service={service.service} data-state={service.state}>
              {filled(
                strings.servicePorts,
                service.service,
                listening(service, strings),
              )}
            </span>
          </Fragment>
        ))}
      </p>
    </div>
  );
}

/** Where a service is listening, or the word for
 *  the state it is in when it is listening
 *  nowhere. */
function listening(
  service: StackZone['services'][number],
  strings: RunsStrings,
): string {
  return service.ports.length === 0
    ? strings.serviceState[service.state]
    : service.ports.map((port) => `:${port}`).join(' ');
}

/** The id the tabs and the list they filter name
 *  each other by. */
const LIST = 'runs-list';

/**
 * The strip that filters the list.
 *
 * Active and Failed share no status, so the two
 * never add up to more than All. Every tab drives
 * the one list, which is always there under them
 * whichever is picked — and which is a region
 * further down the page than the strip whenever the
 * strip is pinned, so the two name each other by id
 * rather than by where they sit.
 */
function Filters({ state }: { state: RunsInit }) {
  const { strings, filter } = state;

  return (
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
  );
}

/**
 * The page of the ledger, or the line that stands
 * in for it.
 *
 * Drawn only where there are tabs to filter it:
 * without them the table's card is about the whole
 * panel, not about a filter, and is drawn above.
 *
 * Under the panel's own card — the app is down and
 * the card says so — an empty filter is a line
 * rather than a second card, because two cards on
 * one panel read as two things being wrong.
 */
function Listing({
  state,
  view,
  card,
}: {
  state: RunsInit;
  view: RunsView;

  /** The table's card, where this filter is what
   *  it is about. */
  card: ReactNode;
}) {
  return (
    <TabPanel panel={LIST} active={state.filter}>
      {view.regions.includes('rows') ? (
        <Rows state={state} />
      ) : view.regions.includes('filter-hint') ? (
        <FieldHint>{emptyFilter(state)}</FieldHint>
      ) : (
        card
      )}
    </TabPanel>
  );
}

/**
 * The page of the ledger.
 *
 * The read stops at a page and the count behind a
 * tab does not, so a page shorter than its tab says
 * how much of it is drawn.
 */
function Rows({ state }: { state: RunsInit }) {
  const { strings } = state;
  const onPage = new Set(state.rows.map((row) => row.workflowId));
  const behind = state.counts[state.filter];

  return (
    <>
      <ol className="run-list">
        {state.rows.map((row) => (
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
 * The one card, and the one way out it offers.
 *
 * Which states draw a card is the table's answer;
 * this is what each of them says. A title is the
 * fact and nothing else, and the line under it is
 * the sentence the host already writes about that
 * state, because which folder, which file and what
 * the database actually said are things only the
 * host knows.
 */
function BoundaryState({ state, view }: { state: RunsInit; view: RunsView }) {
  const said = saidBy(state, view.row);

  if (said === undefined) return null;

  return (
    <EmptyState
      kind={said.kind}
      title={said.title}
      detail={said.detail}
      action={wayOutOf(state, view)}
    />
  );
}

/** What a card says, and whose doing it is: `error`
 *  where the panel asked and was refused, `empty`
 *  where nothing has happened yet. */
type Said = {
  kind: 'empty' | 'error';
  title: string;
  detail: string | undefined;
};

function saidBy(state: RunsInit, row: StateRow): Said | undefined {
  const { strings } = state;

  switch (row) {
    case 'untrusted':
      return card('empty', strings.untrustedTitle, strings.untrusted);
    case 'no-project':
      return card('empty', strings.noProjectTitle, strings.noProject);
    case 'no-database':
      return card('error', strings.noDatabaseTitle, state.detail);
    case 'no-docker':
      return card('error', strings.noDockerTitle, state.stack.detail);
    case 'docker-silent':
      return card(
        'error',
        strings.dockerSilentTitle,
        strings.dockerSilentDetail,
      );
    case 'database-refused':
      return card('error', strings.databaseRefusedTitle, state.detail);
    case 'app-down':
      return card('error', strings.appDownTitle, strings.appDownDetail);
    case 'no-runs':
      return card('empty', strings.emptyTitle, strings.emptyDetail);
    case 'empty-filter':
      return card('empty', emptyFilter(state), undefined);
    case 'loading':
    case 'populated':
      return undefined;
  }
}

function card(
  kind: Said['kind'],
  title: string,
  detail: string | undefined,
): Said {
  return { kind, title, detail };
}

/**
 * The single thing that would change the state, as
 * a Button under the card.
 *
 * Which of them is on offer is the table's answer
 * too, so a state with nothing to offer offers
 * nothing rather than a control that would do
 * nothing.
 */
function wayOutOf(
  state: RunsInit,
  view: RunsView,
): Parameters<typeof EmptyState>[0]['action'] {
  const { strings, testRun } = state;

  switch (view.action) {
    case 'refresh':
      return {
        label: strings.refresh,
        onClick: () => postToHost({ type: 'runRefresh' }),
      };

    case 'start-app': {
      // The label stays a label while it is going:
      // a control that swapped its words for a
      // spinner leaves nobody able to say what they
      // pressed.
      const starting = state.stack.busy === 'up';

      return {
        label: starting ? strings.starting : strings.startApp,
        busy: starting,
        hook: { 'stack-up': '' },
        onClick: () => postToHost({ type: 'stackUp' }),
      };
    }

    case 'run-named': {
      const workflow = testRun.selected;

      return workflow === undefined
        ? undefined
        : {
            label: filled(strings.runNamed, workflow),
            onClick: () => postToHost({ type: 'runWorkflow', workflow }),
          };
    }

    case undefined:
      return undefined;
  }
}

/** What a filter with nothing behind it says. */
function emptyFilter({ strings, filter }: RunsInit): string {
  return filter === 'active' ? strings.noActive : strings.noFailed;
}

mountView('runs', Runs);
