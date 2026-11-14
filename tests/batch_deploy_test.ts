/**
 * A template of the batch family deploys a `BatchJob` (platform.adhar.io/v1alpha1),
 * never its own CronJob. On the platform an application's Argo CD Application
 * per environment syncs the Kargo-rendered `stage/<env>` branch — a kustomize
 * build of `deploy/envs/<env>` — so a skeleton with a raw CronJob in `deploy/base`
 * and no overlays deploys NOTHING in any environment while reporting Healthy
 * (bat-service, 2026-11-13). The platform composes the CronJob, the run
 * template, the runner's identity and the alerts from the BatchJob (design
 * 0025 §6.6, §9.1), so the skeleton ships:
 *
 *   deploy/base/batchjob.yaml          the BatchJob, its job bean, image and database Secret
 *   deploy/base/database.yaml          the Database XR that publishes that Secret
 *   deploy/base/kustomizeconfig.yaml   group platform.adhar.io, kind BatchJob, path spec/parameters/image,
 *                                      so Kargo's kustomize-set-image pins the digest
 *   deploy/envs/{dev,test,prod}/       namespace, the Kargo-owned images: block, and the patches:
 *                                      dev suspends the schedule, prod sets priority critical
 *
 * Whether a template is batch is read the way the Console reads it
 * (apps/console/app/server/templates.ts isBatchTemplate): the label
 * `adhar.io/workload: batch`, a `springboot-batch-*` name, or the `batch` tag.
 *
 * A PARTITIONED template (`mode: partitioned`, design 0025 §5.10, §9.2) is one
 * image for a manager and `workers` worker pods, and its BatchJob alone does not
 * make it work: the kit's runner builds each pod's half of ONE @Configuration
 * from ADHAR_BATCH_ROLE, so the skeleton must also carry
 *
 *   workers, gridSize                 the gang and the partition count, inside the XRD's bounds
 *   spring-batch-integration,         the manager/worker step builders and the JDBC partition
 *   spring-integration-jdbc           channel; without them every worker pod exits 2 (unsupported)
 *   RemotePartitioning.manager(m, w)  the job's step, whose worker step `w` is a bean conditional
 *                                     on @ConditionalOnBatchRole(BatchRole.WORKER), so the manager
 *                                     never builds it and a worker finds it by that name
 *   no ADHAR_BATCH_* under env        the runner's contract is the composition's to set
 *   PartitionedJobIT                  a manager and two workers on one database, a worker killed
 *                                     mid-partition, only unfinished partitions re-run (§9.2)
 */
import { assert, assertEquals, assertMatch } from '@std/assert'
import { parse as parseYaml, parseAll as parseYamlAll } from '@std/yaml'
import { renderContent } from './lib/render.ts'
import { exists, filesUnder, read, type Template, templates, valueKeys, valuesFor, type Variant } from './lib/templates.ts'

const ALL = templates()
const VARIANTS: Variant[] = ['defaults', 'all-on', 'all-off']
const ENVS = ['dev', 'test', 'prod'] as const
const IMAGE_REPO = 'harbor-core.adhar-system.svc.cluster.local/library'
/** What the platform composes from a BatchJob; a skeleton that writes one of these competes with it. */
const COMPOSED_KINDS = ['CronJob', 'Job', 'Service', 'HorizontalPodAutoscaler', 'PodDisruptionBudget', 'PodMonitor', 'PrometheusRule', 'ServiceAccount', 'Role', 'RoleBinding']
const RETIRED_FILES = ['cronjob.yaml', 'service.yaml', 'hpa.yaml', 'pdb.yaml', 'rbac.yaml', 'podmonitor.yaml', 'alerts.yaml', 'resilience.yaml']

// deno-lint-ignore no-explicit-any
type Doc = Record<string, any>

function isBatch(t: Template): boolean {
  const meta = (t.doc.metadata ?? {}) as Doc
  const labels = (meta.labels ?? {}) as Doc
  const tags = Array.isArray(meta.tags) ? meta.tags.map(String) : []
  return labels['adhar.io/workload'] === 'batch' || /^springboot-batch(-|$)/.test(t.id) || tags.some((x) => x.trim().toLowerCase() === 'batch')
}

const BATCH = ALL.filter(isBatch)

function rendered(t: Template, rel: string, variant: Variant): string {
  return renderContent(read(`${t.skeleton}/${rel}`), valuesFor(t, variant))
}

function docs(t: Template, rel: string, variant: Variant): Doc[] {
  try {
    return (parseYamlAll(rendered(t, rel, variant)) as Doc[]).filter((d) => d && typeof d === 'object')
  } catch (e) {
    throw new Error(`${t.id} (${variant}): ${rel} does not render to YAML — ${(e as Error).message}`)
  }
}

function one(t: Template, rel: string, variant: Variant, kind: string): Doc {
  const found = docs(t, rel, variant).filter((d) => d.kind === kind)
  assertEquals(found.length, 1, `${t.id} (${variant}): ${rel} must hold exactly one ${kind}`)
  return found[0]
}

/** The JSON 6902 operations of an overlay patch aimed at the BatchJob. */
function batchJobPatch(t: Template, env: string, k: Doc): Doc[] {
  const patches = (k.patches ?? []) as Doc[]
  const mine = patches.filter((p) => p.target?.group === 'platform.adhar.io' && p.target?.kind === 'BatchJob')
  assertEquals(mine.length, 1, `${t.id}: deploy/envs/${env} must carry exactly one patch targeting the BatchJob`)
  const ops = parseYaml(String(mine[0].patch ?? '')) as Doc[]
  assert(Array.isArray(ops) && ops.length > 0, `${t.id}: deploy/envs/${env}'s BatchJob patch must be a list of operations`)
  return ops
}

Deno.test('the batch family is not empty (the Console lists springboot-batch-service there)', () => {
  assert(BATCH.length > 0, 'no template declares the batch family: adhar.io/workload: batch, a springboot-batch-* name or the batch tag')
})

for (const t of BATCH) {
  Deno.test(`${t.id}: declares the batch family where the scaffolders read it`, () => {
    const labels = ((t.doc.metadata as Doc)?.labels ?? {}) as Doc
    // The label is what the scaffolder stamps on the Application XR; a name or a tag only infers it.
    assertEquals(labels['adhar.io/workload'], 'batch', `${t.id}: template.yaml must carry the label adhar.io/workload: batch`)
  })

  Deno.test(`${t.id}: ships a BatchJob, its database and the three overlays, and no CronJob of its own`, () => {
    for (const f of ['batchjob.yaml', 'database.yaml', 'kustomization.yaml', 'kustomizeconfig.yaml']) {
      assert(exists(`${t.skeleton}/deploy/base/${f}`), `${t.id}: deploy/base/${f} is missing`)
    }
    for (const env of ENVS) assert(exists(`${t.skeleton}/deploy/envs/${env}/kustomization.yaml`), `${t.id}: deploy/envs/${env}/kustomization.yaml is missing`)
    for (const f of RETIRED_FILES) assert(!exists(`${t.skeleton}/deploy/base/${f}`), `${t.id}: deploy/base/${f} is what the platform composes from the BatchJob`)
    for (const v of VARIANTS) {
      for (const rel of filesUnder(`${t.skeleton}/deploy`).filter((f) => f.endsWith('.yaml') && !f.endsWith('kustomization.yaml') && !f.endsWith('kustomizeconfig.yaml'))) {
        for (const d of docs(t, `deploy/${rel}`, v)) {
          assert(!COMPOSED_KINDS.includes(String(d.kind)), `${t.id} (${v}): deploy/${rel} declares a ${d.kind}, which the platform composes from the BatchJob`)
        }
      }
    }
  })

  Deno.test(`${t.id}: kustomize knows where a BatchJob keeps its image`, () => {
    const cfg = parseYaml(read(`${t.skeleton}/deploy/base/kustomizeconfig.yaml`)) as Doc
    const images = (cfg?.images ?? []) as Doc[]
    assert(
      images.some((i) => i.group === 'platform.adhar.io' && i.kind === 'BatchJob' && i.path === 'spec/parameters/image'),
      `${t.id}: kustomizeconfig.yaml must declare {group: platform.adhar.io, kind: BatchJob, path: spec/parameters/image}`,
    )
    for (const v of VARIANTS) {
      const k = one(t, 'deploy/base/kustomization.yaml', v, 'Kustomization')
      assert((k.configurations ?? []).includes('kustomizeconfig.yaml'), `${t.id} (${v}): deploy/base/kustomization.yaml must list kustomizeconfig.yaml under configurations`)
      for (const r of ['batchjob.yaml', 'database.yaml']) assert((k.resources ?? []).includes(r), `${t.id} (${v}): deploy/base/kustomization.yaml must list ${r}`)
    }
  })

  for (const v of VARIANTS) {
    Deno.test(`${t.id} (${v}): the BatchJob names its job bean, the pinned image and its database's Secret`, () => {
      const values = valuesFor(t, v)
      const name = String(values.name)
      const job = one(t, 'deploy/base/batchjob.yaml', v, 'BatchJob')
      assertEquals(job.apiVersion, 'platform.adhar.io/v1alpha1')
      assertEquals(job.metadata?.name, name, `${t.id} (${v}): the BatchJob is named after the application`)
      assertEquals(job.metadata?.labels?.['adhar.io/workload'], 'batch')
      const p = job.spec?.parameters ?? {}
      assertEquals(p.image, `${IMAGE_REPO}/${name}:latest`, `${t.id} (${v}): the image Kargo pins must be the application's Harbor repository at :latest`)
      // The bean the runner starts: it must exist in the sources, or every run exits 2 (unknown job).
      assertMatch(String(p.job ?? ''), /^[A-Za-z][A-Za-z0-9_.-]*$/, `${t.id} (${v}): spec.parameters.job must be a Spring bean name`)
      const sources = filesUnder(`${t.skeleton}/src/main`).filter((f) => f.endsWith('.java')).map((f) => read(`${t.skeleton}/src/main/${f}`))
      const declaresBean = sources.some((src) => new RegExp(`\\bJob\\s+${p.job}\\s*\\(`).test(src) || src.includes(`"${p.job}"`))
      assert(declaresBean, `${t.id} (${v}): no bean named ${p.job} in src/main (batchjob.yaml's spec.parameters.job must match the Spring bean)`)
      // The JobRepository's Secret is the one CNPG publishes for the Database XR beside it.
      const db = one(t, 'deploy/base/database.yaml', v, 'Database')
      assertEquals(db.apiVersion, 'platform.adhar.io/v1alpha1')
      assertEquals(p.database?.secretRef, `${db.metadata?.name}-app`, `${t.id} (${v}): database.secretRef must be <Database name>-app`)
      for (const d of (p.parameters ?? []) as Doc[]) assertMatch(String(d.name ?? ''), /^[A-Za-z][A-Za-z0-9_.]*$/, `${t.id} (${v}): a declared parameter needs a name`)
      if (p.schedule) assertMatch(String(p.schedule.cron ?? ''), /^\S+(\s+\S+){4}$/, `${t.id} (${v}): schedule.cron must have five fields`)
    })

    Deno.test(`${t.id} (${v}): the overlays place the job the way Kargo promotes it`, () => {
      const values = valuesFor(t, v)
      const name = String(values.name)
      const scheduled = Boolean(one(t, 'deploy/base/batchjob.yaml', v, 'BatchJob').spec?.parameters?.schedule)
      for (const env of ENVS) {
        const k = one(t, `deploy/envs/${env}/kustomization.yaml`, v, 'Kustomization')
        assertEquals(k.namespace, env, `${t.id} (${v}): deploy/envs/${env} must deploy into namespace ${env}`)
        assertEquals(k.resources, ['../../base'], `${t.id} (${v}): deploy/envs/${env} builds on ../../base`)
        const images = (k.images ?? []) as Doc[]
        assertEquals(images.length, 1, `${t.id} (${v}): deploy/envs/${env} carries exactly one Kargo-owned images: entry`)
        assertEquals(images[0], { name: `${IMAGE_REPO}/${name}`, newTag: 'latest' }, `${t.id} (${v}): deploy/envs/${env}'s images: entry`)
        const ops = batchJobPatch(t, env, k)
        const suspend = ops.find((o) => o.path === '/spec/parameters/schedule/suspend')
        const priority = ops.find((o) => o.path === '/spec/parameters/priority')
        if (env === 'dev') {
          if (scheduled) assertEquals(suspend, { op: 'add', path: '/spec/parameters/schedule/suspend', value: true }, `${t.id} (${v}): dev suspends the schedule`)
          else assertEquals(suspend, undefined, `${t.id} (${v}): an on-demand job has no schedule to suspend in dev`)
          assertEquals(priority, undefined, `${t.id} (${v}): dev must not set a priority (critical is refused outside prod)`)
        } else if (env === 'test') {
          assertEquals(suspend, undefined, `${t.id} (${v}): test runs the real cron`)
          assertEquals(priority, undefined, `${t.id} (${v}): test must not set a priority (critical is refused outside prod)`)
        } else {
          assertEquals(suspend, undefined, `${t.id} (${v}): prod runs the real cron`)
          assertEquals(priority, { op: 'add', path: '/spec/parameters/priority', value: 'critical' }, `${t.id} (${v}): prod runs with priority critical`)
        }
      }
    })
  }
}

/* ───────────── the partitioned family (design 0025 §5.10, §9.2) ───────────── */

/** The XRD's bounds (xrd/batchjob.xrd.yaml): workers 1..64, gridSize 1..1024. */
const WORKERS = { min: 1, max: 64 }
const GRID_SIZE = { min: 1, max: 1024 }

function isPartitioned(t: Template): boolean {
  return VARIANTS.some((v) => one(t, 'deploy/base/batchjob.yaml', v, 'BatchJob').spec?.parameters?.mode === 'partitioned')
}

const PARTITIONED = BATCH.filter(isPartitioned)

/** The Java sources under src/main, by path. */
function javaSources(t: Template): Map<string, string> {
  const out = new Map<string, string>()
  for (const f of filesUnder(`${t.skeleton}/src/main`).filter((f) => f.endsWith('.java'))) out.set(f, read(`${t.skeleton}/src/main/${f}`))
  return out
}

/** A string literal, or a constant naming one (`static final String X = "..."`) in any of the sources. */
function resolveString(arg: string, sources: Map<string, string>): string | undefined {
  const literal = arg.trim().match(/^"([^"]*)"$/)
  if (literal) return literal[1]
  const name = arg.trim().split('.').pop() ?? ''
  for (const src of sources.values()) {
    const m = src.match(new RegExp(`static\\s+final\\s+String\\s+${name}\\s*=\\s*"([^"]*)"`))
    if (m) return m[1]
  }
  return undefined
}

/** The annotations directly above a @Bean method or class member, up to the method's signature. */
function beanDeclarations(src: string): Array<{ annotations: string; beanName: string; method: string; type: string }> {
  const out: Array<{ annotations: string; beanName: string; method: string; type: string }> = []
  const re = /((?:\s*@[A-Za-z.]+(?:\([^)]*(?:\([^)]*\)[^)]*)*\))?)+)\s*(?:public\s+|protected\s+|private\s+)?(?:static\s+)?([A-Za-z0-9_.<>, ?]+?)\s+([A-Za-z0-9_]+)\s*\(/g
  for (const m of src.matchAll(re)) {
    if (!/@Bean\b/.test(m[1])) continue
    const named = m[1].match(/@Bean\(\s*(?:name\s*=\s*|value\s*=\s*)?([^)]+?)\s*\)/)
    out.push({ annotations: m[1], beanName: named ? named[1] : m[3], method: m[3], type: m[2] })
  }
  return out
}

Deno.test('the partitioned template exists (design 0025 §9.2; the Volcano canary scaffolds springboot-batch-partitioned)', () => {
  assert(
    PARTITIONED.some((t) => t.id === 'springboot-batch-partitioned'),
    `no batch template named springboot-batch-partitioned deploys a BatchJob with mode: partitioned (partitioned: ${PARTITIONED.map((t) => t.id).join(', ') || 'none'})`,
  )
})

for (const t of BATCH) {
  if (PARTITIONED.includes(t)) continue
  Deno.test(`${t.id}: a single-pod job sets neither workers nor gridSize`, () => {
    for (const v of VARIANTS) {
      const p = one(t, 'deploy/base/batchjob.yaml', v, 'BatchJob').spec?.parameters ?? {}
      // The composition ignores them in single mode, so they would only mislead whoever reads the manifest.
      assert(!('workers' in p) && !('gridSize' in p), `${t.id} (${v}): workers/gridSize mean something only with mode: partitioned`)
    }
  })
}

for (const t of PARTITIONED) {
  for (const v of VARIANTS) {
    Deno.test(`${t.id} (${v}): the BatchJob is partitioned within the XRD's bounds and leaves the runner's contract to the composition`, () => {
      const p = one(t, 'deploy/base/batchjob.yaml', v, 'BatchJob').spec?.parameters ?? {}
      assertEquals(p.mode, 'partitioned', `${t.id} (${v}): every variant runs partitioned`)
      for (const [field, bounds] of [['workers', WORKERS], ['gridSize', GRID_SIZE]] as const) {
        const n = p[field]
        assert(Number.isInteger(n) && n >= bounds.min && n <= bounds.max, `${t.id} (${v}): ${field} must be an integer from ${bounds.min} to ${bounds.max}, was ${JSON.stringify(n)}`)
      }
      // A worker never starts the job: the form's defaults must give it partitions to share.
      assert(p.gridSize >= p.workers, `${t.id} (${v}): gridSize ${p.gridSize} below workers ${p.workers} leaves a worker with nothing to do`)
      for (const name of Object.keys((p.env ?? {}) as Doc)) {
        assert(!name.startsWith('ADHAR_BATCH_'), `${t.id} (${v}): env.${name} is the runner's contract; the composition sets it (and refuses it here)`)
      }
      assert(!/ADHAR_BATCH_MODE/.test(rendered(t, 'deploy/base/batchjob.yaml', v)), `${t.id} (${v}): ADHAR_BATCH_MODE would bind to adhar.batch.mode; the role already says partitioned`)
    })
  }

  Deno.test(`${t.id}: the form's workers and gridSize reach the BatchJob`, () => {
    for (const key of ['workers', 'gridSize']) assert(valueKeys(t).has(key), `${t.id}: fetch:template's values must pass ${key} (the BatchJob reads values.${key})`)
    const src = read(`${t.skeleton}/deploy/base/batchjob.yaml`)
    assertMatch(src, /^\s+workers:\s*\$\{\{\s*values\.workers\b/m, `${t.id}: batchjob.yaml's workers must come from values.workers`)
    assertMatch(src, /^\s+gridSize:\s*\$\{\{\s*values\.gridSize\b/m, `${t.id}: batchjob.yaml's gridSize must come from values.gridSize`)
  })

  Deno.test(`${t.id}: the POM carries what a worker pod needs to serve partitions`, () => {
    const pom = read(`${t.skeleton}/pom.xml`)
    for (const [group, artifact] of [['org.springframework.batch', 'spring-batch-integration'], ['org.springframework.integration', 'spring-integration-jdbc']]) {
      const dep = new RegExp(`<dependency>\\s*<groupId>${group.replace(/\./g, '\\.')}</groupId>\\s*<artifactId>${artifact}</artifactId>(?:(?!</dependency>)[\\s\\S])*</dependency>`)
      const found = pom.match(dep)
      assert(found, `${t.id}: pom.xml must depend on ${group}:${artifact} — without it every worker pod exits 2 (unsupported)`)
      assert(!/<scope>\s*(test|provided)\s*<\/scope>/.test(found[0]), `${t.id}: ${artifact} must be on the runtime classpath, not test/provided`)
    }
  })

  Deno.test(`${t.id}: one configuration — the job's manager step names a worker step only workers build`, () => {
    const sources = javaSources(t)
    const calls = [...sources.values()].flatMap((src) => [...src.matchAll(/\.manager\(\s*([^,]+?)\s*,\s*([^,]+?)\s*,/g)])
    assertEquals(calls.length, 1, `${t.id}: exactly one RemotePartitioning.manager(managerStep, workerStep, partitioner) builds the job's step`)
    const workerStep = resolveString(calls[0][2], sources)
    assert(workerStep, `${t.id}: cannot resolve the worker step name ${calls[0][2]} to a string`)
    const job = String(one(t, 'deploy/base/batchjob.yaml', 'defaults', 'BatchJob').spec?.parameters?.job ?? '')
    const beans = [...sources.values()].flatMap(beanDeclarations)
    const named = (b: { beanName: string }) => resolveString(b.beanName, sources) ?? b.beanName
    const step = beans.filter((b) => named(b) === workerStep && /\bStep\b/.test(b.type))
    assertEquals(step.length, 1, `${t.id}: exactly one @Bean Step named ${workerStep} (the worker finds the partition's step by that name)`)
    assertMatch(step[0].annotations, /@ConditionalOnBatchRole\(\s*BatchRole\.WORKER\s*\)/, `${t.id}: the worker step ${workerStep} must be @ConditionalOnBatchRole(BatchRole.WORKER), or the manager builds it too`)
    const jobBeans = beans.filter((b) => named(b) === job && /\bJob\b/.test(b.type))
    assertEquals(jobBeans.length, 1, `${t.id}: exactly one @Bean Job named ${job} (batchjob.yaml's spec.parameters.job)`)
    assert(!/@ConditionalOnBatchRole/.test(jobBeans[0].annotations), `${t.id}: the job ${job} must exist in every role — a worker computes the run's identity from its declared parameters`)
    assertMatch(jobBeans[0].annotations, /@AdharBatchJob\b/, `${t.id}: the job ${job} declares its parameters with @AdharBatchJob`)
    // Everything only a worker runs is kept out of the manager too, @StepScope readers and writers above all:
    // they read #{stepExecutionContext[...]}, which only a partition has.
    for (const b of beans.filter((b) => /@StepScope\b/.test(b.annotations))) {
      assertMatch(b.annotations, /@ConditionalOnBatchRole\(\s*BatchRole\.WORKER\s*\)/, `${t.id}: @StepScope bean ${b.method} must be @ConditionalOnBatchRole(BatchRole.WORKER)`)
    }
  })

  Deno.test(`${t.id}: PartitionedJobIT runs a manager and two workers through a killed worker (§9.2)`, () => {
    const it = filesUnder(`${t.skeleton}/src/test`).find((f) => f.endsWith('/PartitionedJobIT.java'))
    assert(it, `${t.id}: src/test must hold PartitionedJobIT (a manager and two worker contexts on one Testcontainers PostgreSQL)`)
    const src = read(`${t.skeleton}/src/test/${it}`)
    // The pods go through the kit's runner with the composition's roles, not through a JobOperator of the test's own.
    assertMatch(src, /AdharBatchApplication\.run\(/, `${t.id}: PartitionedJobIT must start each pod through AdharBatchApplication.run, as the image does`)
    for (const role of ['manager', 'worker']) assert(src.includes(`"${role}"`), `${t.id}: PartitionedJobIT starts a ${role} pod`)
    assertMatch(src, /PostgresTestContainer|PostgreSQLContainer/, `${t.id}: PartitionedJobIT runs on a Testcontainers PostgreSQL`)
  })
}
