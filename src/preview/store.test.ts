import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { TranscriptEntry } from '../acp/transcript.js';
import { WorkflowIRSchema } from '../core/rules.js';
import { messages } from '../messages.js';
import type { Problem } from '../problem.js';
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

  /** Everything written into the agent's
   *  transcript. */
  noted: TranscriptEntry[];
};

/** A store over one project, with `over` deciding
 *  which step of an approval fails. */
async function drive(
  project: string,
  over: Partial<PreviewHost>,
): Promise<Driven> {
  const said: string[] = [];
  const noted: TranscriptEntry[] = [];
  const store = previewStore({
    folders: () => [project],
    isTrusted: () => true,
    regenerate: async () => [],
    notify: async () => {},
    note: (entry) => noted.push(entry),
    say: (message) => said.push(message),
    ...over,
  });

  await store.reloadAll();

  return { store, said, noted };
}

const failing = (why: string) => async (): Promise<never> => {
  throw new Error(why);
};

/** One finding, as regenerating hands it over. */
function found(file: string, over: Partial<Problem> = {}): Problem {
  return {
    file,
    message: 'Open at requested time? names no handler.',
    severity: 'error',
    code: 'V07',
    ...over,
  };
}

/** The document the proposal was about. */
function documentIn(project: string): string {
  return join(project, '.mboss', 'workflows', 'groom_booking.workflow.json');
}

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

/**
 * What the transcript says mBoss did.
 *
 * The agent's rows and the extension's own sit in
 * one column, because that is the order they
 * happened in, and the only thing telling them
 * apart is who did it. Without a row of its own an
 * approval leaves the column reading as though the
 * agent had applied its own proposal — which is
 * the one thing this product exists to keep
 * separate.
 */
describe('an approval that lands', () => {
  it('writes a row for what the person did', async () => {
    const { project, id } = await projectWithProposal();
    const driven = await drive(project, {});

    await driven.store.approve(id);

    expect(driven.noted).toEqual([
      expect.objectContaining({
        at: 'tool',
        by: 'person',
        status: 'applied',
        verb: messages.previewApplyVerb(),
        target: 'groom_booking',
      }),
    ]);
  });

  /**
   * The column is in the order things happened,
   * and telling the agent runs a whole turn into
   * it. A row written after that would say the
   * approval came after everything it set going.
   */
  it('writes what it did as it does it', async () => {
    const { project, id } = await projectWithProposal();
    const order: string[] = [];
    const driven = await drive(project, {
      regenerate: async () => {
        order.push('regenerated');

        return [found(documentIn(project))];
      },
      notify: async () => void order.push('told the agent'),
      note: (entry) => order.push(entry.at),
    });

    await driven.store.approve(id);

    expect(order).toEqual([
      'tool',
      'regenerated',
      'diagnostic',
      'told the agent',
    ]);
  });
});

/**
 * What regenerating found in what was just
 * applied.
 *
 * Not a refusal — the document changed — and not
 * the incomplete-approval notification either:
 * that one says a step of the approval never ran,
 * and this is the step running and reporting. It
 * is also the one failure the agent can be handed
 * back, so it goes in the transcript with the
 * sentence that would ask it to.
 */
describe('an approval whose regeneration reports errors', () => {
  it('notes them as one diagnostic the agent can be asked to fix', async () => {
    const { project, id } = await projectWithProposal();
    const problem = found(documentIn(project));
    const driven = await drive(project, {
      regenerate: async () => [problem],
    });

    await driven.store.approve(id);

    const diagnostic = driven.noted.find((entry) => entry.at === 'diagnostic');

    expect(diagnostic?.at === 'diagnostic' && diagnostic.source).toBe(
      'codegen',
    );
    expect(diagnostic?.at === 'diagnostic' && diagnostic.rows).toEqual([
      { code: problem.code, message: problem.message },
    ]);
    expect(diagnostic?.at === 'diagnostic' && diagnostic.fix?.prompt).toContain(
      problem.message,
    );
  });

  /** A warning is what is left to do, not what
   *  went wrong, and the approval has already told
   *  the agent to get on with it. */
  it('leaves a warning where warnings go', async () => {
    const { project, id } = await projectWithProposal();
    const driven = await drive(project, {
      regenerate: async () => [
        found(documentIn(project), { severity: 'warning' }),
      ],
    });

    await driven.store.approve(id);

    expect(driven.noted.filter((entry) => entry.at === 'diagnostic')).toEqual(
      [],
    );
  });

  /** Regenerating covers every folder in the
   *  window. Only one of them was approved into. */
  it('says nothing about another folder’s errors', async () => {
    const { project, id } = await projectWithProposal();
    const driven = await drive(project, {
      regenerate: async () => [found('/elsewhere/lib/handlers.ts')],
    });

    await driven.store.approve(id);

    expect(driven.noted.filter((entry) => entry.at === 'diagnostic')).toEqual(
      [],
    );
  });

  /** A regeneration that threw never reported
   *  anything to make rows out of. */
  it('leaves a regeneration that threw to the notification', async () => {
    const { project, id } = await projectWithProposal();
    const driven = await drive(project, {
      regenerate: failing('the lock was held'),
    });

    await driven.store.approve(id);

    expect(driven.noted.filter((entry) => entry.at === 'diagnostic')).toEqual(
      [],
    );
    expect(driven.said.join(' ')).toContain('the lock was held');
  });
});
