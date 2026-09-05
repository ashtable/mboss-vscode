import type { Disposable } from 'vscode';

import { emitter } from '../emitter.js';
import type { Trust } from '../trust.js';
import type { RunsInit } from '../webview/protocol.js';

import type { StackController, StackStatus } from './stack.js';

/**
 * The local stack, as the panel shows it.
 *
 * What compose says about the project's containers,
 * and which of the three commands is in the middle
 * of running. `stack.ts` beside this is what drives
 * compose; this is what the window holds about it
 * between one command and the next, and the fact
 * the view's title buttons swap on.
 *
 * Every command executes the folder's contents, so
 * an untrusted window asks nothing at all rather
 * than asking and ignoring the answer.
 */

/** The slice of the editor the zone needs. */
export type StackZoneHost = {
  projects(): string[];
  /** Publishes a fact `when` clauses can read, so
   *  the view's Start and Stop swap with what is
   *  running. */
  setContext(key: string, value: unknown): void;
};

export type StackZoneDeps = {
  host: StackZoneHost;
  trust: Trust;
  stack: StackController;
};

/** Which command the stack is in the middle of. */
export type StackAction = 'up' | 'down' | 'rebuild';

export type StackZone = Disposable & {
  /** What compose says now, read quietly: the
   *  panel is drawn again by whoever asked. */
  read(): Promise<void>;

  up(): Promise<void>;
  down(): Promise<void>;
  rebuild(): Promise<void>;

  render(): RunsInit['stack'];

  onChanged(listener: () => void): Disposable;
};

const NO_STACK: StackStatus = {
  available: false,
  services: [],
  detail: undefined,
};

/**
 * The fact the view's two title buttons swap on.
 *
 * Read from what compose says rather than from
 * what was last asked for: a stack somebody
 * started outside the editor is up, and a Start
 * button over it would do nothing visible.
 */
const STACK_UP_KEY = 'mboss.stackUp';

export function stackZone(deps: StackZoneDeps): StackZone {
  const changes = emitter();

  let stack: StackStatus = NO_STACK;
  let busy: StackAction | undefined;

  const changed = changes.fire;

  const project = (): string | undefined => deps.host.projects()[0];

  const read = async (): Promise<void> => {
    const dir = project();

    if (dir === undefined || !deps.trust.isTrusted()) {
      stack = NO_STACK;
      deps.host.setContext(STACK_UP_KEY, false);

      return;
    }

    stack = await deps.stack.status(dir);

    // Anything running is a stack there is
    // something to stop. A database that came up
    // while the app crashed is still a stack.
    deps.host.setContext(
      STACK_UP_KEY,
      stack.services.some((service) => service.state === 'running'),
    );
  };

  /**
   * One command against the stack, with the panel
   * saying which one is going.
   *
   * The status read afterwards is the point: `up`
   * answers when the containers are up, and what
   * the panel draws is what compose says about them
   * rather than the fact that a command returned.
   */
  const command = async (
    action: StackAction,
    run: (dir: string) => Promise<void>,
  ): Promise<void> => {
    const dir = project();
    if (dir === undefined || !deps.trust.isTrusted()) return;

    busy = action;
    changed();

    try {
      await run(dir);
    } finally {
      busy = undefined;
    }

    await read();
    changed();
  };

  return {
    read,
    up: () => command('up', (dir) => deps.stack.up(dir)),
    down: () => command('down', (dir) => deps.stack.down(dir)),
    rebuild: () => command('rebuild', (dir) => deps.stack.rebuild(dir)),

    render: () => ({
      available: stack.available,
      services: stack.services,
      busy,
      detail: stack.detail,
    }),

    onChanged: changes.on,
    dispose: () => changes.dispose(),
  };
}
