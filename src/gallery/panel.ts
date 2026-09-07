import { basename } from 'node:path';

import { ViewColumn, window, type Uri, type WebviewPanel } from 'vscode';

import {
  isWorkflowName,
  listPatterns,
  patternNamed,
  startBlankWorkflow,
  startFromPattern,
  workflowFiles,
  type PatternGroup,
  type Started,
  type WorkflowPattern,
} from '../core/index.js';
import { messages } from '../messages.js';
import type { Trust } from '../trust.js';
import { mountWebview } from '../webview/host.js';
import type {
  GalleryCard,
  GalleryInit,
  GalleryShelf,
} from '../webview/protocol.js';

import { galleryWords } from './words.js';

/**
 * The gallery: whole workflows somebody starts
 * from, rather than an empty canvas.
 *
 * Every card is a document this product already
 * draws, and pressing Use writes that document and
 * the handlers it names into the open project. That
 * is the whole of it — nothing here compiles,
 * scans, renames a block or starts the stack, and
 * the sentence it says afterwards is careful not to
 * claim generated code exists, because none does
 * until the next save.
 *
 * The catalog is read out of the library on every
 * mount rather than held: a gallery is opened by
 * hand, a few small files is what it costs, and a
 * cached one would have to be invalidated by
 * something.
 */

/** How a workflow document is named on disk. */
const WORKFLOW_SUFFIX = '.workflow.json';

/**
 * What a blank workflow is called until somebody
 * says otherwise.
 *
 * Not a translated string: this is an identifier —
 * the document's file name, the generated
 * function's name and the name every run of it is
 * recorded against — and a locale that spelled it
 * with a capital would hand somebody a name the
 * rules refuse.
 */
const BLANK_NAME = 'my_workflow';

/**
 * The shelves, in the order somebody reads them.
 *
 * Written down rather than gathered from whatever
 * the patterns claim, so a shelf keeps its place
 * whether or not anything is on it, and so a
 * pattern filed under a fourth group is a compile
 * error here rather than a card nobody ever sees.
 */
const SHELVES = [
  'ai',
  'backend',
  'devops',
] as const satisfies readonly PatternGroup[];

/**
 * The editor, as starting a workflow reaches for
 * it.
 *
 * A narrow interface of its own rather than more
 * methods on one of the others: every stand-in a
 * spec writes has to implement the whole of
 * whatever it takes, and the flow below is driven
 * in its own spec with no editor at all.
 */
export type GalleryHost = {
  /** Every mBoss project open in this window. */
  projects(): string[];

  /** Asks what the workflow is called, checked as
   *  it is typed. */
  askName(prompt: {
    title: string;
    value: string;
    validate(value: string): string | undefined;
  }): Promise<string | undefined>;

  /** Runs work behind a progress notification. */
  withProgress<T>(title: string, work: () => Promise<T>): Promise<T>;

  info(message: string): void;

  /** Opens a workflow document on the canvas. */
  openCanvas(path: string): Promise<void>;
};

export type GalleryDeps = {
  host: GalleryHost;

  trust: Trust;

  /** Closes the gallery: what it was offering is
   *  now a document on screen. */
  done(): void;
};

/** What the gallery draws, and the two things
 *  somebody can do with it. */
export type Gallery = {
  init(): GalleryInit;

  usePattern(name: string): Promise<void>;

  startBlank(): Promise<void>;
};

export function gallery(deps: GalleryDeps): Gallery {
  return {
    init: () => ({
      type: 'init',
      view: 'gallery',
      strings: galleryWords(),
      groups: shelvesOf(listPatterns()),
    }),

    usePattern: async (name) => {
      const project = projectFor(deps);
      if (project === undefined) return;

      // A card the gallery never drew. The panel is
      // a frame running scripts, so the name it
      // sent is looked up in the library rather
      // than joined onto a path.
      const pattern = patternNamed(name);
      if (pattern === undefined) return;

      const called = await askName(deps, project, pattern.name);
      if (called === undefined) return;

      const outcome = await deps.host.withProgress(
        messages.newWorkflowWorking(called),
        async () => await startFromPattern(project, pattern, called),
      );

      if (outcome.at !== 'started') {
        deps.host.info(refusalFor(outcome));

        return;
      }

      await opened(deps, outcome.path);
      deps.host.info(created(pattern, called, outcome.written.length));
    },

    startBlank: async () => {
      const project = projectFor(deps);
      if (project === undefined) return;

      const called = await askName(deps, project, BLANK_NAME);
      if (called === undefined) return;

      const outcome = await deps.host.withProgress(
        messages.newWorkflowWorking(called),
        async () => await startBlankWorkflow(project, called),
      );

      if (outcome.at !== 'started') {
        deps.host.info(refusalFor(outcome));

        return;
      }

      // And nothing said. One document was written
      // and it is now the tab in front of whoever
      // asked for it; a pattern says a sentence
      // because it also wrote handler files nobody
      // can see.
      await opened(deps, outcome.path);
    },
  };
}

/**
 * Why a workflow was not started, in words
 * somebody can act on.
 *
 * The refusal that leaves files behind names them.
 * A pattern's handlers go in before its document so
 * that everything else refuses with the project as
 * it was found, and this is the one case that
 * cannot — nobody can clean up files they were not
 * told about.
 */
export function refusalFor(
  outcome: Exclude<Started, { at: 'started' }>,
): string {
  if (outcome.at === 'nameTaken') {
    return messages.workflowNameTaken(outcome.name);
  }

  if (outcome.at === 'codeInTheWay') {
    return messages.patternCodeExists(outcome.path);
  }

  const said = messages.newWorkflowRefused(outcome.detail);
  if (outcome.written.length === 0) return said;

  return `${said} ${messages.newWorkflowLeftBehind(outcome.written.join(', '))}`;
}

/**
 * A trusted window with a project in it, or the
 * sentence saying which of the two is missing.
 *
 * Asked here, at the seam that writes into a
 * folder, rather than when the gallery opens: the
 * gallery is a catalog, and trust granted while
 * somebody is reading it should not have to be
 * chased with a reload.
 */
function projectFor(deps: GalleryDeps): string | undefined {
  if (!deps.trust.isTrusted()) {
    deps.host.info(messages.newWorkflowNeedsTrust());

    return undefined;
  }

  // The first, the way every other zone that writes
  // into a project does. Which of two open projects
  // a new workflow belongs to is a question about
  // the window, and asking it before asking what
  // the workflow is called is one question too
  // many.
  const [project] = deps.host.projects();
  if (project === undefined) deps.host.info(messages.newWorkflowNeedsProject());

  return project;
}

/**
 * The one question, with the names already taken
 * read once.
 *
 * Read at the moment the question is asked rather
 * than on every keystroke: what finally decides is
 * the write, and this is only so that somebody is
 * not told about a collision after typing a whole
 * name.
 */
async function askName(
  deps: GalleryDeps,
  project: string,
  suggested: string,
): Promise<string | undefined> {
  const taken = new Set(
    workflowFiles(project).map((path) => basename(path, WORKFLOW_SUFFIX)),
  );

  return await deps.host.askName({
    title: messages.newWorkflowNameTitle(),
    value: suggested,
    validate: (value) => {
      if (!isWorkflowName(value)) return messages.newWorkflowNameRefused();

      return taken.has(value) ? messages.workflowNameTaken(value) : undefined;
    },
  });
}

/** The document is on screen, so the gallery has
 *  nothing left to offer. */
async function opened(deps: GalleryDeps, path: string): Promise<void> {
  await deps.host.openCanvas(path);
  deps.done();
}

/**
 * What landed, said once.
 *
 * The blocks that mail somebody are the only part
 * of a pattern that reaches outside the machine it
 * was started on, so a pattern carrying one says so
 * before anybody runs it.
 */
function created(
  pattern: WorkflowPattern,
  name: string,
  handlers: number,
): string {
  const said = messages.newWorkflowCreated(name, handlers);
  if (!sendsMail(pattern)) return said;

  return `${said} ${messages.newWorkflowSendsMail()}`;
}

function sendsMail(pattern: WorkflowPattern): boolean {
  return pattern.document.nodes.some(
    (node) => node.kind === 'approval' || node.kind === 'emailSend',
  );
}

function shelvesOf(patterns: readonly WorkflowPattern[]): GalleryShelf[] {
  return SHELVES.map((group) => ({
    group,
    cards: patterns
      .filter((pattern) => pattern.meta.group === group)
      .map(cardOf),
  }));
}

/**
 * One pattern, as the gallery draws it.
 *
 * Everything here is authored beside the document
 * in the library. Nothing is worked out from the
 * document itself, so a card cannot describe a
 * workflow the project would not get.
 */
function cardOf(pattern: WorkflowPattern): GalleryCard {
  return {
    name: pattern.name,
    title: pattern.title,
    summary: pattern.meta.summary,
    tags: [...pattern.meta.tags],
    glyphs: [...pattern.meta.glyphs],
    demo: pattern.meta.demo === true,
  };
}

/**
 * The gallery, in an editor tab.
 *
 * One panel, revealed again rather than opened
 * twice, and closed the moment a document exists —
 * a shelf of things to start is not something to
 * leave open beside the thing you started.
 *
 * It follows nothing. The library ships with the
 * extension and cannot change while the window is
 * open, so there is no repaint to arrange.
 */
export class GalleryPanel {
  private panel: WebviewPanel | undefined;

  constructor(
    private readonly extensionUri: Uri,
    private readonly host: GalleryHost,
    private readonly trust: Trust,
  ) {}

  show(): void {
    if (this.panel !== undefined) {
      this.panel.reveal(ViewColumn.Active, false);

      return;
    }

    const panel = window.createWebviewPanel(
      'mboss.gallery',
      galleryWords().heading,
      ViewColumn.Active,
    );
    this.panel = panel;

    const zone = gallery({
      host: this.host,
      trust: this.trust,
      done: () => panel.dispose(),
    });

    mountWebview(panel, {
      extensionUri: this.extensionUri,
      view: 'gallery',
      title: galleryWords().heading,
      init: () => zone.init(),
      heard: (message) => {
        if (message.type === 'usePattern') void zone.usePattern(message.name);
        if (message.type === 'startBlank') void zone.startBlank();
      },
    });

    panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
