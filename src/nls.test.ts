import { describe, expect, it } from 'vitest';

import {
  packageManifest,
  packageNls,
  placeholdersIn,
} from './test-support/repo.js';

/**
 * `package.json` against `package.nls.json`, both
 * directions.
 *
 * A `%key%` with nothing behind it renders as the
 * literal `%key%` in the palette, with no error
 * anywhere. A key nobody references is a string a
 * translator will be asked to translate for a UI
 * that no longer shows it. Neither is visible
 * without a check like this one.
 */
describe('the contribution strings', () => {
  const used = new Set(placeholdersIn(packageManifest()));
  const declared = new Set(Object.keys(packageNls()));

  it('resolves every placeholder the manifest uses', () => {
    expect([...used].filter((key) => !declared.has(key))).toEqual([]);
  });

  it('carries no string the manifest stopped using', () => {
    expect([...declared].filter((key) => !used.has(key))).toEqual([]);
  });
});
