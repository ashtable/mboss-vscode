/**
 * The few characters a run is known by on screen.
 *
 * A full run id is too long for a list row and, far
 * worse, too alike the next one to scan: DBOS names
 * a queued child after its parent and a scheduled
 * firing after its workflow and the clock, and the
 * run route records whatever id the caller chose.
 * Only a UUID is random at the front, so every
 * other shape is hashed — four characters cut out
 * of the id itself would have every child of one
 * run, and every nightly firing, reading the same.
 *
 * Four characters do collide: about one pair in
 * fifty rows. That is why nothing here stands on
 * its own — every short id is drawn carrying the
 * full one, so a reader who has two of them can
 * still tell which is which.
 *
 * Its own file, importing nothing, because the host
 * and four browser bundles all shorten ids, and the
 * modules this would otherwise sit in reach the
 * editor API.
 */

/** A canonical UUID, in whichever case it was
 *  written: the one shape random at its head. */
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * What older builds of this extension minted: the
 * clock, then eight random hex.
 *
 * Four hex at least, so that a string merely shaped
 * like one of those ids cannot answer with fewer
 * characters than every other id answers with.
 */
const MINTED = /^run_\d+_([0-9a-f]{4,})$/;

/** How many base-36 numbers four digits hold. */
const FOUR_DIGITS = 36 ** 4;

export function shortRunId(id: string): string {
  if (UUID.test(id)) return `#${id.slice(0, 4).toLowerCase()}`;

  const minted = MINTED.exec(id)?.[1];
  if (minted !== undefined) return `#${minted.slice(0, 4)}`;

  return `#${hashed(id)}`;
}

/**
 * FNV-1a over the whole id, printed base 36.
 *
 * The low digits rather than the high ones: a hash
 * under 36³ has no fourth digit to take, and the
 * low digits are the ones that move when a single
 * character of the id does.
 */
function hashed(id: string): string {
  let hash = 0x811c9dc5;

  for (let at = 0; at < id.length; at += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(at), 0x01000193);
  }

  return ((hash >>> 0) % FOUR_DIGITS).toString(36).padStart(4, '0');
}
