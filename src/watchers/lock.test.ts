import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { build } from 'esbuild';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

import { makeProject, writeWorkflow } from '../test-support/project.js';
import { REPO_ROOT, sourceFiles } from '../test-support/repo.js';

import { generate } from './codegen.js';

/**
 * What happens when this extension regenerates a
 * project while something else is writing to it.
 *
 * The primitive underneath — one advisory lock
 * file, taken with `O_EXCL`, with a stale takeover
 * — is already raced hard elsewhere and is not
 * re-proven here. What is this extension's own to
 * prove is that it goes through that primitive
 * rather than beside it: the same lock, taken by
 * the library functions rather than by a second
 * implementation of the same idea, and never taken
 * twice over — which would deadlock until the stale
 * budget ran out and then read as an intermittent
 * pause rather than as a bug.
 */

const run = promisify(execFile);

type ChildOutcome =
  { ok: true; revision: number; title: string } | { ok: false; code: string };

let project: string;
let document: string;
let base: number;
let outcomes: ChildOutcome[];

beforeAll(async () => {
  const child = join(tmpdir(), `mboss-apply-child-${process.pid}.mjs`);

  // Node reads TypeScript but will not follow a
  // `.js` specifier to a `.ts` file, and the
  // library's sources are written that way.
  await build({
    entryPoints: [join(REPO_ROOT, 'src', 'test-support', 'applyChild.ts')],
    outfile: child,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    logLevel: 'warning',
  });

  const applyFrom = async (title: string): Promise<ChildOutcome> => {
    const { stdout } = await run(process.execPath, [
      child,
      join(project, '.mboss'),
      'groom_booking',
      String(base),
      title,
    ]);

    return JSON.parse(stdout) as ChildOutcome;
  };

  project = await makeProject({ lib: 'lib' });
  document = writeWorkflow(project, 'groom_booking');
  base = revisionOf(document);

  // Once first, so the code-behind scan is warm and
  // the contended generation is spent where the
  // contention is — inside the lock, rather than in
  // front of it reading a project's handlers.
  await generate(project);

  const [, first, second] = await Promise.all([
    generate(project),
    applyFrom('One'),
    applyFrom('Two'),
  ]);

  outcomes = [first, second];

  // Again afterwards, so what is inspected below is
  // code generated from whichever document won.
  await generate(project);
}, 180_000);

describe('two writers and a code generation at once', () => {
  it('lets exactly one of them win', () => {
    expect(outcomes.filter((outcome) => outcome.ok)).toEqual([
      { ok: true, revision: base + 1, title: expect.any(String) },
    ]);
  });

  it('tells the other rather than losing its edit quietly', () => {
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
      { ok: false, code: 'REVISION_CONFLICT' },
    ]);
  });

  it('leaves a document that still reads as one', () => {
    expect(() => JSON.parse(readFileSync(document, 'utf8'))).not.toThrow();
    expect(revisionOf(document)).toBe(base + 1);
  });

  it('leaves generated code that still parses', () => {
    const generated = readFileSync(
      join(project, 'src', 'workflows', 'groom_booking.workflow.ts'),
      'utf8',
    );

    expect(syntaxErrorsIn(generated)).toEqual([]);
  });

  it('leaves no lock behind', () => {
    expect(existsSync(join(project, '.mboss', '.lock'))).toBe(false);
  });
});

describe('the lock', () => {
  /**
   * It is not reentrant, and the library functions
   * this extension calls take it themselves. A
   * second one wrapped around them would wait on the
   * lock its own caller holds.
   */
  it('is never taken by this extension', () => {
    const taking = sourceFiles()
      .filter(
        (path) => !path.endsWith('.test.ts') && !path.includes('test-support'),
      )
      .filter((path) => /\bwithLock\b/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(path.lastIndexOf('src/')));

    expect(taking).toEqual([]);
  });
});

function revisionOf(path: string): number {
  return (JSON.parse(readFileSync(path, 'utf8')) as { revision: number })
    .revision;
}

/** Whether the compiler can read this as TypeScript
 *  at all. */
function syntaxErrorsIn(source: string): string[] {
  const transpiled = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2023 },
  });

  return (transpiled.diagnostics ?? []).map((found) =>
    ts.flattenDiagnosticMessageText(found.messageText, ' '),
  );
}
