import { describe, expect, it } from 'vitest';

import { fakeWebview } from '../../test/doubles/webview.js';
import { emitter } from '../emitter.js';
import { seeInit } from '../runs/view.js';

import type { WebviewName } from './entry.js';
import {
  messageSchemaFor,
  mountWebview,
  type Heard,
  type Source,
} from './host.js';

/**
 * The one mount path, driven the way a provider
 * drives it.
 *
 * Four surfaces share this loop, and the bugs it
 * exists for are silent: a hidden frame repainted
 * for nothing, a listener left on a store after the
 * frame it fed was disposed, a message from another
 * view reaching a handler that never expected it.
 * Each is asked here once, against a fake frame,
 * rather than once per provider.
 */

const extensionUri = { path: '/ext' } as never;

function mounted(
  over: { follows?: Source[]; heard?: (message: Heard<'see'>) => void } = {},
) {
  const frame = fakeWebview();
  const mount = mountWebview(frame.panel, {
    extensionUri,
    view: 'see',
    title: 'See',
    init: () => seeInit(undefined),
    ...over,
  });

  return { frame, mount };
}

describe('a mounted webview', () => {
  it('answers ready with what to draw', () => {
    const { frame } = mounted();

    frame.send({ type: 'ready' });

    expect(frame.posted).toEqual([seeInit(undefined)]);
  });

  it('repaints while showing when something it follows changes', () => {
    const changes = emitter();
    const { frame } = mounted({ follows: [(repaint) => changes.on(repaint)] });

    changes.fire();

    expect(frame.posted).toEqual([seeInit(undefined)]);
  });

  /**
   * A hidden frame has no page to draw on: the
   * editor tears the page down and the view says
   * `ready` again when it is shown, which is when
   * the picture is sent.
   */
  it('leaves a hidden frame alone', () => {
    const changes = emitter();
    const { frame } = mounted({ follows: [(repaint) => changes.on(repaint)] });

    frame.hide();
    changes.fire();

    expect(frame.posted).toEqual([]);

    frame.show();
    changes.fire();

    expect(frame.posted).toHaveLength(1);
  });

  it('lets go of every source once the frame is gone', () => {
    const one = emitter();
    const two = emitter();
    const { frame } = mounted({
      follows: [(repaint) => one.on(repaint), (repaint) => two.on(repaint)],
    });

    frame.close();
    one.fire();
    two.fire();

    expect(frame.posted).toEqual([]);
  });

  it('hands its provider the repaint', () => {
    const { frame, mount } = mounted();

    mount.repaint();

    expect(frame.posted).toEqual([seeInit(undefined)]);
  });

  it('hears what its own view says, and nothing another view does', () => {
    const heard: Heard<'see'>[] = [];
    const { frame } = mounted({ heard: (message) => heard.push(message) });

    frame.send({ type: 'stepSelect', functionId: 3 });
    frame.send({ type: 'stackUp' });
    frame.send('nonsense');

    expect(heard).toEqual([{ type: 'stepSelect', functionId: 3 }]);
  });
});

describe('what each view may say', () => {
  it('always includes that it has mounted', () => {
    for (const view of [
      'canvas',
      'sidebar',
      'runs',
      'see',
      'inspector',
      'gallery',
    ] as const) {
      expect(messageSchemaFor(view).safeParse({ type: 'ready' }).success).toBe(
        true,
      );
    }
  });

  /**
   * Which views each kind parses on, written out by
   * hand.
   *
   * By hand on purpose: derived from the registry
   * this would assert that the registry equals
   * itself. Written here, a kind added to the wrong
   * view's union is a failure, and so is a kind
   * added to no row at all — the case below holds
   * the table complete.
   *
   * A kind belongs to every view whose bundle posts
   * it, and two views can post the same one: the
   * run page and the list both open a run.
   */
  const POSTS: Record<string, readonly WebviewName[]> = {
    ready: ['canvas', 'sidebar', 'runs', 'see', 'inspector', 'gallery'],

    select: ['canvas'],
    inspectorMode: ['inspector'],
    openFunction: ['inspector'],
    openErrorLocation: ['inspector'],
    openOutput: ['inspector'],
    connect: ['canvas'],
    addNode: ['canvas'],
    move: ['canvas'],
    arrange: ['canvas'],
    delete: ['canvas'],
    edit: ['inspector'],
    assign: ['canvas', 'inspector'],
    text: ['canvas'],

    prompt: ['sidebar'],
    cancel: ['sidebar'],
    permission: ['sidebar'],
    chooseAgent: ['sidebar'],
    approve: ['sidebar'],
    undo: ['sidebar'],
    keepFile: ['sidebar'],
    undoFile: ['sidebar'],
    attach: ['sidebar'],
    detach: ['sidebar'],

    runFilter: ['runs'],
    runRefresh: ['runs'],
    runSelect: ['runs', 'see'],
    copyRunId: ['runs'],
    stackUp: ['runs'],
    stackRebuild: ['runs'],
    selectWorkflow: ['runs'],
    // Only the Runs view's input box writes a run's
    // input.
    runInput: ['runs'],
    runWorkflow: ['runs'],
    askAgent: ['runs', 'inspector'],
    // About a block as it is set, rather than about
    // anything a run recorded, so only the pane that
    // sets a block asks it.
    askAboutBlock: ['inspector'],
    openRun: ['runs', 'canvas', 'sidebar', 'inspector'],
    openProduction: ['runs'],
    // Where to read about Conductor, offered by the
    // list's footer in a window with no console.
    learnConductor: ['runs'],
    replayRun: ['runs'],

    // Distinct from `cancel`, which is the side
    // bar's own kind for stopping an agent's turn.
    cancelRun: ['runs', 'inspector'],
    resumeRun: ['runs', 'inspector'],
    openInput: ['inspector'],

    // A trigger's card starts its workflow with the
    // Runs input and opens that input to read.
    runTrigger: ['inspector'],
    openRunInput: ['inspector'],

    // Only a trigger's face asks to be shown the
    // whole run, and only the Inspector draws one.
    inspectRun: ['inspector'],

    stepSelect: ['see'],
    replayFrom: ['inspector', 'sidebar'],

    // The Inspector alone draws the card that reads
    // a queue block, from whichever surface picked
    // the block.
    inspectQueue: ['inspector'],
    seeShow: ['see'],
    seeNode: ['see'],
    seeRefresh: ['see'],
    openWorkflow: ['see'],

    usePattern: ['gallery'],
    startBlank: ['gallery'],
  };

  /**
   * The block the Inspector's own messages are
   * about: the surface it was picked on, the
   * document it is in and its id.
   */
  const ABOUT = {
    source: 'canvas',
    path: '/work/grooming/.mboss/workflows/groom_booking.workflow.json',
    nodeId: 'find_slot',
  };

  /** One message of each kind that ought to parse
   *  wherever its kind is listed. */
  const SAMPLE: Record<string, Record<string, unknown>> = {
    ready: {},

    select: { nodeId: 'find_slot' },
    inspectorMode: { mode: 'evidence', about: ABOUT },
    openFunction: { nodeId: 'find_slot', about: ABOUT },
    openErrorLocation: { nodeId: 'find_slot', functionId: 2, about: ABOUT },
    openOutput: { workflowId: 'wf_c9d2f3', functionId: 2, about: ABOUT },
    connect: {
      baseRevision: 3,
      from: { node: 'find_slot' },
      to: { node: 'book_appointment' },
    },
    addNode: {
      baseRevision: 3,
      kind: 'step',
      position: { x: 10, y: 20 },
    },
    move: { baseRevision: 3, positions: { find_slot: { x: 1, y: 2 } } },
    arrange: { baseRevision: 3 },
    delete: { baseRevision: 3, nodeIds: ['find_slot'], edgeIds: ['e2'] },
    edit: { baseRevision: 3, node: { id: 'find_slot' }, about: ABOUT },
    assign: {
      baseRevision: 3,
      nodeId: 'find_slot',
      export: 'findSlot',
      about: ABOUT,
    },
    text: { text: '{}' },

    prompt: { text: 'why did it fail?' },
    cancel: {},
    permission: { optionId: 'opt_1', kind: 'allow_once' },
    chooseAgent: {},
    approve: { proposalId: 'p_1' },
    undo: {},
    keepFile: { id: 'f_1' },
    undoFile: { id: 'f_1' },
    attach: {},
    detach: { uri: 'file:///project/lib/a.ts' },

    runFilter: { filter: 'failed' },
    runRefresh: {},
    runSelect: { workflowId: 'wf_c9d2f3' },
    copyRunId: { workflowId: 'wf_c9d2f3' },
    stackUp: {},
    stackRebuild: {},
    selectWorkflow: { workflow: 'groom_booking' },
    runInput: { workflow: 'groom_booking', text: '{}' },
    runWorkflow: { workflow: 'groom_booking' },
    askAgent: { workflowId: 'wf_c9d2f3' },
    askAboutBlock: {
      workflow: 'groom_booking',
      nodeId: 'find_slot',
      about: ABOUT,
    },
    openRun: { workflowId: 'wf_c9d2f3' },
    openProduction: {},
    learnConductor: {},
    replayRun: { workflowId: 'wf_c9d2f3' },
    cancelRun: { workflowId: 'wf_c9d2f3' },
    resumeRun: { workflowId: 'wf_c9d2f3' },
    openInput: { workflowId: 'wf_c9d2f3' },
    runTrigger: { workflow: 'groom_booking' },
    openRunInput: {},
    inspectRun: { about: ABOUT },

    stepSelect: { functionId: 2 },
    replayFrom: { workflowId: 'wf_c9d2f3', functionId: 2 },
    inspectQueue: { workflowId: 'wf_c9d2f3', nodeId: 'index_pages' },
    seeShow: { tab: 'trace' },
    seeNode: { nodeId: 'find_slot' },
    seeRefresh: {},
    openWorkflow: { workflowId: 'wf_c9d2f3' },

    usePattern: { name: 'refund_approval' },
    startBlank: {},
  };

  const VIEWS: readonly WebviewName[] = [
    'canvas',
    'sidebar',
    'runs',
    'see',
    'inspector',
    'gallery',
  ];

  it('parses on exactly the views the registry lists', () => {
    for (const [kind, views] of Object.entries(POSTS)) {
      const said = { type: kind, ...SAMPLE[kind] };

      for (const view of VIEWS) {
        expect({
          kind,
          view,
          parses: messageSchemaFor(view).safeParse(said).success,
        }).toEqual({ kind, view, parses: views.includes(view) });
      }
    }
  });

  /**
   * A replay names where it starts: a block, a row
   * picked on the run tab, or the run's start. A
   * message naming none of the three addresses
   * nothing at all.
   */
  it('refuses a replay that names no block, row or start', () => {
    const inspector = messageSchemaFor('inspector');
    const replay = { type: 'replayFrom', workflowId: 'wf_c9d2f3' };

    expect(inspector.safeParse(replay).success).toBe(false);
    expect(
      inspector.safeParse({ ...replay, nodeId: 'refund_payment' }).success,
    ).toBe(true);
    expect(inspector.safeParse({ ...replay, functionId: 3 }).success).toBe(
      true,
    );
    expect(inspector.safeParse({ ...replay, from: 'start' }).success).toBe(
      true,
    );
    expect(inspector.safeParse({ ...replay, from: 'end' }).success).toBe(false);
  });

  /**
   * The list offers a replay from the step a run
   * failed at or from its start, and says which. A
   * list that names neither still asks for the
   * run's own default, and a point that is neither
   * is not one.
   */
  it('carries a list replay’s pick', () => {
    const runs = messageSchemaFor('runs');
    const replay = { type: 'replayRun', workflowId: 'wf_c9d2f3' };

    expect(runs.parse({ ...replay, functionId: 3 })).toEqual({
      ...replay,
      functionId: 3,
    });
    expect(runs.parse({ ...replay, from: 'start' })).toEqual({
      ...replay,
      from: 'start',
    });
    expect(runs.safeParse({ ...replay, from: 'end' }).success).toBe(false);
    expect(runs.safeParse({ ...replay, functionId: 1.5 }).success).toBe(false);
    expect(runs.parse(replay)).toEqual(replay);
  });

  /**
   * The pane draws whichever canvas or run tab was
   * last in front, and which that is can change
   * between a message being made in the pane and it
   * arriving. So every message about a block says
   * which block, and one that says nothing is not a
   * message the host can send anywhere.
   *
   * The canvas's own drop is the exception: a
   * function dropped on a block is made on the board
   * it lands on, which is the surface that sent it.
   */
  it('refuses a message about a block that names no block', () => {
    const inspector = messageSchemaFor('inspector');
    const kinds = [
      'inspectorMode',
      'edit',
      'assign',
      'openFunction',
      'openErrorLocation',
      'openOutput',
      'askAboutBlock',
      'inspectRun',
    ];

    /** That kind's message, saying nothing about
     *  which block it is. */
    const unnamed = (kind: string): Record<string, unknown> => {
      const said: Record<string, unknown> = { type: kind, ...SAMPLE[kind] };
      delete said['about'];

      return said;
    };

    for (const kind of kinds) {
      expect({
        kind,
        parses: inspector.safeParse(unnamed(kind)).success,
      }).toEqual({ kind, parses: false });
    }

    expect(
      messageSchemaFor('canvas').safeParse(unnamed('assign')).success,
    ).toBe(true);
  });

  /**
   * The Runs view's input box is the one place a
   * run's input is written. A start names only the
   * workflow, and an input a stale bundle still
   * sends with one is dropped before any handler
   * sees it.
   */
  it('carries no input on a start', () => {
    expect(
      messageSchemaFor('runs').parse({
        type: 'runWorkflow',
        workflow: 'groom_booking',
        input: '{"n":1}',
      }),
    ).toEqual({ type: 'runWorkflow', workflow: 'groom_booking' });
    expect(
      messageSchemaFor('inspector').parse({
        type: 'runTrigger',
        workflow: 'groom_booking',
        input: '{"n":1}',
      }),
    ).toEqual({ type: 'runTrigger', workflow: 'groom_booking' });
  });

  /**
   * A click on the graph's background picks nothing,
   * and the run tab has to be able to say so.
   */
  it('lets the run graph say nothing is picked', () => {
    const see = messageSchemaFor('see');

    expect(see.safeParse({ type: 'seeNode', nodeId: null }).success).toBe(true);
    expect(see.safeParse({ type: 'seeNode' }).success).toBe(false);
  });

  /**
   * A drop is one gesture or the other. Splicing
   * decides where the block sits without anybody
   * being asked which way out of a block to leave
   * by, so a message claiming to be both used to
   * make the host ask a question and then throw the
   * answer away. It does not parse now.
   */
  it("refuses a drop that is both a splice and a wire's end", () => {
    const canvas = messageSchemaFor('canvas');
    const drop = { type: 'addNode', ...SAMPLE['addNode'] };

    expect(canvas.safeParse({ ...drop, spliceEdge: 'e2' }).success).toBe(true);
    expect(
      canvas.safeParse({ ...drop, connectFrom: { node: 'find_slot' } }).success,
    ).toBe(true);
    expect(
      canvas.safeParse({
        ...drop,
        spliceEdge: 'e2',
        connectFrom: { node: 'find_slot' },
      }).success,
    ).toBe(false);
  });

  /**
   * And the table covers every kind the registry
   * carries, so a kind added without a row here
   * fails rather than going unchecked.
   */
  it('has a row for every kind the registry carries', () => {
    const carried = new Set(
      VIEWS.flatMap((view) =>
        [...messageSchemaFor(view).options].map(
          (option) => (option.shape.type as { value: string }).value,
        ),
      ),
    );

    expect([...carried].sort()).toEqual(Object.keys(POSTS).sort());
  });
});
