import type { Disposable } from 'vscode';

import { emitter } from '../emitter.js';

import type { CanvasSession } from './editor.js';

/**
 * Every canvas that is open, and a signal whenever
 * any of them moves.
 *
 * A registry handed to whoever needs it rather than
 * a static map inside the editor, for three
 * readers a static could not serve. A command runs
 * from the palette with no argument, and finds the
 * canvas in front of somebody here. The Inspector
 * draws a block from a canvas, and has to hear when
 * that canvas re-reads its file, follows a run or
 * finishes a scan — including while its own tab is
 * behind another, when the canvas draws nothing.
 * And an edit made from the Inspector against a
 * file no canvas has open yet has to wait for the
 * canvas it opens, which nothing can do on a map.
 *
 * Keyed by the file's path: a workflow opens in one
 * canvas at most, and a path is what the run tab
 * and the Inspector hold.
 */
export type CanvasSessions = {
  /**
   * Adds the canvas a panel is showing, wakes
   * anybody waiting for that file, and says so.
   *
   * The panel comes along because whether somebody
   * is looking at it is the platform's answer, read
   * when asked. The registration lets go of that
   * canvas only: a tab reopened on the same file may
   * register before the old one has gone.
   */
  register(path: string, session: CanvasSession, panel: Shown): Disposable;

  /** The canvas open on that file, if there is one. */
  forPath(path: string): CanvasSession | undefined;

  /** The canvas a person is looking at, if one is on
   *  screen. */
  active(): CanvasSession | undefined;

  /**
   * The canvas on that file, as soon as there is
   * one: at once when it is already open, and at the
   * moment it registers otherwise.
   */
  whenOpen(path: string): Promise<CanvasSession>;

  /**
   * Hears which canvas moved: a selection, a re-read,
   * a run it follows, a scan.
   *
   * The canvas travels with the signal, so a
   * follower drawing one canvas can tell its own
   * change from a tick on another without asking
   * every canvas again.
   */
  onChanged(listener: (session: CanvasSession) => void): Disposable;

  /** Says that canvas moved. */
  fire(session: CanvasSession): void;
};

/** The one fact about a panel the registry reads. */
type Shown = { readonly active: boolean };

type Registration = { session: CanvasSession; panel: Shown };

export function canvasSessions(): CanvasSessions {
  const open = new Map<string, Registration>();
  const waiting = new Map<string, ((session: CanvasSession) => void)[]>();
  const changes = emitter<CanvasSession>();

  return {
    register: (path, session, panel) => {
      const registration = { session, panel };
      open.set(path, registration);

      for (const wake of waiting.get(path) ?? []) wake(session);
      waiting.delete(path);

      changes.fire(session);

      return {
        dispose: () => {
          if (open.get(path) === registration) open.delete(path);
        },
      };
    },

    forPath: (path) => open.get(path)?.session,

    active: () => [...open.values()].find(({ panel }) => panel.active)?.session,

    whenOpen: (path) => {
      const session = open.get(path)?.session;
      if (session !== undefined) return Promise.resolve(session);

      return new Promise((wake) => {
        waiting.set(path, [...(waiting.get(path) ?? []), wake]);
      });
    },

    onChanged: (listener) => changes.on(listener),

    fire: (session) => changes.fire(session),
  };
}
