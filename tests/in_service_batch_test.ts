/**
 * In-service batch jobs on Quartz (design 0025 §5.20.9, TPL-Q.1 and TPL-Q.2).
 *
 * `springboot-web-service` offers `inServiceBatch`: Spring Batch jobs that run INSIDE the service, on
 * Adhar Kit's clustered Quartz scheduler, rather than as a platform BatchJob. Ticked, the skeleton must
 * carry everything that makes that work, and each piece fails in a way nobody attributes to it:
 *
 *   the database                   the Quartz job store and the JobRepository live in it; the option
 *                                  switches withDatabase on, or the service cannot start
 *   adhar-kit-batch + Quartz       without the Quartz starter the kit refuses `engine: quartz`
 *   one zone                       a Quartz `daily` trigger runs in the JVM's zone and the kit refuses
 *                                  one in another, so the scheduler's zone is also the image's (TZ),
 *                                  the tests' and `spring-boot:run`'s (-Duser.timezone)
 *   triggers for a declared job    a trigger naming a job, a calendar or a parameter that is not there
 *                                  fails the start
 *   the report Role                without `create` and `get`/`update`/`patch` on
 *                                  <scheduler-name>-batch-schedules every report write fails, counted,
 *                                  and the Console and `adhar batch schedules` show nothing
 *   two alerts                     there is no BatchJob, so the platform composes none
 *   QuartzRestartIT                two replicas on one PostgreSQL, one killed mid-run (AQ.3)
 *
 * Unticked, none of it renders: the files exist (a skeleton file is never dropped) and are empty.
 *
 * `springboot-batch-service` keeps the platform path, and its docs say when to use which (§5.20.1).
 */
import { assert, assertEquals, assertMatch } from '@std/assert'
import { parse as parseYaml, parseAll as parseYamlAll } from '@std/yaml'
import { renderContent, type Values } from './lib/render.ts'
import { filesUnder, read, type Template, templates, valueKeys, valuesFor, type Variant } from './lib/templates.ts'

// deno-lint-ignore no-explicit-any
type Doc = Record<string, any>

const WEB = templates().find((t) => t.id === 'springboot-web-service') as Template
const BATCH_SERVICE = templates().find((t) => t.id === 'springboot-batch-service') as Template
const ENVS = ['dev', 'test', 'prod'] as const
const BATCH_SOURCES = ['src/main/java/io/adhar/service/batch', 'src/test/java/io/adhar/service/batch']
const RESTART_IT = 'src/test/java/io/adhar/service/QuartzRestartIT.java'

/** The values with in-service batch jobs ticked (and nothing else changed). */
function on(set: Values = {}): Values {
  return valuesFor(WEB, 'defaults', 'demo-app', { inServiceBatch: true, ...set })
}

function render(rel: string, values: Values, t: Template = WEB): string {
  return renderContent(read(`${t.skeleton}/${rel}`), values)
}

function yamlDocs(rel: string, values: Values): Doc[] {
  return (parseYamlAll(render(rel, values)) as Doc[]).filter((d) => d && typeof d === 'object')
}

/** application.properties as a map; a later line wins, as in Spring. */
function properties(values: Values): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of render('src/main/resources/application.properties', values).split('\n')) {
    const m = line.match(/^\s*([^#!\s][^=]*?)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

/** Every rendered Java source with in-service batch jobs, by path. */
function javaSources(values: Values): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of filesUnder(WEB.skeleton).filter((f) => f.endsWith('.java'))) out[f] = render(f, values)
  return out
}

/** `public static final String X = "y";` across the sources, so @JobParam(name = X) resolves. */
function constants(sources: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const src of Object.values(sources)) {
    for (const m of src.matchAll(/static\s+final\s+String\s+(\w+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2]
  }
  return out
}

interface DeclaredJob {
  bean: string
  params: Record<string, { allowed: string[]; schedule: boolean; type: string }>
}

/** The jobs the sources declare with @AdharBatchJob on a @Bean method, with their parameters. */
function declaredJobs(sources: Record<string, string>): DeclaredJob[] {
  const names = constants(sources)
  const value = (raw: string) => (raw.startsWith('"') ? raw.slice(1, -1) : names[raw] ?? raw)
  const jobs: DeclaredJob[] = []
  for (const src of Object.values(sources)) {
    for (const m of src.matchAll(/@Bean\((\w+|"[^"]*")\)\s*@AdharBatchJob\(([\s\S]*?)\)\s*public\s+Job\s/g)) {
      const params: DeclaredJob['params'] = {}
      for (const p of m[2].matchAll(/@JobParam\(([^)]*)\)/g)) {
        const name = p[1].match(/name\s*=\s*(\w+|"[^"]*")/)
        if (!name) continue
        const allowed = [...(p[1].match(/allowed\s*=\s*\{([^}]*)\}/)?.[1] ?? '').matchAll(/"([^"]*)"/g)].map((a) => a[1])
        params[value(name[1])] = {
          allowed,
          schedule: /source\s*=\s*ParamSource\.SCHEDULE/.test(p[1]),
          type: p[1].match(/type\s*=\s*ParamType\.(\w+)/)?.[1] ?? 'STRING',
        }
      }
      jobs.push({ bean: value(m[1]), params })
    }
  }
  return jobs
}

/** adhar.batch.quartz.triggers.<job>[n].<field> → {job: [{field: value}]}. */
function triggers(props: Record<string, string>): Record<string, Record<string, string>[]> {
  const out: Record<string, Record<string, string>[]> = {}
  for (const [k, v] of Object.entries(props)) {
    const m = k.match(/^adhar\.batch\.quartz\.triggers\.(\w+)\[(\d+)\]\.(.+)$/)
    if (!m) continue
    const list = (out[m[1]] ??= [])
    ;(list[Number(m[2])] ??= {})[m[3]] = v
  }
  return out
}

function rollout(values: Values): Doc {
  const r = yamlDocs('deploy/base/rollout.yaml', values).find((d) => d.kind === 'Rollout')
  assert(r, 'deploy/base/rollout.yaml holds the Rollout')
  return r
}

function reportName(props: Record<string, string>): string {
  const scheduler = props['adhar.batch.quartz.scheduler-name'] ?? props['spring.application.name']
  return (props['adhar.batch.quartz.report.name'] ?? `${scheduler}-batch-schedules`).toLowerCase()
}

Deno.test('springboot-web-service offers in-service batch jobs, off by default, and asking for them asks for the database', () => {
  assert(WEB, 'springboot-web-service is the template §5.20.9 gives the option')
  // deno-lint-ignore no-explicit-any
  const pages = (WEB.doc as any).spec.parameters as Doc[]
  const param = pages.map((p) => p.properties?.inServiceBatch).find(Boolean)
  assert(param, 'template.yaml must declare the parameter inServiceBatch')
  assertEquals(param.type, 'boolean')
  assertEquals(param.default, false, 'in-service batch jobs are opt-in: the platform BatchJob stays the default')
  assert(valueKeys(WEB).has('inServiceBatch'), 'the fetch:template values map must pass inServiceBatch to the skeleton')
  for (
    const [set, db] of [[{ inServiceBatch: true, withDatabase: false }, true], [{ inServiceBatch: false, withDatabase: false }, false], [
      { inServiceBatch: false, withDatabase: true },
      true,
    ]] as const
  ) {
    assertEquals(valuesFor(WEB, 'defaults', 'demo-app', set).withDatabase, db, `withDatabase for ${JSON.stringify(set)}`)
  }
  // The Console reads the batch family from the label, the name or the `batch` tag; a web service with
  // in-service jobs is not one, or it would be required to ship a BatchJob.
  const meta = WEB.doc.metadata as Doc
  assert(meta.labels?.['adhar.io/workload'] !== 'batch' && !(meta.tags ?? []).map(String).includes('batch'))
})

Deno.test('in-service batch jobs: the POM brings adhar-kit-batch, Quartz and PostgreSQL, and every JVM runs in the scheduler zone', () => {
  for (const set of [{}, { withAuth: false, withCache: true, withKafka: true }]) {
    const values = on(set)
    const pom = render('pom.xml', values)
    for (const a of ['adhar-kit-batch', 'spring-boot-starter-quartz', 'postgresql', 'testcontainers-postgresql']) {
      assert(pom.includes(`<artifactId>${a}</artifactId>`), `pom.xml must declare ${a}`)
    }
    const props = properties(values)
    const zone = props['adhar.batch.scheduler.time-zone']
    assert(zone, 'application.properties must name adhar.batch.scheduler.time-zone')
    // A daily trigger runs in the JVM's zone: the build's test JVMs, spring-boot:run and the image.
    for (const plugin of ['maven-surefire-plugin', 'maven-failsafe-plugin', 'spring-boot-maven-plugin']) {
      const block = pom.match(new RegExp(`<artifactId>${plugin}</artifactId>([\\s\\S]*?)</plugin>`))?.[1] ?? ''
      assert(block.includes(`-Duser.timezone=${zone}`), `pom.xml: ${plugin} must run its JVM with -Duser.timezone=${zone}`)
      // The parent's JaCoCo agent rides on @{argLine}; an argLine without it measures nothing and fails the gate.
      if (plugin !== 'spring-boot-maven-plugin') assert(block.includes('@{argLine}'), `pom.xml: ${plugin}'s argLine must keep @{argLine}`)
    }
    const env = (rollout(values).spec.template.spec.containers[0].env ?? []) as Doc[]
    assertEquals(env.find((e) => e.name === 'TZ')?.value, zone, 'the Rollout must run the image in the scheduler zone (TZ)')
    for (const [k, v] of Object.entries(props)) {
      if (/^adhar\.batch\.quartz\.(calendars\.\w+|triggers\.\w+\[\d+\])\.time-zone$/.test(k)) assertEquals(v, zone, `${k} must be the scheduler zone`)
    }
  }
  for (const v of ['defaults', 'all-off'] as Variant[]) {
    const values = valuesFor(WEB, v, 'demo-app', { withDatabase: true })
    const pom = render('pom.xml', values)
    for (const a of ['adhar-kit-batch', 'spring-boot-starter-quartz']) {
      assert(!pom.includes(`<artifactId>${a}</artifactId>`), `(${v}) ${a} without inServiceBatch`)
    }
    assert(!pom.includes('user.timezone'), `(${v}) the JVM's zone is pinned only for in-service batch jobs`)
    assert(!(rollout(values).spec.template.spec.containers[0].env ?? []).some((e: Doc) => e.name === 'TZ'), `(${v}) no TZ without inServiceBatch`)
  }
})

Deno.test('in-service batch jobs: the quartz engine, a cron and a daily trigger on a calendar it defines, for a job the sources declare', () => {
  const values = on()
  const props = properties(values)
  assertEquals(props['adhar.batch.scheduler.enabled'], 'true')
  assertEquals(props['adhar.batch.scheduler.engine'], 'quartz')
  assert(props['adhar.batch.quartz.report.enabled'] !== 'false', 'the schedule report is what the Console and the CLI read')
  const jobs = declaredJobs(javaSources(values))
  assertEquals(jobs.length, 1, 'one sample @AdharBatchJob (§5.20.9)')
  const job = jobs[0]
  assert(Object.values(job.params).some((p) => p.schedule && p.type === 'DATE'), 'the sample job has a business-date parameter (source SCHEDULE, type DATE)')
  const all = triggers(props)
  assertEquals(Object.keys(all), [job.bean], "the triggers are the declared job bean's")
  const list = all[job.bean]
  const kinds = list.map((t) => t.kind)
  assert(kinds.includes('cron') && kinds.includes('daily'), `one cron and one daily trigger, got ${kinds}`)
  assertEquals(new Set(list.map((t) => t.name)).size, list.length, 'trigger names are unique within the job')
  for (const t of list) {
    if (t.kind === 'cron') {
      const fields = t.expression.trim().split(/\s+/)
      assert(
        fields.length >= 6 && fields.length <= 7 && (fields[3] === '?' || fields[5] === '?'),
        `${t.name}: a Quartz cron (seconds first, '?' in a day field): ${t.expression}`,
      )
    }
    if (t.kind === 'daily') assert(t.from && t.to && t.every, `${t.name}: a daily trigger needs from, to and every`)
    if (t.calendar) {
      assert(Object.keys(props).some((k) => k.startsWith(`adhar.batch.quartz.calendars.${t.calendar}.`)), `${t.name}: calendar ${t.calendar} is defined`)
    }
    for (const [k, v] of Object.entries(t)) {
      const p = k.match(/^parameters\.(.+)$/)?.[1]
      if (!p) continue
      assert(job.params[p] && !job.params[p].schedule, `${t.name}: parameters.${p} must be a declared INPUT parameter of ${job.bean}`)
      if (job.params[p].allowed.length) assert(job.params[p].allowed.includes(v), `${t.name}: ${p}=${v} is not one of ${job.params[p].allowed}`)
    }
  }
  assertEquals(list.find((t) => t.kind === 'daily')?.calendar, 'weekdays', 'the daily trigger runs on the weekdays calendar (§5.20.9)')
  // The kit stops a run at its next chunk boundary within adhar.batch.shutdown.timeout; the kubelet must wait longer.
  const pod = rollout(values).spec.template.spec
  const timeout = Number((props['adhar.batch.shutdown.timeout'] ?? '90s').replace(/s$/, ''))
  const preStop = Number(pod.containers[0].lifecycle?.preStop?.sleep?.seconds ?? 0)
  assert(
    pod.terminationGracePeriodSeconds > preStop + timeout,
    `terminationGracePeriodSeconds ${pod.terminationGracePeriodSeconds} must exceed preStop ${preStop} + shutdown ${timeout}`,
  )
})

Deno.test("in-service batch jobs: the report Role lets the Rollout's ServiceAccount write its schedules ConfigMap, and nothing more", () => {
  const values = on()
  const name = String(values.name)
  const report = reportName(properties(values))
  const rbac = yamlDocs('deploy/base/rbac.yaml', values)
  const roles = rbac.filter((d) => d.kind === 'Role' && (d.rules ?? []).some((r: Doc) => (r.resourceNames ?? []).includes(report)))
  assertEquals(roles.length, 1, `one Role grants the report ConfigMap ${report}`)
  const role = roles[0]
  for (const r of role.rules as Doc[]) {
    assertEquals(r.apiGroups, [''], `${role.metadata.name}: core API group only`)
    assertEquals(r.resources, ['configmaps'], `${role.metadata.name}: configmaps only`)
    if (r.resourceNames) {
      assertEquals(r.resourceNames, [report])
      assertEquals([...r.verbs].sort(), ['get', 'patch', 'update'])
    } else {
      // RBAC cannot narrow create by name; nothing else is granted unnamed.
      assertEquals(r.verbs, ['create'])
    }
  }
  assert((role.rules as Doc[]).some((r) => !r.resourceNames), 'the first write creates the ConfigMap')
  const binding = rbac.find((d) => d.kind === 'RoleBinding' && d.roleRef?.name === role.metadata.name)
  assert(binding, `a RoleBinding binds ${role.metadata.name}`)
  assertEquals(binding.roleRef.kind, 'Role')
  assertEquals(binding.subjects?.map((s: Doc) => `${s.kind}/${s.name}`), [`ServiceAccount/${rollout(values).spec.template.spec.serviceAccountName}`])
  for (const env of ENVS) {
    const k = parseYaml(render(`deploy/envs/${env}/kustomization.yaml`, values)) as Doc
    const patch = (k.patches ?? []).find((p: Doc) => p.target?.kind === 'RoleBinding' && (!p.target.name || p.target.name === binding.metadata.name))
    assert(patch, `deploy/envs/${env} must patch every RoleBinding's subject namespace (the report one included)`)
    assert(String(patch.patch).includes('/subjects/0/namespace') && String(patch.patch).includes(env), `deploy/envs/${env}: the binding's subject is in ${env}`)
  }
  assertEquals(name, String(properties(values)['spring.application.name']))
  for (const v of ['defaults', 'all-off'] as Variant[]) {
    const off = yamlDocs('deploy/base/rbac.yaml', valuesFor(WEB, v, 'demo-app', { withDatabase: true }))
    assert(!off.some((d) => String(d.metadata?.name).endsWith('-batch-schedules')), `(${v}) no report Role without inServiceBatch`)
  }
})

Deno.test("in-service batch jobs: two alerts of the service's own, on the series the kit publishes, for its own pods", () => {
  const values = on({ tier: 'critical' })
  const name = String(values.name)
  const rule = yamlDocs('deploy/base/alerts.yaml', values).find((d) => d.kind === 'PrometheusRule')
  assert(rule, 'deploy/base/alerts.yaml holds the PrometheusRule')
  const rules = (rule.spec.groups as Doc[]).flatMap((g) => g.rules as Doc[])
  const byName = Object.fromEntries(rules.map((r) => [r.alert, r]))
  const failed = String(byName.BatchInServiceRunFailed?.expr ?? '')
  const stalled = String(byName.BatchInServiceScheduleStalled?.expr ?? '')
  assertMatch(failed, /adhar_batch_scheduler_fires_total\{[^}]*outcome="failed-to-start"/, 'BatchInServiceRunFailed: a fire that failed to start')
  assertMatch(failed, /spring_batch_job_seconds_count\{[^}]*="FAILED"/, 'BatchInServiceRunFailed: a run that ended FAILED')
  assertMatch(
    stalled,
    /time\(\) - .*adhar_batch_scheduler_next_fire_seconds\{[^}]*\}\)? > 600/,
    'BatchInServiceScheduleStalled: the next fire ten minutes overdue',
  )
  for (const [alert, expr] of [['BatchInServiceRunFailed', failed], ['BatchInServiceScheduleStalled', stalled]]) {
    for (const sel of expr.matchAll(/([a-z_]+)\{([^}]*)\}/g)) {
      assert(sel[2].includes(`pod=~"${name}-[a-z0-9]+-[a-z0-9]+"`), `${alert}: ${sel[1]} must select this service's Rollout pods`)
    }
    // The scrape target sets `job`; the series' own `job` (the schedule) reaches Prometheus as exported_job.
    for (const by of expr.matchAll(/by \(([^)]*)\)/g)) {
      assert(!by[1].split(',').map((l) => l.trim()).includes('job'), `${alert}: group by exported_job, not job`)
    }
    assertEquals(byName[alert].labels?.severity, 'critical', `${alert}: severity follows the tier`)
  }
  // The batch alerts are part of the option, not of "Alert on restarts, unavailable pods and 5xx": unticking
  // that box must not leave the in-service runs unwatched, nor bring the availability alerts back.
  const deployed = (values: Values) => (parseYaml(render('deploy/base/kustomization.yaml', values)) as Doc).resources as string[]
  for (const enableAlerts of [true, false]) {
    const values = on({ enableAlerts })
    assert(deployed(values).includes('alerts.yaml'), `(enableAlerts=${enableAlerts}) deploy/base/kustomization.yaml must deploy alerts.yaml`)
    const groups = yamlDocs('deploy/base/alerts.yaml', values).find((d) => d.kind === 'PrometheusRule')?.spec.groups as Doc[]
    const alerts = groups.flatMap((g) => g.rules as Doc[]).map((r) => r.alert)
    assert(alerts.includes('BatchInServiceRunFailed') && alerts.includes('BatchInServiceScheduleStalled'), `(enableAlerts=${enableAlerts}) both batch alerts`)
    assertEquals(alerts.includes('ApplicationPodRestarting'), enableAlerts, `(enableAlerts=${enableAlerts}) the availability alerts follow their own box`)
  }
  assert(!deployed(valuesFor(WEB, 'defaults', 'demo-app', { enableAlerts: false })).includes('alerts.yaml'), 'no alerts at all when neither asks')
  for (const v of ['defaults', 'all-off'] as Variant[]) {
    assert(
      !render('deploy/base/alerts.yaml', valuesFor(WEB, v, 'demo-app', { withDatabase: true })).includes('BatchInService'),
      `(${v}) no batch alerts without inServiceBatch`,
    )
  }
})

Deno.test('in-service batch jobs: QuartzRestartIT kills a replica mid-run and checks the alerts against the scrape', () => {
  for (const set of [{}, { withKafka: true, withCache: true, withAuth: false }]) {
    const sources = javaSources(on(set))
    const it = sources[RESTART_IT] ?? ''
    assertMatch(it, /class QuartzRestartIT/, 'QuartzRestartIT renders with inServiceBatch')
    assertMatch(it, /new SpringApplication\(Application\.class\)/, 'its replicas are the application as main starts it')
    assert((it.match(/replica\(/g) ?? []).length >= 3, 'two replicas (and the method that starts them)')
    assertMatch(it, /PostgreSQLContainer/, 'one Testcontainers PostgreSQL, shared')
    assertMatch(
      it,
      /getBean\(Scheduler\.class\)\.shutdown\(false\)/,
      "a replica dies: its Quartz scheduler stops checking in, nothing of the kit's shutdown runs",
    )
    assertMatch(it, /BatchTriggers\.Status\.PENDING/, 'the same identity on the other replica is the running run')
    assert(it.includes('deploy/base/alerts.yaml') && it.includes('/actuator/prometheus'), 'the alerts are checked against the scrape')
    if ('withKafka' in set) assert(it.includes('spring.kafka.listener.auto-startup=false'), 'no broker in the test: the sample listener stays off')
    // The kit's own rule, and app-ci's: tests never run on the common pool and never race the wall clock.
    for (const [f, src] of Object.entries(sources).filter(([f]) => f.startsWith('src/test/'))) {
      assert(!/supplyAsync|runAsync|parallelStream|commonPool/.test(src), `${f} must not run work on the common pool`)
    }
  }
  for (const v of ['defaults', 'all-off'] as Variant[]) {
    const values = valuesFor(WEB, v, 'demo-app', { withDatabase: true })
    for (const f of [RESTART_IT, ...filesUnder(WEB.skeleton).filter((f) => BATCH_SOURCES.some((d) => f.startsWith(d)))]) {
      assertEquals(render(f, values).trim(), '', `(${v}) ${f} renders empty without inServiceBatch`)
    }
    assert(!Object.keys(properties(values)).some((k) => k.startsWith('adhar.batch.')), `(${v}) no adhar.batch.* without inServiceBatch`)
    assertEquals(rollout(values).spec.template.spec.terminationGracePeriodSeconds, 30, `(${v}) the grace period is the service's own`)
  }
})

Deno.test("springboot-batch-service's docs say when to use the platform path and when the service's in-service option", () => {
  assert(BATCH_SERVICE, 'springboot-batch-service keeps the platform path (§5.20.9)')
  // deno-lint-ignore no-explicit-any
  const title = ((WEB.doc as any).spec.parameters as Doc[]).map((p) => p.properties?.inServiceBatch?.title).find(Boolean)
  const nav = JSON.stringify((parseYaml(read(`${BATCH_SERVICE.skeleton}/mkdocs.yml`)) as Doc).nav)
  for (const v of ['defaults', 'all-on', 'all-off'] as Variant[]) {
    const docs = render('docs/index.md', valuesFor(BATCH_SERVICE, v), BATCH_SERVICE)
    assert(nav.includes('index.md'), 'the page is in the docs navigation')
    assertMatch(docs, /^## The platform path, or in-service\?$/m, `(${v}) docs/index.md has the section`)
    assert(docs.includes(`\`${WEB.id}\``) && docs.includes(`**${title}**`), `(${v}) it names the template and the option exactly as the form shows them`)
    for (const need of ['Cadence', 'Business calendars', 'A run dies mid-way', 'Console and CLI']) {
      assert(docs.includes(need), `(${v}) the comparison covers ${need}`)
    }
    assert(
      render('docs/architecture.md', valuesFor(BATCH_SERVICE, v), BATCH_SERVICE).includes('index.md#the-platform-path-or-in-service'),
      `(${v}) architecture.md links it`,
    )
  }
})
