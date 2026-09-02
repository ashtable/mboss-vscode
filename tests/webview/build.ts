import { buildExtension } from '../../src/build.js';

/**
 * The specs drive the real bundles, so the real
 * bundles are built first.
 *
 * Here rather than in an npm script, so that
 * running one spec from an editor builds what it
 * is about instead of testing whatever was left in
 * `dist/` last time.
 */
export default async function build(): Promise<void> {
  await buildExtension();
}
