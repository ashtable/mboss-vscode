import { describe, expect, it } from 'vitest';

import type { RunnableWorkflow, StackZone } from '../webview/protocol.js';

import type { Run } from './rows.js';
import type { ServiceHealth } from './stack.js';
import {
  APP_SERVICE,
  runsState,
  type Region,
  type RunsFacts,
  type RunsView,
} from './state.js';
import { rowOf } from './view.js';

/**
 * What the Runs view draws below its header, as
 * one table read top to bottom.
 *
 * Every case names the row of the table it proves
 * and compares the whole answer, so a failure says
 * which state moved and what it moved to rather
 * than which of three fields disagreed.
 */

function service(name: string, state: ServiceHealth['state']): ServiceHealth {
  return {
    service: name,
    state,
    health: state === 'running' ? 'healthy' : 'none',
    ports: state === 'running' && name === 'postgres' ? [5432] : [],
    detail: '',
  };
}

const UP: StackZone = {
  available: true,
  answered: true,
  services: [service('postgres', 'running'), service('app', 'running')],
  busy: undefined,
  detail: undefined,
};

/** Compose has not been asked: what the zone holds
 *  before a read, or without a project. */
const UNREAD: StackZone = {
  available: false,
  answered: false,
  services: [],
  busy: undefined,
  detail: undefined,
};

const MANUAL: RunnableWorkflow = {
  name: 'groom_booking',
  title: 'Groom booking',
  mode: 'manual',
};

const SCHEDULED: RunnableWorkflow = {
  name: 'nightly_sync',
  title: 'Nightly sync',
  mode: 'schedule',
};

const RUN: Run = {
  workflowId: 'wf_c9d2f3',
  name: 'groom_booking',
  status: 'SUCCESS',
  recoveryAttempts: 1,
  executorId: 'local-dev',
  applicationVersion: 'v0.4.1',
  createdAt: 0,
  startedAt: 0,
  completedAt: 10_000,
  error: undefined,
  forkedFrom: undefined,
  wasForkedFrom: false,
};

/** Two runs, as the list's own rule draws them. */
const ROWS = [RUN, { ...RUN, workflowId: 'wf_older' }].map((run) =>
  rowOf(run, [], 60_000, 'en-US'),
);

/** A readable ledger with two runs on the page, a
 *  stack that is up, and a manual workflow chosen. */
function facts(over: Partial<RunsFacts> = {}): RunsFacts {
  return {
    state: 'ok',
    stack: UP,
    counts: { all: 6, active: 0, failed: 1 },
    rows: ROWS,
    filter: 'all',
    testRun: {
      workflows: [MANUAL, SCHEDULED],
      selected: MANUAL.name,
      input: '',
      hint: undefined,
      problem: undefined,
    },
    production: { configured: false },
    ...over,
  };
}

/** The stack with each named service in that
 *  state. */
function stackWith(...services: [string, ServiceHealth['state']][]): StackZone {
  return {
    ...UP,
    services: services.map(([name, state]) => service(name, state)),
  };
}

function selecting(name: string | undefined): Partial<RunsFacts> {
  return { testRun: { ...facts().testRun, selected: name } };
}

const CONFIGURED: Partial<RunsFacts> = { production: { configured: true } };

const NO_RUNS: Partial<RunsFacts> = {
  counts: { all: 0, active: 0, failed: 0 },
  rows: [],
};

/** A readable ledger holding runs, none of them
 *  failed, with Failed picked. */
const NONE_FAILED: Partial<RunsFacts> = {
  counts: { all: 6, active: 0, failed: 0 },
  rows: [],
  filter: 'failed',
};

type Expected = {
  row: RunsView['row'];
  regions: readonly Region[];
  action: RunsView['action'];
};

/** One row of the table, compared whole and under
 *  its name. */
function expectRow(name: string, over: RunsFacts, expected: Expected): void {
  expect({ name, ...runsState(over) }).toEqual({ name, ...expected });
}

describe('what the Runs view draws below its header', () => {
  /**
   * Nothing has been read yet, and every state
   * below is a claim about something read. A card
   * drawn now would be replaced a moment later.
   */
  it('draws the header alone before the first read', () => {
    expectRow('loading', facts({ state: 'loading', stack: UNREAD }), {
      row: 'loading',
      regions: [],
      action: undefined,
    });
  });

  it('says why there is nothing to read, in precedence order', () => {
    for (const state of ['untrusted', 'no-project', 'no-database'] as const) {
      expectRow(state, facts({ state, stack: UNREAD }), {
        row: state,
        regions: ['state'],
        action: undefined,
      });
    }

    const missing: StackZone = {
      ...UNREAD,
      detail: 'Docker is not on the PATH.',
    };

    // Docker missing comes before a refused
    // database: it is usually why the database
    // refused, and it is the one to fix first.
    for (const state of ['ok', 'unreachable'] as const) {
      expectRow(`no docker under ${state}`, facts({ state, stack: missing }), {
        row: 'no-docker',
        regions: ['state'],
        action: undefined,
      });
    }
  });

  /**
   * A daemon that is not running lists no
   * containers, which is not the same as the
   * project's services being down: Start app would
   * fail, and Refresh after starting Docker is the
   * way out.
   */
  it('offers Refresh when Docker is not answering', () => {
    const silent: StackZone = { ...UNREAD, available: true };

    for (const state of ['ok', 'unreachable'] as const) {
      expectRow(`silent under ${state}`, facts({ state, stack: silent }), {
        row: 'docker-silent',
        regions: ['state'],
        action: 'refresh',
      });
    }
  });

  it('names the database when it refuses, with Start app where something is down', () => {
    const refused = { state: 'unreachable' } as const;

    expectRow('all running', facts({ ...refused }), {
      row: 'database-refused',
      regions: ['services', 'state'],
      action: undefined,
    });

    expectRow(
      'postgres stopped',
      facts({
        ...refused,
        stack: stackWith(['postgres', 'exited'], ['app', 'running']),
      }),
      {
        row: 'database-refused',
        regions: ['services', 'state'],
        action: 'start-app',
      },
    );

    expectRow(
      'nothing started',
      facts({
        ...refused,
        stack: stackWith(['postgres', 'absent'], ['app', 'absent']),
      }),
      {
        row: 'database-refused',
        regions: ['services', 'state'],
        action: 'start-app',
      },
    );

    expectRow('nothing declared', facts({ ...refused, stack: stackWith() }), {
      row: 'database-refused',
      regions: ['state'],
      action: undefined,
    });
  });

  /**
   * The ledger is readable, so what it holds stays
   * on screen under the app being down: the one
   * EmptyState is the app's, and an empty filter
   * below it says so in a hint rather than a second
   * card.
   */
  it('keeps the list below the app-down state', () => {
    const down = {
      stack: stackWith(['postgres', 'running'], ['app', 'exited']),
    };
    const appDown = (regions: readonly Region[]): Expected => ({
      row: 'app-down',
      regions,
      action: 'start-app',
    });

    expectRow(
      'no runs',
      facts({ ...down, ...NO_RUNS }),
      appDown(['services', 'state', 'footer']),
    );
    expectRow(
      'runs',
      facts({ ...down }),
      appDown(['services', 'state', 'tabs', 'rows', 'footer']),
    );
    expectRow(
      'an empty filter',
      facts({ ...down, ...NONE_FAILED }),
      appDown(['services', 'state', 'tabs', 'filter-hint', 'footer']),
    );
    expectRow(
      'the app never started',
      facts({ stack: stackWith(['postgres', 'running'], ['app', 'absent']) }),
      appDown(['services', 'state', 'tabs', 'rows', 'footer']),
    );

    // Nothing can be started without the service
    // the workflows run in, whatever else the file
    // declares.
    expectRow(
      'no app declared',
      facts({ stack: stackWith(['postgres', 'running']) }),
      appDown(['services', 'state', 'tabs', 'rows', 'footer']),
    );
  });

  /**
   * The ledger lives in Postgres, so a stopped
   * Postgres is a database that will not answer,
   * whatever the app is doing. Its Start app brings
   * up the whole stack.
   */
  it('reads a stopped database as a refused one, not as the app down', () => {
    expectRow(
      'postgres stopped',
      facts({
        state: 'unreachable',
        stack: stackWith(['postgres', 'exited'], ['app', 'running']),
      }),
      {
        row: 'database-refused',
        regions: ['services', 'state'],
        action: 'start-app',
      },
    );
  });

  it('offers to run the selected workflow when nothing has run yet', () => {
    const regions: readonly Region[] = [
      'run-row',
      'input-row',
      'state',
      'footer',
      'production',
    ];

    expectRow('manual', facts({ ...NO_RUNS }), {
      row: 'no-runs',
      regions,
      action: 'run-named',
    });

    // A schedule workflow cannot be started by
    // hand; its input row says it runs on its
    // schedule instead.
    expectRow('schedule', facts({ ...NO_RUNS, ...selecting(SCHEDULED.name) }), {
      row: 'no-runs',
      regions,
      action: undefined,
    });
    expectRow(
      'nothing chosen',
      facts({ ...NO_RUNS, ...selecting(undefined) }),
      {
        row: 'no-runs',
        regions,
        action: undefined,
      },
    );

    // The production section says either thing,
    // so it is there whether or not a console is
    // set.
    expectRow('configured', facts({ ...NO_RUNS, ...CONFIGURED }), {
      row: 'no-runs',
      regions,
      action: 'run-named',
    });
  });

  it('says an empty filter is empty', () => {
    const regions: readonly Region[] = [
      'run-row',
      'input-row',
      'tabs',
      'state',
      'footer',
    ];

    expectRow('failed', facts({ ...NONE_FAILED }), {
      row: 'empty-filter',
      regions,
      action: undefined,
    });
    expectRow('configured', facts({ ...NONE_FAILED, ...CONFIGURED }), {
      row: 'empty-filter',
      regions: [...regions, 'production-button'],
      action: undefined,
    });

    // The count and the page are two reads and can
    // disagree for a moment; an empty page under
    // All is no runs, whatever the count said.
    expectRow('all, with a count', facts({ rows: [], filter: 'all' }), {
      row: 'no-runs',
      regions: ['run-row', 'input-row', 'state', 'footer', 'production'],
      action: 'run-named',
    });
  });

  it('draws the list when there is one', () => {
    const regions: readonly Region[] = [
      'run-row',
      'input-row',
      'tabs',
      'rows',
      'footer',
    ];

    expectRow('populated', facts(), {
      row: 'populated',
      regions,
      action: undefined,
    });
    expectRow('configured', facts({ ...CONFIGURED }), {
      row: 'populated',
      regions: [...regions, 'production-button'],
      action: undefined,
    });

    // A service the person added only changes its
    // own span in the ports line: runs go through
    // the app.
    expectRow(
      'another service stopped',
      facts({
        stack: stackWith(
          ['postgres', 'running'],
          ['app', 'running'],
          ['mailer', 'exited'],
        ),
      }),
      { row: 'populated', regions, action: undefined },
    );
  });

  it("names the app's service as the scaffold does", () => {
    expect(APP_SERVICE).toBe('app');
  });
});
