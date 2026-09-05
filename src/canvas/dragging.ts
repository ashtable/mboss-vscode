/**
 * What a drag onto a block is carrying.
 *
 * A private media type rather than `text/plain`, so
 * a block only accepts a drag that came from the
 * palette and nothing a person happened to drag in
 * from another window.
 *
 * The name is the only payload: what it means is
 * decided against the manifest, by the host.
 *
 * A block chip carries nothing at all. It is dragged
 * as a press the canvas watches rather than as a
 * drag the browser runs, because where the pointer
 * is on the way — not only where it ended up — is
 * what that gesture means.
 */
export const LIB_FN = 'application/x-mboss-lib-fn';

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
