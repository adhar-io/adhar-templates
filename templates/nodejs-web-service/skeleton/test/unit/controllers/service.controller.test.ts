import type { Request, Response } from 'express';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createServiceController } from '../../../src/controllers/service.controller';
import type { ServiceInfo } from '../../../src/types';

test('getInfo answers with what the service describes', () => {
  const description: ServiceInfo = { service: 'example', status: 'ok' };
  const controller = createServiceController({ serviceInfo: { describe: () => description } });
  let sent: unknown;
  // Just the part of a response the controller uses.
  const res = {
    json: (body: unknown) => {
      sent = body;
    },
  } as unknown as Response<ServiceInfo>;
  controller.getInfo({} as Request, res);
  assert.deepEqual(sent, description);
});
