import type {
  PermissionOptionKind,
  PermissionRequest,
  ToolCallUpdate,
} from './connection.js';

/**
 * What the panel remembers about a tool, and for
 * how long.
 *
 * "Always" is a promise made about one project, so
 * it lives in that workspace's own state and never
 * in the editor's global state: the answer to *may
 * this agent edit these files* is about the files.
 *
 * Every decision here is read off the option's
 * `kind`, which the protocol fixes, and never off
 * its `optionId`, which is a string the agent
 * invented — `yes-always`, `allow_2`, a uuid.
 * Inferring meaning from its spelling is inferring
 * from somebody else's private vocabulary.
 */

/** Where the promise is kept. */
export const REMEMBERED_KEY = 'mboss.permissions';

/** A standing answer, once one has been given. */
export type Standing = 'allow' | 'reject';

/**
 * The slice of workspace state this needs.
 *
 * `ExtensionContext.workspaceState` is one of
 * these. Taking the narrow shape rather than the
 * context means a spec can drive the whole loop
 * without an editor.
 */
export type Memento = {
  get<T>(key: string): T | undefined;

  update(key: string, value: unknown): Thenable<void>;
};

export type PermissionMemory = {
  /** What was promised about this tool, if
   *  anything. */
  standing(toolKey: string): Standing | undefined;

  /** Files an answer away, when it was one that
   *  outlives the turn. */
  remember(toolKey: string, kind: PermissionOptionKind): Promise<void>;
};

export function permissionMemory(state: Memento): PermissionMemory {
  const kept = (): Record<string, Standing> => {
    const stored = state.get<unknown>(REMEMBERED_KEY);

    // Workspace state is a file somebody can edit
    // and a shape this extension has changed
    // before. Nonsense in it means nothing was
    // promised, not a broken panel.
    return typeof stored === 'object' && stored !== null
      ? (stored as Record<string, Standing>)
      : {};
  };

  return {
    standing: (toolKey) => {
      const answer = kept()[toolKey];

      return answer === 'allow' || answer === 'reject' ? answer : undefined;
    },

    remember: async (toolKey, kind) => {
      if (kind !== 'allow_always' && kind !== 'reject_always') return;

      await state.update(REMEMBERED_KEY, {
        ...kept(),
        [toolKey]: kind === 'allow_always' ? 'allow' : 'reject',
      });
    },
  };
}

/**
 * Which tool a promise is about.
 *
 * The agent's own name for it when it sent one,
 * and the protocol's category when it did not.
 * This client can only be as specific as the agent
 * was — it wrote the button label from the same
 * information, so a promise made against a
 * category is the promise the button offered.
 */
export function toolKey(toolCall: ToolCallUpdate): string {
  return toolCall.name ?? toolCall.kind ?? 'other';
}

/**
 * The answer a standing promise gives, when it
 * gives one.
 *
 * The narrowest option that keeps the promise: the
 * promise is already kept here, and answering
 * "always" again would teach the agent a rule it
 * would then apply somewhere this extension cannot
 * see. An agent that offers no way to keep it gets
 * the question put to the user rather than an
 * option id nobody sent.
 */
export function standingAnswer(
  request: PermissionRequest,
  standing: Standing | undefined,
): { optionId: string } | undefined {
  if (standing === undefined) return undefined;

  const wanted: PermissionOptionKind[] =
    standing === 'allow'
      ? ['allow_once', 'allow_always']
      : ['reject_once', 'reject_always'];

  for (const kind of wanted) {
    const option = request.options.find((one) => one.kind === kind);

    if (option !== undefined) return { optionId: option.optionId };
  }

  return undefined;
}
