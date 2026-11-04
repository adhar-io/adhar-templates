import type { ServiceInfo } from '../types';

// What GET / reports. Services hold the business logic: plain functions over
// plain data, with no req or res, so they are called the same way from a
// controller, a job or a test.
export interface ServiceInfoService {
  describe(): ServiceInfo;
}

export function createServiceInfoService({ serviceName }: { readonly serviceName: string }): ServiceInfoService {
  return {
    describe: () => ({ service: serviceName, status: 'ok' }),
  };
}
