import { l10n } from 'vscode';

import type { PatternGroup } from '../core/index.js';
import { once } from '../once.js';

/**
 * Every word the gallery draws, resolved here and
 * sent whole.
 *
 * A webview has no `vscode.l10n`, so its words are
 * resolved on the host and travel in the init
 * message; they live beside the view, and the type
 * the view reads them by is this builder's own
 * return type.
 *
 * What is not here is the cards. A pattern's title,
 * summary and tags are authored beside its document
 * in the library, in one language, and copying them
 * into a table the extension owns would give every
 * pattern two descriptions that can disagree.
 */

export const galleryWords = once(() => ({
  heading: l10n.t('New workflow'),

  /** Said once, at the top: every card below is the
   *  same kind of document the canvas draws, so
   *  nothing here is a wizard or a scaffold. */
  hint: l10n.t(
    'Every pattern is a workflow document, built from the blocks in the palette.',
  ),

  blank: {
    title: l10n.t('Start blank'),
    body: l10n.t(
      'An empty canvas with a webhook trigger. Every pattern below is the same kind of document, already drawn.',
    ),
    action: l10n.t('Create'),
  },

  /** The three shelves, named so somebody scanning
   *  for the shape of their problem finds it. */
  groups: {
    ai: l10n.t('AI & agents'),
    backend: l10n.t('Backend'),
    devops: l10n.t('DevOps'),
  } satisfies Record<PatternGroup, string>,

  use: l10n.t('Use →'),

  demo: l10n.t('DEMO'),

  /** What the empty end of the shelf says. It
   *  promises a library that grows, not a channel
   *  to send patterns to — there is no such
   *  channel. */
  more: l10n.t('More patterns land here as they are written.'),
}));
