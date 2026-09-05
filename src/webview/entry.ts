/**
 * Which webviews this extension ships, and where
 * the build leaves each one.
 *
 * The host asks for a bundle by name through
 * `webviewFile`; the build writes them under the
 * names in `WEBVIEW_ENTRIES`, over in `build.ts`.
 * The two live apart because `npm run build` is
 * plain `node` reading TypeScript, and plain
 * `node` will not follow a `.js` specifier to a
 * `.ts` file — so nothing the build runs may
 * import a sibling at run time. A type-only import
 * is erased before that matters, which is how the
 * compiler still checks that every built entry is
 * a view this module knows about.
 *
 * Adding a webview: a name here, a name in
 * `WEBVIEW_ENTRIES`, and `src/<name>/index.tsx`.
 */
export type WebviewName = 'canvas' | 'sidebar' | 'runs' | 'see';

/** Where the build leaves one webview's asset. */
export function webviewFile(name: WebviewName, kind: 'js' | 'css'): string {
  return `webview/${name}.${kind}`;
}
