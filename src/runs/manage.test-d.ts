import type { ManagementClient } from './manage.js';

/**
 * What the extension may do to somebody's run
 * history, asserted as a type.
 *
 * The object behind this is DBOS's own client,
 * which can also start workflows, enqueue them and
 * list them — and this extension does none of
 * those. Starting a run goes through the app's own
 * ingress, so that the app's own code decides what
 * a run is; a client that could start one from here
 * would be a second door into somebody's system
 * with none of that behind it.
 *
 * A type is the only thing that can hold that: the
 * value at run time carries every one of those
 * members, so no assertion about the object could
 * ever say they are absent. `tsc --noEmit` is what
 * checks this file — vitest does not run it, and it
 * is not meant to.
 *
 * It counts as shipped source to the boundary
 * fences, so it names none of the things they
 * forbid.
 */

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

type Expect<T extends true> = T;

export type ManagementClientMembers = Expect<
  Equal<
    keyof ManagementClient,
    | 'getLatestApplicationVersion'
    | 'forkWorkflow'
    | 'cancelWorkflow'
    | 'resumeWorkflow'
    | 'destroy'
  >
>;
