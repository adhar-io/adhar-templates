/**
 * The templates in this repository, the values the scaffolders render them
 * with, and the toolchain each repository declares.
 */
import { parse as parseYaml } from '@std/yaml'
import { evalExpr, type Values } from './render.ts'

export const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
export const TEMPLATES = `${ROOT}/templates`

export function exists(path: string): boolean {
  try {
    Deno.statSync(path)
    return true
  } catch {
    return false
  }
}

export function read(path: string): string {
  return Deno.readTextFileSync(path)
}

/** Every file under `dir`, relative to it. */
export function filesUnder(dir: string, rel = ''): string[] {
  const out: string[] = []
  const here = rel ? `${dir}/${rel}` : dir
  if (!exists(here)) return out
  for (const e of Deno.readDirSync(here)) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory) out.push(...filesUnder(dir, r))
    else out.push(r)
  }
  return out.sort()
}

export interface Template {
  id: string
  dir: string
  skeleton: string
  doc: Record<string, unknown>
}

/** A template is a directory under templates/ with a template.yaml (what the Console and the CLI list). */
export function templates(): Template[] {
  const out: Template[] = []
  for (const e of [...Deno.readDirSync(TEMPLATES)].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory) continue
    const dir = `${TEMPLATES}/${e.name}`
    if (!exists(`${dir}/template.yaml`)) continue
    const doc = parseYaml(read(`${dir}/template.yaml`)) as Record<string, unknown>
    out.push({ id: e.name, dir, skeleton: `${dir}/${skeletonDir(doc)}`, doc })
  }
  return out
}

/** Directories under templates/ that hold files but no template.yaml: a template nobody can pick. */
export function strayTemplateDirs(): string[] {
  const out: string[] = []
  for (const e of Deno.readDirSync(TEMPLATES)) {
    if (!e.isDirectory) continue
    const dir = `${TEMPLATES}/${e.name}`
    // An empty directory tree is invisible to git, so to everyone but this checkout.
    if (!exists(`${dir}/template.yaml`) && filesUnder(dir).length > 0) out.push(e.name)
  }
  return out.sort()
}

// deno-lint-ignore no-explicit-any
function fetchTemplateStep(doc: any): Record<string, any> | undefined {
  const steps = doc?.spec?.steps
  return Array.isArray(steps) ? steps.find((s) => s?.action === 'fetch:template') : undefined
}

function skeletonDir(doc: Record<string, unknown>): string {
  const url = fetchTemplateStep(doc)?.input?.url
  return (typeof url === 'string' ? url : './skeleton').replace(/^\.\//, '').replace(/\/$/, '')
}

/** The keys the skeleton can use as `values.<key>`: fetch:template's values map. */
export function valueKeys(t: Template): Set<string> {
  return new Set(Object.keys(fetchTemplateStep(t.doc)?.input?.values ?? {}))
}

export type Variant = 'defaults' | 'all-on' | 'all-off'

/**
 * The values a scaffolder renders the skeleton with: the form's defaults (or
 * every checkbox on / off), evaluated through fetch:template's values map,
 * then the identity the scaffolder pins.
 */
export function valuesFor(t: Template, variant: Variant, name = 'demo-app'): Values {
  const params: Values = {}
  // deno-lint-ignore no-explicit-any
  const spec = (t.doc as any).spec ?? {}
  const pages = Array.isArray(spec.parameters) ? spec.parameters : [spec.parameters]
  for (const p of pages) {
    for (const [k, s] of Object.entries((p?.properties ?? {}) as Record<string, Record<string, unknown>>)) {
      if (s?.['ui:field'] === 'RepoUrlPicker' || s?.['ui:field'] === 'OwnerPicker') continue
      if (s && 'default' in s) params[k] = s.default
      else if (s?.type === 'boolean') params[k] = false
      if (s?.type === 'boolean' && variant !== 'defaults') params[k] = variant === 'all-on'
    }
    for (const dep of Object.values((p?.dependencies ?? {}) as Record<string, { oneOf?: Array<{ properties?: Record<string, Record<string, unknown>> }> }>)) {
      for (const alt of dep.oneOf ?? []) {
        for (const [k, s] of Object.entries(alt.properties ?? {})) if (s && 'default' in s && !(k in params)) params[k] = s.default
      }
    }
  }
  Object.assign(params, {
    name,
    description: 'Rendered by the templates test suite.',
    owner: 'group:developers',
    repoUrl: `gitea.platform.example.com?owner=adhar&repo=${name}`,
  })
  const values: Values = {}
  const map = (fetchTemplateStep(t.doc)?.input?.values ?? {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(map)) {
    if (typeof v !== 'string') {
      values[k] = v
      continue
    }
    const lone = v.match(/^\$\{\{\s*([\s\S]+?)\s*\}\}$/)
    values[k] = lone
      ? evalExpr(lone[1], { parameters: params })
      : v.replace(/\$\{\{\s*([\s\S]+?)\s*\}\}/g, (_, ex: string) => String(evalExpr(ex, { parameters: params }) ?? ''))
  }
  Object.assign(values, { gitOwner: 'adhar', repoName: name, hostname: `${name}.dev.platform.example.com` })
  return values
}

/**
 * The toolchain the repository declares, read the way app-ci's
 * detect-toolchain stage reads it (adhar-supply-chain 72-app-ci-stages.yaml),
 * in the same order of precedence: the buildpack's project.toml first, then
 * the files each ecosystem declares a version in, then app-ci's own default.
 * The defaults below are app-ci's; move them together.
 */
export const APP_CI_DEFAULTS = { jdk: '25', maven: '3.9', node: '24', go: '1.24', python: '3.12' }

export interface Declared {
  value: string
  where: string
}

function bpenv(skeleton: string, name: string): string {
  const f = `${skeleton}/project.toml`
  if (!exists(f)) return ''
  const lines = read(f).split('\n')
  let found = false
  for (const line of lines) {
    if (!found && new RegExp(`^\\s*name\\s*=\\s*"${name}"`).test(line)) {
      found = true
      continue
    }
    if (found && /^\s*value/.test(line)) return line.replace(/.*=\s*"?|"?\s*$/g, '')
  }
  return ''
}
const major = (v: string) => v.replace(/^[^0-9]*/, '').replace(/^(1\.)?([0-9]+).*/, '$2')
const minor = (v: string) => (v.match(/([0-9]+\.[0-9]+)/)?.[1] ?? '')
const firstLine = (f: string) => read(f).split('\n')[0] ?? ''

function first(...tries: Array<() => Declared | undefined>): Declared | undefined {
  for (const t of tries) {
    const d = t()
    if (d?.value) return d
  }
  return undefined
}

export function declaredToolchain(skeleton: string): Record<'jdk' | 'node' | 'go' | 'python', Declared> {
  const f = (name: string) => `${skeleton}/${name}`
  const has = (name: string) => exists(f(name))
  const jdk = first(
    () => ({ value: bpenv(skeleton, 'BP_JVM_VERSION'), where: 'project.toml BP_JVM_VERSION' }),
    () => has('.java-version') ? { value: major(firstLine(f('.java-version'))), where: '.java-version' } : undefined,
    () => has('.sdkmanrc') ? { value: major(read(f('.sdkmanrc')).match(/^java=(.*)$/m)?.[1] ?? ''), where: '.sdkmanrc' } : undefined,
    () => has('.tool-versions') ? { value: major(read(f('.tool-versions')).match(/^java\s+(.*)$/m)?.[1] ?? ''), where: '.tool-versions' } : undefined,
    () =>
      has('pom.xml')
        ? {
          value: major(read(f('pom.xml')).match(/<(java\.version|maven\.compiler\.release|maven\.compiler\.target)>\s*([0-9.]+)\s*</)?.[2] ?? ''),
          where: 'pom.xml',
        }
        : undefined,
  ) ?? { value: APP_CI_DEFAULTS.jdk, where: "app-ci's default" }
  const node = first(
    () => ({ value: major(bpenv(skeleton, 'BP_NODE_VERSION')), where: 'project.toml BP_NODE_VERSION' }),
    () => has('.nvmrc') ? { value: major(firstLine(f('.nvmrc'))), where: '.nvmrc' } : undefined,
    () => has('.node-version') ? { value: major(firstLine(f('.node-version'))), where: '.node-version' } : undefined,
    () => has('.tool-versions') ? { value: major(read(f('.tool-versions')).match(/^nodejs\s+(.*)$/m)?.[1] ?? ''), where: '.tool-versions' } : undefined,
    () =>
      has('package.json')
        ? { value: read(f('package.json')).match(/"node"\s*:\s*"[^0-9]*([0-9]+)/)?.[1] ?? '', where: 'package.json engines.node' }
        : undefined,
  ) ?? { value: APP_CI_DEFAULTS.node, where: "app-ci's default" }
  const go = first(
    () => ({ value: minor(bpenv(skeleton, 'BP_GO_VERSION')), where: 'project.toml BP_GO_VERSION' }),
    () => has('go.mod') ? { value: read(f('go.mod')).match(/^go\s+([0-9]+\.[0-9]+)/m)?.[1] ?? '', where: 'go.mod' } : undefined,
  ) ?? { value: APP_CI_DEFAULTS.go, where: "app-ci's default" }
  const python = first(
    () => ({ value: minor(bpenv(skeleton, 'BP_CPYTHON_VERSION')), where: 'project.toml BP_CPYTHON_VERSION' }),
    () => has('.python-version') ? { value: minor(firstLine(f('.python-version'))), where: '.python-version' } : undefined,
    () => has('runtime.txt') ? { value: read(f('runtime.txt')).match(/^python-?([0-9]+\.[0-9]+)/m)?.[1] ?? '', where: 'runtime.txt' } : undefined,
    () =>
      has('pyproject.toml')
        ? { value: read(f('pyproject.toml')).match(/^requires-python\s*=\s*"[^0-9]*([0-9]+\.[0-9]+)/m)?.[1] ?? '', where: 'pyproject.toml requires-python' }
        : undefined,
  ) ?? { value: APP_CI_DEFAULTS.python, where: "app-ci's default" }
  return { jdk, node, go, python }
}

/** The runner app-ci's test-auto picks, by the files present, in its order. */
export function testRunner(skeleton: string): 'maven' | 'gradle' | 'npm' | 'go' | 'pytest' | 'none' {
  const has = (n: string) => exists(`${skeleton}/${n}`)
  if (has('pom.xml')) return 'maven'
  if (has('gradlew') || has('build.gradle') || has('build.gradle.kts')) return 'gradle'
  if (has('package.json')) return 'npm'
  if (has('go.mod')) return 'go'
  if (has('pyproject.toml') || has('requirements.txt')) return 'pytest'
  return 'none'
}
