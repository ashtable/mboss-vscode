import { afterEach, describe, expect, it } from 'vitest';

import { Debouncer } from './debounce.js';

/**
 * The one thing standing between a burst of file
 * events and a burst of compiles.
 *
 * Nothing in the editor's watcher API coalesces
 * anything: a `git checkout`, a formatter touching
 * every file, or an agent applying four proposals
 * in a row each arrive as a separate event, and
 * each one would otherwise start its own run of a
 * job that takes seconds and takes a lock. What is
 * checked here is that a burst costs one run, that
 * a run started while another was going still
 * happens, and that two projects never wait on each
 * other.
 */

/** Short enough that a spec is not slow, long
 *  enough that a burst lands inside it. */
const WAIT = 10;

let debouncer: Debouncer | undefined;

function debouncing(): Debouncer {
  debouncer = new Debouncer(WAIT);

  return debouncer;
}

afterEach(() => {
  debouncer?.dispose();
  debouncer = undefined;
});

/** Waits for something to become true rather than
 *  for a length of time. */
async function until(ready: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !ready(); tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, WAIT));
  }

  expect(ready()).toBe(true);
}

/**
 * Long enough for anything the debouncer still
 * intended to do. Only used to assert that nothing
 * more happens, which is the one claim a poll
 * cannot make.
 */
async function quiet(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, WAIT * 10));
}

describe('a burst of events', () => {
  it('costs one run', async () => {
    const debouncer = debouncing();
    let runs = 0;

    for (let event = 0; event < 5; event += 1) {
      debouncer.schedule('project', async () => void (runs += 1));
    }

    await until(() => runs > 0);
    await quiet();

    expect(runs).toBe(1);
  });
});

describe('events spaced further apart than the window', () => {
  it('cost one run each', async () => {
    const debouncer = debouncing();
    let runs = 0;
    const count = async (): Promise<void> => void (runs += 1);

    debouncer.schedule('project', count);
    await until(() => runs === 1);

    debouncer.schedule('project', count);
    await until(() => runs === 2);

    expect(runs).toBe(2);
  });
});

describe('an event arriving while a run is going', () => {
  /**
   * Codegen takes seconds, and a save during one is
   * ordinary. Dropping it would leave the generated
   * code a version behind with nothing on screen to
   * say so.
   */
  it('is not dropped', async () => {
    const debouncer = debouncing();
    const started: number[] = [];
    let release = (): void => {};
    const held = new Promise<void>((resolve) => (release = resolve));

    debouncer.schedule('project', async () => {
      started.push(1);
      await held;
    });

    await until(() => started.length === 1);
    debouncer.schedule('project', async () => void started.push(2));
    release();

    await until(() => started.length === 2);
    await quiet();

    expect(started).toHaveLength(2);
  });

  /** ...and neither is it run twice because three
   *  more events arrived while it was going. */
  it('costs one further run however many arrive', async () => {
    const debouncer = debouncing();
    let runs = 0;
    let release = (): void => {};
    const held = new Promise<void>((resolve) => (release = resolve));

    debouncer.schedule('project', async () => {
      runs += 1;
      await held;
    });
    await until(() => runs === 1);

    for (let event = 0; event < 4; event += 1) {
      debouncer.schedule('project', async () => void (runs += 1));
    }
    release();

    await until(() => runs === 2);
    await quiet();

    expect(runs).toBe(2);
  });
});

describe('two projects', () => {
  it('do not wait on each other', async () => {
    const debouncer = debouncing();
    const ran: string[] = [];

    debouncer.schedule('one', async () => void ran.push('one'));
    debouncer.schedule('two', async () => void ran.push('two'));

    await until(() => ran.length === 2);

    expect([...ran].sort()).toEqual(['one', 'two']);
  });
});

describe('a debouncer that has been disposed', () => {
  it('does not run what it was still waiting to do', async () => {
    const debouncer = debouncing();
    let runs = 0;

    debouncer.schedule('project', async () => void (runs += 1));
    debouncer.dispose();

    await quiet();

    expect(runs).toBe(0);
  });
});

describe('a job that throws', () => {
  /**
   * The job here ends up being a compile over a
   * document somebody is still typing. A rejection
   * that took the scheduler down with it would stop
   * every later save from regenerating anything,
   * silently.
   */
  it('leaves the debouncer working', async () => {
    const debouncer = debouncing();
    let runs = 0;

    debouncer.schedule('project', async () => {
      runs += 1;
      throw new Error('while compiling');
    });
    await until(() => runs === 1);

    debouncer.schedule('project', async () => void (runs += 1));
    await until(() => runs === 2);

    expect(runs).toBe(2);
  });
});
