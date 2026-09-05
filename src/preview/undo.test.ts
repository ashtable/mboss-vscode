import { applySpec, mbossDirOf } from '@mboss/core';
import { describe, expect, it } from 'vitest';

import { fakeTrust } from '../../test/doubles/trust.js';
import { currentWorkflow } from '../core/index.js';
import { WorkflowIRSchema } from '../core/rules.js';
import {
  makeProject,
  readWorkflowFixture,
  writeWorkflow,
} from '../test-support/project.js';
import { propose, specOf } from '../test-support/proposals.js';

import { previewStore, type PreviewHost } from './store.js';
import { canUndo, undoLast } from './undo.js';

/**
 * Taking back the last thing that was written.
 *
 * The restored document goes on at the *next*
 * revision rather than back to the one it was
 * saved at. The counter says how many times a
 * workflow has been written, not which content it
 * holds, and a counter that went backwards would
 * let an outstanding proposal's base revision line
 * up with content it was never made against — the
 * proposal would then apply as though the undo had
 * never happened.
 *
 * And when there is nothing to take back, the
 * button says so by being disabled. A person who
 * clicks and is then told no learns the same thing
 * one moment later and with a dialog in the way.
 */

const groom = WorkflowIRSchema.parse(
  JSON.parse(readWorkflowFixture('groom_booking')),
);

/** A project whose workflow has been written once
 *  more, so there is a snapshot to restore. */
async function projectWithHistory(): Promise<string> {
  const project = await makeProject({ lib: 'lib' });
  writeWorkflow(project, 'groom_booking');

  const applied = await applySpec(mbossDirOf(project), {
    name: 'groom_booking',
    spec: specOf({ ...groom, title: 'Groom booking, edited' }),
    baseRevision: groom.revision,
  });

  expect(applied.ok).toBe(true);

  return project;
}

function trustingHost(
  folders: string[],
  said: string[] = [],
): PreviewHost & { said: string[] } {
  return {
    said,
    folders: () => folders,
    regenerate: async () => {
      said.push('regenerated');

      return [];
    },
    notify: async (text) => void said.push(text),
    note: () => {},
    say: (message) => void said.push(message),
  };
}

describe('undoing the last write', () => {
  it('puts the old content back at the next revision', async () => {
    const project = await projectWithHistory();

    const outcome = await undoLast(
      { project, regenerate: async () => {} },
      'groom_booking',
    );

    const now = await currentWorkflow(project, 'groom_booking');

    expect(outcome).toEqual({
      at: 'undone',
      workflow: 'groom_booking',
      revision: groom.revision + 2,
    });
    expect(now?.revision).toBe(groom.revision + 2);
    expect(now?.title).toBe(groom.title);
  });

  it('regenerates the code the restored document produces', async () => {
    const project = await projectWithHistory();
    const ran: string[] = [];

    await undoLast(
      { project, regenerate: async () => void ran.push('regenerated') },
      'groom_booking',
    );

    expect(ran).toEqual(['regenerated']);
  });

  it('spends the snapshot it restored', async () => {
    const project = await projectWithHistory();

    expect(await canUndo(project, 'groom_booking')).toBe(true);

    await undoLast({ project, regenerate: async () => {} }, 'groom_booking');

    expect(await canUndo(project, 'groom_booking')).toBe(false);
  });
});

describe('undoing when there is nothing to take back', () => {
  it('says there is nothing, and changed nothing', async () => {
    const project = await makeProject();
    writeWorkflow(project, 'groom_booking');

    const outcome = await undoLast(
      { project, regenerate: async () => {} },
      'groom_booking',
    );

    expect(outcome).toEqual({ at: 'nothing' });
    expect((await currentWorkflow(project, 'groom_booking'))?.revision).toBe(
      groom.revision,
    );
  });
});

/**
 * What the panel shows after an approval: the same
 * card, now saying the edit landed, with the one
 * thing left to do about it.
 */
describe('the card after an approval', () => {
  it('offers Undo while the workflow has a snapshot', async () => {
    const project = await makeProject({ lib: 'lib' });
    writeWorkflow(project, 'groom_booking');

    const proposal = await propose(project, {
      name: 'groom_booking',
      spec: specOf({ ...groom, title: 'Groom booking, as proposed' }),
      baseRevision: groom.revision,
    });

    const host = trustingHost([project]);
    const store = previewStore(host, fakeTrust());
    await store.reloadAll();

    await store.approve(proposal.id);

    const applied = store.card();

    expect(applied?.at).toBe('applied');
    if (applied?.at !== 'applied') return;
    expect(applied.workflow).toBe('groom_booking');
    expect(applied.undoable).toBe(true);
    expect(host.said).toContain('regenerated');

    await store.undo();

    const spent = store.card();

    expect(spent?.at).toBe('applied');
    if (spent?.at !== 'applied') return;
    expect(spent.undoable).toBe(false);
    expect((await currentWorkflow(project, 'groom_booking'))?.revision).toBe(
      groom.revision + 2,
    );
  });
});

/**
 * Approving writes TypeScript into the folder and
 * runs the compiler over it, which is the decision
 * workspace trust exists to make. The preview still
 * draws — reading files is not the thing trust
 * gates — but there is nothing to press.
 */
describe('an untrusted window', () => {
  it('draws the preview and offers nothing to do about it', async () => {
    const project = await makeProject();
    writeWorkflow(project, 'groom_booking');

    await propose(project, {
      name: 'groom_booking',
      spec: specOf({ ...groom, title: 'Groom booking, as proposed' }),
      baseRevision: groom.revision,
    });

    const store = previewStore(trustingHost([project]), fakeTrust(false));
    await store.reloadAll();

    expect(store.card()).toBeUndefined();
    expect(store.forWorkflow(project, 'groom_booking')).toBeDefined();
  });
});
