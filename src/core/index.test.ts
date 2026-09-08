import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applySpec } from '@mboss/core';
import * as fromCore from '@mboss/core';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RETRY,
  NODE_PALETTE,
  RetrySchema,
  SDK_OPERATIONS,
  WorkflowIRSchema,
  ownerOf,
} from './rules.js';
import {
  compileInputs,
  compileWorkflow,
  compileWorkflows,
  nextDocument,
  readWorkflow,
  type TraceMatch,
  type UsePatternOutcome,
} from './index.js';
import * as fromIndex from './index.js';
import * as fromRules from './rules.js';
import { paletteLabels } from '../canvas/words.js';
import {
  makeProject,
  readWorkflowFixture,
  writeWorkflow,
} from '../test-support/project.js';
import { CORE_ROOT, sourceFiles } from '../test-support/repo.js';

const GROOM_BOOKING = join(
  CORE_ROOT,
  'fixtures',
  'ir',
  'groom_booking.workflow.json',
);

describe('reading a workflow document', () => {
  it('parses a real one', () => {
    const read = readWorkflow(readFileSync(GROOM_BOOKING, 'utf8'));

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.ir.name).toBe('groom_booking');
    expect(read.ir.revision).toBeGreaterThan(0);
    expect(read.ir.nodes.length).toBeGreaterThan(0);
  });

  /**
   * A document is edited by hand and by agents, so
   * it is half-written most of the time an editor
   * looks at it. Throwing there would close the
   * canvas over a missing brace.
   */
  it('reports broken JSON instead of throwing', () => {
    const read = readWorkflow('{ "name": ');

    expect(read.ok).toBe(false);
  });

  it('names the field that made a document invalid', () => {
    const read = readWorkflow(
      JSON.stringify({
        $schema: 'https://mboss.dev/schemas/workflow-v1.json',
        version: 1,
        revision: 0,
        name: 'bad_revision',
        nodes: [],
        edges: [],
      }),
    );

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.detail).toContain('revision');
  });
});

/**
 * The canvas writes through the document VS Code
 * owns, so it builds the next version of a workflow
 * itself rather than calling `applySpec`. Two things
 * about that version have to match what core writes
 * anyway — the revision goes up by exactly one, and
 * the keys come out in schema order — or the same
 * content saved from the canvas and from an agent
 * would diff on every line.
 *
 * So the same edit is made both ways and the bytes
 * are compared. Core changing how it writes a
 * document fails this rather than showing up as
 * noise in somebody's git diff.
 */
describe('the next version of a document', () => {
  it('is byte-for-byte what core would have written', async () => {
    const ir = WorkflowIRSchema.parse(
      JSON.parse(readFileSync(GROOM_BOOKING, 'utf8')),
    );

    const project = mkdtempSync(join(tmpdir(), 'mboss-canvas-'));
    const mbossDir = join(project, '.mboss');
    mkdirSync(join(mbossDir, 'workflows'), { recursive: true });

    const file = join(mbossDir, 'workflows', 'groom_booking.workflow.json');
    writeFileSync(file, readFileSync(GROOM_BOOKING, 'utf8'), 'utf8');

    const renamed = { ...ir, title: 'Groom booking, renamed' };

    const applied = await applySpec(mbossDir, {
      name: 'groom_booking',
      spec: {
        title: renamed.title,
        nodes: renamed.nodes,
        edges: renamed.edges,
      },
      baseRevision: ir.revision,
    });

    expect(applied.ok).toBe(true);
    expect(nextDocument(renamed)).toBe(readFileSync(file, 'utf8'));
  });
});

/**
 * The catalog says which kinds there are and what
 * order they come in; it does not say what they are
 * called on screen, because its labels are literals
 * inside a library and a webview may show no string
 * the host did not localize. Both directions are
 * checked, so the table cannot quietly cover a kind
 * that no longer exists or miss one that does.
 */
describe('the palette labels', () => {
  it('cover exactly the kinds the catalog offers', () => {
    expect(Object.keys(paletteLabels()).sort()).toEqual(
      NODE_PALETTE.map((entry) => entry.kind).sort(),
    );
  });

  it('still say what the catalog says they say', () => {
    for (const entry of NODE_PALETTE) {
      expect(paletteLabels()[entry.kind]).toBe(entry.label);
    }
  });
});

/**
 * What a webview needs of core beyond the drawing
 * rules: how to read a ledger row back to the
 * block that wrote it, and what a block that
 * configured nothing will actually do when it
 * fails. Both are arithmetic over data a frame
 * already holds, so they belong on the browser-safe
 * side rather than behind a message.
 */
describe('the browser-safe slice', () => {
  it('reads a recorded step name back to the block that owns it', () => {
    expect(ownerOf('await_reply.register')).toEqual({
      kind: 'node',
      nodeId: 'await_reply',
      segments: [{ kind: 'register' }],
    });
    expect(ownerOf('DBOS.sleep').kind).toBe('sdk');
    expect(SDK_OPERATIONS.has('getStatus')).toBe(true);
  });

  it('carries the retry policy an unconfigured block runs under', () => {
    expect(DEFAULT_RETRY).toEqual(RetrySchema.parse({}));
    expect(DEFAULT_RETRY).toEqual({
      maxAttempts: 3,
      intervalSeconds: 1,
      backoffRate: 2,
    });
  });
});

/**
 * A document compiled on its own has to be
 * compiled the way the project would compile it,
 * or the source a person is shown is not the
 * source that would be written. The manifest and
 * the zone are the whole of that: the manifest
 * says what the handlers are, and the zone is
 * stamped into every schedule whose trigger names
 * none.
 */
describe('what a document is compiled with', () => {
  it('gives one document the same manifest and timezone the project gets', async () => {
    const project = await makeProject({ lib: 'lib' });
    writeWorkflow(project, 'groom_booking');

    const compiled = await compileWorkflows(project);
    expect(compiled.ok).toBe(true);
    const [generated] = compiled.written;
    expect(generated).toBeDefined();
    if (generated === undefined) return;

    const onDisk = readFileSync(join(project, generated), 'utf8');
    const ir = WorkflowIRSchema.parse(
      JSON.parse(readWorkflowFixture('groom_booking')),
    );

    const alone = compileWorkflow({ ir, ...compileInputs(project) });

    expect(alone.ok).toBe(true);
    if (!alone.ok) return;
    expect(alone.source).toBe(onDisk);
  });
});

/**
 * The seam, asserted rather than agreed to.
 *
 * Core's shapes are a library's, and they change
 * on that library's schedule. One module between
 * them and the extension is what keeps a core
 * change from being a change to five unrelated
 * files.
 */
describe('the boundary', () => {
  const shipped = sourceFiles().filter(
    (path) => !path.endsWith('.test.ts') && !path.includes('test-support'),
  );

  const importing = (pattern: RegExp): string[] =>
    shipped
      .filter((path) => pattern.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(path.lastIndexOf('src/')));

  it('is the only place the core library is imported', () => {
    expect(importing(/from\s+'@mboss\/core'/)).toEqual(['src/core/index.ts']);
  });

  /**
   * The barrel drags in the layout engine and the
   * TypeScript compiler, which a browser frame
   * cannot carry, so the browser-safe slice reaches
   * past it by relative path. That is the one file
   * allowed to, and this is what keeps it the one
   * file — a deep import anywhere else would be an
   * unreviewed second seam.
   */
  it('reaches past it in exactly one other place', () => {
    expect(importing(/mboss-core\/src\//)).toEqual(['src/core/rules.ts']);
  });

  /**
   * The client that can write to somebody's run
   * history is opened in one place, so that what
   * this extension may do to a database it does not
   * own is a question with one answer rather than
   * one per caller.
   */
  it('opens a DBOS client in exactly one place', () => {
    // The import and the identifier, rather than the
    // package's name anywhere: the skew gate names
    // the package as a key into a lockfile, which is
    // a fact about somebody else's project rather
    // than a way into this one.
    expect(importing(/from '@dbos-inc\/dbos-sdk'|\bDBOSClient\b/)).toEqual([
      'src/runs/db.ts',
    ]);
  });

  /**
   * And what it may do stops short of starting a
   * run. A run goes through the app's own ingress,
   * so the app's own code decides what a run is;
   * a client that could start one from an editor
   * would be a second door with none of that behind
   * it.
   */
  it('starts no run through the client', () => {
    for (const call of [/startWorkflow\(/, /enqueue\(/, /listWorkflows\(/]) {
      expect(
        importing(call).filter((path) => path.startsWith('src/runs/')),
      ).toEqual([]);
    }
  });

  it('starts a run through the app own ingress', () => {
    const ingress = importing(/\/runs\/\$\{/);

    expect(ingress).toEqual(['src/runs/runner.ts']);

    // The verb as well as the path. The rule is
    // POST `/runs/:workflow`, and a fence that read
    // only the path would not notice the request
    // becoming something the route that starts runs
    // does not answer.
    expect(importing(/method: 'POST'/)).toEqual(ingress);
  });

  /**
   * The wrapper wraps most of core and forwards the
   * rest, and forwarding is only worth anything if
   * what arrives is the same function. A local
   * reimplementation under a core name would satisfy
   * the type and drift the first time core changed
   * its mind, so identity is what is asserted rather
   * than shape.
   *
   * This file is exempt from the fence above, which
   * is what lets it hold the two sides of each name
   * against each other.
   */
  it('carries core own names, not copies of them', () => {
    expect(fromIndex.compileWorkflow).toBe(fromCore.compileWorkflow);
    expect(fromIndex.replayBoundaries).toBe(fromCore.replayBoundaries);
    expect(fromIndex.traceGrammar).toBe(fromCore.traceGrammar);
    expect(fromIndex.matchTrace).toBe(fromCore.matchTrace);
    expect(fromIndex.listPatterns).toBe(fromCore.listPatterns);
    expect(fromIndex.patternNamed).toBe(fromCore.patternNamed);
    expect(fromIndex.usePattern).toBe(fromCore.usePattern);
    expect(fromIndex.blankSpec).toBe(fromCore.blankSpec);
    expect(fromIndex.patternSpec).toBe(fromCore.patternSpec);
    expect(fromIndex.WorkflowNameSchema).toBe(fromCore.WorkflowNameSchema);
    expect(fromIndex.APP_DIR).toBe(fromCore.APP_DIR);
    expect(fromIndex.CONTAINER_APP_DIR).toBe(fromCore.CONTAINER_APP_DIR);
    expect(fromIndex.LIB_DIR).toBe(fromCore.LIB_DIR);
    expect(fromIndex.REGISTRY_FILE).toBe(fromCore.REGISTRY_FILE);
  });

  /**
   * The browser-safe slice the same way, and it
   * needs saying twice: the slice reaches past the
   * barrel by relative path, so nothing but this
   * holds the two specifiers to one function.
   *
   * A frame naming a queue's child workflow, or
   * reading a queue policy off a document, has to
   * name it the way the generator named it. A copy
   * of either would agree today.
   */
  it('carries them on the browser-safe side too', () => {
    expect(fromRules.QueuePolicySchema).toBe(fromCore.QueuePolicySchema);
    expect(fromRules.EnqueuePolicySchema).toBe(fromCore.EnqueuePolicySchema);
    expect(fromRules.queuedWorkflowName).toBe(fromCore.queuedWorkflowName);
  });

  /**
   * The two type-only forwards, read at run time
   * because a type that does not resolve is a
   * compile failure and there is nothing else to
   * assert about it.
   */
  it('carries the two answers that are types and nothing else', () => {
    const matched: TraceMatch = { ok: true };
    const used: UsePatternOutcome = {
      ok: false,
      code: 'WORKFLOW_EXISTS',
      name: 'groom_booking',
    };

    expect(matched.ok).toBe(true);
    expect(used.ok).toBe(false);
  });
});
