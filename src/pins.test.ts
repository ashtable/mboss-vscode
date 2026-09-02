import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './test-support/repo.js';

/**
 * Which branch of the nested library this extension
 * is built against.
 *
 * The compiler, the validation rules and the
 * document format all come from that checkout, so
 * the pin is what decides whether the code this
 * extension generates matches the code the MCP
 * server generates for the same document. A pin
 * that drifts is not a build failure — both sides
 * compile — it is two tools quietly disagreeing
 * about the same project.
 */

const gitmodules = readFileSync(join(REPO_ROOT, '.gitmodules'), 'utf8');

describe('the nested library', () => {
  it('is pinned to the released branch', () => {
    expect(gitmodules).toMatch(/^\s*branch = core-v0\.0\.6$/m);
  });

  it('is nested at the path the aliases point at', () => {
    expect(gitmodules).toMatch(/^\s*path = mboss-core$/m);
  });
});

/**
 * And the two the extension ships copies of.
 *
 * The server's repository nests the skill as well,
 * so one pin would have done — except that its
 * gitlink sits on an older revision than the
 * skill's own released branch, and vendoring
 * through it ships a skill missing a reference file
 * and carrying two rules its author has since
 * corrected. Two pins, named here, and the tool
 * surface they have to agree on is asserted where
 * the assets are read.
 */
describe('the vendored control plane', () => {
  it('takes the server from its released branch', () => {
    expect(gitmodules).toMatch(/^\s*path = mboss-mcp-server$/m);
    expect(gitmodules).toMatch(/^\s*branch = mcp-server-v0\.0\.1$/m);
  });

  it('takes the skill from its own released branch', () => {
    expect(gitmodules).toMatch(/^\s*path = mboss-skills$/m);
    expect(gitmodules).toMatch(/^\s*branch = skills-v0\.0\.1$/m);
  });
});
