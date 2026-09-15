import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { fakeWebview } from '../../test/doubles/webview.js';
import type { CanvasSession, SubjectInputs } from '../canvas/editor.js';
import { canvasSessions } from '../canvas/sessions.js';
import { inspectorWords } from '../canvas/words.js';
import { WorkflowIRSchema } from '../core/rules.js';
import { liveRun } from '../test-support/runs.js';
import type { InspectorInit } from '../webview/protocol.js';

import { inspectorFocus } from './focus.js';
import { InspectorView, type InspectorRuns } from './view.js';

/**
 * The Inspector's provider, driven the way a
 * mounted frame drives it.
 *
 * What it draws is worked out in `subject.ts`.
 * What is asked here is what it follows: which
 * surface is in front, and that surface moving —
 * and that a surface it is not about moving leaves
 * the person in the Inspector alone. Then where
 * what the pane says goes, and when the pane puts
 * itself in front of somebody.
 */

const extensionUri = { path: '/ext' } as never;

const ir = WorkflowIRSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          '../../mboss-core/fixtures/ir/groom_booking.workflow.json',
          import.meta.url,
        ),
      ),
      'utf8',
    ),
  ),
);

/**
 * A canvas session answering only what the
 * Inspector reads of one and asks of one, with
 * every verb it was asked written down in order.
 * The face it is asked for is the face it then
 * answers with, as a real session's is.
 */
function session(file: string, over: Partial<SubjectInputs> = {}) {
  const did: unknown[][] = [];
  const inputs: SubjectInputs = {
    file,
    workflow: file.replace(/\.workflow\.json$/, ''),
    read: { ok: true, ir },
    revision: ir.revision,
    manifest: undefined,
    diagnostics: [],
    selected: undefined,
    mode: 'configure',
    run: undefined,
    decided: {},
    ...over,
  };
  const verb =
    (name: string) =>
    async (...args: unknown[]): Promise<void> => {
      did.push([name, ...args]);
    };

  const canvas = {
    subjectInputs: () => ({ ...inputs }),
    edit: verb('edit'),
    chooseMode: (mode: SubjectInputs['mode']) => {
      did.push(['chooseMode', mode]);
      inputs.mode = mode;
    },
    openFunction: verb('openFunction'),
    openErrorLocation: verb('openErrorLocation'),
    openOutput: verb('openOutput'),
    select: verb('select'),
  } as unknown as CanvasSession;

  return { canvas, inputs, did };
}

function mounted(
  options: { showing?: () => boolean; resolved?: boolean } = {},
) {
  const frame = fakeWebview();
  const focus = inspectorFocus();
  const sessions = canvasSessions();
  const asked: unknown[][] = [];
  const host = { met: 0, meetInspector: () => void (host.met += 1) };
  const runs: InspectorRuns = {
    detail: () => undefined,
    openRun: async (workflowId) => void asked.push(['openRun', workflowId]),
    replay: async (workflowId, picked) =>
      void asked.push(['replay', workflowId, picked]),
    askAgent: async (ask) => void asked.push(['askAgent', ask]),
    inspectQueue: async (workflowId, nodeId) =>
      void asked.push(['inspectQueue', workflowId, nodeId]),
  };

  const view = new InspectorView(
    extensionUri,
    focus,
    sessions,
    runs,
    host,
    options.showing ?? (() => true),
  );

  if (options.resolved ?? true) view.resolveWebviewView(frame.panel);

  const inits = () => frame.posted as InspectorInit[];
  const subjects = () => inits().map((init) => init.subject);

  return { frame, focus, sessions, asked, host, view, subjects };
}

describe('the Inspector view', () => {
  it('answers ready with what to draw', () => {
    const { frame } = mounted();

    frame.send({ type: 'ready' });

    expect(frame.posted).toEqual([
      {
        type: 'init',
        view: 'inspector',
        strings: inspectorWords(),
        subject: { at: 'none', file: undefined },
      },
    ]);
  });

  it('draws again when focus moves', () => {
    const { focus, subjects } = mounted();
    const { canvas } = session('groom_booking.workflow.json');

    focus.report({ at: 'canvas', session: canvas });
    focus.report({ at: 'run' });

    expect(subjects()).toEqual([
      { at: 'none', file: 'groom_booking.workflow.json' },
      { at: 'none', file: undefined },
    ]);
  });

  it('draws again when the canvas it is about moves, and for no other', () => {
    const { focus, sessions, subjects } = mounted();
    const front = session('groom_booking.workflow.json').canvas;
    const behind = session('refund_approval.workflow.json').canvas;

    focus.report({ at: 'canvas', session: front });
    sessions.fire(behind);

    expect(subjects()).toHaveLength(1);

    sessions.fire(front);

    expect(subjects()).toEqual([
      { at: 'none', file: 'groom_booking.workflow.json' },
      { at: 'none', file: 'groom_booking.workflow.json' },
    ]);
  });

  /**
   * Two canvases hold two selections and two faces.
   * The pane draws whichever came forward last, and
   * going back to the other finds it as it was left.
   */
  it('draws the canvas that has focus, and keeps each canvas’s own', () => {
    const { focus, subjects } = mounted();
    const first = session('groom_booking.workflow.json', {
      selected: 'find_slot',
    });
    const second = session('groom_booking.workflow.json', {
      selected: 'book_appointment',
      mode: 'evidence',
      run: liveRun({ workflow: 'groom_booking' }),
    });

    focus.report({ at: 'canvas', session: second.canvas });

    expect(subjects().at(-1)).toMatchObject({
      at: 'block',
      block: { nodeId: 'book_appointment', face: 'evidence' },
    });

    focus.report({ at: 'canvas', session: first.canvas });

    expect(subjects().at(-1)).toMatchObject({
      at: 'block',
      block: { nodeId: 'find_slot', face: 'configure' },
    });
  });
});

describe('what a canvas subject says, and where it goes', () => {
  /** The pane mounted about one canvas in front. */
  function about() {
    const pane = mounted();
    const canvas = session('groom_booking.workflow.json', {
      selected: 'find_slot',
      mode: 'evidence',
      run: liveRun({ workflow: 'groom_booking' }),
    });

    pane.focus.report({ at: 'canvas', session: canvas.canvas });

    return { ...pane, canvas };
  }

  it('picks the face on the canvas it came from, and draws it', () => {
    const { frame, canvas, subjects } = about();

    frame.send({ type: 'inspectorMode', mode: 'configure' });

    expect(canvas.did).toEqual([['chooseMode', 'configure']]);
    expect(subjects().at(-1)).toMatchObject({
      at: 'block',
      block: { face: 'configure' },
    });
  });

  it('edits through that canvas', () => {
    const { frame, canvas } = about();
    const node = { id: 'find_slot', title: 'Find a slot' };

    frame.send({ type: 'edit', view: 'inspector', baseRevision: 3, node });
    frame.send({
      type: 'assign',
      view: 'inspector',
      baseRevision: 3,
      nodeId: 'find_slot',
      export: 'findSlot',
    });

    expect(canvas.did).toEqual([
      ['edit', { type: 'edit', baseRevision: 3, node }],
      [
        'edit',
        {
          type: 'assign',
          baseRevision: 3,
          nodeId: 'find_slot',
          export: 'findSlot',
        },
      ],
    ]);
  });

  it('opens the block’s function through that canvas', () => {
    const { frame, canvas } = about();

    frame.send({ type: 'openFunction', nodeId: 'find_slot' });

    expect(canvas.did).toEqual([['openFunction', 'find_slot']]);
  });

  it('opens the line a failure came from through that canvas', () => {
    const { frame, canvas } = about();

    frame.send({
      type: 'openErrorLocation',
      nodeId: 'find_slot',
      functionId: 3,
    });

    expect(canvas.did).toEqual([['openErrorLocation', 'find_slot', 3]]);
  });

  it('opens a recorded output through that canvas', () => {
    const { frame, canvas } = about();

    frame.send({ type: 'openOutput', workflowId: 'wf_1', functionId: 3 });

    expect(canvas.did).toEqual([['openOutput', 'wf_1', 3]]);
  });

  /**
   * A queue, a replay and the agent are about a
   * run, and a run's rows are in the runs store
   * rather than on any canvas.
   */
  it('reads a queue, replays and asks the agent through the runs store', () => {
    const { frame, canvas, asked } = about();

    frame.send({
      type: 'inspectQueue',
      workflowId: 'wf_1',
      nodeId: 'index_pages',
    });
    frame.send({ type: 'replayFrom', workflowId: 'wf_1', nodeId: 'find_slot' });
    frame.send({ type: 'replayFrom', workflowId: 'wf_1', functionId: 3 });
    frame.send({ type: 'askAgent', workflowId: 'wf_1', nodeId: 'find_slot' });

    expect(asked).toEqual([
      ['inspectQueue', 'wf_1', 'index_pages'],
      ['replay', 'wf_1', { nodeId: 'find_slot' }],
      ['replay', 'wf_1', { functionId: 3 }],
      [
        'askAgent',
        { type: 'askAgent', workflowId: 'wf_1', nodeId: 'find_slot' },
      ],
    ]);
    expect(canvas.did).toEqual([]);
  });

  it('opens a run and puts the run tab in front', () => {
    const { frame, asked } = about();

    frame.send({ type: 'openRun', workflowId: 'wf_1' });

    expect(asked).toEqual([['openRun', 'wf_1']]);
  });

  /** An edit is made against one canvas's revision,
   *  and with no canvas in front there is none it
   *  could have been made against. */
  it('edits nothing when no canvas is in front', () => {
    const { frame, focus, canvas } = about();

    focus.report({ at: 'run' });
    frame.send({
      type: 'edit',
      baseRevision: 3,
      node: { id: 'find_slot' },
    });
    frame.send({ type: 'inspectorMode', mode: 'configure' });

    expect(canvas.did).toEqual([]);
  });
});

describe('when the Inspector puts itself in front of somebody', () => {
  it('brings itself into view when a selection lands on a block', () => {
    const { frame, sessions } = mounted();
    const { canvas, inputs } = session('groom_booking.workflow.json');

    frame.hide();
    sessions.fire(canvas);

    expect(frame.revealed).toEqual([]);

    inputs.selected = 'find_slot';
    sessions.fire(canvas);

    expect(frame.revealed).toEqual([true]);
  });

  /**
   * Showing the view opens the container it sits in,
   * which would take the side bar away from the
   * Explorer somebody is using.
   */
  it('stays put while the mBoss views are not showing', () => {
    const { frame, sessions } = mounted({ showing: () => false });
    const { canvas, inputs } = session('groom_booking.workflow.json');

    frame.hide();
    inputs.selected = 'find_slot';
    sessions.fire(canvas);

    expect(frame.revealed).toEqual([]);
  });

  it('stays put on a focus change alone', () => {
    const { frame, focus, sessions } = mounted();
    const first = session('groom_booking.workflow.json', {
      selected: 'find_slot',
    });
    const second = session('refund_approval.workflow.json', {
      selected: 'refund_payment',
    });

    sessions.fire(first.canvas);
    frame.hide();
    focus.report({ at: 'canvas', session: second.canvas });
    focus.report({ at: 'canvas', session: first.canvas });

    expect(frame.revealed).toEqual([]);
  });

  it('stays put for a tick that changes no selection', () => {
    const { frame, sessions } = mounted();
    const { canvas } = session('groom_booking.workflow.json', {
      selected: 'find_slot',
    });

    sessions.fire(canvas);
    frame.hide();
    sessions.fire(canvas);

    expect(frame.revealed).toEqual([]);
  });

  /**
   * A pane nobody has ever expanded is never
   * resolved, so there is no view to show: the
   * first canvas in the window meets it through
   * its focus command instead, once.
   */
  it('shows itself once in a window where it never resolved', () => {
    const { sessions, host } = mounted({ resolved: false });
    const first = session('groom_booking.workflow.json').canvas;
    const second = session('refund_approval.workflow.json').canvas;

    sessions.fire(first);
    sessions.fire(second);

    expect(host.met).toBe(1);
  });

  it('meets nobody in a window where it has resolved', () => {
    const { sessions, host } = mounted();

    sessions.fire(session('groom_booking.workflow.json').canvas);

    expect(host.met).toBe(0);
  });
});
