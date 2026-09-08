import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkflowIR } from '../core/rules.js';
import { liveRun, watcher } from '../test-support/runs.js';

import { following, type FollowingDeps } from './following.js';
import type { LiveRun } from './watch.js';

/**
 * Who owns the polling.
 *
 * A run this window started and has open on the run
 * page is one run, and two zones both wanting to
 * follow it used to mean two watches reading the
 * same rows twice a second. So there is one owner:
 * whoever cares says which run they care about, and
 * hears what the ledger says about it.
 *
 * Nothing here re-arms on its own. A watch stops
 * itself when the run settles, parks or goes quiet,
 * and only a person asking starts one again — which
 * is the whole of the promise that an editor polls
 * while somebody is watching and never on a timer
 * nobody asked for.
 */

const LEDGER = 'postgres://app@localhost:5432/app';

const WORKFLOW = 'document_ingestion_queued';

/** A saved document holding one queue block and
 *  one block that queues nothing. */
const INGESTION: WorkflowIR = {
  $schema: 'https://mboss.dev/schemas/workflow-v1.json',
  version: 1,
  revision: 1,
  name: WORKFLOW,
  nodes: [
    {
      id: 'started',
      kind: 'trigger',
      title: 'Started',
      config: { mode: 'manual' },
    },
    {
      id: 'index_pages',
      kind: 'queue',
      title: 'Index pages',
      config: {
        itemsPath: 'pages',
        queue: { name: 'document-index' },
        enqueue: {},
      },
    },
  ],
  edges: [],
};

function follow(over: Partial<FollowingDeps> = {}): {
  armed: ReturnType<typeof watcher>;
} & {
  held: ReturnType<typeof following>;
} {
  const armed = watcher();

  return {
    armed,
    held: following({
      open: async () => ({
        query: async () => [],
        close: async () => undefined,
      }),
      watch: armed.watch,
      ledger: () => LEDGER,
      document: () => undefined,
      unsettled: () => [],
      ...over,
    }),
  };
}

describe('following the runs somebody is watching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms one watch per run, however often it is asked', () => {
    const { armed, held } = follow();

    held.arm('wf_1', WORKFLOW);
    held.arm('wf_1', WORKFLOW);
    held.arm('wf_2', WORKFLOW);

    expect(armed.armed.map((one) => one.workflowId)).toEqual(['wf_1', 'wf_2']);
  });

  it('arms nothing where there is no ledger to read', () => {
    const { armed, held } = follow({ ledger: () => undefined });

    held.arm('wf_1', WORKFLOW);

    expect(armed.armed).toHaveLength(0);
  });

  it('lets go of a run nobody is looking at any more', () => {
    const { armed, held } = follow();

    held.arm('wf_1', WORKFLOW);
    held.drop('wf_1');

    expect(armed.armed[0]?.stopped).toBe(true);

    // And arming it again is a new watch rather
    // than a no-op against the stopped one.
    held.arm('wf_1', WORKFLOW);
    expect(armed.armed).toHaveLength(2);
  });

  it('re-arms the runs still moving and the one being shown', () => {
    const { armed, held } = follow({
      unsettled: () => [
        { workflowId: 'wf_1', workflow: WORKFLOW },
        { workflowId: 'wf_shown', workflow: WORKFLOW },
      ],
    });

    held.rewatch();

    expect(armed.armed.map((one) => one.workflowId)).toEqual([
      'wf_1',
      'wf_shown',
    ]);
  });

  it('re-arms nothing else', () => {
    const { armed, held } = follow({
      unsettled: () => [{ workflowId: 'wf_1', workflow: WORKFLOW }],
    });

    held.arm('wf_done', WORKFLOW);
    armed.say('wf_done', liveRun({ workflowId: 'wf_done', outcome: 'done' }));

    held.rewatch();

    expect(
      armed.armed.filter((one) => one.workflowId === 'wf_done'),
    ).toHaveLength(1);
  });

  it('tells everyone listening what one tick read', () => {
    const { armed, held } = follow();
    const heard: LiveRun[] = [];

    held.onRun((run) => heard.push(run));
    held.arm('wf_1', WORKFLOW);
    armed.say('wf_1', liveRun({ workflowId: 'wf_1' }));

    expect(heard.map((run) => run.workflowId)).toEqual(['wf_1']);
  });

  it('stops every watch it armed when disposed', () => {
    const { armed, held } = follow();

    held.arm('wf_1', WORKFLOW);
    held.arm('wf_2', WORKFLOW);
    held.dispose();

    expect(armed.armed.every((one) => one.stopped)).toBe(true);
  });

  /**
   * The bound, checked rather than believed: nothing
   * here schedules anything of its own, so the only
   * clock in play is the watch's own tick.
   */
  it('runs no clock but the half-second tick', () => {
    const { held } = follow();

    held.arm('wf_1', WORKFLOW);
    held.rewatch();

    expect(vi.getTimerCount()).toBe(0);
  });
  /**
   * A watch polls a database and never looked for a
   * document, so the queue blocks it reads counts
   * for have to come with the arming. Deriving them
   * here is what keeps every zone that arms a watch
   * ignorant of the queue grammar.
   */
  it('hands the watch the queue blocks the document holds', () => {
    const { armed, held } = follow({ document: () => INGESTION });

    held.arm('wf_1', WORKFLOW);

    expect(armed.armed[0]?.queueNodes).toEqual([
      {
        nodeId: 'index_pages',
        queuedName: 'index_pages.queued.document_ingestion_queued',
      },
    ]);
  });

  /**
   * A document that will not read is a reason to
   * know less about the run, never a reason not to
   * follow it: the steps and the status column say
   * plenty on their own.
   */
  it('arms a watch with none where the document will not read', () => {
    const { armed, held } = follow({ document: () => undefined });

    held.arm('wf_1', WORKFLOW);

    expect(armed.armed).toHaveLength(1);
    expect(armed.armed[0]?.queueNodes).toEqual([]);
  });
});
