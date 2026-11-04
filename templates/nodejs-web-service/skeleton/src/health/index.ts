import { Router } from 'express';
{%- if values.withDatabase %}

import type { Logger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import type { AppDependencies, DatabaseStatus } from '../types';
{%- endif %}

// GET /healthz is the path BOTH probes in deploy/base/rollout.yaml call, the
// one the platform's chaos suite watches (deploy/base/resilience.yaml), and
// the load test's default target. It answers while the process can serve
// HTTP and checks nothing else, on purpose: a probe that also checked a
// dependency would take every pod out of the Service (readiness) or restart
// them all (liveness) the moment that dependency blinked, turning its
// incident into an outage of this service.
export function createHealthRouter({% if values.withDatabase %}{ logger, db }: { readonly logger: Logger; readonly db: AppDependencies['db'] }{% endif %}): Router {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.type('text/plain').send('ok');
  });
{%- if values.withDatabase %}

  // GET /db is diagnostics, not a probe: can THIS pod reach PostgreSQL now?
  // Why it cannot is logged, not returned: a connection error names hosts
  // and users.
  router.get(
    '/db',
    asyncHandler(async (_req, res) => {
      try {
        res.json({ db: 'ok', now: await db.now() } satisfies DatabaseStatus);
      } catch (err) {
        logger.warn('database check failed', { err });
        res.status(500).json({ db: 'error', error: 'database unavailable' } satisfies DatabaseStatus);
      }
    }),
  );
{%- endif %}

  return router;
}
