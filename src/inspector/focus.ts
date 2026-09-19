import type { Disposable } from 'vscode';

import type { CanvasSession } from '../canvas/editor.js';
import { emitter } from '../emitter.js';

/**
 * Which surface the Inspector is about: the canvas
 * or the run tab somebody last brought to the
 * front.
 *
 * The last one, not the one in front now. Clicking
 * into the Inspector to edit a field, or into a
 * text editor beside the canvas, takes the front
 * from both, and the Inspector must not go blank
 * under the person editing it. So only a canvas or
 * the run tab coming forward moves it.
 *
 * VS Code says a panel's view state changed only
 * when it did, and every panel is born in front.
 * A canvas that opens focused, and every run tab,
 * never hear the event, so a panel is read once
 * when it is followed and heard after that. The
 * surfaces are kept in the order they last came
 * forward, so closing the one in front hands the
 * Inspector to the one looked at before it.
 */
export type InspectorFocus = {
  /** The surface last brought forward that is
   *  still open, if any. */
  holder(): Surface | undefined;

  /**
   * Says a surface came forward. The holder saying
   * so again changes nothing and fires nothing: a
   * redraw for it would reset whatever the person
   * is doing in the Inspector.
   */
  report(surface: Surface): void;

  /** Forgets a surface that closed. Only a holder
   *  leaving changes the answer. */
  drop(surface: Surface): void;

  /**
   * Follows the panel showing a surface: holds it at
   * once if the panel is already in front, whenever
   * it comes forward afterwards, and forgets it when
   * let go of.
   *
   * One rule for the canvas and the run tab, written
   * once, because the half of it that reads the
   * panel before any event is the half nobody would
   * guess.
   */
  follow(surface: Surface, panel: Watched): Disposable;

  /** Hears the holder change. */
  onChanged(listener: () => void): Disposable;
};

/**
 * A surface the Inspector can be about.
 *
 * A canvas is its session, since two tabs never
 * show one file. There is one run tab, so it needs
 * no name.
 */
export type Surface =
  | { readonly at: 'canvas'; readonly session: CanvasSession }
  | { readonly at: 'run' };

/** A panel, as far as focus reads one. */
type Watched = {
  readonly active: boolean;
  onDidChangeViewState(listener: () => void): Disposable;
};

/** One holder for the whole window, because the
 *  pane follows the surface last brought forward
 *  rather than the one with the keyboard. */
export function inspectorFocus(): InspectorFocus {
  // The surface last brought forward first.
  let recent: Surface[] = [];
  const changes = emitter();

  const report = (surface: Surface): void => {
    const holder = recent[0];
    if (holder !== undefined && same(holder, surface)) return;

    recent = [surface, ...recent.filter((one) => !same(one, surface))];
    changes.fire();
  };

  const drop = (surface: Surface): void => {
    const holder = recent[0];

    recent = recent.filter((one) => !same(one, surface));

    if (holder !== undefined && same(holder, surface)) changes.fire();
  };

  return {
    holder: () => recent[0],

    report,

    drop,

    follow: (surface, panel) => {
      if (panel.active) report(surface);

      // A panel going to the back fires too, and
      // changes nothing: whatever took the front is
      // either another surface, which says so
      // itself, or something the Inspector is not
      // about.
      const heard = panel.onDidChangeViewState(() => {
        if (panel.active) report(surface);
      });

      return {
        dispose: () => {
          heard.dispose();
          drop(surface);
        },
      };
    },

    onChanged: (listener) => changes.on(listener),
  };
}

function same(one: Surface, other: Surface): boolean {
  if (one.at === 'canvas' && other.at === 'canvas') {
    return one.session === other.session;
  }

  return one.at === other.at;
}
