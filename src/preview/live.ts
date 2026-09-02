import { currentWorkflow, liveProposals } from '../core/index.js';

import { previewOf, type PreviewModel } from './model.js';

/**
 * What a project is currently waiting for an answer
 * about, oldest first.
 *
 * Each proposal is read against the document it
 * names as it stands *now*, not as it stood when
 * the proposal was written — which is the whole
 * question a preview has to answer before it offers
 * anybody a button.
 *
 * This only reads. Refining a proposal, ignoring
 * one, or closing the window all leave the files
 * exactly as they were; the one write this
 * extension makes to a proposal is the one an
 * approval makes.
 */
export async function livePreviews(project: string): Promise<PreviewModel[]> {
  const models: PreviewModel[] = [];

  for (const proposal of await liveProposals(project)) {
    const current = await currentWorkflow(project, proposal.workflow);

    models.push(previewOf(proposal, current));
  }

  return models;
}
