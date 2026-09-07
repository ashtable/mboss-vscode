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
 * `src/bundle.ts` reads to write
 * `l10n/bundle.l10n.json`. A call that wraps
 * anything else stops the generator by name rather
 * than going quietly untranslated.
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

  /**
   * Starting a workflow writes a document and a
   * handler file per block into somebody's folder,
   * which is the decision workspace trust exists to
   * make. The gallery still opens without it: it is
   * a catalog, and refusing to draw one explains
   * less than refusing to write.
   */
  newWorkflowNeedsTrust: () =>
    l10n.t(
      'Starting a workflow writes a document and its handlers into a folder, so it waits until you trust this window.',
    ),

  newWorkflowNeedsProject: () =>
    l10n.t('Open an mBoss project to start a workflow in it.'),

  newWorkflowNameTitle: () => l10n.t('What is the workflow called?'),

  /**
   * The rule is core's, because the name is the
   * document's file name, the generated function's
   * name and the name every run is recorded
   * against all at once.
   */
  newWorkflowNameRefused: () =>
    l10n.t(
      'Lower-case letters, digits and underscores, starting with a letter.',
    ),

  /** Said under the name box while somebody types,
   *  and again if the file turns up between the
   *  question and the write. */
  workflowNameTaken: (name: string) =>
    l10n.t('This project already has a workflow named {0}.', name),

  newWorkflowWorking: (name: string) => l10n.t('Starting {0}…', name),

  /**
   * A pattern brings its handlers with it under
   * names it chose, so a file already at one of
   * those names is not something a different
   * workflow name would get around.
   */
  patternCodeExists: (path: string) =>
    l10n.t(
      'The pattern brings its own {0}, and this project already has one. Nothing was written.',
      path,
    ),

  newWorkflowRefused: (detail: string) =>
    l10n.t('That workflow was not started: {0}', detail),

  /**
   * The handlers go in before the document, so a
   * refused apply is the one refusal that leaves
   * files behind. Nobody can clean up files they
   * were not told about.
   */
  newWorkflowLeftBehind: (files: string) =>
    l10n.t('Its handlers were written first and are still there: {0}', files),

  /**
   * What landed, and where the code behind it is.
   *
   * It says the handlers are in `lib/` and stops
   * there: nothing has been generated yet, and a
   * sentence promising generated code would point
   * somebody at a file that is not there until the
   * next save.
   */
  newWorkflowCreated: (name: string, handlers: number) =>
    l10n.t(
      '{0} is on the canvas with its {1} handlers in lib/.',
      name,
      handlers,
    ),

  /** The one thing a pattern does that reaches
   *  outside the machine it was started on. */
  newWorkflowSendsMail: () =>
    l10n.t(
      'Its approval and email blocks send real mail — set TWILIO_* in .env, or point TWILIO_EMAIL_BASE_URL at a sink, before running it.',
    ),

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
   * The question asked about a run the ledger has,
   * in three parts.
   *
   * Assembled rather than written whole, because a
   * clause whose fact the evidence does not carry
   * has to be left out: the record is built not to
   * invent, and a sentence introducing it that
   * named a block nobody recorded would undo that
   * in its first line.
   */
  runAskAgentAtBlock: (
    workflowId: string,
    workflow: string,
    title: string,
    error: string,
  ) =>
    l10n.t(
      'Run `{0}` of `{1}` failed at {2} — {3}.',
      workflowId,
      workflow,
      title,
      error,
    ),

  /** The same, where the run threw with no step of
   *  its own to blame. */
  runAskAgentWith: (workflowId: string, workflow: string, error: string) =>
    l10n.t('Run `{0}` of `{1}` failed with {2}.', workflowId, workflow, error),

  /** And a run somebody asked about that recorded
   *  no failure at all, which the button offers
   *  because any run the ledger has may be asked
   *  about. */
  runAskAgentNoFailure: (
    workflowId: string,
    workflow: string,
    status: string,
  ) =>
    l10n.t(
      'Run `{0}` of `{1}` recorded no failure; DBOS has it as {2}.',
      workflowId,
      workflow,
      status,
    ),

  /** How hard the block was allowed to try, said
   *  beside the code it runs. */
  runAskAgentRetry: (attempts: string) =>
    l10n.t('retry policy max {0} (configured)', attempts),

  /**
   * Where the attachment came from, what to prefer
   * over what, and what is deliberately not
   * claimed.
   *
   * The provenance is not decoration: an agent with
   * an MCP tool that reads the same two tables has
   * two accounts of one run, and this is what tells
   * it which is which. The last clause is the one
   * that matters most — the document describes the
   * workspace now and the run carries the version
   * that ran, and nothing here compares them.
   */
  runAskAgentEvidence: (database: string, from: string) =>
    l10n.t(
      'The attached mBoss run evidence was assembled by the editor from the local DBOS ledger (`dbos.workflow_status`, `dbos.operation_outputs` at {0}, via {1}); `project_debug` reads the same tables and returns stored errors unparsed, so prefer the attachment for this run and use `project_debug` for others. The saved workflow and manifest describe the workspace now; the run carries the version that ran, and they are not compared. Tell me why, and fix the handler if the fix belongs in `lib/`.',
      database,
      from,
    ),

  /**
   * The question about a run that never started.
   *
   * No ledger clause, because there is no row
   * anywhere to have read: what travels is this
   * window's own memory of trying, and saying so is
   * what stops it reading as a run that ran.
   */
  runAskAgentRefused: (workflow: string, detail: string) =>
    l10n.t(
      "A run of `{0}` never started — the app refused it with: {1}. The attached mBoss run evidence is this window's own record of the attempt; nothing was written to the ledger, because there was no run to write. Tell me why the request was refused.",
      workflow,
      detail,
    ),

  /**
   * The row mBoss writes into the transcript when
   * it reads a run for the agent.
   *
   * The agent's own reads are drawn the same way,
   * which is the point: what mBoss did and what the
   * agent did belong in one column, and only the
   * rail says which is which.
   */
  runEvidenceVerb: () => l10n.t('Read'),

  runEvidenceTarget: (workflowId: string) =>
    l10n.t('run {0} · mBoss run evidence', workflowId),

  /** The way from that row to the whole run. */
  runEvidenceOpenRun: () => l10n.t('Open run'),

  /**
   * The summary folded under that row, one fact per
   * line.
   *
   * A line whose fact the record does not carry is
   * not printed at all — never a label with a dash
   * after it, which is a panel saying it looked and
   * a reader taking it as an answer.
   */
  runEvidenceError: (error: string) => l10n.t('error · {0}', error),

  runEvidenceFailedAt: (operation: string) =>
    l10n.t('failed at · {0}', operation),

  runEvidenceRetry: (attempts: string) =>
    l10n.t('retry · max {0} · configured', attempts),

  runEvidenceHandler: (signature: string) => l10n.t('handler · {0}', signature),

  /** An export the last scan of the code behind the
   *  project never found — somebody renamed it, or
   *  it is not written yet. */
  runEvidenceHandlerMissing: (exported: string) =>
    l10n.t('handler · {0} · not in the last scan of lib/', exported),

  runEvidenceSource: (file: string) => l10n.t('source · {0}', file),

  runEvidenceStatus: (status: string) => l10n.t('status · {0}', status),

  runEvidenceRecovered: (times: string) =>
    l10n.t('recovered · picked back up {0} times', times),

  runEvidenceVersion: (version: string) => l10n.t('version · {0}', version),

  /** Who read what, and where. The host and the
   *  database only — the string it came from
   *  carries a password. */
  runEvidenceReader: (database: string, from: string) =>
    l10n.t(
      'read · dbos.workflow_status, dbos.operation_outputs at {0} via {1}',
      database,
      from,
    ),

  /** How many rows travelled, so a run longer than
   *  the record carries has a visible gap rather
   *  than a silent one. */
  runEvidenceOperations: (carried: string, total: string) =>
    l10n.t('operations · {0} of {1} carried', carried, total),

  runEvidenceRefused: (workflow: string, at: string) =>
    l10n.t('refused · {0} at {1}', workflow, at),

  runEvidenceDetail: (detail: string) => l10n.t('detail · {0}', detail),

  /**
   * The line naming what is being read. The host
   * and database only — the string it came from
   * carries a password.
   */
  runsSource: (database: string) =>
    l10n.t('dbos.workflow_status · {0}', database),

  /**
   * A run of a workflow this project no longer
   * saves.
   *
   * Somebody renamed the document, or deleted it,
   * or the run came from an app this folder is not
   * the source of. The run still happened and its
   * trace still reads — only the drawing is gone,
   * so this says which one rather than opening
   * nothing.
   */
  runNoDocument: (name: string) =>
    l10n.t(
      'This project has no workflow named {0} to open. The run still reads; only its drawing is missing.',
      name,
    ),

  /**
   * A block naming a function the last scan of the
   * project's code-behind never found.
   *
   * Ordinary rather than broken: a workflow is
   * usually drawn before its code is written, and
   * agents write these documents too. So this names
   * the export and stops, which is what somebody
   * needs to go and write it.
   */
  openFunctionUnknown: (exported: string) =>
    l10n.t(
      "This project's code-behind has no function named {0} to open. Write it in lib/, or point the block at one that exists.",
      exported,
    ),

  /**
   * A frame naming a file this workspace no longer
   * has.
   *
   * The frame was captured inside the image the run
   * executed, so it is a claim about the code that
   * was built rather than about the code on disk.
   * The two coming apart is ordinary — a rename, a
   * move, a run of somebody else's build — so this
   * names the file and says which of the two is
   * being talked about.
   */
  errorLocationGone: (file: string) =>
    l10n.t(
      'This workspace has no {0}. The line came from the image that ran, so the file has been moved or renamed since it was built.',
      file,
    ),

  /** The boundary the design draws, drawn where a
   *  person can see it. */
  runsScope: () =>
    l10n.t("Local runs only. Deployed apps are DBOS Conductor's."),

  /** The mark leads, because recovery is what
   *  happened to the run and the tick after it read
   *  as a second opinion about the outcome. */
  runsRecoveredTag: () => l10n.t('↻ recovered'),

  /**
   * Where a run got to, in one line under its row.
   *
   * Every form of it is worked out from the last
   * operation the run recorded of its own — nothing
   * in the ledger marks a run as being *at* a block
   * — so the row draws these beside the word that
   * says they were derived.
   */
  /**
   * What the run page's graph is a picture of.
   *
   * The revision matters: the document may have
   * moved on since the run, and the picture is of
   * the document rather than of the run.
   */
  runGraphCaption: (revision: number) =>
    l10n.t('workflow as saved · revision {0}', revision),
  runGraphMissing: (name: string) =>
    l10n.t('no saved workflow named {0} · trace only', name),

  /**
   * When a block wakes, and when it gives up.
   *
   * Both are read off the sleep row the SDK writes
   * beside a wait — and both are drawn as derived,
   * because the moment is a deadline the SDK
   * recorded rather than something that has
   * happened.
   */
  runAsleepUntil: (at: string) => l10n.t('asleep until {0}', at),
  runTimesOut: (at: string) => l10n.t('times out {0}', at),

  /** What tells one turn of a block from another. */
  runGroupRound: (round: number) => l10n.t('· round {0}', round),
  runGroupItems: (items: number) => l10n.t('· {0} items', items),

  runFailedSummary: (node: string) => l10n.t('failed · {0}', node),
  runWaitingSummary: (node: string, at: string) =>
    l10n.t('waiting · {0} · {1}', node, at),
  runRunningSummary: (node: string) => l10n.t('running · after {0}', node),
  runDoneSummary: (count: number) =>
    l10n.t('done · {0} durable operations', count),
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
  /**
   * What a recovery cost, without claiming code was
   * skipped.
   *
   * The old wording said steps "came back instead of
   * running again", which reads as though DBOS chose
   * not to execute something. What actually happened
   * is narrower and worth saying exactly: completed
   * durable operations were not re-executed, and the
   * gap is an inference over the recorded rows
   * rather than a moment anything wrote down.
   *
   * The two numbers are not in the sentence. Each is
   * its own line so the page can mark it derived
   * beside the figure — a number inside a paragraph
   * wears no chip, and a derived number a person
   * reads as a recorded one is the whole failure
   * mode of a flight recorder.
   */
  runRecoveredHeading: () =>
    l10n.t('Recovered — completed durable operations were not re-executed'),
  runRecoveredBody: () =>
    l10n.t(
      'DBOS picked this run back up. Both figures are derived from the widest gap between recorded operations — the durable operations that finished before that gap were reused from dbos.operation_outputs rather than run again.',
    ),
  runRecoveredDown: (down: string) => l10n.t('nothing ran for about {0}', down),
  runRecoveredReused: (count: number) =>
    l10n.t('{0} durable operations reused', count),

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
   * Where a replay took over.
   *
   * Named by the block wherever the row at the fork
   * point still belongs to one, and by DBOS's own
   * step number otherwise — a workflow edited since
   * the run has rows naming blocks that are gone,
   * and the number is the fact that is left.
   */
  runReplayFrom: (block: string) => l10n.t('replay from {0}', block),
  runReplayFromStep: (step: number) => l10n.t('replay from step {0}', step),

  /**
   * The same fork, from the list.
   *
   * The child line is drawn only for a run already
   * on the page, so neither of these costs a query:
   * `forked_from` is a column every row already
   * selects.
   */
  runsReplayOf: (id: string) => l10n.t('replay of {0}', id),
  runsReplayInto: (id: string, status: string) =>
    l10n.t('└ replay → {0} · {1}', id, status),

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
   * The modal a replay is offered through.
   *
   * The two lists are the whole of it. What a replay
   * costs is that some of the run is reused and the
   * rest runs again, and a person deciding whether
   * to press the button is deciding about exactly
   * those two lists — so they are drawn, not
   * summarised.
   */
  replayTitle: (block: string) => l10n.t('Replay from {0}?', block),

  /** The same question about a run no point could be
   *  named in, which is every refusal. */
  replayRunTitle: (id: string) => l10n.t('Replay run {0}?', id),
  replayBody: () =>
    l10n.t(
      'Creates a new DBOS execution from this step. Earlier durable results are reused, not re-executed.',
    ),
  replayReused: () => l10n.t('reused · recorded'),
  replayReusedNothing: () =>
    l10n.t("nothing — this is the run's first durable operation"),
  replayWillExecute: () => l10n.t('will execute'),

  /**
   * Where the list stops.
   *
   * A branch's way out is a value nothing recorded,
   * so what runs after it is not something anybody
   * here can know. The block that decides is named
   * instead of the blocks it might reach.
   */
  replayDecides: (block: string) => l10n.t('then {0} decides', block),

  replayHint: () =>
    l10n.t(
      "resolves to the durable operation's DBOS function id · available while the structure before this point is unchanged — structural edits need a new run",
    ),

  /** The buttons. `Cancel` is the modal's own. */
  replayDo: () => l10n.t('Replay'),
  replayRebuildFirst: () => l10n.t('Rebuild and replay'),
  replayStartFirst: () => l10n.t('Start and replay'),
  replayChoose: () => l10n.t('Choose…'),
  replayChoosing: () =>
    l10n.t('Which recorded point should the replay start from?'),
  replayRunAgain: () => l10n.t('Run again'),

  /**
   * What the running app is, against what is on
   * disk.
   *
   * A replay executes the image, not the folder
   * somebody is editing, so a fix that has not been
   * built answers exactly as the failure did. The
   * file that is newest is named because it is the
   * one they just saved.
   */
  replayStackStale: (path: string) =>
    l10n.t('The running app was built before your change to {0}.', path),
  replayStackDown: () =>
    l10n.t('The local stack is not running. The replay starts when it is.'),
  replayStackUnknown: () =>
    l10n.t('Nothing here says when the running app was built.'),
  replayRebuildFailed: () =>
    l10n.t('The app did not come back up, so nothing was replayed.'),
  replayOnBuild: (seconds: string) =>
    l10n.t('It runs on the app built {0} s ago.', seconds),

  /**
   * The seven ways a replay is not on offer.
   *
   * Each names the one thing that would change the
   * answer, because a refusal a person cannot act on
   * is a refusal that reads as a bug.
   */
  replayNoDocument: (name: string) =>
    l10n.t('This project has no workflow named {0} to replay against.', name),
  replayNoLockfile: () =>
    l10n.t(
      'This project has no package-lock.json, so which DBOS it runs is unknown.',
    ),
  replaySdkNewer: (extension: string, project: string) =>
    l10n.t(
      'This extension reads DBOS {0} and the project runs {1}. Update the project first.',
      extension,
      project,
    ),
  replaySdkMajor: (extension: string, project: string) =>
    l10n.t(
      'This extension reads DBOS {0} and the project runs {1}, which is a different major version.',
      extension,
      project,
    ),
  replayNotOffered: () =>
    l10n.t('That row is not a point a replay can start from.'),

  /** Row 14's diagnostic is what says which document
   *  was refused and why, so this points at it
   *  rather than repeating it. */
  replayGeneratedBehind: (name: string) =>
    l10n.t(
      'The code generated for {0} is not what the document says. See the Problems panel.',
      name,
    ),

  /**
   * The one refusal that is about the run rather
   * than the project.
   *
   * DBOS compares the recorded name at each function
   * id as it replays, so a fork carrying rows the
   * current code would not write ends in an error
   * the moment it runs. Both names are said, because
   * which pair disagreed is the whole of what
   * changed.
   */
  replayStructureChanged: (
    block: string,
    at: number,
    recorded: string,
    expected: string,
  ) =>
    l10n.t(
      'The workflow structure before {0} changed: step {1} recorded `{2}`, and the workflow now records `{3}` there. Start a new run instead.',
      block,
      at,
      recorded,
      expected,
    ),

  /** Why one recorded row is not a boundary, said on
   *  the row itself. */
  replayRowSdkOwned: () =>
    l10n.t(
      'DBOS wrote this row for itself. A replay starts from a step the workflow recorded.',
    ),
  replayRowInsideWait: () =>
    l10n.t(
      'Starting here would hand the new run an answer that came back for the old one.',
    ),
  replayRowLinkScoped: (block: string) =>
    l10n.t(
      'The link this wait opens names the run it was minted for. Replay from {0} instead.',
      block,
    ),
  replayRowParkedHere: () => l10n.t('The run is sitting here now.'),

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

  /**
   * Said on a document that is fine, about one that
   * is not.
   *
   * The compiler refuses a project all or nothing,
   * so a workflow nobody has touched stops being
   * regenerated because of something in a document
   * beside it. Without this the panel says only
   * what is wrong with the other one, and the
   * connection between the two is a thing a person
   * has to already know.
   *
   * One name, not a list: a sentence naming three
   * documents stops being read, and each refused
   * document carries its own errors in the same
   * panel.
   */
  codegenNotRegenerated: (name: string, other: string) =>
    l10n.t('`{0}` was not regenerated: `{1}` was refused.', name, other),

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
