import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TextDocument } from 'vscode';
import { describe, expect, it } from 'vitest';

import { fakeAgent } from '../../test/doubles/agent.js';
import { fakeTrust } from '../../test/doubles/trust.js';
import { fakeWebview } from '../../test/doubles/webview.js';
import type { CanvasSession, SubjectInputs } from '../canvas/editor.js';
import { canvasSessions, type CanvasSessions } from '../canvas/sessions.js';
import { inspectorWords } from '../canvas/words.js';
import { workflowDocument } from '../core/index.js';
import { WorkflowIRSchema } from '../core/rules.js';
import { emitter } from '../emitter.js';
import { messages } from '../messages.js';
import { runTabOf, type SeeView } from '../runs/view.js';
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
 * answers with, and a selection or a face pick is
 * said by the session, as a real session's are;
 * `moved` says any other move.
 */
function session(
  file: string,
  over: Partial<SubjectInputs> = {},
  did: unknown[][] = [],
) {
  const changes = emitter();
  const workflow = file.replace(/\.workflow\.json$/, '');
  const inputs: SubjectInputs = {
    file,
    path: workflowDocument(PROJECT, workflow),
    workflow,
    read: { ok: true, ir },
    revision: ir.revision,
    manifest: undefined,
    diagnostics: [],
    selected: undefined,
    mode: 'configure',
    run: undefined,
    decided: {},
    proposedBy: undefined,
    ...over,
  };
  const verb =
    (name: string) =>
    async (...args: unknown[]): Promise<void> => {
      did.push([name, ...args]);
    };

  const canvas = {
    subjectInputs: () => ({ ...inputs }),
    onChanged: changes.on,
    edit: verb('edit'),
    chooseMode: (mode: SubjectInputs['mode']) => {
      did.push(['chooseMode', mode]);
      inputs.mode = mode;
      changes.fire();
    },
    openFunction: verb('openFunction'),
    openErrorLocation: verb('openErrorLocation'),
    openOutput: verb('openOutput'),
    select: (nodeId: string | null) => {
      did.push(['select', nodeId]);
      inputs.selected = nodeId ?? undefined;
      changes.fire();
    },
  } as unknown as CanvasSession;

  return { canvas, inputs, did, moved: () => changes.fire() };
}

/**
 * How the pane names the block a message is about:
 * the surface it was picked on, the document it is
 * in and its id.
 */
function blockOn(source: 'canvas' | 'run', path: string, nodeId = 'find_slot') {
  return { source, path, nodeId };
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

  // What the run tab holds, what the Runs view's
  // input box says, and their two signals.
  const tab: { reading: SeeView | undefined; input: string } = {
    reading: undefined,
    input: '',
  };
  const moves = emitter();
  const typing = emitter();

  const runs: InspectorRuns = {
    detail: () => tab.reading,
    tab: (now) =>
      tab.reading === undefined ? undefined : runTabOf(tab.reading, now),
    project: () => options.project ?? PROJECT,
    chooseFace: (mode) => void asked.push(['chooseFace', mode]),
    selectNode: (nodeId) => void asked.push(['selectNode', nodeId]),
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
    cancel: async (workflowId) => void asked.push(['cancel', workflowId]),
    resume: async (workflowId) => void asked.push(['resume', workflowId]),
    openInput: async (workflowId) => void asked.push(['openInput', workflowId]),
    list: () => ({
      testRun: {
        workflows: [],
        selected: 'groom_booking',
        input: tab.input,
        hint: undefined,
        problem: undefined,
      },
    }),
    runTrigger: async (...args) => void asked.push(['runTrigger', ...args]),
    openRunInput: async (...args) => void asked.push(['openRunInput', ...args]),
    replayStartRefusal: () => undefined,
    onChanged: moves.on,
    onInputChanged: typing.on,
  };

  // The document as the editor holds it, and the
  // canvas a person's first edit opens beside the
  // run tab, registering a moment after it is asked
  // for, as a real one does.
  const texts = new Map<string, string>([[PATH, JSON.stringify(ir)]]);
  const dirty = new Set<string>();

  // The agent, and the side bar it answers in, which
  // says how much the agent had been told by the
  // time it was brought into view.
  const agent = fakeAgent();
  const host = {
    met: 0,
    revealAgent: async () =>
      void asked.push(['revealAgent', agent.told.length]),
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
    unsaved: (path: string) => dirty.has(path),
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
    agent,
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
    runs,
    agent,
    asked,
    host,
    view,
    subjects,
    tab,
    moved: () => moves.fire(),
    typed: (text: string) => {
      tab.input = text;
      typing.fire();
    },
    texts,
    dirty,
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
    const front = session('groom_booking.workflow.json');
    const behind = session('refund_approval.workflow.json');

    sessions.register(front.inputs.path, front.canvas, { active: false });
    sessions.register(behind.inputs.path, behind.canvas, { active: false });
    focus.report({ at: 'canvas', session: front.canvas });
    behind.moved();

    expect(subjects()).toHaveLength(1);

    front.moved();

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
  /** The pane mounted about one canvas in front, as
   *  a canvas registers and then takes focus. */
  function about() {
    const pane = mounted();
    const canvas = session('groom_booking.workflow.json', {
      selected: 'find_slot',
      mode: 'evidence',
      run: liveRun({ workflow: 'groom_booking' }),
    });

    pane.sessions.register(canvas.inputs.path, canvas.canvas, {
      active: true,
    });
    pane.focus.report({ at: 'canvas', session: canvas.canvas });

    return { ...pane, canvas, block: blockOn('canvas', canvas.inputs.path) };
  }

  it('picks the face on the canvas it came from, and draws it', () => {
    const { frame, canvas, subjects, block } = about();

    frame.send({ type: 'inspectorMode', mode: 'configure', about: block });

    expect(canvas.did).toEqual([['chooseMode', 'configure']]);
    expect(subjects().at(-1)).toMatchObject({
      at: 'block',
      block: { face: 'configure' },
    });
  });

  it('edits through that canvas', () => {
    const { frame, canvas, block } = about();
    const node = { id: 'find_slot', title: 'Find a slot' };
    const edit = { type: 'edit', baseRevision: 3, node, about: block };
    const assign = {
      type: 'assign',
      baseRevision: 3,
      nodeId: 'find_slot',
      export: 'findSlot',
      about: block,
    };

    frame.send({ ...edit, view: 'inspector' });
    frame.send({ ...assign, view: 'inspector' });

    expect(canvas.did).toEqual([
      ['edit', edit],
      ['edit', assign],
    ]);
  });

  /**
   * A field commits as focus leaves the pane, and
   * the click that took focus can bring another
   * canvas forward by a shorter path than the commit
   * takes. What was typed belongs to the document it
   * was typed against, and to no other: the canvas
   * that came forward is left alone, whatever its
   * blocks are called and whatever revision it is
   * at.
   */
  it('edits the canvas a message was made on, whichever came forward since', () => {
    const pane = about();
    const other = session('refund_approval.workflow.json', {
      selected: 'find_slot',
    });

    pane.sessions.register(other.inputs.path, other.canvas, { active: true });
    pane.focus.report({ at: 'canvas', session: other.canvas });

    const node = { id: 'find_slot', title: 'typed on the first canvas' };
    const edit = { type: 'edit', baseRevision: 3, node, about: pane.block };

    pane.frame.send({ ...edit, view: 'inspector' });
    pane.frame.send({
      type: 'inspectorMode',
      mode: 'configure',
      about: pane.block,
    });

    expect(other.did).toEqual([]);
    expect(pane.canvas.did).toEqual([
      ['edit', edit],
      ['chooseMode', 'configure'],
    ]);
  });

  /** A canvas nobody has open can be edited by
   *  nobody: its session went with its tab. */
  it('drops a message about a document no canvas has open', () => {
    const { frame, canvas } = about();

    frame.send({
      type: 'edit',
      view: 'inspector',
      baseRevision: 3,
      node: { id: 'find_slot' },
      about: blockOn(
        'canvas',
        '/work/grooming/.mboss/workflows/closed.workflow.json',
      ),
    });

    expect(canvas.did).toEqual([]);
  });

  it('opens the block’s function through that canvas', () => {
    const { frame, canvas, block } = about();

    frame.send({ type: 'openFunction', nodeId: 'find_slot', about: block });

    expect(canvas.did).toEqual([['openFunction', 'find_slot']]);
  });

  it('opens the line a failure came from through that canvas', () => {
    const { frame, canvas, block } = about();

    frame.send({
      type: 'openErrorLocation',
      nodeId: 'find_slot',
      functionId: 3,
      about: block,
    });

    expect(canvas.did).toEqual([['openErrorLocation', 'find_slot', 3]]);
  });

  it('opens a recorded output through that canvas', () => {
    const { frame, canvas, block } = about();

    frame.send({
      type: 'openOutput',
      workflowId: 'wf_1',
      functionId: 3,
      about: block,
    });

    expect(canvas.did).toEqual([['openOutput', 'wf_1', 3]]);
  });

  /**
   * A question about a block as it is set, not about
   * a run: the block by its name and id, and the
   * file it is in, said the way the project names
   * it. The side bar comes into view first, so the
   * answer lands somewhere somebody is looking.
   */
  it('asks the agent about a block in one sentence, after showing the agent', async () => {
    const { frame, agent, asked } = about();

    frame.send({
      type: 'askAboutBlock',
      workflow: 'groom_booking',
      nodeId: 'find_slot',
    });
    await until(() => agent.told.length === 1);

    expect(asked).toEqual([['revealAgent', 0]]);
    expect(agent.told).toEqual([
      {
        at: 'send',
        prompt: {
          text: messages.askAboutBlock(
            'Find open slot',
            'find_slot',
            '.mboss/workflows/groom_booking.workflow.json',
          ),
        },
      },
    ]);
  });

  /** A question can only be put in words drawn off
   *  the block the pane is showing. */
  it('asks nothing about a block the pane is not showing', async () => {
    const { frame, agent, asked } = about();

    frame.send({
      type: 'askAboutBlock',
      workflow: 'groom_booking',
      nodeId: 'book_appointment',
    });
    frame.send({
      type: 'askAboutBlock',
      workflow: 'refund_approval',
      nodeId: 'find_slot',
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(asked).toEqual([]);
    expect(agent.told).toEqual([]);
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

  /** An edit made about a block picked on the run
   *  tab is the run's document's, even where this
   *  canvas has a block of the same id. */
  it('leaves the canvas alone for a block picked on the run tab', () => {
    const { frame, focus, canvas, tab } = about();

    tab.reading = seeView({ selectedNode: 'find_slot' });
    focus.report({ at: 'run' });
    frame.send({
      type: 'edit',
      baseRevision: 3,
      node: { id: 'find_slot' },
      about: {
        source: 'run',
        path: workflowDocument(PROJECT, 'refund_approval'),
        nodeId: 'find_slot',
      },
    });

    expect(canvas.did).toEqual([]);
  });
});

describe('when the Inspector puts itself in front of somebody', () => {
  it('brings itself into view when a selection lands on a block', () => {
    const { frame, sessions } = mounted();
    const { canvas, inputs, moved } = session('groom_booking.workflow.json');

    sessions.register(inputs.path, canvas, { active: false });
    frame.hide();
    moved();

    expect(frame.revealed).toEqual([]);

    inputs.selected = 'find_slot';
    moved();

    expect(frame.revealed).toEqual([true]);
  });

  /**
   * Showing the view opens the container it sits in,
   * which would take the side bar away from the
   * Explorer somebody is using.
   */
  it('stays put while the mBoss views are not showing', () => {
    const { frame, sessions } = mounted({ showing: () => false });
    const { canvas, inputs, moved } = session('groom_booking.workflow.json');

    sessions.register(inputs.path, canvas, { active: false });
    frame.hide();
    inputs.selected = 'find_slot';
    moved();

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

    sessions.register(first.inputs.path, first.canvas, { active: false });
    sessions.register(second.inputs.path, second.canvas, { active: false });
    frame.hide();
    focus.report({ at: 'canvas', session: second.canvas });
    focus.report({ at: 'canvas', session: first.canvas });

    expect(frame.revealed).toEqual([]);
  });

  it('stays put for a tick that changes no selection', () => {
    const { frame, sessions } = mounted();
    const { canvas, inputs, moved } = session('groom_booking.workflow.json', {
      selected: 'find_slot',
    });

    sessions.register(inputs.path, canvas, { active: false });
    frame.hide();
    moved();

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
    const first = session('groom_booking.workflow.json');
    const second = session('refund_approval.workflow.json');

    sessions.register(first.inputs.path, first.canvas, { active: false });
    sessions.register(second.inputs.path, second.canvas, { active: false });
    first.moved();

    expect(host.met).toBe(1);
  });

  it('meets nobody in a window where it has resolved', () => {
    const { sessions, host } = mounted();
    const { canvas, inputs } = session('groom_booking.workflow.json');

    sessions.register(inputs.path, canvas, { active: false });

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
  const picked = blockOn('run', PATH);
  const edit = { type: 'edit', baseRevision: 12, node, about: picked };
  const assign = {
    type: 'assign',
    baseRevision: 12,
    nodeId: 'find_slot',
    export: 'findSlot',
    about: picked,
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

  /**
   * A canvas holding the document knows who is
   * proposing against it, and the pane takes the
   * proposer from there rather than asking the
   * store again: one fact, one owner.
   */
  it('takes a proposal against the document from the canvas open on it', () => {
    const pane = onRunTab();
    const open = session('groom_booking.workflow.json', {
      revision: undefined,
      proposedBy: 'claude code',
    });
    pane.sessions.register(PATH, open.canvas, { active: false });

    expect(pane.subjects().at(-1)).toMatchObject({
      at: 'block',
      block: {
        revision: undefined,
        proposal: messages.previewHeadline('claude code'),
      },
    });
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

  /**
   * An edit made on the run tab is the run
   * document's, whatever came forward while it was
   * on its way — and it lands on the block it was
   * made about, not on whatever the tab has picked
   * by the time it arrives.
   */
  it('keeps a run-tab edit on the block it was made about', async () => {
    const pane = onRunTab();
    const open = session('groom_booking.workflow.json', {}, pane.asked);
    const elsewhere = session('refund_approval.workflow.json');

    pane.sessions.register(PATH, open.canvas, { active: false });
    pane.sessions.register(elsewhere.inputs.path, elsewhere.canvas, {
      active: true,
    });
    pane.focus.report({ at: 'canvas', session: elsewhere.canvas });
    pane.tab.reading = seeView({ selectedNode: 'book_appointment' });

    pane.frame.send({ ...edit, view: 'inspector' });
    await until(() => pane.asked.length === 2);

    expect(pane.asked).toEqual([
      ['select', 'find_slot'],
      ['edit', edit],
    ]);
    expect(elsewhere.did).toEqual([]);
  });

  /**
   * The canvas draws its board from what it says
   * itself, and a selection made from here is said
   * by the canvas as any other is. An edit that
   * lands says so again through the document change
   * it makes; one that writes nothing — a refused
   * assign, a stale revision, a block that has gone
   * — still leaves the board ringing the block the
   * selection named.
   */
  it('says the canvas moved for a run-tab edit that writes nothing', async () => {
    const pane = onRunTab();
    const open = session('groom_booking.workflow.json', {}, pane.asked);
    const signals: unknown[] = [];

    pane.sessions.register(PATH, open.canvas, { active: false });
    pane.sessions.onChanged((moved) => signals.push(moved));

    pane.frame.send({ ...edit, view: 'inspector' });
    await until(() => pane.asked.length === 2);

    expect(pane.asked).toEqual([
      ['select', 'find_slot'],
      ['edit', edit],
    ]);
    expect(signals).toEqual([open.canvas]);
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
    opened.moved();

    expect(pane.subjects().at(-1)).toMatchObject({
      at: 'block',
      block: { revision: ir.revision + 1 },
    });
  });

  it('keeps the face somebody picked on the run tab', () => {
    const { frame, asked } = onRunTab();

    frame.send({ type: 'inspectorMode', mode: 'configure', about: picked });

    expect(asked).toEqual([['chooseFace', 'configure']]);
  });

  it('opens the block’s function from the run it recorded', () => {
    const { frame, asked } = onRunTab();

    frame.send({ type: 'openFunction', nodeId: 'find_slot', about: picked });

    expect(asked).toEqual([['openFunction', 'wf_1', 'find_slot']]);
  });

  it('opens the line a failure came from, by the row', () => {
    const { frame, asked } = onRunTab();

    frame.send({
      type: 'openErrorLocation',
      nodeId: 'find_slot',
      functionId: 3,
      about: picked,
    });

    expect(asked).toEqual([['openErrorLocation', 'wf_1', 3]]);
  });

  it('opens a recorded output from the run tab’s run', () => {
    const { frame, asked } = onRunTab();

    frame.send({
      type: 'openOutput',
      workflowId: 'wf_1',
      functionId: 3,
      about: picked,
    });

    expect(asked).toEqual([['openOutput', 'wf_1', 3]]);
  });

  it('asks the agent about a block in one sentence, after showing the agent', async () => {
    const { frame, agent, asked } = onRunTab();

    frame.send({
      type: 'askAboutBlock',
      workflow: 'groom_booking',
      nodeId: 'find_slot',
    });
    await until(() => agent.told.length === 1);

    expect(asked).toEqual([['revealAgent', 0]]);
    expect(agent.told).toEqual([
      {
        at: 'send',
        prompt: {
          text: messages.askAboutBlock(
            'Find open slot',
            'find_slot',
            '.mboss/workflows/groom_booking.workflow.json',
          ),
        },
      },
    ]);
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
 * A trigger writes no row of its own: it is how the
 * run started. So its face offers the whole run
 * instead, and asking for it lets go of the trigger
 * on whichever surface it was picked on — which is
 * what puts the card about the run in its place.
 */
describe('the whole run, shown again from a trigger', () => {
  it('lets go of the trigger on the canvas it was selected on', () => {
    const pane = mounted();
    const canvas = session('groom_booking.workflow.json', {
      selected: 'booking_requested',
      mode: 'evidence',
      run: liveRun({ workflowId: 'wf_1', workflow: 'groom_booking' }),
    });

    pane.sessions.register(canvas.inputs.path, canvas.canvas, { active: true });
    pane.focus.report({ at: 'canvas', session: canvas.canvas });
    pane.frame.send({ type: 'inspectRun' });

    expect(canvas.did).toEqual([['select', null]]);
    expect(pane.asked).toEqual([]);
    expect(pane.subjects().at(-1)).toMatchObject({
      at: 'run',
      run: { workflowId: 'wf_1' },
    });
  });

  it('lets go of the trigger picked on the run tab', () => {
    const pane = mounted();

    pane.tab.reading = seeView({ selectedNode: 'booking_requested' });
    pane.focus.report({ at: 'run' });
    pane.frame.send({ type: 'inspectRun' });

    expect(pane.asked).toEqual([['selectNode', null]]);
  });
});

/**
 * A trigger's card shows the Runs view's input as
 * the sample a run from the card starts with, and
 * starts that run. The input is only ever written in
 * the Runs view: the card posts the workflow and
 * nothing else, and the runs store reads the input
 * it holds.
 */
describe('a trigger block and the Runs input', () => {
  /** The pane about the trigger selected on a
   *  canvas. */
  function onCanvas() {
    const pane = mounted();
    const canvas = session('groom_booking.workflow.json', {
      selected: 'booking_requested',
    });

    pane.focus.report({ at: 'canvas', session: canvas.canvas });

    return { ...pane, did: canvas.did };
  }

  /** The pane about the trigger picked on the run
   *  tab. */
  function onRunTab() {
    const pane = mounted();

    pane.tab.reading = seeView({ selectedNode: 'booking_requested' });
    pane.focus.report({ at: 'run' });

    return { ...pane, did: [] as unknown[][] };
  }

  const SURFACES = [
    ['a canvas', onCanvas],
    ['the run tab', onRunTab],
  ] as const;

  for (const [surface, about] of SURFACES) {
    describe(`picked on ${surface}`, () => {
      it('draws the trigger again when the Runs input moves', () => {
        const pane = about();
        const drawn = pane.subjects().length;

        pane.typed('{"n":2}');

        expect(pane.subjects()).toHaveLength(drawn + 1);
        expect(pane.subjects().at(-1)).toMatchObject({
          at: 'block',
          block: { runInput: { text: '{"n":2}' } },
        });
      });

      /** The input stays where it was typed: a start
       *  from the card names the workflow, and an
       *  input a frame adds to it goes nowhere. */
      it('starts the trigger’s workflow with no input of its own', () => {
        const { frame, asked, did } = about();

        frame.send({
          type: 'runTrigger',
          workflow: 'groom_booking',
          input: '{"smuggled":true}',
        });

        expect(asked).toEqual([['runTrigger', 'groom_booking']]);
        expect(did).toEqual([]);
      });

      it('opens the Runs input to read', () => {
        const { frame, asked, did } = about();

        frame.send({ type: 'openRunInput' });

        expect(asked).toEqual([['openRunInput']]);
        expect(did).toEqual([]);
      });

      it('says whether its document has changes nobody saved', () => {
        const pane = about();

        expect(pane.subjects().at(-1)).toMatchObject({
          block: { runInput: { unsaved: false } },
        });

        pane.dirty.add(PATH);
        pane.typed('{}');

        expect(pane.subjects().at(-1)).toMatchObject({
          block: { runInput: { unsaved: true } },
        });
      });
    });
  }

  /** Any other block shows nothing of the Runs view,
   *  so a keystroke there is no reason to draw it. */
  it('leaves any other block alone while somebody types', () => {
    const pane = mounted();

    pane.focus.report({
      at: 'canvas',
      session: session('groom_booking.workflow.json', {
        selected: 'find_slot',
      }).canvas,
    });
    const drawn = pane.subjects().length;

    pane.typed('{"n":2}');

    expect(drawn).toBeGreaterThan(0);
    expect(pane.subjects()).toHaveLength(drawn);
  });

  /**
   * Which workflow the Runs view is set to, and why
   * its last start was refused, are the store's to
   * say, and a trigger's card shows both — so the
   * card is drawn again when the store moves, on a
   * canvas as on the run tab.
   */
  it('draws a canvas trigger again when the runs move', () => {
    const pane = onCanvas();
    const drawn = pane.subjects().length;

    pane.moved();

    expect(pane.subjects()).toHaveLength(drawn + 1);
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
    pane.sessions.register(other.inputs.path, other.canvas, { active: false });
    const drawn = pane.subjects().length;

    other.moved();
    expect(pane.subjects()).toHaveLength(drawn);

    open.moved();
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

    // The run itself is shown while the pane is.
    tab.reading = seeView();
    moved();
    frame.hide();

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

  /**
   * A run the tab had not shown is a whole run the
   * pane now has something to say about, before
   * anybody picks a block of it. The same run read
   * again, or a tick on it, is not.
   */
  it('brings itself into view when the run tab shows a different run', () => {
    const { frame, tab, moved } = mounted();
    const other = { ...seeView().run, workflowId: 'wf_2' };

    frame.hide();
    tab.reading = seeView();
    moved();
    expect(frame.revealed).toEqual([true]);

    frame.hide();
    tab.reading = seeView();
    moved();
    moved();
    expect(frame.revealed).toEqual([true]);

    tab.reading = seeView({ run: other });
    moved();
    expect(frame.revealed).toEqual([true, true]);
  });

  it('stays put for another run while the mBoss views are not showing', () => {
    const { frame, tab, moved } = mounted({ showing: () => false });

    frame.hide();
    tab.reading = seeView();
    moved();

    expect(frame.revealed).toEqual([]);
  });

  /**
   * A pane nobody has ever expanded has no view to
   * show, so the first run shown in the window meets
   * it through its focus command instead — once,
   * whatever is shown after.
   */
  it('meets a person once when the run tab is the first thing shown', () => {
    const { tab, moved, host } = mounted({ resolved: false });

    tab.reading = seeView();
    moved();
    tab.reading = seeView({ run: { ...seeView().run, workflowId: 'wf_2' } });
    moved();

    expect(host.met).toBe(1);
  });

  it('meets nobody for a run shown in a window where it has resolved', () => {
    const { tab, moved, host } = mounted();

    tab.reading = seeView();
    moved();

    expect(host.met).toBe(0);
  });
});

/**
 * A whole run, with nothing of it picked.
 *
 * Everything the card about a run offers is about
 * that run, and the run is the store's whichever
 * surface it is in front on: the canvas following
 * it or the run tab showing it. So every way on from
 * the card goes to the runs store, addressed by the
 * run the card names, and nothing reaches a canvas.
 */
describe('what a run-level subject says, and where it goes', () => {
  /** The pane about the run a canvas is following,
   *  with nothing selected on it. */
  function onCanvas() {
    const pane = mounted();
    const canvas = session('groom_booking.workflow.json', {
      mode: 'evidence',
      run: liveRun({ workflowId: 'wf_1', workflow: 'groom_booking' }),
    });

    pane.focus.report({ at: 'canvas', session: canvas.canvas });

    return { ...pane, did: canvas.did };
  }

  /** The pane about the run the run tab is showing,
   *  with nothing picked on it. */
  function onRunTab() {
    const pane = mounted();

    pane.tab.reading = seeView();
    pane.focus.report({ at: 'run' });

    return { ...pane, did: [] as unknown[][] };
  }

  const SURFACES = [
    ['a canvas following it', onCanvas],
    ['the run tab', onRunTab],
  ] as const;

  for (const [surface, about] of SURFACES) {
    describe(`in front on ${surface}`, () => {
      it('is about the whole run', () => {
        expect(about().subjects().at(-1)).toMatchObject({
          at: 'run',
          run: { workflowId: 'wf_1' },
        });
      });

      it('replays it from the start', () => {
        const { frame, asked, did } = about();

        frame.send({ type: 'replayFrom', workflowId: 'wf_1', from: 'start' });

        expect(asked).toEqual([['replay', 'wf_1', { from: 'start' }]]);
        expect(did).toEqual([]);
      });

      it('asks the agent about the whole run', () => {
        const { frame, asked } = about();

        frame.send({ type: 'askAgent', workflowId: 'wf_1' });

        expect(asked).toEqual([
          ['askAgent', { type: 'askAgent', workflowId: 'wf_1' }],
        ]);
      });

      it('cancels it', () => {
        const { frame, asked, did } = about();

        frame.send({ type: 'cancelRun', workflowId: 'wf_1' });

        expect(asked).toEqual([['cancel', 'wf_1']]);
        expect(did).toEqual([]);
      });

      it('picks it back up', () => {
        const { frame, asked, did } = about();

        frame.send({ type: 'resumeRun', workflowId: 'wf_1' });

        expect(asked).toEqual([['resume', 'wf_1']]);
        expect(did).toEqual([]);
      });

      /** Reading the run and putting the run tab in
       *  front are one door, the one every surface
       *  opens a run through. */
      it('opens a run on the run tab', () => {
        const { frame, asked } = about();

        frame.send({ type: 'openRun', workflowId: 'wf_parent' });

        expect(asked).toEqual([['openRun', 'wf_parent']]);
      });

      it('opens the input it was started with', () => {
        const { frame, asked, did } = about();

        frame.send({ type: 'openInput', workflowId: 'wf_1' });

        expect(asked).toEqual([['openInput', 'wf_1']]);
        expect(did).toEqual([]);
      });
    });
  }

  /** "by you" is the store's answer, carried on the
   *  one projection the pane reads; the pane asks no
   *  second question about it. */
  it('says whether this window cancelled the run, as the store projected it', () => {
    const pane = mounted();
    const stopped = { ...seeView().run, status: 'CANCELLED' };

    pane.tab.reading = seeView({ run: stopped, cancelledHere: true });
    pane.focus.report({ at: 'run' });

    expect(pane.subjects().at(-1)).toMatchObject({
      at: 'run',
      run: { controls: { cancelledAt: expect.stringContaining('by you') } },
    });
  });

  it('asks the store whether a replay from the start is on offer', () => {
    const pane = mounted();
    const asked: unknown[][] = [];

    pane.runs.replayStartRefusal = (...question) => {
      asked.push(question);

      return 'refused for a reason';
    };
    pane.tab.reading = seeView();
    pane.focus.report({ at: 'run' });

    expect(asked).toEqual([['groom_booking', ir]]);
    expect(pane.subjects().at(-1)).toMatchObject({
      at: 'run',
      run: { replayStart: false, replayRefused: 'refused for a reason' },
    });
  });
});
