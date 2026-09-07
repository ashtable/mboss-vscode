import { describe, expect, it } from 'vitest';

import type { LibManifest } from './core/rules.js';
import { openHandler, type OpensFiles } from './openHandler.js';

/**
 * The way from a block to the code it runs.
 *
 * One function behind two doors: the canvas reaches
 * the editor through `VsCodeApi` and the run page
 * through `RunsHost`, and neither bag is the other's
 * — so what is shared is the one verb both have, and
 * everything worked out on the way here is worked
 * out once.
 *
 * The manifest is the only place that knows where a
 * function is. Nothing here asks the editor for a
 * symbol: a scan already read `lib/` and wrote down
 * the line, and a second answer to the same question
 * is a second thing to be wrong.
 */

const PROJECT = '/work/booking';

/** The code behind a project, as the last scan read
 *  it: one function it found a line for, and one
 *  from a cache written before lines were recorded. */
const MANIFEST: LibManifest = {
  scannedAt: '2026-01-01T09:00:00.000Z',
  sourceHash: 'b2f4',
  functions: [
    {
      export: 'findSlot',
      file: 'lib/findSlot.ts',
      params: [{ name: 'req', type: 'BookingReq' }],
      returnType: 'SlotGrid',
      line: 6,
    },
    {
      export: 'twilioChat',
      file: 'lib/twilioChat.ts',
      params: [],
      returnType: 'void',
    },
  ],
  types: [],
  typeSources: {},
  nonSerializable: [],
  errors: [],
};

type Opened = { path: string; at?: { line: number; column?: number } };

/** Whatever opens files, writing down what it was
 *  asked to open and where. */
function opener(): OpensFiles & { opened: Opened[] } {
  const opened: Opened[] = [];

  return {
    opened,
    openFile: async (path, at) => void opened.push({ path, at }),
  };
}

describe('opening the function a block runs', () => {
  it('opens the file at the declaration line', async () => {
    const files = opener();

    const unknown = await openHandler(files, PROJECT, MANIFEST, {
      handler: { export: 'findSlot' },
    });

    expect(unknown).toBeUndefined();
    expect(files.opened).toEqual([
      { path: '/work/booking/lib/findSlot.ts', at: { line: 6 } },
    ]);
  });

  /**
   * A manifest written before the scan recorded
   * lines still names the file, and the file is
   * what somebody asked for. The cache is keyed on
   * the code's hash rather than on the build that
   * wrote it, so this is a state that arrives on
   * its own.
   */
  it('opens at the top when the manifest has no line', async () => {
    const files = opener();

    await openHandler(files, PROJECT, MANIFEST, {
      handler: { export: 'twilioChat' },
    });

    expect(files.opened).toEqual([
      { path: '/work/booking/lib/twilioChat.ts', at: undefined },
    ]);
  });

  /**
   * A document is written by agents as well as by
   * the canvas, so a block can name a function
   * nobody has written — which is the ordinary way
   * a workflow is drawn before its code exists.
   * The name comes back rather than a sentence,
   * because the two callers say things in different
   * voices.
   */
  it('says it does not know an export the manifest lacks', async () => {
    const files = opener();

    const unknown = await openHandler(files, PROJECT, MANIFEST, {
      handler: { export: 'reschedule' },
    });

    expect(unknown).toBe('reschedule');
    expect(files.opened).toEqual([]);
  });

  /** A block nobody has assigned a function to has
   *  no code to open, which is not something to
   *  complain about. */
  it('opens nothing for a block that runs no function', async () => {
    const files = opener();

    const unknown = await openHandler(files, PROJECT, MANIFEST, {});

    expect(unknown).toBeUndefined();
    expect(files.opened).toEqual([]);
  });
});
