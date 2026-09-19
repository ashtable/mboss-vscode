import { basename } from 'node:path';

import type { Disposable } from 'vscode';

import type { CanvasCode } from '../canvas/editor.js';
import type { CanvasSessions } from '../canvas/sessions.js';
import {
  checkWorkflow,
  isWorkflowName,
  manifestFor,
  readWorkflow,
  workflowDocument,
} from '../core/index.js';
import type { LibManifest } from '../core/rules.js';
import { emitter } from '../emitter.js';
import { openHandler, openSourceFrame } from '../openHandler.js';
import type { PreviewStore } from '../preview/store.js';
import { stepError } from '../runs/rows.js';
import type { RunTab, SeeView } from '../runs/view.js';
import type { Trust } from '../trust.js';
import type { VsCodeApi } from '../vscodeApi.js';
import type { CanvasDocument, InspectorMode } from '../webview/protocol.js';

import type { BlockInputs, BlockSurface } from './surface.js';

/**
 * The run tab, as a surface a block is picked on.
 *
 * A canvas is its own surface: its session holds
 * the document, the selection and the verbs. The
 * run tab holds none of that itself — the run is
 * the store's, the block picked on it is the
 * store's, and the document it is drawn from is the
 * editor's, the canvas open on it or the buffer —
 * so this is the one place that puts them together
 * and answers the same questions a canvas does.
 *
 * What a block picked here is drawn from is the
 * document as it is being worked on, never the copy
 * the run page read off disk: an edit lands in the
 * buffer and bumps the revision there, and a form
 * drawn from the disk copy would be refused as
 * stale after the first one. The run's rows, the
 * decided arms and the replay's refusal keep the
 * saved drawing, which is the store's one reading.
 */

/** The runs, as the run tab's surface reads them:
 *  the open run, what is picked on it, and the
 *  project it was read from. */
export type RunTabRuns = {
  /** The run the tab is showing, as it was read:
   *  which run, and what is picked on it. */
  detail(): SeeView | undefined;

  /** That run as the pane reads it, projected once
   *  at the moment the pane passed. */
  tab(now: number): RunTab | undefined;

  /** The project the runs are read from, which is
   *  where the run's document is. */
  project(): string | undefined;

  chooseFace(mode: InspectorMode): void;

  selectNode(nodeId: string | null): void;

  onChanged(listener: () => void): Disposable;
};

/** The editor, as the run tab's surface reaches it. */
export type RunTabEditor = {
  /** Opens a workflow document in its canvas. */
  openCanvas(
    path: string,
    how: { beside: boolean; preserveFocus: boolean },
  ): Promise<void>;

  /** A document's text as the editor holds it: an
   *  open one's buffer, unsaved changes and all,
   *  else the file. */
  documentText(path: string): string | undefined;

  onDocumentChanged: VsCodeApi['onDocumentChanged'];
};

export type RunTabDeps = {
  runs: RunTabRuns;
  sessions: Pick<CanvasSessions, 'forPath' | 'whenOpen' | 'onChanged'>;
  editor: RunTabEditor;

  /** Where a block's code and a recorded value are
   *  opened, and where a sentence about them is
   *  said. */
  opener: Pick<VsCodeApi, 'openFile' | 'showText' | 'say'>;

  preview: Pick<PreviewStore, 'forWorkflow' | 'onChanged'>;
  trust: Trust;
  code: CanvasCode;
};

export type RunTabSurface = BlockSurface &
  Disposable & {
    /**
     * What the tab holds at that moment: the run as
     * the store projected it, and the block picked on
     * it drawn from the document as the editor holds
     * it. No block while none is picked, or while no
     * project holds the document.
     */
    holds(now: number): {
      tab: RunTab | undefined;
      block: BlockInputs | undefined;
    };

    /** Where the document the tab's run is a run of
     *  is, whatever is picked; nothing while no run
     *  is shown or no project is open. A message that
     *  names a path is compared with this and never
     *  followed. */
    path(): string | undefined;

    /**
     * Hears the tab move in any of the ways a block
     * picked on it is drawn from: the run, its
     * selection and ticks, the document behind the
     * block, the canvas open on it, a proposal
     * against it, and the project's code, which is
     * read again when it can have changed.
     */
    onChanged(listener: () => void): Disposable;
  };

/** Where the run's document is, and whose run it is. */
type Where = {
  project: string;
  path: string;
  name: string;
};

/** What a form is drawn from, read out of the
 *  document as the editor holds it. */
type Drawn = {
  file: string;
  read: CanvasDocument;
  revision: number | undefined;
  manifest: LibManifest | undefined;
  diagnostics: BlockInputs['diagnostics'];
  proposedBy: string | undefined;
};

/**
 * One surface for the window, built where the
 * canvas and the Inspector are introduced.
 *
 * Its subscriptions are made here rather than while
 * the pane is mounted: the pane is torn down when
 * hidden, and code read before it was hidden is
 * code it must not draw once it is shown again.
 */
export function runTabSurface(deps: RunTabDeps): RunTabSurface {
  const changes = emitter();

  /**
   * The code-behind of each project a block has been
   * drawn from, read once and read again when it can
   * have changed.
   *
   * Read here only where no canvas has the document
   * open: a canvas scans its own. A scan type-checks
   * every file in `lib/`, far too slow to repeat on
   * every tick of a run.
   */
  const manifests = new Map<string, LibManifest | undefined>();

  /**
   * The document the run in front is a run of, where
   * it can have one.
   *
   * The name is what the ledger recorded, and not
   * every run is one of a document: a queue block's
   * items run under the block's id and the
   * document's name joined, which no document is
   * filed under. Such a run has nothing to draw a
   * block from, rather than a path to nowhere.
   */
  const where = (): Where | undefined => {
    const reading = deps.runs.detail();
    const project = deps.runs.project();

    if (reading === undefined || project === undefined) return undefined;
    if (!isWorkflowName(reading.run.name)) return undefined;

    return {
      project,
      path: workflowDocument(project, reading.run.name),
      name: reading.run.name,
    };
  };

  const manifestOf = (project: string): LibManifest | undefined => {
    if (!deps.trust.isTrusted()) return undefined;

    if (!manifests.has(project)) {
      manifests.set(project, manifestFor(project));
    }

    return manifests.get(project);
  };

  /**
   * The document as the editor holds it, drawn: the
   * canvas open on it when one is, since its
   * revision is the one its gate checks an edit
   * against, else the buffer or the file, with the
   * project's code-behind read beside it.
   *
   * A canvas holding the document already knows who
   * is proposing against it; the store is asked only
   * where no canvas is.
   */
  const drawn = (found: Where): Drawn => {
    const canvas = deps.sessions.forPath(found.path);

    if (canvas !== undefined) {
      const held = canvas.block();

      return {
        file: held.file,
        read: held.read,
        revision: held.revision,
        manifest: held.manifest,
        diagnostics: held.diagnostics,
        proposedBy: held.proposedBy,
      };
    }

    const parsed = readWorkflow(deps.editor.documentText(found.path) ?? '');
    const read: CanvasDocument = parsed.ok
      ? { ok: true, ir: parsed.ir }
      : { ok: false, detail: parsed.detail };
    const manifest = manifestOf(found.project);

    return {
      file: basename(found.path),
      read,
      revision: read.ok ? read.ir.revision : undefined,
      manifest,
      diagnostics: read.ok ? checkWorkflow(read.ir, manifest) : [],
      proposedBy: deps.preview.forWorkflow(found.project, found.name)
        ?.proposedBy,
    };
  };

  const holds = (
    now: number,
  ): { tab: RunTab | undefined; block: BlockInputs | undefined } => {
    const tab = deps.runs.tab(now);
    const found = where();
    const nodeId = tab?.picked.nodeId;

    if (tab === undefined || found === undefined || nodeId === undefined) {
      return { tab, block: undefined };
    }

    const document = drawn(found);

    return {
      tab,
      block: {
        source: 'run',
        file: document.file,
        path: found.path,
        workflow: tab.name,
        read: document.read,
        revision: document.revision,
        manifest: document.manifest,
        diagnostics: document.diagnostics,
        selected: nodeId,
        // A block picked on a run is picked to see
        // what the run recorded, until somebody says
        // otherwise.
        face: tab.picked.face ?? 'evidence',
        run: tab.inspected,
        decided: tab.decided,
        proposedBy: document.proposedBy,
        functionId: tab.picked.functionId,
      },
    };
  };

  const following = [
    deps.runs.onChanged(() => changes.fire()),

    // The canvas open on the run's document moving,
    // and no other.
    deps.sessions.onChanged((moved) => {
      const path = where()?.path;

      if (path !== undefined && moved === deps.sessions.forPath(path)) {
        changes.fire();
      }
    }),

    // A change to the run's document from anywhere,
    // including its dirty state flipping on a save.
    deps.editor.onDocumentChanged((document) => {
      if (document.uri.fsPath === where()?.path) changes.fire();
    }),

    deps.preview.onChanged(() => changes.fire()),

    // Code read before trust was granted, or before
    // the project was generated, is code that must
    // not be drawn again.
    deps.trust.onGranted(() => {
      manifests.clear();
      changes.fire();
    }),
    deps.code.onGenerated((project) => {
      manifests.delete(project);
      changes.fire();
    }),
  ];

  return {
    holds,

    block: (now) => holds(now).block,

    path: () => where()?.path,

    select: (nodeId) => deps.runs.selectNode(nodeId),

    chooseFace: (mode) => deps.runs.chooseFace(mode),

    /**
     * An edit to a block picked here, made through
     * the canvas on its document.
     *
     * Through a canvas rather than written here,
     * because the canvas is where the revision gate,
     * the questions an edit can ask and the write
     * all live. With none open, one is opened beside
     * the run tab without taking focus from it, and
     * the edit waits for it to register. The block
     * the edit was made about is selected on it
     * first, so the canvas shows the block the edit
     * lands on whether or not the edit writes
     * anything.
     */
    edit: async (message) => {
      const found = where();
      if (found === undefined) return;

      let canvas = deps.sessions.forPath(found.path);

      if (canvas === undefined) {
        await deps.editor.openCanvas(found.path, {
          beside: true,
          preserveFocus: true,
        });
        canvas = await deps.sessions.whenOpen(found.path);
      }

      canvas.select(message.about.nodeId);
      await canvas.edit(message);
    },

    /**
     * The code the block runs, looked up in the
     * document as the editor holds it — the block
     * the pane is drawing — with the code-behind the
     * pane drew it beside. A window nobody has
     * trusted has no scan, and opens nothing rather
     * than running one to answer a click.
     */
    openFunction: async (nodeId) => {
      const found = where();
      if (found === undefined) return;

      const document = drawn(found);
      if (!document.read.ok || document.manifest === undefined) return;

      const node = document.read.ir.nodes.find((one) => one.id === nodeId);
      if (node === undefined) return;

      await openHandler(deps.opener, found.project, document.manifest, node);
    },

    /**
     * The line a recorded failure came from, read
     * off the rows the tab is already holding: the
     * frame is part of what the run recorded, and it
     * arrived with everything else the card is drawn
     * from.
     *
     * By the row alone. An SDK row drawn under a
     * block is picked as that block's, and the row
     * is the more exact of the two.
     */
    openErrorLocation: async (nodeId, functionId) => {
      const found = where();
      const reading = deps.runs.detail();
      if (found === undefined || reading === undefined) return;

      const row = reading.steps.find((one) => one.functionId === functionId);
      const frame = stepError(row?.failure)?.frame;

      await openSourceFrame(deps.opener, found.project, frame);
    },

    /**
     * The whole of what one row recorded, off the
     * rows the tab is holding. A row the ledger
     * recorded no value for has nothing to open, and
     * a panel that has moved on names a run this tab
     * is no longer showing, and gets nothing.
     */
    openOutput: async (workflowId, functionId) => {
      const reading = deps.runs.detail();
      if (reading === undefined || reading.run.workflowId !== workflowId)
        return;

      const row = reading.steps.find((one) => one.functionId === functionId);
      if (row?.output === undefined) return;

      await deps.opener.showText(row.output, 'json');
    },

    onChanged: (listener) => changes.on(listener),

    dispose: () => {
      for (const one of following) one.dispose();
      changes.dispose();
    },
  };
}
