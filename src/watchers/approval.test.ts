import { describe, expect, it } from 'vitest';

import { fakeTrust } from '../../test/doubles/trust.js';
import { fakeHost } from '../../test/doubles/watchHost.js';
import { WorkflowIRSchema } from '../core/rules.js';
import { previewStore } from '../preview/store.js';
import type { StatusBar } from '../statusBar.js';
import {
  makeProject,
  readWorkflowFixture,
  writeWorkflow,
} from '../test-support/project.js';
import { propose, specOf } from '../test-support/proposals.js';

import { WORKFLOW_GLOB, watchProjects } from './index.js';

/**
 * What an approval costs the watchers.
 *
 * Approving a proposal writes the workflow document
 * and then asks for the project to be generated,
 * once, in that order. The document it wrote is also
 * a file event, and the watchers answer file events
 * by generating — so unless the write is recognised
 * as the extension's own, the one approval is two
 * generations, two publishes of the same problems
 * and two turns of the project's write lock.
 */

const groom = WorkflowIRSchema.parse(
  JSON.parse(readWorkflowFixture('groom_booking')),
);

function reporter(): StatusBar & { finished: number[] } {
  const finished: number[] = [];

  return {
    finished,
    codegenFinished: (ms) => void finished.push(ms),
    codegenNeedsTrust: () => {},
    dispose: () => {},
  };
}

const settle = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('an approval, as the watchers see it', () => {
  it('costs one generation', async () => {
    const project = await makeProject({ lib: 'lib' });
    const document = writeWorkflow(project, 'groom_booking');
    const proposal = await propose(project, {
      name: 'groom_booking',
      spec: specOf({ ...groom, title: 'Groom booking, as proposed' }),
      baseRevision: groom.revision,
    });

    const host = fakeHost({ folders: [project] });
    const status = reporter();
    const watchers = watchProjects(host, fakeTrust(), status, {
      debounceMs: 5,
    });

    const store = previewStore(
      {
        folders: () => [project],
        regenerate: async () => {
          const run = await watchers.generateNow();

          return run.ran ? run.problems : [];
        },
        notify: async () => {},
        note: () => {},
        say: () => {},
      },
      fakeTrust(),
    );
    await store.reloadAll();

    await store.approve(proposal.id);

    // The editor's watcher reports the document the
    // approval wrote, the same as it would a hand
    // edit.
    host.fire(WORKFLOW_GLOB, document);
    await settle(400);

    expect(status.finished).toHaveLength(1);

    watchers.dispose();
    store.dispose();
  });

  it('costs one generation to undo, too', async () => {
    const project = await makeProject({ lib: 'lib' });
    const document = writeWorkflow(project, 'groom_booking');
    const proposal = await propose(project, {
      name: 'groom_booking',
      spec: specOf({ ...groom, title: 'Groom booking, as proposed' }),
      baseRevision: groom.revision,
    });

    const host = fakeHost({ folders: [project] });
    const status = reporter();
    const watchers = watchProjects(host, fakeTrust(), status, {
      debounceMs: 5,
    });

    const store = previewStore(
      {
        folders: () => [project],
        regenerate: async () => {
          const run = await watchers.generateNow();

          return run.ran ? run.problems : [];
        },
        notify: async () => {},
        note: () => {},
        say: () => {},
      },
      fakeTrust(),
    );
    await store.reloadAll();
    await store.approve(proposal.id);
    host.fire(WORKFLOW_GLOB, document);
    await settle(400);
    const afterApproval = status.finished.length;

    await store.undo();
    host.fire(WORKFLOW_GLOB, document);
    await settle(400);

    expect(status.finished.length - afterApproval).toBe(1);

    watchers.dispose();
    store.dispose();
  });
});
