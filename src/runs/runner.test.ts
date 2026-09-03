import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { projectEnv } from './env.js';
import type { Query } from './queries.js';
import { startRun, type RunRequest, type RunnerDeps } from './runner.js';
import type { StackController } from './stack.js';

/**
 * Starting a run, with no app to start it on.
 *
 * Everything the runner does happens at the app's
 * own front door, so the fake here is the door:
 * what was posted where, under which header, and
 * what the panel is told about the answer.
 *
 * The one thing the door cannot say — which run an
 * app scaffolded before the echo just started — is
 * read out of the ledger instead, so the fake
 * database below answers that statement by doing
 * what it says, and the fake app writes its row
 * before it answers the way a real one does.
 */

const ORIGIN = 'http://127.0.0.1:3000';

const SECRET_HEADER = 'x-mboss-events-secret';

const DEFAULT_ENV = [
  'DBOS_SYSTEM_DATABASE_URL="postgres://app:pw@localhost:5432/sys"',
  'EVENTS_SECRET="deadbeef"',
].join('\n');

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** What the app answered, before it is a
 *  `Response`. */
type Answered = { status: number; statusText?: string; body?: string };

/** A row of `dbos.workflow_status`, as much of it
 *  as the fallback reads. */
type LedgerRow = { workflow_uuid: string; name: string; created_at: number };

type Sent = { url: string; method: string; headers: Headers; body: string };

type Driven = {
  deps: RunnerDeps;
  project: string;
  sent: Sent[];
  /** Every connection string the runner opened. */
  opened: string[];
  asked: Query[];
};

/**
 * A project with an app in front of it, driven by
 * a scripted answer.
 *
 * `starts` is the row the app writes before it
 * replies — which is why reading the ledger the
 * moment a 202 lands finds the run that was just
 * started, and why a row already there from last
 * week does not.
 */
function driven(
  options: {
    answer?: Answered | Error;
    /** Nothing is publishing a port. */
    noApp?: boolean;
    env?: string;
    rows?: LedgerRow[];
    starts?: { workflow_uuid: string; name: string };
  } = {},
): Driven {
  const project = mkdtempSync(join(tmpdir(), 'mboss-runner-'));
  writeFileSync(join(project, '.env'), options.env ?? DEFAULT_ENV, 'utf8');

  const answer = options.answer ?? { status: 202, body: '{"ok":true}' };
  const rows = [...(options.rows ?? [])];
  const sent: Sent[] = [];
  const opened: string[] = [];
  const asked: Query[] = [];

  return {
    project,
    sent,
    opened,
    asked,
    deps: {
      stack: stackAt(options.noApp === true ? undefined : ORIGIN),
      env: projectEnv,
      open: async (url) => {
        opened.push(url);

        return {
          query: async <Row>(text: string, values: unknown[]) => {
            asked.push({ text, values });

            return newest(rows, values) as Row[];
          },
          close: async () => undefined,
        };
      },
      fetch: async (input, init) => {
        sent.push({
          url: String(input),
          method: init?.method ?? 'GET',
          headers: new Headers(init?.headers),
          body: String(init?.body ?? ''),
        });

        if (answer instanceof Error) throw answer;

        if (options.starts !== undefined) {
          rows.push({ ...options.starts, created_at: Date.now() });
        }

        return new Response(answer.body ?? '', {
          status: answer.status,
          statusText: answer.statusText,
        });
      },
    },
  };
}

/** What the fallback's statement says, done by
 *  hand: the newest run of that workflow since
 *  that moment. */
function newest(rows: LedgerRow[], values: unknown[]): LedgerRow[] {
  const [name, since] = values as [string, number];

  return rows
    .filter((row) => row.name === name && row.created_at >= since)
    .sort((left, right) => right.created_at - left.created_at)
    .slice(0, 1);
}

/** The runner asks the stack one question and no
 *  others. */
function stackAt(origin: string | undefined): StackController {
  const never = (): never => {
    throw new Error('the runner drives nothing but appOrigin');
  };

  return {
    up: never,
    rebuild: never,
    down: never,
    status: never,
    appOrigin: async () => origin,
  };
}

function manual(project: string): RunRequest {
  return {
    project,
    workflow: 'counter',
    trigger: { mode: 'manual' },
    input: { count: 0 },
  };
}

function event(project: string): RunRequest {
  return {
    project,
    workflow: 'on_claim',
    trigger: { mode: 'event', topic: 'claim.filed' },
    input: { claimId: 'c-1' },
  };
}

describe('starting a workflow by hand', () => {
  /**
   * The id is minted here rather than left to the
   * app, so the panel has a run to record before
   * the request goes — and a run the app started
   * under some id nobody heard is a run nothing on
   * screen can follow.
   */
  it('posts the payload under an id it minted itself', async () => {
    const { deps, project, sent, opened } = driven();

    const start = await startRun(deps, manual(project));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`${ORIGIN}/runs/counter`);
    expect(sent[0]?.method).toBe('POST');
    expect(sent[0]?.headers.get('content-type')).toBe('application/json');
    expect(sent[0]?.headers.get(SECRET_HEADER)).toBe('deadbeef');

    const body = JSON.parse(sent[0]?.body ?? '') as {
      payload: unknown;
      workflowID: string;
    };

    expect(body.payload).toEqual({ count: 0 });
    expect(body.workflowID).toMatch(/^run_\d+_[0-9a-f]+$/);
    expect(start).toEqual({ ok: true, workflowId: body.workflowID });

    // The id came back with the answer; there is
    // nothing to look up.
    expect(opened).toEqual([]);
  });

  /**
   * What the minted id buys is that the *same
   * request* sent twice is one run: the route
   * starts the run the id names. Two starts are
   * two runs, and keeping a second press from
   * becoming one is the panel's job rather than
   * this one's.
   */
  it('mints an id of its own for every start', async () => {
    const { deps, project } = driven();

    const first = await startRun(deps, manual(project));
    const second = await startRun(deps, manual(project));

    expect(first.ok && second.ok).toBe(true);
    expect(first.ok ? first.workflowId : '').not.toBe(
      second.ok ? second.workflowId : '',
    );
  });
});

describe('starting a workflow by its event', () => {
  /**
   * An event run's id is the app's to mint — the
   * route makes it out of the payload's own
   * idempotency key — so the only honest answer is
   * the one the app gives back.
   */
  it('takes the id the app echoes', async () => {
    const { deps, project, sent, opened } = driven({
      answer: {
        status: 202,
        body: '{"ok":true,"workflowID":"claim.filed:on_claim:c-1"}',
      },
    });

    const start = await startRun(deps, event(project));

    expect(sent[0]?.url).toBe(`${ORIGIN}/events/claim.filed`);
    expect(sent[0]?.headers.get(SECRET_HEADER)).toBe('deadbeef');

    // The input is the body: an event route is
    // handed the event, not a wrapper around it.
    expect(JSON.parse(sent[0]?.body ?? '')).toEqual({ claimId: 'c-1' });
    expect(start).toEqual({ ok: true, workflowId: 'claim.filed:on_claim:c-1' });
    expect(opened).toEqual([]);
  });

  /**
   * A project scaffolded before the route echoed
   * the id answers `{ ok: true }` and nothing else,
   * so the run is found in the ledger instead —
   * bounded by the moment the request went, which
   * is what keeps last week's run of the same
   * workflow out of it.
   */
  it('finds the run an older app started without saying so', async () => {
    const { deps, project, opened, asked } = driven({
      rows: [
        {
          workflow_uuid: 'wf_last_week',
          name: 'on_claim',
          created_at: Date.now() - WEEK,
        },
      ],
      starts: { workflow_uuid: 'wf_now', name: 'on_claim' },
    });

    const start = await startRun(deps, event(project));

    expect(start).toEqual({ ok: true, workflowId: 'wf_now' });
    expect(opened).toEqual(['postgres://app:pw@localhost:5432/sys']);
    expect(asked[0]?.values[0]).toBe('on_claim');
  });

  /**
   * The run is going and nothing on screen can
   * follow it, which is neither a refusal nor a
   * rebuild — and a panel that called it refused
   * would be denying a run that is underway.
   */
  it('says when an accepted event names no run it can follow', async () => {
    const { deps, project } = driven({
      rows: [
        {
          workflow_uuid: 'wf_last_week',
          name: 'on_claim',
          created_at: Date.now() - WEEK,
        },
      ],
    });

    const start = await startRun(deps, event(project));

    expect(start).toEqual({
      ok: false,
      because: 'untracked',
      detail:
        'The event was accepted, but no run of on_claim could be found to follow.',
    });
  });
});

describe('when a run does not start', () => {
  /**
   * The container runs the image built at
   * `compose up`. A workflow added or renamed since
   * is not in it, so neither route has heard of it —
   * which is a rebuild, and the panel offers one
   * rather than a status line nobody can act on.
   */
  it('reads a 404 from either route as an app built too early', async () => {
    const missing = { status: 404, body: '{"error":"unknown topic"}' };
    const byHand = driven({ answer: missing });
    const byEvent = driven({ answer: missing });

    const started = await startRun(byHand.deps, manual(byHand.project));
    const sent = await startRun(byEvent.deps, event(byEvent.project));

    expect(started).toEqual({
      ok: false,
      because: 'rebuild-to-run',
      detail: 'unknown topic',
    });
    expect(sent.ok).toBe(false);
    expect(sent.ok ? '' : sent.because).toBe('rebuild-to-run');
  });

  it('carries the route own complaint when a start is refused', async () => {
    const { deps, project } = driven({
      answer: {
        status: 422,
        body: '{"error":"payload: count is required"}',
      },
    });

    expect(await startRun(deps, manual(project))).toEqual({
      ok: false,
      because: 'refused',
      detail: 'payload: count is required',
    });
  });

  /** Not everything that answers is the app: a
   *  proxy in front of it says what it likes, and
   *  an answer with nothing in it leaves only the
   *  status. */
  it('falls back to the status where nothing was said', async () => {
    const { deps, project } = driven({
      answer: { status: 502, statusText: 'Bad Gateway' },
    });

    expect(await startRun(deps, manual(project))).toEqual({
      ok: false,
      because: 'refused',
      detail: 'Bad Gateway',
    });
  });

  it('carries what the connection said when nothing answered', async () => {
    const { deps, project } = driven({ answer: new Error('fetch failed') });

    expect(await startRun(deps, manual(project))).toEqual({
      ok: false,
      because: 'refused',
      detail: 'fetch failed',
    });
  });

  /** Both of these are states of somebody's
   *  machine, so both are sentences and neither is
   *  thrown. */
  it('will not start a run with no app to start it on', async () => {
    const { deps, project, sent } = driven({ noApp: true });

    expect(await startRun(deps, manual(project))).toEqual({
      ok: false,
      because: 'refused',
      detail:
        'The app is not up, so there is nothing to run on. Start the local stack.',
    });
    expect(sent).toEqual([]);
  });

  it('will not send a run the project has no secret for', async () => {
    const { deps, project, sent } = driven({ env: '# nothing here\n' });

    expect(await startRun(deps, manual(project))).toEqual({
      ok: false,
      because: 'refused',
      detail:
        "This project's .env names no EVENTS_SECRET, so the app will not accept a run.",
    });
    expect(sent).toEqual([]);
  });
});
