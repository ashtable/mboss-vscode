import type { ContentBlock } from './connection.js';

/**
 * What a turn is made of, once the agent has said
 * what it will take.
 *
 * A prompt this extension sends is a sentence a
 * person could have typed and, sometimes, a
 * machine-readable record of what mBoss read out
 * of a run. The two are kept apart up to here
 * rather than glued into one string by whoever
 * asked, because only the connection knows
 * whether the agent on the other end accepts a
 * record as a resource of its own — and where it
 * does not, the record still has to travel. An
 * agent asked why a run failed and handed nothing
 * to read answers from imagination.
 *
 * So there is one decision in this module and it
 * is about the envelope, never the contents: the
 * context's `text` is already the JSON somebody
 * else assembled, and nothing here serializes,
 * summarises or reformats it.
 */

/** A turn, as the rest of the extension writes
 *  one. */
export type AgentPrompt = {
  /** The sentence, and the only part a person
   *  reads back in the transcript. */
  text: string;

  context?: PromptContext[];
};

/**
 * One record handed over with the sentence.
 *
 * `uri` names what the record is about rather
 * than somewhere to fetch it from: nothing serves
 * `mboss://`, and an agent that treats it as an
 * identifier is treating it correctly. `name` is
 * what the record is called where there is no uri
 * to carry — the fenced form has a heading and
 * nowhere else to put one.
 */
export type PromptContext = {
  uri: `mboss://run-evidence/${string}`;

  name: string;

  mimeType: 'application/json';

  text: string;
};

/** What the agent said, at the handshake, that a
 *  prompt may contain. */
export type AgentAccepts = { embeddedContext: boolean };

/**
 * The prompt, as blocks.
 *
 * An agent that takes embedded context gets the
 * sentence and each record as separate blocks,
 * which is what lets it read one without the
 * other. An agent that does not gets a single
 * block with the records fenced under their
 * names, because a JSON object dropped into prose
 * unmarked is a paragraph the agent has to guess
 * the edges of.
 */
export function promptBlocks(
  prompt: AgentPrompt,
  accepts: AgentAccepts,
): ContentBlock[] {
  const context = prompt.context ?? [];

  if (accepts.embeddedContext) {
    return [
      { type: 'text', text: prompt.text },
      ...context.map((one): ContentBlock => ({
        type: 'resource',
        resource: { uri: one.uri, mimeType: one.mimeType, text: one.text },
      })),
    ];
  }

  return [
    { type: 'text', text: [prompt.text, ...context.map(fenced)].join('\n\n') },
  ];
}

/** One record, named and fenced, so an agent
 *  reading prose can see where the JSON starts
 *  and stops. */
function fenced(context: PromptContext): string {
  return `${context.name}\n\`\`\`json\n${context.text}\n\`\`\``;
}
