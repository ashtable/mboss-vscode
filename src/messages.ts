import { l10n } from 'vscode';

import type { AgentId } from './acp/registry.js';

/**
 * Every sentence the host says, in one table.
 *
 * `package.json`'s own strings go through
 * `%key%` and `package.nls.json` instead; the two
 * mechanisms share nothing and neither falls back
 * to the other. Anything a running extension says
 * from the host — a dialog, a notification, the
 * status bar, a row a view is handed — belongs
 * here.
 *
 * The words a webview draws are not here. A
 * webview has no `vscode.l10n`, so they are
 * resolved on the host too, but beside the view
 * they belong to — `canvas/words.ts`,
 * `sidebar/words.ts`, `runs/words.ts` — and sent
 * whole in its init message. Those and this are
 * the only files that call `l10n.t`, and a spec
 * holds the list.
 *
 * Each entry is a function because `l10n.t`
 * answers with the active locale's bundle, which
 * is not loaded until the extension activates.
 * Each one holds a literal, because that is what
 * the extraction tooling reads and what
 * `l10n/bundle.l10n.json` is checked against.
 */
export const messages = {
  /**
   * Creating a project writes an executable control
   * plane into a folder, which is the decision
   * workspace trust exists to make. It says so
   * rather than greying the command out, because a
   * palette entry that does nothing explains
   * nothing.
   */
  newProjectNeedsTrust: () =>
    l10n.t(
      'Creating a project writes an mBoss server into a folder, so it waits until you trust this window.',
    ),
  newProjectFolderTitle: () => l10n.t('Where should the new project go?'),
  newProjectFolderAccept: () => l10n.t('Create Here'),
  newProjectNameTitle: () => l10n.t('What is the project called?'),
  newProjectNamePlaceholder: () => l10n.t('my-app'),

  /**
   * The rule is core's, because the name is a
   * directory, an npm package name, a compose
   * project name and the name every run is recorded
   * against all at once. This says it the way
   * somebody typing can act on.
   */
  newProjectNameRefused: () =>
    l10n.t(
      'Lower-case letters, digits, hyphens and underscores, starting with a letter.',
    ),
  newProjectWorking: (name: string) => l10n.t('Creating {0}…', name),
  newProjectFailed: (detail: string) =>
    l10n.t('The project was not created: {0}', detail),

  vendorRefreshOffer: () =>
    l10n.t(
      "This project's mBoss server and skill are not the ones this extension ships.",
    ),
  vendorRefreshDetail: (version: string) =>
    l10n.t(
      'Refreshing rewrites .mboss/mcp/ and both copies of the skill from {0}.',
      version,
    ),
  vendorRefreshAccept: () => l10n.t('Refresh'),
  vendorRefreshWorking: () => l10n.t('Refreshing the mBoss server and skill…'),
  vendorRefreshFailed: (detail: string) =>
    l10n.t('The mBoss server and skill were not refreshed: {0}', detail),

  /**
   * A run history lives in a database named by the
   * project's own `.env`, so opening a connection
   * to it is the decision workspace trust exists to
   * make. It says so rather than greying the
   * command out: a palette entry that does nothing
   * explains nothing.
   */
  runsNeedTrust: () =>
    l10n.t(
      'Reading a run history opens a database this folder names, so it waits until you trust this window.',
    ),

  runsNoProject: () =>
    l10n.t('Open an mBoss project to see how its runs went.'),

  runsEmpty: () =>
    l10n.t('No runs recorded yet. Start the app and set a workflow going.'),

  /**
   * The two ways there is nothing to read, kept
   * apart because what a person does about them is
   * different: write the variable, or start the
   * database.
   */
  runsNoDatabaseUrl: (path: string) =>
    l10n.t(
      '{0} names neither DBOS_SYSTEM_DATABASE_URL nor DATABASE_URL, so there is no database to read.',
      path,
    ),
  runsNoEnvFile: (path: string) =>
    l10n.t(
      '{0} is not readable, so there is no database to read. A scaffolded project writes one; copy .env.example if it is missing.',
      path,
    ),
  runsUnreachable: (detail: string) =>
    l10n.t('That database would not answer: {0}', detail),

  /**
   * The two ways there is no local stack at all,
   * kept apart the same way: one is answered by
   * installing docker, the other by scaffolding a
   * project. Both are states of somebody's machine
   * rather than faults, so both are sentences in
   * the panel and neither is thrown.
   */
  stackNoDocker: () =>
    l10n.t('Docker is not on the PATH, so there is no local stack to start.'),
  stackNoComposeFile: (path: string) =>
    l10n.t(
      '{0} is not there, so there is no local stack to start. A scaffolded project writes one.',
      path,
    ),

  /**
   * When the app's container was made, which is
   * when the app last changed: starting the stack
   * always builds, and compose recreates the
   * container whenever the image did. How long it
   * has been *up* is a different question and not
   * the one being asked.
   */
  stackBuiltAgo: (elapsed: string) => l10n.t('built {0} ago', elapsed),

  /**
   * The three ways a run does not start that the
   * app itself never gets to say, each phrased as
   * the thing to do about it. A person pressed
   * Run, so what comes back has to be a sentence
   * on the panel rather than a thrown error.
   *
   * The last is not a refusal: the event was
   * taken and a run is going, and nothing on
   * screen can follow it. Saying it was refused
   * would deny a run that is underway.
   */
  runNoApp: () =>
    l10n.t(
      'The app is not up, so there is nothing to run on. Start the local stack.',
    ),
  runNoEventsSecret: () =>
    l10n.t(
      "This project's .env names no EVENTS_SECRET, so the app will not accept a run.",
    ),
  runUntracked: (workflow: string) =>
    l10n.t(
      'The event was accepted, but no run of {0} could be found to follow.',
      workflow,
    ),

  /**
   * What a person types in the input box has to be
   * a payload before anything is sent, so this is
   * said in place of a start rather than after one.
   */
  runNotJson: () => l10n.t('That input is not JSON, so nothing was sent.'),

  /**
   * The app answering about a workflow it has
   * never heard of. Phrased as the thing to do
   * about it, because there is exactly one thing:
   * the container runs the image built at
   * `compose up`, and this workflow is not in it.
   */
  runRebuildToRun: () =>
    l10n.t('The running app was built before this workflow. Rebuild the app.'),

  /**
   * Said beside the box somebody types an event
   * into, because it changes what pressing the
   * button twice means: the route mints the run's
   * id from this path, so the same value is the
   * same run.
   */
  runKeyPathHint: (path: string) =>
    l10n.t('{0} is the idempotency key · a new value is a new run', path),

  /**
   * What the extension asks the agent when
   * somebody wants to know why a run failed.
   *
   * It names the three things nothing else in the
   * conversation has: which workflow, which step,
   * and what the ledger recorded. The agent has
   * the project; it does not have the run.
   */
  runAskAgent: (workflow: string, step: string, error: string) =>
    l10n.t(
      'The workflow {0} failed at step {1} with: {2}. Look at that block and its handler and tell me what went wrong.',
      workflow,
      step,
      error,
    ),

  /** The same question about a run no step failed
   *  in — the ingress refused it, or the workflow
   *  itself threw. */
  runAskAgentNoStep: (workflow: string, error: string) =>
    l10n.t(
      'The workflow {0} failed with: {1}. Look at it and tell me what went wrong.',
      workflow,
      error,
    ),

  /**
   * The line naming what is being read. The host
   * and database only — the string it came from
   * carries a password.
   */
  runsSource: (database: string) =>
    l10n.t('dbos.workflow_status · {0}', database),

  /** The boundary the design draws, drawn where a
   *  person can see it. */
  runsScope: () =>
    l10n.t("Local runs only. Deployed apps are DBOS Conductor's."),

  runsRecoveredTag: () => l10n.t('recovered ✓'),
  /**
   * How many crashes, not what the column says: the
   * column counts dispatches, so a run that never
   * crashed already reads one.
   *
   * Shown only when there was more than one, which
   * is also what keeps the sentence grammatical:
   * `vscode.l10n` has no plural forms, the tag
   * beside it already says a run recovered, and
   * "recovered from 1 crashes" would be the
   * commonest thing on the panel.
   */
  runsRecoveredNote: (crashes: number) =>
    l10n.t('recovered from {0} crashes', crashes),

  /**
   * The banner over a run DBOS picked back up.
   *
   * The claim it makes is the product's whole
   * argument, so it is made out of what the ledger
   * actually holds — how long nothing was running,
   * and how many steps came back rather than ran
   * again — and never out of a crash time nothing
   * records.
   */
  runRecoveredHeading: () => l10n.t('Crash recovered — exactly-once held'),
  runRecoveredBody: (down: string, restored: number) =>
    l10n.t(
      'Nothing ran for {0}. DBOS picked this run back up and {1} steps came back from dbos.operation_outputs instead of running again.',
      down,
      restored,
    ),

  /**
   * The same fact, when the steps are timed too
   * closely together to say where the gap was.
   * `recovery_attempts` is a count and no column
   * anywhere holds the moment a process died, so
   * there is nothing to place and the sentence says
   * so instead of guessing.
   */
  runRecoveredUnplaced: () =>
    l10n.t(
      'DBOS picked this run back up. Its steps are timed too closely together to say where the process went down; the recovery count is in the ledger.',
    ),

  runProcessDown: (duration: string) => l10n.t('process down · {0}', duration),
  runResumed: () => l10n.t('resumed by DBOS'),

  runHeadline: (status: string, duration: string) =>
    l10n.t('{0} · {1} total', status, duration),
  runHeadlineRunning: (status: string) => l10n.t('{0} · still going', status),

  runSpan: (started: string, finished: string) =>
    l10n.t('started {0} · finished {1}', started, finished),
  runSpanRunning: (started: string) => l10n.t('started {0}', started),

  runBreadcrumb: (workflow: string, id: string) =>
    l10n.t('mBoss › runs › {0} › {1}', workflow, id),

  /**
   * Seconds with one decimal, because a local run
   * is measured in them and the design's own
   * examples are `8.2 s` and `2.9 s`. Anything
   * under a second says so in the unit it happened
   * in rather than as `0.0 s`.
   */
  runSeconds: (seconds: string) => l10n.t('{0} s', seconds),
  runMilliseconds: (ms: number) => l10n.t('{0} ms', ms),

  /**
   * What a replay did.
   *
   * Both forms name the version, because that is
   * the one thing that decides whether the new run
   * ever moves: a worker dequeues only its own
   * version, and nothing in the schema says whether
   * one is running at all.
   */
  replayStarted: (id: string, version: string) =>
    l10n.t(
      'Replaying as {0}. It starts when your app is running under version {1}.',
      id,
      version,
    ),
  replayStartedNewer: (id: string, version: string, was: string) =>
    l10n.t(
      'Replaying as {0} under version {1}, not the {2} this run used. It starts when your app is running that version.',
      id,
      version,
      was,
    ),
  replayRefused: (detail: string) =>
    l10n.t('That replay did not start: {0}', detail),

  /**
   * `mBoss: Run Workflow…`'s two questions: which
   * one, then what to send it. The picker offers
   * only what can be started this way — a scheduled
   * workflow is listed in the panel's own dropdown,
   * where there is a row to put the reason beside,
   * and left out here instead.
   */
  runWorkflowPickTitle: () => l10n.t('Which workflow should run?'),
  runWorkflowInputTitle: () => l10n.t('What input should it run with?'),
  runWorkflowInputPrompt: () => l10n.t('JSON, or leave empty for none.'),
  runWorkflowNone: () =>
    l10n.t('This project has no workflow that can be started by hand.'),

  /**
   * Starting an agent runs a program named by this
   * workspace's own settings, which is the
   * decision workspace trust exists to make. It
   * says so rather than greying the command out: a
   * palette entry that does nothing explains
   * nothing.
   */
  chooseAgentNeedsTrust: () =>
    l10n.t(
      'Running a coding agent starts a program this folder names, so it waits until you trust this window.',
    ),
  chooseAgentTitle: () => l10n.t('Which coding agent should drive mBoss?'),
  chooseAgentCommandTitle: () => l10n.t('What command starts your agent?'),
  chooseAgentCommandPrompt: () =>
    l10n.t('The program to run. It must speak the Agent Client Protocol.'),
  chooseAgentArgsTitle: () => l10n.t('What arguments does it take?'),
  chooseAgentArgsPrompt: () =>
    l10n.t('Separated by spaces. Leave empty for none.'),
  chooseAgentNeedsCommand: () =>
    l10n.t('A custom agent needs a command to start.'),

  statusReady: () => l10n.t('mBoss ✓ ready — fully local'),
  statusReadyDetail: () =>
    l10n.t('No sign-in, no serial key, and nothing leaves this machine.'),

  /**
   * The status bar reports the milliseconds the
   * compiler spent, not the wait between saving and
   * seeing code — the wait includes a debounce this
   * extension chose, and a number that moved when
   * that setting moved would say nothing about the
   * project.
   */
  codegenDone: (ms: number) => l10n.t('codegen ✓ {0} ms', ms),
  codegenDoneDetail: () =>
    l10n.t('Code is regenerated whenever a workflow is saved.'),
  codegenBlocked: (ms: number) => l10n.t('codegen ✗ {0} ms', ms),
  codegenBlockedDetail: () =>
    l10n.t('Some workflows produced no code. See the Problems panel.'),
  codegenNeedsTrust: () => l10n.t('codegen — folder not trusted'),
  codegenNeedsTrustDetail: () =>
    l10n.t(
      'Generating code writes TypeScript into this folder, so it waits until you trust it.',
    ),

  codegenNoProject: () =>
    l10n.t('There is no mBoss project in this window to generate code for.'),
  codegenRan: (ms: number) =>
    l10n.t('mBoss regenerated this project in {0} ms.', ms),

  codegenStopped: (detail: string) =>
    l10n.t('Code generation stopped: {0}', detail),

  documentUnreadable: (detail: string) =>
    l10n.t('This file is not a workflow document: {0}', detail),
  codeBehindUnreadable: (detail: string) =>
    l10n.t('The code-behind could not be read: {0}', detail),

  canvasEditStale: () =>
    l10n.t('This graph changed while you were editing it. Try that again.'),

  /**
   * Over the list of ways out of a block, once a
   * wire has been let go of on something.
   *
   * A block has one dot to leave by however many
   * ways out it has, because a ten-pixel dot that
   * only appears on hover is not something anybody
   * can aim at three of. So the question is asked
   * where the eyes already are, after the drop.
   */
  canvasChoosePort: () => l10n.t('Which way out does this wire leave by?'),

  /** The way out a branch takes when none of its
   *  cases decided. */
  canvasFallThrough: () => l10n.t('anything else'),
  inspectorEditRefused: () =>
    l10n.t('That would leave the block half-set, so nothing was saved.'),

  /**
   * A function that cannot sit where somebody put
   * it.
   *
   * Said out loud rather than swallowed: a chip
   * dropped on a block that quietly does nothing is
   * a bug report nobody can write. The reason is
   * core's own, carried in rather than restated
   * here, so the notification and the greyed row in
   * the picker say the same thing.
   */
  handlerMisfit: (fn: string, title: string, reason: string) =>
    l10n.t('{0} cannot sit behind {1}: {2}.', fn, title, reason),

  /**
   * The transcript's row for a function assigned
   * from the canvas.
   *
   * A verb, in the shape the agent's own rows have
   * — what tells this one apart is the rail saying
   * a person did it, not different wording.
   */
  canvasAssignVerb: () => l10n.t('Assign lib fn'),

  /**
   * What that row was done to: the function, the
   * kind of block that took it, and the block's
   * own title.
   *
   * The kind is there because a title is whatever
   * somebody typed and two of them can read alike
   * — the kind is what says the function landed on
   * the block that was meant. Its word comes from
   * the palette's table rather than a second one
   * here, so a block is called the same thing
   * wherever it is named.
   */
  canvasAssignTarget: (fn: string, kind: string, title: string) =>
    l10n.t('{0} → {1} "{2}"', fn, kind, title),

  /**
   * The line over a graph nobody has agreed to yet.
   *
   * The mockup puts it in the editor's tab strip.
   * No extension can write there — a webview panel
   * owns its title and nothing else about the tab —
   * so it goes at the top of the canvas itself.
   */
  previewHeadline: (agent: string) =>
    l10n.t('PREVIEW — proposed by {0} · not applied yet', agent),

  /**
   * What a proposal would change, over the sentence
   * that says who placed it.
   *
   * The second half is the product's argument and
   * is why the line is worth its space: an agent
   * sent the meaning of the workflow, and the
   * picture was computed from it. Nobody dragged
   * anything.
   */
  previewBanner: (counts: string) =>
    l10n.t(
      'PREVIEW CHANGES · {0} · deterministic layout — the agent sent semantics, never coordinates',
      counts,
    ),

  /**
   * The counts, grouped by what they are about.
   *
   * `+` arrived, `−` went, `~` changed — the
   * vocabulary every plan-and-apply tool on a
   * developer's machine already uses. The noun
   * comes once per group rather than once per
   * term, so the line reads as one fact about the
   * blocks and one about the wires.
   */
  previewNodes: (terms: string) => l10n.t('{0} nodes', terms),
  previewEdges: (terms: string) => l10n.t('{0} edges', terms),
  previewNoChanges: () => l10n.t('no changes'),

  previewMore: (count: number) => l10n.t('… {0} more proposed nodes', count),

  /**
   * Why a proposal cannot be applied any more.
   *
   * The last sentence is what makes this different
   * from an edit that hit a conflict: a conflicting
   * edit is made again against what the file now
   * says, where nobody has approved *this* edit
   * against *that* content. It names no revisions
   * because two of the four ways to get here have
   * no pair of numbers to name.
   */
  previewStale: () =>
    l10n.t(
      'The graph changed since this was proposed, so it cannot be applied. Ask the agent to propose it again.',
    ),

  previewApplied: (counts: string, revision: number) =>
    l10n.t('APPLIED · {0} · v{1}', counts, revision),

  previewRefused: (detail: string) =>
    l10n.t('That proposal was not applied: {0}', detail),

  /**
   * Applied, and then something after it fell over.
   *
   * Not a refusal, and saying so would be a lie the
   * folder contradicts: the document has already
   * changed. What is left to say is which part did
   * not happen and that the card can take it back.
   */
  previewIncomplete: (detail: string) =>
    l10n.t(
      'That proposal was applied, but finishing the approval failed: {0}. Undo takes it back.',
      detail,
    ),

  undoRefused: (detail: string) => l10n.t('That was not undone: {0}', detail),

  /**
   * The transcript's row for an approval.
   *
   * A verb and, beside it, the workflow it was
   * done to — the shape the agent's own rows have.
   */
  previewApplyVerb: () => l10n.t('Apply proposal'),

  /**
   * The turn the Fix action on a codegen
   * diagnostic sends.
   *
   * Each finding's own sentence, word for word.
   * They already name the block they are about, in
   * the wording the agent sees driving the control
   * plane, and a second wording composed here would
   * be a second thing to keep true.
   */
  previewCodegenFix: (workflow: string, findings: string) =>
    l10n.t(
      'Applying the proposal for {0} left these errors: {1} Fix the blocks and handlers they name.',
      workflow,
      findings,
    ),

  /**
   * The one thing to do about a diagnostic
   * something can be done about.
   *
   * Read by whoever notes the diagnostic rather
   * than by the panel: only the writer knows what
   * pressing it will ask for, so it carries the
   * word with the prompt.
   */
  diagnosticFix: () => l10n.t('Fix'),

  /**
   * What each agent is called.
   *
   * Lower case, the way each project spells its
   * own name — this is a list of other people's
   * products, not a list of headings.
   */
  agents: (): Record<AgentId, string> => ({
    'claude-code': l10n.t('claude code'),
    codex: l10n.t('codex cli'),
    gemini: l10n.t('gemini cli'),
    custom: l10n.t('custom'),
  }),

  /** What each agent is, under its name in the
   *  picker. */
  agentDetails: (): Record<AgentId, string> => ({
    'claude-code': l10n.t('npx @agentclientprotocol/claude-agent-acp'),
    codex: l10n.t('npx @agentclientprotocol/codex-acp'),
    gemini: l10n.t('gemini --acp'),
    custom: l10n.t('Any program that speaks the Agent Client Protocol'),
  }),
};
