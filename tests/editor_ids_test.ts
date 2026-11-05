/**
 * The editor extension and IDE plugin ids the templates install exist where
 * they are installed from:
 *
 *   - VS Code extensions on the VS Code Marketplace (VS Code, Dev Containers)
 *     AND on Open VSX (code-server, VSCodium), which carry different catalogues;
 *   - IntelliJ plugins on the JetBrains Marketplace.
 *
 * Needs the network, so it runs only when asked:  cd tests && deno task test:net
 * Run it whenever editor-ids.json changes, and record what it printed there.
 */
import { assertEquals } from '@std/assert'
import { ROOT } from './lib/templates.ts'

const NET = Deno.env.get('ADHAR_NET_TESTS') === '1'
const IDS = JSON.parse(Deno.readTextFileSync(`${ROOT}/tests/editor-ids.json`)) as {
  vscode: Record<string, unknown>
  vscodeUnwanted: Record<string, unknown>
  jetbrains: Record<string, unknown>
}

async function marketplace(id: string): Promise<string | undefined> {
  const r = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json;api-version=3.0-preview.1' },
    body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: id }], pageSize: 1 }], flags: 0x1 | 0x2 }),
  })
  const d = await r.json()
  const e = d?.results?.[0]?.extensions?.[0]
  if (!e || `${e.publisher?.publisherName}.${e.extensionName}`.toLowerCase() !== id.toLowerCase()) return undefined
  return e.versions?.[0]?.version
}

// deno-lint-ignore no-explicit-any
async function openVsxEntry(path: string): Promise<any> {
  const r = await fetch(`https://open-vsx.org/api/${path}`)
  if (!r.ok) {
    await r.body?.cancel()
    return undefined
  }
  const d = await r.json()
  return d?.error ? undefined : d
}

const vsxPath = (id: string) => `${id.slice(0, id.indexOf('.'))}/${id.slice(id.indexOf('.') + 1)}`

/**
 * The version code-server would install on a Linux workspace, or why it cannot:
 * an extension with native parts (Ruff, debugpy) publishes one build per
 * platform, so a universal build or both Linux ones must exist; and every
 * extensionDependencies entry must be on Open VSX too, or the install fails.
 * (An extensionPack member Open VSX lacks — Pylance in ms-python.python's — is
 * skipped, which is intended: basedpyright is the language server here.)
 */
async function openVsx(id: string): Promise<{ version?: string; problem?: string }> {
  const d = await openVsxEntry(vsxPath(id))
  if (!d) return { problem: 'not on Open VSX (code-server cannot install it)' }
  if ((d.targetPlatform ?? 'universal') !== 'universal') {
    for (const target of ['linux-x64', 'linux-arm64']) {
      if (!(await openVsxEntry(`${vsxPath(id)}/${target}`))) return { version: d.version, problem: `no ${target} build on Open VSX` }
    }
  }
  for (const dep of d.dependencies ?? []) {
    const depId = `${dep.namespace}.${dep.extension}`
    if (!(await openVsxEntry(vsxPath(depId)))) return { version: d.version, problem: `depends on ${depId}, which is not on Open VSX` }
  }
  return { version: d.version }
}

async function jetbrains(id: string): Promise<string | undefined> {
  const r = await fetch(`https://plugins.jetbrains.com/api/plugins/intellij/${encodeURIComponent(id)}`)
  if (!r.ok) {
    await r.body?.cancel()
    return undefined
  }
  return (await r.json())?.name
}

Deno.test({
  name: 'every VS Code extension is on the VS Code Marketplace and on Open VSX',
  ignore: !NET,
  sanitizeResources: false,
  async fn() {
    const missing: string[] = []
    for (const id of Object.keys(IDS.vscode)) {
      const [m, o] = await Promise.all([marketplace(id), openVsx(id)])
      console.log(`${id.padEnd(46)} marketplace=${m ?? 'MISSING'} open-vsx=${o.version ?? 'MISSING'}${o.problem ? ` (${o.problem})` : ''}`)
      if (!m) missing.push(`${id}: not on the VS Code Marketplace`)
      if (o.problem) missing.push(`${id}: ${o.problem}`)
    }
    assertEquals(missing, [])
  },
})

Deno.test({
  name: 'every unwanted VS Code extension is a real Marketplace extension',
  ignore: !NET,
  sanitizeResources: false,
  async fn() {
    const missing: string[] = []
    for (const id of Object.keys(IDS.vscodeUnwanted)) if (!(await marketplace(id))) missing.push(id)
    assertEquals(missing, [])
  },
})

Deno.test({
  name: 'every IntelliJ plugin is on the JetBrains Marketplace',
  ignore: !NET,
  sanitizeResources: false,
  async fn() {
    const missing: string[] = []
    for (const id of Object.keys(IDS.jetbrains)) {
      const name = await jetbrains(id)
      console.log(`${id.padEnd(40)} ${name ?? 'MISSING'}`)
      if (!name) missing.push(id)
    }
    assertEquals(missing, [])
  },
})
