import { defineConfig } from 'vitest/config';

import { aliases } from './vitest.aliases.js';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Two specs run the real esbuild build and one
    // packages a VSIX, which is slower than the
    // default allows for on a cold cache.
    testTimeout: 120_000,
  },
  resolve: { alias: aliases },
});
