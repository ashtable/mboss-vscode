import {
  Diagnostic,
  DiagnosticSeverity,
  Position,
  Range,
  RelativePattern,
  Uri,
  languages,
  workspace,
  type Disposable,
} from 'vscode';

import type { Problem } from '../problem.js';

/**
 * The editor, as the watchers reach for it.
 *
 * Kept apart from the interface the canvas takes
 * for the reason any interface is kept narrow: a
 * single one covering both would make every module
 * that stands in for the editor implement methods
 * it has no opinion about, and each of those
 * stand-ins is what a spec's assertions actually
 * rest on.
 *
 * Everything here is something only a running
 * editor can do — mint a file watcher, own the
 * PROBLEMS panel, know whether a person has trusted
 * this folder. Which is why the watchers take it
 * rather than import it: none of that is available
 * to a test, and none of it is what the watchers
 * are for.
 */

/** Where problems go to be seen. */
export type ProblemSink = {
  /** Replaces everything this extension is showing
   *  about the workspace. */
  publish(problems: readonly Problem[]): void;

  dispose(): void;
};

export type WatchHost = {
  /** Every folder open in this window. */
  folders(): string[];

  /** Whether the person has said this folder's
   *  contents may be executed and written to. */
  isTrusted(): boolean;

  /** Fires when they say so, mid-session. */
  onTrustGranted(listener: () => void): Disposable;

  /** Watches one glob under one folder, for
   *  anything appearing, changing or going. */
  watch(
    folder: string,
    glob: string,
    listener: (path: string) => void,
  ): Disposable;

  /** Every document saved in the editor. */
  onSaved(listener: (path: string) => void): Disposable;

  problems(): ProblemSink;
};

export function watchHost(): WatchHost {
  return {
    folders: () =>
      (workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),

    isTrusted: () => workspace.isTrusted,

    onTrustGranted: (listener) =>
      workspace.onDidGrantWorkspaceTrust(() => listener()),

    watch: (folder, glob, listener) => {
      const watcher = workspace.createFileSystemWatcher(
        new RelativePattern(Uri.file(folder), glob),
      );
      const heard = (uri: Uri): void => listener(uri.fsPath);

      watcher.onDidCreate(heard);
      watcher.onDidChange(heard);
      watcher.onDidDelete(heard);

      return watcher;
    },

    onSaved: (listener) =>
      workspace.onDidSaveTextDocument((document) =>
        listener(document.uri.fsPath),
      ),

    problems: () => {
      const collection = languages.createDiagnosticCollection('mboss');

      return {
        publish: (problems) => {
          const byFile = new Map<string, Diagnostic[]>();

          for (const problem of problems) {
            const found = byFile.get(problem.file) ?? [];

            found.push(diagnosticOf(problem));
            byFile.set(problem.file, found);
          }

          collection.clear();
          collection.set(
            [...byFile].map(([file, found]) => [Uri.file(file), found]),
          );
        },
        dispose: () => collection.dispose(),
      };
    },
  };
}

/**
 * A finding, as the panel wants one.
 *
 * It sits at the top of the file it is about. The
 * rules report against a block or a wire, which the
 * document identifies by name rather than by where
 * it sits in the text, and the sentences they
 * produce already name what they are about — so
 * pointing at the first line says everything a
 * guessed-at offset would, without ever pointing at
 * the wrong thing.
 */
function diagnosticOf(problem: Problem): Diagnostic {
  const found = new Diagnostic(
    new Range(new Position(0, 0), new Position(0, 0)),
    problem.message,
    problem.severity === 'error'
      ? DiagnosticSeverity.Error
      : DiagnosticSeverity.Warning,
  );

  found.source = 'mBoss';
  if (problem.code !== undefined) found.code = problem.code;

  return found;
}
