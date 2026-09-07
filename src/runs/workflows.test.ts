import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { savedWorkflow } from '../test-support/runs.js';

import { projectWorkflows, workflowDocument } from './workflows.js';

/**
 * The documents a project has saved, and one of
 * them read back whole.
 *
 * The picker needs a name and a trigger; the run
 * page needs the graph the run was a run of. Both
 * read the same files off disk, because the app has
 * no route that lists workflows and the canvas
 * writes through the editor's own buffer — so what
 * is saved is the last thing anybody agreed on.
 */

function project(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mboss-workflows-'));
  const workflows = join(dir, '.mboss', 'workflows');

  mkdirSync(workflows, { recursive: true });

  for (const [name, trigger] of Object.entries(files)) {
    writeFileSync(
      join(workflows, `${name}.workflow.json`),
      savedWorkflow(name, trigger),
      'utf8',
    );
  }

  return dir;
}

describe('the workflows a project has saved', () => {
  it('says where each document is, so it can be read again', () => {
    const dir = project({ groom_booking: { mode: 'manual' } });
    const [only] = projectWorkflows(dir);

    expect(only?.name).toBe('groom_booking');
    expect(only?.path).toBe(
      join(dir, '.mboss', 'workflows', 'groom_booking.workflow.json'),
    );
  });
});

describe('one saved workflow, read whole', () => {
  it('parses the document the run was a run of', () => {
    const dir = project({ groom_booking: { mode: 'manual' } });
    const found = workflowDocument(dir, 'groom_booking');

    expect(found?.name).toBe('groom_booking');
    expect(found?.nodes.map((node) => node.id)).toEqual(['started']);
  });

  /**
   * A workflow somebody renamed, deleted, or has
   * not written yet. The run still happened and its
   * trace still reads; only the picture is missing,
   * and saying so is the page's job rather than
   * this one's.
   */
  it('says nothing about a workflow the project does not have', () => {
    const dir = project({ groom_booking: { mode: 'manual' } });

    expect(workflowDocument(dir, 'nightly_sync')).toBeUndefined();
  });

  it('says nothing about a document that will not parse', () => {
    const dir = project({});
    writeFileSync(
      join(dir, '.mboss', 'workflows', 'half_typed.workflow.json'),
      '{ "nodes": [',
      'utf8',
    );

    expect(workflowDocument(dir, 'half_typed')).toBeUndefined();
  });
});
