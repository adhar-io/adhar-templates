// Smoke load test for ${{ values.name }}, wired into the Performance Center.
//
// At scaffold time the console copies this file (with perf/test.json) into
// the Performance Center suite as tests/${{ values.name }}-load. Its target is
// app=${{ values.name }}, so every run's gate verdict counts towards this
// service's production-readiness scorecard (perf_center_gate). Make it
// realistic: add the endpoints your users actually call, keep the thresholds
// in step with the latency target in catalog-info.yaml.
import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE = __ENV.BASE_URL || 'http://${{ values.name }}.test.svc.cluster.local'
const PATH = __ENV.TARGET_PATH || '/'

export const options = {
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

export default function () {
  const res = http.get(BASE + PATH, { tags: { name: 'target' } })
  check(res, { 'status is 2xx': (r) => r.status >= 200 && r.status < 300 })
  sleep(0.5)
}
