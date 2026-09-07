import { describe, expect, it } from 'vitest';

import { fakeWebview } from '../../test/doubles/webview.js';
import type { AgentPanel } from '../acp/agent.js';
import type { PreviewStore } from '../preview/store.js';

import { AgentSidebarView } from './view.js';

/**
 * The agent panel's provider, driven the way a
 * mounted frame drives it.
 *
 * Nothing here is about what the panel draws —
 * that is asked where the bundle is. What is asked
 * here is the one thing the provider decides: which
 * collaborator each message reaches, and in
 * particular that a row in the transcript naming a
 * run can reach a run page at all. The view is
 * handed that door rather than reaching for one,
 * because the sidebar has no other way to a run.
 */

const extensionUri = { path: '/ext' } as never;

/** The panel and the proposals, answering only what
 *  resolving a view asks of them. */
const nothing = { dispose: () => undefined };

const panel = {
  onChanged: () => nothing,
} as unknown as AgentPanel;

const preview = {
  onChanged: () => nothing,
} as unknown as PreviewStore;

describe('the agent sidebar', () => {
  it('opens the run a transcript row names', () => {
    const opened: string[] = [];
    const frame = fakeWebview();

    new AgentSidebarView(
      extensionUri,
      panel,
      async () => undefined,
      preview,
      async (workflowId) => void opened.push(workflowId),
    ).resolveWebviewView(frame.panel);

    frame.send({ type: 'openRun', workflowId: 'wf_c9d2f3' });

    expect(opened).toEqual(['wf_c9d2f3']);
  });
});
