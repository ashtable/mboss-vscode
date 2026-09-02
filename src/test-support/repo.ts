import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Reading this repo's own files from a test.
 *
 * Several specs check the shipped manifest, the
 * two string bundles and the build output against
 * each other, and each of them needs the same
 * three or four paths. Sharing them here means a
 * moved file breaks one line rather than five
 * specs.
 */

/** The repository root, from anywhere under it. */
export const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/** Where the nested core checkout sits. */
export const CORE_ROOT = join(REPO_ROOT, 'mboss-core');

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** `package.json`, as data rather than as a module. */
export function packageManifest(): Record<string, unknown> {
  return readJson(join(REPO_ROOT, 'package.json'));
}

/** The strings `package.json`'s `%key%`s resolve to. */
export function packageNls(): Record<string, string> {
  return readJson(join(REPO_ROOT, 'package.nls.json'));
}

/** The strings `vscode.l10n.t()` resolves at run time. */
export function l10nBundle(): Record<string, string> {
  return readJson(join(REPO_ROOT, 'l10n', 'bundle.l10n.json'));
}

/** Every TypeScript file under `src/`, recursively. */
export function sourceFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);

      if (statSync(path).isDirectory()) return walk(path);
      return /\.tsx?$/.test(name) ? [path] : [];
    });

  return walk(join(REPO_ROOT, 'src'));
}

/**
 * Every `%key%` placeholder in `package.json`,
 * wherever it sits in the tree.
 *
 * Walking the parsed object rather than the raw
 * text means a placeholder in a contribution point
 * nobody thought of when this was written is still
 * found.
 */
export function placeholdersIn(value: unknown): string[] {
  if (typeof value === 'string') {
    const key = /^%([^%]+)%$/.exec(value);
    return key?.[1] === undefined ? [] : [key[1]];
  }
  if (Array.isArray(value)) return value.flatMap(placeholdersIn);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(placeholdersIn);
  }
  return [];
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}
