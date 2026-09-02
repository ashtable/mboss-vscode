// A coding agent that does one scripted thing, so
// the connection module can be tested against a
// real process over real pipes.
//
// This peer is deliberately disposable. It exists
// for `src/acp/connection.test.ts` and
// `src/acp/capabilities.test.ts` and nothing else.
// It is NOT the end-to-end suite's stand-in agent
// and must not grow into a second one: no scenario
// files, no MCP client, no transcript, no second
// script to keep in step with this one. When a
// test needs behaviour this does not have, the
// answer is a different fixture, not another
// branch here.
//
// It speaks the wire by hand rather than through
// the SDK on purpose. Two copies of one library
// agreeing with each other say nothing about what
// goes down a pipe.
//
// Two environment variables steer it, because a
// mismatched handshake and a request the client
// never offered to serve are things one connection
// has to be watched surviving:
//   PEER_PROTOCOL_VERSION  what `initialize` answers
//   PEER_PROBE             one extra request mid-turn

import { appendFileSync, writeFileSync } from 'node:fs';

const SESSION = 'peer-session';
const PERMISSION = 'peer-permission';
const PROBE = 'peer-probe';

const PROBES = {
  terminal: ['terminal/create', { command: 'ls', args: [] }],
  read: ['fs/read_text_file', { path: process.env.PEER_PATH ?? '/nowhere' }],
  write: [
    'fs/write_text_file',
    { path: process.env.PEER_PATH ?? '/nowhere', content: 'written\n' },
  ],
};

// Everything the client said, for the spec to read
// back. Rewritten whole each time, so a spec never
// sees half a record.
const heard = {};
let promptId;
let buffer = '';

// One line per process started, when a spec asks
// for one with `--spawns <file>`. How many agents
// are running cannot be seen from inside the
// client, and counting them out here is the only
// honest way to ask.
//
// An argument rather than an environment variable
// because the environment is shared by every spec
// running in the same worker, and this one is
// about a single spec's own processes.
if (process.argv[2] === '--spawns') {
  appendFileSync(process.argv[3], `${process.pid}\n`);
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;

  for (let cut = buffer.indexOf('\n'); cut >= 0; cut = buffer.indexOf('\n')) {
    const line = buffer.slice(0, cut).trim();

    buffer = buffer.slice(cut + 1);
    if (line !== '') handle(JSON.parse(line));
  }
});

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}

function note(key, value) {
  heard[key] = value;
  if (process.env.PEER_RECORD !== undefined) {
    writeFileSync(process.env.PEER_RECORD, JSON.stringify(heard, null, 2));
  }
}

function update(body) {
  send({
    method: 'session/update',
    params: { sessionId: SESSION, update: body },
  });
}

function handle(message) {
  if (message.method === 'initialize') {
    note('initialize', message.params);
    send({
      id: message.id,
      result: {
        protocolVersion: Number(process.env.PEER_PROTOCOL_VERSION ?? '1'),
        agentCapabilities: {},
        agentInfo: { name: 'scripted-peer', version: '0.0.0' },
      },
    });

    return;
  }

  if (message.method === 'session/new') {
    note('sessionNew', message.params);
    send({ id: message.id, result: { sessionId: SESSION } });

    return;
  }

  if (message.method === 'session/prompt') {
    promptId = message.id;
    note('prompt', message.params);
    stream();

    return;
  }

  if (message.method === 'session/cancel') {
    note('cancelled', message.params);
    finish('cancelled');

    return;
  }

  if (message.id === PROBE) {
    note('probe', message.result ?? message.error);

    return;
  }

  if (message.id === PERMISSION) {
    note('permission', message.result ?? message.error);
    update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-1',
      status: 'completed',
    });
    finish('end_turn');
  }
}

function stream() {
  update({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'Wiring the booking flow.' },
  });
  update({
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: 'The confirm step needs a handler.' },
  });
  update({
    sessionUpdate: 'tool_call',
    toolCallId: 'call-1',
    title: 'Write lib/twilioChat.ts',
    kind: 'edit',
    status: 'in_progress',
    content: [
      {
        type: 'diff',
        path: '/project/lib/twilioChat.ts',
        newText: 'export async function twilioChat() {}\n',
      },
    ],
  });

  const probe = PROBES[process.env.PEER_PROBE ?? ''];

  if (probe !== undefined) {
    send({
      id: PROBE,
      method: probe[0],
      params: { sessionId: SESSION, ...probe[1] },
    });
  }

  send({
    id: PERMISSION,
    method: 'session/request_permission',
    params: {
      sessionId: SESSION,
      toolCall: {
        toolCallId: 'call-1',
        title: 'Write lib/twilioChat.ts',
        kind: 'edit',
      },
      options: [
        { optionId: 'yes', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'yes-always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'no', name: 'Reject', kind: 'reject_once' },
      ],
    },
  });
}

function finish(stopReason) {
  if (promptId === undefined) return;

  send({ id: promptId, result: { stopReason } });
  promptId = undefined;
}
