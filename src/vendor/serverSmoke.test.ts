import {
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { shippedVendor } from './assets.js';
import { createProject, scanCodeBehind } from '../core/index.js';
import { NodeSchema, handlerFit } from '../core/rules.js';
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

  /**
   * One handler, put to both surfaces that judge it.
   *
   * A transaction may not open a connection, and
   * neither surface decides that for itself: the
   * picker greys the row and the server refuses the
   * spec from the same account, in core, of what a
   * function reaches. But the picker reads the core
   * this repository nests and the server reads the
   * one bundled inside the file it ships, and those
   * are two pins, bumped by hand, on two different
   * days. Nothing else here compares them — the
   * spec beside this one reads the branch names out
   * of `.gitmodules`, and a branch name is the same
   * string however far behind the checkout is.
   *
   * When they part, both tools go on answering
   * confidently and differently about one file, and
   * an agent writes down the assignment the person
   * at the canvas is then unable to make by hand.
   * So the assertion is agreement, and the handler
   * is one whose refusal moved recently: the socket
   * is built on the line that dials it, a spelling
   * core only started walking into at the commit
   * both sides now carry.
   */
  const RESERVE_PORT = [
    "import { Socket } from 'node:net';",
    '',
    'export async function reservePort(port: number): Promise<void> {',
    '  new Socket().connect(port);',
    '}',
    '',
  ].join('\n');

  const PAY_CLAIM = {
    id: 'pay_claim',
    title: 'Pay the claim',
    kind: 'transaction',
    handler: { export: 'reservePort' },
    config: {},
  };

  const CHARGING_TRANSACTION = {
    title: 'A sample',
    nodes: [
      {
        id: 'start',
        title: 'Start',
        kind: 'trigger',
        config: { mode: 'manual' },
      },
      PAY_CLAIM,
    ],
    edges: [{ id: 'e1', from: { node: 'start' }, to: { node: 'pay_claim' } }],
  };

  /**
   * The scan is cached in the project it scanned,
   * under a hash of the code and nothing else — so
   * whichever surface reads `lib/` first is
   * answering for both until that code changes
   * again. That is the right cache to keep, but it
   * means the two can only be heard separately, in
   * a project the other one has not been near.
   * Hence a directory of its own here: nothing but
   * a `lib/`, which is all a scan reads.
   */
  function libOnly(): string {
    const dir = scratchDir('mboss-fit-');

    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(join(dir, 'lib', 'reservePort.ts'), RESERVE_PORT, 'utf8');

    return dir;
  }

  it('refuses the handler the canvas greys', async () => {
    const scan = scanCodeBehind(libOnly());
    const found = scan.ok
      ? scan.manifest.functions.find((fn) => fn.export === 'reservePort')
      : undefined;
    if (found === undefined) throw new Error('the scan offered no handler');

    // What the picker draws: greyed, with the facts
    // its note is written from.
    expect(handlerFit(NodeSchema.parse(PAY_CLAIM), found)).toMatchObject({
      fits: false,
      reason: { kind: 'external-call', callee: 'new Socket().connect' },
    });

    // And the shipped server, in the project it
    // ships into, which nothing above has scanned.
    //
    // Node's own declarations have to be reachable
    // from the bundle, and a vendored bundle looks
    // for them in the project rather than beside
    // itself, because it has nothing beside itself.
    // Not finding them is not a failure — the scan
    // carries on and simply records no calls — so a
    // project that has never installed anything
    // reports every handler clean whatever core is
    // inside the file. The one a person has is
    // installed, and this is that project.
    mkdirSync(join(project, 'lib'), { recursive: true });
    mkdirSync(join(project, 'node_modules'), { recursive: true });
    symlinkSync(
      join(REPO_ROOT, 'node_modules', '@types'),
      join(project, 'node_modules', '@types'),
    );
    writeFileSync(join(project, 'lib', 'reservePort.ts'), RESERVE_PORT, 'utf8');

    const checked = await (
      await connect()
    ).callTool({
      name: 'workflow_validate',
      arguments: { spec: CHARGING_TRANSACTION },
    });

    expect(checked.structuredContent).toMatchObject({
      valid: false,
      errors: [expect.objectContaining({ code: 'V16', nodeId: 'pay_claim' })],
    });
  });
});
