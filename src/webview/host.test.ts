import { describe, expect, it } from 'vitest';

import { fakeWebview } from '../../test/doubles/webview.js';
import { emitter } from '../emitter.js';
import { seeInit } from '../runs/view.js';

import {
  messageSchemaFor,
  mountWebview,
  type Heard,
  type Source,
} from './host.js';

/**
 * The one mount path, driven the way a provider
 * drives it.
 *
 * Four surfaces share this loop, and the bugs it
 * exists for are silent: a hidden frame repainted
 * for nothing, a listener left on a store after the
 * frame it fed was disposed, a message from another
 * view reaching a handler that never expected it.
 * Each is asked here once, against a fake frame,
 * rather than once per provider.
 */

const extensionUri = { path: '/ext' } as never;

function mounted(
  over: { follows?: Source[]; heard?: (message: Heard<'see'>) => void } = {},
) {
  const frame = fakeWebview();
  const mount = mountWebview(frame.panel, {
    extensionUri,
    view: 'see',
    title: 'See',
    init: () => seeInit(undefined),
    ...over,
  });

  return { frame, mount };
}

describe('a mounted webview', () => {
  it('answers ready with what to draw', () => {
    const { frame } = mounted();

    frame.send({ type: 'ready' });

    expect(frame.posted).toEqual([seeInit(undefined)]);
  });

  it('repaints while showing when something it follows changes', () => {
    const changes = emitter();
    const { frame } = mounted({ follows: [(repaint) => changes.on(repaint)] });

    changes.fire();

    expect(frame.posted).toEqual([seeInit(undefined)]);
  });

  /**
   * A hidden frame has no page to draw on: the
   * editor tears the page down and the view says
   * `ready` again when it is shown, which is when
   * the picture is sent.
   */
  it('leaves a hidden frame alone', () => {
    const changes = emitter();
    const { frame } = mounted({ follows: [(repaint) => changes.on(repaint)] });

    frame.hide();
    changes.fire();

    expect(frame.posted).toEqual([]);

    frame.show();
    changes.fire();

    expect(frame.posted).toHaveLength(1);
  });

  it('lets go of every source once the frame is gone', () => {
    const one = emitter();
    const two = emitter();
    const { frame } = mounted({
      follows: [(repaint) => one.on(repaint), (repaint) => two.on(repaint)],
    });

    frame.close();
    one.fire();
    two.fire();

    expect(frame.posted).toEqual([]);
  });

  it('hands its provider the repaint', () => {
    const { frame, mount } = mounted();

    mount.repaint();

    expect(frame.posted).toEqual([seeInit(undefined)]);
  });

  it('hears what its own view says, and nothing another view does', () => {
    const heard: Heard<'see'>[] = [];
    const { frame } = mounted({ heard: (message) => heard.push(message) });

    frame.send({ type: 'replay', functionId: 3 });
    frame.send({ type: 'stackUp' });
    frame.send('nonsense');

    expect(heard).toEqual([{ type: 'replay', functionId: 3 }]);
  });
});

describe('what each view may say', () => {
  it('always includes that it has mounted', () => {
    for (const view of ['canvas', 'sidebar', 'runs', 'see'] as const) {
      expect(messageSchemaFor(view).safeParse({ type: 'ready' }).success).toBe(
        true,
      );
    }
  });

  it('is a kind of its own', () => {
    expect(
      messageSchemaFor('runs').safeParse({ type: 'stackUp' }).success,
    ).toBe(true);
    expect(messageSchemaFor('see').safeParse({ type: 'stackUp' }).success).toBe(
      false,
    );
  });
});
