import { randomBytes } from 'node:crypto';

import { messages } from '../messages.js';

import type { Database, OpenDatabase } from './db.js';
import type { ProjectEnv } from './env.js';
import { detailOf } from './failure.js';
import { latestRunQuery } from './queries.js';
import type { StackController } from './stack.js';

/**
 * Starting one run of a workflow.
 *
 * Through the app's own guarded ingress, never
 * through a DBOS client: only the launched app has
 * the workflow registered, and a client that
 * enqueued one would be writing a run nothing can
 * pick up. The request goes over loopback to the
 * port compose published, carrying the secret out
 * of the project's own `.env`.
 *
 * Nothing here throws. A run that does not start
 * is a sentence on the panel and a session row
 * saying why, because a person pressed a button
 * and is owed an answer either way.
 */

/** The header every run-starting route is guarded
 *  by, as the app spells it. */
const SECRET_HEADER = 'x-mboss-events-secret';

export type RunTrigger = { mode: 'manual' } | { mode: 'event'; topic: string };

export type RunRequest = {
  /** The project directory: where the compose file
   *  and the `.env` are. */
  project: string;

  /** The workflow's name, which is also the name
   *  every run of it is recorded under. */
  workflow: string;

  trigger: RunTrigger;

  /** Whatever the panel's JSON box parsed to. */
  input: unknown;

  /**
   * The id a manual run goes out under, where the
   * caller has already put a row on screen against
   * it. Minted here when it has not — the id has
   * to exist before the request does either way,
   * and only one of the two can own it.
   */
  workflowId?: string;
};

/**
 * Why a run did not start, in the three ways that
 * ask for different things of the panel.
 *
 * `rebuild-to-run` is the app answering about a
 * workflow it has never heard of: it runs the
 * image built at `compose up`, so a workflow added
 * or renamed since is not in it, and the answer is
 * a Rebuild rather than a status line. `untracked`
 * is a run that is going and that nothing on
 * screen can follow.
 */
export type RunProblem = 'refused' | 'rebuild-to-run' | 'untracked';

export type RunStart =
  | { ok: true; workflowId: string }
  | { ok: false; because: RunProblem; detail: string };

/** Starting a run, bound to the collaborators it
 *  needs, as the panel's store takes it. */
export type RunStarter = (request: RunRequest) => Promise<RunStart>;

export type RunnerDeps = {
  stack: StackController;

  env: ProjectEnv;

  open: OpenDatabase;

  fetch: typeof globalThis.fetch;
};

export async function startRun(
  deps: RunnerDeps,
  request: RunRequest,
): Promise<RunStart> {
  const origin = await deps.stack.appOrigin(request.project);

  if (origin === undefined) {
    return { ok: false, because: 'refused', detail: messages.runNoApp() };
  }

  const secret = deps.env.eventsSecret(request.project);

  if (secret === undefined) {
    return {
      ok: false,
      because: 'refused',
      detail: messages.runNoEventsSecret(),
    };
  }

  const post = posted(origin, request);

  // Read before the request goes: the app writes
  // the run's row while this is in flight, so a
  // cutoff taken from the answer would be later
  // than the row it is looking for.
  const since = Date.now();

  const answer = await ask(deps.fetch, post, secret);

  if (!answer.reached) {
    return { ok: false, because: 'refused', detail: answer.detail };
  }

  if (answer.status === 404) {
    return { ok: false, because: 'rebuild-to-run', detail: refusalIn(answer) };
  }

  if (answer.status < 200 || answer.status >= 300) {
    return { ok: false, because: 'refused', detail: refusalIn(answer) };
  }

  if (post.minted !== undefined) {
    return { ok: true, workflowId: post.minted };
  }

  const echoed = echoedIn(answer.body);
  const started = echoed ?? (await recorded(deps, request, since));

  if (started === undefined) {
    return {
      ok: false,
      because: 'untracked',
      detail: messages.runUntracked(request.workflow),
    };
  }

  return { ok: true, workflowId: started };
}

/** One request, and the id it carries if the id is
 *  this side's to choose. */
type Post = {
  url: string;
  body: string;
  /** The id a manual run was started under. */
  minted?: string;
};

function posted(origin: string, request: RunRequest): Post {
  if (request.trigger.mode === 'event') {
    return {
      url: `${origin}/events/${encodeURIComponent(request.trigger.topic)}`,
      // The event route is handed the event itself,
      // not a wrapper around it.
      body: JSON.stringify(request.input ?? null),
    };
  }

  const minted = request.workflowId ?? newRunId();

  return {
    url: `${origin}/runs/${encodeURIComponent(request.workflow)}`,
    body: JSON.stringify({ payload: request.input, workflowID: minted }),
    minted,
  };
}

/**
 * The id a manual run is started under, minted on
 * this side rather than left to the app.
 *
 * The panel records the run before the request
 * goes, and a run the app started under some id
 * nobody heard is a run nothing on screen can
 * follow. The route starts the run this names, so
 * a request sent twice is one run.
 */
export function newRunId(): string {
  return `run_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

/** What the app said, whatever it was. */
type Said = { status: number; statusText: string; body: string };

/** What came back, or the reason nothing did. */
type Answer = ({ reached: true } & Said) | { reached: false; detail: string };

async function ask(
  send: typeof globalThis.fetch,
  post: Post,
  secret: string,
): Promise<Answer> {
  try {
    const response = await send(post.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SECRET_HEADER]: secret,
      },
      body: post.body,
    });

    return {
      reached: true,
      status: response.status,
      statusText: response.statusText,
      body: await response.text(),
    };
  } catch (cause) {
    return { reached: false, detail: detailOf(cause) };
  }
}

/**
 * What the app complained about, in as many words
 * as it gave.
 *
 * Every refusal the app writes itself is
 * `{ error }`. Anything in front of it — a proxy,
 * a stack trace — is shown as it arrived, and an
 * answer with nothing in it leaves only the status.
 */
function refusalIn(answer: Said): string {
  const said = fieldOf(parsed(answer.body), 'error');

  if (typeof said === 'string' && said !== '') return said;

  const body = answer.body.trim();

  if (body !== '') return body;

  return answer.statusText === '' ? String(answer.status) : answer.statusText;
}

/** The id the app started, where its ingress says
 *  so. */
function echoedIn(body: string): string | undefined {
  const echoed = fieldOf(parsed(body), 'workflowID');

  return typeof echoed === 'string' && echoed !== '' ? echoed : undefined;
}

/**
 * The run an app that echoes nothing just started.
 *
 * A read of the project's own ledger, which is
 * where every run is recorded whether or not the
 * route said its id. It is the newest run of that
 * workflow since the request went — close enough
 * to be right in a panel one person is driving,
 * and the reason the echo exists at all.
 */
async function recorded(
  deps: RunnerDeps,
  request: RunRequest,
  since: number,
): Promise<string | undefined> {
  const url = deps.env.systemDatabaseUrl(request.project);

  if (!url.ok) return undefined;

  let db: Database | undefined;

  try {
    db = await deps.open(url.url);

    const query = latestRunQuery(request.workflow, since);
    const rows = await db.query<{ workflow_uuid: string }>(
      query.text,
      query.values,
    );

    return rows[0]?.workflow_uuid;
  } catch {
    // A database that will not answer is one more
    // way this run cannot be followed, and the
    // panel says that either way.
    return undefined;
  } finally {
    await db?.close().catch(() => undefined);
  }
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function fieldOf(value: unknown, name: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;

  return (value as Record<string, unknown>)[name];
}
