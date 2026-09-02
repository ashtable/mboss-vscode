import { commands, type ExtensionContext } from 'vscode';

import { WorkflowCanvasEditor } from './canvas/editor.js';
import { Selection } from './canvas/selection.js';
import { commandHandlers } from './commands.js';
import { NodeInspectorView } from './inspector/view.js';
import { AgentSidebarView } from './sidebar/view.js';
import { createStatusBar, editorStatusItem } from './statusBar.js';
import { vsCodeApi } from './vscodeApi.js';
import { watchHost } from './watchers/host.js';
import { watchProjects } from './watchers/index.js';

/**
 * Everything this extension puts on screen, wired
 * up in one place.
 *
 * Nothing here decides anything: the commands know
 * what they do, the providers know what they draw,
 * the watchers know when to regenerate, and the
 * manifest decides when any of it appears. This
 * just hands each one the editor and holds the
 * disposables.
 */
export function activate(context: ExtensionContext): void {
  const api = vsCodeApi();
  // Which node the Inspector shows. Held by the
  // extension rather than by either view, because
  // the view that draws it is disposed and rebuilt
  // every time the selection changes.
  const selection = new Selection(api);

  const statusBar = createStatusBar(editorStatusItem);
  const watchers = watchProjects(watchHost(), statusBar);

  const handlers = commandHandlers(api, () => watchers.generateNow());
  for (const [id, handle] of Object.entries(handlers)) {
    context.subscriptions.push(commands.registerCommand(id, handle));
  }

  context.subscriptions.push(
    WorkflowCanvasEditor.register(context.extensionUri, api, selection),
    NodeInspectorView.register(context.extensionUri, selection),
    AgentSidebarView.register(context.extensionUri),
    watchers,
    statusBar,
  );
}

export function deactivate(): void {}
