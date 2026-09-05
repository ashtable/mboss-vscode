/**
 * A value built the first time it is asked for and
 * kept for as long as the window is open.
 *
 * The words a view is handed are resolved through
 * `l10n`, which answers from the bundle of the
 * locale the window was opened in — a thing that
 * cannot change without the window reloading.
 * Resolving a hundred of them again on every
 * message a view is sent is work that answers the
 * same way every time, and building them at module
 * load would be too early: the bundle is not loaded
 * until the extension activates.
 */
export function once<T>(build: () => T): () => T {
  let built: { value: T } | undefined;

  return () => {
    built ??= { value: build() };

    return built.value;
  };
}
