import type { FileEditEntry } from '../../../src/acp/transcript.js';
import type { SidebarInit } from '../../../src/webview/protocol.js';

import { sidebarWords } from '../words.js';

/**
 * The agent panel, as the host would send it.
 *
 * More than one spec drives this view — the panel's
 * own, and the shared-component one, which needs a
 * real surface to read a component off — and
 * Playwright refuses a spec that imports another, so
 * the message they both send lives here. Two copies
 * of it would drift, and a component spec reading a
 * panel nobody else draws proves nothing about the
 * panel.
 *
 * The words are the ones sent in below, not the ones
 * the extension resolves: that the host resolves the
 * right ones is checked where the host is.
 */
export function sidebarInit(over: Partial<SidebarInit> = {}): SidebarInit {
  return {
    type: 'init',
    view: 'sidebar',
    strings: sidebarWords,
    agent: 'claude code',
    status: 'ready',
    transcript: [],
    prompt: undefined,
    failure: undefined,
    preview: undefined,
    ...over,
  };
}

/** A pending file edit, ready to be overridden for
 *  one thing at a time. */
export function fileEntry(over: Partial<FileEditEntry> = {}): FileEditEntry {
  return {
    at: 'file',
    id: 'call-1:/project/lib/twilioChat.ts',
    toolCallId: 'call-1',
    by: 'agent',
    path: '/project/lib/twilioChat.ts',
    isNew: false,
    added: 1,
    removed: 1,
    lines: [],
    oldText: 'old\n',
    newText: 'new\n',
    decision: 'pending',
    ...over,
  };
}
