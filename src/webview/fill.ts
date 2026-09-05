/**
 * A template's `{n}` placeholders, filled in the
 * order the values were given.
 *
 * A webview resolves no string of its own, so every
 * word arrives from the host already localized. Some
 * of what a sentence names is only known where it is
 * drawn, though — how many functions were hidden,
 * which type a signature disagreed about — so those
 * sentences travel as templates and are filled here.
 * It is what `vscode.l10n.t` does with its own
 * arguments, one step later.
 */
export function filled(template: string, ...values: string[]): string {
  return values.reduce(
    (text, value, index) => text.replace(`{${index}}`, value),
    template,
  );
}
