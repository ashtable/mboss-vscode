import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  MBOSS_DIRNAME,
  ProjectNameSchema,
  WorkflowIRSchema,
  applyProposal,
  compileProject,
  layout,
  listProposals,
  loadOrScan,
  mbossDirOf,
  newestSnapshot,
  readWorkflow as readWorkflowFile,
  scaffoldProject,
  undo,
  validateWorkflow,
  workflowsDir,
  type ApplyError,
  type CompileResult,
  type Diagnostic,
  type LibManifest,
  type NodeBox,
  type Proposal,
  type ScaffoldOptions,
  type WorkflowIR,
} from '@mboss/core';

export { STALE_LOCK_MS } from '@mboss/core';

export type { DiffSummary, Proposal } from '@mboss/core';

/**
 * The one module that talks to `@mboss/core`.
 *
 * Everything the extension knows about workflow
 * semantics comes from that library, and the
 * canvas, the save watcher, the preview flow and
 * the project scaffold all want overlapping bits
 * of it. Routing them through here means the
 * shapes they pass around are this extension's,
 * not a re-export of somebody else's, and that
 * there is one answer to questions like "what does
 * an unreadable document look like" rather than
 * one per caller.
 *
 * This is host-only: the barrel reaches the layout
 * engine and the TypeScript compiler. The slice a
 * browser frame may load is `rules.ts` beside it,
 * and a test asserts those two are the only
 * importers.
 */

export type WorkflowRead =
  { ok: true; ir: WorkflowIR } | { ok: false; detail: string };

/**
 * A workflow document, read the way everything
 * downstream of the file has to read it.
 *
 * The file is written by agents as well as by the
 * canvas, so it is parsed rather than trusted. A
 * failure comes back as one line a user can act
 * on, not as an exception: an editor that throws
 * on a half-typed document is unusable.
 */
export function readWorkflow(text: string): WorkflowRead {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  }

  const parsed = WorkflowIRSchema.safeParse(json);
  if (!parsed.success) {
    const [first] = parsed.error.issues;
    const at = first?.path.join('.');

    return {
      ok: false,
      detail:
        at === undefined || at === ''
          ? (first?.message ?? 'not a workflow document')
          : `${at}: ${first?.message}`,
    };
  }

  return { ok: true, ir: parsed.data };
}

/**
 * Where every node goes, keyed by node id.
 *
 * A plain object rather than the map core hands
 * back, because this crosses into a webview and
 * what crosses has to survive being JSON.
 */
export async function boxesFor(
  ir: WorkflowIR,
): Promise<Record<string, NodeBox>> {
  return Object.fromEntries(await layout(ir));
}

/** What core makes of a document as it stands. */
export function checkWorkflow(
  ir: WorkflowIR,
  manifest?: LibManifest,
): Diagnostic[] {
  return validateWorkflow(ir, { manifest });
}

/**
 * The document, one revision on.
 *
 * Two things here have to match what `core/apply`
 * writes, and a test holds them to it by applying
 * the same edit both ways and comparing bytes.
 *
 * The revision goes up by exactly one, because it
 * counts writes and two writers holding the same
 * number is how a conflicting edit is caught. And
 * the text is the document parsed back through the
 * schema before it is printed, so its keys come
 * out in schema order however the caller assembled
 * it — otherwise the same content saved from the
 * canvas and from an agent would diff on every
 * line.
 */
export function nextDocument(ir: WorkflowIR): string {
  const next = WorkflowIRSchema.parse({ ...ir, revision: ir.revision + 1 });

  return `${JSON.stringify(next, null, 2)}\n`;
}

/**
 * The project a workflow file belongs to, or
 * nothing when the file is not inside one.
 *
 * Documents live at
 * `<project>/.mboss/workflows/<name>.workflow.json`,
 * so the project is three directories up — and the
 * check that the third one is the control
 * directory is what stops a file merely named
 * `*.workflow.json` from being treated as one.
 */
export function projectOf(fsPath: string): string | undefined {
  const mbossDir = dirname(dirname(fsPath));

  return mbossDir.endsWith(MBOSS_DIRNAME) ? dirname(mbossDir) : undefined;
}

export type LibScan =
  { ok: true; manifest: LibManifest } | { ok: false; detail: string };

/**
 * Reads what the project's code-behind offers.
 *
 * A type error in a handler is not a failure here:
 * code mid-edit is the ordinary state, so the scan
 * carries what it could not make sense of and still
 * answers with everything that did scan. Only
 * something that stopped the scan happening at all
 * comes back as a failure.
 *
 * The result is cached against the contents of the
 * files it read, so this is called on every change
 * rather than guarded by a check of our own. A
 * second answer to "has anything changed", written
 * beside one that is already keyed on the bytes, is
 * a second thing to be wrong.
 */
export function scanCodeBehind(project: string): LibScan {
  try {
    return { ok: true, manifest: loadOrScan(project) };
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  }
}

/**
 * What the project's code-behind offers, or
 * nothing when there is no project to scan or the
 * scan cannot run.
 *
 * A missing manifest is a normal state, not a
 * failure: the palette shows no `/lib` section and
 * the two validation rules that read one stay
 * quiet, which is the right answer about a project
 * nobody has scanned. Failing here instead would
 * close the canvas over a syntax error in a file
 * the graph does not depend on.
 */
export function manifestFor(project: string): LibManifest | undefined {
  const scan = scanCodeBehind(project);

  return scan.ok ? scan.manifest : undefined;
}

/** Whether this directory is an mBoss project at
 *  all. */
export function isProject(dir: string): boolean {
  return existsSync(mbossDirOf(dir));
}

/**
 * Whether core would accept this as a project name.
 *
 * Asked while somebody types, so it answers rather
 * than throwing. The rule is core's: the name is a
 * directory, an npm package name, a compose project
 * name and the name every run is recorded against,
 * so it is not this extension's to soften. What to
 * say about a refusal is the caller's, because a
 * string a person reads has to be localized and
 * nothing in here is.
 */
export function isProjectName(name: string): boolean {
  return ProjectNameSchema.safeParse(name).success;
}

/**
 * Creates a project, control plane included.
 *
 * The bundle is passed in rather than written
 * afterwards, because core's scaffold decides what
 * a project is made of and does it as one refusal-
 * or-nothing pass: a name it cannot use leaves the
 * directory exactly as it was found. Writing the
 * server in behind its back would put half a
 * project on disk when the other half was refused.
 *
 * The bundle is around eighteen megabytes of text
 * and is read for exactly the length of this call.
 */
export async function createProject(
  dir: string,
  options: ScaffoldOptions,
): Promise<void> {
  await scaffoldProject(dir, options);
}

/** A project's control directory: everything about
 *  the project that is not the project's own code. */
export function controlDir(project: string): string {
  return mbossDirOf(project);
}

/**
 * Every workflow document in a project, absolute
 * and in a fixed order.
 *
 * Ordered because these become entries in a panel a
 * person reads, and a list that reshuffles itself
 * between runs is a list nobody can scan.
 */
export function workflowFiles(project: string): string[] {
  const dir = workflowsDir(mbossDirOf(project));

  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.workflow.json'))
      .sort()
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/**
 * The zone a schedule runs on when its trigger
 * names none.
 *
 * `UTC` because that is what the control-plane
 * server passes. The extension and an agent both
 * regenerate the same project, and a fallback they
 * disagreed about would have each of them rewrite
 * the other's schedules on every save.
 */
const DEFAULT_TIMEZONE = 'UTC';

/** One workflow the compiler would not take. */
export type CompileFailure = {
  name: string;

  /** What the rules found, when the rules are
   *  why. */
  diagnostics: Diagnostic[];

  /** What the compiler could not express, when that
   *  is why instead. */
  unsupported?: string;
};

export type Compiled = {
  ok: boolean;

  /** Project-relative, and what is actually on
   *  disk. */
  written: string[];
  removed: string[];

  failures: CompileFailure[];
};

/**
 * Regenerates every workflow in a project.
 *
 * It takes the project's write lock itself, and the
 * lock is not reentrant — so this is never called
 * from inside one, and the extension takes no lock
 * of its own anywhere.
 *
 * The two shapes a refusal arrives in are flattened
 * into one here, because to a caller they are one
 * situation: this workflow produced no code, and
 * here is what to say about it.
 */
export async function compileWorkflows(project: string): Promise<Compiled> {
  const result = await compileProject(project, {
    timezone: DEFAULT_TIMEZONE,
  });

  if (result.ok) {
    return {
      ok: true,
      written: result.written,
      removed: result.removed,
      failures: [],
    };
  }

  return {
    ok: false,
    written: [],
    removed: [],
    failures: result.failures.map(({ name, result: failure }) =>
      failureOf(name, failure),
    ),
  };
}

/**
 * Every proposal a project is still waiting on an
 * answer about.
 *
 * The rest of the directory is history: an applied
 * proposal is what the document now says, and a
 * discarded one was replaced by whatever the agent
 * proposed next. One workflow has at most one
 * outstanding proposal, and that is the library's
 * invariant rather than a rule enforced here.
 */
export async function liveProposals(project: string): Promise<Proposal[]> {
  const found = await listProposals(mbossDirOf(project));

  return found.filter((proposal) => proposal.status === 'proposed');
}

/**
 * A workflow as the file has it.
 *
 * Nothing there, and a file that will not parse,
 * both come back as nothing. A proposal is checked
 * against the revision on disk, and a document
 * nobody can read has no revision to check against
 * — which is exactly the answer that makes a
 * proposal stale, and the canvas says what is wrong
 * with the file itself.
 */
export async function currentWorkflow(
  project: string,
  name: string,
): Promise<WorkflowIR | undefined> {
  try {
    const read = await readWorkflowFile(mbossDirOf(project), name);

    return read.ok ? read.ir : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What came of approving a proposal.
 *
 * A stale proposal is its own answer rather than
 * one refusal among many, because it is the only
 * one a person can act on: the graph moved, so ask
 * the agent again.
 */
export type Applied =
  | { at: 'applied'; ir: WorkflowIR }
  | { at: 'stale' }
  | { at: 'refused'; detail: string };

/**
 * Applies a proposal a person approved.
 *
 * This takes the project's write lock itself, and
 * the lock is not reentrant — so nothing may be
 * awaited inside it that takes the lock too, the
 * regeneration afterwards included.
 */
export async function applyLiveProposal(
  project: string,
  id: string,
  manifest?: LibManifest,
): Promise<Applied> {
  const outcome = await applyProposal(mbossDirOf(project), id, { manifest });

  if (outcome.ok) return { at: 'applied', ir: outcome.ir };
  if (outcome.error.code === 'PROPOSAL_STALE') return { at: 'stale' };

  return { at: 'refused', detail: detailOf(outcome.error) };
}

/** What came of taking back the last write. */
export type Undone =
  | { at: 'undone'; ir: WorkflowIR }
  | { at: 'nothing' }
  | { at: 'refused'; detail: string };

/** Puts back what the workflow said before the last
 *  write, as a new revision. */
export async function undoWorkflow(
  project: string,
  name: string,
  manifest?: LibManifest,
): Promise<Undone> {
  const outcome = await undo(mbossDirOf(project), name, { manifest });

  if (outcome.ok) return { at: 'undone', ir: outcome.ir };
  if (outcome.error.code === 'NOTHING_TO_UNDO') return { at: 'nothing' };

  return { at: 'refused', detail: detailOf(outcome.error) };
}

/** Whether there is anything left to take back. */
export async function hasSnapshot(
  project: string,
  name: string,
): Promise<boolean> {
  return (await newestSnapshot(mbossDirOf(project), name)) !== undefined;
}

/**
 * A refusal in words.
 *
 * A failed validation says what the rules said,
 * because that is something a person can act on.
 * The rest are codes: they name situations a person
 * cannot do anything about except tell somebody,
 * and a sentence invented here would be a second
 * description of the library's own.
 */
function detailOf(error: ApplyError): string {
  if (error.code === 'VALIDATION_FAILED') {
    return error.errors.map((found) => found.message).join(' ');
  }

  return error.code;
}

function failureOf(name: string, result: CompileResult): CompileFailure {
  if (result.ok) return { name, diagnostics: [] };

  return result.reason === 'CANNOT_COMPILE'
    ? { name, diagnostics: result.diagnostics }
    : { name, diagnostics: [], unsupported: result.message };
}
