import { describe, expect, it } from 'vitest';

import { WorkflowIRSchema } from '../core/rules.js';
import {
  makeProject,
  readWorkflowFixture,
  writeWorkflow,
} from '../test-support/project.js';
import { propose, specOf } from '../test-support/proposals.js';

import { previewStore, type PreviewHost, type PreviewStore } from './store.js';

/**
 * An approval whose second or third step falls over.
 *
 * Approving is three things in a fixed order and
 * the first of them is the one that writes: the
 * proposal has become the document before either
 * regenerating or telling the agent can fail. Both
 * of them realistically can — the compiler takes
 * the project's write lock, and the agent is a
 * process that can die mid-turn — so what happens
 * next decides whether the folder and the panel
 * still agree.
 *
 * Nothing here is about the failure being rare. It
 * is about the state it leaves behind: a document
 * that changed, a card that never offered the Undo
 * that would take it back, and a store still
 * showing the proposal as outstanding when it is
 * already applied.
 */

const groom = WorkflowIRSchema.parse(
  JSON.parse(readWorkflowFixture('groom_booking')),
);

/** A project with the workflow in it, its handlers,
 *  and one proposal outstanding. */
async function projectWithProposal(): Promise<{
  project: string;
  id: string;
}> {
  const project = await makeProject({ lib: 'lib' });
  writeWorkflow(project, 'groom_booking');

  const proposal = await propose(project, {
    name: 'groom_booking',
    spec: specOf({ ...groom, title: 'Groom booking, as proposed' }),
    baseRevision: groom.revision,
  });

  return { project, id: proposal.id };
}

type Driven = {
  store: PreviewStore;

  /** Everything the person was told. */
  said: string[];
};

/** A store over one project, with `over` deciding
 *  which step of an approval fails. */
async function drive(
  project: string,
  over: Partial<PreviewHost>,
): Promise<Driven> {
  const said: string[] = [];
  const store = previewStore({
    folders: () => [project],
    isTrusted: () => true,
    regenerate: async () => {},
    notify: async () => {},
    say: (message) => said.push(message),
    ...over,
  });

  await store.reloadAll();

  return { store, said };
}

const failing = (why: string) => async (): Promise<void> => {
  throw new Error(why);
};

describe('an approval whose codegen throws', () => {
  it('says so rather than failing where nobody is looking', async () => {
    const { project, id } = await projectWithProposal();
    const driven = await drive(project, {
      regenerate: failing('the lock was held'),
    });

    await expect(driven.store.approve(id)).resolves.toBeUndefined();

    expect(driven.said.join(' ')).toContain('the lock was held');
  });

  /** The document changed, so the one thing that
   *  takes it back has to be on the card. */
  it('offers the Undo for what it did write', async () => {
    const { project, id } = await projectWithProposal();
    const driven = await drive(project, {
      regenerate: failing('the lock was held'),
    });

    await driven.store.approve(id);

    const card = driven.store.card();

    expect(card?.at).toBe('applied');
    expect(card?.at === 'applied' && card.undoable).toBe(true);
  });

  /** Read back off disk, so the panel cannot go on
   *  asking about a proposal that is already the
   *  document. */
  it('stops offering the proposal it already applied', async () => {
    const { project, id } = await projectWithProposal();
    const driven = await drive(project, {
      regenerate: failing('the lock was held'),
    });

    await driven.store.approve(id);

    expect(driven.store.forWorkflow(project, 'groom_booking')).toBeUndefined();
  });
});

describe('an approval the agent cannot be told about', () => {
  it('says so, and still offers the Undo', async () => {
    const { project, id } = await projectWithProposal();
    const driven = await drive(project, {
      notify: failing('the agent went away'),
    });

    await expect(driven.store.approve(id)).resolves.toBeUndefined();

    expect(driven.said.join(' ')).toContain('the agent went away');
    expect(driven.store.card()?.at).toBe('applied');
  });
});
