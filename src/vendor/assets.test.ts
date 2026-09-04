import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  ASSET_ROOT,
  MCP_ASSET_DIR,
  MCP_BUILD_COMMAND,
  SKILL_ASSET_DIR,
  shippedVendor,
} from './assets.js';
import { REPO_ROOT } from '../test-support/repo.js';
import {
  cleanRoots,
  fakeExtensionRoot,
  realExtensionRoot,
  scratchDir,
} from '../test-support/vendor.js';

/**
 * What the extension ships to put inside a project,
 * read back off disk.
 *
 * Everything here is about an installed extension
 * rather than this repository: the assets are
 * produced by a build step that reaches into
 * another checkout, and the only way they can go
 * wrong is by not being there. A missing one has to
 * fail as a sentence naming the command that makes
 * it, because the alternative is a package that
 * installs, activates, and then fails at the one
 * moment it was asked to make a project.
 */

afterAll(cleanRoots);

describe('the shipped assets', () => {
  const vendor = shippedVendor(realExtensionRoot());

  it('reads the version as one unambiguous token', () => {
    expect(vendor.version()).toMatch(/^\S+$/);
  });

  it('names the server build it came from', () => {
    expect(vendor.version()).toMatch(/^mcp-server-v\d+\.\d+\.\d+\+[0-9a-f]+$/);
  });

  it('reads the bundle and stamps it with that version', () => {
    const bundle = vendor.bundle();

    expect(bundle.version).toBe(vendor.version());
    expect(bundle.server.length).toBeGreaterThan(1_000_000);
  });

  /**
   * `references/conventions.md` is real, tracked,
   * shipped content that nothing else guards — it
   * is named by neither the skill's own closing
   * pointer nor the sync test in the server's repo.
   * Naming all four here is what stops it being
   * dropped on the assumption that it is unused.
   */
  it('reads every file of the skill', () => {
    expect(vendor.skill().map((file) => file.path)).toEqual([
      'SKILL.md',
      'references/conventions.md',
      'references/ir-examples.md',
      'references/tools.md',
    ]);
  });

  it('reads the skill as the text it is', () => {
    const [skill] = vendor.skill();

    expect(skill?.contents.startsWith('---\n')).toBe(true);
    expect(skill?.contents).toContain('name: mboss');
  });
});

/**
 * The two halves, held to one tool surface.
 *
 * The server's repository nests the skill and runs
 * this check against the copy *it* pins, which is
 * why it is repeated here: the skill beside that
 * bundle is the one *this* repository pins, and
 * the two have disagreed before. A check of
 * somebody else's pin says nothing about the pair
 * that actually ships together. A skill
 * naming a tool the bundle does not register is an
 * agent calling into nothing, with the failure
 * arriving as far from here as it is possible to
 * get.
 */
describe('the skill and the server it ships beside', () => {
  const skill = shippedVendor(realExtensionRoot()).skill();

  /** The tool names, from the frontmatter's own
   *  one-line list. */
  const claimed = (field: RegExp): string[] => {
    const body = skill.find((file) => file.path === 'SKILL.md')?.contents ?? '';

    return (field.exec(body)?.[1] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .sort();
  };

  const registered = (
    JSON.parse(
      readFileSync(
        join(REPO_ROOT, 'mboss-mcp-server', 'tools.manifest.json'),
        'utf8',
      ),
    ) as { tools: { name: string }[] }
  ).tools
    .map((tool) => tool.name)
    .sort();

  it('claims exactly the tools the server registers', () => {
    expect(claimed(/^\s*mboss-tools:\s*"([^"]*)"/m)).toEqual(registered);
  });

  it('allows exactly those, with the agent prefix', () => {
    expect(claimed(/^allowed-tools:\s*([\s\S]*?)\n---$/m)).toEqual(
      registered.map((name) => `mcp__mboss__${name}`).sort(),
    );
  });
});

describe('a made-up extension root', () => {
  it('reads back what was put there', () => {
    const vendor = shippedVendor(fakeExtensionRoot('probe-v1+abc'));

    expect(vendor.version()).toBe('probe-v1+abc');
    expect(vendor.bundle().server).toContain('hello');
    expect(vendor.skill().map((file) => file.path)).toEqual([
      'SKILL.md',
      'references/tools.md',
    ]);
  });
});

describe('an extension built without the vendored assets', () => {
  const withoutMcp = (): ReturnType<typeof shippedVendor> => {
    const root = fakeExtensionRoot('probe-v1+abc');

    rmSync(join(root, ASSET_ROOT, MCP_ASSET_DIR), { recursive: true });

    return shippedVendor(root);
  };

  it('names the build command when the bundle is missing', () => {
    expect(() => withoutMcp().bundle()).toThrow(MCP_BUILD_COMMAND);
  });

  it('names it when the version is missing too', () => {
    expect(() => withoutMcp().version()).toThrow(MCP_BUILD_COMMAND);
  });

  it('names it when the skill is missing', () => {
    const root = fakeExtensionRoot('probe-v1+abc');
    rmSync(join(root, ASSET_ROOT, SKILL_ASSET_DIR), { recursive: true });

    expect(() => shippedVendor(root).skill()).toThrow(MCP_BUILD_COMMAND);
  });

  it('says which file it looked for', () => {
    const root = scratchDir();

    expect(() => shippedVendor(root).version()).toThrow(root);
  });
});
