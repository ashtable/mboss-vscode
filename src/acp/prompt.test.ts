import { describe, expect, it } from 'vitest';

import { promptBlocks, type PromptContext } from './prompt.js';

/**
 * A turn, in the shape the protocol carries it.
 *
 * The decision under test is what happens to the
 * record mBoss attaches to a sentence when the
 * agent on the other end will not take a resource
 * of its own. It still has to travel — an agent
 * asked why a run failed and handed nothing to
 * read would answer from imagination — so it is
 * fenced into the sentence instead. Both shapes
 * carry the same bytes; only the envelope differs.
 */

const EVIDENCE: PromptContext = {
  uri: 'mboss://run-evidence/wf_c9d2f3',
  name: 'run wf_c9d2f3 · mBoss run evidence',
  mimeType: 'application/json',
  text: '{"at":"run","workflowId":"wf_c9d2f3","status":"ERROR"}',
};

describe('the blocks a prompt becomes', () => {
  it('sends the sentence and the context as a resource', () => {
    expect(
      promptBlocks(
        { text: 'Why did it fail?', context: [EVIDENCE] },
        { embeddedContext: true },
      ),
    ).toEqual([
      { type: 'text', text: 'Why did it fail?' },
      {
        type: 'resource',
        resource: {
          uri: 'mboss://run-evidence/wf_c9d2f3',
          mimeType: 'application/json',
          text: '{"at":"run","workflowId":"wf_c9d2f3","status":"ERROR"}',
        },
      },
    ]);
  });

  it('fences the context into the sentence when the agent will not take a resource', () => {
    const blocks = promptBlocks(
      { text: 'Why did it fail?', context: [EVIDENCE] },
      { embeddedContext: false },
    );

    expect(blocks).toEqual([
      {
        type: 'text',
        text: [
          'Why did it fail?',
          '',
          'run wf_c9d2f3 · mBoss run evidence',
          '```json',
          '{"at":"run","workflowId":"wf_c9d2f3","status":"ERROR"}',
          '```',
        ].join('\n'),
      },
    ]);
  });

  it('sends one text block when there is no context', () => {
    const bare = { text: 'Wire the booking flow.' };

    expect(promptBlocks(bare, { embeddedContext: false })).toEqual([
      { type: 'text', text: 'Wire the booking flow.' },
    ]);
    expect(promptBlocks(bare, { embeddedContext: true })).toEqual([
      { type: 'text', text: 'Wire the booking flow.' },
    ]);
  });
});
