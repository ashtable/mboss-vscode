import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  openAgentSession,
  type AgentSession,
  type PermissionAnswer,
  type PermissionRequest,
  type SessionUpdate,
} from '../acp/connection.js';

/**
 * Driving the connection module against the
 * scripted peer.
 *
 * Two specs start that peer — one about the
 * conversation, one about what the client refuses
 * to serve — and both want the same four things
 * back: the session, what streamed, what was
 * asked, and what the peer heard. Sharing the
 * plumbing keeps the difference between them
 * legible.
 */

/** The peer, as a path to hand `node`. */
export const PEER_SCRIPT = fileURLToPath(
  new URL('../../test/fixtures/scripted-peer.mjs', import.meta.url),
);

/** Everything the peer wrote down about the client. */
export type Heard = {
  initialize?: {
    protocolVersion: number;
    clientCapabilities?: Record<string, unknown>;
  };
  sessionNew?: { cwd: string; mcpServers: unknown[] };
  prompt?: { sessionId: string };
  permission?: { outcome: unknown };
  cancelled?: { sessionId: string };
  probe?: unknown;
};

export type Driven = {
  /** The working directory the session was opened
   *  in. */
  project: string;

  session: AgentSession;

  /** Every `session/update` that arrived, in
   *  order. */
  updates: SessionUpdate[];

  /** Every permission the agent asked for. */
  asked: PermissionRequest[];

  /** Every file the agent asked to read or write. */
  files: { read: string[]; wrote: { path: string; content: string }[] };

  heard(): Heard;
};

export type DriveOptions = {
  /** How the panel answers a permission request. */
  answer?: (request: PermissionRequest) => Promise<PermissionAnswer>;

  /** What the peer is told to do differently. */
  env?: Record<string, string>;
};

const started: AgentSession[] = [];
const scratch: string[] = [];

/** A throwaway directory, removed by `closePeers`. */
export function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mboss-acp-'));

  scratch.push(dir);

  return dir;
}

/** Kills every peer a spec started. Call in
 *  `afterEach`. */
export function closePeers(): void {
  while (started.length > 0) started.pop()?.close();
  while (scratch.length > 0) {
    rmSync(scratch.pop() as string, { recursive: true, force: true });
  }
}

export async function drivePeer(options: DriveOptions = {}): Promise<Driven> {
  const project = scratchDir();
  const record = join(scratchDir(), 'heard.json');
  const updates: SessionUpdate[] = [];
  const asked: PermissionRequest[] = [];
  const files: Driven['files'] = { read: [], wrote: [] };
  const answer = options.answer ?? (async () => ({ optionId: 'yes' }));

  const session = await openAgentSession(
    {
      command: process.execPath,
      args: [PEER_SCRIPT],
      cwd: project,
      env: { ...options.env, PEER_RECORD: record },
    },
    {
      onUpdate: (update) => updates.push(update),
      onPermission: async (request) => {
        asked.push(request);

        return await answer(request);
      },
      readTextFile: async (request) => {
        files.read.push(request.path);

        return 'read through the editor\n';
      },
      writeTextFile: async (request) => {
        files.wrote.push({ path: request.path, content: request.content });
      },
      onClosed: () => {},
    },
  );

  started.push(session);

  return {
    project,
    session,
    updates,
    asked,
    files,
    heard: () => JSON.parse(readFileSync(record, 'utf8')) as Heard,
  };
}

/** Waits for something the peer does on its own
 *  schedule. */
export async function waitFor(done: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (!done()) {
    if (Date.now() > deadline) throw new Error('the peer never got there');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
