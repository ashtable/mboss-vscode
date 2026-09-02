/**
 * A webview entry imports its stylesheet so that
 * the build emits one beside the bundle. The
 * compiler has nothing to say about the file
 * itself; it only needs to know the import
 * resolves.
 */
declare module '*.css';
