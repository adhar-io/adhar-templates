import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createServiceInfoService } from '../../../src/services/service-info.service';

test('describes the service by name, as ok', () => {
  const service = createServiceInfoService({ serviceName: '${{ values.name }}' });
  assert.deepEqual(service.describe(), { service: '${{ values.name }}', status: 'ok' });
});
