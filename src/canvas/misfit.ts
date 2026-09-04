import type { HandlerMisfit } from '../core/rules.js';
import { filled } from '../webview/fill.js';

/**
 * Why a function cannot sit behind a block, in
 * words.
 *
 * Core answers with a code and the facts behind it
 * rather than a sentence, because the same misfit
 * is shown three ways — a greyed row in the
 * palette, a greyed row in the picker, and a
 * notification when a drop is refused. This is the
 * one place that turns the code into the sentence,
 * so those three cannot say different things about
 * the same pairing.
 *
 * The words arrive from the host, already
 * localized; the values in them are known only
 * here, where the pairing is worked out.
 */
export function misfitNote(
  words: Record<HandlerMisfit['kind'], string>,
  reason: HandlerMisfit,
): string {
  const template = words[reason.kind];

  switch (reason.kind) {
    case 'no-handler-kind':
      return template;

    case 'too-many-params':
      return filled(template, String(reason.count));

    case 'input-mismatch':
      return filled(template, reason.takes, reason.declared);

    case 'output-mismatch':
      return filled(template, reason.returns, reason.declared);

    case 'not-a-decision':
      return filled(template, reason.returns);
  }
}
