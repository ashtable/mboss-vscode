import { readFileSync } from 'node:fs';

import {
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

  return {
    ms,
    ok: compiled.ok,
    written: compiled.written,
    removed: compiled.removed,
    problems: [
      ...problems,
      ...refusals(compiled.failures, documents, problems),
    ],
  };
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
