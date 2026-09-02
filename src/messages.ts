import { l10n } from 'vscode';

/**
 * Every string a person reads, in one table.
 *
 * `package.json`'s own strings go through
 * `%key%` and `package.nls.json` instead; the two
 * mechanisms share nothing and neither falls back
 * to the other. Anything a running extension shows
 * belongs here.
 *
 * That includes what the webviews render. A
 * webview has no `vscode.l10n`, so its strings are
 * resolved here and travel in the view's init
 * message rather than being written into a browser
 * bundle.
 *
 * Each entry is a function because `l10n.t`
 * answers with the active locale's bundle, which
 * is not loaded until the extension activates.
 * Each one holds a literal, because that is what
 * the extraction tooling reads and what
 * `l10n/bundle.l10n.json` is checked against.
 */
export const messages = {
  newProjectNotBuilt: () =>
    l10n.t('Creating an mBoss project is not implemented in this build.'),
  openRunsNotBuilt: () =>
    l10n.t('The mBoss Runs view is not implemented in this build.'),
  generateCodeNotBuilt: () =>
    l10n.t('mBoss code generation is not implemented in this build.'),
  chooseCodingAgentNotBuilt: () =>
    l10n.t('Choosing a coding agent is not implemented in this build.'),

  statusReady: () => l10n.t('mBoss ✓ ready — fully local'),
  statusReadyDetail: () =>
    l10n.t('No sign-in, no serial key, and nothing leaves this machine.'),

  canvasCaption: () =>
    l10n.t(
      'Workflow IR — source of truth for orchestration · layout is deterministic, never hand-drawn',
    ),
  canvasNotBuilt: () =>
    l10n.t('The graph is not drawn in this build. Use the JSON editor.'),
  canvasUnreadable: () => l10n.t('This file is not a workflow document.'),
  canvasRevision: () => l10n.t('revision'),
  canvasNodes: () => l10n.t('nodes'),
  canvasEdges: () => l10n.t('edges'),

  sidebarHeading: () => l10n.t('Agent'),
  sidebarNotBuilt: () => l10n.t('No coding agent is connected in this build.'),
};
