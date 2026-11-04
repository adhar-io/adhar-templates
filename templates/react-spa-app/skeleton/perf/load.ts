// Smoke load test for ${{ values.name }}, wired into the Performance Center.
//
// The Performance Center reads this file and perf/test.json straight from this
// repository as the test ${{ values.name }}-load. Its target is
// app=${{ values.name }}, so every run's gate verdict counts towards this
// service's production-readiness scorecard (perf_center_gate). Make it
// realistic: add the endpoints your users actually call, keep the thresholds
// in step with the latency target in catalog-info.yaml.
//
// TypeScript, run by k6 as it is: k6 strips the types itself (k6 v1.0 and
// later; the platform runs grafana/k6:1.3.0), so there is no build step. Its
// types come from @types/k6 (a devDependency); `npm run typecheck` checks it.
import http from 'k6/http'
import { check, sleep } from 'k6'
import type { Options } from 'k6/options'

const BASE: string = __ENV.BASE_URL || 'http://${{ values.name }}.test.svc.cluster.local'
const PATH: string = __ENV.TARGET_PATH || '/'

export const options: Options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 10 },
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<${{ values.latencyTargetMs or '500' }}'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
}

export default function (): void {
  const res = http.get(BASE + PATH, { tags: { name: 'target' } })
  check(res, { 'status is 2xx': (r) => r.status >= 200 && r.status < 300 })
  sleep(0.5)
}
