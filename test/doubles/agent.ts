import type { Agent } from '../../src/acp/agent.js';
import type { AgentPrompt } from '../../src/acp/prompt.js';
import type { DiagnosticEntry, ToolEntry } from '../../src/acp/transcript.js';

/**
 * The agent, as a spec watches it being spoken to.
 *
 * One record of both verbs rather than one array
 * each, because the thing worth asserting about a
 * store that writes a row, compiles, and then starts
 * a turn is the *order* — and a spec holding two
 * separate stubs can only see that by pushing
 * strings into a third array from both of them.
 */
export type Told =
  | { at: 'note'; entry: ToolEntry | DiagnosticEntry }
  | { at: 'send'; prompt: AgentPrompt };

export type FakeAgent = Agent & {
  /** Everything said to it, in the order it was
   *  said. */
  told: Told[];

  /** Just the rows, for a spec that only cares
   *  what went into the column. */
  noted(): (ToolEntry | DiagnosticEntry)[];

  /** Just the sentences. What was attached to one
   *  is on the `told` entry beside it. */
  sent(): string[];

  /**
   * Makes every turn from here on fail.
   *
   * An agent that went away mid-approval is the case
   * a caller has to survive: the proposal is already
   * applied, and the person has to be told something
   * other than that it worked.
   */
  fails(reason: string): void;
};

export function fakeAgent(): FakeAgent {
  const told: Told[] = [];
  let failure: string | undefined;

  return {
    told,

    noted: () => told.flatMap((one) => (one.at === 'note' ? [one.entry] : [])),

    sent: () =>
      told.flatMap((one) => (one.at === 'send' ? [one.prompt.text] : [])),

    fails: (reason) => {
      failure = reason;
    },

    note: (entry) => {
      told.push({ at: 'note', entry });
    },

    send: (prompt) => {
      told.push({ at: 'send', prompt });

      return failure === undefined
        ? Promise.resolve()
        : Promise.reject(new Error(failure));
    },
  };
}
