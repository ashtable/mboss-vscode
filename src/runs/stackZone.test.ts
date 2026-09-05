import { describe, expect, it } from 'vitest';

import {
  RUNNING,
  STOPPED,
  host,
  project,
  stack,
} from '../test-support/runs.js';

import { stackZone, type StackZone, type StackZoneDeps } from './stackZone.js';

/**
 * The local stack, as the panel shows it, driven
 * against a compose controller that only remembers
 * what it was asked.
 */

function zone(over: Partial<StackZoneDeps> = {}): StackZone {
  return stackZone({
    host: host({ projects: () => [project()] }),
    stack: stack().controller,
    ...over,
  });
}

describe('the local stack', () => {
  it('brings it up, takes it down, and rebuilds the app alone', async () => {
    const dir = project();
    const compose = stack();
    const shown = zone({
      host: host({ projects: () => [dir] }),
      stack: compose.controller,
    });

    await shown.up();
    await shown.down();
    await shown.rebuild();

    expect(compose.calls.filter((call) => !call.startsWith('status'))).toEqual([
      `up ${dir}`,
      `down ${dir}`,
      `rebuild ${dir}`,
    ]);
  });

  it('reads what is running after every command', async () => {
    const compose = stack();
    const shown = zone({ stack: compose.controller });

    await shown.up();

    expect(shown.render().services.map((row) => row.service)).toEqual([
      'postgres',
      'app',
    ]);
    expect(shown.render().busy).toBeUndefined();
  });

  it('says which command is going while it goes', async () => {
    const seen: (string | undefined)[] = [];
    const shown = zone();

    shown.onChanged(() => seen.push(shown.render().busy));
    await shown.rebuild();

    expect(seen).toEqual(['rebuild', undefined]);
  });

  /**
   * The view's Start and Stop buttons swap on this
   * key, so it has to follow what compose says
   * rather than what was last asked for.
   */
  it('publishes whether anything is running', async () => {
    const published: { key: string; value: unknown }[] = [];
    const compose = stack(STOPPED);
    const shown = zone({
      host: host({
        projects: () => [project()],
        setContext: (key, value) => published.push({ key, value }),
      }),
      stack: compose.controller,
    });

    await shown.read();
    expect(published.at(-1)).toEqual({ key: 'mboss.stackUp', value: false });

    compose.status = RUNNING;
    await shown.read();
    expect(published.at(-1)).toEqual({ key: 'mboss.stackUp', value: true });
  });

  /** Every one of these executes the folder's
   *  contents. */
  it('runs no command in a window nobody has trusted', async () => {
    const compose = stack();
    const shown = zone({
      host: host({ projects: () => [project()], isTrusted: () => false }),
      stack: compose.controller,
    });

    await shown.up();

    expect(compose.calls).toEqual([]);
  });

  it('says why nothing can run, when nothing can', async () => {
    const compose = stack({
      available: false,
      services: [],
      detail: 'Docker is not on the PATH',
    });
    const shown = zone({ stack: compose.controller });

    await shown.read();

    expect(shown.render().available).toBe(false);
    expect(shown.render().detail).toContain('Docker');
  });
});
