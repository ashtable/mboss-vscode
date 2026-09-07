import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { compileInputs, compileWorkflow } from '../core/index.js';
import type { WorkflowIR } from '../core/rules.js';
import { messages } from '../messages.js';
import { management } from '../test-support/runs.js';

import type { ManagementClient } from './manage.js';
import {
  decideReplay,
  offerReplay,
  replayQuestion,
  type ReplayAnswer,
  type ReplayDeps,
  type ReplayQuestion,
} from './replayZone.js';
import type { Run, Step } from './rows.js';
import type { RunOrigin } from './testRun.js';

/**
 * Whether a run may be replayed from a point, and
 * what it would cost.
 *
 * Everything here is doubles but the two things a
 * decision is worthless without: the real compiler,
 * because the whole `generated-behind` check is a
 * byte comparison against what the compiler would
 * write, and the real boundary and trace grammar,
 * because a replay offered past a row the current
 * document would not write is a fork that ends in
 * an error the moment it runs.
 *
 * The project is a real directory with a real
 * `lib/` for the same reason: the manifest is
 * scanned, not stubbed.
 */

const LIB = `export async function loadPurchase(): Promise<void> {}
export async function evaluateRefund(): Promise<boolean> {
  return true;
}
export async function refundPayment(): Promise<void> {}
export async function updateOrder(): Promise<void> {}
export async function emailCustomer(): Promise<void> {}
export async function refuseRefund(): Promise<void> {}
`;

/**
 * The run the design is written around: a purchase
 * loaded, a refund decided in code, and three
 * blocks in a row after the arm that pays.
 */
const HERO = {
  $schema: 'https://mboss.dev/schemas/workflow-v1.json',
  version: 1,
  revision: 4,
  name: 'refund_flow',
  title: 'Refund flow',
  nodes: [
    {
      id: 'refund_requested',
      kind: 'trigger',
      title: 'Refund requested',
      config: { mode: 'manual' },
    },
    {
      id: 'load_purchase',
      kind: 'step',
      title: 'Load purchase',
      handler: { export: 'loadPurchase' },
      config: {},
    },
    {
      id: 'evaluate_refund',
      kind: 'branch',
      title: 'Evaluate refund',
      handler: { export: 'evaluateRefund' },
      config: {
        cases: [
          { port: 'yes', when: { path: '', op: 'eq', value: true } },
          { port: 'no', when: { path: '', op: 'eq', value: false } },
        ],
        elsePort: 'else',
      },
    },
    {
      id: 'refund_payment',
      kind: 'step',
      title: 'Refund payment',
      handler: { export: 'refundPayment' },
      config: {},
    },
    {
      id: 'update_order',
      kind: 'step',
      title: 'Update order',
      handler: { export: 'updateOrder' },
      config: {},
    },
    {
      id: 'refuse_refund',
      kind: 'step',
      title: 'Refuse refund',
      handler: { export: 'refuseRefund' },
      config: {},
    },
    {
      id: 'email_customer',
      kind: 'step',
      title: 'Email customer',
      handler: { export: 'emailCustomer' },
      forEach: { itemsPath: 'recipients' },
      config: {},
    },
  ],
  edges: [
    {
      id: 'e1',
      from: { node: 'refund_requested', port: 'out' },
      to: { node: 'load_purchase' },
    },
    {
      id: 'e2',
      from: { node: 'load_purchase', port: 'out' },
      to: { node: 'evaluate_refund' },
    },
    {
      id: 'e3',
      from: { node: 'evaluate_refund', port: 'yes' },
      to: { node: 'refund_payment' },
    },
    {
      id: 'e4',
      from: { node: 'refund_payment', port: 'out' },
      to: { node: 'update_order' },
    },
    {
      id: 'e5',
      from: { node: 'update_order', port: 'out' },
      to: { node: 'email_customer' },
    },
    {
      id: 'e6',
      from: { node: 'evaluate_refund', port: 'no' },
      to: { node: 'refuse_refund' },
    },
  ],
} as unknown as WorkflowIR;

const RUN: Run = {
  workflowId: 'run_a1',
  name: 'refund_flow',
  status: 'ERROR',
  recoveryAttempts: 1,
  executorId: 'local-dev',
  applicationVersion: 'v0.4.1',
  createdAt: 1000,
  startedAt: 1000,
  completedAt: 9000,
  error: 'StripeTimeoutError',
  forkedFrom: undefined,
  wasForkedFrom: false,
};

function step(over: Partial<Step> & { name: string }): Step {
  return {
    functionId: 0,
    startedAt: 1000,
    completedAt: 1100,
    output: '{}',
    error: undefined,
    childWorkflowId: undefined,
    ...over,
  };
}

/** The run as it stands when the payment threw:
 *  two rows recorded, and the failure. */
function recorded(): Step[] {
  return [
    step({ functionId: 0, name: 'load_purchase' }),
    step({ functionId: 1, name: 'evaluate_refund', output: 'true' }),
    step({
      functionId: 2,
      name: 'refund_payment',
      completedAt: undefined,
      output: undefined,
      error: 'StripeTimeoutError: timed out after 30000ms',
    }),
  ];
}

/** The same run, gone all the way through: the
 *  last block mails two people, so it recorded two
 *  rows and offers two points. */
function fannedOut(): Step[] {
  return [
    step({ functionId: 0, name: 'load_purchase' }),
    step({ functionId: 1, name: 'evaluate_refund', output: 'true' }),
    step({ functionId: 2, name: 'refund_payment' }),
    step({ functionId: 3, name: 'update_order' }),
    step({ functionId: 4, name: 'email_customer[0]' }),
    step({ functionId: 5, name: 'email_customer[1]', error: 'no mailbox' }),
  ];
}

/**
 * A project with the hero's code-behind and the
 * generated workflow the compiler would write from
 * the document.
 *
 * Written by compiling rather than by hand, because
 * the check under test is a byte comparison against
 * exactly this — a fixture typed out here would
 * only ever prove that two hand-written files
 * differ.
 */
function heroProject(over: { generated?: 'current' | 'behind' } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'mboss-replay-'));

  mkdirSync(join(dir, 'lib'), { recursive: true });
  mkdirSync(join(dir, 'src', 'workflows'), { recursive: true });
  writeFileSync(join(dir, 'lib', 'refund.ts'), LIB, 'utf8');

  const compiled = compileWorkflow({ ir: HERO, ...compileInputs(dir) });
  if (!compiled.ok) throw new Error('the hero fixture stopped compiling');

  writeFileSync(
    join(dir, compiled.path),
    over.generated === 'behind'
      ? '// what an older document generated\n'
      : compiled.source,
    'utf8',
  );

  return dir;
}

/** One project, scanned once: every case but the
 *  ones about a project's own state reads the same
 *  folder. */
const HERO_DIR = heroProject();

type Recorder = {
  deps: ReplayDeps;
  asked: ReplayQuestion[];
  followed: { workflowId: string; workflow: string; origin: RunOrigin }[];
  refusals: { workflowId: string; detail: string }[];
  calls: string[];
  client: ManagementClient & { forkedWith: unknown[] };
};

function recorder(
  over: Partial<ReplayDeps> & { answer?: ReplayAnswer } = {},
): Recorder {
  const asked: ReplayQuestion[] = [];
  const followed: Recorder['followed'] = [];
  const refusals: Recorder['refusals'] = [];
  const calls: string[] = [];
  const forkedWith: unknown[] = [];

  /** Moved by a rebuild, so a stale image becomes a
   *  fresh one the way a real one does. */
  let builtAt: number | undefined = 20_000;

  const client = {
    ...management(),
    forkWorkflow: async (
      workflowId: string,
      startStep: number,
      options?: unknown,
    ) => {
      calls.push('fork');
      forkedWith.push({ workflowId, startStep, options });

      return 'run_b7';
    },
    forkedWith,
  };

  const { answer, ...rest } = over;

  return {
    asked,
    followed,
    refusals,
    calls,
    client,
    deps: {
      project: () => HERO_DIR,
      connection: () => 'postgres://app@localhost:5432/app',
      openManagement: async () => {
        calls.push('openManagement');

        return client;
      },
      document: async (name) => (name === HERO.name ? HERO : undefined),
      compileInputs,
      projectSdk: () => ({ ok: true, version: '4.27.6' }),
      walk: () => [],
      stack: {
        builtAt: () => builtAt,
        render: () => ({
          available: true,
          services: [
            {
              service: 'app',
              state: 'running',
              health: 'healthy',
              detail: 'built 12 s ago',
            },
          ],
          busy: undefined,
          detail: undefined,
        }),
        rebuild: async () => {
          calls.push('rebuild');
          builtAt = 40_000;
        },
        up: async () => {
          calls.push('up');
          builtAt = 40_000;
        },
      },
      confirm: async (question) => {
        asked.push(question);

        return answer ?? { at: 'replay' };
      },
      follow: (workflowId, workflow, origin) =>
        void followed.push({ workflowId, workflow, origin }),
      refused: (workflowId, detail) =>
        void refusals.push({ workflowId, detail }),
      ...rest,
    },
  };
}

describe('deciding whether a run can be replayed from here', () => {
  it('refuses without a document', async () => {
    const decision = await decideReplay(
      recorder({ document: async () => undefined }).deps,
      RUN,
      recorded(),
      { nodeId: 'refund_payment' },
    );

    expect(decision).toEqual({
      at: 'unavailable',
      because: 'no-document',
      detail: messages.replayNoDocument('refund_flow'),
    });
  });

  /**
   * The extension reads columns and calls client
   * members the project's own SDK has to have
   * written. Older on this side is fine; newer is
   * asking for something that is not there.
   */
  it("refuses a project whose DBOS is older than the extension's", async () => {
    const decision = await decideReplay(
      recorder({ projectSdk: () => ({ ok: true, version: '4.0.1' }) }).deps,
      RUN,
      recorded(),
      { nodeId: 'refund_payment' },
    );

    expect(decision.at === 'unavailable' && decision.because).toBe('sdk-newer');
  });

  it('refuses a major SDK difference', async () => {
    const decision = await decideReplay(
      recorder({ projectSdk: () => ({ ok: true, version: '5.1.0' }) }).deps,
      RUN,
      recorded(),
      { nodeId: 'refund_payment' },
    );

    expect(decision.at === 'unavailable' && decision.because).toBe('sdk-major');
  });

  it('refuses without a lockfile', async () => {
    const decision = await decideReplay(
      recorder({
        projectSdk: () => ({ ok: false, because: 'no-lockfile' }),
      }).deps,
      RUN,
      recorded(),
      { nodeId: 'refund_payment' },
    );

    expect(decision).toEqual({
      at: 'unavailable',
      because: 'no-lockfile',
      detail: messages.replayNoLockfile(),
    });
  });

  /** DBOS's own rows are not points a workflow
   *  recorded, so nothing is offered for one. */
  it('refuses a row no boundary is offered for', async () => {
    const rows = [
      ...recorded(),
      step({ functionId: 3, name: 'DBOS.sleep', output: '1739880139200' }),
    ];
    const decision = await decideReplay(recorder().deps, RUN, rows, {
      functionId: 3,
    });

    expect(decision).toEqual({
      at: 'unavailable',
      because: 'not-offered',
      detail: messages.replayRowSdkOwned(),
    });
  });

  /**
   * Code generation is all or nothing per project,
   * so a document beside this one refusing is enough
   * to leave this one's file behind what it says.
   */
  it('refuses when the generated code is behind the document', async () => {
    const decision = await decideReplay(
      recorder({ project: () => heroProject({ generated: 'behind' }) }).deps,
      RUN,
      recorded(),
      { nodeId: 'refund_payment' },
    );

    expect(decision).toEqual({
      at: 'unavailable',
      because: 'generated-behind',
      detail: messages.replayGeneratedBehind('refund_flow'),
    });
  });

  it('refuses when the structure before this point changed', async () => {
    const rows = [
      step({ functionId: 0, name: 'check_policy' }),
      step({ functionId: 1, name: 'evaluate_refund', output: 'true' }),
      step({ functionId: 2, name: 'refund_payment', error: 'boom' }),
    ];
    const decision = await decideReplay(recorder().deps, RUN, rows, {
      functionId: 2,
    });

    expect(decision.at).toBe('unavailable');
    if (decision.at !== 'unavailable') return;

    expect(decision.because).toBe('structure-changed');
    expect(decision.detail).toContain('check_policy');
    expect(decision.detail).toContain('load_purchase');
  });

  /**
   * Opening a management client is itself a
   * connection to somebody's database. A decision
   * that has already refused has nothing to open one
   * for.
   */
  it('never opens a client for a skewed SDK', async () => {
    const held = recorder({
      projectSdk: () => ({ ok: true, version: '5.1.0' }),
    });

    await offerReplay(held.deps, RUN, recorded(), {
      nodeId: 'refund_payment',
    });

    expect(held.calls).toEqual([]);
    expect(held.followed).toEqual([]);
  });

  it('never forks a stale image before the rebuild resolved', async () => {
    const held = recorder({
      answer: { at: 'rebuild' },
      walk: () => [{ path: 'lib/refund.ts', changedAt: 30_000 }],
    });

    await offerReplay(held.deps, RUN, recorded(), {
      nodeId: 'refund_payment',
    });

    expect(held.calls).toEqual(['rebuild', 'openManagement', 'fork']);
  });

  /** A fork against the image the failure came from
   *  answers exactly as the failure did. */
  it('forks nothing when the rebuild failed', async () => {
    const held = recorder({
      answer: { at: 'rebuild' },
      walk: () => [{ path: 'lib/refund.ts', changedAt: 30_000 }],
      stack: {
        builtAt: () => 20_000,
        render: () => ({
          available: true,
          services: [
            {
              service: 'app',
              state: 'running',
              health: 'healthy',
              detail: 'built 12 s ago',
            },
          ],
          busy: undefined,
          detail: undefined,
        }),
        // A rebuild that changed nothing: the image
        // is still older than the edit.
        rebuild: async () => undefined,
        up: async () => undefined,
      },
    });

    const outcome = await offerReplay(held.deps, RUN, recorded(), {
      nodeId: 'refund_payment',
    });

    expect(outcome).toEqual({
      at: 'stopped',
      note: messages.replayRebuildFailed(),
    });
    expect(held.followed).toEqual([]);
  });

  it('writes the session row before the fork call', async () => {
    const held = recorder();
    const order: string[] = [];
    const deps: ReplayDeps = {
      ...held.deps,
      follow: (workflowId, workflow, origin) => {
        order.push('follow');
        held.deps.follow(workflowId, workflow, origin);
      },
      openManagement: async (url) => {
        order.push('openManagement');

        return await held.deps.openManagement(url);
      },
    };

    await offerReplay(deps, RUN, recorded(), { nodeId: 'refund_payment' });

    expect(order).toEqual(['follow', 'openManagement']);
  });

  it('carries what the row was forked from', async () => {
    const held = recorder();

    await offerReplay(held.deps, RUN, recorded(), {
      nodeId: 'refund_payment',
    });

    expect(held.followed).toEqual([
      {
        workflowId: expect.any(String) as unknown as string,
        workflow: 'refund_flow',
        origin: {
          via: 'replay',
          replayOf: { workflowId: 'run_a1', functionId: 2 },
        },
      },
    ]);
  });

  /**
   * Left to itself DBOS mints the id and hands it
   * back only once the run exists, which is a run
   * executing that nothing on screen names.
   */
  it('passes the id it minted', async () => {
    const held = recorder();

    await offerReplay(held.deps, RUN, recorded(), {
      nodeId: 'refund_payment',
    });

    expect(held.client.forkedWith).toEqual([
      {
        workflowId: 'run_a1',
        startStep: 2,
        options: {
          applicationVersion: 'v0.4.1',
          newWorkflowID: held.followed[0]?.workflowId,
        },
      },
    ]);
  });

  it('lists Refund payment, Update order and Email customer ahead of a replay from Refund payment', async () => {
    const decision = await decideReplay(recorder().deps, RUN, recorded(), {
      nodeId: 'refund_payment',
    });

    expect(decision.at === 'available' && decision.willExecute).toEqual([
      'Refund payment',
      'Update order',
      'Email customer',
    ]);
    expect(decision.at === 'available' && decision.decides).toBeUndefined();
    expect(decision.at === 'available' && decision.reused).toEqual([
      'Load purchase',
      'Evaluate refund',
    ]);
  });

  /**
   * A branch's way out is a value nothing recorded,
   * so what runs after it is not something anybody
   * can know from the ledger.
   */
  it('lists Load purchase then says Evaluate refund decides', async () => {
    const decision = await decideReplay(recorder().deps, RUN, recorded(), {
      nodeId: 'load_purchase',
    });

    expect(decision.at === 'available' && decision.willExecute).toEqual([
      'Load purchase',
    ]);
    expect(decision.at === 'available' && decision.decides).toEqual({
      title: 'Evaluate refund',
      how: 'branch',
    });
    expect(decision.at === 'available' && decision.reused).toEqual([]);
  });

  /** A trigger records no row, so nothing it did is
   *  among what a fork copies. */
  it('never puts a trigger in the reused list', async () => {
    const decision = await decideReplay(recorder().deps, RUN, recorded(), {
      nodeId: 'refund_payment',
    });

    expect(
      decision.at === 'available' &&
        decision.reused.includes('Refund requested'),
    ).toBe(false);
  });

  it('offers no Choose when the block has one boundary', async () => {
    const held = recorder();

    await offerReplay(held.deps, RUN, recorded(), {
      nodeId: 'refund_payment',
    });

    expect(held.asked[0]?.actions.map((one) => one.at)).toEqual(['replay']);
  });

  /** Two rows of one block — a fan-out's items, a
   *  loop's rounds — are two points, and which one a
   *  person means is theirs to say. */
  it('offers Choose when the block has two', async () => {
    const held = recorder();

    await offerReplay(held.deps, RUN, fannedOut(), {
      nodeId: 'email_customer',
    });

    expect(held.asked[0]?.actions.map((one) => one.at)).toEqual([
      'replay',
      'choose',
    ]);
    expect(held.asked[0]?.boundaries).toEqual([
      { functionId: 4, label: 'Email customer · item 0' },
      { functionId: 5, label: 'Email customer · item 1' },
    ]);
  });

  it('starts the fork at the boundary a person picked', async () => {
    let asked = 0;
    const held = recorder();
    const deps: ReplayDeps = {
      ...held.deps,
      // First the modal, then the point they named.
      confirm: async (question) => {
        held.asked.push(question);
        asked += 1;

        return asked === 1 ? { at: 'choose', functionId: 5 } : { at: 'replay' };
      },
    };
    await offerReplay(deps, RUN, fannedOut(), { nodeId: 'email_customer' });

    expect(held.followed[0]?.origin.replayOf?.functionId).toBe(5);
    expect(
      (held.client.forkedWith[0] as { startStep: number } | undefined)
        ?.startStep,
    ).toBe(5);
  });
});

/**
 * The modal, whole.
 *
 * Pinned as one string rather than field by field
 * because it is a thing somebody reads: the two
 * lists and the sentence under them are the whole
 * of what a person decides on, and a case that
 * asserted each part separately would pass while
 * the dialog read as nonsense.
 */
describe('what the modal says', () => {
  it('draws the two lists and what the point resolves to', async () => {
    const decision = await decideReplay(recorder().deps, RUN, recorded(), {
      nodeId: 'refund_payment',
    });

    expect(replayQuestion(RUN, decision).title).toBe(
      'Replay from Refund payment?',
    );
    expect(replayQuestion(RUN, decision).detail).toBe(
      [
        'Creates a new DBOS execution from this step. Earlier durable ' +
          'results are reused, not re-executed.',
        '',
        'reused · recorded',
        '  ↺ Load purchase',
        '  ↺ Evaluate refund',
        '',
        'will execute',
        '  → Refund payment',
        '  → Update order',
        '  → Email customer',
        '',
        "resolves to the durable operation's DBOS function id · available " +
          'while the structure before this point is unchanged — structural ' +
          'edits need a new run',
      ].join('\n'),
    );
  });

  it("says nothing was recorded before the run's first operation", async () => {
    const decision = await decideReplay(recorder().deps, RUN, recorded(), {
      nodeId: 'load_purchase',
    });

    expect(replayQuestion(RUN, decision).detail).toContain(
      "nothing — this is the run's first durable operation",
    );
    expect(replayQuestion(RUN, decision).detail).toContain(
      'then Evaluate refund decides',
    );
  });

  it('names the file the running app was built before', async () => {
    const decision = await decideReplay(
      recorder({
        walk: () => [{ path: 'lib/refund.ts', changedAt: 30_000 }],
      }).deps,
      RUN,
      recorded(),
      { nodeId: 'refund_payment' },
    );

    expect(replayQuestion(RUN, decision).detail).toContain(
      'The running app was built before your change to lib/refund.ts.',
    );
    expect(replayQuestion(RUN, decision).actions.map((one) => one.at)).toEqual([
      'rebuild',
    ]);
  });

  it('offers to start a stack that is not running', async () => {
    const decision = await decideReplay(
      recorder({
        stack: {
          builtAt: () => 20_000,
          render: () => ({
            available: true,
            services: [
              {
                service: 'app',
                state: 'exited',
                health: 'none',
                detail: 'built 3 h ago',
              },
            ],
            busy: undefined,
            detail: undefined,
          }),
          rebuild: async () => undefined,
          up: async () => undefined,
        },
      }).deps,
      RUN,
      recorded(),
      { nodeId: 'refund_payment' },
    );

    expect(replayQuestion(RUN, decision).detail).toContain(
      'The local stack is not running.',
    );
    expect(replayQuestion(RUN, decision).actions.map((one) => one.at)).toEqual([
      'start',
    ]);
  });

  /** A refusal offers the one thing that is still
   *  on the table. */
  it('offers a fresh run when the replay is not on offer', async () => {
    const decision = await decideReplay(
      recorder({ document: async () => undefined }).deps,
      RUN,
      recorded(),
      { nodeId: 'refund_payment' },
    );
    const question = replayQuestion(RUN, decision);

    expect(question.detail).toBe(messages.replayNoDocument('refund_flow'));
    expect(question.actions.map((one) => one.at)).toEqual(['again']);
  });
});
