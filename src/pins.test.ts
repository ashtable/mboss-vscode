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
