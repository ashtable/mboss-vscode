import { StatusBarAlignment, window } from 'vscode';

import { messages } from './messages.js';

/**
 * What the status bar says about mBoss.
 *
 * Two rows. The first says the extension is up and
 * that nothing it does leaves the machine. The
 * second reports code generation, and it is the
 * only feedback there is that saving a workflow did
 * anything: the code lands in files nobody has
 * open, so a row that stays blank is the difference
 * between a loop that works and one that looks
 * broken.
 *
 * The design gives this bar two more things to say
 * — whether the graph is in step with the file, and
 * whether the project's database is up. Neither is
 * true of anything built yet, and a row reporting
 * on nothing is worse than no row.
 */

/** A status-bar row, as this extension drives one.
 *  Taken as an argument because minting one is the
 *  whole of what this needs from the editor. */
export type StatusItem = {
  text: string;
  tooltip: string;
  show(): void;
  dispose(): void;
};

export type StatusBar = {
  /** Reports the run that just finished: how long
   *  it took, and whether it produced code. */
  codegenFinished(ms: number, ok: boolean): void;

  /** Says why nothing is being generated in a
   *  folder nobody has trusted. */
  codegenNeedsTrust(): void;

  dispose(): void;
};

/**
 * Rows sit left to right by descending priority, so
 * the two here are numbered to keep code generation
 * beside the extension's own name rather than
 * wherever the bar happened to have room.
 */
const READY_PRIORITY = 100;
const CODEGEN_PRIORITY = 99;

/**
 * A real row, narrowed to what this file does with
 * one.
 *
 * The editor's own tooltip may be marked-up text or
 * nothing at all, and this only ever writes a
 * sentence — so the wider type is narrowed here
 * rather than carried through every function that
 * sets one.
 */
export function editorStatusItem(priority: number): StatusItem {
  const item = window.createStatusBarItem(StatusBarAlignment.Left, priority);

  return {
    get text(): string {
      return item.text;
    },
    set text(value: string) {
      item.text = value;
    },
    get tooltip(): string {
      return typeof item.tooltip === 'string' ? item.tooltip : '';
    },
    set tooltip(value: string) {
      item.tooltip = value;
    },
    show: () => item.show(),
    dispose: () => item.dispose(),
  };
}

export function createStatusBar(
  item: (priority: number) => StatusItem,
): StatusBar {
  const ready = item(READY_PRIORITY);
  const codegen = item(CODEGEN_PRIORITY);

  ready.text = messages.statusReady();
  ready.tooltip = messages.statusReadyDetail();
  ready.show();

  // Nothing has been generated yet, and a row
  // saying so would be a row about nothing. It
  // appears the first time there is something to
  // report.

  return {
    codegenFinished: (ms, ok) => {
      codegen.text = ok
        ? messages.codegenDone(ms)
        : messages.codegenBlocked(ms);
      codegen.tooltip = ok
        ? messages.codegenDoneDetail()
        : messages.codegenBlockedDetail();
      codegen.show();
    },

    codegenNeedsTrust: () => {
      codegen.text = messages.codegenNeedsTrust();
      codegen.tooltip = messages.codegenNeedsTrustDetail();
      codegen.show();
    },

    dispose: () => {
      ready.dispose();
      codegen.dispose();
    },
  };
}
