/**
 * Every template ships a development container and an IDE setup, and they are
 * correct — see "Template standards" in ../README.md.
 *
 *   cd tests && deno task test
 *
 * Offline: the ids of editor extensions and IDE plugins are checked against
 * editor-ids.json here; editor_ids_test.ts checks that file against the VS
 * Code Marketplace, Open VSX and the JetBrains Marketplace (deno task test:net).
 */
import { assert, assertEquals, assertMatch } from '@std/assert'
import { parse as parseJsonc } from '@std/jsonc'
import { parse as parseYaml } from '@std/yaml'
import { Ajv2019 } from 'ajv/dist/2019.js'
import draft7 from 'ajv/dist/refs/json-schema-draft-07.json' with { type: 'json' }
import { renderContent, unsupportedSyntax } from './lib/render.ts'
import {
  APP_CI_DEFAULTS,
  declaredToolchain,
  exists,
  filesUnder,
  read,
  ROOT,
  strayTemplateDirs,
  type Template,
  templates,
  testRunner,
  valueKeys,
  valuesFor,
  type Variant,
} from './lib/templates.ts'

const ALL = templates()
const VARIANTS: Variant[] = ['defaults', 'all-on', 'all-off']
const IDS = JSON.parse(read(`${ROOT}/tests/editor-ids.json`)) as {
  vscode: Record<string, unknown>
  vscodeUnwanted: Record<string, unknown>
  jetbrains: Record<string, unknown>
}

/** What every template's skeleton must carry. */
const REQUIRED = [
  '.devcontainer/devcontainer.json',
  '.devcontainer/Dockerfile',
  '.devcontainer/post-create.sh',
  '.devcontainer/app-ci.sh',
  '.devcontainer/README.md',
  '.vscode/extensions.json',
  '.idea/externalDependencies.xml',
]
/** Byte-identical in every template: what is specific to one goes in devcontainer.json. */
const SHARED = ['.devcontainer/Dockerfile', '.devcontainer/post-create.sh', '.devcontainer/app-ci.sh', '.devcontainer/README.md']
const IDE_DIRS = ['.devcontainer', '.vscode', '.idea']

/** Cross-cutting editor tooling every application gets. */
const COMMON_VSCODE = [
  'eamodio.gitlens',
  'ms-azuretools.vscode-containers',
  'ms-kubernetes-tools.vscode-kubernetes-tools',
  'redhat.vscode-yaml',
  'editorconfig.editorconfig',
  '42crunch.vscode-openapi',
  'sonarsource.sonarlint-vscode',
  'usernamehw.errorlens',
  'humao.rest-client',
]
const COMMON_JETBRAINS = ['com.intellij.kubernetes', 'Docker', 'org.jetbrains.plugins.yaml', 'org.editorconfig.editorconfigjetbrains', 'org.sonarlint.idea']
const JETBRAINS_BACKENDS = ['IntelliJ', 'PyCharm', 'GoLand', 'WebStorm']
const OTEL_ENDPOINT = 'http://alloy.adhar-system.svc.cluster.local:4318'
const DOOD = 'ghcr.io/devcontainers/features/docker-outside-of-docker:1'

/** The official Dev Containers images, by toolchain; the tag carries the version. */
const IMAGES: Array<{ re: RegExp; toolchain: 'jdk' | 'node' | 'go' | 'python'; runners: string[] }> = [
  { re: /^mcr\.microsoft\.com\/devcontainers\/java:\d+-(\d+)-[a-z]+$/, toolchain: 'jdk', runners: ['maven', 'gradle'] },
  { re: /^mcr\.microsoft\.com\/devcontainers\/(?:typescript|javascript)-node:\d+-(\d+)-[a-z]+$/, toolchain: 'node', runners: ['npm'] },
  { re: /^mcr\.microsoft\.com\/devcontainers\/go:\d+-(\d+\.\d+)-[a-z]+$/, toolchain: 'go', runners: ['go'] },
  { re: /^mcr\.microsoft\.com\/devcontainers\/python:\d+-(\d+\.\d+)-[a-z]+$/, toolchain: 'python', runners: ['pytest'] },
]
/** The extensions a stack is not usable without, by the image's toolchain. */
const LANGUAGE_EXTENSIONS: Record<string, string[][]> = {
  jdk: [['vscjava.vscode-java-pack']],
  node: [['dbaeumer.vscode-eslint', 'denoland.vscode-deno']],
  go: [['golang.go']],
  python: [['ms-python.python'], ['charliermarsh.ruff']],
}
const LANGUAGE_PLUGINS: Record<string, string[]> = {
  jdk: ['org.jetbrains.idea.maven'],
  node: ['JavaScript'],
  go: ['org.jetbrains.plugins.go'],
  python: ['Pythonid'],
}
/** The command-line client for each backing service a template can be created with. */
const CLIENTS: Record<string, string> = {
  withDatabase: 'postgresql-client',
  withCache: 'valkey-tools',
  withRateLimit: 'valkey-tools',
  withKafka: 'kcat',
}

// deno-lint-ignore no-explicit-any
type Json = any

function devcontainer(t: Template, variant: Variant): Json {
  const src = read(`${t.skeleton}/.devcontainer/devcontainer.json`)
  return parseJsonc(renderContent(src, valuesFor(t, variant)))
}

function extensionsJson(t: Template): Json {
  return parseJsonc(renderContent(read(`${t.skeleton}/.vscode/extensions.json`), valuesFor(t, 'defaults')))
}

function jetbrainsPlugins(t: Template): string[] {
  const xml = renderContent(read(`${t.skeleton}/.idea/externalDependencies.xml`), valuesFor(t, 'defaults'))
  assert(/<component name="ExternalDependencies">/.test(xml), `${t.id}: .idea/externalDependencies.xml has no ExternalDependencies component`)
  return [...xml.matchAll(/<plugin id="([^"]+)"\s*\/>/g)].map((m) => m[1])
}

function imageOf(dc: Json): { image: string; toolchain: 'jdk' | 'node' | 'go' | 'python'; version: string; runners: string[] } {
  const image = dc?.build?.args?.BASE_IMAGE ?? ''
  for (const i of IMAGES) {
    const m = image.match(i.re)
    if (m) return { image, toolchain: i.toolchain, version: m[1], runners: i.runners }
  }
  throw new Error(`build.args.BASE_IMAGE ${JSON.stringify(image)} is not an official Dev Containers language image (java, typescript-node, go, python)`)
}

const schemaValidator = (() => {
  // validateFormats: false — the schemas' `uri` formats are documentation, and ajv would only warn about them.
  const ajv = new Ajv2019({ strict: false, allErrors: true, validateFormats: false })
  ajv.addMetaSchema(draft7)
  // The VS Code schema points its `settings` and `mcp` at schemas only VS Code itself serves.
  ajv.addSchema({ $id: 'vscode://schemas/settings/machine', type: 'object' })
  ajv.addSchema({ $id: 'vscode://schemas/mcp', type: 'object' })
  const base = JSON.parse(read(`${ROOT}/tests/schemas/devContainer.base.schema.json`))
  const vscode = JSON.parse(read(`${ROOT}/tests/schemas/devContainer.vscode.schema.json`))
  const validateBase = ajv.compile(base)
  const validateVscode = ajv.compile(vscode)
  return (doc: Json): string[] => {
    const errs: string[] = []
    if (!validateBase(doc)) errs.push(...(validateBase.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`))
    if (!validateVscode(doc)) errs.push(...(validateVscode.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`))
    return errs
  }
})()

Deno.test('there are templates to check', () => {
  assert(ALL.length >= 16, `found only ${ALL.length} templates under templates/`)
})

Deno.test('no directory under templates/ holds files without a template.yaml', () => {
  assertEquals(strayTemplateDirs(), [], 'a template needs templates/<id>/template.yaml, or the Console and the CLI never offer it')
})

Deno.test('every template ships a development container and an IDE setup', () => {
  const missing = ALL.flatMap((t) => REQUIRED.filter((f) => !exists(`${t.skeleton}/${f}`)).map((f) => `${t.id}/skeleton/${f}`))
  assertEquals(missing, [], 'see "Template standards" in README.md: copy these from the closest template')
})

Deno.test('the shared development-container files are the same in every template', () => {
  for (const f of SHARED) {
    const ref = ALL[0]
    const want = read(`${ref.skeleton}/${f}`)
    const differ = ALL.filter((t) => exists(`${t.skeleton}/${f}`) && read(`${t.skeleton}/${f}`) !== want).map((t) => t.id)
    assertEquals(differ, [], `${f} differs from ${ref.id}'s copy; what is specific to one application belongs in its devcontainer.json`)
  }
})

Deno.test('the IDE files use only template syntax the scaffolders render (anything else is dropped)', () => {
  const bad: string[] = []
  for (const t of ALL) {
    for (const dir of IDE_DIRS) {
      for (const rel of filesUnder(`${t.skeleton}/${dir}`)) {
        const src = read(`${t.skeleton}/${dir}/${rel}`)
        for (const s of unsupportedSyntax(src)) bad.push(`${t.id}/skeleton/${dir}/${rel}: ${s}`)
        for (const v of VARIANTS) {
          try {
            renderContent(src, valuesFor(t, v))
          } catch (e) {
            bad.push(`${t.id}/skeleton/${dir}/${rel} (${v}): ${(e as Error).message}`)
          }
        }
        for (const m of src.matchAll(/values\.(\w+)/g)) {
          if (!valueKeys(t).has(m[1])) bad.push(`${t.id}/skeleton/${dir}/${rel}: values.${m[1]} is not in template.yaml's fetch:template values`)
        }
      }
    }
  }
  assertEquals(bad, [])
})

Deno.test('git commits the IDE files (a skeleton .gitignore must not hide them)', async () => {
  // The skeleton's own .gitignore applies to THIS repository too: a skeleton
  // ignoring `.idea/` kept its externalDependencies.xml out of every commit, so
  // out of the Gitea mirror the scaffolders read. `git ls-files --ignored`, not
  // `git check-ignore`, which also reports paths a `!` pattern re-includes.
  const dirs = ALL.flatMap((t) => IDE_DIRS.map((d) => `${t.skeleton}/${d}`.replace(`${ROOT}/`, '')))
  const r = await new Deno.Command('git', {
    args: ['-C', ROOT, 'ls-files', '--others', '--ignored', '--exclude-standard', '--', ...dirs],
    stdout: 'piped',
  }).output()
  assert(r.success, 'git ls-files failed')
  const ignored = new TextDecoder().decode(r.stdout).split('\n').filter(Boolean)
  assertEquals(ignored, [], 'ignored by git, so never scaffolded: in the skeleton .gitignore use `.idea/*` + `!.idea/externalDependencies.xml`')
})

Deno.test('the shell scripts parse', async () => {
  for (const f of ['post-create.sh', 'app-ci.sh']) {
    const r = await new Deno.Command('bash', { args: ['-n', `${ALL[0].skeleton}/.devcontainer/${f}`], stderr: 'piped' }).output()
    assert(r.success, `${f}: ${new TextDecoder().decode(r.stderr)}`)
  }
})

Deno.test("app-ci.sh runs gitleaks and trivy the way app-ci's gates do", async () => {
  // lib/app-ci-gates.sh puts stand-ins for both scanners on the PATH and prints
  // what they were called with. app-ci's commands: adhar-supply-chain
  // 72-app-ci-stages.yaml, gitleaks-scan and source-scan (whose evaluate step
  // fails a run on HIGH,CRITICAL, as --severity with --exit-code does here).
  const r = await new Deno.Command('bash', {
    args: [`${ROOT}/tests/lib/app-ci-gates.sh`, ALL[0].skeleton, 'secrets', 'deps', 'manifests'],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  const calls = new TextDecoder().decode(r.stdout)
  const why = `\n${calls}\n${new TextDecoder().decode(r.stderr)}`
  assertMatch(calls, /^exit 0$/m, `app-ci.sh failed with every scanner passing${why}`)
  // The tree, not history; findings redacted; gitleaks reads the config by its extension: a .toml file.
  assertMatch(calls, /^gitleaks detect --source=\. --no-git --no-banner --redact --verbose --config=\S+\.toml --exit-code=1$/m, why)
  // app-ci's skip list first (a local run adds only .venv, which post-create.sh creates and app-ci never sees).
  const skip = 'node_modules,**/node_modules,dist,**/dist,target,**/target,.git,**/.git,generated,**/generated'
  const deps = calls.match(/^trivy fs --scanners vuln --severity HIGH,CRITICAL --exit-code 1 --skip-dirs (\S+) --timeout 20m --no-progress \.$/m)
  assert(deps, `the dependency scan${why}`)
  assert(deps[1] === skip || deps[1].startsWith(`${skip},`), `--skip-dirs ${deps[1]} must start with app-ci's ${skip}`)
  assertMatch(calls, /^trivy config -q --severity HIGH,CRITICAL --exit-code 1 --timeout 20m deploy$/m, `the manifest scan${why}`)
})

for (const t of ALL) {
  Deno.test(`${t.id}: devcontainer.json is valid JSONC against the Dev Container schema, rendered every way`, () => {
    for (const v of VARIANTS) {
      const dc = devcontainer(t, v)
      assertEquals(schemaValidator(dc), [], `${t.id} (${v})`)
    }
  })

  Deno.test(`${t.id}: the container's toolchain is the one the repository declares (app-ci's detect-toolchain)`, () => {
    const dc = devcontainer(t, 'defaults')
    const img = imageOf(dc)
    const runner = testRunner(t.skeleton)
    assert(img.runners.includes(runner), `${t.id}: app-ci tests it with ${runner}, but the container is a ${img.toolchain} image (${img.image})`)
    const declared = declaredToolchain(t.skeleton)[img.toolchain]
    assertEquals(
      img.version,
      img.toolchain === 'jdk' ? declared.value.replace(/^(1\.)?(\d+).*/, '$2') : declared.value,
      `${t.id}: ${declared.where} says ${img.toolchain} ${declared.value}, the container has ${img.image}`,
    )
    if (runner === 'maven' && !exists(`${t.skeleton}/.mvn/wrapper/maven-wrapper.properties`)) {
      const java = dc.features?.['ghcr.io/devcontainers/features/java:1']
      assertEquals(java?.mavenVersion, APP_CI_DEFAULTS.maven, `${t.id}: app-ci builds with Maven ${APP_CI_DEFAULTS.maven} when there is no wrapper`)
    }
  })

  Deno.test(`${t.id}: the platform's tools, a non-root user, telemetry, ports and the post-create step`, () => {
    for (const v of VARIANTS) {
      const dc = devcontainer(t, v)
      const values = valuesFor(t, v)
      assertEquals(dc.build?.dockerfile, 'Dockerfile', `${t.id}: build from the shared Dockerfile (trivy, gitleaks, adhar, kustomize)`)
      assert(dc.features?.['ghcr.io/devcontainers/features/kubectl-helm-minikube:1'], `${t.id}: kubectl and helm`)
      assert(dc.remoteUser && dc.remoteUser !== 'root', `${t.id}: remoteUser must be a non-root user`)
      assertEquals(dc.containerEnv?.OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_ENDPOINT, `${t.id}: OTel to the platform's collector`)
      assertEquals(dc.containerEnv?.OTEL_SERVICE_NAME, values.name, `${t.id}: OTel service name`)
      assertEquals(dc.postCreateCommand, 'bash .devcontainer/post-create.sh', `${t.id}: postCreateCommand`)
      assert(
        Array.isArray(dc.forwardPorts) && dc.forwardPorts.length > 0 && dc.forwardPorts.every((p: unknown) => typeof p === 'number'),
        `${t.id}: forwardPorts`,
      )
      // The app's port; a static SPA (served by nginx in the image) forwards its dev server instead.
      const spa = exists(`${t.skeleton}/nginx-app.conf`)
      const appPort = Number(values.port ?? 8080)
      assert(spa || dc.forwardPorts.includes(appPort), `${t.id} (${v}): forwardPorts must include the app port ${appPort}`)
      // Clients only for the backing services the application was created with.
      const pkgs = String(dc.build?.args?.CLIENT_PACKAGES ?? '').split(/\s+/).filter(Boolean)
      for (const pkg of new Set(Object.values(CLIENTS))) {
        const opts = Object.keys(CLIENTS).filter((o) => CLIENTS[o] === pkg && valueKeys(t).has(o))
        const wanted = opts.some((o) => Boolean(values[o]) && values[o] !== 'false')
        assertEquals(pkgs.includes(pkg), wanted, `${t.id} (${v}): ${pkg} ${wanted ? 'for' : 'without'} ${opts.join('/') || 'a backing service'}`)
      }
    }
  })

  Deno.test(`${t.id}: the host's Docker engine only where the tests need one, and reachable from Testcontainers`, () => {
    const dc = devcontainer(t, 'all-on')
    const pom = exists(`${t.skeleton}/pom.xml`) ? read(`${t.skeleton}/pom.xml`) : ''
    const needs = /testcontainers|quarkus-junit/.test(pom) || exists(`${t.skeleton}/compose.yaml`)
    assertEquals(
      Boolean(dc.features?.[DOOD]),
      needs,
      `${t.id}: docker-outside-of-docker ${needs ? 'is needed (Testcontainers / compose.yaml)' : 'hands the host engine to a container that does not need it'}`,
    )
    assert(!Object.keys(dc.features ?? {}).some((f) => f.includes('docker-in-docker')), `${t.id}: never Docker-in-Docker`)
    if (needs) {
      // Testcontainers otherwise dials the bridge gateway, where Docker Desktop publishes nothing:
      // "Can not connect to Ryuk at 172.17.0.1" and every integration test fails.
      assertEquals(dc.containerEnv?.TESTCONTAINERS_HOST_OVERRIDE, 'host.docker.internal', `${t.id}: TESTCONTAINERS_HOST_OVERRIDE`)
      assert((dc.runArgs ?? []).includes('--add-host=host.docker.internal:host-gateway'), `${t.id}: runArgs --add-host=host.docker.internal:host-gateway`)
    }
  })

  Deno.test(`${t.id}: compose.yaml services join the container's network`, () => {
    const root = `${t.skeleton}/compose.yaml`
    if (!exists(root)) {
      assert(!exists(`${t.skeleton}/.devcontainer/compose.yaml`), `${t.id}: .devcontainer/compose.yaml without a compose.yaml`)
      return
    }
    for (const v of VARIANTS) {
      const values = valuesFor(t, v)
      // Compose's own merge tags (!reset, !override) mean nothing to a plain YAML parser.
      const services = (f: string) =>
        Object.keys((parseYaml(renderContent(read(f), values).replace(/!(reset|override)\s/g, '')) as Json)?.services ?? {}).sort()
      const want = services(root)
      assertEquals(
        services(`${t.skeleton}/.devcontainer/compose.yaml`),
        want,
        `${t.id} (${v}): .devcontainer/compose.yaml must name exactly compose.yaml's services`,
      )
      const dc = devcontainer(t, v)
      assert(String(dc.containerEnv?.COMPOSE_FILE ?? '').endsWith('/.devcontainer/compose.yaml'), `${t.id}: COMPOSE_FILE`)
    }
  })

  Deno.test(`${t.id}: VS Code / code-server extensions and IntelliJ plugins`, () => {
    const dc = devcontainer(t, 'defaults')
    const img = imageOf(dc)
    const listed: string[] = dc.customizations?.vscode?.extensions ?? []
    const wanted = listed.filter((e) => !e.startsWith('-'))
    const unwanted = listed.filter((e) => e.startsWith('-')).map((e) => e.slice(1))
    const ext = extensionsJson(t)
    assertEquals(ext.recommendations, wanted, `${t.id}: .vscode/extensions.json recommendations = customizations.vscode.extensions`)
    assertEquals(ext.unwantedRecommendations ?? [], unwanted, `${t.id}: .vscode/extensions.json unwantedRecommendations = the "-" entries`)
    assertEquals(new Set(wanted).size, wanted.length, `${t.id}: an extension is listed twice`)
    const unverified = wanted.filter((e) => !(e in IDS.vscode))
    assertEquals(unverified, [], `${t.id}: not in editor-ids.json (verified on the VS Code Marketplace AND Open VSX, which code-server installs from)`)
    assertEquals(unwanted.filter((e) => !(e in IDS.vscodeUnwanted)), [], `${t.id}: unwanted extensions must be in editor-ids.json vscodeUnwanted`)
    assertEquals(COMMON_VSCODE.filter((e) => !wanted.includes(e)), [], `${t.id}: the cross-cutting extensions`)
    for (const anyOf of LANGUAGE_EXTENSIONS[img.toolchain]) {
      assert(anyOf.some((e) => wanted.includes(e)), `${t.id}: needs one of ${anyOf.join(', ')}`)
    }

    const jb = dc.customizations?.jetbrains
    assert(JETBRAINS_BACKENDS.includes(jb?.backend), `${t.id}: customizations.jetbrains.backend`)
    const plugins: string[] = jb?.plugins ?? []
    assertEquals(jetbrainsPlugins(t), plugins, `${t.id}: .idea/externalDependencies.xml = customizations.jetbrains.plugins`)
    assertEquals(plugins.filter((p) => !(p in IDS.jetbrains)), [], `${t.id}: not in editor-ids.json (verified on the JetBrains Marketplace)`)
    assertEquals(COMMON_JETBRAINS.filter((p) => !plugins.includes(p)), [], `${t.id}: the cross-cutting plugins`)
    assertEquals(LANGUAGE_PLUGINS[img.toolchain].filter((p) => !plugins.includes(p)), [], `${t.id}: the language plugin`)
  })

  Deno.test(`${t.id}: TypeScript is the project's own, and tsx is on the PATH`, () => {
    if (!exists(`${t.skeleton}/tsconfig.json`)) return
    const dc = devcontainer(t, 'defaults')
    const s = dc.customizations?.vscode?.settings ?? {}
    assertEquals(s['typescript.tsdk'], 'node_modules/typescript/lib', `${t.id}: the editor must use the project's TypeScript`)
    assert(String(dc.build?.args?.NPM_GLOBAL_PACKAGES ?? '').split(/\s+/).some((p: string) => /^tsx(@|$)/.test(p)), `${t.id}: tsx`)
  })
}
