import { beforeEach, describe, expect, it } from 'vitest';

import { workspaceTrustDouble } from '../test/doubles/vscode.js';

import { workspaceTrust } from './trust.js';

/**
 * The one adapter that asks the window about trust.
 *
 * "Never cached" is the rule's whole point: a
 * person grants trust mid-session, and an answer
 * remembered at activation would be a stale no for
 * the rest of the window's life. So the double's
 * answer is changed under the adapter, and the
 * adapter is expected to notice.
 */
beforeEach(() => {
  workspaceTrustDouble.reset();
});

describe('asking the window about trust', () => {
  it('asks again on every call rather than remembering', () => {
    const trust = workspaceTrust();

    workspaceTrustDouble.trusted = false;
    expect(trust.isTrusted()).toBe(false);

    workspaceTrustDouble.trusted = true;
    expect(trust.isTrusted()).toBe(true);
  });

  it('says when the person grants it', () => {
    const trust = workspaceTrust();
    let heard = 0;

    const listening = trust.onGranted(() => void (heard += 1));
    workspaceTrustDouble.grant();

    expect(heard).toBe(1);

    listening.dispose();
    workspaceTrustDouble.grant();

    expect(heard).toBe(1);
  });
});
