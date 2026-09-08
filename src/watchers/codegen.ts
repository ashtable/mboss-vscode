import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  APP_DIR,
  REGISTRY_FILE,
  checkWorkflow,
  compileWorkflows,
  controlDir,
  isProject,
  readWorkflow,
  workflowFiles,
  type CompileFailure,
} from '../core/index.js';
import type { WorkflowIR } from '../core/rules.js';
import { messages } from '../messages.js';
import type { Problem } from '../problem.js';
import { QUEUE_SDK, olderThan, projectSdk } from '../runs/sdk.js';

import { scanProject } from './manifest.js';

/**
 * Turning the documents in a project into the code
 * it runs, and saying what is wrong with them.
 *
 * The two halves belong together because they are
 * one pass over the same files. Every document is
 * checked whether or not it compiles — a draft with
 * no trigger is a legal document that produces no
 * code, and a person needs to be told what is
 * missing rather than told nothing happened.
 *
 * The write lock is not taken here. The library's
 * compile takes it itself and it is not reentrant,
 * so a lock around this call would wait ten seconds
 * on itself and then proceed, which reads as an
 * intermittent pause rather than as a bug.
 */

export type CodegenResult = {
  /** How long the compiler ran, in milliseconds.
   *  Zero when it did not run. */
  ms: number;

  /** Whether every document produced code. */
  ok: boolean;

  /** Project-relative paths, as the compiler
   *  reported them. */
  written: string[];
  removed: string[];

  problems: Problem[];
};

const NOTHING: CodegenResult = {
  ms: 0,
  ok: false,
  written: [],
  removed: [],
  problems: [],
};

/**
 * Regenerates a project once.
 *
 * Nothing here throws for anything a person could
 * cause. A half-typed document, a handler that does
 * not compile and a workflow the compiler cannot
 * express are all ordinary states of a project
 * somebody is working in, and each of them ends up
 * as a line in PROBLEMS rather than as a rejection
 * that takes the whole project's generation with
 * it.
 */
export async function generate(project: string): Promise<CodegenResult> {
  if (!isProject(project)) return NOTHING;

  const scan = scanProject(project);
  const documents = readDocuments(project);
  const problems = [
    ...scan.problems,
    ...documents.flatMap((document) => document.problems),
    ...documents.flatMap((document) =>
      document.ir === undefined
        ? []
        : checkWorkflow(document.ir, scan.manifest).map((found) => ({
            file: document.file,
            message: found.message,
            severity: found.severity,
            code: found.code,
          })),
    ),
  ];

  // A document that will not parse stops the
  // compile rather than being skipped past: the
  // compiler reads every document in the project
  // and would throw on this one, and a project
  // regenerated without it would quietly delete the
  // code the unreadable document used to produce.
  if (documents.some((document) => document.ir === undefined)) {
    return { ...NOTHING, problems };
  }

  const started = Date.now();
  let compiled;
  try {
    compiled = await compileWorkflows(project);
  } catch (error) {
    // Not something a person could have caused —
    // a permission, a full disk. Reported anyway,
    // because the alternative is a status bar that
    // never updates and a panel that never fills,
    // which reads as the extension having stopped
    // working for no reason.
    return {
      ...NOTHING,
      ms: Date.now() - started,
      problems: [...problems, stopped(project, (error as Error).message)],
    };
  }
  const ms = Date.now() - started;

  // Only after a compile that wrote a registry.
  // The checks below read what is on disk, and a
  // refused compile left the previous run's there.
  const setup = compiled.ok ? queueSetup(project) : [];

  return {
    ms,
    ok: compiled.ok,
    written: compiled.written,
    removed: compiled.removed,
    problems: [
      ...problems,
      ...refusals(compiled.failures, documents, problems),
      ...collateral(compiled.failures, documents),
      ...setup,
    ],
  };
}

/**
 * What a project needs around code that has a
 * queue in it.
 *
 * Both of these are about files the compiler does
 * not own — the boot mBoss wrote once and the lock
 * npm writes — so neither is put right here. Each
 * is said on the file it is about, and the next
 * generation that finds it dealt with stops saying
 * it.
 */
function queueSetup(project: string): Problem[] {
  if (!declaresQueues(project)) return [];

  return [...unregisteredQueues(project), ...belowFloor(project)];
}

/** The line a registry with a queue in it carries.
 *  The empty list is written out in full on a line
 *  of its own, which is what tells the two apart —
 *  and a registry from before queues existed has
 *  neither. */
const DECLARES_QUEUES = /^export const queues: QueueEntry\[\] = \[$/m;

/**
 * Whether the registry that was just written has a
 * queue in it.
 *
 * Read back off disk rather than carried out of
 * the compile, because the file is what the app's
 * boot imports `queues` from, and that import is
 * what the sentence below is about.
 */
function declaresQueues(project: string): boolean {
  const registry = contentsOf(join(project, REGISTRY_FILE));

  return registry !== undefined && DECLARES_QUEUES.test(registry);
}

/** The two lines a boot written before queues
 *  existed is missing, in the order they go in. */
const REGISTER_QUEUES = [
  "import { registerQueues } from './queues.js';",
  'await registerQueues(queues);',
].join(' ');

/**
 * A boot that never registers the queue its runs
 * enqueue to.
 *
 * mBoss writes `src/app/main.ts` when it creates a
 * project and never again, so a project older than
 * queues has neither line and nothing here may add
 * them. A grep rather than a parse: the question
 * is whether the call is written in the file at
 * all, and however somebody has moved it around,
 * that is what the text answers.
 */
function unregisteredQueues(project: string): Problem[] {
  const file = join(project, APP_DIR, 'main.ts');
  const boot = contentsOf(file);

  // Nothing to say to a boot that is not there to
  // read. The sentence is two lines to add to this
  // file, and there is no file.
  if (boot === undefined || boot.includes('registerQueues(')) return [];

  return [
    {
      file,
      message: messages.codegenQueuesUnregistered(REGISTER_QUEUES),
      severity: 'error',
    },
  ];
}

/**
 * A project whose installed SDK is older than the
 * code a queue block compiles to.
 *
 * Read out of the lockfile, because that is what
 * the image installed, and reported on
 * `package.json`, because that is the file
 * somebody changes. A project that never installed
 * the SDK, and one with no lockfile at all, are
 * not answers about a version, so nothing is said
 * about either.
 */
function belowFloor(project: string): Problem[] {
  const sdk = projectSdk(project);

  if (!sdk.ok || !olderThan(sdk.version, QUEUE_SDK)) return [];

  return [
    {
      file: join(project, 'package.json'),
      message: messages.codegenQueuesNeedSdk(sdk.version),
      severity: 'error',
    },
  ];
}

/** A file, or nothing where there is no reading
 *  it. */
function contentsOf(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * What a refusal cost the documents beside it.
 *
 * The compiler refuses a project all or nothing, so
 * a workflow nobody has touched stops being
 * regenerated because of something in a document
 * next to it. Saying nothing about that leaves a
 * person reading a file whose generated code has
 * quietly stopped keeping up, with no thread to
 * pull.
 *
 * One diagnostic per document that was not written,
 * naming one refusal rather than all of them. A
 * sentence listing three names stops being read,
 * and every refused document carries its own errors
 * in the same panel.
 *
 * Nothing clears these. The problem sink replaces
 * the whole set on every publish, so a diagnostic
 * that is no longer computed is one that is no
 * longer shown.
 */
function collateral(
  failures: readonly CompileFailure[],
  documents: readonly Document[],
): Problem[] {
  const [first] = failures;
  if (first === undefined) return [];

  const refused = new Set(failures.map((failure) => failure.name));

  return documents.flatMap((document) =>
    document.ir === undefined || refused.has(document.ir.name)
      ? []
      : [
          {
            file: document.file,
            message: messages.codegenNotRegenerated(
              document.ir.name,
              first.name,
            ),
            severity: 'error' as const,
          },
        ],
  );
}

/** A refusal that belongs to the project rather
 *  than to any one of its documents. */
function stopped(project: string, detail: string): Problem {
  return {
    file: controlDir(project),
    message: messages.codegenStopped(detail),
    severity: 'error',
  };
}

/** One workflow document, as it currently reads. */
type Document = {
  file: string;

  /** Absent when the file will not parse. */
  ir?: WorkflowIR;

  /** Only ever the one saying it will not parse. */
  problems: Problem[];
};

function readDocuments(project: string): Document[] {
  return workflowFiles(project).map((file) => {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      return { file, problems: [unreadable(file, (error as Error).message)] };
    }

    const read = readWorkflow(text);

    return read.ok
      ? { file, ir: read.ir, problems: [] }
      : { file, problems: [unreadable(file, read.detail)] };
  });
}

function unreadable(file: string, detail: string): Problem {
  return {
    file,
    message: messages.documentUnreadable(detail),
    severity: 'error',
  };
}

/**
 * What the compiler refused, minus what the rules
 * already said.
 *
 * The compiler runs the same rules over the same
 * documents, so most of what it hands back is
 * already on the list — but not all of it, because
 * a workflow it cannot express is a refusal no rule
 * produces. Filtering rather than dropping the
 * whole set means nothing is lost if the two ever
 * diverge.
 */
function refusals(
  failures: readonly CompileFailure[],
  documents: readonly Document[],
  already: readonly Problem[],
): Problem[] {
  const fileOf = new Map(
    documents.flatMap((document) =>
      document.ir === undefined
        ? []
        : [[document.ir.name, document.file] as const],
    ),
  );
  const seen = new Set(already.map(keyOf));
  const found: Problem[] = [];

  for (const failure of failures) {
    const file = fileOf.get(failure.name);
    if (file === undefined) continue;

    for (const diagnostic of failure.diagnostics) {
      const problem: Problem = {
        file,
        message: diagnostic.message,
        severity: diagnostic.severity,
        code: diagnostic.code,
      };

      if (seen.has(keyOf(problem))) continue;

      seen.add(keyOf(problem));
      found.push(problem);
    }

    if (failure.unsupported !== undefined) {
      found.push({ file, message: failure.unsupported, severity: 'error' });
    }
  }

  return found;
}

function keyOf(problem: Problem): string {
  return JSON.stringify([problem.file, problem.code ?? '', problem.message]);
}
