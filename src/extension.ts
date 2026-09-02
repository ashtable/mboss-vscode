import { commands, workspace, type ExtensionContext } from 'vscode';

import { agentPanel } from './acp/agent.js';
import { chooseAgent } from './acp/choose.js';
import { agentPickerHost, panelHost } from './acp/host.js';
import { WorkflowCanvasEditor } from './canvas/editor.js';
import { Selection } from './canvas/selection.js';
import { commandHandlers } from './commands.js';
import { projectHost } from './commands/host.js';
import { newProject, offerVendorRefresh } from './commands/newProject.js';
import { isProject } from './core/index.js';
import { NodeInspectorView } from './inspector/view.js';
import { previewStore } from './preview/store.js';
import { AgentSidebarView } from './sidebar/view.js';
import { createStatusBar, editorStatusItem } from './statusBar.js';
import { shippedVendor } from './vendor/index.js';
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
  const editor = watchHost();
  const watchers = watchProjects(editor, statusBar);

  // What this build of the extension ships to put
  // inside a project: the MCP server a coding agent
  // drives, and the skill that teaches it how.
  const projects = projectHost();
  const vendor = shippedVendor(context.extensionUri.fsPath);

  // The agent, held here rather than by the view
  // that draws it. A view in the activity bar is
  // disposed the moment it is hidden — which in
  // this extension is every time somebody selects
  // a block — so a session held by the view would
  // be a new agent process on every selection.
  const panel = agentPanel(panelHost(context.workspaceState));
  const pickAgent = chooseAgent(agentPickerHost(), () => panel.reset());

  // What an agent has asked for and nobody has
  // answered yet. The canvas draws it and the panel
  // is where it is answered, so it is held here
  // rather than by either of them.
  const preview = previewStore({
    folders: () => editor.folders(),
    isTrusted: () => editor.isTrusted(),
    regenerate: async () => void (await watchers.generateNow()),
    notify: (text) => panel.send(text),
    say: (message) => api.info(message),
  });

  void preview.reloadAll();

  context.subscriptions.push(
    watchers.onProposal((path) => {
      const project = preview.projectOf(path);

      if (project !== undefined) void preview.reload(project);
    }),
    editor.onTrustGranted(() => void preview.reloadAll()),
  );

  const handlers = commandHandlers(
    api,
    () => watchers.generateNow(),
    newProject(projects, vendor),
    pickAgent,
  );
  for (const [id, handle] of Object.entries(handlers)) {
    context.subscriptions.push(commands.registerCommand(id, handle));
  }

  // Asked once, on the way up. What changes is the
  // extension, and it changes when the window
  // reloads — so asking again later could only
  // produce the same answer.
  void offerVendorRefresh(
    projects,
    vendor,
    projects.folders().filter(isProject),
  );

  // Trust, a folder and a chosen agent are all
  // things a person changes without reloading, and
  // all three decide what the panel shows.
  context.subscriptions.push(
    workspace.onDidGrantWorkspaceTrust(() => panel.refresh()),
    workspace.onDidChangeConfiguration(() => panel.refresh()),
    workspace.onDidChangeWorkspaceFolders(() => panel.refresh()),
  );

  context.subscriptions.push(
    WorkflowCanvasEditor.register(
      context.extensionUri,
      api,
      selection,
      preview,
    ),
    NodeInspectorView.register(context.extensionUri, selection),
    AgentSidebarView.register(context.extensionUri, panel, pickAgent, preview),
    { dispose: () => panel.dispose() },
    preview,
    watchers,
    statusBar,
  );
}

export function deactivate(): void {}
