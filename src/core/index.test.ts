import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readWorkflow } from './index.js';
import { CORE_ROOT, sourceFiles } from '../test-support/repo.js';

const GROOM_BOOKING = join(
  CORE_ROOT,
  'fixtures',
  'ir',
  'groom_booking.workflow.json',
);

describe('reading a workflow document', () => {
  it('summarises a real one', () => {
    const read = readWorkflow(readFileSync(GROOM_BOOKING, 'utf8'));

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.summary.name).toBe('groom_booking');
    expect(read.summary.revision).toBeGreaterThan(0);
    expect(read.summary.nodes).toBeGreaterThan(0);
  });

  it('falls back to the name when there is no title', () => {
    const read = readWorkflow(
      JSON.stringify({
        $schema: 'https://mboss.dev/schemas/workflow-v1.json',
        version: 1,
        revision: 1,
        name: 'untitled_flow',
        nodes: [],
        edges: [],
      }),
    );

    expect(read.ok && read.summary.title).toBe('untitled_flow');
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
 * The seam, asserted rather than agreed to.
 *
 * Core's shapes are a library's, and they change
 * on that library's schedule. One module between
 * them and the extension is what keeps a core
 * change from being a change to five unrelated
 * files.
 */
describe('the boundary', () => {
  it('is the only place the core library is imported', () => {
    const shipped = sourceFiles().filter(
      (path) => !path.endsWith('.test.ts') && !path.includes('test-support'),
    );
    const importers = shipped.filter((path) =>
      /from\s+'@mboss\/core'/.test(readFileSync(path, 'utf8')),
    );

    expect(
      importers.map((path) => path.slice(path.lastIndexOf('src/'))),
    ).toEqual(['src/core/index.ts']);
  });
});
