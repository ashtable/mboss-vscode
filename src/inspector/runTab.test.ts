import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TextDocument } from 'vscode';
import { describe, expect, it } from 'vitest';

import { fakeTrust } from '../../test/doubles/trust.js';
import type { CanvasSession } from '../canvas/editor.js';
import { canvasSessions } from '../canvas/sessions.js';
import { workflowDocument } from '../core/index.js';
import { WorkflowIRSchema } from '../core/rules.js';
import { emitter } from '../emitter.js';
import { messages } from '../messages.js';
import { toStep, type Step } from '../runs/rows.js';
import { runTabOf, type SeeView } from '../runs/view.js';
import { makeProject, writeWorkflow } from '../test-support/project.js';
import { STEP_ROW } from '../test-support/runs.js';
import type { InspectorMode } from '../webview/protocol.js';

import { runTabSurface } from './runTab.js';
import type { BlockInputs } from './surface.js';

/**
 * The run tab as a surface a block is picked on.
 *
 * What is asked here is what the surface answers
 * and does from what it holds: which document a
 * block is drawn from and against which revision,
 * where an edit lands, where a block's code and a
 * recorded value are opened, and when it says it
 * moved. What the pane draws from the answer is
 * `subject.ts`'s; how the pane routes to it is
 * `view.ts`'s.
 */

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
const NOW = 5000;

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
    selectedNode: 'find_slot',
    ...over,
  };
}

/** A canvas session answering only what the surface
 *  reads of one and asks of one, every verb written
 *  down in order. */
function session(over: Partial<BlockInputs> = {}, did: unknown[][] = []) {
  const changes = emitter();
  const inputs: BlockInputs = {
    source: 'canvas',
    file: 'groom_booking.workflow.json',
    path: PATH,
    workflow: 'groom_booking',
    read: { ok: true, ir },
    revision: ir.revision,
    manifest: undefined,
    diagnostics: [],
    selected: undefined,
    face: 'configure',
    run: undefined,
    decided: {},
    proposedBy: undefined,
    functionId: undefined,
    ...over,
  };

  const canvas = {
    block: () => ({ ...inputs }),
    onChanged: changes.on,
    edit: async (message: unknown) => void did.push(['edit', message]),
    select: (nodeId: string | null) => {
      did.push(['select', nodeId]);
      inputs.selected = nodeId ?? undefined;
      changes.fire();
    },
  } as unknown as CanvasSession;

  return { canvas, inputs, did, moved: () => changes.fire() };
}

function surface(options: { project?: string; trusted?: boolean } = {}) {
  const asked: unknown[][] = [];
  const registry = canvasSessions();
  const tab: { reading: SeeView | undefined } = { reading: undefined };
  const moves = emitter();
  const documents = emitter<TextDocument>();
  const proposals = new Map<string, string>();
  const proposing = emitter();
  const generated = emitter<string>();
  const trust = fakeTrust(options.trusted ?? false);
  const project = options.project ?? PROJECT;

  // The document as the editor holds it: what a spec
  // put in the buffer, else the file where one is.
  const texts = new Map<string, string>();
  const opens: { canvas: CanvasSession | undefined } = { canvas: undefined };

  const built = runTabSurface({
    runs: {
      detail: () => tab.reading,
      tab: (now) =>
        tab.reading === undefined ? undefined : runTabOf(tab.reading, now),
      project: () => project,
      chooseFace: (mode: InspectorMode) =>
        void asked.push(['chooseFace', mode]),
      selectNode: (nodeId) => void asked.push(['selectNode', nodeId]),
      onChanged: moves.on,
    },
    sessions: {
      ...registry,
      whenOpen: (path) => {
        asked.push(['whenOpen', path]);

        return registry.whenOpen(path);
      },
    },
    editor: {
      openCanvas: async (path, how) => {
        asked.push(['openCanvas', path, how]);

        const canvas = opens.canvas;

        if (canvas !== undefined) {
          setTimeout(() => registry.register(path, canvas, { active: false }));
        }
      },
      documentText: (path) =>
        texts.get(path) ??
        (existsSync(path) ? readFileSync(path, 'utf8') : undefined),
      onDocumentChanged: documents.on,
    },
    opener: {
      openFile: async (path, at) => void asked.push(['openFile', path, at]),
      showText: async (content, language) =>
        void asked.push(['showText', content, language]),
      say: (message) => void asked.push(['say', message]),
    },
    preview: {
      forWorkflow: (_project, workflow) => {
        const by = proposals.get(workflow);

        return by === undefined ? undefined : ({ proposedBy: by } as never);
      },
      onChanged: proposing.on,
    },
    trust,
    code: { onGenerated: generated.on },
  });

  const documentOf = (name: string): string => workflowDocument(project, name);

  return {
    surface: built,
    asked,
    registry,
    tab,
    texts,
    opens,
    proposals,
    trust,
    documentOf,
    moved: () => moves.fire(),
    changed: (path: string) =>
      documents.fire({ uri: { fsPath: path } } as TextDocument),
    proposed: () => proposing.fire(),
    generated: (dir: string) => generated.fire(dir),
    /** What the surface said, from now on. */
    heard: () => {
      let count = 0;
      built.onChanged(() => {
        count += 1;
      });

      return () => count;
    },
  };
}

/** Waits for something a promise chain the spec
 *  cannot reach is going to do. */
async function until(done: () => boolean): Promise<void> {
  for (let tries = 0; tries < 100 && !done(); tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('what the run tab holds', () => {
  it('holds nothing while no run is shown', () => {
    const { surface: tab } = surface();

    expect(tab.holds(NOW)).toEqual({ tab: undefined, block: undefined });
    expect(tab.path()).toBeUndefined();
  });

  it('holds the run and no block while none is picked', () => {
    const pane = surface();

    pane.tab.reading = seeView({ selectedNode: undefined });

    expect(pane.surface.holds(NOW)).toMatchObject({
      tab: { workflowId: 'wf_1', picked: { nodeId: undefined } },
      block: undefined,
    });
    expect(pane.surface.path()).toBe(PATH);
  });

  /**
   * A block picked on the run tab is drawn from the
   * document as it is being worked on — the canvas
   * open on it, whose revision is the one its gate
   * checks an edit against — never the copy the run
   * page read off disk when the run was opened.
   */
  it('draws the block from the canvas open on the document', () => {
    const pane = surface();
    const open = session({
      read: { ok: true, ir: { ...ir, revision: 9 } },
      revision: 9,
    });

    pane.registry.register(PATH, open.canvas, { active: false });
    pane.tab.reading = seeView({ ir: { ...ir, revision: 7 } });

    expect(pane.surface.holds(NOW).block).toMatchObject({
      source: 'run',
      path: PATH,
      revision: 9,
      read: { ok: true, ir: { revision: 9 } },
      selected: 'find_slot',
    });
  });

  it('draws it from the editor’s buffer where no canvas has it open', () => {
    const pane = surface();

    pane.texts.set(PATH, JSON.stringify({ ...ir, revision: 8 }));
    pane.tab.reading = seeView({ ir: { ...ir, revision: 7 } });

    expect(pane.surface.holds(NOW).block).toMatchObject({
      file: 'groom_booking.workflow.json',
      revision: 8,
      read: { ok: true, ir: { revision: 8 } },
      manifest: undefined,
      selected: 'find_slot',
      run: runTabOf(seeView(), NOW).inspected,
    });
  });

  /**
   * A canvas holding the document already knows who
   * is proposing against it; the store is asked only
   * where no canvas is.
   */
  it('says who is proposing against the document, from whoever holds it', () => {
    const pane = surface();

    pane.texts.set(PATH, JSON.stringify(ir));
    pane.tab.reading = seeView();
    pane.proposals.set('groom_booking', 'codex');

    expect(pane.surface.holds(NOW).block).toMatchObject({
      proposedBy: 'codex',
    });

    const open = session({ revision: undefined, proposedBy: 'claude code' });
    pane.registry.register(PATH, open.canvas, { active: false });
    pane.proposals.clear();

    expect(pane.surface.holds(NOW).block).toMatchObject({
      revision: undefined,
      proposedBy: 'claude code',
    });
  });

  it('answers a document that will not read as such, by name', () => {
    const pane = surface();

    pane.tab.reading = seeView();
    pane.texts.set(PATH, '{ not json');

    expect(pane.surface.holds(NOW).block).toMatchObject({
      file: 'groom_booking.workflow.json',
      read: { ok: false },
    });

    pane.texts.delete(PATH);

    expect(pane.surface.holds(NOW).block).toMatchObject({
      read: { ok: false },
    });
  });

  it('opens on Run evidence, and on Configure once somebody picks it', () => {
    const pane = surface();

    pane.texts.set(PATH, JSON.stringify(ir));
    pane.tab.reading = seeView({ selectedStep: 3 });

    expect(pane.surface.holds(NOW).block).toMatchObject({
      face: 'evidence',
      functionId: 3,
    });

    pane.tab.reading = seeView({ face: 'configure' });

    expect(pane.surface.holds(NOW).block).toMatchObject({
      face: 'configure',
      functionId: undefined,
    });
  });

  it('picks a face and a block through the store, which draws both views', () => {
    const pane = surface();

    pane.surface.chooseFace('configure');
    pane.surface.select(null);

    expect(pane.asked).toEqual([
      ['chooseFace', 'configure'],
      ['selectNode', null],
    ]);
  });
});

/**
 * An edit made from the pane about a block picked
 * here goes through the canvas on the run's
 * document, because that is where the revision
 * gate, the questions an edit can ask and the write
 * live. With none open, one is opened beside the
 * run tab, and the edit waits for it to register.
 */
describe('an edit to a block picked on the run tab', () => {
  const node = { id: 'find_slot', title: 'Find a slot' };
  const about = { source: 'run', path: PATH, nodeId: 'find_slot' } as const;
  const edit = { type: 'edit', baseRevision: 12, node, about } as const;

  it('opens a canvas beside the run tab and waits for it', async () => {
    const pane = surface();
    const opened = session({}, pane.asked);

    pane.tab.reading = seeView();
    pane.opens.canvas = opened.canvas;

    void pane.surface.edit(edit);
    await until(() => pane.asked.length === 4);

    expect(pane.asked).toEqual([
      ['openCanvas', PATH, { beside: true, preserveFocus: true }],
      ['whenOpen', PATH],
      ['select', 'find_slot'],
      ['edit', edit],
    ]);
  });

  it('goes through the canvas already open on the document', async () => {
    const pane = surface();
    const open = session({}, pane.asked);

    pane.tab.reading = seeView();
    pane.registry.register(PATH, open.canvas, { active: false });

    await pane.surface.edit(edit);

    expect(pane.asked).toEqual([
      ['select', 'find_slot'],
      ['edit', edit],
    ]);
  });

  /** The edit lands on the block it was made about,
   *  not on whatever the tab has picked by the time
   *  it arrives. */
  it('lands on the block the edit was made about', async () => {
    const pane = surface();
    const open = session({}, pane.asked);

    pane.tab.reading = seeView({ selectedNode: 'book_appointment' });
    pane.registry.register(PATH, open.canvas, { active: false });

    await pane.surface.edit(edit);

    expect(pane.asked).toEqual([
      ['select', 'find_slot'],
      ['edit', edit],
    ]);
  });

  it('edits nothing while no run is shown', async () => {
    const pane = surface();

    await pane.surface.edit(edit);

    expect(pane.asked).toEqual([]);
  });
});

/**
 * The ways into a block's code and its recorded
 * values, from the run tab: the code out of the
 * document as the editor holds it, with the
 * code-behind read beside it, and the frame and
 * the value off the rows the tab already holds.
 */
describe('the way to what a block picked on the run tab runs and recorded', () => {
  /** A project with a workflow the run is a run of,
   *  and the code behind it where asked for. */
  async function readable(over: { lib?: 'lib' } = {}): Promise<string> {
    const dir = await makeProject(over);

    writeWorkflow(dir, 'groom_booking');

    return dir;
  }

  it("opens a block's function out of the document as the editor holds it", async () => {
    const dir = await readable({ lib: 'lib' });
    const pane = surface({ project: dir, trusted: true });

    pane.tab.reading = seeView();

    await pane.surface.openFunction('find_slot');

    expect(pane.asked).toEqual([
      ['openFile', join(dir, 'lib', 'findSlot.ts'), { line: 6 }],
    ]);
  });

  /**
   * Reading the code-behind type-checks every file
   * in a project and writes the manifest it found
   * inside it, so it is one of the seams a window
   * nobody has trusted may not reach.
   */
  it('scans nothing in a window nobody has trusted', async () => {
    const dir = await readable({ lib: 'lib' });
    const pane = surface({ project: dir, trusted: false });

    pane.tab.reading = seeView();

    await pane.surface.openFunction('find_slot');

    expect(pane.asked).toEqual([]);
    expect(existsSync(join(dir, '.mboss', 'manifest.json'))).toBe(false);
  });

  it('says which function the code-behind has not got', async () => {
    const dir = await readable();
    const pane = surface({ project: dir, trusted: true });

    pane.tab.reading = seeView();

    await pane.surface.openFunction('find_slot');

    expect(pane.asked).toEqual([
      ['say', messages.openFunctionUnknown('findSlot')],
    ]);
  });

  /**
   * The other way in: not the function the block
   * names, but the line the run recorded a failure
   * at. The frame comes off the stack the container
   * wrote, so the file it names is a claim about the
   * image rather than about this workspace.
   */
  describe('the line a failure came from', () => {
    /** The tab showing a run whose one row failed on
     *  a line the container recorded. */
    async function showing(file: string) {
      const dir = await readable({ lib: 'lib' });
      const pane = surface({ project: dir, trusted: true });
      const failed: Step = toStep({
        ...STEP_ROW,
        function_id: 4,
        function_name: 'find_slot',
        error: JSON.stringify({
          json: {
            name: 'SlotTaken',
            message: 'no slot left',
            stack:
              'SlotTaken: no slot left\n' +
              `    at findSlot (/app/${file}:6:9)`,
          },
          __dbos_serializer: 'superjson',
        }),
      });

      pane.tab.reading = seeView({ steps: [failed], selectedStep: 4 });

      return { dir, pane };
    }

    it('opens the file the failure came from', async () => {
      const { dir, pane } = await showing('lib/findSlot.ts');

      await pane.surface.openErrorLocation('find_slot', 4);

      expect(pane.asked).toEqual([
        ['openFile', join(dir, 'lib', 'findSlot.ts'), { line: 6, column: 9 }],
      ]);
    });

    it('says the file the failure named is gone', async () => {
      const { pane } = await showing('lib/rescheduleSlot.ts');

      await pane.surface.openErrorLocation('find_slot', 4);

      expect(pane.asked).toEqual([
        ['say', messages.errorLocationGone('lib/rescheduleSlot.ts')],
      ]);
    });

    /** A row that recorded no failure has no line to
     *  go to, and says nothing. */
    it('opens nothing for a row that did not fail', async () => {
      const { pane } = await showing('lib/findSlot.ts');

      await pane.surface.openErrorLocation('find_slot', 9);

      expect(pane.asked).toEqual([]);
    });
  });

  describe('the whole of a value the run recorded', () => {
    const WHOLE = `{"slot":"${'x'.repeat(4000)}"}`;

    function showing() {
      const pane = surface();

      pane.tab.reading = seeView({
        steps: [toStep({ ...STEP_ROW, function_id: 4, output: WHOLE })],
      });

      return pane;
    }

    it('opens the stored value as JSON', async () => {
      const pane = showing();

      await pane.surface.openOutput('wf_1', 4);

      expect(pane.asked).toEqual([['showText', WHOLE, 'json']]);
    });

    it('opens nothing for a run it is not showing', async () => {
      const pane = showing();

      await pane.surface.openOutput('wf_somebody_else', 4);

      expect(pane.asked).toEqual([]);
    });

    it('opens nothing for a row that returned nothing', async () => {
      const pane = showing();

      await pane.surface.openOutput('wf_1', 9);

      expect(pane.asked).toEqual([]);
    });
  });
});

/**
 * The surface says when it moved in any of the ways
 * a block picked on it is drawn from, and for
 * nothing else, so the pane about it redraws once
 * per move and not for a document or a canvas it is
 * not drawing.
 */
describe('when the run tab says it moved', () => {
  it('says so when the runs move', () => {
    const pane = surface();
    const count = pane.heard();

    pane.moved();

    expect(count()).toBe(1);
  });

  it('says so when its document changes, and not for another', () => {
    const pane = surface();

    pane.tab.reading = seeView();
    const count = pane.heard();

    pane.changed(pane.documentOf('refund_approval'));
    expect(count()).toBe(0);

    pane.changed(PATH);
    expect(count()).toBe(1);
  });

  it('says so when the canvas open on its document moves, and not for another', () => {
    const pane = surface();
    const open = session();
    const other = session({ path: pane.documentOf('refund_approval') });

    pane.tab.reading = seeView();
    pane.registry.register(PATH, open.canvas, { active: false });
    pane.registry.register(other.inputs.path, other.canvas, { active: false });
    const count = pane.heard();

    other.moved();
    expect(count()).toBe(0);

    open.moved();
    expect(count()).toBe(1);
  });

  it('says so for a proposal, for trust granted and for code generated', () => {
    const pane = surface();
    const count = pane.heard();

    pane.proposed();
    pane.trust.grant();
    pane.generated(PROJECT);

    expect(count()).toBe(3);
  });

  /**
   * The code-behind is read once per project behind
   * trust, and again once trust arrives or the
   * project has been generated: what was read
   * before is not what the project holds now.
   */
  it('reads the project’s code again once it can have changed', async () => {
    const dir = await makeProject({ lib: 'lib' });
    const path = writeWorkflow(dir, 'groom_booking');
    const pane = surface({ project: dir, trusted: false });

    pane.tab.reading = seeView();

    expect(pane.surface.holds(NOW).block?.manifest).toBeUndefined();

    pane.trust.grant();

    expect(pane.surface.holds(NOW).block?.manifest).toBeDefined();

    // A function written since is one the block's
    // form should offer.
    writeFileSync(
      join(dir, 'lib', 'rescheduleSlot.ts'),
      readFileSync(join(dir, 'lib', 'findSlot.ts'), 'utf8').replace(
        /findSlot/g,
        'rescheduleSlot',
      ),
      'utf8',
    );
    const named = (): boolean =>
      pane.surface
        .holds(NOW)
        .block?.manifest?.functions.some(
          (one) => one.export === 'rescheduleSlot',
        ) ?? false;

    expect(named()).toBe(false);

    pane.generated(dir);

    expect(named()).toBe(true);
    expect(path).toBe(pane.surface.path());
  });
});
