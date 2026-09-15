import { describe, expect, it } from 'vitest';

import { fakeWebview } from '../../test/doubles/webview.js';

import { pointIn, RunsListView, type SeePanel } from './panels.js';
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
 * Where a replay starts, as a message names it.
 * The run tab and the Inspector both read it this
 * way, so a replay from the start means the same
 * thing wherever it was asked for.
 */
describe('the point a replay message names', () => {
  it('reads a replay from the start before a row or a block', () => {
    expect(pointIn({ from: 'start', functionId: 3, nodeId: 'a' })).toEqual({
      from: 'start',
    });
    expect(pointIn({ functionId: 3, nodeId: 'a' })).toEqual({
      functionId: 3,
    });
    expect(pointIn({ nodeId: 'a' })).toEqual({ nodeId: 'a' });
    expect(pointIn({})).toBeUndefined();
  });
});
