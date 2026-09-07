import { describe, expect, it } from 'vitest';

import { libFrameOf } from './frames.js';

/**
 * The stacks a running container actually wrote.
 *
 * Every string below was read out of
 * `dbos.operation_outputs.error` on a scaffolded
 * project whose one step threw: the app runs its
 * sources under tsx from the directory the image
 * copied them to, so a frame names a `.ts` file at
 * an absolute container path and the line is the
 * line in the source.
 *
 * What is pinned is which frame in one of these is
 * a file somebody can open. The generated workflow
 * and the SDK are as prominent in a stack as the
 * handler is, and neither is code anybody in the
 * project wrote.
 */

/** One step's failure, verbatim. */
const THREW =
  'Error: boom from lib\n' +
  '    at boom (/app/lib/boom.ts:7:11)\n' +
  '    at DBOS.runStep.name (/app/src/workflows/boom.workflow.ts:17:52)\n' +
  '    at <anonymous> ' +
  '(/app/node_modules/@dbos-inc/dbos-sdk/src/dbos-executor.ts:1099:30)\n' +
  '    at AsyncLocalStorage.run ' +
  '(node:internal/async_local_storage/async_context_frame:63:14)\n' +
  '    at runWithParentContext ' +
  '(/app/node_modules/@dbos-inc/dbos-sdk/src/context.ts:129:30)';

/**
 * The wrapper DBOS stores over a step that ran out
 * of tries, verbatim. Its own stack is the SDK
 * giving up, which is why the headline a card reads
 * comes off the last try rather than off this.
 */
const GAVE_UP =
  'Error: Step go_boom has exceeded its maximum of 3 retries.\n' +
  '    at DBOSExecutor.callStepFunction ' +
  '(/app/node_modules/@dbos-inc/dbos-sdk/src/dbos-executor.ts:1198:32)\n' +
  '    at process.processTicksAndRejections ' +
  '(node:internal/process/task_queues:104:5)\n' +
  '    at async boomFn (/app/src/workflows/boom.workflow.ts:17:21)';

describe('the frame a failure came from', () => {
  it('reads a frame inside lib', () => {
    expect(libFrameOf(THREW)).toEqual({
      file: 'lib/boom.ts',
      line: 7,
      column: 11,
    });
  });

  /**
   * Not the form the scaffolded app produced — tsx
   * loads its sources by path — but the form Node
   * writes for a module it was given a URL for, and
   * what the entrypoint runs is the project's to
   * change. Reading both costs one optional prefix.
   */
  it('reads a frame written as a file URL', () => {
    expect(
      libFrameOf(
        'Error: boom from lib\n' + '    at boom (file:///app/lib/boom.ts:7:11)',
      ),
    ).toEqual({ file: 'lib/boom.ts', line: 7, column: 11 });
  });

  /**
   * Two ways a stack names only code nobody wrote:
   * the SDK giving up on a step, and — were the
   * project ever compiled ahead of being run —
   * output under a build directory rather than the
   * handler beside it.
   */
  it('answers nothing for a stack with no lib frame', () => {
    expect(libFrameOf(GAVE_UP)).toBeUndefined();

    expect(
      libFrameOf(
        'Error: boom from lib\n    at boom (/app/dist/lib/boom.js:31:9)',
      ),
    ).toBeUndefined();
  });

  /**
   * The SDK's own frames sit above the handler's in
   * every recorded failure, and one of its files is
   * under a `lib` of its own — which is why the
   * match is anchored at the app directory rather
   * than looking for `lib` anywhere in the path.
   */
  it('skips a node_modules frame ahead of the lib one', () => {
    expect(
      libFrameOf(
        'Error: boom from lib\n' +
          '    at runStep ' +
          '(/app/node_modules/@dbos-inc/dbos-sdk/lib/step.js:412:19)\n' +
          '    at boom (/app/lib/boom.ts:7:11)',
      ),
    ).toEqual({ file: 'lib/boom.ts', line: 7, column: 11 });
  });

  it('answers nothing for no stack at all', () => {
    expect(libFrameOf(undefined)).toBeUndefined();
    expect(libFrameOf('')).toBeUndefined();
  });

  /**
   * A stack is text out of somebody's run database,
   * and what is done with a frame is to join it to a
   * project and open the file. A path that climbs
   * back out of the code-behind is not a handler, so
   * it is not a frame.
   */
  it('answers nothing for a path that climbs out of lib', () => {
    expect(
      libFrameOf('Error: boom\n    at boom (/app/lib/../../etc/hosts:1:1)'),
    ).toBeUndefined();
  });
});
