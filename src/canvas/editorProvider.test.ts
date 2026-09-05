import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fakeWebview, type FakeWebview } from '../../test/doubles/webview.js';
import type { ToolEntry } from '../acp/transcript.js';
import {
  WorkflowIRSchema,
  starterNode,
  type WorkflowIR,
} from '../core/rules.js';
import { messages } from '../messages.js';
import { previewStore, type PreviewStore } from '../preview/store.js';
import { makeProject, writeWorkflow } from '../test-support/project.js';
import { fileExists } from '../test-support/repo.js';
import { propose, specOf } from '../test-support/proposals.js';
import type { LiveRun } from '../runs/watch.js';
import type { PickChoice, VsCodeApi } from '../vscodeApi.js';
import type { CanvasInit } from '../webview/protocol.js';

import {
  WorkflowCanvasEditor,
  type CanvasCode,
  type CanvasRuns,
  type CanvasTrust,
} from './editor.js';
import { GRID } from './grid.js';

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
 *
 * What a gesture means — which wire a dropped
 * block splices, what a deleted block leaves — is
 * a function of the document, and is asked as one
 * in `edits.test.ts`. Here each of those is driven
 * through once, for the sentence it says or the
 * effect that follows the write.
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

  /** Every list somebody was asked to choose
   *  from. */
  asked: { title: string; choices: PickChoice[] }[];

  /** What they choose next. Nothing is a picker
   *  dismissed. */
  answers: (id: string | undefined) => void;

  change: (document: { uri: { toString(): string } }) => void;
};

function recorder(): Recorded {
  const written: Written[] = [];
  const told: string[] = [];
  const noted: ToolEntry[] = [];
  const asked: { title: string; choices: PickChoice[] }[] = [];
  const watchers: ((document: never) => void)[] = [];
  const answer: { id: string | undefined } = { id: undefined };

  return {
    written,
    told,
    noted,
    asked,
    answers: (id) => {
      answer.id = id;
    },
    change: (document) => {
      for (const watcher of watchers) watcher(document as never);
    },
    api: {
      info: (message) => told.push(message),
      run: () => Promise.resolve(),
      pick: (title, choices) => {
        asked.push({ title, choices });

        return Promise.resolve(answer.id);
      },
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
     *  showing it is told. The write is given the
     *  tick it takes to land first. */
    saved: async () => {
      await settled();
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

  /**
   * The engine spaces a graph on numbers of its own,
   * none of them the canvas's, so a freshly laid-out
   * block sits between two grid lines. An arrow
   * press rounds where the block ends up rather than
   * how far it moved, so the first press on such a
   * block goes a fraction of a square the way it was
   * pressed and a few pixels sideways as well.
   */
  it('puts every box on the grid the canvas moves on', () => {
    const boxes = lastCanvasInit().boxes ?? {};

    expect(
      Object.entries(boxes).filter(
        ([, box]) => box.x % GRID !== 0 || box.y % GRID !== 0,
      ),
    ).toEqual([]);
  });

  it('tells it what core makes of the document', () => {
    expect(lastCanvasInit().diagnostics).toBeInstanceOf(Array);
  });

  it('says what it could not read rather than drawing nothing', async () => {
    await open(fakeDocument('{ "not": "a workflow" }'));

    const init = lastCanvasInit();

    expect(init.document.ok).toBe(false);
    expect(init.document.ok === false && init.document.detail).toBeTruthy();
    expect(init.editing).toBeUndefined();
  });
});

describe('an edit from the panel', () => {
  it('goes through the document VS Code owns', async () => {
    panel.send({
      type: 'connect',
      view: 'canvas',
      baseRevision: ir.revision,
      from: { node: 'find_slot' },
      to: { node: 'book_appointment' },
    });
    await settled();

    expect(recorded.written).toHaveLength(1);

    const written = WorkflowIRSchema.parse(
      JSON.parse(recorded.written[0]!.text),
    );

    expect(written.edges.at(-1)).toMatchObject({
      from: { node: 'find_slot' },
      to: { node: 'book_appointment' },
    });
  });

  it('raises the revision by exactly one', async () => {
    panel.send({
      type: 'connect',
      view: 'canvas',
      baseRevision: ir.revision,
      from: { node: 'find_slot' },
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
      from: { node: 'find_slot' },
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
        from: { node: 'find_slot' },
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

/**
 * A block has one dot to leave by and may have
 * several ways out, so which way a wire leaves by
 * is a question rather than something aimed at. It
 * is asked here, once the drop has happened, and
 * `'out'` is not an answer a panel may give: it is
 * not a port a branch has, and a wire naming it
 * would be a document nobody wrote.
 */
describe('which way out a new wire leaves by', () => {
  /** The document plus a block with two ways out of
   *  it, wired to nothing. */
  function withApproval(): WorkflowIR {
    return {
      ...ir,
      nodes: [...ir.nodes, starterNode('approval', 'sign_off', 'Sign off')],
    };
  }

  it('takes the only one there is without asking', async () => {
    panel.send({
      type: 'connect',
      view: 'canvas',
      baseRevision: ir.revision,
      from: { node: 'find_slot' },
      to: { node: 'book_appointment' },
    });
    await settled();

    expect(recorded.asked).toEqual([]);

    const written = WorkflowIRSchema.parse(
      JSON.parse(recorded.written[0]!.text),
    );

    expect(written.edges.at(-1)).toMatchObject({
      from: { node: 'find_slot' },
      to: { node: 'book_appointment' },
    });
  });

  it('asks a branch by what its cases decide, and writes the port', async () => {
    recorded.answers('no');

    panel.send({
      type: 'connect',
      view: 'canvas',
      baseRevision: ir.revision,
      from: { node: 'slot_open' },
      to: { node: 'send_confirmation' },
    });
    await settled();

    expect(recorded.asked).toHaveLength(1);
    expect(recorded.asked[0]!.choices).toEqual([
      { label: 'true', id: 'yes', detail: 'yes' },
      { label: messages.canvasFallThrough(), id: 'no', detail: 'no' },
    ]);

    const written = WorkflowIRSchema.parse(
      JSON.parse(recorded.written[0]!.text),
    );

    expect(written.edges.at(-1)).toMatchObject({
      from: { node: 'slot_open', port: 'no' },
      to: { node: 'send_confirmation' },
    });
  });

  it('asks an approval by its two outcomes, and writes the port', async () => {
    const document = withApproval();
    await open(fakeDocument(JSON.stringify(document)));

    recorded.answers('rejected');

    panel.send({
      type: 'connect',
      view: 'canvas',
      baseRevision: document.revision,
      from: { node: 'sign_off' },
      to: { node: 'send_confirmation' },
    });
    await settled();

    expect(recorded.asked[0]?.choices.map((choice) => choice.id)).toEqual([
      'approved',
      'rejected',
    ]);

    const written = WorkflowIRSchema.parse(
      JSON.parse(recorded.written[0]!.text),
    );

    expect(written.edges.at(-1)).toMatchObject({
      from: { node: 'sign_off', port: 'rejected' },
      to: { node: 'send_confirmation' },
    });
  });

  it('writes nothing when nobody answers', async () => {
    recorded.answers(undefined);

    panel.send({
      type: 'connect',
      view: 'canvas',
      baseRevision: ir.revision,
      from: { node: 'slot_open' },
      to: { node: 'send_confirmation' },
    });
    await settled();

    expect(recorded.asked).toHaveLength(1);
    expect(recorded.written).toEqual([]);
  });

  it('writes neither the block nor the wire when nobody answers', async () => {
    recorded.answers(undefined);

    panel.send({
      type: 'addNode',
      view: 'canvas',
      baseRevision: ir.revision,
      kind: 'step',
      position: { x: 400, y: 600 },
      connectFrom: { node: 'slot_open' },
    });
    await settled();

    expect(recorded.asked).toHaveLength(1);
    expect(recorded.written).toEqual([]);
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
  it('hands the Inspector column the block, and the revision to edit against', async () => {
    panel.send({ type: 'select', view: 'canvas', nodeId: 'reply_decision' });
    await settled();

    const init = lastCanvasInit();

    expect(init.inspector.selected).toBe('reply_decision');
    expect(init.editing).toEqual({ revision: ir.revision });
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

    expect(lastCanvasInit().inspector.selected).toBe('find_slot');
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

    expect(lastCanvasInit().inspector.selected).toBe('find_slot');
  });
});

describe('an edit from the Inspector column', () => {
  it('refuses a node the schema would not accept', async () => {
    panel.send({
      type: 'edit',
      view: 'canvas',
      baseRevision: ir.revision,
      node: { id: 'find_slot', kind: 'step', title: 'x', config: null },
    });
    await settled();

    expect(recorded.written).toHaveLength(0);
    expect(recorded.told).toEqual([messages.inspectorEditRefused()]);
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

  /**
   * The other way a misfit reaches a person: the
   * picker greys the row, and a chip dropped on the
   * block anyway is refused out loud. What the
   * refusal says has to be the same sentence the
   * greyed row said, or the two disagree about one
   * pairing — so it is spelled out here rather than
   * asked of the same helper that writes it.
   *
   * The line comes out of a real scan of the copied
   * code-behind, which is what makes it worth
   * printing at all.
   */
  it('refuses a handler that dials out of a transaction', async () => {
    await openScanned();
    const before = recorded.told.length;

    assign('record_booking', 'chargeCard');
    await settled();

    expect(recorded.written).toEqual([]);
    expect(recorded.told.slice(before)).toEqual([
      messages.handlerMisfit(
        'chargeCard',
        'Record booking',
        'calls fetch at line 12, needs a step',
      ),
    ]);
  });

  /**
   * The canvas is the other place a person changes
   * the document, and the transcript is where what
   * happened to it is read. A block that gained a
   * function without a row there reads, later, as
   * something the agent must have done.
   *
   * The row names the kind as well as the title,
   * because a title is whatever somebody typed and
   * two of them can read alike. Which kind of block
   * took the function is what says whether the
   * assignment was the one meant.
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
        target: 'tryAgain → Branch "Open at requested time?"',
      }),
    ]);
  });

  it('writes no row for an assignment it refused', async () => {
    await openScanned();

    assign('slot_open', 'parseRequest');
    await settled();

    expect(recorded.noted).toEqual([]);
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
    expect(lastCanvasInit().editing).toBeUndefined();
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
 * What follows a block being placed by hand: the
 * column showing it, a no-op that is not written,
 * and the Arrange command finding the canvas it
 * means. What the placing itself writes is asked in
 * `edits.test.ts`.
 */
describe('placing blocks by hand', () => {
  /** The document as the canvas wrote it. */
  function wrote(index = 0): WorkflowIR {
    expect(recorded.written.length).toBeGreaterThan(index);

    return WorkflowIRSchema.parse(JSON.parse(recorded.written[index]!.text));
  }

  function addStep(): void {
    panel.send({
      type: 'addNode',
      view: 'canvas',
      baseRevision: ir.revision,
      kind: 'step',
      position: { x: 320, y: 480 },
    });
  }

  /** Somebody has arranged this graph and an agent
   *  has added a block to it since. Core parks the
   *  unplaced one; pinning it here would be a second
   *  answer to the same question. */

  it('shows the block it just added', async () => {
    const file = livingDocument();
    await open(file.document);

    addStep();
    await file.saved();

    expect(lastCanvasInit().inspector.selected).toBe('step');
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
