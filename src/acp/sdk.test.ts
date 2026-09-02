import { join } from 'node:path';

import {
  AGENT_METHODS,
  CLIENT_METHODS,
  PROTOCOL_VERSION,
  AgentSideConnection,
  agent,
  client,
  ndJsonStream,
  type NewSessionRequest,
} from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT, packageManifest, readJson } from '../test-support/repo.js';

/**
 * The protocol, as the pinned SDK actually ships
 * it.
 *
 * This file is written before any other ACP code
 * and is the reason the version below is the
 * version. Everything the connection module puts
 * on the wire is stated here as a value read out
 * of the SDK's own artifacts — its runtime
 * exports, and the JSON Schema it publishes — so
 * that an upgrade fails here, once, with the
 * changed field named, rather than out in a
 * running editor talking to somebody else's agent
 * binary.
 *
 * Two things drift independently and both are
 * checked: the documentation says one thing about
 * `session/new` and the shipped types say another
 * often enough that reading the docs is not
 * verification.
 *
 * ACP v1 is the stable surface — the bare package
 * entry point. v2 lives behind an
 * `experimental/v2` subpath and is explicitly
 * unstable, so nothing here reaches for it.
 */

/** The published wire contract, as data. */
type JsonSchema = {
  $defs: Record<
    string,
    {
      properties?: Record<string, unknown>;
      required?: string[];
      anyOf?: { required?: string[]; allOf?: { $ref?: string }[] }[];
    }
  >;
};

function wireSchema(): JsonSchema {
  return readJson(
    join(
      REPO_ROOT,
      'node_modules',
      '@agentclientprotocol',
      'sdk',
      'schema',
      'schema.json',
    ),
  );
}

function installedVersion(): string {
  return (
    readJson<{ version: string }>(
      join(
        REPO_ROOT,
        'node_modules',
        '@agentclientprotocol',
        'sdk',
        'package.json',
      ),
    ).version ?? ''
  );
}

describe('the pinned SDK', () => {
  /**
   * An exact version, not a range. The assertions
   * below describe one release's wire format, and
   * a range lets a fresh install move the wire
   * under them — which the test would then catch,
   * on somebody else's machine, at a moment
   * nobody chose.
   */
  it('is pinned to one release', () => {
    const dependencies = packageManifest().dependencies as Record<
      string,
      string
    >;

    expect(dependencies['@agentclientprotocol/sdk']).toBe('1.4.0');
    expect(installedVersion()).toBe('1.4.0');
  });

  /**
   * The number sent in `initialize`. An agent that
   * does not speak it answers with the latest it
   * does, and the session fails with a version
   * mismatch rather than talking past it.
   */
  it('speaks protocol version 1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('names every method the connection module calls', () => {
    expect(AGENT_METHODS.initialize).toBe('initialize');
    expect(AGENT_METHODS.session_new).toBe('session/new');
    expect(AGENT_METHODS.session_prompt).toBe('session/prompt');
    expect(AGENT_METHODS.session_cancel).toBe('session/cancel');
  });

  it('names every method the agent calls back on', () => {
    expect(CLIENT_METHODS.session_update).toBe('session/update');
    expect(CLIENT_METHODS.session_request_permission).toBe(
      'session/request_permission',
    );
    expect(CLIENT_METHODS.fs_read_text_file).toBe('fs/read_text_file');
    expect(CLIENT_METHODS.fs_write_text_file).toBe('fs/write_text_file');
  });

  /**
   * The framing. ACP is JSON-RPC over the agent's
   * stdin and stdout, newline delimited, and this
   * is what turns a pair of pipes into that.
   */
  it('frames a subprocess pair as a stream', () => {
    expect(ndJsonStream).toBeTypeOf('function');
  });

  /**
   * The client half is what this extension builds
   * on. The agent half is what anything speaking
   * back to it builds on — a scripted peer here,
   * and a stand-in agent in the end-to-end suite,
   * which is why its presence is pinned in the
   * same place as everything else.
   */
  it('offers both halves of a connection', () => {
    expect(client).toBeTypeOf('function');
    expect(agent).toBeTypeOf('function');
    expect(AgentSideConnection).toBeTypeOf('function');
  });
});

describe("session/new's parameters", () => {
  const defs = wireSchema().$defs;

  it('requires the working directory and the server list', () => {
    expect(defs.NewSessionRequest?.required).toEqual(['cwd', 'mcpServers']);
  });

  /**
   * The stdio variant is the union's bare member —
   * every other transport carries a `type`
   * discriminant and this one does not, so a
   * descriptor that named its transport would fail
   * to match anything.
   */
  it('describes a stdio server by name, command, args and env', () => {
    expect(defs.McpServerStdio?.required).toEqual([
      'name',
      'command',
      'args',
      'env',
    ]);

    const stdio = (defs.McpServer?.anyOf ?? []).filter((member) =>
      member.allOf?.some((entry) => entry.$ref === '#/$defs/McpServerStdio'),
    );

    expect(stdio).toHaveLength(1);
    expect(stdio[0]?.required).toBeUndefined();
  });

  /**
   * The one field worth a test of its own. `env`
   * is a *list of name/value pairs*, not the
   * object map every other tool in this ecosystem
   * spells it as, and a map serializes without
   * complaint into something the agent reads as an
   * empty environment.
   */
  it('carries environment variables as name/value pairs', () => {
    expect(defs.McpServerStdio?.properties?.env).toMatchObject({
      type: 'array',
      items: { $ref: '#/$defs/EnvVariable' },
    });

    expect(defs.EnvVariable?.required).toEqual(['name', 'value']);
  });

  /**
   * The same shape again, this time as the
   * compiler sees it. The schema above is what the
   * agent validates against; this is what stops
   * the connection module from being written
   * against a different picture of it.
   */
  it('type-checks the descriptor the connection module builds', () => {
    const params = {
      cwd: '/tmp/project',
      mcpServers: [
        {
          name: 'mboss',
          command: 'node',
          args: ['/tmp/project/.mboss/mcp/server.js'],
          env: [],
        },
      ],
    } satisfies NewSessionRequest;

    expect(JSON.parse(JSON.stringify(params))).toEqual({
      cwd: '/tmp/project',
      mcpServers: [
        {
          name: 'mboss',
          command: 'node',
          args: ['/tmp/project/.mboss/mcp/server.js'],
          env: [],
        },
      ],
    });
  });
});
