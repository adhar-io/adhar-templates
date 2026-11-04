{% if values.withDatabase -%}
import { Pool } from 'pg';

import type { Logger } from '../lib/logger';

// PostgreSQL: ONE connection pool for the process, opened at startup and
// closed at shutdown (src/server.ts). The connection string is DATABASE_URL,
// from the Secret CloudNativePG generates for deploy/base/database.yaml;
// nothing in this repository holds a credential.
//
// Add queries here (or as repository modules beside this file) and call them
// from a service; controllers never touch the pool.

export interface Database {
  // The pool itself, for a query that needs one client throughout (a
  // transaction: pool.connect(), then release()).
  readonly pool: Pool;
  // The database server's clock: what GET /db reports.
  now(): Promise<Date>;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  readonly connectionString: string | undefined;
  readonly logger: Logger;
}

export function createDatabase({ connectionString, logger }: DatabaseOptions): Database {
  const pool = new Pool({ connectionString });

  // node-postgres reports an IDLE connection the server dropped (a restart, a
  // failover, a backup) as an 'error' event on the pool, and an 'error' event
  // nobody listens to crashes the process. The pool opens a new connection on
  // its own; this only records that it happened.
  pool.on('error', (err) => {
    logger.warn('idle database connection lost', { err });
  });

  return {
    pool,
    async now() {
      const { rows } = await pool.query<{ now: Date }>('SELECT now() AS now');
      const [row] = rows;
      if (!row) throw new Error('SELECT now() returned no row');
      return row.now;
    },
    close: () => pool.end(),
  };
}
{%- else -%}
// No database: this service was scaffolded without one (withDatabase: false).
// To add PostgreSQL later, see "Database" in docs/index.md.
export {};
{%- endif %}
