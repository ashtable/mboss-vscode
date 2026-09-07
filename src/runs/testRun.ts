import type { Disposable } from 'vscode';

import type { Agent } from '../acp/agent.js';
import type { ToolEntry } from '../acp/transcript.js';
import type { LibManifest, WorkflowIR } from '../core/rules.js';
import { emitter } from '../emitter.js';
import type { Trust } from '../trust.js';
import { messages } from '../messages.js';
import type { RunsInit, TestRunProblem } from '../webview/protocol.js';

import type { OpenDatabase } from './db.js';
import type { EnvName } from './env.js';
import {
  assembleRunEvidence,
  refusedRunEvidence,
  type AskAgent,
  type RunEvidence,
} from './evidence.js';
import type { Following } from './following.js';
import { decidedArms } from './operations.js';
import { readRun } from './reading.js';
import { hasRecovered } from './rows.js';
import { newRunId, type RunStart, type RunStarter } from './runner.js';
import {
  refusedRunId,
  type SessionLog,
  type SessionRun,
} from './sessionLog.js';
import { evidenceLines, evidenceSentence, sessionRowOf } from './view.js';
import { SETTLED, type LedgerRead, type LiveRun } from './watch.js';
import { projectWorkflows, type ProjectWorkflow } from './workflows.js';

/**
 * What this window set going, as the panel shows
 * it.
 *
 * The workflows a project has saved and which of
 * them the input box belongs to; the runs this
 * window started, in the session log; the watch on
 * each of them while it moves; and the one run the
 * canvas draws itself against. A run somebody just
 * started is the one thing in the panel that is
 * followed rather than read on request — watched
 * until it stops moving, and re-armed by a refresh,
 * since a run parked on a person and a run that has
 * gone quiet both let go and nothing puts them back
 * on a timer.
 *
 * The problem shown under the input box is about
 * whichever workflow is picked, and about the stack
 * as it was: a new pick clears it, and so does a
 * stack command, since Rebuild is what one of them
 * asks for.
 */

/** The slice of the editor the zone needs. */
export type TestRunHost = {
  projects(): string[];

  /** Puts the agent panel where somebody can see
   *  it. A question handed over in a view nobody is
   *  looking at is a question nobody was asked. */
  revealAgent(): Promise<void>;
};

export type TestRunDeps = {
  host: TestRunHost;
  agent: Agent;
  trust: Trust;
  runner: RunStarter;
  sessionLog: SessionLog;

  /** The one owner of every watch this window arms.
   *  This zone says which runs it started and hears
   *  back; it polls nothing itself. */
  following: Following;

  /**
   * What reading a run out of the ledger takes: a
   * connection to open, the workflow as it is saved
   * now, and the last scan of the code behind it.
   *
   * The connection is a fresh one rather than the
   * list's, because this read is open, read, close
   * — nothing here holds a slot on somebody's
   * development database while their editor is
   * open. Where there is none, there is nothing to
   * read and the question is answered from what
   * this window remembers instead.
   */
  open: OpenDatabase;

  ledger(): { url: string; from: EnvName } | undefined;

  document(name: string): WorkflowIR | undefined;

  manifest(): LibManifest | undefined;
};

/** What the list draws of this session. */
export type TestRunZone = Pick<RunsInit, 'testRun' | 'live' | 'session'>;

/**
 * Why a run this window is watching exists, where
 * a button rather than a typed input is what made
 * it.
 */
export type RunOrigin = Pick<SessionRun, 'via' | 'replayOf'>;

export type TestRun = Disposable & {
  /** Reads the saved workflows again, quietly: the
   *  panel is drawn again by whoever asked, and
   *  re-arming is the watch owner's. */
  refresh(): void;

  /** The runs this session started that have not
   *  settled, for whoever composes what is worth
   *  following. */
  unsettled(): readonly string[];

  /** Re-reads the project's saved workflows off
   *  disk and says so — what a command needs before
   *  it opens a picker, in a window where nothing
   *  has read them yet. */
  refreshWorkflows(): void;

  /** Which saved workflow the picker has open, so
   *  the hint beside the input box is about the
   *  right one. */
  selectWorkflow(workflow: string): void;

  /** Starts one run of a saved workflow, with
   *  whatever the input box holds. */
  runWorkflow(workflow: string, input: string): Promise<void>;

  /** Starts a run of the same workflow with the
   *  same input. */
  rerun(workflowId: string): Promise<void>;

  /**
   * Puts a run this window is about to ask for on
   * screen, and follows it.
   *
   * Called with the id the request will carry and
   * before that request goes out, so a fork or a
   * resume somebody's database refuses lands on a
   * row already in the list rather than on nothing.
   */
  follow(workflowId: string, workflow: string, origin: RunOrigin): void;

  /** Says the request that was going to create one
   *  of those runs did not. */
  refused(workflowId: string, detail: string): void;

  /**
   * Hands a run to the agent, with whatever can be
   * read about it.
   *
   * Any run the ledger has, not only one this
   * window started: the ledger is the durable
   * record and the session log is a window's
   * memory, so asking the first and falling back to
   * the second is what lets somebody ask about a
   * run from yesterday.
   */
  askAgent(ask: AskAgent): Promise<void>;

  /** Drops the problem under the input box, quietly:
   *  a stack command that is about to say something
   *  itself is what asks. */
  clearProblem(): void;

  /** The run a canvas draws itself against, when
   *  one has been followed. */
  live(): LiveRun | undefined;

  /**
   * Which way out each decided block of that run
   * took, read against the document the asker is
   * drawing.
   *
   * The document comes in because the rows are here
   * and the picture is theirs. The watch never
   * looked at one, so its own reading attributes
   * every row by name alone; asking again against a
   * real drawing is what lets a workflow edited
   * since the run say honestly that a row names a
   * block it no longer has.
   */
  decided(ir: WorkflowIR): ReadonlyMap<string, string>;

  render(): TestRunZone;

  onChanged(listener: () => void): Disposable;
};

export function testRunZone(deps: TestRunDeps): TestRun {
  const changes = emitter();

  let workflows: ProjectWorkflow[] = [];
  let workflow: string | undefined;
  let input = '';
  let problem: TestRunProblem | undefined;
  let live: LiveRun | undefined;

  /** The rows that reading was made of, kept beside
   *  it so a second reader with a document of its
   *  own need not go back to the database. */
  let ledger: LedgerRead | undefined;

  const changed = changes.fire;

  const project = (): string | undefined => deps.host.projects()[0];

  /** What the project has saved, and which of them
   *  the input box belongs to. */
  const readWorkflows = (): void => {
    const dir = project();

    workflows = dir === undefined ? [] : projectWorkflows(dir);

    if (workflows.some((flow) => flow.name === workflow)) return;

    workflow = workflows.find((flow) => flow.trigger.mode !== 'schedule')?.name;
  };

  /**
   * What the ledger says about a run somebody is
   * watching.
   *
   * The session row moves with it — that is what
   * keeps "this session" honest once the watch has
   * let go — and the run is what a canvas of the
   * same workflow draws itself against.
   */
  /**
   * What the ledger says about a run somebody is
   * watching — but only about one this window
   * started.
   *
   * One owner polls every followed run, including
   * ones a person merely opened on the run page, so
   * a report about a foreign run arrives here too.
   * The session log is what says which ones are
   * this window's, and colouring the editable
   * document with somebody else's run is exactly
   * what this guard prevents.
   */
  const heard = (run: LiveRun, read: LedgerRead): void => {
    const row = deps.sessionLog.find(run.workflowId);
    if (row === undefined) return;

    // What the run was started with, filled in from
    // the row where the ledger has no record of it.
    // Done as the report lands rather than when
    // somebody asks, so that the same reading comes
    // back between ticks — a canvas compares what it
    // is following by identity, and a fresh object
    // per question would redraw it on every signal
    // this store makes.
    live = run.input === undefined ? { ...run, input: sent(row) } : run;
    ledger = read;

    const failed = run.steps.find((step) => step.state === 'failed');

    deps.sessionLog.update(run.workflowId, {
      outcome: run.outcome,
      stepCount: run.steps.length,
      recovered: run.recovered,
      ...(failed === undefined
        ? {}
        : { failedStep: { name: failed.name, error: run.error ?? '' } }),
      ...(SETTLED.includes(run.outcome)
        ? { durationMs: Date.now() - row.startedAt }
        : {}),
    });

    changed();
  };

  const reports = deps.following.onRun(heard);

  /** What the zone says when a start did not
   *  happen, and whether the same Rebuild action
   *  the stack zone offers fixes it. */
  const problemOf = (answer: RunStart & { ok: false }): TestRunProblem => ({
    detail:
      answer.because === 'rebuild-to-run'
        ? messages.runRebuildToRun()
        : answer.detail,
    rebuildToRun: answer.because === 'rebuild-to-run',
  });

  const row = (
    workflowId: string,
    name: string,
    payload: unknown,
    over: Partial<SessionRun> = {},
  ): SessionRun => ({
    workflowId,
    workflow: name,
    input: payload,
    startedAt: Date.now(),
    outcome: 'running',
    stepCount: 0,
    recovered: false,
    // Pressing Run is the ordinary way a row gets
    // here; the other two say so.
    via: 'start',
    ...over,
  });

  /**
   * One run, started.
   *
   * A manual run's row exists before the request
   * does, under the id the request will carry, so
   * a start the app refuses lands on something
   * already on screen. An event run has no id
   * until the app echoes one, so its row is
   * recorded on the answer — and an echo naming a
   * run this session already has is the route's
   * own idempotency at work, so it selects that
   * row rather than recording a second.
   */
  const start = async (
    flow: ProjectWorkflow,
    payload: unknown,
  ): Promise<void> => {
    const dir = project();
    if (dir === undefined || !deps.trust.isTrusted()) return;

    problem = undefined;
    workflow = flow.name;

    if (flow.trigger.mode === 'schedule') return void changed();

    if (flow.trigger.mode === 'manual') {
      const workflowId = newRunId();

      deps.sessionLog.record(row(workflowId, flow.name, payload));
      changed();

      const answer = await deps.runner({
        project: dir,
        workflow: flow.name,
        trigger: { mode: 'manual' },
        input: payload,
        workflowId,
      });

      if (answer.ok) {
        // The id the row is under, not the one that
        // came back: the route starts the run under
        // the id it was handed, and the row on
        // screen is the thing being followed.
        deps.following.arm(workflowId);
      } else {
        deps.sessionLog.update(workflowId, {
          outcome: 'failed',
          error: answer.detail,
        });
        problem = problemOf(answer);
      }

      return void changed();
    }

    const answer = await deps.runner({
      project: dir,
      workflow: flow.name,
      trigger: { mode: 'event', topic: flow.trigger.topic },
      input: payload,
    });

    if (!answer.ok) {
      // A start nothing can follow is remembered
      // the same way a refused one is: the row and
      // its input are the only trace of it, and
      // the sentence on the row says which it was.
      deps.sessionLog.record(
        row(refusedRunId(), flow.name, payload, {
          outcome: 'failed',
          error: answer.detail,
        }),
      );
      problem = problemOf(answer);

      return void changed();
    }

    if (deps.sessionLog.find(answer.workflowId) === undefined) {
      deps.sessionLog.record(row(answer.workflowId, flow.name, payload));
    }

    deps.following.arm(answer.workflowId);
    changed();
  };

  /**
   * The row mBoss writes into the transcript about
   * a run it read.
   *
   * One shape whatever the read came back with,
   * because a read that answered and a read that
   * did not are the same event: a reader scanning
   * the column tells them apart by the status word,
   * not by meeting two different kinds of row.
   */
  const readRow = (
    workflowId: string,
    over: Pick<ToolEntry, 'status' | 'body' | 'action'>,
  ): ToolEntry => ({
    at: 'tool',
    id: `evidence:${workflowId}`,
    by: 'person',
    kind: 'read',
    verb: messages.runEvidenceVerb(),
    target: messages.runEvidenceTarget(workflowId),
    ...over,
  });

  /**
   * The record into the column, the panel onto the
   * screen, the question to the agent — in that
   * order.
   *
   * The row goes in first so the transcript reads in
   * the order things happened, and the panel is
   * revealed before the turn starts so that an
   * answer arriving quickly still arrives somewhere
   * somebody is looking. What the row shows is a
   * summary; the machine-readable copy travels with
   * the sentence, because a transcript is what a
   * person reads and a page of JSON in it is not.
   */
  const handOver = async (
    evidence: RunEvidence,
    workflowId: string,
  ): Promise<void> => {
    const target = messages.runEvidenceTarget(workflowId);

    deps.agent.note(
      readRow(workflowId, {
        status: 'applied',
        body: evidenceLines(evidence),
        // A way out only where there is a run to
        // open. The id a refused run is filed under
        // was minted here, and a page for it would
        // draw nothing.
        ...(evidence.at === 'refused'
          ? {}
          : {
              action: {
                label: messages.runEvidenceOpenRun(),
                posts: 'openRun',
                workflowId,
              },
            }),
      }),
    );

    await deps.host.revealAgent();

    await deps.agent.send({
      text: evidenceSentence(evidence),
      context: [
        {
          // Names what the record is about rather
          // than somewhere to fetch it from: nothing
          // serves `mboss://`.
          uri: `mboss://run-evidence/${workflowId}`,
          name: target,
          mimeType: 'application/json',
          text: JSON.stringify(evidence, null, 2),
        },
      ],
    });
  };

  return {
    refresh: () => {
      readWorkflows();
    },

    unsettled: () =>
      deps.sessionLog
        .list()
        .filter((row) => !SETTLED.includes(row.outcome))
        .map((row) => row.workflowId),

    refreshWorkflows: () => {
      readWorkflows();
      changed();
    },

    selectWorkflow: (name) => {
      workflow = name;
      // A problem left over from the last pick is
      // about that workflow, not this one.
      problem = undefined;
      changed();
    },

    runWorkflow: async (name, text) => {
      readWorkflows();

      const flow = workflows.find((one) => one.name === name);
      if (flow === undefined) return;

      problem = undefined;
      input = text;

      const payload = parsed(text);

      if (!payload.ok) {
        problem = { detail: messages.runNotJson(), rebuildToRun: false };

        return void changed();
      }

      await start(flow, payload.value);
    },

    rerun: async (workflowId) => {
      readWorkflows();

      const previous = deps.sessionLog.find(workflowId);
      if (previous === undefined) return;

      // Only a run somebody typed an input for can
      // be sent again with it. A fork or a resume
      // carries the input of the run it came from,
      // which lives in the ledger and never passed
      // through here — so there is nothing to send.
      if (previous.via !== 'start') return;

      const flow = workflows.find((one) => one.name === previous.workflow);
      if (flow === undefined) return;

      await start(flow, previous.input);
    },

    follow: (workflowId, workflow, origin) => {
      // The watch goes on with the row rather than
      // after it: a report about a run the session
      // log has never heard of is dropped, so the
      // row has to exist for the watch to be worth
      // anything.
      if (deps.sessionLog.find(workflowId) === undefined) {
        deps.sessionLog.record(row(workflowId, workflow, undefined, origin));
      }

      deps.following.arm(workflowId);
      changed();
    },

    refused: (workflowId, detail) => {
      if (deps.sessionLog.find(workflowId) === undefined) return;

      deps.sessionLog.update(workflowId, { outcome: 'failed', error: detail });

      // Nothing will ever be written under that id,
      // so the watch lets go now instead of reading
      // somebody's database until the quiet bound
      // ends it.
      deps.following.drop(workflowId);
      changed();
    },

    askAgent: async (ask) => {
      const { workflowId } = ask;
      const source = deps.ledger();

      // The ledger first, whatever this window
      // remembers: it is the durable record, it has
      // every run rather than this session's, and
      // what it says about a run this window did
      // start is the same thing said in more detail.
      const recorded =
        source === undefined
          ? undefined
          : await assembleRunEvidence(deps, source, ask);

      if (recorded !== undefined) return await handOver(recorded, workflowId);

      const remembered = deps.sessionLog.find(workflowId);
      if (remembered === undefined) return;

      // A run the app refused has no row anywhere —
      // the id it is filed under was minted here and
      // names nothing in anybody's database — so
      // this window's memory of trying is the whole
      // of what there is to hand over.
      if (remembered.failedStep === undefined) {
        if (remembered.error === undefined) return;

        return await handOver(refusedRunEvidence(remembered), workflowId);
      }

      // A read that was made and came back with
      // nothing is said out loud, because the
      // sentence after it is thinner than the one a
      // read would have earned and a reader deserves
      // to know which they are looking at.
      if (source !== undefined) {
        deps.agent.note(readRow(workflowId, { status: 'failed', body: [] }));
      }

      await deps.host.revealAgent();
      await deps.agent.send({
        text: messages.runAskAgent(
          remembered.workflow,
          remembered.failedStep.name,
          remembered.failedStep.error,
        ),
      });
    },

    clearProblem: () => {
      problem = undefined;
    },

    live: () => live,

    decided: (ir) =>
      ledger === undefined
        ? new Map()
        : decidedArms(
            readRun(
              ledger.run,
              ledger.steps,
              ir,
              hasRecovered(ledger.run),
              Date.now(),
            ).steps,
            ir,
          ),

    render: () => ({
      testRun: {
        workflows: workflows.map((flow) => ({
          name: flow.name,
          title: flow.title,
          mode: flow.trigger.mode,
          ...(flow.trigger.mode === 'event'
            ? { topic: flow.trigger.topic }
            : {}),
        })),
        selected: workflow,
        input,
        hint: hintFor(workflows, workflow),
        problem,
      },
      live,
      session: deps.sessionLog
        .list()
        .map((run) => sessionRowOf(run, workflows)),
    }),

    onChanged: changes.on,

    dispose: () => {
      reports.dispose();
      changes.dispose();
    },
  };
}

/**
 * Whether the same input is the same run, said
 * beside the box it is typed into.
 *
 * Only an event workflow whose trigger names a key
 * path has one: that path is what the route mints
 * the run id from.
 */
function hintFor(
  workflows: readonly ProjectWorkflow[],
  picked: string | undefined,
): string | undefined {
  const trigger = workflows.find((flow) => flow.name === picked)?.trigger;

  if (trigger?.mode !== 'event' || trigger.keyPath === undefined) {
    return undefined;
  }

  return messages.runKeyPathHint(trigger.keyPath);
}

/**
 * What this window sent to start the run, printed
 * the way the ledger's own input column is.
 *
 * DBOS does not always record what a run was
 * started with, and a run this window started is
 * one whose input this window is still holding — so
 * the row answers where the column could not. A
 * fork or a resume carries the input of the run it
 * came from, which never passed through here, and
 * for those there is honestly nothing to say.
 */
function sent(row: SessionRun): string | undefined {
  return row.input === undefined
    ? undefined
    : JSON.stringify(row.input, null, 2);
}

/**
 * What the input box holds, as a payload.
 *
 * An empty box is a run with no input rather than
 * a mistake — plenty of workflows take none — and
 * anything else has to be JSON before it is worth
 * sending, because the route parses it and would
 * only say the same thing later.
 */
function parsed(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text.trim() === '') return { ok: true, value: undefined };

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}
