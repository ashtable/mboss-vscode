import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fakeWebview, type FakeWebview } from '../../test/doubles/webview.js';
import type { ToolEntry } from '../acp/transcript.js';
import {
  WorkflowIRSchema,
  withDecisionCases,
  type WorkflowIR,
} from '../core/rules.js';
import { messages } from '../messages.js';
import { previewStore, type PreviewStore } from '../preview/store.js';
import { makeProject, writeWorkflow } from '../test-support/project.js';
import { fileExists } from '../test-support/repo.js';
import { propose, specOf } from '../test-support/proposals.js';
import type { LiveRun } from '../runs/watch.js';
import type { VsCodeApi } from '../vscodeApi.js';
import type { CanvasInit, CanvasInspector } from '../webview/protocol.js';

import {
  WorkflowCanvasEditor,
  type CanvasCode,
  type CanvasRuns,
  type CanvasTrust,
} from './editor.js';

/**
 * The editor a workflow opens in, driven the way
 * VS Code drives it.
 *
 * What is checked here is the part that is not
 * visible on a canvas: that the panel is told what
 * the document says, that an edit from the panel
 * becomes an edit to the document VS Code owns and
 * not a write behind its back, that an edit made
 * against a version that has moved on is refused
 * out loud, and that a change from anywhere else
 * reaches every panel showing that file. Only the
 * last of those is obvious when it works, and all
 * four are silent when they do not.
 */

const text = readFileSync(
  fileURLToPath(
    new URL(
      '../../mboss-core/fixtures/ir/groom_booking.workflow.json',
      import.meta.url,
    ),
  ),
  'utf8',
);

const ir = WorkflowIRSchema.parse(JSON.parse(text));

type Written = { path: string; text: string };

type Recorded = {
  api: VsCodeApi;
  written: Written[];
  told: string[];

  /** What the canvas wrote into the agent's
   *  transcript. */
  noted: ToolEntry[];

  change: (document: { uri: { toString(): string } }) => void;
};

function recorder(): Recorded {
  const written: Written[] = [];
  const told: string[] = [];
  const noted: ToolEntry[] = [];
  const watchers: ((document: never) => void)[] = [];

  return {
    written,
    told,
    noted,
    change: (document) => {
      for (const watcher of watchers) watcher(document as never);
    },
    api: {
      info: (message) => told.push(message),
      run: () => Promise.resolve(),
      replaceDocument: (document, next) => {
        written.push({ path: document.uri.path, text: next });

        return Promise.resolve(true);
      },
      onDocumentChanged: (listener) => {
        watchers.push(listener);

        return { dispose: () => {} };
      },
    },
  };
}

/** A `TextDocument` as far as the canvas reads
 *  one: a path, and whatever it currently says. */
function fakeDocument(
  contents = text,
  path = '/project/.mboss/workflows/groom_booking.workflow.json',
) {
  const uri = { path, fsPath: path, toString: () => `file://${path}` };

  return { uri, getText: () => contents } as never;
}

/**
 * A document that keeps what was written to it.
 *
 * The canvas writes through `replaceDocument` and
 * reads the file again when VS Code says it
 * changed, so anything about what the canvas does
 * *after* a write needs a document that remembers
 * one.
 */
function livingDocument(contents = text) {
  const path = '/project/.mboss/workflows/groom_booking.workflow.json';
  const uri = { path, fsPath: path, toString: () => `file://${path}` };

  let says = contents;
  const document = { uri, getText: () => says } as never;

  return {
    document,

    /** What VS Code does once a write lands: the
     *  file says the new thing, and every panel
     *  showing it is told. */
    saved: async () => {
      says = recorded.written.at(-1)!.text;
      recorded.change(document);
      await settled();
    },
  };
}

const extensionUri = { path: '/ext' } as never;

/** The proposals in these folders, if any. Most of
 *  these specs are about the document, and pass
 *  none. */
function previewsIn(folders: string[]): PreviewStore {
  return previewStore({
    folders: () => folders,
    isTrusted: () => true,
    regenerate: async () => [],
    notify: async () => {},
    note: () => {},
    say: (message) => recorded.told.push(message),
  });
}

/** Workspace trust, as the canvas reads it, with a
 *  way to say yes mid-session. */
type FakeTrust = CanvasTrust & { grant(): void };

function trust(trusted: boolean): FakeTrust {
  const listeners: (() => void)[] = [];
  let now = trusted;

  return {
    isTrusted: () => now,
    onTrustGranted: (listener) => {
      listeners.push(listener);

      return { dispose: () => {} };
    },
    grant: () => {
      now = true;
      for (const listener of listeners) listener();
    },
  };
}

/** The runs store, as the canvas reads one, with a
 *  way to say a watcher heard something. */
type FakeRuns = CanvasRuns & { heard(run: LiveRun | undefined): void };

function runsSaying(): FakeRuns {
  const listeners: (() => void)[] = [];
  let live: LiveRun | undefined;

  return {
    live: () => live,
    onChanged: (listener) => {
      listeners.push(listener);

      return { dispose: () => {} };
    },
    heard: (run) => {
      live = run;
      for (const listener of listeners) listener();
    },
  };
}

/** The code-behind, as the canvas hears about it,
 *  with a way to say a project has been generated. */
type FakeCode = CanvasCode & { generated(project: string): void };

function codeSaying(): FakeCode {
  const listeners: ((project: string) => void)[] = [];

  return {
    onGenerated: (listener) => {
      listeners.push(listener);

      return { dispose: () => {} };
    },
    generated: (project) => {
      for (const listener of listeners) listener(project);
    },
  };
}

/** One run of a workflow, as far as a canvas reads
 *  one: whose it is, and which blocks it has been
 *  through. */
function runOf(workflow: string): LiveRun {
  return {
    workflowId: 'wf_1',
    workflow,
    status: 'PENDING',
    steps: [{ name: 'parse_request', nodeId: 'parse_request', state: 'done' }],
    recovered: false,
    outcome: 'running',
  };
}

let recorded: Recorded;
let panel: FakeWebview;
let coded: FakeCode;

async function open(
  document = fakeDocument(),
  preview = previewsIn([]),
  trusted: CanvasTrust = trust(true),
  runs: CanvasRuns = runsSaying(),
): Promise<void> {
  recorded = recorder();
  panel = fakeWebview();
  coded = codeSaying();

  const editor = new WorkflowCanvasEditor(
    extensionUri,
    recorded.api,
    preview,
    runs,
    trusted,
    coded,
    (entry) => recorded.noted.push(entry),
  );

  await editor.resolveCustomTextEditor(document, panel.panel);
  panel.send({ type: 'ready', view: 'canvas' });
  await settled();
}

/** Lets the host finish whatever the last message
 *  set going. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Waits for something to become true rather than
 * for a length of time. Laying a graph out is real
 * work, and how long it takes is not this spec's
 * business.
 */
async function until(ready: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !ready(); tries += 1) await settled();

  expect(ready()).toBe(true);
}

function lastCanvasInit(): CanvasInit {
  const inits = panel.posted.filter(
    (message): message is CanvasInit =>
      (message as CanvasInit).view === 'canvas',
  );

  expect(inits.length).toBeGreaterThan(0);

  return inits[inits.length - 1]!;
}

beforeEach(async () => {
  await open();
});

// The provider keeps a handle on every open canvas
// so a command can find the one in front of
// somebody, and a panel nobody closed would still be
// in front of somebody in the next test.
afterEach(() => {
  panel.close();
});

describe('opening a workflow', () => {
  it('tells the panel what the document says', () => {
    const init = lastCanvasInit();

    expect(init.document.ok).toBe(true);
    expect(init.document.ok && init.document.ir).toEqual(ir);
  });

  it('tells it where every node goes', () => {
    const init = lastCanvasInit();

    expect(Object.keys(init.boxes ?? {}).sort()).toEqual(
      ir.nodes.map((node) => node.id).sort(),
    );
  });

  it('tells it what core makes of the document', () => {
    expect(lastCanvasInit().diagnostics).toBeInstanceOf(Array);
  });

  it('says what it could not read rather than drawing nothing', async () => {
    await open(fakeDocument('{ "not": "a workflow" }'));

    const init = lastCanvasInit();

    expect(init.document.ok).toBe(false);
    expect(init.document.ok === false && init.document.detail).toBeTruthy();
  });
});

describe('an edit from the panel', () => {
  it('goes through the document VS Code owns', async () => {
    panel.send({
      type: 'connect',
      view: 'canvas',
      baseRevision: ir.revision,
      from: { node: 'find_slot', port: 'out' },
      to: { node: 'book_appointment' },
    });
    await settled();

    expect(recorded.written).toHaveLength(1);

    const written = WorkflowIRSchema.parse(
      JSON.parse(recorded.written[0]!.text),
    );

    expect(written.edges.at(-1)).toMatchObject({
      from: { node: 'find_slot', port: 'out' },
      to: { node: 'book_appointment' },
    });
  });

  it('raises the revision by exactly one', async () => {
    panel.send({
      type: 'connect',
      view: 'canvas',
      baseRevision: ir.revision,
      from: { node: 'find_slot', port: 'out' },
      to: { node: 'book_appointment' },
    });
    await settled();

    const written: WorkflowIR = JSON.parse(recorded.written[0]!.text);

    expect(written.revision).toBe(ir.revision + 1);
  });

  it('is refused out loud when the document has moved on under it', async () => {
    panel.send({
      type: 'connect',
      view: 'canvas',
      baseRevision: ir.revision - 1,
      from: { node: 'find_slot', port: 'out' },
      to: { node: 'book_appointment' },
    });
    await settled();

    expect(recorded.written).toHaveLength(0);
    expect(recorded.told).toHaveLength(1);
  });

  it('is ignored when it is not a message this editor knows', async () => {
    panel.send({ type: 'connect', view: 'canvas' });
    panel.send('nonsense');
    await settled();

    expect(recorded.written).toHaveLength(0);
  });

  /**
   * Every edit the panel can make, not only the one
   * above.
   *
   * The base revision is the whole of what keeps an
   * edit made against a graph nobody is looking at
   * any more from landing on the graph they are. A
   * handler that wrote to the document directly
   * rather than through the door that checks would
   * pass every other test in this file, because
   * every other test sends the revision that is
   * current — so this one sends the revision before
   * it, once per kind of edit.
   */
  describe('made against a graph that has moved on', () => {
    const edits = {
      addNode: { type: 'addNode', kind: 'step', position: { x: 8, y: 8 } },
      move: { type: 'move', positions: { find_slot: { x: 8, y: 8 } } },
      arrange: { type: 'arrange' },
      delete: { type: 'delete', nodeIds: ['find_slot'], edgeIds: ['e2'] },
      connect: {
        type: 'connect',
        from: { node: 'find_slot', port: 'out' },
        to: { node: 'book_appointment' },
      },
    };

    for (const [kind, edit] of Object.entries(edits)) {
      it(`says so rather than writing what ${kind} asked for`, async () => {
        panel.send({ ...edit, view: 'canvas', baseRevision: ir.revision - 1 });
        await settled();

        expect(recorded.written).toEqual([]);
        expect(recorded.told).toEqual([messages.canvasEditStale()]);
      });
    }
  });
});

describe('a change from anywhere else', () => {
  it('reaches the panel showing that file', async () => {
    const before = panel.posted.length;

    recorded.change(fakeDocument());

    await until(() => panel.posted.length > before);
  });

  it('leaves panels showing other files alone', async () => {
    const before = panel.posted.length;

    recorded.change({
      uri: { toString: () => 'file:///project/.mboss/workflows/other.json' },
    });
    for (let tries = 0; tries < 20; tries += 1) await settled();

    expect(panel.posted).toHaveLength(before);
  });
});

/**
 * Selection is a fact about one open canvas rather
 * than about the window: the panel says which block
 * a person clicked, and the host holds it so that
 * the Inspector column can be drawn from the same
 * message as the graph.
 */
describe('selecting a node', () => {
  it('hands the Inspector column the node and its fields', async () => {
    panel.send({ type: 'select', view: 'canvas', nodeId: 'reply_decision' });
    await settled();

    const shown = lastCanvasInit().inspector;

    expect(shown.selected?.node.id).toBe('reply_decision');
    expect(shown.selected?.form.kind).toBe('branch');
    expect(shown.selected?.revision).toBe(ir.revision);
    expect(labelled(shown)).toBe(true);
  });

  /**
   * A branch that runs a decision has no predicates
   * to edit, so its cases are read back as the
   * wires they stand for — which takes the graph,
   * and is why the host works them out rather than
   * the form.
   */
  it('reads a decision branch’s cases back as where they lead', async () => {
    const decided = {
      ...ir,
      nodes: ir.nodes.map((node) =>
        node.id === 'slot_open'
          ? { ...node, handler: { export: 'tryAgain' } }
          : node,
      ),
    };

    await open(fakeDocument(JSON.stringify(decided)));

    panel.send({ type: 'select', view: 'canvas', nodeId: 'slot_open' });
    await settled();

    expect(lastCanvasInit().inspector.selected?.outcomes).toEqual([
      { value: 'true', target: 'Book appointment' },
    ]);
  });

  /**
   * A decision can bring more ways out than the
   * branch has wires — three outcomes onto a branch
   * somebody has wired twice. The unwired one names
   * no block, and the column is what says the run
   * stops there. Naming a block for it would be a
   * lie, and leaving it out altogether would hide a
   * way out that exists.
   */
  it('names no block for a way out nothing is wired to', async () => {
    const branch = ir.nodes.find((node) => node.id === 'slot_open')!;
    if (branch.kind !== 'branch') throw new Error('slot_open is not a branch');

    const decided = {
      ...ir,
      nodes: ir.nodes.map((node) =>
        node.id === 'slot_open'
          ? {
              ...withDecisionCases(branch, ['pay', 'refuse', 'hold']),
              handler: { export: 'routeClaim' },
            }
          : node,
      ),
    };

    await open(fakeDocument(JSON.stringify(decided)));

    panel.send({ type: 'select', view: 'canvas', nodeId: 'slot_open' });
    await settled();

    expect(lastCanvasInit().inspector.selected?.outcomes).toEqual([
      { value: 'pay', target: 'Book appointment' },
      { value: 'refuse', target: 'Twilio chat — you decide' },
      { value: 'hold', target: undefined },
    ]);
  });

  it('shows nothing at all once the canvas lets go of it', async () => {
    panel.send({ type: 'select', view: 'canvas', nodeId: 'find_slot' });
    await settled();
    panel.send({ type: 'select', view: 'canvas', nodeId: null });
    await settled();

    expect(lastCanvasInit().inspector.selected).toBeUndefined();
  });

  it('says nothing about a node the document does not have', async () => {
    panel.send({ type: 'select', view: 'canvas', nodeId: 'no_such_node' });
    await settled();

    expect(lastCanvasInit().inspector.selected).toBeUndefined();
  });

  /**
   * A hidden panel is torn down and mounted again
   * when it is shown, and the frame that comes back
   * remembers nothing of what was on screen. The
   * host's copy is what puts the person back where
   * they were.
   */
  it('is given back to a panel that has mounted again', async () => {
    panel.send({ type: 'select', view: 'canvas', nodeId: 'find_slot' });
    await settled();

    panel.send({ type: 'ready', view: 'canvas' });
    await settled();

    expect(lastCanvasInit().inspector.selected?.node.id).toBe('find_slot');
  });

  /** Two canvases can be open at once, and each one
   *  is showing its own block. */
  it('belongs to the canvas it was made on', async () => {
    panel.send({ type: 'select', view: 'canvas', nodeId: 'find_slot' });
    await settled();

    const other = fakeWebview();
    await new WorkflowCanvasEditor(
      extensionUri,
      recorded.api,
      previewsIn([]),
      runsSaying(),
      trust(true),
      codeSaying(),
      () => {},
    ).resolveCustomTextEditor(
      fakeDocument(text, '/project/.mboss/workflows/other.workflow.json'),
      other.panel,
    );
    other.send({ type: 'ready', view: 'canvas' });
    other.send({ type: 'select', view: 'canvas', nodeId: 'book_appointment' });
    await settled();

    panel.send({ type: 'ready', view: 'canvas' });
    await settled();

    expect(lastCanvasInit().inspector.selected?.node.id).toBe('find_slot');
  });
});

describe('an edit from the Inspector column', () => {
  it('replaces the node it names and leaves the rest alone', async () => {
    panel.send({
      type: 'edit',
      view: 'canvas',
      baseRevision: ir.revision,
      node: {
        ...ir.nodes.find((node) => node.id === 'find_slot'),
        title: 'Find an open slot',
      },
    });
    await settled();

    const written = WorkflowIRSchema.parse(
      JSON.parse(recorded.written[0]!.text),
    );

    expect(written.nodes.find((node) => node.id === 'find_slot')?.title).toBe(
      'Find an open slot',
    );
    expect(written.nodes).toHaveLength(ir.nodes.length);
    expect(written.revision).toBe(ir.revision + 1);
  });

  it('refuses a node the schema would not accept', async () => {
    panel.send({
      type: 'edit',
      view: 'canvas',
      baseRevision: ir.revision,
      node: { id: 'find_slot', kind: 'step', title: 'x', config: null },
    });
    await settled();

    expect(recorded.written).toHaveLength(0);
    expect(recorded.told).toHaveLength(1);
  });
});

/**
 * Putting a function from the project's code-behind
 * behind a block.
 *
 * One rule decides whether it may sit there, and
 * the host asks it again on the way in: the picker
 * that offered the row and the node that took the
 * drop are both a frame running scripts. A name the
 * manifest has never heard of is a different thing
 * — somebody naming a function they have not
 * written yet, which is what the scaffolder writes
 * the stub for — so it goes in as typed and the
 * rules say so until the code exists.
 */
describe('assigning a function to a block', () => {
  /** The canvas over a project whose code-behind
   *  has been read. */
  async function openScanned(): Promise<void> {
    const project = await makeProject({ lib: 'lib' });
    const path = writeWorkflow(project, 'groom_booking');

    await open(fakeDocument(readFileSync(path, 'utf8'), path));
    await until(() => lastCanvasInit().manifest !== undefined);
  }

  function assign(nodeId: string, exported: string | null): void {
    panel.send({
      type: 'assign',
      view: 'canvas',
      baseRevision: ir.revision,
      nodeId,
      export: exported,
    });
  }

  /** The one node the write is about, as it was
   *  written. */
  function wrote(id: string) {
    expect(recorded.written).toHaveLength(1);

    const written = WorkflowIRSchema.parse(
      JSON.parse(recorded.written[0]!.text),
    );

    return written.nodes.find((node) => node.id === id)!;
  }

  /**
   * The ordinary case, and the one every other test
   * here happens not to cover: a block that is not a
   * branch, given the function it will run. Nothing
   * about its config is the picker's business, and
   * the seeding a branch gets must not follow the
   * function onto a step.
   */
  it('writes one that fits a block that decides nothing', async () => {
    const project = await makeProject({ lib: 'lib' });
    const path = writeWorkflow(project, 'groom_booking');

    // The same workflow with one step's function
    // taken off, which is the state a person is in
    // when they reach for the picker at all.
    const bare = {
      ...ir,
      nodes: ir.nodes.map((node) =>
        node.id === 'find_slot'
          ? Object.fromEntries(
              Object.entries(node).filter(([key]) => key !== 'handler'),
            )
          : node,
      ),
    };

    await open(fakeDocument(JSON.stringify(bare), path));
    await until(() => lastCanvasInit().manifest !== undefined);

    assign('find_slot', 'findSlot');
    await settled();

    const node = wrote('find_slot');

    expect(node.handler).toEqual({ export: 'findSlot' });
    expect(node.kind).toBe('step');
    expect(node.config).toEqual({});
  });

  it('writes one that fits, and seeds the branch’s cases from it', async () => {
    await openScanned();

    assign('slot_open', 'tryAgain');
    await settled();

    const node = wrote('slot_open');

    expect(node.handler).toEqual({ export: 'tryAgain' });
    expect(node.kind === 'branch' && node.config.cases).toEqual([
      expect.objectContaining({
        port: 'yes',
        when: { path: '', op: 'eq', value: true },
      }),
      expect.objectContaining({
        port: 'no',
        when: { path: '', op: 'eq', value: false },
      }),
    ]);
  });

  it('refuses one that does not fit, and writes nothing', async () => {
    await openScanned();
    const before = recorded.told.length;

    assign('slot_open', 'parseRequest');
    await settled();

    expect(recorded.written).toEqual([]);
    expect(recorded.told.length).toBe(before + 1);
  });

  it('writes a name the code-behind has never heard of', async () => {
    await openScanned();

    assign('slot_open', 'decideLater');
    await settled();

    const node = wrote('slot_open');

    expect(node.handler).toEqual({ export: 'decideLater' });
    expect(
      node.kind === 'branch' && node.config.cases.map((one) => one.when.value),
    ).toEqual([true, false]);
  });

  /**
   * The canvas is the other place a person changes
   * the document, and the transcript is where what
   * happened to it is read. A block that gained a
   * function without a row there reads, later, as
   * something the agent must have done.
   */
  it('writes a row for what the person did', async () => {
    await openScanned();

    assign('slot_open', 'tryAgain');
    await settled();

    expect(recorded.noted).toEqual([
      expect.objectContaining({
        at: 'tool',
        by: 'person',
        status: 'applied',
        verb: messages.canvasAssignVerb(),
        target: 'tryAgain → Open at requested time?',
      }),
    ]);
  });

  it('writes no row for an assignment it refused', async () => {
    await openScanned();

    assign('slot_open', 'parseRequest');
    await settled();

    expect(recorded.noted).toEqual([]);
  });

  it('clears the handler and leaves a branch’s cases alone', async () => {
    const decided = {
      ...ir,
      nodes: ir.nodes.map((node) =>
        node.id === 'slot_open'
          ? { ...node, handler: { export: 'tryAgain' } }
          : node,
      ),
    };

    await open(fakeDocument(JSON.stringify(decided)));

    assign('slot_open', null);
    await settled();

    const node = wrote('slot_open');
    const before = decided.nodes.find((one) => one.id === 'slot_open')!;

    expect(node).not.toHaveProperty('handler');
    expect(node.kind === 'branch' && node.config).toEqual(before.config);
  });
});

/**
 * While an agent's proposal is outstanding, the
 * graph on screen is the proposal's rather than the
 * file's — and a frame running scripts is not
 * trusted to have noticed, so an edit arriving
 * anyway is refused here too.
 */
describe('a proposal about the document on screen', () => {
  /** The canvas over a workflow an agent has asked
   *  to rewrite. */
  async function openProposed(): Promise<void> {
    const project = await makeProject();
    const path = writeWorkflow(project, 'groom_booking');

    await propose(project, {
      name: 'groom_booking',
      spec: specOf({ ...ir, title: 'Groom booking, as proposed' }),
      baseRevision: ir.revision,
    });

    const preview = previewsIn([project]);
    await preview.reloadAll();

    await open(fakeDocument(readFileSync(path, 'utf8'), path), preview);
  }

  it('takes the canvas over, and nothing on it edits', async () => {
    await openProposed();

    const init = lastCanvasInit();

    expect(init.preview?.headline).toContain('claude code');
    expect(init.document.ok && init.document.ir.title).toBe(
      'Groom booking, as proposed',
    );

    panel.send({ type: 'select', view: 'canvas', nodeId: 'find_slot' });
    panel.send({ type: 'text', view: 'canvas', text: '{}' });
    await settled();

    expect(recorded.written).toEqual([]);
    expect(lastCanvasInit().inspector.selected).toBeUndefined();
  });

  /**
   * The panel refuses an edit too, but a command has
   * no panel to be refused by — and what is on screen
   * is a draft, so laying it out again would put
   * content nobody approved into the file.
   */
  it('cannot be arranged from the command either', async () => {
    await openProposed();
    panel.focus();

    WorkflowCanvasEditor.active()?.arrange();
    await settled();

    expect(recorded.written).toEqual([]);
  });
});

/**
 * What opening a workflow does to the folder it is
 * in.
 *
 * Drawing the graph reads a document and parses it
 * here, which is why a workflow opens in a
 * restricted window at all. Reading the code behind
 * it is a different thing wearing the same clothes:
 * it type-checks every file in `lib/` with the
 * compiler and writes what it found into
 * `.mboss/manifest.json`. That is real work done on,
 * and a real file written into, a folder the person
 * has said they do not trust — for a palette and
 * typed wiring they can wait for.
 */
describe('opening a workflow in a restricted window', () => {
  /** A real project, because the scan reads and
   *  writes real files or it proves nothing. */
  async function scannable(): Promise<{ project: string; path: string }> {
    const project = await makeProject({ lib: 'lib' });

    return { project, path: writeWorkflow(project, 'groom_booking') };
  }

  const manifestIn = (project: string): string =>
    join(project, '.mboss', 'manifest.json');

  it('draws the graph and leaves the folder alone', async () => {
    const { project, path } = await scannable();

    await open(
      fakeDocument(readFileSync(path, 'utf8'), path),
      previewsIn([]),
      trust(false),
    );
    for (let tries = 0; tries < 20; tries += 1) await settled();

    expect(lastCanvasInit().document.ok).toBe(true);
    expect(lastCanvasInit().manifest).toBeUndefined();
    expect(fileExists(manifestIn(project))).toBe(false);
  });

  it('reads the code behind once the person says so', async () => {
    const { project, path } = await scannable();
    const trusted = trust(false);

    await open(
      fakeDocument(readFileSync(path, 'utf8'), path),
      previewsIn([]),
      trusted,
    );

    trusted.grant();

    await until(() => lastCanvasInit().manifest !== undefined);
    expect(fileExists(manifestIn(project))).toBe(true);
  });
});

/**
 * The same canvas in a window that is trusted — so
 * that the two above are about the gate rather than
 * about a scan that never worked from here.
 */
describe('opening a workflow in a trusted window', () => {
  it('reads the code behind and hands it to the panel', async () => {
    const project = await makeProject({ lib: 'lib' });
    const path = writeWorkflow(project, 'groom_booking');

    await open(fakeDocument(readFileSync(path, 'utf8'), path));

    await until(() => lastCanvasInit().manifest !== undefined);
    expect(fileExists(join(project, '.mboss', 'manifest.json'))).toBe(true);
  });
});

/**
 * A function written while the canvas is open.
 *
 * The manifest is what the palette's `/lib` drawer
 * and the Inspector's picker are drawn from, and
 * what the host decides a handler's fit against. One
 * read when the tab opened and never again means a
 * function somebody has just written does not exist
 * as far as this canvas is concerned, and closing
 * the tab and opening it again is the only way to
 * say otherwise.
 */
describe('code written while a canvas is open', () => {
  /** A handler somebody adds to the project mid-
   *  session. Its types are its own, so writing it
   *  changes one file and nothing else. */
  const RESCHEDULE = `export async function reschedule(req: {
  at: string;
}): Promise<{ moved: boolean }> {
  return { moved: req.at !== '' };
}
`;

  /** The canvas over a project whose code-behind
   *  has been read once already. */
  async function openScanned(project: string): Promise<void> {
    const path = writeWorkflow(project, 'groom_booking');

    await open(fakeDocument(readFileSync(path, 'utf8'), path));
    await until(() => lastCanvasInit().manifest !== undefined);
  }

  it('reaches the panel without the tab being opened again', async () => {
    const project = await makeProject({ lib: 'lib' });
    await openScanned(project);

    writeFileSync(join(project, 'lib', 'reschedule.ts'), RESCHEDULE, 'utf8');
    coded.generated(project);

    await until(() =>
      (lastCanvasInit().manifest?.functions ?? []).some(
        (fn) => fn.export === 'reschedule',
      ),
    );
  });

  /** Reading a project's code-behind is a type-check
   *  of every file in it, so a canvas does it for
   *  the project it is in and no other. */
  it('leaves a canvas in another project alone', async () => {
    const project = await makeProject({ lib: 'lib' });
    await openScanned(project);

    const before = panel.posted.length;

    coded.generated(join(project, 'elsewhere'));
    for (let tries = 0; tries < 20; tries += 1) await settled();

    expect(panel.posted).toHaveLength(before);
  });
});

/**
 * Where the blocks sit, which is a fact about the
 * document rather than about the panel drawing it.
 *
 * A person's first move pins the whole graph: the
 * canvas writes a position for every node, not only
 * the one that was touched, so a document is either
 * fully placed or not placed at all. The one case in
 * between — an agent adding a block to a document
 * somebody has arranged — is core's to answer, and
 * the canvas must not answer it a second way by
 * pinning over the top.
 */
describe('placing blocks by hand', () => {
  /** The document as the canvas wrote it. */
  function wrote(index = 0): WorkflowIR {
    expect(recorded.written.length).toBeGreaterThan(index);

    return WorkflowIRSchema.parse(JSON.parse(recorded.written[index]!.text));
  }

  /** Where a node ended up, in the document that was
   *  written. */
  function placed(written: WorkflowIR, id: string) {
    return written.nodes.find((node) => node.id === id)?.position;
  }

  function addStep(position = { x: 320, y: 480 }, spliceEdge?: string): void {
    panel.send({
      type: 'addNode',
      view: 'canvas',
      baseRevision: ir.revision,
      kind: 'step',
      position,
      ...(spliceEdge === undefined ? {} : { spliceEdge }),
    });
  }

  it('writes the block that was dropped in, where it was dropped', async () => {
    addStep();
    await settled();

    const added = wrote().nodes.at(-1)!;

    expect(added.id).toBe('step');
    expect(added.kind).toBe('step');
    expect(added.title).toBe(messages.paletteLabels().step);
    expect(added.position).toEqual({ x: 320, y: 480 });
  });

  /**
   * A block let go of on a wire goes into it. The
   * wire ends at the new block, and a second wire
   * carries on to wherever the first one went — so
   * the run that went through two blocks goes
   * through three, in the same order.
   */
  it('splices the block into the wire it was dropped on', async () => {
    const split = ir.edges.find((edge) => edge.id === 'e2')!;

    addStep({ x: 160, y: 240 }, 'e2');
    await settled();

    const written = wrote();

    expect(written.nodes).toHaveLength(ir.nodes.length + 1);
    expect(written.edges).toHaveLength(ir.edges.length + 1);

    const added = written.nodes.at(-1)!;
    const before = written.edges.find((edge) => edge.id === 'e2')!;
    const after = written.edges.at(-1)!;

    // Into the block, and out of it to where the
    // wire used to go.
    expect(before.from).toEqual(split.from);
    expect(before.to).toEqual({ node: added.id });
    expect(after.from).toEqual({ node: added.id, port: 'out' });
    expect(after.to).toEqual(split.to);
  });

  it('wires the block to nothing when it was dropped on nothing', async () => {
    addStep();
    await settled();

    const written = wrote();

    expect(written.nodes).toHaveLength(ir.nodes.length + 1);
    expect(written.edges.map((edge) => edge.id)).toEqual(
      ir.edges.map((edge) => edge.id),
    );
  });

  /**
   * A loop-closing wire cannot be split. What came
   * back round would come back round to a block
   * created a moment ago, which is a document core
   * refuses — so the whole edit is refused here,
   * block included, rather than half-written.
   *
   * The canvas offers no gap on one, so this only
   * arrives from a frame running scripts. That is
   * exactly why it is checked here.
   */
  it('refuses a wire it could not split', async () => {
    const file = livingDocument();
    await open(file.document);

    addStep({ x: 160, y: 240 }, 'e8');
    addStep({ x: 160, y: 240 }, 'e_nope');
    await settled();

    expect(recorded.written).toEqual([]);
    expect(lastCanvasInit().inspector.selected).toBeUndefined();
  });

  it('pins every other block to the box it was drawn with', async () => {
    const { boxes } = lastCanvasInit();

    addStep();
    await settled();

    const written = wrote();

    for (const node of ir.nodes) {
      expect(placed(written, node.id)).toEqual({
        x: boxes[node.id]!.x,
        y: boxes[node.id]!.y,
      });
    }
  });

  /** Somebody has arranged this graph and an agent
   *  has added a block to it since. Core parks the
   *  unplaced one; pinning it here would be a second
   *  answer to the same question. */
  it('leaves a half-placed document to core', async () => {
    const halfPlaced = {
      ...ir,
      nodes: ir.nodes.map((node) =>
        node.id === 'find_slot' ? node : { ...node, position: { x: 0, y: 0 } },
      ),
    };

    await open(fakeDocument(JSON.stringify(halfPlaced)));

    addStep();
    await settled();

    expect(placed(wrote(), 'find_slot')).toBeUndefined();
  });

  it('shows the block it just added', async () => {
    const file = livingDocument();
    await open(file.document);

    addStep();
    await file.saved();

    expect(lastCanvasInit().inspector.selected?.node.id).toBe('step');
  });

  it('writes every position a move carries, and pins the rest', async () => {
    const { boxes } = lastCanvasInit();

    panel.send({
      type: 'move',
      view: 'canvas',
      baseRevision: ir.revision,
      positions: { find_slot: { x: 140, y: 260 } },
    });
    await settled();

    const written = wrote();

    expect(placed(written, 'find_slot')).toEqual({ x: 140, y: 260 });
    expect(placed(written, 'parse_request')).toEqual({
      x: boxes['parse_request']!.x,
      y: boxes['parse_request']!.y,
    });
  });

  it('lets go of every position when the graph is arranged', async () => {
    const file = livingDocument();
    await open(file.document);

    addStep();
    await file.saved();

    panel.send({
      type: 'arrange',
      view: 'canvas',
      baseRevision: ir.revision + 1,
    });
    await settled();

    expect(wrote(1).nodes.map((node) => node.position)).toEqual(
      wrote(1).nodes.map(() => undefined),
    );
  });

  /**
   * A graph nobody has placed is already the one
   * the engine lays out, so there is nothing there
   * for arranging to let go of.
   *
   * Writing it anyway would raise the revision over
   * a document that says exactly what it said
   * before — marking the tab dirty, spending the
   * base revision somebody else's edit was made
   * against, and putting a no-op on the undo stack.
   */
  it('writes nothing when there is no position to let go of', async () => {
    panel.send({
      type: 'arrange',
      view: 'canvas',
      baseRevision: ir.revision,
    });
    await settled();

    expect(recorded.written).toEqual([]);
    expect(recorded.told).toEqual([]);
  });

  /**
   * The command does what the toolbar button does,
   * on the canvas a person is looking at — which is
   * the only one it could sensibly mean.
   */
  it('arranges from the command, on the canvas in front of somebody', async () => {
    const file = livingDocument();
    await open(file.document);
    panel.focus();

    addStep();
    await file.saved();

    WorkflowCanvasEditor.active()?.arrange();
    await settled();

    expect(wrote(1).nodes.every((node) => node.position === undefined)).toBe(
      true,
    );
  });

  it('is no canvas at all once the tab is closed', async () => {
    panel.focus();
    panel.close();

    expect(WorkflowCanvasEditor.active()).toBeUndefined();
  });

  /**
   * A canvas open in some other tab is not the
   * canvas the command means.
   *
   * The command runs from the palette with no
   * argument, so what it is about is whatever is in
   * front of the person who ran it — and a canvas
   * nobody is looking at being laid out again,
   * because it happened to be the first one open,
   * is an edit to a file they did not ask about.
   */
  it('leaves a canvas nobody is looking at alone', async () => {
    expect(WorkflowCanvasEditor.active()).toBeUndefined();

    WorkflowCanvasEditor.active()?.arrange();
    await settled();

    expect(recorded.written).toEqual([]);
  });
});

/**
 * Deleting, which the document does and the canvas
 * does not.
 *
 * React Flow would happily drop a node out of its
 * own copy and leave the file holding a workflow
 * nobody asked for, so the key posts a message and
 * the picture changes when the document does.
 */
describe('deleting through the document', () => {
  function written(): WorkflowIR {
    expect(recorded.written).toHaveLength(1);

    return WorkflowIRSchema.parse(JSON.parse(recorded.written[0]!.text));
  }

  /** One press of the delete key: what was
   *  selected, and the wires the graph library
   *  hands over along with it. */
  function deleting(nodeIds: string[], edgeIds: string[]): void {
    panel.send({
      type: 'delete',
      view: 'canvas',
      baseRevision: ir.revision,
      nodeIds,
      edgeIds,
    });
  }

  it('bridges the gap a deleted block leaves', async () => {
    deleting(['record_booking'], ['e10', 'e11']);
    await settled();

    const after = written();

    expect(after.nodes.map((node) => node.id)).not.toContain('record_booking');
    expect(after.edges).toContainEqual(
      expect.objectContaining({
        from: { node: 'book_appointment', port: 'out' },
        to: { node: 'send_confirmation' },
      }),
    );
  });

  /**
   * A block and the wires it came with, in one
   * write.
   *
   * The graph library hands over every wire touching
   * a block that is going, so this is what an
   * ordinary delete of a wired block looks like. A
   * message per thing going would carry the base
   * revision the last one carried, each applied to
   * the document as it stood before any of them —
   * so only the last would survive, and the block
   * would still be there.
   */
  it('takes a wired block and its wires in one write', async () => {
    deleting(['find_slot'], ['e2', 'e3', 'e8']);
    await settled();

    const after = written();

    expect(after.nodes.map((node) => node.id)).not.toContain('find_slot');
    expect(after.edges.map((edge) => edge.id)).toEqual([
      'e1',
      'e4',
      'e5',
      'e6',
      'e7',
      'e9',
      'e10',
      'e11',
    ]);
    expect(after.revision).toBe(ir.revision + 1);
  });

  it('takes a whole selection in one write', async () => {
    deleting(['twilio_chat', 'await_reply'], ['e5', 'e6', 'e7']);
    await settled();

    const after = written();

    expect(after.nodes.map((node) => node.id)).toEqual(
      ir.nodes
        .map((node) => node.id)
        .filter((id) => id !== 'twilio_chat' && id !== 'await_reply'),
    );
    expect(after.edges).toContainEqual(
      expect.objectContaining({
        from: { node: 'slot_open', port: 'no' },
        to: { node: 'reply_decision' },
      }),
    );
  });

  it('says nothing about a block the document does not have', async () => {
    deleting(['no_such_node'], []);
    await settled();

    expect(recorded.written).toEqual([]);
  });

  it('removes only the wire it was told to', async () => {
    deleting([], ['e9']);
    await settled();

    expect(written().edges.map((edge) => edge.id)).toEqual(
      ir.edges.filter((edge) => edge.id !== 'e9').map((edge) => edge.id),
    );
  });
});

/**
 * When the panel throws away the nodes it is holding
 * and takes the host's.
 *
 * It has to hold its own once a person can drag one:
 * a message arriving mid-drag would put the node back
 * where the document still says it is. So the host
 * says which layout this is, and everything that is
 * not the layout — a selection, a manifest finishing
 * — leaves that key alone and is patched in.
 */
describe('the layout the panel is drawing', () => {
  it('keeps its key while only the selection moves', async () => {
    const before = lastCanvasInit().layoutKey;

    panel.send({ type: 'select', view: 'canvas', nodeId: 'find_slot' });
    await settled();

    expect(lastCanvasInit().layoutKey).toBe(before);
  });

  it('keeps its key while the code-behind is being read', async () => {
    const project = await makeProject({ lib: 'lib' });
    const path = writeWorkflow(project, 'groom_booking');

    await open(fakeDocument(readFileSync(path, 'utf8'), path));
    const before = lastCanvasInit().layoutKey;

    await until(() => lastCanvasInit().manifest !== undefined);

    expect(lastCanvasInit().layoutKey).toBe(before);
  });

  it('takes a new key once a block has been moved', async () => {
    const file = livingDocument();
    await open(file.document);

    const before = lastCanvasInit().layoutKey;

    panel.send({
      type: 'move',
      view: 'canvas',
      baseRevision: ir.revision,
      positions: { find_slot: { x: 140, y: 260 } },
    });
    await file.saved();

    expect(lastCanvasInit().layoutKey).not.toBe(before);
  });
});

/**
 * The run this canvas is about, while somebody is
 * following one.
 *
 * A run is a fact about the workflow rather than
 * about the document, so it arrives without the
 * document changing — which is exactly the case the
 * layout key exists for. It is also the one thing
 * on this canvas that belongs to another window's
 * subject entirely: the store follows whatever run
 * a person started, and most of them are runs of
 * some other workflow.
 */
describe('a run of the workflow on screen', () => {
  it('is patched in, leaving the layout where it was', async () => {
    const runs = runsSaying();
    await open(fakeDocument(), previewsIn([]), trust(true), runs);

    const before = lastCanvasInit().layoutKey;

    runs.heard(runOf('groom_booking'));
    await settled();

    expect(lastCanvasInit().run?.workflowId).toBe('wf_1');
    expect(lastCanvasInit().layoutKey).toBe(before);
  });

  it('is a run this canvas already had when it opened', async () => {
    const runs = runsSaying();
    runs.heard(runOf('groom_booking'));

    await open(fakeDocument(), previewsIn([]), trust(true), runs);

    expect(lastCanvasInit().run?.workflowId).toBe('wf_1');
  });

  it('says nothing about a run of some other workflow', async () => {
    const runs = runsSaying();
    await open(fakeDocument(), previewsIn([]), trust(true), runs);

    const posted = panel.posted.length;

    runs.heard(runOf('invoice_dunning'));
    await settled();

    expect(lastCanvasInit().run).toBeUndefined();
    expect(panel.posted).toHaveLength(posted);
  });

  it('lets go of a run the store has let go of', async () => {
    const runs = runsSaying();
    await open(fakeDocument(), previewsIn([]), trust(true), runs);

    runs.heard(runOf('groom_booking'));
    await settled();
    runs.heard(undefined);
    await settled();

    expect(lastCanvasInit().run).toBeUndefined();
  });
});

/** Every field the Inspector is about to draw has
 *  a word to draw beside it. */
function labelled(shown: CanvasInspector): boolean {
  const fields = shown.selected?.form.fields ?? [];

  return fields.every((field) => {
    const own = shown.strings.fields[field.id] !== undefined;
    if (field.control !== 'choice') return own;

    return (
      own &&
      field.options.every(
        (option) =>
          shown.strings.options[`${field.id}.${option}`] !== undefined,
      )
    );
  });
}
