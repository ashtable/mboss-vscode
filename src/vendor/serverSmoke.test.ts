import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { shippedVendor } from './assets.js';
import { createProject } from '../core/index.js';
import { REPO_ROOT } from '../test-support/repo.js';
import {
  cleanRoots,
  realExtensionRoot,
  scratchDir,
} from '../test-support/vendor.js';

/**
 * The control plane a new project gets, answering
 * for itself.
 *
 * The bundle is built in another repository,
 * shipped inside this one as bytes, and copied out
 * into a project that has no `node_modules` and no
 * repository around it. Nothing about that is
 * visible to the type checker, to any spec that
 * reads a file, or to the server's own tests, which
 * run against the copy sitting next to what built
 * it. Only spawning the vendored file the way an
 * agent does can say whether what this extension
 * ships still works where it lands.
 *
 * The server takes no project argument. It works
 * out which project it is talking about by walking
 * up from its own working directory looking for a
 * control directory, so the `cwd` here is the whole
 * of the wiring under test.
 */

/**
 * The tools the server's own repository says it
 * has, read as data.
 *
 * Not imported: the nested checkout is a build
 * context here, and a test that imported the
 * registry would stop testing that every tool
 * survived being bundled.
 */
function registeredTools(): string[] {
  const manifest = JSON.parse(
    readFileSync(
      join(REPO_ROOT, 'mboss-mcp-server', 'tools.manifest.json'),
      'utf8',
    ),
  ) as { tools: { name: string }[] };

  return manifest.tools.map((tool) => tool.name).sort();
}

describe('the vendored MCP server', () => {
  const clients: Client[] = [];
  let project: string;

  beforeAll(async () => {
    const vendor = shippedVendor(realExtensionRoot());

    // Resolved, because the server answers with the
    // paths it walked to and a temporary directory
    // on this platform is reached through a symlink.
    project = join(realpathSync(scratchDir('mboss-smoke-')), 'app');
    await createProject(project, {
      name: 'smoke_app',
      mcpBundle: vendor.bundle(),
    });
  });

  afterAll(async () => {
    while (clients.length > 0) await clients.pop()?.close();
    cleanRoots();
  });

  async function connect(): Promise<Client> {
    const client = new Client({ name: 'vendor smoke', version: '0.0.0' });
    clients.push(client);

    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(project, '.mboss', 'mcp', 'server.js')],
        cwd: project,
      }),
    );

    return client;
  }

  it('lists every tool the server registers', async () => {
    const { tools } = await (await connect()).listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(registeredTools());
  });

  /**
   * Eleven, spelled out, because "all of them" is
   * true of a bundle that tree-shook ten away.
   */
  it('lists eleven of them', () => {
    expect(registeredTools()).toHaveLength(11);
  });

  /**
   * Which project it answers about is decided by
   * where it was started, so this is the assertion
   * that the working directory reached it.
   */
  it('answers about the project it was started in', async () => {
    const created = await (
      await connect()
    ).callTool({
      name: 'workflow_create',
      arguments: { name: 'smoke' },
    });

    expect(created.isError ?? false).toBe(false);
    expect(created.structuredContent).toMatchObject({
      name: 'smoke',
      path: join(project, '.mboss', 'workflows', 'smoke.workflow.json'),
    });
  });
});
