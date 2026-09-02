import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applySpec } from '@mboss/core';
import { describe, expect, it } from 'vitest';

import { NODE_PALETTE, WorkflowIRSchema } from './rules.js';
import { nextDocument, readWorkflow } from './index.js';
import { messages } from '../messages.js';
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
    expect(Object.keys(messages.paletteLabels()).sort()).toEqual(
      NODE_PALETTE.map((entry) => entry.kind).sort(),
    );
  });

  it('still say what the catalog says they say', () => {
    for (const entry of NODE_PALETTE) {
      expect(messages.paletteLabels()[entry.kind]).toBe(entry.label);
    }
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
});
