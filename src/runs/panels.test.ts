import { describe, expect, it } from 'vitest';

import { fakeWebview } from '../../test/doubles/webview.js';
import type { InspectorFocus } from '../inspector/focus.js';

import { RunsListView, SeePanel } from './panels.js';
import type { RunsStore } from './store.js';

/**
 * The run list's provider, as far as another view
 * reads it.
 *
 * Whether the mBoss container is on screen is read
 * off its panes, and the run list is one of them. A
 * pane nobody has opened yet has no frame to ask,
 * and one that was closed has none any more.
 */

const extensionUri = { path: '/ext' } as never;

const store = {
  list: () => undefined,
  onChanged: () => ({ dispose: () => undefined }),
  refresh: async () => undefined,
} as unknown as RunsStore;

describe('the run list', () => {
  it('shows nothing until resolved, then what its frame shows', () => {
    const frame = fakeWebview();
    const view = new RunsListView(extensionUri, store, {} as SeePanel);

    expect(view.visible()).toBe(false);

    view.resolveWebviewView(frame.panel);

    expect(view.visible()).toBe(true);

    frame.hide();

    expect(view.visible()).toBe(false);

    frame.show();
    frame.close();

    expect(view.visible()).toBe(false);
  });
});

/**
 * What the run list asks for, and which door each
 * request goes through.
 *
 * A row picked on the list is marked and opened
 * out, and nothing else happens; Open on canvas is
 * what opens the run, on its graph.
 */
describe('what the run list asks for', () => {
  function listening(): {
    calls: string[];
    frame: ReturnType<typeof fakeWebview>;
  } {
    const calls: string[] = [];
    const runs = {
      list: () => undefined,
      onChanged: () => ({ dispose: () => undefined }),
      refresh: async () => undefined,
      selectRow: (id: string) => void calls.push(`selectRow ${id}`),
      select: async (id: string) => void calls.push(`select ${id}`),
      showTab: (tab: string) => void calls.push(`showTab ${tab}`),
      replayRun: async (id: string, picked?: unknown) =>
        void calls.push(`replayRun ${id} ${JSON.stringify(picked)}`),
      learnConductor: async () => void calls.push('learnConductor'),
    } as unknown as RunsStore;
    const see = {
      open: async (id: string, tab?: string) =>
        void calls.push(`open ${id} ${tab}`),
      show: () => void calls.push('show'),
    } as unknown as SeePanel;
    const frame = fakeWebview();

    new RunsListView(extensionUri, runs, see).resolveWebviewView(frame.panel);

    return { calls, frame };
  }

  it('marks a row the list picked, and opens nothing', () => {
    const { calls, frame } = listening();

    frame.send({ type: 'runSelect', workflowId: 'wf_a' });

    expect(calls).toEqual(['selectRow wf_a']);
  });

  it('opens a run from Open on canvas once, on its graph', () => {
    const { calls, frame } = listening();

    frame.send({ type: 'openRun', workflowId: 'wf_b' });

    expect(calls).toEqual(['open wf_b graph']);
  });

  it('hands on which point of a run the list asked to replay from', () => {
    const { calls, frame } = listening();

    frame.send({ type: 'replayRun', workflowId: 'wf_c', functionId: 2 });
    frame.send({ type: 'replayRun', workflowId: 'wf_c', from: 'start' });
    frame.send({ type: 'replayRun', workflowId: 'wf_c' });

    expect(calls).toEqual([
      'replayRun wf_c {"functionId":2}',
      'replayRun wf_c {"from":"start"}',
      'replayRun wf_c undefined',
    ]);
  });

  it('opens where Conductor is documented', () => {
    const { calls, frame } = listening();

    frame.send({ type: 'learnConductor' });

    expect(calls).toEqual(['learnConductor']);
  });
});

/**
 * Opening a run in its tab, in the one order every
 * caller leans on: the run read, the view it
 * should be seen in, then the tab in front.
 */
describe('opening a run in its tab', () => {
  function opening(): { calls: string[]; panel: SeePanel } {
    const calls: string[] = [];
    const runs = {
      // Recorded once the read is done, so that an
      // order which did not wait for it shows.
      select: async (id: string) => {
        await Promise.resolve();
        calls.push(`select ${id}`);
      },
      showTab: (tab: string) => void calls.push(`showTab ${tab}`),
    } as unknown as RunsStore;

    // The real tab needs the editor's window, which
    // the unit tier does not have.
    class Shown extends SeePanel {
      override show(): void {
        calls.push('show');
      }
    }

    return {
      calls,
      panel: new Shown(extensionUri, runs, {} as InspectorFocus),
    };
  }

  it('reads the run, puts it on its graph, then shows the tab', async () => {
    const { calls, panel } = opening();

    await panel.open('wf_d', 'graph');

    expect(calls).toEqual(['select wf_d', 'showTab graph', 'show']);
  });

  it('leaves the view where it was when asked for none', async () => {
    const { calls, panel } = opening();

    await panel.open('wf_d');

    expect(calls).toEqual(['select wf_d', 'show']);
  });
});
