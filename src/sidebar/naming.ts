import type { ToolKind } from '../acp/connection.js';
import type { ToolEntry } from '../acp/transcript.js';

/**
 * Which calls are named by the file they touched.
 *
 * The host names such a call by its kind and its
 * file — "Edit lib/a.ts" — whatever the agent titled
 * it, and the panel draws that name as mBoss's own
 * words while it draws any other call's title as the
 * agent's. Both sides have to agree which is which,
 * so the rule is written once, here, where a browser
 * bundle can reach it: it imports nothing at run
 * time.
 */

/**
 * The kinds of call a person reads by the file
 * they touched.
 *
 * Each is something done to a file, so "Edit
 * lib/a.ts" says all of it. Any other kind —
 * thinking, switching mode, whatever else an agent
 * does — is not about a file even when it names
 * one, and the agent's own title says it better.
 */
const FILE_TOOL_KINDS = [
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'fetch',
] as const satisfies readonly ToolKind[];

export type FileToolKind = (typeof FILE_TOOL_KINDS)[number];

/** Whether a call the agent made is named by its
 *  kind and the first file it touched. A row mBoss
 *  wrote keeps the words it was written with. */
export function namedByFile(
  tool: Pick<ToolEntry, 'by' | 'kind' | 'paths'>,
): tool is Pick<ToolEntry, 'by' | 'paths'> & { kind: FileToolKind } {
  return (
    tool.by === 'agent' &&
    tool.paths.length > 0 &&
    (FILE_TOOL_KINDS as readonly ToolKind[]).includes(tool.kind)
  );
}
