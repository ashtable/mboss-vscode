import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TextDocument } from 'vscode';
import { describe, expect, it } from 'vitest';

import { fakeTrust } from '../../test/doubles/trust.js';
import { fakeWebview } from '../../test/doubles/webview.js';
import type { CanvasSession, SubjectInputs } from '../canvas/editor.js';
import { canvasSessions, type CanvasSessions } from '../canvas/sessions.js';
import { inspectorWords } from '../canvas/words.js';
import { workflowDocument } from '../core/index.js';
import { WorkflowIRSchema } from '../core/rules.js';
import { emitter } from '../emitter.js';
import { messages } from '../messages.js';
import type { SeeView } from '../runs/view.js';
import { makeProject } from '../test-support/project.js';
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

/** The project the run tab reads its runs from in
 *  these specs, and the document its run is a run
 *  of. */
const PROJECT = '/work/grooming';
const PATH = workflowDocument(PROJECT, 'groom_booking');

/**
 * A canvas session answering only what the
 * Inspector reads of one and asks of one, with
 * every verb it was asked written down in order.
 * The face it is asked for is the face it then
 * answers with, as a real session's is.
 */
function session(
  file: string,
  over: Partial<SubjectInputs> = {},
  did: unknown[][] = [],
) {
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

/** The run tab showing a run of groom_booking, read
 *  off disk, with whatever is picked on it. */
function seeView(over: Partial<SeeView> = {}): SeeView {
  return {
    run: {
      workflowId: 'wf_1',
      name: 'groom_booking',
      status: 'SUCCESS',
      recoveryAttempts: 1,
      executorId: 'local-dev',
      applicationVersion: 'v0.1.0',
      createdAt: 1000,
      startedAt: 1000,
      completedAt: 9000,
      error: undefined,
      forkedFrom: undefined,
      wasForkedFrom: false,
    },
    steps: [],
    selectedStep: undefined,
    note: undefined,
    ir,
    ...over,
  };
}

function mounted(
  options: {
    showing?: () => boolean;
    resolved?: boolean;
    trusted?: boolean;
    project?: string;
  } = {},
) {
  const frame = fakeWebview();
  const focus = inspectorFocus();
  const registry = canvasSessions();
  const asked: unknown[][] = [];

  // The registry, with every wait for a canvas
  // written down in the order it was asked.
  const sessions: CanvasSessions = {
    ...registry,
    whenOpen: (path) => {
      asked.push(['whenOpen', path]);

      return registry.whenOpen(path);
    },
  };

  // What the run tab holds, and its signal.
  const tab: { reading: SeeView | undefined } = { reading: undefined };
  const moves = emitter();

  const runs: InspectorRuns = {
    detail: () => tab.reading,
    inspected: () =>
      tab.reading === undefined
        ? undefined
        : { run: liveRun({ workflowId: 'wf_1' }), decided: {} },
    project: () => options.project ?? PROJECT,
    chooseFace: (mode) => void asked.push(['chooseFace', mode]),
    openRun: async (workflowId) => void asked.push(['openRun', workflowId]),
    replay: async (workflowId, picked) =>
      void asked.push(['replay', workflowId, picked]),
    askAgent: async (ask) => void asked.push(['askAgent', ask]),
    inspectQueue: async (workflowId, nodeId) =>
      void asked.push(['inspectQueue', workflowId, nodeId]),
    openFunction: async (workflowId, nodeId) =>
      void asked.push(['openFunction', workflowId, nodeId]),
    openErrorLocation: async (workflowId, functionId) =>
      void asked.push(['openErrorLocation', workflowId, functionId]),
    openOutput: async (workflowId, functionId) =>
      void asked.push(['openOutput', workflowId, functionId]),
    onChanged: moves.on,
  };

  // The document as the editor holds it, and the
  // canvas a person's first edit opens beside the
  // run tab, registering a moment after it is asked
  // for, as a real one does.
  const texts = new Map<string, string>([[PATH, JSON.stringify(ir)]]);
  const host = {
    met: 0,
    opens: undefined as CanvasSession | undefined,
    meetInspector: () => void (host.met += 1),
    openCanvas: async (
      path: string,
      how: { beside: boolean; preserveFocus: boolean },
    ) => {
      asked.push(['openCanvas', path, how]);

      const opens = host.opens;

      if (opens !== undefined) {
        setTimeout(() => registry.register(path, opens, { active: false }));
      }
    },
    documentText: (path: string) => texts.get(path),
  };

  const documents = emitter<TextDocument>();
  const proposals = new Map<string, string>();
  const proposing = emitter();
  const generated = emitter<string>();
  const trust = fakeTrust(options.trusted ?? false);

  const view = new InspectorView(
    extensionUri,
    { onDocumentChanged: documents.on },
    {
      forWorkflow: (_project, workflow) => {
        const by = proposals.get(workflow);

        return by === undefined ? undefined : ({ proposedBy: by } as never);
      },
      onChanged: proposing.on,
    },
    runs,
    trust,
    { onGenerated: generated.on },
    sessions,
    focus,
    host,
    options.showing ?? (() => true),
  );

  if (options.resolved ?? true) view.resolveWebviewView(frame.panel);

  const inits = () => frame.posted as InspectorInit[];
  const subjects = () => inits().map((init) => init.subject);

  return {
    frame,
    focus,
    sessions: registry,
    asked,
    host,
    view,
    subjects,
    tab,
    moved: () => moves.fire(),
    texts,
    changed: (path: string) =>
      documents.fire({ uri: { fsPath: path } } as TextDocument),
    proposals,
    proposed: () => proposing.fire(),
    trust,
    generated: (project: string) => generated.fire(project),
  };
}

/** Waits for something a promise chain the spec
 *  cannot reach is going to do. */
async function until(done: () => boolean): Promise<void> {
  for (let tries = 0; tries < 100 && !done(); tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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
   *  and once the run tab is in front, this canvas is
   *  not what the pane is about. */
  it('leaves the canvas alone once the run tab is in front', () => {
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

/**
 * A block picked on the run tab.
 *
 * What the run recorded goes to the runs store,
 * which holds the run. An edit goes to the document,
 * through a canvas: the one open on it, or one
 * opened beside the run tab without taking focus
 * from it, so the edit lands where every other edit
 * lands and the canvas shows it landing.
 */
describe('what a run-tab subject says, and where it goes', () => {
  /** The pane about a block picked on the run
   *  tab. */
  function onRunTab(options: Parameters<typeof mounted>[0] = {}) {
    const pane = mounted(options);

    pane.tab.reading = seeView({ selectedNode: 'find_slot', selectedStep: 3 });
    pane.focus.report({ at: 'run' });

    return pane;
  }

  const node = { id: 'find_slot', title: 'Find a slot' };
  const edit = { type: 'edit', baseRevision: 12, node };
  const assign = {
    type: 'assign',
    baseRevision: 12,
    nodeId: 'find_slot',
    export: 'findSlot',
  };

  it('draws the block from the document, on Run evidence', () => {
    const { subjects } = onRunTab();

    expect(subjects().at(-1)).toMatchObject({
      at: 'block',
      block: {
        source: 'run',
        nodeId: 'find_slot',
        face: 'evidence',
        revision: ir.revision,
        functionId: 3,
      },
    });
  });

  it('edits through a canvas opened beside the run tab', async () => {
    const pane = onRunTab();
    const opened = session('groom_booking.workflow.json', {}, pane.asked);
    pane.host.opens = opened.canvas;

    pane.frame.send({ ...edit, view: 'inspector' });
    await until(() => pane.asked.length === 4);

    expect(pane.asked).toEqual([
      ['openCanvas', PATH, { beside: true, preserveFocus: true }],
      ['whenOpen', PATH],
      ['select', 'find_slot'],
      ['edit', edit],
    ]);
  });

  it('edits through the canvas already open on the document', async () => {
    const pane = onRunTab();
    const open = session('groom_booking.workflow.json', {}, pane.asked);
    pane.sessions.register(PATH, open.canvas, { active: false });

    pane.frame.send({ ...edit, view: 'inspector' });
    pane.frame.send({ ...assign, view: 'inspector' });
    await until(() => pane.asked.length === 4);

    expect(pane.asked).toEqual([
      ['select', 'find_slot'],
      ['edit', edit],
      ['select', 'find_slot'],
      ['edit', assign],
    ]);
  });

  it('draws the next revision once that edit lands', async () => {
    const pane = onRunTab();
    const opened = session('groom_booking.workflow.json');
    pane.host.opens = opened.canvas;

    pane.frame.send({ ...edit, view: 'inspector' });
    await until(() => opened.did.length === 2);

    // The edit lands in the buffer, and the canvas
    // re-reads it and says so.
    opened.inputs.revision = ir.revision + 1;
    opened.inputs.read = { ok: true, ir: { ...ir, revision: ir.revision + 1 } };
    pane.sessions.fire(opened.canvas);

    expect(pane.subjects().at(-1)).toMatchObject({
      at: 'block',
      block: { revision: ir.revision + 1 },
    });
  });

  it('keeps the face somebody picked on the run tab', () => {
    const { frame, asked } = onRunTab();

    frame.send({ type: 'inspectorMode', mode: 'configure' });

    expect(asked).toEqual([['chooseFace', 'configure']]);
  });

  it('opens the block’s function from the run it recorded', () => {
    const { frame, asked } = onRunTab();

    frame.send({ type: 'openFunction', nodeId: 'find_slot' });

    expect(asked).toEqual([['openFunction', 'wf_1', 'find_slot']]);
  });

  it('opens the line a failure came from, by the row', () => {
    const { frame, asked } = onRunTab();

    frame.send({
      type: 'openErrorLocation',
      nodeId: 'find_slot',
      functionId: 3,
    });

    expect(asked).toEqual([['openErrorLocation', 'wf_1', 3]]);
  });

  it('opens a recorded output from the run tab’s run', () => {
    const { frame, asked } = onRunTab();

    frame.send({ type: 'openOutput', workflowId: 'wf_1', functionId: 3 });

    expect(asked).toEqual([['openOutput', 'wf_1', 3]]);
  });

  it('reads a queue, replays and asks the agent through the runs store', () => {
    const { frame, asked } = onRunTab();

    frame.send({
      type: 'inspectQueue',
      workflowId: 'wf_1',
      nodeId: 'index_pages',
    });
    frame.send({
      type: 'replayFrom',
      workflowId: 'wf_1',
      nodeId: 'find_slot',
      functionId: 3,
    });
    frame.send({ type: 'askAgent', workflowId: 'wf_1', nodeId: 'find_slot' });

    expect(asked).toEqual([
      ['inspectQueue', 'wf_1', 'index_pages'],
      ['replay', 'wf_1', { functionId: 3 }],
      [
        'askAgent',
        { type: 'askAgent', workflowId: 'wf_1', nodeId: 'find_slot' },
      ],
    ]);
  });
});

/**
 * What the pane follows while a block picked on the
 * run tab is its subject: the run tab itself, the
 * document the block is drawn from however it
 * changes, a proposal waiting on it, and the
 * project's code-behind once it may be read.
 */
describe('what the Inspector follows for a run-tab block', () => {
  function onRunTab(options: Parameters<typeof mounted>[0] = {}) {
    const pane = mounted(options);

    pane.tab.reading = seeView({ selectedNode: 'find_slot' });
    pane.focus.report({ at: 'run' });

    return pane;
  }

  it('draws again when the run tab moves, only while it is in front', () => {
    const pane = onRunTab();

    pane.moved();
    expect(pane.subjects()).toHaveLength(2);

    pane.focus.report({
      at: 'canvas',
      session: session('groom_booking.workflow.json').canvas,
    });
    pane.moved();
    expect(pane.subjects()).toHaveLength(3);
  });

  it('draws again when its document changes, and not for another', () => {
    const pane = onRunTab();

    pane.texts.set(PATH, JSON.stringify({ ...ir, revision: 13 }));
    pane.changed(PATH);

    expect(pane.subjects()).toHaveLength(2);
    expect(pane.subjects().at(-1)).toMatchObject({
      block: { revision: 13 },
    });

    pane.changed(workflowDocument(PROJECT, 'refund_approval'));
    expect(pane.subjects()).toHaveLength(2);
  });

  it('draws again when the canvas open on its document moves', () => {
    const pane = onRunTab();
    const open = session('groom_booking.workflow.json');
    const other = session('refund_approval.workflow.json');

    pane.sessions.register(PATH, open.canvas, { active: false });
    const drawn = pane.subjects().length;

    pane.sessions.fire(other.canvas);
    expect(pane.subjects()).toHaveLength(drawn);

    pane.sessions.fire(open.canvas);
    expect(pane.subjects()).toHaveLength(drawn + 1);
  });

  it('draws again when a proposal about its document arrives', () => {
    const pane = onRunTab();

    pane.proposals.set('groom_booking', 'claude code');
    pane.proposed();

    expect(pane.subjects().at(-1)).toMatchObject({
      at: 'block',
      block: {
        revision: undefined,
        proposal: messages.previewHeadline('claude code'),
      },
    });
  });

  it('reads the project’s code once trust is granted', async () => {
    const project = await makeProject({ lib: 'lib' });
    const pane = onRunTab({ project, trusted: false });
    pane.texts.set(
      workflowDocument(project, 'groom_booking'),
      JSON.stringify(ir),
    );
    pane.moved();

    expect(pane.subjects().at(-1)).toMatchObject({
      block: { manifest: undefined },
    });

    pane.trust.grant();

    const manifest = (
      pane.subjects().at(-1) as { block: { manifest?: unknown } }
    ).block.manifest;
    expect(manifest).toBeDefined();
  });

  it('reads the project’s code again once it is generated', async () => {
    const project = await makeProject({ lib: 'lib' });
    const pane = onRunTab({ project, trusted: true });
    pane.texts.set(
      workflowDocument(project, 'groom_booking'),
      JSON.stringify(ir),
    );
    pane.moved();

    const names = () =>
      (
        pane.subjects().at(-1) as {
          block: { manifest?: { functions: { export: string }[] } };
        }
      ).block.manifest?.functions.map((one) => one.export) ?? [];

    expect(names()).toContain('findSlot');
    expect(names()).not.toContain('holdSlot');

    writeFileSync(
      join(project, 'lib', 'holdSlot.ts'),
      'export async function holdSlot(slot: string): Promise<string> {\n' +
        '  return slot;\n}\n',
      'utf8',
    );
    const drawn = pane.subjects().length;
    pane.generated(project);

    expect(pane.subjects()).toHaveLength(drawn + 1);
    expect(names()).toContain('holdSlot');
  });
});

describe('when the Inspector comes forward for the run tab', () => {
  it('comes forward when a graph node or a trace row lands on a block', () => {
    const { frame, tab, moved } = mounted();

    frame.hide();
    tab.reading = seeView();
    moved();
    expect(frame.revealed).toEqual([]);

    tab.reading = seeView({ selectedNode: 'find_slot' });
    moved();
    expect(frame.revealed).toEqual([true]);

    frame.hide();
    tab.reading = seeView({ selectedNode: 'find_slot', selectedStep: 3 });
    moved();
    expect(frame.revealed).toEqual([true, true]);

    // A tick that picks nothing new.
    frame.hide();
    moved();
    expect(frame.revealed).toEqual([true, true]);
  });

  it('stays put while the mBoss views are not showing', () => {
    const { frame, tab, moved } = mounted({ showing: () => false });

    frame.hide();
    tab.reading = seeView({ selectedNode: 'find_slot' });
    moved();

    expect(frame.revealed).toEqual([]);
  });

  it('stays put when the graph’s background is clicked', () => {
    const { frame, tab, moved } = mounted();

    tab.reading = seeView({ selectedNode: 'find_slot' });
    moved();
    frame.hide();
    tab.reading = seeView();
    moved();

    expect(frame.revealed).toEqual([]);
  });

  it('stays put on a focus change alone', () => {
    const { frame, focus, tab, moved } = mounted();

    tab.reading = seeView({ selectedNode: 'find_slot' });
    moved();
    frame.hide();
    focus.report({
      at: 'canvas',
      session: session('groom_booking.workflow.json').canvas,
    });
    focus.report({ at: 'run' });

    expect(frame.revealed).toEqual([]);
  });
});
