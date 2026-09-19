import { describe, expect, it } from 'vitest';

import { fakeWebview } from '../../test/doubles/webview.js';
import type { CanvasSession } from '../canvas/editor.js';

import { inspectorFocus, type InspectorFocus, type Surface } from './focus.js';

/**
 * Which surface the Inspector is about, as the
 * panels showing them report it.
 *
 * The holder never calls a session, so a session
 * here is only something with an identity. The
 * panels are the webview double, which says its
 * view state changed only when it did — the way
 * VS Code does, and the reason a panel that opens
 * in front hears nothing at all.
 */

/** A canvas surface over a session nothing asks
 *  anything of. */
function aCanvas(): Surface & { at: 'canvas' } {
  return { at: 'canvas', session: {} as CanvasSession };
}

const RUN_TAB: Surface = { at: 'run' };

/** A holder, and a count of the times it said its
 *  holder changed. */
function holding(): { focus: InspectorFocus; changes: () => number } {
  const focus = inspectorFocus();
  let changes = 0;

  focus.onChanged(() => {
    changes += 1;
  });

  return { focus, changes: () => changes };
}

describe('which surface the Inspector is about', () => {
  it('holds a canvas that opened focused, with no event', () => {
    const { focus } = holding();
    const canvas = aCanvas();

    focus.follow(canvas, fakeWebview({ active: true }).panel);

    expect(focus.holder()).toBe(canvas);
  });

  it('holds no canvas that opened behind, until it comes forward', () => {
    const { focus } = holding();
    const canvas = aCanvas();
    const frame = fakeWebview();

    focus.follow(canvas, frame.panel);

    expect(focus.holder()).toBeUndefined();

    frame.focus();

    expect(focus.holder()).toBe(canvas);
  });

  it('fires nothing when the holder reports again', () => {
    const { focus, changes } = holding();
    const canvas = aCanvas();
    const frame = fakeWebview({ active: true });

    focus.follow(canvas, frame.panel);

    expect(changes()).toBe(1);

    // The same canvas is its session, whichever
    // object names it.
    focus.report({ at: 'canvas', session: canvas.session });
    frame.blur();
    frame.focus();

    expect(changes()).toBe(1);
    expect(focus.holder()).toBe(canvas);

    focus.report(RUN_TAB);
    focus.report({ at: 'run' });

    expect(changes()).toBe(2);
  });

  /**
   * Clicking into the Inspector to edit a field, or
   * into a text editor beside the canvas, takes the
   * front from the canvas. The Inspector has to
   * keep drawing the block being edited.
   */
  it('keeps its holder when something else takes the front', () => {
    const { focus, changes } = holding();
    const canvas = aCanvas();
    const frame = fakeWebview({ active: true });

    focus.follow(canvas, frame.panel);
    frame.blur();
    frame.hide();

    expect(focus.holder()).toBe(canvas);
    expect(changes()).toBe(1);
  });

  it('falls back to the other surface as the holder closes, then none', () => {
    const { focus, changes } = holding();
    const canvas = aCanvas();

    focus.report(canvas);
    focus.report(RUN_TAB);

    expect(focus.holder()).toBe(RUN_TAB);
    expect(changes()).toBe(2);

    focus.drop(RUN_TAB);

    expect(focus.holder()).toBe(canvas);
    expect(changes()).toBe(3);

    focus.drop(canvas);

    expect(focus.holder()).toBeUndefined();
    expect(changes()).toBe(4);
  });

  it('falls back to whichever of the rest had focus last', () => {
    const first = aCanvas();
    const second = aCanvas();

    // Not the surface that opened first.
    const earliest = inspectorFocus();
    earliest.report(first);
    earliest.report(RUN_TAB);
    earliest.report(second);
    earliest.report(first);
    earliest.drop(first);

    expect(earliest.holder()).toBe(second);

    // Nor the one that opened last.
    const latest = inspectorFocus();
    latest.report(first);
    latest.report(second);
    latest.report(first);
    latest.report(RUN_TAB);
    latest.drop(RUN_TAB);

    expect(latest.holder()).toBe(first);
  });

  it('says nothing when a surface behind the holder closes', () => {
    const { focus, changes } = holding();
    const canvas = aCanvas();

    focus.report(canvas);
    focus.report(RUN_TAB);
    focus.drop(canvas);

    expect(focus.holder()).toBe(RUN_TAB);
    expect(changes()).toBe(2);

    focus.drop(RUN_TAB);

    expect(focus.holder()).toBeUndefined();
  });

  /** A panel is let go of when it closes, and a
   *  closed canvas is nothing to be about. */
  it('forgets a panel it has let go of', () => {
    const { focus } = holding();
    const canvas = aCanvas();
    const frame = fakeWebview({ active: true });

    const followed = focus.follow(canvas, frame.panel);
    followed.dispose();

    expect(focus.holder()).toBeUndefined();

    frame.blur();
    frame.focus();

    expect(focus.holder()).toBeUndefined();
  });

  it('stops telling a follower that has let go', () => {
    const focus = inspectorFocus();
    let heard = 0;

    focus
      .onChanged(() => {
        heard += 1;
      })
      .dispose();
    focus.report(RUN_TAB);

    expect(heard).toBe(0);
    expect(focus.holder()).toBe(RUN_TAB);
  });
});
