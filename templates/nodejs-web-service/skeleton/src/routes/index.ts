import { Router } from 'express';

import { createServiceController } from '../controllers/service.controller';
import { createHealthRouter } from '../health';
import { createServiceInfoService } from '../services/service-info.service';
import type { AppDependencies } from '../types';

// Every route the service answers, mounted in one place.
//
// A feature is a controller (HTTP in, HTTP out) over a service (the logic),
// wired together here:
//   src/controllers/<feature>.controller.ts   reads the request, writes the response
//   src/services/<feature>.service.ts         does the work; knows nothing about HTTP
{%- if values.withDatabase %}
//   src/db/                                   the queries; only services call them
{%- endif %}
//   src/types/                                the request and response shapes they share
//
// Express 4 does not catch a rejected promise: wrap an async handler in
// asyncHandler (src/middleware/async-handler.ts), which passes the rejection
// to next(err) and so to src/middleware/error-handler.ts.
export function createRouter({ config{% if values.withDatabase %}, logger, db{% endif %} }: AppDependencies): Router {
  const router = Router();

  router.use(createHealthRouter({% if values.withDatabase %}{ logger, db }{% endif %}));

  const service = createServiceController({
    serviceInfo: createServiceInfoService({ serviceName: config.serviceName }),
  });
  router.get('/', service.getInfo);

  return router;
}
