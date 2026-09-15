import { describe, expect, it } from 'vitest';

import { fakeWebview } from '../../test/doubles/webview.js';
import type { CanvasSession, SubjectInputs } from '../canvas/editor.js';
import { canvasSessions } from '../canvas/sessions.js';
import { inspectorWords } from '../canvas/words.js';
import type { InspectorInit } from '../webview/protocol.js';

import { inspectorFocus } from './focus.js';
import { InspectorView } from './view.js';

/**
 * The Inspector's provider, driven the way a
 * mounted frame drives it.
 *
 * What it draws is worked out in `subject.ts`.
 * What is asked here is what it follows: which
 * surface is in front, and that surface moving —
 * and that a surface it is not about moving leaves
 * the person in the Inspector alone.
 */

const extensionUri = { path: '/ext' } as never;

/** A canvas session answering only what the
 *  Inspector reads of one. */
function session(file: string): CanvasSession {
  const inputs = { file, selected: undefined } as SubjectInputs;

  return { subjectInputs: () => inputs } as unknown as CanvasSession;
}

function mounted() {
  const frame = fakeWebview();
  const focus = inspectorFocus();
  const sessions = canvasSessions();

  new InspectorView(extensionUri, focus, sessions, {
    detail: () => undefined,
  }).resolveWebviewView(frame.panel);

  const subjects = () =>
    (frame.posted as InspectorInit[]).map((init) => init.subject);

  return { frame, focus, sessions, subjects };
}

describe('the Inspector view', () => {
  it('answers ready with what to draw', () => {
    const { frame } = mounted();

    frame.send({ type: 'ready' });

    expect(frame.posted).toEqual([
      {
        type: 'init',
        view: 'inspector',
        strings: inspectorWords(),
        subject: { at: 'none', file: undefined },
      },
    ]);
  });

  it('draws again when focus moves', () => {
    const { focus, subjects } = mounted();
    const canvas = session('groom_booking.workflow.json');

    focus.report({ at: 'canvas', session: canvas });
    focus.report({ at: 'run' });

    expect(subjects()).toEqual([
      { at: 'none', file: 'groom_booking.workflow.json' },
      { at: 'none', file: undefined },
    ]);
  });

  it('draws again when the canvas it is about moves, and for no other', () => {
    const { focus, sessions, subjects } = mounted();
    const front = session('groom_booking.workflow.json');
    const behind = session('refund_approval.workflow.json');

    focus.report({ at: 'canvas', session: front });
    sessions.fire(behind);

    expect(subjects()).toHaveLength(1);

    sessions.fire(front);

    expect(subjects()).toEqual([
      { at: 'none', file: 'groom_booking.workflow.json' },
      { at: 'none', file: 'groom_booking.workflow.json' },
    ]);
  });
});
