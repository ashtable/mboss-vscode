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

    frame.send({ type: 'replay', functionId: 3 });
    frame.send({ type: 'stackUp' });
    frame.send('nonsense');

    expect(heard).toEqual([{ type: 'replay', functionId: 3 }]);
  });
});

describe('what each view may say', () => {
  it('always includes that it has mounted', () => {
    for (const view of [
      'canvas',
      'sidebar',
      'runs',
      'see',
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
    ready: ['canvas', 'sidebar', 'runs', 'see', 'gallery'],

    select: ['canvas'],
    inspectorMode: ['canvas'],
    connect: ['canvas'],
    addNode: ['canvas'],
    move: ['canvas'],
    arrange: ['canvas'],
    delete: ['canvas'],
    edit: ['canvas'],
    assign: ['canvas'],
    text: ['canvas'],

    prompt: ['sidebar'],
    cancel: ['sidebar'],
    permission: ['sidebar'],
    chooseAgent: ['sidebar'],
    approve: ['sidebar'],
    undo: ['sidebar'],
    keepFile: ['sidebar'],
    undoFile: ['sidebar'],

    runFilter: ['runs'],
    runRefresh: ['runs'],
    runSelect: ['runs'],
    copyRunId: ['runs'],
    stackUp: ['runs'],
    stackDown: ['runs'],
    stackRebuild: ['runs'],
    selectWorkflow: ['runs'],
    runWorkflow: ['runs'],
    rerun: ['runs'],
    askAgent: ['runs'],
    openRun: ['runs'],
    openProduction: ['runs'],

    stepSelect: ['see'],
    replay: ['see'],
    seeShow: ['see'],
    seeNode: ['see'],
    seeRaw: ['see'],
    seeRefresh: ['see'],
    openWorkflow: ['see'],

    usePattern: ['gallery'],
    startBlank: ['gallery'],
  };

  /** One message of each kind that ought to parse
   *  wherever its kind is listed. */
  const SAMPLE: Record<string, Record<string, unknown>> = {
    ready: {},

    select: { nodeId: 'find_slot' },
    inspectorMode: { mode: 'evidence' },
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
    edit: { baseRevision: 3, node: { id: 'find_slot' } },
    assign: { baseRevision: 3, nodeId: 'find_slot', export: 'findSlot' },
    text: { text: '{}' },

    prompt: { text: 'why did it fail?' },
    cancel: {},
    permission: { optionId: 'opt_1', kind: 'allow_once' },
    chooseAgent: {},
    approve: { proposalId: 'p_1' },
    undo: {},
    keepFile: { id: 'f_1' },
    undoFile: { id: 'f_1' },

    runFilter: { filter: 'failed' },
    runRefresh: {},
    runSelect: { workflowId: 'wf_c9d2f3' },
    copyRunId: { workflowId: 'wf_c9d2f3' },
    stackUp: {},
    stackDown: {},
    stackRebuild: {},
    selectWorkflow: { workflow: 'groom_booking' },
    runWorkflow: { workflow: 'groom_booking', input: '{}' },
    rerun: { workflowId: 'wf_c9d2f3' },
    askAgent: { workflowId: 'wf_c9d2f3' },
    openRun: { workflowId: 'wf_c9d2f3' },
    openProduction: {},

    stepSelect: { functionId: 2 },
    replay: { functionId: 2 },
    seeShow: { tab: 'trace' },
    seeNode: { nodeId: 'find_slot' },
    seeRaw: { raw: true },
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
