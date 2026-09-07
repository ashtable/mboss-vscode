import { describe, expect, it } from 'vitest';

import { fakeTrust } from '../../test/doubles/trust.js';
import {
  RUNNING,
  STOPPED,
  host,
  project,
  stack,
} from '../test-support/runs.js';

import type { StackStatus } from './stack.js';
import { stackZone, type Stack, type StackZoneDeps } from './stackZone.js';

/**
 * The local stack, as the panel shows it, driven
 * against a compose controller that only remembers
 * what it was asked.
 */

/** Long before any of these specs ran. */
const LONG_AGO = Date.parse('2020-01-01T00:00:00Z');

const MINUTE = 60 * 1000;

/** An app container compose says was made at one
 *  moment. */
function built(at: number): StackStatus {
  return {
    available: true,
    services: [
      {
        service: 'app',
        state: 'running',
        health: 'healthy',
        detail: 'built 12 s ago · :3000',
        builtAt: at,
      },
    ],
    detail: undefined,
  };
}

function zone(over: Partial<StackZoneDeps> = {}): Stack {
  return stackZone({
    host: host({ projects: () => [project()] }),
    trust: fakeTrust(),
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
      host: host({ projects: () => [project()] }),
      trust: fakeTrust(false),
      stack: compose.controller,
    });

    await shown.up();

    expect(compose.calls).toEqual([]);
  });

  it('has no built time before anything has been read', () => {
    expect(zone().builtAt()).toBeUndefined();
  });

  /**
   * Compose does not recreate a container for an
   * image that came out byte-identical, so a
   * rebuild that produced no new layers leaves an
   * old container behind and the code that is
   * running is still current. The other way round
   * is the ordinary build: it began, it took a
   * minute, and the container it made is newer
   * than the moment it started.
   */
  it('takes the later of the image and the command it just ran', async () => {
    const compose = stack(built(LONG_AGO));
    const shown = zone({ stack: compose.controller });

    const before = Date.now();
    await shown.rebuild();
    const after = Date.now();

    expect(shown.builtAt()).toBeGreaterThanOrEqual(before);
    expect(shown.builtAt()).toBeLessThanOrEqual(after);

    compose.status = built(after + MINUTE);
    await shown.read();

    expect(shown.builtAt()).toBe(after + MINUTE);
  });

  /** A stop makes no container, and dating the
   *  running code from the moment somebody stopped
   *  it would call a stale image current. */
  it('does not date the code from a stop', async () => {
    const compose = stack(built(LONG_AGO));
    const shown = zone({ stack: compose.controller });

    await shown.down();

    expect(shown.builtAt()).toBe(LONG_AGO);
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
