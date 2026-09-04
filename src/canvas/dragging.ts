/**
 * What a drag onto the canvas is carrying.
 *
 * A private media type rather than `text/plain`, so
 * a block only accepts a drag that came from the
 * palette and nothing a person happened to drag in
 * from another window.
 *
 * The name is the only payload: what it means is
 * decided against the manifest, by the host.
 */
export const LIB_FN = 'application/x-mboss-lib-fn';

/**
 * A block of one kind, on its way onto the canvas.
 *
 * Its own type rather than the one above, because
 * the two land in different places: a function is
 * dropped on a block, a kind is dropped on the
 * canvas, and each drop target should accept only
 * what it can do something with.
 */
export const NODE_KIND = 'application/x-mboss-node-kind';

/**
 * Whether the drag under the pointer is carrying
 * one.
 *
 * The types are readable while a drag is in flight
 * and the data is not — the browser withholds it
 * until the drop — so this is what a drag-over
 * handler has to ask.
 */
export function carries(transfer: DataTransfer, type: string): boolean {
  return transfer.types.includes(type);
}
