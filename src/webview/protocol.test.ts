import { describe, expect, it } from 'vitest';

import { WebviewMessageSchema } from './host.js';
import { isHostMessageFor } from './protocol.js';

/**
 * A webview's message channel is shared, not
 * private: the webview implementation posts on it,
 * and so can anything else holding the frame. The
 * cost of getting this wrong is a panel that
 * renders blank in a released extension and logs
 * nothing anybody sees.
 */
describe('messages arriving at a webview', () => {
  const init = { type: 'init', view: 'canvas', strings: {}, document: {} };

  it('accepts the host talking to this view', () => {
    expect(isHostMessageFor('canvas', init)).toBe(true);
  });

  it('ignores a message meant for another view', () => {
    expect(isHostMessageFor('sidebar', init)).toBe(false);
  });

  it('ignores whatever else lands on the channel', () => {
    for (const other of [
      undefined,
      null,
      'a string',
      42,
      { command: 'something-elses-protocol' },
      { type: 'init' },
    ]) {
      expect(isHostMessageFor('canvas', other)).toBe(false);
    }
  });
});

/**
 * The other direction, where the host is the one
 * reading. A renderer is a frame running scripts,
 * so what comes back from one is parsed rather
 * than trusted.
 */
describe('messages arriving at the host', () => {
  it('accepts a view saying it has mounted', () => {
    expect(WebviewMessageSchema.safeParse({ type: 'ready' }).success).toBe(
      true,
    );
  });

  it('rejects anything else', () => {
    for (const other of [{}, { type: 'go' }, null, 'ready']) {
      expect(WebviewMessageSchema.safeParse(other).success).toBe(false);
    }
  });
});
