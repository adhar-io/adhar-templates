import type { Request, Response } from 'express';

import type { ServiceInfoService } from '../services/service-info.service';
import type { ServiceInfo } from '../types';

// GET / — what this service is. A controller translates between HTTP and a
// service: it reads the request, calls the service, and writes the status and
// body. It holds no logic of its own, so the logic is tested without HTTP.
export interface ServiceController {
  // Arrow-function properties, not methods: routes pass them to Express on
  // their own (`router.get('/', service.getInfo)`), with no `this`.
  readonly getInfo: (req: Request, res: Response<ServiceInfo>) => void;
}

export function createServiceController({ serviceInfo }: { readonly serviceInfo: ServiceInfoService }): ServiceController {
  return {
    getInfo: (_req, res) => {
      res.json(serviceInfo.describe());
    },
  };
}
