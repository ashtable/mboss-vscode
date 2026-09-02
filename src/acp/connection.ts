import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';

import {
  CLIENT_METHODS,
  PROTOCOL_VERSION,
  client,
  ndJsonStream,
  type ClientCapabilities,
  type ClientConnection,
  type NewSessionRequest,
  type PermissionOption,
  type SessionUpdate,
  type StopReason,
  type ToolCallUpdate,
} from '@agentclientprotocol/sdk';

import { versionFailure, type Failure } from './session.js';

/**
 * Everything this extension puts on the ACP wire.
 *
 * One module, on purpose. The protocol is young,
 * its SDK is a moving target, and four
 * independently released agent binaries sit on the
 * other end of it — so the whole of it is behind
 * one door. Nothing else in this extension imports
 * the SDK, spawns the agent, or knows what a
 * JSON-RPC method is called; a spec asserts that.
 *
 * What crosses the door is deliberately small: a
 * command to run, four callbacks, and a session
 * that can be prompted, cancelled and closed. The
 * protocol's own vocabulary is re-exported from
 * here as types, so the modules that fold updates
 * and remember answers can say what they mean
 * without reaching past this file for it.
 */

export type {
  ContentBlock,
  PermissionOption,
  PermissionOptionKind,
  PlanEntryStatus,
  SessionUpdate,
  StopReason,
  ToolCallContent,
  ToolCallStatus,
  ToolCallUpdate,
  ToolKind,
} from '@agentclientprotocol/sdk';

/** The key the project's own control plane is
 *  registered under, everywhere. */
export const MCP_SERVER_NAME = 'mboss';

/** Where a project keeps the server this extension
 *  vendored into it. */
export const MCP_SERVER_PATH = ['.mboss', 'mcp', 'server.js'];

/**
 * What this client offers to do for an agent.
 *
 * Reading and writing through the editor is what
 * makes an agent's edit land in the window
 * somebody is looking at. Running commands is a
 * different offer and this version does not make
 * it: an agent that wants a shell has one, in a
 * terminal its user opened. Said out loud rather
 * than left off, because an absence a reader has
 * to infer is an absence somebody adds back by
 * accident.
 */
export const CLIENT_CAPABILITIES: ClientCapabilities = {
  fs: { readTextFile: true, writeTextFile: true },
  terminal: false,
};

/** The agent process to start, and where. */
export type AgentLaunch = {
  command: string;

  args: readonly string[];

  /** The project. It becomes the session's `cwd`
   *  and the root of the server path above. */
  cwd: string;

  /** Added to the environment the agent inherits. */
  env?: Record<string, string>;
};

/** A permission question, minus the session it
 *  belongs to. */
export type PermissionRequest = {
  toolCall: ToolCallUpdate;

  options: PermissionOption[];
};

/** What the panel decided, or that the turn ended
 *  first. */
export type PermissionAnswer = { optionId: string } | 'cancelled';

/** What the extension does with what the agent
 *  says. */
export type ConnectionHandlers = {
  onUpdate(update: SessionUpdate): void;

  onPermission(request: PermissionRequest): Promise<PermissionAnswer>;

  readTextFile(request: {
    path: string;
    line?: number | null;
    limit?: number | null;
  }): Promise<string>;

  writeTextFile(request: { path: string; content: string }): Promise<void>;

  /** The agent went away, whether or not anybody
   *  asked it to. */
  onClosed(detail: string | undefined): void;
};

export type AgentSession = {
  sessionId: string;

  /** Runs one turn. Resolves with why it stopped. */
  prompt(text: string): Promise<StopReason>;

  /**
   * Ends the current turn.
   *
   * Also answers whatever the agent was waiting on:
   * the protocol requires a cancelled turn's
   * outstanding permission request to come back
   * `cancelled`, and a question left hanging is a
   * session that can never take another prompt.
   */
  cancel(): Promise<void>;

  /** Ends the session and the process with it. */
  close(): void;
};

/** A session that never opened, and why. */
export class AgentStartError extends Error {
  constructor(readonly failure: Failure) {
    super(describe(failure));
    this.name = 'AgentStartError';
  }
}

/**
 * The `session/new` parameters, built from a
 * project.
 *
 * `node` rather than an absolute interpreter path:
 * the agent spawns this from its own process
 * environment, not the editor's, and the
 * `.mcp.json` a terminal agent reads in the same
 * project says exactly the same thing. Two
 * spellings of one server would be two things to
 * keep in step.
 *
 * The path is absolute and expanded here. Editors
 * substitute their own variables into their own
 * configuration files; nothing in this protocol
 * says an agent expands anything, so nothing is
 * left for it to expand.
 *
 * `env` is a list of name/value pairs. The object
 * map every neighbouring tool spells this as
 * serializes without complaint into an empty
 * environment.
 */
export function sessionParams(project: string): NewSessionRequest {
  return {
    cwd: project,
    mcpServers: [
      {
        name: MCP_SERVER_NAME,
        command: 'node',
        args: [join(project, ...MCP_SERVER_PATH)],
        env: [],
      },
    ],
  };
}

/**
 * Starts an agent and opens a session in it.
 *
 * Rejects with an `AgentStartError` when the
 * process will not start, the handshake fails, or
 * the agent answers with a protocol version this
 * client does not speak — which is not an exotic
 * case with four independently released binaries
 * in the picker, and which the protocol says to
 * treat by closing rather than by carrying on.
 */
export async function openAgentSession(
  launch: AgentLaunch,
  handlers: ConnectionHandlers,
): Promise<AgentSession> {
  const child = await start(launch);
  const stderr = tail(child);

  // Answered when a turn is cancelled, so a
  // question the agent is waiting on does not
  // outlive the turn that asked it.
  const waiting = new Set<(answer: PermissionAnswer) => void>();

  const app = client({ name: 'mBoss' })
    .onNotification(CLIENT_METHODS.session_update, ({ params }) => {
      handlers.onUpdate(params.update);
    })
    .onRequest(
      CLIENT_METHODS.session_request_permission,
      async ({ params }) => {
        const answer = await race(waiting, () =>
          handlers.onPermission({
            toolCall: params.toolCall,
            options: params.options,
          }),
        );

        return {
          outcome:
            answer === 'cancelled'
              ? { outcome: 'cancelled' }
              : { outcome: 'selected', optionId: answer.optionId },
        };
      },
    )
    .onRequest(CLIENT_METHODS.fs_read_text_file, async ({ params }) => ({
      content: await handlers.readTextFile(params),
    }))
    .onRequest(CLIENT_METHODS.fs_write_text_file, async ({ params }) => {
      await handlers.writeTextFile(params);
    });

  // Deliberately no `terminal/*` handler. An
  // unregistered method is refused by the
  // connection itself, which is a stronger
  // statement than a handler that answers "no":
  // there is nothing here to misconfigure into
  // serving it later.

  const connection = app.connect(
    ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ),
  );

  // A handshake that does not agree leaves no
  // session behind, so the process goes with it —
  // the protocol's own instruction on a version
  // mismatch is to close rather than carry on.
  const sessionId = await handshake(connection, launch.cwd, stderr).catch(
    (error: unknown) => {
      connection.close();
      child.kill();
      throw error;
    },
  );

  let closed = false;

  child.once('exit', () => {
    if (closed) return;
    closed = true;
    handlers.onClosed(stderr());
  });

  return {
    sessionId,

    prompt: async (text) => {
      const response = await connection.agent.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text }],
      });

      return response.stopReason;
    },

    cancel: async () => {
      await connection.agent.notify('session/cancel', { sessionId });

      for (const answer of [...waiting]) answer('cancelled');
    },

    close: () => {
      closed = true;
      connection.close();
      child.kill();
    },
  };
}

/**
 * The handshake, in the order the protocol puts it
 * in.
 *
 * An agent that does not support the version it
 * was asked for answers with the latest it does,
 * and the client's part is to stop there. Going on
 * would mean talking past an agent that has
 * already said it does not understand.
 */
async function handshake(
  connection: ClientConnection,
  project: string,
  stderr: () => string | undefined,
): Promise<string> {
  const initialized = await connection.agent
    .request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: CLIENT_CAPABILITIES,
      clientInfo: { name: 'mBoss', version: '1' },
    })
    .catch((error: unknown) => {
      throw new AgentStartError({
        because: 'initialize',
        detail: stderr() ?? String(error),
      });
    });

  const mismatch = versionFailure(
    PROTOCOL_VERSION,
    initialized.protocolVersion,
  );

  if (mismatch !== undefined) throw new AgentStartError(mismatch);

  const opened = await connection.agent
    .request('session/new', sessionParams(project))
    .catch((error: unknown) => {
      throw new AgentStartError({
        because: 'initialize',
        detail: stderr() ?? String(error),
      });
    });

  return opened.sessionId;
}

/**
 * The process, once it is known to be running.
 *
 * A command that is not there fails
 * asynchronously — `spawn` returns a handle and
 * then emits `error` — so a caller that did not
 * wait would get a session object for a process
 * that never existed.
 */
async function start(
  launch: AgentLaunch,
): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(launch.command, [...launch.args], {
    cwd: launch.cwd,
    env: { ...process.env, ...launch.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return await new Promise((resolve, reject) => {
    child.once('spawn', () => resolve(child));
    child.once('error', (error: Error) => {
      reject(new AgentStartError({ because: 'spawn', detail: error.message }));
    });
  });
}

/**
 * The last thing the agent complained about.
 *
 * An agent that refuses to start usually says why
 * on its standard error and then exits, and that
 * sentence is the only useful thing an error card
 * can show. Only the tail is kept: the whole of a
 * chatty agent's output is not an error message.
 */
const STDERR_KEPT = 2_000;

function tail(child: ChildProcessWithoutNullStreams): () => string | undefined {
  let kept = '';

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    kept = `${kept}${chunk}`.slice(-STDERR_KEPT);
  });

  return () => (kept.trim() === '' ? undefined : kept.trim());
}

/** Runs `ask`, unless the turn ends first. */
async function race(
  waiting: Set<(answer: PermissionAnswer) => void>,
  ask: () => Promise<PermissionAnswer>,
): Promise<PermissionAnswer> {
  let release: ((answer: PermissionAnswer) => void) | undefined;

  const cancelled = new Promise<PermissionAnswer>((resolve) => {
    release = resolve;
    waiting.add(resolve);
  });

  try {
    return await Promise.race([ask(), cancelled]);
  } finally {
    if (release !== undefined) waiting.delete(release);
  }
}

function describe(failure: Failure): string {
  if (failure.because === 'version') {
    return `the agent speaks protocol ${failure.offered}, not ${failure.requested}`;
  }

  return `the agent failed to ${failure.because}: ${failure.detail}`;
}
