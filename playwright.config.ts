import { defineConfig, devices } from '@playwright/test';

/**
 * The webview specs.
 *
 * They drive the built browser bundles on a page
 * with no VS Code behind them, which is the only
 * honest way to test a graph: it measures the DOM
 * and works in pointer events, so drag-to-connect
 * and edge routing mean nothing under a simulated
 * one.
 *
 * No retries. A spec that passes on the second try
 * is a spec nobody can read a failure from, and
 * everything here is deterministic — no server, no
 * network, no clock.
 */
export default defineConfig({
  testDir: './tests/webview',
  globalSetup: './tests/webview/build.ts',
  retries: 0,
  fullyParallel: true,
  reporter: process.env.CI === undefined ? 'list' : 'github',
  use: {
    ...devices['Desktop Chrome'],
    // Tall enough that the canonical fixture — ten
    // blocks in a column a metre long — fits at
    // something near full size, so a handle is a
    // thing a pointer can find.
    viewport: { width: 1280, height: 1800 },
  },
});
