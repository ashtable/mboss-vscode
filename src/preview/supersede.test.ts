import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WorkflowIRSchema } from '../core/rules.js';
import {
  makeProject,
  readWorkflowFixture,
  writeWorkflow,
} from '../test-support/project.js';
import { propose, specOf } from '../test-support/proposals.js';

import { livePreviews } from './live.js';
import { previewStore, type PreviewHost } from './store.js';

/**
 * Which proposal is the live one.
 *
 * One workflow has at most one, and that is core's
 * invariant, not this extension's: proposing again
 * discards what came before, because a person can
 * only approve what they were shown and an agent
 * that proposes twice has changed its mind. So what
 * is checked here is that the extension reads that
 * rule rather than keeping an idea of its own — and
 * that it writes nothing while reading, which is
 * what makes Refine free. Refining is a person
 * going back to the chat box; the proposal stays
 * exactly where it was until the agent replaces it.
 */

const groom = WorkflowIRSchema.parse(
  JSON.parse(readWorkflowFixture('groom_booking')),
);

const approval = WorkflowIRSchema.parse(
  JSON.parse(readWorkflowFixture('approval_flow')),
);

/** Every proposal file in a project, by name and
 *  contents. */
function proposalsOnDisk(project: string): Record<string, string> {
  const dir = join(project, '.mboss', 'proposals');

  return Object.fromEntries(
    readdirSync(dir)
      .sort()
      .map((name) => [name, readFileSync(join(dir, name), 'utf8')]),
  );
}

async function projectWithWorkflow(): Promise<string> {
  const project = await makeProject();
  writeWorkflow(project, 'groom_booking');

  return project;
}

/**
 * Waits for the clock to move on.
 *
 * A proposal id leads with the millisecond it was
 * minted in, which is what puts a directory listing
 * in age order. Two minted inside one millisecond
 * are ordered by their random tails instead — never
 * a problem for an agent working at conversation
 * speed, and exactly the problem for a spec that
 * mints two in a row.
 */
async function nextMillisecond(): Promise<void> {
  const started = Date.now();

  while (Date.now() === started) await Promise.resolve();
}

describe('a second proposal for the same workflow', () => {
  it('is the only one left to preview', async () => {
    const project = await projectWithWorkflow();

    const first = await propose(project, {
      name: 'groom_booking',
      spec: specOf({ ...groom, title: 'First thought' }),
      baseRevision: groom.revision,
    });

    await nextMillisecond();

    const second = await propose(project, {
      name: 'groom_booking',
      spec: specOf({ ...groom, title: 'Second thought' }),
      baseRevision: groom.revision,
    });

    const live = await livePreviews(project);

    expect(live.map((preview) => preview.id)).toEqual([second.id]);
    expect(live[0]?.candidate.title).toBe('Second thought');
    expect(first.id).not.toBe(second.id);
  });
});

describe('a proposal on each of two workflows', () => {
  it('previews each over its own graph, and offers the newest', async () => {
    const project = await projectWithWorkflow();
    writeWorkflow(project, 'approval_flow');

    await propose(project, {
      name: 'groom_booking',
      spec: specOf({ ...groom, title: 'Booking, rethought' }),
      baseRevision: groom.revision,
    });

    await nextMillisecond();

    const newest = await propose(project, {
      name: 'approval_flow',
      spec: specOf({ ...approval, title: 'Approvals, rethought' }),
      baseRevision: approval.revision,
    });

    const store = previewStore(quietHost([project]));
    await store.reloadAll();

    expect(store.forWorkflow(project, 'groom_booking')?.candidate.title).toBe(
      'Booking, rethought',
    );
    expect(store.forWorkflow(project, 'approval_flow')?.candidate.title).toBe(
      'Approvals, rethought',
    );

    const card = store.card();

    expect(card?.at).toBe('proposal');
    if (card?.at !== 'proposal') return;
    expect(card.model.id).toBe(newest.id);
  });
});

/**
 * Refine is a person putting the cursor back in the
 * chat box: nothing to write, nothing to record. So
 * the thing worth asserting is the other half —
 * that reading proposals in order to draw them
 * leaves every one of them exactly as it was found,
 * and the only write this extension makes to a
 * proposal is the one an approval makes.
 */
describe('drawing a preview', () => {
  it('leaves every proposal exactly as it found it', async () => {
    const project = await projectWithWorkflow();

    await propose(project, {
      name: 'groom_booking',
      spec: specOf({ ...groom, title: 'Untouched' }),
      baseRevision: groom.revision,
    });

    const before = proposalsOnDisk(project);

    const store = previewStore(quietHost([project]));
    await store.reloadAll();
    store.card();
    await livePreviews(project);

    expect(proposalsOnDisk(project)).toEqual(before);
  });
});

describe('a project with nothing outstanding', () => {
  it('has nothing to offer and nothing to draw', async () => {
    const project = await projectWithWorkflow();

    const store = previewStore(quietHost([project]));
    await store.reloadAll();

    expect(store.card()).toBeUndefined();
    expect(store.forWorkflow(project, 'groom_booking')).toBeUndefined();
  });
});

/** A host that trusts the folder and does nothing
 *  else — these specs never approve. */
function quietHost(folders: string[]): PreviewHost {
  return {
    folders: () => folders,
    isTrusted: () => true,
    regenerate: async () => [],
    notify: async () => {},
    note: () => {},
    say: () => {},
  };
}
