import type { ToolEntry } from './transcript.js';

/**
 * Which row in the column is the one mBoss wrote
 * about a run it read for the agent, and which run.
 *
 * Spelled once, here, because two sides read it:
 * the run store, which writes the row, and the
 * panel, which draws the run by its short id with
 * the whole one on it and needs to know which run
 * that is without parsing the words.
 *
 * Its own file, importing nothing at run time,
 * because the second of those is a browser bundle
 * and the fold beside it reaches for Node.
 */

const EVIDENCE = 'evidence:';

/** The id of the row about `workflowId`. */
export function evidenceRowId(workflowId: string): string {
  return `${EVIDENCE}${workflowId}`;
}

/** The run a row is about, where it is the row
 *  mBoss wrote about one. */
export function evidenceRunOf(
  entry: Pick<ToolEntry, 'by' | 'id'>,
): string | undefined {
  return entry.by === 'person' && entry.id.startsWith(EVIDENCE)
    ? entry.id.slice(EVIDENCE.length)
    : undefined;
}
