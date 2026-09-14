import { isAbsolute, relative } from 'node:path';

/**
 * A file named the way the editor's own tabs name
 * it.
 *
 * Whatever hands this extension a file hands it an
 * absolute one, because that is what the editor and
 * the file walks deal in. A sentence a person reads
 * wants the short form, and anything that turns out
 * to be outside the project keeps the long one
 * rather than being described by a row of `..`. The
 * project directory itself is the same case: it is
 * the empty string relative to itself, which names
 * nothing.
 *
 * Its own file, and host-side only, unlike the rest
 * of the formatting every panel shares: shortening
 * a path needs `node:path`, which a browser bundle
 * has nothing to answer with. So the host works the
 * name out and sends the string it worked out,
 * rather than a webview importing this and the
 * build refusing the bundle.
 */
export function displayPath(
  absolute: string,
  root: string | undefined,
): string {
  if (root === undefined) return absolute;

  const inside = relative(root, absolute);

  return inside === '' || inside.startsWith('..') || isAbsolute(inside)
    ? absolute
    : inside;
}
