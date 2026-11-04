// The contracts the layers share: what the application is built from, and the
// JSON bodies it answers with. Types only — nothing here exists at runtime —
// so any module may import them without depending on another's code.
import type { Config } from '../config';
{%- if values.withDatabase %}
import type { Database } from '../db';
{%- endif %}
import type { Logger } from '../lib/logger';

// What createApp() is built from, and the routes with it. Everything is
// passed in rather than reached for, so a test hands in {% if values.withDatabase %}a fake database or {% endif %}a
// logger that records instead of printing.
export interface AppDependencies {
  readonly config: Config;
  readonly logger: Logger;
{%- if values.withDatabase %}
  // Only what a request needs: src/server.ts keeps the whole pool to close it.
  readonly db: Pick<Database, 'now'>;
{%- endif %}
}

// GET /
export interface ServiceInfo {
  readonly service: string;
  readonly status: 'ok';
}
{%- if values.withDatabase %}

// GET /db
export type DatabaseStatus =
  | { readonly db: 'ok'; readonly now: Date }
  | { readonly db: 'error'; readonly error: string };
{%- endif %}

// Every error response: an RFC 9457 problem document, served as
// application/problem+json.
export interface ProblemDocument {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
}
