import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { savedWorkflow } from '../test-support/runs.js';

import { needsTopic, projectWorkflows, savedDocument } from './workflows.js';

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
    const found = savedDocument(dir, 'groom_booking');

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

    expect(savedDocument(dir, 'nightly_sync')).toBeUndefined();
  });

  it('says nothing about a document that will not parse', () => {
    const dir = project({});
    writeFileSync(
      join(dir, '.mboss', 'workflows', 'half_typed.workflow.json'),
      '{ "nodes": [',
      'utf8',
    );

    expect(savedDocument(dir, 'half_typed')).toBeUndefined();
  });
});

/**
 * An event trigger with no topic is what switching
 * a trigger to an event leaves until somebody names
 * one. The document reads, and there is still no
 * route to post its input to, so it is not offered
 * — and that one reason is worth saying to whoever
 * is looking at the file. Every other document is
 * either offered or has nothing to say.
 */
describe('a saved workflow that needs a topic to run', () => {
  const fileOf = (dir: string, name: string): string =>
    join(dir, '.mboss', 'workflows', `${name}.workflow.json`);

  it('is an event trigger with no topic, which is not offered', () => {
    const dir = project({
      expense_claim: { mode: 'event', topic: '' },
      refund_filed: { mode: 'event', topic: 'refund.filed' },
    });

    expect(projectWorkflows(dir).map((one) => one.name)).toEqual([
      'refund_filed',
    ]);
    expect(needsTopic(fileOf(dir, 'expense_claim'))).toBe(true);
  });

  it('is no other document', () => {
    const dir = project({
      expense_claim: { mode: 'event', topic: 'expense.filed' },
      groom_booking: { mode: 'manual' },
      nightly_sync: { mode: 'schedule', cron: '0 2 * * *' },
    });
    writeFileSync(fileOf(dir, 'half_typed'), '{ "nodes": [', 'utf8');

    for (const name of [
      'expense_claim',
      'groom_booking',
      'nightly_sync',
      'half_typed',
      'never_saved',
    ]) {
      expect({ name, needsTopic: needsTopic(fileOf(dir, name)) }).toEqual({
        name,
        needsTopic: false,
      });
    }
  });
});
