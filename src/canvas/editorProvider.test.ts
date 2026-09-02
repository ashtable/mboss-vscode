import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { fakeWebview, type FakeWebview } from '../../test/doubles/webview.js';
import { WorkflowIRSchema, type WorkflowIR } from '../core/rules.js';
import { previewStore, type PreviewStore } from '../preview/store.js';
import { makeProject, writeWorkflow } from '../test-support/project.js';
import { fileExists } from '../test-support/repo.js';
import { propose, specOf } from '../test-support/proposals.js';
import type { VsCodeApi } from '../vscodeApi.js';
import type { CanvasInit, InspectorInit } from '../webview/protocol.js';

import { WorkflowCanvasEditor, type CanvasTrust } from './editor.js';
import { Selection } from './selection.js';

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
  context: Record<string, unknown>;
  change: (document: { uri: { toString(): string } }) => void;
};

function recorder(): Recorded {
  const written: Written[] = [];
  const told: string[] = [];
  const context: Record<string, unknown> = {};
  const watchers: ((document: never) => void)[] = [];

  return {
    written,
    told,
    context,
    change: (document) => {
      for (const watcher of watchers) watcher(document as never);
    },
    api: {
      info: (message) => told.push(message),
      run: () => Promise.resolve(),
      setContext: (key, value) => {
        context[key] = value;

        return Promise.resolve();
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

const extensionUri = { path: '/ext' } as never;

/** The proposals in these folders, if any. Most of
 *  these specs are about the document, and pass
 *  none. */
function previewsIn(folders: string[]): PreviewStore {
  return previewStore({
    folders: () => folders,
    isTrusted: () => true,
    regenerate: async () => {},
    notify: async () => {},
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

let recorded: Recorded;
let selection: Selection;
let panel: FakeWebview;

async function open(
  document = fakeDocument(),
  preview = previewsIn([]),
  trusted: CanvasTrust = trust(true),
): Promise<void> {
  recorded = recorder();
  selection = new Selection(recorded.api);
  panel = fakeWebview();

  const editor = new WorkflowCanvasEditor(
    extensionUri,
    recorded.api,
    selection,
    preview,
    trusted,
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

describe('selecting a node', () => {
  it('reveals the Inspector and offers it the node', async () => {
    panel.send({ type: 'select', view: 'canvas', nodeId: 'find_slot' });
    await settled();

    expect(recorded.context['mboss.nodeSelected']).toBe(true);
    expect(selection.current()?.node.id).toBe('find_slot');
  });

  it('returns the container to the agent when nothing is selected', async () => {
    panel.send({ type: 'select', view: 'canvas', nodeId: 'find_slot' });
    await settled();
    panel.send({ type: 'select', view: 'canvas', nodeId: null });
    await settled();

    expect(recorded.context['mboss.nodeSelected']).toBe(false);
    expect(selection.current()).toBeUndefined();
  });

  it('says nothing about a node the document does not have', async () => {
    panel.send({ type: 'select', view: 'canvas', nodeId: 'no_such_node' });
    await settled();

    expect(selection.current()).toBeUndefined();
  });

  /**
   * Two canvases can be open at once and only one
   * of them owns the selection. Closing the other
   * must not take the Inspector down with it.
   */
  it('survives another canvas being closed', async () => {
    panel.send({ type: 'select', view: 'canvas', nodeId: 'find_slot' });
    await settled();

    const other = fakeWebview();
    await new WorkflowCanvasEditor(
      extensionUri,
      recorded.api,
      selection,
      previewsIn([]),
      trust(true),
    ).resolveCustomTextEditor(
      fakeDocument(text, '/project/.mboss/workflows/other.workflow.json'),
      other.panel,
    );
    other.close();
    await settled();

    expect(selection.current()?.node.id).toBe('find_slot');
    expect(recorded.context['mboss.nodeSelected']).toBe(true);
  });
});

describe('an edit from the Inspector', () => {
  it('replaces the node it names and leaves the rest alone', async () => {
    panel.send({ type: 'select', view: 'canvas', nodeId: 'find_slot' });
    await settled();

    const renamed = {
      ...ir.nodes.find((node) => node.id === 'find_slot'),
      title: 'Find an open slot',
    };

    selection.edit({ baseRevision: ir.revision, node: renamed });
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
    panel.send({ type: 'select', view: 'canvas', nodeId: 'find_slot' });
    await settled();

    selection.edit({
      baseRevision: ir.revision,
      node: { id: 'find_slot', kind: 'step', title: 'x', config: null },
    });
    await settled();

    expect(recorded.written).toHaveLength(0);
    expect(recorded.told).toHaveLength(1);
  });
});

describe('what the Inspector is told', () => {
  it('is the selected node, and the labels for its fields', async () => {
    panel.send({ type: 'select', view: 'canvas', nodeId: 'reply_decision' });
    await settled();

    const shown = selection.inspectorInit();

    expect(shown.view).toBe('inspector');
    expect(shown.selected?.form.kind).toBe('branch');
    expect(labelled(shown)).toBe(true);
  });

  it('is nothing at all when nothing is selected', () => {
    expect(selection.inspectorInit().selected).toBeUndefined();
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
  it('takes the canvas over, and nothing on it edits', async () => {
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

    const init = lastCanvasInit();

    expect(init.preview?.headline).toContain('claude code');
    expect(init.document.ok && init.document.ir.title).toBe(
      'Groom booking, as proposed',
    );

    panel.send({ type: 'select', view: 'canvas', nodeId: 'find_slot' });
    panel.send({ type: 'text', view: 'canvas', text: '{}' });
    await settled();

    expect(recorded.written).toEqual([]);
    expect(selection.current()).toBeUndefined();
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

/** Every field the Inspector is about to draw has
 *  a word to draw beside it. */
function labelled(shown: InspectorInit): boolean {
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
