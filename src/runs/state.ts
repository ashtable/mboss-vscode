import type { RunsInit, StackZone } from '../webview/protocol.js';

/**
 * What the Runs view draws below its header: one
 * table, read top to bottom, first match wins.
 *
 * Every fact it reads is already in the init, so
 * the view asks this rather than being sent the
 * answer — a second copy a fixture could make
 * disagree with the first. It imports nothing but
 * types, so the browser bundle can load it.
 *
 * The order is the order a person has to fix
 * things in. Nothing can be read in a folder
 * nobody trusts, or without a project, or without
 * a database to read. Docker comes next, because a
 * database that refuses is most often the stack's
 * own, stopped — and a daemon that is not running
 * lists no containers, which says nothing about
 * the project's services, so it is asked about
 * before any of them. Only then does the ledger's
 * own answer decide: a refusal names the database
 * (a stopped Postgres is one, whatever the app is
 * doing); a readable ledger with the app down keeps
 * its list under the app's card; and with the app
 * up, the list, an empty filter, or no runs at all.
 */

/**
 * Compose's name for the container the workflows
 * run in, as the scaffold's compose file names it.
 * Its state is the one that decides whether
 * anything can be started at all.
 */
export const APP_SERVICE = 'app';

/** Which row of the table a moment is. */
export type StateRow =
  | 'loading'
  | 'untrusted'
  | 'no-project'
  | 'no-database'
  | 'no-docker'
  | 'docker-silent'
  | 'database-refused'
  | 'app-down'
  | 'no-runs'
  | 'empty-filter'
  | 'populated';

/**
 * A part of the view below its header.
 *
 * `services` is a row per declared service; `state`
 * is the one card that says why the view looks the
 * way it does; `rows` is the list and
 * `filter-hint` the line that stands in for it
 * where a card is already showing; `production` is
 * the whole section about DBOS Conductor, and
 * `production-button` its one Button alone.
 */
export type Region =
  | 'run-row'
  | 'input-row'
  | 'services'
  | 'state'
  | 'tabs'
  | 'rows'
  | 'filter-hint'
  | 'footer'
  | 'production'
  | 'production-button';

export type RunsView = {
  row: StateRow;

  /** What to draw, in the order it is drawn. */
  regions: readonly Region[];

  /** The one way out the card offers, if any. */
  action: 'refresh' | 'start-app' | 'run-named' | undefined;
};

/** The facts the table reads, all of them the
 *  init's own. */
export type RunsFacts = Pick<
  RunsInit,
  'state' | 'stack' | 'counts' | 'rows' | 'filter' | 'testRun' | 'production'
>;

export function runsState(facts: RunsFacts): RunsView {
  const { state, stack } = facts;

  if (state === 'loading') return drawn('loading', []);

  if (
    state === 'untrusted' ||
    state === 'no-project' ||
    state === 'no-database'
  ) {
    return drawn(state, ['state']);
  }

  if (!stack.available) return drawn('no-docker', ['state']);

  if (!stack.answered) return drawn('docker-silent', ['state'], 'refresh');

  if (state === 'unreachable') {
    return drawn(
      'database-refused',
      stack.services.length === 0 ? ['state'] : ['services', 'state'],
      anyDown(stack) ? 'start-app' : undefined,
    );
  }

  const { rows, counts, filter, production } = facts;

  // The count and the page are two reads and can
  // disagree for a moment. The page is what is
  // drawn, so an empty one under All is no runs
  // whatever the count said.
  const noRuns = rows.length === 0 && (filter === 'all' || counts.all === 0);

  if (!appRunning(stack)) {
    const list: Region[] = noRuns
      ? []
      : ['tabs', rows.length === 0 ? 'filter-hint' : 'rows'];

    return drawn(
      'app-down',
      ['services', 'state', ...list, 'footer'],
      'start-app',
    );
  }

  if (noRuns) {
    return drawn(
      'no-runs',
      ['run-row', 'input-row', 'state', 'footer', 'production'],
      startable(facts) ? 'run-named' : undefined,
    );
  }

  const button: Region[] = production.configured ? ['production-button'] : [];

  if (rows.length === 0) {
    return drawn('empty-filter', [
      'run-row',
      'input-row',
      'tabs',
      'state',
      'footer',
      ...button,
    ]);
  }

  return drawn('populated', [
    'run-row',
    'input-row',
    'tabs',
    'rows',
    'footer',
    ...button,
  ]);
}

function drawn(
  row: StateRow,
  regions: readonly Region[],
  action?: RunsView['action'],
): RunsView {
  return { row, regions, action };
}

/**
 * Whether the service the workflows run in is up.
 * A compose file that declares no such service
 * reads as its being down: nothing could be
 * started either way.
 */
function appRunning(stack: StackZone): boolean {
  return stack.services.some(
    (one) => one.service === APP_SERVICE && one.state === 'running',
  );
}

/** Whether Start app would change anything. */
function anyDown(stack: StackZone): boolean {
  return stack.services.some((one) => one.state !== 'running');
}

/**
 * Whether the chosen workflow can be started from
 * here. A schedule workflow runs on its schedule
 * and nowhere else.
 */
function startable({ testRun }: RunsFacts): boolean {
  const chosen = testRun.workflows.find((one) => one.name === testRun.selected);

  return chosen !== undefined && chosen.mode !== 'schedule';
}
