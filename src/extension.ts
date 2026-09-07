import { commands, window, workspace, type ExtensionContext } from 'vscode';

import { agentPanel } from './acp/agent.js';
import { chooseAgent } from './acp/choose.js';
import { agentPickerHost, panelHost } from './acp/host.js';
import { WorkflowCanvasEditor, type CanvasRuns } from './canvas/editor.js';
import { commandHandlers } from './commands.js';
import { projectHost, runWorkflowHost } from './commands/host.js';
import { newProject, offerVendorRefresh } from './commands/newProject.js';
import { runWorkflowCommand } from './commands/runWorkflow.js';
import { isProject } from './core/index.js';
import { galleryHost } from './gallery/host.js';
import { GalleryPanel } from './gallery/panel.js';
import { previewStore } from './preview/store.js';
import { openDatabase, openManagement } from './runs/db.js';
import { projectSdk } from './runs/sdk.js';
import { projectEnv } from './runs/env.js';
import { runsHost } from './runs/host.js';
import { RunsListView, SeePanel } from './runs/panels.js';
import { startRun } from './runs/runner.js';
import { sessionLog } from './runs/sessionLog.js';
import { STACK_OUTPUT, dockerStack } from './runs/stack.js';
import { runsStore } from './runs/store.js';
import { watchRun } from './runs/watch.js';
import { AgentSidebarView } from './sidebar/view.js';
import { createStatusBar, editorStatusItem } from './statusBar.js';
import { workspaceTrust } from './trust.js';
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
  const trust = workspaceTrust();

  const statusBar = createStatusBar(editorStatusItem);
  const editor = watchHost();
  const watchers = watchProjects(editor, trust, statusBar);

  // What this build of the extension ships to put
  // inside a project: the MCP server a coding agent
  // drives, and the skill that teaches it how.
  const projects = projectHost();
  const vendor = shippedVendor(context.extensionUri.fsPath);

  // The agent, held here rather than by the view
  // that draws it. A view in the activity bar is
  // disposed the moment it is hidden, so a session
  // held by the view would be a new agent process
  // every time somebody collapsed the panel.
  const panel = agentPanel(panelHost(context.workspaceState), trust);
  const pickAgent = chooseAgent(agentPickerHost(), () => panel.reset(), trust);

  // What an agent has asked for and nobody has
  // answered yet. The canvas draws it and the panel
  // is where it is answered, so it is held here
  // rather than by either of them.
  const preview = previewStore(
    {
      folders: () => editor.folders(),
      regenerate: async () => {
        const run = await watchers.generateNow();

        return run.ran ? run.problems : [];
      },
      say: (message) => api.info(message),
    },
    trust,
    panel,
  );

  void preview.reloadAll();

  context.subscriptions.push(
    watchers.onProposal((path) => {
      const project = preview.projectOf(path);

      if (project !== undefined) void preview.reload(project);
    }),
  );

  // What a build prints while it runs, which is
  // minutes of somebody's afternoon and belongs
  // where a long command's log belongs.
  const stackOutput = window.createOutputChannel(STACK_OUTPUT);
  const stack = dockerStack(stackOutput);

  // What a project's own Postgres says happened,
  // and what its own containers are doing. Held
  // here for the same reason the proposals are: a
  // list in the activity bar, a page in the editor
  // and the canvas all draw it, and any of them can
  // be disposed while the others are on screen.
  const runs = runsStore({
    host: runsHost(),
    agent: panel,
    trust,
    open: openDatabase,
    openManagement,
    projectSdk,
    stack,
    // The runner is handed its collaborators here
    // rather than reaching for them: the store has
    // no opinion about how a request is made, and
    // nothing under `runs/` constructs a `fetch`.
    runner: (request) =>
      startRun(
        { stack, env: projectEnv, open: openDatabase, fetch: globalThis.fetch },
        request,
      ),
    watch: watchRun,
    sessionLog: sessionLog(),
  });
  const see = new SeePanel(context.extensionUri, runs);

  // Opening a run takes both the store that reads
  // it and the page that shows one, so the pair is
  // put together once here. Two surfaces ask for it
  // — a card on the canvas, and a row mBoss wrote
  // into the transcript — and neither has any
  // business holding both halves.
  const openRun = async (workflowId: string): Promise<void> => {
    await runs.select(workflowId);
    see.show();
  };

  // The canvas draws a run and offers the ways out
  // of it: the whole run, a replay, and the agent.
  const canvasRuns: CanvasRuns = {
    live: () => runs.live(),
    decided: (ir) => runs.decided(ir),
    output: (workflowId, functionId) => runs.output(workflowId, functionId),
    openRun,
    replayFrom: (workflowId, nodeId) => runs.replay(workflowId, { nodeId }),
    askAgent: (ask) => runs.askAgent(ask),
    onChanged: (listener) => runs.onChanged(listener),
  };

  // The shelf of workflows to start from. Held here
  // rather than by the command, so that running it
  // twice reveals the one panel rather than opening
  // a second.
  const gallery = new GalleryPanel(context.extensionUri, galleryHost(), trust);

  const handlers = commandHandlers(
    api,
    () => watchers.generateNow(),
    newProject(projects, vendor, trust),
    async () => gallery.show(),
    pickAgent,
    () => runs.refresh(),
    () => runs.stackUp(),
    () => runs.stackDown(),
    runWorkflowCommand(runWorkflowHost(), runs, trust),
    async () => WorkflowCanvasEditor.active()?.arrange(),
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
    trust,
  );

  // A folder and a chosen agent are things a person
  // changes without reloading, and both decide what
  // the panel shows. Trust is the third, and the
  // panel follows that itself.
  context.subscriptions.push(
    workspace.onDidChangeConfiguration(() => panel.refresh()),
    workspace.onDidChangeWorkspaceFolders(() => panel.refresh()),
  );

  context.subscriptions.push(
    WorkflowCanvasEditor.register(
      context.extensionUri,
      api,
      preview,
      canvasRuns,
      trust,
      watchers,
      panel,
    ),
    AgentSidebarView.register(
      context.extensionUri,
      panel,
      pickAgent,
      preview,
      openRun,
    ),
    RunsListView.register(context.extensionUri, runs, see),
    { dispose: () => see.dispose() },
    { dispose: () => gallery.dispose() },
    { dispose: () => panel.dispose() },
    preview,
    runs,
    watchers,
    statusBar,
    stackOutput,
  );
}

export function deactivate(): void {}
