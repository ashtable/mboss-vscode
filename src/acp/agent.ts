import type { Disposable } from 'vscode';

import { emitter } from '../emitter.js';
import {
  AgentStartError,
  openAgentSession,
  type AgentSession,
  type PermissionAnswer,
  type PermissionOptionKind,
  type PermissionRequest,
} from './connection.js';
import { readTextFile, type AgentFiles } from './fs.js';
import {
  permissionMemory,
  standingAnswer,
  toolKey,
  type Memento,
} from './permissions.js';
import type { AgentCommand, AgentId } from './registry.js';
import {
  IDLE,
  nextSession,
  sendingWhile,
  type Failure,
  type SessionEvent,
  type SessionState,
} from './session.js';
import { foldUpdate, type PermissionPrompt } from './transcript.js';
import type {
  DiagnosticEntry,
  FileEditEntry,
  ToolEntry,
  TranscriptEntry,
} from './transcript.js';

/**
 * The agent, as the extension holds it.
 *
 * One of these lives for as long as the window
 * does, outside every view. That is the point: the
 * panel is a view in the activity bar, and VS Code
 * disposes a hidden view and builds it again when
 * it is shown. A session held by the view would be
 * a second agent process every time somebody
 * selected a node, and a transcript held by the
 * view would be gone with it.
 *
 * So the agent starts on the first thing somebody
 * types, never on a view being resolved, and
 * everything the panel draws is read from here.
 */

export type PanelStatus =
  | 'untrusted'
  | 'no-project'
  | 'no-agent'
  | 'idle'
  | 'spawning'
  | 'ready'
  | 'streaming'
  | 'awaiting-permission'
  | 'failed';

/** Everything the panel needs to draw itself. */
export type PanelState = {
  status: PanelStatus;

  agent: AgentId | undefined;

  transcript: TranscriptEntry[];

  prompt: PermissionPrompt | undefined;

  failure: Failure | undefined;
};

/**
 * The slice of the editor this needs.
 *
 * A fourth narrow interface rather than more
 * methods on the canvas's, the watchers' or the
 * project command's: every stand-in a spec writes
 * has to implement the whole of whatever it takes,
 * and one wide interface makes each of them
 * implement things it has no opinion about.
 */
export type PanelHost = {
  isTrusted(): boolean;

  /** Where a session would run. The first folder
   *  in the window. */
  project(): string | undefined;

  /** Which agent is chosen, and how to start it.
   *  Read fresh, because the settings can change
   *  under a running session. */
  chosen(): { id: AgentId; launch: AgentCommand | undefined } | undefined;

  files: AgentFiles;

  /** Where an "always" answer is kept — the
   *  workspace's own state, never the editor's. */
  state: Memento;
};

export type AgentPanel = {
  state(): PanelState;

  /**
   * Called whenever anything above moves. Returns
   * the way to stop being called.
   *
   * The view that listens is disposed and rebuilt
   * every time it is hidden, which in this
   * extension is every time somebody selects a
   * block — so a listener with no way off this
   * list would leave one dead view being repainted
   * per selection, for as long as the window is
   * open.
   */
  onChanged(listener: () => void): Disposable;

  /** Repaints from state that changed outside this
   *  module — trust granted, a setting written. */
  refresh(): void;

  /**
   * Adds an entry the extension wrote itself.
   *
   * A proposal applied, a regeneration that failed,
   * a workflow run — things a person needs to see
   * in the same column as what the agent did,
   * because that is the order they happened in.
   * What tells them apart is the entry's own
   * provenance.
   */
  note(entry: ToolEntry | DiagnosticEntry): void;

  /** Marks one pending file edit kept. Does nothing
   *  to a decision already made, or to an id that
   *  names no file. */
  keep(id: string): void;

  /**
   * Writes a pending file edit's `oldText` back — or,
   * for a file that did not exist before it, removes
   * the file — but only while the file's current
   * content still equals `newText`. Otherwise the
   * entry becomes `changed-since` and nothing is
   * written.
   */
  undo(id: string): Promise<void>;

  /** Starts the agent if it is not running, then
   *  runs one turn. */
  send(text: string): Promise<void>;

  cancel(): Promise<void>;

  /** Answers whatever the agent is waiting on. */
  answer(optionId: string, kind: PermissionOptionKind): Promise<void>;

  /** Ends the session and forgets the
   *  conversation. Changing agents is a new
   *  conversation with somebody else. */
  reset(): void;

  dispose(): void;
};

export function agentPanel(host: PanelHost): AgentPanel {
  const memory = permissionMemory(host.state);
  const changes = emitter();

  let session: SessionState = IDLE;
  let live: AgentSession | undefined;
  let transcript: TranscriptEntry[] = [];
  let answering: ((answer: PermissionAnswer) => void) | undefined;

  /**
   * Prompts that arrived while the agent was
   * working, oldest first.
   *
   * The composer hides the send control mid-turn,
   * so a person cannot type one — but approving a
   * proposal sends a prompt of its own, and the
   * proposal being approved was written by the turn
   * that is still running. Arriving mid-turn is
   * therefore the ordinary case rather than the
   * exotic one, and dropping it would be an
   * approval that wrote the document, regenerated
   * the project, and never told the agent.
   */
  let queued: string[] = [];

  const changed = changes.fire;

  const pendingFile = (id: string): FileEditEntry | undefined => {
    const found = transcript.find(
      (entry): entry is FileEditEntry => entry.at === 'file' && entry.id === id,
    );

    return found?.decision === 'pending' ? found : undefined;
  };

  const decideFile = (
    entry: FileEditEntry,
    decision: FileEditEntry['decision'],
  ): void => {
    transcript = transcript.map((item) =>
      item === entry ? { ...entry, decision } : item,
    );
    changed();
  };

  const move = (event: SessionEvent): void => {
    const next = nextSession(session, event);

    if (next === session) return;

    session = next;
    changed();
  };

  const teardown = (): void => {
    live?.close();
    live = undefined;
    answering = undefined;
    move({ is: 'stopped' });
  };

  const onPermission = async (
    request: PermissionRequest,
  ): Promise<PermissionAnswer> => {
    const key = toolKey(request.toolCall);
    const standing = standingAnswer(request, memory.standing(key));

    // Already promised. Answering without asking is
    // the whole point of having promised.
    if (standing !== undefined) return standing;

    return await new Promise<PermissionAnswer>((resolve) => {
      answering = resolve;
      move({ is: 'permissionRequested', prompt: asPrompt(key, request) });
    });
  };

  const start = async (
    project: string,
    launch: AgentCommand,
  ): Promise<void> => {
    move({ is: 'start' });

    try {
      live = await openAgentSession(
        { command: launch.command, args: launch.args, cwd: project },
        {
          onUpdate: (update) => {
            transcript = foldUpdate(transcript, update);
            changed();
          },
          onPermission,
          readTextFile: async (request) =>
            await readTextFile(host.files, request),
          writeTextFile: async (request) =>
            await host.files.write(request.path, request.content),
          onClosed: () => teardown(),
        },
      );

      move({ is: 'started', sessionId: live.sessionId });
    } catch (error) {
      move({ is: 'failed', failure: whyItFailed(error) });
    }
  };

  const send = async (text: string): Promise<void> => {
    const project = host.project();
    const chosen = host.chosen();

    if (!host.isTrusted() || project === undefined) return;
    if (chosen?.launch === undefined) return;

    // Whether this can go now is the session's
    // question, answered beside its states: a prompt
    // that arrives mid-turn, or while the agent is
    // still coming up, waits here for its turn.
    const sending = sendingWhile(session);

    if (sending === 'queue') {
      queued.push(text);

      return;
    }

    if (sending === 'spawn') await start(project, chosen.launch);

    // A start that failed has nothing to send this
    // to, and nothing that was waiting for it either:
    // the person has been shown why, and their next
    // prompt starts afresh rather than behind a
    // prompt from before.
    if (live === undefined) {
      queued = [];

      return;
    }

    transcript = [
      ...transcript,
      {
        at: 'message',
        id: `message-${transcript.filter((e) => e.at === 'message').length}`,
        from: 'user',
        text,
      },
    ];
    move({ is: 'prompted' });
    changed();

    try {
      await live.prompt(text);
    } finally {
      move({ is: 'turnEnded' });
    }

    const next = queued.shift();

    if (next !== undefined) await send(next);
  };

  return {
    state: () => {
      const chosen = host.chosen();

      return {
        status: statusOf(host, chosen, session),
        agent: chosen?.id,
        transcript,
        prompt:
          session.at === 'awaitingPermission' ? session.prompt : undefined,
        failure: session.at === 'failed' ? session.failure : undefined,
      };
    },

    onChanged: changes.on,

    refresh: changed,

    note: (entry) => {
      transcript = [...transcript, entry];
      changed();
    },

    keep: (id) => {
      const entry = pendingFile(id);

      if (entry !== undefined) decideFile(entry, 'kept');
    },

    undo: async (id) => {
      const entry = pendingFile(id);

      // Nothing was kept past the cap, so there is
      // nothing to compare or to write back.
      if (entry === undefined || entry.newText === undefined) return;

      let current: string | undefined;

      try {
        current = await host.files.read(entry.path);
      } catch {
        current = undefined;
      }

      if (current !== entry.newText) {
        decideFile(entry, 'changed-since');

        return;
      }

      if (entry.isNew) {
        await host.files.remove(entry.path);
      } else {
        await host.files.write(entry.path, entry.oldText ?? '');
      }

      decideFile(entry, 'undone');
    },

    send,

    cancel: async () => {
      await live?.cancel();
    },

    answer: async (optionId, kind) => {
      const waiting = session.at === 'awaitingPermission' ? session : undefined;
      const offered = waiting?.prompt.options.find(
        (option) => option.optionId === optionId && option.kind === kind,
      );

      // The panel is a frame running scripts. An
      // option the agent never offered is not an
      // answer, whoever sent it.
      if (waiting === undefined || offered === undefined) return;

      await memory.remember(waiting.prompt.toolKey, kind);

      const resolve = answering;

      answering = undefined;
      move({ is: 'permissionAnswered' });
      resolve?.({ optionId });
    },

    reset: () => {
      transcript = [];
      queued = [];
      teardown();
      changed();
    },

    dispose: () => {
      changes.dispose();
      live?.close();
      live = undefined;
    },
  };
}

/**
 * Why there is nothing to talk to, in the order a
 * person can act on.
 *
 * Trust first, because nothing else is possible
 * without it; then a folder, because a session is
 * opened in one; then an agent.
 */
function statusOf(
  host: PanelHost,
  chosen: { launch: AgentCommand | undefined } | undefined,
  session: SessionState,
): PanelStatus {
  if (!host.isTrusted()) return 'untrusted';
  if (host.project() === undefined) return 'no-project';
  if (chosen?.launch === undefined) return 'no-agent';

  switch (session.at) {
    case 'awaitingPermission':
      return 'awaiting-permission';
    default:
      return session.at;
  }
}

/** The agent's own words, kept, plus what an
 *  answer is remembered against. */
function asPrompt(key: string, request: PermissionRequest): PermissionPrompt {
  return {
    toolCallId: request.toolCall.toolCallId,
    title: request.toolCall.title ?? request.toolCall.toolCallId,
    toolKey: key,
    options: request.options.map((option) => ({
      optionId: option.optionId,
      label: option.name,
      kind: option.kind,
    })),
  };
}

function whyItFailed(error: unknown): Failure {
  if (error instanceof AgentStartError) return error.failure;

  return { because: 'spawn', detail: String(error) };
}
