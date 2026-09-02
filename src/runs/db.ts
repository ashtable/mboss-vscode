import { DBOSClient } from '@dbos-inc/dbos-sdk';
import pg from 'pg';

import type { ForkClient } from './replay.js';

/**
 * The two connections this view opens, and nothing
 * else.
 *
 * Both are short-lived on purpose. This extension
 * does not run alongside the app it is looking at,
 * a person opens the panel occasionally, and a
 * connection held for as long as an editor window
 * would keep a slot on somebody's development
 * database all day.
 *
 * There is no logic in this file, deliberately.
 * Everything that decides anything takes one of
 * these as an argument, which is what lets it be
 * driven without a database — and what leaves this
 * file with nothing to be wrong about beyond the
 * connection strings it is handed.
 */

/** Where a read goes, and how to stop reading. */
export type Database = {
  query<Row>(text: string, values: unknown[]): Promise<Row[]>;

  close(): Promise<void>;
};

export type OpenDatabase = (url: string) => Promise<Database>;

export type OpenFork = (url: string) => Promise<ForkClient>;

/**
 * `max: 1` because the statements run one after
 * the other and nothing else shares this pool.
 */
export const openDatabase: OpenDatabase = async (url) => {
  const pool = new pg.Pool({ connectionString: url, max: 1 });

  return {
    query: async <Row>(text: string, values: unknown[]) => {
      const { rows } = await pool.query(text, values);

      return rows as Row[];
    },
    close: () => pool.end(),
  };
};

/**
 * DBOS's own client, for the one write.
 *
 * `DBOSClient.create` needs a connection string and
 * nothing else: no launch, no registered workflows,
 * no importing the target project's generated code.
 * That is what makes forking something an editor
 * can do at all — the static `DBOS.forkWorkflow` is
 * only callable from inside a launched process.
 */
export const openFork: OpenFork = async (url) =>
  await DBOSClient.create({ systemDatabaseUrl: url });
