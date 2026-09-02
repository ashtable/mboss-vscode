import { defineConfig } from 'vitest/config';

import { aliases } from './vitest.aliases.js';

/**
 * The suite that needs a real Postgres.
 *
 * Deliberately not in CI, matching the other repo in
 * this superproject that has one. What it proves —
 * that the statements this extension composes run
 * against the schema DBOS itself creates, and that a
 * replay writes the row DBOS writes — is not a claim
 * a doubled database can make, and it is also not a
 * claim worth a database in every pull request.
 *
 * `npm run test:integration`, with the superproject's
 * `docker compose up -d postgres` running.
 */
export default defineConfig({
  test: {
    include: ['test/integration/**/*.integration.test.ts'],
    // DBOS is a process-wide singleton — one file at
    // a time, no parallel launches.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
  resolve: { alias: aliases },
});
